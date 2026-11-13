// End-to-end tests for the Writing History dialog, restore and tags: the
// items of docs/manual-tests.md that a script can check (marked "(e2e)"
// there). NEO runs on a throwaway library; a book is written over three
// writer's days (a pause, a move, a paste, a chapter split, joins, a loose
// card, a delete, paragraphs moved and taken out), then History is driven
// as a writer drives it. recording.e2e.js covers the recorder itself and
// the first pass over History; these add what it leaves to the hand.
// Run with `npm run test:history` (NEO_E2E_ONLY=<regex> for some tests).

'use strict';

const neo = require('./e2e-neo.js')('history');
const { js, tick, key, type, paste, caretAt, flush, waitFor, assert, test } = neo;
const fs = require('fs');
const path = require('path');

const TITLES = ['One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
const ID = {};        // title -> chapter id
const DAYS = [];      // the writer's days written, oldest first
let SPLIT = null;     // the chapter the second day's three Enters made
const idx = (title) => js(`book.chapterOrder.indexOf(${JSON.stringify(ID[title])})`);
const chHTML = (id) => js(`chapterHTML[${JSON.stringify(id)}]`);
const name = (id) => js(`chapterName(${JSON.stringify(id)})`);
const texts = (html) => [...html.matchAll(/<p[^>]*>(.*?)<\/p>/g)].map((m) => m[1].replace(/<[^>]+>/g, ''));

// History on day di (0 = the first), at its end, on chapter ch or the whole book
async function atDayEnd(di, ch = 'book') {
  if (!(await js('!!historyShown'))) await neo.openHistory();
  await js(`historyShown.player.openPlayer(historyShown.player.days()[${di}].to - 1, { at: 'end', ch: ${JSON.stringify(ch)} })`);
  await neo.playerReady({ drawn: false });
}
// the paragraph of chapter ch on the sheet whose text starts with `start`, picked
const pickOnSheet = (ch, start, through = null) => js(`(() => {
  const ps = [...historyShown.player.paper.querySelectorAll('.rp-chapter[data-ch="${ch}"] .rp-body p')];
  const a = ps.find((p) => p.textContent.startsWith(${JSON.stringify(start)}));
  const b = ${JSON.stringify(through)} ? ps.find((p) => p.textContent.startsWith(${JSON.stringify(through)})) : a;
  if (!a || !b) return false;
  historyShown.player.pickPart(${JSON.stringify(ch)}, a, b);
  return true;
})()`);
// a NEO choice dialog (optionModal), as shown: its title, its text, and its choices
const optionShown = async () => {
  await waitFor('!!document.body.lastElementChild.querySelector(".fr-choice")', 30000);
  return js(`(() => { const m = document.body.lastElementChild; return { title: m.querySelector('.modal h2').textContent, text: m.querySelector('.modal p').textContent }; })()`);
};
const clipWatch = () => js(`(() => {
  window.__clip = null;
  navigator.clipboard.write = async (items) => { window.__clip = { text: await (await items[0].getType('text/plain')).text() }; };
})()`);
const lastTag = async () => (await neo.sessionLines()).filter((l) => l[1] === 'tag').pop();

/* ---------- the book, written over three days ---------- */

test('day one: typing with a pause, text moved within the book, a paste from elsewhere', async () => {
  DAYS.push(await js('writingDay()'));
  await caretAt(await idx('One'), 0, -1);
  await type(' Gulls cried.');
  await tick(2600); // a pause over 1.5 s, inside the session's writing
  await type(' Again.');
  // copied from chapter Two, pasted in Four: moved text
  const copied = await neo.copyParagraph(await idx('Two'), 2);
  assert.equal(copied, 'Two ends.');
  await caretAt(await idx('Four'), 0, -1);
  await paste({ text: copied });
  // and from another program
  await caretAt(await idx('Four'), 1, -1);
  await paste({ text: ' From the web.' });
  await caretAt(await idx('Three'), 1, -1);
  await type(' Later on.');
  // (Nine is never edited: it's in the history from its baseline, written
  // with the session's first change, and set on a card on day three)
  for (const t of ['Two', 'Five', 'Six', 'Seven', 'Eight', 'Ten']) {
    await caretAt(await idx(t), 0, -1);
    await type(' Yes.');
  }
  await flush();
});

test('day two: a chapter split in two', async () => {
  DAYS.push(await neo.dayAhead(1));
  const before = await neo.chapterIds();
  await caretAt(await idx('One'), 1, -1);
  await type(' Second day.\n\n\nA new one begins.');
  const after = await neo.chapterIds();
  SPLIT = after.find((c) => !before.includes(c));
  assert.ok(SPLIT, 'three Enters made a chapter');
  assert.match(await chHTML(SPLIT), /A new one begins\./);
  await flush();
});

test('day three: a join, a chapter made a section, one set on a loose card and one deleted; paragraphs moved and taken out', async () => {
  DAYS.push(await neo.dayAhead(1));
  await caretAt(await idx('Five'), 0, -1);
  await type(' Third.');
  // Eight joined to Seven (Backspace at its start)
  await caretAt(await idx('Eight'), 0, 0);
  key('Backspace');
  await tick(500);
  await js(`joinChapter(${JSON.stringify(ID.Six)}, ${JSON.stringify(ID.Five)})`);
  await tick(300);
  await js(`chapterToLoose(${JSON.stringify(ID.Nine)})`);
  await tick(300);
  await js(`deleteChapterToDarlings(${JSON.stringify(ID.Ten)})`);
  await tick(300);
  const now = await neo.chapterIds();
  for (const t of ['Six', 'Eight', 'Nine', 'Ten']) assert.ok(!now.includes(ID[t]), t + ' is out of the book');
  // Three's last paragraph edited, then moved to the top of the chapter
  await caretAt(await idx('Three'), 2, -1);
  await type(' Edited.');
  // Two's first paragraph moved into Three; Seven's second taken out
  await js(`(() => {
    const three = chapterBodyEl(${JSON.stringify(ID.Three)});
    const two = chapterBodyEl(${JSON.stringify(ID.Two)});
    const cut = three.lastElementChild;
    cut.remove();
    syncChapter(three, ${JSON.stringify(ID.Three)}, 'outline');
    three.insertBefore(cut, three.firstElementChild);
    syncChapter(three, ${JSON.stringify(ID.Three)}, 'outline');
    three.appendChild(two.firstElementChild);
    syncChapter(two, ${JSON.stringify(ID.Two)}, 'outline');
    syncChapter(three, ${JSON.stringify(ID.Three)}, 'outline');
  })()`);
  await tick(300);
  assert.deepEqual(texts(await chHTML(ID.Three)), ['Three ends. Edited.', 'Three begins.', 'Three goes on. Later on.', 'Two begins. Yes.']);
  await js(`(() => {
    const ps = chapterBodyEl(${JSON.stringify(ID.Seven)}).querySelectorAll('p');
    const r = document.createRange();
    r.setStart(ps[0].firstChild, ps[0].firstChild.length);
    r.setEnd(ps[1].firstChild, ps[1].firstChild.length);
    chapterBodyEl(${JSON.stringify(ID.Seven)}).focus();
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  })()`);
  key('Backspace');
  await tick(500);
  assert.ok(!texts(await chHTML(ID.Seven)).includes('Seven goes on.'), 'taken out');
  await flush();
});

/* ---------- the dialog ---------- */

test('File → Writing History… with a book open opens it, on the days', async () => {
  neo.menuItem('File', 'Writing History…').click();
  await neo.daysReady();
  assert.equal(await js('historyShown.player.view()'), 'days');
  assert.deepEqual(await js('historyShown.player.days().map((d) => d.day)'), DAYS);
  await neo.closeHistory();
});

test('the days: ← and → show each day as it ended, Enter opens one paused, Space plays, Esc goes back, then closes', async () => {
  await neo.openHistory();
  await js('historyShown.player.setMode("book")');
  await neo.daysReady();
  assert.equal(await js('historyShown.player.day()'), 2, 'on the latest day');
  for (const want of [1, 0, 0]) {
    key('Left');
    await tick(250);
    await neo.daysReady();
    assert.equal(await js('historyShown.player.day()'), want);
    assert.equal(await js('historyShown.player.h().day'), DAYS[want], 'that day loaded');
    assert.equal(await js('historyShown.player.pos()'), await js('historyShown.player.steps().length'), 'as it ended');
    assert.equal(await js('document.querySelector(".hs-tile[aria-selected=true]").dataset.day'), DAYS[want]);
  }
  key('Right');
  await tick(250);
  await neo.daysReady();
  assert.equal(await js('historyShown.player.day()'), 1);
  key('Enter');
  await neo.playerReady({ drawn: false });
  assert.equal(await js('historyShown.player.h().day'), DAYS[1]);
  await tick(300);
  assert.equal(await js('historyShown.player.playing()'), false, 'paused');
  key('Space');
  await tick(200);
  assert.equal(await js('historyShown.player.playing()'), true, 'Space plays');
  key('Space');
  await tick(100);
  assert.equal(await js('historyShown.player.playing()'), false);
  key('Escape');
  await tick(300);
  assert.equal(await js('historyShown.player.view()'), 'days');
  key('Escape');
  await tick(300);
  assert.equal(await js('!!historyShown'), false);
});

test('a click outside the dialog closes it', async () => {
  await neo.openHistory();
  await js(`(() => { const bd = document.querySelector('.page-sheet-backdrop'); bd.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); })()`);
  await tick(200);
  assert.equal(await js('!!historyShown'), false);
});

test('the player: ▶▶ plays at 8× and a second press goes back to as written; a long pause plays short with a badge', async () => {
  await atDayEnd(0);
  await js('historyShown.player.seek(0)');
  await js('document.querySelector(".hs-fast").click()');
  assert.deepEqual(await js('[historyShown.player.playing(), historyShown.player.speed(), document.querySelector(".hs-fast").getAttribute("aria-pressed")]'), [true, 8, 'true'], 'from a pause it plays fast, lit');
  await js('document.querySelector(".hs-fast").click()');
  assert.deepEqual(await js('[historyShown.player.playing(), historyShown.player.speed(), document.querySelector(".hs-fast").getAttribute("aria-pressed")]'), [true, 1, 'false'], 'pressed while fast: as written');
  await js('document.querySelector(".hs-play").click()');
  assert.equal(await js('historyShown.player.playing()'), false);
  // as written from the start: the pause typed on day one shows its length
  await js('historyShown.player.seek(0); document.querySelector(".hs-play").click()');
  let badge = '';
  for (const end = Date.now() + 30000; Date.now() < end && !badge; await tick(50)) {
    badge = await js('(() => { const b = document.querySelector(".hs-badge"); return !b.hidden && /^paused \\d+ s$/.test(b.textContent) ? b.textContent : ""; })()');
  }
  await js('historyShown.player.setPlaying(false)');
  assert.match(badge, /^paused [23] s$/, 'the badge says how long the pause was');
});

test('the player: the first day opens on the words written before recording; a chapter made that day opens as it was made; the play head stays within the day', async () => {
  await atDayEnd(0);
  await js('historyShown.player.seek(0)');
  assert.equal(await js('historyShown.player.pos()'), await js('historyShown.player.lead()'));
  const first = Object.values(await neo.playerHTML()).join('');
  assert.match(first, /One begins\./, 'the book as it was when recording began');
  assert.doesNotMatch(first, /Gulls cried/, 'before anything typed');
  // the chapter the second day split off, on that day: never "doesn't exist yet"
  await js(`historyShown.player.openPlayer(historyShown.player.days()[1].from, { ch: ${JSON.stringify(SPLIT)} })`);
  await neo.playerReady();
  assert.equal(await js('!!historyShown.player.paper.querySelector(".hs-empty")'), false);
  assert.ok((await neo.playerHTML())[SPLIT] !== undefined, 'the chapter on the sheet');
  await js('document.querySelector(".page-sheet-backdrop").focus()');
  key('Home');
  await tick(100);
  assert.equal(await js('historyShown.player.pos()'), await js('historyShown.player.lead()'), 'Home: its first moment');
  key('Left');
  await tick(100);
  assert.equal(await js('historyShown.player.pos()'), await js('historyShown.player.lead()'), '← goes no further back');
  key('End');
  await tick(100);
  assert.equal(await js('historyShown.player.pos()'), await js('historyShown.player.steps().length'), 'End: the last');
  key('Right');
  await tick(100);
  assert.equal(await js('historyShown.player.pos()'), await js('historyShown.player.steps().length'));
});

test('the timeline marks a paste from the book as moved text, and one from another program as pasted', async () => {
  await atDayEnd(0);
  const marks = await js('historyShown.player.markers().filter((m) => m.kind === "paste" || m.kind === "paste-in").map((m) => m.kind + ": " + m.label)');
  assert.deepEqual(marks, ['paste-in: Moved text (9 characters)', 'paste: Pasted from elsewhere (14 characters)']);
});

test('a paragraph picked: the buttons beside it, their tooltips, hidden while playing, shorter in a narrow window', async () => {
  await atDayEnd(0, ID.One);
  assert.ok(await pickOnSheet(ID.One, 'One begins'));
  await waitFor('!document.querySelector(".hs-part").hidden');
  assert.match(await js('document.querySelector(".hs-part-prev").title'), /^Earlier version: Back to how this read before it last changed/);
  assert.match(await js('document.querySelector(".hs-part-next").title'), /^Later version: On to how this reads after it next changes/);
  await js('historyShown.player.setPlaying(true)');
  assert.equal(await js('document.querySelector(".hs-part").hidden && document.querySelector(".hs-part-r").hidden'), true, 'hidden while it plays');
  await js('historyShown.player.setPlaying(false)');
  const [w, h] = neo.win.getSize();
  try {
    // a 1920-pixel screen: the margins hold words, the left pair one above the other
    neo.win.setSize(1904, h);
    await tick(600);
    await js('historyShown.player.seek(historyShown.player.pos())');
    await waitFor('!document.querySelector(".hs-part").hidden');
    const shown = await js(`(() => {
      const l = document.querySelector('.hs-part'), r = document.querySelector('.hs-part-r');
      const body = document.querySelector('.hs-paper .rp-body').getBoundingClientRect();
      return { prev: l.querySelector('.hs-part-prev').textContent, restore: l.querySelector('.hs-part-restore').textContent, next: r.textContent,
        stacked: l.classList.contains('hs-part-stack'), inMargins: l.getBoundingClientRect().right <= body.left && r.getBoundingClientRect().left >= body.right };
    })()`);
    assert.ok(/\p{L}/u.test(shown.prev) && /\p{L}/u.test(shown.restore) && /\p{L}/u.test(shown.next), 'in words: ' + JSON.stringify(shown));
    assert.ok(shown.inMargins, 'beside the text, not over it: ' + JSON.stringify(shown));
    neo.win.setSize(700, h);
    await tick(600);
    await js('historyShown.player.seek(historyShown.player.pos())');
    await waitFor('!document.querySelector(".hs-part").hidden');
    assert.equal(await js('document.querySelector(".hs-part-prev").textContent'), '‹', 'shorter where the margin is narrow');
    assert.equal(await js('document.querySelector(".hs-part-next").textContent'), '›');
  } finally {
    neo.win.setSize(w, h);
    await tick(400);
  }
  key('Escape');
  await tick(200);
  assert.equal(await js('historyShown.player.part()'), null);
});

test('search: Match case and Whole words change what is found, and stay while NEO is open', async () => {
  await neo.closeHistory();
  await neo.openHistory();
  const search = async (q) => {
    await js(`historyShown.player.runFind(${JSON.stringify(q)})`);
    await waitFor('!!historyShown.player.find() && historyShown.player.find().finished', 60000);
    return js('!!historyShown.player.find().findings.first');
  };
  const opt = (o) => js(`document.querySelector('.hs-opt[data-opt="${o}"]').getAttribute('aria-pressed')`);
  assert.deepEqual([await opt('cs'), await opt('word')], ['false', 'true'], 'any case, whole words to begin with');
  assert.equal(await search('gulls'), true, 'any case');
  assert.equal(await search('Gull'), false, 'whole words only');
  await js('document.querySelector(\'.hs-opt[data-opt="word"]\').click()');
  assert.equal(await search('Gull'), true, 'part of a word');
  await js('document.querySelector(\'.hs-opt[data-opt="cs"]\').click()');
  assert.equal(await search('gulls'), false, 'match case');
  assert.equal(await search('Gulls'), true);
  await neo.closeHistory();
  await neo.openHistory();
  assert.deepEqual([await opt('cs'), await opt('word')], ['true', 'false'], 'kept while NEO is open');
  await js('document.querySelector(\'.hs-opt[data-opt="cs"]\').click(); document.querySelector(\'.hs-opt[data-opt="word"]\').click()');
  await js('historyShown.player.runFind("")');
  await neo.closeHistory();
});

test('search: a finding picked brings its phrase into sight, where it was there before the recording began', async () => {
  // "Nine ends." is in chapter Nine's baseline, which is never edited: first found at the day's
  // start, nowhere near the caret, so the sheet doesn't follow it there by itself
  await neo.closeHistory();
  await neo.openHistory();
  const [w, h] = neo.win.getSize();
  try {
    // a phone's worth of sheet, and the test book's short chapters spread
    // out, so the phrase falls well below the fold
    neo.win.setSize(w, 360);
    await js(`(() => { const s = document.createElement('style'); s.id = 'e2e-tall'; s.textContent = '.hs-paper .rp-body p { margin-bottom: 600px; }'; document.head.appendChild(s); })()`);
    await tick(600);
    await js('historyShown.player.runFind("Nine ends")');
    await waitFor('!!historyShown.player.find() && historyShown.player.find().finished', 60000);
    const first = await js('historyShown.player.find().findings.first');
    assert.ok(first, 'found');
    await js(`historyShown.player.paper.parentElement.scrollTop = 0; historyShown.player.goFind('first', ${JSON.stringify(first)})`);
    await waitFor('!!CSS.highlights.get("neo-replay-find") && CSS.highlights.get("neo-replay-find").size > 0', 30000);
    await tick(400);
    const seen = await js(`(() => {
      const box = document.querySelector('.hs-scroll').getBoundingClientRect();
      return [...CSS.highlights.get('neo-replay-find')].map((r) => r.getBoundingClientRect()).some((r) => r.bottom > box.top && r.top < box.bottom);
    })()`);
    assert.ok(seen, 'the highlighted phrase is on screen');
  } finally {
    neo.win.setSize(w, h);
    await js(`document.getElementById('e2e-tall')?.remove()`);
    await tick(400);
    await js('historyShown && historyShown.player.runFind("")');
    await neo.closeHistory();
  }
});

test('a phone, upright or on its side: the side pane is a drawer that ☰ brings, and a pick, a tap beside it or Esc puts away', async () => {
  await neo.closeHistory();
  const [w, h] = neo.win.getSize();
  try {
    neo.win.setSize(600, h);
    await tick(600);
    await atDayEnd(0);
    const state = () => js(`(() => {
      const side = document.querySelector('.hs-side'), btn = document.querySelector('.hs-pane-btn');
      const r = side.getBoundingClientRect(), sheet = document.querySelector('.hs-scroll').getBoundingClientRect();
      return { btn: getComputedStyle(btn).display !== 'none', shown: getComputedStyle(side).visibility === 'visible' && r.right > sheet.left + 40,
        expanded: btn.getAttribute('aria-expanded') };
    })()`);
    await tick(300);
    assert.deepEqual(await state(), { btn: true, shown: false, expanded: 'false' }, 'put away to begin with');
    // the text as wide as the editor's page there, not the desktop's margins
    const wide = await js('document.querySelector(".hs-paper .rp-body").getBoundingClientRect().width / document.querySelector(".hs-scroll").getBoundingClientRect().width');
    assert.ok(wide > 0.8, 'the text takes most of the sheet: ' + wide.toFixed(2));
    // ☰ in the title bar, over none of the sheet; the footer's buttons in the drawer
    const placed = await js(`(() => {
      const btn = document.querySelector('.hs-pane-btn'), sheet = document.querySelector('.hs-scroll').getBoundingClientRect();
      return { inBar: !!btn.closest('.ps-bar'), clear: btn.getBoundingClientRect().bottom <= sheet.top,
        inDrawer: ['.hs-tag', '.hs-restore', '.hs-evidence', '.hs-delete'].every((s) => !!document.querySelector('.hs-side-acts ' + s)) };
    })()`);
    assert.deepEqual(placed, { inBar: true, clear: true, inDrawer: true });
    await js('document.querySelector(".hs-pane-btn").click()');
    await tick(400);
    const open = await state();
    assert.ok(open.shown && open.expanded === 'true', 'out over the sheet: ' + JSON.stringify(open));
    // a chapter picked: the drawer goes, the chapter is shown
    const was = await js('historyShown.player.mode()');
    await js('document.querySelector(".hs-list .hs-ch[role=option]:not([disabled]):not([aria-selected=true])").click()');
    await tick(400);
    assert.equal((await state()).shown, false, 'a pick puts it away');
    assert.notEqual(await js('historyShown.player.mode()'), was, 'and shows what was picked');
    // a tap beside it
    await js('document.querySelector(".hs-pane-btn").click()');
    await tick(400);
    await js('document.querySelector(".hs-scrim").click()');
    await tick(400);
    assert.equal((await state()).shown, false, 'a tap beside it puts it away');
    // Esc puts it away before it leaves the player
    await js('document.querySelector(".hs-pane-btn").click()');
    await tick(400);
    await js('document.querySelector(".page-sheet-backdrop").focus()');
    key('Escape');
    await tick(400);
    assert.equal((await state()).shown, false, 'Esc puts it away');
    assert.equal(await js('historyShown.player.view()'), 'player', 'and stays in the player');
    // ⌘F (Ctrl+F) brings it with the search field
    await js('historyShown.focusFind()');
    await tick(400);
    assert.ok((await state()).shown, 'Find brings it');
    assert.equal(await js('document.activeElement === document.querySelector(".hs-q")'), true);
  } finally {
    neo.win.setSize(w, h);
    await tick(400);
    await neo.closeHistory();
  }
  // a phone on its side: the drawer too, and the player's buttons beside its timeline
  // (NEO's window is never under 600 pixels tall on a computer: a phone's is)
  const [minW, minH] = neo.win.getMinimumSize();
  try {
    neo.win.setMinimumSize(300, 300);
    neo.win.setSize(800, 380);
    await tick(600);
    await atDayEnd(0);
    await tick(300);
    const side = await js(`(() => {
      const btn = document.querySelector('.hs-pane-btn'), c = document.querySelector('.hs-controls').getBoundingClientRect(), d = document.querySelector('.hs-dayline').getBoundingClientRect();
      return { btn: getComputedStyle(btn).display !== 'none', pane: getComputedStyle(document.querySelector('.hs-side')).visibility,
        inDrawer: !!document.querySelector('.hs-side-acts .hs-restore'), oneRow: Math.abs((c.top + c.bottom) / 2 - (d.top + d.bottom) / 2) < 12 };
    })()`);
    assert.deepEqual(side, { btn: true, pane: 'hidden', inDrawer: true, oneRow: true });
  } finally {
    neo.win.setMinimumSize(minW, minH);
    neo.win.setSize(w, h);
    await tick(400);
    await neo.closeHistory();
  }
  // wide again: no ☰, the pane where it always is, the buttons in the footer
  await neo.openHistory();
  await tick(300);
  assert.equal(await js('getComputedStyle(document.querySelector(".hs-pane-btn")).display'), 'none');
  assert.equal(await js('getComputedStyle(document.querySelector(".hs-side")).visibility'), 'visible');
  assert.equal(await js('[".hs-tag", ".hs-restore", ".hs-evidence", ".hs-delete"].every((s) => !!document.querySelector(".hs-foot " + s))'), true);
  await neo.closeHistory();
});

test('History closed and opened again rebuilds nothing', async () => {
  await neo.openHistory();
  await neo.closeHistory();
  const dir = path.join(neo.tmp, 'app', 'recording-cache', neo.book);
  const stamp = () => Object.fromEntries(fs.readdirSync(dir).filter((n) => n.startsWith('day')).map((n) => [n, fs.statSync(path.join(dir, n)).mtimeMs]));
  const before = stamp();
  assert.ok(before['days.json.gz'] && Object.keys(before).length >= 2, 'the days and a day cached: ' + Object.keys(before));
  await neo.openHistory();
  await atDayEnd(0);
  await neo.closeHistory();
  assert.deepEqual(stamp(), before);
});

test('one chapter picked: only the days that changed it have tiles', async () => {
  await neo.openHistory();
  const tiles = async (ch) => {
    await js(`historyShown.player.setMode(${JSON.stringify(ch)})`);
    await neo.daysReady();
    return js('[...document.querySelectorAll(".hs-strip .hs-tile[data-day]")].map((b) => b.dataset.day)');
  };
  assert.deepEqual(await tiles(ID.Four), [DAYS[0]]);
  assert.deepEqual(await tiles(ID.One), [DAYS[0], DAYS[1]]);
  assert.deepEqual(await tiles(SPLIT), [DAYS[1]]);
  assert.deepEqual(await tiles(ID.Five), [DAYS[0], DAYS[2]]);
  assert.deepEqual(await tiles('book'), DAYS);
  await neo.closeHistory();
});

test('the side pane lists the chapters there at the moment shown: joined, made a section, set on a card and deleted ones come and go', async () => {
  await neo.openHistory();
  await js('historyShown.player.setMode("book")');
  await neo.daysReady();
  const gone = ['Six', 'Eight', 'Nine', 'Ten'];
  const listedNames = async () => (await neo.listed()).map((x) => x.name).join(' | ');
  const has = (names, t) => new RegExp('\\b' + t + '\\b').test(names);
  let names = await listedNames();
  for (const t of gone) assert.ok(!has(names, t), t + ' isn’t listed on today’s tile: ' + names);
  // played through the day, each leaves the list when it goes
  await atDayEnd(2);
  const went = await js(`(() => {
    const p = historyShown.player;
    const h = p.h();
    const out = [];
    p.steps().forEach((i, j) => { const s = h.steps[i]; if (s.k === 'd' && !Rec.isStream(s.ch)) out.push({ j, ch: s.ch }); });
    return out;
  })()`);
  assert.deepEqual(went.map((x) => x.ch).sort(), gone.map((t) => ID[t]).sort(), 'four chapters went that day');
  for (const { j, ch } of went) {
    await js(`historyShown.player.seek(${j})`);
    const before = (await neo.listed()).length;
    await js(`historyShown.player.seek(${j + 1})`);
    assert.equal((await neo.listed()).length, before - 1, ch + ' leaves the list when it goes');
  }
  // the days before: all of them there, Nine too, though never edited
  for (const di of [1, 0]) {
    await atDayEnd(di);
    names = await listedNames();
    for (const t of gone) assert.ok(has(names, t), t + ` is listed on day ${di + 1}: ` + names);
  }
  await neo.closeHistory();
});

test('a chapter picked at a moment it isn’t there stays listed, dimmed, and the sheet says so', async () => {
  // Ten, played past the moment it was deleted
  await atDayEnd(2, ID.Ten);
  await js('historyShown.player.seek(historyShown.player.steps().length)');
  await tick(300);
  const listed = await neo.listed();
  assert.equal(listed.filter((x) => x.absent).length, 1, JSON.stringify(listed));
  assert.match(listed.find((x) => x.absent).name, /\bTen\b/);
  assert.ok(!listed.some((x) => !x.absent && /\b(Six|Eight|Nine)\b/.test(x.name)), 'the others listed are those there then');
  assert.equal(await js('(document.querySelector(".hs-paper .hs-empty") || {}).textContent'), 'This chapter isn’t in the book at this moment.', 'gone, not yet to come');
  // the chapter the second day split off, on the first day: not there yet
  await atDayEnd(0, SPLIT);
  assert.equal(await js('(document.querySelector(".hs-paper .hs-empty") || {}).textContent'), 'This chapter doesn’t exist yet at this moment.');
  await neo.closeHistory();
});

test('keyboard only: Tab reaches every control in the days and in the player, each visible as it has focus', async () => {
  const walk = async () => {
    await js('document.querySelector(".page-sheet-backdrop").focus()');
    const seen = [];
    for (let i = 0; i < 80; i++) {
      key('Tab');
      await tick(30);
      const out = await js(`(() => { const e = document.activeElement; return e && e !== document.body && !e.closest('.page-sheet-backdrop') ? (e.tagName + '.' + e.className).slice(0, 60) : ''; })()`);
      assert.equal(out, '', 'Tab took the focus out of History, behind it');
      const f = await js(`(() => { const e = document.activeElement; if (!e || !e.closest('.page-sheet-backdrop')) return null;
        const cs = getComputedStyle(e); return { cls: e.className.split(' ')[0], shows: e.offsetParent !== null && cs.visibility !== 'hidden' && +cs.opacity > 0 }; })()`);
      if (!f) continue;
      assert.ok(f.shows, f.cls + ' has focus but can’t be seen');
      if (!seen.includes(f.cls)) seen.push(f.cls);
    }
    return seen;
  };
  await neo.openHistory();
  const days = await walk();
  for (const c of ['hs-q', 'hs-opt', 'hs-ch', 'hs-tile', 'hs-tag', 'hs-evidence', 'hs-delete']) assert.ok(days.includes(c), c + ' in the days: ' + days);
  await atDayEnd(0);
  const player = await walk();
  for (const c of ['hs-back', 'hs-play', 'hs-fast', 'hs-timeline', 'hs-tile', 'hs-tag', 'hs-restore']) assert.ok(player.includes(c), c + ' in the player: ' + player);
  for (let i = 0; i < 5 && (await js('!!historyShown')); i++) { key('Escape'); await tick(250); }
  assert.equal(await js('!!historyShown'), false, 'Esc always gets out');
});

test('keyboard only: Tab and Shift+Tab stay inside every dialog, History’s and the book’s', async () => {
  const count = () => js('document.querySelectorAll(".modal-backdrop").length');
  // a dialog opened by `open`: Tab, then Shift+Tab, round and round it, never out; then Esc
  const walk = async (name, open) => {
    const was = await count();
    await js(`(() => { ${open} })(); undefined`);
    await waitFor(`document.querySelectorAll(".modal-backdrop").length > ${was}`);
    await tick(150);
    let stops = 0;
    for (const mods of [[], ['shift']]) {
      for (let i = 0; i < 25; i++) {
        key('Tab', mods);
        await tick(20);
        const at = await js('(() => { const d = topDialog(); const e = document.activeElement; return !d ? "no dialog" : e && d.contains(e) ? "" : (e ? (e.tagName + "." + e.className).slice(0, 60) : "nothing"); })()');
        assert.equal(at, '', `${name}: Tab${mods.length ? ' with Shift' : ''} left the dialog`);
        stops++;
      }
    }
    assert.ok(stops, name);
    for (let i = 0; i < 4 && (await count()) > was; i++) { key('Escape'); await tick(250); }
    assert.equal(await count(), was, name + ': Esc closes it');
  };
  await walk('a question with a text field', `askInput('Name it', 'a name')`);
  await walk('a confirmation', `confirmModal({ title: 'Sure?', points: ['One thing.', 'Another.'], ok: 'Yes' })`);
  await walk('a confirmation with a phrase to type', `confirmModal({ title: 'Sure?', points: ['Gone.'], ok: 'Delete', danger: true, phrase: 'delete it' })`);
  await walk('a choice', `optionModal('Which?', 'Pick one.', [{ label: 'This', value: 1 }, { label: 'That', value: 2 }])`);
  await walk('the keyboard shortcuts', `showHelp()`);
  await walk('Timestamp services…', `openTsaServices()`);
  // over History: its own dialogs, each the top one
  await neo.openHistory();
  await walk('How It Was Written…', `document.querySelector('.hs-evidence').click()`);
  await walk('Delete this book’s history… (over History)', `document.querySelector('.hs-delete').click()`);
  assert.equal(await js('!!historyShown'), true, 'History is still open beneath');
  await neo.closeHistory();
});

/* ---------- restore ---------- */

test('a chapter restored: History then shows the “Before restoring to …” tag in its list, on the day’s tile and on the timeline, with a Restored marker', async () => {
  const before = await chHTML(ID.One);
  await atDayEnd(0, ID.One);
  const then = await js(`historyShown.player.chapters()[${JSON.stringify(ID.One)}]`);
  assert.notEqual(then, before);
  await js('document.querySelector(".hs-restore").click()');
  await waitFor(`!historyShown && chapterHTML[${JSON.stringify(ID.One)}] === ${JSON.stringify(then)}`);
  await flush();
  await neo.openHistory();
  await js('historyShown.player.setMode("book")');
  await neo.daysReady();
  const tag = (await neo.tagItems()).find((n) => /^Before restoring to /.test(n));
  if (!tag) { await neo.closeHistory(); await js('structuralUndo()'); }
  assert.ok(tag, 'in Tags: ' + (await neo.tagItems()));
  assert.match(await js(`document.querySelector('.hs-tile[data-day="${DAYS[2]}"]').title`), /Tags: .*Before restoring to /);
  assert.equal(await js(`document.querySelector('.hs-tile[data-day="${DAYS[2]}"]').classList.contains('hs-tagged')`), true);
  try {
  await atDayEnd(2);
  const kinds = await js('historyShown.player.markers().map((m) => m.kind + ": " + m.label)');
  assert.ok(kinds.includes('tag: ' + tag), 'a flag on the timeline');
  assert.ok(kinds.includes('restore: Restored'), 'a Restored marker');
  // picked, the tag shows the chapter as it was before the restore
  await js(`[...document.querySelectorAll('.hs-tag-item')].find((b) => b.textContent.startsWith(${JSON.stringify(tag)})).click()`);
  await waitFor(`historyShown.player.chapters()[${JSON.stringify(ID.One)}] === ${JSON.stringify(before)}`);
  } finally {
    await neo.closeHistory();
    await js('structuralUndo()');
    await tick(300);
  }
  assert.equal(await chHTML(ID.One), before);
});

test('a restore can be undone from History while the chapter is as it left it; once written in, it can’t', async () => {
  const before = await chHTML(ID.One);
  const restoreTo = async () => {
    await atDayEnd(0, ID.One);
    const then = await js(`historyShown.player.chapters()[${JSON.stringify(ID.One)}]`);
    await js('document.querySelector(".hs-restore").click()');
    await waitFor(`!historyShown && chapterHTML[${JSON.stringify(ID.One)}] === ${JSON.stringify(then)}`);
  };
  const atEnd = async () => {
    await neo.openHistory();
    const last = await js('historyShown.player.days().length - 1');
    await atDayEnd(last, ID.One);
    await waitFor('!document.querySelector(".hs-restore").hidden');
    return js('document.querySelector(".hs-restore").textContent');
  };
  try {
    await restoreTo();
    // the book's last change: History says so above the sheet as it opens,
    // and the footer's button at that moment is Undo This Restore too
    assert.equal(await atEnd(), 'Undo This Restore');
    await waitFor('!document.querySelector(".hs-undo-bar").hidden', 30000);
    assert.match(await js('document.querySelector(".hs-undo-said").textContent'), /^Your last change was restoring Chapter 1./);
    await js('document.querySelector(".hs-undo-last").click()');
    await waitFor(`!historyShown && chapterHTML[${JSON.stringify(ID.One)}] === ${JSON.stringify(before)}`);
    await flush();
    // restored again, then written in: nothing to undo from here
    await restoreTo();
    await caretAt(await idx('One'), 0, -1);
    await type(' Written after.');
    await flush();
    assert.equal(await atEnd(), 'Same as now');
    await tick(1500);
    assert.equal(await js('document.querySelector(".hs-undo-bar").hidden'), true, 'no bar once it was written in');
    const tag = (await neo.tagItems()).filter((n) => /^Before restoring to /.test(n)).pop();
    await js(`[...document.querySelectorAll('.hs-tag-item')].reverse().find((b) => b.textContent.startsWith(${JSON.stringify(tag)})).click()`);
    await waitFor(`historyShown.player.chapters()[${JSON.stringify(ID.One)}] === ${JSON.stringify(before)}`);
    assert.equal(await js('document.querySelector(".hs-restore").textContent'), 'Restore This Chapter', 'an ordinary restore from the moment before');
  } finally {
    await neo.closeHistory();
    for (let i = 0; i < 4 && (await chHTML(ID.One)) !== before; i++) { await js('structuralUndo()'); await tick(300); }
  }
  assert.equal(await chHTML(ID.One), before);
});

test('with recording off, the restore’s toast says the text it replaced is in a snapshot', async () => {
  const before = await chHTML(ID.One);
  await js('setHistoryLevel("off")');
  await tick(300);
  try {
    await atDayEnd(0, ID.One);
    await js('document.querySelector(".hs-restore").click()');
    await waitFor(`!historyShown && chapterHTML[${JSON.stringify(ID.One)}] !== ${JSON.stringify(before)}`);
    await tick(300);
    assert.match(await neo.toastText(), /snapshot/i);
    await js('structuralUndo()');
    await tick(300);
    assert.equal(await chHTML(ID.One), before);
  } finally {
    await js('setHistoryLevel("record")');
    await tick(500);
  }
});

test('restore from the days: ← to an earlier day restores the chapter as that day ended', async () => {
  const before = await chHTML(ID.One);
  await neo.openHistory();
  await js(`historyShown.player.setMode(${JSON.stringify(ID.One)})`);
  await neo.daysReady();
  while ((await js('historyShown.player.day()')) > 0) { key('Left'); await tick(250); await neo.daysReady(); }
  const then = await js(`historyShown.player.chapters()[${JSON.stringify(ID.One)}]`);
  assert.match(then, /Gulls cried\. Again\./);
  await waitFor('!document.querySelector(".hs-restore").hidden');
  assert.equal(await js('document.querySelector(".hs-restore").textContent'), 'Restore This Chapter');
  await js('document.querySelector(".hs-restore").click()');
  await waitFor(`!historyShown && chapterHTML[${JSON.stringify(ID.One)}] === ${JSON.stringify(then)}`);
  // undone by the toast's own Undo, as on a phone with no keyboard
  await waitFor('!$("#hint").hidden && !!$("#hint .hint-act")');
  assert.equal(await js('$("#hint .hint-act").textContent'), 'Undo');
  await js('$("#hint .hint-act").click()');
  await tick(300);
  assert.equal(await chHTML(ID.One), before);
  assert.equal(await js('$("#hint").hidden'), true, 'the toast goes with it');
});

test('in the whole book, the restore goes to the picked paragraph’s chapter; the chapter as it is now says Same as now', async () => {
  await atDayEnd(0);
  assert.ok(await pickOnSheet(ID.Three, 'Three goes on'));
  await waitFor('!document.querySelector(".hs-restore").hidden');
  assert.ok((await js('document.querySelector(".hs-restore").title')).startsWith((await name(ID.Three)) + ':'), 'named in the tooltip');
  // two paragraphs picked: their own button says so; the footer's still restores the chapter
  assert.ok(await pickOnSheet(ID.Three, 'Three begins', 'Three goes on'));
  await waitFor('document.querySelector(".hs-part-restore").getAttribute("aria-label") === "Restore Paragraphs"');
  assert.equal(await js('document.querySelector(".hs-restore").textContent'), 'Restore This Chapter');
  await neo.closeHistory();
  // the chapter as it is now
  await neo.openHistory();
  await js(`historyShown.player.setMode(${JSON.stringify(ID.Five)})`);
  await neo.daysReady();
  await waitFor('!document.querySelector(".hs-restore").hidden');
  assert.equal(await js('document.querySelector(".hs-restore").textContent'), 'Same as now');
  assert.equal(await js('document.querySelector(".hs-restore").disabled'), true);
  await neo.closeHistory();
});

test('a paragraph edited and moved within its chapter since is found by its words, and restored in its new place', async () => {
  const before = await chHTML(ID.Three);
  await atDayEnd(0, ID.Three);
  assert.ok(await pickOnSheet(ID.Three, 'Three ends'));
  await waitFor('!document.querySelector(".hs-part").hidden');
  await js('document.querySelector(".hs-part-restore").click()');
  await waitFor(`!historyShown && chapterHTML[${JSON.stringify(ID.Three)}] !== ${JSON.stringify(before)}`, 30000);
  try {
    assert.deepEqual(texts(await chHTML(ID.Three)), ['Three ends.', 'Three begins.', 'Three goes on. Later on.', 'Two begins. Yes.']);
  } finally {
    await js('structuralUndo()');
    await tick(300);
  }
  assert.equal(await chHTML(ID.Three), before);
});

test('a paragraph taken out since: History says when, and Add to Darlings, and copy keeps it', async () => {
  const darlings = await js('darlings.length');
  await atDayEnd(0, ID.Seven);
  assert.ok(await pickOnSheet(ID.Seven, 'Seven goes on'));
  await waitFor('!document.querySelector(".hs-part").hidden');
  await clipWatch();
  await js('document.querySelector(".hs-part-restore").click()');
  const shown = await optionShown();
  assert.equal(shown.title, `This paragraph isn’t in ${await name(ID.Seven)} any more`);
  assert.match(shown.text, /^They were taken out on .+, and NEO can’t find them anywhere else in the book\./);
  await js('document.body.lastElementChild.querySelectorAll(".fr-choice")[1].click()');
  await waitFor(`darlings.length === ${darlings + 1} && !!window.__clip`);
  assert.match(await js('darlings[darlings.length - 1].html + darlings[0].html'), /Seven goes on\./);
  assert.match(await js('window.__clip.text'), /Seven goes on\./);
  await neo.closeHistory();
  await js(`darlings = darlings.filter((d) => !/Seven goes on/.test(d.html)); window.neo.writeJSON(book.id, 'darlings', darlings)`);
});

test('a paragraph moved to another chapter since: History names the chapter it seems to be in', async () => {
  await atDayEnd(0, ID.Two);
  assert.ok(await pickOnSheet(ID.Two, 'Two begins'));
  await waitFor('!document.querySelector(".hs-part").hidden');
  await js('document.querySelector(".hs-part-restore").click()');
  const shown = await optionShown();
  assert.equal(shown.title, `This paragraph isn’t in ${await name(ID.Two)} any more`);
  assert.ok(shown.text.startsWith(`They seem to be in ${await name(ID.Three)} now`), shown.text);
  await js('document.body.lastElementChild.querySelector(".modal-backdrop .m-cancel, .m-cancel") ? document.body.lastElementChild.querySelector(".m-cancel").click() : null');
  key('Escape');
  await tick(300);
  await neo.closeHistory();
});

test('restore from History opened on the shelf asks once to open the book, then opens and restores it', async () => {
  const before = await chHTML(ID.One);
  await js('backToShelf()');
  await tick(800);
  await neo.openHistory({ bookId: neo.book });
  await js(`historyShown.player.openPlayer(historyShown.player.days()[0].to - 1, { at: 'end', ch: ${JSON.stringify(ID.One)} })`);
  await neo.playerReady({ drawn: false });
  const then = await js(`historyShown.player.chapters()[${JSON.stringify(ID.One)}]`);
  await js('document.querySelector(".hs-restore").click()');
  await waitFor('!!document.querySelector(".confirm-modal")');
  assert.equal(await js('document.querySelector(".confirm-modal h2").textContent'), 'Open “Harbor” to restore it?');
  await js('document.querySelector(".confirm-modal .m-ok").click()');
  await waitFor(`!!book && book.id === ${JSON.stringify(neo.book)} && !document.getElementById('editor-view').hidden && chapterHTML[${JSON.stringify(ID.One)}] === ${JSON.stringify(then)}`, 15000);
  await tick(300);
  await js('structuralUndo()');
  await tick(300);
  assert.equal(await chHTML(ID.One), before);
});

test('Delete this book’s history…: Cancel, Esc and a click outside each change nothing', async () => {
  const rec = path.join(neo.LIB, neo.book, 'recording');
  for (const how of ['cancel', 'escape', 'outside']) {
    await neo.openHistory();
    await js('document.querySelector(".hs-delete").click()');
    await waitFor('!!document.querySelector(".confirm-modal")');
    assert.match(await js('document.querySelector(".confirm-modal").textContent'), /Its \d+ tags go with it\./);
    if (how === 'cancel') await js('document.querySelector(".confirm-modal .m-cancel").click()');
    else if (how === 'escape') key('Escape');
    else await js(`(() => { const m = document.querySelector('.confirm-modal'); const bd = m.closest('.modal-backdrop') || m.parentElement; bd.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); bd.dispatchEvent(new MouseEvent('click', { bubbles: true })); })()`);
    await waitFor('!document.querySelector(".confirm-modal")');
    assert.ok(fs.existsSync(rec), how + ': the history is there');
    assert.equal(await js('!!historyShown'), true, how + ': History stays open');
    await neo.closeHistory();
  }
});

/* ---------- tags ---------- */

test('Tag This Moment… (Ctrl+S in History): a toast, newest first in Tags, a flag on the timeline and on the day’s tile', async () => {
  await atDayEnd(0);
  await js('historyShown.player.seek(Math.floor(historyShown.player.steps().length / 2))');
  await js('document.querySelector(".page-sheet-backdrop").focus()');
  key('s', [neo.CTRL]);
  await neo.answerInput('Draft 2');
  await waitFor('/Tagged “Draft 2”/.test($("#hint").textContent)');
  const byMoment = await js('historyShown.player.tags().slice().reverse().map((x) => x.label)');
  assert.ok((await neo.tagItems()).includes('Draft 2'));
  assert.equal((await neo.tagItems()).indexOf('Draft 2'), byMoment.indexOf('Draft 2'), 'newest moment first');
  assert.ok((await js('historyShown.player.markers().filter((m) => m.kind === "tag").map((m) => m.label)')).includes('Draft 2'));
  key('Escape');
  await tick(300);
  assert.match(await js(`document.querySelector('.hs-tile[data-day="${DAYS[0]}"]').title`), /Tags: .*Draft 2/);
  await neo.closeHistory();
});

test('a moment tagged in the days is the day’s end', async () => {
  await neo.openHistory();
  await js('historyShown.player.setMode("book")');
  await neo.daysReady();
  const end = await js('(() => { const p = historyShown.player; const h = p.h(); const s = h.steps[p.steps()[p.steps().length - 1]]; return [h.sessions[s.session].id, s.line]; })()');
  key('s', [neo.CTRL]);
  await neo.answerInput('Day end');
  const tg = await lastTag();
  assert.equal(tg[3], 'Day end');
  assert.deepEqual(tg[4].slice(0, 2), end);
  await neo.closeHistory();
});

test('a tag renamed and one removed from its right-click menu; both stick', async () => {
  await neo.openHistory();
  assert.ok(await neo.tagMenu('Draft 2', 'rename'));
  await neo.answerInput('Draft 2b');
  await waitFor('[...document.querySelectorAll(".hs-tag-item .hs-ch-name")].some((x) => x.textContent === "Draft 2b")');
  assert.ok(await neo.tagMenu('Day end', 'remove'));
  await waitFor('/The tag is gone\\. The moment itself is still in Writing History\\./.test($("#hint").textContent)');
  await neo.closeHistory();
  await flush();
  await neo.openHistory();
  const items = await neo.tagItems();
  assert.ok(items.includes('Draft 2b') && !items.includes('Draft 2') && !items.includes('Day end'), JSON.stringify(items));
  // search finds it by name, first
  await js('historyShown.player.runFind("draft")');
  await waitFor('!!document.querySelector(".hs-results .hs-ch-name")');
  assert.equal(await js('document.querySelector(".hs-results .hs-ch-name").textContent'), 'Tag · Draft 2b');
  await js('historyShown.player.runFind("")');
  await neo.closeHistory();
});

test('a snapshot’s tag can be named, Watch from Here opens it, and removing it leaves the snapshot', async () => {
  await caretAt(await idx('Five'), 0, -1);
  await type(' Snap.');
  await tick(900);
  const before = (await neo.snapList()).map((s) => s.name);
  key('s', [neo.CTRL]);
  await waitFor(`window.neo.snapshotList(book.id).then((l) => l.length > ${before.length})`);
  const snap = (await neo.snapList()).find((s) => !before.includes(s.name));
  await flush();
  await neo.openHistory();
  await waitFor('[...document.querySelectorAll(".hs-tag-item .hs-ch-name")].some((x) => x.textContent === "Snapshot · Taken by you")');
  assert.ok(await neo.tagMenu('Snapshot · Taken by you', 'rename'));
  assert.equal(await js('window.__menu.find((i) => /^(Name|Rename)…$/.test(i.label)).label'), 'Name…', 'a snapshot’s tag has no name of its own yet');
  await neo.answerInput('Agent copy');
  await waitFor('[...document.querySelectorAll(".hs-tag-item .hs-ch-name")].some((x) => x.textContent === "Agent copy")');
  await neo.closeHistory();
  // Watch from Here: History at the snapshot's tag
  await js(`snapWatch(${JSON.stringify({ name: snap.name, at: snap.at })})`);
  await neo.playerReady({ drawn: false });
  assert.equal(await js('historyShown.player.h().day'), DAYS[2]);
  const at = await js(`(() => { const p = historyShown.player; const h = p.h(); const tg = p.tags().find((x) => x.made && x.made.snapshot === ${JSON.stringify(snap.name)}); const n = Rec.momentStep(h, tg.at); return { n, step: p.steps()[p.pos() - 1] }; })()`);
  assert.ok(at.n >= 0 && at.step <= at.n, 'at the tag’s moment: ' + JSON.stringify(at));
  assert.ok(await neo.tagMenu('Agent copy', 'remove'));
  await waitFor('/The snapshot itself is still on the Darlings tab\\./.test($("#hint").textContent)');
  assert.ok((await neo.snapList()).some((s) => s.name === snap.name), 'the snapshot is still there');
  await neo.closeHistory();
});

test('Tag This Moment… is dimmed, and says why, with recording off and with the book not open', async () => {
  await js('setHistoryLevel("off")');
  await tick(300);
  try {
    await neo.openHistory();
    await waitFor('!document.querySelector(".hs-tag").hidden');
    assert.equal(await js('document.querySelector(".hs-tag").classList.contains("hs-off")'), true);
    assert.equal(await js('document.querySelector(".hs-tag").title'), 'Turn on File → Record Writing History to tag moments.');
    key('s', [neo.CTRL]);
    await tick(400);
    assert.equal(await js(`[...document.querySelectorAll('.modal-backdrop')].some((b) => !b.classList.contains('page-sheet-backdrop') && b.querySelector('input') && !b.hidden && getComputedStyle(b).display !== 'none')`), false, 'nothing asked');
    assert.equal(await neo.toastText(), 'Turn on File → Record Writing History to tag moments.');
    await neo.closeHistory();
  } finally {
    await js('setHistoryLevel("record")');
    await tick(500);
  }
  await js('backToShelf()');
  await tick(800);
  await neo.openHistory({ bookId: neo.book });
  await waitFor('!document.querySelector(".hs-tag").hidden');
  assert.equal(await js('document.querySelector(".hs-tag").title'), 'Open this book to tag its moments.');
  await neo.closeHistory();
  await js(`openBook(${JSON.stringify(neo.book)})`);
  await tick(800);
});

test('History’s footer has no Snapshots button', async () => {
  await neo.openHistory();
  const foot = await js('[...document.querySelectorAll(".hs-foot button")].map((b) => b.textContent)');
  assert.ok(!foot.some((x) => /Snapshots/.test(x)), JSON.stringify(foot));
  await neo.closeHistory();
});

test('the writer’s day: with the day ending at 4am, 1am and 3am are the day before and 5am the next; its first change takes one start-of-day snapshot', async () => {
  const days = await js(`(() => {
    const was = library.dayEndsAt;
    library.dayEndsAt = 4;
    const real = window.__realDay || writingDay;
    const at = (h) => real(new Date(2026, 0, 2, h));
    const out = [at(1), at(3), at(5)];
    library.dayEndsAt = was;
    return out;
  })()`);
  assert.deepEqual(days, ['2026-01-01', '2026-01-01', '2026-01-02']);
  // a new writer's day: one 'd' snapshot at its first change, none at the next
  const dsnaps = async () => (await neo.snapList()).filter((s) => /Z-d-/.test(s.name)).length;
  await caretAt(await idx('Five'), 0, -1);
  await type(' Saved.');
  await tick(1200); // saved: the next day starts from this
  const was = await dsnaps();
  await neo.dayAhead(1);
  await caretAt(await idx('Five'), 0, -1);
  await type(' Fourth.');
  await waitFor(`window.neo.snapshotList(book.id).then((l) => l.filter((s) => /Z-d-/.test(s.name)).length === ${was + 1})`);
  await type(' Still.');
  await tick(1200);
  assert.equal(await dsnaps(), was + 1);
});

/* ---------- what the dialog says ---------- */

test('a day’s timeline names its split, its joins, its delete and its card', async () => {
  const labels = async (di) => {
    await atDayEnd(di);
    return js('historyShown.player.markers().map((m) => m.label)');
  };
  assert.ok((await labels(1)).includes('Chapter split'), 'day two: the split');
  const three = await labels(2);
  for (const l of ['Chapters joined', 'Chapter deleted', 'Moved in the Outline']) assert.ok(three.includes(l), 'day three: ' + l + ' in ' + three.join(', '));
  await neo.closeHistory();
});

test('How It Was Written…’s chapter table says what took each chapter no longer in the book', async () => {
  await neo.openHistory();
  await js('document.querySelector(".hs-evidence").click()');
  await waitFor('!!document.querySelector(".ev-chapters")', 60000);
  const rows = await js(`[...document.querySelectorAll('.ev-chapters tr[data-ch]')].map((tr) => [tr.dataset.ch, tr.firstElementChild.textContent])`);
  const label = (title) => (rows.find(([ch]) => ch === ID[title]) || [])[1] || '';
  assert.match(label('Eight'), /\(joined to another chapter\)$/);
  assert.match(label('Six'), /\(joined to another chapter\)$/);
  assert.match(label('Nine'), /\(moved to a loose card\)$/);
  assert.match(label('Ten'), /\(deleted\)$/);
  key('Escape');
  await tick(200);
  await neo.closeHistory();
});

test('a search stopped while it looks inside the days: what it found says “perhaps earlier” and “perhaps later”', async () => {
  await neo.openHistory();
  // (the worker answers at once from the days it can see; what it finds
  // inside them comes later, as news: held back here, as on a long history)
  const r = await js(`(async () => {
    const held = [...historyListeners];
    historyListeners.clear();
    try {
      historyShown.player.runFind('begins');
      for (let i = 0; i < 300 && !document.querySelector('.hs-find-stop'); i++) await new Promise((res) => setTimeout(res, 20));
      const stop = document.querySelector('.hs-find-stop');
      if (!stop) return null;
      stop.click();
      await new Promise((res) => setTimeout(res, 200));
      return [...document.querySelectorAll('.hs-hit .hs-ch-when')].map((x) => x.textContent);
    } finally { for (const f of held) historyListeners.add(f); }
  })()`);
  assert.ok(r, 'a Stop button while it looks inside the days');
  assert.ok(r.some((x) => / · perhaps earlier$/.test(x)), JSON.stringify(r));
  assert.ok(r.some((x) => / · perhaps later$/.test(x)), JSON.stringify(r));
  await neo.closeHistory();
});

test('History says what it is plainly, in English and French: the tab’s tooltip, the shelf menu, an empty history; no “replay” or “recording” as a noun', async () => {
  const words = async () => js(`({
    tab: document.querySelector('.history-btn').title,
    dialog: (() => { const d = document.querySelector('.page-sheet-backdrop'); return d ? d.textContent : ''; })()
  })`);
  await neo.openHistory();
  const w = await words();
  assert.equal(w.tab, 'Watch this book being written');
  assert.doesNotMatch(w.dialog, /\breplay|\ba recording\b|\bthe recording\b/i);
  await neo.closeHistory();
  // an empty history
  await js(`addImportedBooks([{ name: 'Fresh', chapters: [{ title: 'Only', paras: [{ text: 'Nothing typed.' }] }] }], library.shelves[0])`);
  await tick(400);
  const fresh = await js('library.shelves[0].bookIds[library.shelves[0].bookIds.length - 1]');
  await js(`openHistory({ bookId: ${JSON.stringify(fresh)} })`);
  await waitFor('!!historyShown');
  await waitFor('/Nothing recorded yet\\. Write in this book and its history shows here\\./.test(document.querySelector(".page-sheet-backdrop").textContent)', 30000);
  await neo.closeHistory();
  // in French
  const fr = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'locales', 'fr.json'), 'utf8'));
  for (const s of ['Watch this book being written', 'Writing History…', 'Nothing recorded yet. Write in this book and its history shows here.']) assert.ok(fr[s] && fr[s] !== s, 'French for ' + s);
});

test('History has no level setting of its own', async () => {
  await neo.openHistory();
  const text = await js('document.querySelector(".page-sheet-backdrop").textContent');
  assert.doesNotMatch(text, /Record only|Record and timestamp|Record Writing History/i);
  assert.equal(await js('document.querySelectorAll(".page-sheet-backdrop .fr-choice, .page-sheet-backdrop select").length'), 0);
  await neo.closeHistory();
});

test('in French, Delete history waits for the French phrase', async () => {
  const fr = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'locales', 'fr.json'), 'utf8'));
  const phrase = fr['delete history'];
  assert.ok(phrase && phrase !== 'delete history');
  await js(`NeoI18n.setLocale('fr', ${JSON.stringify(fr)}, {})`);
  try {
    await neo.openHistory();
    await js('document.querySelector(".hs-delete").click()');
    await waitFor('!!document.querySelector(".confirm-modal input")');
    const typeIt = (s) => js(`(() => { const i = document.querySelector('.confirm-modal input'); i.value = ${JSON.stringify(s)}; i.dispatchEvent(new Event('input')); return document.querySelector('.confirm-modal .m-ok').disabled; })()`);
    assert.equal(await typeIt('delete history'), true, 'not the English phrase');
    assert.equal(await typeIt(phrase.toUpperCase()), false, 'the French, any case');
    await js('document.querySelector(".confirm-modal .m-cancel").click()');
    await tick(200);
    await neo.closeHistory();
  } finally { await js(`NeoI18n.setLocale('en', {}, {})`); }
});

test('the Darlings tab: Watch from Here in a snapshot’s band and its right-click menu while the book has a history; with no snapshots the hint mentions Writing History', async () => {
  await js('switchTab("darlings")');
  await tick(500);
  await waitFor('document.querySelectorAll("#snap-list .snap-k, #snap-list .snap-a, .snap-list .snap-k, .snap-list .snap-a").length > 0 || true');
  const snaps = await neo.snapList();
  assert.ok(snaps.length, 'snapshots to show');
  await js(`showSnapshot(${JSON.stringify(snaps[snaps.length - 1].name)})`);
  await waitFor('!!document.querySelector(".snap-band .snap-watch") && !document.querySelector(".snap-band .snap-watch").hidden', 10000);
  const menu = await js(`(async () => {
    const real = popMenu;
    let items = null;
    popMenu = async (x, y, list) => { popMenu = real; items = list.map((i) => ({ label: i.label, disabled: !!i.disabled })); return null; };
    const b = document.querySelector('.snap-k, .snap-a');
    b.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }));
    for (let i = 0; i < 50 && !items; i++) await new Promise((r) => setTimeout(r, 20));
    return items;
  })()`);
  assert.deepEqual(menu, [{ label: 'Show This Snapshot', disabled: false }, { label: 'Watch from Here', disabled: false }]);
  await js('showDarlingsAgain()');
  // a book with no snapshots
  await js(`addImportedBooks([{ name: 'No Snaps', chapters: [{ title: 'Only', paras: [{ text: 'Still.' }] }] }], library.shelves[0])`);
  await tick(400);
  const other = await js('library.shelves[0].bookIds[library.shelves[0].bookIds.length - 1]');
  await js(`openBook(${JSON.stringify(other)})`);
  await waitFor(`!!book && book.id === ${JSON.stringify(other)}`);
  await tick(400);
  await js('switchTab("darlings")');
  await waitFor('!!document.querySelector(".snap-empty")', 10000);
  assert.match(await js('document.querySelector(".snap-empty").textContent'), /Writing History keeps every moment in between, and shows your snapshots there as tags\./);
  await js('switchTab("manuscript")');
  await js(`openBook(${JSON.stringify(neo.book)})`);
  await waitFor(`!!book && book.id === ${JSON.stringify(neo.book)} && rec.on`);
  await tick(400);
});

// In a language with long words, the dialog's buttons and labels, at the
// window's smallest: nothing overlaps, nothing runs out of its box
for (const lang of ['de', 'ro', 'ru']) {
  test(`in ${lang}, at the smallest window, History’s controls, footer, tags and restore don’t overlap`, async () => {
    const dict = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'locales', lang + '.json'), 'utf8'));
    await js(`NeoI18n.setLocale(${JSON.stringify(lang)}, ${JSON.stringify(dict)}, {})`);
    const was = neo.win.getSize();
    const [mw, mh] = neo.win.getMinimumSize();
    neo.win.setSize(mw, mh);
    await tick(500);
    try {
      await atDayEnd(2, ID.Three);
      await tick(500);
      const bad = await js(`(() => {
        const out = [];
        for (const sel of ['.hs-foot', '.hs-controls', '.hs-side']) {
          const box = document.querySelector(sel);
          if (!box) continue;
          const kids = [...box.querySelectorAll('button, .hs-when, .hs-stamped, .hs-ch-name')].filter((x) => !x.hidden && x.getClientRects().length && getComputedStyle(x).visibility !== 'hidden');
          const rs = kids.map((x) => [x, x.getBoundingClientRect()]);
          for (let i = 0; i < rs.length; i++) {
            const [a, ra] = rs[i];
            if (a.scrollWidth > a.clientWidth + 2 && getComputedStyle(a).textOverflow !== 'ellipsis' && getComputedStyle(a).overflow !== 'hidden') out.push(sel + ': ' + a.className + ' runs out of its box: ' + a.textContent);
            for (let j = i + 1; j < rs.length; j++) {
              const [b, rb] = rs[j];
              if (a.contains(b) || b.contains(a)) continue;
              if (ra.left < rb.right - 1 && rb.left < ra.right - 1 && ra.top < rb.bottom - 1 && rb.top < ra.bottom - 1) out.push(sel + ': ' + a.className + ' overlaps ' + b.className);
            }
          }
        }
        return out;
      })()`);
      assert.deepEqual(bad, []);
    } finally {
      await neo.closeHistory();
      neo.win.setSize(was[0], was[1]);
      await js(`NeoI18n.setLocale('en', {}, {})`);
      await tick(300);
    }
  });
}

/* ---------- the book the tests start from ---------- */

neo.run(async () => {
  await js(`(async () => {
    await addImportedBooks([{ name: 'Harbor', chapters: ${JSON.stringify(TITLES)}.map((title) => ({
      title, paras: [title + ' begins.', title + ' goes on.', title + ' ends.'].map((text) => ({ text }))
    })) }], library.shelves[0]);
    const ids = library.shelves[0].bookIds;
    rec.strict = true;
    await openBook(ids[ids.length - 1]);
  })()`);
  neo.book = await js('book.id');
  const order = await neo.chapterIds();
  for (const id of order) {
    const title = await js(`book.chapterTitles[${JSON.stringify(id)}]`);
    ID[title] = id;
  }
  assert.deepEqual(Object.keys(ID), TITLES);
  await tick(300);
});
