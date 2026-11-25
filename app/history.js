'use strict';

/* ================================================================== */
/*  WRITING HISTORY — the dialog and its player                        */
/*  The recording played back: the book, or                            */
/*  one chapter, on sheets set like the manuscript, the text and the   */
/*  caret looking just as they did in the editor, and a timeline of    */
/*  how busy the writing was, marked where text was                    */
/*  pasted, came from another device, or changed while nothing was     */
/*  recording, and where the writer was away. It changes the book only */
/*  when asked to restore (historyRestore) or to delete the history.   */
/*  The steps and keyframes are recording.js's                         */
/*  History, a day at a time, every device's sessions on one page      */
/*  (Rec.Page), from the day states history-worker.js caches.          */
/*  Ways in: History in the footer, File → Writing History…, a book's  */
/*  menu on the shelf, and a chapter's right-click menu. The sheets    */
/*  are .rp-chapter / .rp-body, never .chapter / .chapter-body, so     */
/*  nothing that looks after the manuscript mistakes them for it.      */
/* ================================================================== */

const HISTORY_FAST = 8;       // ▶▶ plays this many times as fast as it was written
const HISTORY_SKIP = 1500;    // a pause longer than this plays this long (▶▶ skips it), and a badge says how long it was
const HISTORY_INK = { added: '#8fc98a', deleted: '#d9776b', edited: '#c9a86a' };
const historyPrefs = { speed: 1, skip: true }; // the speed is kept while NEO runs
const historyCanOpen = () => !!(Rec && window.neo.recList && window.neo.recRead && window.neo.recDays && window.neo.recDayStart);
// With Writing History off, every way into it is hidden (History in the
// footer, the menus, the shelf's, Export's, Watch from Here), as a feature's
// would be: an empty History would look like a bug. Turned on again, what was
// recorded before is there as it was.
const historyShows = () => historyCanOpen() && historyLevel() !== 'off';
let historyShowsWas = null;
function paintHistoryShows() {
  const on = historyShows();
  const b = $('.tab.history-btn');
  if (b) b.hidden = !on;
  // the menus follow (main.js reads the level from library.json)
  if (historyShowsWas !== null && historyShowsWas !== on && window.neo.recState) window.neo.recState();
  historyShowsWas = on;
}
let historyShown = null; // the open dialog's close()
let historyFindSeq = 0;  // each search's number, so the worker's news reaches the search it's for
const historyFindOpts = { word: true, cs: false }; // whole words, any case: kept while NEO is open

// what made a change, as the timeline's markers say it
const HISTORY_CAUSES = {
  split: tk('Chapter split'), merge: tk('Chapters joined'), new: tk('New chapter'), delete: tk('Chapter deleted'),
  'darling-out': tk('Sent to Darlings'), 'darling-in': tk('Back from Darlings'), 'darling-delete': tk('Sent to Darlings'),
  'replace-all': tk('Replace All'), 'undo-structural': tk('Undone'), snapshot: tk('Snapshot restored'), outline: tk('Moved in the Outline'),
  'disk-adopt': tk('From another device'), 'disk-twin': tk('From another device, kept beside this one'), 'disk-new': tk('From another device'),
  'catch-up': tk('Changed while NEO wasn’t recording'), restore: tk('Restored'), unobserved: tk('A change the recorder didn’t see'),
  anchor: tk('Kept whole again'), import: tk('Chapters imported')
};
const HISTORY_SYNC = ['disk-adopt', 'disk-twin', 'disk-new'];
// the book's other writing, as a day names it
function historyStreamName(id) {
  const S = Rec.STREAMS;
  return recIsNotes(id) ? tabName('notes') : id === S.outline ? tabName('outline')
    : id === S.titles ? t('Chapter titles') : id === S.stickies ? t('Notes & Comments') : '';
}

// The worker's progress (rec:progress), to the dialog that's waiting on it
const historyListeners = new Set();
if (window.neo.onRecProgress) window.neo.onRecProgress((m) => { for (const f of historyListeners) f(m); });
// a book sealed or stamped (proof.js, in the main process)
const proofListeners = new Set();
if (window.neo.onProofChanged) window.neo.onProofChanged((bookId) => { for (const f of proofListeners) f(bookId); });

// One day's sessions, every device's ({ id, device }, in the order they
// play), read and played from the page and each device's chapters as the
// day began (from the cache), keeping keyframes. A book open in the editor
// flushes first, so the session in progress is read up to now.
async function historyLoadDay(bookId, day, list) {
  if (rec.on && rec.bookId === bookId) rec.flush();
  const [start, read] = await Promise.all([
    window.neo.recDayStart(bookId, day),
    Promise.all(list.map((s) => window.neo.recRead(bookId, s.device, s.id).catch(() => null)))
  ]);
  const sessions = [];
  list.forEach((s, i) => {
    const r = read[i];
    if (r && r.text) sessions.push({ id: s.id, device: s.device, open: r.open, text: r.text });
  });
  const h = new Rec.History(sessions);
  h.build(start && start.devices ? start : {});
  h.day = day;
  return h;
}

// A place in a chapter's HTML where a mark can go: never inside a tag or an
// entity, and a place between paragraphs moves into the one that follows.
function historyPlace(html, at) {
  at = Math.max(0, Math.min(at, html.length));
  const lt = html.lastIndexOf('<', at - 1);
  if (lt >= 0) {
    const gt = html.indexOf('>', lt);
    if (gt >= at) at = gt + 1;
  }
  const amp = html.lastIndexOf('&', at - 1);
  if (amp >= 0 && at - amp < 12) {
    const m = /^&[#a-z0-9]+;/i.exec(html.slice(amp, amp + 12));
    if (m && amp + m[0].length > at) at = amp + m[0].length;
  }
  for (;;) {
    const m = /^<p\b[^>]*>/.exec(html.slice(at, at + 300));
    if (!m) break;
    at += m[0].length;
  }
  return at;
}

// HTML with marks put in at offsets ({ at, html, order }), for the player
// only: the mark is its caret
function historyMarked(html, marks) {
  if (!marks.length) return html;
  const sorted = marks.map((m) => ({ ...m, at: historyPlace(html, m.at) })).sort((a, b) => a.at - b.at || a.order - b.order);
  let out = '';
  let last = 0;
  for (const m of sorted) {
    out += html.slice(last, m.at) + m.html;
    last = m.at;
  }
  return out + html.slice(last);
}

// Whether a piece of a chapter (a ChapterText paragraph) closes every tag it
// opens, so it parses alone just as it does in the whole chapter. A chapter
// with one that doesn't (a blockquote around paragraphs) is drawn whole.
const HISTORY_VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
function historyBalanced(html) {
  const open = [];
  for (const m of html.matchAll(/<(\/?)([a-z][a-z0-9-]*)\b[^>]*>/gi)) {
    const tag = m[2].toLowerCase();
    if (HISTORY_VOID.has(tag)) continue;
    if (!m[1]) { if (!m[0].endsWith('/>')) open.push(tag); } else if (open.pop() !== tag) return false;
  }
  return !open.length;
}
// A piece's nodes, parsed apart from the page
let historyTemplate = null;
function historyNodes(html) {
  if (!historyTemplate) historyTemplate = document.createElement('template');
  historyTemplate.innerHTML = html;
  return [...historyTemplate.content.childNodes];
}

// The DOM point that is `off` letters into paragraph pIdx of a player body,
// as recPoint counts them
function historyPoint(body, pIdx, off) {
  const ps = body.querySelectorAll(Rec.CARET_BLOCK);
  const p = ps[Math.min(pIdx, ps.length - 1)];
  if (!p) return null;
  const w = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
  let n;
  let last = null;
  while ((n = w.nextNode())) {
    if (off <= n.data.length) return [n, off];
    off -= n.data.length;
    last = n;
  }
  return last ? [last, last.data.length] : [p, 0];
}

function historyWhen(ms, opts) {
  if (ms === null || ms === undefined) return '';
  try { return new Intl.DateTimeFormat(NeoI18n.getLocale(), opts).format(new Date(ms)); } catch { return new Date(ms).toLocaleString(); }
}
const HISTORY_DAY = { day: 'numeric', month: 'short' };
const HISTORY_DATE = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' };
const HISTORY_MOMENT = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' };
const HISTORY_TIME = { hour: 'numeric', minute: '2-digit' };
// a writer's day as a moment: its noon, where it is
const historyDayMs = (day) => Date.parse(day + 'T12:00:00');

function historyPause(ms) {
  if (ms >= 3600000) return t('paused {n} h', { n: Math.round(ms / 360000) / 10 });
  if (ms >= 60000) return t('paused {n} min', { n: Math.round(ms / 60000) });
  return t('paused {n} s', { n: Math.round(ms / 1000) });
}

// time spent writing, said plainly
function historySpent(ms) {
  if (ms >= 3600000) {
    const h = Math.floor(ms / 3600000);
    const m = Math.round((ms % 3600000) / 60000);
    return m ? t('{h} h {m} min', { h, m }) : t('{h} h', { h });
  }
  if (ms >= 60000) return t('{n} min', { n: Math.round(ms / 60000) });
  return t('{n} s', { n: Math.max(1, Math.round(ms / 1000)) });
}
const historyWords = (added, removed) => t('+{added} −{removed} words', { added: added.toLocaleString(NeoI18n.getLocale()), removed: removed.toLocaleString(NeoI18n.getLocale()) });

/* ---------- the evidence report (plan, part 2) ---------- */

// Chapters as a print dialog takes pages: "1-3, 7, 10-12", numbered from 1 in
// the book's order, up to n. The 0-based indices, sorted and once each, or
// null when the text isn't such a list (empty, a number past n, a range
// backwards). Any dash, commas, semicolons or spaces between.
function chapterRanges(text, n) {
  const parts = String(text).split(/[,;]|\s+(?![-–—])(?<![-–—]\s*)/).map((x) => x.trim()).filter(Boolean);
  if (!parts.length) return null;
  const out = new Set();
  for (const part of parts) {
    const m = /^(\d+)(?:\s*[-–—]\s*(\d+))?$/.exec(part);
    if (!m) return null;
    const lo = +m[1];
    const hi = m[2] === undefined ? lo : +m[2];
    if (lo < 1 || hi > n || hi < lo) return null;
    for (let i = lo; i <= hi; i++) out.add(i - 1);
  }
  return [...out].sort((x, y) => x - y);
}

// the same list written back as short as it goes: [0,1,2,6] → "1–3, 7"
function chapterRangesText(ids) {
  const out = [];
  const sorted = [...new Set(ids)].sort((x, y) => x - y);
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    out.push(j > i ? `${sorted[i] + 1}–${sorted[j] + 1}` : `${sorted[i] + 1}`);
    i = j;
  }
  return out.join(', ');
}

// Export Writing History…: which chapters go. { chapters: null } for the whole book
// (with its seals, the default), { chapters: [ids] } for those typed as a
// print dialog's pages, null on cancel.
function exportReplayAsk(meta, name, moves = Promise.resolve([])) {
  return new Promise((resolve) => {
    const bd = document.createElement('div');
    bd.className = 'modal-backdrop confirm-modal';
    bd.innerHTML = `
      <div class="modal ex-modal" role="dialog" aria-modal="true" style="width:480px">
        <h2 style="font-size:16px"></h2>
        <div class="ex-step1">
          <div class="ex-warn"><p class="ex-warn-head"></p><p class="ex-warn-body"></p><p class="ex-warn-health"></p><p class="ex-warn-risk"></p></div>
          <label class="ex-pick ex-agree"><input type="checkbox" class="ex-understood"> <span class="ex-understood-text"></span></label>
          <div style="text-align:right;margin-top:16px">
            <button class="m-cancel btn-quiet" style="margin-right:10px"></button>
            <button class="m-continue btn-gold" disabled></button>
          </div>
        </div>
        <div class="ex-step2" hidden>
          <p class="ex-what"></p>
          <label class="ex-pick"><input type="radio" name="ex-scope" value="book" checked> <span class="ex-book"></span></label>
          <div class="ex-pick"><input type="radio" name="ex-scope" value="some" id="ex-some"> <label for="ex-some" class="ex-some"></label> <input type="text" class="ex-range" spellcheck="false" autocomplete="off"></div>
          <div class="ex-chapters"></div>
          <p class="ex-note" hidden></p>
          <div style="text-align:right;margin-top:16px">
            <button class="m-cancel btn-quiet" style="margin-right:10px"></button>
            <button class="m-ok btn-gold"></button>
          </div>
        </div>
      </div>`;
    const title = t('Export the Writing History of “{title}”', { title: isUntitled(meta.title) ? t('Untitled') : meta.title });
    bd.querySelector('h2').textContent = title;
    bd.querySelector('.modal').setAttribute('aria-label', title);
    bd.querySelector('.ex-what').textContent = t('One file that plays how the book was written, keystroke by keystroke, with the evidence report, and checks itself. It opens in any web browser, without NEO. Only the words of the chapters you choose are in it.');
    bd.querySelector('.ex-warn-head').textContent = t('Think before you share this export.');
    bd.querySelector('.ex-warn-body').textContent = t('It holds every keystroke in the chapters it carries: the words you deleted as well as the ones you kept, every pause, and when you wrote (the dates, the hours and your time zone).');
    bd.querySelector('.ex-warn-health').textContent = t('How you type can identify you, much as a fingerprint can, and can hint at your health. Consider this personal and sensitive information when deciding who to share it with.');
    bd.querySelector('.ex-warn-risk').textContent = t('Anyone you give it to can pass it on, and it can’t be taken back. You share it at your own risk.');
    bd.querySelector('.ex-book').textContent = t('The whole book');
    bd.querySelector('.ex-some').textContent = t('Chapters:');
    const order = meta.chapterOrder;
    const field = bd.querySelector('.ex-range');
    field.placeholder = t('e.g. {example}', { example: order.length > 3 ? `1–3, ${order.length}` : '1–2' });
    field.setAttribute('aria-label', t('Chapters, as numbers and ranges, such as 1–3, 7'));
    const note = bd.querySelector('.ex-note');
    // the book's chapters, numbered, so the numbers mean something; a click
    // takes one in or out of the list
    const box = bd.querySelector('.ex-chapters');
    const rows = order.map((ch, i) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'ex-ch';
      const num = document.createElement('span');
      num.className = 'ex-num';
      num.textContent = String(i + 1);
      row.append(num, name(ch));
      box.append(row);
      return row;
    });
    const someOn = bd.querySelector('#ex-some');
    const ok = bd.querySelector('.m-ok');
    ok.textContent = t('Export…');
    bd.querySelectorAll('.m-cancel').forEach((b) => { b.textContent = t('Cancel'); });
    // the warning stands alone first; the choices come once it's read
    const understood = bd.querySelector('.ex-understood');
    bd.querySelector('.ex-understood-text').textContent = t('I understand');
    const next = bd.querySelector('.m-continue');
    next.textContent = t('Continue');
    understood.addEventListener('change', () => { next.disabled = !understood.checked; });
    understood.addEventListener('keydown', (e) => { if (e.key === 'Enter' && understood.checked) { e.preventDefault(); next.click(); } });
    next.onclick = () => {
      if (!understood.checked) return;
      bd.querySelector('.ex-step1').hidden = true;
      bd.querySelector('.ex-step2').hidden = false;
      ok.focus();
    };
    const chosen = () => chapterRanges(field.value, order.length);
    // [[to, from], …]: text moved into a chapter from another (Rec.movedIn)
    let moved = [];
    moves.then((m) => { moved = Array.isArray(m) ? m : []; update(); });
    // what the chapters chosen (indexes) hold that was written in chapters
    // left out, so its writing isn't in the export
    const movedNote = (ids) => {
      const chosenIds = new Set(ids.map((i) => order[i]));
      const by = new Map();
      for (const [to, from] of moved) {
        if (!chosenIds.has(to) || chosenIds.has(from)) continue;
        if (!by.has(to)) by.set(to, new Set());
        by.get(to).add(from);
      }
      const out = [];
      for (const to of order.filter((ch) => by.has(ch)).slice(0, 3)) {
        const n = order.indexOf(to) + 1;
        const here = [...by.get(to)].map((ch) => order.indexOf(ch)).filter((i) => i >= 0).sort((a, b) => a - b);
        if (here.length === 1) out.push(t('Chapter {to} holds text moved in from chapter {from}. Add chapter {from} to show it being written.', { to: n, from: here[0] + 1 }));
        else if (here.length > 1) out.push(t('Chapter {to} holds text moved in from chapters {list}. Add them to show it being written.', { to: n, list: chapterRangesText(here) }));
        else out.push(t('Chapter {to} holds text moved in from a chapter no longer in the book. Only the whole book’s export shows it being written.', { to: n }));
      }
      return out.join(' ');
    };
    const update = () => {
      const ids = someOn.checked ? chosen() : null;
      const set = new Set(ids || []);
      rows.forEach((r, i) => { r.classList.toggle('on', set.has(i)); r.setAttribute('aria-pressed', String(set.has(i))); });
      const warn = ids ? movedNote(ids) : '';
      note.hidden = !someOn.checked || (!!ids && !warn);
      if (someOn.checked) {
        note.textContent = !field.value.trim() ? t('Type the chapters’ numbers, or click them.')
          : !ids ? t('Chapters go as numbers from 1 to {n}, and ranges such as 1–3, with commas between.', { n: order.length }) : warn;
        note.classList.toggle('ex-bad', !!field.value.trim() && !ids);
      }
      ok.disabled = someOn.checked && !ids;
    };
    field.addEventListener('input', () => { someOn.checked = true; update(); });
    field.addEventListener('focus', () => { if (!someOn.checked) { someOn.checked = true; update(); } });
    rows.forEach((r, i) => r.addEventListener('click', () => {
      const ids = new Set(someOn.checked ? chosen() || [] : []);
      if (ids.has(i)) ids.delete(i); else ids.add(i);
      someOn.checked = true;
      field.value = chapterRangesText([...ids]);
      update();
    }));
    bd.addEventListener('change', update);
    field.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ok.click(); } });
    update();
    const done = (v) => { bd.remove(); resolve(v); };
    ok.onclick = () => {
      if (ok.disabled) return;
      done({ chapters: someOn.checked ? chosen().map((i) => order[i]) : null });
    };
    bd.querySelectorAll('.m-cancel').forEach((b) => { b.onclick = () => done(null); });
    bd.addEventListener('mousedown', (e) => { if (e.target === bd) done(null); });
    bd.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); done(null); } });
    document.body.appendChild(bd);
    understood.focus();
  });
}

// The exported history's file name: the book's title, and the chapters in
// it when it doesn't hold them all, as their numbers were typed
function replayFileName(title, order, chapters) {
  if (!chapters) return t('{title} — Writing History', { title });
  const nums = chapters.map((ch) => order.indexOf(ch)).filter((i) => i >= 0);
  if (nums.length === 1) return t('{title}, Chapter {n} — Writing History', { title, n: nums[0] + 1 });
  return t('{title}, Chapters {list} — Writing History', { title, list: chapterRangesText(nums) });
}

// a chapter as History names it: its number and its title
function historyChapterLabel(meta, ch, order) {
  const m = { ...meta, chapterOrder: order.includes(ch) ? order : [...order, ch] };
  const title = ((meta.chapterTitles || {})[ch] || '').trim();
  const kind = chapterKind(ch, m);
  if (kind === 'unnumbered') return title || t('Untitled');
  return title ? chapterName(ch, m) + ' — ' + title : chapterName(ch, m);
}

const canExportHistory = () => historyShows() && !!(window.neo.recExport && window.neo.recEvidence);

// Export → Writing History… (the menu, and a book's Export on the shelf): the
// history as one web page anyone can open, that plays and checks itself. The
// whole book carries its seals; chosen chapters only their lines.
let historyExporting = false;
async function exportWritingHistory(bookId = book && book.id) {
  if (!bookId) { toast(t('Open a book first')); return; }
  if (!canExportHistory() || historyExporting) return;
  historyExporting = true;
  try {
    const meta = book && book.id === bookId ? book : await window.neo.readBookMeta(bookId);
    if (!meta) return;
    meta.chapterOrder = meta.chapterOrder || [];
    // what's typed now reaches the files first
    if (rec.on && rec.bookId === bookId) {
      const c = rec.flush();
      if (c) await c.saved;
    }
    let devices = [];
    try { devices = ((await window.neo.recList(bookId)) || []).filter((d) => d.sessions.length); } catch (err) { window.neo.logError('export replay: ' + (err && err.stack || err)); }
    if (!devices.length) { toast(t('This book has no Writing History to export yet.')); return; }
    // chapters no longer in the book are named as History names them, from
    // the sessions' stats
    const sessions = [];
    try {
      const r = await window.neo.recDays(bookId);
      for (const e of (r && r.entries) || []) for (const x of e.sessions) sessions.push(x);
    } catch (err) { window.neo.logError('export replay: ' + (err && err.stack || err)); }
    const goneOf = (ch) => {
      for (let i = sessions.length - 1; i >= 0; i--) {
        const c = sessions[i].stats && sessions[i].stats.chapters && sessions[i].stats.chapters[ch];
        if (c && c.gone) return c;
      }
      return null;
    };
    const name = (ch) => (meta.chapterOrder.includes(ch) ? historyChapterLabel(meta, ch, meta.chapterOrder) : (goneOf(ch) || {}).lead || t('Untitled'));
    const gone = (ch) => (goneOf(ch) || {}).gone || 'delete';
    // text the chapters took from others (an outline move, a split, a join,
    // a cut pasted): the dialog says when an export would leave its writing out
    const moves = window.neo.recMoves ? window.neo.recMoves(bookId).catch((err) => { window.neo.logError('export replay moves: ' + (err && err.stack || err)); return []; }) : Promise.resolve([]);
    const picked = await exportReplayAsk(meta, name, moves);
    if (!picked) return;
    toast(t('Making the export…'));
    const res = await window.neo.recEvidence(bookId, picked.chapters);
    const title = isUntitled(meta.title) ? t('Untitled') : meta.title;
    const report = evidenceHtml(res.evidence, res.cover, { title: t('How “{title}” was written', { title }), name, gone, order: meta.chapterOrder, partial: !!picked.chapters });
    const order = meta.chapterOrder.filter((ch) => !picked.chapters || picked.chapters.includes(ch)).map((ch) => ({ id: ch, title: name(ch) }));
    const saved = await window.neo.recExport(bookId, {
      chapters: picked.chapters, title, author: meta.author || library.authorName || '', lang: NeoI18n.getLocale(),
      strings: replayPageStrings(), report, order, fileName: replayFileName(title, meta.chapterOrder, picked.chapters),
      script: meta.format === 'screenplay', underline: !!meta.underlineHeadings,
      // each page set as the editor sets it: its kind, and the editor's own rules for a sheet (sheetPageCss)
      kinds: Object.fromEntries(order.map((c) => [c.id, chapterKind(c.id, meta)])), css: await sheetPageCss()
    });
    if (saved) toast(t('Exported: {file}', { file: saved.split(/[\\/]/).pop() }));
  } catch (err) {
    window.neo.logError('export replay: ' + (err && err.stack || err));
    toast(t('The Writing History couldn’t be exported.'));
  } finally {
    historyExporting = false;
  }
}

// The exported replay page's words (replay-page.js, replay-export.js), by
// their English: every T('…') there is here (scripts/replay-page.test.js
// checks it), and goes into the page in the writer's language
const REPLAY_PAGE_WORDS = [
  tk('Footnotes'),
  tk('This tag has a note'), tk('Note'), tk('Changed: {chapters}'), tk('{n} more'),
  tk('Feedback · {app}'), tk('Note · {app}'), tk('As given by {app}'), tk('As given by {app}, {when}'), tk('Model: {model}'),
  tk('Pasted in by the writer'), tk('About {chapter}'), tk('The chapter had changed by the time NEO recorded this.'),
  tk('paused {n} h'), tk('paused {n} min'), tk('paused {n} s'),
  tk('it can’t be read'),
  tk('seals before it are missing'),
  tk('it is signed with another key than the first seal'),
  tk('its signature doesn’t verify'),
  tk('it doesn’t name the seal before it'),
  tk('a session it seals isn’t in this export'),
  tk('a session it seals isn’t what it sealed'),
  tk('a chapter it seals isn’t what it sealed'),
  tk('a stamp it covers isn’t what it covered'),
  tk('its drand round isn’t drand’s'),
  tk('its drand round is later than the seal says it was made'),
  tk('a timestamp token stamps something else'),
  tk('This export couldn’t read its history: {why}'),
  tk('this browser is too old to read it'),
  tk('it was opened from an address that isn’t secure (http://): open the file itself, or an https:// address'),
  tk('Nothing was recorded.'),
  tk('The whole book'),
  tk('Untitled chapter'),
  tk('The day before'),
  tk('1 character typed'),
  tk('{n} characters typed'),
  tk('The day after'),
  tk('Play'),
  tk('Timeline'),
  tk('Loading {day}…'),
  tk('Chapter {n}'),
  tk('This chapter isn’t in the book at this moment.'),
  tk('Pause'),
  tk('What this export checks'),
  tk('Checking…'),
  tk('Checking… {pct}'),
  tk('{n} sessions, each hash chain whole and each following the one before it.'),
  tk('{n} sessions; {b} with a broken chain, {u} not following the one before (one is missing between).'),
  tk('Played back: {bad} of {n} chapter writes don’t come out as recorded.'),
  tk('Played back: all {n} chapter writes come out exactly as recorded.'),
  tk('This export holds only some chapters, so the hash chains and seals, which cover every chapter, can’t be checked here.'),
  tk('This export holds only some chapters, so the sessions’ hash chains, which cover every chapter, can’t be checked here. The seals are checked against these chapters’ own lines.'),
  tk('These seals also cover the writing of one other chapter of the book, which this export doesn’t hold.'),
  tk('These seals also cover the writing of {n} other chapters of the book, which this export doesn’t hold.'),
  tk('A seal’s fingerprint is the SHA-256 of its file. The whole book’s export, and verify-recording run on the book, show the same seals with the same fingerprints.'),
  tk('Fingerprint'),
  tk('Nothing fixes this history in time: no writing session was timestamped. A history made up afterwards could pass every check below.'),
  tk('Fixed in time: {n} of {all} writing sessions were timestamped within a day of ending.'),
  tk('Checked, but not timestamped'),
  tk('What these checks can show: that the history holds together and plays back exactly, and, where it was timestamped, that it existed by then and wasn’t made up afterwards. What they can’t show: who was at the keyboard, or whose ideas the words were.'),
  tk('{n} seals, signed with one key, from {from} to {to}, each timestamped.'),
  tk('{n} seals, signed with one key, from {from} to {to}: {s} timestamped, the others fixed in time by a later seal.'),
  tk('This browser can’t check Ed25519 signatures; a recent Chrome, Firefox or Safari can.'),
  tk('Seal {n}: {why}'),
  tk('The figures below were worked out again from the history in this export, and match.'),
  tk('The figures below don’t match the history in this export.'),
  tk('Seals of {device}'),
  tk('Every seal'),
  tk('Seal'),
  tk('Made'),
  tk('After (drand)'),
  tk('Timestamped'),
  tk('Files'),
  tk('by {when} (a later seal)'),
  tk('not stamped'),
  tk('Check it without this export'),
  tk('Each seal’s timestamp tokens are signed by the authority that issued them. With OpenSSL, and the authorities’ root certificates below, check any of them:'),
  tk('A timestamp shows the history existed by then, and the drand round that it was sealed after then. Neither shows who wrote it: the history played back and the report speak to that, and they are evidence, not proof.'),
  tk('Days'),
  tk('Back to the days'),
  tk('Play fast'),
  tk('When the text you see here was first timestamped'),
  tk('How it was written'),
  tk('Chapters'),
  tk('Snapshot'),
  tk('Before restoring to {when}'),
  tk('Tagged'),
  tk('Tags'),
  tk('Close'),
  tk('Moved text ({n} characters)'),
  tk('Pasted from elsewhere ({n} characters)'),
  tk('Written before NEO started recording'),
  tk('Away from NEO'),
  tk('No key pressed: dictation or handwriting ({n} characters)'),
  tk('Timestamped {when}'),
  tk('Not timestamped'),
  tk('Some checks failed'),
  tk('Checked'),
  tk('Chapter split'),
  tk('Chapters joined'),
  tk('New chapter'),
  tk('Chapter deleted'),
  tk('Sent to Darlings'),
  tk('Back from Darlings'),
  tk('Replace All'),
  tk('Undone'),
  tk('Snapshot restored'),
  tk('Moved in the Outline'),
  tk('From another device'),
  tk('From another device, kept beside this one'),
  tk('Changed while NEO wasn’t recording'),
  tk('Restored'),
  tk('A change the recorder didn’t see'),
  tk('Kept whole again'),
  tk('Writing History'),
  tk('This export plays back how this book was written, keystroke by keystroke, as NEO recorded it.'),
  tk('This export holds only some chapters, so its timestamps can’t be verified. Export the whole book for that.'),
  tk('Turn on JavaScript to play the history and check it. The report below is as NEO wrote it.'),
  tk('Made with NEO {version} on {date}.')
];
const replayPageStrings = () => Object.fromEntries(REPLAY_PAGE_WORDS.map((en) => [en, t(en)]));

// The evidence of how a book, or a chapter, was written, as HTML: figures
// only, with the gaps between keys and deletions in a row as bars, and no
// judgements drawn from them. From Rec.evidence's figures (`ev`), the time
// cover from the seals (`cover`, null when nothing was sealed), `scope`
// (null: the book; else a chapter id), `title`, and `name(ch)` for the
// chapter table. The History dialog shows it, and Export Writing History…
// puts it in the page.
const EV_NOKEY = {
  insertText: 'program', insertHTML: 'program', insertParagraph: 'program', insertLineBreak: 'program',
  insertReplacementText: 'autocorrect', insertCompositionText: 'ime',
  deleteByCut: 'mouse', deleteByDrag: 'mouse', historyUndo: 'undo', historyRedo: 'undo',
  formatBold: 'format', formatItalic: 'format', formatUnderline: 'format', formatStrikeThrough: 'format'
};
// each kind of change made with no key, said in full
const EV_NOKEY_NAMES = {
  program: tk('Text put in by dictation, an emoji picker or another program: {n}.'),
  autocorrect: tk('Words replaced by the system’s autocorrect or spelling: {n}.'),
  // composition with no key down: an input method's own composing has a
  // key before each step, so what's left is Windows dictation (Win+H), the
  // handwriting panel, an emoji picked from Win+. with the mouse
  ime: tk('Text that came composed with no key pressed (dictation, handwriting, an emoji panel): {n}.'),
  mouse: tk('Text cut or dragged with the mouse: {n}.'),
  undo: tk('Undo or redo from the Edit menu: {n}.'),
  format: tk('Formatting from a menu: {n}.'),
  other: tk('Other changes made by the system or a program: {n}.')
};
function evidenceHtml(ev, cover, { scope = null, title = '', name = (ch) => ch, gone = () => 'delete', order = [], partial = false } = {}) {
  const e = escHtml;
  const n = (x) => fmtNum(Math.round(x || 0));
  const pct = (x) => (x === null || x === undefined || !Number.isFinite(x) ? '—' : (x > 0 && x < 0.01 ? '<1' : Math.round(x * 100)) + '%');
  const ms = (x) => (x === null || x === undefined ? '—' : t('{n} ms', { n: n(x) }));
  const date = (x) => historyWhen(x, HISTORY_DATE);
  const moment = (x) => historyWhen(x, HISTORY_MOMENT);
  const sc = scope ? ev.chapters[scope] : ev.book;
  const chars = scope ? ev.chars[scope] || 0 : Object.values(ev.chars).reduce((a, b) => a + b, 0);
  if (!sc) return `<h2 class="ev-h">${e(title)}</h2><p>${e(t('Nothing in this chapter was written while NEO was recording.'))}</p>`;
  const r = Rec.evidenceRead(sc, chars);
  const rows = [];
  const row = (head, text, more = '') => rows.push(`<tr><th>${e(head)}</th><td>${e(text)}${more}</td></tr>`);
  // a few bars, each its share of the whole: [[label, count]]
  const bars = (caption, list) => {
    const all = list.reduce((a, [, v]) => a + v, 0);
    if (!all) return '';
    const max = Math.max(...list.map(([, v]) => v));
    return `<table class="ev-hist"><caption>${e(caption)}</caption>` + list.map(([label, v]) =>
      `<tr><th>${e(label)}</th><td class="ev-hist-bar"><span style="width:${(100 * v / max).toFixed(1)}%"></span></td><td class="ev-hist-n">${e(pct(v / all))}</td></tr>`).join('') + '</table>';
  };
  const gapLabel = (x) => (x < 1000 ? t('{n} ms', { n: n(x) }) : t('{n} s', { n: (x / 1000).toLocaleString(NeoI18n.getLocale()) }));
  const span = (x) => (x >= 2 * 86400000 ? t('{n} days', { n: n(x / 86400000) }) : historySpent(x));
  const one = r.days && date(r.first) === date(r.last);
  row(t('Time'), !r.days ? t('Nothing was written while NEO was recording.')
    : (one ? t('Written on {date}.', { date: date(r.first) }) : t('Written on {n} days between {first} and {last}.', { n: r.days, first: date(r.first), last: date(r.last) })) +
      ' ' + t('{n} sessions, {hours} of writing, leaving out pauses of a minute or more.', { n: n(r.sessions), hours: historySpent(r.ms) }));
  row(t('Keys'), t('{n} keys pressed, {typed} characters typed.', { n: n(r.keys), typed: n(r.typed) }));
  if (r.gap !== null) {
    const G = Rec.EV_GAPS;
    const labels = [t('under {t}', { t: gapLabel(G[0]) }), ...G.slice(1).map((x, i) => gapLabel(G[i]) + '–' + gapLabel(x)), t('{t} to a minute', { t: gapLabel(G[G.length - 1]) })];
    row(t('Rhythm'), t('Half of the gaps between keys were between {low} and {high}; the middle one was {mid}.', { low: ms(r.gapLow), high: ms(r.gapHigh), mid: ms(r.gap) }),
      bars(t('The gaps between keys'), r.rhythm.map((v, i) => [labels[i], v])));
  }
  if (r.pauseN.inside) {
    row(t('Pauses'), t('The middle pause before a letter inside a word: {inside}. After a space: {word}. At the start of a sentence: {sentence}. At the start of a paragraph: {para}.', {
      inside: ms(r.pause.inside), word: ms(r.pause.word), sentence: ms(r.pause.sentence), para: ms(r.pause.para)
    }));
  }
  const RUNS = [t('1 key'), t('2 keys'), t('3–5 keys'), t('6–10 keys'), t('11 or more')];
  row(t('Revised as typed'), t('Deleted where the text was being written: {n} characters, {share} of those typed.', { n: n(r.deletedAtEnd), share: pct(r.typed ? r.deletedAtEnd / r.typed : null) }) + ' ' +
    t('Quick fixes (a deletion within a second of typing): {fixes}.', { fixes: n(r.fixes) }) +
    (r.spell ? ' ' + t('Spelling suggestions picked: {n}.', { n: n(r.spell) }) : ''),
  bars(t('Deletions in a row'), r.runs.map((v, i) => [RUNS[i], v])));
  row(t('Revised later'), t('Times the writer went back into earlier text: {n}.', { n: n(r.returns) }) + ' ' +
    t('Typed in earlier text: {typed} characters, {share} of all typing. Deleted there: {deleted}.', { typed: n(r.inside), share: pct(r.insideShare), deleted: n(r.delInside) }));
  // characters, not how many pastes: "1, 43 characters" reads as 1,043
  row(t('Pasted'), r.pastes
    ? t('Pasted from outside NEO: {chars} characters, {share} of the text now.', { chars: n(r.pasted), share: pct(r.pastedShare) }) +
      (r.soon ? ' ' + t('Of those, pasted within ten seconds of coming back to NEO from another app: {chars} characters.', { chars: n(r.soonPasted) }) : '')
    : t('Nothing was pasted from outside NEO.'));
  // a paste of text copied inside NEO moves it, and says so
  if (r.own) row(t('Moved'), t('Text moved within the book: {chars} characters.', { chars: n(r.ownPasted) }));
  const kinds = {};
  for (const [k, v] of Object.entries(r.nokeyKinds)) { const g = EV_NOKEY[k] || 'other'; kinds[g] = (kinds[g] || 0) + v; }
  const kindList = Object.entries(kinds).sort((a, b) => b[1] - a[1]).map(([g, v]) => t(EV_NOKEY_NAMES[g], { n: n(v) })).join(' ');
  row(t('Not typed'), (r.nokey
    ? t('Changes made with no key pressed: {n}, adding {chars} characters.', { n: n(r.nokey), chars: n(r.nokeyChars) }) + ' ' + kindList
    : t('Every change to the text was typed, pasted, or made by one of NEO’s own commands.')) +
    (r.untrusted ? ' ' + t('Keys sent by a program, not a keyboard: {n}.', { n: n(r.untrusted) }) : '') + ' ' +
    t('Not counted here: spelling suggestions picked from NEO’s menu (under Revised as typed), pastes and moves (above), and NEO’s own commands, such as Replace All, joining chapters or moving cards in the Outline.'));
  row(t('Not recorded'), t('Words there before NEO started recording: {before}. Words that came while NEO wasn’t recording: {outside}. Neither is counted above.', { before: n(r.before), outside: n(r.outside) }));
  // the time cover: how much of the writing is fixed in time
  // (a device that seals nothing itself, Pocket, is in it with no seals:
  // only its sessions count, covered by another device's seals)
  const sealing = (cover || []).filter((d) => d.seals);
  if (!sealing.length) {
    row(t('Timestamps'), t('None: timestamping wasn’t turned on, so nothing fixes this history in time.'));
  } else {
    const typedIn = new Map(ev.sessions.map((s) => [s.device + '/' + s.id, s]));
    const all = cover.flatMap((d) => d.cover.map((c) => ({ ...c, device: d.device })));
    const late = all.filter((c) => c.gap && (typedIn.get(c.device + '/' + c.session) || {}).typed);
    const stamps = [...new Set(sealing.flatMap((d) => d.stamps))];
    const count = sealing.reduce((a, d) => a + d.seals, 0);
    const first = Math.min(...sealing.map((d) => d.first));
    const last = Math.max(...sealing.map((d) => d.last));
    let text = count > 1
      ? t('{n} timestamps, the first {first} and the last {last}: one every {gap} on average between them.', { n: n(count), first: moment(first), last: moment(last), gap: span((last - first) / (count - 1)) })
      : t('One timestamp, {when}.', { when: moment(first) });
    if (stamps.length) text += ' ' + t('Timestamp services: {stamps}.', { stamps: stamps.join(', ') });
    text += ' ' + (late.length
      ? t('Sessions not timestamped within a day of ending: {n} of {all}.', { n: n(late.length), all: n(all.length) })
      : t('Every session was timestamped within a day of ending.'));
    if (cover.some((d) => d.bad)) text += ' ' + t('Some timestamps don’t check: run verify-recording on the book to see why.');
    if (partial) text += ' ' + t('NEO checked the timestamps against the whole history when it made this export. It holds only some chapters, so it can itself check only the timestamps over their own lines.');
    row(t('Timestamps'), text);
  }
  // first, whether anything fixes the history in time: the figures below
  // could be made up afterwards, all at once; timestamps taken as it was
  // written can't be (Rec.coverSummary, every device's sessions)
  const fixed = Rec.coverSummary((cover || []).flatMap((d) => d.cover || []));
  const lead = !fixed.stamped
    ? t('Nothing fixes this history in time: no writing session was timestamped. It shows how the book was written, but not when, and a history made up afterwards could look the same.')
    : !fixed.sessions ? '' // only a session still open, timestamped so far
    : fixed.median === null
      ? t('Fixed in time: {n} of {all} writing sessions were timestamped within a day of ending.', { n: n(fixed.within), all: n(fixed.sessions) })
      : t('Fixed in time: {n} of {all} writing sessions were timestamped within a day of ending, half of them within {soon}.', { n: n(fixed.within), all: n(fixed.sessions), soon: fixed.median < 60000 ? t('a minute') : span(fixed.median) });
  let html = `<h2 class="ev-h">${e(title)}</h2>
    ${lead ? `<p class="ev-lead${fixed.stamped ? '' : ' ev-unfixed'}">${e(lead)}</p>` : ''}
    <p class="ev-small">${e(t('Figures from the Writing History NEO kept as the words were written.'))}</p>
    <table class="ev-facts">${rows.join('')}</table>
    <p class="ev-small">${e(t('What this can show: that the history holds together and plays back to the book exactly, and, where it was timestamped, that it existed by then and grew at the pace it shows, so it wasn’t made up afterwards. What it can’t show: who was at the keyboard, or whose ideas the words were.'))}</p>`;
  if (!scope) {
    const ids = [...order.filter((ch) => ev.chapters[ch] || ev.words[ch] !== undefined), ...Object.keys(ev.chapters).filter((ch) => !order.includes(ch))];
    if (ids.length > 1) {
      html += `<h3>${e(t('Chapter by chapter'))}</h3><table class="ev-chapters"><tr><th>${e(t('Chapter'))}</th><th>${e(t('Words now'))}</th><th>${e(t('Days'))}</th><th>${e(t('Typed'))}</th><th>${e(t('Revised'))}</th><th>${e(t('Pasted'))}</th></tr>` +
        ids.map((ch) => {
          const c = ev.chapters[ch];
          const cr = c ? Rec.evidenceRead(c, ev.chars[ch] || 0) : null;
          // a chapter no longer in the book: deleted, or its words gone on elsewhere
          const why = ev.words[ch] === undefined ? gone(ch) : null;
          const label = !why ? name(ch) : why === 'merge' ? t('{name} (joined to another chapter)', { name: name(ch) })
            : why === 'outline' ? t('{name} (moved to a loose card)', { name: name(ch) }) : t('{name} (deleted)', { name: name(ch) });
          return `<tr data-ch="${e(ch)}"><td>${e(label)}</td><td>${ev.words[ch] === undefined ? '—' : n(ev.words[ch])}</td><td>${cr ? n(cr.days) : '—'}</td><td>${cr ? n(cr.typed) : '—'}</td><td>${cr ? e(pct(cr.revised)) : '—'}</td><td>${cr ? e(pct(cr.pastedShare)) : '—'}</td></tr>`;
        }).join('') + '</table>';
    }
  }
  return html;
}

// A map of where text changed, on a square W wide: `parts` in order, each
// { weight, bins: [{ ins, del }] } (a session's changes along a chapter),
// laid out as a grid read like a page, `side` cells a row (more if there are
// more parts than cells), each part a run of cells as long as its share of
// the weights. Nothing marks where a part begins: the map shows where the
// text changed, not how the book divides.
function historyMap(g, W, parts, side) {
  if (!parts.length) return;
  side = Math.max(side, Math.ceil(Math.sqrt(parts.length)));
  const n = side * side;
  const tw = parts.reduce((x, p) => x + p.weight, 0) || parts.length;
  const cells = parts.map((p) => Math.max(1, Math.round((p.weight / tw) * n)));
  let over = cells.reduce((x, y) => x + y, 0) - n;
  while (over > 0) { const i = cells.indexOf(Math.max(...cells)); if (cells[i] <= 1) break; cells[i]--; over--; }
  while (over < 0) { cells[cells.indexOf(Math.max(...cells))]++; over++; }
  const ins = new Float32Array(n);
  const del = new Float32Array(n);
  let at = 0;
  parts.forEach((p, i) => {
    const k = cells[i];
    for (const c of p.bins) {
      const nb = c.ins.length;
      for (let b = 0; b < nb; b++) {
        if (!c.ins[b] && !c.del[b]) continue;
        const a = at + Math.floor((b * k) / nb);
        const z = Math.max(a + 1, at + Math.ceil(((b + 1) * k) / nb));
        for (let q = a; q < z && q < n; q++) { ins[q] += c.ins[b]; del[q] += c.del[b]; }
      }
    }
    at += k;
  });
  let max = 1;
  for (let q = 0; q < n; q++) max = Math.max(max, ins[q] + del[q]);
  const cs = W / side;
  const gap = cs >= 4 ? 1 : 0;
  for (let q = 0; q < n; q++) {
    const v = ins[q] + del[q];
    g.globalAlpha = v ? 0.45 + 0.55 * Math.sqrt(v / max) : 1;
    g.fillStyle = !v ? 'rgba(128,128,128,0.16)' : ins[q] && del[q] ? HISTORY_INK.edited : ins[q] ? HISTORY_INK.added : HISTORY_INK.deleted;
    g.fillRect((q % side) * cs, Math.floor(q / side) * cs, Math.max(0.5, cs - gap), cs - gap);
  }
  g.globalAlpha = 1;
}

// a canvas sized to its box, for drawing in CSS pixels
function historyCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const W = Math.max(1, canvas.clientWidth);
  const H = Math.max(1, canvas.clientHeight);
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  return { g, W, H };
}

// a day as its tile says it: 12th Oct 26 in English, the locale's own way otherwise
function historyDayLabel(day) {
  const ms = historyDayMs(day);
  if (!/^en\b/i.test(NeoI18n.getLocale())) return historyWhen(ms, { day: 'numeric', month: 'short', year: '2-digit' });
  const n = new Date(ms).getDate();
  const th = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th';
  return n + th + ' ' + historyWhen(ms, { month: 'short' }) + ' ' + historyWhen(ms, { year: '2-digit' });
}

// Text copied out of Writing History, remembered so that pasting it in the
// book is recorded as from this book, and from that moment
function historyRemember(text, ref) {
  const hash = Rec.digest(text);
  rec.copied.push(hash);
  if (rec.copied.length > 50) rec.copied.shift();
  rec.copiedFrom.set(hash, ref);
  if (rec.copiedFrom.size > 50) rec.copiedFrom.delete(rec.copiedFrom.keys().next().value);
}

// Paragraphs (HTML) to the clipboard, as prose and as HTML
async function historyClip(html, ref) {
  const holder = document.createElement('div');
  holder.innerHTML = html;
  const text = [...holder.children].map((p) => p.textContent).join('\n\n') || holder.textContent;
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([text], { type: 'text/plain' }), 'text/html': new Blob([html], { type: 'text/html' }) })]);
  } catch {
    await navigator.clipboard.writeText(text);
  }
  historyRemember(text, ref);
}

// Paragraphs (HTML) into a book's Darlings, the open one's or one on the shelf
async function historyToDarlings(bookId, html, label) {
  const holder = document.createElement('div');
  holder.innerHTML = html;
  const entry = {
    id: 'd-' + Date.now().toString(36),
    html,
    text: [...holder.children].map((p) => p.textContent).join('\n\n').slice(0, 2000),
    chapterId: null,
    chapterLabel: label,
    date: new Date().toISOString()
  };
  if (book && book.id === bookId) {
    darlings.unshift(entry);
    await writeSidecar(bookId, 'darlings', darlings);
    if (currentTab === 'darlings') renderDarlings();
    updateCounters();
    return;
  }
  const list = (await window.neo.readJSON(bookId, 'darlings', [])) || [];
  list.unshift(entry);
  await window.neo.writeJSON(bookId, 'darlings', list);
}

// What a restore replaces is kept before anything changes, where the book
// already keeps its past. While the book is recording, that's the recording:
// every change reached it, so the moment just before the restore holds the
// text exactly, and a tag goes there ("Before restoring to …"), on disk
// before the restore. Otherwise, as a snapshot restore keeps it: a "Before a
// restore" snapshot. `ref` and `wall` are the moment restored to. Returns
// { tag } or { snapshot }, or null when neither could be kept, and then
// nothing may change.
async function historyKeepBefore(ref, wall) {
  if (rec.on && book && rec.bookId === book.id) {
    const tg = rec.tag(null, null, { restore: [...ref, new Date(wall).toISOString()] });
    if (tg && await tg.saved) return { tag: tg };
  }
  try {
    const r = await takeSnapshot('r');
    // (null: a book with nothing in it, which has nothing to lose)
    if (r || snapsCan()) return { snapshot: r ? r.snap : null };
  } catch (err) { logSnap(err); }
  return null;
}
// where it went, as a restore's toast says it
const historyKeptSaid = (kept, wall, many = false) => (kept.tag
  ? (many ? t('{undo} undoes it; the text they replaced is in Writing History, at “{tag}”.', { undo: KZ, tag: historyRestoreTag(wall) })
    : t('{undo} undoes it; the text it replaced is in Writing History, at “{tag}”.', { undo: KZ, tag: historyRestoreTag(wall) }))
  : many ? t('{undo} undoes it; the text they replaced is in a snapshot too.', { undo: KZ }) : t('{undo} undoes it; the text it replaced is in a snapshot too.', { undo: KZ }));
// the name of the tag a restore leaves on the moment before it
const historyRestoreTag = (wall) => t('Before restoring to {when}', { when: snapWhen(wall) });
const historyCantKeep = () => toast(t('NEO couldn’t keep the text as it is now, so nothing was changed.'), 6000);

// Restore: a chapter back as it was at a moment of its history (`wall`, as
// the recording names it: `ref`, [session, line, device]). One still in the
// book takes the old text, once what it held is kept (historyKeepBefore);
// one deleted since comes back as a new chapter, after the chapter it
// followed then (`before`: the chapters before it at that moment, nearest
// last). Either is one ⌘Z, and the recording says which moment it came from
// (x restore). A book not open is opened first.
async function historyRestore({ bookId, ch, html, title = '', before = [], wall, ref, paras = null }) {
  if (!book || book.id !== bookId || $('#editor-view').hidden) {
    if (book) await backToShelf();
    await openBook(bookId);
    if (!book || book.id !== bookId) return;
  }
  if (currentTab !== 'manuscript') switchTab('manuscript');
  if (paras) return historyRestoreParagraphs({ ch, html, wall, ref, paras });
  const when = snapWhen(wall);
  let target = ch;
  let said;
  if (book.chapterOrder.includes(ch) && chapterHTML[ch] !== undefined) {
    if (chapterHTML[ch] === html) { toast(t('This chapter is already as it was then.')); return; }
    const kept = await historyKeepBefore(ref, wall);
    if (!kept) { historyCantKeep(); return; }
    if (!book || book.id !== bookId) return;
    snapshotStructure('restore');
    setChapterHTML(ch, html, 'restore', { ref });
    wordCache[ch] = null;
    await persistChapter(ch, html);
    said = t('Chapter restored from {when}.', { when }) + ' ' + historyKeptSaid(kept, wall);
  } else {
    snapshotStructure('restore');
    target = 'ch-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
    const prev = [...before].reverse().find((x) => book.chapterOrder.includes(x));
    book.chapterOrder.splice(prev ? book.chapterOrder.indexOf(prev) + 1 : 0, 0, target);
    if (title) {
      book.chapterTitles = book.chapterTitles || {};
      book.chapterTitles[target] = title;
    }
    setChapterHTML(target, html, 'restore', { ref });
    rec.streams('restore');
    await persistChapter(target, html);
    await saveMeta();
    said = t('Chapter put back from {when}. {undo} undoes it.', { when, undo: KZ });
  }
  renderChapters();
  updateCounters();
  const sec = document.querySelector(`.chapter[data-id="${CSS.escape(target)}"]`);
  if (sec) sec.scrollIntoView({ block: 'start' });
  focusChapterStart(target);
  resetNativeUndo();
  breakRun = 1; // ⌘Z, before any typing, undoes it
  undoToast(said, 9000);
}

// Paragraphs a…b of a chapter (as it was when they were found: `expect`)
// back as they were (`html`): what they hold is kept first, one ⌘Z undoes
// it, and the recording names the moment
async function historyRestoreParagraphs({ ch, html, wall, ref, paras }) {
  const bookId = book.id;
  const cur = chapterHTML[ch];
  if (cur === undefined || !book.chapterOrder.includes(ch)) { toast(t('That couldn’t be restored. The book is as it was.')); return; }
  const q = { ch, a: paras.a, b: paras.b };
  // (the chapter as it opened can differ from its file by a tidy)
  if (cur !== paras.expect) Rec.partSplices(q, Rec.splices(paras.expect, cur), 1);
  if (q.gone || q.b <= q.a) { toast(t('Those paragraphs changed meanwhile, so nothing was restored.')); return; }
  if (cur.slice(q.a, q.b) === html) { toast(t('These paragraphs are already as they were then.')); return; }
  const kept = await historyKeepBefore(ref, wall);
  if (!kept) { historyCantKeep(); return; }
  if (!book || book.id !== bookId || chapterHTML[ch] !== cur) { toast(t('Those paragraphs changed meanwhile, so nothing was restored.')); return; }
  snapshotStructure('restore');
  const next = cur.slice(0, q.a) + html + cur.slice(q.b);
  setChapterHTML(ch, next, 'restore', { ref });
  wordCache[ch] = null;
  await persistChapter(ch, next);
  renderChapters();
  updateCounters();
  // the caret at the first paragraph restored
  const pIdx = (cur.slice(0, q.a).match(/<p[\s>]/g) || []).length;
  const body = document.querySelector(`.chapter[data-id="${CSS.escape(ch)}"] .chapter-body`);
  const p = body && body.querySelectorAll('p')[pIdx];
  if (p) {
    body.focus({ preventScroll: true });
    const r = document.createRange();
    r.setStart(p, 0);
    r.collapse(true);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
    currentChapterId = ch;
    p.scrollIntoView({ block: 'center' });
  } else focusChapterStart(ch);
  resetNativeUndo();
  breakRun = 1;
  const many = (html.match(/<p[\s>]/g) || []).length > 1;
  undoToast((many ? t('Paragraphs restored from {when}.', { when: snapWhen(wall) }) : t('Paragraph restored from {when}.', { when: snapWhen(wall) })) + ' ' + historyKeptSaid(kept, wall, many), 9000);
}

// When a book was last timestamped, and by whom, from proof:status
function proofSays(st) {
  if (!st || !st.seals) return t('Not timestamped yet. The first timestamp comes with your next words.');
  const when = snapWhen(Date.parse(st.at));
  return st.stamps.length >= 2
    ? t('Last timestamped {when}, by {a} and {b}.', { when, a: st.stamps[0], b: st.stamps[1] })
    : st.stampedAt
      ? t('Last timestamped {then}. Your writing up to {when} is waiting for the network to timestamp it.', { when, then: snapWhen(Date.parse(st.stampedAt)) })
      : t('Your writing up to {when} is waiting for the network to timestamp it.', { when });
}

// A book just opened, timestamping on, whose seals have waited more than a
// week for a stamp: said once its own try at stamping them is over, unless
// the writer has started typing meanwhile
const PROOF_STALE = 7 * 24 * 3600 * 1000;
async function proofWarnStale(bookId) {
  if (historyLevel() !== 'timestamp' || !window.neo.proofStatus) return;
  const opened = performance.now();
  let st = null;
  try { st = await window.neo.proofStatus(bookId, true); } catch { return; }
  if (!st || !st.waitingSince || Date.now() - Date.parse(st.waitingSince) < PROOF_STALE) return;
  if (!book || book.id !== bookId || $('#editor-view').hidden || rec.lastKeyAt > opened || historyShown) return;
  toast(t('Your writing since {when} hasn’t been timestamped: no timestamp service has answered for over a week. It is still recorded. Check your connection, or choose other services in {options} → Writing History → Timestamp Services….', {
    options: t('Options…'), when: snapWhen(Date.parse(st.waitingSince))
  }), 12000, { warn: true });
}

// Where History's side pane is a drawer (styles.css): a phone, either way up
const HISTORY_DRAWER = '(max-width: 720px), (max-height: 500px)';

// Opens the Writing History of a book (the open one unless another is
// named). It opens on the days: the chapter the writer is in (or the
// book) as it is now, with a tile for each day it was written on below.
// A day picked opens the player on it, with its typing timeline, play and
// speed. Nothing plays until the writer presses Play.
async function openHistory({ bookId = book && book.id, snapshot = null } = {}) {
  if (!bookId || !historyShows() || historyShown) return;
  const here = !!(book && book.id === bookId && !$('#editor-view').hidden);
  const caret = here ? captureCaret() : null;
  const meta = here ? book : await window.neo.readBookMeta(bookId);
  if (!meta || historyShown) return;
  meta.chapterOrder = meta.chapterOrder || [];
  const bd = sheetBackdrop('history', t('Writing History'), `
    <div class="hs-side">
      <div class="hs-find" hidden><div class="hs-qbox"><input class="hs-q" type="search" spellcheck="false" autocomplete="off"><button class="hs-opt" type="button" data-opt="cs">Aa</button><button class="hs-opt" type="button" data-opt="word"><span class="hs-opt-word">ab</span></button></div><div class="hs-results" hidden></div></div>
      <div class="hs-list" role="listbox"></div>
      <div class="hs-side-acts"></div>
    </div>
    <div class="hs-scrim"></div>
    <div class="hs-main">
      <div class="hs-undo-bar" hidden><span class="hs-undo-said"></span><button class="hs-undo-last" type="button"></button></div>
      <div class="hs-note-bar" hidden><div class="hs-note-text"><div class="hs-note-head"></div><div class="hs-note-body"></div></div><button class="hs-note-all" type="button"></button><button class="hs-note-x" type="button">✕</button></div>
      <div class="hs-scroll"><div class="hs-paper"></div>
        <div class="hs-part" hidden><button class="hs-part-prev" type="button">‹</button><button class="hs-part-restore" type="button"></button></div>
        <div class="hs-part hs-part-r" hidden><button class="hs-part-next" type="button">›</button></div>
      </div>
      <div class="hs-badge" hidden></div>
      <div class="hs-bottom">
        <div class="hs-controls" hidden>
          <button class="hs-back" type="button"></button>
          <button class="hs-play" type="button"></button>
          <button class="hs-fast" type="button">▶▶</button>
        </div>
        <div class="hs-dayline" hidden>
          <span class="hs-prevday"></span>
          <div class="hs-timeline" tabindex="0" role="slider" aria-valuemin="0" aria-valuemax="100">
            <canvas></canvas><div class="hs-head"></div><div class="hs-tip" hidden></div>
          </div>
          <span class="hs-nextday"></span>
        </div>
        <div class="hs-strip show-scrollbar" role="listbox"></div>
      </div>
    </div>
    <div class="hs-foot">
      <span class="hs-when"></span>
      <span class="hs-stamped" hidden></span>
      <button class="hs-tag" type="button" hidden></button>
      <button class="hs-restore" type="button" hidden></button>
      <button class="hs-evidence" type="button" hidden></button>
      <button class="hs-delete" type="button" hidden></button>
    </div>`);
  const $h = (sel) => bd.querySelector(sel);
  // Below 720 px (a phone held upright) the side pane is a drawer over the
  // sheet (styles.css): ☰ in the title bar brings it; a chapter, a tag or a
  // finding picked, one of its buttons, a tap beside it, Esc or back put it
  // away. The footer's buttons (tag, restore, how it was written, delete)
  // move into it there, so the sheet keeps the screen.
  const sheetBox = $h('.ps-paper');
  const undoBar = $h('.hs-undo-bar');
  let lastUndo = null;     // the book's last change, a restore that can be undone (lookForLastRestore)
  let lastLooked = false;
  const paneBtn = document.createElement('button');
  paneBtn.className = 'hs-pane-btn';
  paneBtn.type = 'button';
  paneBtn.textContent = '☰';
  paneBtn.setAttribute('aria-expanded', 'false');
  $h('.ps-bar').prepend(paneBtn);
  const narrowMq = matchMedia(HISTORY_DRAWER);
  const footActs = ['.hs-tag', '.hs-restore', '.hs-evidence', '.hs-delete'].map((s) => $h(s));
  const placeActs = () => { for (const b of footActs) (narrowMq.matches ? $h('.hs-side-acts') : $h('.hs-foot')).appendChild(b); };
  placeActs();
  narrowMq.addEventListener('change', placeActs);
  const paneOpen = () => sheetBox.classList.contains('hs-pane-open');
  const pane = (open) => { sheetBox.classList.toggle('hs-pane-open', open); paneBtn.setAttribute('aria-expanded', String(open)); };
  paneBtn.title = t('Chapters, tags and search');
  paneBtn.setAttribute('aria-label', paneBtn.title);
  paneBtn.addEventListener('click', () => pane(!paneOpen()));
  $h('.hs-scrim').addEventListener('click', () => pane(false));
  $h('.hs-side').addEventListener('click', (e) => { if (paneOpen() && e.target.closest('.hs-ch, .hs-side-acts button')) pane(false); });
  const list = $h('.hs-list');
  const scroller = $h('.hs-scroll');
  const paper = $h('.hs-paper');
  const playBtn = $h('.hs-play');
  const fastBtn = $h('.hs-fast');
  const backBtn = $h('.hs-back');
  const controls = $h('.hs-controls');
  const dayline = $h('.hs-dayline');
  const prevDay = $h('.hs-prevday');
  const nextDay = $h('.hs-nextday');
  const strip = $h('.hs-strip');
  sideScroll(strip);
  const timeline = $h('.hs-timeline');
  const canvas = $h('.hs-timeline canvas');
  const headEl = $h('.hs-head');
  const tip = $h('.hs-timeline .hs-tip');
  const badgeEl = $h('.hs-badge');
  const qIn = $h('.hs-q');
  const results = $h('.hs-results');
  const partL = $h('.hs-part:not(.hs-part-r)'); // beside the paragraphs picked: ‹ and restore them…
  const partR = $h('.hs-part-r');               // …and ›
  const partRestore = $h('.hs-part-restore');
  const partPrev = $h('.hs-part-prev');
  const partNext = $h('.hs-part-next');
  const restoreBtn = $h('.hs-restore');
  const tagBtn = $h('.hs-tag');
  const deleteBtn = $h('.hs-delete');
  $h('.hs-find').hidden = !window.neo.recSearch;
  qIn.placeholder = t('Search the history');
  qIn.setAttribute('aria-label', t('Search the history'));
  qIn.title = t('When a word or phrase was first written, last written, written out or moved') + ' (' + (IS_MAC ? '⌘F' : 'Ctrl+F') + ')';
  const optLabels = { cs: t('Match case'), word: t('Whole words only') };
  for (const b of bd.querySelectorAll('.hs-opt')) {
    const opt = b.dataset.opt;
    b.title = optLabels[opt];
    b.setAttribute('aria-label', optLabels[opt]);
    b.setAttribute('aria-pressed', String(historyFindOpts[opt]));
    // a search showing is searched again the new way
    b.addEventListener('click', () => {
      historyFindOpts[opt] = !historyFindOpts[opt];
      b.setAttribute('aria-pressed', String(historyFindOpts[opt]));
      if (find) runFind(find.phrase.text);
    });
  }
  list.setAttribute('aria-label', t('Chapters'));
  timeline.setAttribute('aria-label', t('Timeline'));
  strip.setAttribute('aria-label', t('Days'));
  backBtn.textContent = '← ' + t('Days');
  backBtn.title = t('Back to the days') + ' (Esc)';

  // when the book was last timestamped, and by whom, said once as it opens
  if (historyLevel() === 'timestamp' && window.neo.proofStatus) {
    window.neo.proofStatus(bookId).then((st) => { if (bd.isConnected) toast(proofSays(st), 7000); }).catch(() => {});
  }
  const proofChanged = (changed) => {
    if (changed !== bookId || !bd.isConnected) return;
    stampLoads.clear();
    loadStamps();
  };
  proofListeners.add(proofChanged);
  document.body.appendChild(bd);
  bd.tabIndex = -1;
  bd.focus();

  // what the history holds, from the cache: its days, and each day's sessions
  const S = {
    devices: [],    // the devices that wrote it: { device, name, mine }
    names: {},      // device -> its name, as the history says it
    entries: [],    // the days the cache has built, oldest first
    open: [],       // the sessions still open: { id, device, stats }
    building: false, done: 0, total: 0, error: null,
    days: [],       // { day, list: [session], stats, from, to }
    sessions: [],   // every session, oldest first: { id, device, day, di, stats, open }
    frames: [],     // the book after each session: { order, words }
    untouched: []    // chapters in the book the recording never saw
  };
  let view = 'days';      // or 'player'
  // the whole book, scrolled to the chapter the writer is in, so a change
  // elsewhere (another device's, in another chapter) is never out of sight;
  // a chapter only when picked in the side pane
  let mode = 'book';
  let settled = false;    // whether the history has had its say on the mode
  let dsel = -1;          // the day the days show, an index into S.days
  let following = true;   // the days stay on the latest as the cache fills in

  let h = null;           // the day in the player, a History
  let dayLoads = new Map(); // day -> its History, loading or loaded
  let steps = [];         // the steps this mode plays (indexes into h.steps)
  let vt = new Float64Array(0); // each one's moment on the player's clock
  let pauses = {};        // view index -> how long the pause before it really was
  let total = 0;
  let pos = 0;            // view entries played
  let clock = 0;
  let chapters = {};      // chapter id -> Rec.ChapterText, as played
  // a footnote being typed: followed until the caret moves (the steps
  // between its letters, a key going down, change nothing in it)
  let fnFollow = null;
  let caretAt = null;     // { ch, at } after an edit, or { ch, a, f } after a caret line
  let playing = false;
  let lastFrame = 0;
  let raf = 0;
  let follow = true;
  let shown = {};         // ch -> what its sheet was last drawn from
  let listKey = null;     // the chapters the side pane last listed, joined
  let markers = [];       // { x (clock), kind, label, step }
  let badgeUntil = 0;
  let pauseSaid = -1;     // the view index whose pause the badge last told
  let lead = 0;           // view steps that only say what was there before (Rec.leadSteps): played at once
  let loaded = { state: 'loading' }; // then ready, empty or failed, with ms and error
  let token = 0;          // a newer load makes an older one's result moot
  let find = null;        // a search: { phrase ({ text, word, cs }), sid, findings, within: { done, total }, finished, stopped, error }
  let part = null;        // paragraphs picked on the sheet, to step through their changes: { ch, a, b (Rec's part), h, n (where it is once n steps of h played) }
  let partSeq = 0;        // each step through them, so a newer one makes an older one moot
  let partWas = '';       // what the badge says of them, when they aren't in the text
  let stamps = null;      // how far the day's sessions were timestamped (rec:stamps): { key, map }, map null when nothing was
  const stampLoads = new Map(); // day -> its stamps, loading or loaded
  let stampMarks = [];    // the timestamps' track: { x (clock), by }
  let tags = [];          // the history's tags (Rec.tagsOf), oldest moment first
  let tagsByDay = new Map(); // day -> its tags
  const resize = new ResizeObserver(() => { if (bd.isConnected) drawAll(); });

  const progress = (m) => {
    if (!bd.isConnected || m.key !== bookId) return;
    if (m.type === 'progress' || m.type === 'kept') {
      // a day built, or (kept) the days the cache already held
      for (const entry of m.type === 'kept' ? m.entries : [m.entry]) {
        const at = S.entries.findIndex((e) => e.day >= entry.day);
        if (at < 0) S.entries.push(entry); else S.entries.splice(at, S.entries[at].day === entry.day ? 1 : 0, entry);
      }
      S.done = m.done;
      S.total = m.total;
      reindex();
    } else if (m.type === 'built') {
      S.built = m;
      if (S.listed) built();
    } else if (m.type === 'search' && find && m.sid === find.sid) {
      foundMore(m);
    }
  };
  // The cache is built: the sessions still open come with it. (Its message
  // can come before the answer to rec:days does; whichever is last calls this.)
  function built() {
    const m = S.built;
    S.built = null;
    S.building = false;
    S.open = m.open || [];
    if (m.error) S.error = m.error;
    if (snapshot) {
      const s = snapshot;
      snapshot = null;
      reindex({ show: false });
      watchSnapshot(s);
    } else reindex();
  }
  historyListeners.add(progress);

  const close = () => {
    if (!bd.isConnected) return;
    cancelAnimationFrame(raf);
    resize.disconnect();
    narrowMq.removeEventListener('change', placeActs);
    historyListeners.delete(progress);
    proofListeners.delete(proofChanged);
    CSS.highlights.delete('neo-replay-sel');
    CSS.highlights.delete('neo-replay-find');
    CSS.highlights.delete('neo-replay-part');
    if (find && find.within) window.neo.recSearchStop(bookId).catch(() => {});
    if (window.neo.recHistoryClosed) window.neo.recHistoryClosed();
    bd.remove();
    historyShown = null;
    if (window.neo.uiModal) window.neo.uiModal(false);
    if (caret && book && book.id === bookId) restoreCaret(caret);
  };
  historyShown = close;
  // the menus are the dialog's while it's open: the rest is greyed out
  if (window.neo.uiModal) window.neo.uiModal(true);
  // Esc, or Pocket's back gesture: from the player to the days, then closed
  close.back = () => { if (paneOpen()) pane(false); else if (part) clearPart(); else if (view === 'player') showDays(curDay()); else close(); };
  // Find, from the menu or ⌘F: the history's own search (in the drawer, where the pane is one)
  close.focusFind = () => {
    if ($h('.hs-find').hidden) return;
    if (narrowMq.matches) pane(true);
    qIn.focus();
    qIn.select();
  };
  // for the tests and the console: historyShown.player.h() and the rest
  close.player = {
    h: () => h, loaded: () => loaded, view: () => view, steps: () => steps, pos: () => pos, lead: () => lead, mode: () => mode,
    chapters: () => Object.fromEntries(Object.entries(chapters).map(([ch, c]) => [ch, c.toString()])),
    sessions: () => S.sessions, days: () => S.days, day: () => dsel, building: () => S.building,
    seek, setMode, setPlaying, openPlayer, showDays, skipSession, paper,
    find: () => find, runFind: (q) => runFind(q), goFind: (kind, x) => goFind(kind, x),
    part: () => part, pickPart, partGo,
    markers: () => markers.map((m) => ({ kind: m.kind, label: m.label, x: m.x })), playing: () => playing, tags: () => tags,
    stampMarks: () => stampMarks.map((m) => ({ x: m.x, j: m.j, by: m.by })),
    speed: (x) => { if (x) historyPrefs.speed = x; return historyPrefs.speed; },
    caret: () => caretAt, describeAt: (p) => describe(p > 0 ? vt[p - 1] : 0)
  };
  $h('.ps-done').onclick = close;
  bd.addEventListener('mousedown', (e) => { if (e.target === bd) close(); });

  /* ---------- the history's days and sessions ---------- */

  // The days and sessions again, as the cache fills in. With `show`, the
  // days (when they're up) go to the day they should show: the latest,
  // unless the writer picked another.
  function reindex({ show = true } = {}) {
    const byDay = new Map();
    const add = (day, s) => {
      if (!byDay.has(day)) byDay.set(day, []);
      const l = byDay.get(day);
      if (!l.some((x) => x.id === s.id && x.device === s.device)) l.push(s);
    };
    for (const e of S.entries) for (const s of e.sessions) add(e.day, { id: s.id, device: s.device, stats: s.stats, open: false });
    for (const o of S.open) add(o.stats.day || o.id.slice(0, 10), { id: o.id, device: o.device, stats: o.stats, open: true });
    const was = S.days[dsel] ? S.days[dsel].day : null;
    S.days = [...byDay.keys()].sort().map((day) => {
      const l = byDay.get(day).sort(Rec.sessionOrder);
      return { day, list: l, stats: Rec.dayStats(l.map((x) => x.stats)) };
    });
    S.sessions = [];
    S.days.forEach((d, di) => {
      d.from = S.sessions.length;
      for (const s of d.list) { s.di = di; s.day = d.day; S.sessions.push(s); }
      d.to = S.sessions.length;
    });
    // the book after each session
    const words = {};
    const seen = new Set();
    let order = null;
    S.frames = S.sessions.map((s) => {
      for (const [ch, c] of Object.entries(s.stats.chapters)) {
        seen.add(ch);
        if (c.gone) delete words[ch]; else words[ch] = c.words;
      }
      for (const ch of s.stats.lost || []) delete words[ch];
      if (s.stats.order) order = s.stats.order;
      return { order, words: { ...words } };
    });
    S.untouched = meta.chapterOrder.filter((ch) => !seen.has(ch));
    computeTags();
    if (!S.building && !lastLooked) lookForLastRestore();
    // a chapter the recording never saw: the whole book instead
    if (!S.building && !settled) {
      settled = true;
      if (mode !== 'book' && !S.days.some(dayFits)) mode = 'book';
    }
    const fits = fitting();
    dsel = following || !was ? -1 : S.days.findIndex((d) => d.day === was && dayFits(d));
    if (dsel < 0) dsel = fits.length ? fits[fits.length - 1] : -1;
    renderList();
    renderStrip();
    if (view !== 'days') { renderDayline(); return; }
    if (show && !S.building) showDays(dsel);
    else if (!h) paper.innerHTML = `<p class="hs-empty">${escHtml(S.total ? t('Reading the history: {n} of {total} days', { n: S.done, total: S.total }) : t('Reading the history…'))}</p>`;
  }

  // the chapters a book's tile shows after session i, in the book's order then
  function columns(i) {
    const f = S.frames[i];
    if (!f) return S.untouched.slice();
    const alive = new Set([...Object.keys(f.words), ...S.untouched]);
    const order = f.order || meta.chapterOrder;
    const cols = order.filter((ch) => alive.has(ch));
    for (const ch of alive) if (!cols.includes(ch)) cols.push(ch);
    return cols;
  }

  // the session the player is in, as an index into S.sessions
  // (the step about to play: at a session's start, that session)
  const nowStep = () => Math.max(0, Math.min(pos, steps.length - 1));
  function playerSession() {
    if (!h || !steps.length) return S.days[curDay()] ? S.days[curDay()].from : -1;
    const st = h.steps[steps[nowStep()]];
    const x = st && h.sessions[st.session];
    return x ? S.sessions.findIndex((s) => s.id === x.id && s.device === x.device) : -1;
  }

  // the days a chapter was written on; for the book, the days with
  // something to see (Rec.dayShows), and the last, which ends as the book is
  const dayFits = (d) => (mode === 'book' ? d === S.days[S.days.length - 1] || Rec.dayShows(d.list.map((s) => s.stats)) : d.stats.chapters.includes(mode));
  const fitting = () => S.days.map((d, di) => (dayFits(d) ? di : -1)).filter((di) => di >= 0);
  // the day on the sheet: the player's, or the one the days show
  const curDay = () => (view === 'player' && h ? S.days.findIndex((d) => d.day === h.day) : dsel);
  // a day's sessions, as the cache has them: a new one makes it another day to load
  const dayKey = (d) => d.day + ':' + d.list.map((s) => s.device + '/' + s.id).join(',');
  // a device as the history names it, when the book has more than one
  const deviceName = (device) => (S.devices.length > 1 ? S.names[device] || '' : '');

  const chapterLabel = (ch, order) => historyChapterLabel(meta, ch, order);

  // what took a chapter no longer in the book ('merge', 'outline', 'delete', …)
  function goneWhy(ch) {
    for (let i = S.sessions.length - 1; i >= 0; i--) {
      const c = S.sessions[i].stats.chapters[ch];
      if (c && c.gone) return c.gone;
    }
    return 'delete';
  }

  function goneLead(ch) {
    for (let i = S.sessions.length - 1; i >= 0; i--) {
      const c = S.sessions[i].stats.chapters[ch];
      if (c && c.gone) return c.lead || '';
    }
    return '';
  }

  /* ---------- the days: a tile for each ---------- */

  // A day as the writer saw it end, the tiles below, and none of the
  // player's controls
  function showDays(di = dsel) {
    setPlaying(false);
    clearPart();
    dsel = di;
    const fits = fitting();
    following = di === fits[fits.length - 1];
    setView('days');
    markDay();
    if (S.days[di]) return openPlayer(S.days[di].to - 1, { at: 'end', as: 'days' });
    ++token;
    h = null;
    steps = [];
    shown = {};
    loaded = { state: S.error ? 'failed' : S.building ? 'loading' : 'empty', error: S.error };
    const say = S.building ? t('Reading the history…') : S.error ? t('The history couldn’t be read.') : t('Nothing recorded yet. Write in this book and its history shows here.');
    paper.innerHTML = `<p class="hs-empty">${escHtml(say)}</p>`;
  }

  function setView(v) {
    view = v;
    controls.hidden = v !== 'player';
    dayline.hidden = v !== 'player';
    strip.hidden = v !== 'days';
    if (v === 'days') { badgeEl.hidden = true; hideTagNote(); }
    renderPart();
    drawWhen();
  }

  function describeDay(d) {
    let added = d.stats.added;
    let removed = d.stats.removed;
    if (mode !== 'book') {
      added = removed = 0;
      for (const s of d.list) { const c = s.stats.chapters[mode]; if (c) { added += c.added; removed += c.removed; } }
    }
    // the devices it was written on
    const on = [...new Set(d.list.map((s) => S.names[s.device] || ''))].filter(Boolean).join(', ');
    // and what else it changed: the notes, titles, outline, stickies
    const also = mode === 'book' ? [...new Set((d.stats.streams || []).map(historyStreamName).filter(Boolean))].join(', ') : '';
    return [historyWhen(historyDayMs(d.day), HISTORY_DATE), historySpent(d.stats.ms), on, historyWords(added, removed), also].filter(Boolean).join(' · ');
  }

  // A day's map: where it changed the text, as a grid read like a page,
  // green where words came, red where they went, gold where both. In the
  // whole book each chapter has a run of cells as long as its share of the
  // book's words, in the book's order, unmarked: 64 cells of the book.
  const HISTORY_TILE = 46;
  function drawTile(cv, d) {
    const dpr = window.devicePixelRatio || 1;
    const W = HISTORY_TILE;
    cv.width = cv.height = Math.round(W * dpr);
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const whole = mode === 'book';
    const chs = whole ? columns(d.to - 1) : [mode];
    const words = (S.frames[d.to - 1] || {}).words || {};
    const known = chs.map((ch) => words[ch]).filter((w) => w > 0);
    const usual = known.length ? known.reduce((x, y) => x + y, 0) / known.length : 1;
    const parts = chs.map((ch) => ({
      weight: words[ch] > 0 ? words[ch] : usual,
      bins: d.list.map((x) => x.stats.chapters[ch]).filter((c) => c && c.ins)
    }));
    historyMap(g, W, parts, whole ? 8 : 6);
  }

  // the chapters a day changed the text of, in the book's order at its end
  function dayChapters(d) {
    const moved = (c) => c && ((c.ins && c.ins.some(Boolean)) || (c.del && c.del.some(Boolean)) || c.added || c.removed);
    const hit = new Set();
    for (const x of d.list) for (const [ch, c] of Object.entries(x.stats.chapters || {})) if (!Rec.isStream(ch) && moved(c)) hit.add(ch);
    const order = columns(d.to - 1);
    return [...order.filter((ch) => hit.has(ch)), ...[...hit].filter((ch) => !order.includes(ch))];
  }

  // In the whole book, a day's tile names the chapters it changed, and
  // hovering it marks them in the side pane (a mark, not a pick)
  function dayChapterNames(d) {
    const chs = dayChapters(d);
    if (!chs.length) return '';
    const order = columns(d.to - 1);
    const names = chs.slice(0, 4).map((ch) => listLabel(ch, order));
    if (chs.length > 4) names.push(t('{n} more', { n: chs.length - 4 }));
    return t('Changed: {chapters}', { chapters: names.join(', ') });
  }

  // the chapters marked in the side pane, in the whole book: the day
  // hovered; else in the player the chapter being written at the moment
  // shown; else the day on the sheet's
  let hoverDay = null;
  function markChapters() {
    let on = [];
    if (mode === 'book') {
      if (hoverDay) on = dayChapters(hoverDay);
      else if (view === 'player' && h) on = caretAt ? [caretAt.ch] : [];
      else if (S.days[curDay()]) on = dayChapters(S.days[curDay()]);
    }
    for (const b of list.querySelectorAll('.hs-ch[data-ch]')) {
      const want = on.includes(b.dataset.ch);
      if (b.classList.contains('hs-ch-day') !== want) b.classList.toggle('hs-ch-day', want);
    }
  }

  // a day's tile: its date, and its map
  function dayTile(d, onPick, label = '') {
    const b = document.createElement('button');
    b.className = 'hs-tile';
    b.dataset.day = d.day;
    b.setAttribute('role', 'option');
    const marked = (tagsByDay.get(d.day) || []).map(tagName);
    const where = mode === 'book' ? dayChapterNames(d) : '';
    b.title = (label ? label + ' · ' : '') + describeDay(d) + (where ? ' · ' + where : '') + (marked.length ? ' · ' + t('Tags') + ': ' + marked.join(', ') : '');
    if (marked.length) b.classList.add('hs-tagged');
    b.innerHTML = '<canvas></canvas><span></span>';
    b.lastChild.textContent = historyDayLabel(d.day);
    drawTile(b.firstChild, d);
    b.addEventListener('click', onPick);
    const hover = (x) => { hoverDay = x; markChapters(); };
    b.addEventListener('pointerenter', () => hover(d));
    b.addEventListener('pointerleave', () => { if (hoverDay === d) hover(null); });
    b.addEventListener('focus', () => hover(d));
    b.addEventListener('blur', () => { if (hoverDay === d) hover(null); });
    return b;
  }

  // the day a tile was made for, as S.days has it now
  const dayIndex = (day) => S.days.findIndex((d) => d.day === day);
  let tiles = new Map(); // a tile, kept for as long as its day and the mode stay the same
  function renderStrip() {
    const keep = new Map();
    const made = fitting().map((di) => {
      const d = S.days[di];
      const key = mode + '|' + dayKey(d) + '|' + (tagsByDay.get(d.day) || []).map((x) => x.id + ':' + tagName(x)).join(',');
      const b = tiles.get(key) || dayTile(d, () => { const i = dayIndex(d.day); if (i >= 0) openPlayer(S.days[i].from); });
      keep.set(key, b);
      return b;
    });
    tiles = keep;
    strip.replaceChildren(...made);
    // while the cache is read or built, the days still to come say so
    if (!made.length || S.building) {
      const p = document.createElement('span');
      p.className = made.length ? 'hs-strip-empty hs-strip-more' : 'hs-strip-empty';
      p.textContent = !S.building ? t('No days yet')
        : S.total ? t('Reading the history: {n} of {total} days', { n: S.done, total: S.total }) : t('Reading the history…');
      strip.appendChild(p);
    }
    markDay();
    markFound();
  }

  // in the player: the days before and after, a tile each, either side of the timeline
  function renderDayline() {
    const di = curDay();
    for (const [el, dir] of [[prevDay, -1], [nextDay, 1]]) {
      const to = di >= 0 ? dayAfter(di, dir) : -1;
      if (to < 0) { el.replaceChildren(); continue; }
      const d = S.days[to];
      el.replaceChildren(dayTile(d, () => { const i = dayIndex(d.day); if (i >= 0) openPlayer(S.days[i].from, { playIt: playing }); }, dir < 0 ? t('Earlier day') : t('Later day')));
    }
    markFound();
  }

  // the day on the sheet, marked in the strip
  function markDay() {
    const cur = S.days[curDay()];
    const day = cur ? cur.day : null;
    for (const b of strip.querySelectorAll('.hs-tile')) {
      const on = b.dataset.day === day;
      if (b.getAttribute('aria-selected') !== String(on)) b.setAttribute('aria-selected', String(on));
      if (on) b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    markChapters();
  }

  function drawWhen() {
    const el = $h('.hs-when');
    const s = h && steps.length ? h.steps[steps[Math.max(0, Math.min(pos || 1, steps.length) - 1)]] : null;
    const when = s ? t('Your book {when}', { when: snapWhen(s.wall) }) : '';
    if (el.textContent !== when) el.textContent = when;
    // …and when the text at that moment was timestamped
    const st = $h('.hs-stamped');
    const map = view === 'player' && s && stamps && stamps.key === h.key ? stamps.map : null;
    st.hidden = !map;
    if (!map) return;
    const by = stampedBy(s);
    const says = by ? t('Timestamped {when}', { when: snapWhen(by) }) : t('Not timestamped');
    if (st.textContent !== says) st.textContent = says;
    st.title = t('When the text you see here was first timestamped');
  }

  // When the lines of the history up to step s were first timestamped
  // (ms), or null
  function stampedBy(s) {
    const x = h.sessions[s.session];
    const list = x && stamps.map[x.device + '/' + x.id];
    let by = null;
    for (const e of list || []) if (e.n >= s.line && e.by !== null && (by === null || e.by < by)) by = e.by;
    return by;
  }

  // the day's timestamps, from the history process (desktop only)
  function loadStamps() {
    if (!h || !window.neo.recStamps) return;
    const key = h.key;
    const d = S.days.find((x) => dayKey(x) === key);
    if (!d) return;
    if (!stampLoads.has(key)) {
      stampLoads.set(key, window.neo.recStamps(bookId, d.list.map((x) => ({ id: x.id, device: x.device, open: !!x.open }))).catch(() => null));
      if (stampLoads.size > 3) for (const k of stampLoads.keys()) { if (k !== key && stampLoads.size > 3) stampLoads.delete(k); }
    }
    stampLoads.get(key).then((map) => {
      if (!bd.isConnected || !h || h.key !== key) return;
      stamps = { key, map };
      stampTrack();
      drawTimeline();
      drawWhen();
    });
  }

  // where each timestamp falls on the clock: the last step of the view
  // that its seal covered (one pass: a session's steps come in line order)
  function stampTrack() {
    stampMarks = [];
    if (!stamps || stamps.key !== h.key || !stamps.map) return;
    const lists = h.sessions.map((x) => stamps.map[x.device + '/' + x.id] || []);
    const next = new Int32Array(lists.length);
    const lastJ = new Int32Array(lists.length).fill(-1);
    const seen = new Set();
    const place = (si) => {
      const e = lists[si][next[si]++];
      const j = lastJ[si];
      if (j < 0 || seen.has(j)) return;
      seen.add(j);
      stampMarks.push({ x: vt[j], j, by: e.by });
    };
    for (let j = 0; j < steps.length; j++) {
      const st = h.steps[steps[j]];
      const l = lists[st.session];
      if (!l) continue;
      while (next[st.session] < l.length && l[next[st.session]].n < st.line) place(st.session);
      lastJ[st.session] = j;
    }
    lists.forEach((l, si) => { while (next[si] < l.length) place(si); });
  }

  /* ---------- the player: one day ---------- */

  // the day with index di, loaded once (and the one after it while this one plays)
  function loadDay(di) {
    const d = S.days[di];
    const key = dayKey(d);
    if (!dayLoads.has(key)) {
      dayLoads.set(key, historyLoadDay(bookId, d.day, d.list.map((s) => ({ id: s.id, device: s.device }))).then((x) => { x.key = key; return x; }));
      if (dayLoads.size > 3) for (const k of dayLoads.keys()) { if (k !== key && dayLoads.size > 3) dayLoads.delete(k); }
    }
    return dayLoads.get(key);
  }

  // The player on session i's day: at the start of that session (or its
  // end, `at: 'end'`), on one chapter if `ch` is given. `as: 'days'` is the
  // same day under the days' tiles, without the player's controls.
  async function openPlayer(i, { ch = null, at = 'start', playIt = false, as = 'player' } = {}) {
    const s = S.sessions[i];
    if (!s) return;
    const mine = ++token;
    setPlaying(false);
    if (ch) mode = ch;
    setView(as);
    const fresh = !h || h.key !== dayKey(S.days[s.di]);
    if (fresh) {
      loaded = { state: 'loading' };
      paper.innerHTML = `<p class="hs-empty">${escHtml(t('Reading the history…'))}</p>`;
      const began = performance.now();
      let next;
      try { next = await loadDay(s.di); } catch (err) {
        if (mine !== token) return;
        window.neo.logError('history: ' + (err && err.stack || err));
        loaded = { state: 'failed', error: String(err && err.message || err) };
        paper.innerHTML = `<p class="hs-empty">${escHtml(t('The history couldn’t be read.'))}</p>`;
        return;
      }
      if (mine !== token || !bd.isConnected) return;
      carryPart(h, next);
      h = next;
      loaded = { state: 'ready', ms: Math.round(performance.now() - began) };
      paper.innerHTML = '';
      shown = {};
    }
    if (mine !== token) return;
    buildView();
    if (fresh) loadStamps();
    renderList();
    renderDayline();
    markDay();
    drawTimeline();
    // the session's first step in this view (or after its last: another's
    // can come between, where the two were open at once)
    const k = h.sessions.findIndex((x) => x.id === s.id && x.device === s.device);
    let p = 0;
    if (k >= 0) {
      const to = at === 'end' ? h.sessions[k].to : h.sessions[k].from;
      while (p < steps.length && steps[p] < to) p++;
    }
    seek(p);
    if (fresh && at !== 'end' && mode === 'book' && !playIt) scrollToChapter(caret && caret.chId);
    // a chapter deleted that day: the days show it as it was just before it went
    if (as === 'days' && at === 'end' && mode !== 'book' && chapters[mode] === undefined) {
      let j = steps.length;
      while (j > 0 && !(h.steps[steps[j - 1]].k === 'd' && h.steps[steps[j - 1]].ch === mode)) j--;
      if (j > 0) seek(j - 1);
    }
    if (playIt) setPlaying(true);
    // the dialog's keys work again, unless the writer has gone on to type in
    // its search field meanwhile (a day loads after the pick that asked for it)
    const typing = document.activeElement;
    if (!(typing && bd.contains(typing) && typing.matches('input, textarea'))) bd.focus();
  }

  function buildView() {
    steps = [];
    const all = h.steps;
    let from = 0;
    let to = all.length;
    if (mode !== 'book') {
      const c = h.chapters().find((x) => x.ch === mode);
      from = c ? c.firstStep : 0;
      to = c ? c.lastStep + 1 : 0;
    }
    for (let i = from; i < to; i++) {
      const s = all[i];
      // (notes, titles, the outline and stickies are recorded, not played)
      if ((mode === 'book' && !Rec.isStream(s.ch)) || s.ch === mode || s.k === 'session' || s.k === 'f') steps.push(i);
    }
    timeClock();
  }

  // the player's clock: the recording's own, with long pauses cut short
  // (and skipped at ▶▶, in frame). The wait before a session's first change and
  // after its last (NEO open, nothing written yet, or left open after) isn't
  // played at all: sessions follow each other with the History's own gap.
  function timeClock() {
    vt = new Float64Array(steps.length);
    pauses = {};
    const acts = (s) => s.k === 'e' || s.k === 'x' || s.k === 'd' || s.k === 'o' || s.k === 'c' || (s.k === 's' && s.by !== 'n');
    const first = new Int32Array(steps.length); // per view entry: its session's first and last change in the view
    const last = new Int32Array(steps.length);
    for (let a = 0; a < steps.length;) {
      let b = a + 1;
      while (b < steps.length && h.steps[steps[b]].k !== 'session') b++;
      let f = -1;
      let l = -1;
      for (let j = a; j < b; j++) if (acts(h.steps[steps[j]])) { if (f < 0) f = j; l = j; }
      first.fill(f < 0 ? b : f, a, b);
      last.fill(l, a, b);
      a = b;
    }
    let v = 0;
    for (let j = 0; j < steps.length; j++) {
      const s = h.steps[steps[j]];
      let gap = j ? s.t - h.steps[steps[j - 1]].t : 0;
      if (s.k === 'session' && j) gap = s.session ? Math.max(0, s.t - h.sessions[s.session - 1].t1) : 0;
      else if (j <= first[j] || j > last[j]) gap = 0;
      if (historyPrefs.skip && gap > HISTORY_SKIP) { pauses[j] = gap; gap = HISTORY_SKIP; }
      v += gap;
      vt[j] = v;
    }
    lead = Rec.playFrom(h, steps, vt, mode === 'book' ? null : mode);
    total = steps.length ? vt[steps.length - 1] : v;
    buildMarkers();
    stampTrack();
  }

  // whether a step changed the page: one another device's copy took
  // without the page going with it (another device's text already there) didn't
  const onPage = (s) => s.page !== false || s.sync !== undefined;
  // the device a step was written on, by name (when the book has more than one)
  const stepDevice = (s) => (h.sessions[s.session] ? deviceName(h.sessions[s.session].device) : '');

  function buildMarkers() {
    markers = [];
    let away = null;
    const said = Rec.keylessStretches((n) => t('No key pressed: dictation or handwriting ({n} characters)', { n }));
    // a cause whose changes none reached the page has nothing to mark
    const reached = (j) => {
      for (let k = j + 1; k < steps.length; k++) {
        const s = h.steps[steps[k]];
        if (s.k === 'x' || s.k === 'session' || s.session !== h.steps[steps[j]].session) return false;
        if ((s.k === 'b' || s.k === 'e' || s.k === 'd') && onPage(s)) return true;
      }
      return false;
    };
    steps.forEach((i, j) => {
      const s = h.steps[i];
      const x = vt[j];
      said.step(s, x, i, markers);
      if (s.k === 'session') markers.push({ x, kind: 'session', step: i, label: [historyWhen(s.wall, HISTORY_MOMENT), stepDevice(s)].filter(Boolean).join(' · ') });
      else if (s.k === 'c' && s.what === 'paste') {
        markers.push({ x, kind: s.internal ? 'paste-in' : 'paste', step: i, label: s.internal ? t('Moved text ({n} characters)', { n: s.len }) : t('Pasted from elsewhere ({n} characters)', { n: s.len }) });
      } else if (s.k === 'x' && HISTORY_CAUSES[s.cause] && Rec.QUIET.has(s.cause) && !reached(j)) {
        // (another device's text the page already showed)
      } else if (s.k === 'x' && HISTORY_CAUSES[s.cause]) {
        const kind = HISTORY_SYNC.includes(s.cause) ? 'sync' : s.cause === 'catch-up' || s.cause === 'unobserved' ? 'catch' : s.cause === 'restore' ? 'restore' : 'move';
        markers.push({ x, kind, step: i, label: t(HISTORY_CAUSES[s.cause]) });
      } else if (s.k === 'd' && s.cause === 'delete' && s.page !== false) {
        // a chapter deleted (to Darlings, or with nothing in it) changes no
        // text, so no `x` says so: its `d` does
        markers.push({ x, kind: 'move', step: i, label: t(HISTORY_CAUSES.delete) });
      } else if ((s.k === 'b' || s.k === 'e') && s.sync !== undefined && typeof s.html !== 'string' && !(s.k === 'e' && s.page === false)) {
        // the page took this device's copy, which wasn't what another device
        // left (where a catch-up ends, its own marker says so)
        markers.push({ x, kind: 'sync', step: i, label: t('As it was on {name}', { name: stepDevice(s) || t('another device') }) });
      } else if (s.k === 'b' && !onPage(s)) {
        // (a chapter the page already showed)
      } else if (s.k === 'b' && s.cause === 'baseline') {
        markers.push({ x, kind: 'catch', step: i, label: t('Written before NEO started recording') });
      } else if (s.k === 'b' && HISTORY_SYNC.includes(s.cause)) {
        markers.push({ x, kind: 'sync', step: i, label: t(HISTORY_CAUSES[s.cause]) });
      } else if (s.k === 'f' && (s.what === 'blur' || s.what === 'hidden')) {
        if (!away) away = { x, kind: 'away', step: i, label: t('Away from NEO') };
      } else if (s.k === 'f' && (s.what === 'focus' || s.what === 'visible') && away) {
        away.to = x;
        markers.push(away);
        away = null;
      }
      if (s.k === 'session' && away) { away.to = x; markers.push(away); away = null; }
    });
    if (away) { away.to = total; markers.push(away); }
    said.end(markers);
    tagMarkers();
  }

  // jump: the chapters as they were after `p` entries of the view
  const nAt = (p) => (p <= 0 ? (steps.length ? steps[0] : 0) : steps[p - 1] + 1); // steps of h played
  function seek(p, { keepFollow = false } = {}) {
    if (!h) return;
    p = Math.max(Math.min(lead, steps.length), Math.min(p, steps.length));
    pos = p;
    pauseSaid = -1;
    clock = p ? vt[p - 1] : 0;
    chapters = h.doc(nAt(p));
    for (const ch of Object.keys(chapters)) if (Rec.isStream(ch)) delete chapters[ch]; // (not played: see buildView)
    caretAt = null;
    for (let j = p - 1; j >= 0 && j >= p - 5000; j--) {
      const s = h.steps[steps[j]];
      if (s.page === false) continue;
      if (s.k === 'e') { caretAt = { ch: s.ch, at: s.at + s.ins.length }; break; }
      if (s.k === 's') { caretAt = { ch: s.ch, a: s.a, f: s.f }; break; }
      if (s.k === 'b' && typeof s.html === 'string') { caretAt = { ch: s.ch, at: 0 }; break; }
    }
    if (!keepFollow) follow = true;
    draw();
  }
  const seekClock = (c) => {
    let lo = 0;
    let hi = steps.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (vt[mid] <= c) lo = mid + 1; else hi = mid; }
    seek(lo);
    clock = Math.max(0, Math.min(c, total));
    drawHead();
  };

  function playStep(j) {
    const i = steps[j];
    const s = h.steps[i];
    if (h.bad.has(i)) return;
    if (s.k === 'e') {
      if (chapters[s.ch] === undefined && s.sync === undefined) return;
      h.apply(chapters, i);
      if (s.page !== false) caretAt = { ch: s.ch, at: s.at + s.ins.length };
    } else if (s.k === 'b' || s.k === 'd') {
      h.apply(chapters, i);
      if (s.k === 'b' && typeof s.html === 'string' && s.page !== false) caretAt = { ch: s.ch, at: 0 };
    } else if (s.k === 's') {
      caretAt = { ch: s.ch, a: s.a, f: s.f };
    }
  }

  // the next (or previous) day this mode plays, as an index into S.days
  function dayAfter(di, dir) {
    for (let d = di + dir; d >= 0 && d < S.days.length; d += dir) if (dayFits(S.days[d])) return d;
    return -1;
  }

  function frame(now) {
    raf = 0;
    if (!playing || !bd.isConnected) return;
    const dt = Math.min(250, now - lastFrame); // a hidden window doesn't fast-forward
    lastFrame = now;
    clock += dt * historyPrefs.speed;
    for (;;) {
      while (pos < steps.length && vt[pos] <= clock) playStep(pos++);
      if (pos >= steps.length || !pauses[pos]) break;
      // in a long pause: the badge says how long it really was, for as long
      // as it plays (1.5 s at most), and ▶▶ skips it
      const fast = historyPrefs.speed === HISTORY_FAST;
      if (pauseSaid !== pos) {
        pauseSaid = pos;
        badgeEl.textContent = historyPause(pauses[pos]);
        badgeEl.hidden = false;
        badgeUntil = now + (fast ? 1200 : (vt[pos] - clock) / historyPrefs.speed + 600);
      }
      if (!fast) break;
      clock = vt[pos];
    }
    const di = curDay();
    const next = di >= 0 ? dayAfter(di, 1) : -1;
    if (next >= 0 && pos > steps.length * 0.7) loadDay(next); // ready by the time it's wanted
    if (pos >= steps.length) {
      clock = total;
      if (next >= 0) { openPlayer(S.days[next].from, { playIt: true }); return; } // play runs on into the next day
      setPlaying(false);
    }
    draw(now);
    if (playing) raf = requestAnimationFrame(frame);
  }

  function setPlaying(on) {
    if (on) {
      if (view !== 'player' || !steps.length) return;
      if (pos >= steps.length) seek(0);
    }
    playing = on;
    if (!on) { badgeEl.hidden = true; badgeUntil = 0; partWas = ''; }
    renderRestore();
    renderPart();
    playBtn.textContent = on ? '❚❚' : '▶';
    playBtn.setAttribute('aria-label', on ? t('Pause') : t('Play'));
    playBtn.title = (on ? t('Pause') : t('Play')) + ' (Space)';
    fastBtn.setAttribute('aria-pressed', String(historyPrefs.speed === HISTORY_FAST));
    if (on) {
      follow = true;
      lastFrame = performance.now();
      if (!raf) raf = requestAnimationFrame(frame);
    }
  }

  // ⇧← and ⇧→: the start of the session before or after, crossing days
  // as play does; in one-chapter mode only sessions that changed it
  function skipSession(dir) {
    if (view !== 'player' || !h) return;
    const cur = playerSession();
    // how far into its session the player is, in real time at this speed
    let start = nowStep();
    const k = steps.length ? h.steps[steps[start]].session : 0;
    while (start > 0 && h.steps[steps[start - 1]].session === k) start--;
    const into = clock - (start ? vt[start - 1] : 0);
    const to = Rec.sessionSkip(S.sessions, cur, dir, { ch: mode === 'book' ? null : mode, atStart: into < 1000 * historyPrefs.speed });
    if (to >= 0) openPlayer(to, { playIt: playing });
  }

  /* ---------- drawing the player ---------- */

  // the chapters the sheet shows now, in the book's order at that moment
  function shownChapters() {
    if (mode !== 'book') return chapters[mode] !== undefined ? [mode] : [];
    const order = h.order(nAt(pos)) || dayOrder();
    const out = order.filter((ch) => chapters[ch] !== undefined);
    for (const ch of Object.keys(chapters)) if (!out.includes(ch) && !Rec.isStream(ch)) out.push(ch);
    return out;
  }
  // the order the day began with
  function dayOrder() {
    const s = h && S.sessions.find((x) => x.day === h.day);
    const i = s ? S.sessions.indexOf(s) - 1 : -1;
    return (i >= 0 && S.frames[i] && S.frames[i].order) || meta.chapterOrder;
  }

  // A chapter's sheet, brought up to the chapter as played. The sheet is the
  // chapter's own elements, side by side as in the editor, and remembers
  // which nodes each of its paragraphs (Rec.ChapterText's pieces) made, so a
  // key replaces one paragraph, not a 300 KB script. The caret is a mark in
  // its paragraph's HTML. True when anything changed.
  const HISTORY_CARET = '<span class="rp-caret"></span>';
  function drawBody(body, ch) {
    const c = chapters[ch];
    const parts = c.parts;
    let mark = null;
    if (caretAt && caretAt.ch === ch && caretAt.at !== undefined && parts.length) {
      const i = c.find(caretAt.at);
      mark = { i, at: caretAt.at - c.startOf(i) };
    }
    const piece = (k) => (mark && mark.i === k ? historyMarked(parts[k], [{ at: mark.at, html: HISTORY_CARET, order: 2 }]) : parts[k]);
    let st = shown[ch];
    if (st && !st.whole) {
      // the pieces that changed: everything between what's the same at the start and at the end
      const old = st.parts;
      let a = 0;
      const n = Math.min(old.length, parts.length);
      while (a < n && old[a] === parts[a]) a++;
      let oe = old.length;
      let ne = parts.length;
      while (oe > a && ne > a && old[oe - 1] === parts[ne - 1]) { oe--; ne--; }
      let fits = true;
      for (let k = a; k < ne && fits; k++) fits = historyBalanced(parts[k]);
      if (fits) return drawPieces(body, st, parts, mark, piece, a, oe, ne);
    } else if (!st && parts.every(historyBalanced)) {
      body.textContent = '';
      st = shown[ch] = { parts: [], nodes: [], mark: null };
      return drawPieces(body, st, parts, mark, piece, 0, 0, parts.length);
    }
    // a chapter with a piece that doesn't parse alone: the whole of it, each
    // time it changes, until every piece does again
    if (st && st.whole && parts.every(historyBalanced)) {
      delete shown[ch];
      return drawBody(body, ch);
    }
    const html = c.toString();
    const sig = mark ? caretAt.at : -1;
    if (st && st.whole && st.html === html && st.sig === sig) return false;
    body.innerHTML = historyMarked(html, mark ? [{ at: caretAt.at, html: HISTORY_CARET, order: 2 }] : []);
    shown[ch] = { whole: true, html, sig };
    return true;
  }

  // Pieces a…oe of what the sheet shows become a…ne of the chapter's, and the
  // caret's piece is drawn again where it left and where it went
  function drawPieces(body, st, parts, mark, piece, a, oe, ne) {
    const was = st.mark;
    const moved = (i) => (i < a ? i : i >= oe ? i + ne - oe : -1); // -1: drawn again below
    const same = was && mark ? moved(was.i) === mark.i && was.at === mark.at : !was && !mark;
    if (a === oe && a === ne && same) return false;
    // the first node of piece k or after, to put pieces before
    const after = (k) => {
      for (; k < st.nodes.length; k++) if (st.nodes[k].length) return st.nodes[k][0];
      return null;
    };
    if (oe > a || ne > a) {
      const before = after(oe);
      for (let k = a; k < oe; k++) for (const x of st.nodes[k]) x.remove();
      const frag = document.createDocumentFragment();
      const made = [];
      for (let k = a; k < ne; k++) {
        const nodes = historyNodes(piece(k));
        frag.append(...nodes);
        made.push(nodes);
      }
      body.insertBefore(frag, before);
      st.nodes = st.nodes.slice(0, a).concat(made, st.nodes.slice(oe));
      st.parts = st.parts.slice(0, a).concat(parts.slice(a, ne), st.parts.slice(oe));
    }
    const redraw = (k, html) => {
      const nodes = historyNodes(html);
      const before = st.nodes[k].length ? st.nodes[k][0] : after(k + 1);
      for (const x of nodes) body.insertBefore(x, before);
      for (const x of st.nodes[k]) x.remove();
      st.nodes[k] = nodes;
    };
    if (!same) {
      const left = was ? moved(was.i) : -1;
      if (left >= 0 && !(mark && mark.i === left)) redraw(left, parts[left]);
      if (mark && !(mark.i >= a && mark.i < ne)) redraw(mark.i, piece(mark.i));
    }
    st.mark = mark;
    return true;
  }

  // What the sheet says with nothing on it: a chapter not there yet, or
  // one that has gone (deleted, joined to another, set on a card): gone
  // once this day had it, or when the day never had it and nor does the
  // book now
  let absentBy = { h: null, by: null };
  function absentSays() {
    if (mode === 'book') return t('Nothing written yet at this moment.');
    if (absentBy.h !== h) absentBy = { h, by: new Map(h.chapters().map((c) => [c.ch, c])) };
    const c = absentBy.by.get(mode);
    const gone = c ? nAt(pos) > c.firstStep : !meta.chapterOrder.includes(mode);
    return gone ? t('This chapter isn’t in the book at this moment.') : t('This chapter doesn’t exist yet at this moment.');
  }

  function draw(now = performance.now()) {
    if (!h) return;
    syncPart();
    // the side pane's chapters, again when one came or went
    if (listedChapters().ids.join(',') !== listKey) renderList();
    markChapters();
    const showing = shownChapters();
    const order = h.order(nAt(pos)) || dayOrder();
    const empty = paper.querySelector('.hs-empty');
    if (showing.length && empty) empty.remove();
    if (!showing.length) {
      const say = absentSays();
      if (!empty) {
        paper.innerHTML = `<p class="hs-empty">${escHtml(say)}</p>`;
        shown = {};
      } else if (empty.textContent !== say) empty.textContent = say;
    }
    // sheets for the chapters shown, in order; others go
    const secs = {};
    for (const sec of paper.querySelectorAll('.rp-chapter')) {
      if (showing.includes(sec.dataset.ch)) secs[sec.dataset.ch] = sec;
      else { sec.remove(); delete shown[sec.dataset.ch]; }
    }
    // a script is set as the editor sets it (styles.css, SCREENPLAYS): its
    // page, and its lines where they print, narrow on a phone as there
    const script = meta.format === 'screenplay';
    const spSet = narrowMq.matches ? 'sp-narrow' : 'sp-geom';
    paper.classList.toggle('hs-script', script);
    paper.classList.toggle('hs-sp-narrow', script && narrowMq.matches);
    paper.classList.toggle('sp-uline', script && !!meta.underlineHeadings);
    scroller.classList.toggle('hs-script-scroll', script);
    let prev = null;
    let fnLive = null; // a footnote this step typed in: followed, not the caret
    for (const ch of showing) {
      let sec = secs[ch];
      if (!sec) {
        sec = document.createElement('section');
        sec.dataset.ch = ch;
        sec.innerHTML = '<div class="chapter-head"></div><div class="rp-body"></div>';
      }
      const rb = sec.querySelector(':scope > .rp-body'); // (not its last child: the footnotes' list follows it)
      // set as the editor sets it (sheetLook): the same classes on the sheet and its text
      const look = sheetLook(ch, meta, { script, narrow: spSet === 'sp-narrow', order });
      const kind = look.kind;
      // (the opening's marks stay, and the drop cap drawn beside it: markSheet
      // sets them from the words)
      const bodyCls = ['rp-body', ...look.body, ...['opens-dialogue', 'has-cap'].filter((c) => rb.classList.contains(c))].join(' ');
      const restyled = rb.className !== bodyCls;
      if (restyled) rb.className = bodyCls;
      const secCls = ['rp-chapter', ...look.sec].join(' ');
      if (sec.className !== secCls) sec.className = secCls;
      const label = chapterLabel(ch, order);
      const head = sec.firstElementChild;
      if (head.textContent !== label) head.textContent = label;
      const where = prev ? prev.nextSibling : paper.firstChild;
      if (where !== sec) paper.insertBefore(sec, where);
      prev = sec;
      // (a sheet set anew, a page become another kind, is marked again too)
      if (drawBody(rb, ch) || restyled) {
        markSheet(rb, kind);
        fnLive = NeoSheet.footnoteList(rb, t('Footnotes')) || fnLive;
      }
    }
    // a caret line's caret, put in where the paragraph and letter say
    for (const c of paper.querySelectorAll('.rp-caret.rp-dom')) c.remove();
    const hlSel = new Highlight();
    if (caretAt && caretAt.f) {
      const body = paper.querySelector(`.rp-chapter[data-ch="${CSS.escape(caretAt.ch)}"] .rp-body`);
      const f = body && historyPoint(body, caretAt.f[0], caretAt.f[1]);
      if (f) {
        const mark = document.createElement('span');
        mark.className = 'rp-caret rp-dom';
        const r = document.createRange();
        r.setStart(f[0], f[1]);
        r.insertNode(mark);
        const a = historyPoint(body, caretAt.a[0], caretAt.a[1]);
        if (a && (caretAt.a[0] !== caretAt.f[0] || caretAt.a[1] !== caretAt.f[1])) {
          const sr = document.createRange();
          try {
            sr.setStart(a[0], a[1]);
            sr.setEnd(mark, 0);
            if (sr.collapsed) { sr.setStartAfter(mark); sr.setEnd(a[0], a[1]); }
            hlSel.add(sr);
          } catch { /* a selection the page no longer has */ }
        }
      }
    }
    CSS.highlights.set('neo-replay-sel', hlSel);
    if (follow) {
      const sig = caretAt ? [caretAt.ch, caretAt.at, caretAt.f && caretAt.f.join(',')].join('|') : '';
      if (fnLive) fnFollow = { row: fnLive, sig };
      else if (fnFollow && (fnFollow.sig !== sig || !fnFollow.row.isConnected)) fnFollow = null;
      const c = (fnFollow && fnFollow.row) || paper.querySelector('.rp-caret');
      if (c) {
        const box = scroller.getBoundingClientRect();
        const r = c.getBoundingClientRect();
        if (r.top < box.top + 40 || r.bottom > box.bottom - 40) scroller.scrollTop += r.top - box.top - box.height * 0.4;
      }
    }
    if (badgeUntil && now > badgeUntil) { badgeEl.hidden = true; badgeUntil = 0; }
    paintFind(now);
    paintPart();
    renderRestore();
    drawHead();
  }

  function drawHead() {
    const x = total ? clock / total : 1;
    headEl.style.left = (x * 100).toFixed(3) + '%';
    timeline.setAttribute('aria-valuenow', String(Math.round(x * 100)));
    drawWhen();
    timeline.setAttribute('aria-valuetext', $h('.hs-when').textContent);
  }

  // the strip: how much was written in each sliver of the day, with the
  // time away shaded and the markers above
  function drawTimeline() {
    if (view !== 'player' || !h) return;
    const { g, W, H } = historyCanvas(canvas);
    if (!total) return;
    const X = (c) => (c / total) * (W - 2) + 1;
    const top = 14;
    // under the writing, a track with a dash where each timestamp was made
    const track = stamps && stamps.key === h.key && stamps.map ? 7 : 0;
    const base = H - track - (track ? 2 : 0);
    if (track) {
      g.fillStyle = 'rgba(128,128,128,0.22)';
      g.fillRect(0, H - 4, W, 1);
      g.fillStyle = '#6fb7a8';
      for (const m of stampMarks) g.fillRect(Math.round(X(m.x)) - 1, H - track, 2, track);
    }
    for (const m of markers) {
      if (m.kind !== 'away' && m.kind !== 'nokey') continue;
      g.fillStyle = m.kind === 'away' ? 'rgba(128,128,128,0.13)' : 'rgba(169,139,201,0.2)';
      g.fillRect(X(m.x), top, Math.max(2, X(m.to) - X(m.x)), base - top);
    }
    // what was written, and, faintly behind it, the caret moving around
    const bins = new Float32Array(Math.ceil(W));
    const nav = new Float32Array(Math.ceil(W));
    steps.forEach((i, j) => {
      const s = h.steps[i];
      const into = s.k === 'e' && s.page !== false ? bins : s.k === 's' && s.by !== 'n' ? nav : null;
      if (into) into[Math.min(into.length - 1, Math.floor(X(vt[j])))]++;
    });
    const bars = (b, color) => {
      let max = 0;
      for (const v of b) if (v > max) max = v;
      g.fillStyle = color;
      for (let x = 0; x < b.length; x++) {
        if (!b[x]) continue;
        const bh = Math.max(1, Math.sqrt(b[x] / max) * (base - top - 2));
        g.fillRect(x, base - bh, 1, bh);
      }
    };
    bars(nav, 'rgba(201,168,106,0.18)');
    bars(bins, 'rgba(201,168,106,0.6)');
    const COLORS = { paste: '#d9776b', 'paste-in': '#c9a86a', sync: '#7aa7d9', catch: '#9a958c', restore: '#8fc98a', move: '#a9a294', session: '#77736b', tag: '#e3c47e', nokey: '#a98bc9' };
    let lastLabel = -1e9;
    g.font = '10px -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif';
    for (const m of markers) {
      if (m.kind === 'away') continue;
      const x = Math.round(X(m.x)) + 0.5;
      g.strokeStyle = COLORS[m.kind];
      g.fillStyle = COLORS[m.kind];
      if (m.kind === 'session') {
        g.beginPath(); g.moveTo(x, top); g.lineTo(x, base); g.stroke();
        if (x - lastLabel > 60) {
          g.fillStyle = '#8a857a';
          const label = [historyWhen(h.steps[m.step].wall, HISTORY_TIME), stepDevice(h.steps[m.step])].filter(Boolean).join(' · ');
          g.fillText(label, x + 3, 10);
          lastLabel = x + g.measureText(label).width - 57;
        }
      } else if (m.kind === 'tag') {
        // a flag on a pole
        g.beginPath(); g.moveTo(x, 1); g.lineTo(x, base); g.stroke();
        g.beginPath(); g.moveTo(x, 1); g.lineTo(x + 7, 4); g.lineTo(x, 7); g.closePath(); g.fill();
      } else {
        g.beginPath(); g.moveTo(x - 3, top - 1); g.lineTo(x + 3, top - 1); g.lineTo(x, top + 4); g.closePath(); g.fill();
      }
    }
  }

  // what's at a point of the timeline, for the tooltip
  function describe(c) {
    const span = total / Math.max(1, timeline.clientWidth) * 5;
    const near = markers.filter((m) => (m.to !== undefined ? c >= m.x - span && c <= m.to + span : Math.abs(m.x - c) <= span) && m.kind !== 'session');
    let lo = 0;
    let hi = steps.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (vt[mid] <= c) lo = mid + 1; else hi = mid; }
    const s = steps.length ? h.steps[steps[Math.max(0, Math.min(lo, steps.length) - 1)]] : null;
    const lines = near.slice(0, 3).map((m) => m.label);
    const stamp = stampMarks.find((m) => Math.abs(m.x - c) <= span);
    if (stamp) lines.push(stamp.by ? t('Timestamped {when}', { when: snapWhen(stamp.by) }) : t('Not timestamped'));
    if (s) lines.push([historyWhen(s.wall, HISTORY_MOMENT), stepDevice(s)].filter(Boolean).join(' · '));
    // in the whole book, the chapter being written then
    const ch = mode === 'book' ? chapterAt(lo) : null;
    if (ch) lines.push(chapterLabel(ch, h.order(nAt(lo)) || dayOrder()));
    return lines.join(' · ');
  }

  // the chapter the caret was in after `p` entries of the view (as seek finds it)
  function chapterAt(p) {
    for (let j = Math.min(p, steps.length) - 1; j >= 0 && j >= p - 5000; j--) {
      const s = h.steps[steps[j]];
      if (s.page === false || Rec.isStream(s.ch)) continue;
      if (s.k === 'e' || s.k === 's' || (s.k === 'b' && typeof s.html === 'string')) return s.ch;
    }
    return null;
  }

  function drawAll() {
    drawTimeline();
    draw();
    drawWhen();
  }

  /* ---------- restore: a moment back in the book ---------- */

  // What a restore would bring back: with `paras` (the button beside
  // them), the paragraphs picked, when they're in the text at this moment;
  // else (the footer's) the chapter played, or in the whole book the picked
  // paragraphs' chapter, else the caret's. None while it plays. { ch, paras }
  function restoreTarget(paras = false) {
    if (!h || playing || !steps.length) return null;
    syncPart();
    if (paras) return part && part.h === h && !part.away && part.b > part.a && chapters[part.ch] !== undefined ? { ch: part.ch, paras: true } : null;
    const ch = mode !== 'book' ? mode : part && !part.away ? part.ch : caretAt ? caretAt.ch : null;
    return ch && !Rec.isStream(ch) && chapters[ch] !== undefined ? { ch, paras: false } : null;
  }
  // the moment on the sheet, as the recording names it: [session, line,
  // device], when it was (wall), and as the snapshot view says it
  function momentRef() {
    const s = h.steps[pos ? steps[pos - 1] : steps[0]];
    const x = h.sessions[s.session];
    const wall = Number.isFinite(s.wall) ? s.wall : historyDayMs(h.day);
    return { ref: [x.id, pos ? s.line : 1, x.device], wall, when: snapWhen(wall) };
  }
  // The restore the moment shown sits on, for chapter ch: the sheet just
  // before it or just after it, with nothing else changing ch between. It
  // can be undone from here while the chapter in the book is still exactly
  // what that restore made it (nothing written in it since, so nothing is
  // lost): then the footer's button puts back the text from just before.
  // { html, wall, ref } of that moment, or null.
  const restoreUndo = (ch) => (h ? restoreUndoIn(h, ch, nAt(pos)) : null);
  // the same, in day hh, at the moment n steps in
  function restoreUndoIn(hh, ch, n) {
    if (!here || !book || book.id !== bookId || !meta.chapterOrder.includes(ch) || chapterHTML[ch] === undefined) return null;
    const S = hh.steps;
    const own = (s) => (s.k === 'e' || s.k === 'b') && s.ch === ch && s.cause === 'restore';
    const touches = (s) => (s.k === 'e' || s.k === 'b' || s.k === 'd') && s.ch === ch;
    let a = -1, z = -1; // the restore's own changes: steps a to z, z not included
    for (let i = n; i < S.length; i++) { if (own(S[i])) { a = i; break; } if (touches(S[i])) break; }
    if (a >= 0) { z = a; while (z < S.length && own(S[z])) z++; } else {
      for (let i = n - 1; i >= 0; i--) { if (own(S[i])) { z = i + 1; break; } if (touches(S[i])) break; }
      if (z < 0) return null;
      a = z - 1;
      while (a > 0 && own(S[a - 1])) a--;
    }
    const was = hh.doc(a)[ch], made = hh.doc(z)[ch];
    if (!was || !made) return null;
    const html = was.toString();
    if (html === made.toString() || chapterHTML[ch] !== made.toString()) return null;
    // the moment just before: the last step before the restore's own lines
    let k = a - 1;
    while (k > 0 && (S[k].k === 'x' || S[k].k === 'tag')) k--;
    const s = S[Math.max(0, k)];
    const x = hh.sessions[s.session];
    return { html, wall: Number.isFinite(s.wall) ? s.wall : historyDayMs(hh.day), ref: [x.id, s.line, x.device] };
  }

  // The book's last change a restore that can still be undone (the
  // chapter as it left it): said in a bar above the sheet as History opens,
  // with Undo This Restore, so it isn't only in the footer (or a phone's
  // drawer). Looked for once the days are read.
  async function lookForLastRestore() {
    lastLooked = true;
    if (!here || !book || book.id !== bookId || !S.days.length) return;
    let hh;
    try { hh = await loadDay(S.days.length - 1); } catch { return; }
    if (!bd.isConnected) return;
    let last = null;
    for (let i = hh.steps.length - 1; i >= 0 && !last; i--) {
      const s = hh.steps[i];
      if ((s.k === 'e' || s.k === 'b' || s.k === 'd') && !Rec.isStream(s.ch)) last = s;
    }
    if (!last || last.cause !== 'restore') return;
    const undo = restoreUndoIn(hh, last.ch, hh.steps.length);
    if (!undo) return;
    lastUndo = { ...undo, ch: last.ch };
    $h('.hs-undo-said').textContent = t('Your last change was restoring {chapter}.', { chapter: chapterName(last.ch, meta) });
    $h('.hs-undo-last').textContent = t('Undo This Restore');
    undoBar.hidden = false;
  }
  $h('.hs-undo-last').addEventListener('click', () => {
    const u = lastUndo;
    if (!u || chapterHTML[u.ch] === undefined) return;
    setPlaying(false);
    close();
    historyRestore({ bookId, ch: u.ch, html: u.html, wall: u.wall, ref: u.ref }).catch((err) => {
      window.neo.logError('history restore: ' + (err && err.stack || err));
      toast(t('That couldn’t be restored. The book is as it was.'));
    });
  });
  // where what a restore replaces is kept, as a button's tooltip says it
  const keptWhere = () => (recordingWanted() ? t('What it holds now stays in Writing History, tagged on the moment before the restore.')
    : t('What it holds now is kept in a snapshot, on the Darlings tab.'));
  let restoreSig = '';
  let restoring = false; // finding picked paragraphs as they are now
  function renderRestore() {
    renderTagBtn();
    if (restoring) return;
    const target = restoreTarget();
    const sig = target ? [h.key, pos, target.ch, mode].join(':') : '';
    if (sig === restoreSig) return;
    restoreSig = sig;
    restoreBtn.hidden = !target;
    if (!target) return;
    const ch = target.ch;
    const inBook = meta.chapterOrder.includes(ch);
    const same = inBook && here && book && book.id === bookId && chapterHTML[ch] === chapters[ch].toString();
    const undo = restoreUndo(ch);
    restoreBtn.disabled = same && !undo;
    restoreBtn.textContent = undo ? t('Undo This Restore') : same ? t('Same as now') : inBook ? t('Restore This Chapter') : t('Put This Chapter Back');
    restoreBtn.title = undo ? chapterName(ch, meta) + ': ' + t('The chapter goes back to how it was just before this restore.') + ' ' + keptWhere()
      : same ? '' : inBook ? chapterName(ch, meta) + ': ' + t('The chapter becomes what you see here.') + ' ' + keptWhere()
      : t('The chapter comes back as you see it here, after the chapter it followed.');
  }
  // A restore acts at once, and ⌘Z undoes it. The one thing it asks is
  // whether to open the book, when it isn't the one being written in.
  function opensFirst() {
    if (here && book && book.id === bookId && !$('#editor-view').hidden) return Promise.resolve(true);
    const name = (m) => (isUntitled(m.title) ? t('Untitled') : m.title);
    return confirmModal({
      title: t('Open “{title}” to restore it?', { title: name(meta) }),
      points: [
        t('NEO opens the book, then restores it as you see it here. {undo} undoes the restore.', { undo: KZ }),
        ...(book && book.id !== bookId && !$('#editor-view').hidden ? [t('“{title}”, open now, is saved and closed first.', { title: name(book) })] : [])
      ],
      ok: t('Open and Restore')
    });
  }

  restoreBtn.addEventListener('click', async () => {
    const target = restoreTarget();
    if (!target) return;
    const ch = target.ch;
    const n = nAt(pos);
    const undo = restoreUndo(ch); // (Undo This Restore: the text from just before it)
    const html = undo ? undo.html : chapters[ch].toString();
    let title = '';
    try {
      const tt = h.doc(n)[Rec.STREAMS.titles];
      title = (tt !== undefined && JSON.parse(String(tt))[ch]) || '';
    } catch { /* no titles then */ }
    const order = h.order(n) || dayOrder();
    const at = order.indexOf(ch);
    const before = at < 0 ? order.slice() : order.slice(0, at);
    const { ref, wall } = undo || momentRef();
    setPlaying(false);
    if (!(await opensFirst())) { bd.focus(); return; }
    close();
    historyRestore({ bookId, ch, html, title, before, wall, ref }).catch((err) => {
      window.neo.logError('history restore: ' + (err && err.stack || err));
      toast(t('That couldn’t be restored. The book is as it was.'));
    });
  });

  // Copy from a moment: what's selected on the sheet, without the player's
  // caret, and remembered, so a paste of it in the book is recorded as from
  // this book, and from this moment
  paper.addEventListener('copy', (e) => {
    const sel = window.getSelection();
    if (!h || !steps.length || !sel.rangeCount || sel.isCollapsed || !e.clipboardData) return;
    const text = String(sel);
    const holder = document.createElement('div');
    holder.appendChild(sel.getRangeAt(0).cloneContents());
    for (const m of holder.querySelectorAll('.rp-caret')) m.remove();
    e.preventDefault();
    e.clipboardData.setData('text/plain', text);
    e.clipboardData.setData('text/html', holder.innerHTML);
    historyRemember(text, momentRef().ref);
  });

  /* ---------- restoring paragraphs ---------- */

  // The book's chapters as they are now: the open book's, or read from disk
  async function chaptersNow() {
    if (here && book && book.id === bookId) return Object.fromEntries(book.chapterOrder.filter((c) => chapterHTML[c] !== undefined).map((c) => [c, chapterHTML[c]]));
    const out = {};
    for (const c of meta.chapterOrder) out[c] = (await window.neo.readChapter(bookId, c).catch(() => '')) || '';
    return out;
  }

  // Where paragraphs a…b of chapter ch, as the sheet shows them, are in the
  // book now. They're carried through the rest of this day a step at a
  // time, through each later day that changed the chapter a day at a time
  // (the cache's day states, in the worker: Rec.partDays), and to the
  // chapter as it is. Where that loses them (taken out, moved, or their
  // chapter deleted), they're looked for by their words in every chapter
  // (Rec.findParagraphs), which costs milliseconds; so are they where
  // another paragraph took their place (Rec.partDoubt), and only kept
  // there when their words are nowhere. Returns { ch, a, b, now, moved }
  // where they are, or { gone, day, chapter, elsewhere }.
  async function trackToNow(ch, a, b, now) {
    const q = { ch, a, b };
    let last = '';
    let day = h.day;
    let chapterGone = false;
    // the rest of this day, a step at a time
    for (let i = nAt(pos); i < h.steps.length && !q.gone; i++) {
      const w = { a: q.a, b: q.b };
      Rec.partMove(h, q, i, i + 1);
      if (q.gone) {
        const c = h.doc(i)[ch];
        last = c ? c.toString().slice(w.a, w.b) : '';
        chapterGone = h.steps[i].k === 'd';
      }
    }
    let html = h.end[ch] || '';
    // each later day, from the cache
    if (!q.gone && window.neo.recTrack && S.entries.some((e) => e.day > h.day && e.kinds && e.kinds[ch] !== undefined)) {
      const r = await window.neo.recTrack(bookId, h.day, { ch, a: q.a, b: q.b }, html);
      Object.assign(q, r.part);
      html = r.html;
      if (r.gone) { q.gone = true; last = r.last || ''; day = r.day || day; chapterGone = r.chapter; }
    }
    // and to the book as it is
    if (!q.gone) {
      const cur = now[ch];
      if (cur === undefined) {
        q.gone = chapterGone = true;
        last = html.slice(q.a, q.b);
      } else {
        const w = { a: q.a, b: q.b };
        if (Rec.partSplices(q, Rec.splices(html, cur), 1)) Rec.partDoubt(q, w, html, cur);
        if (q.gone) last = html.slice(w.a, w.b);
        else {
          // a paragraph moved, with another where it was (Rec.partDoubt): where its words went, if anywhere
          if (q.doubt) {
            const found = Rec.findParagraphs(q.was, now) || Rec.findParagraphs(chapters[ch].toString().slice(a, b), now);
            if (found && found.ch === ch) return { ch, a: found.a, b: found.b, now: cur, moved: true };
            if (found) return { gone: true, day, chapter: false, elsewhere: found };
          }
          // whole paragraphs, as they stand now
          const c = Rec.ChapterText.of(Rec.paragraphs(cur));
          const i = c.find(q.a);
          const j = c.find(Math.max(q.a, q.b - 1));
          return { ch, a: c.startOf(i), b: c.startOf(j) + c.parts[j].length, now: cur, moved: false };
        }
      }
    }
    // lost on the way: by their words, as they last were, or as they are here
    const then = chapters[ch].toString().slice(a, b);
    const found = (last && Rec.findParagraphs(last, now)) || Rec.findParagraphs(then, now);
    if (found && found.ch === ch) return { ch, a: found.a, b: found.b, now: now[ch], moved: true };
    return { gone: true, day, chapter: chapterGone, elsewhere: found };
  }

  // Restore the paragraphs picked: found as they are now, then a
  // confirmation that says what changes; or, when they aren't in their
  // chapter any more, what became of them, and an offer to copy them, or
  // put them in Darlings, as they are here
  async function restoreParagraphs() {
    setPlaying(false);
    const ch = part.ch;
    const { a, b } = part;
    const then = chapters[ch].toString().slice(a, b);
    const { ref, wall } = momentRef();
    const when = historyWhen(wall, HISTORY_MOMENT);
    const many = chapters[ch].find(a) !== chapters[ch].find(b - 1);
    const chapter = meta.chapterOrder.includes(ch) ? chapterName(ch, meta) : t('a deleted chapter');
    restoring = true;
    renderPart();
    const slow = setTimeout(() => partSay(t('Finding them in the book as it is now…'), 60000), 300);
    let r;
    try {
      r = await trackToNow(ch, a, b, await chaptersNow());
    } catch (err) {
      window.neo.logError('history restore: ' + (err && err.stack || err));
      toast(t('That couldn’t be restored. The book is as it was.'));
    }
    restoring = false;
    clearTimeout(slow);
    if (badgeEl.textContent === t('Finding them in the book as it is now…')) { badgeEl.hidden = true; badgeUntil = 0; }
    renderPart();
    if (!r || !bd.isConnected) return;
    if (r.gone) {
      const lost = r.elsewhere
        ? t('They seem to be in {chapter} now: NEO found words like theirs there. It can’t restore them in place, but it can copy them as they were on {when}.', { chapter: chapterName(r.elsewhere.ch, meta), when })
        : r.chapter
          ? t('Their chapter was deleted on {day}, and NEO can’t find these words anywhere else in the book. It can copy them as they were on {when}.', { day: historyWhen(historyDayMs(r.day), HISTORY_DATE), when })
          : t('They were taken out on {day}, and NEO can’t find them anywhere else in the book. It can copy them as they were on {when}.', { day: historyWhen(historyDayMs(r.day), HISTORY_DATE), when });
      const title = !meta.chapterOrder.includes(ch)
        ? (many ? t('The chapter these paragraphs were in was deleted') : t('The chapter this paragraph was in was deleted'))
        : many ? t('These paragraphs aren’t in {chapter} any more', { chapter }) : t('This paragraph isn’t in {chapter} any more', { chapter });
      const how = await optionModal(escHtml(title), escHtml(lost), [
        { label: escHtml(t('Copy to the clipboard')), desc: escHtml(t('Then paste them wherever you want them.')), value: 'copy' },
        { label: escHtml(t('Add to Darlings, and copy')), desc: escHtml(t('They wait in Darlings, labelled with where and when they came from.')), value: 'darlings' }
      ]);
      bd.focus();
      if (!how) return;
      try {
        await historyClip(then, ref);
        if (how === 'darlings') {
          await historyToDarlings(bookId, then, t('From {chapter}, as it was on {when}', { chapter, when }));
          toast(t('In Darlings, and copied, as they were on {when}.', { when }));
        } else toast(t('Copied as they were on {when}. Paste them wherever you want them.', { when }));
      } catch (err) {
        window.neo.logError('history copy: ' + (err && err.stack || err));
        toast(t('NEO couldn’t copy them. Select them on the page and press {key} instead.', { key: IS_MAC ? '⌘C' : 'Ctrl+C' }));
      }
      return;
    }
    const nowHtml = r.now.slice(r.a, r.b);
    if (nowHtml === then) { toast(many ? t('These paragraphs are already as they were then.') : t('This paragraph is already as it was then.')); return; }
    if (!(await opensFirst())) { bd.focus(); return; }
    close();
    historyRestore({ bookId, ch, html: then, wall, ref, paras: { a: r.a, b: r.b, expect: r.now } }).catch((err) => {
      window.neo.logError('history restore: ' + (err && err.stack || err));
      toast(t('That couldn’t be restored. The book is as it was.'));
    });
  }

  // The evidence report: how the book was written, in figures and the
  // judgements they support, from every device's sessions (plan, part 2)
  const evBtn = $h('.hs-evidence');
  evBtn.hidden = !window.neo.recEvidence;
  evBtn.textContent = t('How It Was Written…');
  evBtn.title = t('How this book was written, in figures: the rhythm of the keys, the revising, what was pasted, and when it was timestamped');
  const evName = (ch) => (meta.chapterOrder.includes(ch) ? chapterLabel(ch, meta.chapterOrder) : goneLead(ch) || t('Untitled'));
  const evTitle = () => t('How “{title}” was written', { title: isUntitled(meta.title) ? t('Untitled') : meta.title });
  // what's typed now reaches the files first
  async function evFlush() {
    if (!rec.on || rec.bookId !== bookId) return;
    const c = rec.flush();
    if (c) await c.saved;
  }
  evBtn.addEventListener('click', async () => {
    setPlaying(false);
    const sh = document.createElement('div');
    sh.className = 'modal-backdrop ev-backdrop';
    sh.innerHTML = `<div class="modal ev-modal" role="dialog" aria-modal="true">
      <div class="ev-bar"><button class="ev-back btn-quiet" hidden></button><span class="ev-gap"></span><button class="m-ok btn-gold ev-done"></button></div>
      <div class="ev-body" tabindex="-1"><p class="ev-small"></p></div></div>`;
    const body = sh.querySelector('.ev-body');
    const back = sh.querySelector('.ev-back');
    sh.querySelector('.ev-modal').setAttribute('aria-label', evTitle());
    sh.querySelector('.ev-done').textContent = t('Done');
    back.textContent = '← ' + t('The whole book');
    body.firstElementChild.textContent = t('Reading every session…');
    const done = () => { sh.remove(); bd.focus(); };
    sh.querySelector('.ev-done').onclick = done;
    sh.addEventListener('mousedown', (e) => { if (e.target === sh) done(); });
    sh.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); done(); } });
    document.body.appendChild(sh);
    body.focus();
    let res;
    try {
      await evFlush();
      res = await window.neo.recEvidence(bookId, null);
    } catch (err) {
      window.neo.logError('history evidence: ' + (err && err.stack || err));
      if (sh.isConnected) body.firstElementChild.textContent = t('The evidence couldn’t be worked out from this history.');
      return;
    }
    if (!sh.isConnected) return;
    const show = (scope) => {
      body.innerHTML = evidenceHtml(res.evidence, res.cover, { scope, title: scope ? evName(scope) : evTitle(), name: evName, gone: goneWhy, order: meta.chapterOrder });
      back.hidden = !scope;
      for (const tr of body.querySelectorAll('.ev-chapters tr[data-ch]')) {
        tr.tabIndex = 0;
        tr.title = t('This chapter’s evidence');
        tr.addEventListener('click', () => show(tr.dataset.ch));
        tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') show(tr.dataset.ch); });
      }
      body.scrollTop = 0;
      body.focus();
    };
    back.onclick = () => show(null);
    show(null);
  });

  // Delete this book's history: to the system trash, once the writer has
  // read what goes and typed the phrase that says so
  deleteBtn.hidden = !window.neo.recDelete;
  deleteBtn.textContent = t('Delete this book’s history…');
  deleteBtn.addEventListener('click', async () => {
    setPlaying(false);
    const bin = navigator.platform.toLowerCase().includes('win');
    let sealed = 0;
    if (window.neo.proofStatus) try { sealed = (await window.neo.proofStatus(bookId)).seals || 0; } catch { /* none, then */ }
    const sure = await confirmModal({
      title: t('Delete the Writing History of “{title}”?', { title: isUntitled(meta.title) ? t('Untitled') : meta.title }),
      points: [
        t('All of this book’s Writing History goes, and with it every earlier version you could restore from it, on every computer and phone that shares this library.'),
        t('The book itself is untouched: every chapter, note and Darling stays as it is, and so do its snapshots on the Darlings tab.'),
        ...(tags.length ? [t('Its {n} tags go with it.', { n: tags.length })] : []),
        ...(sealed ? [t('Its timestamps go with it, so nothing will show when the book was written up to now.')] : []),
        bin ? t('The history, and its copy in the Backups folder, go to the Recycle Bin. You can get them back from there until it is emptied, but not from inside NEO.')
          : t('The history, and its copy in the Backups folder, go to the Trash. You can get them back from there until it is emptied, but not from inside NEO.'),
        library.recordWriting !== false ? t('NEO starts a new history from the book as it is now.') : t('Writing History is off, so nothing new is recorded until you turn it on.')
      ],
      ok: t('Delete history'),
      danger: true,
      phrase: t('delete history')
    });
    bd.focus();
    if (!sure) return;
    const recording = rec.on && rec.bookId === bookId;
    if (recording) await rec.end();
    let ok = false;
    try { ok = await window.neo.recDelete(bookId); } catch (err) { window.neo.logError('history delete: ' + (err && err.stack || err)); }
    if (recording && book && book.id === bookId && recordingWanted()) await recRestart(bookId);
    if (!bd.isConnected) return;
    if (ok) toast(t('This book’s Writing History is in the trash. The book is untouched.'), 8000);
    restoreSig = '';
    await load();
  });

  /* ---------- the controls ---------- */

  // ▶ plays as it was written; ❚❚ pauses either
  playBtn.addEventListener('click', () => {
    if (!playing) historyPrefs.speed = 1;
    setPlaying(!playing);
  });
  backBtn.addEventListener('click', () => showDays(curDay()));
  // ▶▶: as fast as it was written, eight times over, and again for as
  // written; from a pause it plays
  fastBtn.title = t('Play fast') + ' (' + HISTORY_FAST + '×)';
  fastBtn.setAttribute('aria-label', t('Play fast'));
  fastBtn.addEventListener('click', () => {
    historyPrefs.speed = historyPrefs.speed === HISTORY_FAST && playing ? 1 : HISTORY_FAST;
    setPlaying(true);
    fastBtn.setAttribute('aria-pressed', String(historyPrefs.speed === HISTORY_FAST));
  });
  const fromPointer = (e) => {
    const r = canvas.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * total;
  };
  timeline.addEventListener('pointerdown', (e) => {
    if (!h || !total) return;
    timeline.setPointerCapture(e.pointerId);
    seekClock(fromPointer(e));
    const move = (ev) => seekClock(fromPointer(ev));
    const up = () => { timeline.removeEventListener('pointermove', move); timeline.removeEventListener('pointerup', up); timeline.removeEventListener('pointercancel', up); };
    timeline.addEventListener('pointermove', move);
    timeline.addEventListener('pointerup', up);
    timeline.addEventListener('pointercancel', up);
  });
  timeline.addEventListener('mousemove', (e) => {
    if (!h || !total) return;
    const text = describe(fromPointer(e));
    tip.textContent = text;
    tip.hidden = !text;
    const r = timeline.getBoundingClientRect();
    tip.style.left = Math.max(0, Math.min(r.width - tip.offsetWidth, e.clientX - r.left - tip.offsetWidth / 2)) + 'px';
  });
  timeline.addEventListener('mouseleave', () => { tip.hidden = true; });

  // reading back while it plays: the sheet stops following the caret
  scroller.addEventListener('wheel', () => { follow = false; }, { passive: true });

  bd.addEventListener('keydown', (e) => {
    e.stopPropagation();
    // (Tab stays inside it: the trap every dialog has, topDialog)
    if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && (e.code === 'KeyS' || e.key === 's')) { e.preventDefault(); tagHere(); return; }
    if (e.target === qIn) {
      if (e.key === 'Enter') { e.preventDefault(); runFind(qIn.value); } else if (e.key === 'Escape') { e.preventDefault(); if (qIn.value || find) clearFind(); else bd.focus(); }
      return;
    }
    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'f') { e.preventDefault(); close.focusFind(); return; }
    if (e.key === 'Escape') {
      e.preventDefault();
      close.back();
      return;
    }
    if (e.target.closest('button, input, select') && (e.key === ' ' || e.key === 'Enter')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (view === 'days') {
      // ← and → walk the days, showing each as it ended; Space or Enter plays the one shown
      const fits = fitting();
      const at = fits.indexOf(dsel);
      const go = (k) => { const di = fits[Math.max(0, Math.min(k, fits.length - 1))]; if (di !== undefined && di !== dsel) showDays(di); };
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (S.days[dsel]) openPlayer(S.days[dsel].from); } else if (e.key === 'ArrowLeft') { e.preventDefault(); go(at - 1); } else if (e.key === 'ArrowRight') { e.preventDefault(); go(at + 1); } else if (e.key === 'Home') { e.preventDefault(); go(0); } else if (e.key === 'End') { e.preventDefault(); go(fits.length - 1); }
      return;
    }
    if (e.key === ' ') { e.preventDefault(); setPlaying(!playing); return; }
    if (part && !e.shiftKey && (e.key === '[' || e.key === ']' || e.code === 'BracketLeft' || e.code === 'BracketRight')) {
      e.preventDefault();
      partGo(e.key === '[' || e.code === 'BracketLeft' ? -1 : 1);
      return;
    }
    if (e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); skipSession(e.key === 'ArrowLeft' ? -1 : 1); return; }
    if (!h) return;
    const jump = Math.max(5000, total / 50);
    if (e.key === 'ArrowLeft') { e.preventDefault(); seekClock(clock - jump); } else if (e.key === 'ArrowRight') { e.preventDefault(); seekClock(clock + jump); } else if (e.key === 'Home') { e.preventDefault(); seek(0); } else if (e.key === 'End') { e.preventDefault(); seek(steps.length); }
  });

  /* ---------- search: when a phrase came, went, or moved ---------- */

  // The first pass (the day states) answers at once; the worker then looks
  // inside the days that pass can't see into, and its findings replace
  // the first pass's as they come (foundMore)
  async function runFind(text) {
    text = String(text || '').trim();
    if (!text || !S.devices.length || !window.neo.recSearch) { clearFind(); return; }
    if (find && find.within) window.neo.recSearchStop(bookId).catch(() => {});
    const sid = ++historyFindSeq;
    if (qIn.value.trim() !== text) qIn.value = text;
    const phrase = { text, ...historyFindOpts };
    find = { phrase, sid, findings: null, within: null, finished: false, stopped: false, error: false };
    renderFind();
    try {
      const r = await window.neo.recSearch(bookId, phrase, sid);
      if (!find || find.sid !== sid) return;
      // (the worker's later findings can come before this answer does)
      if (!find.finished && !find.stopped) {
        find.findings = r.findings;
        find.within = find.within || { done: 0, total: 0 };
      }
    } catch (err) {
      if (!find || find.sid !== sid) return;
      window.neo.logError('history search: ' + (err && err.stack || err));
      find.error = true;
    }
    renderFind();
    if (h) draw();
  }

  function foundMore(m) {
    if (m.error) {
      window.neo.logError('history search: ' + m.error);
      find.within = null;
      find.stopped = true;
    } else if (m.findings) {
      find.findings = m.findings;
      find.finished = !!m.finished;
      find.stopped = !m.finished;
      find.within = null;
    } else if (!find.stopped) find.within = { done: m.done, total: m.total };
    renderFind();
  }

  function stopFind() {
    if (!find || !find.within) return;
    window.neo.recSearchStop(bookId).catch(() => {});
    find.within = null;
    find.stopped = true;
    renderFind();
  }

  function clearFind() {
    if (find && find.within) window.neo.recSearchStop(bookId).catch(() => {});
    find = null;
    qIn.value = '';
    renderFind();
    CSS.highlights.delete('neo-replay-find');
  }

  const FIND_KINDS = { first: tk('First written'), last: tk('Last written'), out: tk('Written out'), moved: tk('Moved') };
  function renderFind() {
    results.hidden = !find;
    results.replaceChildren();
    markFound();
    if (!find) return;
    const note = (text) => {
      const p = document.createElement('div');
      p.className = 'hs-find-note';
      p.textContent = text;
      results.appendChild(p);
      return p;
    };
    const q = Rec.normText(find.phrase.text);
    for (const tg of tags.slice().reverse()) {
      if (!Rec.normText(tagName(tg)).includes(q) && !(tg.note && Rec.normText(tg.note).includes(q))) continue;
      const b = document.createElement('button');
      b.className = 'hs-ch hs-hit';
      b.innerHTML = '<span class="hs-ch-name"></span><span class="hs-ch-when"></span>';
      b.firstChild.textContent = t('Tag') + ' · ' + tagName(tg);
      b.lastChild.textContent = tagWhen(tg);
      b.addEventListener('click', () => goTag(tg));
      results.appendChild(b);
    }
    if (find.error) { note(t('The history couldn’t be searched.')); return; }
    const f = find.findings;
    if (!f) { note(S.building ? t('Reading the history…') : t('Searching…')); return; }
    const name = (ch) => (meta.chapterOrder.includes(ch) ? chapterLabel(ch, meta.chapterOrder) : goneLead(ch) || t('Untitled'));
    const unsure = !find.finished;
    const hit = (kind, x, sub) => {
      const b = document.createElement('button');
      b.className = 'hs-ch hs-hit';
      b.innerHTML = '<span class="hs-ch-name"></span><span class="hs-ch-when"></span>';
      b.firstChild.textContent = t(FIND_KINDS[kind]) + ' · ' + historyWhen(historyDayMs(x.day), HISTORY_DAY);
      b.lastChild.textContent = sub;
      b.title = historyWhen(historyDayMs(x.day), HISTORY_DATE);
      b.addEventListener('click', () => goFind(kind, x));
      results.appendChild(b);
    };
    if (f.first) hit('first', f.first, name(f.first.ch) + (unsure ? ' · ' + t('perhaps earlier') : ''));
    if (f.last) hit('last', f.last, name(f.last.ch) + (unsure ? ' · ' + t('perhaps later') : ''));
    if (f.out) hit('out', f.out, name(f.out.ch) + (unsure ? ' · ' + t('perhaps later') : ''));
    for (const m of f.moved.slice(-20)) hit('moved', m, name(m.from) + ' → ' + name(m.to));
    if (!f.first && !find.within) note(t('Never written in this history.'));
    else if (f.first) note(f.total ? t('In the book now: {n} times', { n: f.total }) : t('Not in the book now.'));
    if (find.within) {
      const p = note(find.within.total ? t('Looking inside each day: {n} of {total}', { n: find.within.done, total: find.within.total }) : t('Looking inside each day…'));
      const stop = document.createElement('button');
      stop.className = 'hs-find-stop';
      stop.textContent = t('Stop');
      stop.addEventListener('click', stopFind);
      p.appendChild(stop);
    }
  }

  // the days the findings name, marked on the strip and beside the timeline
  function markFound() {
    const days = new Set();
    const f = find && find.findings;
    if (f) {
      for (const x of [f.first, f.last, f.out]) if (x) days.add(x.day);
      for (const m of f.moved) days.add(m.day);
    }
    for (const b of bd.querySelectorAll('.hs-tile')) b.classList.toggle('hs-found', days.has(b.dataset.day));
  }

  // A finding picked: its day in the player, stopped at the moment it
  // means, in the chapter that moment was in
  async function goFind(kind, x) {
    const di = dayIndex(x.day);
    if (di < 0 || !find) return;
    const phrase = find.phrase;
    let day;
    try { day = await loadDay(di); } catch { openPlayer(S.days[di].from); return; }
    if (!bd.isConnected || !find || find.phrase !== phrase) return;
    const ev = Rec.phraseEvents(day, phrase);
    const e = Rec.phrasePick(ev.events, ev.start, kind, x.to || null);
    await openPlayer(S.days[di].from, { ch: (e && e.ch) || x.to || x.ch || null });
    if (!e || e.step < 0 || h !== day) return;
    let p = 0;
    while (p < steps.length && steps[p] <= e.step) p++;
    seek(p);
    showFind(e.ch);
  }

  // A finding picked: its phrase in sight. One already on screen (typed at
  // the caret, which the sheet follows) is left as it is; otherwise the
  // chapter's first comes to the middle. A phrase the chapter held before
  // the recording began (a baseline) is wherever the chapter has it, not
  // at the caret, and was highlighted out of sight.
  function showFind(ch) {
    findPainted = 0;
    paintFind(performance.now());
    const hl = CSS.highlights.get('neo-replay-find');
    const sec = ch && paper.querySelector(`.rp-chapter[data-ch="${CSS.escape(ch)}"]`);
    if (!hl || !sec) return;
    const box = scroller.getBoundingClientRect();
    const mine = [...hl].filter((r) => sec.contains(r.startContainer)).map((r) => r.getBoundingClientRect());
    if (!mine.length || mine.some((r) => r.bottom > box.top && r.top < box.bottom)) return;
    const first = mine.reduce((a, b) => (b.top < a.top ? b : a));
    follow = false;
    scroller.scrollTop += first.top - box.top - box.height * 0.4;
  }

  // The phrase on the sheets, with the Highlight API. While playing, at most
  // a few times a second: a whole book's text is walked each time.
  let findPainted = 0;
  let findLater = 0;
  function paintFind(now) {
    clearTimeout(findLater);
    if (!find || !find.findings) { CSS.highlights.delete('neo-replay-find'); return; }
    if (now - findPainted < 250) { findLater = setTimeout(() => paintFind(performance.now()), 260); return; }
    findPainted = now;
    const { q, word, cs } = Rec.phraseQuery(find.phrase);
    const hl = new Highlight();
    for (const body of paper.querySelectorAll('.rp-body')) {
      for (const el of body.children) {
        const nodes = [];
        let text = '';
        const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let n; (n = walk.nextNode());) { nodes.push([n, text.length]); text += n.data; }
        if (!text) continue;
        const m = Rec.normMap(text, cs);
        const point = (at) => {
          let k = nodes.length - 1;
          while (k > 0 && nodes[k][1] > at) k--;
          return [nodes[k][0], Math.min(at - nodes[k][1], nodes[k][0].length)];
        };
        for (const at of Rec.phraseIn(m.s, q, word)) {
          const r = document.createRange();
          r.setStart(...point(m.from[at]));
          r.setEnd(...point(m.to[at + q.length - 1]));
          hl.add(r);
        }
      }
    }
    CSS.highlights.set('neo-replay-find', hl);
  }

  qIn.addEventListener('input', () => { if (!qIn.value && find) clearFind(); });

  /* ---------- paragraphs picked: the times they changed ---------- */

  // A click on the sheet picks the paragraph under it (a selection, the
  // paragraphs it runs through); ‹ and › (or [ and ]) then go to the time
  // before and the next time they changed, as each bout of changing them
  // left them (Rec.partNext, Rec.partPrev), across days. In the days, a
  // click opens the player at the day's end with the paragraph picked.
  // a click off the text puts them down, as Esc does
  scroller.addEventListener('click', (e) => { if (part && !e.target.closest('.rp-body, .hs-part')) clearPart(); });
  paper.addEventListener('click', (e) => {
    if (!h || (view !== 'player' && view !== 'days')) return;
    const body = e.target.closest('.rp-body');
    if (!body || !body.parentElement.dataset.ch) return;
    const sel = window.getSelection();
    const spans = sel && !sel.isCollapsed && body.contains(sel.anchorNode) && body.contains(sel.focusNode);
    pickPart(body.parentElement.dataset.ch, spans ? sel.anchorNode : e.target, spans ? sel.focusNode : e.target);
  });

  // the paragraphs of chapter ch from the one holding node `from` to the one holding `to`
  function pickPart(ch, from, to = from) {
    const st = shown[ch];
    const c = chapters[ch];
    if (!st || st.whole || !c) return; // (drawn whole: its paragraphs aren't told apart)
    const pieceOf = (node) => st.nodes.findIndex((ns) => ns.some((x) => x === node || x.contains(node)));
    let i = pieceOf(from);
    let j = pieceOf(to);
    if (i < 0 || j < 0) return;
    if (i > j) [i, j] = [j, i];
    ++partSeq;
    ++probeSeq;
    partNear = null;
    part = { ch, a: c.startOf(i), b: c.startOf(j) + c.parts[j].length, h, n: nAt(pos) };
    if (view === 'days') { const di = curDay(); if (S.days[di]) openPlayer(S.days[di].to - 1, { at: 'end' }); return; }
    paintPart();
    renderRestore();
  }

  function clearPart() {
    ++partSeq;
    ++probeSeq;
    partNear = null;
    if (!part) return;
    part = null;
    renderPart();
    CSS.highlights.delete('neo-replay-part');
    renderRestore();
  }

  // The part, carried to where the player is, and made whole paragraphs
  // again. Where it isn't in the text (not written yet, or after its
  // chapter went) it stays where it was last seen (`away`) and comes back
  // when the player does.
  function syncPart() {
    if (!part || part.h !== h) return;
    const n = nAt(pos);
    if (part.n !== n) {
      const q = Rec.partMove(h, { ch: part.ch, a: part.a, b: part.b }, part.n, n);
      part.away = !!q.gone && (n < part.n || q.b > q.a); // (gone forward with nothing left: taken out, and shown so)
      if (!part.away) Object.assign(part, { a: q.a, b: q.b, n });
    }
    const c = chapters[part.ch];
    if (c && c.parts.length && part.b > part.a && !part.away) {
      const i = c.find(part.a);
      const j = c.find(part.b - 1);
      part.a = c.startOf(i);
      part.b = c.startOf(j) + c.parts[j].length;
    }
  }

  // Another day in the player: the part goes with it when no day between
  // the two changed its chapter (the next day played on into, ⇧→, a day
  // either side); otherwise it's put down
  function carryPart(from, to) {
    if (!part || !from || part.h !== from || from === to) return;
    const ch = part.ch;
    const a = dayIndex(from.day);
    const b = dayIndex(to.day);
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    if (a < 0 || b < 0 || a === b || S.days.slice(lo + 1, hi).some((d) => d.stats.chapters.includes(ch))) { clearPart(); return; }
    const q = { ch, a: part.a, b: part.b };
    let n = 0;
    if (b > a) {
      Rec.partMove(from, q, part.n, from.steps.length);
      Rec.partSplices(q, Rec.splices(from.end[ch] || '', to.start[ch] || ''), 1);
    } else {
      Rec.partMove(from, q, part.n, 0);
      Rec.partSplices(q, Rec.splices(to.end[ch] || '', from.start[ch] || ''), -1);
      n = to.steps.length;
    }
    if (q.gone && q.b > q.a) { clearPart(); return; }
    part = { ch, a: q.a, b: q.b, h: to, n };
    partNear = null;
  }

  // The paragraphs picked, in the sheet's margins while it's paused: ‹ and
  // restore them on the left, › on the right. Where they aren't in the text
  // at this moment, the badge says so instead.
  function renderPart() {
    const c = part && chapters[part.ch];
    const st = part && part.h === h && !part.away && part.b > part.a && shown[part.ch];
    const nodes = st && c && !st.whole && st.nodes.length === c.parts.length ? st.nodes.slice(c.find(part.a), c.find(part.b - 1) + 1).flat() : [];
    const on = !!nodes.length && !playing && view === 'player';
    partL.hidden = partR.hidden = !on;
    const said = part && part.h === h && view === 'player' ? (part.away ? t('Not in the text at this moment') : part.b <= part.a ? t('Taken out here') : '') : '';
    if (said !== partWas) {
      if (said) { badgeEl.textContent = said; badgeEl.hidden = false; badgeUntil = 0; } else if (badgeEl.textContent === partWas) badgeEl.hidden = true;
      partWas = said;
    }
    // ‹ and ›: off where there's nothing that way (once looked for)
    const near = part && partNear && partNear.key === partKey() ? partNear : null;
    for (const [way, b] of [['prev', partPrev], ['next', partNext]]) {
      const off = !!near && near[way] === null;
      if (b.disabled !== off) b.disabled = off;
    }
    if (!on) return;
    const many = c.find(part.a) !== c.find(part.b - 1);
    const label = many ? t('Restore Paragraphs') : t('Restore This Paragraph');
    partRestore.title = label + ': ' + t('NEO finds them in the book as it is now and puts them back as they are here.') + ' ' + keptWhere();
    partRestore.setAttribute('aria-label', label);
    partRestore.disabled = restoring;
    // beside the paragraphs, kept in sight while they're taller than the sheet's window
    const r = document.createRange();
    r.setStartBefore(nodes[0]);
    r.setEndAfter(nodes[nodes.length - 1]);
    const box = r.getBoundingClientRect();
    const body = nodes[0].parentElement && nodes[0].parentElement.closest('.rp-body');
    const text = (body || paper).getBoundingClientRect();
    const sr = scroller.getBoundingClientRect();
    const top = box.top - sr.top + scroller.scrollTop;
    const y = Math.max(top, Math.min(scroller.scrollTop + 10, top + box.height - partL.offsetHeight));
    partL.style.top = partR.style.top = y + 'px';
    // in words where the margins have room: side by side, else the left
    // pair one above the other, then in short words, then ‹ and ›, then ↺
    // too (both margins in the same words)
    const room = text.left - sr.left - 12;
    const roomR = scroller.clientWidth - (text.right - sr.left + 12) - 2;
    const words = [
      ['‹ ' + t('Earlier version'), label, t('Later version') + ' ›'],
      ['‹ ' + t('Older'), t('Restore'), t('Newer') + ' ›'],
      ['‹', t('Restore'), '›'],
      ['‹', '↺', '›']
    ];
    const fits = () => partL.offsetWidth <= room && partR.offsetWidth <= roomR;
    partL.classList.remove('hs-part-stack');
    for (let k = 0; k < words.length; k++) {
      [partPrev.textContent, partRestore.textContent, partNext.textContent] = words[k];
      if (fits()) break;
      if (k === 0) {
        partL.classList.add('hs-part-stack');
        if (fits()) break;
      }
    }
    partL.style.left = Math.max(2, room - partL.offsetWidth) + 'px';
    partR.style.left = Math.min(text.right - sr.left + 12, scroller.clientWidth - partR.offsetWidth - 2) + 'px';
  }
  scroller.addEventListener('scroll', () => { if (part && !playing) renderPart(); }, { passive: true });

  // The part on the sheet, with the Highlight API: its paragraphs' nodes
  function paintPart() {
    renderPart();
    const hl = new Highlight();
    const st = part && part.h === h && !part.away && shown[part.ch];
    const c = st && chapters[part.ch];
    if (c && !st.whole && part.b > part.a && st.nodes.length === c.parts.length) {
      const nodes = st.nodes.slice(c.find(part.a), c.find(part.b - 1) + 1).flat();
      if (nodes.length) {
        const r = document.createRange();
        r.setStartBefore(nodes[0]);
        r.setEndAfter(nodes[nodes.length - 1]);
        hl.add(r);
      }
    }
    CSS.highlights.set('neo-replay-part', hl);
    probePart();
  }

  let partSaid = 0;
  function partSay(text, ms = 1600) {
    badgeEl.textContent = text;
    badgeEl.hidden = false;
    badgeUntil = performance.now() + ms;
    clearTimeout(partSaid);
    partSaid = setTimeout(() => { if (badgeUntil && performance.now() >= badgeUntil) { badgeEl.hidden = true; badgeUntil = 0; } }, ms + 50);
  }

  // where the part is, which what ‹ and › found from there is kept for
  const partKey = () => (part && h ? [h.key, part.n, part.a, part.b].join(':') : '');

  // The time before the part changed (dir -1), or the next time it did
  // (1), from where it was last seen: in this day, then day by day through
  // the days that changed its chapter. A day's start and the next day's
  // (the cache's day states) say whether the day changed the part at all,
  // so only a day that did is loaded and looked through. { x (the day's
  // History), di, found } or null for none; undefined once stale() says a
  // newer look made this one moot.
  async function partFind(dir, stale) {
    const ch = part.ch;
    let x = h;
    let di = curDay();
    let p = { ch, a: part.a, b: part.b };
    let found = dir > 0 ? Rec.partNext(x, p, part.n) : Rec.partPrev(x, p, part.n);
    // a stop before the player's first moment (Rec.playFrom) can't be shown:
    // the version before it is the day's start, so look before that
    if (dir < 0 && found && lead && found.n < nAt(lead)) {
      found = null;
      p = Rec.partMove(x, { ch, a: part.a, b: part.b }, part.n, 0);
    }
    let cur = (dir > 0 ? x.end[ch] : x.start[ch]) || '';
    const starts = new Map();
    const startOf = async (d) => {
      if (!starts.has(d)) starts.set(d, window.neo.recDayStart(bookId, S.days[d].day).then((r) => (r && r.page) || {}));
      return (await starts.get(d))[ch] || '';
    };
    while (!found && !p.gone && di >= 0) {
      let d = di + dir;
      while (d >= 0 && d < S.days.length && !S.days[d].stats.chapters.includes(ch)) d += dir;
      if (d < 0 || d >= S.days.length) break;
      const st = await startOf(d);
      if (stale() || !bd.isConnected) return undefined;
      if (dir > 0) {
        Rec.partSplices(p, Rec.splices(cur, st), 1); // (one day's end to the next's start: nothing, as a rule)
        const q = { ...p };
        const end = d + 1 < S.days.length ? await startOf(d + 1) : null;
        if (stale() || !bd.isConnected) return undefined;
        if (end !== null && !Rec.partSplices(q, Rec.splices(st, end), 1)) { p = q; cur = end; di = d; continue; }
        x = await loadDay(d);
        if (stale() || !bd.isConnected) return undefined;
        found = Rec.partNext(x, p, 0);
        cur = x.end[ch] || '';
      } else {
        const q = { ...p };
        const list = Rec.splices(st, cur);
        const texts = [];
        list.reduce((html, s) => { const next = Rec.applyEdit(html, s.at, s.del, s.ins); texts.push(next); return next; }, st);
        if (!Rec.partSplices(q, list, -1, (k) => texts[k])) { p = q; cur = st; di = d; continue; }
        x = await loadDay(d);
        if (stale() || !bd.isConnected) return undefined;
        found = Rec.partPrev(x, p, x.steps.length, { strict: false });
        cur = x.start[ch] || '';
      }
      di = d;
    }
    return found ? { x, di, found } : null;
  }

  // Once the player stops, ‹ and › look ahead, so a way with nothing is off
  let partNear = null; // { key, prev, next }: each a partFind's answer
  let probeSeq = 0;
  let probeTimer = 0;
  function probePart() {
    if (!part || playing || view !== 'player' || !h) return;
    const key = partKey();
    if (partNear && partNear.key === key) return;
    clearTimeout(probeTimer);
    partNear = { key };
    const mine = ++probeSeq;
    probeTimer = setTimeout(async () => {
      for (const way of ['prev', 'next']) {
        let r;
        try { r = await partFind(way === 'prev' ? -1 : 1, () => mine !== probeSeq); } catch { r = undefined; }
        if (mine !== probeSeq || !partNear || partNear.key !== key || r === undefined) return;
        partNear[way] = r;
        renderPart();
      }
    }, 150);
  }

  async function partGo(dir) {
    if (!part || !h || view !== 'player') return;
    setPlaying(false);
    syncPart();
    const ch = part.ch;
    const key = partKey();
    const way = dir < 0 ? 'prev' : 'next';
    let r = partNear && partNear.key === key ? partNear[way] : undefined;
    if (r === null) return; // nothing that way: the button is off
    const seq = ++partSeq;
    if (r === undefined) {
      const slow = setTimeout(() => partSay(t('Looking…'), 60000), 300);
      try { r = await partFind(dir, () => seq !== partSeq); } catch (err) {
        window.neo.logError('history part: ' + (err && err.stack || err));
        if (seq === partSeq) partSay(t('The history couldn’t be read.'));
        return;
      } finally {
        clearTimeout(slow);
        if (badgeEl.textContent === t('Looking…')) { badgeEl.hidden = true; badgeUntil = 0; }
      }
      if (seq !== partSeq || !bd.isConnected || r === undefined) return;
      if (!r) {
        if (partNear && partNear.key === key) partNear[way] = null; else partNear = { key, [way]: null };
        renderPart();
        return;
      }
    }
    const { x, di, found } = r;
    if (h.key !== x.key) {
      part = null; // (found where it is there: not carried)
      await openPlayer(S.days[di].from);
      if (seq !== partSeq || !h || h.key !== x.key) return;
    }
    part = { ch, a: found.part.a, b: found.part.b, h, n: found.n };
    let q = 0;
    while (q < steps.length && steps[q] < found.n) q++;
    seek(q);
  }

  for (const [b, label, says, key, go] of [
    [partPrev, t('Earlier version'), t('Back to how this read before it last changed'), '[', () => partGo(-1)],
    [partNext, t('Later version'), t('On to how this reads after it next changes'), ']', () => partGo(1)]]) {
    b.title = label + ': ' + says + ' (' + key + ')';
    b.setAttribute('aria-label', label);
    b.addEventListener('click', () => go());
  }
  partRestore.addEventListener('click', () => { if (!restoring && restoreTarget(true)) restoreParagraphs(); });

  /* ---------- tags: names on moments ---------- */

  // A tag is one line in the recording (Rec.tagsOf): one the writer named,
  // or one NEO made for a snapshot or just before a restore. Made, renamed
  // and removed here by a new line in the session being recorded, so only
  // while this book is open and recording.
  const canTag = () => !!(rec.on && rec.bookId === bookId && book && book.id === bookId);
  // (History is hidden while Writing History is off, so off is no reason here)
  const tagWhy = () => t('Open this book to tag its moments.');
  // the tags written since the history was read, until it's read again
  let localTags = [];
  function computeTags() {
    const local = { id: ':local', device: ':local', day: null, stats: { tags: localTags } };
    tags = Rec.tagsOf([...S.sessions, local]);
    tagsByDay = new Map();
    for (const tg of tags) {
      if (!tagsByDay.has(tg.day)) tagsByDay.set(tg.day, []);
      tagsByDay.get(tg.day).push(tg);
    }
  }
  // a tag as it's shown: its name, or what NEO made it for
  function tagName(tg) {
    if (tg.label) return tg.label;
    const m = tg.made || {};
    if (m.snapshot) {
      const s = parseSnapName(String(m.snapshot));
      return s && snapWhy(s.kind) ? t('Snapshot · {why}', { why: snapWhy(s.kind) }) : t('Snapshot');
    }
    if (Array.isArray(m.restore)) return historyRestoreTag(Date.parse(m.restore[3]));
    if (m.from) return m.from.kind === 'feedback' ? t('Feedback · {app}', { app: String(m.from.app) }) : t('Note · {app}', { app: String(m.from.app) });
    return t('Tagged');
  }
  const tagWhen = (tg) => (tg.when !== null ? snapWhen(tg.when) : historyWhen(historyDayMs(tg.day), HISTORY_DATE));
  const tagMoment = (tg) => [...tg.at, new Date(tg.when !== null ? tg.when : historyDayMs(tg.day)).toISOString()];

  // A line for a tag, written now, and seen at once
  function writeTag(label, at, made, id, note = null) {
    const tg = rec.tag(label, at, made, id, note);
    if (!tg) return null;
    const x = { id: tg.id, label, at, made: made || null, wall: Date.now(), line: tg.ref[1] };
    if (typeof note === 'string' && note) x.note = note;
    localTags.push(x);
    computeTags();
    if (noteShown) { const now = tags.find((y) => y.id === noteShown); if (now && now.note) showTagNote(now); else hideTagNote(); }
    renderList();
    renderStrip();
    if (view === 'player' && h) { buildMarkers(); drawTimeline(); renderDayline(); }
    return tg;
  }

  // Tag This Moment… (or ⌘S in History): a name for the moment on the sheet
  let tagAsking = false;
  async function tagHere() {
    if (!h || !steps.length || tagAsking || !bd.isConnected) return;
    setPlaying(false);
    if (!canTag()) { toast(tagWhy(), 5000); return; }
    // a moment is a line of the recording: inside a typing run, the run's
    // end. The sheet goes there first, so what's tagged is what's shown.
    if (view === 'player') {
      const n = Rec.momentStep(h, momentRef().ref);
      let p = 0;
      while (p < steps.length && steps[p] < n) p++;
      if (p !== pos) seek(p);
    }
    const { ref, wall } = momentRef();
    tagAsking = true;
    const said = await askTagNote({ title: t('Tag this moment'), namePlaceholder: t('Draft 2, Sent to my agent…') });
    tagAsking = false;
    if (!bd.isConnected) return;
    bd.focus();
    const name = said && said.name;
    if (!name) return;
    const tg = writeTag(name, [...ref, new Date(wall).toISOString()], null, undefined, said.note || null);
    if (!tg) { toast(t('NEO couldn’t tag this moment.')); return; }
    toast((await tg.saved) ? t('Tagged “{name}”, {when}.', { name, when: snapWhen(wall) }) : t('NEO couldn’t save the tag yet. It tries again with the next save.'), 4000);
  }
  function renderTagBtn() {
    const show = !!h && steps.length > 0 && !playing && (view === 'player' || view === 'days');
    tagBtn.hidden = !show;
    if (!show) return;
    const ok = canTag();
    tagBtn.classList.toggle('hs-off', !ok);
    tagBtn.title = ok ? t('A name for this moment, to come back to') + ' (' + (IS_MAC ? '⌘S' : 'Ctrl+S') + ')' : tagWhy();
  }
  tagBtn.textContent = t('Tag This Moment…');
  tagBtn.addEventListener('click', () => tagHere());
  close.tag = () => tagHere();

  // A tag picked: its moment in the player, paused. In one chapter's view
  // when that chapter was written that day, else in the whole book.
  async function goTag(tg) {
    const i = S.sessions.findIndex((s) => s.id === tg.at[0] && s.device === tg.at[2]);
    if (i < 0) return;
    const d = S.days[S.sessions[i].di];
    await openPlayer(i, { ch: mode !== 'book' && d && d.stats.chapters.includes(mode) ? null : 'book' });
    if (!h || h.day !== S.sessions[i].day) return;
    const n = Rec.momentStep(h, tg.at);
    if (n < 0) return;
    let p = 0;
    while (p < steps.length && steps[p] < n) p++;
    seek(p);
    renderList();
    if (tg.note) showTagNote(tg); else hideTagNote();
  }

  // A tag's note, in a bar above the sheet once the tag is picked: its
  // first lines, and Read All for the whole of it. Always plain text.
  const noteBar = $h('.hs-note-bar');
  let noteShown = null; // the id of the tag whose note is in the bar
  // above a note another program left: who it's from, as that program
  // says (NEO doesn't vouch for it), and what it's about
  const noteHead = (tg) => {
    const f = tg.made && tg.made.from;
    if (!f) return [];
    const at = Date.parse(f.at);
    const out = [Number.isFinite(at) ? t('As given by {app}, {when}', { app: String(f.app), when: snapWhen(at) }) : t('As given by {app}', { app: String(f.app) })];
    if (f.model) out.push(t('Model: {model}', { model: String(f.model) }));
    if (f.pasted) out.push(t('Pasted in by the writer'));
    if (f.chapter && meta.chapterOrder.includes(f.chapter)) out.push(t('About {chapter}', { chapter: chapterName(f.chapter, meta) }));
    if (f.since) out.push(t('The chapter had changed by the time NEO recorded this.'));
    return out;
  };
  function showTagNote(tg) {
    noteShown = tg.id;
    const head = noteHead(tg);
    $h('.hs-note-head').textContent = [tagName(tg), ...head].join(' · ');
    $h('.hs-note-body').textContent = tg.note;
    noteBar.hidden = false;
  }
  function hideTagNote() { noteShown = null; noteBar.hidden = true; }
  $h('.hs-note-all').textContent = t('Read All');
  $h('.hs-note-x').title = t('Close');
  $h('.hs-note-x').setAttribute('aria-label', t('Close'));
  $h('.hs-note-x').addEventListener('click', () => hideTagNote());
  $h('.hs-note-all').addEventListener('click', () => {
    const tg = tags.find((x) => x.id === noteShown);
    if (tg && tg.note) showNoteModal(tagName(tg), noteHead(tg), tg.note);
  });
  // a note another program left (Draft Sleuth's feedback) is its file's:
  // renamed or removed in History, never edited
  const noteFromOutside = (tg) => !!(tg.made && tg.made.from);

  // the tags in the side pane, newest first: each a way to its moment, and
  // its right-click menu renames or removes it
  function renderTagList() {
    if (!tags.length) return;
    const hd = document.createElement('div');
    hd.className = 'hs-list-head';
    hd.textContent = t('Tags');
    list.appendChild(hd);
    for (const tg of tags.slice().reverse()) {
      const b = item(tagName(tg), [tagWhen(tg), deviceName(tg.at[2])].filter(Boolean).join(' · '), false, () => goTag(tg));
      b.classList.add('hs-tag-item');
      // a tag with a note: a mark before its name (styles.css)
      b.classList.toggle('hs-has-note', !!tg.note);
      b.title = [tg.note ? t('This tag has a note') : '', canTag() ? t('Right-click to rename or remove it') : ''].filter(Boolean).join('. ');
      b.addEventListener('contextmenu', async (e) => {
        e.preventDefault();
        const choice = await popMenu(e.clientX, e.clientY, [
          { label: t('Go to This Moment'), value: 'go' },
          '-',
          { label: tg.label ? t('Rename…') : t('Name…'), value: 'rename', disabled: !canTag() },
          ...(noteFromOutside(tg) ? [] : [{ label: tg.note ? t('Edit Note…') : t('Add a Note…'), value: 'note', disabled: !canTag() }]),
          { label: t('Remove Tag'), value: 'remove', disabled: !canTag(), danger: true }
        ], { title: tagName(tg) });
        if (choice === 'go') goTag(tg);
        else if (choice === 'rename') {
          const name = await askInput(escHtml(t('Name this tag')), escHtml(tagName(tg)), tg.label || '');
          bd.focus();
          if (name && name !== tg.label && !writeTag(name, tagMoment(tg), tg.made, tg.id, tg.note)) toast(t('NEO couldn’t tag this moment.'));
        } else if (choice === 'note') {
          const said = await askTagNote({ title: tagName(tg), named: false, note: tg.note || '' });
          bd.focus();
          if (said && said.note !== (tg.note || '') && !writeTag(tg.label, tagMoment(tg), tg.made, tg.id, said.note || null)) toast(t('NEO couldn’t tag this moment.'));
        } else if (choice === 'remove') {
          if (!writeTag(false, tagMoment(tg), tg.made, tg.id)) toast(t('NEO couldn’t tag this moment.'));
          // (a snapshot keeps its files: only its name in History goes)
          else toast(tg.made && tg.made.snapshot ? t('The tag is gone from Writing History. The snapshot itself is still on the Darlings tab.') : t('The tag is gone. The moment itself is still in Writing History.'), 5000);
        }
      });
    }
  }

  // the tags of the day in the player, on its timeline
  function tagMarkers() {
    for (const tg of tagsByDay.get(h.day) || []) {
      const n = Rec.momentStep(h, tg.at);
      if (n < 0) continue;
      let j = 0;
      while (j < steps.length && steps[j] < n) j++;
      markers.push({ x: j ? vt[j - 1] : 0, kind: 'tag', label: tagName(tg), step: j ? steps[j - 1] : 0 });
    }
  }

  // Watch from Here (a snapshot's, on the Darlings tab): the player at its
  // tag; a snapshot without one (taken while nothing recorded) at the first
  // day from then on, or the history's first day for one older than it
  function watchSnapshot(s) {
    const tg = tags.find((x) => x.made && x.made.snapshot === s.name);
    if (tg) { goTag(tg); return; }
    const day = writingDay(new Date(s.at));
    let di = S.days.findIndex((d) => d.day >= day);
    if (di < 0) di = S.days.length - 1;
    if (di >= 0) openPlayer(S.days[di].from);
  }

  /* ---------- the list of chapters ---------- */

  function renderList() {
    list.innerHTML = '';
    renderChapters();
  }

  const item = (label, sub, selected, onPick) => {
    const b = document.createElement('button');
    b.className = 'hs-ch';
    b.setAttribute('role', 'option');
    b.setAttribute('aria-selected', String(selected));
    b.innerHTML = '<span class="hs-ch-name"></span><span class="hs-ch-when"></span>';
    b.firstChild.textContent = label;
    b.lastChild.textContent = sub;
    if (onPick) b.addEventListener('click', onPick);
    else b.disabled = true; // a chapter with nothing recorded has nothing to play
    list.appendChild(b);
    return b;
  };

  function renderChapters() {
    // each chapter the recording saw: the days it was first and last written
    const seen = new Map();
    for (const s of S.sessions) {
      for (const ch of Object.keys(s.stats.chapters)) {
        let x = seen.get(ch);
        if (!x) { x = { ch, first: s.stats.start, last: s.stats.start }; seen.set(ch, x); }
        x.last = s.stats.start;
      }
    }
    const span = (c) => {
      const a = historyWhen(c.first, HISTORY_DAY);
      const b = historyWhen(c.last, HISTORY_DAY);
      return a === b ? a : a + ' – ' + b;
    };
    item(t('The whole book'), S.sessions.length ? t('{n} sessions', { n: S.sessions.length }) : '', mode === 'book', () => setMode('book'));
    // the chapters in the book at the moment shown, in its order then: they
    // come and go as the sheet plays through a merge or a delete. The one
    // picked stays, dimmed, at a moment it isn't there.
    const { ids, order } = listedChapters();
    listKey = ids.join(',');
    const absent = mode !== 'book' && !ids.includes(mode) && seen.has(mode);
    for (const ch of absent ? [...ids, mode] : ids) {
      const c = seen.get(ch);
      const b = item(listLabel(ch, order), c ? span(c) : t('Not recorded yet'), mode === ch, c ? () => setMode(ch) : null);
      b.dataset.ch = ch;
      if (absent && ch === mode) b.classList.add('hs-ch-absent');
    }
    markChapters();
    renderTagList();
  }

  // the chapters at the moment on the sheet (the book as it is now until a
  // day is loaded), and the order they're named in. A chapter the recording
  // never saw is there throughout.
  function listedChapters() {
    if (!h) return { ids: meta.chapterOrder.slice(), order: meta.chapterOrder };
    const order = h.order(nAt(pos)) || dayOrder();
    const untouched = S.untouched || [];
    const ids = order.filter((ch) => chapters[ch] !== undefined || untouched.includes(ch));
    for (const ch of Object.keys(chapters)) if (!ids.includes(ch) && !Rec.isStream(ch)) ids.push(ch);
    for (const ch of untouched) if (!ids.includes(ch)) ids.push(ch);
    return { ids, order };
  }

  // a chapter's name in the list: one no longer in the book has no title
  // now, so its first words name it
  function listLabel(ch, order) {
    const label = chapterLabel(ch, order);
    const lead = meta.chapterOrder.includes(ch) || ((meta.chapterTitles || {})[ch] || '').trim() ? '' : goneLead(ch);
    if (!lead) return label;
    const m = { ...meta, chapterOrder: order.includes(ch) ? order : [...order, ch] };
    return chapterKind(ch, m) === 'unnumbered' ? lead : label + ' — ' + lead;
  }

  // the whole book, or one chapter: the overview marks it, the player plays only it
  function setMode(m) {
    const di = curDay();
    mode = m;
    if (part && m !== 'book' && part.ch !== m) clearPart();
    // the days: the chapter, or the book, as it is now
    if (view === 'days') {
      following = true;
      reindex();
      return;
    }
    if (!h) return;
    renderStrip();
    const n = nAt(pos);
    const atEnd = pos >= steps.length;
    // a chapter this day didn't touch: the nearest day that did, before or after
    if (m !== 'book' && !h.chapters().some((c) => c.ch === m)) {
      const to = dayAfter(di, -1) >= 0 ? dayAfter(di, -1) : dayAfter(di, 1);
      renderList();
      if (to >= 0) openPlayer(S.days[to].from, { at: 'end' });
      return;
    }
    renderDayline();
    shown = {};
    paper.innerHTML = '';
    buildView();
    // the same moment, in the new view
    let p = 0;
    if (atEnd) p = steps.length;
    else while (p < steps.length && steps[p] < n) p++;
    seek(p);
    drawTimeline();
    renderList();
    if (m === 'book') scrollToChapter(caret && caret.chId);
  }

  function scrollToChapter(ch) {
    const sec = ch && paper.querySelector(`.rp-chapter[data-ch="${CSS.escape(ch)}"]`);
    if (!sec) return;
    follow = false;
    scroller.scrollTop = sec.offsetTop - 20;
  }

  /* ---------- the recording itself ---------- */

  // Every device's sessions, as one history: the devices that wrote it are
  // named where a day or a session is
  async function load() {
    setPlaying(false);
    loaded = { state: 'loading' };
    h = null;
    ++token;
    dayLoads = new Map();
    following = true;
    Object.assign(S, { entries: [], open: [], days: [], sessions: [], frames: [], building: false, built: null, listed: false, error: null, done: 0, total: 0 });
    localTags = [];
    setView('days');
    let devices = [];
    try {
      if (rec.on && rec.bookId === bookId) rec.flush();
      devices = ((await window.neo.recList(bookId)) || []).filter((d) => d.sessions.length);
    } catch (err) {
      window.neo.logError('history: ' + (err && err.stack || err));
      S.error = String(err && err.message || err);
    }
    if (!bd.isConnected) return;
    S.devices = devices;
    S.names = {};
    for (const d of devices) S.names[d.device] = d.mine ? t('{name} (this computer)', { name: d.name }) : d.name;
    if (!devices.length) {
      reindex();
      return;
    }
    S.building = true;
    try {
      const r = await window.neo.recDays(bookId);
      if (!bd.isConnected) return;
      for (const e of r.entries || []) if (!S.entries.some((x) => x.day === e.day)) S.entries.push(e);
      S.entries.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
    } catch (err) {
      window.neo.logError('history: ' + (err && err.stack || err));
      S.error = String(err && err.message || err);
      S.building = false;
      loaded = { state: 'failed', error: S.error };
    }
    if (!bd.isConnected) return;
    S.listed = true;
    if (S.built) built(); else reindex();
  }
  setPlaying(false);
  setView('days');
  paper.innerHTML = `<p class="hs-empty">${escHtml(t('Reading the history…'))}</p>`;
  renderList();
  resize.observe(scroller);
  resize.observe(timeline);
  await load();
}
