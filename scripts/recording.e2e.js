// End-to-end test for the writing recorder (docs/neo-recording-plan.md,
// phases 0 to 4). NEO runs on a throwaway library and is driven the way a writer
// drives it: keys, pastes, an input method, chapter splits and merges,
// Darlings, Replace and Replace All, undo and redo, the Outline's moves and
// structural ⌘Z, spellcheck and focus, and another device's copy arriving.
// After every step the recorder's log, replayed from nothing, has to give
// back every chapter exactly, and nothing may have changed without it
// seeing. Then the files on disk: the chain verifies, every write replays
// to the chapter file byte for byte, no file is written twice, a closed
// session is mirrored in Backups, and rollups, closing, the next session, a
// catch-up, a crash (after a flush, and between a save and a flush) and the
// off switch each keep every line. Then the Writing History dialog, restore
// (a chapter, a deleted chapter, paragraphs, text copied from a moment), books imported
// from a .docx and from Fountain, proof of when I wrote (seals, a tag sealed
// at once, nothing sent but fingerprints), and last, deleting a book’s history.
// Run with `npm run test:recording`.

'use strict';

const { app, BrowserWindow, Menu } = require('electron');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const R = require('../recording.js');

// A folder of its own for each run; earlier runs' folders go once their
// process has ended (see words.e2e.js).
for (const name of fs.readdirSync(os.tmpdir())) {
  const pid = /^neo-recording-test-(\d+)-/.exec(name);
  if (!pid || +pid[1] === process.pid) continue;
  try { process.kill(+pid[1], 0); continue; } catch (err) { if (err.code === 'EPERM') continue; }
  fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `neo-recording-test-${process.pid}-`));
const LIB = path.join(tmp, 'NEO Library');
app.setPath('userData', path.join(tmp, 'app'));
app.setPath('documents', tmp);
fs.mkdirSync(LIB);
fs.writeFileSync(path.join(LIB, 'library.json'), JSON.stringify({
  authorName: '', penNames: [], firstRunDone: true, moreFeatures: true, historyAsked: true, pageTheme: 'night',
  shelves: [{ id: 'shelf-1', name: 'Works in Progress', bookIds: [] }]
}));
// Seals are made in the proof worker: the test one, which reaches no
// network, answers drand from NEO_E2E_DRAND and logs every request to
// NEO_E2E_NET_LOG, for the proof test below
process.env.NEO_E2E_DRAND = path.join(tmp, 'drand.json');
process.env.NEO_E2E_NET_LOG = path.join(tmp, 'sent.jsonl');
{
  const { utilityProcess } = require('electron');
  const fork = utilityProcess.fork;
  utilityProcess.fork = function (file, args, o) {
    if (/proof-worker\.js$/.test(file)) file = path.join(__dirname, 'e2e-proof-worker.js');
    return fork.call(this, file, args, o);
  };
}
const loadFile = BrowserWindow.prototype.loadFile;
BrowserWindow.prototype.loadFile = function (file, opts) {
  return loadFile.call(this, path.resolve(__dirname, '..', file), opts);
};
require('../main.js');

let wc;
const js = (code) => wc.executeJavaScript(code, true);
const tick = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
const CTRL = process.platform === 'darwin' ? 'meta' : 'control';

function key(keyCode, modifiers = []) {
  wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
}
// typed as keys: '\n' is Enter, '\b' Backspace
async function type(keys) {
  for (const k of keys) {
    if (k === '\b') { key('Backspace'); continue; }
    const keyCode = k === '\n' ? 'Enter' : k;
    wc.sendInputEvent({ type: 'keyDown', keyCode });
    wc.sendInputEvent({ type: 'char', keyCode: k === '\n' ? '\r' : k });
    wc.sendInputEvent({ type: 'keyUp', keyCode });
  }
  await tick(300);
}

// A paste, as the window gets one: a paste event at the caret, carrying the
// text (and HTML) in its clipboardData. NEO's handler and the recorder read
// only that, so this is the same path a writer's ⌘V takes. The system
// clipboard isn't used: every program on the computer shares it, and one
// holding it open (or replacing it) made these tests fail at random.
async function paste(data) {
  const ok = await js(`(() => {
    const target = getSelection().focusNode;
    const el = target && (target.nodeType === 3 ? target.parentElement : target);
    if (!el) return false;
    const dt = new DataTransfer();
    dt.setData('text/plain', ${JSON.stringify(data.text)});
    ${data.html ? `dt.setData('text/html', ${JSON.stringify(data.html)});` : ''}
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true, composed: true }));
    return true;
  })()`);
  assert.ok(ok, 'no caret to paste at');
  await tick(300);
}

// the caret in chapter n (from 0), paragraph p, letter off (-1: the end)
async function caretAt(n, p, off) {
  await js(`(() => {
    const body = document.querySelectorAll('.chapter-body')[${n}];
    body.focus();
    const para = body.querySelectorAll('p')[${p}];
    const r = document.createRange();
    const text = para.firstChild && para.firstChild.nodeType === 3 ? para.firstChild : null;
    if (text) r.setStart(text, ${off} < 0 ? text.length : Math.min(${off}, text.length));
    else r.setStart(para, 0);
    r.collapse(true);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  })()`);
  await tick(100);
}

const check = () => js(`(() => {
  const r = rec.check();
  // and the page is what chapterHTML says
  const stale = [...document.querySelectorAll('.chapter')]
    .filter((c) => captureBody(c.querySelector('.chapter-body')) !== chapterHTML[c.dataset.id])
    .map((c) => c.dataset.id);
  return { ...r, stale };
})()`);

const tests = [];
const test = (name, fn, expect = {}) => tests.push({ name, fn, expect });
const chapterIds = () => js('[...book.chapterOrder]');
const html = (n) => js(`chapterHTML[book.chapterOrder[${n}]]`);

test('typing at the end of a chapter', async () => {
  await caretAt(0, 2, -1);
  await type(' The gulls cried.');
  assert.match(await html(0), /The gulls cried\.<\/p>$/);
});

test('repeated letters typed and taken back', async () => {
  await type(' all lll\b\b ok');
  assert.match(await html(0), /all l ok<\/p>$/i); // capitalised after a full stop
});

test('the caret walked back with the arrow keys, a word selected, and typed over', async () => {
  for (let i = 0; i < 3; i++) { key('Left'); await tick(40); }
  key('Left', ['shift']);
  await tick(40);
  key('Right');
  await tick(40);
  for (let i = 0; i < 3; i++) { key('Right'); await tick(40); }
  await type('!');
  assert.match(await html(0), /ok!<\/p>$/i);
});

test('Backspace held down, and Delete', async () => {
  await type(' xyzw');
  key('Backspace');
  await tick(40);
  for (let i = 0; i < 2; i++) { key('Backspace', ['isAutoRepeat']); await tick(30); }
  key('Left');
  await tick(40);
  key('Delete');
  await tick(40);
  assert.match(await html(0), /ok! <\/p>$/i);
});

test('smart quotes, dashes and an ellipsis', async () => {
  await type(' "Hello," she said -- it\'s late...');
  const h = await html(0);
  assert.match(h, /—/);
  assert.match(h, /…/);
});

test('native undo of typing', async () => {
  await tick(1200); // a pause closes the engine's undo run
  await type(' undone');
  await tick(1200);
  key('Z', [CTRL]);
  await tick(300);
  assert.doesNotMatch(await html(0), /undone/);
});

test('a paste of plain text, two paragraphs', async () => {
  await caretAt(0, 0, -1);
  await paste({ text: 'Pasted one.\nPasted two.' });
  assert.match(await html(0), /Pasted one\./);
});

test('a paste of formatted text', async () => {
  await caretAt(1, 1, 4);
  await paste({ text: 'bold words', html: '<b style="color:red">bold</b> <span style="font-size:30px">words</span>' });
  assert.match(await html(1), /words/);
});

test('three Enters split the chapter', async () => {
  const before = (await chapterIds()).length;
  await caretAt(0, 2, 5);
  await type('\n\n\n');
  assert.equal((await chapterIds()).length, before + 1);
});

test('⌘Z puts the split back', async () => {
  const before = (await chapterIds()).length;
  key('Z', [CTRL]);
  await tick(500);
  assert.equal((await chapterIds()).length, before - 1);
});

test('Backspace at a chapter\'s start merges it into the one above', async () => {
  const before = (await chapterIds()).length;
  await caretAt(1, 0, 0);
  key('Backspace');
  await tick(500);
  assert.equal((await chapterIds()).length, before - 1);
});

test('a passage sent to Darlings, and ⌘Z bringing it back', async () => {
  await js(`(() => {
    const p = document.querySelector('.chapter-body').querySelectorAll('p')[1];
    const r = document.createRange();
    r.setStart(p.firstChild, 0);
    r.setEnd(p.firstChild, 4);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  })()`);
  const darlings = await js('darlings.length');
  await js('darlingFromKeyboard()');
  await tick(500);
  assert.equal(await js('darlings.length'), darlings + 1);
  key('Z', [CTRL]);
  await tick(500);
  assert.equal(await js('darlings.length'), darlings);
});

test('replace all', async () => {
  await js(`(() => {
    document.getElementById('search-input').value = 'harbor';
    document.getElementById('replace-input').value = 'quay';
    runSearch();
    replaceAllMatches();
  })()`);
  await tick(300);
  assert.doesNotMatch(await html(0), /harbor/);
});

test('a single Replace, from Find', async () => {
  await js(`(() => {
    document.getElementById('search-input').value = 'boats';
    document.getElementById('replace-input').value = 'ships';
    runSearch();
    replaceCurrent();
  })()`);
  await tick(300);
  const all = await js('book.chapterOrder.map((c) => chapterHTML[c]).join("")');
  assert.match(all, /ships/);
  await js(`(() => { document.getElementById('search-input').value = ''; runSearch(); })()`);
});

test('undo and redo, again and again', async () => {
  await caretAt(0, 0, -1);
  const words = [' one', ' two', ' three'];
  const states = [await html(0)];
  for (const w of words) {
    await type(w);
    await tick(1200); // each its own undo step
    states.push(await html(0));
  }
  for (let i = 3; i > 0; i--) { key('Z', [CTRL]); await tick(300); assert.equal(await html(0), states[i - 1], `undo to ${i - 1}`); }
  for (let i = 1; i <= 2; i++) { key('Z', [CTRL, 'shift']); await tick(300); assert.equal(await html(0), states[i], `redo to ${i}`); }
  key('Z', [CTRL]);
  await tick(300);
  assert.equal(await html(0), states[1]);
});

test('a placeholder dropped and resolved', async () => {
  await caretAt(0, 1, 3);
  await js('insertPlaceholder()');
  await tick(300);
  assert.match(await html(0), /ph-mark/);
  const sid = await js('stickies[stickies.length - 1].id');
  await js(`resolveSticky(${JSON.stringify(sid)})`);
  await tick(300);
  assert.doesNotMatch(await html(0), /ph-mark/);
});

test('an input method composing a word', async () => {
  await caretAt(0, 0, -1);
  await type(' ');
  wc.debugger.attach('1.3');
  try {
    for (const text of ['に', 'にほ', 'にほん']) {
      await wc.debugger.sendCommand('Input.imeSetComposition', { text, selectionStart: text.length, selectionEnd: text.length });
      await tick(60);
    }
    await wc.debugger.sendCommand('Input.insertText', { text: '日本' });
  } finally {
    wc.debugger.detach();
  }
  await tick(300);
  assert.match(await html(0), /日本/);
});

// the book's other writing: notes, titles, the outline, stickies (4f)
const lastLines = () => js('rec.w.lines.slice(1).map((s) => JSON.parse(s))');
// the chapters (and streams) the session's `w` lines wrote
function writesOf(lines) {
  let cur = null;
  const out = [];
  for (const l of lines) {
    if (l[1] === 'ch' || l[1] === 'b') cur = l[2];
    else if (l[1] === 'w') out.push(l.length > 3 ? l[3] : cur);
  }
  return out;
}

test('notes typed in the Notes tab are recorded as typing', async () => {
  await js('switchTab(\'notes\')');
  await tick(300);
  // Notes opens on the chapter's own page: the book's, notes.html, is the one recorded
  await js('openNotesPage(\'book\')');
  await tick(500);
  await js(`(() => {
    const ed = document.getElementById('aux-editor');
    ed.focus();
    const r = document.createRange();
    r.selectNodeContents(ed);
    r.collapse(false);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  })()`);
  await type('Storm in act two.\nThe harborxx\b\b master lies.');
  key('Left');
  await tick(100);
  await js('switchTab(\'manuscript\')'); // the notes are written as the tab goes
  await tick(500);
  assert.match(await js('rec.model[":notes"]'), /harbor master lies/);
  const lines = await lastLines();
  assert.ok(lines.some((l) => l[1] === 'ch' && l[2] === ':notes'), 'the notes are a stream of their own');
  // (a space typed at the very end of a bare line is &nbsp; until the next letter: not a run)
  assert.ok(lines.some((l) => l[1] === 'r' && /harbor/.test(l[2])), 'their typing is a run');
  assert.ok(lines.some((l) => l[1] === 'rd'), 'and their Backspaces');
  assert.ok(writesOf(lines).includes(':notes'), 'and they were written');
  const from = lines.findIndex((l) => l[1] === 'ch' && l[2] === ':notes');
  let to = from + 1;
  while (to < lines.length && !((lines[to][1] === 'ch' || lines[to][1] === 'b') && lines[to][2] !== ':notes')) to++;
  assert.ok(!lines.slice(from, to).some((l) => l[1] === 'n' || l[1] === 's'), 'the notes’ caret isn’t kept, nor the keys that only move it');
});

test('a chapter’s own notes page is recorded as a stream of its own', async () => {
  const id = (await chapterIds())[0];
  await js(`switchTab('notes'); openNotesPage('${id}')`);
  await tick(500);
  assert.equal(await js('document.getElementById("aux-editor").dataset.kind'), 'notes-' + id);
  await js(`(() => {
    const ed = document.getElementById('aux-editor');
    ed.focus();
    const r = document.createRange();
    r.selectNodeContents(ed);
    r.collapse(false);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  })()`);
  await type('The lighthouse keeper knows.');
  await tick(100);
  await js('switchTab(\'manuscript\')'); // the page is written as the tab goes
  await tick(500);
  const sid = ':notes-' + id;
  assert.match(await js(`rec.model[${JSON.stringify(sid)}]`), /lighthouse keeper knows/);
  const lines = await lastLines();
  assert.ok(lines.some((l) => (l[1] === 'ch' || l[1] === 'b') && l[2] === sid), 'the chapter’s notes are a stream of their own');
  assert.ok(lines.some((l) => l[1] === 'r' && /ighthouse/.test(l[2])), 'their typing is a run');
  assert.ok(writesOf(lines).includes(sid), 'and they were written');
  assert.match(await js(`rec.model[":notes"]`), /harbor master lies/, 'the book’s notes are their own stream still');
});

test('a chapter title, an outline note and a sticky are recorded when they are saved', async () => {
  const id = (await chapterIds())[0];
  await js(`(() => {
    book.chapterTitles['${id}'] = 'The Boats'; // as a title's blur leaves it
    book.chapterNotes = { ...(book.chapterNotes || {}), ['${id}']: 'They come home at dawn.' };
    stickies.push({ id: 's-test', chapterId: '${id}', text: 'Check the tide tables', resolved: false });
    scheduleStickiesSave();
    return saveMeta();
  })()`);
  await tick(900);
  const lines = await lastLines();
  for (const s of [':titles', ':outline', ':stickies']) {
    assert.ok(lines.some((l) => (l[1] === 'ch' || l[1] === 'b') && l[2] === s), s + ' recorded');
  }
  assert.ok(lines.some((l) => l[1] === 'e' && /Boats/.test(l[4])), 'the title, as a splice');
  for (const s of [':titles', ':outline', ':stickies']) assert.ok(writesOf(lines).includes(s), s + ' written');
  assert.ok(!lines.some((l) => l[1] === 'o' && l[2].some((c) => c[0] === ':')), 'no stream is a chapter');
});

test('another device\'s copy of a chapter is adopted', async () => {
  await js('flushAllSaves()');
  await tick(500);
  // (the merge above left one chapter)
  const [bookId, chId] = await js('[book.id, book.chapterOrder[0]]');
  const file = path.join(LIB, bookId, 'chapters', chId + '.html');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8') + '<p>Written on the phone.</p>');
  await js('refreshFromDisk()');
  await tick(300);
  assert.match(await html(0), /Written on the phone/);
});

test('both sides changed: the other device\'s copy becomes a twin chapter', async () => {
  await js('flushAllSaves()');
  await tick(500);
  const [bookId, chId] = await js('[book.id, book.chapterOrder[0]]');
  const before = (await chapterIds()).length;
  await caretAt(0, 0, -1);
  await type(' Written here.');
  await js('clearTimeout(saveTimers[book.chapterOrder[0]])'); // still unsaved here
  const file = path.join(LIB, bookId, 'chapters', chId + '.html');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8') + '<p>And there.</p>');
  await js('refreshFromDisk()');
  await tick(500);
  assert.equal((await chapterIds()).length, before + 1);
});

test('a new chapter, typed in, then deleted', async () => {
  const before = (await chapterIds()).length;
  await caretAt(0, 0, 0);
  await js('newChapter()');
  await tick(300);
  await type('Brief.');
  const id = await js('currentChapterId');
  await js(`deleteChapterQuiet(${JSON.stringify(id)})`);
  await tick(300);
  assert.equal((await chapterIds()).length, before);
});

// two chapters after the first, with sections (*** lines), for the Outline's moves
const SECTIONS = {
  a: '<p>Alpha one.</p><p class="scene-break">***</p><p>Alpha two.</p><p class="scene-break">***</p><p>Alpha three.</p>',
  b: '<p>Beta one.</p><p class="scene-break">***</p><p>Beta two.</p>'
};
let A = null;
let B = null;
const bodies = () => js(`[${JSON.stringify(A)}, ${JSON.stringify(B)}].map((c) => chapterHTML[c])`);

test('two chapters with sections, for the Outline', async () => {
  [A, B] = await js(`(() => {
    const ids = [];
    for (const html of [${JSON.stringify(SECTIONS.a)}, ${JSON.stringify(SECTIONS.b)}]) {
      const id = createChapterAt(book.chapterOrder.length);
      const body = chapterBodyEl(id);
      body.innerHTML = html;
      syncChapter(body, id, 'edit');
      ids.push(id);
    }
    return ids;
  })()`);
  await tick(300);
  const [a, b] = await bodies();
  assert.match(a, /Alpha three/);
  assert.match(b, /Beta two/);
});

test('an Outline card moved within its chapter and to another, and ⌘Z putting each back', async () => {
  const before = await bodies();
  await js(`moveSection(${JSON.stringify(A)}, 2, { ch: ${JSON.stringify(A)}, before: 0 })`);
  await tick(300);
  let [a] = await bodies();
  assert.ok(a.indexOf('Alpha three') < a.indexOf('Alpha one'), 'within the chapter: ' + a);
  await js(`moveSection(${JSON.stringify(A)}, 0, { ch: ${JSON.stringify(B)}, before: null })`);
  await tick(300);
  let b;
  [a, b] = await bodies();
  assert.doesNotMatch(a, /Alpha three/);
  assert.match(b, /Alpha three/, 'to another chapter');
  await js('structuralUndo()');
  await tick(300);
  [a, b] = await bodies();
  assert.match(a, /Alpha three/);
  assert.doesNotMatch(b, /Alpha three/);
  await js('structuralUndo()');
  await tick(300);
  assert.deepEqual(await bodies(), before);
});

// (Tab on a chapter's line in the List, and a chapter card dropped on another, both join with joinChapter)
test('a chapter joined to another as a section, and ⌘Z bringing it back', async () => {
  const before = await bodies();
  await js(`joinChapter(${JSON.stringify(B)}, ${JSON.stringify(A)})`);
  await tick(500);
  assert.equal(await js(`book.chapterOrder.includes(${JSON.stringify(B)})`), false, 'the joined chapter went');
  const joined = await js(`chapterHTML[${JSON.stringify(A)}]`);
  assert.match(joined, /Alpha three[\s\S]*Beta one[\s\S]*Beta two/);
  await js('structuralUndo()');
  await tick(500);
  assert.equal(await js(`book.chapterOrder.includes(${JSON.stringify(B)})`), true);
  assert.deepEqual(await bodies(), before);
});

test('Backspace merging a chapter, and ⌘Z splitting it again', async () => {
  const before = await bodies();
  const ids = await chapterIds();
  await caretAt(ids.indexOf(B), 0, 0);
  key('Backspace');
  await tick(500);
  assert.equal((await chapterIds()).length, ids.length - 1);
  key('Z', [CTRL]);
  await tick(500);
  assert.deepEqual(await chapterIds(), ids);
  assert.deepEqual(await bodies(), before);
});

// UI decoration lives in the CSS Highlight API, never in the chapter
test('spellcheck, find highlights and focus dimming change nothing in the book', async () => {
  await caretAt(0, 0, -1);
  await type(' Teh gulsl.');
  await flush();
  const from = await js('rec.w.lines.length');
  const files = await js('book.chapterOrder.map((c) => chapterHTML[c])');
  await js('toggleSpellcheck()');
  await waitFor('CSS.highlights.has("neo-spell") && CSS.highlights.get("neo-spell").size > 0', 60000);
  await js(`(() => { document.getElementById('search-input').value = 'Alpha'; runSearch(); })()`);
  assert.ok(await js('CSS.highlights.get("neo-search").size > 0'));
  await js('setFocus("sentence")');
  await tick(300);
  await flush();
  const lines = (await js(`rec.w.lines.slice(${from})`)).map((s) => JSON.parse(s));
  assert.deepEqual(lines.filter((l) => ['e', 'x', 'b', 'd'].includes(l[1])), [], 'the recording changed nothing');
  assert.deepEqual(await js('book.chapterOrder.map((c) => chapterHTML[c])'), files);
  for (const [i, chId] of (await chapterIds()).entries()) {
    const file = fs.readFileSync(path.join(LIB, await js('book.id'), 'chapters', chId + '.html'), 'utf8');
    assert.equal(file, files[i], chId);
    assert.doesNotMatch(file, /neo-|spell|highlight|focus/i, chId);
  }
  await js(`(() => { toggleSpellcheck(); setFocus('off'); document.getElementById('search-input').value = ''; runSearch(); })()`);
  await tick(300);
});

test('every write replays to the text that was written', async () => {
  await js('flushAllSaves()');
  await tick(500);
  const r = await check();
  assert.ok(r.writes > 0, 'nothing was written');
  assert.deepEqual(r.badWrites, []);
});

// the safety net itself: a change that skips setChapterHTML is still
// caught before it reaches the disk, and the log still replays
test('a change made behind the recorder\'s back is caught as unobserved', async () => {
  // what a forgotten call site would do: change the page, then chapterHTML
  await js(`(() => {
    const chId = book.chapterOrder[0];
    const body = document.querySelector(\`.chapter[data-id="\${chId}"] .chapter-body\`);
    body.insertAdjacentHTML('beforeend', '<p>Sneaked in.</p>');
    chapterHTML[chId] = captureBody(body);
    return persistChapter(chId);
  })()`);
  await tick(300);
  const r = await check();
  assert.equal(r.unobserved, 1);
  assert.deepEqual(r.badWrites, []);
}, { unobserved: 1 });

/* ---------- the recording on disk ---------- */

let BOOK = null;
const recDirOf = () => {
  const root = path.join(LIB, BOOK, 'recording');
  return path.join(root, fs.readdirSync(root).find((n) => n.startsWith('d-')));
};
const readPart = (file) => (file.endsWith('.gz') ? zlib.gunzipSync(fs.readFileSync(file)) : fs.readFileSync(file)).toString('utf8');
// a session still open: its rollups and chunks, joined
function readOpen(id) {
  const folder = path.join(recDirOf(), id);
  return R.joinParts(fs.readdirSync(folder).filter((n) => /^[cs]-.*\.jsonl(\.gz)?$/.test(n))
    .map((name) => ({ name, text: readPart(path.join(folder, name)) })));
}
const readClosed = (id) => readPart(path.join(recDirOf(), id + '.jsonl.gz'));
const closedSessions = () => fs.readdirSync(recDirOf()).filter((n) => n.endsWith('.jsonl.gz')).sort().map((n) => n.slice(0, -9));
const openSessions = () => fs.readdirSync(recDirOf()).filter((n) => /^\d{4}-.*Z-[a-z0-9]+$/.test(n));
const sessionId = () => js('rec.session.id');
const flush = async () => { await js('flushAllSaves()'); await tick(500); };
// every file under a folder: { relative path: 'mtime:size' }
function stamps(dir, rel = '', out = {}) {
  let names = [];
  try { names = fs.readdirSync(path.join(dir, rel)); } catch { return out; }
  for (const n of names) {
    const r = rel ? path.join(rel, n) : n;
    const st = fs.statSync(path.join(dir, r));
    if (st.isDirectory()) stamps(dir, r, out); else out[r] = st.mtimeMs + ':' + st.size;
  }
  return out;
}
let written = null; // the recording's files, as they were before the rollup
// every session so far, in order, replayed from nothing
function replayAll(extra = []) {
  const r = R.replayCheck([...closedSessions().map(readClosed), ...extra]);
  assert.ok(r.ok, JSON.stringify({ bad: r.bad, problems: r.problems }));
  return r;
}

test('the session on disk is sealed, and replays to every chapter file byte for byte', async () => {
  await flush();
  const joined = readOpen(await sessionId());
  assert.deepEqual(joined.gaps, []);
  assert.deepEqual(joined.bad, []);
  const v = R.verifyChain(joined.text);
  assert.ok(v.ok, JSON.stringify(v.breaks));
  const r = R.replayCheck([joined.text], await js('rec.startKnown'));
  assert.ok(r.ok, JSON.stringify({ bad: r.bad, problems: r.problems }));
  // a chunk keeps only each chapter's last write
  assert.ok(r.writes > 0 && r.writes <= await js('rec.counts.writes'));
  const last = {};
  for (const w of R.replay([joined.text], await js('rec.startKnown')).writes) last[w.chapter] = w.hash;
  for (const chId of await chapterIds()) {
    assert.equal(R.digest(fs.readFileSync(path.join(LIB, BOOK, 'chapters', chId + '.html'))), last[chId], chId);
  }
  // and the notes, titles, outline and stickies to the files that hold them
  assert.equal(R.digest(fs.readFileSync(path.join(LIB, BOOK, 'notes.html'))), last[':notes'], 'notes.html');
  // (each chapter's own page too)
  const pages = fs.readdirSync(path.join(LIB, BOOK)).filter((f) => /^notes-.+\.html$/.test(f));
  assert.ok(pages.length, 'a chapter’s notes page was written');
  for (const f of pages) assert.equal(R.digest(fs.readFileSync(path.join(LIB, BOOK, f))), last[':' + f.slice(0, -5)], f);
  const texts = R.streamTexts(JSON.parse(fs.readFileSync(path.join(LIB, BOOK, 'book.json'), 'utf8')),
    JSON.parse(fs.readFileSync(path.join(LIB, BOOK, 'stickies.json'), 'utf8')));
  for (const [id, text] of Object.entries(texts)) assert.equal(R.digest(text), last[id], id);
  const lines = R.parseSession(joined.text).lines;
  const kinds = new Set(lines.map((l) => l[1]));
  for (const k of ['r', 'rd', 'n', 'k', 's', 'c', 'o']) assert.ok(kinds.has(k), `no "${k}" lines`);
  assert.ok(lines.some((l) => l[1] === 'rd' && /b/.test(l[2])), 'a held Backspace is a deleting run');
  // the usual keys for letters need no layout line
  assert.ok(!lines.some((l) => l[1] === 'K' && /^[a-z]$/.test(l[2]) && l[3] === 'Key' + l[2].toUpperCase() && l[4] === 0));
}, { unobserved: 1 });

test('a rollup holds the same lines as the chunks it replaces', async () => {
  written = stamps(path.join(LIB, BOOK, 'recording'));
  const id = await sessionId();
  const before = readOpen(id).text;
  await js('rec.rollup()');
  await tick(500);
  const names = fs.readdirSync(path.join(recDirOf(), id));
  assert.ok(names.some((n) => /^s-\d+-\d+\.jsonl\.gz$/.test(n)), names.join(' '));
  assert.ok(!names.some((n) => n.startsWith('c-')), 'chunks left behind: ' + names.join(' '));
  assert.equal(readOpen(id).text, before);
  await caretAt(0, 0, -1);
  await type(' After the rollup.');
  await flush();
  const after = readOpen(id).text;
  assert.ok(after.startsWith(before));
  assert.ok(R.verifyChain(after).ok);
}, { unobserved: 1 });

test('closing the book joins the session into one file', async () => {
  const id = await sessionId();
  const open = readOpen(id).text;
  await js('backToShelf()');
  await tick(800);
  assert.ok(!fs.existsSync(path.join(recDirOf(), id)), 'the session folder is still there');
  const text = readClosed(id);
  assert.ok(text.startsWith(open));
  assert.ok(R.verifyChain(text).ok);
  const lines = R.parseSession(text).lines;
  assert.equal(lines[lines.length - 2][1], 'end');
  replayAll();
}, { unobserved: 1 });

test('no file in the recording changes once written, and the closed session is mirrored in Backups', async () => {
  const now = stamps(path.join(LIB, BOOK, 'recording'));
  assert.ok(Object.keys(written).length > 2, 'files to look at: ' + Object.keys(written).join(' '));
  for (const [file, stamp] of Object.entries(written)) {
    if (file in now) assert.equal(now[file], stamp, file + ' was written again');
  }
  // closing mirrored it, byte for byte
  const id = closedSessions().slice(-1)[0];
  const device = path.basename(recDirOf());
  const copy = path.join(LIB, 'Backups', 'recordings', BOOK, device, id + '.jsonl.gz');
  for (let i = 0; i < 40 && !fs.existsSync(copy); i++) await tick(50);
  assert.ok(fs.readFileSync(copy).equals(fs.readFileSync(path.join(recDirOf(), id + '.jsonl.gz'))), 'the mirror holds the same bytes');
  assert.ok(fs.existsSync(path.join(LIB, 'Backups', 'recordings', BOOK, device, 'device.json')));
}, { unobserved: 1 });

test('opening the book again continues where the recording left off', async () => {
  const [firstId] = closedSessions();
  await js(`openBook(${JSON.stringify(BOOK)})`);
  await tick(500);
  await caretAt(0, 0, -1);
  await type(' Next day.');
  await flush();
  const id = await sessionId();
  assert.notEqual(id, firstId);
  const text = readOpen(id).text;
  const { header, lines } = R.parseSession(text);
  assert.equal(header.prev, R.verifyChain(readClosed(firstId)).last, 'sessions chain together');
  assert.equal(header.platform, undefined, 'the header doesn’t say which platform recorded it');
  const base = lines.find((l) => l[1] === 'b');
  assert.deepEqual([base[3], base[5]], [null, 'continue']);
  replayAll([text]);
});

test('a chapter changed while NEO was closed is caught up, not taken as typing', async () => {
  await js('backToShelf()');
  await tick(800);
  const meta = await js(`window.neo.readBookMeta(${JSON.stringify(BOOK)})`);
  const file = path.join(LIB, BOOK, 'chapters', meta.chapterOrder[0] + '.html');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8') + '<p>Edited elsewhere.</p>');
  await js(`openBook(${JSON.stringify(BOOK)})`);
  await tick(500);
  // caught up as the book opens, before anything is typed or clicked
  await flush();
  const opened = R.parseSession(readOpen(await sessionId()).text).lines;
  assert.ok(opened.some((l) => l[1] === 'x' && l[2] === 'catch-up'), 'caught up as it opened');
  assert.ok(!opened.some((l) => l[1] === 'k' || l[1] === 'r'), 'with nothing typed');
  await caretAt(0, 0, -1);
  await type(' Here again.');
  await flush();
  const text = readOpen(await sessionId()).text;
  const lines = R.parseSession(text).lines;
  const i = lines.findIndex((l) => l[1] === 'x' && l[2] === 'catch-up');
  assert.ok(i > 0, 'no catch-up');
  assert.deepEqual([lines[i - 1][1], lines[i - 1][3], lines[i - 1][5]], ['b', null, 'continue']);
  assert.match(lines[i + 1][4], /Edited elsewhere/);
  replayAll([text]);
});

test('a key typed after an open tidied the chapter is the key, and the tidy its own small changes', async () => {
  await js('backToShelf()');
  await tick(800);
  const meta = await js(`window.neo.readBookMeta(${JSON.stringify(BOOK)})`);
  const file = path.join(LIB, BOOK, 'chapters', meta.chapterOrder[0] + '.html');
  // the engine's style spans, left in a paragraph far from the one typed in
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8') + '<p>Between.</p><p>' + 'And between. '.repeat(40) + '</p><p><span style="white-space: normal"><span style="text-indent: 2em;">Wrapped in junk.</span></span></p>');
  await js(`openBook(${JSON.stringify(BOOK)})`);
  await tick(500);
  await caretAt(0, 0, -1);
  await type('Z');
  await flush();
  const text = readOpen(await sessionId()).text;
  const lines = R.parseSession(text).lines;
  const x = lines.findIndex((l) => l[1] === 'x' && l[2] === 'tidy');
  assert.ok(x > 0, 'no tidy');
  const tidy = [];
  for (let i = x + 1; i < lines.length && lines[i][1] === 'e' && lines[i].length === 5; i++) tidy.push(lines[i]);
  assert.ok(tidy.length >= 1 && tidy.every((l) => l[3] + l[4].length < 200), 'small splices: ' + JSON.stringify(tidy));
  assert.doesNotMatch(await js(`chapterHTML[${JSON.stringify(meta.chapterOrder[0])}]`), /<span/, 'the spans went');
  // the key: one letter, typed
  const typed = R.compileSession(text).steps.filter((s) => s.k === 'e' && s.cause === 'input');
  const z = typed[typed.length - 1];
  assert.deepEqual([z.del, z.ins, z.key], [0, 'Z', true]);
  assert.ok(!lines.some((l) => l[1] === 'e' && l[3] > 500), 'no edit spans the chapter');
  replayAll([text]);
});

test('a session NEO never closed is closed when the book opens again, even mid-rollup', async () => {
  const id = await sessionId();
  const folder = path.join(recDirOf(), id);
  await type(' More.');
  await flush();
  // a rollup, and a crash before it deleted the chunks it holds
  const saved = fs.readdirSync(folder).filter((n) => n.startsWith('c-')).map((n) => [n, fs.readFileSync(path.join(folder, n))]);
  await js('rec.rollup()');
  await tick(500);
  for (const [n, bytes] of saved) fs.writeFileSync(path.join(folder, n), bytes);
  const wanted = readOpen(id);
  assert.deepEqual(wanted.gaps, []);
  assert.ok(R.verifyChain(wanted.text).ok);
  await js('rec.on = false'); // NEO stops here without closing anything
  await js(`openBook(${JSON.stringify(BOOK)})`);
  await tick(500);
  assert.ok(!fs.existsSync(folder), 'the crashed session is still open');
  const text = readClosed(id);
  assert.ok(text.startsWith(wanted.text));
  const lines = R.parseSession(text).lines;
  assert.deepEqual(lines[lines.length - 2], [0, 'end', { crashed: true }]);
  assert.ok(R.verifyChain(text).ok);
  replayAll();
});

// The chapter is saved 800 ms after the last key; the recording goes to disk
// every 20 s. NEO killed between the two leaves the chapter ahead of it.
test('NEO killed after a chapter’s save, before the recording’s flush: the words come back as a catch-up', async () => {
  await caretAt(0, 0, -1);
  await type(' Settled.');
  await flush();
  const id = await sessionId();
  await js('window.__flush = rec.flush; rec.flush = () => {}; true'); // (the 20 s flush can't land in these seconds)
  await type(' Lost seconds.');
  await tick(1500); // the chapter's save, and no flush
  const [chId] = await chapterIds();
  assert.match(fs.readFileSync(path.join(LIB, BOOK, 'chapters', chId + '.html'), 'utf8'), /Lost seconds/, 'the chapter was saved');
  assert.doesNotMatch(readOpen(id).text, /Lost seconds|Lost/, 'and the recording wasn’t');
  await js('rec.on = false; rec.flush = window.__flush; true'); // NEO stops here: the unflushed lines are gone
  await js(`openBook(${JSON.stringify(BOOK)})`);
  await tick(500);
  assert.ok(closedSessions().includes(id), 'the crashed session was closed');
  await caretAt(0, 0, -1);
  await type(' Back.');
  await flush();
  const text = readOpen(await sessionId()).text;
  const ls = R.parseSession(text).lines;
  const i = ls.findIndex((l) => l[1] === 'x' && l[2] === 'catch-up');
  assert.ok(i > 0, 'no catch-up');
  assert.match(ls.slice(i + 1).find((l) => l[1] === 'e')[4], /Lost seconds/);
  replayAll([text]);
});

test('turning the recording off stops it; turning it on catches up', async () => {
  await js('setHistoryLevel("off")');
  await tick(300);
  assert.equal(await js('rec.on'), false);
  await caretAt(0, 0, -1);
  await type(' Unrecorded.');
  await flush();
  assert.deepEqual(openSessions(), []);
  await js('setHistoryLevel("record")');
  await tick(300);
  assert.equal(await js('rec.on'), true);
  await type(' Recorded.');
  await flush();
  const text = readOpen(await sessionId()).text;
  const lines = R.parseSession(text).lines;
  const i = lines.findIndex((l) => l[1] === 'x' && l[2] === 'catch-up');
  assert.match(lines[i + 1][4], /Unrecorded/);
  replayAll([text]);
  assert.equal(JSON.parse(fs.readFileSync(path.join(LIB, 'library.json'), 'utf8')).recordWriting, true);
  // the File menu's level follows
  assert.equal(menuItem('Record Only').checked, true);
});

test('a library from before Writing History is asked nothing, and records nothing until it’s turned on', async () => {
  await js('backToShelf()');
  await tick(800);
  // as an older NEO left it: never chosen
  await js('library.historyAsked = undefined; delete library.recordWriting; writeLibrary(library).then(() => window.neo.recState()); renderShelves(); 0');
  await tick(400);
  assert.equal(await js('recordingWanted()'), false, 'nothing records');
  assert.equal(await js('[...document.querySelectorAll(".modal-backdrop")].some((b) => !b.hidden && b.getClientRects().length > 0)'), false, 'nothing asks');
  assert.equal(menuItem('Off').checked, true);
  // turned on, as Options does
  await js('setHistoryLevel("record")');
  assert.equal(JSON.parse(fs.readFileSync(path.join(LIB, 'library.json'), 'utf8')).historyAsked, true);
  await js(`openBook(${JSON.stringify(BOOK)})`);
  await tick(800);
  assert.equal(await js('rec.on'), true);
});

/* ---------- Writing History: the dialog, its days and its player ---------- */

// The player's sheets, as captureBody would save them: its own marks out
const playerHTML = () => js(`(() => {
  const out = {};
  for (const sec of historyShown.player.paper.querySelectorAll('.rp-chapter')) {
    const body = sec.querySelector('.rp-body').cloneNode(true);
    body.querySelectorAll('.rp-caret').forEach((m) => m.remove());
    out[sec.dataset.ch] = captureBody(body);
  }
  return out;
})()`);
// What History is doing, for a failure's message: whether it's open, its
// view, the cache's build, the day's load, and where the player is
const historyState = () => js(`(() => {
  if (!historyShown) return { open: false };
  const p = historyShown.player;
  const h = p.h();
  const play = document.querySelector('.hs-play');
  return { open: true, view: p.view(), building: p.building(), loaded: p.loaded(), mode: p.mode(), day: h && h.day,
    pos: p.pos(), lead: p.lead(), steps: p.steps().length, part: !!p.part(), play: play && play.getAttribute('aria-label') };
})()`).catch((err) => ({ error: String((err && err.message) || err) }));
const waitFor = async (code, ms = 8000) => {
  for (const end = Date.now() + ms; Date.now() < end; await tick(50)) if (await js(code)) return;
  throw new Error('timed out waiting for ' + code + (/historyShown/.test(code) ? '\nHistory: ' + JSON.stringify(await historyState()) : ''));
};
const menuItem = (label) => {
  const find = (items) => {
    for (const item of items) {
      if (item.label === label) return item;
      const sub = item.submenu && find(item.submenu.items);
      if (sub) return sub;
    }
    return null;
  };
  return find(Menu.getApplicationMenu().items);
};
const bookNow = () => js('Object.fromEntries(book.chapterOrder.map((c) => [c, chapterHTML[c]]))');
// The days once the cache is built and the day shown has loaded, however long that takes
const daysReady = async () => {
  await waitFor('!!historyShown && !historyShown.player.building() && historyShown.player.view() === "days" && historyShown.player.loaded().state !== "loading"', 120000);
  const loaded = await js('historyShown.player.loaded()');
  assert.equal(loaded.state, 'ready', 'the days’ load: ' + JSON.stringify(loaded));
};
// The player once its day has loaded and drawn
const playerReady = async ({ drawn = true } = {}) => {
  await waitFor('!!historyShown && historyShown.player.view() === "player" && historyShown.player.loaded().state !== "loading"', 120000);
  const loaded = await js('historyShown.player.loaded()');
  assert.equal(loaded.state, 'ready', 'the player’s load: ' + JSON.stringify(loaded));
  if (drawn) await waitFor('!!historyShown.player.paper.querySelector(".rp-chapter")');
};
// the last session, in the player, at its end: the book as it is
const playLatest = async () => {
  await js('historyShown.player.openPlayer(historyShown.player.sessions().length - 1, { at: "end", ch: "book" })'); // the whole book
  await playerReady();
};

test('File → Writing History… is never greyed out; on the shelf it says to open a book first', async () => {
  await tick(300);
  assert.equal(menuItem('Writing History…').enabled, true);
  await js('backToShelf()');
  await tick(800);
  assert.equal(menuItem('Writing History…').enabled, true);
  menuItem('Writing History…').click();
  await tick(300);
  assert.equal(await js('!!historyShown'), false, 'no dialog without a book');
  assert.equal(await js('$("#hint").hidden ? "" : $("#hint").textContent'), 'Open a book first');
  await js(`openBook(${JSON.stringify(BOOK)})`);
  await tick(500);
  assert.equal(menuItem('Writing History…').enabled, true);
});

// what an earlier NEO cached: keyframes (before days), and one computer's days (before 4d)
const OLD_CACHE = ['kf-2026-01-01T09-00-00Z-abcd.json.gz', 'days-d-0123456789abcdef.json.gz', 'day-d-0123456789abcdef-2026-01-01.json.gz'];
test('caches an earlier NEO made are there before History first opens', async () => {
  const dir = path.join(tmp, 'app', 'recording-cache', BOOK);
  fs.mkdirSync(dir, { recursive: true });
  for (const n of OLD_CACHE) fs.writeFileSync(path.join(dir, n), zlib.gzipSync('{}'));
});

// (opened mid-sentence: nothing saved or flushed first, and the words just typed are there)
test('History in the footer opens on the whole book as it is, over its days; the last session plays back to the book as it is', async () => {
  await caretAt(0, 0, -1);
  await type(' Watched.');
  const chId = (await chapterIds())[0];
  await js(`document.querySelector('.tab.history-btn').click()`);
  await daysReady();
  await waitFor('!!historyShown.player.paper.querySelector(".rp-chapter")');
  const o = await js(`(() => { const p = historyShown.player; const ss = p.sessions(); return { sessions: ss.length, open: ss.filter((s) => s.open).length, day: p.day(), days: p.days().length, mode: p.mode() }; })()`);
  assert.ok(o.sessions >= 5, JSON.stringify(o));
  assert.equal(o.open, 1, 'the session in progress is in it');
  assert.equal(o.day, o.days - 1, 'it opens on the latest day');
  assert.equal(o.mode, 'book', 'on the whole book, not only the chapter the caret was in');
  assert.equal((await playerHTML())[chId], await js(`chapterHTML[${JSON.stringify(chId)}]`), 'the chapter as it is now');
  assert.ok(await js('document.querySelectorAll(".hs-strip .hs-tile").length >= 1'), 'a tile for each day');
  assert.ok(await js('document.querySelector(".hs-controls").hidden && document.querySelector(".hs-dayline").hidden'), 'no player’s controls on the days');
  await playLatest();
  assert.ok(await js('!document.querySelector(".hs-controls").hidden && document.querySelector(".hs-strip").hidden'), 'the player’s controls, and no tiles');
  assert.equal(await js('historyShown.player.h().bad.size'), 0, 'steps the player couldn’t follow');
  assert.deepEqual(await playerHTML(), await bookNow());
  assert.deepEqual(await js('[...historyShown.player.paper.querySelectorAll(".rp-chapter")].map((s) => s.dataset.ch)'), await chapterIds());
  assert.equal(await js('document.querySelectorAll(".chapter").length'), (await chapterIds()).length, 'the player made no .chapter of its own');
  assert.match(Object.values(await playerHTML()).join(''), /Watched\./, 'the words typed just before it opened');
  const cache = fs.readdirSync(path.join(tmp, 'app', 'recording-cache', BOOK));
  for (const n of OLD_CACHE) assert.ok(!cache.includes(n), n + ' is still there');
});

test('Ctrl+F in the dialog goes to its own search field, not the editor’s Find', async () => {
  key('F', [CTRL]);
  await tick(300);
  assert.equal(await js('document.activeElement && document.activeElement.classList.contains("hs-q")'), true);
  assert.equal(await js('document.getElementById("searchbar").hidden || !document.getElementById("searchbar").offsetParent'), true, 'the editor’s Find stayed shut');
  await js('document.querySelector(".page-sheet-backdrop").focus()'); // back to the dialog, where its keys go
  assert.equal(await js('document.activeElement.classList.contains("page-sheet-backdrop")'), true);
});

test('the player seeks anywhere, and plays forward to the same text', async () => {
  const n = await js('historyShown.player.steps().length');
  for (const at of [0, 1, Math.floor(n / 3), Math.floor(n / 2), n - 1]) {
    await js(`historyShown.player.seek(${at})`);
    const want = await js(`(() => { const p = historyShown.player; const v = p.steps(); const at = Math.max(${at}, p.lead()); return p.h().state(at ? v[at - 1] + 1 : v[0]); })()`);
    const got = await playerHTML();
    for (const [ch, html] of Object.entries(got)) assert.equal(html, want[ch], `at ${at}, ${ch}`);
  }
  // playing a stretch at full speed lands where seeking there would
  await js(`historyShown.player.seek(${Math.floor(n / 2)})`);
  await js('historyShown.player.speed(32)');
  await js('historyShown.player.setPlaying(true)');
  await tick(1500);
  await js('historyShown.player.setPlaying(false)');
  const pos = await js('historyShown.player.pos()');
  assert.ok(pos > Math.floor(n / 2), 'it played');
  const played = await js('JSON.stringify(historyShown.player.chapters())');
  await js(`historyShown.player.seek(${pos})`);
  assert.equal(await js('JSON.stringify(historyShown.player.chapters())'), played);
});

test('the sheet, drawn a paragraph at a time, is the chapter drawn whole at every step', async () => {
  // every step from the start: splits, joins, pastes, Darlings and replace all among them
  const bad = await js(`(() => {
    const p = historyShown.player;
    const bad = [];
    for (let i = 0; i <= p.steps().length && bad.length < 3; i++) {
      p.seek(i);
      const now = p.chapters();
      for (const sec of p.paper.querySelectorAll('.rp-chapter')) {
        const got = sec.querySelector('.rp-body').cloneNode(true);
        got.querySelectorAll('.rp-caret').forEach((m) => m.remove());
        const want = document.createElement('div');
        want.innerHTML = now[sec.dataset.ch];
        markDialogueOpening(want);
        if (got.innerHTML !== want.innerHTML) bad.push({ step: i, ch: sec.dataset.ch, got: got.innerHTML.slice(0, 300), want: want.innerHTML.slice(0, 300) });
      }
      if (p.paper.querySelectorAll('.rp-caret').length > 1) bad.push({ step: i, carets: p.paper.querySelectorAll('.rp-caret').length });
    }
    return bad;
  })()`);
  assert.deepEqual(bad, []);
});

test('⇧← goes to the start of the session, then the one before; ⇧→ to the next', async () => {
  // the session of the step about to play
  const at = () => js(`(() => { const p = historyShown.player; const h = p.h(); const v = p.steps(); const s = h.steps[v[Math.min(p.pos(), v.length - 1)]]; return h.sessions[s.session].id; })()`);
  const ids = await js('historyShown.player.h().sessions.map((s) => s.id)');
  assert.ok(ids.length >= 2, 'the day has sessions to skip between');
  await js('historyShown.player.speed(1)'); // (a second into a session is its start)
  const atStart = () => js(`(() => { const p = historyShown.player; const h = p.h(); const v = p.steps(); const i = p.pos(); return i === p.lead() || h.steps[v[i - 1]].k === 'session' || h.steps[v[i - 1]].session !== h.steps[v[i]].session; })()`);
  // (the day's first session starts before its first chapter is there, so its start is where the player's clock starts: Rec.playFrom)
  const shift = async (k) => { key(k, ['shift']); await tick(300); await playerReady({ drawn: false }); };
  // halfway through the day's first session, which ran for minutes
  await js(`(() => { const p = historyShown.player; const h = p.h(); const v = p.steps(); p.seek(Math.floor(v.findIndex((i) => h.steps[i].session === 1) / 2)); })()`);
  assert.equal(await at(), ids[0]);
  await shift('Left');
  assert.equal(await at(), ids[0], 'first, the start of its own session');
  assert.ok(await atStart());
  await shift('Right');
  assert.equal(await at(), ids[1], 'the next');
  assert.ok(await atStart());
  await shift('Left');
  assert.equal(await at(), ids[0], 'from a session’s start, the one before');
  await shift('Left');
  assert.equal(await at(), ids[0], 'nothing before the first');
});

test('search lands on the moment a phrase was first written, and the moment Replace All wrote one out', async () => {
  const search = async (q) => {
    await js(`historyShown.player.runFind(${JSON.stringify(q)})`);
    await waitFor('!!historyShown.player.find() && historyShown.player.find().finished', 60000);
    return js('historyShown.player.find().findings');
  };
  // the chapters just before and just after the step the player stopped on
  const around = () => js(`(() => { const p = historyShown.player; const h = p.h(); const i = p.steps()[p.pos() - 1]; return { before: Object.values(h.state(i)).join(''), after: Object.values(h.state(i + 1)).join('') }; })()`);
  const gulls = await search('Gulls cried');
  assert.ok(gulls.first && gulls.total >= 1, JSON.stringify(gulls));
  assert.ok(await js(`[...document.querySelectorAll('.hs-tile.hs-found')].some((b) => b.dataset.day === ${JSON.stringify(gulls.first.day)})`), 'its day marked');
  await js(`historyShown.player.goFind('first', historyShown.player.find().findings.first)`);
  await playerReady();
  let at = await around();
  assert.doesNotMatch(at.before, /gulls cried/i);
  assert.match(at.after, /gulls cried/i);
  await waitFor('CSS.highlights.get("neo-replay-find") && CSS.highlights.get("neo-replay-find").size >= 1');
  // there before the recording began, gone in one Replace All: never there at a day's end
  const harbor = await search('harbor');
  assert.equal(harbor.total, 0);
  assert.ok(harbor.first && harbor.out, JSON.stringify(harbor));
  await js(`historyShown.player.goFind('out', historyShown.player.find().findings.out)`);
  await playerReady();
  at = await around();
  assert.match(at.before, /harbor/i);
  assert.doesNotMatch(at.after, /harbor/i);
  await js('historyShown.player.runFind("")');
  assert.equal(await js('historyShown.player.find()'), null);
  assert.equal(await js('CSS.highlights.has("neo-replay-find")'), false);
});

test('a paragraph picked on the sheet steps back through each time it changed, and forward again', async () => {
  await playLatest();
  const chId = (await chapterIds())[0];
  // the first chapter's first paragraph, which every session typed in
  assert.ok(await js(`(() => {
    const p = historyShown.player;
    const sec = p.paper.querySelector('.rp-chapter[data-ch=${JSON.stringify(chId)}]');
    p.pickPart(sec.dataset.ch, sec.querySelector('.rp-body').firstElementChild.firstChild);
    return !!p.part();
  })()`));
  const now = () => js(`(() => {
    const p = historyShown.player;
    const x = p.part();
    return { day: p.h().day, pos: p.pos(), text: x && p.chapters()[x.ch].slice(x.a, x.b) };
  })()`);
  const latest = await now();
  assert.match(latest.text, /^<p\b[\s\S]*<\/p>$/, 'whole paragraphs');
  assert.equal(await js('CSS.highlights.get("neo-replay-part").size'), 1, 'marked on the sheet');
  // back to the first time it was written: every stop another version of it
  const stops = [latest];
  for (let k = 0; k < 40; k++) {
    await js('historyShown.player.partGo(-1)');
    const at = await now();
    const last = stops[stops.length - 1];
    if (at.day === last.day && at.pos === last.pos) break;
    assert.notEqual(at.text, last.text, `stop ${stops.length}: the paragraph as the change before left it`);
    stops.push(at);
  }
  assert.ok(stops.length >= 3, 'it changed in more than one session: ' + stops.length);
  // nothing before it was first written: ‹ is off, › isn't
  await waitFor('document.querySelector(".hs-part-prev").disabled', 30000);
  assert.equal(await js('document.querySelector(".hs-part-next").disabled'), false);
  // and forward again, through the same stops
  for (let k = stops.length - 2; k >= 0; k--) {
    await js('historyShown.player.partGo(1)');
    const at = await now();
    assert.deepEqual([at.day, at.pos, at.text], [stops[k].day, stops[k].pos, stops[k].text], `forward to stop ${k}`);
  }
  // nothing after the latest: › is off, and goes nowhere
  await waitFor('document.querySelector(".hs-part-next").disabled', 30000);
  assert.equal(await js('document.querySelector(".hs-part-prev").disabled'), false);
  await js('historyShown.player.partGo(1)');
  assert.deepEqual(await now(), stops[0]);
  key('Escape');
  await tick(200);
  assert.equal(await js('historyShown.player.part()'), null, 'Esc puts it down first');
  assert.equal(await js('historyShown.player.view()'), 'player');
});

test('one chapter on its own; Esc goes back to the days, then puts the caret back', async () => {
  const chId = (await chapterIds())[0];
  await js(`historyShown.player.setMode(${JSON.stringify(chId)})`);
  await playerReady({ drawn: false }); // (the skips left it at the day's start, before the chapter was)
  await js('historyShown.player.seek(historyShown.player.steps().length)');
  const got = await playerHTML();
  assert.deepEqual(Object.keys(got), [chId]);
  assert.equal(got[chId], await js(`chapterHTML[${JSON.stringify(chId)}]`));
  assert.equal(await js(`document.querySelector('.hs-ch[aria-selected="true"] .hs-ch-name').textContent`), await js(`chapterName(${JSON.stringify(chId)}) + ' — ' + book.chapterTitles[${JSON.stringify(chId)}]`));
  key('Escape');
  await tick(300);
  assert.equal(await js('historyShown.player.view()'), 'days');
  assert.equal(await js('historyShown.player.day()'), await js('historyShown.player.days().length - 1'), 'on the day the player was in');
  key('Escape');
  await tick(300);
  assert.equal(await js('!!historyShown || !!document.querySelector(".page-sheet-backdrop")'), false);
  assert.equal(await js(`document.activeElement.closest('.chapter') && document.activeElement.closest('.chapter').dataset.id`), chId);
});

test('a deleted chapter is listed, and a chapter’s menu has no way into History', async () => {
  await js('openHistory()');
  await daysReady();
  // the side pane lists the chapters at the moment shown: at the day's end,
  // not the chapter typed in and deleted earlier
  const listed = `document.querySelectorAll('.hs-list .hs-ch:not(.hs-tag-item)').length - 1`;
  const now = (await chapterIds()).length;
  assert.equal(await js(listed), now);
  // the days: a tile for today, with what was written
  assert.ok(await js(`document.querySelectorAll('.hs-strip .hs-tile[data-day]').length >= 1`));
  // a day picked opens the player on it, paused: nothing plays until Play
  await js(`document.querySelector('.hs-strip .hs-tile[data-day]').click()`);
  await playerReady({ drawn: false });
  await tick(300);
  assert.equal(await js('document.querySelector(".hs-play").getAttribute("aria-label")'), 'Play', 'a day picked doesn’t play');
  // just before it was deleted, it's listed (in the whole book: a
  // chapter's steps hold no other's delete)
  await js('historyShown.player.setMode("book")');
  await playerReady({ drawn: false });
  const deleteAt = await js(`(() => {
    const p = historyShown.player;
    const h = p.h();
    const j = p.steps().findIndex((i) => h.steps[i].k === 'd' && !h.steps[i].ch.startsWith(':'));
    p.seek(j);
    return j;
  })()`);
  await tick(100);
  // (what the sheet and the side pane show, should it fail)
  const shown = () => js(`({
    listed: [...document.querySelectorAll('.hs-list .hs-ch:not(.hs-tag-item) .hs-ch-name')].map((e) => e.textContent),
    days: [...document.querySelectorAll('.hs-strip .hs-tile[data-day]')].map((b) => b.dataset.day),
    deletes: historyShown.player.h().steps.filter((s) => s.k === 'd').map((s) => s.ch)
  })`);
  // (the day added chapters after it, so it's the moment just after that has one fewer, not now)
  const before = await js(listed);
  const says = JSON.stringify({ deleteAt, ...(await historyState()), ...(await shown()) });
  assert.ok(deleteAt >= 0, 'the day deletes a chapter: ' + says);
  await js(`historyShown.player.seek(${deleteAt + 1})`);
  await tick(100);
  assert.equal(await js(listed), before - 1, 'a chapter about to be deleted is listed, and once deleted isn’t: ' + says + ' then ' + JSON.stringify(await shown()));
  key('Escape');
  await tick(300);
  key('Escape');
  await tick(300);
  // a chapter's right-click has no way into History: the footer's History is the one
  const chId = (await chapterIds())[0];
  const offered = await js(`(async () => {
    const realPop = popMenu;
    let items = null;
    popMenu = async (x, y, list) => { popMenu = realPop; items = list; return null; };
    await chapterMenu(${JSON.stringify(chId)});
    return items.filter((i) => i && i.value).map((i) => i.value);
  })()`);
  assert.ok(offered.length && !offered.includes('history'), 'no Watch This Chapter Being Written: ' + offered);
});

test('while History is open the menus stay live: an item clicked closes it and then does what it says, one reached by its shortcut does nothing, and ⌘S tags', async () => {
  const before = await js('document.querySelectorAll(".modal-backdrop").length');
  await js('openHistory()');
  await daysReady();
  await tick(300);
  assert.equal(menuItem('Goals…').enabled, true);
  assert.equal(menuItem('Writing History…').enabled, true);
  assert.equal(menuItem('Tag This Moment…').enabled, true, '⌘S reads Tag This Moment… while it is open');
  const open = await js('document.querySelectorAll(".modal-backdrop").length');
  // by its shortcut: nothing happens behind the dialog
  menuItem('Goals…').click({ triggeredByAccelerator: true });
  await tick(300);
  assert.equal(await js('!!historyShown'), true);
  assert.equal(await js('document.querySelectorAll(".modal-backdrop").length'), open, 'Goals didn’t open behind it');
  // clicked: History closes, then Goals opens
  menuItem('Goals…').click();
  await tick(600);
  assert.equal(await js('!!historyShown'), false);
  assert.equal(await js('document.querySelectorAll(".modal-backdrop").length'), before + 1, 'Goals opened, alone');
  key('Escape');
  await tick(400);
  assert.equal(await js('document.querySelectorAll(".modal-backdrop").length'), before);
  assert.equal(menuItem('Take Snapshot').enabled, true, '⌘S takes a snapshot again');
});

test('the days are cached in userData, and the cache plays the same', async () => {
  const cacheDir = path.join(tmp, 'app', 'recording-cache', BOOK);
  const names = fs.readdirSync(cacheDir);
  assert.ok(names.includes('days.json.gz'), names.join(' '));
  assert.ok(names.some((n) => /^day-\d{4}-\d\d-\d\d\.json\.gz$/.test(n)), names.join(' '));
  assert.ok(!names.some((n) => n.startsWith('kf-') || /^days?-d-/.test(n)), 'keyframes from before days, and one computer’s days, are gone');
  await js('openHistory()');
  await daysReady();
  await playLatest();
  assert.equal(await js('historyShown.player.h().bad.size'), 0);
  assert.deepEqual(await playerHTML(), await bookNow());
  key('Escape');
  await tick(300);
  key('Escape');
  await tick(300);
});

// Another computer writes in this book while NEO is open here: its session
// is in today's days with this one's, and this computer adopts its copy
test('another computer’s session plays in the same day, named, and the page ends as the book is', async () => {
  await flush();
  const [chId, before, day] = await js('[book.chapterOrder[0], chapterHTML[book.chapterOrder[0]], writingDay()]');
  const other = 'd-feedfacefeedface';
  const dir = path.join(LIB, BOOK, 'recording', other);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'device.json'), JSON.stringify({ name: 'Other laptop' }));
  const began = new Date(Date.now() - 2000);
  const id = began.toISOString().slice(0, 19).replace(/:/g, '-') + 'Z-oth1';
  const w = new R.SessionWriter({ neoRec: R.FORMAT, session: id, device: other, app: 'test', platform: 'Win32', book: BOOK, day, startedAt: began.toISOString(), tz: 'UTC', prev: null });
  w.push([0, 'b', chId, before, R.digest(before), 'baseline']);
  let html = before;
  const at = html.lastIndexOf('</p>');
  for (const [i, c] of [...' Elsewhere.'].entries()) {
    w.push([120, 'e', at + i, 0, c, 'iT']);
    html = R.applyEdit(html, at + i, 0, c);
  }
  w.push([0, 'w', R.digest(html), chId]);
  w.push([100, 'end', {}]);
  w.chunk();
  fs.writeFileSync(path.join(dir, id + '.jsonl.gz'), zlib.gzipSync(w.lines.join('\n') + '\n'));
  // its copy reaches this computer, which takes it
  fs.writeFileSync(path.join(LIB, BOOK, 'chapters', chId + '.html'), html);
  await js('refreshFromDisk()');
  await tick(300);
  assert.equal(await js(`chapterHTML[${JSON.stringify(chId)}]`), html);
  await flush();
  await js('openHistory()');
  await daysReady();
  const today = await js(`historyShown.player.days().find((d) => d.day === ${JSON.stringify(day)}).list.map((s) => s.device)`);
  assert.ok(today.includes(other) && today.some((d) => d !== other), 'both computers in today’s day: ' + today);
  assert.equal(await js('document.querySelector(".hs-device")'), null, 'no menu of devices');
  await playLatest();
  assert.equal(await js('historyShown.player.h().bad.size'), 0);
  assert.deepEqual(await playerHTML(), await bookNow());
  // the other computer's session, named, inside this one's
  const s = await js(`(() => { const h = historyShown.player.h(); const k = h.sessions.findIndex((x) => x.device === ${JSON.stringify(other)}); const mine = h.sessions.findIndex((x) => x.device !== ${JSON.stringify(other)} && x.open); return { k, from: h.sessions[k].from, to: h.sessions[k].to, mineTo: mine >= 0 ? h.sessions[mine].to : -1, at: h.state(h.sessions[k].to)[${JSON.stringify(chId)}] }; })()`);
  assert.ok(s.k >= 0 && s.to < s.mineTo, 'it plays inside this computer’s open session: ' + JSON.stringify(s));
  assert.equal(s.at, html, 'and leaves the chapter as it wrote it');
  assert.equal(await js('historyShown.player.h().steps.filter((x) => x.sync !== undefined).length'), 0, 'no sync: this computer took its copy as it was');
  key('Escape');
  await tick(300);
  assert.match(await js(`document.querySelector('.hs-tile[aria-selected="true"]').title`), /Other laptop/, 'the day says which computers wrote it');
  key('Escape');
  await tick(300);
});

test('a book’s menu on the shelf opens its history without opening the book', async () => {
  await js('backToShelf()');
  await tick(800);
  await js(`openHistory({ bookId: ${JSON.stringify(BOOK)} })`);
  await daysReady();
  assert.equal(await js(`document.getElementById('editor-view').hidden`), true);
  key('Escape');
  await tick(300);
  await js(`openBook(${JSON.stringify(BOOK)})`);
  await tick(500);
});

test('a session ends with the writer’s day, and the next day plays on from it', async () => {
  await caretAt(0, 0, -1);
  await type(' Today.');
  await flush();
  const before = await sessionId();
  const today = await js('writingDay()');
  assert.equal(R.parseSession(readOpen(before).text).header.day, today, 'a session says which writer’s day it is');
  // the writer's day ends (tomorrow comes, as the goals count it)
  const tomorrow = await js('(() => { const real = writingDay; const next = real(new Date(Date.now() + 86400000)); window.__realDay = real; writingDay = () => next; return next; })()');
  await type(' Tomorrow.');
  await flush();
  const after = await sessionId();
  assert.notEqual(after, before);
  assert.ok(closedSessions().includes(before), 'the day’s session closed when the day ended');
  assert.equal(R.parseSession(readOpen(after).text).header.day, tomorrow);
  replayAll([readOpen(after).text]);
  // the history has two days now, and the second starts where the first ended
  await js('openHistory()');
  await daysReady();
  assert.deepEqual(await js('historyShown.player.days().map((d) => d.day)'), [today, tomorrow]);
  await playLatest();
  assert.equal(await js('historyShown.player.h().day'), tomorrow);
  assert.equal(await js('historyShown.player.h().bad.size'), 0);
  assert.deepEqual(await playerHTML(), await bookNow());
  key('Escape');
  await tick(300);
  key('Escape');
  await tick(300);
  await js('writingDay = window.__realDay; true');
});

/* ---------- restore ---------- */

// the recording's lines so far this session, read back
const sessionLines = () => js('rec.w.lines.slice()').then((ls) => ls.map((l) => JSON.parse(l)));

// The confirmation that opens over History: its title and points, and then
// its answer (`yes`: the button that does it, else Cancel)
async function confirmShown() {
  await waitFor('!!document.querySelector(".confirm-modal")');
  return js(`({ title: document.querySelector('.confirm-modal h2').textContent, points: [...document.querySelectorAll('.confirm-modal li')].map((li) => li.textContent), ok: document.querySelector('.confirm-modal .m-ok').textContent })`);
}
async function answer(yes) {
  await js(`document.querySelector('.confirm-modal ${yes ? '.m-ok' : '.m-cancel'}').click()`);
  await tick(200);
}

// The text of chapter chId at the moment a tag's own line is on: every
// session on disk played from the start, as History plays them
async function atTag(tagId, chId) {
  const sid = await sessionId();
  const device = path.basename(recDirOf());
  const open = readOpen(sid).text;
  const idx = R.splitLines(open).lines.findIndex((l) => l.includes('"tag"') && l.includes(JSON.stringify(tagId)));
  assert.ok(idx > 0, 'the tag is on disk');
  const h = new R.History([...closedSessions().map((id) => ({ id, device, text: readClosed(id) })), { id: sid, device, text: open }]);
  h.build({});
  return h.state(R.momentStep(h, [sid, idx + 1, device]))[chId];
}
const snapCount = () => js('window.neo.snapshotList(book.id).then((l) => l.length)');

// The player on chapter chId, paused at a moment where it isn't as it is now
async function playerAtOlder(chId) {
  await js('openHistory()');
  await daysReady();
  await js(`historyShown.player.openPlayer(historyShown.player.sessions().findIndex((s) => s.stats.chapters[${JSON.stringify(chId)}]), { ch: ${JSON.stringify(chId)} })`);
  await playerReady({ drawn: false });
  const now = await js(`chapterHTML[${JSON.stringify(chId)}]`);
  for (const f of [0.5, 0.3, 0.7, 0.15, 0.9]) {
    await js(`historyShown.player.seek(Math.round(historyShown.player.steps().length * ${f}))`);
    const then = await js(`historyShown.player.chapters()[${JSON.stringify(chId)}]`);
    if (then !== undefined && then !== now) return { now, then };
  }
  throw new Error('no moment where the chapter was otherwise');
}

test('a chapter restored to a moment at once: the moment before it tagged and on disk first, no snapshot or Darlings, and ⌘Z takes it back', async () => {
  const chId = (await chapterIds())[0];
  const { now, then } = await playerAtOlder(chId);
  await waitFor('!document.querySelector(".hs-restore").hidden && !document.querySelector(".hs-restore").disabled');
  assert.equal(await js('document.querySelector(".hs-restore").textContent'), 'Restore This Chapter');
  const darlingsBefore = await js('darlings.length');
  const snapsBefore = await snapCount();
  await js('document.querySelector(".hs-restore").click()');
  assert.equal(await js('!!document.querySelector(".confirm-modal")'), false, 'no confirmation');
  await waitFor(`!historyShown && chapterHTML[${JSON.stringify(chId)}] === ${JSON.stringify(then)}`);
  await tick(300);
  // the page shows it; Darlings and the snapshots are as they were
  assert.equal(await js(`captureBody(document.querySelector('.chapter[data-id="${chId}"] .chapter-body'))`), then);
  assert.equal(await js('darlings.length'), darlingsBefore);
  assert.equal(await snapCount(), snapsBefore, 'no snapshot while recording');
  assert.match(await js('document.getElementById("hint").textContent'), /Chapter restored from .+ undoes it; the text it replaced is in Writing History, at “Before restoring to /);
  // the recording: the tag, then x restore with the moment, then the splices
  const lines = await sessionLines();
  const xi = lines.map((l) => l[1]).lastIndexOf('x');
  const x = lines[xi];
  assert.equal(x[2], 'restore');
  const [sid, line, device] = x.slice(3);
  assert.ok(Number.isInteger(line) && line >= 1, 'a line number');
  assert.equal(device, await js('rec.device'));
  assert.ok(closedSessions().includes(sid) || sid === await sessionId(), 'a session of this book');
  // (between them nothing that changes text: the chunk's seal, the chapter's first sight this session)
  const ti = lines.map((l) => l[1]).lastIndexOf('tag', xi);
  assert.ok(ti > 0 && lines.slice(ti + 1, xi).every((l) => !['e', 'r', 'rd', 'x', 'd'].includes(l[1])), 'a tag just before: ' + JSON.stringify(lines.slice(Math.max(0, xi - 6), xi + 1).map((l) => l.slice(1, 3))));
  const tg = lines[ti];
  assert.equal(tg[3], null, 'NEO’s own');
  assert.deepEqual(tg[5].restore.slice(0, 3), x.slice(3), 'naming the moment restored to');
  // its chunk went to disk before the restore's lines were made: on its own
  const folder = path.join(recDirOf(), await sessionId());
  const chunk = fs.readdirSync(folder).filter((n) => /^c-.*\.jsonl$/.test(n)).map((n) => readPart(path.join(folder, n))).find((c) => c.includes(JSON.stringify(tg[2])));
  assert.ok(chunk, 'the tag’s chunk');
  assert.ok(!chunk.includes('"x","restore"'), 'the tag on disk before the restore');
  await flush();
  replayAll([readOpen(await sessionId()).text]);
  // the tag's moment is the text the restore replaced
  assert.equal(await atTag(tg[2], chId), now);
  // ⌘Z: the chapter as it was
  await js('structuralUndo()');
  await tick(300);
  assert.equal(await html(0), now);
  assert.equal(await js('darlings.length'), darlingsBefore);
});

test('with recording off, a History restore keeps the chapter in a “Before a restore” snapshot first, and changes nothing when it can’t', async () => {
  const chId = (await chapterIds())[0];
  const { now, then } = await playerAtOlder(chId);
  key('Escape');
  await tick(200);
  key('Escape');
  await tick(300);
  await js('setHistoryLevel("off")');
  await tick(300);
  try {
    const darlingsBefore = await js('darlings.length');
    // a snapshot that can't be written: nothing changes
    const { ipcMain } = require('electron');
    const handlers = ipcMain._invokeHandlers;
    const write = handlers.get('snapshot:write');
    handlers.set('snapshot:write', () => { throw new Error('disk full'); });
    try {
      await js(`historyRestore({ bookId: book.id, ch: ${JSON.stringify(chId)}, html: ${JSON.stringify(then)}, wall: Date.now() - 3600000, ref: ['s', 1, 'd'] })`);
    } finally { handlers.set('snapshot:write', write); }
    assert.equal(await html(0), now, 'unchanged');
    const before = await js('window.neo.snapshotList(book.id).then((l) => l.map((s) => s.name))');
    await js(`historyRestore({ bookId: book.id, ch: ${JSON.stringify(chId)}, html: ${JSON.stringify(then)}, wall: Date.now() - 3600000, ref: ['s', 1, 'd'] })`);
    await tick(300);
    assert.equal(await html(0), then);
    const made = (await js('window.neo.snapshotList(book.id)')).filter((s) => !before.includes(s.name));
    assert.equal(made.length, 1, 'one snapshot');
    assert.match(made[0].name, /Z-r-/, 'a “Before a restore” one');
    const holds = await js(`window.neo.snapshotRead(book.id, ${JSON.stringify(made[0].name)}, ${JSON.stringify(chId + '.html')})`);
    assert.equal(holds, now, 'holding the chapter as it was');
    assert.equal(await js('darlings.length'), darlingsBefore, 'nothing to Darlings');
    await js('structuralUndo()');
    await tick(300);
    assert.equal(await html(0), now);
  } finally {
    await js('setHistoryLevel("record")');
    await tick(500);
  }
});

test('a deleted chapter put back, after the chapter it followed, and ⌘Z taking it away again', async () => {
  const before = await chapterIds();
  await js('openHistory()');
  await daysReady();
  const gone = await js(`(() => {
    for (const s of historyShown.player.sessions()) for (const [ch, c] of Object.entries(s.stats.chapters)) if (c.gone && /Brief/.test(c.lead || "") && !book.chapterOrder.includes(ch)) return ch;
    return null;
  })()`);
  assert.ok(gone, 'a deleted chapter');
  await js(`historyShown.player.setMode(${JSON.stringify(gone)})`);
  // the days show it as it was just before it went
  await waitFor(`historyShown.player.view() === 'days' && historyShown.player.loaded().state === 'ready' && historyShown.player.chapters()[${JSON.stringify(gone)}] !== undefined`, 60000);
  const then = await js(`historyShown.player.chapters()[${JSON.stringify(gone)}]`);
  assert.match(then, /Brief\./);
  await waitFor('!document.querySelector(".hs-restore").hidden');
  assert.equal(await js('document.querySelector(".hs-restore").textContent'), 'Put This Chapter Back');
  await js('document.querySelector(".hs-restore").click()');
  await waitFor(`!historyShown && book.chapterOrder.length === ${before.length + 1}`);
  await tick(300);
  const after = await chapterIds();
  const back = after.find((c) => !before.includes(c));
  assert.equal(after.indexOf(back), 1, 'after the chapter it followed');
  assert.equal(await js(`chapterHTML[${JSON.stringify(back)}]`), then);
  const lines = await sessionLines();
  const at = lines.findIndex((l) => l[1] === 'b' && l[2] === back);
  assert.equal(lines[at][5], 'restore');
  assert.deepEqual(lines[at - 1].slice(1, 3), ['x', 'restore'], 'the moment, just before it');
  await flush();
  replayAll([readOpen(await sessionId()).text]);
  await js('structuralUndo()');
  await tick(300);
  assert.deepEqual(await chapterIds(), before);
});

test('text copied from a moment, pasted in the book, is recorded as from this book and from that moment', async () => {
  const chId = (await chapterIds())[0];
  await playerAtOlder(chId);
  const copied = await js(`(() => {
    const p = historyShown.player.paper.querySelector('.rp-body p');
    const r = document.createRange();
    r.selectNodeContents(p);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
    const dt = new DataTransfer();
    p.dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true }));
    getSelection().removeAllRanges();
    return { text: dt.getData('text/plain'), html: dt.getData('text/html') };
  })()`);
  assert.ok(copied.text.length > 3, 'something copied');
  assert.ok(!copied.html.includes('rp-caret'), 'without the player’s caret');
  key('Escape');
  await tick(300);
  key('Escape');
  await tick(300);
  await caretAt(0, 0, -1);
  await paste({ text: copied.text });
  const c = (await sessionLines()).filter((l) => l[1] === 'c' && l[2] === 'paste').pop();
  assert.equal(c[6], true, 'from this book');
  assert.equal(c[7].length, 3, 'and the moment: session, line, device');
  assert.equal(c[7][2], await js('rec.device'));
});

test('a paragraph restored to a moment: only it changes, the moment before it is tagged, and ⌘Z takes it back', async () => {
  const chId = (await chapterIds())[0];
  const { now } = await playerAtOlder(chId);
  // a paragraph as it was then whose words the chapter doesn't have now
  const then = await js(`(() => {
    const ch = ${JSON.stringify(chId)};
    const have = new Set([...document.querySelectorAll('.chapter[data-id="' + ch + '"] .chapter-body p')].map((p) => p.textContent));
    for (const p of historyShown.player.paper.querySelectorAll('.rp-chapter[data-ch="' + ch + '"] .rp-body p')) {
      if (p.textContent.trim() && !have.has(p.textContent)) { historyShown.player.pickPart(ch, p); return p.textContent; }
    }
    return null;
  })()`);
  assert.ok(then, 'a paragraph that has changed since');
  await waitFor('!document.querySelector(".hs-part-restore").parentElement.hidden');
  assert.equal(await js('document.querySelector(".hs-part-restore").getAttribute("aria-label")'), 'Restore This Paragraph');
  const darlingsBefore = await js('darlings.length');
  await js('document.querySelector(".hs-part-restore").click()');
  await waitFor(`!historyShown && chapterHTML[${JSON.stringify(chId)}] !== ${JSON.stringify(now)}`);
  await tick(300);
  const after = await html(0);
  const texts = (x) => [...x.matchAll(/<p[^>]*>(.*?)<\/p>/g)].map((m) => m[1].replace(/<[^>]+>/g, ''));
  assert.ok(texts(after).includes(then), 'the paragraph as it was');
  assert.equal(await js('darlings.length'), darlingsBefore, 'nothing to Darlings');
  // one paragraph changed, every other as it was
  const changed = texts(now).filter((p) => !texts(after).includes(p));
  assert.equal(changed.length, 1, 'kept: ' + JSON.stringify(texts(now)));
  const lines = await sessionLines();
  const xi = lines.map((l) => l[1]).lastIndexOf('x');
  assert.equal(lines[xi][2], 'restore');
  assert.equal(lines[xi].length, 6, 'with the moment');
  const ti = lines.map((l) => l[1]).lastIndexOf('tag', xi);
  assert.ok(ti > 0 && lines.slice(ti + 1, xi).every((l) => !['e', 'r', 'rd', 'x', 'd'].includes(l[1])), 'the moment before it tagged');
  await flush();
  replayAll([readOpen(await sessionId()).text]);
  assert.equal(await atTag(lines[ti][2], chId), now);
  await js('structuralUndo()');
  await tick(300);
  assert.equal(await html(0), now);
});

test('a paragraph whose chapter was deleted: History says so, and puts it in Darlings and on the clipboard as it was', async () => {
  await js('openHistory()');
  await daysReady();
  const gone = await js(`(() => {
    for (const s of historyShown.player.sessions()) for (const [ch, c] of Object.entries(s.stats.chapters)) if (c.gone && /Brief/.test(c.lead || '') && !book.chapterOrder.includes(ch)) return ch;
    return null;
  })()`);
  assert.ok(gone, 'a deleted chapter');
  // the player just before it went, its paragraph picked
  await js(`historyShown.player.openPlayer(historyShown.player.sessions().findIndex((s) => s.stats.chapters[${JSON.stringify(gone)}] && s.stats.chapters[${JSON.stringify(gone)}].gone), { ch: ${JSON.stringify(gone)}, at: 'end' })`);
  await playerReady({ drawn: false });
  await js(`(() => {
    const p = historyShown.player;
    const h = p.h();
    const at = p.steps().findIndex((i) => h.steps[i].k === 'd' && h.steps[i].ch === ${JSON.stringify(gone)});
    p.seek(at);
  })()`);
  await waitFor(`!!historyShown.player.paper.querySelector('.rp-chapter[data-ch="${gone}"] .rp-body p')`);
  await js(`historyShown.player.pickPart(${JSON.stringify(gone)}, historyShown.player.paper.querySelector('.rp-chapter[data-ch="${gone}"] .rp-body p'))`);
  await waitFor('!document.querySelector(".hs-part-restore").parentElement.hidden && document.querySelector(".hs-part-restore").getAttribute("aria-label") === "Restore This Paragraph"');
  // the clipboard, as the page writes it
  await js(`(() => {
    window.__clip = null;
    navigator.clipboard.write = async (items) => { window.__clip = { text: await (await items[0].getType('text/plain')).text(), html: await (await items[0].getType('text/html')).text() }; };
  })()`);
  const darlingsBefore = await js('darlings.length');
  await js('document.querySelector(".hs-part-restore").click()');
  // (the newest dialog: the first-run one is there too, hidden)
  await waitFor('!!document.body.lastElementChild.querySelector(".fr-choice")', 30000);
  assert.equal(await js('document.body.lastElementChild.querySelector(".modal h2").textContent'), 'The chapter this paragraph was in was deleted');
  assert.match(await js('document.body.lastElementChild.querySelector(".modal p").textContent'), /^Their chapter was deleted on .+, and NEO can’t find these words anywhere else in the book\./);
  await js('document.body.lastElementChild.querySelectorAll(".fr-choice")[1].click()');
  await waitFor(`darlings.length === ${darlingsBefore + 1} && !!window.__clip`);
  assert.match(await js('darlings[0].html'), /Brief\./);
  assert.match(await js('darlings[0].chapterLabel'), /^From a deleted chapter, as it was on /);
  const clip = await js('window.__clip');
  assert.match(clip.text, /Brief\./);
  assert.ok(await js(`rec.copiedFrom.has(Rec.digest(${JSON.stringify(clip.text)}))`), 'its paste will say where it came from');
  assert.ok(await js('!!historyShown'), 'History stays open');
  key('Escape');
  await tick(300);
  key('Escape');
  await tick(300);
  // (the book's own Darlings, as they were)
  await js(`darlings.shift(); window.neo.writeJSON(book.id, 'darlings', darlings)`);
});

/* ---------- tags and snapshots ---------- */

test('⌘S takes a snapshot, and tags it in the recording, on disk at once', async () => {
  if (await js('!!historyShown')) await js('historyShown(); 0'); // (left open by the test before)
  await caretAt(0, 0, -1);
  await type(' Snap.');
  await tick(900);
  const before = await js('window.neo.snapshotList(book.id).then((l) => l.map((s) => s.name))');
  key('s', [CTRL]);
  await waitFor(`window.neo.snapshotList(book.id).then((l) => l.length > ${before.length})`);
  await tick(300);
  const name = (await js('window.neo.snapshotList(book.id)')).map((s) => s.name).find((n) => !before.includes(n));
  assert.match(name, /Z-k-/, 'a snapshot of the writer’s');
  const tg = (await sessionLines()).filter((l) => l[1] === 'tag').pop();
  assert.deepEqual([tg[3], tg[4], tg[5]], [null, null, { snapshot: name }]);
  assert.ok(readOpen(await sessionId()).text.includes(JSON.stringify(tg[2])), 'already on disk');
  // History shows it among its tags, named as the snapshot list names it
  await js('openHistory()');
  await daysReady();
  await waitFor('[...document.querySelectorAll(".hs-tag-item .hs-ch-name")].some((x) => x.textContent === "Snapshot · Taken by you")');
  key('Escape');
  await tick(300);
});

test('Tag This Moment… names the moment on the sheet, and the tag takes you back to it', async () => {
  const chId = (await chapterIds())[0];
  await playerAtOlder(chId);
  await waitFor('!document.querySelector(".hs-tag").hidden');
  const ref = await js(`(() => { const p = historyShown.player; const h = p.h(); const s = h.steps[p.steps()[p.pos() - 1]]; const x = h.sessions[s.session]; return [x.id, s.line, x.device]; })()`);
  key('s', [CTRL]);
  // (the newest dialog: the first-run one is there too, hidden)
  await waitFor('document.body.lastElementChild.classList.contains("modal-backdrop") && !!document.body.lastElementChild.querySelector("input")');
  await js('(() => { const i = document.body.lastElementChild.querySelector("input"); i.value = "Sent to my agent"; i.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); })()');
  await waitFor('[...document.querySelectorAll(".hs-tag-item .hs-ch-name")].some((x) => x.textContent === "Sent to my agent")');
  const tg = (await sessionLines()).filter((l) => l[1] === 'tag').pop();
  assert.equal(tg[3], 'Sent to my agent');
  assert.deepEqual(tg[4].slice(0, 3), ref, 'the moment shown, not now');
  const then = await js(`historyShown.player.chapters()[${JSON.stringify(chId)}]`); // (the sheet as tagged)
  // picked: the player at that moment
  await js('historyShown.player.seek(0)');
  await js('[...document.querySelectorAll(".hs-tag-item")].find((x) => x.textContent.includes("Sent to my agent")).click()');
  await waitFor(`historyShown.player.chapters()[${JSON.stringify(chId)}] === ${JSON.stringify(then)}`);
  // and search finds it by its name
  await js('historyShown.player.runFind("agent")');
  await waitFor('[...document.querySelectorAll(".hs-results .hs-ch-name")].some((x) => x.textContent === "Tag · Sent to my agent")');
  key('Escape');
  await tick(200);
  key('Escape');
  await tick(300);
});

test('a duplicated book leaves the original’s Writing History behind', async () => {
  await flush();
  const copy = await js(`window.neo.duplicateBook(book.id, 'Harbor copy')`);
  const dir = path.join(LIB, copy.id);
  assert.ok(fs.existsSync(path.join(dir, 'chapters')), 'the chapters copied');
  assert.ok(fs.existsSync(path.join(LIB, BOOK, 'recording')), 'the original keeps its history');
  assert.ok(!fs.existsSync(path.join(dir, 'recording')), 'the copy has none');
  fs.rmSync(dir, { recursive: true, force: true });
});

/* ---------- imported books ---------- */

// a file picked with Import, as the window takes it in: a new book on the shelf, opened
async function importAndOpen(file) {
  return js(`(async () => {
    const results = await window.neo.importFiles([${JSON.stringify(file)}]);
    await addImportedBooks(results, library.shelves[0]);
    const ids = library.shelves[0].bookIds;
    await openBook(ids[ids.length - 1]);
    return book.id;
  })()`);
}

test('a .docx imported as a new book starts from its text, not typed out', async () => {
  const JSZip = require('jszip');
  const zip = new JSZip();
  const para = (text) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
  zip.file('word/document.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    ['Chapter One', 'The tide went out.', 'Gulls on the mud.', 'Chapter Two', 'It came back.'].map(para).join('') + '</w:body></w:document>');
  const file = path.join(tmp, 'Tide.docx');
  fs.writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer' }));
  const id = await importAndOpen(file);
  await tick(500);
  assert.notEqual(id, BOOK);
  assert.match(await js('book.chapterOrder.map((c) => chapterHTML[c]).join("")'), /The tide went out\.[\s\S]*It came back\./);
  assert.equal(await js('rec.live'), false, 'opening the book records nothing yet');
  await caretAt(0, 0, -1);
  await type(' Written after.');
  await flush();
  const lines = R.parseSession(await js('rec.w.lines.join("\\n") + "\\n"')).lines;
  const [first, second] = await js('book.chapterOrder');
  const b = lines.find((l) => l[1] === 'b' && l[2] === first);
  assert.ok(b && b[3] !== null && /The tide went out/.test(b[3]) && b[5] === 'baseline', 'a baseline: ' + JSON.stringify(b));
  // the chapter not touched has its baseline too, so History shows it on this day
  const b2 = lines.find((l) => l[1] === 'b' && l[2] === second);
  assert.ok(b2 && /It came back/.test(b2[3]) && b2[5] === 'baseline', 'the other chapter’s baseline: ' + JSON.stringify(b2));
  assert.ok(!lines.some((l) => l[1] === 'e' && /tide went out/.test(l[4] || '')), 'never typed out');
  assert.ok(lines.some((l) => l[1] === 'r' && /Written/.test(l[2])), 'what was written after it is typing');
});

test('a script imported from Fountain: a scene card moved is recorded, and ⌘Z puts it back', async () => {
  const file = path.join(tmp, 'Harbor.fountain');
  fs.writeFileSync(file, 'Title: Harbor\n\nINT. HARBOR - NIGHT\n\nRain on the water.\n\nEXT. QUAY - DAWN\n\nThe boats come home.\n\nINT. BAR - DAY\n\nNobody talks.\n');
  await importAndOpen(file);
  assert.equal(await js('book.format'), 'screenplay');
  await waitFor('spLayout.scenes.length === 3', 20000);
  const all = () => js('book.chapterOrder.map((c) => chapterHTML[c]).join("")');
  const before = await all();
  const order = (h) => ['HARBOR', 'QUAY', 'BAR'].sort((x, y) => h.indexOf('. ' + x) - h.indexOf('. ' + y));
  assert.deepEqual(order(before), ['HARBOR', 'QUAY', 'BAR']);
  await js('spMoveScene(2, 0)');
  await tick(500);
  assert.deepEqual(order(await all()), ['BAR', 'HARBOR', 'QUAY'], 'the last scene first');
  await js('structuralUndo()');
  await tick(500);
  assert.equal(await all(), before);
  await flush();
  const lines = R.parseSession(await js('rec.w.lines.join("\\n") + "\\n"')).lines;
  assert.ok(lines.some((l) => l[1] === 'x' && l[2] === 'script'), 'the move, with its cause');
  assert.ok(lines.some((l) => l[1] === 'x' && l[2] === 'undo-structural'), 'and the undo');
});

test('a script in History is set as the editor sets it: its type, its page, each line where it prints', async () => {
  // (the script imported just above is open) the editor's lines: where
  // each sits across the page, as a share of the page's width
  const across = (sheet, body) => js(`(() => {
    const page = document.querySelector(${JSON.stringify(sheet)}).getBoundingClientRect();
    const out = {};
    for (const p of document.querySelectorAll(${JSON.stringify(body)} + ' > p')) {
      const k = p.className.split(' ').find((c) => c.startsWith('sp-')) || 'action';
      if (k in out) continue;
      const r = p.getBoundingClientRect();
      const cs = getComputedStyle(p);
      out[k] = { left: +((r.left - page.left) / page.width).toFixed(3), font: cs.fontFamily.split(',')[0], upper: cs.textTransform };
    }
    return out;
  })()`);
  const editor = await across('#chapters', '#chapters .chapter-body');
  assert.ok(editor['sp-heading'] && editor.action, 'the editor shows a heading and action: ' + JSON.stringify(editor));
  await flush();
  await js('openHistory()');
  await daysReady();
  await playLatest();
  assert.equal(await js('historyShown.player.paper.classList.contains("hs-script")'), true);
  const shown = await across('.hs-paper .rp-chapter', '.hs-paper .rp-body');
  for (const k of Object.keys(editor)) {
    assert.ok(shown[k], k + ' in History: ' + JSON.stringify(shown));
    assert.equal(shown[k].font, editor[k].font, k + ': the script’s type');
    assert.equal(shown[k].upper, editor[k].upper, k + ': its capitals');
    assert.ok(Math.abs(shown[k].left - editor[k].left) < 0.01, `${k}: ${shown[k].left} of the page across in History, ${editor[k].left} in the editor`);
  }
  await js('historyShown(); 0');
  await tick(300);

  // and the exported page, the same way
  const { dialog } = require('electron');
  const real = dialog.showSaveDialog;
  const file = path.join(tmp, 'script-replay.html');
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
  try {
    await js("setTimeout(() => exportWritingHistory(), 0), true");
    await waitFor('!!document.querySelector(".ex-modal")');
    await js('document.querySelector(".ex-understood") && document.querySelector(".ex-understood").click()');
    await js('(document.querySelector(".ex-modal .m-continue") || {}).click && document.querySelector(".ex-modal .m-continue").click()');
    await tick(100);
    await js('[...document.querySelectorAll(".ex-modal .m-ok")].find((b) => b.offsetParent).click()');
    for (let i = 0; i < 300 && !fs.existsSync(file); i++) await tick(100);
  } finally {
    dialog.showSaveDialog = real;
  }
  const data = JSON.parse(/<script type="application\/json" id="rx-data">([^]*?)<\/script>/.exec(fs.readFileSync(file, 'utf8'))[1]);
  assert.equal(data.script, true, 'the page knows it’s a script');
  const w = new BrowserWindow({ show: false, width: 1200, height: 900, webPreferences: { offscreen: true } });
  try {
    await w.loadFile(file);
    const page = (code) => w.webContents.executeJavaScript(code, true);
    for (let i = 0; i < 300 && !(await page('!!document.querySelector(".rx-sheet .rx-body p.sp-heading")')); i++) await tick(100);
    assert.equal(await page('document.querySelector(".rx-sheet").classList.contains("rx-script")'), true);
    const inPage = await page(`(() => {
      const page = document.querySelector('.rx-sheet').getBoundingClientRect();
      const out = {};
      for (const p of document.querySelectorAll('.rx-sheet .rx-body > p')) {
        const k = p.className.split(' ').find((c) => c.startsWith('sp-')) || 'action';
        if (k in out) continue;
        const r = p.getBoundingClientRect();
        out[k] = { left: +((r.left - page.left) / page.width).toFixed(3), upper: getComputedStyle(p).textTransform };
      }
      return out;
    })()`);
    for (const k of Object.keys(editor)) {
      if (!inPage[k]) continue; // (the page shows the book as the last day it can play left it)
      assert.equal(inPage[k].upper, editor[k].upper, k + ': its capitals, in the page');
      assert.ok(Math.abs(inPage[k].left - editor[k].left) < 0.01, `${k}: ${inPage[k].left} of the page across in the export, ${editor[k].left} in the editor`);
    }
    assert.ok(inPage['sp-heading'] && inPage.action, 'the page shows a heading and action: ' + JSON.stringify(inPage));
  } finally {
    w.destroy();
  }
});

/* ---------- runner ---------- */

/* ---------- deleting a book's history ---------- */

/* ---------- proof of when I wrote ---------- */

test('proof turned on seals the session being written; a named tag seals it again at once; only fingerprints leave', async () => {
  if (await js('!book || book.id !== ' + JSON.stringify(BOOK))) {
    await js(`openBook(${JSON.stringify(BOOK)})`);
    await tick(500);
  }
  // the network, as the test's: drand answers, the timestamp authorities don't
  const crypto = require('crypto');
  const sig = crypto.randomBytes(48).toString('hex');
  const randomness = crypto.createHash('sha256').update(Buffer.from(sig, 'hex')).digest('hex');
  const round = Math.floor((Date.now() / 1000 - 1692803367) / 3) + 1; // quicknet's, now
  // (the proof worker's network: drand answers with this, the authorities don't)
  fs.writeFileSync(process.env.NEO_E2E_DRAND, JSON.stringify({ round, signature: sig, randomness }));
  fs.rmSync(process.env.NEO_E2E_NET_LOG, { force: true });
  const sentNow = () => {
    let lines = [];
    try { lines = fs.readFileSync(process.env.NEO_E2E_NET_LOG, 'utf8').split('\n').filter(Boolean); } catch { /* nothing asked yet */ }
    return lines.map((l) => JSON.parse(l)).map((x) => ({ url: x.url, body: x.body ? Buffer.from(x.body, 'base64') : null }));
  };
  const sealsDir = () => path.join(recDirOf(), 'seals');
  const seal = (n) => JSON.parse(fs.readFileSync(path.join(sealsDir(), String(n).padStart(6, '0') + '.json'), 'utf8'));
  const headNow = async () => R.verifyChain(readOpen(await sessionId()).text).last;
  try {
    await caretAt(0, 0, -1);
    await type(' Proven.');
    await flush();
    // asked first, in plain words; nothing is sent until the writer says yes
    await js('setHistoryLevel("timestamp").then((on) => { window.__proved = on; }); 0');
    const asked = await confirmShown();
    assert.ok(asked.points.some((x) => /never your words/.test(x)));
    assert.equal(sentNow().length, 0, 'nothing sent while asking');
    await answer(true);
    await waitFor('window.__proved === "timestamp"');
    assert.equal(await js('library.proveWriting'), true);
    for (let i = 0; i < 300 && !fs.existsSync(path.join(sealsDir(), '000001.json')); i++) await tick(100);
    const first = seal(1);
    const session = await sessionId();
    assert.equal(first.heads[session], await headNow(), 'the open session, as far as it’s on disk');
    assert.ok(closedSessions().every((s) => first.heads[s]), 'and every session before it');
    assert.deepEqual(first.after, [{ beacon: 'drand-quicknet', round, randomness, signature: sig }]);

    // more writing waits for the writing to stop (five minutes) before it's sealed
    await type(' Still.');
    await flush();
    await tick(500);
    assert.ok(!fs.existsSync(path.join(sealsDir(), '000002.json')), 'not sealed again while the writing goes on');
    // a tag the writer names is sealed at once
    await js('rec.tag("Sent to my agent"); 0');
    for (let i = 0; i < 300 && !fs.existsSync(path.join(sealsDir(), '000002.json')); i++) await tick(100);
    const second = seal(2);
    assert.deepEqual(Object.keys(second.heads), [session]);
    assert.equal(second.heads[session], await headNow());
    assert.ok(R.parseSession(readOpen(session).text).lines.some((l) => l[1] === 'tag' && l[3] === 'Sent to my agent'));

    // what left the computer: drand asked, and seal fingerprints, never a word
    const words = Buffer.from('Proven');
    const sent = sentNow();
    for (const s of sent) assert.ok(!s.body || (s.body.length <= 70 && !s.body.includes(words)), 'only fingerprints: ' + s.url);
    assert.ok(sent.some((s) => /timestamp\.digicert\.com/.test(s.url)) && sent.some((s) => /timestamp\.sectigo\.com/.test(s.url)), 'both authorities asked');
    assert.deepEqual(fs.readdirSync(sealsDir()).sort(), ['000001.json', '000002.json'], 'nothing stamped while offline');

    // History says so, as it opens
    await js('openHistory()');
    await daysReady();
    await waitFor('/waiting for the network/.test(document.querySelector("#hint").textContent)');
    assert.equal(await js('historyLevel()'), 'timestamp');
    key('Escape');
    await tick(300);

    // and anyone can check what's there
    const { verifyBook } = require('./verify-recording.js');
    const report = await verifyBook(path.join(LIB, BOOK));
    const mine = report.devices.find((d) => d.seals);
    assert.equal(mine.seals.seals.length, 2);
    for (const s of mine.seals.seals) assert.equal(s.ok, true, s.problems.join('; '));
  } finally {
    await js('setHistoryLevel("record"); 0');
    fs.rmSync(process.env.NEO_E2E_DRAND, { force: true });
  }
  assert.equal(await js('library.proveWriting'), false);
});

/* ---------- the evidence report and the exported replay page ---------- */

test('the evidence report shows how the book was written; Export replay… writes a page that plays and checks itself', async () => {
  if (await js('!book || book.id !== ' + JSON.stringify(BOOK))) {
    await js(`openBook(${JSON.stringify(BOOK)})`);
    await tick(500);
  }
  await caretAt(0, 0, -1);
  await type(' Evidence, typed.');
  await flush();
  await js('openHistory()');
  await daysReady();
  // the report, from every session
  await js('document.querySelector(".hs-evidence").click()');
  await waitFor('!!document.querySelector(".ev-body .ev-facts")', 30000);
  const facts = await js('document.querySelector(".ev-body").innerText');
  assert.match(facts, /keys pressed/);
  assert.match(facts, /The gaps between keys/);
  assert.match(facts, /Revised as typed/);
  assert.match(facts, /whose ideas/);
  assert.doesNotMatch(facts, /Judgement/i, 'figures only');
  // a chapter's own, and back
  if (await js('!!document.querySelector(".ev-chapters tr[data-ch]")')) {
    await js('document.querySelector(".ev-chapters tr[data-ch]").click()');
    assert.equal(await js('document.querySelector(".ev-back").hidden'), false);
    await js('document.querySelector(".ev-back").click()');
  }
  await js('document.querySelector(".ev-done").click()');
  assert.equal(await js('!!document.querySelector(".ev-backdrop")'), false);
  assert.equal(await js('!!historyShown'), true, 'History still open behind it');

  // the page, the whole book
  const { dialog } = require('electron');
  const real = dialog.showSaveDialog;
  const file = path.join(tmp, 'replay.html');
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
  try {
    await js("setTimeout(() => exportWritingHistory(), 0), true");
    await waitFor('!!document.querySelector(".ex-modal")');
    await js('document.querySelector(".ex-modal .m-ok").click()');
    for (let i = 0; i < 300 && !fs.existsSync(file); i++) await tick(100);
  } finally {
    dialog.showSaveDialog = real;
  }
  const html = fs.readFileSync(file, 'utf8');
  const data = JSON.parse(/<script type="application\/json" id="rx-data">([^]*?)<\/script>/.exec(html)[1]);
  assert.equal(data.partial, false);
  assert.equal(data.title, 'Harbor');
  assert.ok(data.sessions.length >= 2);
  assert.ok(data.sessions.some((s) => s.open), 'the session being written, as far as it’s on disk');
  assert.match(html, /keys pressed/, 'the report as History showed it');
  // no device's own name: each is Device 1, 2, … in the order it first wrote
  assert.ok(data.sessions.every((s) => /^Device \d+$/.test(s.name)), data.sessions.map((s) => s.name).join(', '));
  assert.equal(data.sessions[0].name, 'Device 1');
  assert.ok(!html.includes(os.hostname()), 'the computer’s name stays out of the page');
  key('Escape');
  await tick(300);
  // opened in a browser window of its own, it checks out
  const w = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  try {
    await w.loadFile(file);
    const page = (code) => w.webContents.executeJavaScript(code, true);
    for (let i = 0; i < 300 && !(await page('!!document.querySelector(".rx-same")')); i++) await tick(100);
    const checks = await page('[...document.querySelectorAll("#rx-checks li")].map((li) => li.className + " " + li.textContent)');
    assert.ok(checks.length >= 2, checks.join('\n'));
    assert.ok(checks.every((c) => !c.startsWith('bad')), checks.join('\n'));
    assert.equal(await page('document.querySelector(".rx-same").className'), 'rx-same ok');
    // laid out as History: the controls over the timeline, and the evidence and the checks in pop-ups from the header
    assert.deepEqual(await page('[".rx-bottom .rx-play", ".rx-bottom .rx-fast", ".rx-top .rx-evbtn", ".rx-top .rx-ckbtn"].map((q) => !!document.querySelector(q))'), [true, true, true, true]);
    assert.equal(await page('document.querySelector("#rx-report").closest("dialog") !== null && document.querySelector("#rx-checks").closest("dialog") !== null'), true);
    assert.match(await page('document.querySelector(".rx-ckbtn").className'), /\bok\b/);
    // (the book's opening words: an earlier test dates a session the next
    // day, ahead of sessions written after it, so the days can't be played
    // through to now here; scripts/replay-page.test.js checks the last day's end)
    assert.match(await page('document.querySelector(".rx-sheet").innerText'), /Rain fell on the quay/);
  } finally {
    w.destroy();
  }
});

test('a book’s history deleted goes to the trash with its backup; the book is untouched and records afresh', async () => {
  if (await js('!book || book.id !== ' + JSON.stringify(BOOK))) {
    await js(`openBook(${JSON.stringify(BOOK)})`);
    await tick(500);
  }
  await caretAt(0, 0, -1);
  await type(' Kept.');
  await flush();
  const { shell } = require('electron');
  const real = { trash: shell.trashItem };
  const trashed = [];
  // the system's trash is a folder of the test's
  shell.trashItem = async (p) => {
    const to = path.join(tmp, 'trash', String(trashed.length));
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(p, to);
    trashed.push(p);
  };
  try {
    const mirror = path.join(LIB, 'Backups', 'recordings', BOOK);
    const cache = path.join(tmp, 'app', 'recording-cache', BOOK);
    assert.ok(fs.existsSync(mirror) && fs.existsSync(cache), 'a mirror and a cache to begin with');
    const words = await bookNow();
    const old = await sessionId();
    await js('openHistory()');
    await daysReady();
    await js('document.querySelector(".hs-delete").click()');
    // it says what goes, and the button waits for the phrase
    const asked = await confirmShown();
    assert.match(asked.title, /^Delete the Writing History of “Harbor”\?$/);
    assert.ok(asked.points.some((x) => /book itself is untouched/.test(x)));
    assert.ok(asked.points.some((x) => /Recycle Bin|Trash/.test(x)));
    const typeIt = (text) => js(`(() => { const i = document.querySelector('.confirm-modal input'); i.value = ${JSON.stringify(text)}; i.dispatchEvent(new Event('input')); return document.querySelector('.confirm-modal .m-ok').disabled; })()`);
    assert.equal(await js('document.querySelector(".confirm-modal .m-ok").disabled'), true);
    assert.equal(await typeIt('delete'), true, 'not yet');
    await js('document.querySelector(".confirm-modal .m-ok").click()');
    await tick(200);
    assert.ok(fs.existsSync(path.join(LIB, BOOK, 'recording')), 'nothing deleted without the phrase');
    assert.equal(await typeIt('Delete History'), false, 'any case');
    await answer(true);
    await waitFor('!!historyShown && historyShown.player.loaded().state === "empty" && historyShown.player.days().length === 0', 30000);
    assert.deepEqual(trashed, [path.join(LIB, BOOK, 'recording'), mirror]);
    assert.ok(!fs.existsSync(path.join(LIB, BOOK, 'recording')) && !fs.existsSync(mirror), 'both in the trash');
    assert.ok(fs.readdirSync(path.join(tmp, 'trash', '0')).some((n) => n.startsWith('d-')), 'the recording itself, recoverable');
    assert.ok(!fs.existsSync(cache), 'the cache made from it gone');
    assert.deepEqual(await bookNow(), words, 'the book untouched');
    key('Escape');
    await tick(300);
    // recording again, from the book as it is
    assert.equal(await js('rec.on'), true);
    assert.notEqual(await sessionId(), old);
    await caretAt(0, 0, -1);
    await type(' Fresh.');
    await flush();
    const first = R.parseSession(readOpen(await sessionId()).text).lines.find((l) => l[1] === 'b');
    assert.equal(first[5], 'baseline', 'the chapter as it is, with nothing before it');
    assert.deepEqual(closedSessions(), []);
  } finally {
    shell.trashItem = real.trash;
  }
});

async function main() {
  await app.whenReady();
  let failed = 0;
  try {
    let win;
    while (!(win = BrowserWindow.getAllWindows()[0])) await tick(50);
    wc = win.webContents;
    // A window behind another one, or minimized, gets no animation frames,
    // and the player loads and plays on them: keep it running unseen
    wc.setBackgroundThrottling(false);
    while (!(await js(`typeof library !== 'undefined' && !!library`).catch(() => false))) await tick(50);
    await tick(300);
    await js(`(async () => {
      document.getElementById('firstrun').hidden = true;
      await addImportedBooks([{ name: 'Harbor', chapters: [
        { title: 'One', paras: ['Rain fell on the harbor.', 'The harbor lights were out.', 'Nobody came.'].map((text) => ({ text })) },
        { title: 'Two', paras: ['The boats came home.', 'They tied up at dawn.', 'All but one.'].map((text) => ({ text })) }
      ] }], library.shelves[0]);
      const ids = library.shelves[0].bookIds;
      rec.strict = true;
      await openBook(ids[ids.length - 1]);
    })()`);
    BOOK = await js('book.id');
    await tick(300);
    win.focus();
    for (const t of tests) {
      try {
        await t.fn();
        const r = await check();
        assert.equal(r.unobserved, t.expect.unobserved || 0, 'changes the recorder didn\'t see');
        assert.deepEqual(r.mismatched, [], 'chapters the log doesn\'t replay to');
        assert.deepEqual(r.stale, [], 'pages that differ from chapterHTML');
        console.log(`ok   ${t.name}  (${r.lines} lines${r.drift ? `, drift ${r.drift}` : ''})`);
      } catch (err) {
        failed++;
        console.log('FAIL ' + t.name + '\n     ' + String(err.message).replace(/\n/g, '\n     '));
        // a failed test can leave History open, mid-load or in the player,
        // and every test after it would wait out its timeouts: say how it
        // was left, and close it
        const left = await historyState();
        if (left.open) {
          console.log('     History left open: ' + JSON.stringify(left));
          await js('historyShown && historyShown()').catch(() => {});
          await tick(500);
        }
      }
    }
    const r = await check();
    console.log(`\n${tests.length - failed} passed, ${failed} failed`);
    // what the recording saw, every session on disk: each kind of line,
    // each input type, and each cause NEO gave
    await js('flushAllSaves()');
    await tick(500);
    const lines = [...closedSessions().map(readClosed), ...openSessions().map((id) => readOpen(id).text)]
      .flatMap((text) => R.parseSession(text).lines);
    const count = (list, pick) => list.reduce((n, l) => ({ ...n, [pick(l)]: (n[pick(l)] || 0) + 1 }), {});
    const tally = {
      kinds: count(lines, (l) => l[1]),
      inputs: count(lines.filter((l) => l[1] === 'e' && l.length > 5), (l) => (l[5] || '?') + (l.length > 6 ? ' (no key)' : '')),
      causes: count(lines.filter((l) => l[1] === 'x' || l[1] === 'b' || l[1] === 'd'), (l) => l[1] === 'b' ? l[5] : l[1] === 'x' ? l[2] : l[3])
    };
    console.log('lines:       ' + JSON.stringify(tally.kinds));
    console.log('input types: ' + JSON.stringify(tally.inputs));
    console.log('causes:      ' + JSON.stringify(tally.causes));
    console.log(`last session: ${r.lines} lines, ${r.bases} bases, ${r.edits} edits, ${r.drops} drops, ${r.writes} writes, ${r.unobserved} unobserved, ${r.drift} drift`);
  } catch (err) {
    failed++;
    console.error(err);
  } finally {
    app.exit(failed ? 1 : 0);
  }
}
main();
