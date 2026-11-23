// The exported replay page's own script (Export Writing History…, replay-export.js):
// it plays a book's Writing History in any browser, and checks what it
// holds without trusting NEO: each session's hash chain, that replaying the
// sessions gives every chapter write they recorded, each seal's Ed25519
// signature and chain, the sessions it seals, what its timestamp tokens
// stamp and when, and the evidence report's figures worked out again.
// Runs over recording.js (window.NeoRecording). Its words come from the
// page's data in the writer's language (English is the key: app.js,
// replayPageStrings, lists every one). In Node it exports its checks, for
// the tests.
(function (root, factory) {
  const node = typeof module === 'object' && module.exports;
  const api = factory(node ? require('./recording.js') : root.NeoRecording);
  if (node) module.exports = api;
  else {
    root.NeoReplay = api;
    if (root.document) api.start(root.document).catch((err) => api.fail(root.document, err));
    else if (typeof root.postMessage === 'function') api.serve(root); // the page's worker
  }
})(typeof self !== 'undefined' ? self : this, function (Rec) {
  'use strict';

  let words = {};
  const T = (s, vars = {}) => String(words[s] || s).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  /* ---------- bytes ---------- */

  function fromB64(b64) {
    const s = atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  const hex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const fromHex = (h) => new Uint8Array((String(h).match(/../g) || []).map((x) => parseInt(x, 16)));
  const sha256 = async (bytes) => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  async function gunzip(b64) {
    const stream = new Blob([fromB64(b64)]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).text();
  }
  const indexOf = (hay, needle) => {
    for (let i = 0; i + needle.length <= hay.length; i++) {
      let j = 0;
      while (j < needle.length && hay[i + j] === needle[j]) j++;
      if (j === needle.length) return i;
    }
    return -1;
  };

  // JSON with sorted keys, as proof.js signs it
  function canonical(v) {
    if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
    if (v && typeof v === 'object') {
      return '{' + Object.keys(v).filter((k) => v[k] !== undefined).sort()
        .map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
    }
    return JSON.stringify(v);
  }

  // The time a timestamp token says it stamped: its TSTInfo's genTime, the
  // first GeneralizedTime in the token (the certificates and signed
  // attributes come after it)
  function genTime(bytes) {
    for (let i = 0; i + 17 < bytes.length; i++) {
      if (bytes[i] !== 0x18) continue;
      const n = bytes[i + 1];
      if (n < 15 || n > 24 || i + 2 + n > bytes.length) continue;
      const s = String.fromCharCode(...bytes.subarray(i + 2, i + 2 + n));
      const m = /^(\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)(\.\d+)?Z$/.exec(s);
      if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], m[7] ? Math.round(parseFloat(m[7]) * 1000) : 0);
    }
    return null;
  }

  /* ---------- what the page holds ---------- */

  // the sessions, read: { id, device, name, open, text, header, day }
  async function loadSessions(data) {
    const out = [];
    for (const s of data.sessions) {
      const text = await gunzip(s.gz);
      const { header } = Rec.parseSession(text);
      out.push({ id: s.id, device: s.device, name: s.name, open: s.open, text, header, day: Rec.sessionDay(header) });
    }
    return out;
  }

  // Each device's chains: every session's verifies (an open one's up to its
  // last flush), and each names the one before it (`prev`)
  // cover: an object to fill with what Rec.timeCover needs of each
  // device's sessions, when the caller wants the time cover too
  function checkChains(sessions, partial, cover = null) {
    const out = {};
    const last = {};
    for (const s of sessions) {
      const d = out[s.device] || (out[s.device] = { sessions: 0, whole: 0, broken: [], unchained: [] });
      d.sessions++;
      if (partial) continue;
      const v = Rec.verifyChain(s.text);
      // what the time cover needs of it (Rec.timeCover): its heads, and when it began and ended
      const { header, lines } = Rec.parseSession(s.text);
      const from = header ? Date.parse(header.startedAt) : null;
      let to = from;
      for (const w of Rec.lineWalls(header, lines).walls) if (Number.isFinite(w)) to = Math.max(to, w);
      if (cover) (cover[s.device] || (cover[s.device] = [])).push({ id: s.id, open: !!s.open, last: v.last, settled: v.settled, wrote: v.wrote, from, to });
      if (v.ok || (s.open && v.breaks.every((b) => b.reason === 'unsealed' || b.reason === 'torn'))) d.whole++;
      else d.broken.push(s.id);
      if (s.device in last && s.header && s.header.prev !== last[s.device]) d.unchained.push(s.id);
      last[s.device] = v.last;
    }
    return out;
  }

  // A hash as Rec.digest makes it (SHA-256 cut to 128 bits, base64url),
  // with WebCrypto: many times faster than recording.js's own
  async function digest(text) {
    const b = (await sha256(new TextEncoder().encode(text))).subarray(0, 16);
    return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  // Each device's sessions replayed: every chapter write they record, and
  // whether the replay gives exactly what was written (Rec.replayCheck, with
  // the writes hashed by WebCrypto a session at a time). progress(n) after
  // each session.
  async function checkReplay(sessions, progress = () => {}) {
    const out = {};
    const docs = {};
    let n = 0;
    for (const s of sessions) {
      const r = out[s.device] || (out[s.device] = { writes: 0, bad: 0, problems: 0 });
      const doc = docs[s.device] || (docs[s.device] = {});
      const parsed = Rec.parseSession(s.text);
      if (!parsed.known) { r.problems++; continue; }
      const problems = [];
      const lp = Rec.linePlayer(parsed.lines, doc, { problems });
      const writes = [];
      let cur = null;
      parsed.lines.forEach((line, i) => {
        lp.play(i);
        if (!Array.isArray(line)) return;
        if (line[1] === 'b' || line[1] === 'ch') cur = line[2];
        else if (line[1] === 'w') {
          const c = doc[line.length > 3 ? line[3] : cur];
          writes.push({ want: line[2], text: c === undefined ? null : c.toString() });
        }
      });
      const got = await Promise.all(writes.map((w) => (w.text === null ? null : digest(w.text))));
      r.writes += writes.length;
      r.bad += writes.filter((w, i) => got[i] !== w.want).length;
      r.problems += problems.length;
      progress(++n);
    }
    return out;
  }

  // Every `h` hash a session holds: a seal names one of them
  function heads(text) {
    const out = new Set();
    for (const m of text.matchAll(/^\[0,"h",\d+,"([A-Za-z0-9_-]+)"\]$/gm)) out.add(m[1]);
    return out;
  }

  // An export of some chapters: each chapter's own lines in each session,
  // and its chain after each as the seals' `chapters` count them
  // (Rec.ChapterChains, by their chapterHash `v`): { 'device/id': {
  // <chapter>: { nos: [its own lines' numbers], hashes: [the chain after
  // each] } } }. With `hash` false, the line numbers alone (to place the
  // timestamps).
  function chapterChains(sessions, hash = true, v = Rec.CHAPTER_HASH) {
    const out = {};
    for (const s of sessions) {
      const { header, lines } = Rec.parseSession(s.text);
      const per = Rec.chapterLines(lines, hash ? v : 1);
      const cc = hash ? new Rec.ChapterChains(header, v) : null;
      const mine = out[s.device + '/' + s.id] = {};
      per.forEach((c, i) => {
        if (!c || (!hash && !c.ch)) return;
        const st = cc ? cc.add(c) : c;
        if (!st) return;
        const x = mine[c.ch] || (mine[c.ch] = { nos: [], hashes: [] });
        x.nos.push(i + 2);
        if (cc) x.hashes.push(st.h);
      });
    }
    return out;
  }

  // the chapters an export of some chapters holds, or null for the whole book
  function keptOf(sessions) {
    let kept = null;
    for (const s of sessions) if (s.header && Array.isArray(s.header.kept)) for (const ch of s.header.kept) (kept || (kept = new Set())).add(ch);
    return kept;
  }

  const DRAND = { genesis: 1692803367, period: 3 };
  const TSA_NAMES = { digicert: 'DigiCert', sectigo: 'Sectigo', globalsign: 'GlobalSign' };

  // One device's seals ([{ name, b64 }]): each signature (Ed25519, with
  // WebCrypto), its place in the chain, the sessions it seals (`sessions`,
  // id -> its h hashes, and `others`, each other device -> its sessions the
  // same way), the stamps it covers, its drand round, and its timestamp
  // tokens: that each stamps this seal's SHA-256, and when. A token's own
  // signature isn't checked here: openssl does that (below). In an export
  // of some chapters (`kept`, with `chains(chapterHash)` from
  // chapterChains) the sessions' chains aren't there, so the heads can't be
  // checked: what it seals of those chapters' lines is, and `kept` counts
  // them. `fingerprint`: the SHA-256 of its file.
  async function checkSeals(files, sessions, others = new Map(), { kept = null, chains = null } = {}) {
    const byName = new Map(files.map((f) => [f.name, fromB64(f.b64)]));
    const out = { key: null, seals: [], ed25519: true };
    let prev = null;
    let key = null;
    for (const f of files) {
      const m = /^(\d{6})\.json$/.exec(f.name);
      if (!m) continue;
      const seq = +m[1];
      const bytes = byName.get(f.name);
      const s = { seq, at: null, ok: true, problems: [], stamps: [], after: null, by: null, kept: 0 };
      out.seals.push(s);
      const bad = (why) => { s.ok = false; s.problems.push(why); };
      let body;
      try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { bad(T('it can’t be read')); prev = null; continue; }
      s.at = Date.parse(body.at);
      s.heads = body.heads || {};
      s.others = body.others || {};
      s.chapters = body.chapters || {};
      s.chapterHash = body.chapterHash || 1;
      if (body.seq !== seq || seq !== out.seals.length) bad(T('seals before it are missing'));
      const { sig, ...signed } = body;
      if (out.key === null) out.key = body.publicKey;
      else if (body.publicKey !== out.key) bad(T('it is signed with another key than the first seal'));
      try {
        if (!key || key.b64 !== body.publicKey) key = { b64: body.publicKey, k: await crypto.subtle.importKey('raw', fromB64(body.publicKey), { name: 'Ed25519' }, false, ['verify']) };
        const ok = await crypto.subtle.verify({ name: 'Ed25519' }, key.k, fromB64(sig), new TextEncoder().encode(canonical(signed)));
        if (!ok) bad(T('its signature doesn’t verify'));
      } catch {
        out.ed25519 = false; // this browser can't check Ed25519
      }
      if ((body.prev || null) !== (out.seals.length > 1 ? prev : null)) bad(T('it doesn’t name the seal before it'));
      const digest = await sha256(bytes);
      prev = hex(digest);
      s.fingerprint = prev;
      const sealed = [[sessions, body.heads], ...Object.entries(body.others || {}).map(([d, hs]) => [others.get(d) || new Map(), hs])];
      if (!kept) {
        for (const [mine, hs] of sealed) {
          for (const [id, h] of Object.entries(hs || {})) {
            const held = mine.get(id);
            if (!held) bad(T('a session it seals isn’t in this export'));
            else if (!held.has(h)) bad(T('a session it seals isn’t what it sealed'));
          }
        }
      } else {
        for (const [d, ss] of Object.entries(body.chapters || {})) {
          for (const [id, chs] of Object.entries(ss || {})) {
            for (const [ch, v] of Object.entries(chs || {})) {
              if (!kept.has(ch)) continue;
              const held = chains(s.chapterHash)[d + '/' + id];
              if (!held) { bad(T('a session it seals isn’t in this export')); continue; }
              const c = held[ch];
              const n = Array.isArray(v) ? v[0] : 0;
              if (!c || !(n >= 1) || c.hashes.length < n || c.hashes[n - 1] !== v[1]) bad(T('a chapter it seals isn’t what it sealed'));
              else s.kept++;
            }
          }
        }
      }
      for (const [name, want] of Object.entries(body.tokens || {})) {
        const t = byName.get(name);
        if (t && hex(await sha256(t)) !== want) bad(T('a stamp it covers isn’t what it covered'));
      }
      for (const a of body.after || []) {
        if (a.beacon !== 'drand-quicknet') continue;
        const when = (DRAND.genesis + (a.round - 1) * DRAND.period) * 1000;
        if (hex(await sha256(fromHex(a.signature))) !== a.randomness) bad(T('its drand round isn’t drand’s'));
        else if (when > s.at + 60000) bad(T('its drand round is later than the seal says it was made'));
        else s.after = when;
      }
      for (const [name, t] of byName) {
        const tm = /^(\d{6})\.([a-z0-9-]+)\.tsr$/.exec(name);
        if (!tm || +tm[1] !== seq) continue;
        const stamped = indexOf(t, digest) >= 0;
        const at = genTime(t);
        s.stamps.push({ tsa: tm[2], file: name, stamped, at });
        if (!stamped) bad(T('a timestamp token stamps something else'));
        else if (at !== null) s.by = s.by === null ? at : Math.min(s.by, at);
      }
    }
    // a seal not stamped itself is fixed in time by the next one stamped
    let later = null;
    for (let i = out.seals.length - 1; i >= 0; i--) {
      const s = out.seals[i];
      if (s.by !== null && s.ok) later = s.by;
      else if (s.by === null) s.byLater = later;
      if (!s.ok) later = null;
    }
    return out;
  }

  // the evidence figures worked out again, and whether they're NEO's
  function checkEvidence(sessions, evidence) {
    if (!evidence) return null;
    const mine = Rec.evidence(sessions.map((s) => ({ id: s.id, device: s.device, text: s.text })));
    return JSON.stringify(mine) === JSON.stringify(evidence);
  }

  /* ---------- the book, day by day ---------- */

  // The sessions as days, and the page as each day began: a day is played
  // from the nearest day start kept, and a day start is kept every tenth day.
  // `all` is every day, played to reach the next; `days` the ones shown. A
  // page of some chapters still holds the sessions that changed only others,
  // since a later session can start from where they left its chapters, but
  // there's nothing in them to see: it shows only the days that changed its
  // chapters (changesIn).
  class Book {
    constructor(sessions, partial = false) {
      // a page of some chapters: when each session changed them
      this.changes = null;
      let shows = null;
      if (partial) {
        const at = new Map(sessions.map((s) => [s.device + '/' + s.id, changesIn(s)]));
        shows = (s) => at.get(s.device + '/' + s.id).length > 0;
        this.changes = [...at.values()].flat().sort((a, b) => a - b);
      }
      const by = new Map();
      for (const s of sessions) {
        const k = s.day || '';
        if (!by.has(k)) by.set(k, []);
        by.get(k).push(s);
      }
      this.all = [...by.keys()].sort().map((day, at) => ({ day, at, list: by.get(day).sort(Rec.sessionOrder) }));
      const shown = shows ? this.all.filter((d) => d.list.some(shows)) : this.all;
      this.days = shown.length ? shown : this.all;
      this.kept = new Map([[0, null]]);
      // the chapter order each shown day began with, from the last `o` line
      // of the days before it
      let order = null;
      const before = this.all.map((d) => {
        const was = order;
        for (const s of d.list) {
          let found = null;
          for (const m of s.text.matchAll(/^\[\d+,"o",(\[[^\]]*\])\]$/gm)) found = m[1];
          if (found) try { order = JSON.parse(found); } catch { /* not one */ }
        }
        return was;
      });
      this.orders = this.days.map((d) => before[d.at]);
      this.lastOrder = order; // …and the last day's
    }

    static snapshot(pg) {
      const devices = {};
      for (const [d, doc] of Object.entries(pg.docs)) devices[d] = Rec.htmlOf(doc);
      return { page: Rec.htmlOf(pg.doc), devices, links: pg.links() };
    }

    // every day's sessions (all[k], shown or not) played onto pg
    playDay(pg, k) {
      const players = this.all[k].list.map((s) => {
        const p = Rec.parseSession(s.text);
        if (!p.known) return { walls: [], play() {} };
        const lp = Rec.linePlayer(p.lines, null, { page: pg, device: s.device });
        return { walls: Rec.lineWalls(p.header, p.lines).walls, play: lp.play };
      });
      Rec.playInterleaved(players);
    }

    // the page as shown day k began, a Page to play on; the days kept are
    // counted in all of them
    async start(shown) {
      const k = this.days[shown].at;
      let j = k;
      while (!this.kept.has(j)) j--;
      const snap = this.kept.get(j);
      const pg = snap ? new Rec.Page(snap) : new Rec.Page();
      for (; j < k; j++) {
        this.playDay(pg, j);
        if ((j + 1) % 10 === 0) this.kept.set(j + 1, Book.snapshot(pg));
        await tick();
      }
      return pg;
    }

    // a day, ready to play: a History built from its start
    async day(k) {
      const h = new Rec.History(this.days[k].list.map((s) => ({ id: s.id, device: s.device, open: s.open, text: s.text })));
      h.build(await this.start(k));
      return h;
    }
  }

  /* ---------- the page ---------- */

  // When a session changed the chapters it holds, as wall-clock times: its
  // splices, typing, deletions, a chapter taken out, and a `b` that brought
  // a chapter in (not one only saying what was already there)
  const STATES = new Set(['continue', 'anchor', 'baseline']);
  function changesIn(s) {
    const p = Rec.parseSession(s.text);
    if (!p.known) return [];
    const { walls } = Rec.lineWalls(p.header, p.lines);
    const out = [];
    p.lines.forEach((line, i) => {
      if (!Array.isArray(line)) return;
      const k = line[1];
      const changed = k === 'e' || k === 'rd' || k === 'd' || (k === 'r' && !!line[2]) || (k === 'b' && !STATES.has(line[5]));
      if (changed && Number.isFinite(walls[i])) out.push(walls[i]);
    });
    return out;
  }

  // The tags a page of some chapters shows: those on a day it shows, with a
  // change to its chapters since the last one it showed. A snapshot taken
  // while other chapters were written is the same text again.
  function tagsShown(tags, book) {
    if (!book.changes) return tags;
    const days = new Set(book.days.map((d) => d.day));
    const ch = book.changes;
    const out = [];
    let since = -Infinity;
    let i = 0;
    for (const tg of tags) {
      if (!days.has(tg.day) || !Number.isFinite(tg.when)) continue;
      while (i < ch.length && ch[i] <= since) i++;
      if (i < ch.length && ch[i] <= tg.when) { out.push(tg); since = tg.when; }
    }
    return out;
  }

  // The days a chapter was written on, as NEO's days show them (app.js,
  // dayFits): with a chapter picked, only the days whose sessions changed
  // it; for the whole book (''), the days with something to see
  // (Rec.dayShows), and the last, which ends as the book is. `stats` holds
  // each day's sessions as Rec.playSession says them, null for a day not
  // worked out yet, which is shown until it is. A chapter written on no day
  // shows every day, as NEO goes back to the whole book.
  function daysFor(stats, ch) {
    const wrote = (i) => !stats[i] || (ch ? stats[i].some((st) => !!(st && st.chapters && st.chapters[ch])) : i === stats.length - 1 || Rec.dayShows(stats[i]));
    const out = [];
    for (let i = 0; i < stats.length; i++) if (wrote(i)) out.push(i);
    return out.length ? out : stats.map((_, i) => i);
  }

  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  const fmtNum = (n) => Number(n).toLocaleString(words.$lang || undefined);
  const fmtTime = (ms) => (ms === null || ms === undefined ? '—' : new Date(ms).toLocaleString(words.$lang || undefined, { dateStyle: 'medium', timeStyle: 'short' }));
  const fmtDay = (day) => new Date(day + 'T12:00:00Z').toLocaleDateString(words.$lang || undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
  const fmtShort = (day) => new Date(day + 'T12:00:00Z').toLocaleDateString(words.$lang || undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });

  function fail(doc, err) {
    const p = doc.getElementById('rx-status') || doc.getElementById('rx-checks');
    if (!p) return;
    p.hidden = false;
    p.textContent = T('This export couldn’t read its history: {why}', { why: String(err && err.message || err) });
  }

  async function start(doc) {
    const data = JSON.parse(doc.getElementById('rx-data').textContent);
    words = { ...(data.strings || {}), $lang: data.lang };
    if (typeof DecompressionStream === 'undefined' || !crypto.subtle) {
      // WebCrypto is only given to a secure page (a file, or https), so a
      // page put on a plain http:// address can't check itself in any browser
      const insecure = !!doc.defaultView && doc.defaultView.isSecureContext === false;
      fail(doc, insecure ? T('it was opened from an address that isn’t secure (http://): open the file itself, or an https:// address') : T('this browser is too old to read it'));
      return;
    }
    const sessions = await loadSessions(data);
    const book = new Book(sessions, !!data.partial);
    doc.body.classList.add('rx-js');
    const ui = player(doc, data, book, sessions);
    await checks(doc, data, sessions, ui);
  }

  // The tags in the sessions (Rec.tagsOf), each with the day it's on
  function tagsIn(sessions) {
    const list = sessions.map((s) => {
      const p = Rec.parseSession(s.text);
      const tags = [];
      if (p.known) {
        const { walls } = Rec.lineWalls(p.header, p.lines);
        p.lines.forEach((line, i) => {
          if (Array.isArray(line) && line[1] === 'tag') tags.push({ id: line[2], label: line[3], at: line[4] || null, made: line[5] || null, note: typeof line[6] === 'string' ? line[6] : null, wall: Number.isFinite(walls[i]) ? walls[i] : null, line: i + 2 });
        });
      }
      return { id: s.id, device: s.device, day: s.day, stats: { tags } };
    });
    return Rec.tagsOf(list);
  }

  // The lines each session's timestamps reach (as NEO's own player has
  // them): { 'device/id': [{ n, by }] }, from the seals checked here, its
  // device's and another's that sealed it (Rec.sealsOver); null when nothing
  // was sealed. In an export of some chapters, the last line of each of its
  // chapters that each seal reaches, by the seals' `chapters`: [{ n, by, ch }].
  function stampsOf(sessions, sealsChecked) {
    const devices = Object.keys(sealsChecked || {});
    if (!devices.length) return null;
    const out = {};
    const kept = keptOf(sessions);
    if (kept) {
      const chains = chapterChains(sessions, false);
      for (const s of sessions) out[s.device + '/' + s.id] = [];
      for (const r of Object.values(sealsChecked)) {
        for (const seal of (r && r.seals) || []) {
          const by = seal.ok ? (seal.by !== null ? seal.by : seal.byLater || null) : null;
          for (const [d, ss] of Object.entries(seal.chapters || {})) {
            for (const [id, chs] of Object.entries(ss || {})) {
              const list = out[d + '/' + id];
              const held = chains[d + '/' + id];
              if (!list || !held) continue;
              for (const [ch, v] of Object.entries(chs || {})) {
                const c = kept.has(ch) && held[ch];
                if (c && Array.isArray(v) && v[0] >= 1 && v[0] <= c.nos.length) list.push({ n: c.nos[v[0] - 1], by, ch });
              }
            }
          }
        }
      }
      for (const list of Object.values(out)) list.sort((a, b) => a.n - b.n);
      return out;
    }
    for (const s of sessions) {
      const seals = Rec.sealsOver(s.device, sealsChecked);
      if (!seals.length && !sealsChecked[s.device]) continue;
      const lineOf = new Map();
      for (const m of s.text.matchAll(/^\[0,"h",(\d+),"([A-Za-z0-9_-]+)"\]$/gm)) lineOf.set(m[2], +m[1]);
      const list = [];
      for (const seal of seals) {
        const h = seal.heads[s.id];
        if (!h || !lineOf.has(h)) continue;
        list.push({ n: lineOf.get(h), by: seal.ok ? (seal.by !== null ? seal.by : seal.byLater || null) : null });
      }
      out[s.device + '/' + s.id] = list.sort((a, b) => a.n - b.n);
    }
    return out;
  }

  /* ---------- the player ---------- */

  // as NEO's own player: ▶▶ is this many times as fast, and a pause longer
  // than SKIP plays SKIP long (▶▶ skips it)
  const FAST = 8;
  const SKIP = 1500;
    // what made a change, as the timeline's markers say it (app.js, HISTORY_CAUSES)
  const CAUSES = {
    split: 'Chapter split', merge: 'Chapters joined', new: 'New chapter', delete: 'Chapter deleted',
    'darling-out': 'Sent to Darlings', 'darling-in': 'Back from Darlings', 'darling-delete': 'Sent to Darlings',
    'replace-all': 'Replace All', 'undo-structural': 'Undone', snapshot: 'Snapshot restored', outline: 'Moved in the Outline',
    'disk-adopt': 'From another device', 'disk-twin': 'From another device, kept beside this one', 'disk-new': 'From another device',
    'catch-up': 'Changed while NEO wasn’t recording', restore: 'Restored', unobserved: 'A change the recorder didn’t see', anchor: 'Kept whole again'
  };
  const SYNC = ['disk-adopt', 'disk-twin', 'disk-new'];
  const COLORS = { paste: '#d9776b', 'paste-in': '#c9a86a', sync: '#7aa7d9', catch: '#9a958c', restore: '#8fc98a', move: '#a9a294', session: '#77736b', tag: '#e3c47e', nokey: '#a98bc9' };
  const STAMP = '#6fb7a8';

  // The row of days, as NEO's (sideScroll in app.js): a mouse drags it as
  // a finger does, the wheel scrolls it sideways, and an edge with more
  // beyond it fades out. A drag that moved doesn't also pick a day.
  function sideScroll(el) {
    const win = el.ownerDocument.defaultView;
    const edges = () => {
      const max = el.scrollWidth - el.clientWidth;
      el.classList.toggle('edge-l', el.scrollLeft > 2);
      el.classList.toggle('edge-r', max - el.scrollLeft > 2);
    };
    el.addEventListener('scroll', edges, { passive: true });
    if (win.ResizeObserver) new win.ResizeObserver(edges).observe(el);
    new win.MutationObserver(edges).observe(el, { childList: true });
    el.addEventListener('wheel', (e) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || el.scrollWidth <= el.clientWidth) return;
      el.scrollLeft += e.deltaY;
      e.preventDefault();
    }, { passive: false });
    let drag = null;
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch' || e.button !== 0) return;
      drag = { x: e.clientX, left: el.scrollLeft, id: e.pointerId, moved: false };
    });
    el.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x;
      if (!drag.moved && Math.abs(dx) < 6) return;
      if (!drag.moved) { drag.moved = true; el.setPointerCapture(e.pointerId); el.classList.add('dragging'); }
      el.scrollLeft = drag.left - dx;
    });
    const end = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (drag.moved) {
        el.classList.remove('dragging');
        const eat = (c) => { c.stopPropagation(); c.preventDefault(); };
        el.addEventListener('click', eat, { capture: true, once: true });
        win.setTimeout(() => el.removeEventListener('click', eat, { capture: true }), 0);
      }
      drag = null;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    edges();
  }

  // The player, laid out as NEO's Writing History: the chapters and the
  // tags down the left, the sheet, the days as tiles or a day's timeline
  // under it, with the controls, the moment shown and when it was
  // timestamped above them, and in the header the evidence and the
  // checks, each in a pop-up.
  // Returns { stamps(map), checked(state) } for the checks to call.
  function player(doc, data, book, sessions) {
    const box = doc.getElementById('rx-player');
    const side = doc.getElementById('rx-side');
    const actions = doc.getElementById('rx-actions');
    box.hidden = false;
    side.hidden = false;
    actions.hidden = false;
    // On a phone the side is a drawer, as History's is there: ☰ at the
    // header's left brings it over the page, and a pick in it, a tap
    // beside it or Esc puts it away.
    const menuBtn = el('button', 'rx-menu', '☰');
    menuBtn.setAttribute('aria-label', T('Chapters'));
    menuBtn.setAttribute('aria-controls', 'rx-side');
    menuBtn.setAttribute('aria-expanded', 'false');
    const scrim = el('div', 'rx-scrim');
    const drawer = (open) => {
      doc.body.classList.toggle('rx-drawer', open);
      menuBtn.setAttribute('aria-expanded', String(open));
      if (open) { const b = side.querySelector('[aria-selected="true"]') || side.querySelector('button'); if (b) b.focus(); }
    };
    menuBtn.addEventListener('click', () => drawer(!doc.body.classList.contains('rx-drawer')));
    scrim.addEventListener('click', () => drawer(false));
    side.addEventListener('click', (e) => { if (e.target.closest('button')) drawer(false); });
    doc.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !doc.body.classList.contains('rx-drawer')) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      drawer(false);
      menuBtn.focus();
    }, true);
    const top = doc.querySelector('.rx-top');
    if (top) top.prepend(menuBtn);
    side.after(scrim);
    const titles = new Map((data.chapters || []).map((c) => [c.id, c.title]));
    const typed = new Map();
    for (const s of (data.evidence && data.evidence.sessions) || []) typed.set(s.device + '/' + s.id, s.typed);
    const names = {};
    for (const s of sessions) names[s.device] = s.name;
    const many = Object.keys(names).length > 1;
    const tags = tagsShown(tagsIn(sessions), book);

    let view = 'days';
    let k = -1;        // the day shown
    let h = null;      // its History
    let steps = [];    // the steps this view plays (indexes into h.steps)
    let vt = new Float64Array(0); // each one's moment on the player's clock
    let pauses = new Float64Array(0); // how long the pause before a step really was, where it was longer than SKIP
    let lead = 0;      // steps that only say what was there before (Rec.leadSteps): played at once
    let total = 0;
    let pos = 0;       // view steps played
    let n = 0;         // steps of h played
    let cur = null;    // the page after n steps (ChapterTexts)
    let clock = 0;
    let speed = 1;
    let playing = false;
    let last = 0;
    let caret = null;  // { ch, at } of the last edit
    let markers = [];
    let stampMap = null; // from the checks: { 'device/id': [{ n, by }] }
    let stampMarks = [];
    const drawn = new Map(); // ch -> the HTML drawn
    const loads = new Map(); // day index -> its History, loading or loaded
    let loading = 0;


    // the controls, the moment and its timestamp, over the timeline; the
    // pop-ups' buttons in the header
    const backBtn = el('button', 'rx-back', '← ' + T('Days'));
    backBtn.title = T('Back to the days') + ' (Esc)';
    const playBtn = el('button', 'rx-play', '▶');
    playBtn.title = T('Play') + ' (Space)';
    const fastBtn = el('button', 'rx-fast', '▶▶');
    fastBtn.title = T('Play fast');
    fastBtn.setAttribute('aria-pressed', 'false');
    const when = el('span', 'rx-when');
    const stamped = el('span', 'rx-stamped');
    stamped.hidden = true;
    stamped.title = T('When the text you see here was first timestamped');
    const evBtn = el('button', 'rx-evbtn', T('How it was written'));
    const ckBtn = el('button', 'rx-ckbtn', T('Checking…'));
    const controls = el('div', 'rx-controls');
    controls.append(backBtn, playBtn, fastBtn, when, stamped);
    actions.append(evBtn, ckBtn);

    // the side: the chapters, then the tags
    const chList = el('div', 'rx-chlist');
    chList.setAttribute('role', 'listbox');
    chList.setAttribute('aria-label', T('Chapters'));
    side.append(chList);
    let mode = '';  // '' the whole book, else a chapter
    const chButton = (id, label) => {
      const b = el('button', 'rx-chbtn', label);
      b.dataset.ch = id;
      b.setAttribute('role', 'option');
      b.addEventListener('click', () => {
        mode = id;
        markMode();
        markChs();
        drawTiles();
        if (!h) return;
        // in the days, a day the chapter wasn't written on gives way to its last
        if (view === 'days' && !shownDays.includes(k)) { showDay(shownDays[shownDays.length - 1]); return; }
        rebuild();
        if (view === 'days') seek(steps.length);
      });
      chList.append(b);
    };
    chButton('', T('The whole book'));
    for (const c of data.chapters || []) chButton(c.id, c.title || T('Untitled chapter'));
    const markMode = () => { for (const b of chList.children) b.setAttribute('aria-selected', String(b.dataset.ch === mode)); };
    markMode();
    const tagName = (tg) => {
      if (tg.label) return tg.label;
      const m = tg.made || {};
      if (m.snapshot) return T('Snapshot');
      if (Array.isArray(m.restore)) return T('Before restoring to {when}', { when: fmtTime(Date.parse(m.restore[3])) });
      if (m.from) return m.from.kind === 'feedback' ? T('Feedback · {app}', { app: String(m.from.app) }) : T('Note · {app}', { app: String(m.from.app) });
      return T('Tagged');
    };
    if (tags.length) {
      side.append(el('h2', 'rx-sidehead', T('Tags')));
      const tl = el('div', 'rx-tags');
      for (const tg of tags) {
        const b = el('button', 'rx-tagbtn');
        const name = el('span', 'rx-tagname', tagName(tg));
        // a tag with a note: a mark, and the note shown when it's picked
        if (tg.note) {
          b.classList.add('rx-hasnote');
          const mark = el('span', 'rx-notemark', '¶');
          mark.title = T('This tag has a note');
          name.append(mark);
        }
        b.append(name, el('span', 'rx-tagwhen', tg.when !== null ? fmtTime(tg.when) : fmtDay(tg.day)));
        b.addEventListener('click', () => { openTag(tg); if (tg.note) showNote(tg); });
        tl.append(b);
      }
      side.append(tl);
    }

    // the main pane: the sheet, then the timeline or the days
    const scroll = el('div', 'rx-scroll');
    const sheet = el('div', 'rx-sheet');
    scroll.append(sheet);
    // a script, set as NEO sets it (replay-page.css)
    if (data.script) {
      sheet.classList.add('rx-script');
      if (data.underline) sheet.classList.add('rx-uline');
      scroll.classList.add('rx-script-scroll');
    }
    const status = el('p', 'rx-status');
    status.id = 'rx-status';
    const bottom = el('div', 'rx-bottom');
    const dayline = el('div', 'rx-dayline');
    const prevBtn = el('button', 'rx-prev');
    prevBtn.title = T('The day before');
    const nextBtn = el('button', 'rx-next');
    nextBtn.title = T('The day after');
    const tl = el('div', 'rx-timeline');
    tl.tabIndex = 0;
    tl.setAttribute('role', 'slider');
    tl.setAttribute('aria-label', T('Timeline'));
    const canvas = el('canvas');
    const headEl = el('div', 'rx-head');
    const tip = el('div', 'rx-tip');
    tip.hidden = true;
    tl.append(canvas, headEl, tip);
    dayline.append(prevBtn, tl, nextBtn);
    const strip = el('div', 'rx-strip');
    strip.setAttribute('role', 'listbox');
    strip.setAttribute('aria-label', T('Days'));
    bottom.append(controls, dayline, strip);
    sideScroll(strip);
    // a long pause, as NEO's own player says it: how long it really was
    const badge = el('div', 'rx-badge');
    badge.hidden = true;
    badge.setAttribute('aria-live', 'polite');
    box.append(scroll, badge, status, bottom);
    let badgeUntil = 0;
    let pauseSaid = -1; // the step whose pause the badge last told
    const pauseWords = (ms) => (ms >= 3600000 ? T('paused {n} h', { n: Math.round(ms / 360000) / 10 })
      : ms >= 60000 ? T('paused {n} min', { n: Math.round(ms / 60000) }) : T('paused {n} s', { n: Math.round(ms / 1000) }));

    // the pop-ups: the evidence, and what the page checks
    const pop = (bodyEl, label) => {
      const d = el('dialog', 'rx-pop');
      d.setAttribute('aria-label', label);
      const bar = el('div', 'rx-popbar');
      const close = el('button', 'rx-close', T('Close'));
      close.addEventListener('click', () => d.close());
      bar.append(close);
      bodyEl.hidden = false;
      bodyEl.classList.add('rx-popbody');
      d.append(bar, bodyEl);
      d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
      doc.body.append(d);
      return d;
    };
    const report = doc.getElementById('rx-report');
    const evPop = pop(report, T('How it was written'));
    evBtn.addEventListener('click', () => { setPlaying(false); evPop.showModal(); report.scrollTop = 0; });
    const ckPop = pop(doc.getElementById('rx-checks'), T('What this export checks'));
    ckBtn.addEventListener('click', () => { setPlaying(false); ckPop.showModal(); });
    // a tag's note, read whole, as plain text (never as HTML)
    const noteBody = el('div', 'rx-notebody');
    const noteTitle = el('h2', 'rx-notetitle');
    const noteHead = el('div', 'rx-notehead');
    const noteText = el('div', 'rx-notetext');
    noteBody.append(noteTitle, noteHead, noteText);
    const notePop = pop(noteBody, T('Note'));
    function showNote(tg) {
      noteTitle.textContent = tagName(tg);
      noteHead.replaceChildren(...noteLines(tg).map((line) => el('p', null, line)));
      noteHead.hidden = !noteHead.childNodes.length;
      noteText.textContent = tg.note;
      notePop.showModal();
      noteBody.scrollTop = 0;
    }
    // what's said above a note another program left: who it's from, as
    // that program says, and what it's about; nothing for the writer's own
    function noteLines(tg) {
      const f = tg.made && tg.made.from;
      if (!f) return [];
      const at = Date.parse(f.at);
      const out = [Number.isFinite(at) ? T('As given by {app}, {when}', { app: String(f.app), when: fmtTime(at) }) : T('As given by {app}', { app: String(f.app) })];
      if (f.model) out.push(T('Model: {model}', { model: String(f.model) }));
      if (f.pasted) out.push(T('Pasted in by the writer'));
      const c = f.chapter && (data.chapters || []).find((x) => x.id === f.chapter);
      if (c) out.push(T('About {chapter}', { chapter: c.title || T('Untitled chapter') }));
      if (f.since) out.push(T('The chapter had changed by the time NEO recorded this.'));
      return out;
    }

    if (!book.days.length) {
      sheet.append(el('p', 'rx-empty', T('Nothing was recorded.')));
      for (const b of [backBtn, playBtn, fastBtn]) b.hidden = true;
      dayline.hidden = true;
      return wireChecks();
    }

    // the days, as tiles
    const tagDays = new Set(tags.map((tg) => tg.day));
    const dayTyped = book.days.map((d) => d.list.reduce((a, s) => a + (typed.get(s.device + '/' + s.id) || 0), 0));
    book.days.forEach((d, i) => {
      const b = el('button', 'rx-tile' + (tagDays.has(d.day) ? ' rx-tagged' : ''));
      b.setAttribute('role', 'option');
      b.dataset.k = String(i);
      b.append(el('canvas'), el('span', 'rx-tiledate', fmtShort(d.day)));
      b.title = fmtDay(d.day) + (typed.size ? ' · ' + (dayTyped[i] === 1 ? T('1 character typed') : T('{n} characters typed', { n: fmtNum(dayTyped[i]) })) : '');
      b.addEventListener('click', () => openPlayer(i));
      b.addEventListener('focus', () => { hoverDay = i; markChs(); if (view === 'days') showDay(i); });
      b.addEventListener('blur', () => { if (hoverDay === i) { hoverDay = -1; markChs(); } });
      b.addEventListener('pointerenter', () => { hoverDay = i; markChs(); });
      b.addEventListener('pointerleave', () => { if (hoverDay === i) { hoverDay = -1; markChs(); } });
      strip.append(b);
    });
    // Each day's map, as NEO's tiles draw it (app.js, historyMap): where
    // the day changed the text as a grid read like a page, green where words
    // came, red where they went, gold where both; in the whole book each
    // chapter a run of cells as long as its share of the book, a line where
    // each begins. The sessions' stats (Rec.playSession, each chapter's
    // changes in bins along it) and the chapters' lengths as each day ended
    // are worked out here, once, a session at a time after the page has
    // opened, and each tile is drawn as its day is done.
    const dayStats = book.days.map(() => null);
    // In the whole book, the chapters a day changed: named on its tile, and
    // marked in the side pane while it's hovered (else the day on the sheet),
    // a mark, not a pick, as NEO's History does
    let hoverDay = -1;
    function dayChs(i) {
      const moved = (c) => c && ((c.ins && c.ins.some(Boolean)) || (c.del && c.del.some(Boolean)) || c.added || c.removed);
      const hit = new Set();
      for (const st of dayStats[i] || []) for (const [ch, c] of Object.entries(st.chapters || {})) if (!Rec.isStream(ch) && moved(c)) hit.add(ch);
      const order = book.orders[i + 1] || book.lastOrder || (data.chapters || []).map((c) => c.id);
      return [...order.filter((ch) => hit.has(ch)), ...[...hit].filter((ch) => !order.includes(ch))];
    }
    function markChs() {
      const i = hoverDay >= 0 ? hoverDay : k;
      const on = new Set(!mode && i >= 0 ? dayChs(i) : []);
      for (const b of chList.children) b.classList.toggle('rx-chday', !!b.dataset.ch && on.has(b.dataset.ch));
    }
    function titleTile(i) {
      const b = strip.children[i];
      const chs = dayChs(i);
      if (!b || !chs.length) return;
      const title = (id) => { const c = (data.chapters || []).find((x) => x.id === id); return c ? c.title || T('Untitled chapter') : null; };
      const names = chs.map(title).filter(Boolean);
      if (!names.length) return;
      const shown = names.slice(0, 4);
      if (names.length > 4) shown.push(T('{n} more', { n: names.length - 4 }));
      b.title += ' · ' + T('Changed: {chapters}', { chapters: shown.join(', ') });
    }
    const dayLens = book.days.map(() => ({}));
    const INK = { added: '#8fc98a', deleted: '#d9776b', edited: '#c9a86a' };
    function drawTile(i) {
      const cv = strip.children[i] && strip.children[i].firstChild;
      if (!cv) return;
      const W = 46;
      const dpr = window.devicePixelRatio || 1;
      cv.width = cv.height = Math.round(W * dpr);
      const g = cv.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, W);
      const list = dayStats[i] || [];
      const lens = dayLens[i];
      const whole = !mode;
      const after = book.orders[i + 1] || book.lastOrder || (data.chapters || []).map((c) => c.id);
      const chs = whole ? after.filter((ch) => !Rec.isStream(ch) && (lens[ch] || !dayStats[i])) : [mode];
      for (const st of list) for (const ch of Object.keys(st.chapters || {})) if (whole && !Rec.isStream(ch) && !chs.includes(ch) && lens[ch]) chs.push(ch);
      const known = chs.map((ch) => lens[ch]).filter((x) => x > 0);
      const usual = known.length ? known.reduce((x, y) => x + y, 0) / known.length : 1;
      const parts = chs.map((ch) => ({ weight: lens[ch] > 0 ? lens[ch] : usual, bins: list.map((st) => st.chapters && st.chapters[ch]).filter((c) => c && c.ins) }));
      if (!parts.length) return;
      const side = Math.max(whole ? 8 : 6, Math.ceil(Math.sqrt(parts.length)));
      const n = side * side;
      const tw = parts.reduce((x, p) => x + p.weight, 0) || parts.length;
      const cells = parts.map((p) => Math.max(1, Math.round((p.weight / tw) * n)));
      let over = cells.reduce((x, y) => x + y, 0) - n;
      while (over > 0) { const q = cells.indexOf(Math.max(...cells)); if (cells[q] <= 1) break; cells[q]--; over--; }
      while (over < 0) { cells[cells.indexOf(Math.max(...cells))]++; over++; }
      const ins = new Float32Array(n);
      const del = new Float32Array(n);
      let at = 0;
      parts.forEach((p, j) => {
        const k = cells[j];
        for (const c of p.bins) {
          const nb = c.ins.length;
          for (let bi = 0; bi < nb; bi++) {
            if (!c.ins[bi] && !c.del[bi]) continue;
            const lo = at + Math.floor((bi * k) / nb);
            const hi = Math.max(lo + 1, at + Math.ceil(((bi + 1) * k) / nb));
            for (let q = lo; q < hi && q < n; q++) { ins[q] += c.ins[bi]; del[q] += c.del[bi]; }
          }
        }
        at += k;
      });
      let max = 1;
      for (let q = 0; q < n; q++) max = Math.max(max, ins[q] + del[q]);
      const cs = W / side;
      const gap = cs >= 4 ? 1 : 0;
      for (let q = 0; q < n; q++) {
        const v = ins[q] + del[q];
        g.globalAlpha = v ? 0.45 + 0.55 * Math.sqrt(v / max) : 1;
        g.fillStyle = !v ? 'rgba(128,128,128,0.16)' : ins[q] && del[q] ? INK.edited : ins[q] ? INK.added : INK.deleted;
        g.fillRect((q % side) * cs, Math.floor(q / side) * cs, Math.max(0.5, cs - gap), cs - gap);
      }
      g.globalAlpha = 1;
    }
    // the days the chapter picked was written on (all of them for the whole
    // book): the others' tiles hidden, and ‹ › and ← → pass over them
    let shownDays = book.days.map((_, i) => i);
    const nearDay = (i, dir) => {
      const j = dir > 0 ? shownDays.find((x) => x > i) : [...shownDays].reverse().find((x) => x < i);
      return j === undefined ? -1 : j;
    };
    function markNav() {
      if (k < 0) return;
      const p = nearDay(k, -1);
      const n = nearDay(k, 1);
      prevBtn.disabled = p < 0;
      nextBtn.disabled = n < 0;
      prevBtn.textContent = p >= 0 ? '‹ ' + fmtShort(book.days[p].day) : '‹';
      nextBtn.textContent = n >= 0 ? fmtShort(book.days[n].day) + ' ›' : '›';
    }
    function placeTiles() {
      shownDays = daysFor(dayStats, mode);
      for (const b of strip.children) b.hidden = !shownDays.includes(+b.dataset.k);
      markNav();
    }
    const drawTiles = () => { placeTiles(); book.days.forEach((_, i) => drawTile(i)); };
    drawTiles();
    (async () => {
      const pg = new Rec.Page();
      for (let i = 0; i < book.days.length; i++) {
        const out = [];
        for (const s of book.days[i].list) {
          try { out.push(Rec.playSession(s.text, null, { page: pg, device: s.device })); } catch { /* a session that won't play: no map */ }
          await tick();
        }
        dayStats[i] = out;
        for (const [ch, c] of Object.entries(pg.doc)) if (c && !Rec.isStream(ch)) dayLens[i][ch] = c.length;
        placeTiles();
        drawTile(i);
        titleTile(i);
        markChs();
      }
    })();

    const loadDay = (i) => {
      if (!loads.has(i)) {
        loads.set(i, book.day(i));
        if (loads.size > 3) for (const x of loads.keys()) { if (x !== i && loads.size > 3) loads.delete(x); }
      }
      return loads.get(i);
    };
    const devName = (s) => (many && h.sessions[s.session] ? names[h.sessions[s.session].device] || '' : '');

    async function useDay(i) {
      i = Math.max(0, Math.min(book.days.length - 1, i));
      const me = ++loading;
      setPlaying(false);
      if (k !== i || !h) status.textContent = T('Loading {day}…', { day: fmtDay(book.days[i].day) });
      const day = await loadDay(i);
      if (me !== loading) return false;
      status.textContent = '';
      if (h !== day) { h = day; k = i; drawn.clear(); }
      for (const b of strip.children) b.setAttribute('aria-selected', String(+b.dataset.k === k));
      markNav();
      markChs();
      rebuild(false);
      return true;
    }

    // the days: the book as day i ended
    async function showDay(i) {
      setView('days');
      if (await useDay(i)) seek(steps.length);
    }

    // the player on day i, from its start (or `to`, a step of h), paused
    async function openPlayer(i, { to = null, play = false } = {}) {
      setView('player');
      if (!(await useDay(i))) return;
      let p = 0;
      if (to !== null) while (p < steps.length && steps[p] < to) p++;
      seek(p);
      if (play) setPlaying(true);
      tl.focus();
    }

    function openTag(tg) {
      const i = book.days.findIndex((d) => d.day === tg.day);
      if (i < 0) return;
      openPlayer(i).then(() => {
        const at = Rec.momentStep(h, tg.at);
        if (at < 0) return;
        let p = 0;
        while (p < steps.length && steps[p] < at) p++;
        seek(p);
      });
    }

    function setView(v) {
      view = v;
      backBtn.hidden = v !== 'player';
      dayline.hidden = v !== 'player';
      strip.hidden = v !== 'days';
      if (v === 'days') setPlaying(false);
      drawWhen();
    }

    // the steps the view plays, and the player's clock over them: the
    // recording's own, with pauses over SKIP played SKIP long (skipped at ▶▶, in frame), and none
    // before a session's first change or after its last
    function rebuild(keep = true) {
      if (!h) return;
      const at = keep ? n : 0;
      steps = [];
      h.steps.forEach((s, i) => { if ((!mode && !Rec.isStream(s.ch)) || s.ch === mode || s.k === 'session' || s.k === 'f') steps.push(i); });
      vt = new Float64Array(steps.length);
      pauses = new Float64Array(steps.length);
      const acts = (s) => s.k === 'e' || s.k === 'x' || s.k === 'd' || s.k === 'o' || s.k === 'c' || (s.k === 's' && s.by !== 'n');
      const first = new Int32Array(steps.length);
      const lastA = new Int32Array(steps.length);
      for (let a = 0; a < steps.length;) {
        let b = a + 1;
        while (b < steps.length && h.steps[steps[b]].k !== 'session') b++;
        let f = -1;
        let l = -1;
        for (let j = a; j < b; j++) if (acts(h.steps[steps[j]])) { if (f < 0) f = j; l = j; }
        first.fill(f < 0 ? b : f, a, b);
        lastA.fill(l, a, b);
        a = b;
      }
      let v = 0;
      for (let j = 0; j < steps.length; j++) {
        const s = h.steps[steps[j]];
        let gap = j ? s.t - h.steps[steps[j - 1]].t : 0;
        if (s.k === 'session' && j) gap = s.session ? Math.max(0, s.t - h.sessions[s.session - 1].t1) : 0;
        else if (j <= first[j] || j > lastA[j]) gap = 0;
        if (gap > SKIP) { pauses[j] = gap; gap = SKIP; }
        v += gap;
        vt[j] = v;
      }
      lead = Rec.playFrom(h, steps, vt, mode || null);
      total = steps.length ? vt[steps.length - 1] : v;
      buildMarkers();
      stampTrack();
      sheet.dataset.list = '';
      if (keep) {
        let p = 0;
        while (p < steps.length && steps[p] < at) p++;
        seek(p);
      }
      drawTimeline();
    }

    function buildMarkers() {
      markers = [];
      let away = null;
      const said = Rec.keylessStretches((n) => T('No key pressed: dictation or handwriting ({n} characters)', { n }));
      const reached = (j) => {
        for (let q = j + 1; q < steps.length; q++) {
          const s = h.steps[steps[q]];
          if (s.k === 'x' || s.k === 'session' || s.session !== h.steps[steps[j]].session) return false;
          if ((s.k === 'b' || s.k === 'e' || s.k === 'd') && (s.page !== false || s.sync !== undefined)) return true;
        }
        return false;
      };
      steps.forEach((i, j) => {
        const s = h.steps[i];
        const x = vt[j];
        said.step(s, x, i, markers);
        if (s.k === 'session') markers.push({ x, kind: 'session', step: i, label: [fmtTime(s.wall), devName(s)].filter(Boolean).join(' · ') });
        else if (s.k === 'c' && s.what === 'paste') {
          markers.push({ x, kind: s.internal ? 'paste-in' : 'paste', label: s.internal ? T('Moved text ({n} characters)', { n: s.len }) : T('Pasted from elsewhere ({n} characters)', { n: s.len }) });
        } else if (s.k === 'x' && CAUSES[s.cause] && !(Rec.QUIET.has(s.cause) && !reached(j))) {
          const kind = SYNC.includes(s.cause) ? 'sync' : s.cause === 'catch-up' || s.cause === 'unobserved' ? 'catch' : s.cause === 'restore' ? 'restore' : 'move';
          markers.push({ x, kind, label: T(CAUSES[s.cause]) });
        } else if (s.k === 'd' && s.cause === 'delete' && s.page !== false) {
          // a chapter deleted changes no text, so no `x` says so: its `d` does (as NEO's History)
          markers.push({ x, kind: 'move', label: T(CAUSES.delete) });
        } else if (s.k === 'b' && s.cause === 'baseline' && s.page !== false) {
          markers.push({ x, kind: 'catch', label: T('Written before NEO started recording') });
        } else if (s.k === 'f' && (s.what === 'blur' || s.what === 'hidden')) {
          if (!away) away = { x, kind: 'away', label: T('Away from NEO') };
        } else if (s.k === 'f' && (s.what === 'focus' || s.what === 'visible') && away) {
          away.to = x;
          markers.push(away);
          away = null;
        }
        if (s.k === 'session' && away) { away.to = x; markers.push(away); away = null; }
      });
      if (away) { away.to = total; markers.push(away); }
      said.end(markers);
      for (const tg of tags) {
        if (tg.day !== book.days[k].day) continue;
        const at = Rec.momentStep(h, tg.at);
        if (at < 0) continue;
        let j = 0;
        while (j < steps.length && steps[j] < at) j++;
        markers.push({ x: j ? vt[j - 1] : 0, kind: 'tag', label: tagName(tg) });
      }
    }

    // where each timestamp falls on the clock: the last step of the view
    // its seal covered
    function stampTrack() {
      stampMarks = [];
      if (!stampMap || !h) return;
      const lists = h.sessions.map((x) => stampMap[x.device + '/' + x.id] || []);
      const next = new Int32Array(lists.length);
      const lastJ = new Int32Array(lists.length).fill(-1);
      const seen = new Set();
      const place = (si) => {
        const e = lists[si][next[si]++];
        const j = lastJ[si];
        if (j < 0 || seen.has(j)) return;
        seen.add(j);
        stampMarks.push({ x: vt[j], by: e.by });
      };
      for (let j = 0; j < steps.length; j++) {
        const st = h.steps[steps[j]];
        const l = lists[st.session];
        if (!l) continue;
        while (next[st.session] < l.length && l[next[st.session]].n < st.line) place(st.session);
        lastJ[st.session] = j;
      }
      lists.forEach((l, si) => { while (next[si] < l.length) place(si); });
    }

    // when the lines up to step s were first timestamped, or null (in an
    // export of some chapters, by a seal over the step's own chapter)
    function stampedBy(s) {
      const x = h.sessions[s.session];
      let by = null;
      for (const e of (x && stampMap[x.device + '/' + x.id]) || []) {
        if (e.ch !== undefined && s.ch !== undefined && e.ch !== s.ch) continue;
        if (e.n >= s.line && e.by !== null && (by === null || e.by < by)) by = e.by;
      }
      return by;
    }

    const nAt = (p) => (p <= 0 ? (steps.length ? steps[0] : 0) : steps[p - 1] + 1);
    // follow: scroll the sheet to the caret, as playing does (a seek from the timeline)
    function seek(p, follow = false) {
      pos = Math.max(Math.min(lead, steps.length), Math.min(p, steps.length));
      pauseSaid = -1;
      n = nAt(pos);
      cur = h.doc(n);
      clock = pos ? vt[pos - 1] : 0;
      caret = null;
      for (let i = n - 1; i >= 0 && i >= n - 3000; i--) {
        const st = h.steps[i];
        if (st.k === 'e' && st.page !== false && !Rec.isStream(st.ch)) { caret = { ch: st.ch, at: st.at + st.ins.length }; break; }
      }
      draw(follow);
    }

    function advance(to) {
      for (; n < to; n++) {
        if (h.bad.has(n)) continue;
        h.apply(cur, n);
        const st = h.steps[n];
        if (st.k === 'e' && st.page !== false && !Rec.isStream(st.ch)) caret = { ch: st.ch, at: st.at + st.ins.length };
      }
    }

    function order() {
      const o = h.order(n) || book.orders[k] || (data.chapters || []).map((c) => c.id);
      const out = o.filter((ch) => cur[ch]);
      for (const ch of Object.keys(cur)) if (!Rec.isStream(ch) && !out.includes(ch)) out.push(ch);
      return out;
    }

    function withCaret(html, at) {
      if (at === null || at > html.length) return html;
      const open = html.lastIndexOf('<', at - 1);
      if (open > html.lastIndexOf('>', at - 1)) return html; // inside a tag
      return html.slice(0, at) + '<span class="rx-caret"></span>' + html.slice(at);
    }

    function draw(follow = playing) {
      if (!h) return;
      const list = mode ? [mode] : order();
      const want = list.join('\n');
      if (sheet.dataset.list !== want) {
        sheet.textContent = '';
        drawn.clear();
        sheet.dataset.list = want;
        // each page a sheet of its own, set as NEO sets it (sheet.js): its
        // kind's classes, and NEO's rules for them, which the page carries
        const meta = { chapterKinds: data.kinds || {}, chapterOrder: list, format: data.script ? 'screenplay' : '' };
        list.forEach((ch, i) => {
          const look = NeoSheet.sheetLook(ch, meta, { script: !!data.script });
          const sec = el('section', ['rx-ch', 'rp-chapter', ...look.sec].join(' '));
          sec.dataset.ch = ch;
          sec.dataset.kind = look.kind;
          sec.append(el('h2', 'rx-chhead chapter-head', titles.get(ch) || T('Chapter {n}', { n: i + 1 })), el('div', ['rx-body', 'rp-body', ...look.body].join(' ')));
          sheet.append(sec);
        });
      }
      for (const sec of sheet.children) {
        const ch = sec.dataset.ch;
        const html = cur[ch] ? cur[ch].toString() : '';
        const shown = withCaret(html, view === 'player' && caret && caret.ch === ch ? caret.at : null);
        if (drawn.get(ch) === shown) continue;
        drawn.set(ch, shown);
        const body = sec.querySelector('.rx-body');
        body.innerHTML = shown || '';
        if (!html) body.append(el('p', 'rx-empty', mode ? T('This chapter isn’t in the book at this moment.') : ''));
        else NeoSheet.markSheet(body, sec.dataset.kind);
      }
      if (follow) {
        const c = sheet.querySelector('.rx-caret');
        if (c) {
          const r = c.getBoundingClientRect();
          const b = scroll.getBoundingClientRect();
          if (r.top < b.top + 40 || r.bottom > b.bottom - 40) scroll.scrollTop += r.top - b.top - b.height * 0.4;
        }
      }
      drawHead();
    }

    function drawHead() {
      const x = total ? clock / total : 1;
      headEl.style.left = (x * 100).toFixed(3) + '%';
      tl.setAttribute('aria-valuenow', String(Math.round(x * 100)));
      drawWhen();
      tl.setAttribute('aria-valuetext', when.textContent);
    }

    function drawWhen() {
      if (!h) return;
      const s = steps.length ? h.steps[steps[Math.max(0, Math.min(pos || 1, steps.length) - 1)]] : null;
      when.textContent = view === 'days' ? fmtDay(book.days[k].day) : s ? fmtTime(s.wall) : '';
      stamped.hidden = view !== 'player' || !s || !stampMap;
      if (stamped.hidden) return;
      const by = stampedBy(s);
      stamped.textContent = by ? T('Timestamped {when}', { when: fmtTime(by) }) : T('Not timestamped');
    }

    // the timeline: how much was written in each sliver of the day, the
    // time away shaded, the markers above, and the timestamps beneath
    function drawTimeline() {
      if (!h || view !== 'player') return;
      const dpr = window.devicePixelRatio || 1;
      const W = Math.max(1, canvas.clientWidth);
      const H = Math.max(1, canvas.clientHeight);
      if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
      const g = canvas.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, W, H);
      if (!total) return;
      const X = (c) => (c / total) * (W - 2) + 1;
      const top = 14;
      const track = stampMap ? 7 : 0;
      const base = H - track - (track ? 2 : 0);
      if (track) {
        g.fillStyle = 'rgba(128,128,128,0.22)';
        g.fillRect(0, H - 4, W, 1);
        g.fillStyle = STAMP;
        for (const m of stampMarks) g.fillRect(Math.round(X(m.x)) - 1, H - track, 2, track);
      }
      for (const m of markers) {
        if (m.kind !== 'away' && m.kind !== 'nokey') continue;
        g.fillStyle = m.kind === 'away' ? 'rgba(128,128,128,0.13)' : 'rgba(169,139,201,0.2)';
        g.fillRect(X(m.x), top, Math.max(2, X(m.to) - X(m.x)), base - top);
      }
      const bins = new Float32Array(Math.ceil(W));
      const nav = new Float32Array(Math.ceil(W));
      steps.forEach((i, j) => {
        const s = h.steps[i];
        const into = s.k === 'e' && s.page !== false ? bins : s.k === 's' && s.by !== 'n' ? nav : null;
        if (into) into[Math.min(into.length - 1, Math.floor(X(vt[j])))]++;
      });
      const bars = (b, color) => {
        let max = 0;
        for (const v of b) if (v > max) max = v;
        g.fillStyle = color;
        for (let x = 0; x < b.length; x++) {
          if (!b[x]) continue;
          const bh = Math.max(1, Math.sqrt(b[x] / max) * (base - top - 2));
          g.fillRect(x, base - bh, 1, bh);
        }
      };
      bars(nav, 'rgba(201,168,106,0.18)');
      bars(bins, 'rgba(201,168,106,0.6)');
      let lastLabel = -1e9;
      g.font = '10px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      for (const m of markers) {
        if (m.kind === 'away') continue;
        const x = Math.round(X(m.x)) + 0.5;
        g.strokeStyle = COLORS[m.kind];
        g.fillStyle = COLORS[m.kind];
        if (m.kind === 'session') {
          g.beginPath(); g.moveTo(x, top); g.lineTo(x, base); g.stroke();
          if (x - lastLabel > 60) {
            g.fillStyle = '#8a857a';
            const s = h.steps[m.step];
            const label = [new Date(s.wall).toLocaleTimeString(words.$lang || undefined, { hour: 'numeric', minute: '2-digit' }), devName(s)].filter(Boolean).join(' · ');
            g.fillText(label, x + 3, 10);
            lastLabel = x + g.measureText(label).width - 57;
          }
        } else if (m.kind === 'tag') {
          g.beginPath(); g.moveTo(x, 1); g.lineTo(x, base); g.stroke();
          g.beginPath(); g.moveTo(x, 1); g.lineTo(x + 7, 4); g.lineTo(x, 7); g.closePath(); g.fill();
        } else {
          g.beginPath(); g.moveTo(x - 3, top - 1); g.lineTo(x + 3, top - 1); g.lineTo(x, top + 4); g.closePath(); g.fill();
        }
      }
    }

    // what's at a point of the timeline, for the tooltip
    function describe(c) {
      const span = total / Math.max(1, tl.clientWidth) * 5;
      const near = markers.filter((m) => (m.to !== undefined ? c >= m.x - span && c <= m.to + span : Math.abs(m.x - c) <= span) && m.kind !== 'session');
      const lines = near.slice(0, 3).map((m) => m.label);
      const st = stampMarks.find((m) => Math.abs(m.x - c) <= span);
      if (st) lines.push(st.by ? T('Timestamped {when}', { when: fmtTime(st.by) }) : T('Not timestamped'));
      const p = posAt(c);
      const s = steps.length ? h.steps[steps[Math.max(0, p - 1)]] : null;
      if (s) lines.push([fmtTime(s.wall), devName(s)].filter(Boolean).join(' · '));
      return lines.join(' · ');
    }

    // the view steps played by clock c
    function posAt(c) {
      let lo = 0;
      let hi = steps.length;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (vt[mid] <= c) lo = mid + 1; else hi = mid; }
      return lo;
    }

    function frame(now) {
      if (!playing) return;
      const dt = Math.min(250, now - last);
      last = now;
      if (pos >= steps.length) {
        if (nearDay(k, 1) >= 0) { openPlayer(nearDay(k, 1), { play: true }); return; }
        setPlaying(false);
        return;
      }
      clock += dt * speed;
      if (pauses[pos] && clock < vt[pos]) {
        // in a long pause: the badge says how long it really was, for as long
        // as it plays (SKIP at most), and ▶▶ skips it
        if (pauseSaid !== pos) {
          pauseSaid = pos;
          badge.textContent = pauseWords(pauses[pos]);
          badge.hidden = false;
          badgeUntil = now + (speed === FAST ? 1200 : (vt[pos] - clock) / speed + 600);
        }
        if (speed === FAST) clock = vt[pos];
      }
      if (badgeUntil && now > badgeUntil) { badge.hidden = true; badgeUntil = 0; }
      const to = posAt(clock);
      if (to > pos) {
        pos = to;
        advance(nAt(pos));
        draw();
      } else drawHead();
      requestAnimationFrame(frame);
    }

    function setPlaying(on) {
      playing = !!on && !!h && view === 'player';
      if (!playing) { badge.hidden = true; badgeUntil = 0; }
      playBtn.textContent = playing ? '❚❚' : '▶';
      playBtn.title = (playing ? T('Pause') : T('Play')) + ' (Space)';
      fastBtn.setAttribute('aria-pressed', String(playing && speed === FAST));
      if (playing) {
        if (pos >= steps.length) seek(0);
        last = performance.now();
        requestAnimationFrame(frame);
      }
    }

    const play = (fast) => {
      if (view !== 'player') { speed = fast ? FAST : 1; openPlayer(Math.max(0, k), { play: true }); return; }
      if (fast) { speed = playing && speed === FAST ? 1 : FAST; setPlaying(true); } else { speed = 1; setPlaying(!playing); }
    };
    playBtn.addEventListener('click', () => play(false));
    fastBtn.addEventListener('click', () => play(true));
    backBtn.addEventListener('click', () => showDay(k));
    prevBtn.addEventListener('click', () => { if (nearDay(k, -1) >= 0) openPlayer(nearDay(k, -1)); });
    nextBtn.addEventListener('click', () => { if (nearDay(k, 1) >= 0) openPlayer(nearDay(k, 1)); });

    // the timeline: a click or a drag goes there, a hover says what's there
    let dragging = false;
    const clockAt = (ev) => {
      const r = canvas.getBoundingClientRect();
      return Math.max(0, Math.min(1, (ev.clientX - r.left) / Math.max(1, r.width))) * total;
    };
    tl.addEventListener('pointerdown', (ev) => {
      if (!h) return;
      setPlaying(false);
      dragging = true;
      tl.setPointerCapture(ev.pointerId);
      seek(posAt(clockAt(ev)), true);
    });
    tl.addEventListener('pointermove', (ev) => {
      if (!h || !total) return;
      if (dragging) { seek(posAt(clockAt(ev)), true); return; }
      const text = describe(clockAt(ev));
      tip.hidden = !text;
      tip.textContent = text;
      const r = tl.getBoundingClientRect();
      tip.style.left = Math.max(0, Math.min(r.width - tip.offsetWidth, ev.clientX - r.left - tip.offsetWidth / 2)) + 'px';
    });
    tl.addEventListener('pointerup', () => { dragging = false; });
    tl.addEventListener('pointerleave', () => { tip.hidden = true; });
    tl.addEventListener('keydown', (e) => {
      if (!h || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
      e.preventDefault();
      setPlaying(false);
      seek(posAt(clock + (e.key === 'ArrowRight' ? 1 : -1) * total / 50), true);
    });

    doc.addEventListener('keydown', (e) => {
      if (doc.querySelector('dialog[open]')) return;
      if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
      if (e.key === ' ' && !(e.target && e.target.tagName === 'BUTTON')) { e.preventDefault(); play(false); }
      else if (e.key === 'Escape' && view === 'player') { e.preventDefault(); showDay(k); }
      else if (view === 'days' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !(e.target && e.target.tagName === 'BUTTON' && !e.target.classList.contains('rx-tile'))) {
        e.preventDefault();
        const i = nearDay(k, e.key === 'ArrowRight' ? 1 : -1);
        if (i >= 0) { showDay(i); strip.children[i].scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
      }
    });
    new ResizeObserver(() => drawTimeline()).observe(tl);

    showDay(book.days.length - 1);
    strip.scrollLeft = strip.scrollWidth;
    return wireChecks();

    function wireChecks() {
      return {
        stamps(map) {
          stampMap = map;
          if (!h) return;
          stampTrack();
          drawTimeline();
          drawWhen();
        },
        // unfixed: it holds together, but nothing fixes it in time
        checked(ok, text, unfixed = false) {
          ckBtn.textContent = text;
          ckBtn.classList.toggle('ok', ok === true);
          ckBtn.classList.toggle('bad', ok === false);
          ckBtn.classList.toggle('unfixed', ok === true && unfixed);
        }
      };
    }
  }

  /* ---------- the checks ---------- */

  // Every check over the sessions: { chains, replays, seals: { device:
  // checkSeals }, evidence: true | false | null }. progress(done, total).
  async function runChecks({ sessions, partial, seals, evidence }, progress = () => {}) {
    const total = sessions.length * 2 + 1;
    let done = 0;
    const step = () => progress(++done, total);
    const spans = {};
    const chains = checkChains(sessions, partial, spans);
    const replays = await checkReplay(sessions, step);
    const out = { chains, replays, seals: {}, evidence: null };
    if (!partial) {
      const byDevice = new Map();
      for (const s of sessions) {
        if (!byDevice.has(s.device)) byDevice.set(s.device, new Map());
        byDevice.get(s.device).set(s.id, heads(s.text));
      }
      for (const [d, files] of Object.entries(seals || {})) {
        if (!files.length) continue;
        out.seals[d] = await checkSeals(files, byDevice.get(d) || new Map(), byDevice);
      }
      // how much of the history the seals fix in time, every device's sessions
      out.cover = Rec.coverSummary(Object.entries(spans).flatMap(([d, list]) => Rec.timeCover(list, Rec.sealsOver(d, out.seals))));
    } else if (seals) {
      // some chapters: the seals over their lines
      const kept = keptOf(sessions) || new Set();
      const byV = new Map();
      const chains = (v) => byV.get(v) || byV.set(v, chapterChains(sessions, true, v)).get(v);
      for (const [d, files] of Object.entries(seals)) {
        if (!files.length) continue;
        out.seals[d] = await checkSeals(files, new Map(), new Map(), { kept, chains });
      }
      // no seal reaches these chapters (all made before seals held
      // chapters): nothing here fixes them in time
      if (!Object.values(out.seals).some((r) => r.seals.some((s) => s.kept))) out.seals = {};
      // the book's other chapters the seals cover, as hashes only
      const others = new Set();
      for (const r of Object.values(out.seals)) {
        for (const s of r.seals) {
          for (const ss of Object.values(s.chapters || {})) for (const chs of Object.values(ss || {})) for (const ch of Object.keys(chs || {})) if (!kept.has(ch)) others.add(ch);
        }
      }
      out.otherChapters = others.size;
    }
    done = sessions.length * 2;
    out.evidence = checkEvidence(sessions, evidence);
    step();
    return out;
  }

  // In a worker: the page sends the sessions, and gets the checks back
  function serve(scope) {
    scope.onmessage = async (e) => {
      try {
        const res = await runChecks(e.data, (done, total) => scope.postMessage({ type: 'progress', done, total }));
        // (Sets don't cross: nothing in the answer holds one)
        scope.postMessage({ type: 'done', res });
      } catch (err) {
        scope.postMessage({ type: 'error', error: String(err && err.message || err) });
      }
    };
  }

  // The checks, in a worker made of this page's own scripts where the
  // browser allows one (they take a while on a year of writing), else here
  function checksAway(doc, input, progress) {
    let worker = null;
    try {
      const src = [...doc.querySelectorAll('script[nonce]')].map((x) => x.textContent).join('\n;\n');
      worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    } catch { /* not allowed here: run them on the page */ }
    if (!worker) return runChecks(input, progress);
    return new Promise((resolve, reject) => {
      worker.onmessage = (e) => {
        if (e.data.type === 'progress') progress(e.data.done, e.data.total);
        else { worker.terminate(); if (e.data.type === 'done') resolve(e.data.res); else reject(new Error(e.data.error)); }
      };
      worker.onerror = (e) => { e.preventDefault(); worker.terminate(); runChecks(input, progress).then(resolve, reject); };
      worker.postMessage(input);
    });
  }

  async function checks(doc, data, sessions, ui) {
    const box = doc.getElementById('rx-checks');
    box.append(el('h2', '', T('What this export checks')));
    const list = el('ul', 'rx-list');
    box.append(list);
    const line = (ok, text) => {
      const li = el('li', ok === true ? 'ok' : ok === false ? 'bad' : 'info', text);
      list.append(li);
      return li;
    };
    const waiting = line(null, T('Checking…'));
    const names = {};
    for (const s of sessions) names[s.device] = s.name;
    const many = Object.keys(names).length > 1;
    const who = (d) => (many ? names[d] + ': ' : '');
    let bad = false;
    const input = { sessions: sessions.map((s) => ({ id: s.id, device: s.device, open: s.open, text: s.text, header: s.header })), partial: !!data.partial, seals: data.seals, evidence: data.evidence };
    const res = await checksAway(doc, input, (done, total) => {
      const pct = T('Checking… {pct}', { pct: Math.floor((100 * done) / total) + '%' });
      waiting.textContent = pct;
      ui.checked(null, pct);
    });
    waiting.remove();
    // first, whether anything fixes the history in time: a history made up
    // afterwards can hold together, and play back, as well as a real one
    if (!data.partial && res.cover && (!res.cover.stamped || res.cover.sessions)) {
      const c = res.cover;
      const lead = line(null, !c.stamped
        ? T('Nothing fixes this history in time: no writing session was timestamped. A history made up afterwards could pass every check below.')
        : T('Fixed in time: {n} of {all} writing sessions were timestamped within a day of ending.', { n: fmtNum(c.within), all: fmtNum(c.sessions) }));
      lead.classList.add('rx-lead');
      if (!c.stamped) lead.classList.add('rx-unfixed');
    }
    for (const [d, c] of Object.entries(res.chains)) {
      if (!data.partial) {
        const ok = !c.broken.length && !c.unchained.length;
        if (!ok) bad = true;
        line(ok, who(d) + (ok
          ? T('{n} sessions, each hash chain whole and each following the one before it.', { n: fmtNum(c.sessions) })
          : T('{n} sessions; {b} with a broken chain, {u} not following the one before (one is missing between).', { n: fmtNum(c.sessions), b: c.broken.length, u: c.unchained.length })));
      }
      const r = res.replays[d];
      if (r.bad || r.problems) bad = true;
      line(!r.bad && !r.problems, who(d) + (r.bad || r.problems
        ? T('Played back: {bad} of {n} chapter writes don’t come out as recorded.', { bad: fmtNum(r.bad + r.problems), n: fmtNum(r.writes) })
        : T('Played back: all {n} chapter writes come out exactly as recorded.', { n: fmtNum(r.writes) })));
    }
    const chapterSealed = data.partial && Object.keys(res.seals).length > 0;
    if (data.partial) {
      line(null, chapterSealed
        ? T('This export holds only some chapters, so the sessions’ hash chains, which cover every chapter, can’t be checked here. The seals are checked against these chapters’ own lines.')
        : T('This export holds only some chapters, so the hash chains and seals, which cover every chapter, can’t be checked here.'));
      if (chapterSealed && res.otherChapters) {
        line(null, res.otherChapters === 1
          ? T('These seals also cover the writing of one other chapter of the book, which this export doesn’t hold.')
          : T('These seals also cover the writing of {n} other chapters of the book, which this export doesn’t hold.', { n: fmtNum(res.otherChapters) }));
      }
      if (chapterSealed) line(null, T('A seal’s fingerprint is the SHA-256 of its file. The whole book’s export, and verify-recording run on the book, show the same seals with the same fingerprints.'));
    }

    // seals
    if (!data.partial || chapterSealed) {
      const devices = Object.keys(res.seals);
      // (none: the first line says nothing fixes the history in time)
      for (const d of devices) {
        const r = res.seals[d];
        const stampedOnes = r.seals.filter((s) => s.by !== null);
        const badOnes = r.seals.filter((s) => !s.ok);
        if (badOnes.length) bad = true;
        const span = { n: fmtNum(r.seals.length), from: fmtTime(r.seals.length ? r.seals[0].at : null), to: fmtTime(r.seals.length ? r.seals[r.seals.length - 1].at : null), s: fmtNum(stampedOnes.length) };
        line(!badOnes.length, who(d) + (stampedOnes.length === r.seals.length
          ? T('{n} seals, signed with one key, from {from} to {to}, each timestamped.', span)
          : T('{n} seals, signed with one key, from {from} to {to}: {s} timestamped, the others fixed in time by a later seal.', span)));
        if (!r.ed25519) line(null, T('This browser can’t check Ed25519 signatures; a recent Chrome, Firefox or Safari can.'));
        for (const s of badOnes.slice(0, 10)) line(false, T('Seal {n}: {why}', { n: s.seq, why: s.problems.join('; ') }));
        box.append(sealTable(r, data.seals[d], many ? names[d] : ''));
      }
      if (devices.length) box.append(howTo(data));
      ui.stamps(stampsOf(sessions, res.seals));
    }

    // the report's figures
    if (res.evidence !== null) {
      if (!res.evidence) bad = true;
      const p = el('p', res.evidence ? 'rx-same ok' : 'rx-same bad', res.evidence
        ? T('The figures below were worked out again from the history in this export, and match.')
        : T('The figures below don’t match the history in this export.'));
      const report = doc.getElementById('rx-report');
      report.insertBefore(p, report.firstChild);
    }
    box.append(el('p', 'rx-small', T('What these checks can show: that the history holds together and plays back exactly, and, where it was timestamped, that it existed by then and wasn’t made up afterwards. What they can’t show: who was at the keyboard, or whose ideas the words were.')));
    const made = doc.getElementById('rx-made');
    if (made) box.append(made);
    const unfixed = data.partial ? !chapterSealed : !(res.cover && res.cover.stamped);
    ui.checked(!bad, bad ? T('Some checks failed') : unfixed ? T('Checked, but not timestamped') : T('Checked'), unfixed);
  }

  function download(name, bytes, type = 'application/octet-stream') {
    const a = el('a', 'rx-file', name);
    a.href = URL.createObjectURL(new Blob([bytes], { type }));
    a.download = name;
    return a;
  }

  function sealTable(r, files, label) {
    const det = el('details', 'rx-seals');
    det.append(el('summary', '', label ? T('Seals of {device}', { device: label }) : T('Every seal')));
    const tbl = el('table');
    const head = el('tr');
    for (const c of [T('Seal'), T('Fingerprint'), T('Made'), T('After (drand)'), T('Timestamped'), T('Files')]) head.append(el('th', '', c));
    tbl.append(head);
    const byName = new Map(files.map((f) => [f.name, f]));
    for (const s of r.seals) {
      const tr = el('tr', s.ok ? '' : 'bad');
      const pad = String(s.seq).padStart(6, '0');
      const fp = el('td', 'rx-fp', (s.fingerprint || '').slice(0, 16).replace(/(.{4})(?!$)/g, '$1 '));
      fp.title = s.fingerprint || '';
      tr.append(el('td', '', pad), fp, el('td', '', fmtTime(s.at)), el('td', '', fmtTime(s.after)));
      const by = s.stamps.filter((x) => x.stamped && x.at !== null).map((x) => (TSA_NAMES[x.tsa] || x.tsa) + ' ' + fmtTime(x.at)).join(', ');
      tr.append(el('td', '', by || (s.byLater ? T('by {when} (a later seal)', { when: fmtTime(s.byLater) }) : T('not stamped'))));
      const td = el('td');
      for (const name of [pad + '.json', ...s.stamps.map((x) => x.file)]) {
        const f = byName.get(name);
        if (f) td.append(download(name, fromB64(f.b64)), ' ');
      }
      tr.append(td);
      tbl.append(tr);
    }
    det.append(tbl);
    return det;
  }

  function howTo(data) {
    const box = el('div', 'rx-howto');
    box.append(el('h3', '', T('Check it without this export')));
    box.append(el('p', '', T('Each seal’s timestamp tokens are signed by the authority that issued them. With OpenSSL, and the authorities’ root certificates below, check any of them:')));
    box.append(el('pre', '', 'openssl ts -verify -data 000001.json -in 000001.digicert.tsr -CAfile proof-roots.pem'));
    if (data.roots) {
      const p = el('p');
      p.append(download('proof-roots.pem', new TextEncoder().encode(data.roots), 'application/x-pem-file'));
      box.append(p);
    }
    box.append(el('p', 'rx-small', T('A timestamp shows the history existed by then, and the drand round that it was sealed after then. Neither shows who wrote it: the history played back and the report speak to that, and they are evidence, not proof.')));
    return box;
  }

  return { start, fail, serve, runChecks, canonical, genTime, gunzip, digest, loadSessions, checkChains, checkReplay, checkSeals, checkEvidence, heads, chapterChains, keptOf, tagsIn, tagsShown, daysFor, stampsOf, Book };
});
