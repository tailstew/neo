// End-to-end tests for a sync program's conflict copies. NEO runs on a
// throwaway library, and the copies Syncthing, Dropbox and iCloud leave
// beside a chapter are put in its folder by hand, as the sync program
// would. Run with `npm run test:sync-conflicts`.

'use strict';

const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// A folder of its own for each run (see words.e2e.js)
for (const name of fs.readdirSync(os.tmpdir())) {
  const pid = /^neo-conflicts-test-(\d+)-/.exec(name);
  if (!pid || +pid[1] === process.pid) continue;
  try { process.kill(+pid[1], 0); continue; } catch (err) { if (err.code === 'EPERM') continue; }
  fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `neo-conflicts-test-${process.pid}-`));
app.setPath('userData', path.join(tmp, 'app'));
app.setPath('documents', tmp);
fs.mkdirSync(path.join(tmp, 'NEO Library'));
fs.writeFileSync(path.join(tmp, 'NEO Library', 'library.json'), JSON.stringify({
  authorName: '', penNames: [], firstRunDone: true, pageTheme: 'night',
  shelves: [{ id: 'shelf-1', name: 'Works in Progress', bookIds: [] }]
}));
const loadFile = BrowserWindow.prototype.loadFile;
BrowserWindow.prototype.loadFile = function (file, opts) {
  return loadFile.call(this, path.resolve(__dirname, '..', file), opts);
};
require('../main.js');

let wc;
let bookId;
let chId;
const js = (code) => wc.executeJavaScript(code, true);
const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const chapters = () => path.join(tmp, 'NEO Library', bookId, 'chapters');
const order = () => js('book.chapterOrder');
const html = (id) => js(`chapterHTML[${JSON.stringify(id)}]`);
const put = (name, text) => fs.writeFileSync(path.join(chapters(), name), text);
const there = (name) => fs.existsSync(path.join(chapters(), name));
const kept = (name) => fs.existsSync(path.join(tmp, 'NEO Library', bookId, 'sync-conflicts', name));

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

const SYNCTHING = () => `${chId}.sync-conflict-20261030-144927-Q7EGGF3.html`;

test('a copy left while the book was closed becomes the chapter after it as the book opens', async () => {
  const ids = await order();
  assert.equal(ids.length, 2, 'the chapter and the copy\'s');
  assert.equal(ids[0], chId);
  assert.match(await html(ids[1]), /laptop words/);
  assert.match(await js(`book.chapterTitles[${JSON.stringify(ids[1])}]`), /from other device/);
  assert.equal(fs.readFileSync(path.join(chapters(), ids[1] + '.html'), 'utf8'), await html(ids[1]), 'on disk');
  assert.equal(there(SYNCTHING()), false);
  assert.equal(kept(SYNCTHING()), true, 'kept in sync-conflicts/');
});

test('a copy that arrives while the book is open is taken in at the next look at the disk', async () => {
  const name = `${chId} (Ada's conflicted copy 2026-10-30).html`;
  put(name, '<p>Chapter one, with dropbox words.</p>');
  await js('refreshFromDisk()');
  await tick(300);
  const ids = await order();
  assert.equal(ids.length, 3);
  assert.equal(ids[0], chId);
  assert.match(await html(ids[1]), /dropbox words/, 'right after its chapter');
  assert.equal(kept(name), true);
});

test('a copy with no word the chapter lacks is only moved aside', async () => {
  const name = `${chId} 2.html`;
  put(name, await html(chId));
  await js('refreshFromDisk()');
  await tick(300);
  assert.equal((await order()).length, 3, 'no new chapter');
  assert.equal(kept(name), true);
});

test('a copy another device already took in makes no second chapter', async () => {
  // the other device's chapter, under the id the copy's name gives, synced over
  const name = `${chId}.sync-conflict-20261030-150000-ZJR4MCC.html`;
  const twin = await js(`conflictTwinId(${JSON.stringify(name)})`);
  await js(`(async () => {
    book.chapterOrder.push(${JSON.stringify(twin)});
    chapterHTML[${JSON.stringify(twin)}] = '<p>chromebook words</p>';
    await persistChapter(${JSON.stringify(twin)});
  })()`);
  put(name, '<p>Chapter one, chromebook words.</p>');
  await js('refreshFromDisk()');
  await tick(300);
  const ids = await order();
  assert.equal(ids.length, 4);
  assert.equal(ids.filter((id) => id === twin).length, 1);
  assert.equal(kept(name), true);
});

test('a copy of a chapter no longer in the book stays where it is', async () => {
  const name = 'ch-gone-0000.sync-conflict-20261030-150000-ZJR4MCC.html';
  put(name, '<p>words of a chapter deleted here</p>');
  await js('refreshFromDisk()');
  await tick(300);
  assert.equal((await order()).length, 4);
  assert.equal(there(name), true);
});

/* ---------- runner ---------- */

async function main() {
  await app.whenReady();
  let failed = 0;
  try {
    let win;
    while (!(win = BrowserWindow.getAllWindows()[0])) await tick(50);
    wc = win.webContents;
    while (!(await js(`typeof library !== 'undefined' && !!library`).catch(() => false))) await tick(50);
    await tick(300);
    [bookId, chId] = await js(`(async () => {
      document.getElementById('firstrun').hidden = true;
      await addImportedBooks([{ name: 'Conflicts', chapters: [
        { title: 'One', paras: [{ text: 'Chapter one.' }] }
      ] }], library.shelves[0]);
      const ids = library.shelves[0].bookIds;
      const id = ids[ids.length - 1];
      const meta = await window.neo.readBookMeta(id);
      return [id, meta.chapterOrder[0]];
    })()`);
    // Syncthing kept the Chromebook's version and set the laptop's aside
    put(SYNCTHING(), '<p>Chapter one, with laptop words.</p>');
    await js(`openBook(${JSON.stringify(bookId)})`);
    await tick(800);
    win.focus();
    for (const t of tests) {
      try {
        await t.fn();
        console.log('ok   ' + t.name);
      } catch (err) {
        failed++;
        console.log('FAIL ' + t.name + '\n     ' + String(err.message).replace(/\n/g, '\n     '));
      }
    }
    console.log(`\n${tests.length - failed} passed, ${failed} failed`);
  } catch (err) {
    failed++;
    console.error(err);
  } finally {
    app.exit(failed ? 1 : 0);
  }
}
main();
