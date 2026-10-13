// The exported replay page's own script (Export replay…, replay-export.js):
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
  // id -> its h hashes), the stamps it covers, its drand round, and its
  // timestamp tokens: that each stamps this seal's SHA-256, and when. A
  // token's own signature isn't checked here: openssl does that (below).
  async function checkSeals(files, sessions) {
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
      for (const [id, h] of Object.entries(body.heads || {})) {
        const held = sessions.get(id);
        if (!held) bad(T('a session it seals isn’t on this page'));
        else if (!held.has(h)) bad(T('a session it seals isn’t what it sealed'));
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

  function fail(doc, err) {
    const p = doc.getElementById('rx-checks');
    if (!p) return;
    p.hidden = false;
    p.textContent = T('This page couldn’t read its recording: {why}', { why: String(err && err.message || err) });
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
    player(doc, data, book);
    await checks(doc, data, sessions);
  }

  /* ---------- the player ---------- */

  const SPEEDS = [1, 4, 16, 64, 256];

  function player(doc, data, book) {
    const box = doc.getElementById('rx-player');
    box.hidden = false;
    if (!book.days.length) { box.textContent = T('Nothing was recorded.'); return; }
    const titles = new Map((data.chapters || []).map((c) => [c.id, c.title]));
    const typed = new Map();
    for (const s of (data.evidence && data.evidence.sessions) || []) typed.set(s.device + '/' + s.id, s.typed);

    const bar = el('div', 'rx-bar');
    const chSel = el('select', 'rx-chsel');
    chSel.setAttribute('aria-label', T('Chapter'));
    chSel.append(new Option(T('The whole book'), ''));
    for (const c of data.chapters || []) chSel.append(new Option(c.title || T('Untitled chapter'), c.id));
    const prevBtn = el('button', 'rx-prev', '‹');
    prevBtn.title = T('The day before');
    const daySel = el('select', 'rx-daysel');
    daySel.setAttribute('aria-label', T('Day'));
    book.days.forEach((d, i) => {
      const n = d.list.reduce((a, s) => a + (typed.get(s.device + '/' + s.id) || 0), 0);
      daySel.append(new Option(fmtDay(d.day) + (typed.size ? ' · ' + (n === 1 ? T('1 character typed') : T('{n} characters typed', { n: fmtNum(n) })) : ''), String(i)));
    });
    const nextBtn = el('button', 'rx-next', '›');
    nextBtn.title = T('The day after');
    const playBtn = el('button', 'rx-play', T('Play'));
    const speeds = el('span', 'rx-speeds');
    let speed = 16;
    for (const sp of SPEEDS) {
      const b = el('button', '', sp + '×');
      b.setAttribute('aria-pressed', String(sp === speed));
      b.addEventListener('click', () => { speed = sp; for (const x of speeds.children) x.setAttribute('aria-pressed', String(x === b)); });
      speeds.append(b);
    }
    const skipBox = el('label', 'rx-skip');
    const skip = el('input');
    skip.type = 'checkbox';
    skip.checked = true;
    skipBox.append(skip, ' ' + T('Skip pauses'));
    const when = el('span', 'rx-when');
    bar.append(chSel, prevBtn, daySel, nextBtn, playBtn, speeds, skipBox, when);
    const slider = el('input', 'rx-slider');
    slider.type = 'range';
    slider.min = '0';
    slider.setAttribute('aria-label', T('Timeline'));
    const sheet = el('div', 'rx-sheet');
    const status = el('p', 'rx-status');
    box.append(bar, slider, status, sheet);

    let k = -1;        // the day
    let h = null;      // its History
    let n = 0;         // steps played
    let cur = null;    // the page after n steps (ChapterTexts)
    let clock = 0;
    let playing = false;
    let last = 0;
    let caret = null;  // { ch, at } of the last edit
    const drawn = new Map(); // ch -> the HTML drawn
    let loading = 0;

    async function openDay(i, end = false) {
      i = Math.max(0, Math.min(book.days.length - 1, i));
      const me = ++loading;
      setPlaying(false);
      status.textContent = T('Loading {day}…', { day: fmtDay(book.days[i].day) });
      const day = await book.day(i);
      if (me !== loading) return;
      status.textContent = '';
      k = i;
      h = day;
      daySel.value = String(i);
      slider.max = String(h.steps.length);
      prevBtn.disabled = i === 0;
      nextBtn.disabled = i === book.days.length - 1;
      seek(end ? h.steps.length : 0);
    }

    function seek(to) {
      n = Math.max(0, Math.min(to, h.steps.length));
      cur = h.doc(n);
      clock = n ? h.steps[n - 1].t : 0;
      caret = null;
      draw();
    }

    function advance(to) {
      for (; n < to; n++) {
        if (h.bad.has(n)) continue;
        h.apply(cur, n);
        const st = h.steps[n];
        if (st.k === 'e' && st.page !== false) caret = { ch: st.ch, at: st.at + st.ins.length };
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

    function draw() {
      const one = chSel.value;
      const list = one ? [one] : order();
      const want = list.join('\n');
      if (sheet.dataset.list !== want) {
        sheet.textContent = '';
        drawn.clear();
        sheet.dataset.list = want;
        list.forEach((ch, i) => {
          const sec = el('section', 'rx-ch');
          sec.dataset.ch = ch;
          const head = el('h2', 'rx-chhead', titles.get(ch) || T('Chapter {n}', { n: i + 1 }));
          sec.append(head, el('div', 'rx-body'));
          sheet.append(sec);
        });
      }
      for (const sec of sheet.children) {
        const ch = sec.dataset.ch;
        const html = cur[ch] ? cur[ch].toString() : '';
        const shown = withCaret(html, caret && caret.ch === ch ? caret.at : null);
        if (drawn.get(ch) === shown) continue;
        drawn.set(ch, shown);
        const body = sec.querySelector('.rx-body');
        body.innerHTML = shown || '';
        if (!html) body.append(el('p', 'rx-empty', one ? T('This chapter isn’t on the page at this moment.') : ''));
      }
      slider.value = String(n);
      const st = n ? h.steps[n - 1] : h.steps[0];
      when.textContent = st ? fmtTime(st.wall) : '';
      if (playing) {
        const c = sheet.querySelector('.rx-caret');
        if (c) c.scrollIntoView({ block: 'center' });
      }
    }

    function frame(now) {
      if (!playing) return;
      const dt = Math.min(250, now - last);
      last = now;
      if (n >= h.steps.length) {
        if (k < book.days.length - 1) { openDay(k + 1).then(() => setPlaying(true)); return; }
        setPlaying(false);
        return;
      }
      clock += dt * speed;
      const next = h.steps[n].t;
      if (skip.checked && next - clock > 1500) clock = next - 200;
      let to = n;
      while (to < h.steps.length && h.steps[to].t <= clock) to++;
      if (to > n) { advance(to); draw(); }
      requestAnimationFrame(frame);
    }

    function setPlaying(on) {
      playing = !!on && !!h;
      playBtn.textContent = playing ? T('Pause') : T('Play');
      if (playing) {
        if (n >= h.steps.length) seek(0);
        last = performance.now();
        requestAnimationFrame(frame);
      }
    }

    playBtn.addEventListener('click', () => setPlaying(!playing));
    slider.addEventListener('input', () => { setPlaying(false); seek(+slider.value); });
    daySel.addEventListener('change', () => openDay(+daySel.value));
    prevBtn.addEventListener('click', () => openDay(k - 1, true));
    nextBtn.addEventListener('click', () => openDay(k + 1));
    chSel.addEventListener('change', () => { sheet.dataset.list = ''; if (h) draw(); });
    doc.addEventListener('keydown', (e) => {
      if (e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) && e.target !== slider) return;
      if (e.key === ' ') { e.preventDefault(); setPlaying(!playing); }
    });
    openDay(book.days.length - 1, true);
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
      for (const [d, files] of Object.entries(seals || {})) {
        if (!files.length) continue;
        out.seals[d] = await checkSeals(files, new Map(sessions.filter((s) => s.device === d).map((s) => [s.id, heads(s.text)])));
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

  async function checks(doc, data, sessions) {
    const box = doc.getElementById('rx-checks');
    box.hidden = false;
    box.append(el('h2', '', T('What this page checks')));
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
    const input = { sessions: sessions.map((s) => ({ id: s.id, device: s.device, open: s.open, text: s.text, header: s.header })), partial: !!data.partial, seals: data.seals, evidence: data.evidence };
    const res = await checksAway(doc, input, (done, total) => {
      waiting.textContent = T('Checking… {pct}', { pct: Math.floor((100 * done) / total) + '%' });
    });
    waiting.remove();
    for (const [d, c] of Object.entries(res.chains)) {
      if (!data.partial) {
        const ok = !c.broken.length && !c.unchained.length;
        line(ok, who(d) + (ok
          ? T('{n} sessions, each hash chain whole and each following the one before it.', { n: fmtNum(c.sessions) })
          : T('{n} sessions; {b} with a broken chain, {u} not following the one before (one is missing between).', { n: fmtNum(c.sessions), b: c.broken.length, u: c.unchained.length })));
      }
      const r = res.replays[d];
      line(!r.bad && !r.problems, who(d) + (r.bad || r.problems
        ? T('Replayed: {bad} of {n} chapter writes don’t come out as recorded.', { bad: fmtNum(r.bad + r.problems), n: fmtNum(r.writes) })
        : T('Replayed: all {n} chapter writes come out exactly as recorded.', { n: fmtNum(r.writes) })));
    }
    if (data.partial) line(null, T('This page holds only some chapters, so the hash chains and seals, which cover every chapter, can’t be checked here.'));

    // seals
    if (!data.partial) {
      const devices = Object.keys(res.seals);
      if (!devices.length) line(null, T('Proof of when it was written wasn’t turned on, so nothing on this page fixes the recording in time. It shows how the book was written, not when.'));
      for (const d of devices) {
        const r = res.seals[d];
        const stamped = r.seals.filter((s) => s.by !== null);
        const badOnes = r.seals.filter((s) => !s.ok);
        const span = { n: fmtNum(r.seals.length), from: fmtTime(r.seals.length ? r.seals[0].at : null), to: fmtTime(r.seals.length ? r.seals[r.seals.length - 1].at : null), s: fmtNum(stamped.length) };
        line(!badOnes.length, who(d) + (stamped.length === r.seals.length
          ? T('{n} seals, signed with one key, from {from} to {to}, each timestamped.', span)
          : T('{n} seals, signed with one key, from {from} to {to}: {s} timestamped, the others fixed in time by a later seal.', span)));
        if (!r.ed25519) line(null, T('This browser can’t check Ed25519 signatures; a recent Chrome, Firefox or Safari can.'));
        for (const s of badOnes.slice(0, 10)) line(false, T('Seal {n}: {why}', { n: s.seq, why: s.problems.join('; ') }));
        box.append(sealTable(r, data.seals[d], many ? names[d] : ''));
      }
      if (devices.length) box.append(howTo(data));
    }

    // the report's figures
    if (res.evidence !== null) {
      const p = el('p', res.evidence ? 'rx-same ok' : 'rx-same bad', res.evidence
        ? T('The figures below were worked out again from the recording on this page, and match.')
        : T('The figures below don’t match the recording on this page.'));
      const report = doc.getElementById('rx-report');
      report.insertBefore(p, report.firstChild);
    }
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
    box.append(el('h3', '', T('Check it without this page')));
    box.append(el('p', '', T('Each seal’s timestamp tokens are signed by the authority that issued them. With OpenSSL, and the authorities’ root certificates below, check any of them:')));
    box.append(el('pre', '', 'openssl ts -verify -data 000001.json -in 000001.digicert.tsr -CAfile proof-roots.pem'));
    if (data.roots) {
      const p = el('p');
      p.append(download('proof-roots.pem', new TextEncoder().encode(data.roots), 'application/x-pem-file'));
      box.append(p);
    }
    box.append(el('p', 'rx-small', T('A timestamp shows the recording existed by then, and the drand round that it was sealed after then. Neither shows who wrote it: the replay and the report speak to that, and they are evidence, not proof.')));
    return box;
  }

  return { start, fail, serve, runChecks, canonical, genTime, gunzip, digest, loadSessions, checkChains, checkReplay, checkSeals, checkEvidence, heads, Book };
});
