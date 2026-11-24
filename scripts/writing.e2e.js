// End-to-end tests for the items of docs/manual-tests.md about recording as
// the writer goes, the setting, and the upstream features that change
// chapters: first run's last step, the files the recording leaves on disk,
// Off and on again, the book's other writing named on a day, poetry and a
// script with their page marks, the walking note, a snapshot restored,
// loose cards there and back, an outline pasted, sections and scenes sent
// to Darlings, styled text pasted, two books opened at once, stickies from
// another device, a script restored from History, a history deleted and
// put back from the trash, and a book recorded by an earlier build.
// Run with `npm run test:writing` (NEO_E2E_ONLY=<regex> for some tests).

'use strict';

const neo = require('./e2e-neo.js')('writing', {}, { proof: true });
const { js, tick, key, type, paste, caretAt, flush, waitFor, assert, test, R } = neo;
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { verifyBook, print } = require('./verify-recording.js');

// this computer is the one that recorded the frozen v1 sessions
// (scripts/fixtures/recording-v1/), as if it had been upgraded
const DEV = 'd-0123456789abcdef';
fs.mkdirSync(path.join(neo.tmp, 'app'), { recursive: true });
fs.writeFileSync(path.join(neo.tmp, 'app', 'settings.json'), JSON.stringify({ recordingDevice: DEV }));

const ID = {};
const lib = () => JSON.parse(fs.readFileSync(path.join(neo.LIB, 'library.json'), 'utf8'));
const level = (v) => js(`setHistoryLevel(${JSON.stringify({ Off: 'off', 'Record Only': 'record', 'Record and Timestamp': 'timestamp' }[v])}); 0`); // as Options does
const sessionText = () => js('rec.w.lines.join("\\n") + "\\n"');
const markersOfToday = async (ch = 'book') => {
  await neo.openHistory();
  await js(`historyShown.player.openPlayer(historyShown.player.days()[historyShown.player.days().length - 1].to - 1, { at: 'end', ch: ${JSON.stringify(ch)} })`);
  await neo.playerReady({ drawn: false });
  const m = await js('historyShown.player.markers().map((x) => x.label)');
  await neo.closeHistory();
  return m;
};
const newBook = async (name, chapters, more = '') => {
  await js(`(async () => {
    await addImportedBooks([{ name: ${JSON.stringify(name)}, ${more} chapters: ${JSON.stringify(chapters)}.map((c) => ({ title: c[0], paras: c[1].map((text) => ({ text })) })) }], library.shelves[0]);
  })()`);
  await tick(300);
  return js('library.shelves[0].bookIds[library.shelves[0].bookIds.length - 1]');
};
const openIt = async (id) => {
  await js(`openBook(${JSON.stringify(id)})`);
  await waitFor(`!!book && book.id === ${JSON.stringify(id)} && !document.getElementById('editor-view').hidden`);
  await tick(500);
};
async function importScript(name, fountain) {
  const file = path.join(neo.tmp, name + '.fountain');
  fs.writeFileSync(file, fountain);
  return js(`(async () => {
    const results = await window.neo.importFiles([${JSON.stringify(file)}]);
    await addImportedBooks(results, library.shelves[0]);
    const ids = library.shelves[0].bookIds;
    await openBook(ids[ids.length - 1]);
    return book.id;
  })()`);
}

/* ---------- the setting ---------- */

test('first run has no Writing History step: it records from the start, and timestamping, the default, is asked once on the shelf before anything is sent (Esc asks again next time, Record Only answers it); its setting only in Options, where Record and Timestamp asks first, and the first book is timestamped', async () => {
  await js('backToShelf()');
  await tick(600);
  await js('library.firstRunDone = false; delete library.historyAsked; delete library.recordWriting; delete library.proveWriting; showFirstRun()');
  await tick(200);
  await js(`document.querySelector('#fr-step1 .fr-choice').click()`);
  await tick(200);
  assert.equal(await js(`!!document.getElementById('fr-step3') || !!document.getElementById('fr-next')`), false, 'no Writing History step');
  await js(`document.getElementById('fr-done').click()`);
  await waitFor('document.getElementById("firstrun").hidden');
  // on the shelf: the timestamp question, once; nothing sent until it's answered
  assert.equal(await js('historyLevel()'), 'timestamp', 'Record and Timestamp is the default');
  assert.equal(await js('proofFlags().on'), false, 'nothing sent before the writer says yes');
  assert.equal(await js('rec.on || recordingWanted()'), true, 'recording all the same');
  await waitFor('!!document.querySelector(".confirm-modal")');
  const asked = await js('({ text: document.querySelector(".confirm-modal").textContent, cancel: document.querySelector(".confirm-modal .m-cancel").textContent, ok: document.querySelector(".confirm-modal .m-ok").textContent })');
  assert.match(asked.text, /Timestamp your writing history\?/);
  assert.match(asked.text, /You can change this at any time in Options… → Writing History\./);
  assert.equal(asked.cancel, 'Record Only');
  assert.equal(asked.ok, 'Turn on timestamping');
  // Esc puts it aside: nothing chosen, and not asked again while NEO is open
  await js('document.querySelector(".confirm-modal").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))');
  await waitFor('!document.querySelector(".confirm-modal")');
  await tick(2500);
  assert.equal(await js('!!document.querySelector(".confirm-modal")'), false, 'not asked again this time');
  assert.equal('proveWriting' in lib(), false);
  assert.equal(await js('proofFlags().on'), false);
  // the next time NEO starts it asks again; Record Only answers it, for every device
  await js('proofAskDone = false');
  await waitFor('!!document.querySelector(".confirm-modal")');
  await js('document.querySelector(".confirm-modal .m-cancel").click()');
  await waitFor('!document.querySelector(".confirm-modal")');
  await tick(400);
  assert.equal(lib().proveWriting, false);
  assert.equal(await js('historyLevel()'), 'record');
  await js('proofAskDone = false');
  await tick(1500);
  assert.equal(await js('[...document.querySelectorAll(".modal-backdrop")].some((b) => !b.hidden && b.getClientRects().length > 0)'), false, 'answered: never asked again');
  assert.ok(neo.menuItem('File', 'Writing History…'), 'Writing History… in File');
  assert.throws(() => neo.menuItem('File', 'Record Writing History'), 'the setting is only in Options');
  // Options: Record and Timestamp asks first, and yes turns it on
  // (open no book yet: the first one is the one timestamped)
  await js(`openOptions()`);
  await tick(300);
  assert.equal(await js(`document.querySelector('.options-modal [data-opt="historyLevel"]').value`), 'record');
  await js(`(() => { const s = document.querySelector('.options-modal [data-opt="historyLevel"]'); s.value = 'timestamp'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await waitFor('!!document.querySelector(".confirm-modal")');
  await js(`document.querySelector('.confirm-modal .m-ok').click()`);
  await waitFor('!document.querySelector(".confirm-modal")');
  await tick(400);
  assert.equal(await js(`document.querySelector('.options-modal [data-opt="historyLevel"]').value`), 'timestamp');
  await js(`document.querySelector('.options-modal .m-ok').click()`);
  const l = lib();
  assert.equal(l.recordWriting, true);
  assert.equal(l.proveWriting, true);
  assert.equal(await js('historyLevel()'), 'timestamp');
  // the first book written is timestamped
  neo.shorten[5 * 60 * 1000] = 1500;
  const id = await newBook('Lighthouse', [['One', ['The lamp turns.']], ['Two', ['The ship comes.']]]);
  await openIt(id);
  neo.book = id;
  assert.equal(await js(`$('.tab.history-btn').hidden`), false, 'History in the footer');
  for (const ch of await neo.chapterIds()) ID[await js(`book.chapterTitles[${JSON.stringify(ch)}]`)] = ch;
  await caretAt(0, 0, -1);
  await type(' Round and round.');
  await flush();
  for (const end = Date.now() + 15000; Date.now() < end && !neo.seals().some((f) => f.endsWith('.tsr')); await tick(200));
  assert.ok(neo.seals().includes('000001.json'), 'a seal');
  assert.ok(neo.seals().some((f) => /^000001\.\w+\.tsr$/.test(f)), 'stamped');
  // back to Record only for the rest
  level('Record Only');
  await tick(500);
});

test('Off hides every way into History, a book’s history or not: the footer, File, Export, the shelf’s menu; on again, they’re back', async () => {
  level('Off');
  await tick(600);
  assert.equal(await js(`$('.tab.history-btn').hidden`), true, 'not in the footer');
  assert.throws(() => neo.menuItem('File', 'Writing History…'));
  assert.ok(!neo.menuItem('File', 'Export').submenu.items.some((i) => i.label === 'Writing History…'), 'not in Export');
  assert.equal(await js(`(openHistory(), !!document.querySelector('.kind-history'))`), false, 'History doesn’t open');
  level('Record Only');
  await tick(600);
  assert.equal(await js(`$('.tab.history-btn').hidden`), false);
  assert.ok(neo.menuItem('File', 'Writing History…'));
  assert.ok(neo.menuItem('File', 'Export').submenu.items.some((i) => i.label === 'Writing History…'));
});

test('Off says nothing already recorded is touched; Record Only again catches up what changed meanwhile', async () => {
  await js('$("#hint").hidden = true');
  level('Off');
  await waitFor('/Writing History is off\\. Nothing already recorded is touched\\./.test($("#hint").textContent)');
  await caretAt(0, 0, -1);
  await type(' While off.');
  await flush();
  level('Record Only');
  await waitFor('rec.on');
  await type(' On again.');
  await flush();
  const lines = R.parseSession(await sessionText()).lines;
  const i = lines.findIndex((l) => l[1] === 'x' && l[2] === 'catch-up');
  assert.ok(i >= 0, 'a catch-up');
  assert.match(JSON.stringify(lines[i + 1]), /While off/);
});

/* ---------- the files on disk ---------- */

test('recording/ has README.txt, and this computer’s folder a device.json naming it; chunks as it goes, and a rollup that replaces them', async () => {
  const root = path.join(neo.LIB, neo.book, 'recording');
  assert.ok(fs.existsSync(path.join(root, 'README.txt')));
  const device = JSON.parse(fs.readFileSync(path.join(neo.recDir(), 'device.json'), 'utf8'));
  assert.equal(device.name, os.hostname());
  await caretAt(0, 0, -1);
  await type(' Chunked.');
  await flush();
  const open = path.join(neo.recDir(), await js('rec.session.id'));
  const chunks = () => fs.readdirSync(open).filter((f) => /^c-\d+\.jsonl$/.test(f));
  assert.ok(chunks().length >= 1, 'a chunk');
  // the ten minutes' rollup
  await js('rec.rollup()');
  for (let i = 0; i < 50 && chunks().length; i++) await tick(100);
  assert.ok(fs.readdirSync(open).some((f) => /^s-\d+-\d+\.jsonl\.gz$/.test(f)), 'a rollup');
  assert.deepEqual(chunks(), [], 'its chunks gone');
});

/* ---------- what's recorded ---------- */

test('the Notes, a chapter title, an outline note and a sticky edited: the day names them, and History plays only the chapters', async () => {
  await js('switchTab("notes")');
  await tick(500);
  await js(`(() => { const ed = document.getElementById('aux-editor'); ed.focus(); const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false); getSelection().removeAllRanges(); getSelection().addRange(r); })()`);
  await type('A note.');
  await js('switchTab("manuscript")');
  await tick(500);
  await js(`(() => {
    const id = book.chapterOrder[0];
    book.chapterTitles[id] = 'The Lamp';
    book.chapterNotes = { ...(book.chapterNotes || {}), [id]: 'It turns all night.' };
    stickies.push({ id: 's-w', chapterId: id, text: 'Check the oil', resolved: false });
    scheduleStickiesSave();
    return saveMeta();
  })()`);
  await tick(900);
  await flush();
  await neo.openHistory();
  // (the whole book's tiles name them; a chapter's are that chapter's)
  await js('historyShown.player.setMode("book")');
  await neo.daysReady();
  const title = await js(`document.querySelector('.hs-tile[data-day="${await js('writingDay()')}"]').title`);
  for (const s of ['Notes', 'Chapter titles', 'Outline', 'Notes & Comments']) assert.ok(title.includes(s), s + ' named: ' + title);
  await js(`historyShown.player.openPlayer(historyShown.player.days()[historyShown.player.days().length - 1].to - 1, { at: 'end', ch: 'book' })`);
  await neo.playerReady();
  const shown = await js('[...historyShown.player.paper.querySelectorAll(".rp-chapter")].map((s) => s.dataset.ch)');
  assert.ok(shown.length && shown.every((c) => !c.startsWith(':')), 'only chapters on the sheet: ' + shown);
  await neo.closeHistory();
});

test('poetry, and a script typed with Tab between elements across a page: the replay matches and no page mark is recorded', async () => {
  // poetry: ⌘⇧Enter
  await caretAt(0, 0, -1);
  key('Enter', ['control', 'shift']);
  await tick(200);
  await type('Out on the rock');
  key('Enter', ['shift']);
  await type('the lamp goes round');
  await flush();
  assert.match(await neo.html(0), /class="poetry"/);
  // a script long enough for page breaks and (CONT'D)
  let f = 'Title: Night Watch\n\n';
  for (let i = 0; i < 6; i++) f += `INT. LAMP ROOM - NIGHT\n\nThe keeper climbs the stair, again and again, as the storm comes on.\n\nKEEPER\n${'The light must not go out tonight, whatever the sea does to us. '.repeat(6)}\n\n`;
  const id = await importScript('Night Watch', f);
  await waitFor('spLayout.scenes.length >= 6', 20000);
  await js(`(() => { const b = document.querySelector('.chapter-body'); const ps = b.querySelectorAll('p'); const p = ps[ps.length - 1]; b.focus(); const r = document.createRange(); r.selectNodeContents(p); r.collapse(false); getSelection().removeAllRanges(); getSelection().addRange(r); })()`);
  key('Enter');
  await type('KEEPER');
  key('Tab');
  await tick(200);
  await type('(quietly)');
  key('Enter');
  await type('Hold on.');
  await flush();
  await waitFor('!!document.querySelector(".chapter-body [data-pg], .chapter-body [data-contd]")', 15000);
  const text = await sessionText();
  assert.doesNotMatch(text, /data-pg|data-contd|data-fill|data-ghost/, 'no page marks in the recording');
  const files = fs.readdirSync(path.join(neo.LIB, id, 'chapters')).map((c) => fs.readFileSync(path.join(neo.LIB, id, 'chapters', c), 'utf8')).join('');
  assert.doesNotMatch(files, /data-pg|data-contd|data-fill|data-ghost/, 'nor in the file');
  await openIt(neo.book);
});

test('the walking note never reaches the recording or the chapter file', async () => {
  await js(`(() => {
    const id = book.chapterOrder[1];
    const body = chapterBodyEl(id);
    const p = body.querySelector('p');
    const sid = newSectionId();
    p.dataset.secId = sid;
    syncChapter(body, id, 'outline');
    book.sectionNotes = { ...(book.sectionNotes || {}), [id]: [{ id: sid, text: 'The ship must see it.' }] };
    return saveMeta();
  })()`);
  await caretAt(1, 0, -1);
  await type(' Watch.');
  await waitFor('!!document.querySelector(".walk-note")', 5000);
  assert.ok(await js('!!document.querySelector(".chapter-body p[data-walk]")'), 'the walking note is up');
  await flush();
  const file = fs.readFileSync(path.join(neo.LIB, neo.book, 'chapters', (await neo.chapterIds())[1] + '.html'), 'utf8');
  assert.doesNotMatch(file, /data-walk|walk-note/);
  // (the note itself is in the outline's stream, as written on its card)
  assert.doesNotMatch(await sessionText(), /data-walk|walk-note/);
});

/* ---------- upstream 1.5.0's features, recorded ---------- */

test('a snapshot restored, the whole book and one chapter: “Snapshot restored”, a chapter it didn’t have leaves, and the “Before a restore” snapshot is a tag on the moment before', async () => {
  await caretAt(0, 0, -1);
  key('s', [neo.CTRL]);
  await tick(1200);
  const snap = (await neo.snapList()).pop();
  await caretAt(0, 0, -1);
  await type(' After the snapshot.');
  await js('document.getElementById("nav-add").click()'); // a chapter the snapshot doesn't have
  await tick(500);
  const added = (await neo.chapterIds()).length;
  await js('switchTab("darlings")');
  await tick(300);
  await js(`showSnapshot(${JSON.stringify(snap.name)})`);
  await waitFor('!!document.querySelector(".snap-band")');
  await js(`restoreSnapshot(book.chapterOrder[0])`);
  await tick(800);
  await js('switchTab("darlings")'); // (a restore goes back to the page)
  await tick(300);
  await js(`showSnapshot(${JSON.stringify(snap.name)})`);
  await waitFor('!!document.querySelector(".snap-band")');
  await js('restoreSnapshot(null)');
  await tick(1000);
  await js('switchTab("manuscript")');
  await tick(300);
  assert.ok((await neo.chapterIds()).length <= added, 'a chapter the snapshot didn’t have left the book');
  assert.ok(!(await neo.html(0)).includes('After the snapshot.'));
  const labels = await markersOfToday();
  assert.ok(labels.includes('Snapshot restored'), labels.join(', '));
  const tags = R.parseSession(await sessionText()).lines.filter((l) => l[1] === 'tag');
  assert.ok(tags.some((l) => l[5] && /-r-/.test(String(l[5].snapshot))), 'the “Before a restore” snapshot is a tag');
});

test('a chapter, a written section and a scene to Loose Cards and back: “Moved in the Outline”', async () => {
  // a chapter
  const chId = (await neo.chapterIds())[1];
  await js(`chapterToLoose(${JSON.stringify(chId)})`);
  await tick(500);
  let card = await js('book.looseCards[book.looseCards.length - 1].id');
  await js(`looseToChapter(${JSON.stringify(card)}, 1)`);
  await tick(500);
  // a written section: a scene break, then words
  const first = (await neo.chapterIds())[0];
  await js(`(() => {
    const body = chapterBodyEl(${JSON.stringify(first)});
    const brk = document.createElement('p'); brk.className = 'scene-break'; brk.textContent = '***';
    const p = document.createElement('p'); p.textContent = 'A section with words.';
    body.append(brk, p);
    syncChapter(body, ${JSON.stringify(first)}, 'outline');
  })()`);
  await tick(300);
  await js(`writtenSectionToLoose(${JSON.stringify(first)}, chapterSegments(${JSON.stringify(first)})[1])`);
  await tick(500);
  card = await js('book.looseCards[book.looseCards.length - 1].id');
  await js(`looseToSection(${JSON.stringify(card)}, { ch: ${JSON.stringify(first)}, before: null })`);
  await tick(500);
  assert.match(await neo.html(0), /A section with words\./);
  const labels = await markersOfToday();
  assert.ok(labels.filter((l) => l === 'Moved in the Outline').length >= 2, labels.join(', '));
});

test('a list pasted into the Outline’s List makes chapters', async () => {
  const before = (await neo.chapterIds()).length;
  await js('library.outlineView = "list"; switchTab("outline")');
  await tick(800);
  const ok = await js(`(() => {
    const line = [...document.querySelectorAll('[contenteditable="true"]')].find((x) => x.closest('#outline-list, .ol-list, .outline-list'));
    if (!line) return false;
    line.focus();
    const r = document.createRange(); r.selectNodeContents(line); r.collapse(false); getSelection().removeAllRanges(); getSelection().addRange(r);
    const dt = new DataTransfer();
    dt.setData('text/plain', '- Storm\\n- Wreck\\n- Dawn');
    line.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    return true;
  })()`);
  assert.ok(ok, 'a line of the List to paste on');
  await tick(800);
  await js('switchTab("manuscript")');
  await tick(500);
  assert.ok((await neo.chapterIds()).length >= before + 2, 'new chapters');
  const labels = await markersOfToday();
  assert.ok(labels.length, 'History plays it');
});

test('a section deleted to Darlings from its card, and a scene break deleted with Backspace', async () => {
  const first = (await neo.chapterIds())[0];
  await js(`(() => {
    const body = chapterBodyEl(${JSON.stringify(first)});
    for (const t of ['Doomed section.', 'Kept section.']) {
      const brk = document.createElement('p'); brk.className = 'scene-break'; brk.textContent = '***';
      const p = document.createElement('p'); p.textContent = t;
      body.append(brk, p);
    }
    syncChapter(body, ${JSON.stringify(first)}, 'outline');
  })()`);
  await tick(300);
  const segs = await js(`chapterSegments(${JSON.stringify(first)}).length`);
  await js(`deleteSectionToDarlings(${JSON.stringify(first)}, ${segs - 2}, true)`);
  await tick(600);
  assert.doesNotMatch(await neo.html(0), /Doomed section/);
  assert.ok(await js('darlings.some((d) => /Doomed section/.test(d.text || d.html || ""))'), 'in Darlings');
  // Backspace at the start of the line after the last break takes the break
  await js(`(() => {
    const ps = chapterBodyEl(${JSON.stringify(first)}).querySelectorAll('p');
    const p = ps[ps.length - 1];
    chapterBodyEl(${JSON.stringify(first)}).focus();
    const r = document.createRange(); r.setStart(p.firstChild, 0); r.collapse(true);
    getSelection().removeAllRanges(); getSelection().addRange(r);
  })()`);
  const breaks = (await neo.html(0)).match(/scene-break/g).length;
  key('Backspace');
  await tick(500);
  assert.equal(((await neo.html(0)).match(/scene-break/g) || []).length, breaks - 1);
  await flush();
});

test('a scene deleted to Darlings from its card, and one sent to Loose Cards and back', async () => {
  await importScript('Harbour Lights', 'Title: Harbour Lights\n\nINT. HARBOUR - NIGHT\n\nRain.\n\nEXT. QUAY - DAWN\n\nBoats.\n\nINT. BAR - DAY\n\nNobody talks.\n');
  await waitFor('spLayout.scenes.length === 3', 20000);
  // (a scene's card is any element naming its scene: data-scene, as the Outline's cards carry)
  const cell = (n) => `({ dataset: { scene: '${n}' } })`;
  await js(`deleteSceneToDarlings(${cell(2)}, true)`);
  await tick(800);
  assert.ok(await js('darlings.some((d) => /Nobody talks/.test(d.text || d.html || ""))'), 'the scene in Darlings');
  await js(`sceneToLoose(${cell(1)})`);
  await tick(800);
  const card = await js('book.looseCards[book.looseCards.length - 1].id');
  await js(`looseToScene(${JSON.stringify(card)}, 0)`);
  await tick(800);
  await js('switchTab("manuscript")');
  await tick(300);
  assert.equal(await js('spLayout.scenes.length'), 2);
  await flush();
  await openIt(neo.book);
});

test('styled text pasted from a web page: the spans NEO strips are a tidy, not part of the next key', async () => {
  await caretAt(0, 0, -1);
  await paste({ text: ' Styled words.', html: '<span style="font-family:Arial;color:#333;font-size:15px"> Styled <b>words</b>.</span>' });
  await type(' Next.');
  await flush();
  const lines = R.parseSession(await sessionText()).lines;
  const at = lines.findIndex((l) => l[1] === 'c' && l[2] === 'paste');
  assert.ok(at >= 0, 'the paste');
  assert.doesNotMatch(await neo.html(0), /font-family|<span style/);
});

test('two books opened quickly one after the other: only the second is open, and its session holds only its own chapters', async () => {
  const other = await newBook('Breakwater', [['Wall', ['The sea hits it.']]]);
  const theirs = await js(`window.neo.readBookMeta(${JSON.stringify(neo.book)}).then((m) => m.chapterOrder)`);
  await js(`(() => { openBook(${JSON.stringify(neo.book)}); openBook(${JSON.stringify(other)}); })()`);
  await waitFor(`!!book && book.id === ${JSON.stringify(other)} && rec.on`, 10000);
  await tick(1500);
  assert.equal(await js('book.id'), other);
  await caretAt(0, 0, -1);
  await type(' Spray.');
  await flush();
  const text = await sessionText();
  for (const ch of theirs) assert.ok(!text.includes(ch), 'the first book’s chapter ' + ch + ' is in the second’s session');
  await openIt(neo.book);
});

test('stickies changed on another device while the book is open: the comments stream takes it as from another device', async () => {
  const file = path.join(neo.LIB, neo.book, 'stickies.json');
  const now = JSON.parse(fs.readFileSync(file, 'utf8'));
  const list = Array.isArray(now) ? now : now.stickies || [];
  list.push({ id: 's-other', chapterId: (await neo.chapterIds())[0], text: 'From the other computer', resolved: false });
  fs.writeFileSync(file, JSON.stringify(Array.isArray(now) ? list : { ...now, stickies: list }));
  await js('refreshFromDisk()');
  await tick(1500);
  await flush();
  assert.ok(await js('stickies.some((s) => s.id === "s-other")'), 'taken in');
  const lines = R.parseSession(await sessionText()).lines;
  const at = lines.findIndex((l) => l[1] === 'b' && l[2] === ':stickies' || (l[1] === 'ch' && l[2] === ':stickies'));
  assert.ok(at >= 0, 'the stickies stream');
  assert.ok(lines.some((l) => l[1] === 'x' && /^disk-/.test(l[2])), 'as from another device');
});

/* ---------- restore and delete ---------- */

test('a script restored from History comes back whole, with its pages and (CONT’D)', async () => {
  // a speaker who goes on after a line of action is (CONT’D); scenes long enough for pages
  let f = 'Title: Restore Me\n\n';
  for (let i = 0; i < 6; i++) f += `INT. ROOM ${i} - NIGHT\n\nKEEPER\n${'We hold the light until the dawn comes up over the sea. '.repeat(5)}\n\nThe wind howls at the glass.\n\nKEEPER\nAnd after that, we sleep.\n\n`;
  const id = await importScript('Restore Me', f);
  await waitFor('spLayout.scenes.length >= 6', 20000);
  const marks = () => js('({ pg: document.querySelectorAll(".chapter-body [data-pg]").length, contd: document.querySelectorAll(".chapter-body [data-contd]").length })');
  await waitFor('document.querySelectorAll(".chapter-body [data-pg]").length > 0 && document.querySelectorAll(".chapter-body [data-contd]").length > 0', 15000);
  const was = await marks();
  const before = await neo.html(0);
  await js(`(() => { const b = document.querySelector('.chapter-body'); const p = b.querySelector('p'); b.focus(); const r = document.createRange(); r.selectNodeContents(p); r.collapse(false); getSelection().removeAllRanges(); getSelection().addRange(r); })()`);
  await type(' CHANGED');
  await flush();
  await neo.openHistory();
  await js(`historyShown.player.openPlayer(historyShown.player.days()[historyShown.player.days().length - 1].from, { at: 'start', ch: book.chapterOrder[0] })`);
  await neo.playerReady();
  await js('historyShown.player.seek(historyShown.player.lead())');
  await waitFor('!document.querySelector(".hs-restore").hidden');
  await js('document.querySelector(".hs-restore").click()');
  await waitFor(`!chapterHTML[book.chapterOrder[0]].includes('CHANGED')`, 15000);
  await neo.closeHistory();
  assert.equal(await neo.html(0), before);
  await waitFor(`document.querySelectorAll(".chapter-body [data-pg]").length === ${was.pg} && document.querySelectorAll(".chapter-body [data-contd]").length === ${was.contd}`, 15000);
  await openIt(neo.book);
  assert.ok(id);
});

let TRASHED = [];
test('Delete this book’s history…: what goes and what stays, the phrase in any case; yes: both folders in the trash, the words and snapshots there, and what’s written next is the first day', async () => {
  const words = await neo.bookNow();
  const snaps = (await neo.snapList()).map((s) => s.name);
  await neo.openHistory();
  await js('document.querySelector(".hs-delete").click()');
  await waitFor('!!document.querySelector(".confirm-modal input")');
  const text = await js('document.querySelector(".confirm-modal").textContent');
  assert.match(text, /its snapshots on the Darlings tab/);
  assert.match(text, /Its \d+ tags go with it\./);
  assert.equal(await js('document.querySelector(".confirm-modal .m-ok").disabled'), true);
  await js(`(() => { const i = document.querySelector('.confirm-modal input'); i.value = 'DELETE History'; i.dispatchEvent(new Event('input')); })()`);
  assert.equal(await js('document.querySelector(".confirm-modal .m-ok").disabled'), false, 'any case');
  const from = neo.trashed.length;
  await js('document.querySelector(".confirm-modal .m-ok").click()');
  await waitFor('/in the trash/.test($("#hint").textContent)', 15000);
  TRASHED = neo.trashed.slice(from);
  assert.ok(TRASHED.some((x) => x.from === path.join(neo.LIB, neo.book, 'recording')));
  assert.ok(TRASHED.some((x) => x.from === path.join(neo.LIB, 'Backups', 'recordings', neo.book)));
  await neo.closeHistory();
  assert.deepEqual(await neo.bookNow(), words, 'the words are all there');
  assert.deepEqual((await neo.snapList()).map((s) => s.name), snaps, 'the snapshots too');
  await caretAt(0, 0, -1);
  await type(' Afresh.');
  await flush();
  await neo.openHistory();
  assert.equal(await js('historyShown.player.days().length'), 1, 'one day: what was written since');
  await neo.closeHistory();
});

test('both folders put back from the trash, NEO closed: the old history plays again beside the new', async () => {
  const newSessions = await js('window.neo.recList(book.id).then((l) => l.reduce((a, d) => a + d.sessions.length, 0))');
  await js('backToShelf()');
  await tick(1000);
  // as Windows puts a folder back over one of the same name: merged
  const merge = (from, to) => {
    fs.mkdirSync(to, { recursive: true });
    for (const n of fs.readdirSync(from)) {
      const a = path.join(from, n);
      const b = path.join(to, n);
      if (fs.statSync(a).isDirectory()) merge(a, b);
      else if (!fs.existsSync(b)) fs.copyFileSync(a, b);
    }
  };
  for (const x of TRASHED) merge(x.to, x.from);
  await openIt(neo.book);
  const all = await js('window.neo.recList(book.id).then((l) => l.reduce((a, d) => a + d.sessions.length, 0))');
  assert.ok(all > newSessions, `the old sessions are back: ${all} > ${newSessions}`);
  await neo.openHistory();
  assert.ok(await js('historyShown.player.sessions().length') >= all - 1);
  await neo.closeHistory();
});

test('the history deleted on another computer while this one records: a new session from the book as it is, seals from 1 again, nothing lost', async () => {
  const until = async (fn, what) => {
    for (const end = Date.now() + 20000; !fn(); await tick(200)) if (Date.now() > end) throw new Error('never: ' + what);
  };
  if (await js('historyLevel()') !== 'timestamp') {
    level('Record and Timestamp');
    await waitFor('!!document.querySelector(".confirm-modal")');
    await js('document.querySelector(".confirm-modal .m-ok").click()');
    await waitFor('historyLevel() === "timestamp"');
  }
  const dev = await js('rec.device');
  const mine = path.join(neo.LIB, neo.book, 'recording', dev);
  const seals = () => { try { return fs.readdirSync(path.join(mine, 'seals')).filter((n) => /^\d{6}\.json$/.test(n)).sort(); } catch { return []; } };
  await caretAt(0, 0, -1);
  await type(' Before the delete.');
  await js('void rec.tag("Before the delete")'); // (a named tag is sealed at once)
  await until(() => seals().length > 0, 'a seal before the delete');
  const was = await js('rec.session.id');
  // another computer deletes the history, and its sync program takes the
  // folder from under this one, which is still recording, a file at a
  // time: so far only this device's device.json and the README, and none
  // of its sessions, seals or copy in Backups
  await flush();
  const rec = path.join(neo.LIB, neo.book, 'recording');
  const copy = path.join(neo.LIB, 'Backups', 'recordings', neo.book, dev);
  for (const d of fs.readdirSync(rec)) if (d !== dev && d !== 'README.txt') fs.rmSync(path.join(rec, d), { recursive: true, force: true });
  fs.rmSync(path.join(rec, 'README.txt'), { force: true });
  fs.rmSync(path.join(mine, 'device.json'));
  assert.ok(fs.existsSync(path.join(mine, was)) && seals().length > 0, 'the open session and the old seals left where they were');
  const from = neo.trashed.length;
  await type(' After the delete.');
  await flush();
  await waitFor(`rec.on && rec.session.id !== ${JSON.stringify(was)}`, 15000);
  // what was left of this device's part went to the trash, its copy in Backups too
  assert.ok(neo.trashed.slice(from).some((x) => x.from === mine), 'this device’s leftovers in the trash');
  if (fs.existsSync(copy)) assert.ok(neo.trashed.slice(from).some((x) => x.from === copy), 'and its copy in Backups');
  await type(' And on.');
  await flush();
  await js('void rec.tag("After the delete")');
  await until(() => seals().length > 0, 'a seal after the delete');
  const seal = JSON.parse(fs.readFileSync(path.join(mine, 'seals', seals()[0]), 'utf8'));
  assert.equal(seal.seq, 1, 'the seals start again');
  assert.ok(!seal.prev, 'naming no seal before it');
  assert.ok(fs.existsSync(path.join(mine, 'device.json')), 'the folder names this computer again');
  const words = Object.values(await neo.bookNow()).join('');
  assert.match(words, /Before the delete\. After the delete\. And on\./, 'nothing lost');
  await js('backToShelf()');
  await tick(1500);
  assert.ok(!fs.readdirSync(mine).some((n) => n.startsWith(was)), 'nothing left of the session the delete cut short');
  const v = await verifyBook(path.join(neo.LIB, neo.book));
  assert.ok(v.ok, print(v));
  await openIt(neo.book);
});

test('Delete this book’s history… with timestamping on and words not yet sealed: the seal the close asks for is done first, so the new history’s first seal names only what’s in it', async () => {
  const until = async (fn, what) => {
    for (const end = Date.now() + 20000; !fn(); await tick(200)) if (Date.now() > end) throw new Error('never: ' + what);
  };
  assert.equal(await js('historyLevel()'), 'timestamp');
  const dev = await js('rec.device');
  const mine = path.join(neo.LIB, neo.book, 'recording', dev);
  const seals = () => { try { return fs.readdirSync(path.join(mine, 'seals')).filter((n) => /^\d{6}\.json$/.test(n)).sort(); } catch { return []; } };
  await caretAt(0, 0, -1);
  await type(' Unsealed words.');
  await flush();
  await neo.openHistory();
  await js('document.querySelector(".hs-delete").click()');
  await waitFor('!!document.querySelector(".confirm-modal input")');
  await js(`(() => { const i = document.querySelector('.confirm-modal input'); i.value = 'delete history'; i.dispatchEvent(new Event('input')); })()`);
  await js('document.querySelector(".confirm-modal .m-ok").click()');
  await waitFor('/in the trash/.test($("#hint").textContent)', 30000);
  await neo.closeHistory();
  await type(' Written since.');
  await flush();
  await js('void rec.tag("Since the delete")');
  await until(() => seals().length > 0, 'the new history’s first seal');
  const first = JSON.parse(fs.readFileSync(path.join(mine, 'seals', seals()[0]), 'utf8'));
  assert.equal(first.seq, 1);
  const there = new Set(fs.readdirSync(mine).map((n) => n.replace(/\.jsonl\.gz$/, '')));
  for (const s of Object.keys(first.heads || {})) assert.ok(there.has(s), 'a session in the new history: ' + s);
  await js('backToShelf()');
  await tick(1500);
  const v = await verifyBook(path.join(neo.LIB, neo.book));
  assert.ok(v.ok, print(v));
  await openIt(neo.book);
});

/* ---------- a book an earlier build recorded ---------- */

test('a book recorded by an earlier build (no day in its sessions, no notes or titles recorded): every session plays on its day; the first session now starts the notes and titles from a baseline and carries the chapters on', async () => {
  const src = path.join(__dirname, 'fixtures', 'recording-v1');
  const names = fs.readdirSync(src).sort();
  const texts = names.map((n) => fs.readFileSync(path.join(src, n), 'utf8'));
  const end = R.replayCheck(texts).chapters;
  const bookId = 'book-fixture-v1';
  const dir = path.join(neo.LIB, bookId);
  fs.mkdirSync(path.join(dir, 'chapters'), { recursive: true });
  for (const [ch, html] of Object.entries(end)) fs.writeFileSync(path.join(dir, 'chapters', ch + '.html'), html);
  fs.writeFileSync(path.join(dir, 'book.json'), JSON.stringify({ id: bookId, title: 'Fixture', chapterOrder: Object.keys(end), chapterTitles: {}, created: '2026-10-06T09:00:00.000Z' }));
  const rec = path.join(dir, 'recording', DEV);
  fs.mkdirSync(rec, { recursive: true });
  fs.writeFileSync(path.join(rec, 'device.json'), JSON.stringify({ name: os.hostname(), created: '2026-10-06T09:00:00.000Z', app: '1.3.0' }));
  names.forEach((n, i) => fs.writeFileSync(path.join(rec, n + '.gz'), zlib.gzipSync(texts[i])));
  await js(`(async () => { library.shelves[0].bookIds.push(${JSON.stringify(bookId)}); await writeLibrary(library); renderShelves(); })()`);
  await tick(500);
  await neo.openHistory({ bookId });
  const days = await js('historyShown.player.days().map((d) => d.day)');
  assert.deepEqual(days, names.map((n) => R.sessionDay(R.parseSession(texts[names.indexOf(n)]).header)));
  for (let di = 0; di < days.length; di++) {
    await js(`historyShown.player.openPlayer(historyShown.player.days()[${di}].to - 1, { at: 'end', ch: 'book' })`);
    await neo.playerReady();
    await js('historyShown.player.showDays(' + di + ')').catch(() => {});
  }
  await neo.closeHistory();
  // opened and written in now
  await openIt(bookId);
  await caretAt(0, 0, -1);
  await type(' Upgraded.');
  await js(`(() => { book.chapterTitles[book.chapterOrder[0]] = 'Rain'; return saveMeta(); })()`);
  await tick(900);
  await flush();
  const lines = R.parseSession(await sessionText()).lines;
  const bs = lines.filter((l) => l[1] === 'b');
  for (const ch of Object.keys(end)) {
    const b = bs.find((l) => l[2] === ch);
    if (b) assert.equal(b[b.length - 1], 'continue', ch + ' carries on');
  }
  assert.ok(bs.some((l) => l[2] === ':titles' && l[l.length - 1] === 'baseline'), 'the titles start from a baseline');
  await openIt(neo.book);
});

/* ---------- the library the tests start from ---------- */

neo.run(async () => {
  // a new library: first run's steps are the first test's
});
