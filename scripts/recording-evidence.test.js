'use strict';
// The evidence report's figures (docs/neo-recording-plan.md, part 2,
// Evidence of human involvement) and a session cut down to some chapters
// for an exported replay page: npm test.

const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../recording.js');

// A session typed the way the recorder writes it: a `k` line per key and the
// edit it made at the same moment, so the RunEncoder makes runs of them
function writer(device, id, start, chapters = {}) {
  const w = new R.SessionWriter({ neoRec: 1, session: id, device, book: 'b', day: start.slice(0, 10), startedAt: start, tz: 'UTC', prev: null });
  const html = { ...chapters };
  let cur = null;
  const ends = (ch) => html[ch].length - 4; // before the last </p>
  const api = {
    html,
    base(ch, cause = 'baseline', was) {
      const h = was === undefined ? html[ch] : was;
      w.push([0, 'b', ch, cause === 'continue' ? null : h, R.digest(h), cause]);
      cur = ch;
      if (was !== undefined && was !== html[ch]) {
        w.push([0, 'x', 'catch-up']);
        for (const sp of R.splices(was, html[ch])) w.push([0, 'e', sp.at, sp.del, sp.ins]);
      }
      return api;
    },
    to(ch) { if (cur !== ch) { w.push([0, 'ch', ch]); cur = ch; } return api; },
    // types text at `at` (the end of the chapter's last paragraph unless
    // given), each key `gap` ms after the one before (a number or a function)
    type(text, gap = 150, at = ends(cur)) {
      let i = 0;
      for (const c of text) {
        const dt = typeof gap === 'function' ? gap(i++, c) : gap;
        w.push([dt, 'k', 'Key' + c.toUpperCase(), 0]);
        w.push([0, 'e', at, 0, c, 'iT']);
        html[cur] = R.applyEdit(html[cur], at, 0, c);
        at += c.length;
      }
      return api;
    },
    back(n, gap = 120) {
      let at = ends(cur);
      for (let i = 0; i < n; i++) {
        w.push([gap, 'k', 'Backspace', 0]);
        w.push([0, 'e', at - 1, 1, '', 'dB']);
        html[cur] = R.applyEdit(html[cur], at - 1, 1, '');
        at--;
      }
      return api;
    },
    enter(gap = 200) {
      const at = ends(cur) + 4;
      w.push([gap, 'k', 'Enter', 0]);
      w.push([0, 'e', at, 0, '<p></p>', 'iP']);
      html[cur] = R.applyEdit(html[cur], at, 0, '<p></p>');
      return api;
    },
    paste(text, { internal = false, dt = 500 } = {}) {
      const at = ends(cur);
      w.push([dt, 'k', 'KeyV', 2]);
      w.push([0, 'c', 'paste', text.length, 'text', R.digest(text), ...(internal ? [true] : [])]);
      w.push([0, 'e', at, 0, text, 'iFP']);
      html[cur] = R.applyEdit(html[cur], at, 0, text);
      return api;
    },
    dictate(text, dt = 800) {
      const at = ends(cur);
      w.push([dt, 'e', at, 0, text, 'iT', 0]);
      html[cur] = R.applyEdit(html[cur], at, 0, text);
      return api;
    },
    // a change with no key, just after the caret was placed: a spelling
    // suggestion picked (with spell, as NEO writes one now), or dictation
    fix(at, del, ins, { spell = false } = {}) {
      w.push([400, 's', 0, at - 3]);
      if (spell) w.push([0, 'x', 'spell']);
      w.push([1500, 'e', at, del, ins, 'iT', 0]);
      html[cur] = R.applyEdit(html[cur], at, del, ins);
      return api;
    },
    // Backspace n times from `at`
    backAt(at, n, gap = 120) {
      for (let i = 0; i < n; i++) {
        w.push([gap, 'k', 'Backspace', 0]);
        w.push([0, 'e', at - 1, 1, '', 'dB']);
        html[cur] = R.applyEdit(html[cur], at - 1, 1, '');
        at--;
      }
      return api;
    },
    // a line as the recorder wrote it; an `e` is applied to the chapter
    line(l) { w.push(l); if (l[1] === 'e') html[cur] = R.applyEdit(html[cur], l[2], l[3], l[4]); return api; },
    focus(what, dt = 0) { w.push([dt, 'f', what]); return api; },
    write() { for (const ch of Object.keys(html)) { w.push([0, 'w', R.digest(html[ch]), ch]); } return api; },
    done() {
      api.write();
      const c = w.chunk();
      return { id, device, text: c.text };
    }
  };
  return api;
}

const P = (s) => `<p>${s}</p>`;

test('keys, typing, revision and quick fixes are counted per chapter and for the book', () => {
  const s = writer('d-1', '2026-10-01T09-00-00Z-aaaa', '2026-10-01T09:00:00.000Z', { a: P('Start.'), b: P('Other.') })
    .base('a').type(' One two', 150).back(3, 300) // the first Backspace 300 ms after the last letter: a quick fix
    .type('wo', 150).base('b').type(' xyz', 100).done();
  const e = R.evidence([s]);
  assert.equal(e.chapters.a.typed, 10);
  assert.equal(e.chapters.a.deleted, 3);
  assert.equal(e.chapters.a.fixes, 1);
  assert.equal(e.chapters.a.bursts, 1);
  assert.equal(e.chapters.b.typed, 4);
  assert.equal(e.book.typed, 14);
  assert.equal(e.book.keys, 17);
  assert.equal(e.chapters.a.before, 1);
  assert.equal(e.words.a, 3);
  assert.deepEqual(e.order, null);
  assert.equal(e.sessions[0].typed, 14);
  // replays to what the session wrote
  assert.ok(R.replayCheck([s.text]).ok);
});

test('pauses are told apart by where the letter after them went', () => {
  // inside a word 100 ms, after a space 300, at a sentence's start 900, at a paragraph's 2000
  const gap = (i, c) => c === ' ' ? 100 : 100;
  const w = writer('d-1', '2026-10-01T09-00-00Z-aaaa', '2026-10-01T09:00:00.000Z', { a: P('') }).base('a');
  for (let k = 0; k < 30; k++) {
    w.enter(150);
    w.type('Ab', (i) => (i === 0 ? 2000 : 100));
    w.type(' cd', (i) => (i === 1 ? 300 : 100));
    w.type('. Ef', (i) => (i === 2 ? 900 : gap(i, '')));
  }
  const e = R.evidence([w.done()]);
  const read = R.evidenceRead(e.chapters.a, e.chars.a);
  assert.equal(read.pauseN.para, 30);
  assert.equal(read.pauseN.sentence, 30);
  assert.equal(read.pauseN.word, 30);
  assert.equal(read.pauseN.inside, 90);
  const near = (v, want) => Math.abs(v - want) / want < 0.1;
  assert.ok(near(read.pause.para, 2000), String(read.pause.para));
  assert.ok(near(read.pause.sentence, 900), String(read.pause.sentence));
  assert.ok(near(read.pause.word, 300), String(read.pause.word));
  assert.ok(near(read.pause.inside, 100), String(read.pause.inside));
});

test('going back into earlier text is counted; typing on at the end is not', () => {
  const long = 'x'.repeat(800);
  const w = writer('d-1', '2026-10-01T09-00-00Z-aaaa', '2026-10-01T09:00:00.000Z', { a: P(long) }).base('a');
  w.type('abc');
  w.type('def', 150, 10); // back near the start
  w.type('ghi');          // and on at the end again: not a return, it's forward
  const e = R.evidence([w.done()]);
  assert.equal(e.chapters.a.returns, 1);
  assert.equal(e.chapters.a.inside, 3);
  assert.equal(e.chapters.a.typed, 9);
});

test('pastes from outside, pastes soon after coming back, and edits with no key', () => {
  const w = writer('d-1', '2026-10-01T09-00-00Z-aaaa', '2026-10-01T09:00:00.000Z', { a: P('Begin.') }).base('a');
  w.paste('short one');
  w.paste('copied in this book', { internal: true });
  w.focus('blur', 1000).focus('focus', 30000);
  w.paste('y'.repeat(300), { dt: 4000 });
  w.dictate(' spoken words');
  const e = R.evidence([w.done()]);
  const a = e.chapters.a;
  assert.equal(a.pastes, 2);
  assert.equal(a.pasted, 9 + 300);
  assert.equal(a.own, 1);
  assert.equal(a.soon, 1);
  assert.equal(a.soonPasted, 300);
  assert.equal(a.nokey, 1);
  assert.equal(a.nokeyChars, 13);
  assert.deepEqual(a.nokeyKinds, { insertText: 1 });
  assert.equal(a.typed, 0); // nothing typed: a paste isn't typing
  const read = R.evidenceRead(a, e.chars.a);
  assert.ok(read.pastedShare > 0.8 && read.pastedShare < 1, String(read.pastedShare));
});

test('a key a program sent is counted as not trusted', () => {
  const w = writer('d-1', '2026-10-01T09-00-00Z-aaaa', '2026-10-01T09:00:00.000Z', { a: P('Hi') }).base('a');
  w.type('ab');
  // what the recorder writes for an untrusted key: it never joins a run
  w.html.a = R.applyEdit(w.html.a, 4, 0, 'c');
  const s = w.done();
  const lines = s.text.split('\n');
  const at = lines.findIndex((l) => l.includes('"w"'));
  lines.splice(at, 0, JSON.stringify([90, 'k', 'KeyC', R.MOD.untrusted]), JSON.stringify([0, 'e', 4, 0, 'c', 'iT']));
  // (the chain no longer matters: evidence reads lines, and replay has its own test)
  const e = R.evidence([{ ...s, text: lines.join('\n') }]);
  assert.equal(e.chapters.a.untrusted, 1);
  assert.equal(e.chapters.a.typed, 3);
});

test('words from before the recording count once, and another device’s recorded words aren’t “outside”', () => {
  const start = P('Five words were here first.');
  // the laptop records the chapter from the start and types in it
  const a = writer('d-1', '2026-10-01T09-00-00Z-aaaa', '2026-10-01T09:00:00.000Z', { a: start }).base('a').type(' More words here.');
  const left = a.html.a;
  const sa = a.done();
  // the desktop never saw it: its first sight is a baseline, of the laptop's text
  const sb = writer('d-2', '2026-10-02T09-00-00Z-bbbb', '2026-10-02T09:00:00.000Z', { a: left }).base('a').type(' Desk.').done();
  // then the laptop again, catching up with the desktop's words (recorded there), and then with words nobody recorded
  const desk = R.applyEdit(left, left.length - 4, 0, ' Desk.');
  const sneaked = R.applyEdit(desk, desk.length - 4, 0, ' Typed elsewhere entirely.');
  const c = writer('d-1', '2026-10-03T09-00-00Z-cccc', '2026-10-03T09:00:00.000Z', { a: sneaked }).base('a', 'continue', left);
  const sc = c.type('!').done();
  const e = R.evidence([sa, sb, sc]);
  assert.equal(e.chapters.a.before, 5);      // the laptop's baseline only; the desktop's was on the page already
  assert.equal(e.chapters.a.outside, 3);     // "Typed elsewhere entirely", not "Desk"
  assert.equal(e.chapters.a.days, 3);
  assert.equal(e.chapters.a.sessions, 3);
});

test('a chapter not chosen is left out, and streams never count', () => {
  const w = writer('d-1', '2026-10-01T09-00-00Z-aaaa', '2026-10-01T09:00:00.000Z', { a: P('A.'), b: P('B.'), ':notes': P('N.') })
    .base('a').type('aa').base('b').type('bbb').base(':notes').type('nnnn');
  const s = w.done();
  const all = R.evidence([s]);
  assert.deepEqual(Object.keys(all.chapters).sort(), ['a', 'b']);
  assert.equal(all.book.typed, 5);
  const some = R.evidence([s], { chapters: ['b'] });
  assert.deepEqual(Object.keys(some.chapters), ['b']);
  assert.equal(some.book.typed, 3);
  assert.deepEqual(Object.keys(some.words), ['b']);
});

test('spelling suggestions picked are counted as such, not as text with no key', () => {
  const w = writer('d-1', '2026-10-01T09-00-00Z-aaaa', '2026-10-01T09:00:00.000Z', { a: P('I wnet hoem thee.') }).base('a');
  w.fix(6, 3, 'ent', { spell: true });   // NEO writes `x spell` before it
  w.fix(11, 3, 'ome');                   // a session from before it did: the caret placed, letters inside a word
  w.fix(18, 1, '');                      // …or only taken out ("thee" to "the")
  w.fix(18, 0, ' and spoke');            // words after the caret, with a space: dictation, still no key
  const e = R.evidence([w.done()]);
  const a = e.chapters.a;
  assert.equal(w.html.a, P('I went home the and spoke.'));
  assert.equal(a.spell, 3);
  assert.equal(a.nokey, 1);
  assert.equal(a.nokeyChars, 10);
  const read = R.evidenceRead(a, e.chars.a);
  assert.equal(read.spell, 3);
  assert.equal(read.nokey, 1);
});

test('revising as typed and in earlier text, and deletions in a row', () => {
  const long = 'x'.repeat(800);
  const w = writer('d-1', '2026-10-01T09-00-00Z-aaaa', '2026-10-01T09:00:00.000Z', { a: P(long) }).base('a');
  w.type('abcd').back(1).type('e').back(2).type('z'); // at the end: a run of 1, then a run of 2
  w.backAt(13, 6);                           // back near the start: a run of 6, in earlier text
  w.type('q', 150, 7);
  const e = R.evidence([w.done()]);
  const a = e.chapters.a;
  assert.equal(a.deleted, 9);
  assert.equal(a.delInside, 6);
  assert.deepEqual(a.runs, [1, 1, 0, 1, 0]);
  assert.equal(a.bursts, 1);
  const read = R.evidenceRead(a, e.chars.a);
  assert.equal(read.deletedAtEnd, 3);
  assert.equal(read.typedAtEnd, 6);
  assert.equal(read.inside, 1);
  assert.equal(read.returns, 1);
});

test('the gaps between keys, in coarse bars', () => {
  const w = writer('d-1', '2026-10-01T09-00-00Z-aaaa', '2026-10-01T09:00:00.000Z', { a: P('') }).base('a');
  w.type('abcdef', 30);    // under 50 ms
  w.type('ghij', 150);     // 100–200 ms
  w.type('k', 5000);       // 3.2 s to a minute
  w.type('l', 120000);     // time away: not rhythm at all
  const r = R.evidenceRead(R.evidence([w.done()]).book);
  assert.equal(r.rhythm.length, R.EV_GAPS.length + 1);
  assert.deepEqual(r.rhythm, [5, 0, 4, 0, 0, 0, 0, 1]);
  assert.equal(r.judge, undefined); // figures only: no judgements
});

test('a session cut down to some chapters still replays, on the same clock', () => {
  const w = writer('d-1', '2026-10-01T09-00-00Z-aaaa', '2026-10-01T09:00:00.000Z', { a: P('A.'), b: P('B.'), ':titles': '{}' })
    .base('a').type('aa', 200).base('b').type('bbbb', 300).to('a').type('a', 400).back(1).base(':titles').type('x');
  w.focus('blur', 50);
  const s = w.done();
  const cut = R.keepChapters(s.text, ['a']);
  const { header, lines } = R.parseSession(cut);
  assert.deepEqual(header.kept, ['a']);
  // nothing of the computer: no platform, no time zone, and the day still known
  assert.equal(header.platform, undefined);
  assert.equal(header.tz, undefined);
  assert.equal(R.sessionDay(header), R.sessionDay(R.parseSession(s.text).header));
  const old = R.keepChapters(s.text.replace(/^\{/, '{"platform":"MacIntel","tz":"America/New_York",').replace(/"day":"[^"]*",?/, ''), ['a']);
  const oh = R.parseSession(old).header;
  assert.ok(!old.includes('MacIntel') && !old.includes('New_York'));
  assert.equal(oh.day, '2026-10-01');
  assert.ok(lines.every((l) => l[1] !== 'h'));
  assert.ok(!cut.includes('B.') && !cut.includes('bbbb') && !cut.includes(':titles'));
  const r = R.replayCheck([cut]);
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.chapters.a, w.html.a);
  assert.equal(r.writes, 1);
  // the time the lines that went took is carried on: the session lasts as long
  assert.equal(R.compileSession(cut).duration, R.compileSession(s.text).duration);
  // and the evidence of the kept chapter is the whole session's of it, but for the gaps across the cut
  const whole = R.evidence([s]).chapters.a;
  const part = R.evidence([{ ...s, text: cut }]).chapters.a;
  for (const k of ['typed', 'deleted', 'returns', 'pastes', 'nokey', 'before']) assert.equal(part[k], whole[k], k);
});


// Windows dictation (Win+H) as the laptop recorded it on 2026-11-14:
// composition with no key down, a phrase at a time, a spoken "backspace"
// typed, taken back and done; then the Japanese IME, a key before each step
test('text composed with no key pressed is counted as such, and marked as stretches on the timeline', () => {
  const w = writer('d-1', '2026-11-14T13-00-00Z-aaaa', '2026-11-14T13:00:00.000Z', { a: P('Begin.') }).base('a');
  const at = 9; // after "Begin."
  w.line([2000, 'f', 'compose'])
    .line([1, 'e', at, 0, ' mary', 'iC', 0])
    .line([300, 'e', at + 5, 0, ' had', 'iC', 0])
    .line([20, 'e', at, 9, ' Mary had', 'iC', 0])
    .line([0, 'f', 'composed'])
    .line([1400, 'f', 'compose'])
    .line([1, 'e', at + 9, 0, ' back', 'iC', 0])
    .line([15, 'e', at + 14, 0, 'space', 'iC', 0])
    .line([250, 'e', at + 9, 10, '', 'iC', 0])
    .line([0, 'f', 'composed'])
    .line([34, 'k', '', 0]).line([0, 'e', at + 8, 1, '', 'dB'])
    // a key: the stretch ends
    .type('x')
    // the IME: each composing step comes with its key
    .line([800, 'f', 'compose'])
    .line([100, 'k', 'KeyK', 0]).line([0, 'e', at + 9, 0, 'ｋ', 'iC'])
    .line([100, 'k', 'KeyO', 0]).line([0, 'e', at + 9, 1, 'こ', 'iC'])
    .line([300, 'k', 'Enter', 0]).line([0, 'f', 'composed'])
    // an emoji picked from the panel with the mouse: no letter, not marked
    .line([5000, 'f', 'compose']).line([1, 'e', at + 10, 0, '😉', 'iC', 0]).line([0, 'f', 'composed']);
  const s = w.done();
  const e = R.evidence([s]);
  assert.equal(e.chapters.a.nokeyKinds.insertCompositionText, 7, 'the dictation’s six and the emoji, not the IME');
  const { steps } = R.compileSession(s.text);
  const marks = [];
  const said = R.keylessStretches((n) => 'said ' + n);
  steps.forEach((st, i) => said.step(st, st.t, i, marks));
  said.end(marks);
  assert.deepEqual(marks.map((m) => m.label), ['said 8'], 'one stretch: " Mary ha" once its backspace is done');
  assert.equal(marks[0].kind, 'nokey');
  assert.ok(marks[0].to > marks[0].x);
});
