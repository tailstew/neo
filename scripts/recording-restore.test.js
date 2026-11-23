// Restoring paragraphs (docs/neo-recording-plan.md, phase 3): carrying
// picked paragraphs through later days' states (Rec.partDays), and finding
// paragraphs in the book as it is by their words (Rec.findParagraphs).

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../recording.js');

const P = (...texts) => texts.map((x) => `<p>${x}</p>`).join('');
// a part: paragraph i of some HTML
function para(html, i) {
  const ps = R.paragraphs(html);
  let a = 0;
  for (let k = 0; k < i; k++) a += ps[k].length;
  return { a, b: a + ps[i].length };
}
// day entries and files as the cache holds them: each day the chapter whole
function days(list) {
  const entries = list.map((html, i) => ({ day: `2026-01-0${i + 1}`, kinds: html === undefined ? {} : { c1: html === null ? -1 : 0 } }));
  const files = new Map(list.map((html, i) => [`2026-01-0${i + 1}`, { chapters: html ? { c1: { full: html } } : {} }]));
  return { entries, readDay: (day) => files.get(day) };
}

const A = 'The tide came in over the stones before anyone woke.';
const B = 'Martha kept the lamp lit all night, waiting for the boat.';
const C = 'Nobody spoke of the storm again until spring.';

test('a paragraph edited on later days is carried to where it is now', () => {
  const d1 = P(A, B, C);
  const d2 = P('A new opening line.', A, B + ' Still waiting.', C);
  const d3 = P('A new opening line.', A, 'Martha kept the lamp lit all night, waiting.', C);
  const { entries, readDay } = days([d1, d2, d3]);
  const r = R.partDays(entries, 1, readDay, { ch: 'c1', ...para(d1, 1) }, d1);
  assert.equal(r.gone, false);
  assert.equal(r.html, d3);
  assert.equal(d3.slice(r.part.a, r.part.b), `<p>${'Martha kept the lamp lit all night, waiting.'}</p>`);
});

test('days that didn’t change the chapter are passed over', () => {
  const d1 = P(A, B, C);
  const { entries, readDay } = days([d1, undefined, P(A, B + '!', C)]);
  const r = R.partDays(entries, 1, readDay, { ch: 'c1', ...para(d1, 1) }, d1);
  assert.equal(r.html.slice(r.part.a, r.part.b), `<p>${B}!</p>`);
});

test('a paragraph taken out is gone, with the day and how it last read', () => {
  const d1 = P(A, B, C);
  const d2 = P(A, B + ' More.', C);
  const { entries, readDay } = days([d1, d2, P(A, C)]);
  const r = R.partDays(entries, 1, readDay, { ch: 'c1', ...para(d1, 1) }, d1);
  assert.equal(r.gone, true);
  assert.equal(r.chapter, false);
  assert.equal(r.day, '2026-01-03');
  assert.equal(r.last, `<p>${B} More.</p>`);
});

test('a chapter deleted takes its paragraphs with it', () => {
  const d1 = P(A, B, C);
  const { entries, readDay } = days([d1, null]);
  const r = R.partDays(entries, 1, readDay, { ch: 'c1', ...para(d1, 2) }, d1);
  assert.equal(r.gone, true);
  assert.equal(r.chapter, true);
  assert.equal(r.last, `<p>${C}</p>`);
});

test('the player’s text, where it differs from the cache’s, is carried to it first', () => {
  const cache = P(A, B, C);
  const player = P(A, B);
  const { entries, readDay } = days([cache, P(A, B + ' Later.', C)]);
  const r = R.partDays(entries, 1, readDay, { ch: 'c1', ...para(player, 1) }, player);
  assert.equal(r.html.slice(r.part.a, r.part.b), `<p>${B} Later.</p>`);
});

test('paragraphs moved to another chapter are found there by their words, a little changed', () => {
  const now = {
    c1: P(A, C),
    c2: P('Something else entirely, about gulls.', 'Martha kept the lamp lit all night, still waiting for the boat.', 'The end.')
  };
  const f = R.findParagraphs(P(B), now);
  assert.equal(f.ch, 'c2');
  assert.equal(now.c2.slice(f.a, f.b), '<p>Martha kept the lamp lit all night, still waiting for the boat.</p>');
  assert.ok(f.likeness > 0.5 && f.likeness < 1);
});

test('several paragraphs found together give the run from the first to the last', () => {
  const now = { c1: P('Opening.', A, 'An inserted line between them.', B, 'Closing.') };
  const f = R.findParagraphs(P(A, B), now);
  assert.equal(now.c1.slice(f.a, f.b), P(A, 'An inserted line between them.', B));
});

test('words nowhere in the book are not found, and a few words alike are not enough', () => {
  const now = { c1: P('The tide went out.', 'A boat, a lamp, a storm.') };
  assert.equal(R.findParagraphs(P(B), now), null);
  assert.equal(R.findParagraphs(P(A, B, C), { c1: P(A, 'Other words here entirely.', 'And more of them still.') }), null, 'less than half its words');
});

test('notes and other streams are never searched', () => {
  assert.equal(R.findParagraphs(P(B), { [R.STREAMS.notes]: P(B) }), null);
});

test('a paragraph moved, with another in its old place, is in doubt, and found by its words where it went', () => {
  const d1 = P(A, B, C);
  // C cut from the end and put at the top; later a new paragraph at the end
  const d2 = P(C, A, B, 'Gulls wheeled over the harbour wall at dawn.');
  const { entries, readDay } = days([d1, d2]);
  const r = R.partDays(entries, 1, readDay, { ch: 'c1', ...para(d1, 2) }, d1);
  assert.equal(r.gone, false);
  assert.equal(r.part.doubt, true, 'what stands where it was has few of its words');
  assert.equal(r.part.was, `<p>${C}</p>`);
  const f = R.findParagraphs(r.part.was, { c1: d2 });
  assert.equal(d2.slice(f.a, f.b), `<p>${C}</p>`);
});

test('a paragraph rewritten in place keeps enough of its words not to be in doubt', () => {
  const d1 = P(A, B, C);
  const d2 = P(A, 'Martha kept the old lamp lit all night long, waiting for the boat.', C);
  const { entries, readDay } = days([d1, d2]);
  const r = R.partDays(entries, 1, readDay, { ch: 'c1', ...para(d1, 1) }, d1);
  assert.ok(!r.part.doubt);
  assert.equal(d2.slice(r.part.a, r.part.b), '<p>Martha kept the old lamp lit all night long, waiting for the boat.</p>');
});

test('short paragraphs are found by their words: a line of dialogue, a heading', () => {
  const now = { c1: P(A, 'Three begins.', B), c2: P(C, 'Yes.', 'Three ends. Edited.') };
  let f = R.findParagraphs(P('Yes.'), now);
  assert.equal(f.ch, 'c2');
  assert.equal(now.c2.slice(f.a, f.b), '<p>Yes.</p>');
  f = R.findParagraphs(P('Three ends.'), now);
  assert.equal(now.c2.slice(f.a, f.b), '<p>Three ends. Edited.</p>');
  assert.equal(R.findParagraphs(P('Three finishes.'), now), null, 'one word in two alike is not enough');
});
