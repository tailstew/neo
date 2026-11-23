// End-to-end tests for notes another program leaves for Writing History
// (docs/tag-notes-plan.md, part 2): a file put in a book's history-notes/
// folder, as Draft Sleuth writes one, is taken into the history as a tag
// with its note, once, and the file is left as it was. NEO runs on a
// throwaway library. Run with `npm run test:history-notes`.

'use strict';

const neo = require('./e2e-neo.js')('history-notes');
const { js, tick, flush, waitFor, assert, test } = neo;
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let CH = null; // the first chapter's id
const notesDir = () => path.join(neo.LIB, neo.book, 'history-notes');
// a note as Draft Sleuth writes it: .tmp, then renamed
function put(id, fields = {}, name = id + '.json') {
  fs.mkdirSync(notesDir(), { recursive: true });
  const note = { neoNote: 1, id, at: '2026-11-23T10:15:02.000Z', app: 'Draft Sleuth', kind: 'feedback', text: 'prompt feedback-1\n\nWhat works: the storm.', ...fields };
  const file = path.join(notesDir(), name);
  fs.writeFileSync(file + '.tmp', typeof fields === 'string' ? fields : JSON.stringify(note, null, 2));
  fs.renameSync(file + '.tmp', file);
  return file;
}
// the hash Draft Sleuth works out of the chapter file exactly as read
const fileHash = (html) => crypto.createHash('sha256').update(html, 'utf8').digest().subarray(0, 16).toString('base64url');
const look = () => js(`takeHistoryNotes(book.id)`);
const tagLines = async () => (await neo.sessionLines()).filter((l) => l[1] === 'tag');
const taken = (name) => js(`conflictsTaken(book.id, 'notes').includes(${JSON.stringify(name)})`);

test('a note left in history-notes/ becomes one tag, "Feedback · Draft Sleuth", with its note; the file is unchanged', async () => {
  const chapterFile = fs.readFileSync(path.join(neo.LIB, neo.book, 'chapters', CH + '.html'), 'utf8');
  assert.equal(fileHash(chapterFile), await js(`Rec.digest(${JSON.stringify(chapterFile)})`), 'Draft Sleuth’s hash is NEO’s');
  const file = put('ds-20261123t101502-k3f9', { chapter: CH, hash: fileHash(chapterFile), model: 'claude-fable-5-2', extra: 'ignored' });
  const bytes = fs.readFileSync(file);
  await look();
  const lines = (await tagLines()).filter((l) => l[2] === 'n-ds-20261123t101502-k3f9');
  assert.equal(lines.length, 1);
  const [, , , label, at, made, note] = lines[0];
  assert.equal(label, null);
  assert.equal(at, null);
  assert.deepEqual(made, { from: { app: 'Draft Sleuth', kind: 'feedback', at: '2026-11-23T10:15:02.000Z', chapter: CH, model: 'claude-fable-5-2' } }, 'unknown fields left out, no `since`');
  assert.equal(note, 'prompt feedback-1\n\nWhat works: the storm.');
  assert.ok(await taken('ds-20261123t101502-k3f9.json'));
  assert.ok(fs.readFileSync(file).equals(bytes), 'the file byte for byte as it was');
  assert.deepEqual(fs.readdirSync(notesDir()), ['ds-20261123t101502-k3f9.json'], 'nothing else written there');
  // a second look makes no second tag
  await look();
  await flush();
  await look();
  assert.equal((await tagLines()).filter((l) => l[2] === 'n-ds-20261123t101502-k3f9').length, 1);
  // History names it and shows where it's from above the note
  await neo.openHistory();
  assert.ok((await neo.tagItems()).includes('Feedback · Draft Sleuth'));
  await js('[...document.querySelectorAll(".hs-tag-item")].find((x) => x.querySelector(".hs-ch-name").textContent === "Feedback · Draft Sleuth").click()');
  await waitFor('!document.querySelector(".hs-note-bar").hidden');
  const head = await js('document.querySelector(".hs-note-head").textContent');
  assert.match(head, /As given by Draft Sleuth/);
  assert.match(head, /Model: claude-fable-5-2/);
  assert.match(head, /About /);
  assert.doesNotMatch(head, /had changed/);
  // renamed or removed, never edited: no Edit Note…
  assert.ok(await neo.tagMenu('Feedback · Draft Sleuth', 'go'));
  const labels = await js('window.__menu.map((i) => i.label)');
  assert.ok(labels.includes('Rename…') || labels.includes('Name…'));
  assert.ok(!labels.some((l) => /Note…$/.test(l)), JSON.stringify(labels));
  await neo.closeHistory();
});

test('a note about a chapter changed since: `since`; a pasted one and a plain note are named as such', async () => {
  put('ds-old-hash', { chapter: CH, hash: 'AAAAAAAAAAAAAAAAAAAAAA' });
  put('ds-pasted', { kind: 'feedback', pasted: true, text: 'Pasted from elsewhere.' });
  put('other-note', { app: 'Margin', kind: 'something', text: 'A plain note.' });
  await look();
  const by = Object.fromEntries((await tagLines()).map((l) => [l[2], l]));
  assert.equal(by['n-ds-old-hash'][5].from.since, true);
  assert.equal(by['n-ds-pasted'][5].from.pasted, true);
  assert.ok(!('model' in by['n-ds-pasted'][5].from));
  assert.equal(by['n-other-note'][5].from.kind, 'note', 'an unknown kind is a note');
  await neo.openHistory();
  const items = await neo.tagItems();
  assert.ok(items.includes('Note · Margin'), JSON.stringify(items));
  await neo.closeHistory();
});

test('a broken file, an oversized one, a wrong id and a wrong version are skipped, and stay', async () => {
  const before = (await tagLines()).length;
  const files = [
    put('broken', '{ "neoNote": 1, "id": "brok'),
    put('big', { text: 'x'.repeat(40000), pad: 'y'.repeat(260 * 1024) }),
    put('named-one', { id: 'named-other' }),
    put('v2', { neoNote: 2 }),
    put('Upper', {}, 'Upper.json'),
    put('long', { text: 'z'.repeat(50001) }),
    put('noapp', { app: '' })
  ];
  await look();
  assert.equal((await tagLines()).length, before, 'no tag for any of them');
  for (const f of files) assert.ok(fs.existsSync(f), path.basename(f) + ' is still there');
  assert.equal(await taken('broken.json'), false);
});

test('with recording off nothing is taken in; once it’s on, the note is', async () => {
  await js('setHistoryLevel("off")');
  await waitFor('!rec.on');
  put('while-off', { text: 'Left while nothing recorded.' });
  await look();
  assert.equal(await taken('while-off.json'), false);
  await js('setHistoryLevel("record")');
  await waitFor('rec.on');
  await waitFor(`conflictsTaken(book.id, 'notes').includes('while-off.json')`);
  assert.ok((await tagLines()).some((l) => l[2] === 'n-while-off' && l[6] === 'Left while nothing recorded.'));
});

test('opening the book takes in a note left while it was closed; a file tidied away is forgotten', async () => {
  await js('backToShelf()');
  await tick(800);
  put('while-closed', { text: 'Left while the book was shut.' });
  fs.unlinkSync(path.join(notesDir(), 'ds-pasted.json'));
  await js(`openBook(${JSON.stringify(neo.book)})`);
  await waitFor(`!!book && book.id === ${JSON.stringify(neo.book)} && rec.on`);
  await waitFor(`conflictsTaken(book.id, 'notes').includes('while-closed.json')`);
  assert.equal(await taken('ds-pasted.json'), false, 'its mark is gone with it');
});

test('Duplicate leaves history-notes/ out', async () => {
  const id = await js(`window.neo.duplicateBook(book.id, 'Copy of Notes').then((r) => r && r.id)`);
  const dir = path.join(neo.LIB, typeof id === 'string' ? id : '');
  assert.ok(typeof id === 'string' && fs.existsSync(dir), 'the copy: ' + JSON.stringify(id));
  assert.ok(!fs.existsSync(path.join(dir, 'history-notes')));
  assert.ok(!fs.existsSync(path.join(dir, 'recording')));
});

neo.run(async () => {
  await js(`(async () => {
    await addImportedBooks([{ name: 'Notes', chapters: ['One', 'Two'].map((title) => ({
      title, paras: [title + ' begins.', title + ' ends.'].map((text) => ({ text }))
    })) }], library.shelves[0]);
    const ids = library.shelves[0].bookIds;
    rec.strict = true;
    await openBook(ids[ids.length - 1]);
  })()`);
  neo.book = await js('book.id');
  CH = await js('book.chapterOrder[0]');
  await flush();
  await tick(300);
});
