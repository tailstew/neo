'use strict';

// recording.js, the Writing History engine: splices, runs, the hash chain,
// joining a session's files, and replay (docs/neo-recording-plan.md).

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { test } = require('node:test');
const R = require('../recording.js');

const apply = (a, sp) => (sp ? R.applyEdit(a, sp.at, sp.del, sp.ins) : a);
const plain = (sp) => (sp ? { ...sp } : sp);

// a small, repeatable source of randomness
function rng(seed) {
  return (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
}

/* ---------- splices ---------- */

test('a splice turns one text into the other', () => {
  assert.equal(R.splice('same', 'same'), null);
  assert.deepEqual(plain(R.splice('<p>Rain</p>', '<p>Rains</p>')), { at: 7, del: 0, ins: 's' });
  assert.deepEqual(plain(R.splice('<p>Rains</p>', '<p>Rain</p>')), { at: 7, del: 1, ins: '' });
  assert.deepEqual(plain(R.splice('<p>a cat</p>', '<p>a dog</p>')), { at: 5, del: 3, ins: 'dog' });
  assert.deepEqual(plain(R.splice('', '<p><br></p>')), { at: 0, del: 0, ins: '<p><br></p>' });
  assert.deepEqual(plain(R.splice('<p>x</p>', '')), { at: 0, del: 8, ins: '' });
});

test('among repeated letters, the caret says where the change was', () => {
  // "l" typed after "al": the second l, unless the caret says the first
  assert.deepEqual(plain(R.splice('al', 'all')), { at: 2, del: 0, ins: 'l' });
  assert.deepEqual(plain(R.splice('al', 'all', 2)), { at: 1, del: 0, ins: 'l' });
  assert.deepEqual(plain(R.splice('al', 'all', () => 3)), { at: 2, del: 0, ins: 'l' });
  // one of three a's deleted, the caret after the first
  assert.deepEqual(plain(R.splice('baaab', 'baab', 1)), { at: 1, del: 1, ins: '' });
  // "ab" typed into "ab|ab": the same text, placed at the caret
  assert.deepEqual(plain(R.splice('abab', 'ababab', 4)), { at: 2, del: 0, ins: 'ab' });
  // a hint the change can't end at is ignored
  assert.deepEqual(plain(R.splice('al', 'all', 0)), { at: 2, del: 0, ins: 'l' });
  assert.deepEqual(plain(R.splice('al', 'all', -1)), { at: 2, del: 0, ins: 'l' });
  assert.deepEqual(plain(R.splice('<p>x</p>', '<p>xy</p>', 0)), { at: 4, del: 0, ins: 'y' });
});

test('every splice replays to the text it came from, wherever the caret is', () => {
  const rand = rng(7);
  const word = (n) => Array.from({ length: n }, () => 'ab <p>'[rand(6)]).join('');
  for (let i = 0; i < 3000; i++) {
    const a = word(rand(30));
    const at = rand(a.length + 1);
    const b = a.slice(0, at) + word(rand(5)) + a.slice(at + rand(5));
    for (const hint of [undefined, rand(b.length + 2) - 1]) {
      const sp = R.splice(a, b, hint);
      assert.equal(apply(a, sp), b, JSON.stringify({ a, b, hint, sp }));
    }
  }
});

/* ---------- hashes ---------- */

test('SHA-256 matches Node’s, over UTF-8', () => {
  const rand = rng(3);
  const samples = ['', 'abc', 'é', '日本語', '😀 emoji', 'x'.repeat(55), 'y'.repeat(56), 'z'.repeat(64), 'q'.repeat(1000)];
  for (let i = 0; i < 50; i++) samples.push(Array.from({ length: rand(300) }, () => String.fromCodePoint(32 + rand(0x2fff))).join(''));
  for (const s of samples) assert.equal(R.sha256(s), crypto.createHash('sha256').update(s, 'utf8').digest('hex'), JSON.stringify(s.slice(0, 20)));
  assert.equal(R.sha256(new Uint8Array([1, 2, 3])), crypto.createHash('sha256').update(Buffer.from([1, 2, 3])).digest('hex'));
});

// SHA-256's first 16 bytes, in base64url, as Node writes it
const digest = (...parts) => {
  const h = crypto.createHash('sha256');
  for (const p of parts) h.update(p);
  return h.digest().subarray(0, 16).toString('base64url');
};

test('a recording’s hash is SHA-256 cut to 128 bits, in base64url', () => {
  for (const s of ['', 'abc', '日本語 😀', 'q'.repeat(1000)]) assert.equal(R.digest(s), digest(Buffer.from(s, 'utf8')));
  assert.equal(R.digest('').length, 22);
});

test('a chain link hashes the previous link’s bytes, then the lines', () => {
  const prev = R.digest('header\n');
  const want = digest(Buffer.from(prev, 'base64url'), '[1,"k","KeyA",0]\n');
  assert.equal(R.chainHash(prev, '[1,"k","KeyA",0]\n'), want);
});

/* ---------- runs ---------- */

// what the recorder makes for a key that types c at `at` (the edit comes at
// the key's moment, dt 0)
const typed = (dt, code, mods, at, c) => [[dt, 'k', code, mods], [0, 'e', at, 0, c, 'iT']];
const back = (dt, at) => [[dt, 'k', 'Backspace', 0], [0, 'e', at, 1, '', 'dB']];

test('ordinary typing becomes a run, and expands back key for key', () => {
  const lines = [
    [0, 'b', 'ch-1', '<p></p>', R.digest('<p></p>'), 'baseline'],
    ...typed(500, 'KeyH', 1, 3, 'H'), ...typed(120, 'KeyI', 0, 4, 'i'),
    ...typed(95, 'Space', 0, 5, ' '), ...typed(2210, 'KeyI', 0, 6, 'i'),
    ...back(300, 6), ...back(110, 5),
    ...typed(80, 'KeyO', 0, 5, 'o')
  ];
  const enc = R.encodeRuns(lines);
  // the usual keys for letters, digits and space need no K line
  assert.deepEqual(enc, [
    lines[0],
    [500, 'r', 'Hi i', [120, 95, 2210], 3], // a run's first position, when nothing was typed here before
    [300, 'rd', 2, [110]],
    [80, 'r', 'o', []]
  ]);
  assert.deepEqual(R.expandRuns(enc), lines);
});

test('Backspace and Delete, held down or not, become one deleting run', () => {
  const del = (dt, mods, at) => [[dt, 'k', 'Delete', mods], [0, 'e', at, 1, '', 'dF']];
  const lines = [
    [0, 'b', 'ch-1', '<p>abcdefghij</p>', R.digest('<p>abcdefghij</p>'), 'baseline'],
    [10, 's', 0, 7, 'p'],
    ...back(500, 9), [500, 'k', 'Backspace', 16], [0, 'e', 8, 1, '', 'dB'], [30, 'k', 'Backspace', 16], [0, 'e', 7, 1, '', 'dB'],
    ...del(200, 0, 7), ...del(400, 16, 7), ...del(30, 16, 7),
    ...back(90, 6)
  ];
  const enc = R.encodeRuns(lines);
  assert.deepEqual(enc, [lines[0], lines[1], [500, 'rd', 'BbbDddB', [500, 30, 200, 400, 30, 90], 10]]);
  assert.deepEqual(R.expandRuns(enc), lines);
  const r = R.replay([enc]);
  assert.deepEqual(r.problems, []);
  assert.equal(r.chapters['ch-1'], '<p>abc</p>');
  // only Backspaces: a count, as before
  assert.deepEqual(R.encodeRuns([lines[0], ...back(5, 13), ...back(5, 12)])[1], [5, 'rd', 2, [5], 14]);
});

test('a key that isn’t the usual one for its character gets a K line once', () => {
  const lines = [
    [0, 'b', 'ch-1', '<p></p>', R.digest('<p></p>'), 'baseline'],
    ...typed(50, 'KeyQ', 0, 3, 'a'), ...typed(50, 'KeyB', 0, 4, 'b'), ...typed(50, 'KeyQ', 0, 5, 'a'),
    ...typed(50, 'Quote', 1, 6, 'é')
  ];
  const enc = R.encodeRuns(lines);
  assert.deepEqual(enc, [
    lines[0],
    [0, 'K', 'a', 'KeyQ', 0], [0, 'K', 'é', 'Quote', 1],
    [50, 'r', 'abaé', [50, 50, 50], 3]
  ]);
  assert.deepEqual(R.expandRuns(enc), lines);
});

test('keys that can’t be a run break it, and come through whole', () => {
  const amp = '&amp;';
  const lines = [
    [0, 'b', 'ch-1', '<p>ab</p>', R.digest('<p>ab</p>'), 'baseline'],
    ...typed(10, 'KeyC', 0, 5, 'c'),
    // & is saved as &amp;: five characters, not one
    [40, 'k', 'Digit7', 1], [0, 'e', 6, 0, amp, 'iT'],
    ...typed(30, 'KeyD', 0, 11, 'd'),
    // Enter: a new paragraph
    [50, 'k', 'Enter', 0], [0, 'e', 12, 0, '</p><p>', 'iP'],
    ...typed(60, 'KeyE', 0, 19, 'e'),
    // a Backspace that joins two paragraphs
    ...typed(20, 'KeyF', 0, 20, 'f'),
    [70, 'k', 'Backspace', 0], [0, 'e', 12, 7, '', 'dB'],
    // the same character from another key (the keypad's 5, then the number row's)
    ...typed(10, 'Numpad5', 0, 14, '5'), ...typed(10, 'Digit5', 0, 15, '5'),
    // a held key repeats; a key a script sent; a shortcut
    [10, 'k', 'KeyG', 16], [0, 'e', 16, 0, 'g', 'iT'],
    [10, 'k', 'KeyH', 32], [0, 'e', 17, 0, 'h', 'iT'],
    [10, 'k', 'KeyB', 2],
    // an edit with no key down, and one a moment after its key
    [5, 'e', 18, 0, 'x', 'iT', 0],
    [10, 'k', 'KeyY', 0], [3, 'e', 19, 0, 'y', 'iT'],
    // typing somewhere else: the caret moved
    [10, 's', 0, 1, 'p'],
    ...typed(10, 'KeyZ', 0, 4, 'z'),
    // two dashes become one: the second dash's key, then two edits
    ...typed(10, 'Minus', 0, 5, '-'),
    [10, 'k', 'Minus', 0], [0, 'e', 5, 1, '', 'dB'], [0, 'e', 5, 0, '—', 'iT']
  ];
  const enc = R.encodeRuns(lines);
  assert.deepEqual(R.expandRuns(enc), lines);
  const kinds = enc.map((l) => l[1]);
  // Digit7, Enter, the joining Backspace, KeyG, KeyH, KeyB, KeyY and the second Minus
  assert.equal(kinds.filter((k) => k === 'k').length, 8, JSON.stringify(enc));
  assert.ok(enc.some((l) => l[1] === 'K' && l[2] === '5' && l[3] === 'Digit5'), 'a second key for 5 gets its own layout line');
});

// a caret key, and (a few ms later) the caret line it caused
const nav = (dt, code, mods, ...sel) => [[dt, 'k', code, mods], ...(sel.length ? [[3, 's', ...sel]] : [])];
// each line's moment, and what it says
const timeline = (lines) => { let t = 0; return lines.map((l) => [(t += l[0]), ...l.slice(1)]); };

test('caret keys become an n run, writing down only the moves that aren’t one letter along', () => {
  const lines = [
    [0, 'b', 'ch-1', '<p>Rain fell</p>', R.digest('<p>Rain fell</p>'), 'baseline'],
    [10, 's', 0, 9, 'p'],                                  // a click: the guesses start here
    ...nav(400, 'ArrowLeft', 0, 0, 8), ...nav(90, 'ArrowLeft', 16, 0, 7), ...nav(33, 'ArrowLeft', 16, 0, 6),
    ...nav(200, 'ArrowRight', 1, 0, 6, 0, 7),             // Shift: the focus moves, the anchor stays
    ...nav(80, 'ArrowLeft', 0, 0, 6),                      // a selection collapses: not a guess
    ...nav(80, 'End', 0, 0, 9),                            // not a guess either
    ...nav(80, 'ArrowRight', 0),                           // at the end: the caret stays
    ...nav(80, 'ArrowDown', 0, 1, 0)
  ];
  const enc = R.encodeRuns(lines);
  assert.deepEqual(enc, [
    lines[0], lines[1],
    [400, 'n', 'LL*L*rLERD', [93, 36, 203, 83, 83, 83, 80, 3], [[4, 0, 6], [5, 0, 9], [6], [7, 1, 0]]]
  ]);
  const back = R.expandRuns(enc);
  // the same lines, each caret line at its key's moment (but the last)
  assert.deepEqual(back.map((l) => l.slice(1)), lines.map((l) => l.slice(1)));
  const keyTimes = (ls) => timeline(ls).filter((l) => l[1] === 'k').map((l) => l[0]);
  assert.deepEqual(keyTimes(back), keyTimes(lines));
  assert.deepEqual(timeline(back).at(-1), timeline(lines).at(-1));
  // the player sees each move
  const text = JSON.stringify({ neoRec: R.FORMAT, session: 's', startedAt: '2026-10-06T09:00:00.000Z' }) + '\n' + enc.map((l) => JSON.stringify(l) + '\n').join('');
  const steps = R.compileSession(text).steps.filter((s) => s.k === 's');
  assert.deepEqual(steps.map((s) => [...s.a, ...s.f]), [[0, 9, 0, 9], [0, 8, 0, 8], [0, 7, 0, 7], [0, 6, 0, 6], [0, 6, 0, 7], [0, 6, 0, 6], [0, 9, 0, 9], [1, 0, 1, 0]]);
  assert.equal(R.compileSession(text).keys.length, 8);
});

test('a caret key with Ctrl, or a caret line a click made, stays out of the n run', () => {
  const lines = [
    [0, 'b', 'ch-1', '<p>ab</p>', R.digest('<p>ab</p>'), 'baseline'],
    [10, 's', 0, 2, 'p'],
    ...nav(50, 'ArrowLeft', 0, 0, 1),
    [40, 'k', 'ArrowLeft', 2], [3, 's', 0, 0],
    ...nav(50, 'ArrowRight', 0, 0, 1),
    [40, 's', 0, 2, 'p']
  ];
  const enc = R.encodeRuns(lines);
  assert.deepEqual(enc.map((l) => l[1]), ['b', 's', 'n', 'k', 's', 'n', 's']);
  assert.deepEqual(R.expandRuns(enc).map((l) => l.slice(1)), lines.map((l) => l.slice(1)));
});

test('a chunk keeps the last write of each chapter, and the time of the ones it leaves out', () => {
  const w = new R.SessionWriter({ neoRec: R.FORMAT, session: 's' });
  const a = '<p>a</p>';
  const b = '<p>b</p>';
  w.push([0, 'b', 'ch-a', a, R.digest(a), 'baseline']);
  w.push([0, 'b', 'ch-b', b, R.digest(b), 'baseline']);
  w.push([100, 'w', R.digest(b)]);
  w.push([200, 'w', R.digest(a), 'ch-a']);
  w.push([0, 'ch', 'ch-a']);
  w.push([300, 'f', 'blur']);
  w.push([400, 'w', R.digest(a)]);
  w.push([500, 'w', R.digest(b), 'ch-b']);
  const { text } = w.chunk();
  const { lines } = R.parseSession(text);
  assert.deepEqual(lines.filter((l) => l[1] !== 'h'), [
    [0, 'b', 'ch-a', a, R.digest(a), 'baseline'],
    [0, 'b', 'ch-b', b, R.digest(b), 'baseline'],
    [0, 'ch', 'ch-a'],
    [600, 'f', 'blur'],
    [400, 'w', R.digest(a)],
    [500, 'w', R.digest(b), 'ch-b']
  ]);
  assert.ok(R.verifyChain(text).ok);
  assert.equal(R.replayCheck([text]).writes, 2);
});

test('a session in a format this NEO doesn’t know is left unread', () => {
  const text = JSON.stringify({ neoRec: R.FORMAT + 1, session: 's' }) + '\n' + JSON.stringify([0, 'b', 'ch-1', '<p></p>', 'x', 'baseline']) + '\n';
  const r = R.replayCheck([text]);
  assert.deepEqual(r.problems.map((p) => p.reason), ['format']);
  assert.deepEqual(R.compileSession(text).steps, []);
});

test('runs round-trip on generated typing, through any number of chapters', () => {
  for (let seed = 1; seed < 40; seed++) {
    const rand = rng(seed);
    const chapters = { a: '<p>x</p>', b: '<p>y</p>' };
    let cur = 'a';
    const caret = { a: 4, b: 4 };
    const lines = [
      [0, 'b', 'a', chapters.a, R.digest(chapters.a), 'baseline'],
      [0, 'b', 'b', chapters.b, R.digest(chapters.b), 'baseline']
    ];
    cur = 'b';
    for (let i = 0; i < 400; i++) {
      const roll = rand(20);
      if (roll === 0) {
        cur = cur === 'a' ? 'b' : 'a';
        lines.push([0, 'ch', cur]);
      } else if (roll === 1) {
        caret[cur] = 3 + rand(chapters[cur].length - 6);
        lines.push([rand(900), 's', 0, rand(9)]);
      } else if (roll < 5 && caret[cur] > 3) {
        lines.push(...back(rand(400), caret[cur] - 1));
        chapters[cur] = R.applyEdit(chapters[cur], caret[cur] - 1, 1, '');
        caret[cur]--;
      } else {
        const c = 'aebc Ωd😀'[rand(9)] === '😀' ? '😀' : 'aebc Ωd'[rand(7)];
        lines.push(...typed(rand(3000), c === ' ' ? 'Space' : 'Key' + c, rand(2), caret[cur], c));
        chapters[cur] = R.applyEdit(chapters[cur], caret[cur], 0, c);
        caret[cur] += c.length;
      }
    }
    const enc = R.encodeRuns(lines);
    assert.deepEqual(R.expandRuns(enc), lines, 'seed ' + seed);
    assert.ok(enc.length < lines.length / 2, 'runs should be most of it');
    const r = R.replay([enc]);
    assert.deepEqual(r.problems, []);
    assert.equal(r.chapters.a, chapters.a);
    assert.equal(r.chapters.b, chapters.b);
  }
});

/* ---------- writing, joining and checking a session ---------- */

// A session written the way the recorder writes it: chunks, each sealed
function session(seed, chunks = 6) {
  const rand = rng(seed);
  const w = new R.SessionWriter({ neoRec: 1, session: '2026-10-06T09-14-03Z-test', device: 'd-0', book: 'book-x', prev: null });
  let html = '<p>Rain fell.</p>';
  w.push([0, 'b', 'ch-1', html, R.digest(html), 'baseline']);
  const parts = [];
  for (let c = 0; c < chunks; c++) {
    for (let i = 0; i < 30; i++) {
      const at = html.length - 4;
      if (rand(5) === 0 && html.length > 8) {
        w.push([rand(300), 'k', 'Backspace', 0]);
        w.push([0, 'e', at - 1, 1, '', 'dB']);
        html = R.applyEdit(html, at - 1, 1, '');
      } else {
        const ch = 'abc &'[rand(5)];
        const ins = ch === '&' ? '&amp;' : ch;
        w.push([rand(300), 'k', 'Key' + ch, 0]);
        w.push([0, 'e', at, 0, ins, 'iT']);
        html = R.applyEdit(html, at, 0, ins);
      }
    }
    w.push([400, 'w', R.digest(html)]);
    w.push([400, 'w', R.digest(html)]); // the same chapter written twice: the chunk keeps the last
    const part = w.chunk();
    parts.push({ name: 'c-' + String(part.first).padStart(6, '0') + '.jsonl', text: part.text, first: part.first, last: part.last });
  }
  return { parts, html, text: parts.map((p) => p.text).join(''), w };
}

test('a session’s chunks join into a chain that verifies and replays', () => {
  const s = session(11);
  const joined = R.joinParts(s.parts);
  assert.equal(joined.text, s.text);
  assert.deepEqual(joined.gaps, []);
  const v = R.verifyChain(joined.text);
  assert.ok(v.ok, JSON.stringify(v.breaks));
  assert.equal(v.verified, v.lines);
  assert.equal(v.last, s.w.H);
  const r = R.replayCheck([joined.text]);
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.writes, 6);
  assert.equal(r.chapters['ch-1'], s.html);
});

test('rollups and chunks join in line order, even when a crash left both', () => {
  const s = session(12, 8);
  const p = s.parts;
  const rollup = (from, to) => ({ name: `s-${String(p[from].first).padStart(6, '0')}-${String(p[to].last).padStart(6, '0')}.jsonl.gz`, text: p.slice(from, to + 1).map((x) => x.text).join('') });
  // the usual shape: a rollup, then the chunks since
  assert.equal(R.joinParts([rollup(0, 3), p[4], p[5], p[6], p[7]]).text, s.text);
  // a crash between writing the second rollup and deleting its chunks
  const crashed = R.joinParts([p[7], rollup(4, 6), p[5], rollup(0, 3), p[4], p[6]]);
  assert.equal(crashed.text, s.text);
  assert.deepEqual(crashed.gaps, []);
  // a lost chunk is a gap, and a break in the chain
  const lost = R.joinParts([rollup(0, 3), p[5], p[6], p[7]]);
  assert.deepEqual(lost.gaps, [{ from: p[4].first, to: p[4].last }]);
  assert.ok(!R.verifyChain(lost.text).ok);
  // a chunk that won't read whole is left out and named
  const torn = R.joinParts([...p.slice(0, 7), { name: p[7].name, text: p[7].text.slice(0, -10) }]);
  assert.deepEqual(torn.bad, [p[7].name]);
  assert.equal(torn.text, p.slice(0, 7).map((x) => x.text).join(''));
});

test('the chain notices a line changed, removed or added', () => {
  const s = session(13, 4);
  const lines = s.text.split('\n');
  const edited = [...lines];
  edited[5] = edited[5].replace(/,(\d+),/, (m, n) => `,${+n + 1},`);
  assert.ok(!R.verifyChain(edited.join('\n')).ok, 'a changed line');
  const removed = lines.filter((_, i) => i !== 7);
  assert.ok(!R.verifyChain(removed.join('\n')).ok, 'a removed line');
  const added = [...lines.slice(0, 9), '[0,"f","blur"]', ...lines.slice(9)];
  const v = R.verifyChain(added.join('\n'));
  assert.ok(!v.ok, 'an added line');
  assert.ok(v.verified < v.lines);
  // and the header is in the chain too
  const header = [lines[0].replace('book-x', 'book-y'), ...lines.slice(1)];
  assert.ok(!R.verifyChain(header.join('\n')).ok, 'a changed header');
});

test('a session closed for NEO after a crash gets an end line, still chained', () => {
  const s = session(14, 3);
  const closed = R.appendLines(s.text, [[0, 'end', { crashed: true }]]);
  const v = R.verifyChain(closed);
  assert.ok(v.ok, JSON.stringify(v.breaks));
  const { lines } = R.parseSession(closed);
  assert.deepEqual(lines[lines.length - 2], [0, 'end', { crashed: true }]);
});

test('replay checks every write, and says where it can’t follow', () => {
  const one = '<p>Rain</p>';
  const two = '<p>Rain fell</p>';
  const sessionOne = [
    [0, 'b', 'ch-1', one, R.digest(one), 'baseline'],
    [0, 'K', ' ', 'Space', 0], [0, 'K', 'f', 'KeyF', 0], [0, 'K', 'e', 'KeyE', 0], [0, 'K', 'l', 'KeyL', 0],
    [120, 'r', ' fell', [90, 80, 70, 60], 7],
    [3, 'w', R.digest(two)],
    [0, 'b', 'ch-2', '<p><br></p>', R.digest('<p><br></p>'), 'split'],
    [5, 'x', 'merge'],
    [0, 'ch', 'ch-1'],
    [0, 'e', 16, 0, '<p><br></p>'],
    [0, 'd', 'ch-2', 'merge'],
    [9, 'w', R.digest(one), 'ch-1'] // not what the replay leaves
  ];
  const a = R.replayCheck([sessionOne]);
  assert.equal(a.writes, 2);
  assert.deepEqual(a.bad.map((w) => w.line), [14]); // line numbers count the header
  assert.deepEqual({ ...a.chapters }, { 'ch-1': two + '<p><br></p>' });
  // a later session picks up where this one left the chapter
  const sessionTwo = [
    [0, 'b', 'ch-1', null, R.digest(two + '<p><br></p>'), 'continue'],
    [40, 'rd', 1, [], 12],
    [5, 'w', R.digest('<p>Rain fel</p><p><br></p>')]
  ];
  const b = R.replayCheck([sessionOne, sessionTwo]);
  assert.equal(b.bad.length, 1);
  assert.deepEqual(b.problems, []);
  // …and alone, without the first, it can't
  const c = R.replayCheck([sessionTwo]);
  assert.deepEqual(c.problems.map((p) => p.reason), ['continue', 'edit']);
  assert.ok(!c.ok);
});

/* ---------- history: what the player plays ---------- */

test('an HTML offset counts the text a rendered chapter has before it', () => {
  const html = '<p class="poetry">Rain &amp; <i>hail</i></p><p><br></p><p>a&nbsp;b &#128512;!</p>';
  const text = (at) => R.textOffset(html, at);
  assert.equal(text(0), 0);
  assert.equal(text(html.indexOf('Rain')), 0);
  assert.equal(text(html.indexOf('&amp;')), 5);
  assert.equal(text(html.indexOf('&amp;') + 2), 5); // inside the entity: from its start
  assert.equal(text(html.indexOf('hail')), 7);
  assert.equal(text(html.indexOf('<br>') + 2), 11); // inside a tag: from its start
  assert.equal(text(html.indexOf('!')), 11 + 4 + 2); // a&nbsp;b, a space, an emoji's two units
  assert.equal(text(html.length), 18);
  assert.equal(R.textOffset('<p title="a>b">x</p>', 15), 0); // a > inside quotes doesn't end the tag
  assert.equal(R.textOffset('<p title="a>b">x</p>', 16), 1);
});

// Sessions written the way the recorder writes them, with typing, caret
// moves, pastes, structural moves, a chapter dropped and wall-clock lines.
// Each picks up where the one before left its chapters.
function sessions(seed, count = 4) {
  const rand = rng(seed);
  const known = {};
  const out = [];
  let prev = null;
  for (let s = 0; s < count; s++) {
    const id = `2026-10-0${s + 1}T09-00-00Z-t${seed}${s}`;
    const w = new R.SessionWriter({ neoRec: 1, session: id, device: 'd-0', book: 'book-x', startedAt: `2026-10-0${s + 1}T09:00:00.000Z`, prev });
    const chapters = {};
    const caret = {};
    let cur = null;
    const touch = (ch) => {
      if (ch in chapters) { if (cur !== ch) w.push([0, 'ch', ch]); cur = ch; return; }
      if (known[ch] !== undefined) { chapters[ch] = known[ch]; w.push([0, 'b', ch, null, R.digest(known[ch]), 'continue']); }
      else { chapters[ch] = '<p>' + ch + '</p>'; w.push([0, 'b', ch, chapters[ch], R.digest(chapters[ch]), 'baseline']); }
      caret[ch] = chapters[ch].length - 4;
      cur = ch;
    };
    // a place to type: never inside a tag
    const safe = (html, at) => !/[<>&;/]/.test(html[at - 1] || '') && !/[<&/]/.test(html[at] || '') && html.lastIndexOf('<', at - 1) <= html.lastIndexOf('>', at - 1);
    for (let i = 0; i < 700; i++) {
      const roll = Math.floor(rand(0x7fffffff) / 0x7fffffff * 40); // (the low bits repeat too soon)
      if (i === 100) { w.push([5, 'T', `2026-10-0${s + 1}T15:00:00.000Z`]); continue; } // the computer slept
      if (i === 400 && s === count - 1) { // a chapter goes, its words with it
        touch('ch-c');
        w.push([rand(300), 'd', 'ch-c', 'delete']);
        delete chapters['ch-c'];
        delete known['ch-c'];
        cur = null;
        touch('ch-a');
        continue;
      }
      if (i === 0 || roll === 0) touch(['ch-a', 'ch-b', i > 400 && s === count - 1 ? 'ch-b' : 'ch-c'][rand(3)]);
      else if (roll === 1) {
        const to = 3 + rand(Math.max(1, chapters[cur].length - 6));
        if (safe(chapters[cur], to)) caret[cur] = to;
        w.push([rand(900), 's', 0, rand(9), 'p']);
      } else if (roll === 2) {
        w.push([rand(400), 'c', 'paste', 5, 'text', R.digest('pasted'), rand(2) === 0]);
        w.push([0, 'e', caret[cur], 0, 'Some.', 'iFP']);
        chapters[cur] = R.applyEdit(chapters[cur], caret[cur], 0, 'Some.');
        caret[cur] += 5;
      } else if (roll === 3) {
        w.push([rand(400), 'x', 'split']);
        w.push([0, 'e', caret[cur], 0, '</p><p>']);
        chapters[cur] = R.applyEdit(chapters[cur], caret[cur], 0, '</p><p>');
        caret[cur] += 7;
      } else if (roll === 4) {
        w.push([rand(60000), 'f', 'blur']);
        w.push([rand(9), 'T', `2026-10-0${s + 1}T1${rand(9)}:00:00.000Z`]);
      } else if (roll < 12 && caret[cur] > 4 && safe(chapters[cur], caret[cur] - 1)) {
        w.push([rand(400), 'k', 'Backspace', 0]);
        w.push([0, 'e', caret[cur] - 1, 1, '', 'dB']);
        chapters[cur] = R.applyEdit(chapters[cur], caret[cur] - 1, 1, '');
        caret[cur]--;
      } else {
        const c = 'abc d'[rand(5)];
        w.push([rand(3000), 'k', c === ' ' ? 'Space' : 'Key' + c, 0]);
        w.push([0, 'e', caret[cur], 0, c, 'iT']);
        chapters[cur] = R.applyEdit(chapters[cur], caret[cur], 0, c);
        caret[cur]++;
      }
      if (rand(60) === 0) { w.push([0, 'w', R.digest(chapters[cur])]); w.chunk(); }
    }
    w.push([0, 'end', {}]);
    w.chunk();
    for (const [ch, html] of Object.entries(chapters)) known[ch] = html;
    prev = w.H;
    out.push({ id, device: 'd-0', text: w.lines.join('\n') + '\n' });
  }
  return { sessions: out, known };
}

// The chapters after n steps, played one by one from nothing
function played(h, n) {
  const doc = {};
  for (let i = 0; i < n; i++) h.apply(doc, i);
  return Object.fromEntries(Object.entries(doc).map(([ch, c]) => [ch, c.toString()]));
}

test('a history plays to where the replay ends, and seeks to any step', () => {
  for (let seed = 1; seed < 6; seed++) {
    const { sessions: ss, known } = sessions(seed);
    const h = new R.History(ss);
    h.build({}, { every: 97 });
    assert.equal(h.bad.size, 0, 'seed ' + seed);
    assert.ok(h.keyframes.length > 10);
    const r = R.replayCheck(ss.map((s) => s.text));
    assert.ok(r.ok, JSON.stringify(r.problems.slice(0, 3)));
    assert.deepEqual({ ...h.end }, { ...r.chapters });
    assert.deepEqual({ ...h.end }, known);
    const ns = [0, 1, 2, 96, 97, 98, h.steps.length - 1, h.steps.length];
    for (let i = 0; i < 25; i++) ns.push(rng(seed + i)(h.steps.length));
    for (const n of ns) assert.deepEqual(h.state(n), played(h, n), `seed ${seed}, step ${n}`);
  }
});

test('a history’s steps keep the clock, the wall time and the causes', () => {
  const { sessions: ss } = sessions(4, 2);
  const h = new R.History(ss, { gap: 1500 });
  assert.equal(h.sessions.length, 2);
  assert.equal(h.steps[0].k, 'session');
  assert.equal(h.steps[h.sessions[1].from].k, 'session');
  assert.equal(h.sessions[1].t0, h.sessions[0].t1 + 1500);
  for (let i = 1; i < h.steps.length; i++) assert.ok(h.steps[i].t >= h.steps[i - 1].t, 'time only moves on');
  assert.equal(h.steps[1].wall, Date.parse('2026-10-01T09:00:00.000Z') + h.steps[1].t);
  // a T line sets the wall clock again, whatever the clock said
  assert.ok(h.steps.some((s) => s.session === 0 && s.wall !== null && s.wall - s.t !== h.steps[1].wall - h.steps[1].t));
  // typing runs come out one step per key; pastes and moves keep their cause
  assert.ok(h.steps.some((s) => s.k === 'e' && s.key && s.cause === 'input'));
  assert.ok(h.steps.some((s) => s.k === 'e' && s.input === 'iFP' && s.cause === 'input'), 'a paste');
  assert.ok(h.steps.some((s) => s.k === 'e' && s.cause === 'split'));
  assert.ok(h.steps.some((s) => s.k === 'c' && s.what === 'paste'));
  assert.ok(h.steps.some((s) => s.k === 's' && s.by === 'p'));
  assert.ok(h.keys.length > 500);
  assert.ok(R.parseSession(ss[0].text).lines.length < h.steps.length / 2, 'runs were in the file');
});

// Two devices open on one day (the laptop and the Chromebook, 2026-11-14):
// the Chromebook's session ran 33 s ahead of the laptop's on the day's
// clock, and every laptop key behind it landed on one moment
test('a session behind another one open beside it keeps the spacing of its keys', () => {
  const H = (id, device, startedAt) => new R.SessionWriter({ neoRec: 1, session: id, device, book: 'book-x', startedAt, prev: null });
  const a = H('2026-11-14T10-00-00Z-aaaa', 'd-a', '2026-11-14T10:00:00.000Z');
  a.push([0, 'b', 'ch-a', '<p>A</p>', R.digest('<p>A</p>'), 'baseline']);
  // its clock says a minute went by, the wall clock forty seconds
  a.push([60000, 'T', '2026-11-14T10:00:40.000Z']);
  a.push([0, 'f', 'focus']);
  a.push([30000, 'f', 'blur']);
  const b = H('2026-11-14T10-00-20Z-bbbb', 'd-b', '2026-11-14T10:00:20.000Z');
  b.push([0, 'b', 'ch-b', '<p>B</p>', R.digest('<p>B</p>'), 'baseline']);
  b.push([25000, 'k', 'KeyX', 0]);
  b.push([0, 'e', 4, 0, 'x', 'iT']);
  for (const c of 'yz') { b.push([200, 'k', 'Key' + c.toUpperCase(), 0]); b.push([0, 'e', 4, 0, c, 'iT']); }
  const h = new R.History([{ id: 'a', device: 'd-a', text: a.chunk().text }, { id: 'b', device: 'd-b', text: b.chunk().text }]);
  const keys = h.steps.filter((st) => st.k === 'e' && st.session === 1);
  assert.equal(keys.length, 3);
  assert.deepEqual(keys.slice(1).map((st, i) => Math.round(st.t - keys[i].t)), [200, 200], 'typed 200 ms apart, played so');
  for (let i = 1; i < h.steps.length; i++) assert.ok(h.steps[i].t >= h.steps[i - 1].t, 'time only moves on');
});

test('a history lists every chapter it saw, a dropped one too', () => {
  const { sessions: ss, known } = sessions(5, 3);
  const h = new R.History(ss);
  h.build();
  const list = h.chapters();
  assert.deepEqual(list.filter((c) => !c.dropped).map((c) => c.ch).sort(), Object.keys(known).sort());
  const c = list.find((x) => x.dropped);
  assert.equal(c.ch, 'ch-c');
  assert.equal(h.steps[c.lastStep].k, 'd');
  assert.ok(c.first < c.last);
  assert.ok(h.state(c.lastStep)[c.ch] !== undefined, 'its words are there just before it went');
  assert.equal(h.state(c.lastStep + 1)[c.ch], undefined);
});

test('a history starts from the chapters it’s given, and its keyframes never change under it', () => {
  const { sessions: ss } = sessions(4, 3);
  const whole = new R.History(ss);
  whole.build({}, { every: 150 });
  // the last session alone, from where the first two left the book
  const first = new R.History(ss.slice(0, 2));
  first.build();
  const last = new R.History(ss.slice(2));
  last.build(first.end, { every: 150 });
  assert.equal(last.bad.size, 0);
  assert.deepEqual(last.end, whole.end);
  assert.deepEqual(last.state(0), first.end);
  const kf = JSON.stringify(last.keyframes.map((k) => Object.entries(k.chapters).map(([ch, c]) => [ch, c.toString()])));
  for (const n of [0, 151, 1000, last.steps.length]) {
    const doc = last.doc(n);
    for (const c of Object.values(doc)) c.splice(0, 0, 'played on');
  }
  assert.equal(JSON.stringify(last.keyframes.map((k) => Object.entries(k.chapters).map(([ch, c]) => [ch, c.toString()]))), kf, 'a seek played on a copy');
  // without the sessions before, its continues can’t be followed
  const alone = new R.History(ss.slice(2));
  alone.build();
  assert.ok(alone.bad.size > 0);
});

test('the chapter order at any step is the last o line before it', () => {
  const lines = [
    [0, 'b', 'a', '<p>a</p>', R.digest('<p>a</p>'), 'baseline'],
    [0, 'o', ['a']],
    [5, 'b', 'b', '<p>b</p>', R.digest('<p>b</p>'), 'new'],
    [0, 'o', ['a', 'b']],
    [5, 'o', ['b', 'a']]
  ];
  const text = JSON.stringify({ neoRec: 1, session: 's', startedAt: '2026-10-06T09:00:00.000Z' }) + '\n' + lines.map((l) => JSON.stringify(l) + '\n').join('');
  const h = new R.History([{ id: 's', device: 'd', text }]);
  h.build();
  assert.equal(h.order(0), null);
  assert.equal(h.order(2), null);
  assert.deepEqual(h.order(3), ['a']);
  assert.deepEqual(h.order(5), ['a', 'b']);
  assert.deepEqual(h.order(6), ['b', 'a']);
});

/* ---------- tags ---------- */

// A session of `device` from `start`: a chapter typed in, with tags put in
// as the recorder puts them, each flushed as its own chunk
function tagged(device, id, start, steps) {
  const w = new R.SessionWriter({ neoRec: 1, session: id, device, book: 'book-x', startedAt: start, prev: null });
  let html = '<p>Rain.</p>';
  w.push([0, 'b', 'c1', html, R.digest(html), 'baseline']);
  const parts = [];
  const lines = {};
  for (const s of steps) {
    if (s.type) {
      const at = html.length - 4;
      w.push([s.dt || 100, 'k', 'KeyA', 0]);
      w.push([0, 'e', at, 0, s.type, 'iT']);
      html = R.applyEdit(html, at, 0, s.type);
      continue;
    }
    w.push([s.dt || 100, 'tag', s.id, s.label === undefined ? null : s.label, s.at || null, ...(s.made ? [s.made] : [])]);
    const c = w.chunk();
    parts.push(c);
    lines[s.id] = c.first + c.text.split('\n').findIndex((l) => l.includes('"tag"'));
  }
  w.push([100, 'w', R.digest(html)]);
  const c = w.chunk();
  if (c) parts.push(c);
  return { id, device, text: parts.map((p) => p.text).join(''), parts, lines, html };
}
const statsOf = (sessions) => {
  const b = new R.DayBuilder();
  return sessions.map((s) => ({ id: s.id, device: s.device, day: '2026-10-08', stats: b.day('2026-10-08', [s]).entry.sessions[0].stats }));
};

test('tags go through chunks and come back from the joined session, each on its own line', () => {
  const s = tagged('d-1', '2026-10-08T09-00-00Z-aaaa', '2026-10-08T09:00:00.000Z', [
    { type: 'x' }, { id: 't1', label: 'Draft 2' }, { type: 'y' }, { id: 't2', made: { snapshot: '20261008T090001Z-k-1-2-ab12' } }
  ]);
  const joined = R.joinParts(s.parts.slice().reverse().map((p) => ({ name: 'c-' + String(p.first).padStart(6, '0') + '.jsonl', text: p.text })));
  assert.ok(R.verifyChain(joined.text).ok);
  const tags = R.tagsOf(statsOf([{ ...s, text: joined.text }]));
  assert.deepEqual(tags.map((x) => [x.id, x.label, x.at[1]]), [['t1', 'Draft 2', s.lines.t1], ['t2', null, s.lines.t2]]);
  assert.deepEqual(tags[1].made, { snapshot: '20261008T090001Z-k-1-2-ab12' });
  // a tag's moment: the text as its line found it
  const h = new R.History([{ ...s, text: joined.text }]);
  h.build({});
  assert.equal(h.state(R.momentStep(h, tags[0].at)).c1, '<p>Rain.x</p>');
  assert.equal(h.state(R.momentStep(h, tags[1].at)).c1, '<p>Rain.xy</p>');
});

test('a later line renames or removes a tag; tags on two devices go by the time they were made', () => {
  const a = tagged('d-1', '2026-10-08T09-00-00Z-aaaa', '2026-10-08T09:00:00.000Z', [{ type: 'x' }, { id: 't1', label: 'First' }, { id: 't2', label: 'Gone soon' }]);
  const iso = '2026-10-08T09:00:00.200Z';
  // the other computer, a minute later: renames one, removes the other, adds its own
  const b = tagged('d-2', '2026-10-08T09-01-00Z-bbbb', '2026-10-08T09:01:00.000Z', [
    { id: 't1', label: 'Renamed', at: [a.id, a.lines.t1, 'd-1', iso] },
    { id: 't2', label: false, at: [a.id, a.lines.t2, 'd-1', iso] },
    { id: 't3', label: 'Mine' }
  ]);
  const tags = R.tagsOf(statsOf([a, b]));
  assert.deepEqual(tags.map((x) => [x.id, x.label, x.at[2]]), [['t1', 'Renamed', 'd-1'], ['t3', 'Mine', 'd-2']]);
  // made in the other order, the earlier line loses
  const c = tagged('d-2', '2026-10-08T08-59-00Z-cccc', '2026-10-08T08:59:00.000Z', [{ id: 't1', label: 'Older', at: [a.id, a.lines.t1, 'd-1', iso] }]);
  assert.equal(R.tagsOf(statsOf([a, c])).find((x) => x.id === 't1').label, 'First');
  // a tag on a session the history doesn't hold is left out
  assert.deepEqual(R.tagsOf(statsOf([b])).map((x) => x.id), ['t3']);
});

test('a restore’s tag is the moment before the restore: the text it replaced', () => {
  const w = new R.SessionWriter({ neoRec: 1, session: 's1', device: 'd-1', book: 'book-x', startedAt: '2026-10-08T09:00:00.000Z', prev: null });
  const old = '<p>Rain fell.</p><p>Night came.</p>';
  const now = '<p>Rain fell hard.</p><p>Night.</p>';
  w.push([0, 'b', 'c1', old, R.digest(old), 'baseline']);
  for (const sp of R.splices(old, now)) w.push([0, 'e', sp.at, sp.del, sp.ins]);
  w.push([100, 'tag', 't-r', null, null, { restore: ['s1', 2, 'd-1', '2026-10-08T09:00:00.000Z'] }]);
  w.push([0, 'x', 'restore', 's1', 2, 'd-1']);
  for (const sp of R.splices(now, old)) w.push([0, 'e', sp.at, sp.del, sp.ins]);
  w.push([100, 'w', R.digest(old)]);
  const s = { id: 's1', device: 'd-1', text: w.chunk().text };
  const [tg] = R.tagsOf(statsOf([s]));
  const h = new R.History([s]);
  h.build({});
  assert.equal(h.state(R.momentStep(h, tg.at)).c1, now, 'the tag: what the restore replaced');
  assert.equal(h.state(R.momentStep(h, tg.made.restore)).c1, old, 'its restore: the moment restored to');
  assert.equal(h.end.c1, old);
});

test('leadSteps: a player starts on the words that were there before it recorded', () => {
  const steps = [
    { k: 'session' },
    { k: 'x', cause: 'catch-up' },
    { k: 'e', cause: 'catch-up' },
    { k: 'b', cause: 'baseline' },
    { k: 's', by: 'n' },
    { k: 'e', cause: 'input' },
    { k: 'b', cause: 'baseline' }
  ];
  const view = steps.map((_, i) => i);
  assert.equal(R.leadSteps(steps, view, new Float64Array([0, 0, 0, 0, 0, 0, 40])), 5);
  // nothing before the clock moves is passed over…
  assert.equal(R.leadSteps(steps, view, new Float64Array([0, 0, 10, 10, 10, 10, 40])), 2);
  // …and a chapter made new isn't text from before
  assert.equal(R.leadSteps([{ k: 'session' }, { k: 'x', cause: 'new' }, { k: 'b', cause: 'new' }], [0, 1, 2], new Float64Array(3)), 1);
});

test('playFrom: the clock starts where the chapter shown is first there', () => {
  const steps = [
    { k: 'session' },
    { k: 'e', ch: 'a', cause: 'input' },
    { k: 'x', ch: 'b', cause: 'new' },
    { k: 'b', ch: 'b', html: '', cause: 'new' },
    { k: 'e', ch: 'b', cause: 'input' }
  ];
  const h = { steps, bad: new Set(), doc: (n) => (n >= 4 ? { a: 1, b: 1 } : { a: 1 }) };
  // the whole book: chapter a is there from the first step
  let vt = new Float64Array([0, 0, 500, 500, 900]);
  assert.equal(R.playFrom(h, [0, 1, 2, 3, 4], vt), 1);
  // chapter b alone: from once it was made, which is 0 on the clock
  vt = new Float64Array([0, 500, 500, 900]);
  assert.equal(R.playFrom(h, [0, 2, 3, 4], vt, 'b'), 3);
  assert.deepEqual([...vt], [0, 0, 0, 400]);
});
