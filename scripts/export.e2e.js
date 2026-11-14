// End-to-end tests for How It Was Written… and Export ▸ Writing History…
// (docs/manual-tests.md, phase 6): the report's figures for what a writer
// did (typing and fixing, going back, pastes from outside and from the
// book, dictation, Undo from the menu, a cut with the mouse, spelling
// picks), History's footer, the export's menus and its dialog, and the
// exported file itself, opened in a window of its own as a browser opens
// it: the player, the pop-ups, the checks, a page of some chapters, the
// file with JavaScript off, at a phone's width, tampered with, and in
// French. Timestamps come from fake-tsa.js (e2e-neo.js, opts.proof); the
// exported page trusts its root as NEO's own roots are trusted.
// Run with `npm run test:export` (NEO_E2E_ONLY=<regex> for some tests).

'use strict';

const neo = require('./e2e-neo.js')('export', {}, { proof: true });
const { js, tick, key, type, caretAt, flush, waitFor, assert, test } = neo;
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { BrowserWindow, dialog, clipboard } = require('electron');
const { verifyBook, print } = require('./verify-recording.js');
const ReplayExport = require('../replay-export.js');

const TITLES = ['Harbour', 'Lamps', 'Tides', 'Gulls', 'Nets'];
const ID = {};
const LONG = 'The lamps along the quay came on one by one as the boats came in, and the gulls settled on the posts to wait for scraps. ';
const idx = (title) => js(`book.chapterOrder.indexOf(${JSON.stringify(ID[title])})`);
const level = (v) => neo.menuItem('File', 'Record Writing History', v).click();
const sealCount = () => neo.seals().filter((f) => /^\d{6}\.json$/.test(f)).length;
const stampsOf = (n) => neo.seals().filter((f) => f.startsWith(String(n).padStart(6, '0') + '.') && f.endsWith('.tsr')).length;
async function until(fn, ms = 10000, what = String(fn)) {
  for (const end = Date.now() + ms; Date.now() < end; await tick(100)) if (fn()) return;
  throw new Error('timed out waiting for ' + what);
}

/* ---------- saving and opening the exported file ---------- */

// the save dialog answers with a folder of the test's own; what it was asked is kept
const saves = [];
let exportDir = path.join(neo.tmp, 'Exports A');
dialog.showSaveDialog = async (win, o) => {
  saves.push(o);
  fs.mkdirSync(exportDir, { recursive: true });
  return { canceled: false, filePath: path.join(exportDir, path.basename(o.defaultPath)) };
};
// the page's own copy of NEO's roots holds the test root too, as NEO's do here
const pageSrc = path.join(neo.tmp, 'page-src');
fs.mkdirSync(pageSrc, { recursive: true });
for (const f of ['recording.js', 'replay-page.js', 'replay-page.css']) fs.copyFileSync(path.join(__dirname, '..', f), path.join(pageSrc, f));
fs.writeFileSync(path.join(pageSrc, 'proof-roots.pem'), fs.readFileSync(path.join(__dirname, '..', 'proof-roots.pem'), 'utf8') + '\n' + require('./fake-tsa.js').rootPem);
const build = ReplayExport.build;
ReplayExport.build = (o) => build({ ...o, dir: pageSrc });

// the export dialog, step by step
const ask = {
  open: async (via = 'menu') => {
    if (via === 'menu') neo.menuItem('File', 'Export', 'Writing History…').click();
    else await js('exportWritingHistory()');
    await waitFor('!!document.querySelector(".ex-modal")', 15000);
  },
  agree: async () => {
    await js('document.querySelector(".ex-understood").click()');
    await js('document.querySelector(".m-continue").click()');
    await tick(100);
  },
  range: async (text) => {
    await js(`(() => { const f = document.querySelector('.ex-range'); f.focus(); f.value = ${JSON.stringify(text)}; f.dispatchEvent(new Event('input')); })()`);
    await tick(100);
  },
  state: () => js(`(() => {
    const q = (s) => document.querySelector(s);
    const note = q('.ex-note');
    return {
      some: q('#ex-some').checked, field: q('.ex-range').value, ok: !q('.ex-step2 .m-ok').disabled,
      note: note.hidden ? '' : note.textContent, bad: note.classList.contains('ex-bad'),
      on: [...document.querySelectorAll('.ex-ch')].map((r, i) => r.classList.contains('on') ? i + 1 : 0).filter(Boolean)
    };
  })()`),
  // Cancel, as pressed (taking the dialog away by hand would leave the export waiting on it)
  cancel: async () => { await js(`[...document.querySelectorAll('.ex-modal .m-cancel')].find((b) => b.offsetParent).click()`); await tick(100); }
};
// the whole export: the dialog through, the file written; returns its path
async function exportHistory(range = null) {
  const before = saves.length;
  await ask.open();
  await ask.agree();
  if (range) await ask.range(range);
  await js('document.querySelector(".ex-step2 .m-ok").click()');
  await until(() => saves.length > before, 60000, 'the save dialog');
  const file = path.join(exportDir, path.basename(saves[saves.length - 1].defaultPath));
  await until(() => fs.existsSync(file), 15000, 'the file');
  await waitFor('!historyExporting', 15000);
  return file;
}
// the exported file in a browser window of its own, its checks done
async function openPage(file, { width = 1280, height = 900, javascript = true, checked = true } = {}) {
  const win = new BrowserWindow({ show: false, width, height, webPreferences: { javascript, backgroundThrottling: false } });
  await win.loadFile(file);
  const pjs = (code) => win.webContents.executeJavaScript(code, true);
  const page = { win, js: pjs, close: () => win.destroy() };
  if (javascript && checked) {
    for (const end = Date.now() + 90000; ; await tick(200)) {
      const t = await pjs('(document.querySelector(".rx-ckbtn") || {}).textContent || ""');
      if (/^(Checked|Some checks failed|Vérifié|Certaines vérifications ont échoué)/.test(t)) break;
      if (Date.now() > end) throw new Error('the page’s checks never finished: ' + t);
    }
  }
  return page;
}
const pageData = (file) => JSON.parse(/<script type="application\/json" id="rx-data">([^]*?)<\/script>/.exec(fs.readFileSync(file, 'utf8'))[1]);
const pageSessions = (file) => pageData(file).sessions.map((s) => zlib.gunzipSync(Buffer.from(s.gz, 'base64')).toString('utf8'));

// History's report
const report = {
  open: async () => {
    if (!(await js('!!historyShown'))) await neo.openHistory();
    await js('document.querySelector(".hs-evidence").click()');
    const first = await js('document.querySelector(".ev-body").textContent');
    await waitFor('!!document.querySelector(".ev-facts")', 60000);
    return first;
  },
  row: (head) => js(`(() => { const r = [...document.querySelectorAll('.ev-facts tr')].find((tr) => tr.querySelector('th').textContent === ${JSON.stringify(head)}); return r ? r.querySelector('td').textContent : null; })()`),
  heads: () => js(`[...document.querySelectorAll('.ev-facts > tbody > tr > th, .ev-facts > tr > th')].map((th) => th.textContent)`),
  close: async () => { key('Escape'); await tick(200); }
};

// A word misspelt, then put right from NEO's spelling menu, as a writer does:
// spellcheck on, the word right-clicked, a suggestion clicked
async function spellingPick(chTitle, wrong) {
  await caretAt(await idx(chTitle), 0, -1);
  await type(' ' + wrong + '.');
  await js('if (!spellOn) toggleSpellcheck()');
  // the word underlined (the CSS Highlight API's neo-spell ranges), then right-clicked
  // (after a full stop NEO capitalizes it: Teh)
  const find = `[...(CSS.highlights.get('neo-spell') || [])].find((r) => r.toString().toLowerCase() === ${JSON.stringify(wrong)})`;
  await waitFor(`!!${find}`, 60000);
  const at = await js(`(() => {
    const r = ${find};
    r.startContainer.parentElement.scrollIntoView({ block: 'center' });
    const b = r.getBoundingClientRect();
    return [Math.round(b.left + b.width / 2), Math.round(b.top + b.height / 2)];
  })()`);
  neo.wc.sendInputEvent({ type: 'mouseDown', x: at[0], y: at[1], button: 'right', clickCount: 1 });
  neo.wc.sendInputEvent({ type: 'mouseUp', x: at[0], y: at[1], button: 'right', clickCount: 1 });
  await waitFor('!!document.querySelector(".spell-menu button")', 10000);
  await js('document.querySelector(".spell-menu button").click()');
  await tick(400);
  assert.ok(!(await neo.html(await idx(chTitle))).toLowerCase().includes(' ' + wrong + '.'), wrong + ' was put right');
}

// What a writer's Ctrl+V does: the system clipboard holds it, the key pastes it
async function pasteKey(data) {
  clipboard.write(data);
  key('v', [neo.CTRL]);
  await tick(400);
}

/* ---------- the writing, with nothing timestamped ---------- */

test('day one: typing and fixing, pastes from outside and from the book, dictation, Undo from the menu, a cut with the mouse, three spelling picks', async () => {
  // typing with a few slips put right as they're made
  await caretAt(await idx('Harbour'), 0, -1);
  await type(' The tide turnd\b\bned early\b\b\b\b\bat dusk.');
  // a paste from a web page: 412 characters
  const web = ('Rain came off the sea in sheets. ').repeat(13).slice(0, 412);
  await caretAt(await idx('Harbour'), 1, -1);
  await pasteKey({ text: web, html: '<p>' + web + '</p>' });
  // a paragraph cut in one chapter and pasted in another: moved
  await js(`(() => {
    const p = chapterBodyEl(${JSON.stringify(ID.Lamps)}).querySelectorAll('p')[1];
    const r = document.createRange();
    r.selectNodeContents(p);
    chapterBodyEl(${JSON.stringify(ID.Lamps)}).focus();
    getSelection().removeAllRanges(); getSelection().addRange(r);
  })()`);
  key('x', [neo.CTRL]);
  await tick(400);
  await caretAt(await idx('Tides'), 1, -1);
  key('v', [neo.CTRL]);
  await tick(400);
  // back from another app, and a paste within ten seconds
  await js('window.dispatchEvent(new Event("blur"))');
  await tick(300);
  await js('window.dispatchEvent(new Event("focus"))');
  await caretAt(await idx('Gulls'), 0, -1);
  await pasteKey({ text: 'y'.repeat(300) });
  // dictation: text that comes with no key
  await caretAt(await idx('Gulls'), 1, -1);
  await js(`document.execCommand('insertText', false, ' Dictated words.')`);
  await tick(300);
  // Undo from the Edit menu (its role: the window's own undo)
  neo.wc.undo();
  await tick(400);
  // a word cut with the mouse: selected, then Edit ▸ Cut
  await js(`(() => {
    const p = chapterBodyEl(${JSON.stringify(ID.Gulls)}).querySelectorAll('p')[2];
    const r = document.createRange();
    r.setStart(p.firstChild, 0); r.setEnd(p.firstChild, 5);
    chapterBodyEl(${JSON.stringify(ID.Gulls)}).focus();
    getSelection().removeAllRanges(); getSelection().addRange(r);
  })()`);
  neo.wc.cut();
  await tick(400);
  for (const w of ['teh', 'recieve', 'wierd']) await spellingPick('Harbour', w);
  await js('if (spellOn) toggleSpellcheck()');
  await flush();
});

test('Nets: typed at the end with Backspaces, then once back in earlier text, well before the end', async () => {
  const n = await idx('Nets');
  await caretAt(n, 2, -1);
  await type(' And the nets dried on the wal\b\b\bwalls.');
  // 500 characters or more before the chapter's end
  await caretAt(n, 0, 4);
  key('Delete'); key('Delete'); key('Delete');
  await tick(200);
  await type('XYZW');
  await flush();
});

test('How It Was Written…: “Reading every session…”, then figures only, row by row, for what was done', async () => {
  const first = await report.open();
  assert.match(first, /Reading every session…/);
  const heads = await report.heads();
  for (const h of ['Time', 'Keys', 'Rhythm', 'Pauses', 'Revised as typed', 'Revised later', 'Pasted', 'Moved', 'Not typed', 'Not recorded', 'Timestamps']) assert.ok(heads.includes(h), 'a row ' + h + ': ' + heads);
  const all = await js('document.querySelector(".ev-body").textContent');
  assert.doesNotMatch(all, /Judgement|vary as a person/);
  // the bars
  const hist = await js(`[...document.querySelectorAll('.ev-hist')].map((t) => ({ caption: t.querySelector('caption').textContent, rows: [...t.querySelectorAll('tr th')].map((th) => th.textContent), pct: [...t.querySelectorAll('.ev-hist-n')].map((x) => x.textContent) }))`);
  const rhythm = hist.find((x) => x.caption === 'The gaps between keys');
  assert.equal(rhythm.rows[0], 'under 50 ms');
  assert.equal(rhythm.rows[rhythm.rows.length - 1], '3.2 s to a minute');
  assert.ok(rhythm.pct.every((p) => /%$/.test(p)));
  assert.deepEqual(hist.find((x) => x.caption === 'Deletions in a row').rows, ['1 key', '2 keys', '3–5 keys', '6–10 keys', '11 or more']);
  // pastes: characters, no count of pastes; the one from the book is Moved
  const pasted = await report.row('Pasted');
  assert.match(pasted, /^Pasted from outside NEO: 712 characters, /);
  assert.match(pasted, /pasted within ten seconds of coming back to NEO from another app: 300 characters\./);
  assert.match(await report.row('Moved'), /^Text moved within the book: \d+ characters\.$/);
  const notTyped = await report.row('Not typed');
  assert.match(notTyped, /^Changes made with no key pressed: 3, /);
  assert.match(notTyped, /Text put in by dictation, an emoji picker or another program: 1\./);
  assert.match(notTyped, /Undo or redo from the Edit menu: 1\./);
  assert.match(notTyped, /Text cut or dragged with the mouse: 1\./);
  assert.match(notTyped, /Not counted here: spelling suggestions picked from NEO’s menu .*Replace All, joining chapters or moving cards in the Outline\.$/);
  assert.doesNotMatch(notTyped, /spelling: \d/, 'the picks aren’t counted as the system’s');
  assert.match(await report.row('Revised as typed'), /Spelling suggestions picked: 3\./);
  assert.match(await report.row('Timestamps'), /^None: timestamping wasn’t turned on/);
});

test('the chapter table: a row opens that chapter’s report, ← The whole book goes back, Esc and Done close the report and leave History open', async () => {
  if (!(await js('!!document.querySelector(".ev-chapters")'))) await report.open();
  const rows = await js(`[...document.querySelectorAll('.ev-chapters tr[data-ch]')].map((tr) => tr.dataset.ch)`);
  assert.equal(rows.length, TITLES.length);
  await js(`document.querySelector('.ev-chapters tr[data-ch="${ID.Nets}"]').click()`);
  await tick(200);
  assert.match(await js('document.querySelector(".ev-h").textContent'), /Nets/);
  assert.equal(await js('document.querySelector(".ev-back").hidden'), false);
  // Nets: deleted at the end as typed, then back once into earlier text
  assert.match(await report.row('Revised as typed'), /^Deleted where the text was being written: 3 characters/);
  assert.match(await report.row('Revised later'), /^Times the writer went back into earlier text: 1\. Typed in earlier text: 4 characters, .* Deleted there: 3\.$/);
  await js('document.querySelector(".ev-back").click()');
  await tick(200);
  assert.match(await js('document.querySelector(".ev-h").textContent'), /^How “Quay” was written$/);
  await report.close();
  assert.equal(await js('!!document.querySelector(".ev-backdrop")'), false);
  assert.equal(await js('!!historyShown'), true, 'History stays open');
  await report.open();
  await js('document.querySelector(".ev-done").click()');
  await tick(200);
  assert.equal(await js('!!document.querySelector(".ev-backdrop")'), false);
  assert.equal(await js('!!historyShown'), true);
  await neo.closeHistory();
});

test('History’s footer: Tag, restore, How It Was Written… and Delete as one kind of pill, the last two at the right, no Export; at the smallest window they wrap, never overlap', async () => {
  await neo.openHistory();
  await js(`historyShown.player.openPlayer(historyShown.player.days()[0].to - 1, { at: 'end', ch: ${JSON.stringify(ID.Harbour)} })`);
  await neo.playerReady();
  const foot = () => js(`[...document.querySelectorAll('.hs-foot > *')].filter((x) => !x.hidden && getComputedStyle(x).display !== 'none').map((x) => {
    const r = x.getBoundingClientRect(); const s = getComputedStyle(x);
    return { cls: x.className, text: x.textContent, tag: x.tagName, l: r.left, r: r.right, t: r.top, b: r.bottom, h: Math.round(r.height), radius: s.borderTopLeftRadius, border: s.borderTopWidth + ' ' + s.borderTopStyle, font: s.fontSize };
  })`);
  let f = await foot();
  const btns = f.filter((x) => x.tag === 'BUTTON');
  assert.deepEqual(btns.map((x) => x.cls), ['hs-tag', 'hs-restore', 'hs-evidence', 'hs-delete']);
  assert.ok(!btns.some((x) => /Export/.test(x.text)), 'no Export button');
  for (const b of btns) assert.deepEqual([b.h, b.radius, b.border, b.font], [btns[0].h, btns[0].radius, btns[0].border, btns[0].font], b.cls + ' is a pill like Tag This Moment…');
  assert.ok(btns[2].l > btns[1].r && btns[3].l > btns[2].r, 'at the right');
  // Delete's hover is red
  assert.ok(await js(`[...document.styleSheets].some((s) => { try { return [...s.cssRules].some((r) => /hs-delete:hover/.test(r.selectorText || '') && /color/.test(r.cssText)); } catch { return false; } })`));
  // the smallest window
  const was = neo.win.getSize();
  const [mw, mh] = neo.win.getMinimumSize();
  neo.win.setSize(mw, mh);
  await tick(600);
  try {
    f = await foot();
    for (let i = 0; i < f.length; i++) {
      for (let j = i + 1; j < f.length; j++) {
        const a = f[i]; const b = f[j];
        const overlap = a.l < b.r - 1 && b.l < a.r - 1 && a.t < b.b - 1 && b.t < a.b - 1;
        assert.ok(!overlap, a.cls + ' overlaps ' + b.cls);
      }
    }
    assert.ok(await js('(() => { const f = document.querySelector(".hs-foot"); return f.scrollWidth <= f.clientWidth + 1; })()'), 'nothing runs off the footer');
  } finally { neo.win.setSize(was[0], was[1]); await tick(300); }
  await neo.closeHistory();
});

test('with timestamping never on, the player shows no “Timestamped” and no track', async () => {
  await neo.openHistory();
  await js(`historyShown.player.openPlayer(historyShown.player.days()[0].to - 1, { at: 'end', ch: ${JSON.stringify(ID.Harbour)} })`);
  await neo.playerReady();
  await tick(1000);
  assert.equal(await js('document.querySelector(".hs-stamped").hidden'), true);
  assert.deepEqual(await js('historyShown.player.stampMarks()'), []);
  await neo.closeHistory();
});

/* ---------- the menus and the dialog ---------- */

test('File ▸ Export: Writing History… in a section of its own between the formats and Paperback for KDP…', () => {
  const items = neo.menuItem('File', 'Export').submenu.items;
  const i = items.findIndex((x) => x.label === 'Writing History…');
  assert.equal(items[i - 1].type, 'separator');
  assert.equal(items[i - 2].label, 'EPUB (.epub)');
  assert.equal(items[i + 1].type, 'separator');
  assert.equal(items[i + 2].label, 'Paperback for KDP…');
});

test('the ask: the warning alone, I understand focused, Continue greyed until it’s ticked (Space ticks, Enter goes on), then the choices; Esc and Cancel export nothing', async () => {
  const before = saves.length;
  await ask.open();
  const s1 = await js(`(() => {
    const q = (s) => document.querySelector(s);
    const btn = q('.m-continue'); const cs = getComputedStyle(btn);
    return {
      step2: !q('.ex-step2').hidden, focused: document.activeElement === q('.ex-understood'), disabled: btn.disabled, cursor: cs.cursor, shadow: cs.boxShadow,
      head: q('.ex-warn-head').textContent, body: q('.ex-warn-body').textContent, health: q('.ex-warn-health').textContent, risk: q('.ex-warn-risk').textContent,
      riskWeight: +getComputedStyle(q('.ex-warn-risk')).fontWeight, edge: getComputedStyle(q('.ex-warn')).borderLeftColor || getComputedStyle(q('.ex-warn')).borderColor
    };
  })()`);
  assert.equal(s1.step2, false);
  assert.equal(s1.focused, true);
  assert.equal(s1.disabled, true);
  assert.equal(s1.cursor, 'default');
  assert.equal(s1.shadow, 'none');
  assert.equal(s1.head, 'Think before you share this export.');
  assert.match(s1.body, /every keystroke.*words you deleted.*every pause.*time zone/);
  assert.doesNotMatch(s1.body, /device/);
  assert.equal(s1.health, 'How you type can identify you, much as a fingerprint can, and can hint at your health. Consider this personal and sensitive information when deciding who to share it with.');
  assert.match(s1.risk, /can’t be taken back\. You share it at your own risk\./);
  assert.ok(s1.riskWeight >= 600, 'in bold');
  assert.match(s1.edge, /rgb\((1\d\d|2\d\d), \d{1,2}, \d{1,2}\)|rgb\(2\d\d, \d{1,3}, \d{1,3}\)/, 'red-edged: ' + s1.edge);
  key(' ');
  await tick(100);
  assert.equal(await js('document.querySelector(".m-continue").disabled'), false, 'Space ticks it');
  key(' ');
  await tick(100);
  assert.equal(await js('document.querySelector(".m-continue").disabled'), true, 'untick greys it again');
  key(' ');
  await tick(100);
  key('Enter');
  await tick(200);
  const s2 = await js(`({ step2: !document.querySelector('.ex-step2').hidden, what: document.querySelector('.ex-what').textContent, book: document.querySelector('.ex-book').textContent, ok: document.querySelector('.ex-step2 .m-ok').textContent, warn: !document.querySelector('.ex-step1').hidden })`);
  assert.deepEqual([s2.step2, s2.warn, s2.book, s2.ok], [true, false, 'The whole book', 'Export…']);
  assert.match(s2.what, /^One file that plays how the book was written/);
  key('Escape');
  await tick(200);
  assert.equal(await js('!!document.querySelector(".ex-modal")'), false);
  await ask.open();
  await js('document.querySelector(".ex-step1 .m-cancel").click()');
  await tick(200);
  assert.equal(await js('!!document.querySelector(".ex-modal")'), false);
  assert.equal(saves.length, before, 'nothing exported');
});

test('the ask in light theme: Continue is as plainly grey', async () => {
  const was = await js('library.pageTheme');
  await js(`library.pageTheme = 'light'; applyPageTheme && applyPageTheme()`).catch(() => js(`document.body.classList.remove('night'); document.body.classList.add('light')`));
  try {
    await ask.open();
    const c = await js(`(() => { const cs = getComputedStyle(document.querySelector('.m-continue')); return { cursor: cs.cursor, shadow: cs.boxShadow }; })()`);
    assert.deepEqual(c, { cursor: 'default', shadow: 'none' });
    key('Escape');
    await tick(200);
  } finally {
    await js(`library.pageTheme = ${JSON.stringify(was)}; document.body.classList.toggle('night', library.pageTheme === 'night'); document.body.classList.toggle('light', library.pageTheme === 'light')`);
  }
});

test('the choices: Chapters typed or clicked, the field rewritten shortest, bad ones said in red with Export greyed; the whole book again hides it all', async () => {
  await ask.open();
  await ask.agree();
  let s = await ask.state();
  assert.deepEqual([s.some, s.ok, s.note], [false, true, '']);
  assert.equal(await js('document.querySelector(".ex-range").placeholder'), 'e.g. 1–3, 5');
  assert.deepEqual(await js(`[...document.querySelectorAll('.ex-ch')].map((r) => r.querySelector('.ex-num').textContent)`), ['1', '2', '3', '4', '5']);
  assert.equal(await js('getComputedStyle(document.querySelector(".ex-chapters")).overflowY'), 'scroll', 'a scroll bar always showing');
  await js('document.querySelector(".ex-range").focus()');
  await tick(100);
  s = await ask.state();
  assert.deepEqual([s.some, s.ok, s.note], [true, false, 'Type the chapters’ numbers, or click them.']);
  for (const typed of ['1-3, 5', '1 - 3; 5', '1–3 5', '3,1,2,5']) {
    await ask.range(typed);
    s = await ask.state();
    assert.deepEqual([s.on, s.ok, s.note], [[1, 2, 3, 5], true, ''], typed);
  }
  for (const typed of ['0', '5-3', '9', 'a']) {
    await ask.range(typed);
    s = await ask.state();
    assert.equal(s.ok, false, typed);
    assert.equal(s.bad, true, typed);
    assert.match(s.note, /^Chapters go as numbers from 1 to 5, and ranges such as 1–3, with commas between\.$/);
  }
  await ask.range('');
  for (const i of [3, 1, 2, 5]) { await js(`document.querySelectorAll('.ex-ch')[${i - 1}].click()`); await tick(50); }
  s = await ask.state();
  assert.equal(s.field, '1–3, 5');
  await js('document.querySelectorAll(".ex-ch")[1].click()');
  assert.equal((await ask.state()).field, '1, 3, 5');
  await js(`(() => { const r = document.querySelector('input[name="ex-scope"][value="book"]'); r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await tick(100);
  s = await ask.state();
  assert.deepEqual([s.on, s.note, s.ok], [[], '', true]);
  await ask.cancel();
});

test('a script’s File ▸ Export has Writing History… after Final Draft', () => {
  // the menu as main.js builds it for a script: read from its source, as it's
  // built only while a script is open
  const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const script = /submenu: scriptState\.on \? \[([^]*?)\] : \[/.exec(src)[1];
  assert.match(script, /Final Draft \(\.fdx\)[^]*separator[^]*Writing History…/);
});

test('with no book open, the menu says “Open a book first”; a book never recorded has nothing to export; the shelf’s Export… lists it second to last and exports without opening the book', async () => {
  await js('backToShelf()');
  await tick(800);
  await js('$("#hint").hidden = true');
  neo.menuItem('File', 'Export', 'Writing History…').click();
  await waitFor('/Open a book first/.test($("#hint").textContent) && !$("#hint").hidden');
  // a book never recorded
  await js(`addImportedBooks([{ name: 'Blank Slate', chapters: [{ title: 'Only', paras: [{ text: 'Never opened.' }] }] }], library.shelves[0])`);
  await tick(500);
  const blank = await js('library.shelves[0].bookIds[library.shelves[0].bookIds.length - 1]');
  await js(`exportWritingHistory(${JSON.stringify(blank)})`);
  await waitFor('/This book has no Writing History to export yet\\./.test($("#hint").textContent)');
  // the shelf's Export…: its choices, answered with Writing History…
  const before = saves.length;
  const opts = await js(`(async () => {
    const real = optionModal;
    let seen = null;
    optionModal = async (title, msg, options) => { optionModal = real; seen = options.map((o) => o.label); return 'history'; };
    const realPop = popMenu;
    popMenu = async () => { popMenu = realPop; return 'export'; };
    const el = [...document.querySelectorAll('[data-book-id]')].find((x) => x.dataset.bookId === ${JSON.stringify(neo.book)});
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 50 }));
    await new Promise((r) => setTimeout(r, 300));
    return seen;
  })()`);
  assert.equal(opts[opts.length - 2], 'Writing History…');
  assert.equal(opts[opts.length - 1], 'Paperback for KDP…');
  await waitFor('!!document.querySelector(".ex-modal")', 15000);
  await ask.agree();
  await js('document.querySelector(".ex-step2 .m-ok").click()');
  await until(() => saves.length > before, 60000, 'the save dialog');
  await waitFor('!historyExporting', 15000);
  assert.equal(await js('document.getElementById("editor-view").hidden'), true, 'the book wasn’t opened');
  await js(`openBook(${JSON.stringify(neo.book)})`);
  await waitFor(`!!book && book.id === ${JSON.stringify(neo.book)} && rec.on`);
  await tick(400);
});

test('picked from the menu while History is open, it closes History and asks', async () => {
  await neo.openHistory();
  neo.menuItem('File', 'Export', 'Writing History…').click();
  await waitFor('!!document.querySelector(".ex-modal")', 15000);
  assert.equal(await js('!!historyShown'), false);
  await ask.cancel();
});

/* ---------- the exported file ---------- */

let WHOLE = null;
test('the whole book: the save dialog in the last export folder, named “<title> — Writing History.html”; it checks itself', async () => {
  exportDir = path.join(neo.tmp, 'Exports B');
  WHOLE = await exportHistory();
  assert.equal(path.basename(WHOLE), 'Quay — Writing History.html');
  WHOLE = await exportHistory();
  assert.equal(path.dirname(saves[saves.length - 1].defaultPath), exportDir, 'the last export folder');
  const page = await openPage(WHOLE);
  try {
    const s = await page.js(`(() => {
      const q = (x) => document.querySelector(x);
      const r = (x) => q(x).getBoundingClientRect();
      return {
        checked: q('.rx-ckbtn').textContent, ok: q('.rx-ckbtn').classList.contains('ok'),
        actions: [...q('#rx-actions').children].map((b) => b.textContent),
        side: [...document.querySelectorAll('.rx-chbtn')].map((b) => b.textContent),
        tiles: document.querySelectorAll('.rx-tile').length, footer: !!q('footer'),
        headerRight: r('#rx-actions').left > r('.rx-top h1').right,
        controlsAboveStrip: r('.rx-controls').bottom <= r('.rx-strip').top + 1
      };
    })()`);
    assert.ok(s.ok, 'checked: ' + s.checked);
    // a book never timestamped: it holds together, and says nothing fixes it in time
    assert.equal(s.checked, 'Checked, but not timestamped');
    assert.match(await page.js('document.querySelector(".rx-lead.rx-unfixed").textContent'), /^Nothing fixes this history in time: no writing session was timestamped\./);
    assert.deepEqual(s.actions, ['How it was written', s.checked]);
    assert.deepEqual(s.side, ['The whole book', ...await js('book.chapterOrder.map((c) => historyChapterLabel(book, c, book.chapterOrder))')]);
    assert.ok(s.tiles >= 1);
    assert.equal(s.footer, false);
    assert.ok(s.headerRight, 'the buttons at the right of the header');
    assert.ok(s.controlsAboveStrip, 'the controls above the tiles');
    // the controls stay on screen at a low window
    page.win.setSize(1100, 520);
    await tick(400);
    assert.ok(await page.js('document.querySelector(".rx-controls").getBoundingClientRect().bottom <= innerHeight'), 'the controls on screen at 520 pixels high');
  } finally { page.close(); }
});

test('the exported player: a tile opens its day paused, ▶ and ❚❚, ▶▶ lit at 8× and back, Space, ← → on the timeline, Esc back to the days', async () => {
  const page = await openPage(WHOLE);
  try {
    // (the play head's place on the timeline: the moment's label shows minutes only)
    const st = () => page.js(`({ player: !document.querySelector('.rx-controls').hidden && document.querySelector('.rx-back') && !document.querySelector('.rx-back').hidden, play: document.querySelector('.rx-play').textContent, fast: document.querySelector('.rx-fast').getAttribute('aria-pressed'), when: document.querySelector('.rx-head').style.left || document.querySelector('.rx-head').style.transform, prev: !!document.querySelector('.rx-prev'), next: !!document.querySelector('.rx-next') })`);
    await page.js('document.querySelector(".rx-tile").click()');
    await tick(1500);
    let s = await st();
    assert.equal(s.play, '▶', 'paused');
    assert.ok(s.prev && s.next);
    await page.js('document.querySelector(".rx-play").click()');
    await tick(300);
    assert.equal((await st()).play, '❚❚');
    await page.js('document.querySelector(".rx-play").click()');
    await tick(200);
    assert.equal((await st()).play, '▶');
    await page.js('document.querySelector(".rx-fast").click()');
    await tick(200);
    s = await st();
    assert.deepEqual([s.fast, s.play], ['true', '❚❚']);
    await page.js('document.querySelector(".rx-fast").click()');
    await tick(200);
    assert.equal((await st()).fast, 'false');
    await page.js('document.querySelector(".rx-play").click()');
    await tick(200);
    // Space plays and pauses
    const sendKey = (k) => { page.win.webContents.sendInputEvent({ type: 'keyDown', keyCode: k }); page.win.webContents.sendInputEvent({ type: 'keyUp', keyCode: k }); };
    await page.js('document.activeElement && document.activeElement.blur()');
    const was = (await st()).play;
    sendKey('Space');
    await tick(300);
    assert.notEqual((await st()).play, was);
    sendKey('Space');
    await tick(300);
    // ← and → on the timeline go there
    await page.js('document.querySelector(".rx-timeline").focus()');
    const w0 = (await st()).when;
    // (wherever the play head is, one way or the other has room to go)
    for (let i = 0; i < 10; i++) { sendKey('Left'); await tick(30); }
    await tick(300);
    const w1 = (await st()).when;
    for (let i = 0; i < 20; i++) { sendKey('Right'); await tick(30); }
    await tick(300);
    const w2 = (await st()).when;
    assert.ok(w1 !== w0 || w2 !== w1, 'the timeline moved: ' + [w0, w1, w2].join(' / '));
    await page.js('document.activeElement.blur()');
    sendKey('Escape');
    await tick(400);
    assert.equal(await page.js('getComputedStyle(document.querySelector(".rx-strip")).display !== "none" && !document.querySelector(".rx-strip").hidden'), true, 'back to the days');
  } finally { page.close(); }
});

test('the exported pop-ups: How it was written opens the report, matched; the checks button what the export checks, ending “Made with NEO”; Close, Esc and a click outside close them', async () => {
  // while the checks run, “Made with NEO” waits out of sight: it showed
  // through the header's title until they took it into their pop-up
  const early = await openPage(WHOLE, { checked: false });
  try {
    await early.js('new Promise((r) => requestAnimationFrame(() => r()))');
    const made = await early.js('(() => { const m = document.getElementById("rx-made"); return { inChecks: !!m.closest("#rx-checks"), shown: m.getClientRects().length > 0 }; })()');
    assert.ok(made.inChecks || !made.shown, 'not shown under the header: ' + JSON.stringify(made));
  } finally {
    early.close();
  }
  const page = await openPage(WHOLE);
  try {
    await page.js('document.querySelector(".rx-evbtn").click()');
    let d = await page.js(`(() => { const d = document.querySelector('dialog[open]'); return d && { label: d.getAttribute('aria-label'), first: d.querySelector('.rx-same') && d.querySelector('.rx-same').textContent, facts: !!d.querySelector('.ev-facts'), bars: d.querySelectorAll('.ev-hist').length }; })()`);
    assert.equal(d.label, 'How it was written');
    assert.equal(d.first, 'The figures below were worked out again from the history in this export, and match.');
    assert.ok(d.facts && d.bars >= 2);
    await page.js('document.querySelector("dialog[open] .rx-close").click()');
    assert.equal(await page.js('!!document.querySelector("dialog[open]")'), false, 'Close');
    await page.js('document.querySelector(".rx-ckbtn").click()');
    d = await page.js(`(() => { const d = document.querySelector('dialog[open]'); return d && { label: d.getAttribute('aria-label'), text: d.textContent.trim() }; })()`);
    assert.equal(d.label, 'What this export checks');
    assert.match(d.text, /Made with NEO [^]*\.$/);
    page.win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    page.win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await tick(300);
    assert.equal(await page.js('!!document.querySelector("dialog[open]")'), false, 'Esc');
    await page.js('document.querySelector(".rx-evbtn").click()');
    await page.js(`document.querySelector('dialog[open]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
    assert.equal(await page.js('!!document.querySelector("dialog[open]")'), false, 'a click outside');
  } finally { page.close(); }
});

test('the exported file with JavaScript off is the report on a plain page', async () => {
  const page = await openPage(WHOLE, { javascript: false });
  try {
    const off = await page.win.webContents.executeJavaScript('1').then(() => false, () => true).catch(() => true);
    // (with scripts off, executeJavaScript can't run either: read the DOM's text another way)
    const html = await page.win.webContents.executeJavaScript('document.body.innerText').catch(() => null);
    if (html !== null) {
      assert.match(html, /Time[\s\S]*Keys[\s\S]*Rhythm/);
      assert.match(html, /Turn on JavaScript to play the history and check it/);
    } else assert.ok(off);
  } finally { page.close(); }
  // the file as a browser without scripts shows it: the report isn't hidden, the player is
  const src = fs.readFileSync(WHOLE, 'utf8');
  assert.match(src, /<section id="rx-report" class="rx-report"><h2 class="ev-h">/);
  assert.match(src, /<main id="rx-player" class="rx-player" hidden>/);
});

test('the exported file at a phone’s width: no side pane, nothing wider than the screen', async () => {
  const page = await openPage(WHOLE, { width: 390, height: 844 });
  try {
    const s = await page.js(`({ side: getComputedStyle(document.getElementById('rx-side')).display, wide: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      out: [...document.querySelectorAll('.rx-controls button, #rx-actions button, .rx-tile')].filter((b) => b.getBoundingClientRect().right > innerWidth + 1 && !b.closest('.rx-strip')).map((b) => b.className) })`);
    assert.equal(s.side, 'none');
    assert.ok(s.wide <= 0, 'sideways scrolling: ' + s.wide);
    assert.deepEqual(s.out, []);
    await page.js('document.querySelector(".rx-tile").click()');
    await tick(800);
    await page.js('document.querySelector(".rx-play").click()');
    await tick(300);
    assert.equal(await page.js('document.querySelector(".rx-play").textContent'), '❚❚', 'it plays');
  } finally { page.close(); }
});

test('the exported file in French: its buttons and checks in French', async () => {
  const fr = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'locales', 'fr.json'), 'utf8'));
  await js(`NeoI18n.setLocale('fr', ${JSON.stringify(fr)}, {})`);
  let file;
  try {
    await ask.open();
    assert.equal(await js('document.querySelector(".ex-warn-head").textContent'), fr['Think before you share this export.'], 'the warning in French');
    await ask.cancel();
    const before = saves.length;
    await ask.open();
    await ask.agree();
    await js('document.querySelector(".ex-step2 .m-ok").click()');
    await until(() => saves.length > before, 60000, 'the save dialog');
    file = path.join(exportDir, path.basename(saves[saves.length - 1].defaultPath));
    await until(() => fs.existsSync(file), 15000, 'the file');
    await waitFor('!historyExporting', 15000);
  } finally { await js(`NeoI18n.setLocale('en', {}, {})`); }
  const page = await openPage(file);
  try {
    assert.equal(await page.js('document.querySelector(".rx-evbtn").textContent'), fr['How it was written']);
    assert.equal(await page.js('document.querySelector(".rx-fast").title'), fr['Play fast']);
  } finally { page.close(); }
});

test('an export of some chapters, none timestamped: named for them, only theirs inside, and it says its timestamps can’t be verified', async () => {
  const file = await exportHistory('1-2, 4');
  assert.equal(path.basename(file), 'Quay, Chapters 1–2, 4 — Writing History.html');
  const one = await exportHistory('3');
  assert.equal(path.basename(one), 'Quay, Chapter 3 — Writing History.html');
  const src = fs.readFileSync(file, 'utf8');
  assert.match(src, /This export holds only some chapters, so its timestamps can’t be verified\. Export the whole book for that\./);
  // nothing of chapter 3 or 5, even unpacked
  const texts = pageSessions(file).join('\n');
  assert.ok(!texts.includes('Tides begins') && !texts.includes('Nets begins'), 'a chapter left out is in it');
  assert.ok(texts.includes('Harbour begins'));
  const page = await openPage(file);
  try {
    assert.deepEqual(await page.js('[...document.querySelectorAll(".rx-chbtn")].map((b) => b.textContent)'), ['The whole book', ...(await js(`[0, 1, 3].map((i) => historyChapterLabel(book, book.chapterOrder[i], book.chapterOrder))`))]);
  } finally { page.close(); }
});

test('moved-in text: chapter 3 alone is warned of chapter 2’s text, 2–3 isn’t; an Undo that put text back says nothing', async () => {
  await ask.open();
  await ask.agree();
  await waitFor('true');
  await tick(1500); // (the moves are worked out as the dialog opens)
  await ask.range('3');
  assert.equal((await ask.state()).note, 'Chapter 3 holds text moved in from chapter 2. Add chapter 2 to show it being written.');
  await ask.range('2-3');
  assert.equal((await ask.state()).note, '');
  await ask.range('1');
  assert.equal((await ask.state()).note, '');
  await ask.cancel();
});

/* ---------- with timestamps ---------- */

test('Record and Timestamp turned on two days after the first writing: sealed and stamped', async () => {
  await js('backToShelf()');
  await tick(1000);
  await js(`openBook(${JSON.stringify(neo.book)})`);
  await waitFor('rec.on');
  // (the clock two days on while the first seal is made and stamped, so the
  // first day's sessions are timestamped more than a day after they ended)
  neo.mainAhead(2 * 24 * 3600 * 1000);
  try {
    level('Record and Timestamp');
    await waitFor('!!document.querySelector(".confirm-modal")');
    await js('document.querySelector(".confirm-modal .m-ok").click()');
    await until(() => sealCount() >= 1 && stampsOf(1) === 2, 15000, 'the first seal');
  } finally { neo.mainAhead(0); }
  neo.shorten[5 * 60 * 1000] = 1500;
  let n = sealCount();
  await caretAt(await idx('Harbour'), 0, -1);
  await type(' Sealed words.');
  await caretAt(await idx('Lamps'), 0, -1);
  await type(' Lamps sealed.');
  await flush();
  await until(() => sealCount() === n + 1 && stampsOf(n + 1) === 2, 15000, 'the seal after the words');
  // a tag, and a snapshot (a tag of NEO's own)
  n = sealCount();
  await js('void rec.tag("Sent to my agent")');
  await until(() => sealCount() === n + 1 && stampsOf(n + 1) === 2, 15000, 'the tag’s seal');
  await caretAt(await idx('Harbour'), 0, -1);
  key('s', [neo.CTRL]);
  await tick(1500);
  // and words after the last seal
  neo.shorten[5 * 60 * 1000] = 60 * 60 * 1000;
  await caretAt(await idx('Harbour'), 0, -1);
  await type(' Not sealed yet.');
  await flush();
});

test('How It Was Written…’s Timestamps: how many, the first and the last, the mean between, the services, and the sessions not timestamped within a day', async () => {
  await report.open();
  const ts = await report.row('Timestamps');
  assert.match(ts, /^\d+ timestamps, the first .+ and the last .+: one every .+ on average between them\. Timestamp services: DigiCert, Sectigo\. Sessions not timestamped within a day of ending: \d+ of \d+\.$/);
  assert.doesNotMatch(ts, /Invalid Date/);
  await report.close();
  await neo.closeHistory();
});

test('in the player with timestamps: “Timestamped …” changes as it’s scrubbed, a dash per seal on the track, “Not timestamped” after the last', async () => {
  await neo.openHistory();
  const days = await js('historyShown.player.days().length');
  await js(`historyShown.player.openPlayer(historyShown.player.days()[${days - 1}].to - 1, { at: 'end', ch: ${JSON.stringify(ID.Harbour)} })`);
  await neo.playerReady();
  await waitFor('historyShown.player.stampMarks().length >= 2', 15000);
  const marks = await js('historyShown.player.stampMarks()');
  const said = async (j) => js(`(() => { historyShown.player.seek(${j}); const s = document.querySelector('.hs-stamped'); return s.hidden ? '' : s.textContent; })()`);
  const at = [];
  for (const m of marks) at.push(await said(m.j + 1));
  for (const s of at) assert.match(s, /^Timestamped /);
  assert.ok(new Set(at).size >= 2, 'it changes where a new seal begins: ' + at);
  const steps = await js('historyShown.player.steps().length');
  assert.equal(await said(steps), 'Not timestamped');
  await neo.closeHistory();
});

let SEALED = null;
test('the whole book with its seals: checked, each seal’s fingerprint as verify-recording prints it, its files to download, and its stamps check against the page’s own roots', async () => {
  SEALED = await exportHistory();
  const page = await openPage(SEALED);
  try {
    const lead = await page.js('document.querySelector(".rx-lead") ? document.querySelector(".rx-lead").textContent : ""');
    assert.match(await page.js('document.querySelector(".rx-ckbtn").textContent'), /Checked$/, lead);
    assert.match(lead, /^Fixed in time: \d+ of \d+ writing sessions were timestamped within a day of ending\.$/);
    const tbl = await page.js(`[...document.querySelectorAll('.rx-seals tr')].map((tr) => [...tr.children].map((c) => c.textContent))`);
    assert.deepEqual(tbl[0], ['Seal', 'Fingerprint', 'Made', 'After (drand)', 'Timestamped', 'Files']);
    const out = print(await verifyBook(path.join(neo.LIB, neo.book)));
    for (const row of tbl.slice(1)) {
      const fp = row[1].replace(/ /g, '');
      assert.match(out, new RegExp(row[0] + ' ok  fingerprint ' + fp), 'verify-recording prints ' + fp);
      assert.match(row[5], new RegExp(row[0] + '\\.json'));
    }
    assert.ok(await page.js('[...document.querySelectorAll("a.rx-file")].every((a) => a.download && a.href.startsWith("blob:"))'));
    // a moment of the day: Timestamped …, and the track
    await page.js('document.querySelectorAll(".rx-tile")[document.querySelectorAll(".rx-tile").length - 1].click()');
    await tick(1500);
    await page.js(`(() => { const t = document.querySelector('.rx-timeline'); t.focus(); })()`);
    for (let i = 0; i < 25; i++) { page.win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Left' }); page.win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Left' }); await tick(20); }
    await tick(300);
    assert.match(await page.js('document.querySelector(".rx-stamped").hidden ? "" : document.querySelector(".rx-stamped").textContent'), /^(Timestamped|Not timestamped)/);
  } finally { page.close(); }
  // each stamp checks against the roots the page carries
  const data = pageData(SEALED);
  const roots = neo.Proof.certsIn(data.roots);
  for (const files of Object.values(data.seals)) {
    const byName = new Map(files.map((f) => [f.name, Buffer.from(f.b64, 'base64')]));
    for (const [name, bytes] of byName) {
      const m = /^(\d{6})\.([a-z0-9-]+)\.tsr$/.exec(name);
      if (!m) continue;
      const digest = require('crypto').createHash('sha256').update(byName.get(m[1] + '.json')).digest();
      const c = neo.Proof.checkToken(bytes, { digest, anchors: roots });
      assert.ok(c.ok && c.trusted, name + ': ' + c.problems.join('; '));
    }
  }
});

test('a seal changed by one character in the exported file: the page shows ✗', async () => {
  const data = pageData(SEALED);
  const dev = Object.keys(data.seals)[0];
  const f = data.seals[dev].find((x) => x.name === '000001.json');
  const was = Buffer.from(f.b64, 'base64').toString('utf8');
  const changed = was.replace(/("seq":\s*)1(?!\d)/, '$17');
  assert.notEqual(changed, was, 'the seal’s seq changed');
  f.b64 = Buffer.from(changed).toString('base64');
  const src = fs.readFileSync(SEALED, 'utf8');
  const bad = path.join(path.dirname(SEALED), 'tampered.html');
  fs.writeFileSync(bad, src.replace(/(<script type="application\/json" id="rx-data">)[^]*?(<\/script>)/, (m, a, b) => a + JSON.stringify(data).replace(/</g, '\\u003c') + b));
  const page = await openPage(bad);
  try {
    assert.equal(await page.js('document.querySelector(".rx-ckbtn").textContent'), 'Some checks failed');
    assert.ok(await page.js('document.querySelector(".rx-ckbtn").classList.contains("bad")'));
  } finally { page.close(); }
});

test('one chapter, timestamped, as a public sample: no tags, its seals checked against its own lines, how many other chapters they cover, and the same fingerprints', async () => {
  const file = await exportHistory('1');
  const page = await openPage(file);
  try {
    const s = await page.js(`({ tags: !!document.querySelector('.rx-sidehead'), lines: [...document.querySelectorAll('#rx-checks li')].map((li) => li.className + ': ' + li.textContent), fps: [...document.querySelectorAll('.rx-seals tr')].slice(1).map((tr) => tr.children[1].textContent), bad: document.querySelectorAll('.rx-seals tr.bad').length, ok: document.querySelector('.rx-ckbtn').classList.contains('ok') })`);
    assert.equal(s.tags, false, 'no Tags');
    assert.ok(s.ok, s.lines.join('\n'));
    assert.ok(s.lines.some((l) => /This export holds only some chapters, so the sessions’ hash chains, which cover every chapter, can’t be checked here\. The seals are checked against these chapters’ own lines\./.test(l)));
    assert.ok(s.lines.some((l) => /These seals also cover the writing of (one other chapter|\d+ other chapters) of the book/.test(l)));
    assert.ok(s.lines.some((l) => /The whole book’s export, and verify-recording run on the book, show the same seals with the same fingerprints\./.test(l)));
    assert.equal(s.bad, 0);
    const whole = await openPage(SEALED);
    try {
      const all = await whole.js(`[...document.querySelectorAll('.rx-seals tr')].slice(1).map((tr) => tr.children[1].textContent)`);
      for (const fp of s.fps) assert.ok(all.includes(fp), fp + ' is in the whole book’s seals');
    } finally { whole.close(); }
    // no tag on its timeline: its tags aren't in it at all
    assert.ok(!pageSessions(file).join('\n').includes('Sent to my agent'));
  } finally { page.close(); }
  assert.ok((await verifyBook(path.join(neo.LIB, neo.book))).ok, 'verify-recording still says everything checks');
});

test('a chapter joined to another: an export of the one that took it says the text came from a chapter no longer in the book', async () => {
  await js(`joinChapter(${JSON.stringify(ID.Nets)}, ${JSON.stringify(ID.Gulls)})`);
  await tick(600);
  await flush();
  await ask.open();
  await ask.agree();
  await tick(1500);
  await ask.range(String(await idx('Gulls') + 1));
  assert.equal((await ask.state()).note, `Chapter ${await idx('Gulls') + 1} holds text moved in from a chapter no longer in the book. Only the whole book’s export shows it being written.`);
  await ask.cancel();
});

/* ---------- the book the tests start from ---------- */

neo.run(async () => {
  await js(`(async () => {
    await addImportedBooks([{ name: 'Quay', chapters: ${JSON.stringify(TITLES)}.map((title) => ({
      title, paras: [title + ' begins. ' + ${JSON.stringify(LONG)}.repeat(3), title + ' goes on. ' + ${JSON.stringify(LONG)}.repeat(2), title + ' ends.'].map((text) => ({ text }))
    })) }], library.shelves[0]);
    const ids = library.shelves[0].bookIds;
    rec.strict = true;
    await openBook(ids[ids.length - 1]);
  })()`);
  neo.book = await js('book.id');
  for (const id of await neo.chapterIds()) ID[await js(`book.chapterTitles[${JSON.stringify(id)}]`)] = id;
  assert.deepEqual(Object.keys(ID), TITLES);
  await tick(300);
});
