'use strict';

// Writing History by day (docs/neo-recording-plan.md, phase 4b): the
// paragraph model the player and the cache hold chapters in, a change made
// all at once recorded as a splice per run of paragraphs, anchors, session
// and day stats, the day states the cache keeps, and skipping by session;
// and search (phase 4c): when a phrase was first written, last written,
// written out and moved, and the moment in its day each lands on. Each is
// checked against a brute-force count over plain strings.

const assert = require('node:assert/strict');
const { test } = require('node:test');
const crypto = require('node:crypto');
const R = require('../recording.js');

// Node's SHA-256, as history-worker.js hands it in: the same hashes, faster
R.setDigest((data) => crypto.createHash('sha256').update(data).digest().subarray(0, 16).toString('base64url'));

function rng(seed) {
  return (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return Math.floor((seed / 0x7fffffff) * n); };
}
const pad = (n) => String(n).padStart(2, '0');
const DEV = 'd-0123456789abcdef'; // the computer the generated histories are written on
const str = (doc) => Object.fromEntries(Object.entries(doc).map(([ch, c]) => [ch, c.toString()]));

// Places in a chapter's HTML where typing can go: not inside a tag or an
// entity, and inside a paragraph (after its <p…>, before its </p>)
function safePlaces(html) {
  const out = [];
  let inP = false;
  for (let i = 0; i < html.length;) {
    if (html[i] === '<') {
      const end = html.indexOf('>', i) + 1;
      const tag = html.slice(i, end);
      if (/^<p\b/.test(tag)) inP = true;
      if (tag === '</p>') { out.push(i); inP = false; } else if (inP && /^<\/?(i|b)>$/.test(tag)) out.push(i);
      i = end;
      continue;
    }
    if (html[i] === '&') { if (inP) out.push(i); i = html.indexOf(';', i) + 1; continue; }
    if (inP) out.push(i);
    i += html.codePointAt(i) > 0xffff ? 2 : 1;
  }
  return out;
}

const WORDS = ['rain', 'door', 'John', 'Mara', 'the', 'quiet', 'boat', 'river', 'never', 'light', 'cold', 'harbour', 'said', 'and'];

// A history as the recorder writes it: `days` writing days, a session or two
// each, typing, Enter and Backspace across paragraphs, italics, pastes (an
// emoji now and then), Replace All and paragraphs moved (NEO's moves,
// recorded as Rec.splices), chapters new and deleted, the `b` lines from
// Rec.baseLines with each chapter's edits counted for anchors. With two
// devices, a session now and then is the second's: each device's `b` lines
// start from where its own recording left a chapter, and its chain is its
// own, while the book is one (synced between sessions). Returns the
// sessions and, after each, the chapters as they truly were.
function history({ seed = 1, days = 6, size = 1, scale = 1, devices = [DEV] } = {}) {
  const rand = rng(seed);
  const pick = (xs) => xs[rand(xs.length)];
  // each device: where its recording left each chapter, edits since its last full `b`, its chain
  const per = Object.fromEntries(devices.map((d) => [d, { known: {}, edited: {}, prev: null }]));
  const sessions = [];
  let nextCh = 0;
  const book = {};
  const order = [];
  const newChapter = () => {
    const ch = 'ch-' + String.fromCharCode(97 + nextCh++);
    book[ch] = '<p>' + Array.from({ length: 3 + rand(4) }, () => pick(WORDS)).join(' ') + '.</p><p class="scene-break">***</p><p></p>';
    order.push(ch);
    return ch;
  };
  for (let i = 0; i < 3; i++) newChapter();
  for (let d = 0; d < days; d++) {
    const day = `2026-11-${pad(d + 1)}`;
    const count = d % 3 === 1 ? 2 : 1;
    for (let k = 0; k < count; k++) {
      const id = `${day}T${pad(9 + 6 * k)}-00-00Z-g${seed}${d}${k}`;
      const device = devices.length > 1 ? devices[rand(3) === 0 ? 1 : 0] : devices[0];
      const me = per[device];
      const { known, edited } = me;
      const w = new R.SessionWriter({ neoRec: 1, session: id, device, book: 'b', day, startedAt: `${day}T${pad(9 + 6 * k)}:00:00.000Z`, tz: 'UTC', prev: me.prev });
      const seen = new Set();
      let cur = null;
      let clock = 0;
      const dt = (n) => { clock += n; return n; };
      const count = (ch, del, ins) => { edited[ch] = (edited[ch] || 0) + del + ins.length; };
      const touch = (ch) => {
        if (seen.has(ch)) { if (cur !== ch) w.push([0, 'ch', ch]); cur = ch; return; }
        seen.add(ch);
        R.baseLines(ch, book[ch], known[ch], edited[ch] || 0).forEach((line) => {
          if (line[0] === 'b' && line[2] !== null) edited[ch] = 0;
          if (line[0] === 'e') count(ch, line[2], line[3]);
          w.push([0, ...line]);
        });
        cur = ch;
      };
      const edit = (ch, at, del, ins, input, key) => {
        touch(ch);
        if (key) w.push([dt(80 + rand(400)), 'k', key, 0]);
        w.push([key ? 0 : dt(50 + rand(900)), 'e', at, del, ins, input]);
        book[ch] = R.applyEdit(book[ch], at, del, ins);
        count(ch, del, ins);
      };
      const neo = (ch, html, cause) => {
        touch(ch);
        w.push([dt(500), 'x', cause]);
        for (const sp of R.splices(book[ch], html)) { w.push([0, 'e', sp.at, sp.del, sp.ins]); count(ch, sp.del, sp.ins); }
        book[ch] = html;
      };
      // between days, now and then, the chapter changed while nothing recorded
      if (k === 0 && d > 1 && rand(4) === 0) {
        const ch = pick(order);
        book[ch] = book[ch].replace('</p>', ' Written elsewhere.</p>');
      }
      const ops = (60 + rand(60)) * size;
      for (let n = 0; n < ops; n++) {
        const ch = pick(order);
        const html = book[ch];
        // somewhere in a paragraph (or the one after it, for a selection that crosses)
        const ps = R.paragraphs(html);
        const p = rand(ps.length);
        let base = 0;
        for (let i = 0; i < p; i++) base += ps[i].length;
        const places = safePlaces(ps[p] + (ps[p + 1] || '')).map((x) => x + base);
        const at = pick(places.filter((x) => x < base + ps[p].length)) ?? places[0];
        const roll = rand(100);
        if (roll < 45) { // a word typed
          const word = (html[at - 1] === '>' ? '' : ' ') + pick(WORDS);
          for (let i = 0; i < word.length; i++) edit(ch, at + i, 0, word[i], 'iT', 'KeyA');
        } else if (roll < 55) { // Backspace, or a selection deleted (within a paragraph, or across a break)
          const to = places.find((p) => p > at && p - at < 40);
          const gap = to === undefined ? '' : html.slice(at, to);
          if (to !== undefined && /^[^<&]*(<\/p><p>[^<&]*)?$/.test(gap)) edit(ch, at, to - at, '', 'dB', 'Backspace');
        } else if (roll < 62) { // Enter
          if (html.slice(at - 3, at) !== '<p>' || rand(3) === 0) edit(ch, at, 0, '</p><p>', 'iP', 'Enter');
        } else if (roll < 67) { // a word set in italic or bold
          const m = /(?<=[ >])(rain|door|boat|river)(?=[ .<])/.exec(html.slice(at));
          if (m && !/<\/?[ib]>/.test(html.slice(at, at + m.index))) {
            const tag = rand(4) ? 'i' : 'b';
            const from = at + m.index;
            const inside = html.lastIndexOf('<i>', from) > html.lastIndexOf('</i>', from) || html.lastIndexOf('<b>', from) > html.lastIndexOf('</b>', from);
            if (!inside) edit(ch, from, m[0].length, `<${tag}>${m[0]}</${tag}>`, tag === 'i' ? 'fI' : 'fB', tag === 'i' ? 'KeyI' : 'KeyB');
          }
        } else if (roll < 72) { // a paste, a paragraph or several
          const parts = Array.from({ length: 1 + rand(3) }, () => Array.from({ length: 4 + rand(30 * scale) }, () => pick(WORDS)).join(' ') + (rand(5) ? '.' : ' 😀.'));
          edit(ch, at, 0, parts.join('</p><p>'), 'iFP');
        } else if (roll < 76) { // Replace All renaming one of the cast
          const [from, to] = rand(2) ? ['John', 'Ivo'] : ['Ivo', 'John'];
          for (const c of order) if (book[c].includes(from)) neo(c, book[c].split(from).join(to), 'replace-all');
        } else if (roll < 80) { // a paragraph moved in the Outline
          const ps = R.paragraphs(html);
          if (ps.length > 3) {
            const [p] = ps.splice(rand(ps.length), 1);
            ps.splice(rand(ps.length + 1), 0, p);
            neo(ch, ps.join(''), 'outline');
          }
        } else if (roll < 82 && order.length < 6) { // a new chapter
          const c = newChapter();
          seen.add(c);
          w.push([dt(900), 'x', 'new']);
          w.push([0, 'b', c, book[c], R.digest(book[c]), 'new']);
          edited[c] = 0;
          cur = c;
          w.push([0, 'o', order.slice()]);
        } else if (roll < 83 && order.length > 2) { // a chapter deleted
          const c = order[order.length - 1];
          touch(c);
          w.push([dt(600), 'd', c, 'delete']);
          delete book[c];
          delete known[c];
          delete edited[c];
          order.pop();
          cur = null;
          w.push([0, 'o', order.slice()]);
        } else if (roll < 86) { // Backspace on a whole lot at once, held down
          const to = places.find((p) => p > at + 20);
          if (to !== undefined && !/[<&]/.test(html.slice(at, to))) edit(ch, at, to - at, '', 'dB', 'Backspace');
        } else { // the caret somewhere
          touch(ch);
          w.push([dt(300 + rand(70000)), 's', 0, rand(5), 'p']);
        }
        if (rand(15) === 0) { for (const c of seen) if (book[c] !== undefined) w.push([0, 'w', R.digest(book[c]), c]); w.chunk(); }
      }
      w.push([dt(500), 'end', {}]);
      w.chunk();
      for (const c of seen) { if (book[c] !== undefined) known[c] = book[c]; }
      me.prev = w.H;
      sessions.push({
        id, device, day, text: w.lines.join('\n') + '\n', after: { ...Object.fromEntries(order.map((c) => [c, book[c]])) },
        // where each device's recording left each chapter, after this session
        known: Object.fromEntries(devices.map((x) => [x, { ...per[x].known }]))
      });
    }
  }
  return { sessions, book, order };
}

// a long history with anchors in it, made once
let anchored = null;
const longHistory = () => anchored || (anchored = history({ seed: 4, days: 12, size: 3, scale: 40 }));

// the sessions grouped by day, in order
function byDay(sessions) {
  const days = [];
  for (const s of sessions) {
    if (!days.length || days[days.length - 1].day !== s.day) days.push({ day: s.day, sessions: [] });
    days[days.length - 1].sessions.push(s);
  }
  return days;
}

/* ---------- the paragraph model ---------- */

test('a chapter held as paragraphs plays every splice exactly as one string does', () => {
  const rand = rng(7);
  const html0 = '<p>One <i>two</i> three.</p><p class="scene-break">***</p><p></p><p>Four 😀 <b>five</b> six.</p><p>Seven.</p>';
  for (let round = 0; round < 40; round++) {
    let s = html0;
    const c = new R.ChapterText(s);
    for (let i = 0; i < 400; i++) {
      const at = rand(s.length + 1);
      const del = rand(4) ? rand(Math.min(6, s.length - at) + 1) : rand(s.length - at + 1); // now and then most of it
      const ins = ['', 'x', '😀', '</p><p>', '<i>', '</i>', '</p><p class="scene-break">***</p><p>', '</p>', 'word word', '<p>'][rand(10)];
      assert.equal(c.splice(at, del, ins), true);
      s = R.applyEdit(s, at, del, ins);
      assert.equal(c.length, s.length);
      if (i % 37 === 0 || i === 399) {
        assert.equal(c.toString(), s, `round ${round}, splice ${i}`);
        assert.deepEqual(c.parts, R.paragraphs(s), 'its pieces are the paragraphs, cut after each </p>');
      }
    }
    assert.equal(c.splice(s.length + 1, 0, 'x'), false, 'a splice past the end doesn’t fit');
    assert.equal(c.splice(2, s.length, ''), false);
  }
  const empty = new R.ChapterText('');
  assert.equal(empty.splice(0, 0, '<p>a</p><p>b</p>'), true);
  assert.deepEqual(empty.parts, ['<p>a</p>', '<p>b</p>']);
  assert.equal(empty.splice(0, 16, ''), true);
  assert.equal(empty.toString(), '');
});

test('a copy of a chapter is its own: playing on one leaves the other', () => {
  const a = new R.ChapterText('<p>a</p><p>b</p>');
  const b = a.clone();
  b.splice(3, 0, 'x');
  b.splice(0, 0, '<p>new</p>');
  assert.equal(a.toString(), '<p>a</p><p>b</p>');
  assert.equal(b.toString(), '<p>new</p><p>xa</p><p>b</p>');
});

test('the paragraph model replays a recorded history step for step, as strings do', () => {
  for (const seed of [1, 2, 3]) {
    const { sessions } = history({ seed, days: 4 });
    const h = new R.History(sessions);
    const doc = {};
    const strings = {};
    h.steps.forEach((s, i) => {
      if (s.k === 'b' && typeof s.html === 'string') strings[s.ch] = s.html;
      else if (s.k === 'e' && strings[s.ch] !== undefined) strings[s.ch] = R.applyEdit(strings[s.ch], s.at, s.del, s.ins);
      else if (s.k === 'd') delete strings[s.ch];
      h.apply(doc, i);
      if (s.ch && doc[s.ch]) assert.equal(doc[s.ch].toString(), strings[s.ch], `seed ${seed}, step ${i}`);
    });
    assert.deepEqual(str(doc), strings);
  }
});

/* ---------- a change made all at once ---------- */

test('a change made all at once is a splice per run of paragraphs, in order', () => {
  const rand = rng(3);
  const ps = Array.from({ length: 30 }, (_, i) => `<p>Paragraph ${i} with John in it.</p>`);
  const a = ps.join('');
  const play = (x, sps) => sps.reduce((h, sp) => R.applyEdit(h, sp.at, sp.del, sp.ins), x);
  // a name replaced at both ends of a chapter: two small splices
  const renamed = ps.map((p, i) => (i === 0 || i === 29 ? p.replace('John', 'Ivo') : p)).join('');
  const two = R.splices(a, renamed);
  assert.equal(two.length, 2);
  assert.ok(two.every((sp) => sp.del + sp.ins.length < 12));
  assert.equal(play(a, two), renamed);
  // a section moved: a delete where it was and an insert where it went
  const moved = [...ps.slice(0, 5), ...ps.slice(9, 20), ...ps.slice(5, 9), ...ps.slice(20)].join('');
  const mv = R.splices(a, moved);
  assert.equal(play(a, mv), moved);
  assert.equal(mv.length, 2);
  assert.ok(mv.some((sp) => sp.del && !sp.ins) && mv.some((sp) => sp.ins && !sp.del), JSON.stringify(mv));
  // a script's repeated cues stay matched around a changed line
  const script = [];
  for (let i = 0; i < 40; i++) script.push('<p class="sp-character">JOHN</p>', `<p class="sp-dialogue">Line ${i}.</p>`, '<p class="sp-character">MARA</p>', '<p class="sp-dialogue">Yes.</p>');
  const changed = script.slice();
  changed[41] = '<p class="sp-dialogue">Line 10, said again.</p>';
  const one = R.splices(script.join(''), changed.join(''));
  assert.equal(one.length, 1);
  assert.equal(one[0].ins, ', said again');
  assert.equal(play(script.join(''), one), changed.join(''));
  // anything to anything
  for (let i = 0; i < 200; i++) {
    const from = Array.from({ length: rand(12) }, () => `<p>${'abc'[rand(3)]}${rand(3)}</p>`).join('') + (rand(4) ? '' : 'tail');
    const to = Array.from({ length: rand(12) }, () => `<p>${'abc'[rand(3)]}${rand(3)}</p>`).join('') + (rand(4) ? '' : 'tail');
    assert.equal(play(from, R.splices(from, to)), to, `${from} → ${to}`);
  }
  assert.deepEqual(R.splices(a, a), []);
});

/* ---------- anchors ---------- */

test('an anchor comes once a chapter’s edits pass 200,000 characters, or four times its length for a long one', () => {
  const short = '<p>' + 'a'.repeat(1000) + '</p>';
  const long = '<p>' + 'a'.repeat(100000) + '</p>';
  const cause = (html, edited) => R.baseLines('ch', html, html, edited)[0][4];
  assert.equal(cause(short, 0), 'continue');
  assert.equal(cause(short, 199999), 'continue');
  assert.equal(cause(short, 200000), 'anchor');
  assert.equal(cause(long, 200000), 'continue', 'four times a 100 KB chapter is more than 200,000');
  assert.equal(cause(long, 4 * long.length - 1), 'continue');
  assert.equal(cause(long, 4 * long.length), 'anchor');
  // an anchor holds the chapter as the recording left it; a catch-up follows it
  const lines = R.baseLines('ch', short + '<p>new</p>', short, 300000);
  assert.deepEqual(lines[0], ['b', 'ch', short, R.digest(short), 'anchor']);
  assert.deepEqual(lines.slice(1), [['x', 'catch-up'], ['e', short.length, 0, '<p>new</p>']]);
  assert.deepEqual(R.baseLines('ch', short, undefined, 0), [['b', 'ch', short, R.digest(short), 'baseline']]);
});

test('a recorded history anchors each chapter once its edits are enough, and not before', () => {
  const { sessions } = longHistory();
  const edited = {};
  const known = {};
  let anchors = 0;
  for (const s of sessions) {
    for (const line of R.parseSession(s.text).lines) {
      if (line[1] !== 'b') continue;
      const [, , ch, html, , cause] = line;
      if (cause === 'anchor') {
        anchors++;
        assert.ok(R.anchorDue(edited[ch], html.length), `${ch} anchored at ${edited[ch]}`);
      } else if (cause === 'continue') {
        assert.ok(!R.anchorDue(edited[ch] || 0, known[ch].length), `${ch} went on without an anchor at ${edited[ch]}`);
      }
    }
    const r = R.replay([s.text], known, { edited });
    assert.ok(r.problems.length === 0, JSON.stringify(r.problems.slice(0, 2)));
    Object.assign(edited, r.edited);
    for (const k of Object.keys(known)) delete known[k];
    Object.assign(known, r.chapters);
  }
  assert.ok(anchors > 0, 'the history is long enough to need one');
});

/* ---------- session and day stats ---------- */

// The words of a chapter, counted plainly
function bag(html) {
  const m = new Map();
  const text = html.replace(/<p\b[^>]*>/g, '').replace(/<\/p>/g, '\n').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').toLowerCase();
  for (const w of text.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) || []) m.set(w, (m.get(w) || 0) + 1);
  return m;
}
function brute(text, before) {
  const c = R.compileSession(text);
  const ch = { ...before };
  const start = {};
  const marks = {};
  const born = {};
  const goneWords = {};
  for (const s of c.steps) {
    if (s.k === 'b') {
      if (typeof s.html !== 'string') continue;
      if (['baseline', 'anchor', 'catch-up'].includes(s.cause)) { if (!(s.ch in ch) && !(s.ch in start)) start[s.ch] = s.html; } else {
        if (!(s.ch in start)) start[s.ch] = ch[s.ch] || '';
        if (!(s.ch in ch)) born[s.ch] = s.cause;
      }
      ch[s.ch] = s.html;
    } else if (s.k === 'e') {
      if (s.cause !== 'catch-up') {
        if (!(s.ch in start)) start[s.ch] = ch[s.ch];
        (marks[s.ch] = marks[s.ch] || []).push([ch[s.ch].length ? s.at / ch[s.ch].length : 0, s.ins.length, s.del]);
      }
      ch[s.ch] = R.applyEdit(ch[s.ch], s.at, s.del, s.ins);
    } else if (s.k === 'd') {
      if (!(s.ch in start)) start[s.ch] = ch[s.ch];
      goneWords[s.ch] = [...bag(ch[s.ch]).values()].reduce((a, b) => a + b, 0);
      delete ch[s.ch];
    }
  }
  const out = {};
  for (const id of new Set([...Object.keys(start), ...Object.keys(marks)])) {
    const now = ch[id] || '';
    const was = start[id] !== undefined ? start[id] : now;
    if (was === now && !marks[id] && !born[id] && !(id in goneWords && !(id in ch))) continue;
    const a = bag(was);
    const b = bag(now);
    let added = 0;
    let removed = 0;
    for (const w of new Set([...a.keys(), ...b.keys()])) {
      const d = (b.get(w) || 0) - (a.get(w) || 0);
      if (d > 0) added += d; else removed -= d;
    }
    const words = id in ch ? [...b.values()].reduce((x, y) => x + y, 0) : goneWords[id] || 0;
    const n = Math.max(64, Math.min(256, Math.ceil(words / 100)));
    const ins = new Array(n).fill(0);
    const del = new Array(n).fill(0);
    for (const [share, i, d] of marks[id] || []) { const k = Math.min(n - 1, Math.floor(share * n)); ins[k] += i; del[k] += d; }
    out[id] = { added, removed, words, ins, del };
  }
  // time spent writing: gaps under a minute between keys and edits
  const moments = [...c.keys, ...c.steps.filter((s) => s.k === 'e').map((s) => s.t)].sort((x, y) => x - y);
  let ms = 0;
  for (let i = 1; i < moments.length; i++) if (moments[i] - moments[i - 1] < 60000) ms += moments[i] - moments[i - 1];
  return { chapters: out, keys: c.keys.length, ms, end: ch };
}

test('session stats count the words and bins a brute-force replay counts', () => {
  for (const seed of [1, 5, 9]) {
    const { sessions } = history({ seed, days: 5, scale: 30 });
    const doc = {};
    let before = {};
    let crossed = false;
    for (const s of sessions) {
      const st = R.playSession(s.text, doc);
      const b = brute(s.text, before);
      assert.equal(st.keys, b.keys);
      assert.equal(st.ms, b.ms);
      assert.equal(st.day, s.day);
      for (const [ch, c] of Object.entries(b.chapters)) {
        const got = st.chapters[ch];
        assert.ok(got, `seed ${seed}, ${s.id}: ${ch} is missing`);
        assert.deepEqual({ added: got.added, removed: got.removed, words: got.words, ins: got.ins, del: got.del }, c, `seed ${seed}, ${s.id}, ${ch}`);
        const startWords = [...bag(before[ch] || '').values()].reduce((x, y) => x + y, 0);
        if (R.binsFor(startWords) !== got.ins.length) crossed = true;
      }
      assert.deepEqual(Object.keys(st.chapters).sort(), Object.keys(b.chapters).sort());
      assert.deepEqual(str(doc), b.end);
      before = b.end;
    }
    if (seed === 9) assert.ok(crossed, 'a chapter grew past a bin-count threshold in a session');
  }
});

test('a chapter deleted in a session keeps its bins, counted at the size it went at', () => {
  const html = '<p>' + Array.from({ length: 9000 }, () => 'word').join(' ') + '</p>';
  const lines = [
    [0, 'b', 'ch-a', html, R.digest(html), 'baseline'],
    [10, 'k', 'KeyA', 0], [0, 'e', 3, 0, 'x', 'iT'],
    [10, 'd', 'ch-a', 'delete']
  ];
  const text = JSON.stringify({ neoRec: 1, session: 's', startedAt: '2026-11-01T09:00:00.000Z', day: '2026-11-01' }) + '\n' + lines.map((l) => JSON.stringify(l) + '\n').join('');
  const st = R.playSession(text, {});
  const c = st.chapters['ch-a'];
  assert.equal(c.gone, 'delete');
  assert.equal(c.ins.length, 90, '9,000 words: 90 bins');
  assert.equal(c.ins[0], 1);
  assert.equal(c.removed, 9000);
  assert.equal(c.added, 0, 'xword is a word that went with the rest');
});

test('notes, titles, the outline and stickies are streams: replayed and checked as chapters are, but nobody’s words and never searched', () => {
  const ch = '<p>Rain fell.</p>';
  const notes = '<p>Ideas</p>';
  const was = R.streamTexts({}, [])[':titles'];
  const now = R.streamTexts({ chapterTitles: { 'ch-a': 'Rain' } }, [])[':titles'];
  const sp = R.splice(was, now);
  const lines = [
    [0, 'b', 'ch-a', ch, R.digest(ch), 'baseline'],
    [0, 'b', ':notes', notes, R.digest(notes), 'baseline'],
    [10, 'k', 'KeyS', 0], [0, 'e', 8, 0, 's', 'iT'],
    [5, 'w', R.digest('<p>Ideas</p>'.replace('Ideas', 'Ideass'))],
    [0, 'b', ':titles', was, R.digest(was), 'baseline'],
    [10, 'x', 'edit'], [0, 'e', sp.at, sp.del, sp.ins],
    [5, 'w', R.digest(now)],
    [0, 'ch', 'ch-a'], [10, 'k', 'KeyA', 0], [0, 'e', 13, 0, ' again', 'iT'],
    [0, 'o', ['ch-a']]
  ];
  const text = JSON.stringify({ neoRec: 1, session: 's', startedAt: '2026-11-01T09:00:00.000Z', day: '2026-11-01' }) + '\n' + lines.map((l) => JSON.stringify(l) + '\n').join('');
  const r = R.replayCheck([text]);
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.writes, 2);
  assert.equal(r.chapters[':notes'], '<p>Ideass</p>');
  assert.equal(r.chapters[':titles'], now);
  const st = R.playSession(text, {});
  assert.deepEqual(Object.keys(st.chapters), ['ch-a'], 'the words are the chapters’');
  assert.deepEqual(st.streams.sort(), [':notes', ':titles']);
  assert.equal(st.keys, 2, 'a key in the notes is a key');
  assert.deepEqual(R.dayStats([st]).streams.sort(), [':notes', ':titles']);
  const tally = new R.PhraseTally('Ideass');
  assert.deepEqual(tally.set(':notes', R.paragraphs(r.chapters[':notes'])), [0, 0]);
  assert.equal(tally.total, 0, 'search looks in the chapters');
  const h = new R.History([{ id: 's', device: '', text }]);
  h.build({});
  assert.deepEqual(h.chapters().map((c) => c.ch), ['ch-a'], 'the player lists the chapters');
  assert.equal(h.state(h.steps.length)[':notes'], '<p>Ideass</p>', 'and plays the streams too');
});

test('a stream’s text is the same book whatever order its keys are in, without empty entries', () => {
  const a = R.streamTexts({ chapterTitles: { b: 'Two', a: 'One', c: '' }, sectionNotes: { x: [], y: [{ text: 'Storm', id: 's1' }] }, looseCards: [] }, [{ text: 'Tide', id: 's-1' }]);
  const b = R.streamTexts({ sectionNotes: { y: [{ id: 's1', text: 'Storm' }] }, chapterTitles: { a: 'One', b: 'Two' } }, [{ id: 's-1', text: 'Tide' }]);
  assert.deepEqual(a, b);
  assert.deepEqual(JSON.parse(a[':titles']), { a: 'One', b: 'Two' });
  assert.deepEqual(JSON.parse(a[':outline']), { sectionNotes: { y: [{ id: 's1', text: 'Storm' }] } });
  assert.ok(a[':titles'].split('\n').length > 2, 'an entry a line');
  assert.deepEqual(Object.keys(a).every(R.isStream), true);
  assert.ok(!R.isStream('ch-mur5yiiu-u1cv'));
});

test('day stats add up their sessions', () => {
  const { sessions } = history({ seed: 2, days: 6 });
  const doc = {};
  for (const day of byDay(sessions)) {
    const stats = day.sessions.map((s) => R.playSession(s.text, doc));
    const d = R.dayStats(stats);
    assert.equal(d.sessions, day.sessions.length);
    assert.equal(d.added, stats.reduce((n, s) => n + Object.values(s.chapters).reduce((a, c) => a + c.added, 0), 0));
    assert.equal(d.removed, stats.reduce((n, s) => n + Object.values(s.chapters).reduce((a, c) => a + c.removed, 0), 0));
    assert.equal(d.keys, stats.reduce((n, s) => n + s.keys, 0));
    assert.equal(d.ms, stats.reduce((n, s) => n + s.ms, 0));
    assert.deepEqual(d.chapters.sort(), [...new Set(stats.flatMap((s) => Object.keys(s.chapters)))].sort());
    assert.equal(d.start, stats[0].start);
  }
});

test('a session’s day is its header’s, or the date it began where it was written', () => {
  assert.equal(R.sessionDay({ day: '2026-11-03', startedAt: '2026-11-04T01:00:00.000Z' }), '2026-11-03', 'a session past midnight belongs to the night it began');
  assert.equal(R.sessionDay({ startedAt: '2026-11-04T01:00:00.000Z', tz: 'America/New_York' }), '2026-11-03');
  assert.equal(R.sessionDay({ startedAt: '2026-11-04T01:00:00.000Z', tz: 'Europe/Bucharest' }), '2026-11-04');
  assert.equal(R.sessionDay({ startedAt: '2026-11-04T01:00:00.000Z', tz: 'Not/AZone' }), '2026-11-04');
  assert.equal(R.sessionDay(null), null);
});

/* ---------- the days the cache keeps ---------- */

// The cache as the worker keeps it, in memory
function build(sessions) {
  const b = new R.DayBuilder();
  const entries = [];
  const files = {};
  for (const d of byDay(sessions)) {
    const { entry, file } = b.day(d.day, d.sessions);
    entries.push(entry);
    files[d.day] = JSON.parse(JSON.stringify(file));
  }
  return { entries: JSON.parse(JSON.stringify(entries)), files, builder: b };
}

test('a chapter rebuilt from its whole state and the diffs since is the state the replay reaches', () => {
  for (const seed of [1, 2, 3]) {
    const { sessions } = history({ seed, days: 14 });
    const { entries, files } = build(sessions);
    const days = byDay(sessions);
    let diffs = 0;
    let wholes = 0;
    for (const e of entries) for (const k of Object.values(e.kinds)) { if (k > 0) diffs++; else if (k === 0) wholes++; }
    assert.ok(diffs > 0 && wholes > 0, `days keep diffs and whole states (${diffs} diffs, ${wholes} whole)`);
    for (let n = 0; n <= days.length; n++) {
      const want = n ? days[n - 1].sessions[days[n - 1].sessions.length - 1].after : {};
      const read = [];
      const got = str(R.dayState(entries, n, (day) => { read.push(day); return files[day]; }));
      assert.deepEqual(got, want, `seed ${seed}: the start of day ${n}`);
      assert.ok(new Set(read).size === read.length, 'each file read once');
    }
  }
});

test('a day loaded from the cache plays to the same text as the whole history played from the start', () => {
  const { sessions } = history({ seed: 6, days: 9 });
  const { entries, files } = build(sessions);
  const whole = new R.History(sessions);
  whole.build();
  const days = byDay(sessions);
  days.forEach((d, i) => {
    const start = R.dayState(entries, i, (day) => files[day]);
    const h = new R.History(d.sessions);
    h.build(start, { every: 50 });
    assert.equal(h.bad.size, 0, d.day);
    const at = whole.sessions.find((s) => s.id === d.sessions[d.sessions.length - 1].id);
    assert.deepEqual(h.end, whole.state(at.to), d.day);
    // and any moment in it
    const mid = h.steps.length >> 1;
    const first = whole.sessions.find((s) => s.id === d.sessions[0].id);
    assert.deepEqual(h.state(mid), whole.state(first.from + mid));
  });
});

test('a builder picks up where a cache left off', () => {
  const { sessions } = history({ seed: 8, days: 10 });
  const all = build(sessions);
  const days = byDay(sessions);
  const half = build(sessions.filter((s) => s.day <= days[4].day));
  const b = R.DayBuilder.after(half.entries, (day) => half.files[day]);
  for (const d of days.slice(5)) {
    const { entry } = b.day(d.day, d.sessions);
    const want = all.entries.find((e) => e.day === d.day);
    assert.equal(entry.key, want.key);
    assert.deepEqual(JSON.parse(JSON.stringify(entry)), want);
  }
});

test('a session gone missing: the history plays up to it, and again from each chapter’s next anchor', () => {
  const { sessions } = longHistory();
  const gone = 3;
  const kept = sessions.filter((_, i) => i !== gone);
  const { entries, files } = build(kept);
  // before the gap, everything
  const before = byDay(kept).filter((d) => d.day < sessions[gone].day).length;
  assert.ok(sessions[gone - 1].day < sessions[gone].day, 'the missing session is the first of its day');
  assert.deepEqual(str(R.dayState(entries, before, (day) => files[day])), sessions[gone - 1].after);
  // after it, the chapters the missing session changed are lost until a full `b`
  const lost = new Set(entries.flatMap((e) => e.lost));
  assert.ok(lost.size > 0);
  const found = new Set();
  for (const s of kept.slice(gone)) {
    for (const line of R.parseSession(s.text).lines) if (line[1] === 'b' && line[3] !== null && lost.has(line[2])) found.add(line[2]);
  }
  const end = str(R.dayState(entries, entries.length, (day) => files[day]));
  const last = sessions[sessions.length - 1].after;
  for (const ch of Object.keys(last)) {
    if (!lost.has(ch) || found.has(ch)) assert.equal(end[ch], last[ch], `${ch} is back`);
    else assert.equal(end[ch], undefined, `${ch} has had no anchor yet`);
  }
  assert.ok(found.size > 0, 'an anchor brought one back');
});

test('a session whose chain is broken isn’t played: the chapters it names are lost', () => {
  const { sessions } = history({ seed: 3, days: 4 });
  const broken = sessions.map((s, i) => (i === 1 ? { ...s, text: s.text.replace(/"(rain|door|boat|river)/, '"$1s') } : s));
  assert.equal(R.verifyChain(broken[1].text).ok, false);
  const { entries } = build(broken);
  const day = entries.find((e) => e.sessions.some((s) => s.id === broken[1].id));
  const st = day.sessions.find((s) => s.id === broken[1].id).stats;
  assert.equal(st.damaged, true);
  assert.ok(st.lost.length > 0);
  for (const ch of st.lost) assert.ok(day.lost.includes(ch));
  // a later session that continues from where the broken one left a chapter can't follow it either
  assert.ok(day.lost.length >= st.lost.length);
});

/* ---------- the worker's cache on disk ---------- */

test('the worker builds each day once, picks up a new session, and tells a day’s start', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const zlib = require('node:zlib');
  const { BookDays } = require('../history-worker.js');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-days-'));
  try {
    const { sessions } = history({ seed: 11, days: 7 });
    const dir = path.join(root, 'recording', DEV);
    const days = () => new BookDays({ root: path.join(root, 'recording'), cache });
    const cache = path.join(root, 'cache');
    fs.mkdirSync(dir, { recursive: true });
    const close = (s) => fs.writeFileSync(path.join(dir, s.id + '.jsonl.gz'), zlib.gzipSync(s.text));
    const last = sessions.length - 1;
    sessions.slice(0, last - 1).forEach(close);
    // the one before last still open: a rollup and a chunk
    const open = sessions[last - 1];
    const lines = open.text.split('\n');
    const folder = path.join(dir, open.id);
    fs.mkdirSync(folder);
    const cut = lines.findIndex((l, i) => i > 20 && l.includes('"h"'));
    fs.writeFileSync(path.join(folder, `s-000001-${String(cut + 1).padStart(6, '0')}.jsonl.gz`), zlib.gzipSync(lines.slice(0, cut + 1).join('\n') + '\n'));
    fs.writeFileSync(path.join(folder, `c-${String(cut + 2).padStart(6, '0')}.jsonl`), lines.slice(cut + 1).join('\n'));

    const want = build(sessions.slice(0, last - 1));
    const a = days();
    const seen = [];
    const r = await a.build((entry, done, total) => seen.push([entry.day, done, total]));
    assert.deepEqual(JSON.parse(JSON.stringify(r.entries)), want.entries);
    assert.deepEqual(seen.map((x) => x[1]), want.entries.map((_, i) => i + 1));
    assert.equal(r.open.length, 1);
    assert.equal(r.open[0].id, open.id);
    const st = R.playSession(open.text, null, { page: R.pageState(want.entries, want.entries.length, (d) => want.files[d]), device: DEV });
    assert.deepEqual(r.open[0].stats, JSON.parse(JSON.stringify(st)), 'the open session’s stats, played on from the closed ones');

    // opened again: nothing is built twice, and the days the cache holds are told
    const b = days();
    const again = [];
    const kept = [];
    await b.build((entry) => again.push(entry.day), (entries, total) => kept.push([entries.map((e) => e.day), total]));
    assert.deepEqual(again, []);
    assert.equal(b.entries.length, want.entries.length);
    assert.deepEqual(kept, [[want.entries.map((e) => e.day), want.entries.length]]);
    // through the worker's messages, as the window hears them: the answer comes before the cache is read
    const { handle } = require('../history-worker.js');
    const news = [];
    const msg = { type: 'days', key: 'kept-' + Date.now(), root: path.join(root, 'recording'), cache };
    const answer = await handle(msg, (m) => news.push(m));
    while (!news.some((m) => m.type === 'built')) await new Promise((resolve) => setTimeout(resolve, 10));
    const heard = new Set([...answer.entries.map((e) => e.day), ...news.filter((m) => m.type === 'kept').flatMap((m) => m.entries.map((e) => e.day))]);
    assert.deepEqual([...heard].sort(), want.entries.map((e) => e.day), 'every day reaches the window');

    // the open session closes and another is written: only their days are built
    fs.rmSync(folder, { recursive: true });
    close(open);
    close(sessions[last]);
    const c = days();
    const built = [];
    const r2 = await c.build((entry) => built.push(entry.day));
    const all = build(sessions);
    assert.deepEqual(JSON.parse(JSON.stringify(r2.entries)), all.entries);
    assert.deepEqual(built, [...new Set([open.day, sessions[last].day])]);
    // each day starts where the one before ended
    for (const [i, d] of byDay(sessions).entries()) {
      const before = i ? byDay(sessions)[i - 1].sessions.slice(-1)[0].after : {};
      assert.deepEqual((await c.dayStart(d.day)).page, before, d.day);
      assert.deepEqual((await c.dayStart(d.day)).devices[DEV] || {}, before, d.day + ': the computer’s own copies');
    }
    assert.deepEqual((await c.dayStart('2099-01-01')).page, sessions[last].after, 'a day after the last starts where it ended');
    // a day file gone from the cache: built again
    fs.rmSync(c.dayFile(all.entries[2].day));
    const d = days();
    const rebuilt = [];
    await d.build((entry) => rebuilt.push(entry.day));
    assert.deepEqual(rebuilt, all.entries.slice(2).map((e) => e.day), 'from the day whose file went');
    assert.deepEqual(JSON.parse(JSON.stringify(d.entries)), all.entries);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

/* ---------- merging devices ---------- */

const DEV2 = 'd-fedcba9876543210'; // a second computer

test('two computers’ sessions play as one page: after every session it is the book as it was', () => {
  let syncs = 0;
  let quiet = 0;
  for (const seed of [1, 2, 3, 4, 5]) {
    const { sessions } = history({ seed, days: 14, devices: [DEV, DEV2] });
    assert.ok(sessions.some((s) => s.device === DEV2) && sessions.some((s) => s.device === DEV), 'both computers wrote');
    const h = new R.History(sessions);
    h.build();
    assert.equal(h.bad.size, 0, `seed ${seed}: every step plays on its own computer's copies`);
    sessions.forEach((s, i) => assert.deepEqual(h.state(h.sessions[i].to), s.after, `seed ${seed}, session ${i} (${s.device})`));
    // and each computer's own copies are where its recording left them
    const last = sessions[sessions.length - 1].known;
    for (const d of [DEV, DEV2]) assert.deepEqual(str(h.page.docs[d]), last[d], `seed ${seed}: ${d}'s copies`);
    syncs += h.steps.filter((s) => s.sync !== undefined).length;
    quiet += h.steps.filter((s) => s.page === false).length;
  }
  assert.ok(quiet > 0, 'catch-ups of the other computer’s text leave the page alone');
  assert.ok(syncs > 0, 'text changed while nothing recorded reaches the page where a catch-up ends');
});

test('the days of two computers: each starts where the one before ended, on the page and on each computer', () => {
  for (const seed of [1, 2, 3]) {
    const { sessions } = history({ seed, days: 14, devices: [DEV, DEV2] });
    const { entries, files } = build(sessions);
    const days = byDay(sessions);
    const kinds = new Set();
    for (const e of entries) for (const k of Object.values(e.devices)) for (const x of Object.values(k)) kinds.add(x === -2 ? 'page' : x === 0 ? 'whole' : x > 0 ? 'diff' : 'gone');
    assert.ok(kinds.has('page') && kinds.has('whole'), 'a computer’s copy is the page’s, or its own');
    for (let n = 0; n <= days.length; n++) {
      const end = n ? days[n - 1].sessions[days[n - 1].sessions.length - 1] : null;
      const read = (day) => files[day];
      assert.deepEqual(str(R.dayState(entries, n, read)), end ? end.after : {}, `seed ${seed}: the page as day ${n} began`);
      for (const d of [DEV, DEV2]) assert.deepEqual(str(R.dayState(entries, n, read, d)), end ? end.known[d] : {}, `seed ${seed}: ${d} as day ${n} began`);
    }
  }
});

test('a day of two computers loaded from the cache plays to the page the whole history reaches', () => {
  const { sessions } = history({ seed: 7, days: 12, devices: [DEV, DEV2] });
  const { entries, files } = build(sessions);
  const whole = new R.History(sessions);
  whole.build();
  byDay(sessions).forEach((d, i) => {
    const h = new R.History(d.sessions);
    h.build(R.pageState(entries, i, (day) => files[day]), { every: 50 });
    assert.equal(h.bad.size, 0, d.day);
    const at = whole.sessions.find((s) => s.id === d.sessions[d.sessions.length - 1].id);
    assert.deepEqual(h.end, whole.state(at.to), d.day);
    const first = whole.sessions.find((s) => s.id === d.sessions[0].id);
    for (const n of [1, h.steps.length >> 2, h.steps.length >> 1]) assert.deepEqual(h.state(n), whole.state(first.from + n), `${d.day}, step ${n}`);
  });
  // a builder carries on from the cache, both computers' copies with it
  const half = build(sessions.filter((s) => s.day <= byDay(sessions)[5].day));
  const b = R.DayBuilder.after(half.entries, (day) => half.files[day]);
  for (const d of byDay(sessions).slice(6)) {
    const { entry } = b.day(d.day, d.sessions);
    assert.deepEqual(JSON.parse(JSON.stringify(entry)), entries.find((e) => e.day === d.day));
  }
});

test('the worker builds two computers’ days as one, with a session one left open', async () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const zlib = require('node:zlib');
  const { BookDays } = require('../history-worker.js');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-merge-'));
  try {
    const { sessions } = history({ seed: 2, days: 10, devices: [DEV, DEV2] });
    const rdir = path.join(root, 'recording');
    const put = (s, open) => {
      const dir = path.join(rdir, s.device);
      fs.mkdirSync(dir, { recursive: true });
      if (!open) { fs.writeFileSync(path.join(dir, s.id + '.jsonl.gz'), zlib.gzipSync(s.text)); return; }
      fs.mkdirSync(path.join(dir, s.id), { recursive: true });
      fs.writeFileSync(path.join(dir, s.id, 'c-000001.jsonl'), s.text);
    };
    // the second computer stopped with a session open days ago; the last session is still being written
    const stale = sessions.findIndex((s, i) => s.device === DEV2 && i < sessions.length - 3);
    assert.ok(stale >= 0);
    const last = sessions.length - 1;
    sessions.forEach((s, i) => put(s, i === stale || i === last));
    const d = new BookDays({ root: rdir, cache: path.join(root, 'cache') });
    const r = await d.build();
    const want = build(sessions.slice(0, last));
    assert.deepEqual(JSON.parse(JSON.stringify(r.entries)), want.entries, 'the open session days ago is built with its day');
    assert.deepEqual(r.open.map((o) => [o.id, o.device]), [[sessions[last].id, sessions[last].device]], 'the one being written is played on');
    for (const [i, day] of byDay(sessions).entries()) {
      const before = i ? byDay(sessions)[i - 1].sessions.slice(-1)[0] : null;
      const start = await d.dayStart(day.day);
      assert.deepEqual(start.page, before ? before.after : {}, day.day);
      // the window plays the day from what the worker sends
      const h = new R.History(day.sessions);
      h.build(start);
      assert.equal(h.bad.size, 0, day.day);
      assert.deepEqual(h.end, day.sessions.slice(-1)[0].after, day.day);
    }
    assert.deepEqual((await d.dayStart('2099-01-01')).page, sessions[last].after, 'a day after the last plays the open session on');
    // the stale session closes, crashed, when its computer opens the book again: its day is built again
    const s = sessions[stale];
    fs.rmSync(path.join(rdir, s.device, s.id), { recursive: true });
    const closed = R.appendLines(s.text, [[0, 'end', { crashed: true }]]);
    fs.writeFileSync(path.join(rdir, s.device, s.id + '.jsonl.gz'), zlib.gzipSync(closed));
    const again = [];
    await new BookDays({ root: rdir, cache: path.join(root, 'cache') }).build((entry) => again.push(entry.day));
    assert.equal(again[0], s.day, 'from the day of the session that closed');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// Sessions on two computers written by hand: `steps` are [device, day,
// hour, lines] with lines as the recorder writes them (no dt)
function written(steps) {
  const prev = {};
  return steps.map(([device, day, hour, lines], k) => {
    const id = `${day}T${pad(hour)}-00-00Z-hand${k}`;
    const w = new R.SessionWriter({ neoRec: 1, session: id, device, book: 'b', day, startedAt: `${day}T${pad(hour)}:00:00.000Z`, tz: 'UTC', prev: prev[device] || null });
    let wait = 0; // a number among the lines: that many ms before the next
    for (const l of lines) {
      if (typeof l === 'number') { wait += l; continue; }
      w.push([(l[0] === 'e' && l.length > 4 ? 120 : 0) + wait, ...l]);
      wait = 0;
    }
    w.push([100, 'end', {}]);
    w.chunk();
    prev[device] = w.H;
    return { id, device, day, text: w.lines.join('\n') + '\n' };
  });
}

// typing `text` at `at`, a key at a time
const typed = (at, text) => [...text].map((c, i) => ['e', at + i, 0, c, 'iT']);

test('both computers changed a chapter: the page takes the second’s copy, a sync, and the other’s is kept beside it', () => {
  const p = (s) => `<p>${s}</p>`;
  const one = p('One. Two');
  const sessions = written([
    // the first computer writes; the second, synced, carries on
    [DEV, '2026-12-01', 9, [['b', 'ch-a', p('One.'), R.digest(p('One.')), 'baseline'], ...typed(7, ' Two')]],
    [DEV2, '2026-12-01', 15, [['b', 'ch-a', one, R.digest(one), 'baseline'], ...typed(11, ' Three')]],
    // both open, apart: the first catches up and adds Four; the second, offline, adds Five,
    // then finds the first's copy on disk and keeps it beside its own
    [DEV, '2026-12-02', 9, [['b', 'ch-a', null, R.digest(one), 'continue'], ['x', 'catch-up'], ['e', 11, 0, ' Three'], ...typed(17, ' Four')]],
    [DEV2, '2026-12-02', 10, [['b', 'ch-a', null, R.digest(p('One. Two Three')), 'continue'], ...typed(17, ' Five'),
      ['x', 'disk-twin'], ['b', 'ch-t', p('One. Two Three Four'), R.digest(p('One. Two Three Four')), 'disk-twin'], ['o', ['ch-a', 'ch-t']]]],
    // the first, open again, adds Six; the second adopts that copy and adds Seven
    [DEV, '2026-12-03', 9, [['b', 'ch-a', null, R.digest(p('One. Two Three Four')), 'continue'], ['x', 'catch-up'], ['e', 17, 5, ' Five'], ...typed(22, ' Six')]],
    [DEV2, '2026-12-03', 10, [['b', 'ch-a', null, R.digest(p('One. Two Three Five')), 'continue'], ['x', 'disk-adopt'], ['e', 22, 0, ' Six'], ...typed(26, ' Seven')]]
  ]);
  const h = new R.History(sessions);
  h.build();
  assert.equal(h.bad.size, 0);
  const at = (i) => h.state(h.sessions[i].to);
  assert.deepEqual(at(1), { 'ch-a': p('One. Two Three') }, 'the second computer carries on from the page, no sync');
  assert.deepEqual(at(2), { 'ch-a': p('One. Two Three Four') });
  assert.deepEqual(at(3), { 'ch-a': p('One. Two Three Five'), 'ch-t': p('One. Two Three Four') }, 'the second computer’s copy, and the first’s beside it');
  assert.deepEqual(at(5), { 'ch-a': p('One. Two Three Five Six Seven'), 'ch-t': p('One. Two Three Four') });
  // one sync: the second computer's `continue` on day 2, where its own copy isn't the page
  const syncs = h.steps.map((s, i) => [s, i]).filter(([s]) => s.sync !== undefined);
  assert.equal(syncs.length, 1);
  const [s, i] = syncs[0];
  assert.equal(h.sessions[s.session].device, DEV2);
  assert.deepEqual([s.k, s.cause], ['b', 'continue']);
  assert.equal(s.sync, p('One. Two Three'));
  assert.equal(h.state(i)['ch-a'], p('One. Two Three Four'));
  assert.equal(h.state(i + 1)['ch-a'], p('One. Two Three'));
  assert.equal(h.state(i + 3)['ch-a'], p('One. Two Three F'), 'and its keys play on it');
  // catch-ups and adoptions of the other's text leave the page; they're nobody's words
  assert.ok(h.steps.filter((x) => x.page === false).every((x) => x.cause === 'catch-up' || x.cause === 'disk-adopt' || x.cause === 'baseline' || x.cause === 'continue'));
  const { entries, files } = build(sessions);
  const seven = entries[2].sessions[1].stats.chapters['ch-a'];
  assert.deepEqual([seven.added, seven.removed], [1, 0], 'only Seven is the second computer’s word on day 3');
  assert.deepEqual(str(R.dayState(entries, 3, (d) => files[d])), at(5));
  assert.equal(entries[1].links['ch-t'], DEV2);
});

test('NEO left open on one computer while the other writes: their lines play in the order they were written', async () => {
  const p = (s) => `<p>${s}</p>`;
  const H = 3600000;
  const sessions = written([
    // open from nine, Two typed, then away; at eleven it adopts the other's copy and adds Four
    [DEV, '2026-12-05', 9, [['b', 'ch-a', p('One.'), R.digest(p('One.')), 'baseline'], ...typed(7, ' Two'),
      2 * H, ['x', 'disk-adopt'], ['e', 11, 0, ' Three'], ...typed(17, ' Four')]],
    // at ten, on the other computer: Three
    [DEV2, '2026-12-05', 10, [['b', 'ch-a', p('One. Two'), R.digest(p('One. Two')), 'baseline'], ...typed(11, ' Three')]]
  ]);
  const h = new R.History(sessions);
  h.build();
  assert.equal(h.bad.size, 0);
  assert.deepEqual(h.end, { 'ch-a': p('One. Two Three Four') });
  assert.ok(h.sessions[1].from > h.sessions[0].from && h.sessions[1].to < h.sessions[0].to, 'the second session plays inside the first');
  assert.ok(h.sessions[1].t0 > h.sessions[0].t0 && h.sessions[1].t1 < h.sessions[0].t1, 'and on the clock');
  // the page never goes back: once a word is on it, it stays
  let had = '';
  for (let n = 0; n <= h.steps.length; n++) {
    const now = h.state(n)['ch-a'] || '';
    assert.ok(R.textOf(now).startsWith(R.textOf(had).replace(/\s+$/, '')), `step ${n}: ${had} → ${now}`);
    had = now;
  }
  assert.equal(h.steps.filter((s) => s.sync !== undefined).length, 0, 'no sync: each carried on from the page');
  // the cache's day and search see it the same way
  const { entries, files } = build(sessions);
  assert.deepEqual(str(R.dayState(entries, 1, (d) => files[d])), h.end);
  assert.deepEqual(entries[0].sessions[0].stats.chapters['ch-a'].added, 2, 'Two and Four are the first computer’s');
  const found = await workerSearch(sessions, ['Three']);
  const want = bruteSearch(sessions, 'Three');
  assert.equal(found.Three.both.first.day, '2026-12-05');
  const m = momentOf(sessions, entries, files, want.whole, 'first', { day: '2026-12-05', phrase: 'Three' });
  assert.deepEqual(m, { ch: want.first.ch, step: want.first.step });
  assert.equal(h.sessions[h.steps[m.step].session].device, DEV2, 'Three was first written on the second computer');
});

test('search across two computers finds what a brute-force replay of the page does, to the step', async () => {
  const seen = { first: 0, last: 0, out: 0, moved: 0 };
  for (const seed of [3, 6]) {
    const { sessions } = history({ seed, days: 12, devices: [DEV, DEV2] });
    const { entries, files } = build(sessions);
    const phrases = ['John', 'Ivo', 'quiet boat', 'Written elsewhere'];
    const found = await workerSearch(sessions, phrases);
    for (const phrase of phrases) {
      const want = bruteSearch(sessions, phrase);
      const got = found[phrase].both;
      const where = `seed ${seed}, "${phrase}"`;
      assert.equal(got.total, want.total, where);
      assert.deepEqual(got.now, want.now, where);
      for (const kind of ['first', 'last', 'out']) {
        const w = want[kind];
        assert.equal(got[kind] ? got[kind].day : null, w ? w.day : null, `${where}: ${kind} written, the day`);
        if (!w) continue;
        seen[kind]++;
        const m = momentOf(sessions, entries, files, want.whole, kind, { day: got[kind].day, phrase });
        assert.deepEqual(m, { ch: w.ch, step: w.step }, `${where}: ${kind} written, the moment`);
      }
      const key = (m) => m.day + ' ' + m.from;
      assert.deepEqual(got.moved.map(key).sort(), want.moved.map(key).sort(), where + ': moved');
      seen.moved += got.moved.length;
    }
  }
  for (const kind of ['first', 'last']) assert.ok(seen[kind] > 0, `a ${kind} to find`);
});

/* ---------- skipping by session ---------- */

test('a skip from a day’s first session lands on the previous day’s last (or its last that changed the chapter), with the text there', () => {
  const { sessions } = history({ seed: 12, days: 8 });
  const { entries, files } = build(sessions);
  const flat = entries.flatMap((e) => e.sessions.map((s) => ({ ...s, day: e.day })));
  const whole = new R.History(sessions);
  whole.build();
  const startOf = (i) => whole.state(whole.sessions[i].from);
  for (let di = 1; di < entries.length; di++) {
    const first = flat.findIndex((s) => s.day === entries[di].day);
    // from inside the session: its own start; from its start: the day before's last
    assert.equal(R.sessionSkip(flat, first, -1), first);
    const to = R.sessionSkip(flat, first, -1, { atStart: true });
    assert.equal(to, first - 1);
    assert.equal(flat[to].day, entries[di - 1].day);
    // that day's player, from the cache, reaches the same text at that session's start
    const h = new R.History(byDay(sessions)[di - 1].sessions);
    h.build(R.dayState(entries, di - 1, (d) => files[d]));
    const k = h.sessions.findIndex((s) => s.id === flat[to].id);
    assert.deepEqual(h.state(h.sessions[k].from), startOf(to));
    // with a chapter: only sessions that changed it
    const ch = 'ch-a';
    const back = R.sessionSkip(flat, first, -1, { ch, atStart: true });
    const want = flat.slice(0, first).map((s, i) => (s.stats.chapters[ch] ? i : -1)).filter((i) => i >= 0).pop();
    assert.equal(back, want === undefined ? -1 : want);
    const fwd = R.sessionSkip(flat, first, 1, { ch });
    const wantF = flat.map((s, i) => (i > first && s.stats.chapters[ch] ? i : -1)).find((i) => i >= 0);
    assert.equal(fwd, wantF === undefined ? -1 : wantF);
  }
  assert.equal(R.sessionSkip(flat, 0, -1, { atStart: true }), -1);
  assert.equal(R.sessionSkip(flat, flat.length - 1, 1), -1);
});

/* ---------- search ---------- */

test('search folds case, accents, quotes and spaces, and matches whole words', () => {
  assert.equal(R.normText('He said  “John’s BOAT”'), 'he said "john\'s boat"');
  assert.equal(R.normText('Café'), R.normText('Café'));
  const s = R.normText('John, Johnson and John\'s boat; johns. JOHN');
  assert.deepEqual(R.phraseIn(s, 'john'), [0, 18, 38]);
  assert.deepEqual(R.phraseIn(s, R.normText('John’s boat')), [18]);
  assert.deepEqual(R.phraseIn('aaaa', 'aa'), [], 'inside a word is no match');
  assert.deepEqual(R.phraseIn('— —', '—'), [0, 2], 'a phrase of no letters matches anywhere');
  // where each folded character came from, for drawing a match on the page
  const m = R.normMap('A  Café ’x');
  assert.equal(m.s, 'a café \'x');
  const at = m.s.indexOf('café');
  assert.equal(m.from[at], 3);
  assert.equal(m.to[at + 3], 8, 'the accent goes with its letter');
  // what search tests and what the page is marked from are folded alike
  for (const x of ['ΟΔΟΣ οδός ΟΔΟΣ.', 'Café\tCAFÉ\n\n “Ivo’s” İstanbul', 'Straße STRASSE', '́ leading mark', 'a  b']) {
    assert.equal(R.normText(x), R.normMap(x).s, JSON.stringify(x));
  }
});

test('search can match in the same case, and inside words', () => {
  assert.deepEqual(R.phraseQuery('  John’s '), { q: 'john\'s', word: true, cs: false }, 'a string: whole words, any case');
  assert.deepEqual(R.phraseQuery({ text: 'John', cs: true, word: false }), { q: 'John', word: false, cs: true });
  assert.equal(R.normText('He said “ΟΔΟΣ”', true), 'He said "ΟΔΟΣ"');
  const text = 'John, Johnson and john\'s boat. JOHN';
  const s = R.normText(text, true);
  assert.deepEqual(R.phraseIn(s, 'John'), [0], 'the same case only');
  assert.deepEqual(R.phraseIn(s, 'John', false), [0, 6], 'and inside a word');
  assert.deepEqual(R.phraseIn(R.normText(text), 'john', false), [0, 6, 18, 31]);
  assert.deepEqual(R.phraseIn('aaaa', 'aa', false), [0, 2], 'never overlapping');
  for (const x of ['ΟΔΟΣ οδός', 'Café\tCAFÉ “Ivo’s”', 'Straße STRASSE']) {
    assert.equal(R.normText(x, true), R.normMap(x, true).s, JSON.stringify(x));
  }
  const tally = new R.PhraseTally({ text: 'Rain', cs: true, word: false });
  tally.set('c', R.paragraphs('<p>Rain, rainbows. Rainbows.</p><p>RAIN</p>'));
  assert.equal(tally.total, 2);
  const loose = new R.PhraseTally({ text: 'rain', word: false });
  loose.set('c', R.paragraphs('<p>Rain, rainbows. Rainbows.</p><p>RAIN</p>'));
  assert.equal(loose.total, 4);
});

test('a tally kept a paragraph at a time counts what counting the whole chapter counts', () => {
  const { sessions } = history({ seed: 3, days: 6 });
  const whole = new R.History(sessions);
  whole.build();
  for (const phrase of ['John', 'the rain', 'Ivo']) {
    const tally = new R.PhraseTally(phrase);
    const doc = {};
    whole.steps.forEach((s, i) => {
      whole.apply(doc, i);
      if (!s.ch || !(s.k === 'b' || s.k === 'e' || s.k === 'd')) return;
      tally.set(s.ch, doc[s.ch] ? doc[s.ch].parts : null);
      if (i % 7) return;
      for (const ch of Object.keys(doc)) assert.equal(tally.of(ch), brutalCount(doc[ch].toString(), phrase), `${phrase}, step ${i}, ${ch}`);
    });
  }
});

// how often a phrase is in a chapter, counted over its whole text
function brutalCount(html, phrase) {
  const q = R.normText(phrase).trim();
  return R.textOf(html).split('\n').reduce((n, line) => n + R.phraseIn(R.normText(line), q).length, 0);
}

// Search by brute force: the whole history played as strings from the
// start, each chapter counted whole at each of its writes, at each `b`
// that sets it whole, and at every session's end, and the findings read
// from those looks
function bruteSearch(sessions, phrase) {
  const whole = new R.History(sessions);
  whole.build();
  const doc = {};
  const live = {};
  const saved = {};
  const changes = {};
  const events = [];
  let total = 0;
  const look = (ch, n, si) => {
    const was = saved[ch] || 0;
    const now = live[ch] || 0;
    const cs = changes[ch] || [];
    delete changes[ch];
    if (now === was) return;
    let step = -1;
    for (let k = cs.length - 1; k >= 0; k--) {
      const [i, b, a] = cs[k];
      if (now > was ? b < now && a >= now : b > now && a <= now) { step = i; break; }
    }
    saved[ch] = now;
    // looks with no change between them are one moment, its counts shared
    const prev = events[events.length - 1];
    const e = { n, ch, was, now, before: total, after: total + now - was, step, day: whole.sessions[si].day, version };
    if (prev && prev.version === version) {
      e.before = prev.before;
      for (const x of events) if (x.version === version) x.after = e.after;
    }
    events.push(e);
    total += now - was;
  };
  let version = 0;
  const sessionOf = (x) => whole.sessions.findIndex((s) => x >= s.from && x < s.to);
  let wi = 0;
  const dayStart = {};
  const lookAt = (n) => {
    while (wi < whole.writes.length && whole.writes[wi].n <= n) { const w = whole.writes[wi++]; look(w.ch, w.n, sessionOf(w.n - 1)); }
    const si = whole.sessions.findIndex((s) => s.to === n);
    if (si >= 0) for (const ch of new Set([...Object.keys(live), ...Object.keys(saved)])) look(ch, n, si);
  };
  whole.steps.forEach((s, i) => {
    lookAt(i);
    if (s.k === 'session') { const d = whole.sessions[s.session].day; if (!(d in dayStart)) dayStart[d] = total; }
    // the page: a step another device's copy took that the page didn't go with changes nothing
    if (!(s.k === 'b' || s.k === 'e' || s.k === 'd') || (s.page === false && s.sync === undefined)) return;
    if (s.sync !== undefined) doc[s.ch] = s.sync;
    if (s.page !== false) {
      if (s.k === 'b' && typeof s.html === 'string') doc[s.ch] = s.html;
      else if (s.k === 'e') doc[s.ch] = R.applyEdit(doc[s.ch], s.at, s.del, s.ins);
      else if (s.k === 'd') delete doc[s.ch];
      else if (s.sync === undefined) return; // a continue: nothing changed
    }
    version++;
    const now = doc[s.ch] === undefined ? 0 : brutalCount(doc[s.ch], phrase);
    const b = live[s.ch] || 0;
    live[s.ch] = now;
    if (now !== b) (changes[s.ch] = changes[s.ch] || []).push([i, b, now]);
    if (s.k === 'b' && typeof s.html === 'string') look(s.ch, i + 1, s.session); // a chapter recorded whole
  });
  lookAt(whole.steps.length);
  const first = events.find((e) => e.before === 0 && e.after > 0 && e.now > e.was) || null;
  let last = null;
  for (const e of events) if (e.after > e.before && e.after > dayStart[e.day] && e.now > e.was) last = e;
  let out = null;
  if (first && !total) for (const e of events) if (e.before > 0 && e.after === 0 && e.now < e.was) out = e;
  // moved: the chapters' counts as each day ended
  const moved = [];
  const days = [...new Set(whole.sessions.map((s) => s.day))];
  let prev = {};
  for (const day of days) {
    const lastS = whole.sessions.filter((s) => s.day === day).pop();
    const end = {};
    for (const e of events) if (e.n <= lastS.to) end[e.ch] = e.now;
    const fell = Object.keys({ ...prev, ...end }).filter((ch) => (end[ch] || 0) < (prev[ch] || 0));
    const rose = Object.keys(end).filter((ch) => (end[ch] || 0) > (prev[ch] || 0));
    for (const f of fell) if (rose.some((ch) => ch !== f)) moved.push({ day, from: f, rose });
    prev = end;
  }
  const now = {};
  for (const [ch, n] of Object.entries(saved)) if (n) now[ch] = n;
  return { whole, first, last, out, moved, total, now };
}

// The moment a finding lands on, as the dialog finds it: that day played
// from the cache, its events, the one the finding means, as a step of the
// whole history
function momentOf(sessions, entries, files, whole, kind, f) {
  const days = byDay(sessions);
  const di = days.findIndex((d) => d.day === f.day);
  const h = new R.History(days[di].sessions);
  h.build(R.pageState(entries, di, (d) => files[d]));
  const ev = R.phraseEvents(h, f.phrase);
  const e = R.phrasePick(ev.events, ev.start, kind, f.to);
  if (!e) return null;
  const k = h.steps[e.step].session;
  const g = whole.sessions.findIndex((s) => s.id === h.sessions[k].id);
  return { ch: e.ch, step: whole.sessions[g].from + (e.step - h.sessions[k].from) };
}

async function workerSearch(sessions, phrases) {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const zlib = require('node:zlib');
  const { BookDays } = require('../history-worker.js');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-search-'));
  try {
    for (const s of sessions) {
      const dir = path.join(root, 'recording', s.device || DEV);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, s.id + '.jsonl.gz'), zlib.gzipSync(s.text));
    }
    const d = new BookDays({ root: path.join(root, 'recording'), cache: path.join(root, 'cache') });
    await d.build();
    const out = {};
    for (const phrase of phrases) {
      const first = await d.searchFirst(phrase);
      const r = await d.searchWithin(phrase, first.findings, () => false, () => {});
      out[phrase] = { first: first.findings, both: r.findings, finished: r.finished };
    }
    return out;
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('search finds first written, last written, written out and moved where a brute-force replay does, to the step', async () => {
  const seen = { first: 0, last: 0, out: 0, moved: 0 };
  for (const seed of [2, 5, 9]) {
    const { sessions } = history({ seed, days: 10 });
    const { entries, files } = build(sessions);
    const phrases = ['John', 'Ivo', 'quiet boat', 'river'];
    const found = await workerSearch(sessions, phrases);
    for (const phrase of phrases) {
      const want = bruteSearch(sessions, phrase);
      const got = found[phrase].both;
      const where = `seed ${seed}, "${phrase}"`;
      assert.ok(found[phrase].finished, where);
      assert.equal(got.total, want.total, where + ': how often it is in the book now');
      assert.deepEqual(got.now, want.now, where);
      for (const kind of ['first', 'last', 'out']) {
        const w = want[kind];
        assert.equal(got[kind] ? got[kind].day : null, w ? w.day : null, `${where}: ${kind} written, the day`);
        if (!w) continue;
        seen[kind]++;
        const m = momentOf(sessions, entries, files, want.whole, kind, { day: got[kind].day, phrase });
        assert.deepEqual(m, { ch: w.ch, step: w.step }, `${where}: ${kind} written, the moment`);
      }
      const key = (m) => m.day + ' ' + m.from;
      assert.deepEqual(got.moved.map(key).sort(), want.moved.map(key).sort(), where + ': moved');
      for (const mv of got.moved) {
        seen.moved++;
        assert.ok(want.moved.find((x) => key(x) === key(mv)).rose.includes(mv.to), `${where}: moved on ${mv.day} into a chapter it came into`);
        const m = momentOf(sessions, entries, files, want.whole, 'moved', { day: mv.day, phrase, to: mv.to });
        assert.ok(m && m.ch === mv.to, `${where}: moved on ${mv.day} has a moment in ${mv.to}`);
      }
    }
  }
  for (const [kind, n] of Object.entries(seen)) assert.ok(n > 0, `the generated histories have a ${kind} to find`);
});

// Sessions that take a chapter through the states given, a write after
// each; the first session of all starts the chapter from its first state
function scripted(days) {
  const sessions = [];
  let prev = null;
  let known;
  days.forEach((states, d) => {
    const day = `2026-12-${pad(d + 1)}`;
    const id = `${day}T09-00-00Z-scrip${d}`;
    const w = new R.SessionWriter({ neoRec: 1, session: id, device: 'd-0', book: 'b', day, startedAt: `${day}T09:00:00.000Z`, tz: 'UTC', prev });
    let html = known === undefined ? states[0] : known;
    for (const line of R.baseLines('ch-a', html, known, 0)) w.push([0, ...line]);
    for (const next of states) {
      // an insertion typed a key at a time, anything else in one go
      for (const sp of R.splices(html, next)) {
        if (sp.del || /[<&]/.test(sp.ins)) w.push([300, 'e', sp.at, sp.del, sp.ins, 'iT']);
        else [...sp.ins].forEach((c, k) => w.push([120, 'e', sp.at + k, 0, c, 'iT']));
      }
      html = next;
      w.push([0, 'w', R.digest(html), 'ch-a']);
      w.chunk();
    }
    w.push([100, 'end', {}]);
    w.chunk();
    known = html;
    prev = w.H;
    sessions.push({ id, device: DEV, day, text: w.lines.join('\n') + '\n' });
  });
  return sessions;
}

test('a phrase that came and went inside one day is found by looking inside the days', async () => {
  const sessions = scripted([
    ['<p>The rain.</p>', '<p>The rain. Zed</p>', '<p>The rain.</p>'],                   // came and went
    ['<p>The rain.</p>', '<p>The rain. Zed came.</p>'],                                   // the first a day ended with
    ['<p>The rain. Zed came.</p>', '<p>The rain. Zed came. Zed</p>', '<p>The rain. Zed came.</p>'], // another, gone again
    ['<p>The rain. Zed came.</p>', '<p>The rain. Zedekiah came.</p>']                    // only a longer name
  ]);
  const found = await workerSearch(sessions, ['Zed']);
  const { first, both } = found.Zed;
  assert.equal(first.first.day, '2026-12-02', 'the day states see only the second day');
  assert.equal(first.out.day, '2026-12-04');
  assert.equal(both.first.day, '2026-12-01', 'looking inside the days finds the first');
  assert.equal(both.last.day, '2026-12-03', 'and the last');
  assert.equal(both.out.day, '2026-12-04');
  const want = bruteSearch(sessions, 'Zed');
  const { entries, files } = build(sessions);
  for (const kind of ['first', 'last', 'out']) {
    assert.equal(both[kind].day, want[kind].day, kind);
    const m = momentOf(sessions, entries, files, want.whole, kind, { day: both[kind].day, phrase: 'Zed' });
    assert.deepEqual(m, { ch: want[kind].ch, step: want[kind].step }, kind);
  }
});

test('a name passed through while typing a longer one is never the moment', () => {
  // typed a key at a time between two writes: "John" is there at the n of "Johnson"
  const sessions = scripted([['<p>A.</p>', '<p>A. Johnson met John</p>']]);
  const h = new R.History(sessions);
  h.build();
  const ev = R.phraseEvents(h, 'John');
  const e = R.phrasePick(ev.events, ev.start, 'first');
  assert.equal(h.state(e.step)['ch-a'], '<p>A. Johnson met Joh</p>');
  assert.equal(h.state(e.step + 1)['ch-a'], '<p>A. Johnson met John</p>');
  const want = bruteSearch(sessions, 'John');
  assert.equal(e.step, want.first.step);
});

test('a part of a chapter is carried through splices, and only a change to it counts', () => {
  const html = '<p>One.</p><p>Two.</p><p>Three.</p>';
  const two = () => ({ ch: 'ch-a', a: 11, b: 22 });
  assert.equal(html.slice(11, 22), '<p>Two.</p>');
  // a splice and its text, forward and back, against the strings themselves
  const check = (at, del, ins, hit) => {
    const after = R.applyEdit(html, at, del, ins);
    const f = two();
    assert.equal(R.partSplices(f, [{ at, del, ins }], 1), hit, `forward ${at} ${del} ${ins}`);
    if (!hit) {
      assert.equal(after.slice(f.a, f.b), '<p>Two.</p>');
      const b = { ...f };
      assert.equal(R.partSplices(b, [{ at, del, ins }], -1), false, `back ${at} ${del} ${ins}`);
      assert.deepEqual([b.a, b.b], [11, 22]);
    }
    return f;
  };
  check(7, 0, ' more', false);                   // in One
  check(28, 0, ' more', false);                  // in Three
  check(17, 0, ' and', true);                    // in Two
  check(7, 7, '', true);                         // One's </p><p>: joined to it
  assert.deepEqual(check(11, 11, '', true), { ch: 'ch-a', a: 11, b: 11, gone: true }, 'taken out, it holds nothing');
  check(18, 0, '</p><p>New', false);             // Enter at its end
  check(14, 0, 'New</p><p>', false);             // Enter at its start
  check(16, 0, '</p><p>', true);                 // Enter in the middle splits it
});

test('the changes to a part come in bouts: the next and previous each end where the writer went elsewhere', () => {
  const sessions = scripted([
    ['<p>One.</p><p>Two.</p><p>Three.</p>',
      '<p>One.</p><p>Two and more.</p><p>Three.</p>',          // bout 1, in Two
      '<p>One more.</p><p>Two and more.</p><p>Three.</p>',     // elsewhere
      '<p>One more.</p><p>Two and more again.</p><p>Three.</p>', // bout 2
      '<p>One more.</p><p>New</p><p>Two and more again.</p><p>Three.</p>'], // a paragraph before it: not a change
    ['<p>One more.</p><p>New</p><p>Two and more again.</p><p>Three.</p>',
      '<p>One more.</p><p>New</p><p>Two, again.</p><p>Three.</p>'] // the next day: bout 3
  ]);
  const h = new R.History(sessions);
  h.build();
  const twoAt = (n, part) => h.state(n)['ch-a'].slice(part.a, part.b);
  const first = h.steps.findIndex((s) => s.k === 'b') + 1;
  const start = { ch: 'ch-a', a: 11, b: 22 };
  assert.equal(twoAt(first, start), '<p>Two.</p>');
  const stops = [];
  let at = { n: first, part: start };
  while ((at = R.partNext(h, { ...at.part }, at.n))) stops.push(at);
  assert.deepEqual(stops.map((x) => twoAt(x.n, x.part)), ['<p>Two and more.</p>', '<p>Two and more again.</p>', '<p>Two, again.</p>']);
  // each bout ends just before the next change elsewhere, or with its session
  assert.equal(h.state(stops[0].n + 1)['ch-a'], '<p>One .</p><p>Two and more.</p><p>Three.</p>');
  // and back from the last, the same stops, then the baseline
  const back = [];
  at = stops[2];
  while ((at = R.partPrev(h, { ...at.part }, at.n))) back.push(at);
  assert.deepEqual(back.map((x) => twoAt(x.n, x.part)), ['<p>Two and more again.</p>', '<p>Two and more.</p>', '<p>Two.</p>']);
  assert.equal(back[2].n, first);
  // from inside a bout: next is where it ends, previous the one before it
  const mid = stops[1].n - 3;
  const inside = R.partMove(h, { ...stops[1].part }, stops[1].n, mid);
  assert.equal(R.partNext(h, { ...inside }, mid).n, stops[1].n);
  assert.equal(R.partPrev(h, { ...inside }, mid).n, stops[0].n);
  // carried along, the part is the paragraph wherever it is
  const end = R.partMove(h, { ...start }, first, h.steps.length);
  assert.equal(twoAt(h.steps.length, end), '<p>Two, again.</p>');
  assert.deepEqual(R.partMove(h, end, h.steps.length, first), start);
});

test('a paragraph goes back as far as it was first written, and on as far as it was deleted', () => {
  const sessions = scripted([
    ['<p>One.</p>',
      '<p>One.</p><p>Two</p>',                    // Enter and typed: Two is written
      '<p>One more.</p><p>Two</p>',               // elsewhere
      '<p>One more.</p><p>Two, more</p>',         // Two again
      '<p>One more.</p><p>Three.</p>',            // Two again
      '<p>One more!</p><p>Three.</p>',            // elsewhere
      '<p>One more!</p>']                         // and Two's place taken out
  ]);
  const h = new R.History(sessions);
  h.build();
  const end = h.steps.length;
  const html = (n) => h.state(n)['ch-a'];
  // Two as it is after its second bout
  const at3 = h.steps.findIndex((s, i) => html(i + 1) === '<p>One more.</p><p>Two, more</p>') + 1;
  const two = { ch: 'ch-a', a: 16, b: 32 };
  assert.equal(html(at3).slice(two.a, two.b), '<p>Two, more</p>');
  const back = R.partPrev(h, { ...two }, at3);
  assert.equal(html(back.n).slice(back.part.a, back.part.b), '<p>Two</p>', 'as first written');
  const p = { ...back.part };
  assert.equal(R.partPrev(h, p, back.n), null, 'nothing before it was written');
  assert.ok(p.gone, 'and before that it wasn’t there');
  // forward: Three replaced it (a change), then it was taken out
  const fwd = R.partNext(h, { ...two }, at3);
  assert.equal(html(fwd.n).slice(fwd.part.a, fwd.part.b), '<p>Three.</p>');
  const out = R.partNext(h, { ...fwd.part }, fwd.n);
  assert.ok(out.part.gone && out.part.a === out.part.b, 'taken out');
  assert.equal(R.partNext(h, { ch: 'ch-a', a: out.part.a, b: out.part.b }, out.n), null, 'nothing after');
  // and back from there: what was taken out
  const again = R.partPrev(h, { ch: 'ch-a', a: out.part.a, b: out.part.b }, out.n);
  assert.equal(html(again.n).slice(again.part.a, again.part.b), '<p>Three.</p>');
  assert.equal(end, h.steps.length);
});
