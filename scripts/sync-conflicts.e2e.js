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
  authorName: '', penNames: [], firstRunDone: true, historyAsked: true, moreFeatures: true, pageTheme: 'night',
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
const tick = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
const chapters = () => path.join(tmp, 'NEO Library', bookId, 'chapters');
const order = () => js('book.chapterOrder');
const html = (id) => js(`chapterHTML[${JSON.stringify(id)}]`);
const put = (name, text) => fs.writeFileSync(path.join(chapters(), name), text);
const there = (name) => fs.existsSync(path.join(chapters(), name));
const kept = (name) => fs.existsSync(path.join(tmp, 'NEO Library', bookId, 'sync-conflicts', name));

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

const SYNCTHING = () => `${chId}.sync-conflict-20261030-144927-Q7EGGF3.html`;

test("library.json: a setting and a book another device wrote stay when this window saves the library from memory", async () => {
  // NEO re-reads library.json only on the shelf; the book is open here.
  // The other device (the laptop, as the phone saw it) turns a timestamp
  // service off and puts a book on a shelf.
  const file = path.join(tmp, 'NEO Library', 'library.json');
  const disk = JSON.parse(fs.readFileSync(file, 'utf8'));
  disk.proofTsas = [{ id: 'digicert', on: true }, { id: 'sectigo', on: true }, { id: 'globalsign', on: false }];
  disk.shelves[0].bookIds.push('book-from-elsewhere');
  fs.writeFileSync(file, JSON.stringify(disk));
  // and this window saves a change of its own, from what it holds
  await js('library.spellLanguage = "fr"; writeLibrary()');
  await tick(400);
  const now = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(now.proofTsas, disk.proofTsas, 'the other device’s timestamp services');
  assert.ok(now.shelves[0].bookIds.includes('book-from-elsewhere'), 'the book it put on the shelf');
  assert.ok(now.shelves[0].bookIds.includes(bookId), 'this book still there');
  assert.equal(now.spellLanguage, 'fr', 'and the change made here');
  assert.deepEqual(await js('library.proofTsas'), disk.proofTsas, 'taken into the window too');
  await js('delete library.spellLanguage; library.shelves[0].bookIds = library.shelves[0].bookIds.filter((id) => id !== "book-from-elsewhere"); writeLibrary()');
  await tick(300);
});

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
    setChapterHTML(${JSON.stringify(twin)}, '<p>chromebook words</p>', 'disk-new');
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

const bookDir = () => path.join(tmp, 'NEO Library', bookId);
const keptBook = (name) => fs.existsSync(path.join(bookDir(), 'sync-conflicts', name));
const bookCopy = (name, change) => {
  const meta = JSON.parse(fs.readFileSync(path.join(bookDir(), 'book.json'), 'utf8'));
  change(meta);
  fs.writeFileSync(path.join(bookDir(), name), JSON.stringify(meta, null, 2));
};

test("a chapter only the other device's book.json had comes back after the one before it, with its title", async () => {
  const before = await order();
  // made on the other device: its file arrived, its book.json lost to ours
  put('ch-new-0001.html', '<p>A chapter written on the other device.</p>');
  const name = 'book.sync-conflict-20261030-160000-ZJR4MCC.json';
  bookCopy(name, (m) => {
    m.chapterOrder.splice(1, 0, 'ch-new-0001');
    m.chapterTitles = { ...(m.chapterTitles || {}), 'ch-new-0001': 'Written elsewhere' };
  });
  await js('refreshFromDisk()');
  await tick(500);
  const ids = await order();
  assert.deepEqual(ids, [before[0], 'ch-new-0001', ...before.slice(1)]);
  assert.equal(await js("book.chapterTitles['ch-new-0001']"), 'Written elsewhere');
  assert.match(await html('ch-new-0001'), /other device/);
  const saved = JSON.parse(fs.readFileSync(path.join(bookDir(), 'book.json'), 'utf8'));
  assert.deepEqual(saved.chapterOrder, ids, 'on disk');
  assert.equal(fs.existsSync(path.join(bookDir(), name)), false);
  assert.equal(keptBook(name), true);
});

test("a chapter the other device's book.json had whose file is gone doesn't come back; a loose card with words does", async () => {
  const before = await order();
  const name = "book (Ada's conflicted copy 2026-10-30).json";
  bookCopy(name, (m) => {
    m.chapterOrder.push('ch-deleted-0002');
    m.looseCards = [...(m.looseCards || []), { id: 'lc-elsewhere', text: 'A card noted on the other device' }, { id: 'lc-empty', text: '' }];
  });
  await js('refreshFromDisk()');
  await tick(500);
  assert.deepEqual(await order(), before);
  assert.deepEqual(await js('(book.looseCards || []).map((c) => c.id)'), ['lc-elsewhere']);
  assert.equal(keptBook(name), true);
});

test("a copy of book.json.bak, or a book.json copy with nothing more in it, is only moved aside", async () => {
  const before = await order();
  const bak = 'book.json.sync-conflict-20261030-160100-ZJR4MCC.bak';
  fs.writeFileSync(path.join(bookDir(), bak), '{"half":');
  const same = 'book 2.json';
  bookCopy(same, () => {});
  await js('refreshFromDisk()');
  await tick(500);
  assert.deepEqual(await order(), before);
  assert.equal(keptBook(bak), true);
  assert.equal(keptBook(same), true);
});

// book.json as the other device would save it, knowing nothing since `meta`
const standing = () => JSON.parse(fs.readFileSync(path.join(bookDir(), 'book.json'), 'utf8'));
const saveAsOther = (meta, name = 'book.json') => {
  const m = JSON.parse(JSON.stringify(meta));
  m.lastPosition = { ...(m.lastPosition || {}), at: Date.now(), pIdx: 7 }; // only the caret moved there
  fs.writeFileSync(path.join(bookDir(), name), JSON.stringify(m, null, 2));
};
const newChapter = (id, text, title) => js(`(async () => {
  book.chapterOrder.push(${JSON.stringify(id)});
  if (${JSON.stringify(title || '')}) (book.chapterTitles = book.chapterTitles || {})[${JSON.stringify(id)}] = ${JSON.stringify(title || '')};
  setChapterHTML(${JSON.stringify(id)}, ${JSON.stringify(text)}, 'new');
  await persistChapter(${JSON.stringify(id)});
  await saveMeta();
})()`);
const cards = () => js('(book.looseCards || []).map((c) => c.html || c.text || "")');
// a look at the disk, then until what it joined is saved (on a timer, which
// a window in the background may run late)
const lookAndSave = async () => {
  await js('refreshFromDisk()');
  for (let i = 0; i < 100 && !(await js('metaSig(book) === savedMetaSig')); i++) await tick(100);
  await tick(200);
};

test("a chapter set on a loose card here doesn't come back with the other device's older book.json", async () => {
  await newChapter('ch-aside-0003', '<p>Words that go on a card.</p>');
  const old = standing();
  await js("chapterToLoose('ch-aside-0003')");
  await tick(300);
  assert.equal((await order()).includes('ch-aside-0003'), false);
  saveAsOther(old);
  await lookAndSave();
  assert.equal((await order()).includes('ch-aside-0003'), false, 'still out');
  assert.equal((await cards()).filter((h) => /go on a card/.test(h)).length, 1, 'the card, once');
  const saved = standing();
  assert.equal(saved.chapterOrder.includes('ch-aside-0003'), false, 'on disk');
  assert.equal(saved.looseCards.filter((c) => /go on a card/.test(c.html || '')).length, 1);
  assert.equal(saved.removed['ch-aside-0003'].back, undefined);
});

test("a chapter added here keeps its place and title when the other device's older book.json arrives", async () => {
  const old = standing();
  await newChapter('ch-here-0004', '<p>Written on this computer.</p>', 'Mine');
  saveAsOther(old);
  await lookAndSave();
  assert.equal((await order()).at(-1), 'ch-here-0004');
  assert.equal(await js("book.chapterTitles['ch-here-0004']"), 'Mine');
  assert.equal(standing().chapterOrder.at(-1), 'ch-here-0004', 'on disk');
});

test('a loose card made here stays when the other device\'s older book.json arrives', async () => {
  const old = standing();
  await js(`(async () => {
    book.looseCards.push({ id: 'lc-here-0005', text: 'A card noted here' });
    await saveMeta();
  })()`);
  saveAsOther(old);
  await lookAndSave();
  assert.equal((await js('book.looseCards.map((c) => c.id)')).includes('lc-here-0005'), true);
  assert.equal(standing().looseCards.some((c) => c.id === 'lc-here-0005'), true, 'on disk');
});

test("a book.json copy from the device that set a chapter aside takes it out here too, and brings its card", async () => {
  await newChapter('ch-there-0006', '<p>Set aside over there.</p>');
  const text = await html('ch-there-0006');
  const name = 'book.sync-conflict-20261030-170000-ZJR4MCC.json';
  bookCopy(name, (m) => {
    m.chapterOrder = m.chapterOrder.filter((id) => id !== 'ch-there-0006');
    m.looseCards.push({ id: 'lc-there-0006', held: 'chapter', html: text, text: '', words: 3 });
    m.removed = { ...(m.removed || {}), 'ch-there-0006': { at: Date.now(), hash: null } };
  });
  // the copy's fingerprint, as the other device made it
  const hash = await js(`textHash(${JSON.stringify(text)})`);
  const m = JSON.parse(fs.readFileSync(path.join(bookDir(), name), 'utf8'));
  m.removed['ch-there-0006'].hash = hash;
  fs.writeFileSync(path.join(bookDir(), name), JSON.stringify(m, null, 2));
  await js('refreshFromDisk()');
  await tick(1200);
  assert.equal((await order()).includes('ch-there-0006'), false);
  assert.equal((await cards()).filter((h) => /Set aside over there/.test(h)).length, 1);
  assert.equal(standing().chapterOrder.includes('ch-there-0006'), false, 'on disk');
  assert.equal(keptBook(name), true);
});

test('a chapter written in here after the other device took it out stays, and goes back in there', async () => {
  await newChapter('ch-both-0007', '<p>Begun.</p>');
  const name = 'book.sync-conflict-20261030-170100-ZJR4MCC.json';
  const hash = await js("textHash('<p>Begun.</p>')");
  await js(`(async () => {
    setChapterHTML('ch-both-0007', '<p>Begun. And carried on here.</p>', 'input');
    await persistChapter('ch-both-0007');
  })()`);
  bookCopy(name, (m) => {
    m.chapterOrder = m.chapterOrder.filter((id) => id !== 'ch-both-0007');
    m.removed = { ...(m.removed || {}), 'ch-both-0007': { at: Date.now(), hash } };
  });
  await js('refreshFromDisk()');
  await tick(1200);
  assert.equal((await order()).includes('ch-both-0007'), true);
  const saved = standing();
  assert.equal(saved.chapterOrder.includes('ch-both-0007'), true, 'on disk');
  assert.equal(saved.removed['ch-both-0007'].back, true, 'back, for the other device');
  assert.match(fs.readFileSync(path.join(chapters(), 'ch-both-0007.html'), 'utf8'), /carried on here/);
});

test("a chapter set on a card there while this one typed in it stays, and the card goes when the chapter holds all it held", async () => {
  for (const [chId, cardId, held, goes] of [
    ['ch-card-0011', 'lc-card-0011', '<p><br></p>', true], // set aside before the words reached it
    ['ch-card-0012', 'lc-card-0012', '<p>Only on the card.</p>', false]
  ]) {
    await newChapter(chId, '<p><br></p>');
    const hash = await js("textHash('<p><br></p>')");
    await js(`(async () => {
      setChapterHTML(${JSON.stringify(chId)}, '<p>Typed here meanwhile.</p>', 'input');
      await persistChapter(${JSON.stringify(chId)});
    })()`);
    const name = `book.sync-conflict-20261114-1200${goes ? '00' : '01'}-ZJR4MCC.json`;
    bookCopy(name, (m) => {
      m.chapterOrder = m.chapterOrder.filter((id) => id !== chId);
      m.looseCards.push({ id: cardId, held: 'chapter', from: chId, title: '', text: '', html: held, notes: [], words: 0 });
      m.removed = { ...(m.removed || {}), [chId]: { at: Date.now(), hash } };
    });
    await js('refreshFromDisk()');
    await tick(1200);
    assert.equal((await order()).includes(chId), true, 'the chapter stays');
    const saved = standing();
    assert.equal(saved.removed[chId].back, true);
    assert.equal(saved.looseCards.some((c) => c.id === cardId), !goes, goes ? 'the empty card went' : 'a card with words of its own stays');
    if (goes) assert.ok(saved.removed[cardId] && !saved.removed[cardId].back, 'noted, so the other device lets it go too');
  }
});

test('a chapter emptied on the other device while this one typed in it makes no empty "from other device" chapter; one with new words there still does', async () => {
  // the other device set the chapter's only section on a card (the file is
  // left with an empty line) while this one went on typing in it
  await newChapter('ch-emptied-0010', '<p>Here it begins.</p>');
  await js("setChapterHTML('ch-emptied-0010', '<p>Here it begins. Typed on.</p>', 'input')");
  await tick(50);
  fs.writeFileSync(path.join(chapters(), 'ch-emptied-0010.html'), '<p><br></p>');
  const before = (await order()).length;
  await js('refreshFromDisk()');
  await tick(1200);
  assert.equal((await order()).length, before, 'no chapter made');
  assert.equal(await html('ch-emptied-0010'), '<p>Here it begins. Typed on.</p>', 'the page keeps what was typed');
  assert.match(fs.readFileSync(path.join(chapters(), 'ch-emptied-0010.html'), 'utf8'), /Typed on/, 'and saves it');
  // words there that the page lacks: kept beside it, as before
  await js("setChapterHTML('ch-emptied-0010', '<p>Here it begins. Typed on. More here.</p>', 'input')");
  await tick(50);
  fs.writeFileSync(path.join(chapters(), 'ch-emptied-0010.html'), '<p>Here it begins. Typed on. Written there.</p>');
  await js('refreshFromDisk()');
  await tick(1200);
  const now = await order();
  assert.equal(now.length, before + 1, 'a chapter for the other device’s words');
  assert.equal(await html(now[now.indexOf('ch-emptied-0010') + 1]), '<p>Here it begins. Typed on. Written there.</p>');
});

test('⌘Z on a chapter set on a card marks it back', async () => {
  await newChapter('ch-undo-0008', '<p>Undone.</p>');
  await js("chapterToLoose('ch-undo-0008')");
  await tick(300);
  assert.equal(standing().removed['ch-undo-0008'].back, undefined);
  await js('structuralUndo()');
  await tick(300);
  await js('saveMeta()');
  await tick(300);
  assert.equal((await order()).includes('ch-undo-0008'), true);
  const saved = standing();
  assert.equal(saved.removed['ch-undo-0008'].back, true);
  assert.equal(saved.looseCards.some((c) => /Undone/.test(c.html || '')), false, 'the card went');
  const card = Object.entries(saved.removed).find(([id, r]) => id.startsWith('lc-') && r.hash && !r.back);
  assert.ok(card, 'the card noted as removed');
});

test('a chapter a flush already wrote isn’t written again when its 800 ms save comes', async () => {
  const id = (await order())[0];
  const file = path.join(chapters(), id + '.html');
  // typed (the edit and its save timer), then a flush before the timer fires: a blur, the 20 s tick
  await js(`(() => {
    const body = chapterBodyEl(${JSON.stringify(id)});
    body.querySelector('p').append(' Typed then flushed.');
    syncChapter(body, ${JSON.stringify(id)});
    flushAllSaves();
  })()`);
  await tick(400);
  const flushed = fs.statSync(file).mtimeMs;
  assert.match(fs.readFileSync(file, 'utf8'), /Typed then flushed\./);
  await tick(1200); // the 800 ms save has come and gone
  assert.equal(fs.statSync(file).mtimeMs, flushed, 'the file wasn’t written again');
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
