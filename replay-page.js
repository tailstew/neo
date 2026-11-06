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
  function checkChains(sessions, partial) {
    const out = {};
    const last = {};
    for (const s of sessions) {
      const d = out[s.device] || (out[s.device] = { sessions: 0, whole: 0, broken: [], unchained: [] });
      d.sessions++;
      if (partial) continue;
      const v = Rec.verifyChain(s.text);
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

  const DRAND = { genesis: 1692803367, period: 3 };
  const TSA_NAMES = { digicert: 'DigiCert', sectigo: 'Sectigo', globalsign: 'GlobalSign' };

  // One device's seals ([{ name, b64 }]): each signature (Ed25519, with
  // WebCrypto), its place in the chain, the sessions it seals (`sessions`,
  // id -> its h hashes, and `others`, each other device -> its sessions the
  // same way), the stamps it covers, its drand round, and its timestamp
  // tokens: that each stamps this seal's SHA-256, and when. A token's own
  // signature isn't checked here: openssl does that (below).
  async function checkSeals(files, sessions, others = new Map()) {
    const byName = new Map(files.map((f) => [f.name, fromB64(f.b64)]));
    const out = { key: null, seals: [], ed25519: true };
    let prev = null;
    let key = null;
    for (const f of files) {
      const m = /^(\d{6})\.json$/.exec(f.name);
      if (!m) continue;
      const seq = +m[1];
      const bytes = byName.get(f.name);
      const s = { seq, at: null, ok: true, problems: [], stamps: [], after: null, by: null };
      out.seals.push(s);
      const bad = (why) => { s.ok = false; s.problems.push(why); };
      let body;
      try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { bad(T('it can’t be read')); prev = null; continue; }
      s.at = Date.parse(body.at);
      s.heads = body.heads || {};
      s.others = body.others || {};
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
      const sealed = [[sessions, body.heads], ...Object.entries(body.others || {}).map(([d, hs]) => [others.get(d) || new Map(), hs])];
      for (const [mine, hs] of sealed) {
        for (const [id, h] of Object.entries(hs || {})) {
          const held = mine.get(id);
          if (!held) bad(T('a session it seals isn’t in this export'));
          else if (!held.has(h)) bad(T('a session it seals isn’t what it sealed'));
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
  // from the nearest day start kept, and a day start is kept every tenth day
  class Book {
    constructor(sessions) {
      const by = new Map();
      for (const s of sessions) {
        const k = s.day || '';
        if (!by.has(k)) by.set(k, []);
        by.get(k).push(s);
      }
      this.days = [...by.keys()].sort().map((day) => ({ day, list: by.get(day).sort(Rec.sessionOrder) }));
      this.kept = new Map([[0, null]]);
      // the chapter order each day left, from its last `o` line
      let order = null;
      this.orders = this.days.map((d) => {
        const before = order;
        for (const s of d.list) {
          let found = null;
          for (const m of s.text.matchAll(/^\[\d+,"o",(\[[^\]]*\])\]$/gm)) found = m[1];
          if (found) try { order = JSON.parse(found); } catch { /* not one */ }
        }
        return before;
      });
      this.lastOrder = order; // …and the last day's
    }

    static snapshot(pg) {
      const devices = {};
      for (const [d, doc] of Object.entries(pg.docs)) devices[d] = Rec.htmlOf(doc);
      return { page: Rec.htmlOf(pg.doc), devices, links: pg.links() };
    }

    playDay(pg, k) {
      const players = this.days[k].list.map((s) => {
        const p = Rec.parseSession(s.text);
        if (!p.known) return { walls: [], play() {} };
        const lp = Rec.linePlayer(p.lines, null, { page: pg, device: s.device });
        return { walls: Rec.lineWalls(p.header, p.lines).walls, play: lp.play };
      });
      Rec.playInterleaved(players);
    }

    // the page as day k began, a Page to play on
    async start(k) {
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
      fail(doc, T('this browser is too old to read it'));
      return;
    }
    const sessions = await loadSessions(data);
    const book = new Book(sessions);
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
          if (Array.isArray(line) && line[1] === 'tag') tags.push({ id: line[2], label: line[3], at: line[4] || null, made: line[5] || null, wall: Number.isFinite(walls[i]) ? walls[i] : null, line: i + 2 });
        });
      }
      return { id: s.id, device: s.device, day: s.day, stats: { tags } };
    });
    return Rec.tagsOf(list);
  }

  // The lines each session's timestamps reach (as NEO's own player has
  // them): { 'device/id': [{ n, by }] }, from the seals checked here, its
  // device's and another's that sealed it (Rec.sealsOver); null when nothing
  // was sealed
  function stampsOf(sessions, sealsChecked) {
    const devices = Object.keys(sealsChecked || {});
    if (!devices.length) return null;
    const out = {};
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
  const COLORS = { paste: '#d9776b', 'paste-in': '#c9a86a', sync: '#7aa7d9', catch: '#9a958c', restore: '#8fc98a', move: '#a9a294', session: '#77736b', tag: '#e3c47e' };
  const STAMP = '#6fb7a8';

  // The player, laid out as NEO's Writing History: the chapters and the
  // tags down the left, the sheet, the days as tiles or a day's timeline
  // under it, and a footer with the controls, the moment shown, when it
  // was timestamped, and the evidence and the checks, each in a pop-up.
  // Returns { stamps(map), checked(state) } for the checks to call.
  function player(doc, data, book, sessions) {
    const box = doc.getElementById('rx-player');
    const side = doc.getElementById('rx-side');
    const foot = doc.getElementById('rx-foot');
    box.hidden = false;
    side.hidden = false;
    foot.hidden = false;
    const titles = new Map((data.chapters || []).map((c) => [c.id, c.title]));
    const typed = new Map();
    for (const s of (data.evidence && data.evidence.sessions) || []) typed.set(s.device + '/' + s.id, s.typed);
    const names = {};
    for (const s of sessions) names[s.device] = s.name;
    const many = Object.keys(names).length > 1;
    const tags = tagsIn(sessions);

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


    // the footer: the controls, the moment, its timestamp, the pop-ups
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
    foot.append(backBtn, playBtn, fastBtn, when, stamped, el('span', 'rx-gap'), evBtn, ckBtn);

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
      b.addEventListener('click', () => { mode = id; markMode(); drawTiles(); if (!h) return; rebuild(); if (view === 'days') seek(steps.length); });
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
      return T('Tagged');
    };
    if (tags.length) {
      side.append(el('h2', 'rx-sidehead', T('Tags')));
      const tl = el('div', 'rx-tags');
      for (const tg of tags) {
        const b = el('button', 'rx-tagbtn');
        b.append(el('span', 'rx-tagname', tagName(tg)), el('span', 'rx-tagwhen', tg.when !== null ? fmtTime(tg.when) : fmtDay(tg.day)));
        b.addEventListener('click', () => openTag(tg));
        tl.append(b);
      }
      side.append(tl);
    }

    // the main pane: the sheet, then the timeline or the days
    const scroll = el('div', 'rx-scroll');
    const sheet = el('div', 'rx-sheet');
    scroll.append(sheet);
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
    bottom.append(dayline, strip);
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
      b.addEventListener('focus', () => { if (view === 'days') showDay(i); });
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
      const starts = [];
      let at = 0;
      parts.forEach((p, j) => {
        const k = cells[j];
        starts.push(at);
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
      g.globalAlpha = 0.85;
      g.fillStyle = getComputedStyle(cv).color;
      for (const q of starts.slice(1)) if (q < n) g.fillRect((q % side) * cs - (q % side ? 1 : 0), Math.floor(q / side) * cs, 1.5, cs - gap);
      g.globalAlpha = 1;
    }
    const drawTiles = () => book.days.forEach((_, i) => drawTile(i));
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
        drawTile(i);
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
      prevBtn.disabled = k === 0;
      nextBtn.disabled = k === book.days.length - 1;
      prevBtn.textContent = k > 0 ? '‹ ' + fmtShort(book.days[k - 1].day) : '‹';
      nextBtn.textContent = k < book.days.length - 1 ? fmtShort(book.days[k + 1].day) + ' ›' : '›';
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
        if (s.k === 'session') markers.push({ x, kind: 'session', step: i, label: [fmtTime(s.wall), devName(s)].filter(Boolean).join(' · ') });
        else if (s.k === 'c' && s.what === 'paste') {
          markers.push({ x, kind: s.internal ? 'paste-in' : 'paste', label: s.internal ? T('Moved text ({n} characters)', { n: s.len }) : T('Pasted from elsewhere ({n} characters)', { n: s.len }) });
        } else if (s.k === 'x' && CAUSES[s.cause] && !(Rec.QUIET.has(s.cause) && !reached(j))) {
          const kind = SYNC.includes(s.cause) ? 'sync' : s.cause === 'catch-up' || s.cause === 'unobserved' ? 'catch' : s.cause === 'restore' ? 'restore' : 'move';
          markers.push({ x, kind, label: T(CAUSES[s.cause]) });
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

    // when the lines up to step s were first timestamped, or null
    function stampedBy(s) {
      const x = h.sessions[s.session];
      let by = null;
      for (const e of (x && stampMap[x.device + '/' + x.id]) || []) if (e.n >= s.line && e.by !== null && (by === null || e.by < by)) by = e.by;
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
        list.forEach((ch, i) => {
          const sec = el('section', 'rx-ch');
          sec.dataset.ch = ch;
          sec.append(el('h2', 'rx-chhead', titles.get(ch) || T('Chapter {n}', { n: i + 1 })), el('div', 'rx-body'));
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
        if (m.kind !== 'away') continue;
        g.fillStyle = 'rgba(128,128,128,0.13)';
        g.fillRect(X(m.x), top, Math.max(1, X(m.to) - X(m.x)), base - top);
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
      const near = markers.filter((m) => (m.kind === 'away' ? c >= m.x && c <= m.to : Math.abs(m.x - c) <= span) && m.kind !== 'session');
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
        if (k < book.days.length - 1) { openPlayer(k + 1, { play: true }); return; }
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
    prevBtn.addEventListener('click', () => openPlayer(k - 1));
    nextBtn.addEventListener('click', () => openPlayer(k + 1));

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
        const i = k + (e.key === 'ArrowRight' ? 1 : -1);
        if (i >= 0 && i < book.days.length) { showDay(i); strip.children[i].scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
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
        checked(ok, text) {
          ckBtn.textContent = text;
          ckBtn.classList.toggle('ok', ok === true);
          ckBtn.classList.toggle('bad', ok === false);
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
    const chains = checkChains(sessions, partial);
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
    if (data.partial) line(null, T('This export holds only some chapters, so the hash chains and seals, which cover every chapter, can’t be checked here.'));

    // seals
    if (!data.partial) {
      const devices = Object.keys(res.seals);
      if (!devices.length) line(null, T('Timestamping wasn’t turned on, so nothing in this export fixes the history in time. It shows how the book was written, not when.'));
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
    const made = doc.getElementById('rx-made');
    if (made) box.append(made);
    ui.checked(!bad, bad ? T('Some checks failed') : T('Checked'));
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
    for (const c of [T('Seal'), T('Made'), T('After (drand)'), T('Timestamped'), T('Files')]) head.append(el('th', '', c));
    tbl.append(head);
    const byName = new Map(files.map((f) => [f.name, f]));
    for (const s of r.seals) {
      const tr = el('tr', s.ok ? '' : 'bad');
      const pad = String(s.seq).padStart(6, '0');
      tr.append(el('td', '', pad), el('td', '', fmtTime(s.at)), el('td', '', fmtTime(s.after)));
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

  return { start, fail, serve, runChecks, canonical, genTime, gunzip, digest, loadSessions, checkChains, checkReplay, checkSeals, checkEvidence, heads, tagsIn, stampsOf, Book };
});
