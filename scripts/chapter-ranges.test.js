'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

// Export Writing History…'s chapters, typed as a print dialog's pages:
// chapterRanges and chapterRangesText from app.js, run on their own
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const context = vm.createContext({});
vm.runInContext(app.slice(app.indexOf('function chapterRanges('), app.indexOf('// Export Writing History…: which chapters go.')), context);
const ranges = (text, n) => JSON.parse(JSON.stringify(vm.runInContext('chapterRanges', context)(text, n)));
const write = (ids) => vm.runInContext('chapterRangesText', context)(ids);

test('numbers and ranges, as a print dialog takes pages', () => {
  assert.deepEqual(ranges('1-3,10,21-30', 30), [0, 1, 2, 9, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29]);
  assert.deepEqual(ranges('7', 30), [6]);
});

test('any dash, commas, semicolons or spaces between, in any order, once each', () => {
  assert.deepEqual(ranges('1 - 3; 7', 10), [0, 1, 2, 6]);
  assert.deepEqual(ranges('1–3 9 5—6', 10), [0, 1, 2, 4, 5, 8]);
  assert.deepEqual(ranges('3, 1, 2, 2, 1-2', 10), [0, 1, 2]);
  assert.deepEqual(ranges(' 2 -4 ', 10), [1, 2, 3]);
});

test('not a list: empty, a number outside the book, a range backwards, words', () => {
  for (const bad of ['', '  ', '0', '11', '5-3', '1-11', 'a', '1,x', '1--3', '-2']) assert.equal(ranges(bad, 10), null, bad);
});

test('written back as short as it goes', () => {
  assert.equal(write([0, 1, 2, 6, 9, 10]), '1–3, 7, 10–11');
  assert.equal(write([4, 0, 4]), '1, 5');
  assert.equal(write([]), '');
  assert.deepEqual(ranges(write([0, 1, 2, 6, 9, 10]), 11), [0, 1, 2, 6, 9, 10]);
});
