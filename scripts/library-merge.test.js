'use strict';

// library.json is written by every device that shares the library. A write
// merges with what's on disk (libraryMerged, mergeShelves in app.js): what
// this device changed since it last read or wrote the file is its own, what
// another changed is kept. Before, the phone wrote what it held in memory and
// undid the laptop's timestamp services; the sync program set one aside.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const from = app.indexOf('let libraryBase = null;');
const to = app.indexOf('// What another device changed reached this window');
const look = app.slice(app.indexOf('const DEVICE_LOOK = '), app.indexOf('\n', app.indexOf('const DEVICE_LOOK = ')));

function merger(disk) {
  const context = vm.createContext({ window: { neo: { readLibrary: async () => JSON.parse(JSON.stringify(disk)) } }, JSON });
  vm.runInContext(look + '\n' + app.slice(from, to) + '\nthis.api = { libraryMerged, mergeShelves, setBase: (b) => { libraryBase = b; } };', context);
  return context.api;
}
const plain = (v) => JSON.parse(JSON.stringify(v));
const lib = (extra = {}) => ({
  firstRunDone: true,
  shelves: [{ id: 's1', name: 'Works in Progress', bookIds: ['a', 'b'] }, { id: 's2', name: 'Short Stories', bookIds: ['c'] }],
  ...extra
});

test('a setting another device changed is kept; one changed here is ours', async () => {
  const base = lib({ typewriter: false, spellLanguage: 'en' });
  const disk = lib({ typewriter: false, spellLanguage: 'en', proofTsas: [{ id: 'globalsign', on: false }] }); // the laptop
  const ours = lib({ typewriter: false, spellLanguage: 'fr' }); // the phone, from memory
  const m = merger(disk);
  m.setBase(plain(base));
  assert.equal(await m.libraryMerged(ours), true);
  assert.deepEqual(ours.proofTsas, [{ id: 'globalsign', on: false }], 'the other device\'s timestamp services stay');
  assert.equal(ours.spellLanguage, 'fr', 'and this device\'s change is its own');
});

test('nobody else wrote: nothing is taken', async () => {
  const base = lib({ spellLanguage: 'en' });
  const ours = lib({ spellLanguage: 'de' });
  const m = merger(base);
  m.setBase(plain(base));
  assert.equal(await m.libraryMerged(ours), false);
  assert.equal(ours.spellLanguage, 'de');
});

test('this device\'s look is its own, whatever the other device left', async () => {
  const base = lib({ pageTheme: 'night' });
  const disk = lib({ pageTheme: 'light' });
  const ours = lib({ pageTheme: 'night' });
  const m = merger(disk);
  m.setBase(plain(base));
  await m.libraryMerged(ours);
  assert.equal(ours.pageTheme, 'night');
});

test('a key the other device took out goes, unless changed here', async () => {
  const base = lib({ exportFolderHint: 'x', note: 1 });
  const disk = lib({ note: 1 });
  const ours = lib({ exportFolderHint: 'x', note: 2 });
  const m = merger(disk);
  m.setBase(plain(base));
  await m.libraryMerged(ours);
  assert.equal('exportFolderHint' in ours, false);
  assert.equal(ours.note, 2);
});

test('shelves: a book put on there and one taken off here both stand', () => {
  const { mergeShelves } = merger(lib());
  const base = lib().shelves;
  const ours = [{ id: 's1', name: 'Works in Progress', bookIds: ['a'] }, { id: 's2', name: 'Short Stories', bookIds: ['c'] }]; // b off here
  const theirs = [{ id: 's1', name: 'Works in Progress', bookIds: ['a', 'b'] }, { id: 's2', name: 'Short Stories', bookIds: ['c', 'd'] }]; // d on there
  assert.deepEqual(plain(mergeShelves(base, ours, theirs)), [
    { id: 's1', name: 'Works in Progress', bookIds: ['a'] },
    { id: 's2', name: 'Short Stories', bookIds: ['c', 'd'] }
  ]);
});

test('shelves: renamed there, a book added here; a shelf made there; one taken out there', () => {
  const { mergeShelves } = merger(lib());
  const base = [{ id: 's1', name: 'WIP', bookIds: ['a'] }, { id: 's2', name: 'Old', bookIds: [] }];
  const ours = [{ id: 's1', name: 'WIP', bookIds: ['a', 'n'] }, { id: 's2', name: 'Old', bookIds: [] }];
  const theirs = [{ id: 's1', name: 'Works in Progress', bookIds: ['a'] }, { id: 's3', name: 'New', bookIds: [] }];
  assert.deepEqual(plain(mergeShelves(base, ours, theirs)), [
    { id: 's1', name: 'Works in Progress', bookIds: ['a', 'n'] },
    { id: 's3', name: 'New', bookIds: [] }
  ]);
});

test('shelves: a book moved there, and left alone here, is on one shelf', () => {
  const { mergeShelves } = merger(lib());
  const base = [{ id: 's1', name: 'A', bookIds: ['a', 'b'] }, { id: 's2', name: 'B', bookIds: [] }];
  const ours = [{ id: 's1', name: 'A', bookIds: ['a', 'b', 'x'] }, { id: 's2', name: 'B', bookIds: [] }];
  const theirs = [{ id: 's1', name: 'A', bookIds: ['a'] }, { id: 's2', name: 'B', bookIds: ['b'] }];
  assert.deepEqual(plain(mergeShelves(base, ours, theirs)), [
    { id: 's1', name: 'A', bookIds: ['a', 'x'] },
    { id: 's2', name: 'B', bookIds: ['b'] }
  ]);
});

test('shelves: only one side changed them, that side\'s stand as they are', () => {
  const { mergeShelves } = merger(lib());
  const base = lib().shelves;
  const changed = [{ id: 's2', name: 'Short Stories', bookIds: ['c'] }, { id: 's1', name: 'Works in Progress', bookIds: ['b', 'a'] }];
  assert.deepEqual(plain(mergeShelves(base, plain(base), changed)), changed);
  assert.deepEqual(plain(mergeShelves(base, changed, plain(base))), changed);
});
