// End-to-end tests for Proof of when I wrote (docs/manual-tests.md, phase 5
// and Timestamp services…): Record and Timestamp turned on as a writer
// does it, the seals NEO makes as the writing starts and stops, stamps
// offline and online again, a crash, verify-recording, Off, delete, the
// backup mirror, the signing key, and the services dialog. The timestamp
// authorities are fake-tsa.js on 127.0.0.1 standing in for DigiCert,
// Sectigo and GlobalSign (e2e-neo.js, opts.proof): real RFC 3161 tokens
// from a test root NEO trusts here as its own. Nothing reaches the network.
// The five minutes after the writing stops are shortened, and the hour and
// the week are the main process's clock moved on (neo.mainAhead).
// Run with `npm run test:proof` (NEO_E2E_ONLY=<regex> for some tests).

'use strict';

const neo = require('./e2e-neo.js')('proof', {}, { proof: true });
const { js, tick, key, type, caretAt, flush, waitFor, assert, test } = neo;
const fs = require('fs');
const path = require('path');
const { verifyBook, print } = require('./verify-recording.js');

const IDLE = 5 * 60 * 1000;
const DAY = 24 * 3600 * 1000;
const lib = () => JSON.parse(fs.readFileSync(path.join(neo.LIB, 'library.json'), 'utf8'));
const level = (v) => neo.menuItem('File', 'Record Writing History', v).click();
const sealCount = () => neo.seals().filter((f) => /^\d{6}\.json$/.test(f)).length;
const stampsOf = (n) => neo.seals().filter((f) => f.startsWith(String(n).padStart(6, '0') + '.') && f.endsWith('.tsr')).map((f) => f.split('.')[1]).sort();
// in the main process (the seals are written there)
async function until(fn, ms = 10000, what = String(fn)) {
  for (const end = Date.now() + ms; Date.now() < end; await tick(100)) if (fn()) return;
  throw new Error('timed out waiting for ' + what + '\nseals: ' + neo.seals().join(' '));
}
const sealBody = (n) => JSON.parse(fs.readFileSync(path.join(neo.sealsDir(), String(n).padStart(6, '0') + '.json'), 'utf8'));
// a moment tagged with a name, as Tag This Moment… does
const tagNamed = (label) => js(`void rec.tag(${JSON.stringify(label)})`);
const write = async (words) => { await caretAt(0, 0, -1); await type(words); await flush(); };
const closeBook = async () => { await js('backToShelf()'); await tick(800); };
const openTheBook = async () => {
  await js(`openBook(${JSON.stringify(neo.book)})`);
  await waitFor(`!!book && book.id === ${JSON.stringify(neo.book)} && rec.on`);
  await tick(500);
};
const modalOk = () => js('document.querySelector(".confirm-modal .m-ok").click()');
const modalCancel = () => js('document.querySelector(".confirm-modal .m-cancel").click()');
const confirmShown = async () => {
  await waitFor('!!document.querySelector(".confirm-modal")');
  return js('({ title: document.querySelector(".confirm-modal h2").textContent, text: document.querySelector(".confirm-modal").textContent })');
};
// the services dialog
const tsa = {
  open: async () => { neo.menuItem('File', 'Record Writing History', 'Timestamp Services…').click(); await waitFor('!!document.querySelector(".tsa-backdrop")'); await tick(200); },
  rows: () => js(`[...document.querySelectorAll('.tsa-list li')].map((li) => ({ id: li.dataset.id, name: li.querySelector('.tsa-name').textContent, on: li.querySelector('input').checked, about: li.querySelector('.tsa-about').textContent }))`),
  warn: () => js(`(() => { const w = document.querySelector('.tsa-warn'); return w.hidden ? '' : w.textContent; })()`),
  click: (id, sel) => js(`document.querySelector('.tsa-list li[data-id="${id}"] ${sel}').click()`),
  done: async () => { await js('document.querySelector(".tsa-backdrop .m-ok").click()'); await tick(200); },
  // Add a service…: the address typed, Enter, and what it said
  tryAdd: async (url) => {
    await js(`(() => { const add = document.querySelector('.tsa-add'); if (add.hidden) document.querySelector('.tsa-new').click(); })()`);
    await js(`(() => { const i = document.querySelector('.tsa-add input'); i.value = ${JSON.stringify(url)}; i.dispatchEvent(new Event('input')); i.focus(); })()`);
    key('Enter');
    await waitFor(`(() => { const s = document.querySelector('.tsa-said'); return !s.hidden && !/Asking it/.test(s.textContent); })()`, 15000);
    return js(`({ said: document.querySelector('.tsa-said').textContent, ok: document.querySelector('.tsa-yes').hidden ? '' : document.querySelector('.tsa-ok').textContent })`);
  }
};

/* ---------- turning it on ---------- */

test('at Record Only, Record and Timestamp asks first, in plain words; Cancel leaves Record Only and sends nothing', async () => {
  await write(' Before proof.');
  level('Record and Timestamp');
  const m = await confirmShown();
  assert.equal(m.title, 'Timestamp your writing history?');
  assert.match(m.text, /never your words/);
  assert.match(m.text, /DigiCert and Sectigo/);
  await modalCancel();
  await tick(400);
  assert.equal(await js('historyLevel()'), 'record');
  assert.notEqual(lib().proveWriting, true);
  assert.equal(neo.menuItem('File', 'Record Writing History', 'Record Only').checked, true, 'the menu’s tick goes back');
  assert.ok(!fs.existsSync(neo.sealsDir()), 'no seals/ folder');
  assert.equal(neo.tsa.digicert.asked + neo.tsa.sectigo.asked + neo.tsa.globalsign.asked, 0, 'nothing sent');
});

test('yes: the open book is sealed and stamped by DigiCert and Sectigo at once, only .json and .tsr in seals/; History’s toast says so and its footer doesn’t', async () => {
  level('Record and Timestamp');
  await confirmShown();
  await modalOk();
  await until(() => stampsOf(1).length === 2, 10000, 'seal 1 stamped');
  assert.deepEqual(neo.seals(), ['000001.digicert.tsr', '000001.json', '000001.sectigo.tsr']);
  assert.equal(lib().proveWriting, true);
  assert.equal(neo.menuItem('File', 'Record Writing History', 'Record and Timestamp').checked, true);
  await neo.openHistory();
  await waitFor('/Last timestamped/.test($("#hint").textContent) && !$("#hint").hidden');
  assert.match(await neo.toastText(), /^Last timestamped today at .+, by DigiCert and Sectigo\.$/);
  assert.doesNotMatch(await js('document.querySelector(".hs-foot").textContent'), /Last timestamped/);
  await neo.closeHistory();
});

test('the signing key is kept encrypted where the system can encrypt it, not as a readable PEM', () => {
  const secrets = JSON.parse(fs.readFileSync(path.join(neo.tmp, 'app', 'secrets.json'), 'utf8'));
  assert.ok(secrets.proofKey, 'a key');
  // (a Linux with no keyring can't: NEO keeps it as it is then, on purpose)
  if (!require('electron').safeStorage.isEncryptionAvailable()) {
    assert.equal(secrets.proofKey.enc, false);
    console.log('     (this system has no keyring: the key is kept unencrypted, as NEO does then)');
    return;
  }
  assert.equal(secrets.proofKey.enc, true);
  assert.doesNotMatch(JSON.stringify(secrets), /BEGIN PRIVATE KEY/);
});

/* ---------- when it seals ---------- */

test('writing stops: one seal five minutes later, and at its dash on History’s track the sheet shows that stretch whole and nothing after', async () => {
  neo.shorten[IDLE] = 1500;
  const was = sealCount();
  await write(' First stretch ends here.');
  await until(() => sealCount() === was + 1 && stampsOf(was + 1).length === 2, 10000, 'the seal after the stretch');
  await tick(2500);
  assert.equal(sealCount(), was + 1, 'one seal, not more');
  await write(' Second stretch begins.');
  await until(() => sealCount() === was + 2 && stampsOf(was + 2).length === 2, 10000, 'the seal after the second stretch');
  await neo.openHistory();
  await js(`historyShown.player.openPlayer(historyShown.player.days()[historyShown.player.days().length - 1].to - 1, { at: 'end', ch: book.chapterOrder[0] })`);
  await neo.playerReady();
  await waitFor('historyShown.player.stampMarks().length >= 2');
  const marks = await js('historyShown.player.stampMarks()');
  const at = async (j) => js(`(() => { historyShown.player.seek(${j}); return historyShown.player.chapters()[book.chapterOrder[0]]; })()`);
  const texts = [];
  for (const m of marks) texts.push(await at(m.j + 1)); // (seek(n) plays n steps: the dash's step is j)
  const i = texts.findIndex((h) => h.includes('First stretch ends here.') && !h.includes('Second stretch'));
  assert.ok(i >= 0, 'a dash where the first stretch ended: ' + JSON.stringify(marks) + ' | ' + texts.map((h) => String(h).replace(/<[^>]+>/g, ' ').slice(-160)).join(' | '));
  assert.ok(texts.some((h) => h.includes('Second stretch begins.')), 'and one after the second');
  await neo.closeHistory();
});

test('writing on for over an hour: a seal once the first unsealed words are an hour old, then one when it stops; closing the book seals only if words came since', async () => {
  neo.shorten[IDLE] = 60 * 60 * 1000; // (stopping is a test of its own)
  let n = sealCount();
  await write(' An hour of writing starts.');
  await tick(500);
  assert.equal(sealCount(), n, 'not yet');
  neo.mainAhead(61 * 60 * 1000);
  try {
    await write(' Still writing.');
    await until(() => sealCount() === n + 1 && stampsOf(n + 1).length === 2, 10000, 'the hour’s seal');
  } finally { neo.mainAhead(0); }
  n++;
  neo.shorten[IDLE] = 1500;
  await write(' And stops.');
  await until(() => sealCount() === n + 1 && stampsOf(n + 1).length === 2, 10000, 'the seal when it stopped');
  n++;
  await closeBook();
  await tick(1500);
  assert.equal(sealCount(), n, 'nothing new since: closing seals nothing');
  neo.shorten[IDLE] = 60 * 60 * 1000;
  await openTheBook();
  await write(' Closing soon.');
  await closeBook();
  await until(() => sealCount() === n + 1, 10000, 'the seal as it closed');
  await openTheBook();
});

test('caret moves, clicks and focus alone seal nothing, opening or closing the book', async () => {
  neo.shorten[IDLE] = 1500;
  await closeBook();
  await tick(1500);
  const n = sealCount();
  await openTheBook();
  for (let i = 0; i < 4; i++) { await caretAt(0, 0, i); key('ArrowRight'); await tick(100); }
  await js('window.dispatchEvent(new Event("blur")); window.dispatchEvent(new Event("focus"))');
  await flush();
  await tick(2500);
  await closeBook();
  await tick(2500);
  assert.equal(sealCount(), n);
  await openTheBook();
});

test('a moment tagged with a name is sealed within a minute, not at the next hour', async () => {
  neo.shorten[IDLE] = 60 * 60 * 1000;
  const n = sealCount();
  await tagNamed('Sent to my agent');
  await until(() => sealCount() === n + 1 && stampsOf(n + 1).length === 2, 10000, 'the tag’s seal');
});

test('a note another program left (history-notes/) is sealed within a minute once it’s taken in, not at the next hour', async () => {
  neo.shorten[IDLE] = 60 * 60 * 1000;
  const n = sealCount();
  const dir = path.join(neo.LIB, neo.book, 'history-notes');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'ds-sealed.json'), JSON.stringify({ neoNote: 1, id: 'ds-sealed', at: new Date().toISOString(), app: 'Draft Sleuth', kind: 'feedback', text: 'Feedback to be timestamped.' }));
  await js('takeHistoryNotes(book.id)');
  await until(() => sealCount() === n + 1 && stampsOf(n + 1).length === 2, 10000, 'the note’s seal');
});

test('typing goes on while a seal waits on slow authorities', async () => {
  for (const id of ['digicert', 'sectigo', 'globalsign']) neo.tsa[id].delay = 4000;
  try {
    const n = sealCount();
    await tagNamed('Slow');
    await until(() => sealCount() === n + 1, 5000, 'the seal');
    const t0 = Date.now();
    await caretAt(0, 0, -1);
    await type(' Typed while it waits.');
    assert.match(await neo.html(0), /Typed while it waits\./);
    assert.ok(Date.now() - t0 < 3500, 'typing took ' + (Date.now() - t0) + ' ms');
    assert.deepEqual(stampsOf(n + 1), [], 'the stamps were still under way');
    await until(() => stampsOf(n + 1).length === 2, 15000, 'the slow stamps');
  } finally { for (const id of ['digicert', 'sectigo', 'globalsign']) neo.tsa[id].delay = 0; }
  await flush();
});

/* ---------- offline ---------- */

test('offline: seals are written but not stamped and History says it’s waiting; online, the half hour’s retry stamps the newest', async () => {
  neo.shorten[IDLE] = 60 * 60 * 1000;
  for (const id of ['digicert', 'sectigo', 'globalsign']) neo.tsa[id].mode = 'down';
  let n;
  try {
    await write(' Written offline.');
    n = sealCount();
    await closeBook();
    await until(() => sealCount() === n + 1, 10000, 'the seal as it closed');
    await tick(1000);
    assert.deepEqual(stampsOf(n + 1), []);
    await openTheBook();
    await neo.openHistory();
    await waitFor('/waiting for the network/.test($("#hint").textContent)', 10000);
    await neo.closeHistory();
  } finally { for (const id of ['digicert', 'sectigo', 'globalsign']) neo.tsa[id].mode = 'up'; }
  await neo.halfHour();
  await until(() => stampsOf(sealCount()).length === 2, 10000, 'the newest stamped');
});

test('a week with no stamp: a warning as the book opens, not if the writer is typing by then, and not once a stamp comes', async () => {
  neo.shorten[IDLE] = 60 * 60 * 1000;
  const down = (on, delay = 0) => { for (const id of ['digicert', 'sectigo', 'globalsign']) { neo.tsa[id].mode = on ? 'down' : 'up'; neo.tsa[id].delay = delay; } };
  const warned = () => js('!$("#hint").hidden && $("#hint").classList.contains("hint-warn") && /hasn’t been timestamped/.test($("#hint").textContent)');
  down(true);
  try {
    // a seal made eight days ago that nobody stamped
    neo.mainAhead(-8 * DAY);
    try {
      await write(' A week offline.');
      const n = sealCount();
      await closeBook();
      await until(() => sealCount() === n + 1, 10000, 'the old seal');
      await tick(800);
    } finally { neo.mainAhead(0); }
    await js('$("#hint").hidden = true');
    await openTheBook();
    await waitFor('!$("#hint").hidden && $("#hint").classList.contains("hint-warn")', 15000);
    assert.ok(await warned());
    assert.match(await neo.toastText(), /Timestamp Services/);
    // typing straight away: no warning
    await closeBook();
    await js('$("#hint").hidden = true');
    down(true, 2500);
    await js(`openBook(${JSON.stringify(neo.book)})`);
    await waitFor(`!!book && book.id === ${JSON.stringify(neo.book)} && rec.on`);
    await caretAt(0, 0, -1);
    await type(' Typing.');
    await tick(5000);
    assert.equal(await warned(), false);
  } finally { down(false); }
  // online again: stamped as it opens, and no warning
  await closeBook();
  await js('$("#hint").hidden = true');
  await openTheBook();
  await until(() => stampsOf(sealCount()).length === 2, 10000, 'stamped');
  await tick(1500);
  assert.equal(await warned(), false);
});

/* ---------- a crash ---------- */

test('NEO’s window crashes after a sentence: opening the book again seals the crashed session at once', async () => {
  neo.shorten[IDLE] = 60 * 60 * 1000;
  await write(' Then it crashed.');
  const session = await js('rec.session.id');
  const n = sealCount();
  neo.wc.forcefullyCrashRenderer();
  await tick(500);
  neo.wc.reload();
  await tick(1000);
  while (!(await js(`typeof library !== 'undefined' && !!library`).catch(() => false))) await tick(100);
  await tick(500);
  await js(`document.getElementById('firstrun').hidden = true`);
  await openTheBook();
  await until(() => sealCount() > n, 10000, 'a seal after the crash');
  const s = sealBody(n + 1);
  assert.ok(session in s.heads, 'it names the crashed session');
  const r = await verifyBook(path.join(neo.LIB, neo.book));
  const d = r.devices[0];
  assert.ok(!d.cover.some((c) => c.session === session && c.gap), 'the crashed session is timestamped: ' + JSON.stringify(d.cover.filter((c) => c.gap)));
});

/* ---------- checking it ---------- */

test('verify-recording: everything checks, each seal with its stamps, and every session timestamped within a day', async () => {
  neo.shorten[IDLE] = 1500;
  const n = sealCount() + 1;
  await write(' Checked.');
  await until(() => sealCount() === n && stampsOf(n).length === 2, 10000, 'the seal after the words');
  await closeBook();
  await tick(1500);
  const r = await verifyBook(path.join(neo.LIB, neo.book));
  const out = print(r);
  assert.ok(r.ok, out);
  assert.match(out, /everything checks/);
  const seals = r.devices[0].seals.seals;
  assert.equal(seals.length, sealCount());
  for (const s of seals) assert.ok(s.ok, out);
  assert.match(out, /000001 ok .*digicert .*sectigo/);
  assert.match(out, /every closed session timestamped within a day of its end/);
  assert.ok(seals[0].heads && Object.keys(seals[0].heads).length >= 1);
  await openTheBook();
});

test('a writing session that ended with a seal and then only clicks counts as timestamped within a day', async () => {
  neo.shorten[IDLE] = 1500;
  const n = sealCount() + 1;
  await write(' Then only clicks.');
  await until(() => sealCount() === n && stampsOf(n).length === 2, 10000, 'the seal after the words');
  const session = await js('rec.session.id');
  for (let i = 0; i < 3; i++) { await caretAt(0, 0, i); await tick(100); }
  await flush();
  await closeBook();
  await tick(2000);
  assert.equal(sealCount(), n, 'no seal for the clicks');
  const r = await verifyBook(path.join(neo.LIB, neo.book));
  const c = r.devices[0].cover.find((x) => x.session === session);
  assert.ok(c && !c.gap && c.wholeBy, JSON.stringify(c));
  await openTheBook();
});

test('the backup mirror has every seal and stamp', async () => {
  await closeBook();
  await openTheBook();
  await tick(1500);
  const mirror = path.join(neo.LIB, 'Backups', 'recordings', neo.book, path.basename(neo.recDir()), 'seals');
  const held = fs.readdirSync(mirror).sort();
  const sealed = neo.seals().filter((f) => fs.statSync(path.join(neo.sealsDir(), f)).mtimeMs < Date.now() - 1500);
  for (const f of sealed) assert.ok(held.includes(f), f + ' isn’t in the mirror: ' + held.join(' '));
});

/* ---------- Off ---------- */

test('Off: no seals; Record and Timestamp again asks first', async () => {
  neo.shorten[IDLE] = 1500;
  const n = sealCount();
  level('Off');
  await tick(500);
  assert.equal(await js('historyLevel()'), 'off');
  await caretAt(0, 0, -1);
  await type(' Unrecorded.');
  await js('flushAllSaves()');
  await tick(3000);
  assert.equal(sealCount(), n);
  level('Record and Timestamp');
  const m = await confirmShown();
  assert.equal(m.title, 'Timestamp your writing history?');
  await modalOk();
  await waitFor('rec.on');
  await until(() => sealCount() === n + 1, 10000, 'sealed as it was turned on');
});

/* ---------- Timestamp services… ---------- */

test('Timestamp Services… is under a line after Record and Timestamp, and from History closes History first: the three, ticked, with their addresses', async () => {
  const items = neo.menuItem('File', 'Record Writing History').submenu.items;
  const i = items.findIndex((x) => x.label === 'Record and Timestamp');
  assert.equal(items[i + 1].type, 'separator');
  assert.equal(items[i + 2].label, 'Timestamp Services…');
  await neo.openHistory();
  await tsa.open();
  assert.equal(await js('!!historyShown'), false, 'History closed first');
  const rows = await tsa.rows();
  assert.deepEqual(rows.map((r) => [r.name, r.on]), [['DigiCert', true], ['Sectigo', true], ['GlobalSign', true]]);
  assert.equal(rows[0].about, 'http://timestamp.digicert.com');
  assert.match(rows[2].about, /tsa\/r45standard$/);
  await tsa.done();
});

test('↑ and ↓ show only on the row pointed at or with focus; GlobalSign moved first stays first and stamps first', async () => {
  await tsa.open();
  // (read once the fade has had its frame: with the system's Reduce motion on,
  // styles.css makes every transition 0.01 ms rather than none, so a read at
  // once still sees where it started)
  const shown = async (id) => { await tick(50); return js(`getComputedStyle(document.querySelector('.tsa-list li[data-id="${id}"] .tsa-up')).opacity`); };
  await js('document.activeElement.blur()');
  assert.equal(await shown('globalsign'), '0');
  await js(`document.querySelector('.tsa-list li[data-id="globalsign"] input').focus()`);
  assert.equal(await shown('globalsign'), '1');
  assert.equal(await shown('sectigo'), '0');
  await js(`document.querySelector('.tsa-list li[data-id="globalsign"] input').blur()`);
  // and under the pointer: the same rule (a hover can't be had in a window the
  // pointer isn't over, as when two of these tests run at once)
  assert.ok(await js(`[...document.styleSheets].some((sh) => { try { return [...sh.cssRules].some((r) => (r.selectorText || '').includes('.tsa-list li:hover .tsa-move') && r.style.opacity === '1'); } catch { return false; } })`), 'shown under the pointer');
  await tsa.click('globalsign', '.tsa-up');
  await tick(300);
  await tsa.click('globalsign', '.tsa-up');
  await tick(300);
  assert.deepEqual((await tsa.rows()).map((x) => x.id), ['globalsign', 'digicert', 'sectigo']);
  await tsa.done();
  await tsa.open();
  assert.deepEqual((await tsa.rows()).map((x) => x.id), ['globalsign', 'digicert', 'sectigo'], 'kept');
  await tsa.done();
  assert.deepEqual(lib().proofTsas.map((x) => x.id), ['globalsign', 'digicert', 'sectigo']);
  const n = sealCount();
  await tagNamed('GlobalSign first');
  await until(() => sealCount() === n + 1 && stampsOf(n + 1).length === 2, 10000, 'the seal');
  assert.deepEqual(stampsOf(n + 1), ['digicert', 'globalsign']);
});

test('one service ticked warns of one timestamp, none of none; the opt-in names the services first now', async () => {
  await tsa.open();
  await tsa.click('digicert', 'input');
  await tick(200);
  await tsa.click('sectigo', 'input');
  await tick(300);
  assert.match(await tsa.warn(), /With one on, your writing gets one timestamp/);
  await tsa.click('globalsign', 'input');
  await tick(300);
  assert.match(await tsa.warn(), /nothing timestamps it/);
  for (const id of ['globalsign', 'digicert', 'sectigo']) { await tsa.click(id, 'input'); await tick(200); }
  assert.equal(await tsa.warn(), '');
  await tsa.done();
  level('Record Only');
  await tick(500);
  level('Record and Timestamp');
  const m = await confirmShown();
  assert.match(m.text, /The fingerprint goes to GlobalSign, DigiCert, and Sectigo|The fingerprint goes to GlobalSign, DigiCert and Sectigo/);
  assert.doesNotMatch(m.text, /goes to DigiCert and Sectigo/);
  await modalOk();
  await waitFor('historyLevel() === "timestamp"');
});

test('a service added whose root is in no public list: Add anyway, last, with its note, and its root in library.json', async () => {
  await tsa.open();
  const r = await tsa.tryAdd(neo.tsa.added.url);
  assert.match(r.said, /^127\.0\.0\.1 answered with a good timestamp, but its root, NEO Test Added Root \(tests only\), is in no public list/);
  assert.equal(r.ok, 'Add anyway');
  await js('document.querySelector(".tsa-ok").click()');
  await tick(400);
  const rows = await tsa.rows();
  assert.equal(rows[rows.length - 1].name, '127.0.0.1');
  assert.match(rows[rows.length - 1].about, /Added by you\. Its root, NEO Test Added Root \(tests only\), is in no public list/);
  const kept = lib().proofTsas.find((x) => x.added);
  assert.equal(kept.id, '127-0-0-1');
  assert.match(kept.root, /-----BEGIN CERTIFICATE-----/);
  await tsa.done();
});

test('a service whose root is public says so, and the button says Add; one that isn’t a timestamp service, or is already listed, isn’t added', async () => {
  await tsa.open();
  const before = (await tsa.rows()).length;
  // (the test root is one of NEO's own here, as a public root is)
  let r = await tsa.tryAdd(neo.tsa.digicert.url.replace('/tsr', '/public'));
  assert.match(r.said, /answered with a good timestamp\. Its root, NEO Test Root \(tests only\), is in Mozilla’s list/);
  assert.equal(r.ok, 'Add');
  r = await tsa.tryAdd(neo.tsa.other.url);
  assert.match(r.said, /^NEO couldn’t use it/);
  assert.equal(r.ok, '');
  r = await tsa.tryAdd('http://timestamp.digicert.com');
  assert.match(r.said, /already in the list/);
  r = await tsa.tryAdd(neo.tsa.added.url);
  assert.match(r.said, /already in the list/);
  key('Escape');
  await tick(200);
  assert.equal((await tsa.rows()).length, before, 'nothing added');
  await tsa.done();
});

test('the added service ticked into the first two warns, and its seal brings its root beside the seals once; verify-recording says whose root it is', async () => {
  await tsa.open();
  for (let i = 0; i < 3; i++) { await tsa.click('127-0-0-1', '.tsa-up'); await tick(250); }
  assert.equal((await tsa.rows())[0].id, '127-0-0-1');
  assert.match(await tsa.warn(), /Stamps from 127\.0\.0\.1 rest on a root you added, so they don’t count toward the time cover/);
  await tsa.done();
  for (let k = 0; k < 2; k++) {
    const n = sealCount();
    await tagNamed(`Added ${k}`);
    await until(() => sealCount() === n + 1 && stampsOf(n + 1).length === 2, 10000, 'the seal');
    assert.deepEqual(stampsOf(n + 1), ['127-0-0-1', 'globalsign']);
  }
  const roots = neo.seals().filter((f) => /^root-[0-9a-f]{16}\.pem$/.test(f));
  assert.equal(roots.length, 1);
  const out = print(await verifyBook(path.join(neo.LIB, neo.book)));
  assert.match(out, /127-0-0-1 \S+ \(root added by the writer, in no public list\)/);
});

test('× takes an added service out; Restore the defaults asks first when one is added, then the three, ticked, in order, and no proofTsas', async () => {
  await tsa.open();
  await tsa.tryAdd(neo.tsa.digicert.url.replace('/tsr', '/public'));
  await js('document.querySelector(".tsa-ok").click()');
  await tick(400);
  const added = (await tsa.rows()).filter((x) => x.id.startsWith('127-0-0-1'));
  assert.equal(added.length, 2);
  await tsa.click(added[0].id, '.tsa-x');
  await tick(400);
  assert.ok(!(await tsa.rows()).some((x) => x.id === added[0].id));
  assert.ok(!lib().proofTsas.some((x) => x.id === added[0].id));
  await js('document.querySelector(".tsa-reset").click()');
  const m = await confirmShown();
  assert.equal(m.title, 'Restore the defaults?');
  await modalOk();
  await tick(500);
  assert.deepEqual((await tsa.rows()).map((x) => [x.id, x.on]), [['digicert', true], ['sectigo', true], ['globalsign', true]]);
  assert.ok(!('proofTsas' in lib()));
  await tsa.done();
});

test('Esc in the address closes the add row, Esc again the dialog with History left open; a click outside closes it too', async () => {
  await neo.openHistory();
  await js('void openTsaServices()');
  await waitFor('!!document.querySelector(".tsa-backdrop")');
  await js(`document.querySelector('.tsa-new').click()`);
  await tick(200);
  key('Escape');
  await tick(200);
  assert.equal(await js('document.querySelector(".tsa-add").hidden'), true);
  assert.ok(await js('!!document.querySelector(".tsa-backdrop")'));
  key('Escape');
  await tick(200);
  assert.equal(await js('!!document.querySelector(".tsa-backdrop")'), false);
  assert.equal(await js('!!historyShown'), true, 'History stays open');
  await js('void openTsaServices()');
  await waitFor('!!document.querySelector(".tsa-backdrop")');
  await js(`(() => { const bd = document.querySelector('.tsa-backdrop'); bd.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); bd.dispatchEvent(new MouseEvent('click', { bubbles: true })); })()`);
  await tick(300);
  assert.equal(await js('!!document.querySelector(".tsa-backdrop")'), false, 'a click outside closes it');
  await neo.closeHistory();
});

/* ---------- delete ---------- */

test('Delete this book’s history… on a book with seals says its timestamps go, and they go to the trash with the recording', async () => {
  await neo.openHistory();
  await js('document.querySelector(".hs-delete").click()');
  const m = await confirmShown();
  assert.match(m.text, /Its timestamps go with it/);
  await js(`(() => { const i = document.querySelector('.confirm-modal input'); i.value = 'delete history'; i.dispatchEvent(new Event('input')); })()`);
  await modalOk();
  await waitFor('/in the trash/.test($("#hint").textContent)', 15000);
  const rec = neo.trashed.find((x) => x.from === path.join(neo.LIB, neo.book, 'recording'));
  assert.ok(rec, 'recording/ in the trash: ' + JSON.stringify(neo.trashed));
  const dev = fs.readdirSync(rec.to).find((d) => d.startsWith('d-'));
  assert.ok(fs.readdirSync(path.join(rec.to, dev, 'seals')).includes('000001.digicert.tsr'), 'its seals with it');
  assert.ok(neo.trashed.some((x) => x.from.includes(path.join('Backups', 'recordings'))), 'and the mirror');
  await neo.closeHistory();
});

/* ---------- the book the tests start from ---------- */

neo.run(async () => {
  await js(`(async () => {
    await addImportedBooks([{ name: 'Tide', chapters: ['One', 'Two'].map((title) => ({
      title, paras: [title + ' begins.', title + ' ends.'].map((text) => ({ text }))
    })) }], library.shelves[0]);
    const ids = library.shelves[0].bookIds;
    rec.strict = true;
    await openBook(ids[ids.length - 1]);
  })()`);
  neo.book = await js('book.id');
  await tick(300);
});
