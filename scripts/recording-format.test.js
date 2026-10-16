'use strict';

// Tripwires for Writing History's format. Writers keep their recordings for
// years, synced between computers running different versions of NEO, so a
// change to what a line means, how a caret is counted, or what the player
// makes of a session must be on purpose. These tests read sessions frozen in
// scripts/fixtures/recording-v<N>/ and fail when today's code reads them
// differently. Never regenerate a fixture to make one pass: an old session
// on a writer's disk can't be regenerated either.
//
// When one fails:
//   what a line means changed  → FORMAT + 1, keep the old number in READS
//                                 with its own branch, add a v<FORMAT> fixture
//   the player's steps changed → PLAYER + 1 (cached days are built again),
//                                 and add its fingerprint below
//   a class lost its rule      → keep styling it for .rp-body: old sessions
//                                 still hold that HTML

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const R = require('../recording.js');

const ROOT = path.join(__dirname, '..');
const FIXTURES = path.join(__dirname, 'fixtures');
// a source file as text, whatever line endings the checkout gave it
const source = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8').replace(/\r\n/g, '\n');

function fixture(v) {
  const dir = path.join(FIXTURES, 'recording-v' + v);
  return fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort()
    .map((f) => ({ id: f.replace(/\.jsonl$/, ''), device: 'd-0123456789abcdef', text: fs.readFileSync(path.join(dir, f), 'utf8') }));
}
const v1 = fixture(1);
// the first two, frozen before tags: what these tests measured from the start
const v1First = v1.slice(0, 2);

const NEW_FORMAT = 'what a format-1 line means has changed. If that is on purpose, it is a new format: ' +
  'raise FORMAT in recording.js, keep 1 in READS with a branch that still reads it this way, ' +
  'and add scripts/fixtures/recording-v2/. Writers have years of format-1 sessions.';

/* ---------- every format ever written is still read ---------- */

test('every recording format NEO has written is still read, and has a frozen fixture', () => {
  for (let v = 1; v <= R.FORMAT; v++) {
    assert.ok(R.READS.includes(v), `format ${v} was dropped from READS: every session written in it would stop playing`);
    assert.ok(fs.existsSync(path.join(FIXTURES, 'recording-v' + v)), `format ${v} has no fixture in scripts/fixtures/recording-v${v}/`);
  }
  assert.ok(!R.READS.some((v) => v > R.FORMAT), 'READS holds a format newer than FORMAT');
});

test('the fixture files reached the disk byte for byte (no CRLF from git)', () => {
  for (const s of v1) {
    assert.ok(!s.text.includes('\r'), `${s.id} has CR in it: .gitattributes must keep scripts/fixtures/*.jsonl as -text`);
    const chain = R.verifyChain(s.text);
    assert.ok(chain.ok, `${s.id}: ${JSON.stringify(chain.breaks)}`);
  }
  for (let i = 1; i < v1.length; i++) assert.equal(R.parseSession(v1[i].text).header.prev, R.verifyChain(v1[i - 1].text).last, 'the sessions chain together');
});

test('the format-1 fixture uses every kind of line recording.js describes', () => {
  // the table at the top of recording.js: "//   kind  fields…"
  const src = source('recording.js');
  const top = src.slice(0, src.indexOf('(function'));
  const kinds = [...top.matchAll(/^\/\/ {3}([A-Za-z]+) +\S/gm)].map((m) => m[1]);
  assert.ok(kinds.length >= 18, 'could not read the table of line kinds: ' + kinds.join(' '));
  const used = new Set();
  for (const s of v1) for (const l of R.parseSession(s.text).lines) if (Array.isArray(l)) used.add(l[1]);
  for (const k of kinds) {
    assert.ok(used.has(k), `the line kind "${k}" isn't in scripts/fixtures/recording-v1/. A new kind is a new format (old NEOs skip it): see the top of this file`);
  }
  for (const k of used) assert.ok(kinds.includes(k), `the fixture has a "${k}" line that recording.js doesn't describe`);
});

/* ---------- what a format-1 line means ---------- */

test('format 1 still parses, replays and hashes as it did', () => {
  for (const s of v1) {
    const p = R.parseSession(s.text);
    assert.ok(p.known, `${s.id} is no longer read: ${NEW_FORMAT}`);
    assert.equal(p.format, 1);
  }
  const r = R.replayCheck(v1First.map((s) => s.text));
  assert.ok(r.ok, NEW_FORMAT + '\n' + JSON.stringify({ problems: r.problems, bad: r.bad }));
  assert.equal(r.writes, 4);
  assert.deepEqual(r.chapters, {
    'ch-a': '<p>The rain came down “hard” indeed Again.</p><p class="scene-break">***</p><p>She left the gate open.</p>'
  }, NEW_FORMAT);
});

test('format 1’s runs still expand to the same keys, edits and carets', () => {
  // one k and one e or s per key, as the recorder saw them before encoding
  const got = v1First.map((s) => R.expandRuns(R.parseSession(s.text).lines));
  const keys = got.flat().filter((l) => l[1] === 'k').map((l) => l[2] + (l[3] ? '+' + l[3] : '')).join(' ');
  assert.equal(keys,
    'Space KeyD KeyO KeyW KeyN Space Quote+1 KeyH KeyA KeyR KeyD Quote+1 Space KeyQ Backspace Backspace ' +
    'ArrowLeft ArrowLeft ArrowLeft ArrowRight+1 KeyB+2 Delete Delete+16 Quote+1 KeyH KeyV+2 KeyS ' +
    'Space KeyW+1 KeyI KeyD KeyE KeyZ+2', NEW_FORMAT);
  const carets = got.flat().filter((l) => l[1] === 's').map((l) => l.slice(2).join(','));
  assert.deepEqual(carets, ['0,13,p', '0,25', '0,24', '0,23', '0,22', '0,22,0,23', '0,19', '2,4,p', '2,13,2,17,p', '1,8,p', '2,23,p'], NEW_FORMAT);
  assert.equal(R.digest(JSON.stringify(got)), 'EbndyGqd0BjpzC0Bx8RV8g', NEW_FORMAT);
});

test('format 1’s codes and bits mean what they did', () => {
  assert.equal(R.CARET_BLOCK, 'p', 'an s line counts <p>s in format 1. ' + NEW_FORMAT);
  assert.deepEqual(R.MOD, { shift: 1, ctrl: 2, alt: 4, meta: 8, repeat: 16, untrusted: 32 }, NEW_FORMAT);
  // a new inputType may be added; a code can't change or go
  const v1Codes = {
    insertText: 'iT', insertParagraph: 'iP', insertLineBreak: 'iL', insertFromPaste: 'iFP',
    insertFromDrop: 'iFD', insertReplacementText: 'iRT', insertCompositionText: 'iC',
    insertHTML: 'iH', insertFromYank: 'iFY', insertTranspose: 'iTr',
    deleteContentBackward: 'dB', deleteContentForward: 'dF', deleteWordBackward: 'dWB',
    deleteWordForward: 'dWF', deleteSoftLineBackward: 'dSLB', deleteSoftLineForward: 'dSLF',
    deleteHardLineBackward: 'dHLB', deleteHardLineForward: 'dHLF', deleteByCut: 'dX',
    deleteByDrag: 'dD', deleteContent: 'dC',
    historyUndo: 'hU', historyRedo: 'hR',
    formatBold: 'fB', formatItalic: 'fI', formatUnderline: 'fU', formatStrikeThrough: 'fS'
  };
  for (const [name, code] of Object.entries(v1Codes)) {
    assert.equal(R.INPUT_TYPES[name], code, `inputType ${name} was written as "${code}" in format 1. ` + NEW_FORMAT);
    assert.equal(R.inputName(code), name);
  }
});

/* ---------- carets land where they were ---------- */

// The text of paragraph pIdx of a chapter's HTML, split at a caret `off`
// letters in: what recPoint counted and historyPoint finds, without a DOM.
// Enough for the fixture, whose paragraphs don't nest.
function caretSplit(html, pIdx, off) {
  const open = new RegExp('<' + R.CARET_BLOCK + '\\b[^>]*>', 'g');
  let m;
  for (let i = 0; (m = open.exec(html)) && i < pIdx; i++);
  assert.ok(m, `no paragraph ${pIdx}`);
  const from = m.index + m[0].length;
  const text = html.slice(from, html.indexOf('</' + R.CARET_BLOCK + '>', from)).replace(/<[^>]*>/g, '');
  return [text.slice(0, off), text.slice(off)];
}

test('a format-1 caret still lands on the letters it was recorded at', () => {
  const h = new R.History(v1First);
  h.build({}, { every: 5 });
  const seen = [];
  h.steps.forEach((s, i) => {
    if (s.k !== 's' || s.by !== 'p') return;
    const html = h.state(i)[s.ch];
    const [, after] = caretSplit(html, s.a[0], s.a[1]);
    const [, sel] = caretSplit(html, s.f[0], s.f[1]);
    seen.push(s.a.join() === s.f.join() ? '|' + after : after.slice(0, after.length - sel.length));
  });
  assert.deepEqual(seen, ['|', '|left the gate open.', 'gate', '|', '|'],
    'a recorded caret no longer lands where the writer put it. ' + NEW_FORMAT);
});

test('the window counts carets with Rec.CARET_BLOCK, the same way it records them', () => {
  const app = source('app.js');
  for (const name of ['recPoint', 'historyPoint']) {
    const at = app.indexOf(`function ${name}(`);
    assert.ok(at >= 0, `app.js has no ${name}`);
    const body = app.slice(at, app.indexOf('\n}\n', at));
    assert.ok(body.includes('Rec.CARET_BLOCK'), `${name} must count Rec.CARET_BLOCK, or recorded carets and played carets disagree`);
    assert.ok(!/(querySelectorAll|closest)\(\s*['"]/.test(body), `${name} counts a block of its own instead of Rec.CARET_BLOCK`);
  }
});

/* ---------- the player and its cache ---------- */

// The days the cache keeps of the format-1 fixture, one session a day
function days(sessions) {
  const b = new R.DayBuilder();
  return sessions.map((x) => b.day(R.sessionDay(R.parseSession(x.text).header), [x]));
}

// What PLAYER's number vouches for: the steps and keyframes a History makes
// of the format-1 fixture, and the days the cache keeps of it (from 5 on,
// the session with tags too). Add a line when PLAYER moves on; never edit one.
const PLAYER_FINGERPRINTS = {
  1: 'hg23E-vVGuQIZXgIsGSFbw',
  2: 'xbHUWHB2DFtMfqIHCwPosw',
  3: 'vacLbqay6MQQMDO7U1BK4w',
  4: 'critEwgcdtDFZt0cc4keLw',
  5: '8HbjOIYIxuPvJhIfPZzmDw',
  6: 'k_7K1mTdtsqC_OpVKJA2jQ'
};

test('the player makes the same steps, keyframes and days, or PLAYER moved on', () => {
  const h = new R.History(v1);
  h.build({}, { every: 5 });
  const keyframes = h.keyframes.map((k) => [k.at, Object.entries(k.chapters).map(([ch, c]) => [ch, c.toString()])]);
  const print = R.digest(JSON.stringify({ steps: h.steps, keys: h.keys, keyframes, end: h.end, days: days(v1) }));
  const known = PLAYER_FINGERPRINTS[R.PLAYER];
  assert.ok(known, `PLAYER is ${R.PLAYER}: add its fingerprint, ${print}, to PLAYER_FINGERPRINTS`);
  assert.equal(print, known,
    'the player or the cache makes something different of format-1 sessions. Writers have those cached: ' +
    'raise PLAYER in recording.js so the cache is built again, and add the new fingerprint here.');
});

test('a cached day’s key names the PLAYER that made it, and every session up to it, with its device', () => {
  let ancestry = 'player ' + R.PLAYER;
  const built = days(v1);
  v1.forEach((s, i) => {
    ancestry = R.sha256(ancestry + ':' + (s.device || '') + '/' + s.id + ':' + R.verifyChain(s.text).last);
    assert.equal(built[i].entry.key, ancestry, 'a day’s key must change with PLAYER, or days from an older player are used');
  });
});

/* ---------- tags ---------- */

test('format-1 tags still name the moments they named', () => {
  const built = days(v1);
  const sessions = v1.map((s, i) => ({ id: s.id, device: s.device, day: built[i].entry.day, stats: built[i].entry.sessions[0].stats }));
  const tags = R.tagsOf(sessions);
  // renamed by a later line, one removed, NEO's own unnamed: oldest moment first
  assert.deepEqual(tags.map((x) => [x.id, x.label, x.at[0].slice(0, 10), x.at[1]]), [
    ['t-cut', 'Before the big cut', '2026-10-06', 6],
    ['t-draft', 'Second draft', '2026-10-08', 4],
    ['t-snap', null, '2026-10-08', 7],
    ['t-rest', null, '2026-10-08', 14]
  ], NEW_FORMAT);
  assert.deepEqual(tags[2].made, { snapshot: '20261008T083002Z-k-1-11-ab12' });
  const h = new R.History(v1);
  h.build({});
  const at = (x) => h.state(R.momentStep(h, x.at))['ch-a'];
  // a tag on an earlier moment is that moment; a restore's is the text it replaced
  assert.equal(at(tags[0]), '<p>The rain came</p><p class="scene-break">***</p><p>She left the door open.</p>', NEW_FORMAT);
  assert.equal(at(tags[3]), '<p>The rain came down “hard” indeed Again.</p><p class="scene-break">***</p><p>She left the gate open. </p>', NEW_FORMAT);
  assert.deepEqual(tags[3].made.restore.slice(0, 3), tags[0].at, 'a restore’s tag names the moment restored to');
  assert.equal(h.end['ch-a'], at(tags[0]), 'and the restore made the chapter that moment’s');
});

/* ---------- the player draws old HTML with today's CSS ---------- */

test('every class format-1 chapters hold is still styled in the player', () => {
  const css = source('styles.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const selectors = [...css.matchAll(/([^{}]+)\{/g)].map((m) => m[1]).filter((s) => s.includes('.rp-body'));
  const classes = new Set();
  const h = new R.History(v1);
  for (const s of h.steps) {
    for (const html of [s.html, s.ins]) {
      if (typeof html !== 'string') continue;
      for (const m of html.matchAll(/class="([^"]*)"/g)) for (const c of m[1].split(/\s+/)) if (c) classes.add(c);
    }
  }
  assert.ok(classes.size >= 3);
  for (const c of classes) {
    const re = new RegExp('\\.' + c.replace(/[-]/g, '\\-') + '(?![\\w-])');
    assert.ok(selectors.some((s) => re.test(s)),
      `no rule in styles.css styles .${c} inside .rp-body. Recorded chapters still hold it: keep a rule for it under :is(.chapter-body, .rp-body)`);
  }
});

/* ---------- headers ---------- */

test('a header field format 1 didn’t start with is read past', () => {
  const head = R.parseSession(v1[1].text).header;
  assert.equal(head.platform, 'Win32');
  assert.equal(R.parseSession(v1[0].text).header.platform, undefined);
  assert.ok(R.parseSession(v1[0].text).known && R.parseSession(v1[1].text).known);
});
