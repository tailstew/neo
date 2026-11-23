'use strict';

// Writing History over a year (docs/neo-recording-plan.md, phase 4a).
// Generates a year of writing on a novel and on a screenplay, line for line
// as the recorder writes it, then times today's player against the plan's
// budgets and measures what the recording and the backups cost on disk.
// Run with:
//   node scripts/benchmark-history.js              both books, 250 writing days
//   node scripts/benchmark-history.js script 20    one book, 20 writing days
//   … --keep                                       keep the generated files
//   … --from=2025-11-10                            the year's first day (2027-01-04 unless given):
//                                                  a past year, to open the kept books in NEO
//   … --pace=0.25                                  a writer typing a quarter as much a day
//   … --one-splice                                 a change made all at once recorded as
//                                                  phase 1's recorder did: one splice from
//                                                  the first change to the last
//   … --pocket                                     played as NEO Pocket plays it: every
//                                                  file through a promise, as the page
//                                                  answers its worker, and recording.js's
//                                                  own SHA-256 (a phone is slower still)
//   node scripts/benchmark-history.js --book=<book folder>
//                                                  a real book's figures beside a generated
//                                                  month's: bytes a key, chapters a day,
//                                                  paragraph, splice and catch-up sizes
// Each book is generated in one fresh process and played in another, so
// memory is measured on its own. Files go to the system temp folder.
//
// The writing has what makes real recordings awkward: italics and bold,
// scene breaks, smart quotes, dashes and Romanian letters typed with AltGr,
// undo (typed and structural), Replace All renaming a character through the
// book, drafts of several KB pasted in, deletes across paragraphs, Outline
// moves, and a second computer writing on some days, whose changes the
// first sees as catch-ups. Only the first computer is timed; both replays
// are checked.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const R = require('../recording.js');

// The writer's two computers: the second writes on about one day in seven
const DEVICES = ['d-0123456789abcdef', 'd-fedcba9876543210'];
const SECOND_DAYS = 0.15;
const BOOK = 'book-benchmark-year';

// keysPerDay: an average writing day's keys, with revisions. size: the
// book's HTML once written, reached at fullBy of the year and then held
// there by revision. A novel of 100,000 words in 30 chapters; a 120-page
// script, which is one chapter.
const BOOKS = {
  novel: { keysPerDay: 18000, size: 640000, fullBy: 1, chapterSize: 21000 },
  script: { keysPerDay: 12000, size: 300000, fullBy: 0.6, chapterSize: Infinity }
};


// The plan's budgets (Days, seeking and search), novel and script
const BUDGETS = {
  open: [300, 300], day: [500, 800], seek: [50, 100], jump: [300, 500],
  searchStates: [1000, 2000], firstBuild: [30000, 120000], memory: [150, 250], cache: [10, 25]
};

const nodeDigest = (s) => crypto.createHash('sha256').update(s, 'utf8').digest().subarray(0, 16).toString('base64url');

function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- text ---------- */

// Made-up words drawn with a long tail, so the text compresses about as
// well as prose does: a few words very often, most of them rarely. One word
// in a dozen has a Romanian letter; a sentence may hold a name or a dash.
function language(rand) {
  const on = ['b', 'c', 'd', 'f', 'g', 'h', 'l', 'm', 'n', 'p', 'r', 's', 't', 'v', 'w', 'st', 'th', 'br', 'tr', 'sh', 'ch', ''];
  const nu = ['a', 'e', 'i', 'o', 'u', 'ea', 'ou', 'ai', 'ee', 'o'];
  const co = ['', '', 'n', 'r', 's', 't', 'd', 'll', 'ng', 'ck', 'rd', 'nt'];
  const words = [];
  const seen = new Set();
  while (words.length < 6000) {
    let w = '';
    const syl = 1 + Math.floor(rand() * rand() * 4);
    for (let i = 0; i < syl; i++) w += on[Math.floor(rand() * on.length)] + nu[Math.floor(rand() * nu.length)] + co[Math.floor(rand() * co.length)];
    if (rand() < 0.08) w = w.replace(/[aist]/, (c) => (c === 'a' ? (rand() < 0.6 ? 'ă' : 'â') : { i: 'î', s: 'ș', t: 'ț' }[c]));
    if (w.length > 1 && !seen.has(w)) { seen.add(w); words.push(w); }
  }
  const pick = () => words[Math.floor(words.length * Math.pow(rand(), 3))];
  const cap = (w) => w[0].toUpperCase() + w.slice(1);
  const newName = () => cap(words[100 + Math.floor(rand() * (words.length - 100))]);
  // the cast, the first few far more often than the rest
  const names = Array.from({ length: 14 }, newName);
  const name = () => names[Math.floor(names.length * Math.pow(rand(), 2))];
  const sentence = () => {
    const n = 5 + Math.floor(rand() * 18);
    let out = '';
    for (let i = 0; i < n; i++) {
      let w = rand() < 0.03 ? name() : pick();
      if (rand() < 0.04) w += '’s';
      if (i > 2 && i < n - 2 && rand() < 0.08) w += ',';
      out += (i === 0 ? '' : i > 1 && i < n - 1 && !out.endsWith(',') && rand() < 0.012 ? '—' : ' ') + w;
    }
    const end = rand();
    return cap(out) + (end < 0.85 ? '.' : end < 0.95 ? '?' : '!');
  };
  // a novel's paragraph: narration, or a line of dialogue and what follows it
  const paragraph = () => {
    const more = Array.from({ length: 1 + Math.floor(rand() * 4) }, sentence).join(' ');
    if (rand() < 0.25) return `“${sentence().slice(0, -1)},” ${name()} ${pick()}. ${more}`;
    return sentence() + ' ' + more;
  };
  const places = Array.from({ length: 30 }, () => pick().toUpperCase() + (rand() < 0.5 ? ' ' + pick().toUpperCase() : ''));
  return { pick, sentence, paragraph, names, name, newName, places };
}

const KEYS = { ' ': ['Space', 0], '.': ['Period', 0], ',': ['Comma', 0], '?': ['Slash', 1], '!': ['Digit1', 1],
  '’': ['Quote', 0], '“': ['Quote', 1], '”': ['Quote', 1], '-': ['Minus', 0], '(': ['Digit9', 1], ')': ['Digit0', 1], ':': ['Semicolon', 1] };
// Romanian letters on the Programmers layout: AltGr (Ctrl+Alt) and the letter
const ALTGR = { 'ă': 'KeyA', 'â': 'KeyQ', 'î': 'KeyI', 'ș': 'KeyS', 'ț': 'KeyT' };
function keyOf(c) {
  if (KEYS[c]) return KEYS[c];
  if (ALTGR[c]) return [ALTGR[c], R.MOD.ctrl | R.MOD.alt];
  if (ALTGR[c.toLowerCase()]) return [ALTGR[c.toLowerCase()], R.MOD.ctrl | R.MOD.alt | R.MOD.shift];
  if (c >= 'a' && c <= 'z') return ['Key' + c.toUpperCase(), 0];
  if (c >= 'A' && c <= 'Z') return ['Key' + c, R.MOD.shift];
  if (c >= '0' && c <= '9') return ['Digit' + c, 0];
  return ['Unidentified', 0];
}

/* ---------- the book ---------- */

const open = (p) => (p.c ? `<p class="${p.c}">` : '<p>');
const paraLen = (p) => open(p).length + p.t.length + 4;
const chapterHTML = (ch) => ch.paras.map((p) => open(p) + p.t + '</p>').join('');
// A paragraph's HTML holds <i> and <b>. Where it can be cut: not inside a
// tag, and the part cut holds whole pairs. An `s` line counts text, not tags.
const inTag = (t, off) => off > 0 && t.lastIndexOf('<', off - 1) > t.lastIndexOf('>', off - 1);
function clean(t, a, b) {
  if (inTag(t, a) || inTag(t, b)) return false;
  const open = [];
  for (const m of t.slice(a, b).matchAll(/<(\/?)(\w+)>/g)) {
    if (!m[1]) open.push(m[2]);
    else if (open.pop() !== m[2]) return false;
  }
  return !open.length;
}
const textOff = (t, off) => t.slice(0, off).replace(/<[^>]*>/g, '').length;
const isBreak = (p) => p.c === 'scene-break';

// What follows a script's line when Enter ends it
function nextClass(c, rand) {
  const r = rand();
  if (c === 'sp-heading') return '';
  if (c === '') return r < 0.5 ? 'sp-character' : '';
  if (c === 'sp-character') return r < 0.12 ? 'sp-paren' : 'sp-dialogue';
  if (c === 'sp-paren') return 'sp-dialogue';
  if (c === 'sp-dialogue') return r < 0.68 ? 'sp-character' : r < 0.95 ? '' : 'sp-transition';
  return 'sp-heading';
}


let oneSplice = false; // --one-splice: as phase 1's recorder wrote them
const splicesFor = (a, b) => {
  if (oneSplice) { const sp = R.splice(a, b); return sp ? [sp] : []; }
  return R.splices(a, b);
};

/* ---------- generating a year ---------- */

const pad = (n, w = 2) => String(n).padStart(w, '0');
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

function generate(kind, days, dir, pace = 1, one = false) {
  oneSplice = one;
  const spec = BOOKS[kind];
  const script = kind === 'script';
  const rand = rng(kind === 'novel' ? 1 : 2);
  const lang = language(rand);
  const between = (a, b) => a + Math.floor(rand() * (b - a));
  const book = { chapters: new Map(), order: [], size: 0 };
  // each computer: its hash chain, each chapter as its recording last left
  // it, and each chapter's edits since its last full `b` (its anchors)
  const devs = DEVICES.map((id) => ({ id, prev: null, known: new Map(), edited: new Map(), sessions: 0 }));
  let dev = devs[0];
  let nextId = 0;
  const newId = () => `ch-bench${pad(nextId++, 4)}`;
  for (const d of devs) fs.mkdirSync(path.join(dir, 'recording', d.id), { recursive: true });

  // the writing days: `days` of the calendar days in a year's span
  const span = Math.max(days, Math.ceil(days * 365 / 250));
  const pickDays = Array.from({ length: span }, (_, i) => i).sort(() => rand() - 0.5).slice(0, days).sort((a, b) => a - b);
  const start = Date.parse((process.env.NEO_BENCH_FROM || '2027-01-04') + 'T00:00:00.000Z');
  // The anchors the recorder writes (Rec.baseLines): how many, what they
  // cost gzipped on their own (so a little high), and the most edits a
  // chapter needed replayed from its last full `b` when a session began
  const anchors = { n: 0, bytes: 0, most: 0 };
  const fullB = (id) => { dev.edited.set(id, 0); };
  const out = { kind, days, span, sessions: 0, keys: 0, lines: 0, perDay: [], replaceDays: [] };
  // how often each awkward edit came, and for the edits NEO records as one
  // splice from the first change to the last, the characters that splice
  // carried against what the changes themselves were
  out.counts = { italics: 0, breaks: 0, undos: 0, structuralUndos: 0, replaceAlls: 0, bigPastes: 0, crossDeletes: 0, moves: 0, catchUps: 0, dashes: 0 };
  out.spans = { replace: { ins: 0, changed: 0 }, move: { ins: 0, changed: 0 }, catchUp: { ins: 0 } };

  for (const [di, calDay] of pickDays.entries()) {
    const dayMs = start + calDay * 86400000;
    const target = spec.size * Math.min(1, (di + 1) / (days * spec.fullBy));
    const nSessions = rand() < 0.5 ? 1 : rand() < 0.7 ? 2 : 3;
    const hours = [9, 14, 20].sort(() => rand() - 0.5).slice(0, nSessions).sort((a, b) => a - b);
    const dayKeys = pace * spec.keysPerDay * (0.4 + 1.2 * rand());
    dev = di > 0 && rand() < SECOND_DAYS ? devs[1] : devs[0];
    let replaced = false;
    let raw = 0;
    let gz = 0;
    for (const hour of hours) {
      const when = dayMs + hour * 3600000 + between(0, 50) * 60000 + between(0, 60000);
      const s = session(when, dayKeys / nSessions, target);
      replaced = replaced || s.replaced;
      raw += Buffer.byteLength(s.text);
      const z = zlib.gzipSync(Buffer.from(s.text, 'utf8'));
      gz += z.length;
      fs.writeFileSync(path.join(dir, 'recording', dev.id, s.id + '.jsonl.gz'), z);
      out.sessions++;
      dev.sessions++;
    }
    out.perDay.push({ raw, gz });
    if (replaced) out.replaceDays.push(isoDay(dayMs));
    if (process.stderr.isTTY && di % 10 === 9) process.stderr.write(`\r  ${kind}: day ${di + 1} of ${days}, ${(book.size / 1000).toFixed(0)} KB `);
  }
  if (process.stderr.isTTY) process.stderr.write('\r' + ' '.repeat(60) + '\r');

  fs.mkdirSync(path.join(dir, 'chapters'));
  for (const [id, ch] of book.chapters) fs.writeFileSync(path.join(dir, 'chapters', id + '.html'), chapterHTML(ch));
  fs.writeFileSync(path.join(dir, 'book.json'), JSON.stringify({ id: BOOK, title: 'A Year', chapterOrder: book.order, format: script ? 'screenplay' : undefined }, null, 2));
  out.chapters = book.order.length;
  out.bookBytes = book.size;
  out.anchors = anchors;
  out.devices = devs.map((d) => d.sessions);
  out.oneSplice = oneSplice;
  // what each computer's replay has to end on
  fs.writeFileSync(path.join(dir, 'ends.json'), JSON.stringify(Object.fromEntries(devs.map((d) => [d.id, Object.fromEntries(d.known)]))));
  return out;

  // One sitting: about `keys` keys, starting at wall time startMs
  function session(startMs, keys, target) {
    const d = new Date(startMs);
    const id = `${isoDay(startMs)}T${pad(d.getUTCHours())}-${pad(d.getUTCMinutes())}-${pad(d.getUTCSeconds())}Z-${Math.floor(rand() * 36 ** 4).toString(36).padStart(4, '0')}`;
    const w = new R.SessionWriter({ neoRec: R.FORMAT, session: id, device: dev.id, app: '1.3.0', platform: 'Win32', book: BOOK, day: isoDay(startMs), startedAt: d.toISOString(), tz: 'Europe/London', prev: dev.prev });
    const parts = [];
    const touched = new Set();
    const dirty = new Set();
    let ordered = false;
    let cur = null;
    let caret = null;   // { ch, p, off }
    let base = null;    // where caret.p's text starts in the chapter's HTML
    let clock = 0;
    let lastFlush = 0;
    let lastKey = 0;
    let typed = 0;
    let nextAway = between(10, 40) * 60000;
    let replaced = false;

    const push = (line) => { w.push(line); out.lines++; };
    const flush = () => {
      for (const ch of dirty) {
        const c = book.chapters.get(ch);
        if (c) push([0, 'w', nodeDigest(chapterHTML(c)), ...(ch === cur ? [] : [ch])]);
      }
      dirty.clear();
      const part = w.chunk();
      if (part) parts.push(part.text);
      lastFlush = clock;
    };
    // the time before a line: a minute without keys is an `idle` line, and
    // the 20 s flush comes when it's due
    const wait = (dt) => {
      if (clock + dt - lastFlush >= 20000) flush();
      if (clock + dt - lastKey > 60000 && clock - lastKey < 60000) {
        const idle = lastKey + 60000 - clock;
        push([idle, 'f', 'idle']);
        clock += idle;
        dt -= idle;
      }
      clock += dt;
      return dt;
    };
    // vol: the characters inserted and deleted; an edit that only inserts
    // or only deletes is |delta|
    const changed = (id, delta, vol = Math.abs(delta)) => {
      book.size += delta;
      dirty.add(id);
      dev.edited.set(id, (dev.edited.get(id) || 0) + vol);
    };

    const order = () => { push([0, 'o', [...book.order]]); };
    // the `e` lines for a change made all at once, and the characters they
    // insert and delete
    function edits(a, b) {
      let vol = 0;
      for (const sp of splicesFor(a, b)) {
        push([0, 'e', sp.at, sp.del, sp.ins]);
        vol += sp.del + sp.ins.length;
      }
      return vol;
    }
    function touch(id) {
      if (!touched.has(id)) {
        touched.add(id);
        const html = chapterHTML(book.chapters.get(id));
        const was = dev.known.get(id);
        const edited = dev.edited.get(id) || 0;
        // its `b` as the recorder writes it (Rec.baseLines); the catch-up's
        // splices as --one-splice says
        const [b] = R.baseLines(id, html, was, edited);
        push([0, ...b]);
        if (was !== undefined) anchors.most = Math.max(anchors.most, edited);
        if (b[2] !== null) {
          fullB(id);
          if (b[4] === 'anchor') { anchors.n++; anchors.bytes += zlib.gzipSync(Buffer.from(JSON.stringify(b[2]))).length; }
        }
        if (was !== undefined && was !== html) { // the other computer changed it since
          push([0, 'x', 'catch-up']);
          const vol = edits(was, html);
          dev.edited.set(id, (dev.edited.get(id) || 0) + vol);
          out.spans.catchUp.ins += vol;
          out.counts.catchUps++;
        }
        if (!ordered) { order(); ordered = true; }
      } else if (cur !== id) push([0, 'ch', id]);
      cur = id;
    }
    const chapter = () => book.chapters.get(caret.ch);
    const para = () => chapter().paras[caret.p];
    const at = () => {
      if (base === null) {
        const ps = chapter().paras;
        base = 0;
        for (let i = 0; i < caret.p; i++) base += paraLen(ps[i]);
        base += open(ps[caret.p]).length;
      }
      return base + caret.off;
    };
    // where paragraph p's text starts in its chapter's HTML
    const startOf = (ps, p) => {
      let n = 0;
      for (let i = 0; i < p; i++) n += paraLen(ps[i]);
      return n + open(ps[p]).length;
    };
    // the caret put somewhere by a click
    function jump(id, p, off) {
      touch(id);
      caret = { ch: id, p, off };
      base = null;
      push([wait(between(400, 4000)), 's', p, textOff(chapter().paras[p].t, off), 'p']);
    }
    // the gap before a key: log-normal, as in a real session (median about 190 ms, 95% under 520)
    const gap = () => Math.max(30, Math.round(190 * Math.exp(0.6 * Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand()))));

    function key(dt, code, mods, e) {
      const d = wait(dt);
      lastKey = clock;
      push([d, 'k', code, mods]);
      if (e) push(e);
      typed++;
    }
    function type(text) {
      for (const c of text) {
        if (c !== ' ' && rand() < 0.012) { // a slip, and its Backspaces
          const n = 1 + Math.floor(rand() * 2);
          for (let i = 0; i < n; i++) typeChar(lang.pick()[0] || 'e', gap());
          for (let i = 0; i < n; i++) backspace(between(150, 400), false);
        }
        if (c === '—') { // two hyphens, the second made a dash
          typeChar('-', gap());
          key(gap(), 'Minus', 0, [0, 'e', at() - 1, 1, '—', 'iT']);
          para().t = para().t.slice(0, caret.off - 1) + '—' + para().t.slice(caret.off);
          changed(caret.ch, 0, 2);
          out.counts.dashes++;
          continue;
        }
        typeChar(c, c === ' ' ? gap() + 40 : gap());
      }
    }
    function typeChar(c, dt) {
      const [code, mods] = keyOf(c);
      key(dt, code, mods, [0, 'e', at(), 0, c, 'iT']);
      const p = para();
      p.t = p.t.slice(0, caret.off) + c + p.t.slice(caret.off);
      caret.off += c.length;
      changed(caret.ch, c.length);
    }
    function backspace(dt, repeat) {
      if (caret.off === 0 || para().t[caret.off - 1] === '>') return; // (not into a tag)
      key(dt, 'Backspace', repeat ? R.MOD.repeat : 0, [0, 'e', at() - 1, 1, '', 'dB']);
      const p = para();
      p.t = p.t.slice(0, caret.off - 1) + p.t.slice(caret.off);
      caret.off--;
      changed(caret.ch, -1);
    }
    function enter() {
      const p = para();
      const np = { c: script ? nextClass(p.c, rand) : '', t: p.t.slice(caret.off) };
      key(between(150, 900), 'Enter', 0, [0, 'e', at(), 0, '</p>' + open(np), 'iP']);
      p.t = p.t.slice(0, caret.off);
      chapter().paras.splice(caret.p + 1, 0, np);
      changed(caret.ch, 4 + open(np).length);
      base = at() + 4 + open(np).length;
      caret.p++;
      caret.off = 0;
    }
    // Enter again on the empty line: NEO puts a *** line above it
    function sceneBreak() {
      const ps = chapter().paras;
      const brk = { c: 'scene-break', t: '***' };
      const html = open(brk) + brk.t + '</p>';
      key(between(150, 900), 'Enter', 0, null);
      push([0, 'x', 'break']);
      push([0, 'e', startOf(ps, caret.p) - open(ps[caret.p]).length, 0, html]);
      ps.splice(caret.p, 0, brk);
      caret.p++;
      base = null;
      push([0, 's', caret.p, 0]);
      changed(caret.ch, html.length);
      out.counts.breaks++;
    }
    // what a script's line holds
    function line(c) {
      if (c === 'sp-heading') return `${rand() < 0.6 ? 'INT.' : 'EXT.'} ${lang.places[Math.floor(rand() * lang.places.length)]} - ${rand() < 0.6 ? 'DAY' : 'NIGHT'}`;
      if (c === 'sp-character') return lang.names[Math.floor(rand() * lang.names.length)];
      if (c === 'sp-paren') return `(${lang.pick()} ${lang.pick()})`;
      if (c === 'sp-transition') return 'CUT TO:';
      if (c === 'sp-dialogue') return Array.from({ length: 1 + Math.floor(rand() * 3) }, lang.sentence).join(' ');
      return Array.from({ length: 1 + Math.floor(rand() * 3) }, lang.sentence).join(' ');
    }

    // Writing on in new paragraphs: at the end of the book while it has
    // chapters to come, then (and in a script, half the time once it's half
    // written) after a paragraph somewhere in it
    function draft() {
      let id = book.order[book.order.length - 1];
      let p;
      const full = !id || (!script && book.chapters.get(id).paras.reduce((n, x) => n + paraLen(x), 0) > spec.chapterSize);
      if (full && book.order.length < Math.ceil(spec.size / spec.chapterSize)) id = newChapter();
      else if (full || (script && book.size > spec.size / 2 && rand() < 0.5)) {
        id = somewhere();
        p = Math.floor(rand() * book.chapters.get(id).paras.length);
      }
      const ps = book.chapters.get(id).paras;
      if (p === undefined) p = ps.length - 1;
      if (isBreak(ps[p])) { if (p === 0) return; p--; }
      if (!caret || caret.ch !== id || caret.p !== p || caret.off !== ps[p].t.length) jump(id, p, ps[p].t.length);
      for (let n = 1 + Math.floor(rand() * 3); n > 0; n--) {
        if (para().t.length) {
          enter();
          if (!script && rand() < 0.012) sceneBreak();
        }
        if (script) type(line(para().c));
        else type(lang.paragraph());
      }
    }
    // a chapter to go back to: the later ones more often
    const somewhere = () => book.order[Math.min(book.order.length - 1, Math.floor(book.order.length * Math.pow(rand(), 0.4)))];
    // Somewhere earlier: a word or a sentence changed, added, or taken back
    function revise() {
      const id = somewhere();
      const ps = book.chapters.get(id).paras;
      let p = Math.floor(rand() * ps.length);
      for (let i = 0; i < 5 && ps[p].t.length < 10; i++) p = Math.floor(rand() * ps.length);
      const t = ps[p].t;
      if (t.length < 10) return;
      let off = t.indexOf(' ', Math.floor(rand() * t.length));
      if (off < 0) off = t.length;
      const r = rand();
      if (r < 0.06) emphasize(id, p);
      else if (r < 0.3) { // a sentence more, sometimes taken back with Ctrl+Z
        jump(id, p, off);
        const from = caret.off;
        type(' ' + lang.sentence());
        if (rand() < 0.06) {
          const n = caret.off - from;
          key(between(400, 2500), 'KeyZ', R.MOD.ctrl, [0, 'e', at() - n, n, '', 'hU']);
          para().t = para().t.slice(0, from) + para().t.slice(caret.off);
          caret.off = from;
          changed(id, -n);
          out.counts.undos++;
        }
      } else if (r < 0.6) { // a few words held away with Backspace, and others typed
        jump(id, p, off);
        const n = Math.min(caret.off, 3 + Math.floor(rand() * 25));
        for (let i = 0; i < n; i++) backspace(i ? 33 : between(200, 900), i > 0);
        type(' ' + Array.from({ length: 1 + Math.floor(rand() * 4) }, lang.pick).join(' '));
      } else if (r < 0.85) { // words selected and typed over
        const from = Math.max(0, t.lastIndexOf(' ', Math.max(0, off - 1 - Math.floor(rand() * 40))));
        if (!clean(t, from, off)) return;
        jump(id, p, from);
        selectDelete(from, off);
        type(' ' + Array.from({ length: 1 + Math.floor(rand() * 5) }, lang.pick).join(' '));
      } else { // a few arrows back, a word put in
        jump(id, p, off);
        const n = Math.min(caret.off, 1 + Math.floor(rand() * 8));
        for (let i = 0; i < n && para().t[caret.off - 1] !== '>'; i++) {
          const d = wait(i ? between(60, 200) : between(200, 900));
          lastKey = clock;
          push([d, 'k', 'ArrowLeft', 0]);
          caret.off--;
          push([wait(3), 's', caret.p, textOff(para().t, caret.off)]);
        }
        type(lang.pick() + ' ');
      }
    }
    function selectDelete(from, to) {
      if (to <= from) return;
      const t = para().t;
      push([wait(between(300, 1500)), 's', caret.p, textOff(t, from), caret.p, textOff(t, to), 'p']);
      caret.off = from;
      key(between(200, 800), 'Backspace', 0, [0, 'e', at(), to - from, '', 'dB']);
      const p = para();
      p.t = p.t.slice(0, from) + p.t.slice(to);
      changed(caret.ch, from - to);
    }
    // Over length: a sentence cut, or paragraphs sent to Darlings
    function cut() {
      const id = somewhere();
      const ps = book.chapters.get(id).paras;
      let p = Math.floor(rand() * ps.length);
      for (let i = 0; i < 5 && ps[p].t.length < 40; i++) p = Math.floor(rand() * ps.length);
      if (rand() < 0.15) { crossDelete(id, Math.min(p, ps.length - 2)); return; }
      // a sentence, or (a short paragraph, or half the time) whole paragraphs
      if (ps[p].t.length >= 40 && (ps.length < 4 || rand() < 0.5)) {
        const t = ps[p].t;
        const from = Math.max(0, t.lastIndexOf('. ', Math.floor(rand() * t.length)));
        const to = t.indexOf('. ', from + 2);
        if (!clean(t, from, to < 0 ? t.length : to)) return;
        jump(id, p, from);
        selectDelete(from, to < 0 ? t.length : to);
        return;
      }
      if (ps.length < 4) return;
      p = Math.min(p, ps.length - 2); // the last paragraph stays
      const n = Math.min(ps.length - p - 1, 1 + Math.floor(rand() * 3));
      touch(id);
      let from = 0;
      for (let i = 0; i < p; i++) from += paraLen(ps[i]);
      let del = 0;
      for (let i = p; i < p + n; i++) del += paraLen(ps[i]);
      push([wait(between(1000, 5000)), 'x', 'darling-out']);
      push([0, 'e', from, del, '']);
      const gone = ps.splice(p, n);
      changed(id, -del);
      caret = null;
      if (rand() < 0.08) { // and Ctrl+Z puts them back
        push([wait(between(800, 6000)), 'k', 'KeyZ', R.MOD.ctrl]);
        push([0, 'x', 'undo-structural']);
        push([0, 'e', from, 0, chapterHTML({ paras: gone })]);
        ps.splice(p, 0, ...gone);
        changed(id, del);
        out.counts.structuralUndos++;
      }
    }
    // A selection from one paragraph into the next, deleted: they join
    function crossDelete(id, p) {
      const ps = book.chapters.get(id).paras;
      if (p < 0 || ps.length < 2) return;
      const a = ps[p].t;
      const b = ps[p + 1].t;
      if (a.length < 40 || b.length < 40) return;
      const from = a.lastIndexOf(' ', Math.floor(rand() * a.length));
      const to = b.indexOf(' ', Math.floor(rand() * b.length));
      if (from < 0 || to < 0 || !clean(a, from, a.length) || !clean(b, 0, to)) return;
      jump(id, p, from);
      const at0 = startOf(ps, p) + from;
      const del = startOf(ps, p + 1) + to - at0;
      push([wait(between(300, 1500)), 's', p, textOff(a, from), p + 1, textOff(b, to), 'p']);
      key(between(200, 800), 'Backspace', 0, [0, 'e', at0, del, '', 'dB']);
      ps[p].t = a.slice(0, from) + b.slice(to);
      ps.splice(p + 1, 1);
      base = null;
      changed(id, -del);
      out.counts.crossDeletes++;
    }
    // A word selected and set in italic (or bold) with Ctrl+I
    function emphasize(id, p) {
      const ps = book.chapters.get(id).paras;
      const t = ps[p].t;
      const words = [...t.matchAll(/(?<=^| )[^ <>]{4,}(?= |$)/g)];
      if (!words.length) return;
      const m = words[Math.floor(rand() * words.length)];
      const from = m.index;
      const to = from + m[0].length;
      if (!clean(t, 0, from)) return; // (not inside one already)
      const tag = rand() < 0.85 ? 'i' : 'b';
      const html = `<${tag}>${m[0]}</${tag}>`;
      jump(id, p, to);
      push([wait(between(300, 1500)), 's', p, textOff(t, from), p, textOff(t, to), 'p']);
      key(between(200, 800), tag === 'i' ? 'KeyI' : 'KeyB', R.MOD.ctrl, [0, 'e', startOf(ps, p) + from, m[0].length, html, tag === 'i' ? 'fI' : 'fB']);
      ps[p].t = t.slice(0, from) + html + t.slice(to);
      caret.off = from + html.length;
      base = null;
      changed(id, html.length - m[0].length, m[0].length + html.length);
      out.counts.italics++;
    }
    // Replace All renaming one of the cast through the book: NEO records
    // each chapter it changed as one splice, from the first name to the last
    function replaceAll() {
      const i = Math.floor(rand() * 4);
      const from = lang.names[i];
      const to = lang.newName();
      const re = new RegExp(`(?<!\\p{L})(${from}|${from.toUpperCase()})(?!\\p{L})`, 'gu');
      push([wait(between(2000, 8000)), 'k', 'KeyH', R.MOD.ctrl]);
      for (const id of book.order) {
        const ch = book.chapters.get(id);
        let hits = 0;
        const next = ch.paras.map((p) => p.t.replace(re, (w) => { hits++; return w === from ? to : to.toUpperCase(); }));
        if (!hits) continue;
        touch(id);
        const old = chapterHTML(ch);
        ch.paras.forEach((p, j) => { p.t = next[j]; });
        const now = chapterHTML(ch);
        push([wait(between(5, 40)), 'x', 'replace-all']);
        const vol = edits(old, now);
        changed(id, now.length - old.length, vol);
        out.spans.replace.ins += vol;
        out.spans.replace.changed += hits * to.length;
      }
      lang.names[i] = to;
      caret = null;
      replaced = true;
      out.counts.replaceAlls++;
    }
    // A draft from elsewhere, several KB of paragraphs, pasted on a new line
    function bigPaste() {
      const id = book.order[book.order.length - 1];
      const ps = book.chapters.get(id).paras;
      const p = ps.length - 1;
      if (isBreak(ps[p])) return;
      jump(id, p, ps[p].t.length);
      if (para().t.length) enter();
      const size = script ? between(3000, 15000) : between(5000, 30000);
      const paras = [];
      let c = para().c;
      for (let n = 0; n < size;) {
        const q = script ? { c, t: line(c) } : { c: '', t: lang.paragraph() };
        if (script) c = nextClass(c, rand);
        paras.push(q);
        n += paraLen(q);
      }
      const ins = paras[0].t + paras.slice(1).map((q) => '</p>' + open(q) + q.t).join('');
      key(between(400, 2000), 'KeyV', R.MOD.ctrl, null);
      push([0, 'c', 'paste', ins.length, 'html', nodeDigest(ins), false]);
      push([0, 'e', at(), 0, ins, 'iFP']);
      para().t += paras[0].t;
      chapter().paras.splice(caret.p + 1, 0, ...paras.slice(1));
      caret.p += paras.length - 1;
      caret.off = para().t.length;
      base = null;
      changed(id, ins.length);
      out.counts.bigPastes++;
    }
    // A card dragged in the Outline: a section moved, in its chapter or to
    // another (a scene, in a script). A move within a chapter is one splice
    // from where it left to where it went
    function outlineMove() {
      const a = somewhere();
      const A = book.chapters.get(a).paras;
      let from, n;
      if (script) {
        const heads = A.map((q, i) => (q.c === 'sp-heading' ? i : -1)).filter((i) => i >= 0);
        if (heads.length < 4) return;
        const k = Math.floor(rand() * (heads.length - 1));
        from = heads[k];
        n = heads[k + 1] - from;
      } else {
        if (A.length < 12) return;
        from = 1 + Math.floor(rand() * (A.length - 10));
        n = 3 + Math.floor(rand() * 6);
      }
      const b = script || rand() < 0.3 ? a : somewhere();
      const B = book.chapters.get(b).paras;
      push([wait(between(2000, 8000)), 'f', 'tab:outline']);
      touch(a);
      const oldA = chapterHTML({ paras: A });
      const moved = A.splice(from, n);
      let to = Math.floor(rand() * (B.length + 1));
      if (script) { // before another scene's heading, or at the end
        const heads = B.map((q, i) => (q.c === 'sp-heading' ? i : -1)).filter((i) => i >= 0);
        to = rand() < 0.1 ? B.length : heads[Math.floor(rand() * heads.length)];
      }
      const mlen = chapterHTML({ paras: moved }).length;
      if (b === a) {
        A.splice(to, 0, ...moved);
        const now = chapterHTML({ paras: A });
        if (now === oldA) return;
        push([wait(between(5, 40)), 'x', script ? 'script' : 'outline']);
        const vol = edits(oldA, now);
        changed(a, 0, vol);
        out.spans.move.ins += vol;
      } else {
        push([wait(between(5, 40)), 'x', 'outline']);
        const va = edits(oldA, chapterHTML({ paras: A }));
        changed(a, -mlen, va);
        touch(b);
        const oldB = chapterHTML({ paras: B });
        B.splice(to, 0, ...moved);
        push([0, 'x', 'outline']);
        const vb = edits(oldB, chapterHTML({ paras: B }));
        changed(b, mlen, vb);
        out.spans.move.ins += va + vb;
      }
      out.spans.move.changed += mlen;
      push([wait(between(1000, 5000)), 'f', 'tab:manuscript']);
      caret = null;
      out.counts.moves++;
    }
    function newChapter() {
      const id = newId();
      const ch = { paras: [{ c: script ? 'sp-heading' : '', t: '' }] };
      book.chapters.set(id, ch);
      book.order.push(id);
      const html = chapterHTML(ch);
      if (cur) push([wait(between(1000, 4000)), 'x', 'new']);
      push([0, 'b', id, html, nodeDigest(html), 'new']);
      touched.add(id);
      fullB(id);
      if (ordered) order(); else { order(); ordered = true; }
      changed(id, html.length);
      cur = id;
      caret = null;
      return id;
    }
    // A long chapter cut in two where a paragraph begins
    function split() {
      const id = book.order[Math.floor(rand() * book.order.length)];
      const ps = book.chapters.get(id).paras;
      if (ps.length < 20) return;
      const p = Math.floor(ps.length * (0.3 + 0.4 * rand()));
      touch(id);
      let from = 0;
      for (let i = 0; i < p; i++) from += paraLen(ps[i]);
      const moved = { paras: ps.splice(p) };
      const html = chapterHTML(moved);
      push([wait(between(1000, 4000)), 'x', 'split']);
      push([0, 'e', from, html.length, '']);
      changed(id, -html.length);
      const nid = newId();
      book.chapters.set(nid, moved);
      book.order.splice(book.order.indexOf(id) + 1, 0, nid);
      push([0, 'b', nid, html, nodeDigest(html), 'split']);
      touched.add(nid);
      fullB(nid);
      changed(nid, html.length);
      cur = nid;
      order();
      caret = null;
    }
    function paste() {
      if (!caret) return;
      const text = lang.sentence();
      key(between(400, 2000), 'KeyV', R.MOD.ctrl, null);
      push([0, 'c', 'paste', text.length, 'text', nodeDigest(text), rand() < 0.5]);
      push([0, 'e', at(), 0, text, 'iFP']);
      para().t = para().t.slice(0, caret.off) + text + para().t.slice(caret.off);
      caret.off += text.length;
      changed(caret.ch, text.length);
    }

    push([0, 'f', 'focus']);
    push([0, 'T', d.toISOString()]);
    if (!book.order.length) newChapter();
    let stalled = 0;
    for (;;) {
      if (typed >= keys) break; // key() counts them
      if (++stalled > 5000) throw new Error(`${kind}: 5000 moves in a row typed nothing`);
      const before = typed;
      if (clock > nextAway) { // away from NEO for a while
        push([wait(between(500, 3000)), 'f', 'blur']);
        const away = between(10, 600) * 1000;
        clock += away;
        push([away, 'f', 'focus']);
        push([0, 'T', new Date(startMs + clock).toISOString()]);
        nextAway = clock + between(10, 40) * 60000;
      }
      if (rand() < 0.02) wait(between(20, 240) * 1000); // thinking
      const over = book.size > target;
      const r = rand();
      if (!script && rand() < 0.0001) split();
      else if (rand() < 0.00012) replaceAll();
      else if (rand() < 0.0005) outlineMove();
      else if (!over && rand() < 0.00025) bigPaste();
      else if (over ? r < 0.65 : r < 0.04) cut();
      else if (over || r < 0.3) revise();
      else if (r > 0.995) paste();
      else draft();
      if (typed > before) stalled = 0;
    }
    flush();
    push([wait(between(1000, 9000)), 'f', 'blur']);
    push([0, 'end', { closed: 'book' }]);
    const last = w.chunk();
    if (last) parts.push(last.text);
    out.keys += typed;
    dev.prev = w.H;
    for (const ch of touched) if (book.chapters.has(ch)) dev.known.set(ch, chapterHTML(book.chapters.get(ch)));
    return { id, text: parts.join(''), replaced };
  }
}

/* ---------- playing it, as the dialog does ---------- */

function timed(fn) {
  const t = performance.now();
  const value = fn();
  return [value, performance.now() - t];
}
async function timedAsync(fn) {
  const t = performance.now();
  const value = await fn();
  return [value, performance.now() - t];
}
const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return { mean: s.reduce((a, b) => a + b, 0) / Math.max(1, s.length), p95: s[Math.floor(s.length * 0.95)] || 0, max: s[s.length - 1] || 0, median: s[s.length >> 1] || 0 };
};
const dirBytes = (dir) => fs.readdirSync(dir).reduce((n, f) => n + fs.statSync(path.join(dir, f)).size, 0);
// chapters whose state doesn't end where that computer's recording left them
const unlikeEnds = (got, ends) => Object.keys(ends).filter((id) => got[id] !== ends[id]).length;

// The overview's frames, as the dialog's reindex makes them from the stats
function frames(entries) {
  const words = {};
  let order = null;
  const out = [];
  for (const e of entries) {
    for (const s of e.sessions) {
      for (const [ch, c] of Object.entries(s.stats.chapters)) { if (c.gone) delete words[ch]; else words[ch] = c.words; }
      if (s.stats.order) order = s.stats.order;
      out.push({ order, words: { ...words } });
    }
  }
  return out;
}

async function play(dir) {
  // history-worker.js is what builds the cache in NEO (and it hands
  // recording.js Node's SHA-256, as there)
  const { BookDays } = require('../history-worker.js');
  // --pocket: the worker asks the page for each file and waits for the
  // answer, and there is no native SHA-256
  let io;
  if (process.argv.includes('--pocket')) {
    R.setDigest(null);
    const node = require('../recording-files.js').nodeIO({ fs, path, zlib, write: (f, d) => fs.writeFileSync(f, d), log: () => {} });
    const later = (fn) => (...args) => new Promise((resolve, reject) => setImmediate(() => { try { resolve(fn(...args)); } catch (err) { reject(err); } }));
    io = { join: node.join, log: node.log };
    for (const k of ['list', 'read', 'readGz', 'write', 'writeGz', 'remove', 'exists']) io[k] = later(node[k]);
  }
  const ends = JSON.parse(fs.readFileSync(path.join(dir, 'ends.json'), 'utf8'));
  // the book as it ended: its chapter files
  const book = {};
  for (const f of fs.readdirSync(path.join(dir, 'chapters'))) book[f.replace(/\.html$/, '')] = fs.readFileSync(path.join(dir, 'chapters', f), 'utf8');
  const mb = () => { global.gc(); return process.memoryUsage().heapUsed / 2 ** 20; };
  const out = {};
  const target = () => ({ root: path.join(dir, 'recording'), cache: path.join(dir, 'cache'), ...(io ? { io } : {}) });

  // the first build, in the worker: every day of both computers, oldest first

  let d = new BookDays(target());
  [, out.firstBuild] = await timedAsync(() => d.build());
  out.days = d.entries.length;
  out.sessions = d.entries.reduce((n, e) => n + e.sessions.length, 0);
  out.lost = d.entries.reduce((n, e) => n + e.lost.length, 0);
  out.cacheBytes = dirBytes(path.join(dir, 'cache'));
  out.indexBytes = fs.statSync(d.indexFile).size;
  // the year ends where the book did on the page, and where each computer's
  // recording left every chapter on that computer
  const end = await d.dayStart('9999-12-31');
  out.mismatched = unlikeEnds(end.page, book);
  out.devices = DEVICES.map((x) => unlikeEnds(end.devices[x] || {}, ends[x]));
  d = null;

  // opening: the index read (nothing to build), and the overview's frames
  const heap0 = mb();
  const [opened, openMs] = await timedAsync(() => new BookDays(target()).build());
  const [, framesMs] = timed(() => frames(opened.entries));
  out.openMs = openMs + framesMs;
  const days = opened.entries;
  const dd = new BookDays(target());
  dd.entries = days;

  // a day ready to play: its start from the cache, its sessions read and
  // played with keyframes, as historyLoadDay does
  const loadDay = async (e) => {
    const start = await dd.dayStart(e.day);
    const ss = [];
    for (const s of e.sessions) ss.push({ id: s.id, device: s.device, text: await dd.closedText(s) });
    const h = new R.History(ss);
    h.build(start);
    return h;
  };
  const rand = rng(7);
  const loads = [];
  for (let i = 0; i < 20; i++) loads.push((await timedAsync(() => loadDay(days[Math.floor(rand() * days.length)])))[1]);
  out.day = stats(loads);
  // the biggest day: memory while playing it, and seeks within it
  const big = days.reduce((a, e) => (e.stats.keys > a.stats.keys ? e : a), days[0]);
  let h = await loadDay(big);
  out.memoryMB = mb() - heap0;
  out.bigDay = { keys: big.stats.keys, steps: h.steps.length, bad: h.bad.size };
  const seeks = [];
  for (let i = 0; i < 300; i++) {
    const n = Math.floor(rand() * h.steps.length);
    seeks.push(timed(() => h.doc(n))[1]);
  }
  out.seek = stats(seeks);
  h = null;

  // a day loaded from the cache plays to what the whole year played to there
  let checked = 0;
  for (const e of [days[1], days[days.length >> 1], days[days.length - 1]].filter(Boolean)) {
    const hh = await loadDay(e);
    const next = (await dd.dayStart(days.indexOf(e) + 1 < days.length ? days[days.indexOf(e) + 1].day : '9999-12-31')).page;
    if (hh.bad.size || unlikeEnds(hh.end, next)) out.dayMismatch = (out.dayMismatch || 0) + 1;
    checked++;
  }
  out.daysChecked = checked;

  // search (4c): the first pass over the day files, where only a day's new
  // paragraphs are tested; and the second, inside the days, at its worst:
  // a phrase never written, so every day is played
  [, out.searchDiffsMs] = await timedAsync(() => dd.searchFirst('the quick'));
  const never = await dd.searchFirst('zqxwv never written');
  [, out.searchWithinMs] = await timedAsync(() => dd.searchWithin('zqxwv never written', never.findings, () => false, () => {}));
  // the day files: a median and the largest, and the most diffs a day
  const sizes = days.map((e) => fs.statSync(dd.dayFile(e.day)).size);
  out.dayFiles = stats(sizes);

  return out;
}

/* ---------- a real book's figures ---------- */

// What a book's recording says about its writing, for checking the
// generated year against: bytes a key, chapters a day, the sizes of its
// paragraphs, of the splices NEO's own moves made, and of catch-ups
function figures(bookDir) {
  const root = path.join(bookDir, 'recording');
  const out = { sessions: 0, keys: 0, gz: 0, days: new Map(), paras: [], splices: [], catchUps: [] };
  for (const device of fs.readdirSync(root)) {
    const dir = path.join(root, device);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const n of fs.readdirSync(dir).filter((x) => x.endsWith('.jsonl.gz')).sort()) {
      const z = fs.readFileSync(path.join(dir, n));
      const text = zlib.gunzipSync(z).toString('utf8');
      const { header, lines } = R.parseSession(text);
      if (!header) continue;
      out.sessions++;
      out.gz += z.length;
      out.keys += R.compileSession(text).keys.length;
      const day = R.sessionDay(header);
      if (!out.days.has(day)) out.days.set(day, new Set());
      let cause = null;
      for (const l of lines) {
        if (!Array.isArray(l)) continue;
        if (l[1] === 'x') cause = l[2];
        if ((l[1] === 'b' || l[1] === 'ch') && !R.isStream(l[2])) out.days.get(day).add(l[2]);
        if (l[1] === 'e' && l.length <= 5) (cause === 'catch-up' ? out.catchUps : out.splices).push(l[3] + l[4].length);
      }
    }
  }
  const chDir = path.join(bookDir, 'chapters');
  for (const f of fs.readdirSync(chDir)) for (const p of R.paragraphs(fs.readFileSync(path.join(chDir, f), 'utf8'))) out.paras.push(p.length);
  return {
    sessions: out.sessions,
    days: out.days.size,
    bytesPerKey: out.gz / Math.max(1, out.keys),
    chaptersADay: stats([...out.days.values()].map((s) => s.size)),
    paragraph: stats(out.paras),
    splice: stats(out.splices),
    catchUp: stats(out.catchUps)
  };
}

function compare(real, gen) {
  const lines = [];
  const row = (what, a, b) => lines.push(`  ${what.padEnd(44)}${String(a).padEnd(26)}${b}`);
  const dist = (s, unit = '') => `${s.median.toFixed(0)}${unit} / ${s.p95.toFixed(0)}${unit} / ${s.max.toFixed(0)}${unit}`;
  row('', 'This book', 'A generated month');
  row('Sessions, writing days', `${real.sessions}, ${real.days}`, `${gen.sessions}, ${gen.days}`);
  row('Bytes a key, gzipped', real.bytesPerKey.toFixed(2), gen.bytesPerKey.toFixed(2));
  row('Chapters touched a day (median/95th/most)', dist(real.chaptersADay), dist(gen.chaptersADay));
  row('Paragraph, characters', dist(real.paragraph), dist(gen.paragraph));
  row('NEO\'s own splices, characters', dist(real.splice), dist(gen.splice));
  row('Catch-ups, characters', dist(real.catchUp), dist(gen.catchUp));
  return lines.join('\n');
}

/* ---------- the report ---------- */

function zipBytes(dir) {
  // the book's files as dailyBackup zips them (DEFLATE), recording left out
  let n = 0;
  for (const f of fs.readdirSync(path.join(dir, 'chapters'))) n += zlib.deflateRawSync(fs.readFileSync(path.join(dir, 'chapters', f))).length + 100;
  return n + zlib.deflateRawSync(fs.readFileSync(path.join(dir, 'book.json'))).length + 100;
}

const kb = (n) => (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
const mbs = (n) => (n / 2 ** 20).toFixed(1) + ' MB';
const ms = (n) => (n >= 10000 ? (n / 1000).toFixed(1) + ' s' : n.toFixed(n < 10 ? 1 : 0) + ' ms');

function report(kind, gen, played, dir) {
  const col = kind === 'novel' ? 0 : 1;
  const yearGz = gen.perDay.reduce((a, d) => a + d.gz, 0);
  const yearRaw = gen.perDay.reduce((a, d) => a + d.raw, 0);
  const gzs = gen.perDay.map((d) => d.gz).sort((a, b) => a - b);
  const zip = zipBytes(dir);
  const lines = [];
  const row = (what, budget, today) => lines.push(`  ${what.padEnd(44)}${String(budget).padEnd(12)}${today}`);
  lines.push(`${kind}: ${gen.days} writing days over ${gen.span}, ${gen.sessions} sessions (${gen.devices.join(' and ')} on two computers), ${gen.keys.toLocaleString('en')} keys, ${gen.chapters} chapter${gen.chapters === 1 ? '' : 's'} of ${kb(gen.bookBytes)} in all`);
  const c = gen.counts;
  lines.push(`  The year held ${c.italics} words set in italic or bold, ${c.breaks} scene breaks, ${c.dashes} dashes, ${c.undos} Ctrl+Z on typing and ${c.structuralUndos} on Darlings, ${c.replaceAlls} Replace All, ${c.bigPastes} pasted drafts, ${c.crossDeletes} deletes across paragraphs, ${c.moves} Outline moves and ${c.catchUps} catch-ups from the other computer`);
  lines.push('');
  lines.push(`  ${(process.argv.includes('--pocket') ? 'The player by day, as Pocket plays it' : 'The player by day (both computers)').padEnd(44)}${'Budget'.padEnd(12)}Measured`);
  if (played.error) {
    lines.push(`  It didn't finish: ${played.error}`);
  } else {
    const b = (k, unit = 'ms') => (unit === 'ms' ? ms(BUDGETS[k][col]) : BUDGETS[k][col] + ' MB');
    row('Dialog open, cached (index and overview)', b('open'), ms(played.openMs) + `  (${played.days} days, ${played.sessions} sessions)`);
    row('A day ready to play, cached, mean / worst', b('day'), `${ms(played.day.mean)} / ${ms(played.day.max)}`);
    row('Seek within the day, mean / 95th / worst', b('seek'), `${ms(played.seek.mean)} / ${ms(played.seek.p95)} / ${ms(played.seek.max)}  (the busiest day: ${played.bigDay.steps.toLocaleString('en')} steps)`);
    row('Jump to another cached day', b('jump'), `${ms(played.day.mean)}  (a day ready to play)`);
    row('First build of the cache, in the worker', b('firstBuild'), `${ms(played.firstBuild)}`);
    row('Memory while playing (heap, no DOM)', b('memory', 'MB'), `${played.memoryMB.toFixed(0)} MB: the index and the busiest day`);
    row('Cache on disk', b('cache', 'MB'), `${mbs(played.cacheBytes)}  (the index ${kb(played.indexBytes)}; a day's file, median ${kb(played.dayFiles.median)}, largest ${kb(played.dayFiles.max)})`);
    row('Search over the day files (4c\'s first pass)', ms(BUDGETS.searchStates[col]), ms(played.searchDiffsMs));
    row('Search inside the days, at its worst', b('firstBuild'), ms(played.searchWithinMs) + '  (4c\'s second pass, a phrase never written: every day played)');
    row('Replay check', '', played.mismatched || played.lost || played.bigDay.bad || played.dayMismatch ? `${played.mismatched} chapters unlike the book at the end, ${played.lost} lost, ${played.bigDay.bad} steps that don't fit, ${played.dayMismatch || 0} days unlike the cache` : `the page ends as the book did, and ${played.daysChecked} days played from the cache end where the next begins`);
    row('… each computer', '', played.devices.some(Boolean) ? `${played.devices.join(' and ')} chapters unlike where each computer's recording left them` : 'its copies end where its recording left every chapter');
  }
  lines.push('');
  lines.push('  Size');
  row('Recording per writing day, gzipped', '', `median ${kb(gzs[gzs.length >> 1])}, mean ${kb(yearGz / gen.days)}, largest ${kb(gzs[gzs.length - 1])}`);
  row('Recording for the year', '', `${mbs(yearGz)} gzipped, ${mbs(yearRaw)} as text`);
  const a = gen.anchors;
  row('… of which anchors', '', `${kb(a.bytes)} (${(100 * a.bytes / yearGz).toFixed(1)}%), ${a.n} anchors, the longest replay ${kb(a.most)} of edits`);
  const as = gen.oneSplice ? 'one splice each (--one-splice)' : 'a splice per change';
  for (const [what, sp] of [['Replace All', gen.spans.replace], ['Outline moves', gen.spans.move], ['Catch-ups', gen.spans.catchUp]]) {
    if (sp.ins) row(`${what}, ${as}`, '', `${kb(sp.ins)} inserted and deleted${sp.changed === undefined ? '' : `, for ${kb(sp.changed)} changed`}`);
  }
  lines.push('');
  lines.push('  Backups/, writing one such book a year (14 daily zips)');
  row('Today, recording in every zip, after 1 year', '', mbs(14 * (zip + yearGz)));
  row('… after 3 years', '', mbs(14 * 3 * (zip + yearGz)));
  row('Zips without recordings, after 1 year', '', mbs(14 * zip));
  row('… after 3 years', '', mbs(14 * 3 * zip));
  row('The recording mirror, after 1 year', '', mbs(yearGz));
  row('… after 3 years', '', mbs(3 * yearGz));
  return lines.join('\n');
}

/* ---------- processes ---------- */

const [mode, ...rest] = process.argv.slice(2);
if (mode === '--gen') {
  const [kind, days, dir, pace, one] = rest;
  console.log(JSON.stringify(generate(kind, +days, dir, +pace, one === 'one')));
} else if (mode === '--play') {
  play(rest[0]).then((r) => console.log(JSON.stringify(r)));
} else {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const keep = process.argv.includes('--keep');
  const from = (process.argv.find((a) => a.startsWith('--from=')) || '').slice(7);
  if (from) { if (!/^\d{4}-\d\d-\d\d$/.test(from)) throw new Error('--from=YYYY-MM-DD'); process.env.NEO_BENCH_FROM = from; } // the generator, a child, reads it
  const real = (process.argv.find((a) => a.startsWith('--book=')) || '').slice(7);
  const kinds = real ? ['novel'] : args[0] ? [args[0]] : Object.keys(BOOKS);
  const days = real ? 20 : +args[1] || 250;
  const pace = +((process.argv.find((a) => a.startsWith('--pace=')) || '').slice(7) || 1);
  if (kinds.some((k) => !BOOKS[k])) throw new Error('Books: ' + Object.keys(BOOKS).join(', '));
  if (R.digest('Writing History') !== nodeDigest('Writing History')) throw new Error('digest differs from Node’s');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-history-'));
  const child = (args, heapMB) => {
    const r = spawnSync(process.execPath, ['--expose-gc', `--max-old-space-size=${heapMB}`, __filename, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 1 << 26 });
    if (r.status !== 0) return { error: r.signal || `exit ${r.status}${/heap out of memory/i.test(r.stderr || '') ? ', out of memory' : ''}` };
    return JSON.parse(r.stdout.trim().split('\n').pop());
  };
  console.log(`${os.cpus()[0].model.trim()}, ${os.cpus().length} threads, ${Math.round(os.totalmem() / 2 ** 30)} GB, Node ${process.version}\n`);
  try {
    for (const kind of kinds) {
      const dir = path.join(root, kind);
      const t = performance.now();
      const gen = child(['--gen', kind, days, dir, pace, process.argv.includes('--one-splice') ? 'one' : 'many'], 8192);
      if (gen.error) throw new Error(`generating the ${kind} failed: ${gen.error}`);
      process.stderr.write(`  ${kind}: generated in ${ms(performance.now() - t)}\n`);
      if (real) {
        console.log(`${path.basename(real)}, beside ${days} generated days of a novel\n`);
        console.log(compare(figures(real), figures(dir)));
        continue;
      }
      const played = child(['--play', dir, ...(process.argv.includes('--pocket') ? ['--pocket'] : [])], 12288);
      console.log(report(kind, gen, played, dir) + '\n');
    }
  } finally {
    if (keep) console.log('Kept in ' + root);
    else fs.rmSync(root, { recursive: true, force: true });
  }
}
