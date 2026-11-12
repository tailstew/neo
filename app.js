/* =============================== NEO =============================== */

'use strict';

// ---------- interface language (see i18n.js and locales/) ----------
// The English text is the key: t('Cancel') shows the translation when the
// chosen language has one, and the English original otherwise.
(() => {
  const l = (window.neo && window.neo.i18n) || {};
  NeoI18n.setLocale(l.locale || 'en', l.dict || {}, l.base || {});
})();
const { t, fmtNum, fmtDate } = NeoI18n;

// index.html marks its words with data-i18n (text), data-i18n-title,
// data-i18n-placeholder and data-i18n-ph (the empty-field hints)
function applyStaticI18n(root = document) {
  document.documentElement.lang = NeoI18n.getLocale();
  root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.textContent.replace(/\s+/g, ' ').trim()); });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => { if (el.title) el.title = t(el.title); });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.placeholder = t(el.placeholder); });
  root.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.dataset.ph = t(el.dataset.ph); });
  // names for screen readers, where a symbol or a placeholder is all the eye gets
  root.querySelectorAll('[data-i18n-label]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.i18nLabel)); });
  // hints that styles.css draws with ::before read these custom properties
  const cssHints = {
    '--ph-add-title': t('add a title'),
    '--ph-write-freely': t('Write freely…'),
    '--ph-ol-chapter': t('What happens in this chapter…'),
    '--ph-ol-section': t('What happens in this section…'),
    '--ph-nav-note': t('What happens here…')
  };
  for (const [name, text] of Object.entries(cssHints)) {
    document.documentElement.style.setProperty(name, JSON.stringify(text));
  }
}
applyStaticI18n();

// Books keep the title they were created with, so "Untitled" may be stored
// in any language: both the English word and the current one count.
// tk() marks a string for translation where it is defined and t() is
// applied later, when it is shown
const tk = (s) => s;

// The Notes and Outline tabs keep their default names in English and show
// them in the current language; a name the writer chose shows as written.
const tabName = (kind) => {
  const n = (book && book.tabNames && book.tabNames[kind]) || (kind === 'notes' ? 'Notes' : kind === 'outline' ? 'Outline' : kind);
  return n === 'Notes' || n === 'Outline' ? t(n) : n;
};

// What each entry in the Chapters pane is. Every entry is a chapter unless
// the writer makes it something else (right-click its box, or add one with
// the faint + between boxes): a page a published book carries, a part, a
// prologue or an epilogue. book.chapterKinds holds the ones that aren't
// chapters. Chapters are numbered; parts are numbered on their own; the rest
// go by their names. An unnumbered chapter is a chapter that goes by its
// title alone and stays out of the count — a run of named chapters before
// the numbering starts, say. Prologues, epilogues and chapters (numbered or
// not) are the story: they count toward the words. book.restartNumbering
// starts the chapter count again at 1 after every part.
const CHAPTER_KINDS = ['copyright', 'dedication', 'epigraph', 'contents', 'prologue', 'part', 'chapter', 'unnumbered', 'epilogue', 'acknowledgments', 'about'];
const STORY_KINDS = ['chapter', 'unnumbered', 'prologue', 'epilogue'];
// what comes after the story, where a new chapter never goes
const BACK_KINDS = ['epilogue', 'acknowledgments', 'about'];
function chapterKind(chId, meta = book) {
  const k = meta && meta.chapterKinds && meta.chapterKinds[chId];
  if (k && CHAPTER_KINDS.includes(k)) return k;
  // NEO 1.0 kept a prologue and an epilogue as roles of the first and last
  // chapters (a book not opened since reads that way until it is)
  const order = (meta && meta.chapterOrder) || [];
  if (order.length >= 2) {
    if (meta.prologue === chId && order[0] === chId) return 'prologue';
    if (meta.epilogue === chId && order[order.length - 1] === chId) return 'epilogue';
  }
  return 'chapter';
}
const isStory = (chId, meta = book) => STORY_KINDS.includes(chapterKind(chId, meta));
// a prologue or an epilogue: story that stands outside the numbering
function chapterRole(chId, meta = book) {
  const k = chapterKind(chId, meta);
  return k === 'prologue' || k === 'epilogue' ? k : null;
}
// a chapter's number counts chapters only; a part's, parts only
function kindCount(chId, kind, meta = book) {
  let n = 0;
  for (const c of meta.chapterOrder) {
    const k = chapterKind(c, meta);
    if (k === kind) n++;
    // numbering that restarts with each part
    else if (kind === 'chapter' && k === 'part' && meta.restartNumbering) n = 0;
    if (c === chId) break;
  }
  return n;
}
const chapterNumber = (chId, meta = book) => kindCount(chId, 'chapter', meta);
function chapterName(chId, meta = book) {
  const k = chapterKind(chId, meta);
  if (k === 'chapter') return t('Chapter {n}', { n: chapterNumber(chId, meta) });
  if (k === 'part') return partLabel(kindCount(chId, 'part', meta));
  // an unnumbered chapter is its title
  if (k === 'unnumbered') return ((meta.chapterTitles || {})[chId] || '').trim() || t('Untitled');
  return kindName(k);
}
// the chapter a note sits in, for the notes pane: its name, or for an
// unnumbered chapter with no title (whose name would be Untitled), its
// opening words (#346)
function stickyChapterLabel(chId) {
  if (chapterKind(chId) !== 'unnumbered' || ((book.chapterTitles || {})[chId] || '').trim()) return chapterName(chId);
  const words = chapterText(chId).replace(/\s+/g, ' ').trim();
  if (!words) return t('Untitled');
  return words.length > 32 ? words.slice(0, 30).replace(/\s+\S*$/, '') + '…' : words;
}
// a chapter's heading as the reader sees it: its name, then any title —
// once, for an unnumbered chapter, whose name is its title
// The dash between a chapter's number and its title follows the book's
// language: an en dash where that's how the language sets its dash
// (KAPITEL 2 – SZENENWECHSEL), the em dash elsewhere (CHAPTER 2 — TITLE)
const EN_DASH_LANGUAGES = ['de', 'nl', 'pl', 'ro', 'fr', 'it', 'hu'];
function headingDash() {
  return EN_DASH_LANGUAGES.includes(writingLanguage().toLowerCase().split('-')[0]) ? '–' : '—';
}
function chapterHeading(chId, meta = book, sep = ' ' + headingDash() + ' ') {
  const title = ((meta.chapterTitles || {})[chId] || '').trim();
  const k = chapterKind(chId, meta);
  if (k === 'unnumbered') return title;
  if (!title) return chapterName(chId, meta);
  return library.exportCustomChapterTitles ? title : chapterName(chId, meta) + sep + title;
}
function kindName(kind) {
  if (kind === 'chapter') return t('Chapter');
  if (kind === 'unnumbered') return t('Unnumbered Chapter');
  if (kind === 'contents') return t('Contents');
  return pageKindName(kind);
}
// where there's only room for a number: a chapter's, a part's in roman
// numerals, and a fleuron for the rest
function chapterMark(chId, meta = book) {
  const k = chapterKind(chId, meta);
  if (k === 'chapter') return String(chapterNumber(chId, meta));
  if (k === 'part') return roman(kindCount(chId, 'part', meta));
  return '❦';
}
// how many numbered chapters the book has — or, when numbering restarts
// with each part, how many share chId's part
function numberedChapters(meta = book, chId = null) {
  let n = 0, total = 0, found = false;
  for (const c of meta.chapterOrder) {
    const k = chapterKind(c, meta);
    if (k === 'part' && meta.restartNumbering && chId) {
      if (found) break;
      n = 0;
    }
    if (c === chId) found = true;
    if (k === 'chapter') { n++; total++; }
  }
  return chId && meta.restartNumbering ? n : total;
}
// A story of one chapter is just "the story": no heading, no number, until a
// second chapter (or a prologue, an epilogue or a part) joins it. The pages
// around it don't count.
function soloStory(meta = book) {
  const story = meta.chapterOrder.filter((c) => isStory(c, meta) || chapterKind(c, meta) === 'part');
  return story.length === 1 && chapterKind(story[0], meta) === 'chapter' ? story[0] : null;
}
// NEO 1.0's roles become kinds the first time a book opens here, and a kind
// whose entry is gone is let go
function settleChapterKinds() {
  let changed = false;
  for (const role of ['prologue', 'epilogue']) {
    if (!(role in book)) continue;
    const id = book[role];
    if (chapterKind(id) === role) (book.chapterKinds = book.chapterKinds || {})[id] = role;
    delete book[role];
    changed = true;
  }
  for (const id of Object.keys(book.chapterKinds || {})) {
    const k = book.chapterKinds[id];
    if (!book.chapterOrder.includes(id) || k === 'chapter' || !CHAPTER_KINDS.includes(k)) {
      delete book.chapterKinds[id];
      changed = true;
    }
  }
  if (changed) scheduleMetaSave();
}
function setChapterKind(chId, kind) {
  book.chapterKinds = book.chapterKinds || {};
  if (kind === 'chapter') delete book.chapterKinds[chId];
  else book.chapterKinds[chId] = kind;
}

const isUntitled = (s) => !s || s === 'Untitled' || s === t('Untitled');
// a title as the writer reads it: the untitled default in the current language
const shownTitle = (s) => (isUntitled(s) ? t('Untitled') : s);

// ---------- state ----------
let library = null;          // library.json
let book = null;             // current book.json
let chapterHTML = {};        // chapterId -> html (loaded at open)
let savedHTML = {};          // chapterId -> html as last read from / written to disk
let savedMetaSig = '';       // book.json as last read/written, minus the volatile bits
let diskStamps = {};         // chapterId -> file mtime as of the last look at the disk
let writing = {};            // chapterId -> chapter writes still on their way to disk
let stickies = [];           // [{id, chapterId, text, resolved}]
let darlings = [];           // [{id, html, text, chapterId, chapterLabel, date}]
let currentTab = 'manuscript';
let currentChapterId = null; // chapter the caret/scroll is in
let wordMode = 'book';       // 'book' | 'chapter'
let saveTimers = {};

// Every library.json write from this window goes through here. A look at the
// disk (refreshFromDisk) can then tell its own writes from another device's:
// a read that a write here crossed, or that finished while one was still on
// its way, is older than the library in memory and must not replace it.
let libraryGeneration = 0;
let libraryWritesPending = 0;
function writeLibrary(lib = library) {
  rememberDeviceLook(lib);
  libraryGeneration++;
  libraryWritesPending++;
  return new Promise((resolve) => resolve(window.neo.writeLibrary(lib)))
    .finally(() => { libraryWritesPending--; });
}

// How NEO looks is each device's own: dark on the iPad, light on the PC.
// These settings are kept on the device as well as in library.json. The
// library's copy is the last device's, so a device opening the library for
// the first time starts out the way the writer last had it, and from then on
// keeps its own.
const DEVICE_LOOK = ['pageTheme', 'uiBright', 'uiBrightAside', 'uiZoom', 'editorFontSize', 'typewriter', 'focus', 'posMode', 'outlineView', 'vimKeys'];
const DEVICE_LOOK_KEY = 'neo-device-look';
function deviceLookOf(lib) {
  const out = {};
  for (const k of DEVICE_LOOK) if (lib && lib[k] !== undefined) out[k] = lib[k];
  return out;
}
function rememberDeviceLook(lib) {
  try { localStorage.setItem(DEVICE_LOOK_KEY, JSON.stringify(deviceLookOf(lib))); } catch { /* storage can be off */ }
}
// a library read from disk takes this device's look, or (on a device new to
// it) gives this device the look it carries
function applyDeviceLook(lib) {
  if (!lib) return lib;
  let mine = null;
  try { mine = JSON.parse(localStorage.getItem(DEVICE_LOOK_KEY) || 'null'); } catch { /* none kept */ }
  if (!mine || typeof mine !== 'object') { rememberDeviceLook(lib); return lib; }
  for (const k of DEVICE_LOOK) {
    if (mine[k] !== undefined) lib[k] = mine[k];
    else delete lib[k];
  }
  return lib;
}

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// The counters change as the writer types. Swapping their text node (what
// `textContent =` does, even for the same words) ends the engine's undo run,
// and ⌘Z then took back one letter at a time (#241). Changing the node's own
// text leaves the run alone.
function setText(el, text) {
  const node = el.firstChild;
  if (node && node.nodeType === Node.TEXT_NODE && !node.nextSibling) {
    if (node.data !== text) node.data = text;
  } else if (el.textContent !== text) {
    el.textContent = text;
  }
}

// Platform-aware key labels: Macs read ⌘⇧X, everyone else reads Ctrl+Shift+X
const IS_MAC = navigator.platform.toLowerCase().includes('mac');
const IS_LINUX = !IS_MAC && /linux/i.test(navigator.platform) && !window.Capacitor;
// a touch screen (Pocket): nothing to hover, no right button
const NO_HOVER = !!(window.matchMedia && window.matchMedia('(hover: none)').matches) || !!window.Capacitor;
// NEO Pocket (the Android and iOS shell)
const IS_POCKET = !!window.Capacitor;

// Touch has no right-click: a long press on a book, a shelf name or a chapter
// heading opens the same menu. Not inside the text itself — there a long
// press belongs to the system's own selection handles.
(() => {
  let timer = null;
  let start = null;
  let swallowClick = false;
  let armed = false; // held long enough; the menu opens when the finger lifts
  document.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    const target = e.target;
    if (!target.closest) return;
    // shelf names are editable on tap, but a long press on one is a menu
    if (target.closest('[contenteditable="true"], input, textarea')) return;
    if (target.closest('#pocket-chapters')) return;
    const p = e.touches[0];
    start = { x: p.clientX, y: p.clientY, target };
    armed = false;
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; armed = true; }, 550);
  }, { passive: true });
  const cancel = () => { clearTimeout(timer); timer = null; armed = false; };
  document.addEventListener('touchmove', (e) => {
    if (!start) return;
    const p = e.touches[0];
    if (Math.hypot(p.clientX - start.x, p.clientY - start.y) > 10) cancel();
  }, { passive: true });
  document.addEventListener('touchend', () => {
    if (armed && start) {
      // iOS usually sends no click after a long press; when it does, it
      // comes at once — so the guard lifts itself before the menu's first tap
      swallowClick = true;
      setTimeout(() => { swallowClick = false; }, 300);
      const { target, x, y } = start;
      setTimeout(() => target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y })), 30);
    }
    cancel();
  }, { passive: true });
  document.addEventListener('touchcancel', cancel, { passive: true });
  // the tap that ends a long press must not also open the book
  document.addEventListener('click', (e) => {
    if (!swallowClick) return;
    swallowClick = false;
    e.stopPropagation();
    e.preventDefault();
  }, true);
})();
const K = (mac, pc) => (IS_MAC ? mac : pc);
const KZ = K('⌘Z', 'Ctrl+Z');
const KPH = K('⌘⇧X', 'Ctrl+Shift+X');
const KDA = K('⌘⇧D', 'Ctrl+Shift+D');
const KHELP = K('⌘/', 'Ctrl+/');

// Scrollbars stay out of sight until they're wanted, then wait for you:
// they show while scrolling, whenever the pointer comes near the right edge
// of anything that scrolls, and the whole time one is held; they fade a
// moment after the pointer leaves (#341: one used to vanish on the way to
// it). Touch screens scroll with a finger and never show them.
function showScrollbar(el, ms = 1200) {
  el.classList.add('show-scrollbar');
  clearTimeout(el._neoSbHide);
  if (ms) el._neoSbHide = setTimeout(() => { if (!el._neoSbHeld && !el._neoSbNear) el.classList.remove('show-scrollbar'); }, ms);
}
document.addEventListener('scroll', (e) => {
  const el = e.target;
  if (!el || !el.classList) return;
  showScrollbar(el);
}, true);
// what scrolls under the pointer, if the pointer is in its scrollbar's strip
function scrollbarUnder(e) {
  for (let el = e.target; el && el !== document.documentElement; el = el.parentElement) {
    if (el.nodeType !== 1 || el.scrollHeight <= el.clientHeight + 1) continue;
    const oy = getComputedStyle(el).overflowY;
    if (oy !== 'auto' && oy !== 'scroll') continue;
    const r = el.getBoundingClientRect();
    return e.clientX >= r.right - 24 && e.clientX <= r.right ? el : null;
  }
  return null;
}
let sbNear = null;
let sbFrame = 0;
document.addEventListener('mousemove', (e) => {
  if (sbFrame) return;
  sbFrame = requestAnimationFrame(() => {
    sbFrame = 0;
    const el = scrollbarUnder(e);
    if (el === sbNear) return;
    if (sbNear) { sbNear._neoSbNear = false; showScrollbar(sbNear); }
    sbNear = el;
    if (el) { el._neoSbNear = true; showScrollbar(el, 0); }
  });
}, { passive: true });
document.addEventListener('mousedown', (e) => {
  const el = scrollbarUnder(e);
  if (!el) return;
  el._neoSbHeld = true;
  showScrollbar(el, 0);
  const up = () => { el._neoSbHeld = false; showScrollbar(el); window.removeEventListener('mouseup', up, true); };
  window.addEventListener('mouseup', up, true);
}, true);

function askInput(title, placeholder, value = '') {
  return new Promise((resolve) => {
    const bd = document.createElement('div');
    bd.className = 'modal-backdrop';
    bd.innerHTML = `
      <div class="modal" style="width:380px">
        <h2 style="font-size:16px">${title}</h2>
        <input type="text" spellcheck="false" placeholder="${placeholder}" />
        <div style="text-align:right;margin-top:14px">
          <button class="m-cancel btn-quiet" style="margin-right:10px">${t('Cancel')}</button>
          <button class="m-ok btn-gold">${t('OK')}</button>
        </div>
      </div>`;
    document.body.appendChild(bd);
    const input = bd.querySelector('input');
    input.value = value;
    input.focus();
    input.select();
    const done = (val) => { bd.remove(); resolve(val); };
    bd.querySelector('.m-ok').onclick = () => done(input.value.trim());
    bd.querySelector('.m-cancel').onclick = () => done(null);
    input.onkeydown = (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Enter') done(input.value.trim());
      // the prompt is gone by the time Esc bubbles up, so without this the
      // editor's own Esc would close the book too
      if (e.key === 'Escape') { e.stopPropagation(); done(null); }
    };
  });
}

// A yes or no that says, point by point, what will happen. With `phrase`,
// the writer types it before the button works: for what can't be taken
// back from inside NEO. True on yes.
function confirmModal({ title, points = [], ok, danger = false, phrase = '' }) {
  return new Promise((resolve) => {
    const bd = document.createElement('div');
    bd.className = 'modal-backdrop confirm-modal';
    const typeIt = phrase
      ? escHtml(t('To confirm, type {phrase} below.', { phrase: '\u0000' })).replace('\u0000', '<strong></strong>')
      : '';
    bd.innerHTML = `
      <div class="modal" role="alertdialog" aria-modal="true" style="width:460px">
        <h2 style="font-size:16px"></h2>
        <ul class="cm-points">${points.map(() => '<li></li>').join('')}</ul>
        ${phrase ? `<p class="cm-type">${typeIt}</p><input type="text" spellcheck="false" autocomplete="off">` : ''}
        <div style="text-align:right;margin-top:16px">
          <button class="m-cancel btn-quiet" style="margin-right:10px">${t('Cancel')}</button>
          <button class="m-ok ${danger ? 'btn-danger' : 'btn-gold'}"></button>
        </div>
      </div>`;
    bd.querySelector('h2').textContent = title;
    bd.querySelector('.modal').setAttribute('aria-label', title);
    bd.querySelectorAll('.cm-points li').forEach((li, i) => { li.textContent = points[i]; });
    if (phrase) bd.querySelector('.cm-type strong').textContent = phrase;
    const okBtn = bd.querySelector('.m-ok');
    okBtn.textContent = ok;
    const input = bd.querySelector('input');
    const typed = () => !input || input.value.trim().toLocaleLowerCase() === phrase.toLocaleLowerCase();
    if (input) {
      okBtn.disabled = true;
      input.setAttribute('aria-label', t('To confirm, type {phrase} below.', { phrase }));
      input.addEventListener('input', () => { okBtn.disabled = !typed(); });
    }
    document.body.appendChild(bd);
    const done = (val) => { bd.remove(); resolve(val); };
    okBtn.onclick = () => { if (typed()) done(true); };
    bd.querySelector('.m-cancel').onclick = () => done(false);
    bd.addEventListener('mousedown', (e) => { if (e.target === bd) done(false); });
    bd.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); done(false); } else if (e.key === 'Enter' && typed() && e.target.tagName !== 'BUTTON') { e.preventDefault(); done(true); }
    });
    (input || bd.querySelector('.m-cancel')).focus();
  });
}

// A list of choices, null on cancel.
function optionModal(title, message, options) {
  return new Promise((resolve) => {
    const bd = document.createElement('div');
    bd.className = 'modal-backdrop';
    const buttons = options.map((o, i) =>
      `<button class="fr-choice${o.danger ? ' danger' : ''}" data-i="${i}" style="width:100%;margin-bottom:8px">
        <strong>${o.label}</strong>
        ${o.desc ? `<span>${o.desc}</span>` : ''}
      </button>`).join('');
    bd.innerHTML = `
      <div class="modal" style="width:420px">
        <h2 style="font-size:16px">${title}</h2>
        ${message ? `<p>${message}</p>` : ''}
        ${buttons}
        <div style="text-align:right;margin-top:6px">
          <button class="m-cancel btn-quiet">${t('Cancel')}</button>
        </div>
      </div>`;
    document.body.appendChild(bd);
    const done = (val) => { bd.remove(); resolve(val); };
    bd.querySelectorAll('.fr-choice').forEach((b) => {
      b.onclick = () => done(options[+b.dataset.i].value);
    });
    bd.querySelector('.m-cancel').onclick = () => done(null);
    bd.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(null); } });
    // (the keys come here, not to whatever was behind it)
    bd.querySelector('.m-cancel').focus();
  });
}

// A small menu at the pointer, the way a right-click menu opens: items are
// {label, value, checked, disabled, danger} or '-' for a line between them.
// Resolves to the chosen value, or null. Arrow keys, Enter and Esc work.
function popMenu(x, y, items, { title = '', from = null } = {}) {
  if (popMenu.close) popMenu.close(); // one at a time
  return new Promise((resolve) => {
    const menu = document.createElement('div');
    menu.className = 'pop-menu';
    menu.setAttribute('role', 'menu');
    if (title) {
      const h = document.createElement('div');
      h.className = 'pm-title';
      h.textContent = title;
      menu.setAttribute('aria-label', title);
      menu.appendChild(h);
    }
    for (const it of items) {
      if (it === '-') {
        const sep = document.createElement('div');
        sep.className = 'pm-sep';
        menu.appendChild(sep);
        continue;
      }
      const b = document.createElement('button');
      b.setAttribute('role', it.checked !== undefined ? 'menuitemradio' : 'menuitem');
      if (it.checked !== undefined) b.setAttribute('aria-checked', it.checked ? 'true' : 'false');
      b.className = (it.checked ? 'on' : '') + (it.danger ? ' danger' : '');
      b.textContent = it.label;
      b.disabled = !!it.disabled;
      b.tabIndex = -1;
      b.onclick = () => done(it.value);
      b.onmouseenter = () => { if (!b.disabled) b.focus({ preventScroll: true }); };
      menu.appendChild(b);
    }
    document.body.appendChild(menu);
    // opened from the keyboard (no pointer), it hangs from the thing it's for
    if ((!x && !y) && from) {
      const r = from.getBoundingClientRect();
      x = r.left + 12;
      y = r.bottom;
    }
    const zoom = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-zoom')) || 1;
    const w = menu.offsetWidth * zoom;
    const h = menu.offsetHeight * zoom;
    const left = Math.max(4, Math.min(x, window.innerWidth - w - 4));
    const top = y + h > window.innerHeight - 4 ? Math.max(4, y - h) : y;
    menu.style.left = left / zoom + 'px';
    menu.style.top = top / zoom + 'px';
    const back = document.activeElement;
    const buttons = [...menu.querySelectorAll('button:not(:disabled)')];
    const done = (value) => {
      if (!menu.isConnected) return;
      menu.remove();
      popMenu.close = null;
      document.removeEventListener('mousedown', outside, true);
      window.removeEventListener('blur', cancel);
      // the Chapters pane it kept open closes if the pointer has left it
      const nav = $('#nav-pane');
      if (nav && nav.dataset.pinned !== '1' && !nav.matches(':hover')) nav.classList.remove('open');
      if (value === null && back && back.isConnected && back.focus) back.focus({ preventScroll: true });
      resolve(value);
    };
    const cancel = () => done(null);
    popMenu.close = cancel;
    const outside = (e) => { if (!menu.contains(e.target)) done(null); };
    document.addEventListener('mousedown', outside, true);
    window.addEventListener('blur', cancel);
    menu.addEventListener('keydown', (e) => {
      const at = buttons.indexOf(document.activeElement);
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const next = buttons[(at + (e.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length];
        if (next) next.focus();
      } else if (e.key === 'Tab') e.preventDefault();
      e.stopPropagation();
    });
    (buttons.find((b) => b.classList.contains('on')) || buttons[0] || menu).focus({ preventScroll: true });
  });
}

// A click (or tap) on the dim page around any dialog dismisses it the way
// its own quiet button would — Cancel or Later where there is one, else
// Done/OK. Dialogs that must be answered have neither and stay put.
document.addEventListener('mousedown', (e) => {
  const bd = e.target && e.target.classList && e.target.classList.contains('modal-backdrop') ? e.target : null;
  if (!bd || bd.dataset.stay === '1') return;
  const btn = bd.querySelector('.m-cancel') || bd.querySelector('.m-ok');
  if (btn) btn.click();
});

// The open book's title up where the window's buttons are: the system's own
// title bar on Windows and Linux (and the Window menu everywhere), and on
// macOS, where that bar is hidden behind the page, the strip beside the buttons
if (IS_MAC && !IS_POCKET) document.body.classList.add('mac-bar');
function showWindowTitle() {
  const title = book ? (book.title || t('Untitled')) : '';
  document.title = title ? title + ' — NEO' : 'NEO';
  const strip = IS_MAC && !IS_POCKET && document.querySelector('#dragstrip'); // the desktop's page only
  if (strip) strip.textContent = title;
}

function toast(msg, ms = 4000, { warn = false } = {}) {
  const h = $('#hint');
  h.textContent = msg;
  h.classList.toggle('hint-warn', warn);
  h.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { h.hidden = true; }, ms);
}

// Scripts that do not separate words with spaces: a whitespace count reports
// one "word" for a whole sentence, so word goals and statistics read far too
// low. Intl.Segmenter knows their boundaries; the same API already runs the
// focus mode (see sentenceRange), and one segmenter is kept per script.
const SEGMENTED_SCRIPTS = [
  { lang: 'th', chars: /[\u0E00-\u0E7F]/ }, // Thai
  { lang: 'lo', chars: /[\u0E80-\u0EFF]/ }, // Lao
  { lang: 'my', chars: /[\u1000-\u109F]/ }, // Myanmar
  { lang: 'km', chars: /[\u1780-\u17FF]/ }  // Khmer
];
let wordSegmenter = null;
let wordSegmenterLang = '';

// a word holds at least one letter or digit, so French « » and spaced
// dashes are not counted as words
function countWords(text) {
  const trimmed = text.trim();
  if (trimmed === '') return 0;
  if (window.Intl && Intl.Segmenter) {
    const script = SEGMENTED_SCRIPTS.find((s) => s.chars.test(trimmed));
    if (script) {
      if (wordSegmenterLang !== script.lang) {
        wordSegmenter = new Intl.Segmenter(script.lang, { granularity: 'word' });
        wordSegmenterLang = script.lang;
      }
      let words = 0;
      for (const part of wordSegmenter.segment(trimmed)) if (part.isWordLike) words += 1;
      return words;
    }
  }
  return (trimmed.match(/\S+/g) || []).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

// A copy of a chapter without the marks that aren't words. A chapter on the
// page is copied node for node: writing it out as HTML and reading it back
// costs twice as much and gives the same tree.
const UNCOUNTED = '.darling-anchor, .ph-mark, .ghost';
function cleanChapterEl(id) {
  const el = document.querySelector(`.chapter[data-id="${id}"] .chapter-body`);
  let holder;
  if (el) holder = el.cloneNode(true);
  else {
    holder = document.createElement('div');
    holder.innerHTML = chapterHTML[id] || '';
  }
  holder.querySelectorAll(UNCOUNTED).forEach((n) => n.remove());
  return holder;
}
// Text a line to each paragraph. innerText does that only for what is laid
// out on screen: of a copy held aside, like the one above, it runs one
// paragraph's last word into the next one's first ("end.Next"), and the two
// count as one word. A range's toString runs them together the same way.
function plainText(root) {
  root.querySelectorAll('p, div, br').forEach((el) => el.after('\n'));
  return root.textContent;
}
const chapterText = (id) => plainText(cleanChapterEl(id));

// Word counts are cached per chapter and only recomputed for the chapter being edited.
let wordCache = {};
function chapterWords(chId) {
  if (wordCache[chId] == null) {
    const body = document.querySelector(`.chapter[data-id="${chId}"] .chapter-body`);
    const n = body ? paragraphWords(body) : null;
    wordCache[chId] = n != null ? n : countWords(chapterText(chId));
  }
  return wordCache[chId];
}

// A chapter on the page is also counted paragraph by paragraph, and each
// paragraph keeps its count until it changes, so a keystroke in a long
// chapter recounts one paragraph instead of all of them. The sum is the
// whole-chapter count because chapterText ends every paragraph with a line
// break: no word runs from one paragraph into the next. Where that can't be
// promised, paragraphWords answers null and the chapter is counted whole.
// <p> → { n: its words, seg: has Thai, Lao…; all, allSeg: the same with marks and ghosts }
const paraWords = new WeakMap();
// A paragraph is forgotten when its words, its marks or a class change (a
// ghost becoming text changes its count with no new letter), and whenever it
// is put on the page, so one changed while off the page is counted again.
function forgetParaWords(rec) {
  const el = rec.target.nodeType === Node.ELEMENT_NODE ? rec.target : rec.target.parentElement;
  const p = el && el.closest('.chapter-body > *');
  if (p) paraWords.delete(p);
  for (const n of rec.addedNodes) {
    if (n.nodeType !== Node.ELEMENT_NODE) continue;
    paraWords.delete(n);
    if (n.firstElementChild) n.querySelectorAll('.chapter-body > *').forEach((q) => paraWords.delete(q));
  }
}
const paraWordsWatch = new MutationObserver((recs) => recs.forEach(forgetParaWords));
paraWordsWatch.observe($('#chapters'), {
  subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class']
});
function paragraphWords(body) {
  paraWordsWatch.takeRecords().forEach(forgetParaWords); // edits not yet reported
  let sum = 0;
  for (let c = body.firstChild; c; c = c.nextSibling) {
    if (c.nodeType === Node.TEXT_NODE) {
      if (/\S/.test(c.data)) return null; // loose words could run into a paragraph's
      continue;
    }
    if (c.nodeType !== Node.ELEMENT_NODE) continue;
    // only blocks end in a line break; a loose inline element could join words
    if (c.tagName !== 'P' && c.tagName !== 'DIV' && c.tagName !== 'BR' && !c.matches(UNCOUNTED)) return null;
    const e = paraEntry(c);
    if (e.n === undefined) {
      if (c.matches(UNCOUNTED)) { e.n = 0; e.seg = false; }
      else {
        const copy = c.cloneNode(true);
        copy.querySelectorAll(UNCOUNTED).forEach((n) => n.remove());
        const text = plainText(copy);
        e.n = countWords(text);
        e.seg = segmented(text);
      }
    }
    // countWords picks one segmenter for a whole chapter by the first script
    // it finds, which a paragraph counted alone can't know
    if (e.seg) return null;
    sum += e.n;
  }
  return sum;
}
function paraEntry(p) {
  let e = paraWords.get(p);
  if (!e) paraWords.set(p, e = {});
  return e;
}
const segmented = (text) => SEGMENTED_SCRIPTS.some((s) => s.chars.test(text));

// Page of pages counts the words from the chapter's start to the caret as
// they stand, marks and ghosts too. The paragraphs above the caret's give
// theirs from a second kept count, so only the caret's own is counted. null
// where they can't be summed, and the range is counted whole.
function wordsBeforeCaret(body, node, offset) {
  paraWordsWatch.takeRecords().forEach(forgetParaWords);
  const el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  const top = el && el.closest('.chapter-body > *');
  if (!top || top.parentNode !== body) return null;
  let sum = 0;
  for (let c = body.firstChild; c !== top; c = c.nextSibling) {
    if (c.nodeType === Node.TEXT_NODE) {
      if (/\S/.test(c.data)) return null;
      continue;
    }
    if (c.nodeType !== Node.ELEMENT_NODE) continue;
    // a mark kept in the count is inline: its letters could join the next paragraph's
    if (c.tagName !== 'P' && c.tagName !== 'DIV' && c.tagName !== 'BR') return null;
    const e = paraEntry(c);
    if (e.all === undefined) {
      const text = plainText(c.cloneNode(true));
      e.all = countWords(text);
      e.allSeg = segmented(text);
    }
    if (e.allSeg) return null;
    sum += e.all;
  }
  const r = document.createRange();
  r.setStartBefore(top);
  r.setEnd(node, offset);
  const text = plainText(r.cloneContents());
  if (segmented(text)) return null;
  return sum + countWords(text);
}

/* ================================================================== */
/*  BOOKSHELF                                                          */
/* ================================================================== */

let libraryDirPath = '';

function coverUrl(meta) {
  // Pocket serves the library through a URL; desktop hands a plain path
  if (/^[a-z]+:\/\//.test(libraryDirPath)) {
    return libraryDirPath + '/' + encodeURIComponent(meta.id) + '/' + encodeURIComponent(meta.coverImage);
  }
  const p = (libraryDirPath + '/' + meta.id + '/' + meta.coverImage).replace(/\\/g, '/');
  return encodeURI('file://' + (p.startsWith('/') ? '' : '/') + p);
}

async function loadLibrary() {
  libraryDirPath = await window.neo.libraryPath();
  applyShelfZoom();
  library = applyDeviceLook(await window.neo.readLibrary());
  // A first shelf is named in the language NEO had when it was made. If the
  // writer never renamed it, it follows a change of language: from English,
  // or from the language this device last showed (any language, the first
  // time). Not from another device's, so a phone in another language and
  // this computer don't take turns renaming it in library.json.
  const DEFAULT_SHELF = 'Works in Progress';
  const own = t(DEFAULT_SHELF);
  const lang = NeoI18n.getLocale();
  let was = null;
  try { was = localStorage.getItem('neo.shelfLanguage'); } catch { /* none */ }
  const names = new Set([DEFAULT_SHELF]);
  if (was !== lang && window.neo.translationsOf) {
    try {
      const all = await window.neo.translationsOf(DEFAULT_SHELF);
      for (const x of was ? [all[was]] : Object.values(all)) if (x) names.add(x);
    } catch { /* English alone, as before */ }
  }
  // (each writing name has a first shelf of its own, made the same way)
  const untouched = (library.shelves || []).filter((s) => names.has(s.name) && s.name !== own);
  for (const s of untouched) s.name = own;
  if (untouched.length) await writeLibrary(library);
  try { localStorage.setItem('neo.shelfLanguage', lang); } catch { /* fine */ }
  if (window.neo.writingStyleState) window.neo.writingStyleState(library.writingStyle);
  if (window.neo.proofSet) window.neo.proofSet(proofFlags()).catch(() => {});
  if (!library.firstRunDone) {
    showFirstRun();
  } else if (library.historyAsked !== true) {
    askHistoryLevel(); // a library from before Writing History, asked once
  }
  if (window.neo.recState) window.neo.recState(); // the File menu's level
  renderShelves();
}

function showFirstRun() {
  const fr = $('#firstrun');
  fr.hidden = false;
  let picked = { body: Object.keys(BODY_FONTS)[0] || 'Georgia', dropcap: 'literary' };

  // Step 1: who are you, and how do you write?
  $$('.fr-choice').forEach((btn) => {
    btn.onclick = () => {
      library.authorName = $('#fr-name').value.trim();
      const pen = $('#fr-pen').value.trim();
      library.penNames = pen ? [pen] : [];
      library.writingStyle = btn.dataset.style;
      if (window.neo.writingStyleState) window.neo.writingStyleState(library.writingStyle);
      $('#fr-step1').hidden = true;
      $('#fr-step2').hidden = false;
      buildFontStep();
    };
  });

  // Step 2: fonts, with a WYSIWYG sample
  function preview() {
    document.documentElement.style.setProperty('--body-font', BODY_FONTS[picked.body]);
    document.documentElement.style.setProperty('--dropcap-font', DROPCAP_FONTS[picked.dropcap]);
  }
  function buildFontStep() {
    const bodyRow = $('#fr-bodyfonts');
    bodyRow.innerHTML = '';
    for (const name of BODY_FONT_CHOICES) {
      const b = document.createElement('button');
      b.className = 'fr-font' + (picked.body === name ? ' sel' : '');
      b.textContent = name;
      b.style.fontFamily = BODY_FONTS[name];
      b.onmouseenter = () => { document.documentElement.style.setProperty('--body-font', BODY_FONTS[name]); };
      b.onmouseleave = preview;
      b.onclick = () => {
        picked.body = name;
        buildFontStep();
        preview();
      };
      bodyRow.appendChild(b);
    }
    const capRow = $('#fr-dropcaps');
    capRow.innerHTML = '';
    const caps = { literary: t('Literary'), fantasy: t('Fantasy'), scifi: t('Sci-Fi') };
    // an A of the alphabet the sample is written in, so each button shows
    // the drop cap the writer will get (Cyrillic letters come from other faces)
    const capA = /\p{Script=Cyrillic}/u.test($('#fr-sample-text').textContent) ? 'А' : 'A';
    for (const key of Object.keys(caps)) {
      const b = document.createElement('button');
      b.className = 'fr-font' + (picked.dropcap === key ? ' sel' : '');
      b.innerHTML = `<span class="fr-cap" style="font-family:${DROPCAP_FONTS[key].replace(/"/g, '&quot;')}">${capA}</span>${caps[key]}`;
      b.onmouseenter = () => { document.documentElement.style.setProperty('--dropcap-font', DROPCAP_FONTS[key]); };
      b.onmouseleave = preview;
      b.onclick = () => {
        picked.dropcap = key;
        buildFontStep();
        preview();
      };
      capRow.appendChild(b);
    }
    preview();
  }

  // Step 3: Writing History, chosen before a word is written. Where it can't
  // record (an old iOS), there's nothing to choose.
  let level = 'record';
  $('#fr-next').onclick = () => {
    if (!historyCan()) { $('#fr-done').click(); return; }
    $('#fr-step2').hidden = true;
    $('#fr-step3').hidden = false;
    historyLevelCards($('#fr-levels'), level, (v) => { level = v; });
  };

  $('#fr-done').onclick = async () => {
    library.fonts = { body: picked.body, dropcap: picked.dropcap };
    library.firstRunDone = true;
    // the choice made here is the consent: nothing asks again
    library.historyAsked = true;
    library.recordWriting = level !== 'off';
    library.proveWriting = level === 'timestamp' && !!window.neo.proofSet;
    // the shelf was drawn (and the author record seeded as Anonymous) before
    // the name was typed — carry the name across
    currentAuthor().name = library.authorName || (library.penNames || [])[0] || t('Anonymous');
    // a library that can't be written must not leave the writer at a button
    // that does nothing: say so, and keep the page ready for another try
    const note = $('#fr-error');
    try {
      await writeLibrary(library);
    } catch (err) {
      library.firstRunDone = false;
      window.neo.logError('first run: ' + ((err && err.message) || err));
      note.textContent = t('NEO can\'t save in {dir}. File → Library Folder… lets you choose a folder it can write to; then press Start writing again.', { dir: libraryDirPath });
      note.hidden = false;
      return;
    }
    note.hidden = true;
    applyFonts();
    fr.hidden = true;
    if (window.neo.proofSet) window.neo.proofSet(proofFlags()).catch(() => {});
    if (window.neo.recState) window.neo.recState();
    renderShelves();
  };
}

// Pen names: each author owns a set of shelves. Books all live in the one
// NEO Library folder on disk regardless of name — switching or deleting a
// pen name never touches files.
function currentAuthor() {
  if (!library.authors || !library.authors.length) {
    library.authors = [{
      id: 'a1',
      name: library.authorName || (library.penNames && library.penNames[0]) || t('Anonymous')
    }];
  }
  return library.authors.find((a) => a.id === library.currentAuthorId) || library.authors[0];
}

function shelvesFor(authorId) {
  const homeId = library.authors[0].id;
  return library.shelves.filter((s) => (s.authorId || homeId) === authorId);
}

function displayAuthor() {
  return currentAuthor().name || t('Anonymous');
}

// Redrawing the shelves used to read every book.json again — eighty files
// through the bridge on Pocket, for a shelf rename. The shelves now keep
// what they last read; any write to a book, and every look at the disk
// (refreshFromDisk), forgets it.
const bookMetaCache = new Map();
async function shelfMeta(bookId) {
  if (bookMetaCache.has(bookId)) return bookMetaCache.get(bookId);
  const meta = await window.neo.readBookMeta(bookId);
  if (meta) bookMetaCache.set(bookId, meta);
  return meta;
}
// Saves a book's meta and drops the cached copy. This used to be done by
// replacing window.neo.writeBookMeta, but on desktop that object is
// read-only, so the assignment threw and app.js stopped loading.
function writeBookMeta(bookId, meta) {
  bookMetaCache.delete(bookId);
  if (meta === book) noteStructure();
  return window.neo.writeBookMeta(bookId, meta);
}

async function renderShelves() {
  await NeoCovers.ready; // display faces, so titles measure true
  const view = $('#bookshelf-view');
  const keepScroll = view.scrollTop; // re-rendering must not move the page
  $('#author-chip').textContent = displayAuthor();
  const wrap = $('#shelves');
  // the new shelves are built off-screen and swapped in whole, so the page
  // never goes blank while books are read from disk — no flash on a drop
  const built = document.createDocumentFragment();
  // shelves drag by their grip to reorder, with a gold bar showing the drop spot
  if (!wrap.dataset.dndWired) {
    wrap.dataset.dndWired = '1';
    wrap.addEventListener('dragover', (e) => {
    if (!e.dataTransfer.types.includes('application/x-neo-shelf')) return;
    e.preventDefault();
    let ind = wrap.querySelector('.shelf-drop-ind');
    if (!ind) {
      ind = document.createElement('div');
      ind.className = 'shelf-drop-ind';
    }
    let placed = false;
    for (const s of wrap.querySelectorAll('.shelf:not(.dragging)')) {
      const r = s.getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) {
        wrap.insertBefore(ind, s);
        placed = true;
        break;
      }
    }
      if (!placed) wrap.appendChild(ind);
    });
    wrap.addEventListener('drop', async (e) => {
      const shelfId = e.dataTransfer.getData('application/x-neo-shelf');
      if (!shelfId) return;
      e.preventDefault();
      const ind = wrap.querySelector('.shelf-drop-ind');
      let index = library.shelves.length;
      if (ind) {
        index = 0;
        for (const c of wrap.children) {
          if (c === ind) break;
          if (c.classList.contains('shelf') && !c.classList.contains('dragging')) index++;
        }
        ind.remove();
      }
      const moving = library.shelves.find((s) => s.id === shelfId);
      if (!moving) return;
      library.shelves = library.shelves.filter((s) => s.id !== shelfId);
      library.shelves.splice(index, 0, moving);
      await writeLibrary(library);
      // move the shelf on screen rather than redrawing everything
      const secs = [...wrap.querySelectorAll('.shelf')];
      const movingSec = secs.find((el) => el.dataset.shelfId === shelfId);
      const others = secs.filter((el) => el !== movingSec);
      if (movingSec) wrap.insertBefore(movingSec, others[index] || null);
      else renderShelves();
    });
  }

  for (const shelf of shelvesFor(currentAuthor().id)) {
    const sec = document.createElement('section');
    sec.className = 'shelf';
    sec.dataset.shelfId = shelf.id;
    if (isBound(shelf)) sec.classList.add('bound');
    if (shelf.id === justBoundId) { sec.classList.add('just-bound'); justBoundId = null; }

    const grip = document.createElement('span');
    grip.className = 'shelf-grip';
    grip.textContent = '⠿';
    grip.title = t('Drag to reorder shelves');
    grip.draggable = true;
    grip.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/x-neo-shelf', shelf.id);
      sec.classList.add('dragging');
    });
    grip.addEventListener('dragend', () => {
      sec.classList.remove('dragging');
      const ind = document.querySelector('.shelf-drop-ind');
      if (ind) ind.remove();
    });
    sec.appendChild(grip);

    const label = document.createElement('span');
    label.className = 'shelf-label';
    // on a touch screen the name turns editable only when tapped, so a long
    // press (the menu) never wakes the keyboard or selects the text
    label.contentEditable = NO_HOVER ? 'false' : 'true';
    label.spellcheck = false;
    label.textContent = shelf.name;
    label.title = t('Click to rename · right-click to export or delete');
    if (NO_HOVER) {
      label.addEventListener('click', () => {
        if (label.isContentEditable) return;
        label.contentEditable = 'true';
        label.focus();
        const r = document.createRange();
        r.selectNodeContents(label);
        r.collapse(false);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
      });
    }
    label.addEventListener('blur', async () => {
      const before = shelf.name;
      shelf.name = label.textContent.trim() || shelf.name;
      label.textContent = shelf.name;
      if (NO_HOVER) label.contentEditable = 'false';
      await writeLibrary(library);
      // a bound shelf's name is its book's title: the cover follows it
      if (isBound(shelf) && shelf.name !== before) { await syncCoverTitle(shelf); renderShelves(); }
    });
    label.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); label.blur(); }
    });
    // right-click a shelf label: bind it into one book, publish it as an
    // anthology, or delete it (a bound shelf has a menu of its own)
    label.addEventListener('contextmenu', async (e) => {
      e.preventDefault();
      if (isBound(shelf)) { await boundShelfMenu(shelf); return; }
      const choice = await optionModal(escHtml(t('Shelf “{name}”', { name: shelf.name })), null, [
        {
          label: t('Bind into one book'),
          desc: t('Its titles become one book, with a cover, front and back pages, and one table of contents.'),
          value: 'bind'
        },
        {
          label: t('Export shelf as anthology…'),
          desc: shelf.bookIds.length
            ? t('Collect its {n} works, in shelf order, into a single book with a table of contents.', { n: shelf.bookIds.length })
            : t('Collect the works, in shelf order, into a single book with a table of contents.'),
          value: 'anthology'
        },
        { label: t('Delete shelf'), desc: t('Books move to another shelf. Nothing is deleted from disk.'), danger: true, value: 'del' }
      ]);
      if (choice === 'bind') {
        await bindShelf(shelf);
      } else if (choice === 'anthology') {
        await exportShelfAnthology(shelf);
      } else if (choice === 'del') {
        const mine = shelvesFor(currentAuthor().id);
        if (mine.length === 1) {
          toast(t('This is your only shelf — add another before deleting this one'));
          return;
        }
        const other = mine.find((s) => s.id !== shelf.id);
        for (const id of shelf.bookIds) {
          if (isPageMeta(await shelfMeta(id))) continue; // a bound book's pages stay in the library folder
          if (!other.bookIds.includes(id)) await placeTitle(other, id);
        }
        library.shelves = library.shelves.filter((s) => s.id !== shelf.id);
        await writeLibrary(library);
        renderShelves();
      }
    });
    const row = document.createElement('div');
    row.className = 'shelf-books';
    row.dataset.shelfId = shelf.id;

    // drag targets: reorder within a shelf, move between shelves, or drop
    // manuscript files straight from Finder
    row.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes('Files')) {
        e.preventDefault();
        row.classList.add('drag-over');
        return;
      }
      if (!e.dataTransfer.types.includes('application/x-neo-book')) return;
      e.preventDefault();
      row.classList.add('drag-over');
      const ind = dropIndicator();
      let placed = false;
      for (const t of row.querySelectorAll('.book:not(.dragging)')) {
        const r = t.getBoundingClientRect();
        // cursor above this book's row, or on its row and left of center
        if (e.clientY < r.top || (e.clientY < r.bottom && e.clientX < r.left + r.width / 2)) {
          row.insertBefore(ind, t);
          placed = true;
          break;
        }
      }
      if (!placed) row.insertBefore(ind, row.querySelector('.new-book'));
    });
    row.addEventListener('dragleave', (e) => {
      if (row.contains(e.relatedTarget)) return;
      row.classList.remove('drag-over');
      const ind = document.querySelector('.drop-indicator');
      if (ind && ind.parentElement === row) ind.remove();
    });
    row.addEventListener('drop', async (e) => {
      row.classList.remove('drag-over');
      // files from Finder → import them right onto this shelf
      if (e.dataTransfer.files && e.dataTransfer.files.length) {
        e.preventDefault();
        const paths = [...e.dataTransfer.files]
          .map((f) => { try { return window.neo.pathForFile(f); } catch { return null; } })
          .filter(Boolean);
        if (!paths.length) return;
        toast(t('Importing…'));
        const results = await window.neo.importFiles(paths);
        if (!results.length) { toast(t('No .docx, .txt, or .md files in that drop')); return; }
        await addImportedBooks(results, shelf);
        return;
      }
      const bookId = e.dataTransfer.getData('application/x-neo-book');
      if (!bookId) return;
      e.preventDefault();
      // insertion index = how many (non-dragged) books sit before the indicator
      const ind = document.querySelector('.drop-indicator');
      let index = shelf.bookIds.filter((b) => b !== bookId).length;
      if (ind && ind.parentElement === row) {
        index = 0;
        for (const c of row.children) {
          if (c === ind) break;
          if (c.classList.contains('book') && !c.classList.contains('dragging')) index++;
        }
      }
      if (ind) ind.remove();
      const fromShelf = shelfOf(bookId);
      if (isBound(shelf)) {
        if (isPageMeta(await shelfMeta(bookId))) return; // a page keeps its place
        const { start, end } = await bodyRange(shelf, bookId);
        index = Math.min(Math.max(index, start), end);
      }
      for (const s of library.shelves) s.bookIds = s.bookIds.filter((b) => b !== bookId);
      shelf.bookIds.splice(index, 0, bookId);
      await writeLibrary(library);
      if (isBound(shelf) || isBound(fromShelf)) { renderShelves(); return; }
      // slide the tile into place; the shelf itself is not redrawn
      const tile = document.querySelector(`.book[data-book-id="${bookId}"]`);
      if (tile) {
        const others = [...row.querySelectorAll('.book')].filter((b) => b !== tile);
        row.insertBefore(tile, others[index] || row.querySelector('.new-book'));
        tile.classList.remove('dragging');
      } else renderShelves();
    });

    // the blank page — click to begin
    const blank = document.createElement('div');
    blank.className = 'new-book';
    blank.textContent = '+';
    blank.title = t('Start a new book');
    blank.onclick = () => createBookOnShelf(shelf);
    pressable(blank, t('Start a new book'));
    // right-click (a long press on a phone): a book or a script
    if (!isBound(shelf)) {
      blank.addEventListener('contextmenu', async (e) => {
        e.preventDefault();
        const pick = await popMenu(e.clientX, e.clientY, [
          { label: t('New Book'), value: 'book' },
          { label: t('New Script'), value: 'script' }
        ], { from: blank });
        if (pick === 'book') createBookOnShelf(shelf);
        else if (pick === 'script') createScriptOnShelf(shelf);
      });
    }

    if (isBound(shelf)) {
      await renderBoundRow(shelf, row, blank);
      // the tiles of a shelf just bound settle in one after another
      if (sec.classList.contains('just-bound')) [...row.children].forEach((el, i) => el.style.setProperty('--i', i));
    } else {
      for (const bookId of shelf.bookIds) {
        const meta = await shelfMeta(bookId);
        if (!meta || isPageMeta(meta)) continue;
        row.appendChild(bookTile(meta));
      }
      row.appendChild(blank);
    }

    sec.appendChild(label);
    if (isBound(shelf)) {
      const mark = document.createElement('span');
      mark.className = 'shelf-bound-mark';
      mark.textContent = t('one book');
      sec.appendChild(mark);
    }
    sec.appendChild(row);
    built.appendChild(sec);
  }
  wrap.replaceChildren(built);
  view.scrollTop = keepScroll;
  fitBoundShelves();
}

// A bound shelf, measured once it's on screen: the thread under it runs as
// far as its books do, and a page's name too long for its spine (some
// languages have long ones) is set smaller until it fits
function fitBoundShelves() {
  for (const row of document.querySelectorAll('.shelf.bound .shelf-books')) {
    const last = row.lastElementChild;
    const box = row.getBoundingClientRect();
    if (!last || !box.width) continue;
    const zoom = box.width / row.offsetWidth; // the Interface Size zoom
    row.style.setProperty('--stitch', Math.ceil((last.getBoundingClientRect().right - box.left) / zoom) + 'px');
    for (const l of row.querySelectorAll('.pt-label')) {
      l.style.fontSize = '';
      l.style.letterSpacing = '';
      const room = l.clientHeight;
      const need = l.scrollHeight;
      if (!room || need <= room + 1) continue;
      const cs = getComputedStyle(l);
      const k = room / need;
      l.style.fontSize = Math.max(6.5, parseFloat(cs.fontSize) * k).toFixed(2) + 'px';
      l.style.letterSpacing = ((parseFloat(cs.letterSpacing) || 0) * k).toFixed(2) + 'px';
    }
  }
}
window.addEventListener('resize', () => {
  clearTimeout(fitBoundShelves.t);
  fitBoundShelves.t = setTimeout(fitBoundShelves, 120);
});

/* ================================================================== */
/*  BOUND SHELVES — a shelf that is one book                           */
/*  Right-click a shelf's name → Bind into one book. Its titles stay   */
/*  ordinary books to write in. A cover and the pages a published book */
/*  carries (copyright, dedication, epigraph, parts, acknowledgments,  */
/*  about the author) join them as small books of their own: plain     */
/*  folders like every other, so backups, sync and Pocket carry them.  */
/*  Hovering a bound shelf shows each missing page, faint, in its      */
/*  place; a click adds it and opens it as the page it will print as.  */
/*  Unbinding tucks the pages away (shelf.binding.parked) until the    */
/*  next binding. Nothing is ever deleted by binding or unbinding.     */
/* ================================================================== */

const PAGE_FRONT = ['copyright', 'dedication', 'epigraph'];
const PAGE_BACK = ['acknowledgments', 'about'];
// A book's own prologue and epilogue, when it has them: story, written in
// the editor like any title, standing before the first part and after the
// last. (A single book's first or last chapter can take the role too.)
const PAGE_WRITTEN = ['prologue', 'epilogue'];
// the order each end of a bound shelf keeps
const PAGE_LEAD = ['cover', ...PAGE_FRONT, 'prologue'];
const PAGE_TAIL = ['epilogue', ...PAGE_BACK];
const PAGE_KINDS = [...PAGE_LEAD, 'part', ...PAGE_TAIL];
const isPageMeta = (m) => !!(m && PAGE_KINDS.includes(m.kind));
const isBound = (shelf) => !!(shelf && shelf.binding && shelf.binding.bound);
const shelfOf = (bookId) => library.shelves.find((s) => s.bookIds.includes(bookId));

function pageKindName(kind) {
  return {
    cover: t('Cover'),
    copyright: t('Copyright'),
    dedication: t('Dedication'),
    epigraph: t('Epigraph'),
    prologue: t('Prologue'),
    part: t('Part'),
    epilogue: t('Epilogue'),
    acknowledgments: t('Acknowledgments'),
    about: t('About the Author')
  }[kind] || kind;
}

// Part I, Part II …: roman numerals read the same in every language
function roman(n) {
  const r = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let out = '';
  for (const [v, s] of r) while (n >= v) { out += s; n -= v; }
  return out;
}
const partLabel = (n) => t('Part {n}', { n: roman(n) });

// the name a bound book goes out under: the pen name that owns the shelf
function shelfAuthorName(shelf) {
  const all = library.authors || [];
  const a = all.find((x) => x.id === shelf.authorId) || all[0];
  return (a && a.name) || t('Anonymous');
}

// a new page starts with what every such page says, where that's knowable
const PAGE_STARTERS = {
  copyright: (shelf) =>
    `<p>${escHtml(t('Copyright © {year} {name}', { year: String(new Date().getFullYear()), name: shelfAuthorName(shelf) }))}</p>` +
    `<p>${escHtml(t('All rights reserved.'))}</p>`
};

async function createPageBook(shelf, kind) {
  const written = PAGE_WRITTEN.includes(kind);
  // a prologue opens in the editor as "Prologue", under the book's name
  const title = kind === 'cover' || written ? (written ? pageKindName(kind) : shelf.name) : pageKindName(kind) + ' — ' + shelf.name;
  const meta = await window.neo.createBook({ author: shelfAuthorName(shelf), title });
  meta.title = title;
  meta.kind = kind;
  meta.shelfId = shelf.id; // which bound book it belongs to, for anyone reading the folder
  if (written) {
    meta.subtitle = shelf.name;
    meta.tabNames = {
      notes: (library.tabDefaults && library.tabDefaults.notes) || 'Notes',
      outline: (library.tabDefaults && library.tabDefaults.outline) || 'Outline'
    };
  }
  if (kind === 'cover') {
    meta.coverSeed = 'bound:' + shelf.id;
    meta.chapterOrder = [];
  } else {
    const chId = 'ch-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
    await window.neo.writeChapter(meta.id, chId, PAGE_STARTERS[kind] ? PAGE_STARTERS[kind](shelf) : '<p><br></p>');
    meta.chapterOrder = [chId];
  }
  await writeBookMeta(meta.id, meta);
  return meta;
}

// Where titles may sit on a bound shelf: after the cover and front pages,
// before the back pages (indexes into bookIds, without skipId)
async function bodyRange(shelf, skipId) {
  const ids = shelf.bookIds.filter((b) => b !== skipId);
  const kinds = [];
  for (const id of ids) {
    const m = await shelfMeta(id);
    kinds.push((m && m.kind) || '');
  }
  let start = 0;
  while (start < ids.length && PAGE_LEAD.includes(kinds[start])) start++;
  let end = ids.length;
  while (end > start && PAGE_TAIL.includes(kinds[end - 1])) end--;
  return { start, end };
}

// Put a title on a shelf: last in line (or first), which on a bound shelf
// means the end (or start) of its body, never after the back pages
async function placeTitle(shelf, bookId, atStart) {
  shelf.bookIds = shelf.bookIds.filter((b) => b !== bookId);
  if (!isBound(shelf)) {
    if (atStart) shelf.bookIds.unshift(bookId); else shelf.bookIds.push(bookId);
    return;
  }
  const { start, end } = await bodyRange(shelf);
  shelf.bookIds.splice(atStart ? start : end, 0, bookId);
}

let justBoundId = null; // the shelf whose binding the next drawing shows
async function bindShelf(shelf) {
  shelf.binding = Object.assign({ numbering: 'through', parked: [] }, shelf.binding || {}, { bound: true });
  restoreParked(shelf);
  let cover = null;
  for (const id of shelf.bookIds) {
    const m = await shelfMeta(id);
    if (m && m.kind === 'cover') { cover = m; break; }
  }
  if (!cover) {
    cover = await createPageBook(shelf, 'cover');
    shelf.bookIds.unshift(cover.id);
  } else if (cover.title !== shelf.name) {
    cover.title = shelf.name;
    await writeBookMeta(cover.id, cover);
  }
  await writeLibrary(library);
  justBoundId = shelf.id;
  await renderShelves();
  toast(t('“{name}” is bound into one book', { name: shelf.name }));
}

// the pages come back where they were: the cover and front pages lead, a
// part page returns before the title it opened, the back pages close
function restoreParked(shelf) {
  const parked = (shelf.binding && shelf.binding.parked) || [];
  if (!parked.length) return;
  const front = parked.filter((p) => PAGE_LEAD.includes(p.kind))
    .sort((a, b) => PAGE_LEAD.indexOf(a.kind) - PAGE_LEAD.indexOf(b.kind));
  const back = parked.filter((p) => PAGE_TAIL.includes(p.kind))
    .sort((a, b) => PAGE_TAIL.indexOf(a.kind) - PAGE_TAIL.indexOf(b.kind));
  const body = shelf.bookIds.filter((id) => !parked.some((p) => p.id === id));
  for (const p of parked.filter((x) => x.kind === 'part')) {
    const at = p.before ? body.indexOf(p.before) : -1;
    if (at >= 0) body.splice(at, 0, p.id); else body.push(p.id);
  }
  shelf.bookIds = [...front.map((p) => p.id), ...body, ...back.map((p) => p.id)];
  shelf.binding.parked = [];
}

async function unbindShelf(shelf) {
  const ids = [...shelf.bookIds];
  const metas = [];
  for (const id of ids) metas.push(await shelfMeta(id));
  const parked = [];
  const titles = [];
  ids.forEach((id, i) => {
    const m = metas[i];
    if (!isPageMeta(m)) { titles.push(id); return; }
    // a part page remembers the title it opens
    let before = null;
    if (m.kind === 'part') {
      for (let j = i + 1; j < ids.length; j++) {
        if (metas[j] && !isPageMeta(metas[j])) { before = ids[j]; break; }
      }
    }
    parked.push({ id, kind: m.kind, before });
  });
  shelf.bookIds = titles;
  shelf.binding = Object.assign({}, shelf.binding, { bound: false, parked });
  await writeLibrary(library);
  await renderShelves();
  toast(t('Unbound. Its pages wait for the next binding.'));
}

// the shelf's name is the book's title, so a rename reaches the cover too
async function syncCoverTitle(shelf) {
  for (const id of shelf.bookIds) {
    const m = await shelfMeta(id);
    if (m && m.kind === 'cover') {
      if (m.title !== shelf.name) { m.title = shelf.name; await writeBookMeta(m.id, m); }
      return;
    }
  }
}

/* ---------- a bound shelf, drawn ---------- */

async function renderBoundRow(shelf, row, blank) {
  const items = [];
  for (const id of shelf.bookIds) {
    const m = await shelfMeta(id);
    if (m) items.push(m);
  }
  let f = 0;
  while (f < items.length && PAGE_LEAD.includes(items[f].kind)) f++;
  let b = items.length;
  while (b > f && PAGE_TAIL.includes(items[b - 1].kind)) b--;
  const front = items.slice(0, f);
  const body = items.slice(f, b);
  const back = items.slice(b);
  const cover = front.find((m) => m.kind === 'cover');
  if (cover) row.appendChild(boundCoverTile(shelf, cover));
  const offer = missingPages(body);
  appendPageZone(row, shelf, front.filter((m) => m.kind !== 'cover'), [...PAGE_FRONT, 'prologue'], offer);
  let parts = 0;
  body.forEach((m, i) => {
    if (m.kind === 'part') {
      parts += 1;
      row.appendChild(pageTile(shelf, m, partLabel(parts)));
      return;
    }
    if (isPageMeta(m)) { row.appendChild(pageTile(shelf, m, pageKindName(m.kind))); return; }
    const prev = body[i - 1];
    if (!NO_HOVER && !(prev && prev.kind === 'part')) row.appendChild(partSeam(shelf, m.id));
    row.appendChild(bookTile(m));
  });
  row.appendChild(blank);
  appendPageZone(row, shelf, back, PAGE_TAIL, offer);
}

// Which pages a bound book could still take. A book of one title whose
// first chapter is already its prologue isn't offered another (nor one
// whose last chapter is its epilogue).
function missingPages(body) {
  const titles = body.filter((m) => !isPageMeta(m));
  const lone = titles.length === 1 ? titles[0] : null;
  const own = (role) => !!lone && (lone.chapterOrder || []).some((c) => chapterRole(c, lone) === role);
  return (kind) => !(PAGE_WRITTEN.includes(kind) && own(kind));
}

// the pages of one end of the book, each in its place, with a faint
// stand-in (shown on hover) wherever one could be added
function appendPageZone(row, shelf, have, kinds, offer) {
  const left = [...have];
  for (const k of kinds) {
    const i = left.findIndex((m) => m.kind === k);
    if (i >= 0) row.appendChild(pageTile(shelf, left.splice(i, 1)[0], pageKindName(k)));
    else if (!NO_HOVER && offer(k)) row.appendChild(ghostPage(shelf, k));
  }
  for (const m of left) row.appendChild(pageTile(shelf, m, pageKindName(m.kind)));
}

function boundCoverTile(shelf, meta) {
  // the cover wears the shelf's name, whatever its folder was first called
  const shown = Object.assign({}, meta, { title: shelf.name, author: meta.author || shelfAuthorName(shelf) });
  const el = bookTile(shown, { cover: shelf });
  el.classList.add('bound-cover');
  el.draggable = false;
  return el;
}

// a page's name runs up its spine; a long one is set smaller to fit
const spineFit = (label) => (label.length > 17 ? ' longer' : label.length > 12 ? ' long' : '');

function pageTile(shelf, meta, label) {
  const el = document.createElement('div');
  el.className = 'book page-tile kind-' + meta.kind + spineFit(label);
  el.dataset.bookId = meta.id;
  el.draggable = false;
  const span = document.createElement('span');
  span.className = 'pt-label';
  span.textContent = label;
  el.appendChild(span);
  el.title = label;
  el.onclick = () => openPage(shelf, meta, label);
  pressable(el, label);
  el.addEventListener('contextmenu', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const choice = await optionModal(escHtml(label), null, [
      { label: t('Open'), value: 'open' },
      {
        label: t('Remove page'),
        desc: window.Capacitor
          ? t('Moves the book folder to Deleted Books in your NEO Library, where you can recover it.')
          : t('Sends the page to your system trash, where you can recover it.'),
        danger: true, value: 'remove'
      }
    ]);
    if (choice === 'open') openPage(shelf, meta, label);
    else if (choice === 'remove' && await window.neo.deleteBook(meta.id, label)) {
      shelf.bookIds = shelf.bookIds.filter((b) => b !== meta.id);
      await writeLibrary(library);
      renderShelves();
    }
  });
  return el;
}

function ghostPage(shelf, kind) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'ghost-page' + spineFit(pageKindName(kind));
  el.innerHTML = '<span class="gp-plus" aria-hidden="true">+</span><span class="pt-label"></span>';
  el.querySelector('.pt-label').textContent = pageKindName(kind);
  el.title = pageKindName(kind);
  el.setAttribute('aria-label', pageKindName(kind));
  el.onclick = () => addPage(shelf, kind);
  return el;
}

function partSeam(shelf, beforeId) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'part-seam';
  el.title = t('Start a part here');
  el.setAttribute('aria-label', t('Start a part here'));
  el.innerHTML = '<span class="ps-line"></span><span class="ps-plus">+</span>';
  el.onclick = () => addPage(shelf, 'part', beforeId);
  return el;
}

// A new page goes where books put it: front pages after the cover in their
// usual order, back pages at the end in theirs, a part before its title
async function addPage(shelf, kind, beforeId) {
  const meta = await createPageBook(shelf, kind);
  const ids = shelf.bookIds;
  let at = ids.length;
  if (kind === 'part') {
    at = beforeId ? ids.indexOf(beforeId) : -1;
    if (at < 0) at = (await bodyRange(shelf)).end;
  } else if (PAGE_LEAD.includes(kind)) {
    at = 0;
    for (let i = 0; i < ids.length; i++) {
      const m = await shelfMeta(ids[i]);
      const k = m && m.kind;
      if (PAGE_LEAD.includes(k) && PAGE_LEAD.indexOf(k) < PAGE_LEAD.indexOf(kind)) at = i + 1;
      else break;
    }
  } else {
    for (let i = ids.length - 1; i >= 0; i--) {
      const m = await shelfMeta(ids[i]);
      const k = m && m.kind;
      if (PAGE_TAIL.includes(k) && PAGE_TAIL.indexOf(k) > PAGE_TAIL.indexOf(kind)) at = i;
      else break;
    }
  }
  ids.splice(at, 0, meta.id);
  await writeLibrary(library);
  await renderShelves();
  let label = pageKindName(kind);
  if (kind === 'part') {
    let n = 0;
    for (const id of shelf.bookIds) {
      const m = await shelfMeta(id);
      if (m && m.kind === 'part') n += 1;
      if (id === meta.id) break;
    }
    label = partLabel(n);
  }
  openPage(shelf, meta, label);
}

// A prologue or an epilogue is story: it opens in the editor, ready to
// write in. Every other page opens as the sheet it will print on.
async function openPage(shelf, meta, label) {
  if (!PAGE_WRITTEN.includes(meta.kind)) { openPageSheet(shelf, meta, label); return; }
  await openBook(meta.id);
  // a first visit starts at the top of the page, under its title
  if (book && book.id === meta.id && !book.lastPosition && book.chapterOrder[0]) focusChapterStart(book.chapterOrder[0]);
}

/* ---------- a page, open as it will print ---------- */

const PAGE_PLACEHOLDERS = {
  dedication: () => t('For…'),
  epigraph: () => '…',
  part: () => t('Title')
};

// Whatever the editing engine left, a page is stored as NEO's plain
// paragraphs: loose text and <div>s become <p>s, stray <br>s go
function normalizePageBody(body) {
  let cur = null;
  for (const node of [...body.childNodes]) {
    if (node.nodeType === 1 && /^(P|DIV|H[1-6]|BLOCKQUOTE|LI|UL|OL)$/.test(node.tagName)) {
      cur = null;
      if (node.tagName !== 'P') {
        const p = document.createElement('p');
        while (node.firstChild) p.appendChild(node.firstChild);
        node.replaceWith(p);
      }
      continue;
    }
    const blank = (node.nodeType === 3 && !node.textContent.trim()) || (node.nodeType === 1 && node.tagName === 'BR');
    if (!cur && blank) { node.remove(); continue; }
    if (!cur) {
      cur = document.createElement('p');
      body.insertBefore(cur, node);
    }
    cur.appendChild(node);
  }
  if (!body.querySelector('p')) body.innerHTML = '<p><br></p>';
}

function sheetBackdrop(kind, label, inner) {
  const bd = document.createElement('div');
  bd.className = 'modal-backdrop page-sheet-backdrop';
  bd.innerHTML = `
    <div class="page-sheet" role="dialog" aria-modal="true">
      <div class="ps-bar"><span class="ps-name"></span><button class="m-ok ps-done">${t('Done')}</button></div>
      <div class="ps-paper kind-${kind}">${inner}</div>
    </div>`;
  bd.querySelector('.ps-name').textContent = label;
  bd.querySelector('.page-sheet').setAttribute('aria-label', label);
  return bd;
}

// the lines of a page that say who said the lines above them (a dash first)
const ATTRIBUTED_PAGES = ['dedication', 'epigraph', 'part'];

async function openPageSheet(shelf, meta, label) {
  const live = (await window.neo.readBookMeta(meta.id)) || meta;
  let chId = (live.chapterOrder || [])[0];
  if (!chId) {
    chId = 'ch-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
    live.chapterOrder = [chId];
    await writeBookMeta(live.id, live);
  }
  const html = await window.neo.readChapter(live.id, chId);
  const bd = sheetBackdrop(live.kind, label, '<div class="ps-label" hidden></div><div class="ps-body" contenteditable="true" role="textbox" aria-multiline="true"></div>');
  const lab = bd.querySelector('.ps-label');
  if (live.kind === 'part') { lab.hidden = false; lab.textContent = label; }
  if (PAGE_BACK.includes(live.kind)) { lab.hidden = false; lab.textContent = pageKindName(live.kind); }
  const body = bd.querySelector('.ps-body');
  body.setAttribute('aria-label', label);
  body.innerHTML = html && html.trim() ? html : '<p><br></p>';
  if (PAGE_PLACEHOLDERS[live.kind]) body.dataset.ph = PAGE_PLACEHOLDERS[live.kind]();
  // the page shows what it will print: a line that opens with a dash is set
  // as the name of whoever said the lines above it
  const settle = () => {
    body.classList.toggle('empty', !body.textContent.trim());
    if (!ATTRIBUTED_PAGES.includes(live.kind)) return;
    for (const p of body.querySelectorAll('p')) p.toggleAttribute('data-attr', isAttribution({ text: p.textContent.trim() }));
  };
  settle();
  let timer = null;
  let saved = body.innerHTML;
  const save = async () => {
    clearTimeout(timer);
    timer = null;
    normalizePageBody(body);
    const out = body.cloneNode(true);
    out.querySelectorAll('[data-attr]').forEach((p) => p.removeAttribute('data-attr'));
    if (out.innerHTML === saved) return;
    saved = out.innerHTML;
    await window.neo.writeChapter(live.id, chId, saved);
  };
  body.addEventListener('input', () => {
    settle();
    clearTimeout(timer);
    timer = setTimeout(save, 600);
  });
  body.addEventListener('paste', (e) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');
    if (pasted) document.execCommand('insertHTML', false, cleanPasteHtml(pasted));
    else if (text) {
      text.replace(/\r/g, '').split(/\n+/).filter((p) => p.trim()).forEach((p, i) => {
        if (i > 0) document.execCommand('insertParagraph');
        document.execCommand('insertText', false, p.trim());
      });
    }
  });
  document.body.appendChild(bd);
  document.execCommand('defaultParagraphSeparator', false, 'p');
  const close = async () => {
    if (!bd.isConnected) return;
    await save();
    bd.remove();
  };
  bd.querySelector('.ps-done').onclick = close;
  bd.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  });
  // the caret waits at the end of whatever the page already says
  body.focus();
  caretToEnd(body.lastElementChild || body);
}

function caretToEnd(el) {
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
}

// The cover opens to the title page: the book's title (the shelf's name),
// a subtitle, and the name it goes out under. One line each; Enter moves on.
async function openTitlePage(shelf, coverMeta) {
  const live = (await window.neo.readBookMeta(coverMeta.id)) || coverMeta;
  const bd = sheetBackdrop('title', t('Title Page'), `
    <div class="tp-field tp-t" contenteditable="true" role="textbox" spellcheck="false"></div>
    <div class="tp-field tp-s" contenteditable="true" role="textbox" spellcheck="false"></div>
    <div class="tp-field tp-a" contenteditable="true" role="textbox" spellcheck="false"></div>`);
  const fields = ['.tp-t', '.tp-s', '.tp-a'].map((s) => bd.querySelector(s));
  const [ti, su, au] = fields;
  const text = (el) => el.textContent.replace(/\s+/g, ' ').trim();
  [[ti, shelf.name, t('Title')], [su, live.subtitle || '', t('Subtitle')], [au, live.author || shelfAuthorName(shelf), t('Author')]]
    .forEach(([el, value, name]) => {
      el.textContent = value;
      el.dataset.ph = name;
      el.setAttribute('aria-label', name);
    });
  const close = async () => {
    if (!bd.isConnected) return;
    bd.remove();
    const title = text(ti) || shelf.name;
    const subtitle = text(su);
    const author = text(au) || shelfAuthorName(shelf);
    if (title === shelf.name && subtitle === (live.subtitle || '') && author === (live.author || '')) return;
    shelf.name = title;
    live.title = title;
    live.subtitle = subtitle;
    live.author = author;
    await writeBookMeta(live.id, live);
    await writeLibrary(library);
    renderShelves();
  };
  for (const f of fields) {
    // an emptied line shows its name again
    f.addEventListener('input', () => { if (!f.textContent) f.innerHTML = ''; });
    f.addEventListener('paste', (e) => {
      e.preventDefault();
      document.execCommand('insertText', false, e.clipboardData.getData('text/plain').replace(/\s+/g, ' '));
    });
    f.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const next = fields[fields.indexOf(f) + 1];
      if (next) { next.focus(); caretToEnd(next); } else close();
    });
  }
  document.body.appendChild(bd);
  bd.querySelector('.ps-done').onclick = close;
  bd.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  });
  ti.focus();
  const r = document.createRange();
  r.selectNodeContents(ti);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
}

/* ---------- the bound shelf's own menu (right-click its name) ---------- */

async function boundShelfMenu(shelf) {
  const through = (shelf.binding.numbering || 'through') !== 'restart';
  const options = [
    { label: t('Export the book…'), desc: t('EPUB, Word or PDF, with its cover, its pages and one table of contents.'), value: 'export' },
    {
      label: (through ? '✓ ' : '') + t('Number chapters straight through'),
      desc: through ? t('Each title picks up where the one before it left off.') : t('Each title starts again at Chapter 1.'),
      value: 'numbering'
    },
    { label: t('Unbind'), desc: t('A shelf of separate titles again. Its pages wait for the next binding.'), value: 'unbind' }
  ];
  // a touch screen has no hover to show the pages it could still have
  const missing = [];
  if (NO_HOVER) {
    const have = new Set();
    const body = [];
    for (const id of shelf.bookIds) {
      const m = await shelfMeta(id);
      if (isPageMeta(m)) have.add(m.kind);
      else if (m) body.push(m);
    }
    const offer = missingPages(body);
    missing.push(...[...PAGE_FRONT, 'prologue', 'epilogue', ...PAGE_BACK].filter((k) => !have.has(k) && offer(k)));
    if (missing.length) options.splice(1, 0, { label: t('Add a page…'), value: 'page' });
  }
  const choice = await optionModal(escHtml(t('“{name}” · one book', { name: shelf.name })), null, options);
  if (choice === 'export') {
    await exportBoundBook(shelf);
  } else if (choice === 'page') {
    const kind = await optionModal(t('Add a page…'), null, missing.map((k) => ({ label: pageKindName(k), value: k })));
    if (kind) await addPage(shelf, kind);
  } else if (choice === 'numbering') {
    shelf.binding.numbering = through ? 'restart' : 'through';
    await writeLibrary(library);
    toast(through ? t('Each title starts again at Chapter 1') : t('Chapters are numbered straight through'));
  } else if (choice === 'unbind') {
    await unbindShelf(shelf);
  }
}

// single shared drop-position indicator for shelf drags
let _dropInd = null;
function dropIndicator() {
  if (!_dropInd) {
    _dropInd = document.createElement('div');
    _dropInd.className = 'drop-indicator';
  }
  return _dropInd;
}

// Covers are two layers the shelf composites live: art (a seeded abstract,
// an image the writer chose, or one NEO painted from the text) and type.
// See covers.js. Painted art is read once and downsampled to tile size so
// forty books on a shelf cost about as much as forty small PNGs.
const artCache = new Map(); // bookId/file -> { url, canvas }

async function paintedArt(meta) {
  const art = meta.coverArt;
  if (!art || art.status !== 'done' || !art.file) return null;
  const key = meta.id + '/' + art.file;
  if (artCache.has(key)) return artCache.get(key);
  try {
    const data = await window.neo.readCover(meta.id, art.file);
    if (!data) { window.neo.logError('painted cover missing on disk: ' + key); return null; }
    const entry = await NeoCovers.fitImage(key, `data:${data.mime};base64,${data.base64}`);
    if (!entry) { window.neo.logError('painted cover would not decode: ' + key); return null; }
    artCache.set(key, entry);
    return entry;
  } catch (err) {
    window.neo.logError('painted cover: ' + (err && err.stack || err));
    return null;
  }
}

// Which layers a book has to show, and which one is showing. Nothing is
// ever thrown away by switching: the writer's image, NEO's painting, and the
// abstract all stay available, and coverMode just picks one.
const hasPainting = (meta) => !!(meta.coverArt && meta.coverArt.status === 'done' && meta.coverArt.file);
function coverMode(meta) {
  const m = meta.coverMode;
  if (m === 'image' && meta.coverImage) return 'image';
  if (m === 'painted' && hasPainting(meta)) return 'painted';
  if (m === 'abstract') return 'abstract';
  return meta.coverImage ? 'image' : hasPainting(meta) ? 'painted' : 'abstract';
}

function dressTile(el, meta) {
  if (isScript(meta)) return; // a script wears its card (scriptTile)
  el.classList.remove('has-cover');
  const mode = coverMode(meta);
  if (mode === 'image') {
    el.classList.add('has-cover');
    el.style.background = `#1d1d1d url("${coverUrl(meta)}") center / cover no-repeat`;
    return;
  }
  el.classList.toggle('cv-painting', !!(meta.coverArt && meta.coverArt.status === 'pending'));
  const token = (el._dressToken = (el._dressToken || 0) + 1);
  // a painting already decoded is drawn straight away; otherwise the
  // abstract shows instantly and the painting replaces it once read.
  // The tile may not be on the page yet when the art arrives, so the only
  // staleness check is whether this tile has been dressed again since.
  const cached = mode === 'painted' && artCache.get(meta.id + '/' + meta.coverArt.file);
  NeoCovers.dress(el, NeoCovers.plan(meta, cached || undefined));
  if (mode !== 'painted' || cached) return;
  paintedArt(meta).then((art) => {
    if (art && el._dressToken === token) NeoCovers.dress(el, NeoCovers.plan(meta, art));
  });
}

function bookTile(meta, opts = {}) {
  const el = document.createElement('div');
  el.className = 'book';
  el.dataset.bookId = meta.id;
  el.draggable = true;
  el.innerHTML = `
    <div class="b-text"><div class="b-title"></div><div class="b-author"></div></div>
    <span class="b-refresh" title="${t('New cover')}">&#8635;</span>
    <div class="b-painting" hidden></div>
    <div class="b-progress" hidden><div></div></div>`;
  el.querySelector('.b-author').textContent = meta.author || '';
  if (isScript(meta)) scriptTile(el, meta);
  else {
    dressTile(el, meta);
    el.querySelector('.b-painting').hidden = !(meta.coverArt && meta.coverArt.status === 'pending');
    el.querySelector('.b-refresh').onclick = async (e) => {
      e.stopPropagation();
      await refreshCover(meta, el);
    };
  }
  if (meta.wordGoal > 0) {
    const bar = el.querySelector('.b-progress');
    bar.hidden = false;
    const pct = Math.min(100, Math.round(((meta.wordCount || 0) / meta.wordGoal) * 100));
    bar.firstElementChild.style.width = pct + '%';
  }
  el.title = meta.wordGoal
    ? t('{title} — {count} / {goal} words', { title: shownTitle(meta.title), count: meta.wordCount || 0, goal: meta.wordGoal })
    : shownTitle(meta.title);
  el.onclick = () => (opts.cover ? openTitlePage(opts.cover, meta) : openBook(meta.id));
  pressable(el, [el.title, meta.author ? t('by {author}', { author: meta.author }) : ''].filter(Boolean).join(', '));
  const refresh = el.querySelector('.b-refresh');
  if (refresh) refresh.setAttribute('aria-hidden', 'true'); // the book's right-click menu offers the same
  el.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('application/x-neo-book', meta.id);
    // the ghost that rides under the cursor is a faded, smaller cover, held
    // by its top-left corner so it never sits on top of a drop target's label
    el.style.opacity = '0.45';
    el.style.transform = 'scale(0.7)';
    e.dataTransfer.setDragImage(el, 12, 12);
    setTimeout(() => { el.style.opacity = ''; el.style.transform = ''; el.classList.add('dragging'); }, 0);
  });
  el.addEventListener('dragend', () => el.classList.remove('dragging'));
  // images dragged from Finder onto a book become its cover;
  // manuscripts dropped here import onto this book's shelf
  el.addEventListener('dragover', (e) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      e.stopPropagation();
    }
  });
  el.addEventListener('drop', async (e) => {
    if (!e.dataTransfer.files || !e.dataTransfer.files.length) return;
    e.preventDefault();
    e.stopPropagation();
    let p = null;
    try { p = window.neo.pathForFile(e.dataTransfer.files[0]); } catch { /* no path */ }
    if (!p) return;
    if (/\.(png|jpe?g|webp)$/i.test(p) && !isScript(meta)) {
      const fname = await window.neo.setCover(meta.id, p);
      if (fname) {
        meta.coverImage = fname;
        meta.coverMode = 'image';
        await writeBookMeta(meta.id, meta);
        renderShelves();
      }
    } else if (/\.(docx|txt|md|fountain|fdx)$/i.test(p)) {
      const homeShelf = library.shelves.find((s) => s.bookIds.includes(meta.id)) || library.shelves[0];
      const results = await window.neo.importFiles([p]);
      if (results.length) await addImportedBooks(results, homeShelf);
    }
  });

  el.addEventListener('contextmenu', async (e) => {
    e.preventDefault();
    if (opts.cover) { await boundCoverMenu(opts.cover, meta, el); return; }
    // on a bound shelf, a title can open a new part of the book
    const home = shelfOf(meta.id);
    let startPart = false;
    if (isBound(home)) {
      const at = home.bookIds.indexOf(meta.id);
      const prev = at > 0 ? bookMetaCache.get(home.bookIds[at - 1]) : null;
      startPart = !(prev && prev.kind === 'part');
    }
    const script = isScript(meta);
    const trashLabel = window.Capacitor ? t('Delete book')
      : navigator.platform.toLowerCase().includes('win') ? t('Move to Recycle Bin') : t('Move to Trash');
    const canCopy = !!window.neo.duplicateBook && !isPageMeta(meta);
    // the cover's own choices, gathered in one place
    const coverItems = script ? [] : [
      ...(NO_HOVER ? [] : [{ label: meta.coverImage ? t('Replace cover art…') : t('Set cover art…'), value: 'cover' }]),
      { label: t('New cover'), value: 'refresh' },
      ...(!window.Capacitor ? [{ label: t('Save cover as image…'), value: 'saveCover' }] : []),
      ...(meta.coverImage ? ['-', { label: t('Remove cover art'), value: 'uncover', danger: true }] : [])
    ];
    let choice;
    if (NO_HOVER || window.Capacitor) {
      // a touch screen: the larger cards, each saying what it does
      const options = [];
      if (startPart) options.push({ label: t('Start a part here'), desc: t('A part page goes in before “{title}”.', { title: escHtml(shownTitle(meta.title)) }), value: 'part' });
      options.push(window.Capacitor
        ? { label: t('Export…'), desc: script ? t('PDF, Fountain or Final Draft, through the share sheet.') : t('Text, Markdown, HTML, PDF, Word or EPUB, through the share sheet.'), value: 'export' }
        : { label: t('Export…'), value: 'export' });
      if (canCopy) options.push({ label: t('Duplicate'), desc: t('A copy of the whole book on this shelf, to keep as a backup or try another version.'), value: 'duplicate' });
      if (coverItems.length) options.push({ label: t('Cover'), desc: t('A new cover, your own art, or a saved image.'), value: 'coverMenu' });
      options.push(
        { label: t('Set word goal…'), desc: t('Adds the subtle progress bar to the cover.'), value: 'goal' },
        ...(historyCanOpen() ? [{ label: t('Writing History…'), desc: t('Watch this book being written, keystroke by keystroke.'), value: 'history' }] : []),
        { label: t('Remove from bookshelf'), desc: t('Takes it off your shelves. The files stay safe in your NEO Library folder on disk.'), value: 'remove' },
        { label: trashLabel, desc: window.Capacitor ? t('Moves the book folder to Deleted Books in your NEO Library, where you can recover it.') : t('Sends the book folder to your system trash, where you can recover it.'), danger: true, value: 'trash' }
      );
      choice = await optionModal(t('“{title}”', { title: escHtml(shownTitle(meta.title)) }), null, options);
      if (choice === 'coverMenu') choice = await optionModal(t('Cover'), null, coverItems.filter((x) => x !== '-'));
    } else {
      // the desktop: a small menu at the pointer, the cover's choices one level in
      const items = [];
      if (startPart) items.push({ label: t('Start a part here'), value: 'part' }, '-');
      items.push({ label: t('Export…'), value: 'export' });
      if (canCopy) items.push({ label: t('Duplicate'), value: 'duplicate' });
      items.push({ label: t('Set word goal…'), value: 'goal' });
      if (historyCanOpen()) items.push({ label: t('Writing History…'), value: 'history' });
      if (coverItems.length) items.push({ label: t('Cover') + '  ›', value: 'coverMenu' });
      items.push('-', { label: t('Remove from bookshelf'), value: 'remove' }, { label: trashLabel, value: 'trash', danger: true });
      const x = e.clientX;
      const y = e.clientY;
      choice = await popMenu(x, y, items, { title: shownTitle(meta.title), from: el });
      if (choice === 'coverMenu') choice = await popMenu(x, y, coverItems, { title: t('Cover'), from: el });
    }
    if (choice === 'part') {
      await addPage(home, 'part', meta.id);
    } else if (choice === 'duplicate') {
      await duplicateBook(meta);
    } else if (choice === 'refresh') {
      await refreshCover(meta, el);
    } else if (choice === 'history') {
      await openHistory({ bookId: meta.id });
    } else if (choice === 'export' && script) {
      const fmt = await optionModal(t('Export “{title}”', { title: escHtml(shownTitle(meta.title)) }), null, [
        { label: 'PDF (.pdf)', value: 'pdf' },
        { label: 'Fountain (.fountain)', value: 'fountain' }, { label: 'Final Draft (.fdx)', value: 'fdx' },
        ...(canExportHistory() ? [{ label: t('Writing History…'), value: 'history' }] : [])
      ]);
      if (!fmt) return;
      if (fmt === 'history') { await exportWritingHistory(meta.id); return; }
      await openBook(meta.id);
      await doExport(fmt);
    } else if (choice === 'export') {
      const fmt = await optionModal(t('Export “{title}”', { title: escHtml(shownTitle(meta.title)) }), null, [
        { label: t('Text (.txt)'), value: 'txt' }, { label: t('Markdown (.md)'), value: 'md' }, { label: t('HTML (.html)'), value: 'html' },
        { label: 'PDF (.pdf)', value: 'pdf' },
        { label: t('Word (.docx)'), value: 'docx' }, { label: t('EPUB (.epub)'), value: 'epub' },
        ...(canExportHistory() && !isPageMeta(meta) ? [{ label: t('Writing History…'), value: 'history' }] : []),
        ...(window.Capacitor || isPageMeta(meta) ? [] : [{ label: t('Paperback for KDP…'), value: 'paperback' }])
      ]);
      if (!fmt) return;
      if (fmt === 'history') { await exportWritingHistory(meta.id); return; }
      if (window.Capacitor || fmt === 'paperback') {
        await openBook(meta.id);
        await doExport(fmt);
      } else {
        await exportFromShelf(meta.id, fmt);
      }
    } else if (choice === 'cover') {
      const src = await window.neo.pickCover();
      if (!src) return;
      const fname = await window.neo.setCover(meta.id, src);
      if (fname) {
        meta.coverImage = fname;
        meta.coverMode = 'image';
        await writeBookMeta(meta.id, meta);
        renderShelves();
      }
    } else if (choice === 'refresh') {
      await refreshCover(meta, el);
    } else if (choice === 'saveCover') {
      await saveCoverImage(meta);
    } else if (choice === 'uncover') {
      await window.neo.removeCover(meta.id);
      meta.coverImage = null;
      await writeBookMeta(meta.id, meta);
      renderShelves();
    } else if (choice === 'goal') {
      const goal = await askInput(t('Word count goal for “{title}”', { title: escHtml(shownTitle(meta.title)) }), t('e.g. 80000 — blank removes the goal'),
        meta.wordGoal ? String(meta.wordGoal) : '');
      if (goal === null) return;
      meta.wordGoal = parseInt(goal, 10) || 0;
      await writeBookMeta(meta.id, meta);
      renderShelves();
    } else if (choice === 'remove') {
      for (const s of library.shelves) s.bookIds = s.bookIds.filter((b) => b !== meta.id);
      await writeLibrary(library);
      renderShelves();
      toast(t('“{title}” removed from the shelves — its files are still in your NEO Library', { title: shownTitle(meta.title) }));
    } else if (choice === 'trash') {
      const ok = await window.neo.deleteBook(meta.id, meta.title);
      if (ok) {
        for (const s of library.shelves) s.bookIds = s.bookIds.filter((b) => b !== meta.id);
        await writeLibrary(library);
        renderShelves();
      }
    }
  });
  return el;
}

// A copy of the whole book beside it on the shelf, titled as a copy; the
// writer renames it (or keeps it as a backup). The open book's unsaved
// words go to disk first, so the copy has them.
async function duplicateBook(meta) {
  if (book && book.id === meta.id) {
    await Promise.all(book.chapterOrder.filter((c) => chapterHTML[c] !== undefined && chapterHTML[c] !== savedHTML[c]).map((c) => persistChapter(c)));
    flushAllSaves();
    await saveMeta();
    await new Promise((resolve) => setTimeout(resolve, 300)); // notes and sidecars, written alongside
  }
  let copy;
  try {
    copy = await window.neo.duplicateBook(meta.id, t('{title} (copy)', { title: meta.title }));
  } catch (err) {
    window.neo.logError('duplicate: ' + (err && err.stack || err));
    toast(t('Couldn’t copy the book: {error}', { error: plainError(err) }), 8000);
    return;
  }
  bookMetaCache.set(copy.id, copy);
  // beside the original; a title in a bound book gets its copy on a shelf
  // of its own, so the bound book doesn't print the story twice
  let shelf = library.shelves.find((x) => x.bookIds.includes(meta.id)) || library.shelves[0];
  if (isBound(shelf)) {
    const bound = shelf;
    shelf = library.shelves.find((x) => !isBound(x) && x.authorId === bound.authorId) || library.shelves.find((x) => !isBound(x));
    if (!shelf) {
      shelf = { id: 'shelf-' + Date.now().toString(36), name: t('Copies'), bookIds: [], ...(bound.authorId ? { authorId: bound.authorId } : {}) };
      library.shelves.push(shelf);
    }
    shelf.bookIds.push(copy.id);
  } else shelf.bookIds.splice(shelf.bookIds.indexOf(meta.id) + 1, 0, copy.id);
  await writeLibrary(library);
  renderShelves();
  toast(t('Made a copy: “{title}”', { title: copy.title }));
}

// The cover as a picture file: the writer's own image just as they gave it;
// otherwise the abstract at full size (1600×2560, KDP's ratio) with the
// title and author set on it. A painted cover never leaves NEO, here as in
// the exports, so a book showing one saves its abstract.
async function saveCoverImage(meta) {
  const defaultName = safeName(meta.title) + '-cover';
  let payload = null;
  if (coverMode(meta) === 'image') {
    const c = await window.neo.readCover(meta.id, meta.coverImage);
    if (c) payload = { format: c.ext, defaultName, content: c.base64, base64: true };
  }
  if (!payload) {
    await NeoCovers.ready;
    // JPEG: what KDP asks for, and a tenth the size of a PNG of all that grain
    const url = NeoCovers.renderFull(meta, {}).toDataURL('image/jpeg', 0.92);
    payload = { format: 'jpg', defaultName, content: url.split(',')[1], base64: true };
  }
  const saved = await window.neo.exportSave(payload);
  if (saved) toast(t('Saved: {file}', { file: saved.split(/[\\/]/).pop() }));
}

/* ---- painted covers ----
   At a thousand words a story has a shape, so NEO reads it and paints an
   abstract cover to sit under the type. The writer's own cover (coverImage)
   always wins; the abstract is the fallback; painting never blocks typing. */

const PAINT_AT = 1000;
const STALE_PAINT_MS = 10 * 60 * 1000; // a job that never came back

function paintable(meta) {
  if (!meta || meta.coverImage) return false; // the writer's own art is never painted over
  if (isScript(meta)) return false; // a script is card stock
  if (meta.kind) return false; // a bound book's pages show no cover of their own
  if ((meta.wordCount || 0) < PAINT_AT) return false;
  const art = meta.coverArt;
  if (!art) return true;
  if (art.status === 'pending') return Date.now() - Date.parse(art.at || 0) > STALE_PAINT_MS;
  return false; // done, shelved, or failed: the ↻ on the tile is the way back in
}

function bookPlainText() {
  return book.chapterOrder.map((id) => chapterText(id)).join('\n\n');
}

// Paint the open book, or a book on the shelf (text is read from disk then).
async function requestPaint(meta, text) {
  const provider = coverProvider();
  if (!(await window.neo.hasSecret(provider))) {
    if (!library.coverArtNudged) {
      library.coverArtNudged = true;
      await writeLibrary(library);
      toast(t('This story just passed {n} words — add an API key under File → Cover Art… and NEO will paint it a cover.', { n: PAINT_AT }), 8000);
    }
    return;
  }
  meta.coverArt = { status: 'pending', at: new Date().toISOString(), words: meta.wordCount || 0 };
  if (book && book.id === meta.id) scheduleMetaSave();
  else await writeBookMeta(meta.id, meta);
  markPainting(meta.id, true);
  if (text == null) {
    const m = await window.neo.readBookMeta(meta.id);
    const parts = [];
    for (const chId of (m && m.chapterOrder) || []) {
      const holder = document.createElement('div');
      holder.innerHTML = await window.neo.readChapter(meta.id, chId);
      holder.querySelectorAll('.darling-anchor, .ph-mark, .ghost').forEach((n) => n.remove());
      parts.push(holder.innerText);
    }
    text = parts.join('\n\n');
  }
  const cs = coverSettings();
  const mine = (cs.models && cs.models[provider]) || {};
  let res = null;
  try {
    res = await window.neo.paintCover(meta.id, text, { provider, textModel: mine.text, imageModel: mine.image, quality: cs.quality });
  } catch (err) {
    window.neo.logError('paint request: ' + (err && err.stack || err));
    res = { error: String((err && err.message) || err) };
  }
  // the writer may have moved on — write to whichever copy of the meta is live
  const live = (book && book.id === meta.id) ? book : (await window.neo.readBookMeta(meta.id)) || meta;
  if (res && res.file) {
    live.coverArt = { status: 'done', file: res.file, brief: res.brief, words: meta.wordCount || 0, at: new Date().toISOString() };
    if (!live.coverImage) live.coverMode = 'painted';
    artCache.delete(meta.id + '/' + res.file);
  } else {
    live.coverArt = { status: 'failed', error: (res && res.error) || 'unknown', at: new Date().toISOString() };
    toast(t('NEO couldn’t paint that cover: {error}', { error: live.coverArt.error }), 7000);
  }
  if (live === book) scheduleMetaSave();
  else await writeBookMeta(meta.id, live);
  markPainting(meta.id, false);
  if (!$('#bookshelf-view').hidden) renderShelves();
}

// shimmer on the tile while its painting is in flight
function markPainting(bookId, on) {
  for (const el of $$('.book')) {
    if (el.dataset.bookId !== bookId) continue;
    el.classList.toggle('cv-painting', on);
    const sh = el.querySelector('.b-painting');
    if (sh) sh.hidden = !on;
  }
}

// the ↻ on a tile: switch between the covers a book has, re-roll the
// abstract, or paint a fresh one from the text
async function refreshCover(meta, el) {
  const mode = coverMode(meta);
  const enough = (meta.wordCount || 0) >= PAINT_AT;
  // a bound book's cover has no text of its own to paint from
  const hasKey = meta.kind !== 'cover' && await window.neo.hasSecret(coverProvider());
  const options = [];
  if (meta.coverImage && mode !== 'image') options.push({ label: t('Show your cover art'), desc: t('The image you gave this book.'), value: 'image' });
  if (hasPainting(meta) && mode !== 'painted') options.push({ label: t('Show NEO’s painting'), desc: t('The cover painted from the text.'), value: 'painted' });
  if (mode !== 'abstract') options.push({ label: t('Show the abstract'), desc: t('The seeded cover every book starts with.'), value: 'abstract' });
  options.push({ label: t('New type & colours'), desc: mode === 'abstract' ? t('A fresh abstract and a different title style.') : t('Re-sets the title in a different style over the same art.'), value: 'reroll' });
  if (hasKey) {
    options.push(enough
      ? { label: hasPainting(meta) ? t('Paint it again') : t('Paint a cover from the text'), desc: t('NEO reads the manuscript and paints a new cover. About a minute; a few cents.'), value: 'paint' }
      : { label: t('Paint a cover from the text'), desc: t('Once the story passes {n} words.', { n: PAINT_AT }), value: 'nope' });
  }
  // a plain abstract with nothing else to offer just re-rolls
  const choice = options.length === 1 ? 'reroll' : await optionModal(t('Cover for “{title}”', { title: escHtml(shownTitle(meta.title)) }), null, options);
  if (!choice || choice === 'nope') return;
  const live = (book && book.id === meta.id) ? book : meta;
  if (choice === 'paint') {
    if (meta.coverArt && meta.coverArt.status === 'pending' && !paintable(meta)) { toast(t('Still painting…')); return; }
    live.coverMode = 'painted';
    requestPaint(live, book && book.id === meta.id ? bookPlainText() : null);
    return;
  }
  if (choice === 'reroll') {
    live.coverSeed = meta.id + ':' + (meta.wordCount || 0) + ':' + Date.now().toString(36);
    if (mode === 'image') live.coverMode = 'abstract';
  } else {
    live.coverMode = choice;
  }
  if (live === book) scheduleMetaSave(); else await writeBookMeta(meta.id, live);
  dressTile(el, live);
}

async function createBookOnShelf(shelf) {
  const meta = await window.neo.createBook({ author: displayAuthor() });
  meta.tabNames = {
    notes: (library.tabDefaults && library.tabDefaults.notes) || 'Notes',
    outline: (library.tabDefaults && library.tabDefaults.outline) || 'Outline'
  };
  await writeBookMeta(meta.id, meta);
  await placeTitle(shelf, meta.id);
  await writeLibrary(library);
  openBook(meta.id);
}

// While dragging a book or shelf, nearing the window's top or bottom edge
// scrolls the bookshelf — faster the deeper into the edge zone you push.
let shelfScrollDir = 0;
let shelfScrollRAF = null;
function shelfAutoScrollStep() {
  if (!shelfScrollDir) { shelfScrollRAF = null; return; }
  $('#bookshelf-view').scrollTop += shelfScrollDir;
  shelfScrollRAF = requestAnimationFrame(shelfAutoScrollStep);
}
{
  const view = $('#bookshelf-view');
  const EDGE = 90;
  view.addEventListener('dragover', (e) => {
    const h = window.innerHeight;
    if (e.clientY < EDGE) shelfScrollDir = -Math.ceil((EDGE - e.clientY) / 5);
    else if (e.clientY > h - EDGE) shelfScrollDir = Math.ceil((e.clientY - (h - EDGE)) / 5);
    else shelfScrollDir = 0;
    if (shelfScrollDir && !shelfScrollRAF) shelfScrollRAF = requestAnimationFrame(shelfAutoScrollStep);
  });
  view.addEventListener('drop', () => { shelfScrollDir = 0; });
  view.addEventListener('dragend', () => { shelfScrollDir = 0; });
  view.addEventListener('dragleave', (e) => { if (!e.relatedTarget) shelfScrollDir = 0; });
}

$('#add-shelf-btn').onclick = async () => {
  library.shelves.push({
    id: 'shelf-' + Date.now().toString(36),
    name: t('New Shelf'),
    bookIds: [],
    authorId: currentAuthor().id
  });
  await writeLibrary(library);
  await renderShelves();
  // the new shelf may be below the fold: bring it up, name ready to type over
  const shelves = $$('#shelves .shelf');
  const last = shelves[shelves.length - 1];
  if (last) {
    last.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
    const label = last.querySelector('.shelf-label');
    if (label) setTimeout(() => {
      if (NO_HOVER) { label.click(); return; }
      label.focus();
      const r = document.createRange();
      r.selectNodeContents(label); // selected: typing replaces "New Shelf"
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    }, 350);
  }
};

// Drag a book up to your name: if you write under other names too, a little
// rack of shelves unfolds beneath it, one per pen name, and the book can be
// dropped onto one. It lands on that name's top shelf and takes the name.
// With a single author there is nothing to unfold, so nothing happens.
(() => {
  const chip = $('#author-chip');
  let rack = null;
  let hideTimer = null;
  const otherAuthors = () => (library.authors || []).filter((a) => a.id !== currentAuthor().id);
  const isBookDrag = (e) => e.dataTransfer && e.dataTransfer.types.includes('application/x-neo-book');

  function showRack() {
    if (rack) return;
    const others = otherAuthors();
    if (!others.length) return;
    rack = document.createElement('div');
    rack.id = 'pen-rack';
    for (const a of others) {
      const slot = document.createElement('div');
      slot.className = 'pen-slot';
      slot.textContent = a.name;
      slot.dataset.authorId = a.id;
      slot.addEventListener('dragover', (e) => {
        if (!isBookDrag(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        slot.classList.add('over');
        clearTimeout(hideTimer);
      });
      slot.addEventListener('dragleave', () => slot.classList.remove('over'));
      slot.addEventListener('drop', async (e) => {
        if (!isBookDrag(e)) return;
        e.preventDefault();
        e.stopPropagation();
        const bookId = e.dataTransfer.getData('application/x-neo-book');
        hideRack();
        await moveBookToAuthor(bookId, a.id);
      });
      rack.appendChild(slot);
    }
    const r = chip.getBoundingClientRect();
    rack.style.top = (r.bottom + 8) + 'px';
    // the rack hangs from the name and reaches leftward, so the names on its
    // planks sit well clear of the cover riding under the cursor
    rack.style.right = Math.max(12, window.innerWidth - r.right) + 'px';
    document.body.appendChild(rack);
    requestAnimationFrame(() => rack.classList.add('open'));
  }
  function hideRack() {
    clearTimeout(hideTimer);
    if (rack) { rack.remove(); rack = null; }
  }
  const armHide = () => { clearTimeout(hideTimer); hideTimer = setTimeout(hideRack, 400); };

  chip.addEventListener('dragenter', (e) => { if (isBookDrag(e)) { e.preventDefault(); showRack(); } });
  chip.addEventListener('dragover', (e) => { if (isBookDrag(e)) { e.preventDefault(); clearTimeout(hideTimer); } });
  chip.addEventListener('dragleave', armHide);
  document.addEventListener('dragover', (e) => {
    // leaving both the chip and the rack lets the rack fold away
    if (rack && !rack.contains(e.target) && e.target !== chip) armHide();
  });
  document.addEventListener('dragend', hideRack);
  document.addEventListener('drop', hideRack);
})();

// Esc mid-drag cancels the drag itself (the browser does that). Esc or ⌘Z
// in the seconds after a drop puts the book back where it came from.
let lastShelfMove = null;
async function moveBookToAuthor(bookId, authorId) {
  const target = (library.authors || []).find((a) => a.id === authorId);
  const shelf = target && shelvesFor(target.id)[0];
  if (!shelf) return;
  const meta = await window.neo.readBookMeta(bookId);
  if (!meta) return;
  const from = library.shelves.find((s) => s.bookIds.includes(bookId));
  lastShelfMove = {
    bookId, title: meta.title, author: meta.author,
    shelfId: from ? from.id : null, index: from ? from.bookIds.indexOf(bookId) : 0,
    authorId: currentAuthor().id, at: Date.now()
  };
  for (const s of library.shelves) s.bookIds = s.bookIds.filter((b) => b !== bookId);
  await placeTitle(shelf, bookId, true); // the top shelf, first in line
  meta.author = target.name;
  await writeBookMeta(bookId, meta);
  await writeLibrary(library);
  renderShelves();
  toast(t('“{title}” now sits on {name}’s top shelf — Esc puts it back', { title: shownTitle(meta.title), name: target.name }), 6000);
}
async function undoShelfMove() {
  const m = lastShelfMove;
  if (!m || Date.now() - m.at > 15000) return false;
  lastShelfMove = null;
  const home = library.shelves.find((s) => s.id === m.shelfId) || shelvesFor(m.authorId)[0] || library.shelves[0];
  for (const s of library.shelves) s.bookIds = s.bookIds.filter((b) => b !== m.bookId);
  home.bookIds.splice(Math.min(m.index, home.bookIds.length), 0, m.bookId);
  const meta = await window.neo.readBookMeta(m.bookId);
  if (meta) { meta.author = m.author; await writeBookMeta(m.bookId, meta); }
  await writeLibrary(library);
  renderShelves();
  toast(t('“{title}” is back where it was', { title: shownTitle(m.title) }));
  return true;
}
document.addEventListener('keydown', (e) => {
  if (!$('#editor-view').hidden || !lastShelfMove) return;
  const undoKey = e.key === 'Escape' || ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z');
  if (!undoKey) return;
  if (document.querySelector('.modal-backdrop:not([hidden])')) return;
  e.preventDefault();
  e.stopPropagation();
  undoShelfMove();
}, true);

// File → Reshelve a Book…: a book taken off the shelves is still on disk;
// this puts it back, on the current name's first shelf
async function reshelveBook() {
  const all = await window.neo.listBooks();
  const shelved = new Set(library.shelves.flatMap((s) => [...s.bookIds, ...((s.binding && s.binding.parked) || []).map((p) => p.id)]));
  // a bound book's pages aren't books to write in
  const loose = all.filter((b) => !shelved.has(b.id) && !b.kind).sort((a, b) => (b.modified || '').localeCompare(a.modified || ''));
  if (!loose.length) { toast(t('Every book in your library is already on a shelf')); return; }
  const pick = await optionModal(t('Books in your library that aren’t on a shelf'), null,
    loose.map((b) => ({ label: escHtml(b.title), desc: b.author ? escHtml(t('by {author}', { author: b.author })) : '', value: b.id })));
  if (!pick) return;
  const shelf = shelvesFor(currentAuthor().id)[0] || library.shelves[0];
  await placeTitle(shelf, pick);
  await writeLibrary(library);
  renderShelves();
  toast(t('“{title}” is back on the shelf', { title: loose.find((b) => b.id === pick).title }));
}

$('#author-chip').onclick = async () => {
  const cur = currentAuthor();
  const opts = [];
  for (const a of library.authors) {
    if (a.id !== cur.id) {
      opts.push({ label: t('Write as {name}', { name: escHtml(a.name) }), desc: t('Switch to this name’s shelves'), value: 'sw:' + a.id });
    }
  }
  opts.push({ label: t('Rename {name}', { name: escHtml(cur.name) }), value: 'rename' });
  opts.push({ label: t('Add a pen name…'), desc: t('A separate set of shelves under another name'), value: 'add' });
  if (library.authors.length > 1) {
    opts.push({
      label: t('Remove {name}', { name: escHtml(cur.name) }),
      desc: t('These shelves and books move to your other name. Nothing is deleted from disk.'),
      danger: true, value: 'del'
    });
  }
  const pick = await optionModal(t('Writing as {name}', { name: escHtml(cur.name) }), null, opts);
  if (!pick) return;
  if (pick.startsWith('sw:')) {
    library.currentAuthorId = pick.slice(3);
  } else if (pick === 'rename') {
    const name = await askInput(t('Author name'), t('Shown on your title pages'), cur.name);
    if (name === null) return;
    cur.name = name || cur.name;
    library.authorName = library.authors[0].name; // legacy field follows the first name
  } else if (pick === 'add') {
    const name = await askInput(t('New pen name'), t('Shown on that name’s title pages'), '');
    if (!name) return;
    const a = { id: 'a-' + Date.now().toString(36), name };
    library.authors.push(a);
    library.currentAuthorId = a.id;
    library.shelves.push({
      id: 'shelf-' + Date.now().toString(36),
      name: t('Works in Progress'), bookIds: [], authorId: a.id
    });
  } else if (pick === 'del') {
    const homeId = library.authors[0].id;
    const rest = library.authors.filter((a) => a.id !== cur.id);
    const target = rest[0];
    for (const s of library.shelves) {
      if ((s.authorId || homeId) === cur.id) s.authorId = target.id;
    }
    library.authors = rest;
    library.currentAuthorId = target.id;
    library.authorName = library.authors[0].name;
  }
  await writeLibrary(library);
  renderShelves();
};

/* ================================================================== */
/*  RECORDING                                                          */
/*  Writing History (docs/neo-recording-plan.md). Every change to a   */
/*  chapter's HTML comes through setChapterHTML with its cause, and   */
/*  the recorder keeps it, with the keys, caret, clipboard and focus  */
/*  around it, as lines in recording.js's format. The lines go to     */
/*  disk as a chunk in flushAllSaves (every 20 s, and on blur, hide   */
/*  and close). A crash can leave a chapter up to 20 s ahead of the   */
/*  recording; the next session's `b` line catches it up, so the      */
/*  words are kept, only those seconds' keys are not. persistChapter  */
/*  reconciles first: a change the recorder didn't see is logged as   */
/*  `unobserved`. Off when library.recordWriting is false, and where  */
/*  window.neo has no recStart (Pocket in a web view without gzip).   */
/*  In the console:                                                    */
/*    rec.check()        replays this session against the page        */
/*    rec.verbose = true logs each line as it is recorded             */
/*    rec.strict = true  also notices the page drifting between events */
/* ================================================================== */

const Rec = window.NeoRecording;
const REC_IDLE = 60000;         // no keys or edits this long: an `idle` line
const REC_WALL = 5 * 60000;     // a wall-clock line this often
const REC_ROLLUP = 10 * 60000;  // chunks joined into one file this often

// Writing History's one setting (File → Record Writing History) has three
// levels: 'off', 'record', and 'timestamp' (recorded, then sealed and
// timestamped: Proof of when I wrote). It's kept as recordWriting and
// proveWriting, which a NEO from before reads. Nothing is recorded in a
// library whose writer hasn't been asked yet (historyAsked, askHistoryLevel).
const historyCan = () => !!(Rec && window.neo.recStart);
const recordingWanted = () => !!(historyCan() && library && library.historyAsked === true && library.recordWriting !== false);
const historyLevel = () => (!recordingWanted() ? 'off' : window.neo.proofSet && library.proveWriting === true ? 'timestamp' : 'record');

function recSessionId() {
  return new Date().toISOString().replace(/\.\d+Z$/, 'Z').replace(/:/g, '-') + '-' +
    Math.random().toString(36).slice(2, 6).padEnd(4, '0');
}

// A place in a chapter as an `s` line holds it: the paragraph's index among
// the body's Rec.CARET_BLOCKs, and the letters before it within that
// paragraph. Changing what's counted is a new recording format.
function recPoint(body, node, offset) {
  const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  const p = el && el.closest ? el.closest(Rec.CARET_BLOCK) : null;
  if (!p || !body.contains(p)) return [0, 0];
  const r = document.createRange();
  r.selectNodeContents(p);
  r.setEnd(node, offset);
  return [[...body.querySelectorAll(Rec.CARET_BLOCK)].indexOf(p), r.toString().length];
}
const recBodyOf = (n) => {
  const el = n && (n.nodeType === Node.TEXT_NODE ? n.parentElement : n);
  return el && el.closest ? el.closest('.chapter-body') : null;
};
// [chapter, anchor pIdx, off, focus pIdx, off], or null outside the chapters
function recSelection() {
  const sel = window.getSelection();
  if (!sel.rangeCount) return null;
  const body = recBodyOf(sel.focusNode);
  if (!body) return null;
  const f = recPoint(body, sel.focusNode, sel.focusOffset);
  const a = recBodyOf(sel.anchorNode) === body ? recPoint(body, sel.anchorNode, sel.anchorOffset) : f;
  return [body.closest('.chapter').dataset.id, ...a, ...f];
}

const rec = {
  on: false,
  bookId: null,
  device: null,
  appVersion: '',
  prev: null,        // the last hash of this device's previous session for the book
  w: null,           // the session's Rec.SessionWriter
  session: null,     // { id, day }
  model: {},         // chapterId -> HTML as the recorder last saw it (and each stream's text)
  wrote: {},         // stream -> its text at its last `w`
  known: {},         // chapterId -> HTML where this device's recordings left it
  unseen: new Set(), // chapters in the book as it opened that this device never recorded (baseUnseen)
  startKnown: {},    // known, as this session began
  edited: {},        // chapterId -> characters inserted and deleted since its last full `b` (anchors)
  inSession: new Set(), // chapters with a `b` line this session
  cur: null,         // the chapter the lines apply to
  clock: 0,          // performance.now() of the last event, rounded
  lastKind: '',
  key: null,         // the key that is down: { code }
  lastKeyAt: -1e9,
  lastPointerAt: -1e9,
  pointerDown: false,
  sel: '',           // the last caret or selection seen
  copied: [],        // hashes of what was copied or cut in NEO lately
  copiedFrom: new Map(), // hash -> the moment of Writing History it was copied from: [session, line, device]
  orderSig: '',
  live: false,       // the session holds a change: worth keeping
  chunks: 0,         // sent since the last rollup
  retry: [],
  counts: { keys: 0, edits: 0, bases: 0, drops: 0, writes: 0, unobserved: 0, drift: 0 },
  idleTimer: 0,
  verbose: false,
  strict: false,

  async begin(bookId) {
    this.end();
    this.bookId = bookId;
    this.model = {};
    this.wrote = {};
    this.unseen = new Set();
    if (!recordingWanted()) return;
    let info;
    try { info = await window.neo.recStart(bookId, proofFlags()); } catch (err) {
      window.neo.logError('recording start: ' + (err && err.message || err));
      return;
    }
    if (this.bookId !== bookId || !info) return; // another book opened meanwhile
    this.device = info.device;
    this.appVersion = info.app || '';
    this.prev = info.prev || null;
    this.known = info.known || {};
    this.edited = info.edited || {};
    this.on = true;
    this.newSession();
  },

  newSession() {
    const now = new Date();
    this.session = { id: recSessionId(), day: writingDay(now) };
    this.w = new Rec.SessionWriter({
      neoRec: Rec.FORMAT, session: this.session.id, device: this.device, app: this.appVersion,
      book: this.bookId, day: this.session.day, startedAt: now.toISOString(),
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone || '', prev: this.prev
    });
    this.startKnown = { ...this.known };
    this.inSession = new Set();
    this.cur = null;
    this.sel = '';
    this.orderSig = '';
    this.live = false;
    this.chunks = 0;
    this.retry = [];
    this.clock = Math.round(performance.now());
    this.lastKind = '';
    this.counts = { keys: 0, edits: 0, bases: 0, drops: 0, writes: 0, unobserved: 0, drift: 0 };
  },

  // The session's last line, its last chunk, and the folder joined into one
  // file. A session that never changed a chapter leaves nothing behind.
  // The promise is the close reaching the disk.
  closeSession() {
    clearTimeout(this.idleTimer);
    if (!this.live) return Promise.resolve();
    const { keys, edits, unobserved } = this.counts;
    this.event(['end', { keys, edits, unobserved }]);
    this.flush();
    for (const chId of this.inSession) {
      if (chId in this.model) this.known[chId] = this.model[chId];
      else delete this.known[chId];
    }
    this.prev = this.w.H;
    this.live = false;
    return window.neo.recClose(this.bookId, this.session.id).catch((err) => window.neo.logError('recording close: ' + (err && err.message || err)));
  },

  end() {
    let closed = Promise.resolve();
    if (this.on) {
      closed = this.closeSession();
      if (this.counts.unobserved) console.warn('[rec] closed with', this.counts.unobserved, 'unobserved changes');
    }
    this.on = false;
    this.bookId = null;
    return closed;
  },

  // a session is at most the writer's day (the goals' day, which ends at
  // library.dayEndsAt): when it ends the next one starts
  tick() {
    if (this.session.day === writingDay()) return;
    this.closeSession();
    this.newSession();
  },

  // an event, dt after the one before (or at the same moment, dt 0)
  event(fields, sameMoment = false) {
    let dt = 0;
    if (!sameMoment) {
      const now = Math.round(performance.now());
      dt = Math.max(0, now - this.clock);
      this.clock = now;
    }
    this.put([dt, ...fields]);
  },
  // a description of what follows: dt 0, and the clock stays
  meta(fields) { this.put([0, ...fields]); },
  put(line) {
    this.w.push(line);
    this.lastKind = line[1];
    if (this.verbose) console.debug('[rec]', JSON.stringify(line).slice(0, 300));
  },

  focusChapter(chId) {
    if (this.cur === chId) return;
    this.cur = chId;
    this.meta(['ch', chId]);
  },

  order() {
    if (!book || !this.live) return;
    const sig = book.chapterOrder.join(' ');
    if (sig === this.orderSig) return;
    this.orderSig = sig;
    this.meta(['o', [...book.chapterOrder]]);
  },

  // Chapters in the book as it opened that this device never recorded
  // (unseen) get their baseline once the session first records anything,
  // all together, so History shows each on every day it was in the book,
  // not only from its first edit; opening a book alone records nothing.
  // They're one moment, and true when there were any, so the line that
  // brought them shares it (the player's first moment is after them all).
  baseUnseen() {
    if (!this.unseen.size) return false;
    const ids = [...this.unseen].filter((id) => this.model[id] !== undefined);
    this.unseen.clear();
    ids.forEach((id, i) => this.establish(id, this.model[id], i > 0));
    return ids.length > 0;
  },

  // The first time this session touches a chapter, a `b` line says what it
  // was: as the last recording left it (only its hash, or all of it again
  // when an anchor is due), then the change made while nothing was
  // recording (catch-up); or, for a chapter never recorded, all of it
  // (baseline). Rec.baseLines decides.
  establish(chId, html, same = false) {
    if (this.inSession.has(chId)) return;
    this.unseen.delete(chId);
    if (this.baseUnseen()) same = true;
    this.inSession.add(chId);
    this.live = true;
    this.counts.bases++;
    Rec.baseLines(chId, html, this.known[chId], this.edited[chId] || 0).forEach((line, i) => {
      if (line[0] === 'b' && line[2] !== null) this.edited[chId] = 0;
      if (line[0] === 'e') this.counted(chId, line[2], line[3]);
      this.event(line, same || i > 0);
    });
    this.cur = chId;
    this.order();
  },

  // what an anchor waits on: the characters inserted and deleted
  counted(chId, del, ins) {
    this.edited[chId] = (this.edited[chId] || 0) + del + ins.length;
  },

  change(chId, html, cause, opts = {}) {
    if (!this.on) return;
    html = html == null ? '' : String(html);
    if (cause === 'open') { // the book as it opened: nothing happened yet
      this.model[chId] = html;
      if (Rec.isStream(chId)) this.wrote[chId] = html;
      // a chapter changed while nothing recorded (a file put back from a
      // backup, another program) is caught up now, not at its first edit,
      // so History shows the book as it is; one never recorded here waits
      // for the session's first line (baseUnseen)
      else if (this.known[chId] === undefined) this.unseen.add(chId);
      else if (this.known[chId] !== html) this.establish(chId, html);
      if (this.live) this.baseUnseen();
      return;
    }
    this.tick(); // (a new day's session starts before the change, not after)
    const old = this.model[chId];
    this.model[chId] = html;
    if (old === undefined) {
      // a chapter new to the page: all of it, with what made it (and, for a
      // restore, the moment it came from)
      const same = this.baseUnseen();
      this.inSession.add(chId);
      this.live = true;
      this.counts.bases++;
      this.edited[chId] = 0;
      if (opts.ref) this.event(['x', cause, ...opts.ref], same);
      this.event(['b', chId, html, Rec.digest(html), cause], same || !!opts.ref);
      this.cur = chId;
      this.order();
      this.noteCaret();
      return;
    }
    if (old === html) return;
    this.establish(chId, old);
    this.focusChapter(chId);
    this.counts.edits++;
    if (cause === 'input') {
      let sp = Rec.splice(old, html, opts.hint);
      // what a key typed happened when the key went down
      let now = !!this.key && this.lastKind === 'k';
      // A key that comes with a tidy elsewhere in the chapter (the junk
      // spans an open strips, saved with the next change): the tidy as its
      // own changes, a splice per run of paragraphs, and only the run at the
      // caret as what was typed, so a letter isn't the chapter between
      if ((sp.ins + old.slice(sp.at, sp.at + sp.del)).includes('</p>')) {
        const runs = Rec.splices(old, html);
        const h = typeof opts.hint === 'function' ? opts.hint(html) : opts.hint;
        const k = runs.length > 1 && typeof h === 'number' ? runs.findIndex((r) => h >= r.at && h <= r.at + r.ins.length) : -1;
        if (k >= 0) {
          this.event(['x', 'tidy'], now);
          now = true;
          // right to left, each where the HTML was before any of them, so
          // the typed run is where Rec.splices put it once they're made
          let delta = 0;
          const at = runs.map((r) => { const a = r.at - delta; delta += r.ins.length - r.del; return a; });
          let tidied = old;
          for (let j = runs.length - 1; j >= 0; j--) {
            if (j === k) continue;
            this.counted(chId, runs[j].del, runs[j].ins);
            this.event(['e', at[j], runs[j].del, runs[j].ins], true);
            tidied = Rec.applyEdit(tidied, at[j], runs[j].del, runs[j].ins);
          }
          // (placed by the caret, as typing is, among repeated letters)
          sp = Rec.splice(tidied, html, opts.hint);
        }
      }
      const line = ['e', sp.at, sp.del, sp.ins, Rec.inputCode(opts.inputType)];
      if (!this.key) line.push(0); // no key was down: dictation, autocorrect, a tool
      this.counted(chId, sp.del, sp.ins);
      this.event(line, now);
      this.active();
    } else {
      // NEO's own moves change a chapter all at once: a splice per run of
      // paragraphs they changed, so a name replaced on the first page and
      // the last is two small splices, not the chapter between them. A
      // restore says the moment it came from: [session, line, device]
      this.event(['x', cause, ...(opts.ref || [])]);
      for (const sp of Rec.splices(old, html)) {
        this.counted(chId, sp.del, sp.ins);
        this.event(['e', sp.at, sp.del, sp.ins], true);
      }
      this.order();
    }
    this.noteCaret();
  },

  drop(chId, cause) {
    if (!this.on || !(chId in this.model)) return;
    this.tick();
    this.establish(chId, this.model[chId]); // its words are in the history before it goes
    delete this.model[chId];
    this.counts.drops++;
    this.event(['d', chId, cause]);
    this.order();
  },

  // Titles, the outline and stickies, as the book holds them now: what
  // changed since the recorder last looked is recorded with `cause`. Those
  // in `written` were just written to disk (book.json, stickies.json): a
  // `w` for each that changed since its last.
  streams(cause = 'edit', written = []) {
    if (!this.on || !book || book.id !== this.bookId) return;
    for (const [id, text] of Object.entries(Rec.streamTexts(book, stickies))) {
      if (this.model[id] === undefined) continue; // not opened yet
      if (this.model[id] !== text) this.change(id, text, cause);
      if (written.includes(id) && this.wrote[id] !== text) this.reconcile(id, text);
    }
  },

  // Just before a chapter is written: the write is explained by what the
  // recording already holds, or the difference is logged as unobserved.
  // Then the write itself. It reaches the disk with the next flush.
  reconcile(chId, html) {
    if (!this.on) return;
    html = html == null ? '' : String(html);
    this.tick();
    if (this.model[chId] !== html) {
      this.counts.unobserved++;
      console.warn('[rec] unobserved change to', chId, Rec.splice(this.model[chId] || '', html));
      this.change(chId, html, 'unobserved');
    }
    this.establish(chId, html);
    if (Rec.isStream(chId)) this.wrote[chId] = html;
    this.counts.writes++;
    this.event(chId === this.cur ? ['w', Rec.digest(html)] : ['w', Rec.digest(html), chId]);
  },

  keyDown(e, chId) {
    if (['Shift', 'Control', 'Alt', 'Meta', 'AltGraph'].includes(e.key)) return; // shown as the mods of the key they go with
    this.tick();
    this.focusChapter(chId); // before the key, so what it types can join a run
    const mods = (e.shiftKey ? Rec.MOD.shift : 0) | (e.ctrlKey ? Rec.MOD.ctrl : 0) | (e.altKey ? Rec.MOD.alt : 0) |
      (e.metaKey ? Rec.MOD.meta : 0) | (e.repeat ? Rec.MOD.repeat : 0) | (e.isTrusted ? 0 : Rec.MOD.untrusted);
    this.counts.keys++;
    this.event(['k', e.code || '', mods]);
    this.key = { code: e.code };
    this.lastKeyAt = performance.now();
    this.active();
  },

  keyUp(e) {
    if (this.key && this.key.code === e.code) this.key = null;
  },

  // where an edit leaves the caret goes without saying
  noteCaret() {
    const s = recSelection();
    if (s) this.sel = s.join(' ');
  },

  selection() {
    const s = recSelection();
    if (!s) return;
    const sig = s.join(' ');
    if (sig === this.sel) return;
    this.sel = sig;
    this.tick();
    const [chId, ap, ao, fp, fo] = s;
    this.focusChapter(chId);
    const line = ap === fp && ao === fo ? ['s', fp, fo] : ['s', ap, ao, fp, fo];
    // moved by the pointer, by NEO itself, or (unmarked) by a key
    const now = performance.now();
    if (this.pointerDown || (this.lastPointerAt > this.lastKeyAt && now - this.lastPointerAt < 1000)) line.push('p');
    else if (now - this.lastKeyAt >= 1000) line.push('n');
    this.event(line);
  },

  clip(kind, text, flavour) {
    this.tick();
    const hash = Rec.digest(text);
    const line = ['c', kind, text.length, flavour, hash];
    if (kind === 'paste') {
      line.push(this.copied.includes(hash));
      // copied from a moment of Writing History: that moment
      if (this.copiedFrom.has(hash)) line.push(this.copiedFrom.get(hash));
    } else {
      this.copied.push(hash);
      if (this.copied.length > 50) this.copied.shift();
    }
    this.event(line);
  },

  context(what) {
    if (!this.on) return;
    this.tick();
    this.event(['f', what]);
    if (what === 'focus') this.wallClock();
  },

  wallClock() {
    if (!this.on) return;
    this.tick();
    this.event(['T', new Date().toISOString()]);
  },

  // keys or edits: the `idle` line waits for a minute without either
  // What the engine's next change is, when NEO has it made as typing (a
  // spelling suggestion picked: `spell`): an `x` line before it, so the
  // evidence doesn't count it as text that came with no key
  mark(cause) {
    if (!this.on || !this.w) return;
    this.tick();
    this.event(['x', cause]);
  },

  active() {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.context('idle'), REC_IDLE);
  },

  // A tag: a name on a moment of the history (Rec.tagsOf). `label` null is
  // one NEO makes for its own reasons (`made`), named when shown; `at` null
  // is this moment, else [session, line, device, iso]. It goes to disk at
  // once. Returns null when nothing is recording, else { ref: the moment
  // the tag is on, saved: true once it's on disk, false if it couldn't be }.
  tag(label, at = null, made = null, id = 't-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)) {
    if (!this.on || !this.w) return null;
    this.tick();
    this.baseUnseen();
    this.live = true;
    this.order();
    const line = ['tag', id, label, at];
    if (made) line.push(made);
    this.event(line);
    const c = this.flush();
    if (!c) return null;
    // the tag's own line, counted as History counts lines (the header is 1)
    const k = c.chunk.text.split('\n').findIndex((s) => s.includes('"tag"') && s.includes(JSON.stringify(id)));
    // with proof on, a tag the writer named is sealed at once, not at the
    // next hour, so "Sent to my agent" is timestamped minutes after it's said
    const bookId = this.bookId;
    if (typeof label === 'string' && proofFlags().on) c.saved.then((ok) => ok && window.neo.proofSeal(bookId)).catch(() => {});
    return { id, ref: [this.session.id, c.chunk.first + k, this.device], saved: c.saved };
  },

  // The lines so far, as one chunk, to disk: from flushAllSaves, and when
  // a session closes, a tag is made or the history is opened. Returns the
  // chunk and a promise of whether it reached the disk, or null for none.
  flush() {
    if (!this.on || !this.live) return null;
    this.order();
    const c = this.w.chunk();
    if (!c) return null;
    const { bookId } = this;
    const id = this.session.id;
    const send = (part) => window.neo.recChunk(bookId, id, part.first, part.text).then(() => { this.chunks++; return true; }, (err) => {
      window.neo.logError('recording chunk: ' + (err && err.message || err));
      if (this.session && this.session.id === id) this.retry.push(part); // tried again with the next
      return false;
    });
    for (const part of this.retry.splice(0)) send(part);
    return { chunk: c, saved: send(c) };
  },

  rollup() {
    if (!this.on || !this.chunks) return;
    this.chunks = 0;
    window.neo.recRollup(this.bookId, this.session.id).catch((err) => window.neo.logError('recording rollup: ' + (err && err.message || err)));
  },

  // In strict mode, before a key, a paste or an input is handled: a page
  // that no longer matches chapterHTML was changed by something that
  // didn't say so. It's counted and shown, and the next change takes it in.
  drift(chId, body) {
    if (!this.strict || !this.on || chapterHTML[chId] === undefined) return;
    const html = captureBody(body);
    if (html === chapterHTML[chId]) return;
    this.counts.drift++;
    console.warn('[rec] page drifted from chapterHTML in', chId, Rec.splice(chapterHTML[chId], html));
  },

  // Replays this session and compares it with the book in memory.
  check() {
    if (!this.w) return { ok: true, lines: 0, mismatched: [], badWrites: [], problems: [], ...this.counts };
    this.streams(); // (titles, the outline and stickies are looked at when they're saved)
    this.w.endRun();
    const text = this.w.lines.join('\n') + '\n';
    const r = Rec.replayCheck([text], this.startKnown);
    const mismatched = [];
    const texts = book ? Rec.streamTexts(book, stickies) : {};
    const want = (chId) => {
      if (chId === Rec.STREAMS.notes) return recNotesNow();
      if (Rec.isStream(chId)) return book ? texts[chId] : this.model[chId];
      return chapterHTML[chId] == null ? undefined : String(chapterHTML[chId]);
    };
    for (const chId of this.inSession) if (r.chapters[chId] !== want(chId)) mismatched.push(chId);
    if (this.on) for (const chId of [...Object.keys(chapterHTML), ...Object.keys(texts), Rec.STREAMS.notes]) if (!this.inSession.has(chId) && this.model[chId] !== want(chId)) mismatched.push(chId);
    const badWrites = r.bad.map((w) => w.line);
    const result = {
      ok: !mismatched.length && !badWrites.length && !r.problems.length && !this.counts.unobserved,
      ...this.counts, lines: this.w.lines.length, mismatched, badWrites, problems: r.problems
    };
    console.log('[rec] check', result);
    return result;
  }
};

// Every change to chapterHTML comes through here, with what caused it:
// 'input' (typing, paste, dictation: anything the engine did, with its
// inputType) or one of NEO's own moves ('split', 'merge', 'new', …).
function setChapterHTML(chId, html, cause, opts) {
  chapterHTML[chId] = html;
  rec.change(chId, html, cause, opts);
}
function dropChapterHTML(chId, cause) {
  noteRemoved(chId, textHash(String(chapterHTML[chId] || ''))); // so another device's book.json can't bring it back
  delete chapterHTML[chId];
  rec.drop(chId, cause);
}

// The book's other writing as it opened (notes.html, and the titles,
// outline and stickies as book.json and stickies.json hold them): what the
// recorder's first look at each is measured from
async function recOpenStreams(bookId) {
  if (!rec.on || rec.bookId !== bookId) return;
  const notes = await window.neo.readAux(bookId, 'notes');
  if (!rec.on || rec.bookId !== bookId || !book || book.id !== bookId) return;
  rec.change(Rec.STREAMS.notes, notes || '', 'open');
  for (const [id, text] of Object.entries(Rec.streamTexts(book, stickies))) rec.change(id, text, 'open');
}

// The Notes tab, as it reads notes.html: text that isn't what the recorder
// last saw came from another device. recNotesShown is the notes as the
// page drew them, so a page that drew them differently (the browser tidies
// HTML it's given) is a tidy of its own, not part of the first key.
let recNotesShown = null;
function recNotesRead(html, bookId) {
  if (!rec.on || rec.bookId !== bookId) return;
  const id = Rec.STREAMS.notes;
  if (rec.model[id] === undefined) rec.change(id, html, 'open');
  else if (rec.model[id] !== html) rec.change(id, html, 'disk-adopt');
}
function recNotesInput(e) {
  if (!rec.on) return;
  const id = Rec.STREAMS.notes;
  if (recNotesShown !== null && rec.model[id] !== undefined && rec.model[id] !== recNotesShown) rec.change(id, recNotesShown, 'tidy');
  recNotesShown = null;
  rec.change(id, $('#aux-editor').innerHTML, 'input', { inputType: e.inputType });
}
// the notes as they are now: on the page while the Notes tab shows them
function recNotesNow() {
  const ed = $('#aux-editor');
  return currentTab === 'notes' && ed.dataset.kind === 'notes' && !ed.hidden ? ed.innerHTML : rec.model[Rec.STREAMS.notes];
}

// Where the caret sits in a chapter's HTML: the length of what captureBody
// would write for everything before it, or -1 when that can't be said.
// Only asked for when a splice could sit in more than one place.
function caretHtmlOffset(body, html) {
  const sel = window.getSelection();
  if (!sel.rangeCount || !sel.isCollapsed || !body.contains(sel.focusNode)) return -1;
  const r = document.createRange();
  r.selectNodeContents(body);
  r.setEnd(sel.focusNode, sel.focusOffset);
  const holder = document.createElement('div');
  holder.appendChild(r.cloneContents());
  const before = captureBody(holder).replace(/(<\/[a-z0-9]+>)+$/i, '');
  return html.startsWith(before) ? before.length : -1;
}

// What happens around the chapters. Capture phase, so a key is in the
// recording before NEO's own handlers act on it.
// the chapter (or the notes) a key or a clipboard event is in, or null
function recWhere(target) {
  if (!rec.on) return null;
  const body = recBodyOf(target);
  if (body) return body.closest('.chapter').dataset.id;
  const el = target && (target.nodeType === Node.TEXT_NODE ? target.parentElement : target);
  const notes = el && el.closest ? el.closest('#aux-editor') : null;
  return notes && notes.dataset.kind === 'notes' ? Rec.STREAMS.notes : null;
}
const recInChapter = (target) => !!recWhere(target);
// the notes' caret isn't recorded, so neither are the keys that only move it
const REC_CARET_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);
document.addEventListener('keydown', (e) => {
  const id = recWhere(e.target);
  if (id && !(Rec.isStream(id) && REC_CARET_KEYS.has(e.key))) rec.keyDown(e, id);
}, true);
document.addEventListener('keyup', (e) => rec.keyUp(e), true);
document.addEventListener('pointerdown', () => { rec.pointerDown = true; rec.lastPointerAt = performance.now(); }, true);
document.addEventListener('pointerup', () => { rec.pointerDown = false; rec.lastPointerAt = performance.now(); }, true);
document.addEventListener('selectionchange', () => { if (rec.on) rec.selection(); });
for (const kind of ['copy', 'cut']) {
  document.addEventListener(kind, (e) => { if (recInChapter(e.target)) rec.clip(kind, String(window.getSelection()), 'text'); }, true);
}
document.addEventListener('paste', (e) => {
  if (!recInChapter(e.target)) return;
  const data = e.clipboardData;
  rec.clip('paste', data ? data.getData('text/plain') : '', data && [...data.types].includes('text/html') ? 'html' : 'text');
}, true);
document.addEventListener('compositionstart', (e) => { if (recInChapter(e.target)) rec.context('compose'); }, true);
document.addEventListener('compositionend', (e) => { if (recInChapter(e.target)) rec.context('composed'); }, true);
window.addEventListener('focus', () => rec.context('focus'));
window.addEventListener('blur', () => rec.context('blur'));
document.addEventListener('visibilitychange', () => rec.context(document.visibilityState === 'visible' ? 'visible' : 'hidden'));
setInterval(() => rec.wallClock(), REC_WALL);
setInterval(() => rec.rollup(), REC_ROLLUP);

// Off, Record only, or Record and timestamp: from the File menu, History's
// footer, Pocket's ⋯ sheet, and the question NEO asks once. With `asked`
// the writer chose it there, having read what each level means; otherwise
// timestamping asks first, in plain words, before anything is sent.
// Returns the level it's at now.
async function setHistoryLevel(level, { asked = false } = {}) {
  if (level === 'timestamp' && !window.neo.proofSet) level = 'record';
  const wasRecording = recordingWanted();
  const wasProving = proofFlags().on;
  if (level === 'timestamp' && !wasProving && !asked && !await proofConsent()) {
    if (window.neo.recState) window.neo.recState(); // the menu's tick goes back
    return historyLevel();
  }
  library.historyAsked = true;
  library.recordWriting = level !== 'off';
  // (Pocket can't timestamp: it leaves the desktop's choice alone, unless off)
  if (window.neo.proofSet || level === 'off') library.proveWriting = level === 'timestamp';
  await writeLibrary(library);
  if (window.neo.proofSet) await window.neo.proofSet(proofFlags()).catch(() => {});
  if (window.neo.recState) window.neo.recState();
  if (wasRecording && level === 'off') {
    rec.end();
    if (!asked) toast(t('Writing History is off. Nothing already recorded is touched.'), 6000);
  } else if (!wasRecording && level !== 'off') {
    if (!asked) toast(t('NEO records every keystroke so you can watch how your book was written, and bring back any earlier version. It stays with your book, and your words are never sent anywhere.'), 8000);
    if (book) await recRestart(book.id);
  }
  // the book open is sealed now, rather than at the next hour
  if (level === 'timestamp' && !wasProving && book && rec.on && rec.bookId === book.id) {
    const c = rec.flush();
    if (c) await c.saved;
    window.neo.proofSeal(book.id).catch(() => {});
  }
  return level;
}

// The three levels as cards to pick from: first run's last step, and the
// question asked once in a library from before Writing History
function historyLevelCards(box, picked, onPick, { existing = false } = {}) {
  const levels = [
    ['off', t('Off'), t('NEO keeps no history. Snapshots still work.')],
    ['record', t('Record only'), t('Every keystroke is kept with the book, on this computer, so you can watch how it was written and bring back any earlier version. Nothing is sent anywhere.')],
    ...(window.neo.proofSet ? [['timestamp', t('Record and timestamp'),
      t('Every keystroke is recorded, and every hour you write, a unique fingerprint of the recording (never your words) goes to two timestamp services. Their receipts prove your work was written over time.') +
      (existing ? ' ' + t('Timestamps cover your writing from the day they’re turned on.') : '')]] : [])
  ];
  const pick = (value) => box.querySelectorAll('.fr-choice').forEach((b) => {
    b.classList.toggle('sel', b.dataset.level === value);
    b.setAttribute('aria-pressed', String(b.dataset.level === value));
  });
  box.replaceChildren(...levels.map(([value, name, desc]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'fr-choice';
    b.dataset.level = value;
    b.innerHTML = '<strong></strong><span></span>';
    b.firstChild.textContent = name;
    b.lastChild.textContent = desc;
    b.onclick = () => { pick(value); onPick(value); };
    return b;
  }));
  pick(picked);
}

// A library from before Writing History: asked once, on the shelf, whether to
// record from now on. Nothing records until it's answered (recordingWanted),
// and it can't be put aside: the cards and Continue, no Esc, no click outside.
// One answer serves every device that shares the library.
function askHistoryLevel() {
  if (!historyCan() || library.historyAsked === true || $('#history-ask')) return;
  let picked = 'record';
  const bd = document.createElement('div');
  bd.className = 'modal-backdrop';
  bd.id = 'history-ask';
  bd.dataset.stay = '1';
  bd.innerHTML = `<div class="modal" role="dialog" aria-modal="true" style="width:620px">
    <h2></h2><p></p><div class="fr-choices hl-cards"></div>
    <p class="hl-error" role="alert" hidden></p>
    <div style="text-align:right;margin-top:20px"><button class="btn-gold" type="button"></button></div>
  </div>`;
  bd.querySelector('h2').textContent = t('New: your writing history');
  bd.querySelector('p').textContent = t('NEO can now record how you write, keystroke by keystroke, so you can watch how any chapter was written and revised, and bring back any earlier version.') +
    (window.neo.proofSet ? ' ' + t('With timestamps, you also have proof that your work was written over time.') : '') +
    ' ' + t('It starts when you turn it on: what you’ve already written is where the history begins.');
  historyLevelCards(bd.querySelector('.hl-cards'), picked, (v) => { picked = v; }, { existing: true });
  const go = bd.querySelector('.btn-gold');
  go.textContent = t('Continue');
  go.onclick = async () => {
    go.disabled = true;
    try {
      await setHistoryLevel(picked, { asked: true });
      bd.remove();
    } catch (err) {
      window.neo.logError('history ask: ' + ((err && err.message) || err));
      const note = bd.querySelector('.hl-error');
      note.textContent = t('NEO couldn’t save your choice. Try again.');
      note.hidden = false;
      go.disabled = false;
    }
  };
  document.body.appendChild(bd);
  go.focus();
}

// Proof of when I wrote (docs/neo-recording-plan.md, part 2): off unless
// the writer turns it on in Writing History. The main process seals and
// stamps (proof.js); the window only says whether it's wanted. Pocket has
// no proofSet, so it never offers it.
const proofFlags = () => ({
  on: !!(window.neo.proofSet && library && library.proveWriting === true && recordingWanted()),
  // the timestamp services the writer chose (Timestamp services…)
  tsas: library && Array.isArray(library.proofTsas) ? library.proofTsas : null
});

// Record and timestamp, from the menu or History's footer: asked in plain
// words before anything is sent. Returns whether the writer said yes.
async function proofConsent() {
  const sure = await confirmModal({
    title: t('Timestamp your writing history?'),
    points: [
      t('Every hour you write, NEO sends a fingerprint of your writing history (never your words) to two independent timestamp services. Their signed receipts show your writing existed by that time.'),
      ...await proofWhoSays(),
      t('Your timestamps are signed with a key kept on this computer, and stay with your book in its Writing History. Anyone can check them, without NEO.'),
      t('A timestamp shows when your writing existed, not who wrote it. Your Writing History, which shows how you wrote it, speaks to that.')
    ],
    ok: t('Turn on timestamping')
  });
  return !!sure;
}

// Who the opt-in says the fingerprint goes to: the services the writer's
// library asks first (Timestamp services…), DigiCert and Sectigo unless changed
async function proofWhoSays() {
  let on = [];
  try { on = (await window.neo.proofServices()).filter((s) => s.on); } catch { /* the defaults, then */ }
  if (!on.length || on.slice(0, 2).map((s) => s.id).join() === 'digicert,sectigo') {
    return [t('The fingerprint goes to DigiCert and Sectigo, the companies that timestamp signed software, and each timestamp carries a public random number from drand, so it can’t have been made before then.')];
  }
  const names = new Intl.ListFormat(NeoI18n.getLocale(), { type: 'conjunction' }).format(on.map((s) => s.name));
  return [t('The fingerprint goes to {services}, the timestamp services you chose, and each timestamp carries a public random number from drand, so it can’t have been made before then.', { services: names })];
}

// Timestamp services… (docs/neo-recording-plan.md, The writer's own
// services): who stamps the seals, opened from File → Record Writing
// History → Timestamp Services…. NEO's three and any the writer added, in the order they're
// asked; the first two that answer stamp each seal. Every change is kept at
// once, in library.proofTsas, so the writer's other computers ask the same
// services; main.js hands back each change as keep, roots and all.
// Resolves when closed.
async function openTsaServices() {
  if (!window.neo.proofServices) return;
  let list = [];
  try {
    await window.neo.proofSet(proofFlags()); // (the library as it is now)
    list = await window.neo.proofServices();
  } catch { return; }
  const kept = (r) => {
    if (!r || !Array.isArray(r.list)) return list;
    if (r.keep) library.proofTsas = r.keep;
    else delete library.proofTsas;
    writeLibrary(library);
    return r.list;
  };
  return new Promise((resolve) => {
    const bd = document.createElement('div');
    bd.className = 'modal-backdrop tsa-backdrop';
    bd.innerHTML = `
      <div class="modal tsa-modal" role="dialog" aria-modal="true">
        <h2></h2>
        <p class="tsa-lede"></p>
        <ul class="tsa-list"></ul>
        <p class="tsa-warn" hidden></p>
        <div class="tsa-add" hidden>
          <div class="tsa-row"><input type="url" spellcheck="false" autocomplete="off"><button class="tsa-try btn-quiet" type="button"></button></div>
          <p class="tsa-said" hidden></p>
          <div class="tsa-row tsa-yes" hidden><button class="tsa-cancel btn-quiet" type="button"></button><button class="tsa-ok btn-gold" type="button"></button></div>
        </div>
        <div class="tsa-foot">
          <button class="tsa-new btn-quiet" type="button"></button>
          <button class="tsa-reset btn-quiet" type="button"></button>
          <button class="m-ok btn-gold" type="button"></button>
        </div>
      </div>`;
    const $q = (sel) => bd.querySelector(sel);
    const title = t('Timestamp services');
    $q('h2').textContent = title;
    $q('.modal').setAttribute('aria-label', title);
    $q('.tsa-lede').textContent = t('Each hour’s fingerprint, never your words, goes to these services in this order, until two have timestamped it. A service whose box is clear is never asked.');
    $q('.tsa-new').textContent = t('Add a service…');
    $q('.tsa-reset').textContent = t('Restore the defaults');
    $q('.m-ok').textContent = t('Done');
    const input = $q('.tsa-add input');
    input.placeholder = 'https://…';
    input.setAttribute('aria-label', t('The service’s web address'));
    $q('.tsa-try').textContent = t('Check');
    $q('.tsa-cancel').textContent = t('Cancel');
    const ul = $q('.tsa-list');
    const warn = $q('.tsa-warn');

    const save = async (next) => {
      try { list = kept(await window.neo.proofServicesSet(next.map((s) => ({ id: s.id, on: s.on })))); } catch { /* shown as it was */ }
      render();
    };
    function render(focusId = null, focusSel = null) {
      ul.textContent = '';
      list.forEach((s, i) => {
        const li = document.createElement('li');
        const label = document.createElement('label');
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = s.on;
        box.addEventListener('change', () => save(list.map((x) => (x === s ? { ...x, on: box.checked } : x))));
        const name = document.createElement('span');
        name.className = 'tsa-name';
        name.textContent = s.name;
        label.append(box, ' ', name);
        const about = document.createElement('span');
        about.className = 'tsa-about';
        about.textContent = s.added
          ? (s.public
            ? t('Added by you. Its root, {root}, is in Mozilla’s list.', { root: s.rootName })
            : t('Added by you. Its root, {root}, is in no public list, so its stamps are proof only to someone who trusts {name}.', { root: s.rootName, name: s.name }))
          : s.url;
        about.title = s.url;
        const acts = document.createElement('span');
        acts.className = 'tsa-acts';
        const btn = (txt, label, cls, disabled, fn) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'tsa-move ' + cls;
          b.textContent = txt;
          b.title = label;
          b.setAttribute('aria-label', label + ': ' + s.name);
          b.disabled = disabled;
          b.addEventListener('click', fn);
          acts.append(b);
        };
        const move = (by, sel) => () => {
          const next = list.slice();
          next.splice(i, 1);
          next.splice(i + by, 0, s);
          save(next).then(() => render(s.id, sel));
        };
        btn('↑', t('Move up'), 'tsa-up', i === 0, move(-1, '.tsa-up'));
        btn('↓', t('Move down'), 'tsa-down', i === list.length - 1, move(1, '.tsa-down'));
        if (s.added) {
          btn('×', t('Take out'), 'tsa-x', false, async () => {
            try { list = kept(await window.neo.proofServiceRemove(s.id)); } catch { /* as it was */ }
            render();
            $q('.tsa-new').focus();
          });
        }
        li.dataset.id = s.id;
        li.append(label, acts, about);
        ul.append(li);
      });
      const on = list.filter((s) => s.on);
      const notPublic = on.slice(0, 2).find((s) => s.added && !s.public);
      warn.textContent = !on.length
        ? t('With none on, your writing is still recorded, but nothing timestamps it.')
        : on.length < 2
          ? t('With one on, your writing gets one timestamp each hour instead of two. Two services from different companies make a much harder story to argue with.')
          : notPublic
            ? t('Stamps from {name} rest on a root you added, so they don’t count toward the time cover in Evidence.', { name: notPublic.name })
            : '';
      warn.hidden = !warn.textContent;
      if (focusId) {
        const li = ul.querySelector(`li[data-id="${focusId}"]`);
        const b = li && li.querySelector(focusSel);
        (b && !b.disabled ? b : li && li.querySelector('input')).focus();
      }
    }
    render();

    // Adding: the address, one test request, what it said, then yes or no
    const said = $q('.tsa-said');
    const yes = $q('.tsa-yes');
    let tried = null;
    const resetAdd = () => { tried = null; said.hidden = true; yes.hidden = true; $q('.tsa-try').disabled = false; };
    $q('.tsa-new').addEventListener('click', () => {
      $q('.tsa-add').hidden = false;
      $q('.tsa-new').hidden = true;
      input.focus();
    });
    input.addEventListener('input', resetAdd);
    async function check() {
      const url = input.value.trim();
      if (!url) return;
      resetAdd();
      $q('.tsa-try').disabled = true;
      said.hidden = false;
      said.textContent = t('Asking it for a timestamp…');
      let r;
      try { r = await window.neo.proofServiceTry(/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : 'https://' + url); } catch (err) { r = { ok: false, problems: [String(err && err.message || err)] }; }
      if (!bd.isConnected || input.value.trim() !== url) return;
      $q('.tsa-try').disabled = false;
      if (!r.ok) {
        said.textContent = t('NEO couldn’t use it: {why}', { why: (r.problems || []).join('; ') });
        return;
      }
      tried = r;
      said.textContent = r.public
        ? t('{name} answered with a good timestamp. Its root, {root}, is in Mozilla’s list of trusted roots.', { name: r.name, root: r.rootName })
        : t('{name} answered with a good timestamp, but its root, {root}, is in no public list. NEO keeps the root in your library and in each book it stamps, so its stamps can be checked, but they’re independent proof only to someone who trusts {name}.', { name: r.name, root: r.rootName });
      $q('.tsa-ok').textContent = r.public ? t('Add') : t('Add anyway');
      yes.hidden = false;
      $q('.tsa-ok').focus();
    }
    $q('.tsa-try').addEventListener('click', check);
    input.addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Enter') { e.preventDefault(); check(); }
    });
    const closeAdd = () => {
      input.value = '';
      resetAdd();
      $q('.tsa-add').hidden = true;
      $q('.tsa-new').hidden = false;
      $q('.tsa-new').focus();
    };
    $q('.tsa-cancel').addEventListener('click', closeAdd);
    $q('.tsa-ok').addEventListener('click', async () => {
      if (!tried) return;
      try { list = kept(await window.neo.proofServiceAdd(tried.url)); } catch { /* as it was */ }
      closeAdd();
      render();
    });

    $q('.tsa-reset').addEventListener('click', async () => {
      const added = list.filter((s) => s.added);
      if (added.length) {
        const sure = await confirmModal({
          title: t('Restore the defaults?'),
          points: [
            t('DigiCert, Sectigo and GlobalSign, in that order, all on.'),
            t('The services you added are taken out. Their stamps already in your books stay there, and can still be checked.')
          ],
          ok: t('Restore the defaults')
        });
        if (!sure || !bd.isConnected) { $q('.tsa-reset').focus(); return; }
      }
      try { list = kept(await window.neo.proofServicesReset()); } catch { /* as it was */ }
      render();
      $q('.tsa-reset').focus();
    });

    const done = () => { bd.remove(); resolve(); };
    $q('.m-ok').addEventListener('click', done);
    bd.addEventListener('keydown', (e) => {
      e.stopPropagation(); // (not to History behind it)
      if (e.key === 'Escape') {
        e.preventDefault();
        if (!$q('.tsa-add').hidden && document.activeElement && $q('.tsa-add').contains(document.activeElement)) closeAdd();
        else done();
      }
    });
    document.body.appendChild(bd);
    const first = ul.querySelector('input');
    (first || $q('.m-ok')).focus();
  });
}

// Recording the open book from now, as it is now
async function recRestart(bookId) {
  await rec.begin(bookId);
  if (!book || book.id !== bookId) return;
  for (const [chId, html] of Object.entries(chapterHTML)) rec.change(chId, html, 'open');
  await recOpenStreams(bookId);
}

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
  anchor: tk('Kept whole again')
};
const HISTORY_SYNC = ['disk-adopt', 'disk-twin', 'disk-new'];
// the book's other writing, as a day names it
function historyStreamName(id) {
  const S = Rec.STREAMS;
  return id === S.notes ? tabName('notes') : id === S.outline ? tabName('outline')
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

const canExportHistory = () => historyCanOpen() && !!(window.neo.recExport && window.neo.recEvidence);

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
      strings: replayPageStrings(), report, order, fileName: replayFileName(title, meta.chapterOrder, picked.chapters)
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
  tk('Timestamping wasn’t turned on, so nothing in this export fixes the history in time. It shows how the book was written, not when.'),
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
  ime: tk('Text composed with an input method (accents, Chinese, Japanese…): {n}.'),
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
  let html = `<h2 class="ev-h">${e(title)}</h2>
    <p class="ev-small">${e(t('Figures from the Writing History NEO kept as the words were written.'))}</p>
    <table class="ev-facts">${rows.join('')}</table>
    <p class="ev-small">${e(t('Writing History shows how the words were typed and when. It can’t show whose ideas they were.'))}</p>`;
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
// the weights. A line in `edge` marks where each part after the first begins.
function historyMap(g, W, parts, side, edge) {
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
  const starts = [];
  let at = 0;
  parts.forEach((p, i) => {
    const k = cells[i];
    starts.push(at);
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
  // where each chapter after the first begins
  g.globalAlpha = 0.85;
  g.fillStyle = edge;
  for (const q of starts.slice(1)) if (q < n) g.fillRect((q % side) * cs - (q % side ? 1 : 0), Math.floor(q / side) * cs, 1.5, cs - gap);
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
  toast(said, 9000);
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
  toast((many ? t('Paragraphs restored from {when}.', { when: snapWhen(wall) }) : t('Paragraph restored from {when}.', { when: snapWhen(wall) })) + ' ' + historyKeptSaid(kept, wall, many), 9000);
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
  toast(t('Your writing since {when} hasn’t been timestamped: no timestamp service has answered for over a week. It is still recorded. Check your connection, or choose other services in File → Record Writing History → Timestamp Services….', {
    when: snapWhen(Date.parse(st.waitingSince))
  }), 12000, { warn: true });
}

// Opens the Writing History of a book (the open one unless another is
// named). It opens on the days: the chapter the writer is in (or the
// book) as it is now, with a tile for each day it was written on below.
// A day picked opens the player on it, with its typing timeline, play and
// speed. Nothing plays until the writer presses Play. With `firstDay`,
// straight into the player at the first day the chapter was written.
async function openHistory({ bookId = book && book.id, chId = null, firstDay = false, snapshot = null } = {}) {
  if (!bookId || !historyCanOpen() || historyShown) return;
  const here = !!(book && book.id === bookId && !$('#editor-view').hidden);
  const caret = here ? captureCaret() : null;
  const meta = here ? book : await window.neo.readBookMeta(bookId);
  if (!meta || historyShown) return;
  meta.chapterOrder = meta.chapterOrder || [];
  const bd = sheetBackdrop('history', t('Writing History'), `
    <div class="hs-side">
      <div class="hs-find" hidden><div class="hs-qbox"><input class="hs-q" type="search" spellcheck="false" autocomplete="off"><button class="hs-opt" type="button" data-opt="cs">Aa</button><button class="hs-opt" type="button" data-opt="word"><span class="hs-opt-word">ab</span></button></div><div class="hs-results" hidden></div></div>
      <div class="hs-list" role="listbox"></div>
    </div>
    <div class="hs-main">
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
        <div class="hs-strip" role="listbox"></div>
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
  // the chapter the writer is in, unless the history never saw it
  let mode = chId || (here && ((caret && caret.chId) || currentChapterId)) || 'book';
  let settled = !!chId;   // whether the history has had its say on the mode
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
    if (firstDay && chId) { firstDay = false; reindex({ show: false }); startWatching(); } else if (snapshot) {
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
  close.back = () => { if (part) clearPart(); else if (view === 'player') showDays(curDay()); else close(); };
  // Find, from the menu or ⌘F: the history's own search
  close.focusFind = () => { if ($h('.hs-find').hidden) return; qIn.focus(); qIn.select(); };
  // for the tests and the console: historyShown.player.h() and the rest
  close.player = {
    h: () => h, loaded: () => loaded, view: () => view, steps: () => steps, pos: () => pos, lead: () => lead, mode: () => mode,
    chapters: () => Object.fromEntries(Object.entries(chapters).map(([ch, c]) => [ch, c.toString()])),
    sessions: () => S.sessions, days: () => S.days, day: () => dsel, building: () => S.building,
    seek, setMode, setPlaying, openPlayer, showDays, skipSession, paper,
    find: () => find, runFind: (q) => runFind(q), goFind: (kind, x) => goFind(kind, x),
    part: () => part, pickPart, partGo,
    markers: () => markers.map((m) => ({ kind: m.kind, label: m.label, x: m.x })), playing: () => playing, tags: () => tags,
    speed: (x) => { if (x) historyPrefs.speed = x; return historyPrefs.speed; }
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

  // the days a chapter was written on (all of them for the book)
  const dayFits = (d) => mode === 'book' || d.stats.chapters.includes(mode);
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
    const say = S.building ? t('Reading the history…') : S.error ? t('The history couldn’t be read.') : library.recordWriting === false
      ? (IS_POCKET ? t('Writing History is off. Turn it on in ⋯ → Record Writing History, and NEO starts recording the next time you write.')
        : t('Writing History is off. Turn it on in File → Record Writing History, and NEO starts recording the next time you write.'))
      : t('Nothing recorded yet. Write in this book and its history shows here.');
    paper.innerHTML = `<p class="hs-empty">${escHtml(say)}</p>`;
  }

  function setView(v) {
    view = v;
    controls.hidden = v !== 'player';
    dayline.hidden = v !== 'player';
    strip.hidden = v !== 'days';
    if (v === 'days') badgeEl.hidden = true;
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
    const also = mode === 'book' ? (d.stats.streams || []).map(historyStreamName).filter(Boolean).join(', ') : '';
    return [historyWhen(historyDayMs(d.day), HISTORY_DATE), historySpent(d.stats.ms), on, historyWords(added, removed), also].filter(Boolean).join(' · ');
  }

  // A day's map: where it changed the text, as a grid read like a page,
  // green where words came, red where they went, gold where both. In the
  // whole book each chapter has a run of cells as long as its share of the
  // book's words, in the book's order, and a line marks where each begins.
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
    historyMap(g, W, parts, whole ? 8 : 6, getComputedStyle(cv).color);
  }

  // a day's tile: its date, and its map
  function dayTile(d, onPick, label = '') {
    const b = document.createElement('button');
    b.className = 'hs-tile';
    b.dataset.day = d.day;
    b.setAttribute('role', 'option');
    const marked = (tagsByDay.get(d.day) || []).map(tagName);
    b.title = (label ? label + ' · ' : '') + describeDay(d) + (marked.length ? ' · ' + t('Tags') + ': ' + marked.join(', ') : '');
    if (marked.length) b.classList.add('hs-tagged');
    b.innerHTML = '<canvas></canvas><span></span>';
    b.lastChild.textContent = historyDayLabel(d.day);
    drawTile(b.firstChild, d);
    b.addEventListener('click', onPick);
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
      stampMarks.push({ x: vt[j], by: e.by });
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
    bd.focus();
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
      if (s.k === 'session') markers.push({ x, kind: 'session', step: i, label: [historyWhen(s.wall, HISTORY_MOMENT), stepDevice(s)].filter(Boolean).join(' · ') });
      else if (s.k === 'c' && s.what === 'paste') {
        markers.push({ x, kind: s.internal ? 'paste-in' : 'paste', step: i, label: s.internal ? t('Moved text ({n} characters)', { n: s.len }) : t('Pasted from elsewhere ({n} characters)', { n: s.len }) });
      } else if (s.k === 'x' && HISTORY_CAUSES[s.cause] && Rec.QUIET.has(s.cause) && !reached(j)) {
        // (another device's text the page already showed)
      } else if (s.k === 'x' && HISTORY_CAUSES[s.cause]) {
        const kind = HISTORY_SYNC.includes(s.cause) ? 'sync' : s.cause === 'catch-up' || s.cause === 'unobserved' ? 'catch' : s.cause === 'restore' ? 'restore' : 'move';
        markers.push({ x, kind, step: i, label: t(HISTORY_CAUSES[s.cause]) });
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

  function draw(now = performance.now()) {
    if (!h) return;
    syncPart();
    // the side pane's chapters, again when one came or went
    if (listedChapters().ids.join(',') !== listKey) renderList();
    const showing = shownChapters();
    const order = h.order(nAt(pos)) || dayOrder();
    const empty = paper.querySelector('.hs-empty');
    if (showing.length && empty) empty.remove();
    if (!showing.length && !empty) {
      paper.innerHTML = `<p class="hs-empty">${escHtml(mode === 'book' ? t('Nothing written yet at this moment.') : t('This chapter doesn’t exist yet at this moment.'))}</p>`;
      shown = {};
    }
    // sheets for the chapters shown, in order; others go
    const secs = {};
    for (const sec of paper.querySelectorAll('.rp-chapter')) {
      if (showing.includes(sec.dataset.ch)) secs[sec.dataset.ch] = sec;
      else { sec.remove(); delete shown[sec.dataset.ch]; }
    }
    let prev = null;
    for (const ch of showing) {
      let sec = secs[ch];
      if (!sec) {
        sec = document.createElement('section');
        sec.dataset.ch = ch;
        sec.innerHTML = '<div class="chapter-head"></div><div class="rp-body"></div>';
      }
      const kind = chapterKind(ch, meta);
      sec.className = `rp-chapter sheet kind-${kind}` + (STORY_KINDS.includes(kind) ? '' : ' bookpage');
      const label = chapterLabel(ch, order);
      const head = sec.firstElementChild;
      if (head.textContent !== label) head.textContent = label;
      const where = prev ? prev.nextSibling : paper.firstChild;
      if (where !== sec) paper.insertBefore(sec, where);
      prev = sec;
      if (drawBody(sec.lastElementChild, ch)) markDialogueOpening(sec.lastElementChild);
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
      const c = paper.querySelector('.rp-caret');
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
      if (m.kind !== 'away') continue;
      g.fillStyle = 'rgba(128,128,128,0.13)';
      g.fillRect(X(m.x), top, Math.max(1, X(m.to) - X(m.x)), base - top);
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
    const COLORS = { paste: '#d9776b', 'paste-in': '#c9a86a', sync: '#7aa7d9', catch: '#9a958c', restore: '#8fc98a', move: '#a9a294', session: '#77736b', tag: '#e3c47e' };
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
    const near = markers.filter((m) => (m.kind === 'away' ? c >= m.x && c <= m.to : Math.abs(m.x - c) <= span) && m.kind !== 'session');
    let lo = 0;
    let hi = steps.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (vt[mid] <= c) lo = mid + 1; else hi = mid; }
    const s = steps.length ? h.steps[steps[Math.max(0, Math.min(lo, steps.length) - 1)]] : null;
    const lines = near.slice(0, 3).map((m) => m.label);
    const stamp = stampMarks.find((m) => Math.abs(m.x - c) <= span);
    if (stamp) lines.push(stamp.by ? t('Timestamped {when}', { when: snapWhen(stamp.by) }) : t('Not timestamped'));
    if (s) lines.push([historyWhen(s.wall, HISTORY_MOMENT), stepDevice(s)].filter(Boolean).join(' · '));
    return lines.join(' · ');
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
    restoreBtn.disabled = same;
    restoreBtn.textContent = same ? t('Same as now') : inBook ? t('Restore This Chapter') : t('Put This Chapter Back');
    restoreBtn.title = same ? '' : inBook ? chapterName(ch, meta) + ': ' + t('The chapter becomes what you see here.') + ' ' + keptWhere()
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
    const html = chapters[ch].toString();
    let title = '';
    try {
      const tt = h.doc(n)[Rec.STREAMS.titles];
      title = (tt !== undefined && JSON.parse(String(tt))[ch]) || '';
    } catch { /* no titles then */ }
    const order = h.order(n) || dayOrder();
    const at = order.indexOf(ch);
    const before = at < 0 ? order.slice() : order.slice(0, at);
    const { ref, wall } = momentRef();
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
    const up = () => { timeline.removeEventListener('pointermove', move); timeline.removeEventListener('pointerup', up); };
    timeline.addEventListener('pointermove', move);
    timeline.addEventListener('pointerup', up);
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
    // Tab goes round the dialog's controls and never out of it: behind it is
    // the book, which keys must not reach while History is open
    if (e.key === 'Tab' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const all = [...bd.querySelectorAll('button, input, [tabindex]:not([tabindex="-1"])')]
        .filter((x) => !x.disabled && x.offsetParent !== null && getComputedStyle(x).visibility !== 'hidden');
      const at = document.activeElement;
      const i = all.indexOf(at);
      // (the browser also stops on the sheet's scrolling box: from there it goes on as usual)
      const inside = at && at !== bd && bd.contains(at);
      if (!all.length || (i < 0 && !inside) || (i >= 0 && (e.shiftKey ? i === 0 : i === all.length - 1))) {
        e.preventDefault();
        if (all.length) all[e.shiftKey ? all.length - 1 : 0].focus();
        return;
      }
    }
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
      if (!Rec.normText(tagName(tg)).includes(q)) continue;
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
  const tagWhy = () => (library.recordWriting === false ? (IS_POCKET ? t('Turn on ⋯ → Record Writing History to tag moments.') : t('Turn on File → Record Writing History to tag moments.'))
    : t('Open this book to tag its moments.'));
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
    return t('Tagged');
  }
  const tagWhen = (tg) => (tg.when !== null ? snapWhen(tg.when) : historyWhen(historyDayMs(tg.day), HISTORY_DATE));
  const tagMoment = (tg) => [...tg.at, new Date(tg.when !== null ? tg.when : historyDayMs(tg.day)).toISOString()];

  // A line for a tag, written now, and seen at once
  function writeTag(label, at, made, id) {
    const tg = rec.tag(label, at, made, id);
    if (!tg) return null;
    localTags.push({ id: tg.id, label, at, made: made || null, wall: Date.now(), line: tg.ref[1] });
    computeTags();
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
    const name = await askInput(escHtml(t('Tag this moment')), escHtml(t('Draft 2, Sent to my agent…')));
    tagAsking = false;
    if (!bd.isConnected) return;
    bd.focus();
    if (!name) return;
    const tg = writeTag(name, [...ref, new Date(wall).toISOString()], null);
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
  }

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
      b.title = canTag() ? t('Right-click to rename or remove it') : '';
      b.addEventListener('contextmenu', async (e) => {
        e.preventDefault();
        const choice = await popMenu(e.clientX, e.clientY, [
          { label: t('Go to This Moment'), value: 'go' },
          '-',
          { label: tg.label ? t('Rename…') : t('Name…'), value: 'rename', disabled: !canTag() },
          { label: t('Remove Tag'), value: 'remove', disabled: !canTag(), danger: true }
        ], { title: tagName(tg) });
        if (choice === 'go') goTag(tg);
        else if (choice === 'rename') {
          const name = await askInput(escHtml(t('Name this tag')), escHtml(tagName(tg)), tg.label || '');
          bd.focus();
          if (name && name !== tg.label && !writeTag(name, tagMoment(tg), tg.made, tg.id)) toast(t('NEO couldn’t tag this moment.'));
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
      if (absent && ch === mode) b.classList.add('hs-ch-absent');
    }
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

  // Watch This Chapter Being Written: the first day it was written, ready to play
  function startWatching() {
    const i = S.sessions.findIndex((s) => s.stats.chapters[chId]);
    if (i >= 0) openPlayer(i, { ch: chId }); else showDays(dsel);
  }

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

/* ================================================================== */
/*  EDITOR — open / render                                             */
/* ================================================================== */

let openGeneration = 0;
async function openBook(bookId) {
  diskWordsAt = Date.now();
  // a book being exported from the shelf finishes first (it borrows the
  // open book's place for the moment it takes)
  // oxlint-disable-next-line no-unmodified-loop-condition -- the shelf's export clears it
  while (shelfExport) await new Promise((resolve) => setTimeout(resolve, 50));
  // Everything is read first and only then becomes the open book, so a
  // second book opened while this one loads (a double click, a slow cloud
  // read) never ends up with a mix of the two.
  const gen = ++openGeneration;
  const meta = await window.neo.readBookMeta(bookId);
  if (!meta || gen !== openGeneration) return;
  const html = {};
  for (const chId of meta.chapterOrder) {
    html[chId] = await window.neo.readChapter(bookId, chId);
    if (gen !== openGeneration) return;
  }
  const sideStickies = await window.neo.readJSON(bookId, 'stickies', []);
  const sideDarlings = await window.neo.readJSON(bookId, 'darlings', []);
  if (gen !== openGeneration) return;
  tabPlaces = {}; // a fresh book starts with fresh places
  book = meta;
  knowCards();
  showWindowTitle();
  snapShown = null;
  snapCache = null;
  sideCardsKey = '';
  currentChapterId = null; // never carry a chapter reference across books
  undoStack = [];
  // Writing History: this book's session starts (the last one closes) once
  // everything is read, before any of it becomes the open book
  await rec.begin(bookId);
  if (gen !== openGeneration) return;
  proofWarnStale(bookId);
  chapterHTML = {};
  for (const chId of Object.keys(html)) setChapterHTML(chId, html[chId], 'open');
  savedHTML = { ...chapterHTML };
  for (const chId of Object.keys(html)) knowDisk(bookId, chId, html[chId]);
  diskStamps = {};
  savedMetaSig = metaSig(book); // what disk holds; NEO's own defaults don't count as edits
  stickies = sideStickies;
  darlings = sideDarlings;
  sidecarBase[bookId + '/stickies'] = JSON.stringify(stickies);
  sidecarBase[bookId + '/darlings'] = JSON.stringify(darlings);
  await recOpenStreams(bookId);
  if (gen !== openGeneration) return;

  $('#bookshelf-view').hidden = true;
  $('#editor-view').hidden = false;
  applyBright();
  document.execCommand('defaultParagraphSeparator', false, 'p');

  $('#tp-title').textContent = isUntitled(book.title) ? '' : book.title;
  showTitleStyle();
  $('#tp-subtitle').textContent = book.subtitle || '';
  $('#tp-author').textContent = book.author || t('Anonymous');
  $$('.tab[data-tab="notes"]')[0].textContent = tabName('notes');
  $$('.tab[data-tab="outline"]')[0].textContent = tabName('outline');
  spEditorMode(); // a script, or a book

  renderChapters();
  renderStickies();
  takeConflictCopies(bookId); // what a sync program set aside while the book was closed
  migrateDarlingAnchors(); // sweep legacy invisible markers out of the prose
  reconcileMarks();        // re-adopt any note marks orphaned by cut/paste
  updateCounters();

  // Plotters land in the outline for a brand-new book
  const isNew = book.chapterOrder.length === 0;
  // a new script opens on its title page (it has no outline to open to)
  const newScript = isScript() && isUntitled(book.title) && !bookWordCount();
  if (isNew && library.writingStyle === 'plotter' && !isScript()) {
    switchTab('outline');
  } else {
    switchTab('manuscript');
    if (isNew || newScript) {
      $('#tp-title').focus();
    } else if (book.lastPosition && book.chapterOrder.includes(book.lastPosition.chapterId)) {
      // pick up right where you left off — here, or on the other device
      currentChapterId = book.lastPosition.chapterId;
      const pos = book.lastPosition;
      requestAnimationFrame(() => {
        resumePosition(pos);
        vimRest();
        // closed on the Outline, Notes or Darlings: it opens there again, at
        // the same scroll (the manuscript keeps its own place underneath)
        if (['outline', 'notes', 'darlings'].includes(pos.tab) && book && book.id === bookId) {
          tabPlaces[pos.tab] = { scroll: pos.tabScroll || 0 };
          switchTab(pos.tab);
        }
      });
    }
  }

  // the Enter hint shows once per library, ever
  if (!library.hintShown && !isScript()) {
    library.hintShown = true;
    writeLibrary(library);
    setTimeout(() => toast(t('Enter twice = section break · three times = new chapter · {key} shows everything else', { key: KHELP }), 7000), 800);
  }
  spReportState();
}

// the pages that show a faint word until they have their own
const PAGE_PROMPTS = { dedication: () => t('For…'), epigraph: () => '…', part: () => t('Title') };

function renderChapters() {
  const wrap = $('#chapters');
  wrap.innerHTML = '';
  wordCache = {};
  book.chapterTitles = book.chapterTitles || {};
  settleChapterKinds();
  // a lone chapter is just "the story" — no heading until a second one exists,
  // at which point both appear, numbered in retrospect
  const solo = soloStory();
  book.chapterOrder.forEach((chId) => {
    const kind = chapterKind(chId);
    const story = STORY_KINDS.includes(kind);
    const sec = document.createElement('section');
    sec.className = `chapter sheet kind-${kind}` + (chId === solo ? ' solo' : '') + (story ? '' : ' bookpage');
    sec.dataset.id = chId;
    const role = chapterRole(chId);
    if (role) sec.classList.add(role);
    const head = document.createElement('div');
    head.className = 'chapter-head';
    if (kind === 'unnumbered') head.classList.add('no-number');
    head.id = 'ch-head-' + chId;
    const num = document.createElement('span');
    num.className = 'ch-num';
    num.textContent = chapterName(chId);
    head.appendChild(num);
    if (story) {
      head.title = t('Right-click for chapter options · click after the number to add a title');
      const sep = document.createElement('span');
      sep.className = 'ch-sep';
      sep.setAttribute('aria-hidden', 'true');
      sep.textContent = headingDash();
      const titleSpan = document.createElement('span');
      titleSpan.className = 'ch-title';
      titleSpan.contentEditable = 'true';
      titleSpan.spellcheck = false;
      titleSpan.textContent = book.chapterTitles[chId] || '';
      if (titleSpan.textContent) head.classList.add('has-title');
      titleSpan.addEventListener('input', () => {
        head.classList.toggle('has-title', titleSpan.textContent.trim() !== '');
      });
      titleSpan.addEventListener('keydown', (e) => {
        if (e.isComposing || e.keyCode === 229) { e.stopPropagation(); return; } // an input method's Enter confirms its word
        if (e.key === 'Enter' && e.shiftKey && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          titleSpan.blur();
          poetryUnderHeading(sec.querySelector('.chapter-body'), chId);
        } else if (e.key === 'Enter') { e.preventDefault(); titleSpan.blur(); }
        e.stopPropagation();
      });
      titleSpan.addEventListener('blur', () => {
        book.chapterTitles[chId] = titleSpan.textContent.trim();
        scheduleMetaSave();
        renderNav();
      });
      head.appendChild(sep);
      head.appendChild(titleSpan);
    }
    head.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      chapterMenu(chId, e.clientX, e.clientY);
    });
    const body = document.createElement('div');
    body.className = 'chapter-body';
    sec.appendChild(head);
    sec.appendChild(body);
    wrap.appendChild(sec);
    if (kind === 'contents') {
      // the contents are the book's own shape, kept up to date: nothing to type
      body.hidden = true;
      const list = document.createElement('ol');
      list.className = 'toc-list';
      sec.appendChild(list);
      return;
    }
    body.contentEditable = 'true';
    // screen readers name each chapter by its heading (a lone chapter by the book)
    body.setAttribute('role', 'textbox');
    body.setAttribute('aria-multiline', 'true');
    if (chId === solo) body.setAttribute('aria-label', book.title ? shownTitle(book.title) : t('The story'));
    else body.setAttribute('aria-labelledby', head.id);
    body.spellcheck = false; // NEO runs its own spellcheck pass
    if (!story) body.classList.add('no-cap');
    // a script's lines are set as they print (styles.css, SCREENPLAYS)
    if (isScript()) body.classList.add('script-body', $('#paper').classList.contains('narrow') ? 'sp-narrow' : 'sp-geom', 'no-cap');
    body.innerHTML = chapterHTML[chId] || '<p><br></p>';
    markDialogueOpening(body);
    if (PAGE_PROMPTS[kind]) {
      body.dataset.ph = PAGE_PROMPTS[kind]();
      const blank = () => body.classList.toggle('blank', !body.textContent.trim());
      blank();
      body.addEventListener('input', blank);
    }
    // a line that opens with a dash is set as the name of whoever said the
    // lines above it, as it will print
    if (ATTRIBUTED_PAGES.includes(kind)) {
      const settle = () => {
        for (const p of body.querySelectorAll('p')) {
          const attr = isAttribution({ text: p.textContent.trim() });
          if (p.hasAttribute('data-attr') !== attr) p.toggleAttribute('data-attr', attr);
        }
      };
      settle();
      body.addEventListener('input', settle);
    }
    // older marks used a "?" that read as a broken image — normalize to the flag
    body.querySelectorAll('.ph-mark').forEach((m) => { m.textContent = '⚑'; });
    // heal the engine's style-junk spans left by past merges and splits
    stripJunkSpans(body);
    // heal prose that got merged into a scene-break's styled paragraph:
    // real breaks contain only ***, anything else is a stained paragraph
    body.querySelectorAll('p.scene-break').forEach((p) => {
      if (p.textContent.trim() !== '***') {
        p.classList.remove('scene-break');
        p.removeAttribute('style');
      }
    });
    // heal the no-break spaces the old engine repair pass planted (the
    // writer's own, Dr. Müller and 5 km, stay)
    healStrayNbsp(body);
    wireChapterBody(body, chId);
  });
  if (isScript()) {
    // the pages are counted before the pane lists the scenes; again once
    // Courier Prime has arrived, in case the first count was in another face
    spRepaginate();
    if (document.fonts) document.fonts.load('1em "Courier Prime"').then(() => spSchedule(0)).catch(() => {});
  }
  renderNav();
}

async function deleteChapterToDarlings(chId, quiet = false) {
  if (!quiet) snapshotStructure('chapter delete');
  const kind = chapterKind(chId);
  const name = chapterName(chId);
  const index = book.chapterOrder.indexOf(chId);
  const text = chapterText(chId).trim();
  if (text) {
    const bodyEl = document.querySelector(`.chapter[data-id="${chId}"] .chapter-body`);
    darlings.push({
      id: 'd-' + Date.now().toString(36),
      html: bodyEl ? bodyEl.innerHTML : chapterHTML[chId],
      text: text.slice(0, 2000),
      chapterId: null,
      chapterLabel: chapterKind(chId) !== 'chapter' ? chapterName(chId) : t('deleted Chapter {n}', { n: chapterNumber(chId) }),
      date: new Date().toISOString()
    });
    await writeSidecar(book.id, 'darlings', darlings);
  }
  if (currentChapterId === chId) currentChapterId = null;
  await deleteChapterQuiet(chId);
  if (text && !quiet) {
    toast(kind === 'chapter'
      ? t('Chapter removed — its words are in Darlings, or {key} to undo', { key: KZ })
      : t('{name} removed — its words are in Darlings, or {key} to undo', { name, key: KZ }));
  }
}

// Right-click a chapter's box in the Chapters pane, its heading, or its
// line in the outline: what it is (a chapter, a part, one of the pages a
// book carries), or Delete. Resolves to the choice once it's made.
async function chapterMenu(chId, x = 0, y = 0, from = null) {
  const kind = chapterKind(chId);
  const words = countWords(chapterText(chId));
  const otherContents = book.chapterOrder.some((c) => c !== chId && chapterKind(c) === 'contents');
  const items = CHAPTER_KINDS.map((k) => ({
    label: kindName(k),
    value: k,
    checked: k === kind,
    // one contents per book, and never over words: it would hide them
    disabled: k === 'contents' && k !== kind && (otherContents || words > 0)
  }));
  // any piece of the story can leave on its own — to a beta reader, an
  // editor, a magazine — in any format the book can
  if (STORY_KINDS.includes(kind) && words > 0) items.push('-', { label: t('Export Chapter…'), value: 'export' });
  if (historyCanOpen()) items.push('-', { label: t('Watch This Chapter Being Written'), value: 'history' });
  // one switch for the whole book, where the parts are: count chapters
  // from 1 again after each part
  if (kind === 'part') {
    items.push('-', { label: t('Restart Chapter Numbers at Each Part'), value: 'restart', checked: !!book.restartNumbering });
  }
  items.push('-', { label: t('Delete'), value: 'delete', danger: true });
  const choice = await popMenu(x, y, items, { title: chapterName(chId), from: from || document.querySelector(`.nav-item[data-id="${chId}"] .n-row`) });
  if (!choice || choice === kind) return null;
  if (choice === 'history') {
    openHistory({ chId, firstDay: true });
    return null;
  }
  if (choice === 'export') {
    const formats = [
      { label: t('Text (.txt)'), value: 'txt' }, { label: t('Markdown (.md)'), value: 'md' }, { label: t('HTML (.html)'), value: 'html' },
      { label: 'PDF (.pdf)', value: 'pdf' },
      { label: t('Word (.docx)'), value: 'docx' }, { label: t('EPUB (.epub)'), value: 'epub' }
    ];
    const fmt = await optionModal(t('Export “{title}”', { title: escHtml(chapterHeading(chId) || chapterName(chId)) }), null, formats);
    if (fmt) await doExport(fmt, chId);
    return null;
  }
  if (choice === 'restart') {
    if (book.restartNumbering) delete book.restartNumbering;
    else book.restartNumbering = true;
    await saveMeta();
    renderChapters();
    if (currentTab === 'outline') renderOutline();
    updateCounters();
    return choice;
  }
  if (choice === 'delete') {
    await deleteChapterToDarlings(chId);
    if (currentTab === 'outline') renderOutline();
    return choice;
  }
  snapshotStructure('chapter kind');
  setChapterKind(chId, choice);
  // a copyright page starts with what every copyright page says
  if (choice === 'copyright' && !chapterText(chId).trim()) {
    setChapterHTML(chId, copyrightStarter(), 'kind');
    persistChapter(chId);
  }
  await saveMeta();
  renderChapters();
  if (currentTab === 'outline') renderOutline();
  updateCounters();
  return choice;
}

// Copyright © 2026 Hugh Howey / All rights reserved.
function copyrightStarter() {
  const name = (book && book.author) || library.authorName || t('Anonymous');
  return `<p>${escHtml(t('Copyright © {year} {name}', { year: String(new Date().getFullYear()), name }))}</p>`
    + `<p>${escHtml(t('All rights reserved.'))}</p>`;
}

/* ================================================================== */
/*  EDITOR — typing                                                    */
/* ================================================================== */

// a drag that began on NEO's own page (moving words within the book)
let dragFromInside = false;
document.addEventListener('dragstart', () => { dragFromInside = true; }, true);
document.addEventListener('dragend', () => { dragFromInside = false; }, true);
document.addEventListener('drop', () => { setTimeout(() => { dragFromInside = false; }, 0); }, true);

function wireChapterBody(body, chId) {
  body.addEventListener('focus', () => { currentChapterId = chId; updateCounters(); highlightNav(); });
  // ahead of NEO's own handlers, which may change the page themselves
  for (const type of ['keydown', 'beforeinput', 'paste']) body.addEventListener(type, () => rec.drift(chId, body));

  // ⌘Z takes back what was typed since the last pause, not a whole page of
  // it: a second of quiet closes the engine's undo run (the caret stays put).
  // Not on a phone, where the keyboard keeps its own run of words in hand.
  let runTimer = null;
  const endTypingRunSoon = () => {
    if (IS_POCKET) return;
    clearTimeout(runTimer);
    runTimer = setTimeout(() => {
      if (composing || document.activeElement !== body) return;
      const sel = window.getSelection();
      if (!sel.rangeCount || !sel.isCollapsed || !body.contains(sel.anchorNode)) return;
      sel.collapse(sel.anchorNode, sel.anchorOffset);
    }, 1000);
  };
  body.addEventListener('input', (e) => {
    sealUndoOnEdit(); // chapterHTML is still the text from before this edit
    breakRun = 0; // fresh typing: ⌘Z belongs to the engine again
    if (isScript()) scriptInput(body);
    markDialogueOpening(body);
    setChapterHTML(chId, captureBody(body), 'input', { inputType: e.inputType, hint: (html) => caretHtmlOffset(body, html) });
    wordCache[chId] = null;
    scheduleChapterSave(chId);
    if (spellOn) scheduleSpellRescan(chId, body);
    updateCounters();
    scheduleNavRefresh();
    if (!typewriterEnabled) revealCaret();
    endTypingRunSoon();
  });
  // paste without formatting
  body.addEventListener('paste', (e) => {
    // a script's lines keep their elements; a script pasted as text is read
    if (isScript() && spPaste(e, body, chId)) return;
    e.preventDefault();
    insertClip(e.clipboardData);
  });
  // Text dragged in from another app (a browser, Word) is cleaned the same
  // way as a paste, instead of landing with its fonts, colours and links.
  // A drag within NEO's own pages is left to the engine.
  body.addEventListener('drop', (e) => {
    if (dragFromInside || isScript() || !e.dataTransfer || (e.dataTransfer.files && e.dataTransfer.files.length)) return;
    const types = [...(e.dataTransfer.types || [])];
    if (!types.includes('text/html') && !types.includes('text/plain')) return;
    e.preventDefault();
    const at = document.caretRangeFromPoint ? document.caretRangeFromPoint(e.clientX, e.clientY) : null;
    if (at && body.contains(at.startContainer)) {
      body.focus({ preventScroll: true });
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(at);
    }
    insertClip(e.dataTransfer);
  });
  function insertClip(data) {
    writeOverGhost(); // pasted words over a gray note are prose, like typed ones
    const html = data.getData('text/html');
    const text = data.getData('text/plain');
    // hyphens set as dialogue dashes, the same as typing them
    const edges = caretEdges(body);
    if (html) {
      document.execCommand('insertHTML', false, cleanPasteHtml(html, { style: dashStyle(), ...edges }));
      // the engine wraps inserted HTML (and its neighbours) in style spans
      if (body.querySelector('span:not(.ph-mark)')) {
        const caret = captureCaret();
        stripJunkSpans(body);
        restoreCaret(caret);
        syncChapter(body, chId, 'tidy'); // what's saved is the cleaned paragraph
      }
      reconcileMarks();
    } else if (text) {
      const parts = text.replace(/\r/g, '').split(/\n+/).filter((p) => p.trim());
      parts.forEach((p, i) => {
        if (i > 0) document.execCommand('insertParagraph');
        // the clipboard's own space at either end stays when the paste lands
        // mid-line ("the " + "big " + "dog"), and goes at a paragraph's edge
        const lead = i === 0 && !edges.start && !edges.spaced && /^\s/.test(p) ? ' ' : '';
        const tail = i === parts.length - 1 && !edges.end && !edges.spacedAfter && /\s$/.test(p) ? ' ' : '';
        const line = lead + dialogueDashes(p.trim(), dashStyle(), { start: i > 0 || edges.start, end: i < parts.length - 1 || edges.end, spaced: i === 0 && edges.spaced }) + tail;
        // plain text written in Markdown keeps its *italics* and **bold**
        const styled = library && library.markdownOff ? null : markdownInline(line);
        if (styled) {
          document.execCommand('insertHTML', false, styled);
          stripJunkSpans(body); // the engine wraps inserted HTML in style spans
        } else document.execCommand('insertText', false, line);
      });
    }
  }
  // While macOS composes input, shortcuts stand down completely.
  let composing = false;
  body.addEventListener('compositionstart', () => { composing = true; });
  body.addEventListener('compositionend', () => { composing = false; });
  body.addEventListener('keydown', (e) => {
    // An input method mid-word owns the keys. Its marker (keyCode 229) also
    // rides on Enter with nothing being composed, as on GNOME (Wayland, IBus),
    // where it kept ⇧Enter and ⌘⇧Enter from ever reaching NEO.
    if (composing || e.isComposing || (e.keyCode === 229 && e.key !== 'Enter')) return;
    // count consecutive Enters — the double/triple rhythm works mid-sentence
    if (e.key === 'Enter' && !e.shiftKey) enterRun++;
    else enterRun = 0;
    // ⌘Z right after a break operation undoes the break via the structural
    // stack — the engine's own undo never saw it and would corrupt the page
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.code === 'KeyZ' && breakRun > 0 && undoStack.length) {
      e.preventDefault();
      breakRun--;
      structuralUndo();
      return;
    }
    // Chromium's selection-delete can duplicate a neighboring character when
    // the selection spans fragmented text nodes. Merging the fragments right
    // before any destructive keystroke.
    if (!e.metaKey && !e.ctrlKey && !e.altKey) {
      const s = window.getSelection();
      const destructive = e.key === 'Backspace' || e.key === 'Delete' ||
        (s && !s.isCollapsed && (e.key.length === 1 || e.key === 'Enter'));
      if (destructive) healSelectionSeams(body);
    }
    if (styleKeepScroll(e)) return;
    // a script: its own Enter, Tab and ⌘1–7; no breaks, poetry or chapters
    if (isScript()) {
      if (scriptKey(e, body)) return;
      if (spaceSafeDelete(e, body, chId)) return;
      if (emptyChapterBackspace(e, body, chId)) return;
      if (chapterStartBackspace(e, body, chId)) return;
      if (guardMarkerDelete(e, body, chId)) return;
      smartKeys(e, body);
      return;
    }
    if (handlePoetry(e, body, chId)) return;
    if (handleFlush(e, body, chId)) return;
    if (poetryBackspace(e, body, chId)) return;
    if (sceneBreakDelete(e, body, chId)) return;
    if (spaceSafeDelete(e, body, chId)) return;
    if (emptyChapterBackspace(e, body, chId)) return;
    if (chapterStartBackspace(e, body, chId)) return;
    if (guardMarkerDelete(e, body, chId)) return;
    // "Espere -" then Enter: the dash goes in before the paragraph ends
    if (e.key === 'Enter') dialogueDashKey(e, body);
    if (handleEnter(e, body, chId)) return;
    if (handleTabSpacing(e)) return;
    smartKeys(e, body);
  });
  // when the whole chapter loses focus, merge every fragmented text node
  body.addEventListener('blur', () => {
    try { body.normalize(); } catch { /* nothing to merge */ }
  });
  body.addEventListener('mousedown', () => { enterRun = 0; });
  body.addEventListener('click', (e) => {
    const mark = e.target.closest('.ph-mark');
    if (mark) focusSticky(mark.dataset.sid);
    // clicking a ghost outline note selects it, ready to be replaced with prose
    const ghost = e.target.closest('p.ghost');
    if (ghost) {
      const r = document.createRange();
      r.selectNodeContents(ghost);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
    }
  });
  // A line break the engine is about to make on its own is ⇧Enter that the
  // keys above never saw (an input method can carry it past them): it
  // becomes the flush paragraph ⇧Enter makes, or the next line of a poem.
  body.addEventListener('beforeinput', (e) => {
    if (e.inputType !== 'insertLineBreak' || e.defaultPrevented) return;
    if (isScript()) { e.preventDefault(); return; } // a script's lines are its elements
    const key = { key: 'Enter', shiftKey: true, metaKey: false, ctrlKey: false, altKey: false, preventDefault: () => e.preventDefault() };
    if (!handlePoetry(key, body, chId)) handleFlush(key, body, chId);
  });
  // the moment writing hits a ghost, it becomes prose
  // (it keeps its data-sec-id so the outline knows it's been written)
  const ghostWas = {}; // each ghost's own words, from before it was written over
  // the ghost the caret is in, also when the caret sits between paragraphs
  // (a click in the margin, the arrow keys) rather than in the ghost's text
  function ghostAtCaret() {
    const sel = window.getSelection();
    if (!sel.rangeCount) return null;
    const r = sel.getRangeAt(0);
    const c = r.startContainer;
    const near = c.nodeType === Node.ELEMENT_NODE ? [c.childNodes[r.startOffset], c.childNodes[r.startOffset - 1], c] : [c];
    for (const n of near) {
      const el = n && (n.nodeType === Node.ELEMENT_NODE ? n : n.parentElement);
      const g = el && el.closest ? el.closest('p.ghost') : null;
      if (g && body.contains(g)) return g;
    }
    return null;
  }
  // Writing on a ghost replaces it whole, however the caret got there: a
  // click selects it, and so does any key that types (the arrow keys, Home,
  // a click in the margin leave the caret inside the note's words, and the
  // typing was added to them)
  function selectGhost(ghost) {
    const sel = window.getSelection();
    if (sel.rangeCount && !sel.isCollapsed && sel.toString() === ghost.textContent) return;
    const r = document.createRange();
    r.selectNodeContents(ghost);
    sel.removeAllRanges();
    sel.addRange(r);
  }
  function writeOverGhost() {
    const ghost = ghostAtCaret();
    if (!ghost) return;
    const secId = ghost.dataset.secId;
    if (secId && !(secId in ghostWas)) ghostWas[secId] = ghost.textContent;
    ghost.classList.remove('ghost');
  }
  body.addEventListener('beforeinput', (e) => {
    // undo and redo give words back; they don't write
    if (e.inputType && e.inputType.startsWith('history')) return;
    const ghost = ghostAtCaret();
    if (ghost && e.inputType === 'insertText' && e.cancelable && typeof e.data === 'string') {
      const sel = window.getSelection();
      if (!(sel.rangeCount && !sel.isCollapsed && sel.toString() === ghost.textContent)) {
        // the typed letters take the ghost's place, the caret after them
        e.preventDefault();
        writeOverGhost();
        ghost.textContent = e.data;
        const r = document.createRange();
        r.selectNodeContents(ghost);
        r.collapse(false);
        sel.removeAllRanges();
        sel.addRange(r);
        body.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: e.data }));
        return;
      }
    }
    if (ghost && e.inputType && e.inputType.startsWith('insert')) selectGhost(ghost);
    writeOverGhost();
  });
  // NEO's own typing aids (smart quotes, capitals) write without a
  // beforeinput: a key that types a letter over a ghost selects it whole and
  // makes it prose first (an input method's first key reads Process)
  body.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.isComposing) return;
    const types = (e.key && e.key.length === 1) || e.key === 'Process' || e.keyCode === 229;
    if (!types) return;
    const ghost = ghostAtCaret();
    if (!ghost) return;
    selectGhost(ghost);
    writeOverGhost();
  }, true);
  // …and when undo brings a ghost's words back, the ghost comes back with
  // them: the class isn't part of the engine's undo, so it follows the text
  body.addEventListener('input', (e) => {
    if (!e.inputType || !e.inputType.startsWith('history')) return;
    for (const p of body.querySelectorAll('p[data-sec-id]')) {
      const was = ghostWas[p.dataset.secId];
      if (was !== undefined) p.classList.toggle('ghost', p.textContent === was);
    }
  });
}

// the contents have nothing to type in: going there is only looking
function showEntry(chId) {
  const sec = document.querySelector(`.chapter[data-id="${chId}"]`);
  if (!sec) return;
  if (document.activeElement && document.activeElement.isContentEditable) document.activeElement.blur();
  sec.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
  currentChapterId = chId;
  highlightNav();
  updateCounters();
}

function focusChapterStart(chId) {
  const nb = document.querySelector(`.chapter[data-id="${chId}"] .chapter-body`);
  if (!nb) return;
  if (!nb.isContentEditable) { showEntry(chId); return; }
  nb.focus({ preventScroll: true });
  const nr = document.createRange();
  const first = nb.querySelector('p');
  if (first) nr.setStart(first, 0); // inside the first paragraph, not the container
  else nr.selectNodeContents(nb);
  nr.collapse(true);
  const s = window.getSelection();
  s.removeAllRanges();
  s.addRange(nr);
  currentChapterId = chId;
  highlightNav();
}

// The caret at the last character of a chapter, inside its last paragraph,
// with the view kept where the writer is — not thrown to the chapter's top
function focusChapterEnd(chId, reveal = true) {
  const nb = document.querySelector(`.chapter[data-id="${chId}"] .chapter-body`);
  if (!nb) return;
  if (!nb.isContentEditable) { showEntry(chId); return; }
  nb.focus({ preventScroll: true });
  const nr = document.createRange();
  const paras = nb.querySelectorAll('p');
  const last = paras[paras.length - 1];
  if (last) {
    // the last text node that's really editable (skips placeholders and ghosts)
    const walk = document.createTreeWalker(last, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement && n.parentElement.isContentEditable
        ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
    });
    let text = null;
    for (let n = walk.nextNode(); n; n = walk.nextNode()) text = n;
    if (text) nr.setStart(text, text.length);
    else nr.setStart(last, 0); // an empty last line: before its <br>
  } else {
    nr.selectNodeContents(nb);
  }
  nr.collapse(true);
  const s = window.getSelection();
  s.removeAllRanges();
  s.addRange(nr);
  currentChapterId = chId;
  highlightNav();
  if (reveal) revealCaret();
}

// Backspace in an empty chapter deletes it:
function emptyChapterBackspace(e, body, chId) {
  if (e.key !== 'Backspace' || e.metaKey || e.ctrlKey || e.altKey) return false;
  if (body.innerText.trim() !== '') return false; // ghosts count as content
  const idx = book.chapterOrder.indexOf(chId);
  if (idx < 0 || book.chapterOrder.length < 2) return false;
  e.preventDefault();
  snapshotStructure('empty chapter removed');
  breakRun++;
  const was = caretHeight();
  if (idx > 0) {
    const prev = book.chapterOrder[idx - 1];
    deleteChapterQuiet(chId).then(() => { focusChapterEnd(prev); resetNativeUndo(); keepCaretHeight(was); });
  } else {
    // an empty chapter 1 dissolves too — the caret lands at the top of
    // what just became the new chapter 1
    const next = book.chapterOrder[1];
    deleteChapterQuiet(chId).then(() => { focusChapterStart(next); resetNativeUndo(); keepCaretHeight(was); });
  }
  return true;
}

// ⌘B / ⌘I applied by hand: the engine's native handling scrolls the
// selection "into view" and mis-measures NEO's transformed page column,
// throwing the reader to the top of the screen. Style, don't scroll.
function styleKeepScroll(e) {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return false;
  const cmd = e.shiftKey
    ? (e.code === 'KeyS' ? 'strikeThrough' : null)
    : ({ KeyB: 'bold', KeyI: 'italic', KeyU: 'underline' })[e.code];
  if (!cmd) return false;
  e.preventDefault();
  const sc = $('#paper-scroll');
  const keep = sc.scrollTop;
  document.execCommand(cmd);
  sc.scrollTop = keep;
  requestAnimationFrame(() => { sc.scrollTop = keep; });
  return true;
}

// A click on the page's empty space puts the caret where it means: below
// the text, at the end of that chapter; in the margin beside a line, on that
// line; above the first line, at the start. Margins, the space under the
// last line, the gaps between chapters and the dark room around the pages
// all count.
function caretFromEmptyClick(e) {
  if (e.button !== 0 || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
  if (!book || currentTab !== 'manuscript') return;
  const t = e.target;
  if (!t || !t.closest || t.closest('[contenteditable="true"], input, textarea, button, a, .pop-menu, .ph-mark, #title-page')) return;
  if (t.closest('.chapter-head') && t !== t.closest('.chapter-head')) return; // its number and title answer clicks themselves
  if (!(t.matches('.chapter, .chapter-head, #chapters, #paper, #paper-scroll, #editor-view'))) return;
  // the chapter whose page this is, or the one just above a gap
  let sec = t.closest('.chapter');
  if (!sec) {
    for (const c of document.querySelectorAll('#chapters .chapter')) {
      if (c.getBoundingClientRect().top <= e.clientY) sec = c; else break;
    }
  }
  if (!sec) return;
  const body = sec.querySelector('.chapter-body');
  if (!body || !body.isContentEditable) return;
  const box = body.getBoundingClientRect();
  const chId = sec.dataset.id;
  e.preventDefault();
  if (e.clientY < box.top) { focusChapterStart(chId); return; }
  // below the text: the caret at its end, and the page stays where it is
  // (focusChapter's focus() scrolled up to the chapter's top, a page or two
  // on a half-empty sheet, #354)
  if (e.clientY > box.bottom) { focusChapterEnd(chId, false); updateCounters(); return; }
  const x = Math.min(Math.max(e.clientX, box.left + 2), box.right - 2);
  const r = document.caretRangeFromPoint(x, e.clientY);
  if (!r || !body.contains(r.startContainer)) { focusChapterEnd(chId, false); updateCounters(); return; }
  body.focus({ preventScroll: true });
  const s = window.getSelection();
  s.removeAllRanges();
  s.addRange(r);
  currentChapterId = chId;
  highlightNav();
  updateCounters();
}
$('#editor-view').addEventListener('mousedown', caretFromEmptyClick);

// ⌥⌘↓ / ⌥⌘↑ (Ctrl+Alt on Windows and Linux): the start of the next or the
// previous chapter, without opening the pane
function gotoChapter(step) {
  if (!book || $('#editor-view').hidden || !book.chapterOrder.length) return;
  if (document.querySelector('.modal-backdrop:not([hidden])')) return;
  if (currentTab !== 'manuscript') switchTab('manuscript');
  const order = book.chapterOrder;
  let at = order.indexOf(currentChapterId);
  if (at < 0) at = step > 0 ? -1 : order.length;
  const to = Math.max(0, Math.min(order.length - 1, at + step));
  if (to === at) return;
  const sec = document.querySelector(`.chapter[data-id="${order[to]}"]`);
  if (!sec) return;
  focusChapterStart(order[to]);
  sec.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
}

// The caret's line on screen, or null when the caret isn't on the page
function caretRect() {
  const sc = $('#paper-scroll');
  const sel = window.getSelection();
  if (!sc || !sel.rangeCount || !sc.contains(sel.anchorNode)) return null;
  const r = sel.getRangeAt(0).cloneRange();
  r.collapse(false);
  const rect = r.getBoundingClientRect();
  if (rect.height) return rect;
  // an empty line has no text to measure: its paragraph does
  const node = r.endContainer.nodeType === Node.ELEMENT_NODE ? r.endContainer : r.endContainer.parentElement;
  return node ? node.getBoundingClientRect() : null;
}

// A chapter split, merged or taken away redraws the chapters. The writer's
// line stays at the height it had in the window, so the page doesn't jump:
// caretHeight() before the change, keepCaretHeight(it) after.
// (The browser's own scroll anchoring is paused meanwhile: it moves the page
// to make up for what changed above the window, after NEO has already put
// the line back, and the page landed a line or two off.)
function caretHeight() {
  const sc = $('#paper-scroll');
  sc.style.overflowAnchor = 'none';
  clearTimeout(caretHeight.t);
  caretHeight.t = setTimeout(() => { sc.style.overflowAnchor = ''; }, 3000); // (never left off)
  const rect = caretRect();
  return rect ? rect.top - sc.getBoundingClientRect().top : null;
}
function keepCaretHeight(was) {
  const sc = $('#paper-scroll');
  const rect = caretRect();
  if (was != null && rect) sc.scrollTop += rect.top - sc.getBoundingClientRect().top - was;
  // anchoring back on once the page has settled where NEO put it
  clearTimeout(caretHeight.t);
  caretHeight.t = setTimeout(() => { sc.style.overflowAnchor = ''; }, 300);
}

// The caret never types out of sight: an Enter (or anything else) on the
// window's bottom line brings the new line into view, with a little room
// below it. (Typewriter scrolling keeps the line centered on its own.)
function revealCaret() {
  const sc = $('#paper-scroll');
  const rect = caretRect();
  if (!rect) return;
  const box = sc.getBoundingClientRect();
  const room = Math.min(48, box.height / 6);
  if (rect.bottom > box.bottom - room) sc.scrollTop += rect.bottom - (box.bottom - room);
  else if (rect.top < box.top + 8) sc.scrollTop -= box.top + 8 - rect.top;
}

// Backspace at the very start of a chapter swallows an empty chapter above it
function chapterStartBackspace(e, body, chId) {
  if (e.key !== 'Backspace' || e.metaKey || e.ctrlKey || e.altKey) return false;
  const sel = window.getSelection();
  if (!sel.rangeCount || !sel.isCollapsed) return false;
  const r = sel.getRangeAt(0);
  const pre = document.createRange();
  pre.selectNodeContents(body);
  try { pre.setEnd(r.startContainer, r.startOffset); } catch { return false; }
  if (pre.toString().length !== 0) return false; // caret isn't at the chapter's first character
  // …and on its first line. Below an empty line, Backspace takes the empty
  // line away and the paragraph moves up to the top of the chapter; it
  // never reaches past it into the chapter above.
  let el = r.startContainer.nodeType === Node.TEXT_NODE ? r.startContainer.parentElement : r.startContainer;
  const block = el && el.closest ? el.closest('p') : null;
  if (block && body.contains(block) && block !== body.firstElementChild) {
    const above = block.previousElementSibling;
    if (!above || above.tagName !== 'P' || above.classList.contains('scene-break') || above.classList.contains('ghost')) return false;
    e.preventDefault();
    snapshotStructure('empty line removed');
    above.remove();
    placeCaret(block, 0);
    syncChapter(body, chId, 'break');
    resetNativeUndo();
    breakRun++;
    return true;
  }
  const idx = book.chapterOrder.indexOf(chId);
  if (idx <= 0) return false;
  const prevId = book.chapterOrder[idx - 1];
  const prevBody = document.querySelector(`.chapter[data-id="${prevId}"] .chapter-body`);
  if (!prevBody || chapterKind(prevId) === 'contents') return false;
  const empty = prevBody.innerText.trim() === '';
  // only story runs into story: a page above stays a page
  if (!empty && !(isStory(chId) && isStory(prevId))) return false;
  e.preventDefault();
  if (empty) {
    // empty chapter above: swallow it
    snapshotStructure('empty chapter removed');
    breakRun++;
    const was = caretHeight();
    deleteChapterQuiet(prevId).then(() => { focusChapterStart(chId); resetNativeUndo(); keepCaretHeight(was); });
    return true;
  }
  // chapter with words above: merge this chapter up into it — the inverse
  // of a triple-Enter split, and ⌘Z restores the split
  snapshotStructure('chapters merged');
  const was = caretHeight();
  const prevCount = prevBody.querySelectorAll('p').length;
  const keepScroll = $('#paper-scroll').scrollTop;
  setChapterHTML(prevId, captureBody(prevBody) + captureBody(body), 'merge');
  persistChapter(prevId);
  for (const s of stickies) if (s.chapterId === chId) s.chapterId = prevId;
  writeStickies(book.id, stickies, 'merge');
  for (const d of darlings) if (d.chapterId === chId) d.chapterId = prevId;
  writeSidecar(book.id, 'darlings', darlings);
  if (book.sectionNotes && book.sectionNotes[chId]) {
    book.sectionNotes[prevId] = [...(book.sectionNotes[prevId] || []), ...book.sectionNotes[chId]];
    delete book.sectionNotes[chId];
  }
  if (book.chapterTitles) delete book.chapterTitles[chId];
  if (book.chapterNotes) delete book.chapterNotes[chId];
  if (book.chapterKinds) delete book.chapterKinds[chId];
  book.chapterOrder = book.chapterOrder.filter((c) => c !== chId);
  dropChapterHTML(chId, 'merge');
  rec.streams('merge');
  clearTimeout(saveTimers[chId]);
  delete saveTimers[chId];
  // on disk, in the order that can't lose a word: the chapter above with
  // both texts first, then book.json without this chapter, and only then
  // this chapter's file. A save that fails stops the sequence there.
  const bookId = book.id;
  (async () => {
    await persistChapter(prevId);
    if (!book || book.id !== bookId) return;
    await saveMeta();
    await window.neo.deleteChapter(bookId, chId);
  })().catch((err) => window.neo.logError('merge: ' + (err && err.message || err)));
  renderChapters();
  renderStickies();
  restoreCaret({ chId: prevId, pIdx: prevCount, off: 0, scroll: keepScroll });
  resetNativeUndo();
  keepCaretHeight(was); // the line stays put as the heading above it goes
  breakRun++;
  return true;
}

// Tab for spacing:
function handleTabSpacing(e) {
  if (e.key !== 'Tab' || e.metaKey || e.ctrlKey || e.altKey) return false;
  e.preventDefault();
  if (!e.shiftKey) {
    document.execCommand('insertText', false, '  ');
    return true;
  }
  // Shift+Tab: remove up to two preceding em spaces
  const sel = window.getSelection();
  if (sel.rangeCount && sel.isCollapsed) {
    const r = sel.getRangeAt(0);
    const node = r.startContainer;
    if (node.nodeType === Node.TEXT_NODE) {
      let n = 0;
      while (n < 2 && r.startOffset - n > 0 &&
             node.textContent[r.startOffset - n - 1] === ' ') n++;
      if (n > 0) {
        // through the engine, so the change is seen (and saved, and undone)
        const del = document.createRange();
        del.setStart(node, r.startOffset - n);
        del.setEnd(node, r.startOffset);
        sel.removeAllRanges();
        sel.addRange(del);
        document.execCommand('delete');
      }
    }
  }
  return true;
}

function flatOffset(p, container, offset) {
  // flatten any (container, offset) pair to a character offset in p.textContent
  let n;
  if (container.nodeType !== Node.TEXT_NODE) {
    if (!p.contains(container) && container !== p) return -99;
    let acc = 0;
    for (let i = 0; i < offset && i < container.childNodes.length; i++) {
      acc += container.childNodes[i].textContent.length;
    }
    let before = 0;
    const w = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    while ((n = w.nextNode())) {
      if (container === p || container.contains(n)) break;
      before += n.textContent.length;
    }
    return (container === p ? 0 : before) + acc;
  }
  let pos = 0;
  const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
  while ((n = walker.nextNode())) {
    if (n === container) return pos + offset;
    pos += n.textContent.length;
  }
  return -1;
}

function flatPoint(p, off) {
  const w = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
  let pos = 0, n;
  while ((n = w.nextNode())) {
    const len = n.textContent.length;
    if (off <= pos + len) return [n, off - pos];
    pos += len;
  }
  return null;
}

// A delete that leaves two plain spaces touching triggers the engine's broken
// whitespace repair, which duplicates a neighboring character. When that exact
// hazard is about to happen, take the right-hand space along with the deletion,
// leaving one clean space. All other deletes stay native.
function spaceSafeDelete(e, body, chId) {
  if (e.key !== 'Backspace' && e.key !== 'Delete') return false;
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  const sel = window.getSelection();
  if (!sel.rangeCount) return false;
  const r = sel.getRangeAt(0);
  const elOf = (n) => (n.nodeType === Node.TEXT_NODE ? n.parentElement : n);
  const pA = elOf(r.startContainer)?.closest?.('p');
  const pB = elOf(r.endContainer)?.closest?.('p');
  if (!pA || pA !== pB || !body.contains(pA)) return false;
  const t = pA.textContent;
  let from, to;
  if (sel.isCollapsed) {
    const at = flatOffset(pA, r.startContainer, r.startOffset);
    if (at < 0) return false;
    if (e.key === 'Backspace') { from = at - 1; to = at; } else { from = at; to = at + 1; }
    if (from < 0 || to > t.length) return false;
  } else {
    from = flatOffset(pA, r.startContainer, r.startOffset);
    to = flatOffset(pA, r.endContainer, r.endOffset);
    if (from < 0 || to <= from) return false;
  }
  if (t[from - 1] !== ' ' || t[to] !== ' ') return false;
  let end = to;
  while (t[end] === ' ') end++;
  const a = flatPoint(pA, from), b = flatPoint(pA, end);
  if (!a || !b) return false;
  e.preventDefault();
  const nr = document.createRange();
  nr.setStart(a[0], a[1]); nr.setEnd(b[0], b[1]);
  sel.removeAllRanges(); sel.addRange(nr);
  document.execCommand('insertText', false, '');
  return true;
}

// Merge fragmented text nodes in the paragraph(s) the selection touches,
// so native editing operates on whole text instead of seams.
function healSelectionSeams(body) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const r = sel.getRangeAt(0);
  const paraOf = (n) => {
    if (n && n.nodeType === Node.TEXT_NODE) n = n.parentElement;
    return n && n.closest ? n.closest('p') : null;
  };
  const a = paraOf(r.startContainer);
  const b = paraOf(r.endContainer);
  try { if (a && body.contains(a)) a.normalize(); } catch { /* fine */ }
  try { if (b && b !== a && body.contains(b)) b.normalize(); } catch { /* fine */ }
}

// Chromium mangles Backspace/Delete beside non-editable inline elements:
function guardMarkerDelete(e, body, chId) {
  if (e.key !== 'Backspace' && e.key !== 'Delete') return false;
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  const sel = window.getSelection();
  if (!sel.rangeCount || !sel.isCollapsed) return false;
  const r = sel.getRangeAt(0);
  const node = r.startContainer;
  const back = e.key === 'Backspace';
  const isMark = (n) => n && n.nodeType === Node.ELEMENT_NODE &&
    (n.classList.contains('ph-mark') || n.classList.contains('darling-anchor'));

  // Case 1: the deletion would cross INTO a marker (caret at a node boundary,
  // marker on the far side) — delete the marker itself, cleanly.
  let adjacent = null;
  if (node.nodeType === Node.TEXT_NODE) {
    if (back && r.startOffset === 0) adjacent = node.previousSibling;
    else if (!back && r.startOffset === node.textContent.length) adjacent = node.nextSibling;
  } else if (node.nodeType === Node.ELEMENT_NODE) {
    adjacent = back ? node.childNodes[r.startOffset - 1] : node.childNodes[r.startOffset];
  }
  if (isMark(adjacent)) {
    e.preventDefault();
    if (adjacent.classList.contains('ph-mark') && adjacent.dataset.sid) {
      resolveSticky(adjacent.dataset.sid); // removes mark + its note, syncs
    } else {
      adjacent.remove();
      syncChapter(body, chId, 'break');
    }
    return true;
  }

  // Case 2: deleting a character inside a text node that TOUCHES a marker:
  if (node.nodeType !== Node.TEXT_NODE) return false;
  if (back ? r.startOffset === 0 : r.startOffset >= node.textContent.length) return false;
  if (!isMark(node.previousSibling) && !isMark(node.nextSibling)) return false;

  e.preventDefault();
  const targetOffset = back ? r.startOffset - 1 : r.startOffset;
  const del = document.createRange();
  del.setStart(node, targetOffset);
  del.setEnd(node, targetOffset + 1);
  del.deleteContents();
  const caret = document.createRange();
  caret.setStart(node, targetOffset);
  caret.collapse(true);
  sel.removeAllRanges();
  sel.addRange(caret);
  syncChapter(body, chId, 'break');
  return true;
}

// The engine wraps text in style-carrying spans during merges and splits
// ("<span style='text-indent...'>"). They corrupt later edits — unwrap them,
// keeping only NEO's own marks.
function stripJunkSpans(el) {
  for (const s of [...el.querySelectorAll('span:not(.ph-mark)')]) {
    while (s.firstChild) s.before(s.firstChild);
    s.remove();
  }
  // …and the size, face or colour the engine writes onto bold and italic
  // words when it merges lines: a word kept at an old size ignores ⌘+ and ⌘−
  for (const f of el.querySelectorAll('b[style], i[style], em[style], strong[style], u[style], s[style], strike[style], sub[style], sup[style]')) {
    f.removeAttribute('style');
  }
}

// Enter once: new paragraph. Enter twice: *** section break — wherever the
// caret is, even mid-sentence. Enter three times: the chapter splits here.
let enterRun = 0;
// break operations live outside the engine's undo history; while the most
// recent edits are breaks, ⌘Z routes to NEO's structural undo, one per press
let breakRun = 0;

// was: the caret's height in the window before the *** above it went
function splitChapterAt(body, chId, block, sel, was) {
  // an empty line is no way to start a chapter, or end one: blank lines at
  // the seam stay behind (the new chapter opens on its first words)
  const blank = (p) => p && p.tagName === 'P' && !p.classList.contains('scene-break') && p.textContent.trim() === '' && !p.querySelector('.ph-mark');
  while (blank(block) && block.nextElementSibling) {
    const next = block.nextElementSibling;
    block.remove();
    block = next;
  }
  while (blank(block.previousElementSibling) && block.previousElementSibling.previousElementSibling) block.previousElementSibling.remove();
  const parts = [];
  let n = block;
  while (n) {
    const next = n.nextElementSibling;
    parts.push(n.outerHTML);
    n.remove();
    n = next;
  }
  if (!body.querySelector('p')) body.innerHTML = '<p><br></p>';
  syncChapter(body, chId, 'split');
  const idx = book.chapterOrder.indexOf(chId);
  const newId = createChapterAt(idx + 1);
  setChapterHTML(newId, parts.join('') || '<p><br></p>', 'split');
  persistChapter(newId);
  renderChapters();
  focusChapterStart(newId);
  resetNativeUndo();
  // the writer's line stays where it was in the window, the new chapter's
  // heading above it; only a line near the window's top moves down, as far
  // as it takes for the heading to show
  keepCaretHeight(was);
  const sc = $('#paper-scroll');
  const head = document.querySelector(`.chapter[data-id="${newId}"] .chapter-head`).getBoundingClientRect();
  const top = sc.getBoundingClientRect().top + 8;
  if (head.height && head.top < top) sc.scrollTop -= top - head.top;
  revealCaret();
  breakRun++;
}

function handleEnter(e, body, chId) {
  if (e.key !== 'Enter' || e.shiftKey) return false;
  const sel = window.getSelection();
  if (!sel.rangeCount || !sel.isCollapsed) return false;
  let el = sel.anchorNode;
  if (el.nodeType === Node.TEXT_NODE) el = el.parentElement;
  const block = el && el.closest ? el.closest('p') : null;
  if (!block || !body.contains(block)) return false;
  // on a page (a dedication, a part, the copyright) Enter is only a new
  // line: breaks and new chapters belong to the story
  if (!isStory(chId) && !block.classList.contains('poetry')) {
    e.preventDefault();
    enterRun = 0;
    if (block.querySelector('span:not(.ph-mark)')) {
      const caret = captureCaret();
      stripJunkSpans(block);
      restoreCaret(caret);
    }
    document.execCommand('insertParagraph');
    syncChapter(body, chId, 'break');
    return true;
  }
  if (block.classList.contains('scene-break')) { e.preventDefault(); return true; } // Enter on a *** line: nothing
  // Enter in a poetry paragraph steps back into prose: an empty line becomes
  // an ordinary paragraph in place; otherwise the line splits and the new
  // paragraph is plain (⇧Enter is how the poem continues)
  if (block.classList.contains('poetry') || block.classList.contains('flush')) {
    e.preventDefault();
    enterRun = 0;
    if (block.textContent.trim() === '') {
      snapshotStructure('poetry paragraph to prose');
      block.classList.remove('poetry', 'flush');
      romanize(block);
      placeCaret(block, 0);
      syncChapter(body, chId, 'break');
      resetNativeUndo();
      breakRun++;
      return true;
    }
    const wasPoetry = block.classList.contains('poetry');
    document.execCommand('insertParagraph');
    const cur = caretBlock(body);
    if (cur && cur !== block) {
      cur.classList.remove('poetry', 'flush');
      if (wasPoetry) romanize(cur);
      placeCaret(cur, 0);
    }
    syncChapter(body, chId, 'break');
    return true;
  }
  const prev = block.previousElementSibling;

  if (block.textContent.trim() !== '') {
    // caret inside a real paragraph — where is it?
    const r = sel.getRangeAt(0);
    const pre = document.createRange();
    pre.selectNodeContents(block);
    try { pre.setEnd(r.startContainer, r.startOffset); } catch { return false; }
    const atStart = pre.toString().length === 0;

    // second/third Enter mid-flow: the caret sits at the start of the text
    // that the previous press pushed down
    if (atStart && enterRun >= 2 && prev) {
      if (prev.classList.contains('scene-break')) {
        // third Enter: everything from here becomes the next chapter
        e.preventDefault();
        snapshotStructure('chapter split');
        const was = caretHeight();
        prev.remove();
        splitChapterAt(body, chId, block, sel, was);
        return true;
      }
      e.preventDefault();
      // a break made by the full double-Enter gesture un-splits on undo too
      snapshotStructure('section break', { rejoin: enterRun >= 2 });
      if (prev.textContent.trim() === '') {
        // a break is only a break: no alignment or paragraph kind carried
        // over from the paragraph it was made in (a justified one set it left)
        prev.removeAttribute('style');
        prev.className = 'scene-break';
        prev.textContent = '***';
      } else {
        const brk = document.createElement('p');
        brk.className = 'scene-break';
        brk.textContent = '***';
        block.before(brk);
      }
      const keep = document.createRange();
      keep.setStart(block, 0);
      keep.collapse(true);
      sel.removeAllRanges();
      sel.addRange(keep);
      syncChapter(body, chId, 'break');
      resetNativeUndo();
      // no input event follows a break made by hand, so the caret is kept in
      // sight here, as typing keeps it: a break near the window's foot pushed
      // the line below it until the next key
      if (!typewriterEnabled) revealCaret();
      breakRun++;
      return true;
    }

    // normal Enter — native split so ⌘Z keeps working; junk spans (which
    // make the engine clone whole paragraphs) are stripped first if present
    e.preventDefault();
    if (block.querySelector('span:not(.ph-mark)')) {
      // Unwrapping moves text nodes, so preserve the caret's text position.
      const caret = captureCaret();
      stripJunkSpans(block);
      restoreCaret(caret);
    }
    document.execCommand('insertParagraph');
    syncChapter(body, chId, 'break');
    return true;
  }

  // Third Enter at end of flow: empty paragraph under a *** — chapter splits here
  if (prev && prev.classList.contains('scene-break')) {
    e.preventDefault();
    snapshotStructure('chapter split');
    const was = caretHeight();
    prev.remove();
    splitChapterAt(body, chId, block, sel, was);
    return true;
  }

  // Second Enter at end of flow: the empty paragraph becomes a *** break
  if (prev) {
    e.preventDefault();
    snapshotStructure('section break', { rejoin: enterRun >= 2 });
    block.removeAttribute('style'); // (see above: a break carries nothing over)
    block.className = 'scene-break';
    block.textContent = '***';
    const np = document.createElement('p');
    np.innerHTML = '<br>';
    block.after(np);
    const range = document.createRange();
    range.setStart(np, 0);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    syncChapter(body, chId, 'break');
    resetNativeUndo();
    if (!typewriterEnabled) revealCaret(); // (see the break above)
    breakRun++;
    return true;
  }
  return false;
}

/* ================================================================== */
/*  POETRY PARAGRAPHS — ⌘⇧Enter (Ctrl+Shift+Enter)                     */
/*  A paragraph pulled in from the margins, italic: a stanza of verse,  */
/*  a quote, a POV name under the chapter heading. One class, one key.  */
/*  FLUSH PARAGRAPHS — ⇧Enter                                          */
/*  Prose with no first-line indent: a report, a list, an email, a     */
/*  sign in the story. ⇧Enter again gives another; Enter is prose.     */
/* ================================================================== */

// the paragraph holding the caret, if it belongs to this chapter body
function caretBlock(body) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  let el = sel.anchorNode;
  if (el && el.nodeType === Node.TEXT_NODE) el = el.parentElement;
  const block = el && el.closest ? el.closest('p') : null;
  return block && body.contains(block) ? block : null;
}

// A poetry paragraph is born italic — real <i> markup, so ⌘I can take it
// off a word — and sheds that default italic when it returns to prose.
function italicize(p) {
  if (p.textContent.trim() === '') { p.innerHTML = '<i><br></i>'; return; }
  const kids = [...p.childNodes].filter((n) => !(n.nodeType === Node.TEXT_NODE && !n.textContent.trim()));
  if (kids.length === 1 && kids[0].nodeType === Node.ELEMENT_NODE && kids[0].tagName === 'I') return;
  const i = document.createElement('i');
  while (p.firstChild) i.appendChild(p.firstChild);
  p.appendChild(i);
}
function romanize(p) {
  const kids = [...p.childNodes].filter((n) => !(n.nodeType === Node.TEXT_NODE && !n.textContent.trim()));
  if (kids.length !== 1 || kids[0].nodeType !== Node.ELEMENT_NODE || kids[0].tagName !== 'I') return;
  const i = kids[0];
  while (i.firstChild) i.before(i.firstChild);
  i.remove();
  if (p.textContent.trim() === '' && !p.querySelector('br')) p.innerHTML = '<br>';
}
// caret at the start of a paragraph's text — inside its italic when it has one
function caretIntoStart(p) {
  const i = p.firstElementChild && p.firstElementChild.tagName === 'I' ? p.firstElementChild : p;
  placeCaret(i, 0);
}

function placeCaret(node, offset) {
  const sel = window.getSelection();
  const r = document.createRange();
  r.setStart(node, offset);
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
}

// ⌘⇧Enter (Ctrl+Shift+Enter). At the end of a paragraph: a new poetry
// paragraph beneath it. Mid-paragraph: the text after the caret becomes
// one. Inside a poetry paragraph, ⇧Enter or ⌘⇧Enter: another line of it,
// so verse flows. On a *** line: nothing.
function handlePoetry(e, body, chId) {
  if (e.key !== 'Enter' || !e.shiftKey || e.altKey) return false;
  const sel = window.getSelection();
  if (!sel.rangeCount || !sel.isCollapsed) return false;
  const block = caretBlock(body);
  if (!block) return false;
  const mod = e.metaKey || e.ctrlKey;
  if (!mod && !block.classList.contains('poetry')) return false; // ⇧Enter alone: a flush paragraph
  e.preventDefault();
  if (block.classList.contains('scene-break')) return true;

  if (block.classList.contains('poetry')) {
    // the engine's own split keeps the class on the new line, and ⌘Z sees it
    if (block.querySelector('span:not(.ph-mark)')) stripJunkSpans(block);
    document.execCommand('insertParagraph');
    const cur = caretBlock(body);
    if (cur) {
      cur.classList.add('poetry');
      if (cur.textContent.trim() === '' && !cur.querySelector('i')) { italicize(cur); caretIntoStart(cur); }
    }
    syncChapter(body, chId, 'para-kind');
    return true;
  }

  snapshotStructure('poetry paragraph');
  const r = sel.getRangeAt(0);
  const tail = document.createRange();
  tail.selectNodeContents(block);
  try { tail.setStart(r.startContainer, r.startOffset); } catch { return true; }
  const after = tail.toString();
  const empty = block.textContent.trim() === '';
  const atStart = after.length === block.textContent.length;
  if (empty || atStart) {
    // an empty paragraph, or the caret at its very start: the whole paragraph turns to poetry
    block.classList.remove('flush');
    block.classList.add('poetry');
    italicize(block);
    caretIntoStart(block);
  } else {
    const line = document.createElement('p');
    line.className = 'poetry';
    if (after.trim() !== '') {
      line.appendChild(tail.extractContents());
      for (const junk of line.querySelectorAll('br')) junk.remove();
      if (!block.textContent.trim()) block.innerHTML = '<br>';
    }
    italicize(line);
    block.after(line);
    caretIntoStart(line);
  }
  syncChapter(body, chId, 'para-kind');
  resetNativeUndo();
  breakRun++;
  return true;
}

// ⇧Enter. At the end of a paragraph: a flush paragraph beneath it.
// Mid-paragraph: the text after the caret becomes one. At the start of a
// paragraph (or in an empty one): that paragraph goes flush. Inside a flush
// paragraph: another one. On a *** line: nothing.
function handleFlush(e, body, chId) {
  if (e.key !== 'Enter' || !e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return false;
  const sel = window.getSelection();
  if (!sel.rangeCount || !sel.isCollapsed) return false;
  const block = caretBlock(body);
  if (!block) return false;
  e.preventDefault();
  if (block.classList.contains('scene-break')) return true;
  if (block.querySelector('span:not(.ph-mark)')) stripJunkSpans(block);
  if (block.classList.contains('flush')) {
    // the engine's own split keeps the class on the new line, and ⌘Z sees it
    document.execCommand('insertParagraph');
    const cur = caretBlock(body);
    if (cur) cur.classList.add('flush');
    syncChapter(body, chId, 'para-kind');
    return true;
  }
  const r = sel.getRangeAt(0);
  const head = document.createRange();
  head.selectNodeContents(block);
  try { head.setEnd(r.startContainer, r.startOffset); } catch { return true; }
  if (block.textContent.trim() === '' || head.toString().length === 0) {
    snapshotStructure('flush paragraph');
    block.classList.add('flush');
    syncChapter(body, chId, 'para-kind');
    resetNativeUndo();
    breakRun++;
    return true;
  }
  document.execCommand('insertParagraph');
  const cur = caretBlock(body);
  if (cur && cur !== block) cur.classList.add('flush');
  syncChapter(body, chId, 'para-kind');
  return true;
}

// Backspace at the very start of a poetry or flush paragraph makes it prose
// again — the second Backspace then merges it upward like any paragraph
function poetryBackspace(e, body, chId) {
  if (e.key !== 'Backspace' || e.metaKey || e.ctrlKey || e.altKey) return false;
  const sel = window.getSelection();
  if (!sel.rangeCount || !sel.isCollapsed) return false;
  const block = caretBlock(body);
  if (!block || !(block.classList.contains('poetry') || block.classList.contains('flush'))) return false;
  const r = sel.getRangeAt(0);
  const head = document.createRange();
  head.selectNodeContents(block);
  try { head.setEnd(r.startContainer, r.startOffset); } catch { return false; }
  if (head.toString().length !== 0) return false;
  e.preventDefault();
  snapshotStructure('poetry paragraph to prose');
  if (block.classList.contains('poetry')) romanize(block);
  block.classList.remove('poetry', 'flush');
  placeCaret(block, 0);
  syncChapter(body, chId, 'para-kind');
  resetNativeUndo();
  breakRun++;
  return true;
}

// Format → Poetry Paragraph / Flush Paragraph: toggles every paragraph the
// selection touches (a paragraph is one or the other, or plain prose)
function togglePoetry() { toggleParaKind('poetry'); }
function toggleFlush() { toggleParaKind('flush'); }
function toggleParaKind(kind) {
  const sel = window.getSelection();
  if (!sel.rangeCount) { toast(t('Click into a paragraph first')); return; }
  const r = sel.getRangeAt(0);
  let el = r.startContainer;
  if (el.nodeType === Node.TEXT_NODE) el = el.parentElement;
  const body = el && el.closest ? el.closest('.chapter-body') : null;
  if (!body) { toast(t('Click into a paragraph first')); return; }
  const chId = body.closest('.chapter').dataset.id;
  const ps = [...body.querySelectorAll('p')].filter(
    (p) => r.intersectsNode(p) && !p.classList.contains('scene-break')
  );
  if (!ps.length) return;
  snapshotStructure(kind + ' paragraph');
  const on = !ps.every((p) => p.classList.contains(kind));
  for (const p of ps) {
    const wasPoetry = p.classList.contains('poetry');
    p.classList.remove('poetry', 'flush');
    if (on) p.classList.add(kind);
    if (kind === 'poetry' && on) italicize(p);
    else if (wasPoetry) romanize(p);
  }
  caretIntoStart(ps[0]);
  syncChapter(body, chId, 'para-kind');
  resetNativeUndo();
  breakRun++;
}

// ⇧Enter from the chapter title: a poetry paragraph above the opening one
function poetryUnderHeading(body, chId) {
  const line = document.createElement('p');
  line.className = 'poetry';
  italicize(line);
  snapshotStructure('poetry paragraph');
  body.prepend(line);
  body.focus();
  caretIntoStart(line);
  syncChapter(body, chId, 'para-kind');
  resetNativeUndo();
  breakRun++;
}

// Backspace just below a *** (or Delete just above one) removes the break
// itself — prose never merges into the break's styled paragraph. With the
// caret on the *** line itself, either key removes the whole break too: a
// break is one thing, so it never joins the line above as three stars of
// text, and never loses one star at a time.
function sceneBreakDelete(e, body, chId) {
  if (e.key !== 'Backspace' && e.key !== 'Delete') return false;
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  const sel = window.getSelection();
  if (!sel.rangeCount || !sel.isCollapsed) return false;
  const r = sel.getRangeAt(0);
  let el = r.startContainer;
  if (el.nodeType === Node.TEXT_NODE) el = el.parentElement;
  const block = el && el.closest ? el.closest('p') : null;
  if (!block || !body.contains(block)) return false;
  const back = e.key === 'Backspace';
  if (block.classList.contains('scene-break')) {
    // the caret goes where the key was heading: the end of the line above
    // (Backspace) or the start of the line below (Delete), or the other one
    // when there's nothing that way
    const above = block.previousElementSibling;
    const below = block.nextElementSibling;
    e.preventDefault();
    snapshotStructure('section break removed');
    block.remove();
    if (back && above) caretToEnd(above);
    else if (below) caretIntoStart(below);
    else if (above) caretToEnd(above);
    syncChapter(body, chId, 'break');
    resetNativeUndo();
    breakRun++;
    return true;
  }
  const edge = document.createRange();
  edge.selectNodeContents(block);
  try {
    if (back) edge.setEnd(r.startContainer, r.startOffset);
    else edge.setStart(r.startContainer, r.startOffset);
  } catch { return false; }
  if (edge.toString().length !== 0) return false; // caret isn't at the block's edge
  const target = back ? block.previousElementSibling : block.nextElementSibling;
  if (!target || !target.classList.contains('scene-break')) return false;
  e.preventDefault();
  snapshotStructure('section break removed');
  target.remove();
  syncChapter(body, chId, 'break');
  resetNativeUndo();
  breakRun++;
  return true;
}

// Read a body's HTML for saving:
function captureBody(body) {
  // (a page marks the lines that say who said it, and a chapter the speech
  // after a scene break, for the screen only)
  // (and a script's page breaks, (CONT'D) and suggestions)
  return dropJunkSpans(body.innerHTML).replace(/<(b|i|em|strong|u|s|strike|sub|sup)\s+style="[^"]*"/g, '<$1').replace(/<p\b[^>]*>/g, (tag) => tag.replace(/ data-(?:attr|speech|first|walk)=""/g, '')
    .replace(/ data-(?:pg|fill|contd|ghost|ghost-empty|sp-paste|scene-note)(?:="[^"]*")?/g, ''));
}

// The engine's style spans (stripJunkSpans), left out of what's saved. A
// cut, Backspace or Delete across paragraphs wraps the words it joins in
// them (the indent and white-space of the paragraph they came from); taken
// off the page there and then, they'd break ⌘Z, which puts back what the
// engine itself took away. So the page keeps them until the chapter is next
// opened, and the file never has them. NEO's own spans (placeholder flags)
// stay.
function dropJunkSpans(html) {
  if (html.indexOf('<span') < 0) return html;
  const junk = [];
  return html.replace(/<span\b[^>]*>|<\/span>/g, (tag) => {
    if (tag[1] === '/') return junk.pop() ? '' : tag;
    const drop = !/\sclass="[^"]*\bph-mark\b/.test(tag);
    junk.push(drop);
    return drop ? '' : tag;
  });
}

// A chapter that opens on a line of dialogue sets no drop cap: the dash
// itself would be the letter enlarged. That line, and one that follows a
// scene break, keep their indent where prose is set flush, so the speech
// lines up with the lines that answer it. The marks are never saved.
const OPENING_DASH = /^\s*[-‐‑‒–—―]/;
// A chapter's opening paragraph — the one with the drop cap and no indent —
// is its first paragraph with words in it, past a blank line or a *** at the
// top (the exports skip those too). Poetry stands apart. In an empty
// chapter it's the paragraph waiting for the first word. Marked data-first,
// for the screen only.
function openingPara(body) {
  const ps = [...body.children].filter((p) => p.tagName === 'P' && !p.classList.contains('poetry') && !p.classList.contains('scene-break') && !p.classList.contains('ghost'));
  return ps.find((p) => p.textContent.trim() !== '') || ps[0] || null;
}
function markDialogueOpening(body) {
  const first = openingPara(body);
  for (const p of body.querySelectorAll('p[data-first]')) if (p !== first) p.removeAttribute('data-first');
  if (first && !first.hasAttribute('data-first')) first.setAttribute('data-first', '');
  body.classList.toggle('opens-dialogue', !!first && OPENING_DASH.test(first.textContent));
  for (const p of body.querySelectorAll('p[data-speech]')) if (!p.matches('.scene-break + p')) p.removeAttribute('data-speech');
  for (const p of body.querySelectorAll('p.scene-break + p')) {
    const speech = OPENING_DASH.test(p.textContent);
    if (p.hasAttribute('data-speech') !== speech) p.toggleAttribute('data-speech', speech);
  }
}

function syncChapter(body, chId, cause = 'program') {
  markDialogueOpening(body);
  setChapterHTML(chId, captureBody(body), cause, { hint: (html) => caretHtmlOffset(body, html) });
  wordCache[chId] = null;
  scheduleChapterSave(chId);
  updateCounters();
  scheduleNavRefresh();
}

// Heal text-node fragmentation in each paragraph as the caret leaves it:
let lastCaretPara = null;
let capOffBody = null;
let menuPoetryState = false;
let menuFlushState = false;
document.addEventListener('selectionchange', () => {
  if (!book || currentTab !== 'manuscript') return;
  const sel = window.getSelection();
  let caretP = null;
  if (sel && sel.rangeCount) {
    let el = sel.anchorNode;
    if (el && el.nodeType === Node.TEXT_NODE) el = el.parentElement;
    const p = el && el.closest ? el.closest('p') : null;
    if (p && p.parentElement && p.parentElement.classList.contains('chapter-body')) caretP = p;
  }
  if (caretP !== lastCaretPara) {
    if (lastCaretPara && lastCaretPara.isConnected) {
      try { lastCaretPara.normalize(); } catch { /* fine */ }
    }
    lastCaretPara = caretP;
  }
  // a script: the element in the pane, the suggestion at the caret
  if (isScript()) {
    if (caretP) spLastPara = caretP;
    spRefreshGhost();
    spShowElement();
    spHighlightScene();
  }
  // during a spellcheck pass, each chapter scans as the caret arrives
  if (spellOn && caretP) {
    const ch = caretP.closest('.chapter');
    if (ch) scanSpellingIn(ch.querySelector('.chapter-body'), ch.dataset.id);
  }
  // the drop cap steps aside while the caret is in the first paragraph
  const inPoetry = !!(caretP && caretP.classList.contains('poetry'));
  if (inPoetry !== menuPoetryState && window.neo.poetryState) {
    menuPoetryState = inPoetry;
    window.neo.poetryState(inPoetry);
  }
  const inFlush = !!(caretP && caretP.classList.contains('flush'));
  if (inFlush !== menuFlushState && window.neo.flushState) {
    menuFlushState = inFlush;
    window.neo.flushState(inFlush);
  }
  const inFirst = caretP && caretP.parentElement &&
    caretP.hasAttribute('data-first');
  const capBody = inFirst ? caretP.parentElement : null;
  if (capBody !== capOffBody) {
    if (capOffBody && capOffBody.isConnected) capOffBody.classList.remove('cap-off');
    if (capBody) capBody.classList.add('cap-off');
    capOffBody = capBody;
  }
});

// Does the caret sit at the start or the end of its paragraph, or after a
// space? What's pasted there opens or ends the paragraph only if so.
function caretEdges(body) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return { start: true, end: true };
  const range = sel.getRangeAt(0);
  const node = range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer.parentElement : range.startContainer;
  const block = node && node.closest('p, div, li');
  if (!block || !body.contains(block)) return { start: true, end: true };
  const pre = document.createRange();
  pre.selectNodeContents(block);
  pre.setEnd(range.startContainer, range.startOffset);
  const post = document.createRange();
  post.selectNodeContents(block);
  post.setStart(range.endContainer, range.endOffset);
  const before = pre.toString();
  const after = post.toString();
  return { start: !before.trim(), end: !after.trim(), spaced: /\s$/.test(before), spacedAfter: /^\s/.test(after) };
}

// Reduce pasted HTML to what a manuscript is made of: paragraphs, bold,
// italic. Word, Apple Notes, Google Docs and browsers each dress a
// paragraph differently — <p>, <div>, a line break inside a block, styled
// spans — so every block boundary and <br> becomes a paragraph break, and
// styling that only lives in a style attribute is read as bold/italic.
// dashes: { style, ...caretEdges } sets dialogue dashes, for the manuscript.
function cleanPasteHtml(html, dashes) {
  // parsed off to the side: nothing in a clipboard loads or runs
  const holder = new DOMParser().parseFromString(html, 'text/html').body;
  holder.querySelectorAll('script,style,meta,link,img,head,title').forEach((n) => n.remove());
  // Google Docs wraps the whole clipboard in <b style="font-weight:normal">
  holder.querySelectorAll('b, strong').forEach((b) => {
    const w = (b.style && b.style.fontWeight || '').toLowerCase();
    if (w === 'normal' || w === '400') { while (b.firstChild) b.before(b.firstChild); b.remove(); }
  });
  // styled spans: Word's italics and bold often live only in a style attribute
  holder.querySelectorAll('span[style], font[style]').forEach((sp) => {
    const st = sp.style;
    const fw = (st.fontWeight || '').toLowerCase();
    const bold = fw === 'bold' || fw === 'bolder' || parseInt(fw, 10) >= 600;
    const ital = (st.fontStyle || '').toLowerCase() === 'italic';
    if (bold) { const b = document.createElement('b'); while (sp.firstChild) b.appendChild(sp.firstChild); sp.appendChild(b); }
    if (ital) { const i = document.createElement('i'); while (sp.firstChild) i.appendChild(sp.firstChild); sp.appendChild(i); }
    // (underline and strikethrough in a style are read by paraRuns)
  });
  // a break marker at every block edge and every line break
  const BREAK = '\uE000';
  // (a table's cells are paragraphs too: a letter or a sign set in a table
  // keeps its words)
  const blocks = 'p, div, li, h1, h2, h3, h4, h5, h6, blockquote, pre, section, article, header, footer, tr, td, th, dd, dt, caption';
  holder.querySelectorAll(blocks).forEach((b) => {
    b.before(document.createTextNode(BREAK));
    b.after(document.createTextNode(BREAK));
  });
  holder.querySelectorAll('br').forEach((br) => br.replaceWith(document.createTextNode(BREAK)));

  const paras = [[]];
  for (const r of paraRuns(holder.innerHTML)) {
    if (r.mark !== undefined) { paras[paras.length - 1].push(r); continue; }
    const pieces = r.text.split(BREAK);
    pieces.forEach((text, i) => {
      if (i > 0) paras.push([]);
      if (text) paras[paras.length - 1].push({ text, b: r.b, i: r.i, u: r.u, s: r.s });
    });
  }
  const filled = paras.map((runs) => runs.some((r) => r.mark === undefined && r.text.trim()));
  const out = paras.map((runs, n) => {
    // whitespace collapses like HTML's, and each paragraph is trimmed
    runs = runs.map((r) => (r.mark !== undefined ? r : { ...r, text: r.text.replace(/\s+/g, ' ') }));
    // (one space is kept where the clipboard's words meet the line's own,
    // mid-line: "the " + "big" + " dog" doesn't fuse into "thebigdog")
    const first = runs.find((r) => r.mark === undefined);
    const keepLead = dashes && n === filled.indexOf(true) && !dashes.start && !dashes.spaced;
    const keepTail = dashes && n === filled.lastIndexOf(true) && !dashes.end && !dashes.spacedAfter;
    if (first) first.text = first.text.replace(/^\s+/, keepLead && /^\s/.test(first.text) ? ' ' : '');
    const last = [...runs].reverse().find((r) => r.mark === undefined);
    if (last) last.text = last.text.replace(/\s+$/, keepTail && /\s$/.test(last.text) ? ' ' : '');
    if (dashes) {
      dashRuns(runs, dashes.style, {
        start: n !== filled.indexOf(true) || dashes.start,
        end: n !== filled.lastIndexOf(true) || dashes.end,
        spaced: n === filled.indexOf(true) && dashes.spaced
      });
    }
    const inner = runs.map((r) => {
      if (r.mark !== undefined) {
        // placeholder marks travel with their text; reconcileMarks pairs
        // each one back up with a note after the paste lands
        return r.mark
          ? `<span class="ph-mark" data-sid="${escHtml(r.mark)}" contenteditable="false">⚑</span>`
          : '';
      }
      if (!r.text) return '';
      return runHtml(r);
    }).join('');
    return inner.replace(/<[^>]+>/g, '').trim() ? '<p>' + inner + '</p>' : '';
  }).filter(Boolean);
  // single block pastes inline (no forced new paragraph)
  if (out.length === 1) return out[0].slice(3, -4);
  return out.join('');
}

// Em dash, ellipsis, smart quotes:
// Markdown emphasis, for writers whose fingers already know it: typing the
// closing * of *word* sets it in italic, the closing ** of **word** in bold
// (_word_ and __word__ too). Only in the manuscript and Notes, only when the
// marks hug a word the way Markdown wants them to, so 2 * 3, f***, a lone
// footnote * or a snake_case name stay as typed. ⌘Z right after gives the
// marks back as plain characters.
const escRe = (c) => c.replace(/\*/g, '\\*');
// Which emphasis the typed mark closes, if any, from the paragraph's text
// before the caret: ***word*** (bold italic), **word**, *word*. Nested
// emphasis is fine: **a *b* c** and *a **b** c* both close.
function mdEmphasisMatch(before, mark) {
  const m = escRe(mark);
  const edge = `(^|[^\\p{L}\\p{N}${m}\\\\])`;
  const inner = `(?!\\s|${m})(.*?[^\\s\\\\])`;
  const tries = [
    { open: 3, part: 2, bold: true, italic: true },
    { open: 2, part: 1, bold: true, italic: false },
    { open: 1, part: 0, bold: false, italic: true }
  ];
  for (const t of tries) {
    const r = before.match(new RegExp(`${edge}${m.repeat(t.open)}${inner}${m.repeat(t.part)}$`, 'u'));
    // the inner text must not end on the mark itself (that is a longer mark
    // still being typed), nor hold an emphasis opened but not yet closed
    // (in *a **b the next * closes **b, not *a)
    if (r && !r[2].endsWith(mark) && !(t.part === 0 && before.endsWith(mark)) && balancedRuns(r[2], mark)) {
      return { ...t, inner: r[2], start: before.length - (r[0].length - r[1].length) };
    }
  }
  return null;
}
function balancedRuns(text, mark) {
  const counts = {};
  for (const run of text.match(new RegExp(escRe(mark) + '+', 'g')) || []) counts[run.length] = (counts[run.length] || 0) + 1;
  return Object.values(counts).every((n) => n % 2 === 0);
}
// character offset within el → a (text node, offset) point
function pointAt(el, offset) {
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let n; let left = offset; let last = null;
  while ((n = walk.nextNode())) {
    if (left <= n.textContent.length) return { node: n, offset: left };
    left -= n.textContent.length;
    last = n;
  }
  return last ? { node: last, offset: last.textContent.length } : { node: el, offset: 0 };
}
function selectChars(el, from, to) {
  const a = pointAt(el, from); const b = pointAt(el, to);
  const r = document.createRange();
  r.setStart(a.node, a.offset);
  r.setEnd(b.node, b.offset);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
}
let mdJustSet = null; // what was just turned into styling, for ⌘Z
// ~~struck~~ as it's typed: the second closing ~ strikes the words through
function markdownStrike(e, body, range) {
  if (library && library.markdownOff) return false;
  if (e.key !== '~' || !range.collapsed) return false;
  if (!body.matches || !body.matches('.chapter-body, #aux-editor')) return false;
  const start = range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer.parentElement : range.startContainer;
  const block = (start && start.closest('p, div, li')) || body;
  if (!body.contains(block)) return false;
  const pre = document.createRange();
  pre.setStart(block, 0);
  pre.setEnd(range.startContainer, range.startOffset);
  const before = pre.toString();
  const m = before.match(/(^|[^~\\])~~(?![\s~])(.*?[^\s\\~])~$/u);
  if (!m) return false;
  e.preventDefault();
  const end = before.length;
  const at = end - m[0].length + m[1].length; // where the opening ~~ sits
  let steps = 0;
  selectChars(block, end - 1, end); document.execCommand('delete'); steps++;
  selectChars(block, at, at + 2); document.execCommand('delete'); steps++;
  const innerEnd = end - 3;
  selectChars(block, at, innerEnd);
  if (!document.queryCommandState('strikeThrough')) { document.execCommand('strikeThrough'); steps++; }
  selectChars(block, innerEnd, innerEnd);
  if (document.queryCommandState('strikeThrough')) document.execCommand('strikeThrough');
  mdJustSet = { steps, key: e.key, block, end: innerEnd + 3 };
  return true;
}
function markdownEmphasis(e, body, range) {
  if (markdownStrike(e, body, range)) return true;
  if (library && library.markdownOff) return false;
  if (e.key !== '*' && e.key !== '_') return false;
  if (!body.matches || !body.matches('.chapter-body, #aux-editor')) return false;
  if (!range.collapsed) return false;
  const start = range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer.parentElement : range.startContainer;
  const block = (start && start.closest('p, div, li')) || body;
  if (!body.contains(block)) return false;
  const pre = document.createRange();
  pre.setStart(block, 0);
  pre.setEnd(range.startContainer, range.startOffset);
  const before = pre.toString();
  const hit = mdEmphasisMatch(before, e.key);
  if (!hit) return false;
  e.preventDefault();
  let steps = 0;
  const end = before.length;
  // the part of the closing mark already typed, then the opening mark
  if (hit.part) { selectChars(block, end - hit.part, end); document.execCommand('delete'); steps++; }
  selectChars(block, hit.start, hit.start + hit.open);
  document.execCommand('delete'); steps++;
  // the words between them get the styling ⌘B and ⌘I give
  const innerEnd = end - hit.part - hit.open;
  const cmds = [hit.italic && 'italic', hit.bold && 'bold'].filter(Boolean);
  for (const cmd of cmds) {
    selectChars(block, hit.start, innerEnd);
    if (!document.queryCommandState(cmd)) { document.execCommand(cmd); steps++; }
  }
  selectChars(block, innerEnd, innerEnd);
  // what comes next is typed plain again
  for (const cmd of cmds) if (document.queryCommandState(cmd)) document.execCommand(cmd);
  mdJustSet = { steps, key: e.key, block, end };
  return true;
}
// a key pressed on its own on the way to a shortcut
const MODIFIER_KEYS = new Set(['Meta', 'Control', 'Shift', 'Alt', 'AltGraph', 'CapsLock', 'OS']);
// A pasted line of Markdown as HTML with <b> and <i>, or null when it has
// no emphasis (so ordinary text keeps pasting as text). Same rules as typing.
function markdownInline(line) {
  const edge = '(^|[^\\p{L}\\p{N}*_\\\\])';
  const tail = '(?![\\p{L}\\p{N}])';
  let html = escHtml(line);
  const before = html;
  html = html.replace(new RegExp(`${edge}(\\*\\*\\*|___)(?!\\s)(.+?)(?<![\\s\\\\])\\2${tail}`, 'gu'), '$1<b><i>$3</i></b>');
  html = html.replace(new RegExp(`${edge}(\\*\\*|__)(?!\\s)(.+?)(?<![\\s\\\\])\\2${tail}`, 'gu'), '$1<b>$3</b>');
  html = html.replace(new RegExp(`${edge}(\\*|_)(?![\\s*_])(.+?)(?<![\\s\\\\*_])\\2${tail}`, 'gu'), '$1<i>$3</i>');
  html = html.replace(/(^|[^~\\])~~(?![\s~])(.+?)(?<![\s\\~])~~(?!~)/gu, '$1<s>$2</s>');
  return html === before ? null : html;
}
// ⌘Z (Ctrl+Z) right after: the styling goes and the marks come back as typed
document.addEventListener('keydown', (e) => {
  if (MODIFIER_KEYS.has(e.key)) return; // the ⌘ or Ctrl of ⌘Z, on its way
  const just = mdJustSet;
  mdJustSet = null;
  if (!just || !(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || e.code !== 'KeyZ') return;
  e.preventDefault();
  e.stopPropagation();
  for (let i = 0; i < just.steps; i++) document.execCommand('undo');
  // the text is back as it was typed; the mark that was about to close it goes in
  if (just.block.isConnected) selectChars(just.block, just.end, just.end);
  document.execCommand('insertText', false, just.key);
}, true);

// Dialogue dashes as you type (see dialogueDashEdits): a hyphen turns once
// the key after it shows what it is. The key then goes on as usual, so a
// quote after the dash still opens or closes. The opening dash is the
// manuscript's only: Notes and Outline keep their "- " lists.
let dashJustSet = null; // the dash just set, for ⌘Z
function dialogueDashKey(e, body) {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.isComposing || e.keyCode === 229) return;
  const key = e.key === 'Enter' ? '' : e.key;
  if (key.length > 1) return;
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  if (!range.collapsed) return;
  const start = range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer.parentElement : range.startContainer;
  let block = start && start.closest('p, div, li');
  if (!block || !body.contains(block)) block = body;
  // a script's headings, names and transitions keep their hyphens (INT. HOUSE - DAY)
  if (block.matches('.sp-heading, .sp-character, .sp-transition, .sp-shot')) return;
  const pre = document.createRange();
  pre.setStart(block, 0);
  pre.setEnd(range.startContainer, range.startOffset);
  const before = pre.toString();
  // the hyphen opening the paragraph, or the one just behind the caret
  let from;
  if (/^-\s*$/.test(before) && body.matches('.chapter-body')) from = 0;
  else if (/\s-$/.test(before)) from = before.length - 2;
  else return;
  const edit = dialogueDashEdits(before.slice(from) + key, dashStyle(), { start: from === 0, end: !key })[0];
  if (!edit) return;
  const at = from + edit.at;
  selectChars(block, at, at + edit.from.length);
  document.execCommand('insertText', false, edit.to);
  if (key) dashJustSet = { block, at, was: edit.from, to: edit.to, key };
}
// ⌘Z (Ctrl+Z) right after: the hyphen comes back as typed
document.addEventListener('keydown', (e) => {
  if (MODIFIER_KEYS.has(e.key)) return; // the ⌘ or Ctrl of ⌘Z, on its way
  const just = dashJustSet;
  dashJustSet = null;
  if (!just || !(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || e.code !== 'KeyZ' || !just.block.isConnected) return;
  e.preventDefault();
  e.stopPropagation();
  selectChars(just.block, just.at, just.at + just.to.length);
  document.execCommand('insertText', false, just.was);
  const caret = just.at + just.was.length + just.key.length;
  selectChars(just.block, caret, caret);
}, true);

// Swap the last n typed characters for text. They are selected and typed
// over, so the new text takes their styling: deleting them first leaves the
// caret in whatever sits before them, and after an italic word the dash
// (and everything typed after it) would come out italic.
function replaceBefore(n, text) {
  const sel = window.getSelection();
  for (let i = 0; i < n; i++) sel.modify('extend', 'backward', 'character');
  document.execCommand('insertText', false, text);
}

// Capitals as you type, in the manuscript: a sentence's first letter (at a
// paragraph's start, or after a full stop that isn't an ellipsis or an
// abbreviation; the same rules as capitalSlips) and, in English, "i" on its
// own. ⌘Z (Ctrl+Z) right after keeps the lowercase. Poetry is left alone.
let capJustSet = null; // the capital just set, for ⌘Z
function autoCapKey(e, body) {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.isComposing || e.keyCode === 229) return;
  if (e.key.length !== 1 || !body.matches('.chapter-body')) return;
  const sel = window.getSelection();
  if (!sel.rangeCount || !sel.getRangeAt(0).collapsed) return;
  const range = sel.getRangeAt(0);
  const start = range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer.parentElement : range.startContainer;
  const block = start && start.closest('p');
  if (!block || !body.contains(block) || block.matches('.poetry, .scene-break, .sp-paren')) return;
  const pre = document.createRange();
  pre.setStart(block, 0);
  pre.setEnd(range.startContainer, range.startOffset);
  const before = pre.toString();
  const lang = writingLanguage();
  // a lowercase letter where a sentence starts
  if (e.key !== e.key.toLocaleUpperCase(lang) && /\p{L}/u.test(e.key)) {
    let starts = /^[\s"'“‘„«»(\[¿¡—–-]*$/.test(before);
    if (!starts && /(?<!\.)\.\s+["'“‘„«(\[]?$/.test(before)) {
      const word = (before.replace(/\.\s+["'“‘„«(\[]?$/, '.').match(/([\p{L}.]+)\.$/u) || [])[1] || '';
      starts = !CAPS_ABBREV.has(word.toLowerCase()) && !/^\p{L}$/u.test(word);
    }
    if (!starts) return;
    e.preventDefault();
    const to = e.key.toLocaleUpperCase(lang);
    document.execCommand('insertText', false, to);
    capJustSet = { block, at: before.length, was: e.key, to, key: '' };
    return;
  }
  // English: "i" standing alone becomes "I" once the next key shows it is
  // a word (a space, punctuation, an apostrophe), and the key goes on as usual
  if (/^en\b/.test(lang) && /^[\s,;:!?'’")”\]—–-]$/.test(e.key) && /(?:^|[^\p{L}\p{M}\d'’.(-])i$/u.test(before)) {
    const at = before.length - 1;
    selectChars(block, at, at + 1);
    document.execCommand('insertText', false, 'I');
    capJustSet = { block, at, was: 'i', to: 'I', key: e.key };
  }
}
// ⌘Z (Ctrl+Z) right after: the lowercase comes back as typed
document.addEventListener('keydown', (e) => {
  if (MODIFIER_KEYS.has(e.key)) return; // the ⌘ or Ctrl of ⌘Z, on its way
  const just = capJustSet;
  capJustSet = null;
  if (!just || !(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || e.code !== 'KeyZ' || !just.block.isConnected) return;
  e.preventDefault();
  e.stopPropagation();
  selectChars(just.block, just.at, just.at + 1);
  document.execCommand('insertText', false, just.was);
  // a key typed after the "i" stays, with the caret past it
  const caret = just.at + 1 + just.key.length;
  selectChars(just.block, caret, caret);
}, true);

function smartKeys(e, body) {
  // a field can reach smartKeys twice (its own handler and the page-wide
  // one below): the first pass wins
  if (e.defaultPrevented) return;
  dialogueDashKey(e, body);
  autoCapKey(e, body);
  if (e.defaultPrevented) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.isComposing || e.keyCode === 229) return;

  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const range = sel.getRangeAt(0);

  const prevChars = (n) => {
    if (!range.collapsed) return '';
    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE) return '';
    return node.textContent.slice(Math.max(0, range.startOffset - n), range.startOffset);
  };

  if (markdownEmphasis(e, body, range)) return;
  // German sets its dash as an en dash – like this –, so there -- makes
  // one, and a third hyphen the em dash (#286)
  const german = writingLanguage().toLowerCase().startsWith('de');
  if (e.key === '-' && prevChars(1) === '-') {
    e.preventDefault();
    replaceBefore(1, german ? '–' : '—');
    return;
  }
  if (german && e.key === '-' && prevChars(1) === '–') {
    e.preventDefault();
    replaceBefore(1, '—');
    return;
  }
  if (e.key === '.' && prevChars(2) === '..') {
    e.preventDefault();
    replaceBefore(2, '…'); // …
    return;
  }
  const french = frenchTypography();
  // French: a narrow no-break space (U+202F) before ; : ! ? replaces the
  // ordinary space typed ahead of them. (The wider U+00A0 is not used: the
  // editing engine turns it back into a plain space, and NEO heals it away.)
  // Quebec usage (OQLF) keeps the space before the colon only.
  const spaced = french === 'ca' ? /^:$/ : /^[;:!?]$/;
  if (french && spaced.test(e.key) && /^[ \u00a0]$/.test(prevChars(1))) {
    e.preventDefault();
    document.execCommand('delete');
    document.execCommand('insertText', false, '\u202f' + e.key);
    return;
  }
  if (e.key === '"' || e.key === "'") {
    e.preventDefault();
    const before = prevChars(1);
    const q = e.key === '"' ? bookQuotes(body) : quoteStyle();
    let opening = before === '' || /[\s\(\[\{‘“«„‚»›‹>]/.test(before);
    // after a dash, a quote usually closes speech that was cut off ("I was
    // just—"); it opens one only when no quotation is open in the paragraph
    if (before === '—' || before === '–') opening = !quoteIsOpen(range, e.key === '"' ? q : { open: '‘', close: '’' }, e.key === '"' ? '"' : '');
    let ch;
    if (e.key === "'") {
      // most languages type ' as an apostrophe only; English, Dutch and
      // German also open (and German closes) single quotes with it
      const sq = singleQuotes(body);
      if (!sq) ch = '’';
      else if (opening) ch = sq.open;
      // German's closing mark isn't its apostrophe: it closes only a single
      // quotation that is open in the paragraph
      else if (sq.close !== '’' && quoteIsOpen(range, sq, '')) ch = sq.close;
      else ch = '’';
    } else {
      ch = opening ? q.open : q.close;
    }
    document.execCommand('insertText', false, ch);
  }
}

// Is a quotation open at the caret, in the paragraph so far?
function quoteIsOpen(range, q, straight) {
  let el = range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer.parentElement : range.startContainer;
  const block = el && el.closest ? el.closest('p, div') : null;
  if (!block) return false;
  const pre = document.createRange();
  pre.selectNodeContents(block);
  try { pre.setEnd(range.startContainer, range.startOffset); } catch { return false; }
  return quoteOpenIn(pre.toString(), q, straight);
}
// The count itself: opening marks against closing ones; an apostrophe (’
// between two letters) is no quote. Straight marks ("), which text imported
// or pasted from a plain-text editor arrives with, have no side of their
// own: they pair up in turn, so an odd one out is an open quotation.
function quoteOpenIn(text, q, straight = '') {
  const open = q.open.trim();
  const close = q.close.trim();
  let depth = 0;
  let straights = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (straight && c === straight) straights++;
    else if (c === open && open === close) depth = depth ? 0 : 1;
    else if (c === open) depth++;
    else if (c === close) {
      if (close === '’' && /\p{L}/u.test(text[i - 1] || '') && /\p{L}/u.test(text[i + 1] || '')) continue;
      depth = Math.max(0, depth - 1);
    }
  }
  return depth > 0 || straights % 2 === 1;
}

// The quotation marks of the language being written: the spellcheck
// language when one is set, otherwise NEO's own language.
const QUOTE_STYLES = {
  en: { open: '“', close: '”', singles: true },
  nl: { open: '“', close: '”', singles: true },
  pt: { open: '“', close: '”', singles: true },          // Brazil
  'pt-PT': { open: '«', close: '»' },
  fr: { open: '«\u202f', close: '\u202f»' },             // narrow no-break spaces inside
  es: { open: '«', close: '»' },                          // RAE: « » first
  it: { open: '«', close: '»' },
  de: { open: '»', close: '«' },                          // novels: »…« (#353); a book in „…“ keeps it (bookQuotes)
  'de-CH': { open: '«', close: '»' },                     // Swiss: «…»
  pl: { open: '„', close: '”' },
  ro: { open: '„', close: '”' },
  ru: { open: '«', close: '»' },
  el: { open: '«', close: '»' },
  hu: { open: '„', close: '”' },
  sv: { open: '”', close: '”' }
};
// The single quotation marks, where ' types them: English and Dutch ‘…’;
// German ‚…‘, or ›…‹ in a book set in »…«, or ‹…› in Swiss «…» (#286).
// Elsewhere ' is an apostrophe only.
function singleQuotes(el) {
  const q = quoteStyle();
  if (q.singles) return { open: '‘', close: '’' };
  if (!writingLanguage().toLowerCase().startsWith('de')) return null;
  const d = bookQuotes(el).open.trim();
  if (d === '»') return { open: '›', close: '‹' };
  if (d === '«') return { open: '‹', close: '›' };
  return { open: '‚', close: '‘' };
}
function writingLanguage() {
  return (library && library.spellLanguage) || NeoI18n.getLocale();
}
function quoteStyle() {
  const code = writingLanguage();
  return QUOTE_STYLES[code] || QUOTE_STYLES[code.split('-')[0]] || QUOTE_STYLES.en;
}
// …unless the book has settled on guillemets its language doesn't use:
// German novels often set »…« where the language says „…“, Swiss writing
// «…». Whichever mark opens the most quotes wins — in this chapter, or in
// the book when the chapter has none yet — so a » typed by hand once is
// enough to carry on in that style.
function bookQuotes(el) {
  const q = quoteStyle();
  const opens = (text) => {
    const n = (re) => (text.match(re) || []).length;
    const own = q.open.trim();
    return { '»': own === '»' ? 0 : n(/»(?=[\p{L}\p{N}])/gu), '«': own === '«' ? 0 : n(/«(?=[\p{L}\p{N}])/gu), '„': own === '„' ? 0 : n(/„(?=[\p{L}\p{N}])/gu), own: n(new RegExp(own + '\\s?(?=[\\p{L}\\p{N}])', 'gu')) };
  };
  const body = el && el.closest ? el.closest('.chapter-body') : null;
  let c = opens(body ? body.textContent : '');
  if (!c['»'] && !c['«'] && !c['„'] && !c.own && book) c = opens(book.chapterOrder.map((id) => chapterHTML[id] || '').join(' '));
  // a German book already written in „…“ keeps its marks
  if (c['„'] > c.own && c['„'] >= c['»'] && c['„'] >= c['«'] && writingLanguage().toLowerCase().startsWith('de')) return { open: '„', close: '“' };
  if (c['»'] > c.own && c['»'] >= c['«']) return { open: '»', close: writingLanguage().split('-')[0] === 'sv' ? '»' : '«' };
  if (c['«'] > c.own && c['«'] > c['»']) return { open: '«', close: '»' };
  return q;
}

// A hyphen standing on its own is a dash the keyboard didn't have. At the
// start of a paragraph it opens speech, spaced the way the language sets
// dialogue (— Olá, —Hola; elsewhere as typed). After a space, with a space,
// a closing quote, punctuation or the paragraph's end behind it, it becomes
// the language's dash and the spaces stay as typed. Hyphens in words
// (guarda-chuva), suspended ones (pré- e pós-), and those before a digit
// (-5) or a suffix (-mente) stay hyphens.
const DIALOGUE_DASHES = {
  pt: { open: '—', space: ' ', mid: '—' },   // — Olá — diz ela.
  ru: { open: '—', space: ' ', mid: '—' },
  hu: { open: '–', space: ' ', mid: '–' },   // – Szia – mondta.
  es: { open: '—', space: '', mid: '—' },    // —Hola —dijo él—.
  en: { open: '—', mid: '–' }                // and every other language: word – word
};
const DASH_OPEN = /^-(?:(\s+)(?=[^\s-])|(?=[^\s\d-]))/u;
// (a quote typed right after the hyphen closes whatever comes next)
const DASH_MID = /(?<=\s)-(?=["'“”‘’«»„]*(?:[\s.,;:!?…)\]]|$)|["'“”‘’«»„]+\uE000)/gu;
// The changes, as { at, from, to }. start / end: whether the text begins or
// ends its paragraph (a fragment pasted mid-sentence does neither); spaced:
// whether a space comes before it.
function dialogueDashEdits(text, style, { start = true, end = true, spaced = false } = {}) {
  // a scene break, or a paragraph of nothing but dashes
  if (start && end && /^[\s*#•~⁂—–-]*$/.test(text)) return [];
  const edits = [];
  const open = start && text.match(DASH_OPEN);
  if (open) edits.push({ at: 0, from: open[0], to: style.open + (style.space !== undefined ? style.space : open[1] || '') });
  // past the end of a fragment, anything could follow
  const lead = !start && spaced ? ' ' : '';
  const probe = lead + text + (end ? '' : '\uE000');
  for (const m of probe.matchAll(DASH_MID)) edits.push({ at: m.index - lead.length, from: '-', to: style.mid });
  return edits;
}
function dialogueDashes(text, style, edges) {
  return dialogueDashEdits(text, style, edges).reduceRight(
    (s, e) => s.slice(0, e.at) + e.to + s.slice(e.at + e.from.length), text);
}
// The same across a pasted paragraph's runs of bold and italic: each change
// lands in the run that holds it
function dashRuns(runs, style, edges) {
  const texts = runs.filter((r) => r.mark === undefined);
  const edits = dialogueDashEdits(texts.map((r) => r.text).join(''), style, edges);
  for (const e of edits.reverse()) {
    let pos = 0;
    for (const r of texts) {
      if (e.at >= pos && e.at + e.from.length <= pos + r.text.length) {
        r.text = r.text.slice(0, e.at - pos) + e.to + r.text.slice(e.at - pos + e.from.length);
        break;
      }
      pos += r.text.length;
    }
  }
}
function dashStyle() {
  const code = writingLanguage();
  return DIALOGUE_DASHES[code] || DIALOGUE_DASHES[code.split('-')[0]] || DIALOGUE_DASHES.en;
}

// French typographic rules apply when the book is spellchecked in French,
// or when NEO itself speaks French. Returns false, 'fr', or 'ca' for Quebec
// usage (when the interface is set to Canadian French).
function frenchTypography() {
  if (!writingLanguage().startsWith('fr')) return false;
  return /^fr-CA$/i.test(NeoI18n.getLocale()) ? 'ca' : 'fr';
}

// ⌥⌘→ / ⌥⌘← (Ctrl+Alt on Windows and Linux): the next or previous tab,
// Manuscript → Notes → Outline → Darlings, round again. Caught here, like the
// chapter keys, so no menu accelerator flashes the menu or takes AltGr input.
function goToTab(name) {
  if (!book || $('#editor-view').hidden || name === currentTab) return;
  if (document.querySelector('.modal-backdrop:not([hidden])')) return;
  switchTab(name);
}
const TAB_ORDER = ['manuscript', 'notes', 'outline', 'darlings'];
window.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
  const cmd = IS_POCKET ? (e.metaKey !== e.ctrlKey) : (IS_MAC ? e.metaKey : e.ctrlKey);
  if (!cmd || !e.altKey || e.shiftKey || e.isComposing) return;
  if ($('#editor-view').hidden || document.querySelector('.modal-backdrop:not([hidden])')) return;
  e.preventDefault();
  e.stopPropagation();
  const step = e.key === 'ArrowRight' ? 1 : TAB_ORDER.length - 1;
  goToTab(TAB_ORDER[(TAB_ORDER.indexOf(currentTab) + step) % TAB_ORDER.length]);
}, true);

// Titles, outline lines, notes and shelf names get the same typography as
// the manuscript (which calls smartKeys itself). Capture phase, because
// those fields keep their keystrokes from bubbling to the page.
document.addEventListener('keydown', (e) => {
  const el = e.target;
  if (e.defaultPrevented || !el || !el.isContentEditable || el.closest('.chapter-body')) return;
  smartKeys(e, el);
}, true);

// Title page: Enter drops you into Chapter One.
$('#tp-title').addEventListener('keydown', titleEnter);
$('#tp-subtitle').addEventListener('keydown', titleEnter);
// the author's line too: a new book's first page used to wait for a trip
// to the Outline when Enter came from here
$('#tp-author').addEventListener('keydown', titleEnter);
function titleEnter(e) {
  if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229) return;
  e.preventDefault();
  // into the story, past any pages that come before it
  const first = book.chapterOrder.find((c) => isStory(c));
  if (first) focusChapter(first);
  else focusChapter(createChapterAt(storyEnd()));
}
// A script's title is set in bold, underline or italic as a whole (⌘B, ⌘U,
// ⌘I on the title page), kept as book.titleStyle and carried into the PDF,
// Fountain and Final Draft. A book's title page is designed by its exports.
$('#tp-title').addEventListener('keydown', (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
  const k = ({ KeyB: 'b', KeyU: 'u', KeyI: 'i' })[e.code];
  if (!k) return;
  e.preventDefault();
  if (!book || !isScript()) return;
  const st = { ...(book.titleStyle || {}) };
  if (st[k]) delete st[k]; else st[k] = true;
  if (Object.keys(st).length) book.titleStyle = st; else delete book.titleStyle;
  showTitleStyle();
  scheduleMetaSave();
}, true);
function showTitleStyle() {
  const st = (book && isScript() && book.titleStyle) || {};
  const el = $('#tp-title');
  el.classList.toggle('tp-b', !!st.b);
  el.classList.toggle('tp-u', !!st.u);
  el.classList.toggle('tp-i', !!st.i);
}
$('#tp-title').addEventListener('input', () => {
  book.title = $('#tp-title').textContent.trim() || t('Untitled');
  showWindowTitle();
  scheduleMetaSave();
});
$('#tp-subtitle').addEventListener('input', () => {
  book.subtitle = $('#tp-subtitle').textContent.trim();
  scheduleMetaSave();
});
// each book can carry its own pen name
$('#tp-author').addEventListener('input', () => {
  book.author = $('#tp-author').textContent.trim();
  scheduleMetaSave();
});

// Which logical shortcut a keyboard event means.
//
// Matched by the CHARACTER the key types, not the position it sits at: the help
// overlay names characters (⌘/), and a character is what a menu accelerator can
// name. A physical fallback catches the layouts where that character needs a
// modifier the accelerator cannot spell — on Swiss German `/` is Shift+7 and
// `;` is Shift+`,`, and on German `ö` sits on the `;` key — and every fallback
// skips the character the menu already handles, so one press fires one action.
function isSpellcheckShortcut(e) {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return false;
  // the menu shows ⌘; but leaves the key to the window (main.js), so the
  // character itself, Shift or not, is the shortcut
  if (e.key === ';') return true;
  return e.code === 'Semicolon' && ![';', ':', '/', '?'].includes(e.key);
}
function isLargerTextShortcut(e) {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return false;
  return e.key === '+' || e.key === '=' || e.code === 'NumpadAdd';
}
function isSmallerTextShortcut(e) {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return false;
  return e.key === '-' || e.code === 'NumpadSubtract';
}
function isHelpShortcut(e) {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return false;
  return e.key === '/' || e.key === '?';
}

// Global editor shortcuts
document.addEventListener('keydown', (e) => {
  if ($('#editor-view').hidden) return;
  if (document.querySelector('.modal-backdrop:not([hidden])')) return; // visible modals own the keyboard
  const cmd = e.metaKey || e.ctrlKey;
  if (cmd && e.shiftKey && e.code === 'KeyX') {
    e.preventDefault();
    if (currentTab === 'manuscript') insertPlaceholder();
  }
  if (cmd && e.shiftKey && e.code === 'KeyD') {
    e.preventDefault();
    if (currentTab === 'manuscript') darlingFromKeyboard();
  }
  // ⌘S takes a snapshot of the book (SNAPSHOTS)
  if (cmd && !e.altKey && !e.shiftKey && (e.code === 'KeyS' || e.key === 's')) {
    e.preventDefault();
    snapshotNow();
  }
  if (isSpellcheckShortcut(e)) {
    e.preventDefault();
    toggleSpellcheck();
  }
  // The text-size pair keeps the menu's own keys on the layouts where they
  // match, and takes over by character where they do not (`+` is Shift+1 on
  // Swiss German, so CmdOrCtrl-Plus never fires there).
  if (isLargerTextShortcut(e)) {
    e.preventDefault();
    void setEditorFontSize(1);
  }
  if (isSmallerTextShortcut(e)) {
    e.preventDefault();
    void setEditorFontSize(-1);
  }
  if (e.key === 'Escape') {
    // an input method's Esc cancels its own composition, nothing more
    if (e.isComposing || e.keyCode === 229) return;
    // an open spelling menu closes; the book stays open
    const spellMenu = document.querySelector('.spell-menu');
    if (spellMenu) { e.preventDefault(); spellMenu.remove(); return; }
    // from the find bar's buttons too (the arrows take the focus when
    // clicked): back to the page. Typing on the page with the bar still
    // open, Esc only closes the bar and leaves the caret where it is.
    const inBar = !document.activeElement || document.activeElement === document.body || $('#searchbar').contains(document.activeElement);
    if (!$('#searchbar').hidden) { if (inBar) returnFromSearch(); else closeSearch(); }
    else window.neo.fullscreenEscape().then((exited) => { if (!exited) backToShelf(); });
  }
});

// The help character works on every layout, editor or shelf: ⌘/ needs Shift+7
// on Swiss German, which the bare-character accelerator cannot name, so the
// renderer catches the character the layout produced.
document.addEventListener('keydown', (e) => {
  if (!isHelpShortcut(e)) return;
  e.preventDefault();
  showHelp();
});

// ⌥⌘↓ / ⌥⌘↑ (Ctrl+Alt on Windows and Linux): next or previous chapter.
// No menu item carries these any more, so the window catches them itself —
// first, before the page or the outline can read them as plain arrows.
// Pocket takes both: a keyboard paired with a phone or an iPad may be a
// Mac's (⌘ arrives as Meta) or a PC's (Ctrl).
// Off the Mac, Ctrl+Page Down / Ctrl+Page Up do the same: GNOME keeps
// Ctrl+Alt+↑↓ for switching workspaces, so NEO never hears them there, and
// some Windows graphics drivers turn the screen with them (#254).
window.addEventListener('keydown', (e) => {
  const arrows = e.key === 'ArrowDown' || e.key === 'ArrowUp';
  const pages = e.key === 'PageDown' || e.key === 'PageUp';
  if (!arrows && !pages) return;
  const cmd = IS_POCKET ? (e.metaKey !== e.ctrlKey) : (IS_MAC ? e.metaKey : e.ctrlKey);
  if (arrows && (!cmd || !e.altKey || e.shiftKey)) return;
  if (pages && ((IS_MAC && !IS_POCKET) || !e.ctrlKey || e.metaKey || e.altKey || e.shiftKey)) return;
  if ($('#editor-view').hidden || document.querySelector('.modal-backdrop:not([hidden])')) return;
  e.preventDefault();
  e.stopPropagation();
  gotoChapter(e.key === 'ArrowDown' || e.key === 'PageDown' ? 1 : -1);
}, true);

/* ------------------------------------------------------------------ */
/*  Vim keys (View → Vim Keys, off unless chosen)                      */
/*                                                                      */
/*  The small part of vim that writers use to move around a page. Esc   */
/*  puts the page in moving mode (the caret turns gold), and a book     */
/*  opens in it; letters then                                           */
/*  move instead of type, and i, a, o and friends go back to writing.   */
/*  Esc while moving stays put, as in vim. Keys with ⌘ or Ctrl keep     */
/*  their usual jobs, so none of NEO's shortcuts change.                */
/*                                                                      */
/*    h j k l   left, down, up, right      w b e   by word              */
/*    0 ^ $     start / end of the line    ( )     by sentence          */
/*    { }       by paragraph               gg G    top / end of chapter */
/*    [[ ]]     previous / next chapter    Ctrl-d Ctrl-u  half a screen */
/*    i a I A   write here / after / at the start / at the end of line   */
/*    o O       new paragraph below / above                             */
/*    v         select: motions stretch it, y copies, d or x cuts       */
/*    x         delete the letter under the caret                       */
/*    /         find (Esc goes back to moving, at the match)            */
/*    n N       next / previous match    a number first repeats: 3w     */
/* ------------------------------------------------------------------ */
let vimEnabled = false;
let vimNav = false;        // moving, not typing
let vimVisual = false;     // v: motions stretch the selection
let vimCount = '';
let vimPending = '';       // the g of gg, the [ of [[
function applyVim() {
  if (!vimEnabled) { vimNav = false; vimVisual = false; }
  document.body.classList.toggle('vim-nav', vimNav);
  if (window.neo.vimState) window.neo.vimState(vimEnabled); // the View menu's tick
}
function toggleVim() {
  vimEnabled = !vimEnabled;
  library.vimKeys = vimEnabled;
  writeLibrary(library);
  applyVim();
  toast(vimEnabled ? t('Vim keys on — Esc to move, i to write') : t('Vim keys off'));
}
const vimEditor = (el) => el && el.closest && el.closest('.chapter-body, #aux-editor');
// With vim keys on, the page rests in moving mode, as vim starts: a book
// opens that way, and so does the Manuscript or Notes tab when you come back
// to it (#257). i, a or o to write. A click, a title's Enter or the window
// coming back to the front leave the mode as it was.
function vimRest() {
  if (vimEnabled && vimEditor(document.activeElement)) vimSetNav(true);
}
function vimSetNav(on) {
  vimNav = on;
  vimVisual = false;
  vimCount = '';
  vimPending = '';
  if (!on) { const s = window.getSelection(); if (s.rangeCount && !s.isCollapsed) s.collapseToEnd(); }
  applyVim();
}
// the paragraph the caret is in, and the text on either side of it there
function vimBlock() {
  const s = window.getSelection();
  if (!s.rangeCount) return null;
  let n = s.focusNode;
  if (n && n.nodeType === Node.TEXT_NODE) n = n.parentElement;
  const p = n && n.closest && n.closest('p, li, div.chapter-body, #aux-editor');
  return p || null;
}
function vimAround() {
  const s = window.getSelection();
  const block = vimBlock();
  if (!block || !s.rangeCount) return { before: '', after: '' };
  const r = document.createRange();
  r.selectNodeContents(block);
  const b = r.cloneRange();
  b.setEnd(s.focusNode, s.focusOffset);
  const a = r.cloneRange();
  a.setStart(s.focusNode, s.focusOffset);
  return { before: b.toString(), after: a.toString() };
}
const vimClass = (c) => (!c || /\s/.test(c) ? 0 : /[\p{L}\p{M}\p{N}_'’]/u.test(c) ? 1 : 2);
function vimMove(dir, unit, times = 1) {
  const s = window.getSelection();
  for (let i = 0; i < times; i++) s.modify(vimVisual ? 'extend' : 'move', dir, unit);
}
// w, b, e as vim counts them: letters, then punctuation, are words; space isn't
function vimWord(key) {
  const { before, after } = vimAround();
  const chars = [...(key === 'b' ? before : after)];
  let n = 0;
  if (key === 'w') {
    const start = vimClass(chars[0]);
    while (n < chars.length && start && vimClass(chars[n]) === start) n++;
    while (n < chars.length && vimClass(chars[n]) === 0) n++;
    if (n >= chars.length) { vimMove('forward', 'paragraphboundary'); vimMove('forward', 'character'); return; }
  } else if (key === 'e') {
    n = 1;
    while (n < chars.length && vimClass(chars[n]) === 0) n++;
    const cls = vimClass(chars[n]);
    while (n + 1 < chars.length && vimClass(chars[n + 1]) === cls) n++;
    if (n >= chars.length) { vimMove('forward', 'paragraphboundary'); return; }
  } else {
    chars.reverse();
    while (n < chars.length && vimClass(chars[n]) === 0) n++;
    const cls = vimClass(chars[n]);
    while (n < chars.length && cls && vimClass(chars[n]) === cls) n++;
    if (!chars.length) { vimMove('backward', 'character'); vimMove('backward', 'paragraphboundary'); return; }
  }
  vimMove(key === 'b' ? 'backward' : 'forward', 'character', n);
}
// a line or paragraph move that can't go further steps into the next chapter
function vimLine(dir, unit) {
  const s = window.getSelection();
  const at = s.rangeCount ? [s.focusNode, s.focusOffset] : null;
  vimMove(dir, unit);
  if (vimVisual || !at || s.focusNode !== at[0] || s.focusOffset !== at[1]) return;
  const ed = vimEditor(document.activeElement);
  if (!ed || !ed.classList.contains('chapter-body')) return;
  const order = book.chapterOrder;
  const i = order.indexOf(currentChapterId) + (dir === 'forward' ? 1 : -1);
  if (i < 0 || i >= order.length) return;
  if (dir === 'forward') focusChapterStart(order[i]);
  else {
    const nb = document.querySelector(`.chapter[data-id="${order[i]}"] .chapter-body`);
    if (!nb || !nb.isContentEditable) return;
    nb.focus({ preventScroll: true });
    const r = document.createRange();
    r.selectNodeContents(nb);
    r.collapse(false);
    s.removeAllRanges();
    s.addRange(r);
    currentChapterId = order[i];
    highlightNav();
  }
  revealCaret();
}
// vim's selections take in the letter under the caret, too
function vimInclusive() {
  const s = window.getSelection();
  if (!s.rangeCount || s.isCollapsed) return;
  const r = document.createRange();
  r.setStart(s.anchorNode, s.anchorOffset);
  r.setEnd(s.focusNode, s.focusOffset);
  if (!r.collapsed) s.modify('extend', 'forward', 'character'); // anchor first: a forward selection
}
function vimHalfPage(dir) {
  const sc = $('#paper-scroll');
  if (!sc || currentTab !== 'manuscript') return;
  const box = sc.getBoundingClientRect();
  sc.scrollTop += dir * sc.clientHeight / 2;
  // the caret follows to the same place on the screen
  const r = document.caretRangeFromPoint(box.left + box.width / 2, box.top + box.height / 2);
  const ed = r && vimEditor(r.startContainer.nodeType === Node.TEXT_NODE ? r.startContainer.parentElement : r.startContainer);
  if (!ed) return;
  ed.focus({ preventScroll: true });
  const s = window.getSelection();
  s.removeAllRanges();
  s.addRange(r);
}
// n and N: the next or previous place the last search found, from the caret,
// round to the top (or bottom) when the tab runs out, as vim does
function vimSearchAgain(dir, times = 1) {
  const s = window.getSelection();
  const found = findRanges($('#search-input').value);
  if (!found.length || !s.rangeCount) return;
  const here = s.getRangeAt(0);
  // the first match past the caret (or the last one before it)
  let i = dir > 0
    ? found.findIndex((r) => r.compareBoundaryPoints(Range.START_TO_START, here) > 0)
    : found.findLastIndex((r) => r.compareBoundaryPoints(Range.START_TO_START, here) < 0);
  if (i < 0) i = dir > 0 ? 0 : found.length - 1;
  i = (((i + dir * (times - 1)) % found.length) + found.length) % found.length;
  const r = found[i];
  const ed = editableOf(r);
  if (!ed) return;
  if (vimVisual && ed.contains(s.anchorNode)) { s.extend(r.startContainer, r.startOffset); return; }
  if (document.activeElement !== ed) ed.focus({ preventScroll: true });
  r.collapse(true);
  s.removeAllRanges();
  s.addRange(r);
}
// Moving, a key counts by where it sits on the keyboard, named as on a US
// one, whatever layout is on: on Russian or Greek the key under the right
// index finger is still j, and Shift+4 is still $. A dead key, and a key an
// input method takes (Process), count by their place too.
const VIM_US = {
  Space: [' ', ' '], Minus: ['-', '_'], Equal: ['=', '+'], BracketLeft: ['[', '{'], BracketRight: [']', '}'],
  Backslash: ['\\', '|'], Semicolon: [';', ':'], Quote: ["'", '"'], Backquote: ['`', '~'],
  Comma: [',', '<'], Period: ['.', '>'], Slash: ['/', '?']
};
for (const c of 'abcdefghijklmnopqrstuvwxyz') VIM_US['Key' + c.toUpperCase()] = [c, c.toUpperCase()];
[...')!@#$%^&*('].forEach((shifted, d) => { VIM_US['Digit' + d] = [String(d), shifted]; });
function vimKeyOf(e) {
  const us = VIM_US[e.code];
  if (!us || (e.key.length > 1 && e.key !== 'Dead' && e.key !== 'Process')) return e.key;
  const caps = /^Key/.test(e.code) && e.getModifierState('CapsLock');
  return us[e.shiftKey !== caps ? 1 : 0];
}
function vimKey(e) {
  const k = vimKeyOf(e);
  // counts: 3w, 12j (a 0 on its own is the start of the line)
  if (/^[0-9]$/.test(k) && (k !== '0' || vimCount)) { vimCount += k; return; }
  const times = Math.max(1, Math.min(999, parseInt(vimCount || '1', 10)));
  vimCount = '';
  const pending = vimPending;
  vimPending = '';
  if (pending === 'g') { if (k === 'g') vimMove('backward', 'documentboundary'); revealCaret(); return; }
  if (pending === '[' || pending === ']') {
    if (k === pending) gotoChapter(k === ']' ? times : -times);
    return;
  }
  const back = 'backward', fwd = 'forward';
  switch (k) {
    case 'h': case 'Backspace': vimMove(back, 'character', times); break;
    case 'l': case ' ': vimMove(fwd, 'character', times); break;
    case 'j': case 'Enter': for (let i = 0; i < times; i++) vimLine(fwd, 'line'); break;
    case 'k': for (let i = 0; i < times; i++) vimLine(back, 'line'); break;
    case 'w': case 'b': case 'e': for (let i = 0; i < times; i++) vimWord(k); break;
    case '0': case '^': vimMove(back, 'lineboundary'); break;
    case '$': vimMove(fwd, 'lineboundary'); break;
    case '(': vimMove(back, 'sentence', times); break;
    case ')': vimMove(fwd, 'sentence', times); break;
    case '{': for (let i = 0; i < times; i++) vimLine(back, 'paragraph'); break;
    case '}': for (let i = 0; i < times; i++) vimLine(fwd, 'paragraph'); break;
    case 'G': vimMove(fwd, 'documentboundary'); break;
    case 'g': case '[': case ']': vimPending = k; return;
    case 'v': {
      vimVisual = !vimVisual;
      if (!vimVisual) window.getSelection().collapseToEnd();
      break;
    }
    case 'y':
      if (vimVisual) { vimInclusive(); document.execCommand('copy'); vimVisual = false; window.getSelection().collapseToStart(); }
      break;
    case 'd': case 'x': case 'Delete':
      if (vimVisual) { vimInclusive(); document.execCommand('cut'); vimVisual = false; }
      else if (k !== 'd') for (let i = 0; i < times; i++) document.execCommand('forwardDelete');
      break;
    case 'i': vimSetNav(false); break;
    case 'a': vimSetNav(false); vimMove(fwd, 'character'); break;
    case 'I': vimSetNav(false); vimMove(back, 'lineboundary'); break;
    case 'A': vimSetNav(false); vimMove(fwd, 'lineboundary'); break;
    case 'o': vimSetNav(false); vimMove(fwd, 'paragraphboundary'); document.execCommand('insertParagraph'); break;
    case 'O':
      vimSetNav(false);
      vimMove(back, 'paragraphboundary');
      document.execCommand('insertParagraph');
      vimMove(back, 'character');
      break;
    case '/': vimSetNav(false); openSearch(true); return;
    case 'n': case 'N': vimSearchAgain(k === 'n' ? 1 : -1, times); break;
    default: return;
  }
  revealCaret();
}
// first in line for keys in the page and the notes, ahead of NEO's own
// typing rules, and only while vim keys are on
window.addEventListener('keydown', (e) => {
  if (!vimEnabled) return;
  const ed = vimEditor(e.target);
  if (!ed) { if (vimNav) vimSetNav(false); return; }
  if (document.querySelector('.modal-backdrop:not([hidden])')) return;
  if (!vimNav) {
    if (e.isComposing || e.keyCode === 229) return; // an input method's, while writing
    // Esc while writing: start moving
    if (e.key === 'Escape' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      vimSetNav(true);
    }
    return;
  }
  if (e.key === 'Escape') {
    // vim hands press Esc out of habit: here it only lets go of a selection
    // or a half-typed command, and never sends the book back to the shelf
    e.preventDefault();
    e.stopPropagation();
    if (vimVisual) window.getSelection().collapseToEnd();
    vimVisual = false;
    vimCount = '';
    vimPending = '';
    return;
  }
  const k = vimKeyOf(e);
  // Ctrl-d / Ctrl-u move half a screen; other modified keys keep their jobs
  if (e.ctrlKey && !e.metaKey && !e.altKey && (k === 'd' || k === 'u')) {
    e.preventDefault();
    e.stopPropagation();
    vimHalfPage(k === 'd' ? 1 : -1);
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey || e.getModifierState('AltGraph')) return;
  // arrows, Home, End, Page Up and Down still move as they always do
  if (k.length > 1 && k !== 'Enter' && k !== 'Backspace' && k !== 'Delete' && k !== 'Tab') return;
  e.preventDefault();
  e.stopPropagation();
  if (ed.classList.contains('chapter-body')) typewriterByKeyboard = true; // typewriter scrolling follows
  vimKey(e);
}, true);
// a click into the page, or the window losing focus, leaves the mode as it was;
// leaving the page for a title or the notes' own fields lets it go
document.addEventListener('focusin', (e) => {
  if (vimNav && !vimEditor(e.target)) vimSetNav(false);
});
// Moving, nothing a keyboard types lands in the text. What ⌥ or AltGr makes
// is refused. A dead key or an input method reaches the page after the
// system has begun composing with it, which can't be refused, so the
// composition is ended as soon as it starts (moving the focus away and
// back commits it and resets the composer), and its text comes back out.
document.addEventListener('beforeinput', (e) => {
  if (vimNav && vimEditor(e.target) && e.inputType === 'insertText') e.preventDefault();
}, true);
document.addEventListener('compositionstart', (e) => {
  const ed = vimNav && vimEditor(e.target);
  const s = window.getSelection();
  if (!ed || !s.rangeCount) return;
  const at = s.getRangeAt(0).cloneRange();
  const before = ed.innerHTML;
  // setting the selection ends the engine's typing run, so the composed
  // text is an undo step of its own and not part of the last x
  s.removeAllRanges();
  s.addRange(at);
  setTimeout(() => {
    if (document.activeElement !== ed) return;
    ed.blur();
    ed.focus({ preventScroll: true });
    if (ed.innerHTML !== before) document.execCommand('undo');
    s.removeAllRanges();
    s.addRange(at);
  }, 0);
}, true);

// Escape also exits regular fullscreen from the bookshelf
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !$('#editor-view').hidden) return;
  if (document.querySelector('.modal-backdrop:not([hidden])')) return;
  window.neo.fullscreenEscape();
});

// ⌘Enter (Ctrl+Enter): toggle fullscreen from anywhere
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
  if (document.querySelector('.modal-backdrop:not([hidden])')) return;
  e.preventDefault();
  window.neo.fullscreenToggle();
});

function createChapterAt(idx) {
  const chId = 'ch-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  book.chapterOrder.splice(idx, 0, chId);
  setChapterHTML(chId, '<p><br></p>', 'new');
  persistChapter(chId);
  saveMeta();
  renderChapters();
  return chId;
}

function newChapter() {
  // insert after the chapter you're in; at the end if you're not in one
  const idx = currentChapterId ? book.chapterOrder.indexOf(currentChapterId) + 1 : book.chapterOrder.length;
  const chId = createChapterAt(idx);
  focusChapter(chId);
}

// cause: what Writing History says took it ('merge' when its words went
// into another chapter, 'outline' onto a loose card)
async function deleteChapterQuiet(chId, cause = 'delete') {
  // a save still queued for this chapter must not resurrect it (nejcc, #70)
  clearTimeout(saveTimers[chId]);
  delete saveTimers[chId];
  book.chapterOrder = book.chapterOrder.filter((c) => c !== chId);
  dropChapterHTML(chId, cause);
  delete wordCache[chId];
  if (book.sectionNotes) delete book.sectionNotes[chId];
  if (book.chapterNotes) delete book.chapterNotes[chId];
  if (book.chapterKinds) delete book.chapterKinds[chId];
  stickies = stickies.filter((s) => s.chapterId !== chId);
  writeStickies(book.id, stickies, 'delete');
  rec.streams('delete');
  const bookId = book.id;
  renderChapters();
  renderStickies();
  // book.json lets go of the chapter before its file goes
  await saveMeta();
  if (book && book.id === bookId) await window.neo.deleteChapter(bookId, chId);
}

function focusChapter(chId) {
  const body = document.querySelector(`.chapter[data-id="${chId}"] .chapter-body`);
  if (!body) return;
  if (!body.isContentEditable) { showEntry(chId); return; }
  body.focus();
  // caret at the very end
  const range = document.createRange();
  range.selectNodeContents(body);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  body.closest('.chapter').scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
  currentChapterId = chId;
  highlightNav();
}

/* ================================================================== */
/*  SCREENPLAYS                                                        */
/*  A script is a book whose book.json says "format": "screenplay".    */
/*  It lives on the shelves like any book (right-click a shelf's + for */
/*  New Script) and is set as it prints: Courier Prime on letter       */
/*  paper. The whole script is one chapter, one typing area, so a      */
/*  selection and the arrow keys run straight through the scenes; the  */
/*  scenes are found by their headings. Each line is a paragraph of    */
/*  one of seven elements, its class sp-<element> (action has none).   */
/*  Nobody has to pick an element: INT. or EXT. makes a scene heading, */
/*  a short line in capitals followed by Enter makes a character, and  */
/*  Enter on an empty line changes what that line is (the rules of     */
/*  Fountain, the plain-text screenplay format). Page breaks, page     */
/*  numbers, (CONT'D) and the gray suggestions are drawn from data-*   */
/*  marks that captureBody strips: nothing on screen is saved.         */
/* ================================================================== */

// ---- screenplay rules: plain functions of the lines, no page (see scripts/screenplay.test.js) ----
const SP_TYPES = ['heading', 'action', 'character', 'paren', 'dialogue', 'transition', 'shot'];
// blank lines above each element (two above a scene heading, so each scene
// stands apart; it costs a few pages, as it does in Final Draft)
const SP_BEFORE = { heading: 2, action: 1, character: 1, paren: 0, dialogue: 0, transition: 1, shot: 2 };
// Enter at the end of a line with words: what the next line is
const SP_AFTER = { heading: 'action', action: 'action', character: 'dialogue', paren: 'dialogue', dialogue: 'action', transition: 'heading', shot: 'action' };
// Enter on an empty line: what that line becomes. Enter twice after a
// speech brings in the next speaker
const SP_EMPTY = { action: 'character', character: 'action', dialogue: 'action', paren: 'dialogue', heading: 'action', transition: 'action', shot: 'action' };
// Tab steps through these (in a speech, Tab trades dialogue and parenthetical)
const SP_CYCLE = ['action', 'character', 'transition', 'heading', 'shot'];
const SP_LINES_PER_PAGE = 54;
const SP_HEAD_RE = /^(?:INT\.?\/EXT|INT\/EXT|I\/E|INT|EXT|EST)(?:\.|\s)/i;
const SP_HEAD_PARSE = /^(INT\.?\/EXT\.?|INT\/EXT\.?|I\/E\.?|INT\.?|EXT\.?|EST\.?)\s+(.*)$/i;
const SP_TIMES = ['DAY', 'NIGHT', 'CONTINUOUS', 'LATER', 'MORNING', 'EVENING', 'DAWN', 'DUSK', 'MOMENTS LATER', 'SAME TIME'];
const SP_TRANSITIONS = ['CUT TO:', 'DISSOLVE TO:', 'SMASH CUT TO:', 'MATCH CUT TO:', 'JUMP CUT TO:', 'FADE OUT.', 'FADE TO BLACK.', 'INTERCUT WITH:'];
const SP_EXTENSIONS = ['V.O.)', 'O.S.)', 'O.C.)', "CONT'D)"];

// a speaker's name without (V.O.) and the like
function spBareName(t) {
  return String(t || '').replace(/\s*\^\s*$/, '').replace(/\s*\([^)]*\)?\s*$/, '').trim().toUpperCase();
}
// Fountain's transition: capitals ending in TO:, or a fade out (the usual
// ones also as typed, "Cut to:", since NEO capitalizes a line's first word)
function spLooksLikeTransition(t) {
  const s = String(t || '').trim();
  if (SP_TRANSITIONS.includes(s.toUpperCase())) return true;
  return !!s && s === s.toUpperCase() && /\p{Lu}/u.test(s) && (/TO:$/.test(s) || s === 'FADE OUT.' || s === 'FADE TO BLACK.');
}
// Fountain's character: a short line all in capitals (an extension in
// parentheses may follow), not a sentence
function spLooksLikeCharacter(t) {
  const s = String(t || '').trim();
  if (!s || s.length > 38 || s !== s.toUpperCase() || !/\p{Lu}/u.test(s)) return false;
  const name = s.replace(/\s*\^\s*$/, '').replace(/\s*\([^)]*\)\s*$/, '').trim();
  if (!name || !/\p{Lu}/u.test(name)) return false;
  if (/[.!?,;:—–-]$/.test(name) && !/^(MR|MRS|MS|DR|ST|JR|SR)\.$/.test(name.split(/\s+/).pop())) return false;
  return name.split(/\s+/).length <= 4;
}
function spParseHeading(t) {
  const m = String(t || '').match(SP_HEAD_PARSE);
  if (!m) return null;
  const rest = m[2];
  const d = rest.search(/\s+[-–—]\s*/);
  if (d < 0) return { prefix: m[1], loc: rest, time: null };
  return { prefix: m[1], loc: rest.slice(0, d).trim(), time: rest.slice(d).replace(/^\s+[-–—]\s*/, '') };
}
// the rest of the first word in the pool that starts with what's typed
function spComplete(partial, pool) {
  if (!partial) return '';
  const p = partial.toUpperCase();
  // a name or place already used just as typed is what's meant (KIM, not KIMBERLY)
  if (pool.includes(p)) return '';
  for (const w of pool) if (w.startsWith(p) && w.length > p.length) return w.slice(p.length);
  return '';
}
// who speaks most, then most lately
function spNames(lines, skip) {
  const seen = new Map();
  lines.forEach((l, i) => {
    if (l.type !== 'character' || i === skip) return;
    const n = spBareName(l.text);
    if (!n) return;
    const e = seen.get(n) || { name: n, count: 0, last: 0 };
    e.count++; e.last = i;
    seen.set(n, e);
  });
  return [...seen.values()].sort((a, b) => b.count - a.count || b.last - a.last).map((e) => e.name);
}
function spLocations(lines, skip) {
  const out = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].type !== 'heading' || i === skip) continue;
    const h = spParseHeading(lines[i].text);
    const loc = h && h.loc.trim().toUpperCase();
    if (loc && !out.includes(loc)) out.push(loc);
  }
  return out;
}
function spTimesUsed(lines, skip) {
  const out = [];
  lines.forEach((l, i) => {
    if (l.type !== 'heading' || i === skip) return;
    const h = spParseHeading(l.text);
    const time = h && h.time && h.time.trim().toUpperCase();
    if (time && !out.includes(time)) out.push(time);
  });
  return out;
}
// the one being answered: the speaker before the last one, in this scene
function spPartner(lines, i) {
  const order = [];
  for (let j = i - 1; j >= 0; j--) {
    const l = lines[j];
    if (l.type === 'heading') break;
    if (l.type !== 'character') continue;
    const n = spBareName(l.text);
    if (n && !order.includes(n)) order.push(n);
    if (order.length === 2) break;
  }
  return order.length === 2 ? order[1] : '';
}
// The gray suggestion for line i, the caret at its end: only names and
// places this script already has (and the usual times and transitions)
function spGhost(lines, i) {
  const l = lines[i];
  const text = l.text;
  if (l.type === 'character') {
    const open = text.lastIndexOf('(');
    if (open >= 0 && text.indexOf(')', open) < 0) return spComplete(text.slice(open + 1), SP_EXTENSIONS);
    if (!text.trim()) return spPartner(lines, i);
    return spComplete(text.trimStart(), spNames(lines, i));
  }
  if (l.type === 'heading') {
    const h = spParseHeading(text);
    if (!h) return '';
    if (h.time === null) return /\s$/.test(text) ? '' : spComplete(h.loc, spLocations(lines, i));
    return spComplete(h.time, [...spTimesUsed(lines, i), ...SP_TIMES]);
  }
  if (l.type === 'transition') {
    const used = lines.filter((x, j) => x.type === 'transition' && j !== i && x.text.trim()).map((x) => x.text.trim().toUpperCase());
    return spComplete(text.trimStart(), [...used, ...SP_TRANSITIONS]);
  }
  return '';
}
// (CONT'D): the same voice again, after action, in the same scene
function spContd(lines, i) {
  const me = spBareName(lines[i].text);
  if (!me || /\(/.test(lines[i].text)) return false;
  let between = false;
  for (let j = i - 1; j >= 0; j--) {
    const l = lines[j];
    if (l.type === 'heading' || l.type === 'transition') return false;
    if (l.type === 'character') return between && spBareName(l.text) === me;
    if ((l.type === 'action' || l.type === 'shot') && l.text.trim()) between = true;
  }
  return false;
}
// The pages, as they print: 54 lines, a speech kept with its speaker, a
// scene heading never alone at the foot of a page. items: [{ type, lines }]
// (lines = how many lines the element takes). For each item: the page it's
// on, the blank lines above it, and, where a page starts, how many lines
// were left blank at the foot of the page before (fill).
function spPaginate(items, perPage = SP_LINES_PER_PAGE) {
  const n = items.length;
  const blocks = [];
  for (let i = 0; i < n;) {
    let j = i + 1;
    // (a line the writer starts a page with begins a block of its own)
    if (items[i].type === 'character') while (j < n && (items[j].type === 'dialogue' || items[j].type === 'paren') && !items[j].newPage) j++;
    blocks.push([i, j]);
    i = j;
  }
  const at = items.map(() => ({ page: 1, before: 0, brk: false, fill: 0 }));
  let page = 1;
  let used = 0;
  const above = (x, top) => (top || x === 0 ? 0 : SP_BEFORE[items[x].type] || 0);
  const height = (b, top) => {
    let h = 0;
    for (let x = b[0]; x < b[1]; x++) h += items[x].lines + above(x, top && x === b[0]);
    return h;
  };
  blocks.forEach((b, bi) => {
    let need = height(b, used === 0);
    const next = blocks[bi + 1];
    if (items[b[0]].type === 'heading' && next) need += height(next, false);
    // Page Break Here: a new page, however much room is left
    if (used > 0 && (items[b[0]].newPage || used + need > perPage)) {
      at[b[0]].brk = true;
      at[b[0]].fill = Math.max(0, perPage - used);
      page++;
      used = 0;
    }
    for (let x = b[0]; x < b[1]; x++) {
      at[x].before = above(x, used === 0 && x === b[0]);
      at[x].page = page;
      at[x].top = used + at[x].before; // the line it starts on
      used += at[x].before + items[x].lines;
      // longer than a page: it runs on over the next one
      while (used > perPage) { used -= perPage; page++; }
    }
  });
  return { at, pages: page, used };
}
// a length in eighths of a page, the way a production counts it
function spEighths(lines, perPage = SP_LINES_PER_PAGE) {
  return Math.max(1, Math.round(lines / perPage * 8));
}
// Fountain text from the script's lines ([{type, text}], text already in
// Fountain's emphasis). A line that Fountain would read as something else
// is forced: ! for action, . for a heading, > for a transition, @ for a name.
function spToFountain(lines, title = {}) {
  const out = [];
  // a styled title in Fountain's own marks: **bold**, *italic*, _underline_
  const st = title.titleStyle || {};
  let tt = String(title.title || '').trim();
  if (tt && (st.b || st.i || st.u)) {
    tt = tt.replace(/([\\*_])/g, '\\$1');
    if (st.b && st.i) tt = '***' + tt + '***'; else if (st.b) tt = '**' + tt + '**'; else if (st.i) tt = '*' + tt + '*';
    if (st.u) tt = '_' + tt + '_';
  }
  const keys = [['Title', tt], ['Credit', title.credit], ['Author', title.author], ['Draft date', title.draft], ['Contact', title.contact]];
  for (const [k, v] of keys) {
    const s = String(v || '').trim();
    if (!s) continue;
    const rows = s.split(/\n/).map((r) => r.trim()).filter(Boolean);
    if (rows.length === 1) out.push(`${k}: ${rows[0]}`);
    else out.push(`${k}:`, ...rows.map((r) => '    ' + r));
  }
  if (out.length) out.push('');
  let inSpeech = false;
  const gap = () => { if (out.length && out[out.length - 1] !== '') out.push(''); };
  let newPage = false;
  for (const l of lines) {
    const text = String(l.text || '').trim();
    newPage = newPage || !!l.newPage;
    if (!text) { inSpeech = false; continue; }
    const caps = text.toUpperCase();
    // Fountain's page break: === on a line of its own
    if (newPage && out.some((x) => x !== '' && !/^[A-Za-z ]+:/.test(x))) { inSpeech = false; gap(); out.push('==='); }
    newPage = false;
    if ((l.type === 'dialogue' || l.type === 'paren') && inSpeech) {
      out.push(l.type === 'paren' && !/^\(/.test(text) ? `(${text})` : text);
      continue;
    }
    inSpeech = false;
    gap();
    if (l.type === 'heading') out.push(SP_HEAD_RE.test(caps) ? caps : '.' + caps);
    else if (l.type === 'character') {
      // a name Fountain wouldn't take for one on sight ("MAN IN THE BLUE
      // HAT", "GUARD!") is forced, so the speech comes back as a speech
      out.push(/\p{Ll}/u.test(caps) ? '@' + text : spLooksLikeCharacter(caps) ? caps : '@' + caps);
      inSpeech = true;
    } else if (l.type === 'transition') out.push(/TO:$/.test(caps) ? caps : '>' + caps);
    else if (l.type === 'shot') out.push('!' + caps);
    else {
      // action (or a speech with no speaker): forced when it would read as
      // a heading, a name, a transition or a Fountain mark
      const misread = SP_HEAD_RE.test(text) || (text === caps && /\p{Lu}/u.test(text)) || /^[.!@~>#=[]/.test(text);
      out.push(misread ? '!' + text : text);
    }
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join('\n') + '\n';
}
// Fountain (or a plain-text script) into lines: [{type, text}], the text
// keeping Fountain's *emphasis* for the caller to set. The title page is
// left out; notes, boneyard, sections, synopses and page breaks too.
// A speaker's (CONT'D) is NEO's to draw: one typed in, or carried in from
// Final Draft or a PDF, comes off the name
const spDropContd = (t) => String(t || '').replace(/\s*\(\s*cont(?:['’]?d|inued)\s*\)\s*$/i, '').trim();
// lines a PDF's text carries that aren't the script: page numbers, (MORE),
// CONTINUED
const SP_PDF_NOISE = /^(?:\d{1,3}[A-Z]?\.|\(MORE\)|\(?CONTINUED\)?:?|CONTINUED:)$/i;
function spFromFountain(src) {
  let text = String(src || '').replace(/\r\n?/g, '\n').replace(/\t/g, '    ');
  text = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\[\[[\s\S]*?\]\]/g, '');
  let rows = text.split('\n');
  if (SP_TITLE_KEY.test(rows[0] || '')) {
    let k = 0;
    while (k < rows.length && rows[k].trim() !== '') k++;
    rows = rows.slice(k);
  }
  const blank = (k) => k < 0 || k >= rows.length || rows[k].trim() === '';
  const out = [];
  let inSpeech = false;
  // a block's lines run on into one paragraph: Fountain keeps a writer's
  // line breaks, and a script copied from a PDF is broken at every line
  let joinable = false;
  let breakNext = false;
  const push = (type, t, join = false) => {
    const last = out[out.length - 1];
    if (join && joinable && last && last.type === type && !breakNext) last.text += ' ' + t;
    else out.push(breakNext && out.length ? { type, text: t, newPage: true } : { type, text: t });
    joinable = join;
    breakNext = false;
  };
  for (let k = 0; k < rows.length; k++) {
    const s = rows[k].trim();
    if (!s) { inSpeech = false; joinable = false; continue; }
    if (/^={3,}$/.test(s)) { breakNext = true; inSpeech = false; continue; }
    // inside a speech, a line is what's said ("#2 pencil", "42."): only a
    // PDF's (MORE) and CONTINUED are left out there
    if (inSpeech ? /^(?:\(MORE\)|\(?CONTINUED\)?:?)$/i.test(s)
      : /^={3,}$/.test(s) || /^#/.test(s) || /^=[^=]/.test(s) || s === '=' || SP_PDF_NOISE.test(s)) continue;
    if (inSpeech) {
      if (/^\(.*\)$/.test(s)) push('paren', s);
      else push('dialogue', s.replace(/^~\s*/, ''), true);
      continue;
    }
    if (s.startsWith('!')) { push('action', s.slice(1).trim(), true); continue; }
    if (/^\.[^.\s]/.test(s)) { push('heading', s.slice(1).trim().replace(/\s*#[^#\s]+#$/, '')); continue; }
    if (s.startsWith('>') && s.endsWith('<')) { push('action', s.slice(1, -1).trim()); continue; }
    if (s.startsWith('>')) { push('transition', s.slice(1).trim()); continue; }
    if (s.startsWith('~')) { push('action', s.slice(1).trim()); continue; }
    if (s.startsWith('@')) { push('character', spDropContd(s.slice(1).trim().replace(/\s*\^$/, ''))); inSpeech = true; continue; }
    if (SP_HEAD_RE.test(s) && blank(k - 1)) { push('heading', s.replace(/\s*#[^#\s]+#$/, '')); continue; }
    if (spLooksLikeTransition(s) && blank(k - 1) && blank(k + 1)) { push('transition', s); continue; }
    if (blank(k - 1) && !blank(k + 1) && spLooksLikeCharacter(s.replace(/\s*\^$/, ''))) {
      push('character', spDropContd(s.replace(/\s*\^$/, '')));
      inSpeech = true;
      continue;
    }
    push('action', s, true);
  }
  return out;
}
// Fountain's title page: Title, Credit, Author, Draft date, Contact (a value
// on its own line or on indented lines below its key). Markup comes off.
const SP_TITLE_KEY = /^(title|credit|author|authors|source|draft date|date|contact|copyright|notes|revision)\s*:/i;
function spFountainTitle(src) {
  const rows = String(src || '').replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
  const out = {};
  if (!SP_TITLE_KEY.test(rows[0] || '')) return out;
  const vals = {};
  let key = null;
  for (const row of rows) {
    if (!row.trim()) break;
    const m = !/^\s/.test(row) && row.match(/^([^:]+):\s*(.*)$/);
    if (m) { key = m[1].trim().toLowerCase(); vals[key] = m[2].trim() ? [m[2].trim()] : []; } else if (key) vals[key].push(row.trim());
  }
  const plain = (a) => (a || []).map((r) => spRunsFromFountain(r.replace(/^>\s*|\s*<$/g, '')).map((x) => x.text).join('').trim()).filter(Boolean);
  if (vals.title) {
    out.title = plain(vals.title).join(' ');
    const runs = vals.title.flatMap((r) => spRunsFromFountain(r.replace(/^>\s*|\s*<$/g, ''))).filter((x) => x.text.trim());
    const all = (k) => runs.length && runs.every((x) => x[k]);
    const st = {};
    for (const k of ['b', 'i', 'u']) if (all(k)) st[k] = true;
    if (Object.keys(st).length) out.titleStyle = st;
  }
  if (vals.credit) out.credit = plain(vals.credit).join(' ');
  if (vals.author || vals.authors) out.author = plain(vals.author || vals.authors).join(' & ');
  if (vals['draft date'] || vals.date) out.draft = plain(vals['draft date'] || vals.date).join('\n');
  if (vals.contact) out.contact = plain(vals.contact).join('\n');
  return out;
}
// Fountain's emphasis as runs: *italic*, **bold**, ***both***, _underline_,
// with a backslash keeping a mark as itself
function spRunsFromFountain(t) {
  const runs = [];
  const st = { b: false, i: false, u: false };
  let buf = '';
  const flush = () => { if (buf) runs.push({ text: buf, b: st.b, i: st.i, u: st.u, s: false }); buf = ''; };
  // a mark only counts where a closing one follows on the line
  const closes = (from, mark) => t.indexOf(mark, from) > -1;
  for (let k = 0; k < t.length; k++) {
    const c = t[k];
    if (c === '\\' && k + 1 < t.length) { buf += t[++k]; continue; }
    if (c === '*') {
      let n = 1;
      while (t[k + n] === '*' && n < 3) n++;
      const on = n === 3 ? st.b && st.i : n === 2 ? st.b : st.i;
      if (on || closes(k + n, '*'.repeat(n))) {
        flush();
        if (n === 3) { st.b = !on; st.i = !on; } else if (n === 2) st.b = !st.b; else st.i = !st.i;
        k += n - 1;
        continue;
      }
    }
    if (c === '_' && (st.u || closes(k + 1, '_'))) { flush(); st.u = !st.u; continue; }
    buf += c;
  }
  flush();
  return runs;
}
// Final Draft's .fdx is XML: a <Paragraph Type="…"> per line, its words in
// <Text Style="Bold+Italic"> runs. Read without a parser, so the same code
// runs in the tests. Dual dialogue comes in as two speeches in a row.
const SP_FDX_TYPES = {
  'scene heading': 'heading', action: 'action', character: 'character', parenthetical: 'paren',
  dialogue: 'dialogue', transition: 'transition', shot: 'shot', lyrics: 'dialogue', general: 'action'
};
const spXmlText = (s) => String(s).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const spXmlAttr = (tag, name) => { const m = tag.match(new RegExp('\\b' + name + '="([^"]*)"')); return m ? spXmlText(m[1]) : ''; };
function spFdxParas(xml) {
  // Final Draft keeps a scene's summary and story beats inside its heading,
  // as Paragraphs of their own: they come out first, or the heading's own
  // text would be cut off at the first inner </Paragraph>
  xml = xml.replace(/<SceneProperties\b[\s\S]*?<\/SceneProperties>/g, '').replace(/<ScriptNote\b[\s\S]*?<\/ScriptNote>/g, '');
  xml = xml.replace(/<Paragraph\b[^>]*>\s*<DualDialogue>([\s\S]*?)<\/DualDialogue>\s*<\/Paragraph>/g, '$1');
  const out = [];
  for (const m of xml.matchAll(/<Paragraph\b([^>]*)>([\s\S]*?)<\/Paragraph>/g)) {
    const runs = [];
    for (const r of m[2].matchAll(/<Text\b([^>]*?)(?:\/>|>([\s\S]*?)<\/Text>)/g)) {
      const text = spXmlText(r[2] || '').replace(/\s*\n\s*/g, ' ');
      if (!text) continue;
      const style = spXmlAttr(r[1], 'Style').toLowerCase().split('+');
      runs.push({ text, b: style.includes('bold'), i: style.includes('italic'), u: style.includes('underline'), s: style.includes('strikeout') });
    }
    out.push({ type: spXmlAttr(m[1], 'Type'), align: spXmlAttr(m[1], 'Alignment').toLowerCase(), runs, newPage: /^yes$/i.test(spXmlAttr(m[1], 'StartsNewPage')) });
  }
  return out;
}
function spFromFdx(xml) {
  xml = String(xml || '');
  const body = (xml.match(/<Content>([\s\S]*?)<\/Content>/) || [])[1] || '';
  const lines = [];
  let newPage = false;
  for (const p of spFdxParas(body)) {
    const text = p.runs.map((r) => r.text).join('').trim();
    newPage = newPage || p.newPage;
    if (!text) continue;
    const type = SP_FDX_TYPES[p.type.toLowerCase()] || 'action';
    let runs = p.runs;
    if (type === 'character') runs = [{ text: spDropContd(text), b: false, i: false, u: false, s: false }];
    if (type === 'paren' && !text.startsWith('(')) runs = [{ text: '(' + text + ')', b: false, i: false, u: false, s: false }];
    lines.push(newPage && lines.length ? { type, runs, newPage } : { type, runs });
    newPage = false;
  }
  // the title page: the centered lines are the title, the credit and the
  // writer; lines set left, below them, the contact; set right, the draft
  const title = {};
  const page = (xml.match(/<TitlePage>[\s\S]*?<Content>([\s\S]*?)<\/Content>/) || [])[1] || '';
  const tp = spFdxParas(page).map((p) => ({ align: p.align, runs: p.runs, text: p.runs.map((r) => r.text).join('').trim() })).filter((p) => p.text);
  const centered = tp.filter((p) => p.align === 'center').map((p) => p.text);
  if (centered.length) {
    title.title = centered[0];
    const runs = tp.find((p) => p.align === 'center').runs.filter((r) => r.text.trim());
    const st = {};
    for (const k of ['b', 'i', 'u']) if (runs.length && runs.every((r) => r[k])) st[k] = true;
    if (Object.keys(st).length) title.titleStyle = st;
    const c = centered.findIndex((x, k) => k > 0 && /^(?:written by|screenplay by|teleplay by|story by|by)$/i.test(x));
    if (c > 0) { title.credit = centered[c]; if (centered[c + 1]) title.author = centered[c + 1]; } else if (centered[1]) title.author = centered[1];
  }
  const left = tp.filter((p) => p.align !== 'center' && p.align !== 'right').map((p) => p.text);
  const right = tp.filter((p) => p.align === 'right').map((p) => p.text);
  if (left.length) title.contact = left.join('\n');
  if (right.length) title.draft = right.join('\n');
  return { lines, title };
}
// …and back out: lines [{type, runs}] (runs as paraRuns gives them)
function spToFdx(lines, title = {}) {
  const NAMES = { heading: 'Scene Heading', action: 'Action', character: 'Character', paren: 'Parenthetical', dialogue: 'Dialogue', transition: 'Transition', shot: 'Shot' };
  const CAPS = ['heading', 'character', 'transition', 'shot'];
  // oxlint-disable-next-line no-control-regex -- characters XML can't hold
  const esc = (s) => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const textEl = (r, caps) => {
    const style = [r.b && 'Bold', r.i && 'Italic', r.u && 'Underline', r.s && 'Strikeout'].filter(Boolean).join('+');
    return `      <Text${style ? ` Style="${style}"` : ''}>${esc(caps ? r.text.toUpperCase() : r.text)}</Text>\n`;
  };
  let out = '<?xml version="1.0" encoding="UTF-8" standalone="no" ?>\n<FinalDraft DocumentType="Script" Template="No" Version="1">\n\n  <Content>\n';
  let newPage = false;
  for (const l of lines) {
    newPage = newPage || !!l.newPage;
    let runs = (l.runs || []).filter((r) => r.text);
    if (!runs.length) continue;
    if (l.type === 'heading' && title.underlineHeadings) runs = runs.map((r) => ({ ...r, b: true, u: true }));
    out += `    <Paragraph Type="${NAMES[l.type] || 'Action'}"${newPage ? ' StartsNewPage="Yes"' : ''}>\n${runs.map((r) => textEl(r, CAPS.includes(l.type))).join('')}    </Paragraph>\n`;
    newPage = false;
  }
  out += '  </Content>\n';
  const para = (text, align, st) => {
    const style = st ? [st.b && 'Bold', st.i && 'Italic', st.u && 'Underline'].filter(Boolean).join('+') : '';
    return `    <Paragraph Alignment="${align}">\n      <Text${style ? ` Style="${style}"` : ''}>${esc(text)}</Text>\n    </Paragraph>\n`;
  };
  const gap = (n) => '    <Paragraph Alignment="Center">\n      <Text></Text>\n    </Paragraph>\n'.repeat(n);
  const tp = [];
  if (title.title) tp.push(gap(18), para(String(title.title).toUpperCase(), 'Center', title.titleStyle));
  if (title.credit) tp.push(gap(1), para(title.credit, 'Center'));
  if (title.author) tp.push(gap(1), para(title.author, 'Center'));
  const rows = (s) => String(s || '').split('\n').map((x) => x.trim()).filter(Boolean);
  if (rows(title.draft).length || rows(title.contact).length) tp.push(gap(16));
  for (const r of rows(title.draft)) tp.push(para(r, 'Right'));
  for (const r of rows(title.contact)) tp.push(para(r, 'Left'));
  if (tp.length) out += '  <TitlePage>\n    <Content>\n' + tp.join('').replace(/^ {4}/gm, '      ') + '    </Content>\n  </TitlePage>\n';
  return out + '</FinalDraft>\n';
}
// ---- end of screenplay rules ----

const isScript = (meta = book) => !!meta && meta.format === 'screenplay';
const SP_CLASSES = SP_TYPES.filter((x) => x !== 'action').map((x) => 'sp-' + x);
const SP_NAMES = {
  heading: tk('Scene Heading'), action: tk('Action'), character: tk('Character'), paren: tk('Parenthetical'),
  dialogue: tk('Dialogue'), transition: tk('Transition'), shot: tk('Shot')
};
const spKey = (n) => K('⌘' + n, 'Ctrl+' + n);
// the screen's own marks on a script's lines, never saved
const SP_SCREEN_ATTRS = ['data-pg', 'data-fill', 'data-contd', 'data-ghost', 'data-ghost-empty', 'data-scene-note'];
// characters NEO guessed from a line in capitals, and headings it made of
// INT./EXT.: either goes back to action when the guess turns out wrong
const spGuessed = new WeakSet();
const spDismissed = new WeakMap(); // a line → its text when Esc sent its suggestion away

function spType(p) {
  if (!p || !p.classList) return 'action';
  for (const x of SP_TYPES) if (x !== 'action' && p.classList.contains('sp-' + x)) return x;
  return 'action';
}
function spSetClass(p, type) {
  p.classList.remove(...SP_CLASSES, 'poetry', 'flush', 'scene-break', 'ghost');
  if (type !== 'action') p.classList.add('sp-' + type);
  if (!p.className) p.removeAttribute('class');
  spGuessed.delete(p);
}
function spCleanMarks(p) {
  for (const a of SP_SCREEN_ATTRS) if (p.hasAttribute(a)) p.removeAttribute(a);
  // (a new line split from one that starts a page doesn't start one too)
  if (p.hasAttribute('data-newpage')) p.removeAttribute('data-newpage');
}
// a page break's fill, as a custom property the stylesheet can read
(() => {
  const st = document.createElement('style');
  let css = '';
  for (let n = 0; n <= SP_LINES_PER_PAGE; n++) css += `.sp-geom>p[data-fill="${n}"]{--fill:${n}}`;
  st.textContent = css;
  document.head.appendChild(st);
})();

// the bodies and the lines of the open script, top to bottom
function spBodies() { return $$('#chapters .chapter-body.script-body'); }
function spParas() {
  const out = [];
  for (const b of spBodies()) for (const p of b.children) if (p.tagName === 'P') out.push(p);
  return out;
}
const spLinesOf = (ps) => ps.map((p) => ({ type: spType(p), text: p.textContent }));
// the line the caret is in (or was, before a click in the pane took focus)
let spLastPara = null;
function spCaretPara() {
  const sel = window.getSelection();
  if (sel && sel.rangeCount) {
    let el = sel.anchorNode;
    if (el && el.nodeType === Node.TEXT_NODE) el = el.parentElement;
    const p = el && el.closest ? el.closest('p') : null;
    if (p && p.parentElement && p.parentElement.classList.contains('script-body')) return p;
  }
  return spLastPara && spLastPara.isConnected ? spLastPara : null;
}
const spBodyOf = (p) => p && p.closest('.chapter-body');
const spChapterOf = (p) => { const s = p && p.closest('.chapter'); return s ? s.dataset.id : null; };
function spCaretAtEnd(p) {
  const sel = window.getSelection();
  if (!sel.rangeCount || !sel.isCollapsed || !p.contains(sel.anchorNode) && sel.anchorNode !== p) return false;
  const r = document.createRange();
  r.selectNodeContents(p);
  try { r.setStart(sel.anchorNode, sel.anchorOffset); } catch { return false; }
  return r.toString().length === 0;
}
function spCaretAtStart(p) {
  const sel = window.getSelection();
  if (!sel.rangeCount || !sel.isCollapsed) return false;
  const r = document.createRange();
  r.selectNodeContents(p);
  try { r.setEnd(sel.anchorNode, sel.anchorOffset); } catch { return false; }
  return r.toString().length === 0;
}
function spCaretToEnd(p) {
  const w = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
  let last = null;
  for (let n = w.nextNode(); n; n = w.nextNode()) last = n;
  if (last) placeCaret(last, last.length); else placeCaret(p, 0);
}
// typed in, so ⌘Z takes it back like any typing
function spInsert(text) { document.execCommand('insertText', false, text); }
function spReplaceAll(p, text) {
  selectChars(p, 0, p.textContent.length);
  if (text) spInsert(text); else document.execCommand('delete');
  if (!p.textContent && !p.querySelector('br')) p.appendChild(document.createElement('br'));
}

// One element for a line: from the pane, the Format menu, ⌘1–7 or Tab.
// A parenthetical gets its parentheses, and loses them when it stops being one.
function spSetType(p, type) {
  const was = spType(p);
  if (!p || was === type) return;
  const text = p.textContent;
  if (was === 'paren' && /^\s*\(/.test(text)) {
    const inner = text.trim().replace(/^\(/, '').replace(/\)$/, '');
    spReplaceAll(p, inner);
  }
  spSetClass(p, type);
  if (type === 'paren') {
    const inner = p.textContent.trim().replace(/^\(/, '').replace(/\)$/, '');
    spReplaceAll(p, '(' + inner + ')');
    const pos = p.textContent.length - 1;
    selectChars(p, pos, pos);
  } else {
    spCaretToEnd(p);
  }
}
function spAfterChange(p) {
  const body = spBodyOf(p);
  if (!body) return;
  spLastPara = p;
  syncChapter(body, spChapterOf(p), 'script');
  spSchedule();
  spRefreshGhost();
  spShowElement();
}
// ⌘1–7, a click in the pane, the Format menu
function spSetElement(type) {
  const p = spCaretPara();
  if (!p || !SP_TYPES.includes(type)) return;
  const body = spBodyOf(p);
  if (document.activeElement !== body) {
    body.focus({ preventScroll: true });
    spCaretToEnd(p);
  }
  if (spType(p) !== type) spSetType(p, type);
  spAfterChange(p);
}

// The keys of a script. True when the key was handled here.
function scriptKey(e, body) {
  const cmd = IS_POCKET ? (e.metaKey !== e.ctrlKey) : (IS_MAC ? e.metaKey : e.ctrlKey);
  if (cmd && !e.shiftKey && !e.altKey && /^Digit[1-7]$/.test(e.code || '')) {
    e.preventDefault();
    spSetElement(SP_TYPES[Number(e.code.slice(5)) - 1]);
    return true;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  const sel = window.getSelection();
  if (!sel.rangeCount) return false;
  if (e.key === 'Enter') {
    e.preventDefault();
    if (!sel.isCollapsed) document.execCommand('delete');
    const p = caretBlock(body);
    if (p) spEnter(p, body);
    return true;
  }
  if (!sel.isCollapsed) return false;
  const p = caretBlock(body);
  if (!p) return false;
  const ghost = p.getAttribute('data-ghost') || '';
  if (e.key === 'Escape' && ghost) {
    // not this one: gone until the line changes
    e.preventDefault();
    e.stopPropagation();
    spDismissed.set(p, p.textContent);
    spRefreshGhost();
    return true;
  }
  if (e.key === 'Tab') {
    e.preventDefault();
    spTab(p, e.shiftKey, ghost && !e.shiftKey && spCaretAtEnd(p) ? ghost : '');
    return true;
  }
  if (e.key === 'ArrowRight' && !e.shiftKey && ghost && spCaretAtEnd(p)) {
    e.preventDefault();
    spInsert(ghost);
    spAfterChange(p);
    return true;
  }
  if (e.key === 'Backspace' && spCaretAtStart(p)) {
    // at the top of a line that starts a page, Backspace takes the page
    // break away first, like the empty lines it stands for
    if (p.hasAttribute('data-newpage')) {
      e.preventDefault();
      p.removeAttribute('data-newpage');
      spAfterChange(p);
      return true;
    }
    const prev = p.previousElementSibling;
    // an empty speech under a name NEO guessed: it was action after all
    if (!p.textContent.trim() && spType(p) === 'dialogue' && prev && spType(prev) === 'character' && spGuessed.has(prev)) {
      e.preventDefault();
      spSetClass(prev, 'action');
      p.remove();
      spCaretToEnd(prev);
      spAfterChange(prev);
      return true;
    }
  }
  return false;
}

function spEnter(p, body) {
  let type = spType(p);
  // Enter takes the gray suggestion, as in Final Draft: on an empty name
  // line the one being answered, on a half-typed one the rest of the name
  // (or place, time, transition). A name already used as typed gets no
  // suggestion (spComplete), and Esc sends one away.
  if (p.getAttribute('data-ghost') && spCaretAtEnd(p)) spInsert(p.getAttribute('data-ghost'));
  const text = p.textContent;
  enterRun = 0;
  // (an empty parenthetical is its parentheses)
  if (!(type === 'paren' ? text.replace(/[()]/g, '') : text).trim()) {
    // Enter on an empty line changes what it is
    if (text) spReplaceAll(p, '');
    spSetClass(p, SP_EMPTY[type]);
    placeCaret(p, 0);
    spAfterChange(p);
    return;
  }
  // in a parenthetical, the caret before its closing ) is at its end
  if (type === 'paren') {
    const sel = window.getSelection();
    const r = document.createRange();
    r.selectNodeContents(p);
    try { r.setStart(sel.anchorNode, sel.anchorOffset); } catch { /* where it is */ }
    if (r.toString().trim() === ')') spCaretToEnd(p);
  }
  if (spCaretAtStart(p)) {
    // at the start of a line with words: an empty line opens above it, a
    // line of the speech inside a speech, action anywhere else
    document.execCommand('insertParagraph');
    const above = p.previousElementSibling;
    if (above && above.tagName === 'P') { spSetClass(above, type === 'dialogue' || type === 'paren' ? 'dialogue' : 'action'); spCleanMarks(above); }
    spAfterChange(p);
    return;
  }
  if (!spCaretAtEnd(p)) {
    // mid-line: the rest becomes the next line
    document.execCommand('insertParagraph');
    const next = caretBlock(body);
    if (next && next !== p) {
      spCleanMarks(next);
      spSetClass(next, type === 'dialogue' || type === 'action' ? type : SP_AFTER[type]);
      spSetClass(p, type); // the engine may have moved the class along
      spAfterChange(next);
    }
    return;
  }
  // at the end: settle what this line is, then the next one
  if (type === 'action') {
    if (spLooksLikeTransition(text)) { spSetClass(p, 'transition'); type = 'transition'; }
    else if (spLooksLikeCharacter(text)) { spSetClass(p, 'character'); spGuessed.add(p); type = 'character'; }
  }
  if (type === 'paren' && !/\)\s*$/.test(text)) spInsert(')');
  const guessed = spGuessed.has(p);
  document.execCommand('insertParagraph');
  const next = caretBlock(body);
  if (next && next !== p) {
    spCleanMarks(next);
    spSetClass(next, SP_AFTER[type]);
    if (guessed) spGuessed.add(p);
    placeCaret(next, 0);
    spAfterChange(next);
  }
}

function spTab(p, back, ghost) {
  if (ghost) { spInsert(ghost); spAfterChange(p); return; }
  const type = spType(p);
  const text = p.textContent;
  // INT, EXT and the like, then Tab: a scene heading, with its period
  const prefix = /^(INT|EXT|EST|I\/E|INT\.?\/EXT)\.?$/i.test(text.trim());
  if ((type === 'heading' || (type === 'action' && prefix)) && !back) {
    const t = text.replace(/\s+$/, '');
    const h = spParseHeading(text);
    if (prefix) {
      spReplaceAll(p, t.replace(/\.$/, '') + '. ');
      spSetClass(p, 'heading');
      spGuessed.add(p);
      spCaretToEnd(p);
      spAfterChange(p);
      return;
    }
    if (h && h.loc && h.time === null) {
      spReplaceAll(p, t + ' - ');
      spAfterChange(p);
      return;
    }
  }
  let to;
  if (type === 'dialogue' || type === 'paren') to = type === 'dialogue' ? 'paren' : 'dialogue';
  else {
    const k = SP_CYCLE.indexOf(type);
    to = SP_CYCLE[(k + (back ? -1 : 1) + SP_CYCLE.length) % SP_CYCLE.length];
  }
  spSetType(p, to);
  spAfterChange(p);
}

// As the writer types: INT. or EXT. makes a heading, an opening "(" in a
// speech makes a parenthetical
function scriptInput(body) {
  const p = caretBlock(body);
  // the whole script cleared (⌘A, then Delete or ⌘X): the one line left
  // starts over as action, the way a new script does, not as whatever the
  // last line deleted was. Left as dialogue, "int." stayed dialogue and
  // Return kept to the speech's rules (#359)
  if (p && body.children.length === 1) {
    const type = spType(p);
    const text = p.textContent.trim();
    if ((type === 'dialogue' || type === 'paren') || (type !== 'action' && type !== 'heading' && (!text || SP_HEAD_RE.test(text)))) spSetClass(p, 'action');
  }
  if (p) {
    const type = spType(p);
    const text = p.textContent;
    if (type === 'action' && SP_HEAD_RE.test(text)) { spSetClass(p, 'heading'); spGuessed.add(p); }
    else if (type === 'heading' && spGuessed.has(p) && !SP_HEAD_RE.test(text)) spSetClass(p, 'action');
    else if (type === 'dialogue' && text.startsWith('(')) spSetClass(p, 'paren');
    // "(" opening the line after a speech: a parenthetical inside it, and
    // Enter after it goes back to the speech
    else if (type === 'action' && text.startsWith('(') && p.previousElementSibling &&
      ['dialogue', 'paren'].includes(spType(p.previousElementSibling))) spSetClass(p, 'paren');
    spLastPara = p;
  }
  spSchedule();
  spRefreshGhost();
  spShowElement();
}

// ---- a scene's card note, in gray on its empty first line ----
// The way a book's section notes stand on the page until written over: a
// scene with nothing written under its heading yet shows its note there,
// gone at the first letter typed. A screen mark (data-scene-note), never
// saved, and nothing Enter takes. (#339)
function spSceneNoteGhosts(ps, lines) {
  const notes = book.sceneNotes || {};
  const want = new Map();
  for (let i = 0; i < ps.length; i++) {
    if (lines[i].type !== 'heading') continue;
    const note = ps[i].dataset.sceneId && notes[ps[i].dataset.sceneId];
    if (!note) continue;
    let j = i + 1;
    let blank = null;
    let written = false;
    for (; j < ps.length && lines[j].type !== 'heading'; j++) {
      if (ps[j].textContent.trim()) { written = true; break; }
      if (!blank) blank = ps[j];
    }
    if (!written && blank) want.set(blank, note);
  }
  for (const p of ps) {
    const note = want.get(p) || null;
    if (p.getAttribute('data-scene-note') !== note) { if (note) p.setAttribute('data-scene-note', note); else p.removeAttribute('data-scene-note'); }
  }
}

// ---- the gray suggestion at the caret ----
function spRefreshGhost() {
  // a scene note on the line being typed on goes the moment it has words
  const at = spCaretPara();
  if (at && at.hasAttribute('data-scene-note') && at.textContent.trim()) at.removeAttribute('data-scene-note');
  const p = spCaretPara();
  let ghost = '';
  if (p && document.activeElement === spBodyOf(p) && ['character', 'heading', 'transition'].includes(spType(p)) && spCaretAtEnd(p) && spDismissed.get(p) !== p.textContent) {
    const ps = spParas();
    ghost = spGhost(spLinesOf(ps), ps.indexOf(p));
  }
  for (const q of $$('#chapters p[data-ghost]')) {
    if (q !== p || !ghost) { q.removeAttribute('data-ghost'); q.removeAttribute('data-ghost-empty'); }
  }
  if (p && ghost) {
    if (p.getAttribute('data-ghost') !== ghost) p.setAttribute('data-ghost', ghost);
    p.toggleAttribute('data-ghost-empty', !p.textContent);
  }
}

// ---- pages ----
let spLayout = { ps: [], at: [], pages: 1, used: 0, scenes: [] };
let spTimer = null;
const SP_NARROW = window.matchMedia ? window.matchMedia('(max-width: 599px)') : { matches: false };
function spSchedule(ms = 140) {
  clearTimeout(spTimer);
  spTimer = setTimeout(spRepaginate, ms);
}
// How many lines each element takes on the printed page. Read from the
// page itself when it is showing at its true shape; otherwise laid out in
// a measuring room off screen (on a phone, from another tab, for the PDF).
function spMeasure(ps, live) {
  if (live && ps.length) {
    const lh = parseFloat(getComputedStyle(ps[0]).lineHeight) || 0;
    const first = ps[0].getBoundingClientRect().height;
    if (lh > 0 && first > 0) return ps.map((p) => Math.max(1, Math.round(p.getBoundingClientRect().height / lh)));
  }
  let room = $('#sp-measure');
  if (!room) {
    room = document.createElement('div');
    room.id = 'sp-measure';
    room.className = 'sp-measure';
    room.setAttribute('aria-hidden', 'true');
    room.innerHTML = '<div class="sp-geom"></div>';
    document.body.appendChild(room);
  }
  const inner = room.firstElementChild;
  inner.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (const p of ps) {
    const c = p.cloneNode(true);
    for (const a of ['data-pg', 'data-fill', 'data-ghost', 'data-ghost-empty']) c.removeAttribute(a);
    frag.appendChild(c);
  }
  inner.appendChild(frag);
  const out = [...inner.children].map((c) => Math.max(1, Math.round(c.getBoundingClientRect().height / 20)));
  inner.innerHTML = '';
  return out;
}
function spRepaginate() {
  clearTimeout(spTimer);
  if (!book || !isScript() || !$('#paper').classList.contains('script')) return;
  const ps = spParas();
  const lines = spLinesOf(ps);
  // (CONT'D) first: it makes a name's line longer
  ps.forEach((p, i) => {
    const c = spContdOn() && lines[i].type === 'character' && spContd(lines, i);
    if (p.hasAttribute('data-contd') !== c) p.toggleAttribute('data-contd', c);
  });
  const narrow = $('#paper').classList.contains('narrow');
  const live = !narrow && currentTab === 'manuscript' && !$('#paper').hidden;
  const counts = spMeasure(ps, live);
  const pg = spPaginate(ps.map((p, i) => ({ type: lines[i].type, lines: counts[i], newPage: p.hasAttribute('data-newpage') })));
  ps.forEach((p, i) => {
    const a = pg.at[i];
    const page = a.brk ? String(a.page) : null;
    if (p.getAttribute('data-pg') !== page) { if (page) p.setAttribute('data-pg', page); else p.removeAttribute('data-pg'); }
    const fill = a.brk ? String(Math.min(SP_LINES_PER_PAGE, a.fill)) : null;
    if (p.getAttribute('data-fill') !== fill) { if (fill) p.setAttribute('data-fill', fill); else p.removeAttribute('data-fill'); }
  });
  spSceneNoteGhosts(ps, lines);
  const chapters = $('#chapters');
  chapters.style.setProperty('--sp-last', String(Math.max(0, SP_LINES_PER_PAGE - pg.used)));
  if (narrow) chapters.style.setProperty('--sp-fullw', chapters.clientWidth + 'px');
  // the scenes: where each starts and how long it runs
  const scenes = [];
  ps.forEach((p, i) => {
    if (lines[i].type === 'heading') scenes.push({ p, i, slug: lines[i].text.trim(), lines: 0 });
    if (scenes.length) scenes[scenes.length - 1].lines += counts[i] + pg.at[i].before;
  });
  const before = spLayout.scenes.map((s) => s.slug + s.lines).join('|');
  spLayout = { ps, at: pg.at, pages: pg.pages, used: pg.used, scenes, counts };
  if (scenes.map((s) => s.slug + s.lines).join('|') !== before) scheduleNavRefresh();
  updateCounters();
}
// The script's length as a production reads it: pages in eighths, and a
// page a minute
function spLengthText() {
  const eighths = Math.max(1, Math.round(((spLayout.pages - 1) * SP_LINES_PER_PAGE + spLayout.used) / SP_LINES_PER_PAGE * 8));
  return { eighths, text: spEighthsText(eighths), minutes: Math.max(1, Math.round(eighths / 8)) };
}
function spEighthsText(e) {
  const whole = Math.floor(e / 8);
  const rem = e % 8;
  if (!whole) return rem + '/8';
  return rem ? `${fmtNum(whole)} ${rem}/8` : fmtNum(whole);
}
function spCurrentPage() {
  const p = spCaretPara();
  const i = p ? spLayout.ps.indexOf(p) : -1;
  if (i >= 0 && spLayout.at[i]) return spLayout.at[i].page;
  // no caret: the page at the top of the window
  const top = $('#paper-scroll').getBoundingClientRect().top + 40;
  let page = 1;
  spLayout.ps.forEach((q, k) => { if (q.isConnected && q.getBoundingClientRect().top < top && spLayout.at[k]) page = spLayout.at[k].page; });
  return page;
}
function spCurrentScene() {
  const p = spCaretPara();
  const i = p ? spLayout.ps.indexOf(p) : -1;
  let n = 0;
  spLayout.scenes.forEach((s, k) => { if (s.i <= i) n = k + 1; });
  return n;
}
let spPosScene = false; // the page counter, clicked, counts scenes instead
function spCounters() {
  const len = spLengthText();
  const wc = $('#word-counter');
  if (wordMode === 'book') setText(wc, t('{pages} pages · ~{n} min', { pages: len.text, n: len.minutes }));
  else setText(wc, t('{n} words', { n: bookWordCount() }));
  const pos = $('#pos-counter');
  setText(pos, spPosScene
    ? t('scene {n} of {total}', { n: spCurrentScene(), total: spLayout.scenes.length })
    : t('page {p} of {total}', { p: spCurrentPage(), total: spLayout.pages }));
}

// ---- the pane: the elements on top, the scenes beneath ----
let spShownElement = null;
function spShowElement() {
  const p = spCaretPara();
  const type = p ? spType(p) : null;
  if (type === spShownElement) return;
  spShownElement = type;
  for (const el of $$('#nav-list .sp-el')) el.classList.toggle('current', el.dataset.el === type);
  spReportState();
}
// the scene the caret is in, lit in the pane
function spHighlightScene() {
  const n = spCurrentScene();
  $$('#nav-list .sp-scene').forEach((el, k) => el.classList.toggle('current', k + 1 === n));
}
function spReportState() {
  if (!window.neo.scriptState) return;
  const on = !!book && isScript() && !$('#editor-view').hidden;
  window.neo.scriptState({ on, element: on ? spShownElement || 'action' : null, underline: on && spUnderlineOn(), contd: on && spContdOn() });
}
// the Format menu's two script-style items, and Page Break Here
function spToggleStyle(key) {
  if (!book || !isScript()) return;
  if (key === 'underline') book.underlineHeadings = !spUnderlineOn();
  else book.contd = spContdOn() ? false : undefined;
  if (book.underlineHeadings === false) delete book.underlineHeadings;
  if (book.contd === undefined) delete book.contd;
  saveMeta();
  spApplyStyle();
  spRepaginate();
  spReportState();
}
// the line a right-click landed on, for Page Break Here
let spContextLine = null;
document.addEventListener('contextmenu', (e) => {
  spContextLine = null;
  if (!book || !isScript() || !window.neo.scriptContext) return;
  const body = e.target.closest && e.target.closest('.chapter-body.script-body');
  if (!body) { window.neo.scriptContext(null); return; }
  const at = document.caretRangeFromPoint ? document.caretRangeFromPoint(e.clientX, e.clientY) : null;
  let el = at ? at.startContainer : e.target;
  if (el && el.nodeType === Node.TEXT_NODE) el = el.parentElement;
  const p = el && el.closest ? el.closest('p') : null;
  // (the first line of a script already starts its first page)
  spContextLine = p && body.contains(p) && spParas()[0] !== p ? p : null;
  window.neo.scriptContext(spContextLine ? { pageBreak: spContextLine.hasAttribute('data-newpage') } : null);
}, true);
function spTogglePageBreak() {
  const p = spContextLine;
  spContextLine = null;
  if (!p || !p.isConnected || !book || !isScript()) return;
  snapshotStructure('page break');
  p.toggleAttribute('data-newpage');
  spAfterChange(p);
  breakRun++;
}
function renderScriptNav() {
  const list = $('#nav-list');
  list.innerHTML = '';
  setText($('#nav-head span'), t('Elements'));
  SP_TYPES.forEach((type, k) => {
    const item = document.createElement('div');
    item.className = 'nav-item sp-el';
    item.dataset.el = type;
    item.innerHTML = '<div class="n-row"><span class="n-label"></span><span class="n-words"></span></div>';
    item.querySelector('.n-label').textContent = t(SP_NAMES[type]);
    item.querySelector('.n-words').textContent = spKey(k + 1);
    // the caret stays in the script while the pane is used
    item.addEventListener('mousedown', (e) => e.preventDefault());
    item.onclick = () => spSetElement(type);
    pressable(item, t(SP_NAMES[type]));
    list.appendChild(item);
  });
  spShownElement = null;
  spShowElement();
  const head = document.createElement('div');
  head.className = 'sp-scenes-head';
  head.textContent = t('Scenes');
  list.appendChild(head);
  const caret = spCaretPara();
  const at = caret ? spLayout.ps.indexOf(caret) : -1;
  spLayout.scenes.forEach((s, k) => {
    const item = document.createElement('div');
    item.className = 'nav-item sp-scene';
    const next = spLayout.scenes[k + 1];
    if (at >= s.i && (!next || at < next.i)) item.classList.add('current');
    item.innerHTML = '<div class="n-row"><span class="n-num"></span><span class="n-label"></span><span class="n-words"></span></div>';
    item.querySelector('.n-num').textContent = String(k + 1);
    item.querySelector('.n-label').textContent = s.slug || '…';
    item.querySelector('.n-words').textContent = spEighthsText(spEighths(s.lines));
    const row = item.querySelector('.n-row');
    row.draggable = true;
    row.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/x-neo-scene', String(k));
      item.classList.add('dragging');
      $('#nav-pane').classList.add('open');
    });
    row.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      const ind = list.querySelector('.nav-drop-ind');
      if (ind) ind.remove();
    });
    item.onclick = () => {
      switchTab('manuscript');
      const p = s.p;
      if (!p.isConnected) return;
      const body = spBodyOf(p);
      body.focus({ preventScroll: true });
      spCaretToEnd(p);
      spLastPara = p;
      const sc = $('#paper-scroll');
      sc.scrollTop += p.getBoundingClientRect().top - sc.getBoundingClientRect().top - sc.clientHeight / 4;
      updateCounters();
      if (IS_POCKET && $('#nav-pane').dataset.pinned !== '1') $('#nav-pane').classList.remove('open');
    };
    pressable(row, [String(k + 1), s.slug].join(' '));
    list.appendChild(item);
  });
}
// a scene dragged in the pane: it moves, heading and all, to the gold line
(() => {
  const list = $('#nav-list');
  if (!list) return;
  list.addEventListener('dragover', (e) => {
    if (!e.dataTransfer.types.includes('application/x-neo-scene')) return;
    e.preventDefault();
    const ind = navDropInd();
    let placed = false;
    for (const it of list.querySelectorAll('.sp-scene:not(.dragging)')) {
      const r = it.getBoundingClientRect();
      if (e.clientY < r.top + r.height / 2) { list.insertBefore(ind, it); placed = true; break; }
    }
    if (!placed) list.appendChild(ind);
  });
  list.addEventListener('drop', (e) => {
    const from = e.dataTransfer.getData('application/x-neo-scene');
    if (from === '') return;
    e.preventDefault();
    const ind = list.querySelector('.nav-drop-ind');
    let to = spLayout.scenes.length;
    if (ind) {
      to = 0;
      for (const c of list.children) {
        if (c === ind) break;
        if (c.classList.contains('sp-scene')) to++;
      }
      ind.remove();
    }
    spMoveScene(Number(from), to);
  });
})();
// scene k, heading and all, to just before scene `to` (or the end)
function spMoveScene(k, to) {
  const scenes = spLayout.scenes;
  const s = scenes[k];
  if (!s || to === k || to === k + 1 || !s.p.isConnected) return;
  const body = spBodyOf(s.p);
  const nodes = [s.p];
  for (let n = s.p.nextElementSibling; n && !(n.tagName === 'P' && spType(n) === 'heading'); n = n.nextElementSibling) nodes.push(n);
  snapshotStructure('scene moved');
  const target = scenes[to] && scenes[to].p.isConnected ? scenes[to].p : null;
  const dest = target ? spBodyOf(target) : spBodies()[spBodies().length - 1];
  for (const n of nodes) {
    if (target) target.before(n); else dest.appendChild(n);
  }
  if (!body.querySelector('p')) body.innerHTML = '<p><br></p>';
  for (const b of new Set([body, dest])) syncChapter(b, b.closest('.chapter').dataset.id, 'script');
  breakRun++;
  spRepaginate();
  renderNav();
}

// A scene card's Delete: the scene's lines leave the script for Darlings
// (saved there first), its note goes with it, and ⌘Z puts it all back
async function deleteSceneToDarlings(cell, quiet = false) {
  const sc = sceneOfCell(cell);
  if (!sc || !sc.s.p.isConnected) return;
  const nodes = sceneNodes(sc.s);
  const body = spBodyOf(sc.s.p);
  const chId = body.closest('.chapter').dataset.id;
  if (!quiet) snapshotStructure('scene delete');
  const holder = document.createElement('div');
  for (const n of nodes) holder.appendChild(n.cloneNode(true));
  const text = nodes.map((n) => n.textContent).join('\n').trim();
  if (text) {
    darlings.unshift({
      id: 'd-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      html: captureBody(holder),
      text: text.slice(0, 2000),
      chapterId: chId,
      chapterLabel: sc.s.p.textContent.trim() || t('Scene'),
      date: new Date().toISOString()
    });
    try {
      await writeSidecar(book.id, 'darlings', darlings);
    } catch {
      darlings.shift();
      toast(t('NEO couldn’t save to Darlings, so the scene stays where it was'));
      return;
    }
    renderDarlings();
  }
  for (const n of nodes) n.remove();
  if (!body.querySelector('p')) body.innerHTML = '<p><br></p>';
  if (cell.dataset.sid && book.sceneNotes) delete book.sceneNotes[cell.dataset.sid];
  syncChapter(body, chId, 'darling-out');
  clearTimeout(saveTimers[chId]);
  persistChapter(chId).then(() => saveMeta())
    .catch((err) => window.neo.logError('scene delete: ' + (err && err.message || err)));
  breakRun++;
  spRepaginate();
  renderNav();
  renderBoard();
  updateCounters();
  if (text && !quiet) toast(t('Scene removed — its lines are in Darlings, or {key} to undo', { key: KZ }));
}

// ---- the title page: title, "Written by", the writer, and at the foot
// the contact (one for the whole library) and the draft ----
function spTitlePage(on) {
  const page = $('#title-page');
  for (const id of ['tp-credit', 'tp-contact', 'tp-draft']) {
    const old = document.getElementById(id);
    if (old) old.remove();
  }
  if (!on) return;
  const field = (id, ph, value, after, save) => {
    const el = document.createElement('div');
    el.id = id;
    el.contentEditable = 'true';
    el.spellcheck = false;
    el.setAttribute('role', 'textbox');
    el.setAttribute('aria-label', ph);
    el.dataset.ph = ph;
    el.textContent = value || '';
    if (after) after.after(el); else page.appendChild(el);
    el.addEventListener('input', () => save(el.innerText.replace(/\n+$/, '')));
    return el;
  };
  const credit = field('tp-credit', t('Written by'), book.credit === undefined ? t('Written by') : book.credit, $('#tp-subtitle'), (v) => { book.credit = v.trim(); scheduleMetaSave(); });
  credit.addEventListener('keydown', titleEnter);
  const contact = field('tp-contact', t('Contact'), library.scriptContact || '', null, (v) => {
    library.scriptContact = v;
    clearTimeout(spTitlePage.t);
    spTitlePage.t = setTimeout(() => writeLibrary(library), 800);
  });
  contact.setAttribute('aria-multiline', 'true');
  // Enter starts a new line of the block (a line break, not a paragraph)
  const lineBreak = (e) => { if (e.key === 'Enter') { e.preventDefault(); document.execCommand('insertLineBreak'); } };
  contact.addEventListener('keydown', lineBreak);
  const draft = field('tp-draft', t('Draft and date'), book.draft || '', null, (v) => { book.draft = v; scheduleMetaSave(); });
  draft.setAttribute('aria-multiline', 'true');
  draft.addEventListener('keydown', lineBreak);
}

// The look of the editor for a script, or back to a book's
function spEditorMode() {
  const on = isScript();
  const narrow = on && SP_NARROW.matches;
  $('#paper').classList.toggle('script', on);
  $('#paper').classList.toggle('narrow', narrow);
  $('#editor-view').classList.toggle('script-mode', on);
  $('#nav-pane').classList.toggle('script', on);
  // novel and script each keep their own page zoom: entering one applies its own
  applyPageZoom();
  const tabM = $('.tab[data-tab="manuscript"]');
  if (tabM) setText(tabM, on ? t('Script') : t('Manuscript'));
  const tabO = $('.tab[data-tab="outline"]');
  if (tabO) tabO.hidden = false; // a script's outline is its scenes, as cards
  const add = $('#nav-add');
  if (add) add.hidden = on;
  if (!on) setText($('#nav-head span'), t('Chapters'));
  spTitlePage(on);
  spApplyStyle();
  // the pane stays open beside a script, unless the writer unpinned it there
  if (!NO_HOVER) {
    let kept = {};
    try { kept = JSON.parse(localStorage.getItem('neo-pinned-panes') || '{}'); } catch { /* nothing kept */ }
    pinPane('nav', on ? kept.scriptNav !== false : !!kept.nav, on ? 'scriptNav' : 'nav');
  }
}
if (SP_NARROW.addEventListener) {
  SP_NARROW.addEventListener('change', () => { if (book && isScript() && !$('#editor-view').hidden) { const c = captureCaret(); renderChapters(); restoreCaret(c); } });
}
window.addEventListener('resize', () => { if (book && isScript() && $('#paper').classList.contains('narrow')) spSchedule(200); });

// Pasting into a script: lines copied from a script keep their elements,
// and a script pasted as plain text (Fountain, or copied from a PDF) is
// read line by line the way Fountain reads it
function spPaste(e, body, chId) {
  const html = e.clipboardData.getData('text/html');
  const text = e.clipboardData.getData('text/plain');
  let lines = null;
  if (html && /class="[^"]*\bsp-|script-body/.test(html)) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    lines = [...doc.body.querySelectorAll('p')].map((p) => ({ type: spType(p), html: paraRuns(p.innerHTML, false).filter((r) => r.text).map(runHtml).join('') }));
  } else if (text && /\n/.test(text.trim())) {
    lines = spFromFountain(text).map((l) => ({ type: l.type, newPage: l.newPage, html: spRunsFromFountain(l.text).map((x) => runHtml(x)).join('') }));
  }
  if (!lines || !lines.length) return false;
  e.preventDefault();
  if (lines.length > 60) { spPasteMany(lines, body, chId); return true; }
  const marker = 'sp' + Date.now().toString(36);
  const out = lines.map((l, i) => `<p${l.type === 'action' ? '' : ` class="sp-${l.type}"`}${i === lines.length - 1 ? ` data-sp-paste="${marker}"` : ''}>${l.html || '<br>'}</p>`).join('');
  document.execCommand('insertHTML', false, out);
  stripJunkSpans(body);
  const last = body.querySelector(`p[data-sp-paste="${marker}"]`);
  if (last) last.removeAttribute('data-sp-paste');
  for (const p of body.querySelectorAll('p[data-sp-paste]')) p.removeAttribute('data-sp-paste');
  for (const p of body.querySelectorAll('p')) {
    for (const a of ['style']) if (p.getAttribute(a) && !/text-align/.test(p.getAttribute(a))) p.removeAttribute(a);
  }
  syncChapter(body, chId, 'script');
  spSchedule();
  return true;
}

// Lines joined by a delete: the engine keeps the upper line and pours the
// lower one into it. When the upper line goes entirely (a shot selected and
// deleted, an empty line Backspaced away from below), what's left is the
// lower line, so it stays what it was: a scene heading stays a heading, and
// its card keeps its note. NEO makes that cut itself; ⌘Z puts it back.
document.addEventListener('beforeinput', (e) => {
  const body = e.target && e.target.closest ? e.target.closest('.script-body') : null;
  if (!body || e.defaultPrevented || !/^delete(Content|Word|SoftLine|HardLine|ByCut)/.test(e.inputType || '')) return;
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const r = sel.getRangeAt(0);
  const lineOf = (n) => {
    const el = n && n.nodeType === Node.TEXT_NODE ? n.parentElement : n;
    const p = el && el.closest ? el.closest('p') : null;
    return p && p.parentElement === body ? p : null;
  };
  let upper = null;
  let lower = null;
  if (!r.collapsed) {
    upper = lineOf(r.startContainer);
    lower = lineOf(r.endContainer);
    if (!upper || !lower || upper === lower) return;
    // the upper line keeps words: the join is the engine's, as usual
    const before = document.createRange();
    before.selectNodeContents(upper);
    before.setEnd(r.startContainer, r.startOffset);
    if (before.toString().length) return;
  } else if (/Backward$/.test(e.inputType)) {
    lower = lineOf(r.startContainer);
    upper = lower && lower.previousElementSibling;
    if (!upper || upper.tagName !== 'P' || upper.textContent.length || !spCaretAtStart(lower)) return;
  } else if (/Forward$/.test(e.inputType)) {
    upper = lineOf(r.startContainer);
    lower = upper && upper.nextElementSibling;
    if (!lower || lower.tagName !== 'P' || upper.textContent.length) return;
  } else return;
  e.preventDefault();
  const chId = spChapterOf(lower);
  snapshotStructure('lines removed');
  if (!r.collapsed) {
    const cut = document.createRange();
    cut.setStart(lower, 0);
    cut.setEnd(r.endContainer, r.endOffset);
    cut.deleteContents();
  }
  const upperType = spType(upper);
  for (let n = upper; n && n !== lower;) { const next = n.nextElementSibling; n.remove(); n = next; }
  if (!lower.textContent && !lower.querySelector('br')) lower.appendChild(document.createElement('br'));
  // nothing of the lower line left: the line is the one the selection began
  // on, and a script cleared whole (⌘A, Delete) starts over as action, as a
  // new one does. Kept as the last line's dialogue, Return only changed the
  // element and "int." never became a heading (#359)
  if (!lower.textContent.trim()) spSetClass(lower, body.children.length === 1 ? 'action' : upperType);
  placeCaret(lower, 0);
  syncChapter(body, chId, 'script');
  breakRun++;
  spAfterChange(lower);
}, true);

// A whole script pasted in: the engine's own paste takes seconds per few
// hundred lines (and minutes for a feature), so the lines go straight onto
// the page, and ⌘Z takes the paste back as one move
function spPasteMany(lines, body, chId) {
  snapshotStructure('paste');
  const sel = window.getSelection();
  if (!sel.isCollapsed) document.execCommand('delete');
  let p = caretBlock(body);
  let atEnd = false;
  if (!p) {
    // a caret on the page itself, between its lines: the line beside it
    const kids = [...body.children].filter((c) => c.tagName === 'P');
    p = sel.anchorNode === body ? kids[Math.min(sel.anchorOffset, kids.length - 1)] : kids[kids.length - 1];
    atEnd = true;
    if (!p) { p = document.createElement('p'); p.innerHTML = '<br>'; body.appendChild(p); }
  }
  // the words after the caret wait below what's pasted, as a line of their own
  const tail = document.createRange();
  try {
    if (atEnd) throw new Error('at the line\'s end');
    tail.setStart(sel.anchorNode, sel.anchorOffset);
  } catch { tail.setStart(p, p.childNodes.length); }
  tail.setEnd(p, p.childNodes.length);
  const after = tail.extractContents();
  const frag = document.createDocumentFragment();
  let last = null;
  for (const l of lines) {
    const q = document.createElement('p');
    if (l.type !== 'action') q.className = 'sp-' + l.type;
    if (l.newPage) q.setAttribute('data-newpage', '');
    q.innerHTML = l.html || '<br>';
    frag.appendChild(q);
    last = q;
  }
  if (after.textContent) {
    const q = p.cloneNode(false);
    spCleanMarks(q);
    q.appendChild(after);
    frag.appendChild(q);
  }
  p.after(frag);
  if (!p.textContent.trim() && !p.querySelector('.ph-mark')) p.remove();
  spCaretToEnd(last);
  syncChapter(body, chId, 'script');
  resetNativeUndo();
  breakRun++;
  spSchedule();
  revealCaret();
}

// A .fountain or .fdx file, dropped on a shelf or picked with Import: a new
// script on that shelf, title page and all
async function importScript(r, shelf) {
  const parsed = r.script === 'fdx'
    ? spFromFdx(r.source)
    : { lines: spFromFountain(r.source).map((l) => ({ type: l.type, newPage: l.newPage, runs: spRunsFromFountain(l.text) })), title: spFountainTitle(r.source) };
  if (!parsed.lines.length) return false;
  const tp = parsed.title || {};
  const title = tp.title || r.name;
  const meta = await window.neo.createBook({ author: tp.author || displayAuthor(), title });
  const chId = 'ch-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  const html = parsed.lines.map((l) => `<p${l.type === 'action' ? '' : ` class="sp-${l.type}"`}${l.newPage ? ' data-newpage=""' : ''}>${l.runs.map((x) => runHtml(x)).join('') || '<br>'}</p>`).join('');
  await window.neo.writeChapter(meta.id, chId, html);
  meta.title = title;
  meta.format = 'screenplay';
  meta.chapterOrder = [chId];
  meta.credit = tp.credit || t('Written by');
  if (tp.titleStyle) meta.titleStyle = tp.titleStyle;
  if (tp.draft) meta.draft = tp.draft;
  meta.tabNames = { notes: (library.tabDefaults && library.tabDefaults.notes) || 'Notes', outline: 'Outline' };
  meta.wordCount = parsed.lines.reduce((n, l) => n + countWords(l.runs.map((x) => x.text).join('')), 0);
  // the contact block is the writer's, for every script: one carried in
  // fills it only when it's still empty
  if (tp.contact && !library.scriptContact) library.scriptContact = tp.contact;
  await writeBookMeta(meta.id, meta);
  await placeTitle(shelf, meta.id);
  return true;
}

// ---- out of NEO: the PDF, as the industry prints a script, and Fountain ----
// The script's lines for the exports: each with its element, its runs of
// bold/italic/underline, and (CONT'D) where the screen shows it
function spExportLines() {
  const lines = [];
  for (const chId of book.chapterOrder) {
    const holder = cleanChapterEl(chId);
    for (const p of holder.querySelectorAll('p')) {
      const runs = paraRuns(p.innerHTML, false).filter((r) => r.text && r.mark === undefined);
      const text = runs.map((r) => r.text).join('').replace(/\s+$/, '');
      lines.push({ type: spType(p), runs, text, newPage: p.hasAttribute('data-newpage') });
    }
  }
  const plain = lines.map((l) => ({ type: l.type, text: l.text }));
  lines.forEach((l, i) => { l.contd = spContdOn() && l.type === 'character' && spContd(plain, i); });
  return lines;
}
// The script's own style (Format menu, while a script is open): scene
// headings underlined as well as bold, which some studios ask for, and
// whether a returning speaker gets (CONT'D). Kept in the script's book.json.
const spContdOn = () => !book || book.contd !== false;
const spUnderlineOn = () => !!(book && book.underlineHeadings);
function spApplyStyle() {
  $('#paper').classList.toggle('sp-uline', isScript() && spUnderlineOn());
}
const SP_CAPS = ['heading', 'character', 'transition', 'shot'];
function spRunsHtml(l) {
  const caps = SP_CAPS.includes(l.type);
  return l.runs.map((r) => runHtml({ ...r, text: caps ? r.text.toUpperCase() : r.text })).join('') + (l.contd ? " (CONT'D)" : '');
}
async function spPdfHtml() {
  // (an empty line that starts a page passes its page on to the next one)
  const all = spExportLines();
  all.forEach((l, i) => { if (l.newPage && !l.text.trim() && all[i + 1]) all[i + 1].newPage = true; });
  const lines = all.filter((l, i) => l.text.trim() || (i > 0 && i < all.length - 1));
  // lay the lines out off screen, as they print, to count them
  const holder = document.createElement('div');
  const ps = lines.map((l) => {
    const p = document.createElement('p');
    if (l.type !== 'action') p.className = 'sp-' + l.type;
    p.innerHTML = spRunsHtml(l) || '<br>';
    holder.appendChild(p);
    return p;
  });
  await document.fonts.load('1em "Courier Prime"').catch(() => {});
  const counts = spMeasure(ps, false);
  const pg = spPaginate(lines.map((l, i) => ({ type: l.type, lines: counts[i], newPage: l.newPage })));
  const pages = [];
  lines.forEach((l, i) => {
    const a = pg.at[i];
    if (!pages[a.page - 1]) pages[a.page - 1] = [];
    const cls = l.type === 'action' ? '' : ` class="sp-${l.type}"`;
    const html = spRunsHtml(l) || '&nbsp;';
    pages[a.page - 1].push(`<p${cls} style="margin-top:${a.before}em">${html}</p>`);
    // longer than the room left on its page: the rest is carried onto the
    // pages after, each showing the next slice of the same paragraph
    let shown = SP_LINES_PER_PAGE - (a.top || 0);
    for (let k = a.page; shown < counts[i]; k++) {
      if (!pages[k]) pages[k] = [];
      pages[k].push(`<p${cls} style="margin-top:-${shown}em">${html}</p>`);
      shown += SP_LINES_PER_PAGE;
    }
  });
  const esc = (s) => escHtml(String(s || ''));
  const title = book.title && !isUntitled(book.title) ? book.title : t('Untitled');
  const credit = book.credit === undefined ? t('Written by') : book.credit;
  const fonts = await spFontFaces();
  const lines2 = (s) => esc(s).replace(/\n/g, '<br>');
  const titlePage = `<div class="page title">
    <div class="tp-main"><div class="tp-t${['b', 'u', 'i'].filter((k) => (book.titleStyle || {})[k]).map((k) => ' tp-' + k).join('')}">${esc(title.toUpperCase())}</div>${credit ? `<div class="gap">${esc(credit)}</div>` : ''}<div class="${credit ? '' : 'gap'}">${esc(book.author || '')}</div></div>
    <div class="tp-contact">${lines2(library.scriptContact || '')}</div>
    <div class="tp-draft">${lines2(book.draft || '')}</div>
  </div>`;
  const body = pages.map((rows, k) => `<div class="page">${k ? `<div class="num">${k + 1}.</div>` : ''}<div class="room">${(rows || []).join('')}</div></div>`).join('');
  return `<!DOCTYPE html><html lang="${escHtml(writingLanguage())}"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
${fonts}
@page { size: 8.5in 11in; margin: 0; }
html, body { margin: 0; padding: 0; background: #fff; }
body { font-family: 'Courier Prime', 'Courier New', Courier, monospace; font-size: 12pt; line-height: 12pt; color: #000; }
.page { width: 8.5in; height: 11in; box-sizing: border-box; padding: 1in 1in 0 1.5in; position: relative; overflow: hidden; break-after: page; }
.page:last-child { break-after: auto; }
.num { position: absolute; top: 0.5in; right: 1in; }
.room { height: ${SP_LINES_PER_PAGE}em; overflow: hidden; }
p { margin: 0; width: 36.3em; white-space: pre-wrap; overflow-wrap: anywhere; }
p.sp-character { margin-left: 13.2em; width: 23.1em; }
p.sp-paren { margin-left: 9.6em; width: 15.3em; }
p.sp-dialogue { margin-left: 6em; width: 21.3em; }
p.sp-transition { text-align: right; }
p.sp-heading, p.sp-shot { font-weight: bold; }
${spUnderlineOn() ? 'p.sp-heading { text-decoration: underline; }' : ''}
.title { text-align: center; }
.tp-main { position: absolute; top: 3.5in; left: 1.5in; width: 6in; }
.tp-main .gap { margin-top: 2em; }
.tp-t.tp-b { font-weight: bold; } .tp-t.tp-u { text-decoration: underline; } .tp-t.tp-i { font-style: italic; }
.tp-main div + div:not(.gap) { margin-top: 1em; }
.tp-contact { position: absolute; left: 1.5in; bottom: 1in; width: 3.5in; text-align: left; }
.tp-draft { position: absolute; right: 1in; bottom: 1in; width: 2.5in; text-align: right; }
</style></head><body>${titlePage}${body}</body></html>`;
}
// Courier Prime travels inside the PDF
async function spFontFaces() {
  let css = '';
  for (const sheet of document.styleSheets) {
    let rules = [];
    try { rules = [...sheet.cssRules]; } catch { continue; }
    for (const r of rules) {
      if (!(r instanceof CSSFontFaceRule)) continue;
      if (r.style.getPropertyValue('font-family').replace(/["']/g, '').trim() !== 'Courier Prime') continue;
      const src = r.style.getPropertyValue('src').match(/url\(["']?([^"')]+)["']?\)/);
      if (!src) continue;
      try {
        const bytes = new Uint8Array(await (await fetch(new URL(src[1], sheet.href || location.href))).arrayBuffer());
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        const range = r.style.getPropertyValue('unicode-range');
        css += `@font-face { font-family: 'Courier Prime'; src: url(data:font/woff2;base64,${btoa(bin)}) format('woff2'); font-weight: ${r.style.getPropertyValue('font-weight') || 400}; font-style: ${r.style.getPropertyValue('font-style') || 'normal'};${range ? ` unicode-range: ${range};` : ''} }\n`;
      } catch { /* the PDF falls back on Courier */ }
    }
  }
  return css;
}
// Runs as marked-up text (Markdown, Fountain): a mark opens where its style
// starts and closes where it ends, hugging the words, so runs that touch
// ("un" + bold-italic "believ" + "able") come out as **un*believ*able**,
// not as markers piled into each other
function markedRuns(runs, marks, esc) {
  let out = '';
  const open = [];
  const closeTo = (want) => {
    const k = open.findIndex((key) => !want[key]);
    if (k === -1) return;
    const shut = open.splice(k).reverse().map((key) => marks.find((m) => m.key === key).close).join('');
    const ws = out.match(/\s*$/)[0];
    out = out.slice(0, out.length - ws.length) + shut + ws;
  };
  for (const r of runs) {
    if (r.mark !== undefined) continue;
    const text = esc(r.text || '');
    if (!text.trim()) { out += text; continue; }
    const want = {};
    for (const m of marks) want[m.key] = !!r[m.key];
    closeTo(want);
    const lead = text.match(/^\s*/)[0];
    const opening = marks.filter((m) => want[m.key] && !open.includes(m.key));
    open.push(...opening.map((m) => m.key));
    out += lead + opening.map((m) => m.open).join('') + text.slice(lead.length);
  }
  closeTo({});
  return out;
}

function spFountain() {
  const marks = [{ key: 'b', open: '**', close: '**' }, { key: 'i', open: '*', close: '*' }, { key: 'u', open: '_', close: '_' }];
  const lines = spExportLines().map((l) => ({
    type: l.type,
    newPage: l.newPage,
    text: markedRuns(l.runs, marks, (t) => t.replace(/([\\*_])/g, '\\$1'))
  }));
  return spToFountain(lines, spTitleFields());
}
// what the title page says, for the files a script leaves as
function spTitleFields() {
  return {
    title: book.title && !isUntitled(book.title) ? book.title : '',
    titleStyle: book.titleStyle || null,
    credit: book.credit === undefined ? t('Written by') : book.credit,
    author: book.author || '',
    draft: book.draft || '',
    contact: library.scriptContact || ''
  };
}
async function spExport(format) {
  flushAllSaves();
  const defaultName = safeName(book.title);
  try {
    let payload;
    if (format === 'pdf') payload = { format: 'pdf', defaultName, content: await spPdfHtml(), print: 'screenplay' };
    else if (format === 'fdx') payload = { format: 'fdx', defaultName, content: spToFdx(spExportLines(), { ...spTitleFields(), underlineHeadings: spUnderlineOn() }) };
    else payload = { format: 'fountain', defaultName, content: spFountain() };
    const saved = await window.neo.exportSave(payload);
    if (saved) toast(t('Exported: {file}', { file: saved.split('/').pop() }));
  } catch (err) {
    window.neo.logError('export ' + format + ': ' + (err && err.stack || err));
    toast(t('Couldn’t export: {error}', { error: plainError(err) }), 8000);
  }
}

// ---- the shelf: a new script, and its tile ----
async function createScriptOnShelf(shelf) {
  const meta = await window.neo.createBook({ author: displayAuthor() });
  const chId = 'ch-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  await window.neo.writeChapter(meta.id, chId, '<p><br></p>');
  meta.format = 'screenplay';
  meta.chapterOrder = [chId];
  meta.credit = t('Written by');
  meta.tabNames = { notes: (library.tabDefaults && library.tabDefaults.notes) || 'Notes', outline: 'Outline' };
  await writeBookMeta(meta.id, meta);
  await placeTitle(shelf, meta.id);
  await writeLibrary(library);
  await openBook(meta.id);
}
function scriptTile(el, meta) {
  el.classList.add('script-tile');
  el.innerHTML = `
    <div class="st-text"><div class="st-title"></div><div class="st-author"></div></div>
    <span class="st-brad top"></span><span class="st-hole"></span><span class="st-brad bot"></span>
    <div class="b-progress" hidden><div></div></div>`;
  const title = isUntitled(meta.title) ? t('Untitled') : meta.title;
  const tEl = el.querySelector('.st-title');
  tEl.textContent = title;
  tEl.classList.toggle('long', title.length > 36);
  el.querySelector('.st-author').textContent = meta.author || '';
}

/* ================================================================== */
/*  PLACEHOLDERS + STICKIES                                            */
/* ================================================================== */

function insertPlaceholder() {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  // derive the chapter from where the caret actually is:
  let el = sel.anchorNode;
  if (el && el.nodeType === Node.TEXT_NODE) el = el.parentElement;
  const bodyEl = el && el.closest ? el.closest('.chapter-body') : null;
  if (!bodyEl) {
    toast(t('Click into a chapter first, then {key} drops a placeholder', { key: KPH }));
    return;
  }
  currentChapterId = bodyEl.closest('.chapter').dataset.id;
  const sid = 's-' + Date.now().toString(36);
  const span = document.createElement('span');
  span.className = 'ph-mark';
  span.dataset.sid = sid;
  span.contentEditable = 'false';
  span.textContent = '⚑';
  const range = sel.getRangeAt(0);
  range.collapse(false);
  range.insertNode(span);
  // park the caret just past the mark and keep writing
  const after = document.createTextNode(' ');
  span.after(after);
  range.setStartAfter(after);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);

  stickies.push({ id: sid, chapterId: currentChapterId, text: '', resolved: false });
  writeStickies(book.id, stickies);
  setChapterHTML(currentChapterId, captureBody(document.querySelector(
    `.chapter[data-id="${currentChapterId}"] .chapter-body`
  )), 'mark');
  scheduleChapterSave(currentChapterId);
  renderStickies();
  scheduleNavRefresh();
  // the caret lands in the note: type what needs doing, Enter brings you
  // back to the page just past the flag (Shift+Enter for another line)
  const pane = $('#side-pane');
  pane.dataset.autoOpened = pane.classList.contains('open') ? '0' : '1';
  focusSticky(sid);
}

// Back to the manuscript, caret just past the flag. Scrolls only when the
// flag isn't already on screen, and from wherever the page is now.
function returnToMark(sid) {
  if (currentTab !== 'manuscript') switchTab('manuscript');
  const mark = document.querySelector(`.ph-mark[data-sid="${sid}"]`);
  if (!mark) return;
  const bodyEl = mark.closest('.chapter-body');
  const scroller = $('#paper-scroll');
  const r = mark.getBoundingClientRect();
  const sr = scroller.getBoundingClientRect();
  if (r.top < sr.top + 40 || r.bottom > sr.bottom - 40) mark.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
  if (!bodyEl) return;
  currentChapterId = bodyEl.closest('.chapter').dataset.id;
  bodyEl.focus({ preventScroll: true });
  const range = document.createRange();
  const next = mark.nextSibling;
  if (next && next.nodeType === Node.TEXT_NODE) range.setStart(next, Math.min(1, next.textContent.length));
  else range.setStartAfter(mark);
  range.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  highlightNav();
}

function renderStickies() {
  const wrap = $('#sticky-list');
  wrap.innerHTML = '';
  const open = stickies.filter((s) => !s.resolved);
  if (open.length === 0) {
    wrap.innerHTML = `<div class="stickies-empty">${t('No notes yet.')}<br><br>${t('Hit {key} while writing to drop a placeholder — a “come back to this” mark that never breaks your flow.', { key: KPH })}</div>`;
    return;
  }
  for (const s of open) {
    const chIdx = book.chapterOrder.indexOf(s.chapterId);
    const el = document.createElement('div');
    el.className = 'sticky unresolved';
    el.dataset.sid = s.id;
    el.innerHTML = `
      <div class="s-ch">${chIdx >= 0 ? escHtml(stickyChapterLabel(s.chapterId)) : t('Unplaced')}</div>
      <textarea placeholder="${t('What needs doing here?')}" spellcheck="false"></textarea>
      <div class="s-actions"><button class="s-go">${t('Go to')}</button><span class="s-sep">·</span><button class="s-done">${t('Resolve')}</button></div>`;
    const ta = el.querySelector('textarea');
    ta.value = s.text;
    ta.addEventListener('focus', () => markCurrentSticky(s.id));
    ta.addEventListener('input', () => {
      s.text = ta.value;
      scheduleStickiesSave();
    });
    ta.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.shiftKey) return; // Shift+Enter: another line in the note
      e.preventDefault();
      const pane = $('#side-pane');
      if (pane.dataset.autoOpened === '1' && pane.dataset.pinned !== '1') pane.classList.remove('open');
      pane.dataset.autoOpened = '0';
      returnToMark(s.id);
    });
    el.querySelector('.s-go').onclick = () => returnToMark(s.id);
    el.querySelector('.s-done').onclick = () => resolveSticky(s.id);
    wrap.appendChild(el);
  }
}

// A note is saved a moment after the last keystroke. The save belongs to the
// book it was typed in: leaving the book (Esc to the shelf) writes it at once
// instead of letting the timer find no book, which lost the note's text.
function scheduleStickiesSave() {
  if (!book) return;
  const bookId = book.id;
  const list = stickies;
  clearTimeout(saveTimers.stickies);
  saveTimers.stickies = setTimeout(() => {
    delete saveTimers.stickies;
    writeStickies(bookId, list);
  }, 600);
}

// stickies.json, and its text in the recording
function writeStickies(bookId, list, cause = 'edit') {
  if (book && book.id === bookId && list === stickies) rec.streams(cause, [Rec.STREAMS.stickies]);
  return writeSidecar(bookId, 'stickies', list);
}

function flushStickiesSave() {
  if (!saveTimers.stickies || !book) return;
  clearTimeout(saveTimers.stickies);
  delete saveTimers.stickies;
  writeStickies(book.id, stickies);
}

// Pair every mark in the manuscript with a note: pasted duplicates get their
// own copy of the note, marks that moved chapters update their red dot, and
// marks orphaned by older versions get a fresh (empty) note instead of dying.
function reconcileMarks() {
  if (!book) return;
  const seen = new Set();
  let changed = false;
  for (const m of document.querySelectorAll('.chapter-body .ph-mark')) {
    let sid = m.dataset.sid;
    if (!sid) continue;
    const chEl = m.closest('.chapter');
    const chId = chEl ? chEl.dataset.id : null;
    const existing = stickies.find((s) => s.id === sid);
    if (seen.has(sid)) {
      const nid = 's-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 5);
      m.dataset.sid = nid;
      stickies.push({ id: nid, chapterId: chId, text: existing ? existing.text : '', resolved: false });
      seen.add(nid);
      changed = true;
      continue;
    }
    if (!existing) {
      stickies.push({ id: sid, chapterId: chId, text: '', resolved: false });
      changed = true;
    } else if (existing.chapterId !== chId) {
      existing.chapterId = chId;
      changed = true;
    }
    seen.add(sid);
  }
  if (changed) {
    writeStickies(book.id, stickies);
    renderStickies();
    renderNav();
  }
}

function resolveSticky(sid) {
  const mark = document.querySelector(`.ph-mark[data-sid="${sid}"]`);
  if (mark) {
    const chId = mark.closest('.chapter').dataset.id;
    const prev = mark.previousSibling;
    const next = mark.nextSibling;
    mark.remove();
    // tidy the seam: old flags parked a no-break space after themselves,
    // and removing a flag between two spaces shouldn't leave both
    if (next && next.nodeType === Node.TEXT_NODE) next.data = next.data.replace(/^\u00a0/, ' ');
    if (prev && prev.nodeType === Node.TEXT_NODE) prev.data = prev.data.replace(/\u00a0$/, ' ');
    if (prev && next && prev.nodeType === Node.TEXT_NODE && next.nodeType === Node.TEXT_NODE &&
        / $/.test(prev.data) && /^ /.test(next.data)) {
      next.data = next.data.slice(1);
    }
    const body = document.querySelector(`.chapter[data-id="${chId}"] .chapter-body`);
    try { body.normalize(); } catch { /* fine */ }
    setChapterHTML(chId, captureBody(body), 'mark');
    scheduleChapterSave(chId);
  }
  stickies = stickies.filter((s) => s.id !== sid);
  writeStickies(book.id, stickies);
  renderStickies();
  scheduleNavRefresh();
}

// the note being worked on stands out in the pane (#351): the one whose
// mark was just clicked in the text, or whose words are being edited
function markCurrentSticky(sid) {
  for (const s of document.querySelectorAll('.sticky.current')) if (s.dataset.sid !== sid) s.classList.remove('current');
  const el = sid && document.querySelector(`.sticky[data-sid="${sid}"]`);
  if (el) el.classList.add('current');
}

function focusSticky(sid) {
  $('#side-pane').classList.add('open');
  const el = document.querySelector(`.sticky[data-sid="${sid}"] textarea`);
  if (!el) return;
  markCurrentSticky(sid);
  el.closest('.sticky').scrollIntoView({ block: 'nearest', behavior: scrollBehavior() });
  el.focus({ preventScroll: true });
}

/* ================================================================== */
/*  NAV PANE                                                           */
/* ================================================================== */

let chapterDragActive = false;
let navRefreshPending = false;

function renderNav() {
  if (!book) return; // a refresh queued just before the shelf came back
  // Replacing the source row during a native drag can interrupt its lifecycle.
  if (chapterDragActive) { navRefreshPending = true; return; }
  // a chapter note being written in the pane isn't pulled out from under
  // the writer: the pane catches up when they leave the note
  const editingNote = document.activeElement && document.activeElement.closest && document.activeElement.closest('#nav-list .nav-note[contenteditable="true"]');
  if (editingNote) {
    navRefreshPending = true;
    if (!editingNote.dataset.catchUp) {
      editingNote.dataset.catchUp = '1';
      editingNote.addEventListener('blur', () => { setTimeout(() => { if (navRefreshPending) renderNav(); }, 0); }, { once: true });
    }
    return;
  }
  navRefreshPending = false;
  if (isScript()) { renderScriptNav(); return; }
  const list = $('#nav-list');
  // a keyboard user on a chapter row keeps their place through the rebuild
  const focusedRow = document.activeElement && document.activeElement.classList.contains('n-row') &&
    document.activeElement.matches(':focus-visible') ? document.activeElement.closest('.nav-item').dataset.id : null;
  list.innerHTML = '';
  book.chapterNotes = book.chapterNotes || {};
  const solo = soloStory();
  // the book from top to bottom: a faint + between the boxes (and above and
  // below them) adds a chapter, a part or a page right there
  const gap = (at) => {
    const g = document.createElement('div');
    g.className = 'nav-gap';
    const plus = document.createElement('button');
    plus.className = 'ng-plus';
    plus.tabIndex = -1;
    plus.textContent = '+';
    plus.setAttribute('aria-label', t('Add'));
    const add = (e) => { e.preventDefault(); e.stopPropagation(); addEntryMenu(at, e.clientX, e.clientY, plus); };
    plus.addEventListener('click', add);
    plus.addEventListener('contextmenu', add);
    g.appendChild(plus);
    return g;
  };
  let inPart = false;
  book.chapterOrder.forEach((chId, i) => {
    const kind = chapterKind(chId);
    const story = STORY_KINDS.includes(kind);
    // a part gathers what follows it, up to the next part or the back of the book
    if (kind === 'part') inPart = true;
    else if (BACK_KINDS.includes(kind)) inPart = false;
    const words = story ? chapterWords(chId) : 0;
    const flagged = !!document.querySelector(`.chapter[data-id="${chId}"] .ph-mark`);
    const chTitle = story ? (book.chapterTitles || {})[chId] : '';
    const item = document.createElement('div');
    item.className = `nav-item kind-${kind}` + (story ? '' : ' nav-page') + (inPart && kind !== 'part' ? ' in-part' : '') +
      (chId === currentChapterId ? ' current' : '') + (chId === justAddedEntry ? ' just-added' : '');
    item.dataset.id = chId;
    item.innerHTML = `<div class="n-row" title="${t('Drag to reorder chapters')}"><span class="n-label"></span>
      <span style="display:flex;align-items:center">${story ? `<span class="n-words">${fmtNum(words)}</span>` : ''}${flagged ? `<span class="n-flag" title="${t('Unresolved placeholder')}"></span>` : ''}</span></div>`;
    item.querySelector('.n-label').textContent = chId === solo
      ? (book.title ? shownTitle(book.title) : t('The story'))
      : (chTitle ? `${chapterMark(chId)} · ${chTitle}` : chapterName(chId));

    // the row is the drag handle, so the note below stays freely editable
    const rowEl = item.querySelector('.n-row');
    rowEl.draggable = true;
    rowEl.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/x-neo-chapter', chId);
      chapterDragActive = true;
      $('#nav-pane').classList.add('open');
      item.classList.add('dragging');
    });
    rowEl.addEventListener('dragend', finishChapterDrag);
    // right-click: what it is, or Delete
    item.addEventListener('contextmenu', (e) => {
      if (IS_POCKET) { e.preventDefault(); return; } // on a phone this pane is for hopping
      if (e.target.closest('.nav-note[contenteditable="true"]')) return; // the note's own text menu
      e.preventDefault();
      chapterMenu(chId, e.clientX, e.clientY, rowEl);
    });

    if (story && IS_POCKET) {
      // on a phone this pane is for hopping: a tap anywhere on the box
      // goes there. The note is read here and written in the Outline.
      const note = document.createElement('div');
      note.className = 'nav-note nav-note-ro';
      note.textContent = book.chapterNotes[chId] || '';
      item.appendChild(note);
    } else if (story) {
      // outline your whole book from this panel:
      const note = document.createElement('div');
      note.className = 'nav-note';
      note.contentEditable = 'true';
      note.spellcheck = false;
      note.textContent = book.chapterNotes[chId] || '';
      note.setAttribute('role', 'textbox');
      note.setAttribute('aria-label', t('Outline note'));
      note.setAttribute('aria-placeholder', t('What happens here…'));
      note.addEventListener('click', (e) => e.stopPropagation());
      note.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); note.blur(); }
        e.stopPropagation();
      });
      note.addEventListener('blur', () => {
        book.chapterNotes[chId] = note.textContent.trim();
        scheduleMetaSave();
      });
      item.appendChild(note);
    } else if (kind !== 'contents') {
      // a page shows the start of what it says
      const peek = document.createElement('div');
      peek.className = 'nav-note nav-peek';
      peek.textContent = entryPeek(chId);
      if (!peek.textContent && PAGE_PROMPTS[kind]) { peek.dataset.ph = PAGE_PROMPTS[kind](); peek.classList.add('blank'); }
      item.appendChild(peek);
    }

    item.onclick = () => {
      switchTab('manuscript');
      if (IS_POCKET) {
        // the top of the chapter, and the pane steps aside for the page
        const sec = document.querySelector(`.chapter[data-id="${chId}"]`);
        focusChapterStart(chId);
        if (sec) sec.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
        if ($('#nav-pane').dataset.pinned !== '1') $('#nav-pane').classList.remove('open');
        return;
      }
      focusChapter(chId);
    };
    // from the keyboard, the row is the chapter's button (F6 reaches the pane)
    pressable(rowEl, [
      item.querySelector('.n-label').textContent,
      story ? t('{n} words', { n: words }) : '',
      flagged ? t('Unresolved placeholder') : ''
    ].filter(Boolean).join(', '));
    list.appendChild(gap(i));
    list.appendChild(item);
    if (chId === focusedRow) rowEl.focus({ preventScroll: true });
  });
  list.appendChild(gap(book.chapterOrder.length));
  justAddedEntry = null;
  renderContentsLists();
}

// the first words of a page, for its box in the Chapters pane
function entryPeek(chId) {
  const el = document.querySelector(`.chapter[data-id="${chId}"] .chapter-body`);
  const holder = document.createElement('template');
  holder.innerHTML = el ? el.innerHTML : (chapterHTML[chId] || '');
  const first = [...holder.content.querySelectorAll('p:not(.ghost):not(.scene-break)')].map((p) => p.textContent.trim()).find(Boolean);
  return first || '';
}

// The + between two boxes: which kind, then it's there, in place
let justAddedEntry = null;
async function addEntryMenu(at, x, y, from) {
  const hasContents = book.chapterOrder.some((c) => chapterKind(c) === 'contents');
  const kind = await popMenu(x, y, CHAPTER_KINDS.map((k) => ({ label: kindName(k), value: k, disabled: k === 'contents' && hasContents })), { from });
  if (!kind) return;
  addEntry(at, kind);
}
function addEntry(at, kind) {
  switchTab('manuscript');
  snapshotStructure('add ' + kind);
  const chId = newEntryId();
  justAddedEntry = chId;
  book.chapterOrder.splice(at, 0, chId);
  setChapterKind(chId, kind);
  setChapterHTML(chId, kind === 'copyright' ? copyrightStarter() : '<p><br></p>', 'new');
  persistChapter(chId);
  saveMeta();
  renderChapters();
  // the new page is ready to write on (the contents, to look at)
  if (kind === 'copyright') focusChapter(chId); else focusChapterStart(chId);
  document.querySelector(`.chapter[data-id="${chId}"]`).scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
  updateCounters();
  if (currentTab === 'outline') renderOutline();
  return chId;
}
const newEntryId = () => 'ch-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);

// The contents, in the manuscript: the parts, the chapters and the pages at
// the back, as the reader will find them, each one a way there
function bookContents(meta = book) {
  const solo = soloStory(meta);
  const out = [];
  let inPart = false;
  for (const chId of meta.chapterOrder) {
    const kind = chapterKind(chId, meta);
    if (kind === 'part') inPart = true;
    else if (BACK_KINDS.includes(kind)) inPart = false;
    if (['copyright', 'dedication', 'epigraph', 'contents'].includes(kind) || chId === solo) continue;
    let label = STORY_KINDS.includes(kind) ? chapterHeading(chId, meta) || chapterName(chId, meta) : chapterName(chId, meta);
    if (kind === 'part') {
      const partTitle = partTitleOf(chId);
      if (partTitle) label += ': ' + partTitle;
    }
    out.push({ chId, label, type: kind === 'part' ? 'part' : STORY_KINDS.includes(kind) ? 'chapter' : 'page', level: inPart && kind !== 'part' ? 1 : 0 });
  }
  return out;
}
// a part's title is the first line of its page (what follows is its quote)
function partTitleOf(chId) {
  const el = document.querySelector(`.chapter[data-id="${chId}"] .chapter-body`);
  const paras = parasFromHtml(el ? el.innerHTML : (chapterHTML[chId] || ''));
  return paras[0] && !paras[0].sceneBreak && !isAttribution(paras[0]) ? paras[0].text : '';
}
function renderContentsLists() {
  const lists = $$('#chapters .toc-list');
  if (!lists.length) return;
  const entries = bookContents();
  for (const list of lists) {
    list.innerHTML = '';
    for (const e of entries) {
      const li = document.createElement('li');
      li.className = `t-${e.type} lv${e.level}`;
      li.textContent = e.label;
      li.onclick = () => focusChapterStart(e.chId);
      list.appendChild(li);
    }
  }
}

// A new chapter goes at the end of the story: after the last chapter, and
// before an epilogue and the pages at the back
function storyEnd() {
  const order = book.chapterOrder;
  const last = order.map((c) => chapterKind(c)).lastIndexOf('chapter');
  if (last >= 0) return last + 1;
  let at = order.length;
  while (at > 0 && BACK_KINDS.includes(chapterKind(order[at - 1]))) at--;
  return at;
}
$('#nav-add').onclick = () => {
  switchTab('manuscript');
  focusChapter(createChapterAt(storyEnd()));
};

// drop target for chapter reordering, with a gold line showing the landing spot
const navList = $('#nav-list');
// the + on the seam nearest the pointer, when it's near one (the pane
// listens, so the seams above the first box and below the last wake too)
$('#nav-pane').addEventListener('mousemove', (e) => {
  if (chapterDragActive || e.buttons) return;
  let near = null;
  let best = 9;
  for (const g of navList.querySelectorAll('.nav-gap')) {
    const d = Math.abs(e.clientY - g.getBoundingClientRect().top);
    if (d < best) { best = d; near = g; }
  }
  for (const g of navList.querySelectorAll('.nav-gap')) g.classList.toggle('near', g === near);
});
$('#nav-pane').addEventListener('mouseleave', () => {
  navList.querySelectorAll('.nav-gap.near').forEach((g) => g.classList.remove('near'));
});
function finishChapterDrag(e) {
  if (!chapterDragActive) return;
  chapterDragActive = false;
  navList.querySelectorAll('.dragging').forEach((el) => el.classList.remove('dragging'));
  const ind = navList.querySelector('.nav-drop-ind');
  if (ind) ind.remove();
  // Native dragging can temporarily blur the window. Use the release position
  // to keep the pane available after an in-pane drop, even before focus returns.
  const pane = $('#nav-pane');
  const r = pane.getBoundingClientRect();
  if (pane.dataset.pinned !== '1' && (e.clientX < r.left || e.clientX >= r.right || e.clientY < r.top || e.clientY >= r.bottom)) {
    pane.classList.remove('open');
  }
  if (navRefreshPending) renderNav();
}
// Drop also cleans up if rendering removes the source before dragend bubbles.
// Dragend covers Escape and releases outside a valid drop target.
document.addEventListener('drop', finishChapterDrag);
document.addEventListener('dragend', finishChapterDrag);

function navDropInd() {
  let ind = document.querySelector('.nav-drop-ind');
  if (!ind) {
    ind = document.createElement('div');
    ind.className = 'nav-drop-ind';
  }
  return ind;
}
navList.addEventListener('dragover', (e) => {
  if (!e.dataTransfer.types.includes('application/x-neo-chapter')) return;
  e.preventDefault();
  const ind = navDropInd();
  const items = [...navList.querySelectorAll('.nav-item:not(.dragging)')];
  let placed = false;
  for (const it of items) {
    const r = it.getBoundingClientRect();
    if (e.clientY < r.top + r.height / 2) {
      navList.insertBefore(ind, it);
      placed = true;
      break;
    }
  }
  if (!placed) navList.appendChild(ind);
});
navList.addEventListener('dragleave', (e) => {
  if (navList.contains(e.relatedTarget)) return;
  const ind = document.querySelector('.nav-drop-ind');
  if (ind) ind.remove();
});
navList.addEventListener('drop', async (e) => {
  const chId = e.dataTransfer.getData('application/x-neo-chapter');
  if (!chId) return;
  e.preventDefault();
  const ind = document.querySelector('.nav-drop-ind');
  let index = book.chapterOrder.filter((c) => c !== chId).length;
  if (ind) {
    index = 0;
    for (const c of navList.children) {
      if (c === ind) break;
      if (c.classList.contains('nav-item') && !c.classList.contains('dragging')) index++;
    }
    ind.remove();
  }
  const from = book.chapterOrder.indexOf(chId);
  if (from === -1) return;
  snapshotStructure('chapter reorder');
  book.chapterOrder = book.chapterOrder.filter((c) => c !== chId);
  book.chapterOrder.splice(index, 0, chId);
  await saveMeta();
  renderChapters(); // renumbers heads and rebuilds the nav
  if (currentTab === 'outline') renderOutline();
});

function highlightNav() {
  $$('.nav-item').forEach((el) => el.classList.toggle('current', el.dataset.id === currentChapterId));
}

function scheduleNavRefresh() {
  clearTimeout(saveTimers.nav);
  saveTimers.nav = setTimeout(renderNav, 1200);
}

// Hover behavior for both side panes:
function wireHoverPane(hotzone, pane, isPinnable) {
  // (a menu opened from the Chapters pane keeps it open while it's up)
  const pinned = () => (isPinnable && pane.dataset.pinned === '1') ||
    (pane.id === 'nav-pane' && (chapterDragActive || !!document.querySelector('.pop-menu'))) ||
    (pane.id === 'side-pane' && $('#editor-view').classList.contains('darlings-tab')); // the snapshots stay
  hotzone.addEventListener('mouseenter', (e) => {
    if (e.buttons) return; // dragging something — stand down
    pane.classList.add('open');
  });
  hotzone.addEventListener('mouseleave', (e) => {
    if (pinned()) return;
    if (e.relatedTarget && pane.contains(e.relatedTarget)) return;
    pane.classList.remove('open');
  });
  pane.addEventListener('mouseleave', () => {
    if (pinned()) return;
    pane.classList.remove('open');
  });
}
wireHoverPane($('#nav-hotzone'), $('#nav-pane'), true);
wireHoverPane($('#side-hotzone'), $('#side-pane'), true);

// leaving the window closes unpinned panes (they used to stick open)
function closeUnpinnedPanes() {
  // Wayland can blur the window as a native chapter drag begins.
  if (!chapterDragActive && $('#nav-pane').dataset.pinned !== '1') $('#nav-pane').classList.remove('open');
  if ($('#side-pane').dataset.pinned !== '1' && !$('#editor-view').classList.contains('darlings-tab')) $('#side-pane').classList.remove('open');
}
document.documentElement.addEventListener('mouseleave', closeUnpinnedPanes);
window.addEventListener('blur', closeUnpinnedPanes);

// the wheel scrolls the manuscript even when the pointer floats over the
// dark margins beside the (narrower) page column
$('#editor-view').addEventListener('wheel', (e) => {
  const scroller = $('#paper-scroll');
  if (e.ctrlKey) return; // pinch-zoom gesture, not a scroll
  if (scroller.contains(e.target)) return; // native scrolling handles it
  if ($('#nav-pane').contains(e.target) || $('#side-pane').contains(e.target)) return;
  scroller.scrollTop += e.deltaY;
}, { passive: true });

// Keep Open, on either pane: the page moves over to make room, and the
// choice stays for next time (on this computer)
function pinPane(side, on, key = side) {
  const pane = $(side === 'nav' ? '#nav-pane' : '#side-pane');
  const pin = $(side === 'nav' ? '#nav-pin' : '#side-pin');
  pane.dataset.pinned = on ? '1' : '0';
  pin.classList.toggle('pinned', on);
  pin.setAttribute('aria-pressed', on ? 'true' : 'false');
  $('#editor-view').classList.toggle(side + '-pinned', on);
  if (on) pane.classList.add('open');
  try {
    const kept = JSON.parse(localStorage.getItem('neo-pinned-panes') || '{}');
    kept[key] = on;
    localStorage.setItem('neo-pinned-panes', JSON.stringify(kept));
  } catch { /* fine: it just won't be remembered */ }
}
$('#side-pin').onclick = () => pinPane('side', $('#side-pane').dataset.pinned !== '1');
$('#nav-pin').onclick = () => pinPane('nav', $('#nav-pane').dataset.pinned !== '1', book && isScript() ? 'scriptNav' : 'nav');
if (!NO_HOVER) {
  try {
    const kept = JSON.parse(localStorage.getItem('neo-pinned-panes') || '{}');
    if (kept.nav) pinPane('nav', true);
    if (kept.side) pinPane('side', true);
  } catch { /* nothing kept */ }
}

/* ================================================================== */
/*  TABS — Manuscript / Notes / Outline / Darlings                     */
/* ================================================================== */

$$('.tab[data-tab]').forEach((tab) => {
  tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  tab.addEventListener('dblclick', async () => {
    const kind = tab.dataset.tab;
    if (kind !== 'notes' && kind !== 'outline') return;
    const name = await askInput(t('Rename tab'), t('New tab name'), tabName(kind));
    if (!name) return;
    book.tabNames[kind] = name;
    tab.textContent = name;
    saveMeta();
    // Renamed tabs become the default for future books
    library.tabDefaults = library.tabDefaults || {};
    library.tabDefaults[kind] = name;
    writeLibrary(library);
  });
});

// History, after the tabs: the Writing History, scrolled to the chapter the caret is in
const historyBtn = $('.tab.history-btn');
historyBtn.hidden = !historyCanOpen();
historyBtn.addEventListener('click', () => openHistory());

// Darlings tab is a drop target for selected text
const darlingsTab = $('.tab.darlings');
// The selection usually collapses by the time a drag lands on the Darlings
// tab, so the range is remembered at dragstart and the cut is made by NEO
// itself (dropEffect 'copy' keeps Chromium from moving the text on its own).
let draggedRange = null;
document.addEventListener('dragstart', (e) => {
  // any text drag inside the manuscript lights up the bottom bar
  if (currentTab === 'manuscript' && e.target.closest && e.target.closest('.chapter-body')) {
    $('#bottombar').classList.add('attn');
    const sel = window.getSelection();
    draggedRange = sel.rangeCount && !sel.isCollapsed ? sel.getRangeAt(0).cloneRange() : null;
  }
});
document.addEventListener('dragend', () => { $('#bottombar').classList.remove('attn'); draggedRange = null; });

darlingsTab.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  darlingsTab.classList.add('drag-over');
});
darlingsTab.addEventListener('dragleave', () => darlingsTab.classList.remove('drag-over'));
darlingsTab.addEventListener('drop', async (e) => {
  e.preventDefault();
  darlingsTab.classList.remove('drag-over');
  const html = e.dataTransfer.getData('text/html');
  const text = e.dataTransfer.getData('text/plain');
  await moveSelectionToDarlings(html, text);
});

// ---- text-position helpers: darlings remember home by their surrounding
// text, so nothing foreign is left inside the manuscript ----

function bodyPlainText(body) {
  let t = '';
  const w = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = w.nextNode())) t += n.textContent;
  return t;
}

function textPosToRange(body, pos) {
  const w = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  let n, acc = 0;
  while ((n = w.nextNode())) {
    const len = n.textContent.length;
    if (acc + len >= pos) {
      const r = document.createRange();
      r.setStart(n, pos - acc);
      r.collapse(true);
      return r;
    }
    acc += len;
  }
  return null;
}

// Where in the chapter does this darling belong?
function findDarlingPosition(body, d) {
  if (d.anchorPrefix == null && d.anchorSuffix == null) return -1;
  const text = bodyPlainText(body);
  const pre = d.anchorPrefix || '';
  const suf = d.anchorSuffix || '';
  let idx = (pre + suf) ? text.indexOf(pre + suf) : -1;
  if (idx !== -1) return idx + pre.length;
  if (pre) {
    idx = text.indexOf(pre);
    if (idx !== -1) return idx + pre.length;
  }
  if (suf) {
    idx = text.indexOf(suf);
    if (idx !== -1) return idx;
  }
  return -1;
}

// The one move shared by drag-to-tab and ⌘⇧D: the cut point is remembered by its surroundings —
// no markers in the WIP itself.
async function moveSelectionToDarlings(html, text) {
  if (!text || !text.trim() || !book) return;
  const sel = window.getSelection();
  // the live selection if it survived the drag, else the one saved at dragstart
  const live = sel.rangeCount && !sel.isCollapsed ? sel.getRangeAt(0) : null;
  const range = live || draggedRange;
  draggedRange = null;
  const srcChapter = range
    ? range.startContainer.parentElement?.closest?.('.chapter')
    : null;
  const chId = srcChapter ? srcChapter.dataset.id : currentChapterId;
  const chIdx = book.chapterOrder.indexOf(chId);
  const did = 'd-' + Date.now().toString(36);

  snapshotStructure('darling');
  breakRun++; // the engine never saw this cut: ⌘Z inside the text must reach the structural stack

  let anchorPrefix = null;
  let anchorSuffix = null;
  if (range) {
    const startNode = range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer.parentElement : range.startContainer;
    const startBlock = startNode && startNode.closest ? startNode.closest('p') : null;
    range.deleteContents();
    // a whole paragraph dragged away leaves its empty shell behind: remove it
    // and park the caret at the end of the paragraph before (or start of after)
    if (startBlock && !startBlock.textContent.trim() && !startBlock.querySelector('span')
        && startBlock.parentElement && startBlock.parentElement.children.length > 1) {
      const prev = startBlock.previousElementSibling;
      const next = startBlock.nextElementSibling;
      startBlock.remove();
      if (prev) { range.selectNodeContents(prev); range.collapse(false); }
      else if (next) { range.selectNodeContents(next); range.collapse(true); }
    }
    sel.removeAllRanges(); sel.addRange(range);
    const r = range;
    const body = r.startContainer.parentElement?.closest?.('.chapter-body');
    if (body) {
      const pre = document.createRange();
      pre.selectNodeContents(body);
      pre.setEnd(r.startContainer, r.startOffset);
      anchorPrefix = pre.toString().slice(-60);
      const post = document.createRange();
      post.selectNodeContents(body);
      post.setStart(r.startContainer, r.startOffset);
      anchorSuffix = post.toString().slice(0, 60);
    }
  }
  if (chId) {
    const body = document.querySelector(`.chapter[data-id="${chId}"] .chapter-body`);
    if (body) {
      setChapterHTML(chId, captureBody(body), 'darling-out');
      wordCache[chId] = null;
    }
  }

  // Chromium's drag html carries inline font/colour/background styles;
  // keep only the prose (paragraphs when the drag spanned more than one)
  let cleanHtml = null;
  if (html) {
    const cleaned = cleanPasteHtml(html);
    cleanHtml = /\n/.test(text.trim()) && !/<p[\s>]/i.test(cleaned) ? '<p>' + cleaned + '</p>' : cleaned;
  }
  darlings.unshift({
    id: did,
    html: cleanHtml,
    text: text,
    chapterId: chId || null,
    chapterLabel: chIdx >= 0 ? chapterName(chId) : t('Manuscript'),
    anchorPrefix,
    anchorSuffix,
    date: new Date().toISOString()
  });
  // Darlings first; the chapter without the passage is saved only once the
  // passage is safe there. If it can't be, the cut is undone.
  const bookId = book.id;
  try {
    await writeSidecar(bookId, 'darlings', darlings);
  } catch {
    delete sidecarPending[bookId + '/darlings'];
    if (book && book.id === bookId) await structuralUndo();
    toast(t('NEO couldn’t save to Darlings, so the passage stays where it was'));
    return;
  }
  if (chId && book && book.id === bookId) scheduleChapterSave(chId);
  updateCounters();
  toast(t('Saved to Darlings — kill without remorse ({key} to undo)', { key: KZ }));
}

// Older versions of NEO planted invisible marker spans at darling cut points,
// which interfered with Chromium's delete handling. On open, convert each one
// into a remembered-context position and remove it:
async function migrateDarlingAnchors() {
  const spans = [...document.querySelectorAll('.darling-anchor')];
  if (!spans.length) return;
  let changed = false;
  for (const span of spans) {
    const body = span.closest('.chapter-body');
    const d = darlings.find((x) => x.id === span.dataset.did);
    if (body && d && d.anchorPrefix == null) {
      const pre = document.createRange();
      pre.selectNodeContents(body);
      pre.setEndBefore(span);
      d.anchorPrefix = pre.toString().slice(-60);
      const post = document.createRange();
      post.selectNodeContents(body);
      post.setStartAfter(span);
      d.anchorSuffix = post.toString().slice(0, 60);
      changed = true;
    }
    const chapter = span.closest('.chapter');
    span.remove();
    if (body && chapter) {
      setChapterHTML(chapter.dataset.id, captureBody(body), 'heal');
      wordCache[chapter.dataset.id] = null;
      scheduleChapterSave(chapter.dataset.id);
    }
  }
  if (changed) await writeSidecar(book.id, 'darlings', darlings);
}

// keyboard route: select a passage, ⌘⇧D to move to Darlings
function darlingFromKeyboard() {
  const sel = window.getSelection();
  if (!sel.rangeCount || sel.isCollapsed) {
    toast(t('Select the passage first, then {key} sends it to Darlings', { key: KDA }));
    return;
  }
  let el = sel.anchorNode;
  if (el && el.nodeType === Node.TEXT_NODE) el = el.parentElement;
  if (!el || !el.closest || !el.closest('.chapter-body')) return;
  const holder = document.createElement('div');
  holder.appendChild(sel.getRangeAt(0).cloneContents());
  moveSelectionToDarlings(holder.innerHTML, sel.toString());
}

// Every tab shares one scroller, so leaving a tab used to lose its place.
// Each tab now remembers where it was — the manuscript keeps its caret as
// well — for as long as the book is open.
let tabPlaces = {};

let auxLoad = 0; // which Notes read is the current one
function switchTab(name) {
  if (book && name !== currentTab) rec.context('tab:' + name);
  closeCardEditor();
  auxLoad++;
  $('#editor-view').classList.remove('board-on');
  updateZoomDisplay(); // the page's own zoom, not the cards' (#336)
  sidePaneForTab(name);
  const scroller = $('#paper-scroll');
  if (book && currentTab && currentTab !== name) {
    tabPlaces[currentTab] = currentTab === 'manuscript'
      ? { caret: captureCaret(), scroll: scroller.scrollTop }
      : { scroll: scroller.scrollTop };
  }
  currentTab = name;
  queueSideCards();
  applyBright();
  $$('.tab[data-tab]').forEach((t) => {
    t.classList.toggle('active', t.dataset.tab === name);
    t.setAttribute('aria-selected', t.dataset.tab === name ? 'true' : 'false');
  });
  if (spellOn) setTimeout(scanSpellingHere, 0);
  const paper = $('#paper');
  const aux = $('#aux-paper');
  const auxEditor = $('#aux-editor');
  const dList = $('#darlings-list');
  const oList = $('#outline-list');
  const back = tabPlaces[name];
  const returnTo = () => { if (back && typeof back.scroll === 'number') scroller.scrollTop = back.scroll; };

  // stash whatever aux content was open
  flushAux();

  // an open Find follows the tab (Notes arrives from disk, so it looks later)
  const findHere = () => { if (!$('#searchbar').hidden) runSearch(); };
  if (name === 'manuscript') {
    paper.hidden = false;
    aux.hidden = true;
    if (back && back.caret) restoreCaret(back.caret); // brings the scroll along
    else returnTo();
    findHere();
    vimRest();
    return;
  }
  paper.hidden = true;
  aux.hidden = false;
  auxEditor.hidden = true;
  dList.hidden = true;
  oList.hidden = true;
  // the outline's cards, their List/Cards switch and their hint belong to the Outline alone
  for (const id of ['#outline-board', '#outline-views', '#outline-board-hint']) { const el = $(id); if (el) el.hidden = true; }

  snapShown = null;
  if (window.CSS && CSS.highlights) CSS.highlights.delete('neo-snap-gone');
  if ($('#snap-view')) { $('#snap-view').hidden = true; $('#snap-view').innerHTML = ''; }
  if (name === 'darlings') {
    $('#aux-title').textContent = t('Darlings');
    dList.hidden = false;
    renderDarlings();
    renderSnapList();
    returnTo();
    findHere();
  } else if (name === 'outline') {
    $('#aux-title').textContent = tabName('outline');
    oList.hidden = false;
    if (!book.chapterOrder.some((c) => isStory(c))) createChapterAt(storyEnd());
    renderOutline();
    returnTo();
    findHere();
  } else {
    $('#aux-title').textContent = tabName(name);
    auxEditor.hidden = false;
    // The page waits for its text: nothing typed into the old contents
    // while the file is read can be overwritten by it, and a read that
    // comes back after the writer moved on (another tab, another book)
    // lands nowhere.
    const bookId = book.id;
    const load = ++auxLoad;
    auxEditor.contentEditable = 'false';
    auxEditor.dataset.kind = '';
    auxEditor.dataset.book = '';
    const pending = auxPending[bookId + '/' + name];
    (pending ? Promise.resolve(pending.html) : window.neo.readAux(bookId, name)).then((html) => {
      if (load !== auxLoad || !book || book.id !== bookId || currentTab !== name) return;
      if (name === 'notes') recNotesRead(html || '', bookId);
      auxEditor.innerHTML = html || '';
      recNotesShown = name === 'notes' ? auxEditor.innerHTML : null;
      auxEditor.dataset.kind = name;
      auxEditor.dataset.book = bookId;
      auxEditor.contentEditable = 'true';
      auxEditor.focus({ preventScroll: true });
      returnTo();
      findHere();
      vimRest();
    }, (err) => {
      if (load !== auxLoad) return;
      window.neo.logError('notes read: ' + (err && err.message || err));
      toast(t('NEO couldn’t read this page from disk'));
    });
  }
}

/* ================================================================== */
/*  STRUCTURED OUTLINE                                                 */
/*  Chapter lines are the book's real chapters. Section notes become   */
/*  grayed "ghost" paragraphs in the manuscript                       */
/* ================================================================== */

const secLetter = (i) => String.fromCharCode(65 + (i % 26));

/**
 * Where the caret goes after a section is removed from the outline: the end of the section ABOVE it,
 * the way a text editor behaves. Only the first section has no line above it, and then the chapter's
 * own line is where the caret belongs.
 */
function focusAfterSectionRemoved(list, index, chId) {
  const above = index > 0 ? list[index - 1] : undefined;
  return above ? { secId: above.id } : { chId };
}

/** Put the caret at the END of an outline line's text, the way moving down the list does. */
function focusOutlineTextEnd(el) {
  el.focus();
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(false);
  const s = window.getSelection();
  s.removeAllRanges();
  s.addRange(r);
}

function renderOutline(focusTarget) {
  // the outline as cards, unless the writer chose the list
  if (showOutlineView()) { renderBoard(); return; }
  const boardHint = $('#outline-board-hint');
  if (boardHint) boardHint.hidden = true;
  book.sectionNotes = book.sectionNotes || {};
  book.chapterNotes = book.chapterNotes || {};
  const wrap = $('#outline-list');
  wrap.innerHTML = '';

  // the story's lines, with each part standing over its chapters (the pages
  // a book carries have nothing to outline)
  book.chapterOrder.forEach((chId, i) => {
    const kind = chapterKind(chId);
    if (kind === 'part') { wrap.appendChild(outlinePartLine(chId)); return; }
    if (!STORY_KINDS.includes(kind)) return;
    wrap.appendChild(outlineLine('chapter', chId, null, i, chapterMark(chId),
      book.chapterNotes[chId] || ''));
    (book.sectionNotes[chId] || []).forEach((sec, j) => {
      wrap.appendChild(outlineLine('section', chId, sec.id, j, secLetter(j), sec.text));
    });
  });

  const hint = document.createElement('div');
  hint.className = 'ol-hint';
  hint.textContent = t('Enter — new chapter · Tab — make it a section, or a new section below one · ⇧Tab — make it a chapter again · Backspace on an empty line removes it');
  wrap.appendChild(hint);

  if (focusTarget) {
    const el = wrap.querySelector(
      focusTarget.secId
        ? `.ol-line[data-sec-id="${focusTarget.secId}"] .ol-text`
        : `.ol-line.ol-chapter[data-ch-id="${focusTarget.chId}"] .ol-text`
    );
    if (el) {
      el.focus();
      const r = document.createRange();
      r.selectNodeContents(el);
      r.collapse(false);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
    }
  }
}

// a part in the outline: its name and title, over the chapters it holds
function outlinePartLine(chId) {
  const line = document.createElement('div');
  line.className = 'ol-line ol-part';
  line.dataset.chId = chId;
  const num = document.createElement('span');
  num.className = 'ol-num';
  num.textContent = chapterMark(chId);
  const name = document.createElement('div');
  name.className = 'ol-part-name';
  const title = partTitleOf(chId);
  name.textContent = chapterName(chId) + (title ? ': ' + title : '');
  line.append(num, name);
  line.addEventListener('contextmenu', (e) => { e.preventDefault(); chapterMenu(chId, e.clientX, e.clientY, line); });
  return line;
}

// the story entry before this one (pages and parts aren't where sections go)
function storyBefore(chId) {
  const order = book.chapterOrder;
  for (let i = order.indexOf(chId) - 1; i >= 0; i--) if (isStory(order[i])) return order[i];
  return null;
}

function outlineLine(kind, chId, secId, index, label, text) {
  const line = document.createElement('div');
  line.className = 'ol-line ol-' + kind;
  line.dataset.chId = chId;
  if (secId) line.dataset.secId = secId;
  const num = document.createElement('span');
  num.className = 'ol-num';
  num.textContent = label;
  if (kind === 'chapter' && chapterKind(chId) !== 'chapter') num.title = chapterName(chId);
  const txt = document.createElement('div');
  txt.className = 'ol-text';
  txt.contentEditable = 'true';
  txt.spellcheck = false;
  txt.textContent = text;

  const save = () => {
    const val = txt.textContent.trim();
    if (kind === 'chapter') {
      book.chapterNotes[chId] = val;
    } else {
      const sec = (book.sectionNotes[chId] || []).find((s) => s.id === secId);
      if (sec) sec.text = val;
    }
    scheduleMetaSave();
  };

  txt.addEventListener('blur', () => {
    save();
    if (kind === 'section') syncGhosts(chId);
    renderNav();
  });
  // a list pasted (Word, Obsidian, a notes app): a line for each item, as if
  // typed with Enter and Tab. On a chapter's line the top items are chapters
  // and the indented ones their sections; on a section's, each is a section (#348)
  txt.addEventListener('paste', (e) => {
    const items = pastedOutline(e.clipboardData);
    if (items.length < 2) {
      e.preventDefault();
      document.execCommand('insertText', false, (e.clipboardData.getData('text/plain') || '').replace(/\s+/g, ' '));
      return;
    }
    e.preventDefault();
    snapshotStructure('outline paste', { outlineFocus: here() });
    book.sectionNotes = book.sectionNotes || {};
    book.chapterNotes = book.chapterNotes || {};
    document.execCommand('insertText', false, items[0].text);
    save();
    let focus = here();
    const touched = new Set([chId]);
    if (kind === 'section') {
      const list = book.sectionNotes[chId] || (book.sectionNotes[chId] = []);
      let at = list.findIndex((x) => x.id === secId) + 1;
      for (const it of items.slice(1)) {
        const sec = { id: newSectionId(), text: it.text };
        list.splice(at++, 0, sec);
        focus = { secId: sec.id };
      }
    } else {
      let cur = chId; // the chapter the items go after, and their sections into
      let secAt = 0; // under the line pasted on, ahead of the sections it already has
      for (const it of items.slice(1)) {
        if (it.level === 0) {
          const next = 'ch-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
          book.chapterOrder.splice(book.chapterOrder.indexOf(cur) + 1, 0, next);
          cur = next;
          setChapterHTML(cur, '<p><br></p>', 'new');
          book.chapterNotes[cur] = it.text;
          persistChapter(cur);
          secAt = 0;
          focus = { chId: cur };
        } else {
          const list = book.sectionNotes[cur] || (book.sectionNotes[cur] = []);
          const sec = { id: newSectionId(), text: it.text };
          list.splice(secAt++, 0, sec);
          touched.add(cur);
          focus = { secId: sec.id };
        }
      }
    }
    scheduleMetaSave();
    renderChapters();
    for (const c of touched) syncGhosts(c);
    updateCounters();
    renderOutline(focus);
  });

  // Enter at the very start of a line that has text makes the new line
  // ABOVE it (the only way to put something before "A"); anywhere else,
  // below — the way a text editor's outline behaves
  const caretAtStart = () => {
    if (!txt.textContent.trim()) return false;
    const sel = window.getSelection();
    if (!sel.rangeCount || !sel.isCollapsed) return false;
    const r = sel.getRangeAt(0);
    if (!txt.contains(r.startContainer)) return false;
    const head = document.createRange();
    head.selectNodeContents(txt);
    head.setEnd(r.startContainer, r.startOffset);
    return head.toString().length === 0;
  };

  // the line the writer is on, so ⌘Z puts the caret back on it
  const here = () => (secId ? { secId } : { chId });

  txt.addEventListener('keydown', (e) => {
    // Typing in a line is the engine's to undo. Once it has nothing left to
    // undo here, the outline's structure is ours: a line added, removed, or
    // turned into a chapter or a section comes back with ⌘Z. (The engine
    // answers a ⌘Z the moment this handler returns, so a moment later we know
    // whether it had anything to take back in this line.)
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
      const top = undoStack[undoStack.length - 1];
      if (top && top.outlineFocus) {
        let engineUndid = false;
        const heard = () => { engineUndid = true; };
        txt.addEventListener('beforeinput', heard, { once: true });
        setTimeout(() => {
          txt.removeEventListener('beforeinput', heard);
          if (!engineUndid && undoStack[undoStack.length - 1] === top) structuralUndo();
        }, 0);
      }
      e.stopPropagation();
      return;
    }
    // Enter: always a new chapter. From a chapter's line it goes right after
    // that chapter (or before it, from the very start of a line with words);
    // from a section's line, after the whole chapter the section is in.
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      if (e.isComposing || e.keyCode === 229) return;
      const above = kind === 'chapter' && caretAtStart();
      save();
      snapshotStructure('outline new chapter', { outlineFocus: here() });
      const at = book.chapterOrder.indexOf(chId) + (above ? 0 : 1);
      const newId = createChapterAt(at);
      updateCounters();
      renderOutline({ chId: newId });
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const lines = [...document.querySelectorAll('.ol-line .ol-text')];
      const next = lines[lines.indexOf(txt) + (e.key === 'ArrowDown' ? 1 : -1)];
      if (next) focusOutlineTextEnd(next);
    }
    // Tab: always a section. A section's line makes a new one below it; a
    // chapter's line becomes a section of the chapter above, writing and all
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      save();
      if (kind === 'section') {
        snapshotStructure('outline new section', { outlineFocus: here() });
        const list = book.sectionNotes[chId];
        const newSec = { id: newSectionId(), text: '' };
        list.splice(index + 1, 0, newSec);
        scheduleMetaSave();
        syncGhosts(chId);
        renderOutline({ secId: newSec.id });
        return;
      }
      const prevCh = storyBefore(chId);
      if (!prevCh) { toast(t('The first line has to be a chapter')); return; }
      joinChapter(chId, prevCh).then((secId) => {
        if (currentTab === 'outline') renderOutline(secId ? { secId } : { chId: prevCh });
      });
      return;
    }
    if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault();
      if (kind !== 'section') return;
      save();
      snapshotStructure('outline section to chapter', { outlineFocus: here() });
      const list = book.sectionNotes[chId];
      const from = list.findIndex((s) => s.id === secId);
      // the section and the ones after it leave together, so the book's order
      // holds (B in A B C: B and C make the next chapter, A stays). Sections
      // already written over keep their prose here, so those stay here too.
      const [sec, ...after] = list.splice(from);
      const carry = after.length > 0 && !after.some((s) => sectionWritten(chId, s.id));
      if (!carry) list.push(...after);
      const at = book.chapterOrder.indexOf(chId) + 1;
      const newId = createChapterAt(at);
      book.chapterNotes[newId] = sec.text;
      if (carry) book.sectionNotes[newId] = after;
      scheduleMetaSave();
      syncGhosts(chId);
      if (carry) syncGhosts(newId);
      renderOutline({ chId: newId });
    }
    if (e.key === 'Backspace' && txt.textContent.trim() === '') {
      e.preventDefault();
      if (kind === 'section') {
        snapshotStructure('outline section removed', { outlineFocus: here() });
        const list = book.sectionNotes[chId] || [];
        const focus = focusAfterSectionRemoved(list, index, chId);
        book.sectionNotes[chId] = list.filter((s) => s.id !== secId);
        scheduleMetaSave();
        syncGhosts(chId);
        renderOutline(focus);
      } else if (book.chapterOrder.filter((c) => isStory(c)).length > 1 && countWords(chapterText(chId)) === 0) {
        snapshotStructure('outline chapter removed', { outlineFocus: here() });
        const prevCh = storyBefore(chId) || book.chapterOrder.find((c) => c !== chId && isStory(c));
        deleteChapterQuiet(chId).then(() => renderOutline({ chId: prevCh }));
      }
    }
    e.stopPropagation();
  });

  // right-click any outline line to delete it
  line.addEventListener('contextmenu', async (e) => {
    e.preventDefault();
    if (kind === 'chapter') {
      await chapterMenu(chId, e.clientX, e.clientY, line);
    } else {
      const choice = await optionModal(t('Delete this section?'), null,
        [{ label: t('Delete section'), desc: t('Removes the outline line and its gray ghost from the manuscript. Written prose is never touched.'), danger: true, value: 'delete' }]);
      if (choice === 'delete') {
        snapshotStructure('outline section removed', { outlineFocus: here() });
        const list = book.sectionNotes[chId] || [];
        const focus = focusAfterSectionRemoved(list, index, chId);
        book.sectionNotes[chId] = list.filter((s) => s.id !== secId);
        scheduleMetaSave();
        syncGhosts(chId);
        renderOutline(focus);
      }
    }
  });

  line.appendChild(num);
  line.appendChild(txt);
  return line;
}

// a section whose outline line the writer has written over: prose of their
// own now stands where its gray ghost was
function sectionWritten(chId, secId) {
  return !!document.querySelector(`.chapter[data-id="${chId}"] .chapter-body p[data-sec-id="${secId}"]:not(.ghost)`);
}

// Push section notes into the manuscript as gray ghost paragraphs,
// with real *** scene breaks between sections. A ghost stays where it is
// (the cards can set one between two written sections); a note the page
// doesn't have yet goes in before the next section that's already there,
// else at the end. Once a ghost has been written over, it's prose.
function syncGhosts(chId) {
  const body = document.querySelector(`.chapter[data-id="${chId}"] .chapter-body`);
  if (!body) return;
  const list = (book.sectionNotes && book.sectionNotes[chId]) || [];
  const notes = new Map(list.map((s) => [s.id, s]));

  // 1. a ghost whose note is gone (or emptied) leaves, with the *** made
  //    for it; the rest take their note's words
  for (const p of [...body.querySelectorAll('p.ghost[data-sec-id]')]) {
    const sec = notes.get(p.dataset.secId);
    if (sec && sec.text) {
      if (p.textContent !== sec.text) p.textContent = sec.text;
      continue;
    }
    removeGhost(body, p);
  }

  // 2. a note with no place on the page yet gets one
  list.forEach((sec, i) => {
    if (!sec.text || body.querySelector(`p[data-sec-id="${sec.id}"]`)) return;
    let before = null;
    for (let j = i + 1; j < list.length && !before; j++) {
      const el = body.querySelector(`p[data-sec-id="${list[j].id}"]`);
      if (el) before = segmentStartEl(body, el);
    }
    placeGhost(body, sec, before);
  });
  syncChapter(body, chId, 'ghost');
}

// where the section holding el begins: its *** (or the body's first line)
function segmentStartEl(body, el) {
  let n = el;
  while (n.parentElement && n.parentElement !== body) n = n.parentElement;
  for (let q = n; q; q = q.previousElementSibling) {
    if (q.classList.contains('scene-break')) return q;
    if (!q.previousElementSibling) return q;
  }
  return n;
}

function newSceneBreak(secId) {
  const b = document.createElement('p');
  b.className = 'scene-break';
  if (secId) b.dataset.secBrk = secId;
  b.textContent = '***';
  return b;
}

function placeGhost(body, sec, before) {
  const p = document.createElement('p');
  p.className = 'ghost';
  p.dataset.secId = sec.id;
  p.textContent = sec.text;
  if (before && before.parentElement === body) {
    if (before.classList.contains('scene-break')) {
      body.insertBefore(newSceneBreak(sec.id), before);
      body.insertBefore(p, before);
    } else {
      // the first section of the chapter: the ghost goes ahead of it
      body.insertBefore(p, before);
      body.insertBefore(newSceneBreak(sec.id), before);
    }
    return p;
  }
  const hasContent = body.innerText.trim() !== '';
  if (hasContent && !(body.lastElementChild && body.lastElementChild.classList.contains('scene-break'))) {
    body.appendChild(newSceneBreak(sec.id));
  }
  body.appendChild(p);
  return p;
}

// a ghost leaves, and so does the *** that set it apart
function removeGhost(body, p) {
  const prev = p.previousElementSibling;
  const next = p.nextElementSibling;
  const isBrk = (q) => q && q.classList.contains('scene-break');
  if (isBrk(prev) && (!next || isBrk(next))) prev.remove();
  else if (!prev && isBrk(next)) next.remove();
  p.remove();
  if (!body.firstElementChild) body.innerHTML = '<p><br></p>';
}

/* ================================================================== */
/*  OUTLINE CARDS                                                      */
/*  The outline as index cards, set like a page: they read left to    */
/*  right, line after line, so any shape of book fills the window. A   */
/*  chapter starts at its numeral, and its cards share a mat, rounded  */
/*  where the chapter starts and ends and cut square where it wraps.   */
/*  Parts start a fresh line. Sections are the manuscript's own: every */
/*  *** makes one, outlined or not, and a card shows its note or else  */
/*  the section's first line, in quotes. Dragging a card moves the     */
/*  writing with it (⌘Z puts it back). Loose cards, ideas that don't   */
/*  have a chapter yet, wait in the right-hand pane (book.looseCards). */
/*  A script's cards are its scenes (book.sceneNotes holds their notes). */
/* ================================================================== */

const outlineCardsOn = () => !!book && (isScript() || (library.outlineView || 'cards') === 'cards');
const chapterBodyEl = (chId) => document.querySelector(`.chapter[data-id="${chId}"] .chapter-body`);
const newSectionId = () => 'sec-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

// A chapter cut at its *** lines. Each piece: its *** (none for the first),
// its paragraphs, the outline note it belongs to (if any), and what's on it.
// A paragraph split from a written ghost carries the ghost's id along, so
// only the first piece to hold an id is that note's.
function chapterSegments(chId) {
  const body = chapterBodyEl(chId);
  if (!body) return [];
  const segs = [];
  let cur = { brk: null, ps: [] };
  for (const el of body.children) {
    if (el.classList.contains('scene-break')) { segs.push(cur); cur = { brk: el, ps: [] }; }
    else cur.ps.push(el);
  }
  segs.push(cur);
  const notes = new Set(((book.sectionNotes || {})[chId] || []).map((s) => s.id));
  const claimed = new Set();
  for (const seg of segs) {
    const tagged = seg.ps.find((p) => p.dataset && notes.has(p.dataset.secId) && !claimed.has(p.dataset.secId));
    seg.id = tagged ? tagged.dataset.secId : null;
    if (seg.id) claimed.add(seg.id);
    const prose = seg.ps.filter((p) => !p.classList.contains('ghost'));
    seg.words = countWords(prose.map((p) => p.textContent).join('\n'));
    seg.first = prose.map((p) => p.textContent.replace(/\s+/g, ' ').trim()).find(Boolean) || '';
    seg.flag = seg.ps.some((p) => p.querySelector && p.querySelector('.ph-mark'));
  }
  return segs;
}

// the note a section has, if it has one
const sectionNote = (chId, secId) => ((book.sectionNotes || {})[chId] || []).find((s) => s.id === secId) || null;

// keep a chapter's notes in the order their sections stand on the page
// (a note with no place yet keeps to the end)
function orderSectionNotes(chId) {
  const list = (book.sectionNotes || {})[chId];
  if (!list) return;
  const ids = chapterSegments(chId).map((s) => s.id).filter(Boolean);
  const placed = ids.map((id) => list.find((s) => s.id === id)).filter(Boolean);
  book.sectionNotes[chId] = placed.concat(list.filter((s) => !ids.includes(s.id)));
}

// Zoom is per mode and per device. Novel and script keep their own page zoom, and the outline's
// cards keep their own; none of them travel in library.json, so a phone never inherits the zoom a
// desktop set. `library.pageZoom` / `library.cardZoom` stay as the fallback for devices that have
// not chosen yet, which keeps an existing zoom as the default.
const PAGE_ZOOM_RANGE = { min: 0.75, max: 3 };
const CARD_ZOOM_RANGE = { min: 0.55, max: 1.5 };
const CARD_ZOOM_KEY = 'neo.cardZoom';
const pageZoomKey = () => 'neo.pageZoom.' + (isScript() ? 'script' : 'novel');

/** The stored zoom, or the fallback, always inside the range. Split out so a test can hold it. */
function resolveStoredZoom(raw, fallback, min, max) {
  const value = raw === null || raw === '' ? NaN : Number(raw);
  const chosen = Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, chosen));
}

function readStoredZoom(key, fallback, range) {
  let raw = null;
  try { raw = localStorage.getItem(key); } catch { /* storage can be off */ }
  return resolveStoredZoom(raw, fallback || 1, range.min, range.max);
}

function rememberZoom(key, value) {
  try { localStorage.setItem(key, String(value)); } catch { /* storage can be off */ }
}

const activePageZoom = () => readStoredZoom(pageZoomKey(), library.pageZoom || 1, PAGE_ZOOM_RANGE);
function applyPageZoom() {
  document.documentElement.style.setProperty('--page-zoom', activePageZoom());
  updateZoomDisplay();
}

function cardZoom() { return readStoredZoom(CARD_ZOOM_KEY, library.cardZoom || 1, CARD_ZOOM_RANGE); }

// The shelf has a size of its own (#336): bigger covers without the page's
// type growing. ⌘+ and ⌘− (Ctrl), a pinch or Ctrl-scroll, and ⌘0 on the
// shelf, in steps of a tenth, kept on this device.
const SHELF_ZOOM_KEY = 'neo.shelfZoom';
const SHELF_ZOOM_RANGE = { min: 0.8, max: 2 };
const shelfZoom = () => readStoredZoom(SHELF_ZOOM_KEY, 1, SHELF_ZOOM_RANGE);
const shelfShowing = () => !$('#bookshelf-view').hidden;
function applyShelfZoom() {
  const z = shelfZoom();
  document.documentElement.style.setProperty('--shelf-zoom', z);
}
function stepShelfZoom(dir) {
  const now = shelfZoom();
  const next = dir === 0 ? 1 : Math.min(SHELF_ZOOM_RANGE.max, Math.max(SHELF_ZOOM_RANGE.min, Math.round((now + dir * 0.1) * 10) / 10));
  if (next === now) return;
  rememberZoom(SHELF_ZOOM_KEY, next);
  applyShelfZoom();
}
// a page zoom moves in tenths, so it reads 110%, 120%, never 121%
const tenth = (z) => Math.round(z * 10) / 10;
const CARD_ZOOMS = [0.55, 0.7, 0.85, 1, 1.15, 1.3, 1.5];
function stepCardZoom(dir) {
  const now = cardZoom();
  let next = now;
  if (dir === 0) next = 1;
  else if (dir > 0) next = CARD_ZOOMS.find((z) => z > now + 0.001) || now;
  else next = [...CARD_ZOOMS].reverse().find((z) => z < now - 0.001) || now;
  if (next === now) return;
  rememberZoom(CARD_ZOOM_KEY, next);
  renderBoard();
  updateZoomDisplay();
}

// ---- the board ----

function outlineBoard() {
  let board = $('#outline-board');
  if (board) return board;
  board = document.createElement('div');
  board.id = 'outline-board';
  board.hidden = true;
  board.setAttribute('role', 'list');
  board.setAttribute('aria-label', t('Outline cards'));
  $('#outline-list').after(board);
  board.addEventListener('pointerdown', (e) => {
    const cell = e.target.closest('.ob-cell');
    if (!cell || e.button !== 0 || cell.classList.contains('open')) return;
    if (e.target.closest('button')) return;
    cardPress(e, { kind: cell.dataset.kind, cell });
  });
  // a sweep starts anywhere on the outline page that isn't a card or a control
  $('#paper-scroll').addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.pointerType !== 'mouse' || !boardShowing()) return;
    if (e.target.closest('.ob-cell, button, a, input, textarea, select, [contenteditable="true"], .ob-add, #outline-list')) return;
    cardLasso(e);
  });
  board.addEventListener('contextmenu', (e) => {
    const cell = e.target.closest('.ob-cell');
    if (!cell || cell.classList.contains('open')) return;
    e.preventDefault();
    if (NO_HOVER) return; // a long press is the menu there (cardPress)
    cardMenu(cell, e.clientX, e.clientY);
  });
  board.addEventListener('keydown', (e) => {
    const cell = e.target.closest && e.target.closest('.ob-cell');
    if (!cell || cell.classList.contains('open')) return;
    if (e.key === 'Enter' && e.altKey) { e.preventDefault(); newCardAfter(cell); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openCard(cell); }
    else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); cardMenu(cell, 0, 0); }
    else if (['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
      e.preventDefault();
      const cells = [...board.querySelectorAll('.ob-cell')];
      const i = cells.indexOf(cell);
      let next = null;
      if (e.key === 'ArrowRight') next = cells[i + 1];
      else if (e.key === 'ArrowLeft') next = cells[i - 1];
      else {
        // the card above or below: the nearest one in the next line
        const r = cell.getBoundingClientRect();
        const down = e.key === 'ArrowDown';
        let best = Infinity;
        for (const c of cells) {
          const q = c.getBoundingClientRect();
          if (down ? q.top <= r.top + 4 : q.top >= r.top - 4) continue;
          const d = Math.abs(q.top - r.top) * 4 + Math.abs(q.left - r.left);
          if (d < best) { best = d; next = c; }
        }
      }
      if (next) { next.focus(); next.scrollIntoView({ block: 'nearest' }); }
    }
  });
  return board;
}

function viewSwitch() {
  let sw = $('#outline-views');
  if (sw) return sw;
  sw = document.createElement('div');
  sw.id = 'outline-views';
  sw.setAttribute('role', 'group');
  sw.setAttribute('aria-label', t('Outline view'));
  for (const [value, label] of [['list', t('List')], ['cards', t('Cards')]]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.view = value;
    b.textContent = label;
    b.onclick = () => {
      if ((library.outlineView || 'cards') === value) return;
      closeCardEditor();
      library.outlineView = value;
      writeLibrary(library);
      renderOutline();
    };
    sw.appendChild(b);
  }
  $('#aux-title').after(sw);
  return sw;
}

// called by renderOutline: shows the list or the board
function showOutlineView() {
  const sw = viewSwitch();
  const cards = outlineCardsOn();
  sw.hidden = !book || isScript(); // a script has only the cards
  for (const b of sw.querySelectorAll('button')) {
    const on = b.dataset.view === (cards ? 'cards' : 'list');
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  $('#outline-list').hidden = cards;
  outlineBoard().hidden = !cards;
  $('#editor-view').classList.toggle('board-on', cards);
  updateZoomDisplay();
  return cards;
}

function renderBoard() {
  const board = outlineBoard();
  if (!book) return;
  requestAnimationFrame(showCardSelection);
  closeCardEditor(true);
  board.innerHTML = '';
  const z = cardZoom();
  board.style.setProperty('--cz', z);
  board.classList.toggle('tiles', z < 0.8);
  board.classList.remove('script-board');
  if (isScript()) { renderScriptBoard(board); boardAddCard(board); boardHint(board); return; }
  const solo = soloStory();
  for (const chId of book.chapterOrder) {
    const kind = chapterKind(chId);
    if (kind === 'part') { board.appendChild(boardPartRow(chId)); continue; }
    if (!STORY_KINDS.includes(kind)) continue;
    const segs = chapterSegments(chId);
    const opening = segs[0] && !segs[0].id ? segs[0] : null;
    const run = [chapterCard(chId, opening, solo === chId)];
    let letter = 0;
    segs.forEach((seg, i) => {
      if (seg === opening) return;
      run.push(sectionCard(chId, seg, i, letter++));
    });
    // notes the page doesn't hold yet (written but emptied, or just made)
    const onPage = new Set(segs.map((s) => s.id).filter(Boolean));
    for (const sec of (book.sectionNotes || {})[chId] || []) {
      if (onPage.has(sec.id)) continue;
      run.push(sectionCard(chId, { id: sec.id, ps: [], words: 0, first: '', flag: false, virtual: true }, -1, letter++));
    }
    run.forEach((cell, i) => {
      if (i === 0) cell.classList.add('first');
      if (i === run.length - 1) cell.classList.add('last');
      board.appendChild(cell);
    });
  }
  boardAddCard(board);
  boardHint(board);
}

function boardHint(board) {
  let hint = $('#outline-board-hint');
  if (!hint) {
    hint = document.createElement('div');
    hint.id = 'outline-board-hint';
    hint.className = 'ol-hint';
    board.after(hint);
  }
  hint.hidden = false;
  hint.textContent = NO_HOVER
    ? t('Tap a card to write on it · hold a card to move it · hold and let go for more · + adds a card')
    : isScript()
      ? t('Click a card to write on it · drag it to move the scene · right-click for more · + adds a scene')
      : t('Click a card to write on it · drag it to move it, writing and all · right-click for more · + adds a card');
}

function boardPartRow(chId) {
  const row = document.createElement('div');
  row.className = 'ob-part';
  row.setAttribute('role', 'heading');
  row.setAttribute('aria-level', '3');
  const title = partTitleOf(chId);
  const label = document.createElement('span');
  label.textContent = chapterName(chId) + (title ? ' · ' + title : '');
  const rule = document.createElement('span');
  rule.className = 'ob-rule';
  row.append(label, rule);
  row.addEventListener('contextmenu', (e) => { e.preventDefault(); chapterMenu(chId, e.clientX, e.clientY, row); });
  return row;
}

function cardCell(kind, chId) {
  const cell = document.createElement('div');
  cell.className = 'ob-cell';
  cell.dataset.kind = kind;
  cell.dataset.ch = chId;
  cell.tabIndex = 0;
  cell.setAttribute('role', 'listitem');
  const card = document.createElement('div');
  card.className = 'ob-card ob-' + kind;
  cell.appendChild(card);
  if (kind !== 'loose') {
    // a + on the seam after the card: a new card right there
    const plus = document.createElement('button');
    plus.type = 'button';
    plus.className = 'ob-plus';
    plus.textContent = '+';
    plus.title = kind === 'scene' ? t('New scene after this one') : t('New card after this one');
    plus.setAttribute('aria-label', plus.title);
    plus.tabIndex = -1; // the keyboard has ⌥Enter
    plus.addEventListener('click', (e) => { e.stopPropagation(); if (!cell.dataset.new) newCardAfter(cell); });
    cell.appendChild(plus);
  }
  return { cell, card };
}

// the last place on the board: a new chapter (or scene) at the end
function boardAddCard(board) {
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'ob-add';
  const script = isScript();
  add.textContent = script ? t('+ Scene') : t('+ Chapter');
  add.addEventListener('click', () => {
    if (script) {
      const cells = [...board.querySelectorAll('.ob-cell[data-kind="scene"]')];
      const last = cells[cells.length - 1];
      if (last) { newCardAfter(last); return; }
      const fresh = sceneCard({ k: -1, s: { p: null }, id: null, slug: '', eighths: 0, cast: [], first: '' });
      fresh.dataset.new = '1';
      fresh.dataset.after = '-1';
      add.before(fresh);
      openCard(fresh, { fresh: true });
      return;
    }
    newChapterCard(storyEnd());
  });
  board.appendChild(add);
}

const cardWords = (n) => (n ? t('{n} words', { n: n.toLocaleString() }) : '');
const quoted = (s) => '“' + (s.length > 220 ? s.slice(0, 220).trim() + '…' : s) + '”';

function chapterCard(chId, opening, solo) {
  const { cell, card } = cardCell('chapter', chId);
  const kind = chapterKind(chId);
  const head = document.createElement('div');
  head.className = 'ob-head';
  const mark = document.createElement('span');
  mark.className = 'ob-mark';
  if (solo) { mark.textContent = t('The story'); mark.classList.add('ob-word'); }
  else if (kind === 'chapter') mark.textContent = String(chapterNumber(chId));
  else { mark.textContent = chapterName(chId); mark.classList.add('ob-word'); }
  const words = document.createElement('span');
  words.className = 'ob-words';
  const n = countWords(chapterText(chId));
  words.textContent = cardWords(n);
  head.append(mark, words);
  if (chapterHasFlag(chId)) head.appendChild(cardFlag());
  const text = document.createElement('div');
  text.className = 'ob-text';
  card.append(head, text);
  cell.dataset.excerpt = opening && opening.first ? quoted(opening.first) : '';
  fillCardText(cell, (book.chapterNotes || {})[chId] || '');
  cell.setAttribute('aria-label', (solo ? t('The story') : chapterName(chId)) + '. ' + text.textContent);
  return cell;
}

function sectionCard(chId, seg, segIdx, letterIdx) {
  const { cell, card } = cardCell('section', chId);
  cell.dataset.seg = String(segIdx);
  if (seg.id) cell.dataset.sec = seg.id;
  if (seg.virtual) cell.dataset.virtual = '1';
  const note = seg.id ? sectionNote(chId, seg.id) : null;
  const head = document.createElement('div');
  head.className = 'ob-head';
  const letter = document.createElement('span');
  letter.className = 'ob-letter';
  letter.textContent = secLetter(letterIdx);
  head.appendChild(letter);
  if (seg.flag) head.appendChild(cardFlag());
  const text = document.createElement('div');
  text.className = 'ob-text';
  const foot = document.createElement('div');
  foot.className = 'ob-foot';
  foot.textContent = seg.words ? cardWords(seg.words) : t('not written yet');
  card.append(head, text, foot);
  card.classList.toggle('unwritten', !seg.words);
  cell.dataset.written = seg.words ? '1' : '';
  cell.dataset.excerpt = seg.first ? quoted(seg.first) : '';
  fillCardText(cell, note ? note.text : '');
  cell.setAttribute('aria-label', t('Section {letter}', { letter: letter.textContent }) + '. ' + text.textContent + '. ' + foot.textContent);
  return cell;
}

// a card shows its note; with none, the section's first line, in quotes
function fillCardText(cell, note) {
  const text = cell.querySelector('.ob-text');
  text.classList.remove('excerpt', 'empty');
  if (note) text.textContent = note;
  else if (cell.dataset.excerpt) { text.textContent = cell.dataset.excerpt; text.classList.add('excerpt'); }
  else {
    text.textContent = cell.dataset.kind === 'chapter' ? t('What happens in this chapter…') : cell.dataset.kind === 'scene' ? t('What happens in this scene…') : t('What happens in this section…');
    text.classList.add('empty');
  }
}

function cardFlag() {
  const f = document.createElement('span');
  f.className = 'ob-flag';
  f.title = t('Unresolved placeholder');
  return f;
}
function chapterHasFlag(chId) {
  const body = chapterBodyEl(chId);
  return !!(body && body.querySelector('.ph-mark'));
}

// ---- writing on a card ----

let cardEditor = null; // { cell, text, before }

function openCard(cell, { fresh = false } = {}) {
  closeCardEditor();
  const text = cell.querySelector('.ob-text');
  const note = cardNoteOf(cell);
  cell.classList.add('open');
  // a card near the right edge opens toward the left
  const board = outlineBoard();
  const r = cell.getBoundingClientRect();
  const b = board.getBoundingClientRect();
  cell.classList.toggle('open-left', r.left + r.width * 2 > b.right + 4);
  text.classList.remove('excerpt', 'empty');
  text.textContent = note;
  // the page's own first line stays in view above the note, so opening a
  // card never looks like it wiped what was on it
  if (cell.dataset.excerpt && cell.dataset.kind !== 'loose') {
    const from = document.createElement('div');
    from.className = 'ob-from';
    from.textContent = cell.dataset.excerpt;
    text.before(from);
    text.dataset.ph = t('Write a note…');
  } else {
    text.dataset.ph = cell.dataset.kind === 'chapter' ? t('What happens in this chapter…') : cell.dataset.kind === 'scene' ? t('What happens in this scene…') : cell.dataset.kind === 'loose' ? t('Write a note…') : t('What happens in this section…');
  }
  text.contentEditable = 'true';
  text.spellcheck = false;
  text.setAttribute('role', 'textbox');
  // a scene's heading can be set right on its card
  const slug = cell.querySelector('.ob-slug');
  if (slug) {
    slug.contentEditable = 'true';
    slug.spellcheck = false;
    slug.setAttribute('role', 'textbox');
    slug.addEventListener('keydown', slugKeys);
    if (!slug.textContent.trim()) slug.textContent = '';
  }
  // the way to the page, and what Enter does
  const tools = document.createElement('div');
  tools.className = 'ob-tools';
  if (!cell.dataset.new && !cell.dataset.virtual) {
    const go = document.createElement('button');
    go.className = 'ob-go';
    go.type = 'button';
    go.textContent = t('Go to the page');
    go.addEventListener('mousedown', (e) => e.preventDefault()); // keep the note's focus until we leave
    go.onclick = () => { const c = cardEditor && cardEditor.cell; closeCardEditor(); if (c) goToCard(c); };
    tools.appendChild(go);
  }
  if (cell.dataset.kind !== 'loose') {
    const more = document.createElement('button');
    more.type = 'button';
    more.textContent = cell.dataset.kind === 'scene' ? t('New scene') : t('New card');
    more.addEventListener('mousedown', (e) => e.preventDefault());
    more.onclick = () => { const c = cardEditor && cardEditor.cell; if (c) newCardAfter(c); };
    tools.appendChild(more);
  }
  const tip = document.createElement('span');
  tip.textContent = fresh && cell.dataset.kind !== 'loose'
    ? t('Enter: another new card · Enter on an empty card, or Esc: done')
    : t('Enter: done · Tab: next card · {key}: new card', { key: K('⌥Enter', 'Alt+Enter') });
  tools.appendChild(tip);
  cell.querySelector('.ob-card').appendChild(tools);
  cardEditor = { cell, text, slug, before: note, slugBefore: slug ? slug.textContent : null, fresh };
  text.addEventListener('keydown', cardKeys);
  text.addEventListener('blur', cardBlur);
  text.addEventListener('paste', (e) => {
    e.preventDefault();
    const raw = e.clipboardData.getData('text/plain') || '';
    const items = pastedOutline(e.clipboardData);
    // a list (from Word, Obsidian, a notes app): one card per line (#348)
    if (items.length > 1) { pasteOutline(items); return; }
    document.execCommand('insertText', false, raw.replace(/\s+/g, ' '));
  });
  const first = slug && fresh ? slug : text;
  first.focus();
  const sel = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(first);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
  cell.scrollIntoView({ block: 'nearest' });
}

function cardNoteOf(cell) {
  if (cell.dataset.new) return '';
  const chId = cell.dataset.ch;
  if (cell.dataset.kind === 'chapter') return (book.chapterNotes || {})[chId] || '';
  if (cell.dataset.kind === 'loose') return (book.looseCards || []).find((c) => c.id === cell.dataset.loose)?.text || '';
  if (cell.dataset.kind === 'scene') return (cell.dataset.sid && (book.sceneNotes || {})[cell.dataset.sid]) || '';
  const note = cell.dataset.sec ? sectionNote(chId, cell.dataset.sec) : null;
  return note ? note.text : '';
}

function cardBlur() {
  // the window losing focus isn't the writer leaving the card
  setTimeout(() => {
    if (!cardEditor || !document.hasFocus()) return;
    if (cardEditor.cell.contains(document.activeElement) && document.activeElement.isContentEditable) return;
    closeCardEditor();
  }, 0);
}

// save what's on the open card and put it down
function closeCardEditor(quiet = false) {
  const ed = cardEditor;
  if (!ed) return;
  cardEditor = null;
  const { cell, text, slug } = ed;
  text.removeEventListener('keydown', cardKeys);
  text.removeEventListener('blur', cardBlur);
  text.contentEditable = 'false';
  text.removeAttribute('role');
  cell.classList.remove('open', 'open-left');
  cell.querySelector('.ob-tools')?.remove();
  cell.querySelector('.ob-from')?.remove();
  const val = text.textContent.replace(/\s+/g, ' ').trim();
  if (slug) {
    slug.removeEventListener('keydown', slugKeys);
    slug.removeEventListener('blur', cardBlur);
    slug.contentEditable = 'false';
    slug.removeAttribute('role');
    const sv = slug.textContent.replace(/\s+/g, ' ').trim();
    if (!quiet || val !== ed.before || sv !== ed.slugBefore) saveSceneCard(cell, val, sv);
    if (cell.isConnected && cell.dataset.new) cell.remove();
    else if (cell.isConnected) { fillCardText(cell, val); renderBoardLater(); }
    return;
  }
  if (!quiet || val !== ed.before) saveCard(cell, val);
  if (!cell.isConnected) return;
  if (cell.dataset.new && !val) { cell.remove(); return; }
  if (cell.dataset.kind !== 'loose') fillCardText(cell, cardNoteOf(cell));
}

function saveCard(cell, val) {
  if (!book) return;
  const chId = cell.dataset.ch;
  const kind = cell.dataset.kind;
  if (kind === 'loose') { saveLooseCard(cell.dataset.loose, val); return; }
  if (kind === 'chapter') {
    book.chapterNotes = book.chapterNotes || {};
    if ((book.chapterNotes[chId] || '') === val) return;
    book.chapterNotes[chId] = val;
    scheduleMetaSave();
    scheduleNavRefresh();
    return;
  }
  book.sectionNotes = book.sectionNotes || {};
  const list = book.sectionNotes[chId] = book.sectionNotes[chId] || [];
  if (cell.dataset.new) {
    if (!val) return;
    // a new card: a gray ghost on the page, after the card it came from
    const sec = { id: newSectionId(), text: val };
    const body = chapterBodyEl(chId);
    if (!body) return;
    const segs = chapterSegments(chId);
    const after = Number(cell.dataset.after);
    const next = segs[after + 1];
    list.push(sec);
    placeGhost(body, sec, next ? (next.brk || next.ps[0]) : null);
    orderSectionNotes(chId);
    syncChapter(body, chId, 'outline');
    scheduleMetaSave();
    delete cell.dataset.new;
    cell.dataset.sec = sec.id;
    reindexChapterCards(chId);
    return;
  }
  if (cell.dataset.sec) {
    const sec = list.find((s) => s.id === cell.dataset.sec);
    if (!sec || sec.text === val) return;
    sec.text = val;
    scheduleMetaSave();
    syncGhosts(chId);
    return;
  }
  if (!val) return;
  // a section written without an outline gets its first note: its first
  // line of prose carries the note's id from now on
  const seg = chapterSegments(chId)[Number(cell.dataset.seg)];
  const anchor = seg && seg.ps.find((p) => !p.classList.contains('ghost'));
  if (!anchor) return;
  const sec = { id: newSectionId(), text: val };
  anchor.dataset.secId = sec.id;
  list.push(sec);
  orderSectionNotes(chId);
  syncChapter(chapterBodyEl(chId), chId, 'outline');
  scheduleMetaSave();
  cell.dataset.sec = sec.id;
}

// after a card is set on the page, the chapter's cards learn their places
// (and letters) again, without redrawing the board under the writer's hand
function reindexChapterCards(chId) {
  const segs = chapterSegments(chId);
  const placed = segs.filter((sg, i) => !(i === 0 && !sg.id));
  const cells = [...outlineBoard().querySelectorAll(`.ob-cell[data-kind="section"][data-ch="${chId}"]`)];
  let k = 0;
  let letter = 0;
  for (const cell of cells) {
    if (!cell.dataset.new) cell.querySelector('.ob-letter').textContent = secLetter(letter++);
    if (cell.dataset.new || cell.dataset.virtual) continue;
    const seg = placed[k++];
    if (seg) cell.dataset.seg = String(segs.indexOf(seg));
  }
}

function cardKeys(e) {
  const ed = cardEditor;
  if (!ed) return;
  const { cell, text } = ed;
  e.stopPropagation();
  if (e.key === 'Escape') {
    e.preventDefault();
    closeCardEditor();
    if (cell.isConnected) cell.focus();
    return;
  }
  if (e.isComposing || e.keyCode === 229) return;
  // Enter on a new card with words on it: on to another new card, so an
  // outline can be typed straight through; Enter on an empty one stops
  // there (the way a list's empty bullet does), and so does Esc (#334)
  if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && ed.fresh &&
      cell.dataset.kind !== 'loose' && (text.textContent.trim() || (ed.slug && ed.slug.textContent.trim()))) {
    e.preventDefault();
    newCardAfter(cell);
    return;
  }
  // Enter: the card is done (and stays where the keyboard is)
  if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
    e.preventDefault();
    closeCardEditor();
    if (cell.isConnected) cell.focus();
    else renderBoardFocus(cell);
    return;
  }
  // Tab and ⇧Tab: on to the next card, or back to the one before
  if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey && !e.altKey) {
    e.preventDefault();
    const list = cell.closest('#loose-list') || outlineBoard();
    const cells = [...list.querySelectorAll('.ob-cell')];
    const at = cells.indexOf(cell);
    const ahead = e.shiftKey ? cells.slice(0, at).reverse() : cells.slice(at + 1);
    closeCardEditor();
    const next = ahead.find((c) => c.isConnected);
    if (next) openCard(next);
    else if (cell.isConnected) cell.focus();
    return;
  }
  // ⌥Enter (Alt+Enter): a new card after this one; on an empty new card,
  // a new chapter instead (the manuscript's Enter, Enter)
  if (e.key === 'Enter' && e.altKey && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    const empty = !text.textContent.trim();
    if (empty && cell.dataset.new && cell.dataset.kind === 'section') {
      const chId = cell.dataset.ch;
      cardEditor = null;
      cell.remove();
      newChapterCard(book.chapterOrder.indexOf(chId) + 1);
      return;
    }
    if (cell.dataset.kind === 'loose') { closeCardEditor(); addLooseCard(); return; }
    newCardAfter(cell);
    return;
  }
  if (e.key === 'Backspace' && !text.textContent) {
    e.preventDefault();
    if (cell.dataset.new) {
      const prev = cell.previousElementSibling;
      cardEditor = null;
      cell.remove();
      if (prev && prev.classList.contains('ob-cell')) openCard(prev);
      return;
    }
    if (cell.dataset.kind === 'loose') { cardEditor = null; removeLooseCard(cell.dataset.loose); return; }
    if (cell.dataset.kind === 'section' && cell.dataset.sec && !cell.dataset.written) {
      const chId = cell.dataset.ch;
      cardEditor = null;
      deleteSectionNote(chId, cell.dataset.sec);
    }
  }
}

// A pasted list, one item a line: bullets (-, *, •), numbers (1. 2)) and
// letters (a.) come off, blank lines go. A line indented more than the
// list's least indented ones is a level down. (#348)
// A list as plain text, one item a line. Its marks go: bullets (Word's
// second and third levels arrive as "o" and "§" before a tab), numbers and
// letters, Markdown's headings and checkboxes (Obsidian). An item indented
// past the least indented, or under one of Word's deeper bullets, is a level
// down.
function outlineLines(raw) {
  const items = [];
  for (const line of String(raw).replace(/\r\n?/g, '\n').split('\n')) {
    const m = /^([ \t]*)(?:([-*+•◦▪‣·–—])\s+|([o§])\t+|\d{1,3}[.)]\s+|[a-zA-Z][.)]\s+|#{1,6}\s+)?(?:\[[ xX]\]\s+)?(.*)$/.exec(line);
    const words = (m ? m[4] : line).replace(/\s+/g, ' ').trim();
    if (!words) continue;
    const deep = !!m && (!!m[3] || /^[◦▪]$/.test(m[2] || ''));
    items.push({ indent: (m ? m[1] : '').replace(/\t/g, '    ').length + (deep ? 1000 : 0), text: words });
  }
  return outlineLevels(items);
}
function outlineLevels(items) {
  const least = items.length ? Math.min(...items.map((x) => x.indent)) : 0;
  for (const x of items) x.level = x.indent > least ? 1 : 0;
  return items;
}
// The same list from the HTML a word processor or a web page puts on the
// clipboard beside the text, where the levels are real: nested <ul>/<ol>, or
// Word's own list paragraphs (mso-list … level2). Fewer than two items: none.
function outlineFromHtml(html) {
  if (!html || !/<li[\s>]|mso-list/i.test(html)) return [];
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const root = tpl.content;
  const items = [];
  const lis = [...root.querySelectorAll('li')];
  if (lis.length) {
    for (const li of lis) {
      const copy = li.cloneNode(true);
      copy.querySelectorAll('ul, ol').forEach((x) => x.remove());
      const text = copy.textContent.replace(/\s+/g, ' ').trim();
      if (!text) continue;
      let depth = 0;
      for (let a = li.parentElement; a; a = a.parentElement) if (a.tagName === 'UL' || a.tagName === 'OL') depth++;
      items.push({ indent: depth, text });
    }
  } else {
    for (const p of root.querySelectorAll('p')) {
      const m = /mso-list:\s*\S+\s+level(\d+)/i.exec(p.getAttribute('style') || '');
      const copy = p.cloneNode(true);
      copy.querySelectorAll('[style*="mso-list:Ignore" i], [style*="mso-list: Ignore" i]').forEach((x) => x.remove());
      const text = copy.textContent.replace(/\s+/g, ' ').trim();
      if (!text) continue;
      items.push({ indent: m ? +m[1] : 0, text });
    }
  }
  return items.length > 1 ? outlineLevels(items) : [];
}
// what was pasted, as a list: the HTML's levels when it has them, else the text's
function pastedOutline(data) {
  const fromHtml = outlineFromHtml(data.getData('text/html'));
  return fromHtml.length > 1 ? fromHtml : outlineLines(data.getData('text/plain') || '');
}

// The list's first line goes on the open card, and each line after it on a
// new card of its own, as if typed with Enter. On a chapter card the top
// lines are chapters and the indented ones their sections; on a section,
// scene or loose card, every line is another of the same.
function pasteOutline(items) {
  const ed = cardEditor;
  if (!ed) return;
  const kind = ed.cell.dataset.kind;
  document.execCommand('insertText', false, items[0].text);
  for (const it of items.slice(1)) {
    const cur = cardEditor && cardEditor.cell;
    if (!cur || !cur.isConnected) break;
    if (kind === 'loose') { closeCardEditor(); addLooseCard(); }
    else if (kind === 'chapter' && it.level === 0) {
      const chId = cur.dataset.ch;
      closeCardEditor();
      newChapterCard(book.chapterOrder.indexOf(chId) + 1);
    } else newCardAfter(cur);
    const next = cardEditor;
    if (!next || next.cell === cur) break;
    next.text.focus();
    next.text.textContent = it.text;
    const r = document.createRange();
    r.selectNodeContents(next.text);
    r.collapse(false);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(r);
  }
}

// a new card after this one, open to write on
function newCardAfter(cell) {
  closeCardEditor();
  if (!cell.isConnected) return;
  const fresh = makeNewCardAfter(cell, cell.dataset.ch);
  if (fresh) openCard(fresh, { fresh: true });
}

// a new chapter at this place in the book, its card open to write on
function newChapterCard(at) {
  closeCardEditor();
  snapshotStructure('card new chapter');
  const newId = createChapterAt(at);
  updateCounters();
  renderBoard();
  const nc = outlineBoard().querySelector(`.ob-cell[data-kind="chapter"][data-ch="${newId}"]`);
  if (nc) openCard(nc, { fresh: true });
}

// after a redraw, the keyboard goes back to the card it was on
function renderBoardFocus(cell) {
  const sel = cell.dataset.sec ? `.ob-cell[data-sec="${cell.dataset.sec}"]` : cell.dataset.kind === 'chapter' ? `.ob-cell[data-kind="chapter"][data-ch="${cell.dataset.ch}"]` : null;
  setTimeout(() => { const c = sel && outlineBoard().querySelector(sel); if (c) c.focus(); }, 150);
}

// in a scene's heading: Enter or Tab moves on to the note
function slugKeys(e) {
  e.stopPropagation();
  if (e.key === 'Escape') { e.preventDefault(); const c = cardEditor && cardEditor.cell; closeCardEditor(); if (c && c.isConnected) c.focus(); return; }
  if ((e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) || (e.key === 'Tab' && !e.shiftKey)) {
    e.preventDefault();
    const text = cardEditor && cardEditor.text;
    if (!text) return;
    text.focus();
    const r = document.createRange();
    r.selectNodeContents(text);
    r.collapse(false);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(r);
  }
}

// once a scene card is put down, the board takes in what changed
let boardLater = null;
function renderBoardLater() {
  clearTimeout(boardLater);
  boardLater = setTimeout(() => {
    if (!cardEditor && !cardDrag && currentTab === 'outline' && boardShowing()) renderBoard();
  }, 120);
}

// a blank card right after this one, in its chapter
function makeNewCardAfter(cell, chId) {
  if (!cell.isConnected) return null;
  if (cell.dataset.kind === 'scene') {
    const fresh = sceneCard({ k: -1, s: { p: null }, id: null, slug: '', eighths: 0, cast: [], first: '' });
    fresh.dataset.new = '1';
    fresh.dataset.after = cell.dataset.scene;
    fresh.querySelector('.ob-letter').textContent = '+';
    cell.after(fresh);
    return fresh;
  }
  const segs = chapterSegments(chId);
  let after;
  if (cell.dataset.kind === 'chapter') after = segs[0] && !segs[0].id ? 0 : -1;
  else if (cell.dataset.virtual || Number(cell.dataset.seg) < 0) after = segs.length - 1;
  else after = Number(cell.dataset.seg);
  const fresh = sectionCard(chId, { id: null, ps: [], words: 0, first: '', flag: false }, -1, 0);
  fresh.dataset.new = '1';
  fresh.dataset.after = String(after);
  fresh.querySelector('.ob-letter').textContent = '+';
  // it joins the chapter's mat
  cell.classList.remove('last');
  fresh.classList.add('last');
  let spot = cell;
  // a chapter card's new card goes before its first section
  if (cell.dataset.kind === 'chapter') spot = cell;
  spot.after(fresh);
  // if it landed mid-chapter, it isn't the end of the mat
  const n = fresh.nextElementSibling;
  if (n && n.classList.contains('ob-cell') && n.dataset.ch === chId) fresh.classList.remove('last');
  return fresh;
}

function deleteSectionNote(chId, secId) {
  snapshotStructure('card removed');
  book.sectionNotes[chId] = (book.sectionNotes[chId] || []).filter((s) => s.id !== secId);
  scheduleMetaSave();
  syncGhosts(chId);
  renderBoard();
}

// the card's place in the manuscript
function goToCard(cell) {
  if (cell.dataset.kind === 'scene') { goToScene(cell); return; }
  const chId = cell.dataset.ch;
  switchTab('manuscript');
  if (cell.dataset.kind === 'chapter') {
    focusChapterStart(chId);
    document.querySelector(`.chapter[data-id="${chId}"]`)?.scrollIntoView({ behavior: scrollBehavior(), block: 'start' });
    return;
  }
  const seg = chapterSegments(chId)[Number(cell.dataset.seg)];
  const p = seg && seg.ps[0];
  const body = chapterBodyEl(chId);
  if (!p || !body) { focusChapterStart(chId); return; }
  body.focus({ preventScroll: true });
  const r = document.createRange();
  if (p.classList.contains('ghost')) r.selectNodeContents(p); // ready to be written over
  else { r.setStart(p, 0); r.collapse(true); }
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
  currentChapterId = chId;
  highlightNav();
  p.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
}

async function cardMenu(cell, x, y) {
  if (cardSel.size > 1 && cardSel.has(cardKey(cell))) {
    const v = await popMenu(x, y, [{ label: t('Delete {n} cards', { n: cardSel.size }), value: 'delete', danger: true }], { from: cell });
    if (v === 'delete') await deleteSelectedCards();
    return;
  }
  const chId = cell.dataset.ch;
  if (cell.dataset.kind === 'chapter') { await chapterMenu(chId, x, y, cell); return; }
  if (cell.dataset.kind === 'loose') {
    const v = await popMenu(x, y, [{ label: t('Delete card'), value: 'delete', danger: true }], { from: cell });
    if (v === 'delete') removeLooseCard(cell.dataset.loose);
    return;
  }
  if (cell.dataset.new) return;
  if (cell.dataset.kind === 'scene') {
    const v = await popMenu(x, y, [
      { label: t('Go to the page'), value: 'go' },
      '-',
      { label: t('Delete the note'), value: 'delete', disabled: !cell.dataset.sid },
      { label: t('Delete scene'), value: 'deleteScene', danger: true }
    ], { from: cell });
    if (v === 'go') goToScene(cell);
    else if (v === 'deleteScene') await deleteSceneToDarlings(cell);
    else if (v === 'delete') {
      snapshotStructure('scene note removed');
      delete book.sceneNotes[cell.dataset.sid];
      scheduleMetaSave();
      renderBoard();
    }
    return;
  }
  const linked = !!cell.dataset.sec;
  const written = !!cell.dataset.written;
  const choice = await popMenu(x, y, [
    { label: t('Go to the page'), value: 'go', disabled: !!cell.dataset.virtual },
    { label: t('Make it a chapter'), value: 'chapter', disabled: !!cell.dataset.virtual },
    { label: t('Move to loose cards'), value: 'loose', disabled: !written && !linked },
    '-',
    { label: t('Delete the note'), value: 'delete', disabled: !linked },
    { label: t('Delete section'), value: 'deleteSection', danger: true, disabled: !!cell.dataset.virtual || (!written && !linked) }
  ], { from: cell });
  if (choice === 'go') goToCard(cell);
  else if (choice === 'chapter') sectionToChapter(chId, Number(cell.dataset.seg));
  else if (choice === 'loose') sectionToLoose(chId, Number(cell.dataset.seg), cell.dataset.virtual ? cell.dataset.sec : null);
  else if (choice === 'delete') {
    deleteSectionNote(chId, cell.dataset.sec);
    if (written) toast(t('The note is gone; the writing stays on the page'));
  } else if (choice === 'deleteSection') await deleteSectionToDarlings(chId, Number(cell.dataset.seg));
}

// A section card's Delete: its writing leaves the manuscript for Darlings
// (saved there before the chapter is), its note goes, and ⌘Z puts it back
async function deleteSectionToDarlings(chId, segIdx, quiet = false) {
  const body = chapterBodyEl(chId);
  const seg = chapterSegments(chId)[segIdx];
  if (!body || !seg) return;
  if (!quiet) snapshotStructure('section delete');
  const prose = seg.ps.filter((p) => !p.classList.contains('ghost'));
  if (seg.words) {
    const holder = document.createElement('div');
    for (const p of prose) holder.appendChild(p.cloneNode(true));
    for (const p of holder.querySelectorAll('[data-sec-id]')) p.removeAttribute('data-sec-id');
    darlings.unshift({
      id: 'd-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      html: captureBody(holder),
      text: prose.map((p) => p.textContent).join('\n').slice(0, 2000),
      chapterId: chId,
      chapterLabel: chapterName(chId),
      date: new Date().toISOString()
    });
    try {
      await writeSidecar(book.id, 'darlings', darlings);
    } catch {
      darlings.shift();
      toast(t('NEO couldn’t save to Darlings, so the section stays where it was'));
      return;
    }
    renderDarlings();
  }
  liftSegment(body, seg);
  if (seg.id) book.sectionNotes[chId] = (book.sectionNotes[chId] || []).filter((s) => s.id !== seg.id);
  orderSectionNotes(chId);
  syncChapter(body, chId, 'darling-out');
  clearTimeout(saveTimers[chId]);
  persistChapter(chId).then(() => saveMeta())
    .catch((err) => window.neo.logError('section delete: ' + (err && err.message || err)));
  renderBoard();
  updateCounters();
  if (seg.words && !quiet) toast(t('Section removed — its words are in Darlings, or {key} to undo', { key: KZ }));
}

// ---- moving cards ----

// lift a section out of its chapter: its *** and its lines
function liftSegment(body, seg) {
  if (seg.brk) seg.brk.remove();
  for (const p of seg.ps) p.remove();
  // the chapter's first section left: the next one's *** would open the chapter
  if (!seg.brk) {
    const f = body.firstElementChild;
    if (f && f.classList.contains('scene-break')) f.remove();
  }
  if (!body.firstElementChild) body.innerHTML = '<p><br></p>';
}

// set lines down in a chapter, before a section (or at the end)
function setSegmentDown(body, ps, brk, target) {
  const blank = !body.innerText.trim() && !body.querySelector('.scene-break, .ghost, .ph-mark');
  if (!target && blank) {
    body.innerHTML = '';
    for (const p of ps) body.appendChild(p);
    return;
  }
  const tBrk = target && target.brk && target.brk.isConnected ? target.brk : null;
  const tFirst = target && target.ps.find((p) => p.isConnected);
  if (tBrk) {
    body.insertBefore(brk || newSceneBreak(), tBrk);
    for (const p of ps) body.insertBefore(p, tBrk);
    return;
  }
  if (tFirst) {
    // ahead of the chapter's first section
    for (const p of ps) body.insertBefore(p, tFirst);
    body.insertBefore(brk || newSceneBreak(), tFirst);
    return;
  }
  if (!(body.lastElementChild && body.lastElementChild.classList.contains('scene-break'))) body.appendChild(brk || newSceneBreak());
  for (const p of ps) body.appendChild(p);
}

// placeholders keep their sticky notes pointed at the chapter they're in
function repointStickies(ps, chId) {
  let changed = false;
  for (const p of ps) {
    for (const m of p.querySelectorAll ? p.querySelectorAll('.ph-mark') : []) {
      const s = stickies.find((x) => x.id === m.dataset.sid);
      if (s && s.chapterId !== chId) { s.chapterId = chId; changed = true; }
    }
  }
  if (changed) { writeStickies(book.id, stickies); renderStickies(); }
}

// to = { ch, before }: before is a section's index in that chapter, or null for the end
function moveSection(fromCh, segIdx, to) {
  const fromBody = chapterBodyEl(fromCh);
  const toBody = chapterBodyEl(to.ch);
  if (!fromBody || !toBody) return;
  const fromSegs = chapterSegments(fromCh);
  const seg = fromSegs[segIdx];
  if (!seg) return;
  const toSegs = fromCh === to.ch ? fromSegs : chapterSegments(to.ch);
  const target = to.before == null ? null : toSegs[to.before] || null;
  if (target === seg) return;
  if (fromCh === to.ch && (to.before === segIdx + 1 || (to.before == null && segIdx === fromSegs.length - 1))) return;
  snapshotStructure('card moved');
  liftSegment(fromBody, seg);
  setSegmentDown(toBody, seg.ps, seg.brk, target);
  if (seg.id && fromCh !== to.ch) {
    const from = book.sectionNotes[fromCh] || [];
    const note = from.find((s) => s.id === seg.id);
    book.sectionNotes[fromCh] = from.filter((s) => s.id !== seg.id);
    if (note) (book.sectionNotes[to.ch] = book.sectionNotes[to.ch] || []).push(note);
  }
  orderSectionNotes(fromCh);
  if (fromCh !== to.ch) orderSectionNotes(to.ch);
  syncChapter(fromBody, fromCh, 'outline');
  if (fromCh !== to.ch) {
    syncChapter(toBody, to.ch, 'outline');
    // the chapter it lands in is saved before the one it left, so a save
    // that fails never leaves the section in neither
    clearTimeout(saveTimers[fromCh]);
    clearTimeout(saveTimers[to.ch]);
    persistChapter(to.ch).then(() => persistChapter(fromCh))
      .catch((err) => window.neo.logError('move section: ' + (err && err.message || err)));
  }
  repointStickies(seg.ps, to.ch);
  scheduleMetaSave();
  updateCounters();
}

function moveChapterCard(chId, index) {
  const from = book.chapterOrder.indexOf(chId);
  if (from === -1 || index === from || index === from + 1) return;
  snapshotStructure('chapter reorder');
  const order = book.chapterOrder.filter((c) => c !== chId);
  order.splice(index > from ? index - 1 : index, 0, chId);
  book.chapterOrder = order;
  saveMeta();
  renderChapters();
}

// a section on its own becomes the next chapter: its writing, and its note
// as the chapter's
function sectionToChapter(chId, segIdx) {
  const body = chapterBodyEl(chId);
  const seg = chapterSegments(chId)[segIdx];
  if (!body || !seg) return;
  snapshotStructure('card to chapter');
  liftSegment(body, seg);
  syncChapter(body, chId, 'outline');
  const note = seg.id ? sectionNote(chId, seg.id) : null;
  if (seg.id) book.sectionNotes[chId] = book.sectionNotes[chId].filter((s) => s.id !== seg.id);
  const prose = seg.ps.filter((p) => !p.classList.contains('ghost'));
  for (const p of prose) delete p.dataset.secId;
  const html = prose.length ? prose.map((p) => p.outerHTML).join('') : '<p><br></p>';
  const newId = newEntryId();
  book.chapterOrder.splice(book.chapterOrder.indexOf(chId) + 1, 0, newId);
  setChapterHTML(newId, html, 'outline');
  book.chapterNotes = book.chapterNotes || {};
  if (note && note.text) book.chapterNotes[newId] = note.text;
  for (const s of stickies) if (prose.some((p) => p.querySelector(`.ph-mark[data-sid="${s.id}"]`))) s.chapterId = newId;
  writeStickies(book.id, stickies);
  // the new chapter's file, then book.json naming it, and only then the
  // chapter it came out of: a failed save never leaves the words nowhere
  clearTimeout(saveTimers[chId]);
  persistChapter(newId, html).then(() => saveMeta()).then(() => persistChapter(chId))
    .catch((err) => window.neo.logError('section to chapter: ' + (err && err.message || err)));
  renderChapters();
  renderStickies();
  updateCounters();
  if (currentTab === 'outline') renderOutline();
}

// A card set aside for later. A note alone becomes a loose card; a section
// with writing takes its words along on the card (book.looseCards keeps them
// as html), out of the manuscript and the counts until it's dragged back.
function sectionToLoose(chId, segIdx, virtualSec) {
  if (virtualSec) {
    const note = sectionNote(chId, virtualSec);
    if (!note) return;
    snapshotStructure('card to loose');
    book.sectionNotes[chId] = book.sectionNotes[chId].filter((s) => s.id !== virtualSec);
    (book.looseCards = book.looseCards || []).push({ id: 'lc-' + Date.now().toString(36), text: note.text });
    scheduleMetaSave();
    renderLooseCards();
    renderBoard();
    return;
  }
  const seg = chapterSegments(chId)[segIdx];
  if (!seg) return;
  if (seg.words) { writtenSectionToLoose(chId, seg); return; }
  const note = seg.id ? sectionNote(chId, seg.id) : null;
  if (!note) return;
  snapshotStructure('card to loose');
  book.sectionNotes[chId] = book.sectionNotes[chId].filter((s) => s.id !== seg.id);
  (book.looseCards = book.looseCards || []).push({ id: 'lc-' + Date.now().toString(36), text: note.text });
  scheduleMetaSave();
  syncGhosts(chId);
  renderLooseCards();
  renderBoard();
}

async function writtenSectionToLoose(chId, seg) {
  if (seg.flag) { toast(t('That section has a placeholder in it. Drag it to another chapter instead.')); return; }
  const body = chapterBodyEl(chId);
  if (!body) return;
  snapshotStructure('card to loose');
  const note = seg.id ? sectionNote(chId, seg.id) : null;
  const holder = document.createElement('div');
  for (const p of seg.ps) if (!p.classList.contains('ghost')) holder.appendChild(p.cloneNode(true));
  for (const p of holder.querySelectorAll('[data-sec-id]')) p.removeAttribute('data-sec-id');
  const card = { id: 'lc-' + Date.now().toString(36), text: note ? note.text : '', html: captureBody(holder), words: seg.words };
  (book.looseCards = book.looseCards || []).push(card);
  // the card that holds the words is on disk before the chapter loses them
  let stamp = null;
  try { stamp = await writeBookMeta(book.id, book); } catch (err) { window.neo.logError('section to loose: ' + (err && err.message || err)); }
  if (typeof stamp !== 'string') {
    book.looseCards = book.looseCards.filter((c) => c !== card);
    toast(t('NEO couldn’t save the card, so the section stays where it was'));
    return;
  }
  book.modified = stamp;
  liftSegment(body, seg);
  if (seg.id) book.sectionNotes[chId] = book.sectionNotes[chId].filter((s) => s.id !== seg.id);
  orderSectionNotes(chId);
  syncChapter(body, chId, 'outline');
  clearTimeout(saveTimers[chId]);
  saveMeta().then(() => persistChapter(chId))
    .catch((err) => window.neo.logError('section to loose: ' + (err && err.message || err)));
  renderLooseCards();
  renderBoard();
  updateCounters();
  toast(t('Its words went with it, onto the loose card. Drag it back onto the board to put them in again.'), 6000);
}

function looseToSection(looseId, to) {
  const card = (book.looseCards || []).find((c) => c.id === looseId);
  const body = chapterBodyEl(to.ch);
  if (!card || !body) return;
  snapshotStructure('loose card placed');
  book.looseCards = book.looseCards.filter((c) => c.id !== looseId);
  const sec = { id: newSectionId(), text: card.text };
  const target = to.before == null ? null : chapterSegments(to.ch)[to.before];
  if (card.html) {
    // a card that holds writing: its words go back in as a section
    const holder = document.createElement('div');
    holder.innerHTML = card.html;
    const ps = [...holder.children];
    if (ps.length) {
      if (sec.text) {
        ps[0].dataset.secId = sec.id;
        (book.sectionNotes[to.ch] = book.sectionNotes[to.ch] || []).push(sec);
      }
      setSegmentDown(body, ps, null, target);
    }
    orderSectionNotes(to.ch);
    syncChapter(body, to.ch, 'outline');
    // the chapter with the words is saved before the card leaves book.json
    clearTimeout(saveTimers[to.ch]);
    persistChapter(to.ch).then(() => saveMeta())
      .catch((err) => window.neo.logError('loose to section: ' + (err && err.message || err)));
    renderLooseCards();
    updateCounters();
    return;
  }
  (book.sectionNotes[to.ch] = book.sectionNotes[to.ch] || []).push(sec);
  if (sec.text) placeGhost(body, sec, target ? (target.brk || target.ps[0]) : null);
  orderSectionNotes(to.ch);
  syncChapter(body, to.ch, 'outline');
  scheduleMetaSave();
  renderLooseCards();
}

// ---- one chapter becomes a section of another ----
// Tab on a chapter's line in the List, or a chapter card dropped on the
// middle of another: the chapter's writing goes to the end of the other
// one, after a ***, its note (or its title) becomes that section's note,
// and its own sections come along. Nothing is lost; ⌘Z puts it back.
// Resolves to the new section's id, or null when it can't be done.
async function joinChapter(chId, intoCh) {
  if (!book || !intoCh || chId === intoCh) return null;
  if (!isStory(chId) || !isStory(intoCh)) { toast(t('Only chapters can become sections')); return null; }
  const from = chapterBodyEl(chId);
  const into = chapterBodyEl(intoCh);
  if (!from || !into) return null;
  closeCardEditor();
  snapshotStructure('chapter joined', { outlineFocus: { chId } });
  book.sectionNotes = book.sectionNotes || {};
  const notes = book.sectionNotes[intoCh] = book.sectionNotes[intoCh] || [];
  const sec = { id: newSectionId(), text: ((book.chapterNotes || {})[chId] || '').trim() || ((book.chapterTitles || {})[chId] || '').trim() };
  // what the chapter holds (a chapter of one empty line holds nothing)
  const kids = [...from.children];
  const hasLines = kids.some((el) => el.textContent.trim() || el.querySelector('.ph-mark'));
  const moving = hasLines ? kids : [];
  const intoBlank = !into.innerText.trim() && !into.querySelector('.scene-break, .ghost, .ph-mark');
  if (hasLines) {
    if (intoBlank) into.innerHTML = '';
    else if (!(into.lastElementChild && into.lastElementChild.classList.contains('scene-break'))) into.appendChild(newSceneBreak(sec.id));
    // a chapter that opened with a *** keeps just the one
    if (moving[0].classList.contains('scene-break') && into.lastElementChild && into.lastElementChild.classList.contains('scene-break')) moving.shift().remove();
    for (const el of moving) into.appendChild(el);
    // the chapter's opening carries the new section's note; an opening
    // that's only outline gets the note as a ghost of its own
    const opening = moving[0] && !moving[0].classList.contains('scene-break') && !moving[0].classList.contains('ghost') ? moving[0] : null;
    if (opening) opening.dataset.secId = sec.id;
    else if (sec.text && moving[0]) placeGhost(into, sec, moving[0]);
    repointStickies(moving, intoCh);
  }
  notes.push(sec);
  for (const n of book.sectionNotes[chId] || []) notes.push(n);
  delete book.sectionNotes[chId];
  if (!hasLines && sec.text) placeGhost(into, sec, null);
  orderSectionNotes(intoCh);
  syncChapter(into, intoCh, 'outline');
  // the words are safe in the other chapter before this one's file goes
  try { await persistChapter(intoCh); } catch (err) { window.neo.logError('join: ' + (err && err.message || err)); return null; }
  if (book.chapterTitles) delete book.chapterTitles[chId];
  rec.streams('outline');
  await deleteChapterQuiet(chId, 'merge');
  updateCounters();
  return sec.id;
}

// ---- dragging (pointer events, so a finger works the same as a mouse) ----

let cardDrag = null;
document.addEventListener('touchmove', (e) => { if (cardDrag && cardDrag.live) e.preventDefault(); }, { passive: false });

function cardPress(e, src) {
  const touch = e.pointerType !== 'mouse';
  const pick = e.shiftKey ? 'range' : (IS_MAC ? e.metaKey : e.ctrlKey) ? 'toggle' : null;
  const st = { src, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, live: false, held: false, timer: null, float: null, target: null };
  cardDrag = st;
  const finish = () => {
    clearTimeout(st.timer);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('keydown', esc, true);
    endCardDrag(st);
    if (cardDrag === st) cardDrag = null;
  };
  const move = (ev) => {
    st.x = ev.clientX;
    st.y = ev.clientY;
    const far = Math.hypot(st.x - st.x0, st.y - st.y0);
    if (!st.live) {
      if (touch && !st.held) { if (far > 8) finish(); return; } // a scroll, not a press
      if (!touch && far < 5) return;
      beginCardDrag(st);
    }
    dragOver(st);
  };
  const up = () => {
    const { live, held } = st;
    const target = st.target;
    finish();
    if (live) { dropCard(st.src, target); return; }
    // a press that went nowhere: a click (or, held on a touch screen, the menu)
    const cell = st.src.cell;
    if (held) cardMenu(cell, st.x, st.y);
    else if (pick) selectCard(cell, pick);
    else { clearCardSelection(); openCard(cell); }
  };
  const cancel = () => finish();
  const esc = (ev) => { if (ev.key === 'Escape' && st.live) { ev.preventDefault(); ev.stopPropagation(); st.target = null; finish(); } };
  if (touch) st.timer = setTimeout(() => { st.held = true; if (navigator.vibrate) try { navigator.vibrate(10); } catch { /* fine */ } }, 380);
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
  window.addEventListener('keydown', esc, true);
}

// ---- several cards at once ----
// ⌘-click (Ctrl-click) adds a card to the selection or takes it out,
// Shift-click takes the run from the last one picked, and a drag across the
// board's empty space sweeps up every card it touches. Delete (or the
// right-click menu) removes them together: their writing goes to Darlings,
// and one ⌘Z brings them all back. A plain click, or Esc, lets go.
let cardSel = new Set();
let cardSelAnchor = null;
function cardKey(cell) {
  const d = cell.dataset;
  if (d.kind === 'loose') return 'l|' + d.loose;
  if (d.kind === 'scene') return 'n|' + d.scene;
  if (d.kind === 'chapter') return 'c|' + d.ch;
  return 's|' + d.ch + '|' + (d.seg || '') + '|' + (d.virtual ? d.sec : '');
}
const selectableCells = () => $$('#outline-board .ob-cell:not([data-new]), #loose-list .ob-cell');
function showCardSelection() {
  for (const c of selectableCells()) c.classList.toggle('ob-sel', cardSel.has(cardKey(c)));
}
function clearCardSelection() {
  if (!cardSel.size) return;
  cardSel = new Set();
  cardSelAnchor = null;
  showCardSelection();
}
function selectCard(cell, how) {
  closeCardEditor();
  const key = cardKey(cell);
  if (how === 'range' && cardSelAnchor) {
    const cells = selectableCells();
    const a = cells.findIndex((c) => cardKey(c) === cardSelAnchor);
    const b = cells.indexOf(cell);
    if (a >= 0 && b >= 0) for (const c of cells.slice(Math.min(a, b), Math.max(a, b) + 1)) cardSel.add(cardKey(c));
    else cardSel.add(key);
  } else if (cardSel.has(key)) cardSel.delete(key);
  else cardSel.add(key);
  cardSelAnchor = key;
  showCardSelection();
}
function cardLasso(e) {
  const x0 = e.clientX;
  const y0 = e.clientY;
  const keep = e.shiftKey || e.metaKey || e.ctrlKey ? new Set(cardSel) : new Set();
  let box = null;
  const move = (ev) => {
    if (!box) {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return;
      closeCardEditor();
      box = document.createElement('div');
      box.className = 'ob-lasso';
      document.body.appendChild(box);
      document.body.classList.add('ob-lassoing');
    }
    ev.preventDefault();
    const ts = window.getSelection();
    if (ts && !ts.isCollapsed) ts.removeAllRanges(); // a sweep, not a text selection
    const l = Math.min(x0, ev.clientX), t0 = Math.min(y0, ev.clientY);
    const r = Math.max(x0, ev.clientX), b = Math.max(y0, ev.clientY);
    Object.assign(box.style, { left: l + 'px', top: t0 + 'px', width: (r - l) + 'px', height: (b - t0) + 'px' });
    cardSel = new Set(keep);
    for (const c of $$('#outline-board .ob-cell:not([data-new])')) {
      const q = c.querySelector('.ob-card').getBoundingClientRect();
      if (q.right > l && q.left < r && q.bottom > t0 && q.top < b) cardSel.add(cardKey(c));
    }
    showCardSelection();
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    document.body.classList.remove('ob-lassoing');
    if (box) box.remove();
    else clearCardSelection(); // a click on the empty board lets go
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}
// Delete or Backspace with cards picked (not while writing on one)
document.addEventListener('keydown', (e) => {
  if (!cardSel.size || !book || currentTab !== 'outline') return;
  if (e.target && e.target.closest && e.target.closest('[contenteditable="true"], input, textarea')) return;
  if (e.key === 'Escape') { clearCardSelection(); return; }
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelectedCards(); }
});

async function deleteSelectedCards() {
  const cells = selectableCells().filter((c) => cardSel.has(cardKey(c)));
  clearCardSelection();
  if (!cells.length || !book) return;
  snapshotStructure('cards delete');
  const chapters = new Set(cells.filter((c) => c.dataset.kind === 'chapter').map((c) => c.dataset.ch));
  // a book keeps at least one chapter of its story
  const stories = book.chapterOrder.filter((c) => isStory(c));
  if (stories.length && stories.every((c) => chapters.has(c))) chapters.delete(stories[0]);
  // sections from the last up, so the ones before keep their places; none
  // from a chapter that's going whole
  const sections = cells.filter((c) => c.dataset.kind === 'section' && !chapters.has(c.dataset.ch))
    .sort((a, b) => Number(b.dataset.seg || -1) - Number(a.dataset.seg || -1));
  for (const c of sections) {
    if (c.dataset.virtual) deleteSectionNote(c.dataset.ch, c.dataset.sec);
    else await deleteSectionToDarlings(c.dataset.ch, Number(c.dataset.seg), true);
  }
  const scenes = cells.filter((c) => c.dataset.kind === 'scene').sort((a, b) => Number(b.dataset.scene) - Number(a.dataset.scene));
  for (const c of scenes) await deleteSceneToDarlings(c, true);
  for (const chId of chapters) await deleteChapterToDarlings(chId, true);
  for (const c of cells.filter((x) => x.dataset.kind === 'loose')) await removeLooseCard(c.dataset.loose, true);
  renderLooseCards();
  if (currentTab === 'outline') renderOutline();
  updateCounters();
  toast(t('{n} cards removed — their writing is in Darlings, or {key} to undo', { n: cells.length, key: KZ }), 6000);
}

function beginCardDrag(st) {
  st.live = true;
  closeCardEditor();
  const card = st.src.cell.querySelector('.ob-card');
  const r = card.getBoundingClientRect();
  const float = card.cloneNode(true);
  float.classList.add('ob-float');
  float.style.width = r.width + 'px';
  float.style.height = r.height + 'px';
  st.dx = st.x0 - r.left;
  st.dy = st.y0 - r.top;
  document.body.appendChild(float);
  st.float = float;
  st.src.cell.classList.add('ob-lifted');
  document.body.classList.add('ob-dragging');
  // the loose pane opens to take a card
  const c = st.src.cell;
  if ((st.src.kind === 'section' && (c.dataset.written || c.dataset.sec)) || st.src.kind === 'scene' ||
      (st.src.kind === 'chapter' && canSetChapterAside(c.dataset.ch))) $('#side-pane').classList.add('drop-ready');
}

function endCardDrag(st) {
  if (st.float) st.float.remove();
  st.src.cell.classList.remove('ob-lifted');
  document.body.classList.remove('ob-dragging');
  $('#side-pane').classList.remove('drop-ready', 'drop-over');
  $('#ob-caret')?.remove();
  $('#ob-join-tip')?.remove();
  for (const c of $$('.ob-cell.ob-join')) c.classList.remove('ob-join');
  clearInterval(st.scroller);
}

function dragOver(st) {
  st.float.style.left = (st.x - st.dx) + 'px';
  st.float.style.top = (st.y - st.dy) + 'px';
  // the right edge opens the loose cards for a card that can go there
  const pane = $('#side-pane');
  if (pane.classList.contains('drop-ready') && st.x > window.innerWidth - 36) pane.classList.add('open');
  st.target = dragTarget(st);
  showDropCaret(st.target);
  // near the top or bottom: the board scrolls
  const sc = $('#paper-scroll');
  const r = sc.getBoundingClientRect();
  const edge = st.y < r.top + 50 ? -1 : st.y > r.bottom - 50 ? 1 : 0;
  clearInterval(st.scroller);
  if (edge) st.scroller = setInterval(() => { sc.scrollTop += edge * 14; st.target = dragTarget(st); showDropCaret(st.target); }, 30);
}

// where a card would land: { cell, side } on the board, or the loose pane
function dragTarget(st) {
  // a loose card holding a whole chapter goes back in as a chapter
  const kind = st.src.kind === 'loose' && st.src.cell.dataset.held === 'chapter' ? 'chapter' : st.src.kind;
  const pane = $('#side-pane');
  const pr = pane.getBoundingClientRect();
  const overPane = pane.classList.contains('open') && st.x >= pr.left && st.x <= pr.right && st.y >= pr.top && st.y <= pr.bottom;
  pane.classList.toggle('drop-over', overPane && pane.classList.contains('drop-ready'));
  if (overPane) return pane.classList.contains('drop-ready') ? { loose: true } : null;
  const cells = [...outlineBoard().querySelectorAll('.ob-cell:not(.ob-lifted):not([data-new])')];
  if (!cells.length) return null;
  // the card under the pointer, or the nearest one in its line
  let best = null;
  let bestD = Infinity;
  for (const c of cells) {
    const r = c.getBoundingClientRect();
    const dy = st.y < r.top ? r.top - st.y : st.y > r.bottom ? st.y - r.bottom : 0;
    const dx = st.x < r.left ? r.left - st.x : st.x > r.right ? st.x - r.right : 0;
    const d = dy * 3 + dx;
    if (d < bestD) { bestD = d; best = c; }
  }
  const r = best.getBoundingClientRect();
  // over the middle of a chapter card: into that chapter (a chapter joins
  // it as a section; a section or loose card goes to its end)
  const middle = st.x > r.left + r.width * 0.25 && st.x < r.right - r.width * 0.25 && st.y >= r.top && st.y <= r.bottom;
  if (middle && best.dataset.kind === 'chapter' && (kind === 'section' || kind === 'loose' || (kind === 'chapter' && st.src.kind === 'chapter' && best.dataset.ch !== st.src.cell.dataset.ch))) {
    return { cell: best, side: 'into' };
  }
  let side = st.x < r.left + r.width / 2 ? 'before' : 'after';
  // a chapter goes in only between chapters
  if (kind === 'chapter') {
    if (best.dataset.kind !== 'chapter' || side === 'after') {
      // after this card's chapter
      const run = cells.filter((c) => c.dataset.ch === best.dataset.ch);
      best = run[run.length - 1];
      side = 'after';
    }
  }
  return { cell: best, side };
}

function showDropCaret(target) {
  let caret = $('#ob-caret');
  for (const c of $$('.ob-cell.ob-join')) if (!target || c !== target.cell || target.side !== 'into') c.classList.remove('ob-join');
  let tip = $('#ob-join-tip');
  if (target && target.side === 'into') {
    if (caret) caret.remove();
    target.cell.classList.add('ob-join');
    if (!tip) {
      tip = document.createElement('div');
      tip.id = 'ob-join-tip';
      document.body.appendChild(tip);
    }
    const name = chapterName(target.cell.dataset.ch);
    tip.textContent = cardDrag && cardDrag.src.kind === 'chapter'
      ? t('becomes a section of {chapter}', { chapter: name })
      : t('goes to the end of {chapter}', { chapter: name });
    const r = target.cell.getBoundingClientRect();
    tip.style.left = (r.left + 8) + 'px';
    tip.style.top = (r.bottom + 4) + 'px';
    return;
  }
  if (tip) tip.remove();
  if (!target || !target.cell) { if (caret) caret.remove(); return; }
  if (!caret) {
    caret = document.createElement('div');
    caret.id = 'ob-caret';
    document.body.appendChild(caret);
  }
  const r = target.cell.getBoundingClientRect();
  caret.style.left = (target.side === 'before' ? r.left - 2 : r.right - 1) + 'px';
  caret.style.top = (r.top + 6) + 'px';
  caret.style.height = Math.max(10, r.height - 12) + 'px';
}

function dropCard(src, target) {
  if (!target || !book) return;
  clearCardSelection(); // the cards picked may stand elsewhere after a move
  const cell = src.cell;
  if (target.loose) {
    if (src.kind === 'section') sectionToLoose(cell.dataset.ch, Number(cell.dataset.seg), cell.dataset.virtual ? cell.dataset.sec : null);
    else if (src.kind === 'chapter') chapterToLoose(cell.dataset.ch);
    else if (src.kind === 'scene') sceneToLoose(cell);
    return;
  }
  const tc = target.cell;
  // a card holding a chapter: a chapter again, before or after the one it's dropped by
  if (src.kind === 'loose' && cell.dataset.held === 'chapter') {
    const at = book.chapterOrder.indexOf(tc.dataset.ch);
    if (at < 0) return;
    looseToChapter(cell.dataset.loose, at + (tc.dataset.kind === 'chapter' && target.side === 'before' ? 0 : 1));
    renderBoard();
    return;
  }
  if (target.side === 'into') {
    const into = tc.dataset.ch;
    if (src.kind === 'chapter') { joinChapter(cell.dataset.ch, into).then(() => { if (currentTab === 'outline') renderBoard(); }); return; }
    if (src.kind === 'loose') looseToSection(cell.dataset.loose, { ch: into, before: null });
    else if (cell.dataset.virtual) moveVirtualNote(cell.dataset.ch, cell.dataset.sec, into);
    else moveSection(cell.dataset.ch, Number(cell.dataset.seg), { ch: into, before: null });
    renderBoard();
    return;
  }
  if (tc.dataset.kind === 'scene') {
    const idx = Number(tc.dataset.scene);
    const to = target.side === 'before' ? idx : idx + 1;
    if (src.kind === 'scene') spMoveScene(Number(cell.dataset.scene), to);
    else if (src.kind === 'loose') looseToScene(cell.dataset.loose, to);
    renderBoard();
    return;
  }
  if (src.kind === 'chapter') {
    const at = book.chapterOrder.indexOf(tc.dataset.ch) + (target.side === 'after' ? 1 : 0);
    moveChapterCard(cell.dataset.ch, at);
    renderBoard();
    return;
  }
  // a section (or a loose card): which chapter, and before which section
  let to;
  if (tc.dataset.kind === 'chapter') {
    if (target.side === 'after') to = { ch: tc.dataset.ch, before: firstSectionIndex(tc.dataset.ch) };
    else {
      const prev = storyBefore(tc.dataset.ch);
      to = prev ? { ch: prev, before: null } : { ch: tc.dataset.ch, before: firstSectionIndex(tc.dataset.ch) };
    }
  } else {
    const idx = Number(tc.dataset.seg);
    if (target.side === 'before') to = { ch: tc.dataset.ch, before: idx >= 0 ? idx : null };
    else {
      const segs = chapterSegments(tc.dataset.ch);
      to = { ch: tc.dataset.ch, before: idx >= 0 && idx + 1 < segs.length ? idx + 1 : null };
    }
  }
  if (src.kind === 'loose') looseToSection(cell.dataset.loose, to);
  else if (cell.dataset.virtual) {
    // a note that isn't on the page yet just changes chapters
    moveVirtualNote(cell.dataset.ch, cell.dataset.sec, to.ch);
  } else moveSection(cell.dataset.ch, Number(cell.dataset.seg), to);
  renderBoard();
}

function firstSectionIndex(chId) {
  const segs = chapterSegments(chId);
  const i = segs[0] && !segs[0].id ? 1 : 0;
  return i < segs.length ? i : null;
}

function moveVirtualNote(fromCh, secId, toCh) {
  if (fromCh === toCh) return;
  snapshotStructure('card moved');
  const note = sectionNote(fromCh, secId);
  book.sectionNotes[fromCh] = book.sectionNotes[fromCh].filter((s) => s.id !== secId);
  if (note) (book.sectionNotes[toCh] = book.sectionNotes[toCh] || []).push(note);
  scheduleMetaSave();
}

// ---- a script's board: every scene a card ----
// A scene is its heading and the lines under it (spLayout.scenes). Its card
// shows the heading, how long it runs in eighths of a page, who's in it, and
// the writer's note (book.sceneNotes, keyed by an id on the heading line;
// the first heading to carry an id owns it), or else its first line of
// action. Dragging a card moves the scene, as dragging it in the pane does.

const newSceneId = () => 'sc-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

// the scene's lines, heading first
function sceneNodes(s) {
  const nodes = [s.p];
  for (let n = s.p.nextElementSibling; n && !(n.tagName === 'P' && spType(n) === 'heading'); n = n.nextElementSibling) nodes.push(n);
  return nodes;
}

function scriptScenes() {
  spRepaginate();
  const notes = book.sceneNotes || {};
  const claimed = new Set();
  return (spLayout.scenes || []).filter((s) => s.p.isConnected).map((s, k) => {
    const nodes = sceneNodes(s);
    let id = s.p.dataset.sceneId || null;
    if (id && (claimed.has(id) || !(id in notes))) id = null;
    if (id) claimed.add(id);
    const cast = [];
    for (const n of nodes) {
      if (spType(n) !== 'character') continue;
      const name = n.textContent.replace(/\(.*?\)/g, '').replace(/\^$/, '').trim().toUpperCase();
      if (name && !cast.includes(name)) cast.push(name);
    }
    const action = nodes.slice(1).find((n) => spType(n) === 'action' && n.textContent.trim());
    return { k, s, id, slug: s.slug, eighths: spEighths(s.lines), cast, first: action ? action.textContent.replace(/\s+/g, ' ').trim() : '' };
  });
}

function renderScriptBoard(board) {
  board.classList.add('script-board');
  rescueSceneNotes();
  for (const sc of scriptScenes()) board.appendChild(sceneCard(sc));
}

// A note whose heading is gone from the page (its scene cut away, or its
// line made into something else) goes to the loose cards, not nowhere
function rescueSceneNotes() {
  const notes = book.sceneNotes || {};
  const ids = Object.keys(notes);
  if (!ids.length) return;
  const ps = spParas();
  if (!ps.length) return; // the page isn't up yet
  const onPage = new Set(ps.filter((p) => spType(p) === 'heading').map((p) => p.dataset.sceneId).filter(Boolean));
  let moved = false;
  for (const id of ids) {
    if (onPage.has(id)) continue;
    if (String(notes[id] || '').trim()) (book.looseCards = book.looseCards || []).push({ id: 'lc-' + id, text: notes[id] });
    delete notes[id];
    moved = true;
  }
  if (moved) { scheduleMetaSave(); renderLooseCards(); }
}

function sceneCard(sc) {
  const { cell, card } = cardCell('scene', spChapterOf(sc.s.p) || '');
  cell.dataset.scene = String(sc.k);
  if (sc.id) cell.dataset.sid = sc.id;
  const head = document.createElement('div');
  head.className = 'ob-head';
  const num = document.createElement('span');
  num.className = 'ob-letter';
  num.textContent = String(sc.k + 1);
  const len = document.createElement('span');
  len.className = 'ob-words';
  len.textContent = sc.eighths ? spEighthsText(sc.eighths) : '';
  head.append(num, len);
  const slug = document.createElement('div');
  slug.className = 'ob-slug';
  slug.textContent = sc.slug;
  slug.dataset.ph = t('INT. PLACE - DAY');
  const text = document.createElement('div');
  text.className = 'ob-text';
  const foot = document.createElement('div');
  foot.className = 'ob-foot';
  foot.textContent = sc.cast.join(' · ');
  card.append(head, slug, text, foot);
  cell.dataset.excerpt = sc.first ? quoted(sc.first) : '';
  fillCardText(cell, sc.id ? book.sceneNotes[sc.id] : '');
  cell.setAttribute('aria-label', t('Scene {n}', { n: sc.k + 1 }) + '. ' + (sc.slug || '') + '. ' + text.textContent);
  return cell;
}

// the scene a card stands for, as the page has it now
function sceneOfCell(cell) {
  return scriptScenes()[Number(cell.dataset.scene)] || null;
}

// a new scene, after scene k (-1: before the first), with its heading and an
// empty line of action under it
function insertScene(k, slug) {
  const scenes = scriptScenes();
  const h = document.createElement('p');
  h.className = 'sp-heading';
  if (slug) h.textContent = slug; else h.appendChild(document.createElement('br'));
  const a = document.createElement('p');
  a.appendChild(document.createElement('br'));
  let body;
  if (k < 0 && scenes[0]) {
    body = spBodyOf(scenes[0].s.p);
    scenes[0].s.p.before(h, a);
  } else if (scenes[k]) {
    const nodes = sceneNodes(scenes[k].s);
    body = spBodyOf(scenes[k].s.p);
    nodes[nodes.length - 1].after(h, a);
  } else {
    const bodies = spBodies();
    body = bodies[bodies.length - 1];
    if (!body) return null;
    const last = body.lastElementChild;
    // an empty last line becomes the heading's place
    if (last && !last.textContent.trim() && spType(last) === 'action' && body.children.length > 1) last.remove();
    body.append(h, a);
  }
  syncChapter(body, body.closest('.chapter').dataset.id, 'outline');
  breakRun++;
  spRepaginate();
  return h;
}

function saveSceneCard(cell, note, slug) {
  if (cell.dataset.new) {
    if (!note && !slug) return;
    snapshotStructure('scene added');
    if (slug) slug = slug.replace(/\s[–—]\s/g, ' - ');
    const h = insertScene(Number(cell.dataset.after), slug);
    if (!h) return;
    delete cell.dataset.new;
    cell.dataset.scene = String((spLayout.scenes || []).findIndex((x) => x.p === h));
    if (note) {
      const id = newSceneId();
      (book.sceneNotes = book.sceneNotes || {})[id] = note;
      h.dataset.sceneId = id;
      syncChapter(spBodyOf(h), spChapterOf(h), 'outline');
      scheduleMetaSave();
    }
    renderNav();
    return;
  }
  const sc = sceneOfCell(cell);
  if (!sc) return;
  const h = sc.s.p;
  // a heading keeps its plain hyphens (the card's typing makes dashes of them)
  if (slug) slug = slug.replace(/\s[–—]\s/g, ' - ');
  let changed = false;
  if (slug !== null && slug !== sc.slug) {
    h.textContent = slug;
    if (!slug) h.appendChild(document.createElement('br'));
    changed = true;
  }
  const had = sc.id ? book.sceneNotes[sc.id] : '';
  if (note !== had) {
    book.sceneNotes = book.sceneNotes || {};
    let id = sc.id;
    if (!id) {
      if (!note) return;
      id = newSceneId();
      h.dataset.sceneId = id;
      changed = true;
    }
    book.sceneNotes[id] = note;
    scheduleMetaSave();
  }
  if (changed) {
    syncChapter(spBodyOf(h), spChapterOf(h), 'outline');
    spRepaginate();
    renderNav();
  }
}

function looseToScene(looseId, before) {
  const card = (book.looseCards || []).find((c) => c.id === looseId);
  if (!card) return;
  if (card.html) { heldSceneBack(card, before); return; }
  snapshotStructure('loose card placed');
  book.looseCards = book.looseCards.filter((c) => c.id !== looseId);
  const h = insertScene(before - 1, '');
  if (h && card.text) {
    const id = newSceneId();
    (book.sceneNotes = book.sceneNotes || {})[id] = card.text;
    h.dataset.sceneId = id;
    syncChapter(spBodyOf(h), spChapterOf(h), 'outline');
  }
  scheduleMetaSave();
  renderLooseCards();
  renderNav();
}

function goToScene(cell) {
  const sc = sceneOfCell(cell);
  switchTab('manuscript');
  if (!sc) return;
  const p = sc.s.p;
  spBodyOf(p).focus({ preventScroll: true });
  spCaretToEnd(p);
  spLastPara = p;
  const scr = $('#paper-scroll');
  scr.scrollTop += p.getBoundingClientRect().top - scr.getBoundingClientRect().top - scr.clientHeight / 4;
  updateCounters();
}

// ---- loose cards: the right-hand pane, while the outline is up ----

function looseList() {
  let list = $('#loose-list');
  if (list) return list;
  const head = $('#side-head > span');
  if (head) {
    head.classList.add('side-title-notes');
    const alt = document.createElement('span');
    alt.className = 'side-title-loose';
    alt.textContent = t('Loose cards');
    head.after(alt);
  }
  list = document.createElement('div');
  list.id = 'loose-list';
  $('#sticky-list').after(list);
  list.addEventListener('pointerdown', (e) => {
    const cell = e.target.closest('.ob-cell');
    if (!cell || e.button !== 0 || cell.classList.contains('open') || e.target.closest('button')) return;
    cardPress(e, { kind: 'loose', cell });
  });
  list.addEventListener('contextmenu', (e) => {
    const cell = e.target.closest('.ob-cell');
    if (!cell) return;
    e.preventDefault();
    if (!NO_HOVER) cardMenu(cell, e.clientX, e.clientY);
  });
  list.addEventListener('keydown', (e) => {
    const cell = e.target.closest && e.target.closest('.ob-cell');
    if (!cell || cell.classList.contains('open')) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openCard(cell); }
  });
  return list;
}

function renderLooseCards() {
  const list = looseList();
  list.innerHTML = '';
  if (!book) return;
  for (const c of book.looseCards || []) {
    const { cell, card } = cardCell('loose', '');
    cell.dataset.loose = c.id;
    const text = document.createElement('div');
    text.className = 'ob-text';
    text.textContent = c.text;
    card.appendChild(text);
    if (c.html) {
      // the words it holds: its opening line, and how many
      const holder = document.createElement('div');
      holder.innerHTML = c.html;
      const first = [...holder.children].map((x) => x.textContent).join(' ').replace(/\s+/g, ' ').trim();
      if (!c.text) text.textContent = c.title || (first.length > 120 ? first.slice(0, 117) + '…' : first);
      const n = document.createElement('div');
      n.className = 'ob-held';
      n.textContent = t('{n} words', { n: (c.words || countWords(holder.textContent)).toLocaleString() });
      card.appendChild(n);
      cell.dataset.held = c.held || 'section';
    }
    list.appendChild(cell);
  }
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'loose-add';
  add.textContent = t('+ card');
  add.onclick = () => addLooseCard();
  list.appendChild(add);
  if (!(book.looseCards || []).length) {
    const tip = document.createElement('div');
    tip.className = 'loose-tip';
    tip.textContent = t('Ideas without a chapter yet. Drag one onto the board when it finds its place.');
    list.appendChild(tip);
  }
}

function addLooseCard() {
  if (!book) return;
  const id = 'lc-' + Date.now().toString(36);
  (book.looseCards = book.looseCards || []).push({ id, text: '' });
  renderLooseCards();
  const cell = looseList().querySelector(`.ob-cell[data-loose="${id}"]`);
  if (cell) openCard(cell);
}

function saveLooseCard(id, val) {
  const cards = book.looseCards || [];
  const c = cards.find((x) => x.id === id);
  if (!c) return;
  // an emptied note takes the card away, unless the card holds writing
  if (!val && !c.html) { book.looseCards = cards.filter((x) => x.id !== id); scheduleMetaSave(); setTimeout(renderLooseCards, 0); return; }
  if (c.text === val) return;
  c.text = val;
  scheduleMetaSave();
}

async function removeLooseCard(id, quiet = false) {
  const card = (book.looseCards || []).find((x) => x.id === id);
  if (!card) return;
  // words on the card go to Darlings first; the card goes only once they're safe there
  if (card.html) {
    const holder = document.createElement('div');
    holder.innerHTML = card.html;
    darlings.unshift({
      id: 'd-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      html: card.html,
      text: [...holder.children].map((x) => x.textContent).join('\n'),
      chapterId: null,
      chapterLabel: t('Loose cards'),
      date: new Date().toISOString()
    });
    try {
      await writeSidecar(book.id, 'darlings', darlings);
    } catch {
      darlings.shift();
      toast(t('NEO couldn’t save to Darlings, so the card stays'));
      return;
    }
    renderDarlings();
    if (!quiet) toast(t('The card’s words are in Darlings'));
  }
  if (!quiet) snapshotStructure('loose card removed');
  book.looseCards = (book.looseCards || []).filter((x) => x.id !== id);
  scheduleMetaSave();
  renderLooseCards();
}

// ---- whole chapters and scenes set aside as loose cards ----
// The card carries the writing (as html) and what belongs to it, and is
// written to book.json before the chapter or the scene leaves the page, so
// the words are always somewhere on disk. Placed again, it comes back whole.

// a chapter of the story that isn't the book's only one
function canSetChapterAside(chId) {
  return !!chId && isStory(chId) && book.chapterOrder.filter((c) => isStory(c)).length > 1;
}

// book.json with the card in it, or the card taken back out and false
async function saveHeldCard(card) {
  let stamp = null;
  try { stamp = await writeBookMeta(book.id, book); } catch (err) { window.neo.logError('loose card: ' + (err && err.message || err)); }
  if (typeof stamp !== 'string') {
    book.looseCards = (book.looseCards || []).filter((c) => c !== card);
    toast(t('NEO couldn’t save the card, so the writing stays where it was'));
    return false;
  }
  book.modified = stamp;
  savedMetaSig = metaSig(book);
  return true;
}

async function chapterToLoose(chId) {
  if (!canSetChapterAside(chId)) return;
  const body = chapterBodyEl(chId);
  if (body && body.querySelector('.ph-mark')) { toast(t('That chapter has a placeholder in it. Move the placeholder first.')); return; }
  snapshotStructure('card to loose');
  if (body) syncChapter(body, chId, 'outline');
  const kind = chapterKind(chId);
  const card = {
    id: 'lc-' + Date.now().toString(36),
    held: 'chapter',
    title: (book.chapterTitles || {})[chId] || '',
    text: (book.chapterNotes || {})[chId] || '',
    html: chapterHTML[chId] || '',
    notes: JSON.parse(JSON.stringify((book.sectionNotes || {})[chId] || [])),
    words: chapterWords(chId)
  };
  if (kind !== 'chapter') card.kind = kind;
  (book.looseCards = book.looseCards || []).push(card);
  if (!(await saveHeldCard(card))) return;
  if (book.chapterTitles) delete book.chapterTitles[chId];
  if (currentChapterId === chId) currentChapterId = null;
  await deleteChapterQuiet(chId, 'outline');
  renderLooseCards();
  if (currentTab === 'outline') renderBoard();
  updateCounters();
  toast(t('The chapter is on a loose card, its words with it. Drag it back between two chapters to put it in again.'), 6000);
}

function looseToChapter(looseId, index) {
  const card = (book.looseCards || []).find((c) => c.id === looseId);
  if (!card) return;
  snapshotStructure('loose card placed');
  const chId = 'ch-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  book.chapterOrder.splice(Math.max(0, Math.min(index, book.chapterOrder.length)), 0, chId);
  setChapterHTML(chId, card.html || '<p><br></p>', 'outline');
  if (card.title) (book.chapterTitles = book.chapterTitles || {})[chId] = card.title;
  if (card.text) (book.chapterNotes = book.chapterNotes || {})[chId] = card.text;
  if (card.notes && card.notes.length) (book.sectionNotes = book.sectionNotes || {})[chId] = card.notes;
  if (card.kind) setChapterKind(chId, card.kind);
  book.looseCards = book.looseCards.filter((c) => c.id !== looseId);
  // the chapter's file is written before book.json lets the card go
  persistChapter(chId).then(() => saveMeta())
    .catch((err) => window.neo.logError('loose to chapter: ' + (err && err.message || err)));
  renderChapters();
  renderLooseCards();
  updateCounters();
}

async function sceneToLoose(cell) {
  const sc = sceneOfCell(cell);
  if (!sc || !sc.s.p.isConnected) return;
  const nodes = sceneNodes(sc.s);
  const body = spBodyOf(sc.s.p);
  const chId = body.closest('.chapter').dataset.id;
  snapshotStructure('card to loose');
  const holder = document.createElement('div');
  for (const n of nodes) holder.appendChild(n.cloneNode(true));
  const head = holder.firstElementChild;
  if (head) head.removeAttribute('data-scene-id');
  const card = {
    id: 'lc-' + Date.now().toString(36),
    held: 'scene',
    text: (cell.dataset.sid && (book.sceneNotes || {})[cell.dataset.sid]) || '',
    html: captureBody(holder),
    words: countWords(nodes.map((n) => n.textContent).join('\n'))
  };
  (book.looseCards = book.looseCards || []).push(card);
  if (!(await saveHeldCard(card))) return;
  for (const n of nodes) n.remove();
  if (!body.querySelector('p')) body.innerHTML = '<p><br></p>';
  if (cell.dataset.sid && book.sceneNotes) delete book.sceneNotes[cell.dataset.sid];
  syncChapter(body, chId, 'outline');
  clearTimeout(saveTimers[chId]);
  persistChapter(chId).then(() => saveMeta())
    .catch((err) => window.neo.logError('scene to loose: ' + (err && err.message || err)));
  breakRun++;
  spRepaginate();
  renderNav();
  renderLooseCards();
  renderBoard();
  updateCounters();
  toast(t('The scene is on a loose card, its lines with it. Drag it back onto the board to put it in again.'), 6000);
}

// a card holding a scene's lines: back in before scene `before` (or at the end)
function heldSceneBack(card, before) {
  const scenes = scriptScenes();
  const target = scenes[before] && scenes[before].s.p.isConnected ? scenes[before].s.p : null;
  const dest = target ? spBodyOf(target) : spBodies()[spBodies().length - 1];
  if (!dest) return;
  snapshotStructure('loose card placed');
  const holder = document.createElement('div');
  holder.innerHTML = card.html;
  const nodes = [...holder.children];
  if (!nodes.length) return;
  // an empty script's one blank line gives way
  if (!dest.textContent.trim() && dest.children.length === 1) dest.innerHTML = '';
  if (card.text) {
    const id = newSceneId();
    (book.sceneNotes = book.sceneNotes || {})[id] = card.text;
    nodes[0].dataset.sceneId = id;
  }
  for (const n of nodes) { if (target) target.before(n); else dest.appendChild(n); }
  book.looseCards = book.looseCards.filter((c) => c.id !== card.id);
  const chId = dest.closest('.chapter').dataset.id;
  syncChapter(dest, chId, 'outline');
  clearTimeout(saveTimers[chId]);
  persistChapter(chId).then(() => saveMeta())
    .catch((err) => window.neo.logError('loose to scene: ' + (err && err.message || err)));
  breakRun++;
  spRepaginate();
  renderNav();
  renderLooseCards();
  updateCounters();
}

// the right-hand pane holds loose cards while the Outline is up (there are
// no placeholders to show there)
function sidePaneForTab(name) {
  const outline = name === 'outline' && !!book;
  $('#editor-view').classList.toggle('outline-tab', outline);
  if (outline) renderLooseCards();
  // on Darlings the pane holds the book's snapshots, and stays open
  const was = $('#editor-view').classList.contains('darlings-tab');
  const dar = name === 'darlings' && !!book && snapsCan() && !IS_POCKET; // (Pocket's own list: later)
  $('#editor-view').classList.toggle('darlings-tab', dar);
  if (dar) { snapList(); $('#side-pane').classList.add('open'); }
  else if (was && $('#side-pane').dataset.pinned !== '1') $('#side-pane').classList.remove('open');
}

// ---- the note walks ahead ----
// Writing over a section's gray ghost used to take the note away with the
// first key. Now, while the caret is in a section that has an outline note,
// the note rides one line below the paragraph being written: faint, out of
// the text (it's never saved or exported), with a quiet Dismiss. Leave the
// section and it waits; come back and it's there, until it's dismissed.
let walkEl = null;
let walkP = null;
let walkQueued = false;

// the outline note of the section holding p (the first section to carry an
// id is its owner: lines split from a written ghost carry the id along)
function sectionIdAt(body, p) {
  const chId = body.closest('.chapter')?.dataset.id;
  const notes = new Set(((book.sectionNotes || {})[chId] || []).map((s) => s.id));
  const claimed = new Set();
  let id = null;
  let mine = false;
  let ghost = false;
  for (const el of body.children) {
    if (el.classList.contains('scene-break')) {
      if (mine) break;
      if (id) claimed.add(id);
      id = null;
      ghost = false;
      continue;
    }
    if (!id && el.dataset && notes.has(el.dataset.secId) && !claimed.has(el.dataset.secId)) id = el.dataset.secId;
    if (el.classList.contains('ghost')) ghost = true;
    if (el === p) mine = true;
  }
  return mine && !ghost ? { chId, id } : null;
}

function hideWalkNote() {
  // (a paragraph split from the one holding the room takes the mark along)
  for (const q of document.querySelectorAll('.chapter-body p[data-walk]')) q.removeAttribute('data-walk');
  if (walkEl) walkEl.remove();
  walkEl = null;
  walkP = null;
}

// ---- the cards beside the page (#340) ----
// While writing, the top of the right-hand pane holds the Outline's cards for
// where the caret is: the chapter's card and its sections' (the one the caret
// is in marked), or in a script the scene's. They're the same notes the
// Outline shows, and they stay here after the gray ghost on the page has
// been written over. Typed on here, they change there too.
let sideCardsKey = '';
let sideCardsQueued = false;
function sideCardsBox() {
  let box = $('#side-cards');
  if (box) return box;
  box = document.createElement('div');
  box.id = 'side-cards';
  $('#side-head').before(box);
  return box;
}
// the section (by its note's id) holding p, ghost or written
function sectionOf(body, p) {
  const chId = body.closest('.chapter')?.dataset.id;
  const notes = new Set(((book.sectionNotes || {})[chId] || []).map((s) => s.id));
  const claimed = new Set();
  let id = null;
  for (const el of body.children) {
    if (el.classList.contains('scene-break')) {
      if (id) claimed.add(id);
      id = null;
      if (el === p) return null;
      continue;
    }
    if (!id && el.dataset && notes.has(el.dataset.secId) && !claimed.has(el.dataset.secId)) id = el.dataset.secId;
    if (el === p) return id;
  }
  return null;
}
function queueSideCards() {
  if (sideCardsQueued) return;
  sideCardsQueued = true;
  requestAnimationFrame(() => { sideCardsQueued = false; sideCardsUpdate(); });
}
function sideCardsUpdate(force) {
  const box = sideCardsBox();
  if (!book || currentTab !== 'manuscript') { if (sideCardsKey) { box.innerHTML = ''; sideCardsKey = ''; } return; }
  if (box.contains(document.activeElement)) return; // being typed on
  const sel = window.getSelection();
  let el = sel.rangeCount ? sel.anchorNode : null;
  if (el && el.nodeType === Node.TEXT_NODE) el = el.parentElement;
  const p = el && el.closest ? el.closest('.chapter-body > p') : null;
  const body = p ? p.parentElement : null;
  const chId = body ? body.closest('.chapter').dataset.id : currentChapterId;
  let key = '';
  let cards = [];
  if (chId && isScript()) {
    // the scene: its heading, at or above the caret
    let h = p;
    while (h && !h.classList.contains('sp-heading')) h = h.previousElementSibling;
    if (h) {
      // (a scene gets its id with its first note, here as on the Outline)
      const sid = h.dataset.sceneId || '';
      key = 'scene:' + (sid || [...body.querySelectorAll('p.sp-heading')].indexOf(h)) + ':' + h.textContent;
      cards = [{ kind: 'scene', id: sid, head: h, label: h.textContent.trim() || t('Scene'), text: (book.sceneNotes || {})[sid] || '', current: false }];
    }
  } else if (chId && book.chapterOrder.includes(chId) && isStory(chId)) {
    const secId = body ? sectionOf(body, p) : null;
    const secs = (book.sectionNotes || {})[chId] || [];
    key = 'ch:' + chId + ':' + (secId || '') + ':' + secs.length;
    cards = [{ kind: 'chapter', id: chId, label: (book.chapterTitles || {})[chId] || chapterName(chId), text: (book.chapterNotes || {})[chId] || '', current: false },
      ...secs.map((s, i) => ({ kind: 'section', id: s.id, chId, label: t('Section {letter}', { letter: secLetter(i) }), text: s.text || '', current: s.id === secId }))];
  }
  if (key === sideCardsKey && !force) return;
  sideCardsKey = key;
  box.innerHTML = '';
  for (const c of cards) {
    const card = document.createElement('div');
    card.className = 'side-card side-card-' + c.kind + (c.current ? ' current' : '');
    const head = document.createElement('div');
    head.className = 'side-card-head';
    head.textContent = c.label;
    const ta = document.createElement('textarea');
    ta.spellcheck = false;
    ta.rows = 1;
    ta.value = c.text;
    ta.placeholder = c.kind === 'chapter' ? t('What happens in this chapter?') : c.kind === 'scene' ? t('What happens in this scene?') : t('What happens in this section?');
    ta.setAttribute('aria-label', c.label);
    const fit = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
    ta.addEventListener('input', () => {
      const val = ta.value.trim();
      if (c.kind === 'chapter') book.chapterNotes[c.id] = val;
      else if (c.kind === 'scene') {
        book.sceneNotes = book.sceneNotes || {};
        if (!c.id && val && c.head.isConnected) {
          c.id = newSceneId();
          c.head.dataset.sceneId = c.id;
          syncChapter(spBodyOf(c.head), spChapterOf(c.head));
        }
        if (c.id) { if (val) book.sceneNotes[c.id] = val; else delete book.sceneNotes[c.id]; }
      }
      else { const s = (book.sectionNotes[c.chId] || []).find((x) => x.id === c.id); if (s) s.text = val; }
      scheduleMetaSave();
      fit();
    });
    ta.addEventListener('blur', () => {
      if (c.kind === 'section') syncGhosts(c.chId);
      if (c.kind === 'scene') spSchedule();
      renderNav();
    });
    ta.addEventListener('keydown', (e) => {
      // Esc (or Enter without Shift) goes back to the page
      if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey && !e.isComposing)) {
        e.preventDefault();
        e.stopPropagation();
        ta.blur();
        focusPage();
      }
    });
    card.append(head, ta);
    box.appendChild(card);
    requestAnimationFrame(fit);
  }
}
document.addEventListener('selectionchange', queueSideCards);
// the pane coming into view shows the cards as they are now (the Outline may
// have changed them since)
$('#side-hotzone').addEventListener('mouseenter', () => sideCardsUpdate(true));

function walkNoteUpdate() {
  walkQueued = false;
  if (!book || currentTab !== 'manuscript' || isScript()) { hideWalkNote(); return; }
  const sel = window.getSelection();
  let el = sel.rangeCount ? sel.anchorNode : null;
  if (el && el.nodeType === Node.TEXT_NODE) el = el.parentElement;
  const p = el && el.closest ? el.closest('.chapter-body > p') : null;
  const body = p && p.parentElement;
  if (!p || p.classList.contains('ghost') || p.classList.contains('scene-break')) { hideWalkNote(); return; }
  const at = sectionIdAt(body, p);
  const note = at && at.id ? sectionNote(at.chId, at.id) : null;
  if (!note || !note.text || note.dismissed) { hideWalkNote(); return; }
  const chapter = body.closest('.chapter');
  if (!walkEl || !walkEl.isConnected || walkEl.parentElement !== chapter || walkEl.dataset.sec !== note.id) {
    hideWalkNote();
    walkEl = document.createElement('div');
    walkEl.className = 'walk-note';
    walkEl.contentEditable = 'false';
    walkEl.dataset.sec = note.id;
    walkEl.dataset.ch = at.chId;
    const text = document.createElement('span');
    text.className = 'wn-text';
    text.textContent = note.text;
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'wn-dismiss';
    dismiss.textContent = t('Dismiss');
    dismiss.title = t('Put this outline note away for this section (it stays on its card)');
    dismiss.addEventListener('mousedown', (e) => e.preventDefault()); // the caret stays where it is
    dismiss.addEventListener('click', () => {
      const n = sectionNote(walkEl.dataset.ch, walkEl.dataset.sec);
      if (n) { n.dismissed = true; scheduleMetaSave(); }
      hideWalkNote();
    });
    walkEl.append(text, dismiss);
    chapter.appendChild(walkEl);
  }
  if (walkP !== p) {
    for (const q of body.querySelectorAll('p[data-walk]')) if (q !== p) q.removeAttribute('data-walk');
    walkP = p;
    p.setAttribute('data-walk', '');
  }
  placeWalkNote();
}

function placeWalkNote() {
  if (!walkEl || !walkP || !walkP.isConnected) return;
  const chapter = walkEl.parentElement;
  const body = walkP.parentElement;
  const c = chapter.getBoundingClientRect();
  const b = body.getBoundingClientRect();
  walkEl.style.left = (b.left - c.left) + 'px';
  walkEl.style.width = b.width + 'px';
  chapter.style.setProperty('--walk-h', (walkEl.offsetHeight + 8) + 'px');
  const p = walkP.getBoundingClientRect();
  walkEl.style.top = (p.bottom - c.top + 2) + 'px';
}

function queueWalkNote() {
  if (walkQueued) return;
  walkQueued = true;
  requestAnimationFrame(walkNoteUpdate);
}
document.addEventListener('selectionchange', queueWalkNote);
document.addEventListener('input', (e) => { if (e.target && e.target.closest && e.target.closest('.chapter-body')) queueWalkNote(); }, true);
window.addEventListener('resize', queueWalkNote);

let auxDirty = false;
$('#aux-editor').addEventListener('keydown', (e) => { if (styleKeepScroll(e)) return; smartKeys(e, e.currentTarget); });
$('#aux-editor').addEventListener('input', (e) => {
  auxDirty = true;
  if (e.currentTarget.dataset.kind === 'notes') recNotesInput(e);
  scheduleAuxSave();
  if (spellOn) {
    const key = 'aux-' + ($('#aux-editor').dataset.kind || 'notes');
    scheduleSpellRescan(key, $('#aux-editor'));
  }
});
// notes paste arrives clean, same as the manuscript
$('#aux-editor').addEventListener('paste', (e) => {
  e.preventDefault();
  const html = e.clipboardData.getData('text/html');
  const text = e.clipboardData.getData('text/plain');
  if (html) document.execCommand('insertHTML', false, cleanPasteHtml(html));
  else if (text) document.execCommand('insertText', false, text.replace(/\r/g, ''));
});
function scheduleAuxSave() {
  clearTimeout(saveTimers.aux);
  saveTimers.aux = setTimeout(flushAux, 800);
}
// Notes waiting for the disk, by book and page. An entry leaves only once
// that exact text is saved; a refused save stays here, is tried again on
// the next flush, and is what the page shows if the writer comes back to it
// before then (not the older file).
const auxPending = {};
function flushAux() {
  const ed = $('#aux-editor');
  if (auxDirty && ed.dataset.kind && ed.dataset.book) {
    if (ed.dataset.kind === 'notes' && rec.bookId === ed.dataset.book) rec.reconcile(Rec.STREAMS.notes, ed.innerHTML);
    const key = ed.dataset.book + '/' + ed.dataset.kind;
    auxPending[key] = { bookId: ed.dataset.book, kind: ed.dataset.kind, html: ed.innerHTML, inFlight: false };
    auxDirty = false;
  }
  for (const key of Object.keys(auxPending)) {
    const job = auxPending[key];
    if (job.inFlight) continue;
    job.inFlight = true;
    Promise.resolve().then(() => window.neo.writeAux(job.bookId, job.kind, job.html)).then(() => {
      if (auxPending[key] === job) delete auxPending[key];
    }, (err) => {
      job.inFlight = false;
      window.neo.logError('notes save: ' + (err && err.message || err));
    });
  }
}

// The same promise for the JSON beside a book (comments, Darlings): the
// newest list for each file is kept until it is on disk, and a refused
// write is tried again on the next flush instead of being forgotten.
const sidecarPending = {};
// what each sidecar held when this device last read or wrote it: the base a
// change from another device is told apart from a change made here
const sidecarBase = {};
// Both devices changed a list (comments, Darlings): every entry either side
// added stays, an entry either side removed (and the other left alone) goes,
// and an entry both kept keeps this device's version.
function mergeSidecar(base, local, remote, newestFirst) {
  const key = (e) => (e && e.id) || JSON.stringify(e);
  const B = new Map(base.map((e) => [key(e), JSON.stringify(e)]));
  const L = new Set(local.map(key));
  const R = new Map(remote.map((e) => [key(e), e]));
  const out = local.filter((e) => R.has(key(e)) || !B.has(key(e)) || B.get(key(e)) !== JSON.stringify(e));
  const added = remote.filter((e) => !L.has(key(e)) && !B.has(key(e)));
  return newestFirst ? [...added, ...out] : [...out, ...added];
}
function writeSidecar(bookId, name, data) {
  const key = bookId + '/' + name;
  const job = { bookId, name, data, inFlight: false };
  sidecarPending[key] = job;
  return runSidecar(key, job);
}
function runSidecar(key, job) {
  job.inFlight = true;
  const json = JSON.stringify(job.data);
  return Promise.resolve().then(() => window.neo.writeJSON(job.bookId, job.name, job.data)).then((r) => {
    if (sidecarPending[key] === job) delete sidecarPending[key];
    sidecarBase[key] = json;
    return r;
  }, (err) => {
    job.inFlight = false;
    window.neo.logError('save ' + job.name + ': ' + (err && err.message || err));
    throw err;
  });
}
function flushSidecars() {
  for (const key of Object.keys(sidecarPending)) {
    const job = sidecarPending[key];
    if (!job.inFlight) runSidecar(key, job).catch(() => {});
  }
}

function renderDarlings() {
  const wrap = $('#darlings-list');
  wrap.innerHTML = '';
  if (darlings.length === 0) {
    wrap.innerHTML = `<div class="darlings-empty">${t('When a beautiful paragraph is gumming up the works, select it and drag it onto the Darlings tab below.')}<br>${t('It leaves your manuscript but it is never lost.')}</div>`;
    return;
  }
  for (const d of darlings) {
    const el = document.createElement('div');
    el.className = 'darling';
    const content = document.createElement('div');
    if (d.html) content.innerHTML = d.html;
    else content.textContent = d.text;
    const meta = document.createElement('div');
    meta.className = 'd-meta';
    const when = fmtDate(d.date);
    meta.innerHTML = `<span>${t('from {label} · {date} · {n} words', { label: d.chapterLabel, date: when, n: countWords(d.text) })}</span>
      <span><button class="d-restore">${t('Restore')}</button> <button class="d-del">${t('Delete forever')}</button></span>`;
    meta.querySelector('.d-restore').onclick = () => restoreDarling(d.id);
    meta.querySelector('.d-del').onclick = async () => {
      snapshotStructure('darling delete');
      // tidy up the invisible anchor the darling left behind
      const anchor = document.querySelector(`.darling-anchor[data-did="${d.id}"]`);
      if (anchor) {
        const body = anchor.closest('.chapter-body');
        const chId = anchor.closest('.chapter').dataset.id;
        anchor.remove();
        syncChapter(body, chId, 'darling-delete');
      }
      darlings = darlings.filter((x) => x.id !== d.id);
      await writeSidecar(book.id, 'darlings', darlings);
      renderDarlings();
    };
    el.appendChild(content);
    el.appendChild(meta);
    wrap.appendChild(el);
  }
}

async function savedBeforeLettingGo(chId) {
  clearTimeout(saveTimers[chId]);
  try {
    await persistChapter(chId);
    return true;
  } catch {
    toast(t('NEO couldn’t save the chapter, so the passage stays in Darlings too'));
    return false;
  }
}

async function restoreDarling(id) {
  const d = darlings.find((x) => x.id === id);
  if (!d) return;
  snapshotStructure('darling restore');
  switchTab('manuscript');

  // Preferred: put it back in the exact spot it was cut from, located by
  // the remembered text surrounding the cut point
  if (d.chapterId && book.chapterOrder.includes(d.chapterId)) {
    const body = document.querySelector(`.chapter[data-id="${d.chapterId}"] .chapter-body`);
    const pos = body ? findDarlingPosition(body, d) : -1;
    if (body && pos !== -1) {
      const at = textPosToRange(body, pos);
      if (at) {
        let scrollTo = at.startContainer.parentElement?.closest?.('p') || body;
        if (d.html && /<p[\s>]/i.test(d.html)) {
          // block content: paragraphs go back in after the host paragraph
          const holder = document.createElement('div');
          holder.innerHTML = d.html;
          let ref = scrollTo === body ? body.lastElementChild : scrollTo;
          scrollTo = holder.firstElementChild || scrollTo;
          for (const n of [...holder.childNodes]) { ref.after(n); ref = n; }
        } else {
          // inline content: slot it right where the caret was
          at.insertNode(document.createRange().createContextualFragment(d.html || d.text));
        }
        syncChapter(body, d.chapterId, 'darling-in');
        // the chapter holding it again is saved before Darlings lets it go
        if (!(await savedBeforeLettingGo(d.chapterId))) return;
        darlings = darlings.filter((x) => x.id !== id);
        await writeSidecar(book.id, 'darlings', darlings);
        scrollTo.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
        toast(t('Darling restored to its original spot'));
        return;
      }
    }
  }

  // Fallback: the spot no longer exists — end of its chapter (or the last one)
  let chId = d.chapterId && book.chapterOrder.includes(d.chapterId)
    ? d.chapterId
    : book.chapterOrder[book.chapterOrder.length - 1];
  if (!chId) { newChapter(); chId = book.chapterOrder[0]; }
  const body = document.querySelector(`.chapter[data-id="${chId}"] .chapter-body`);
  const frag = d.html ? d.html : '<p>' + d.text.replace(/\n+/g, '</p><p>') + '</p>';
  body.insertAdjacentHTML('beforeend', frag);
  setChapterHTML(chId, captureBody(body), 'darling-in');
  if (!(await savedBeforeLettingGo(chId))) return;
  darlings = darlings.filter((x) => x.id !== id);
  await writeSidecar(book.id, 'darlings', darlings);
  focusChapter(chId);
  toast(t('Original spot is gone — restored to the end of {label}', { label: d.chapterLabel || t('the manuscript') }));
}

/* ================================================================== */
/*  COUNTERS                                                           */
/* ================================================================== */

// the story's words: the pages a book carries don't count
function bookWordCount() {
  return book.chapterOrder.reduce((sum, chId) => sum + (isStory(chId) ? chapterWords(chId) : 0), 0);
}

function updateCounters() {
  if (!book) return;
  // a script is one long chapter: its words are counted when the typing
  // pauses, not at every key
  if (isScript() && !updateCounters.now) {
    clearTimeout(updateCounters.t);
    updateCounters.t = setTimeout(() => {
      updateCounters.now = true;
      try { updateCounters(); } finally { updateCounters.now = false; }
    }, 250);
    return;
  }
  const total = bookWordCount();
  const known = book.wordCount; // the count before this one (trackDailyWords)
  const wc = $('#word-counter');
  if (isScript()) spCounters();
  else updateBookCounters(total, wc);
  // cache for the bookshelf progress bar
  if (book.wordCount !== total) {
    // only a true crossing earns a painting — a story that was already long
    // before NEO could paint keeps its abstract until the writer asks
    const before = typeof book.wordCount === 'number' ? book.wordCount : total;
    book.wordCount = total;
    scheduleMetaSave();
    if (before < PAINT_AT && total >= PAINT_AT && !(library.coverArt && library.coverArt.auto === false) && paintable(book)) {
      requestPaint(book, bookPlainText());
    }
  }
  trackDailyWords(total, known);
}
function updateBookCounters(total, wc) {
  if (wordMode === 'book') setText(wc, t('{n} words', { n: total }));
  const cur = book.chapterOrder.includes(currentChapterId) ? currentChapterId : null;
  const solo = soloStory();
  if (wordMode !== 'book') {
    const n = cur ? chapterWords(cur) : 0;
    setText(wc, cur && chapterKind(cur) !== 'chapter'
      ? t('{name}: {n} words', { name: chapterName(cur), n })
      : t('ch. {ch}: {n} words', { ch: cur ? chapterNumber(cur) : 0, n }));
  }
  const pos = $('#pos-counter');
  setText(pos, library.posMode === 'page'
    ? (cur ? t('page {p} of {total}', { p: currentPage(cur), total: pageCount(total) }) : t('{n} pages', { n: pageCount(total) }))
    : !cur
    ? (numberedChapters() > 1 ? t('{n} chapters', { n: numberedChapters() }) : '')
    : cur === solo
      ? '' // a chapterless story needs no chapter locator
      : chapterKind(cur) !== 'chapter'
        ? chapterName(cur)
        : t('chapter {ch} of {total}', { ch: chapterNumber(cur), total: numberedChapters(book, cur) }));
}

// ---- daily word tracking + goal display ----
// The writing day follows the writer's own clock, and rolls over at
// library.dayEndsAt (0 = midnight) so a session that runs past midnight
// still counts toward the night it began.
function writingDay(d = new Date()) {
  d = new Date(d);
  if (d.getHours() < (library.dayEndsAt || 0)) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const todayStr = () => writingDay();

// when the text last came in from disk (a book opening, another device's
// changes adopted): a drop then isn't the writer cutting (#345)
let diskWordsAt = 0;
function trackDailyWords(total, known = book.wordCount) {
  book.dailyCounts = book.dailyCounts || {};
  const today = todayStr();
  // a book that reads as empty for a moment (its chapters still coming in,
  // or a synced folder still downloading them) must not set the day's start:
  // from zero, "today" would count the whole book (#345)
  if (!total && (known || 0) > 0) return;
  if (!book.dailyCounts[today]) {
    book.dailyCounts[today] = { start: total, end: total };
    scheduleMetaSave();
  } else if (book.dailyCounts[today].end !== total) {
    book.dailyCounts[today].end = total;
  }
  // Cutting is writing too: words cut below where the day began move the
  // day's start down with them, so today never reads below zero, and what's
  // written after the cut counts in full. (Cut what you wrote today, and
  // today is smaller: that part is honest.)
  if (total < book.dailyCounts[today].start && Date.now() - diskWordsAt > 3000) {
    book.dailyCounts[today].start = total;
    scheduleMetaSave();
  }
  if (sprint && sprint.bookId !== book.id) sprint = null; // a sprint belongs to the book it began in
  if (sprint && total < sprint.startCount) sprint.startCount = total;
  const wordsToday = Math.max(0, book.dailyCounts[today].end - book.dailyCounts[today].start);
  const gc = $('#goal-counter');
  if (sprint && !sprint.done) {
    const sprintWords = total - sprint.startCount;
    setText(gc, `⚡ ${fmtNum(sprintWords)} / ${fmtNum(sprint.target)}`);
    if (sprintWords >= sprint.target) {
      sprint.done = true;
      toast(t('Sprint complete — {n} words. Well earned.', { n: sprintWords }), 6000);
    }
  } else {
    const goal = library.dailyGoal || 0;
    setText(gc, goal
      ? t('{n} / {goal} today', { n: wordsToday, goal })
      : t('{n} today', { n: wordsToday }));
    gc.classList.toggle('goal-met', goal > 0 && wordsToday >= goal);
  }
}

// Pages, the way a manuscript counts them: 250 words to a page. The page
// the caret is on counts the story's words before it.
const WORDS_PER_PAGE = 250;
const pageCount = (words) => Math.max(1, Math.ceil(words / WORDS_PER_PAGE));
function currentPage(cur) {
  let before = 0;
  for (const chId of book.chapterOrder) {
    if (chId === cur) break;
    if (isStory(chId)) before += chapterWords(chId);
  }
  const sel = window.getSelection();
  const body = document.querySelector(`.chapter[data-id="${cur}"] .chapter-body`);
  if (isStory(cur) && body && sel.rangeCount && body.contains(sel.anchorNode)) {
    let n = wordsBeforeCaret(body, sel.anchorNode, sel.anchorOffset);
    if (n == null) {
      const r = document.createRange();
      r.selectNodeContents(body);
      r.setEnd(sel.anchorNode, sel.anchorOffset);
      n = countWords(plainText(r.cloneContents()));
    }
    before += n;
  }
  return Math.min(pageCount(bookWordCount()), Math.floor(before / WORDS_PER_PAGE) + 1);
}
// click: chapter of chapters ↔ page of pages
$('#pos-counter').onclick = () => {
  // a script's counter goes page ↔ scene
  if (book && isScript()) { spPosScene = !spPosScene; updateCounters(); return; }
  library.posMode = library.posMode === 'page' ? 'chapter' : 'page';
  writeLibrary(library);
  updateCounters();
};

$('#word-counter').onclick = () => {
  wordMode = wordMode === 'book' ? 'chapter' : 'book';
  updateCounters();
};

// select a passage → the counter reports its size
document.addEventListener('selectionchange', () => {
  if (!book || currentTab !== 'manuscript') return;
  // the recount a click asked for would cover the count of the word a
  // double click goes on to select
  clearTimeout(saveTimers.selcount);
  const sel = window.getSelection();
  if (sel && !sel.isCollapsed) {
    let el = sel.anchorNode;
    if (el && el.nodeType === Node.TEXT_NODE) el = el.parentElement;
    if (el && el.closest && el.closest('.chapter-body')) {
      const n = countWords(sel.toString());
      if (n > 0) {
        setText($('#word-counter'), t('{n} selected', { n }));
        return;
      }
    }
  }
  saveTimers.selcount = setTimeout(() => { if (book) updateCounters(); }, 150);
});

// track which chapter you're scrolled to
$('#paper-scroll').addEventListener('scroll', () => {
  clearTimeout(saveTimers.scroll);
  saveTimers.scroll = setTimeout(() => {
    const mid = window.innerHeight * 0.4;
    let best = null;
    for (const sec of $$('.chapter')) {
      if (sec.getBoundingClientRect().top < mid) best = sec.dataset.id;
    }
    if (best && best !== currentChapterId) {
      currentChapterId = best;
      highlightNav();
      updateCounters();
    }
  }, 120);
});

/* ================================================================== */
/*  SAVING                                                             */
/* ================================================================== */

// One door for chapter writes, so NEO always knows what is on disk. That
// knowledge is what lets it write only what changed (a library shared over
// iCloud or Syncthing must not be re-written every twenty seconds) and, in
// refreshFromDisk, tell another device's edits from its own.
let shelfExport = false; // see exportFromShelf
// What this device last knew to be in each chapter file (read, written, or
// found there), by book: the `expected` a save hands the disk. Only a write
// that landed changes it, so a save that failed, or one still on its way,
// is never taken for another device's.
const diskKnown = {};
const knowDisk = (bookId, chId, html) => { diskKnown[bookId + '/' + chId] = html; };
// One write at a time per chapter, in the order they were asked for
const chapterChain = {};
function persistChapter(chId, html) {
  if (!book) return Promise.resolve(false);
  if (html === undefined) html = chapterHTML[chId] || '';
  rec.reconcile(chId, html);
  const bookId = book.id;
  const key = bookId + '/' + chId;
  savedHTML[chId] = html;
  writing[chId] = (writing[chId] || 0) + 1;
  // the disk is told what this device last knew of the chapter: if another
  // device wrote it since, the write stops and hands that text back, which
  // is kept as its own chapter before this device's words go on
  const run = async () => {
    let r = await window.neo.writeChapter(bookId, chId, html, diskKnown[key]);
    for (let tries = 0; r && typeof r.conflict === 'string' && tries < 3; tries++) {
      knowDisk(bookId, chId, r.conflict);
      await keepOtherDeviceVersion(bookId, chId, r.conflict);
      r = await window.neo.writeChapter(bookId, chId, html, r.conflict);
    }
    if (r && typeof r.conflict === 'string') throw new Error('chapter keeps changing on disk');
    knowDisk(bookId, chId, html);
    return r;
  };
  const p = (chapterChain[key] || Promise.resolve()).catch(() => {}).then(run);
  chapterChain[key] = p;
  return p.catch((err) => {
    // It never reached the disk. Book it as unsaved again (what the disk
    // holds), so the next flush tries once more, and so a look at the disk
    // can't take the old file for news and put it back on the page.
    if (book && book.id === bookId && savedHTML[chId] === html) savedHTML[chId] = diskKnown[key];
    throw err;
  }).finally(() => {
    writing[chId]--;
    if (chapterChain[key] === p) delete chapterChain[key];
  });
}

// Another device's version of a chapter, found on disk when this device
// went to save its own (or on a look at the disk): it becomes the chapter
// right after, titled to say where it came from. Works for a book that has
// since been closed too, straight on disk.
function twinChapterTitle(title) {
  const when = new Date().toLocaleTimeString(NeoI18n.getLocale(), { hour: 'numeric', minute: '2-digit' });
  return ((title || '') + ' ' + t('from other device, {time}', { time: when })).trim();
}
async function keepOtherDeviceVersion(bookId, chId, disk, twinId) {
  twinId = twinId || 'ch-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  if (book && book.id === bookId) {
    const idx = book.chapterOrder.indexOf(chId);
    book.chapterOrder.splice(idx < 0 ? book.chapterOrder.length : idx + 1, 0, twinId);
    book.chapterTitles = book.chapterTitles || {};
    book.chapterTitles[twinId] = twinChapterTitle(book.chapterTitles[chId]);
    setChapterHTML(twinId, disk, 'disk-twin');
    rec.streams('disk-twin');
    await persistChapter(twinId, disk);
    await saveMeta();
    const caret = captureCaret();
    const keepScroll = $('#paper-scroll').scrollTop;
    renderChapters();
    $('#paper-scroll').scrollTop = keepScroll;
    if (caret) restoreCaret(caret);
    updateCounters();
    scheduleNavRefresh();
    toast(t('This chapter also changed on another device. That version is saved as the chapter after it.'), 8000);
    return;
  }
  await window.neo.writeChapter(bookId, twinId, disk);
  const meta = await window.neo.readBookMeta(bookId);
  if (!meta || !Array.isArray(meta.chapterOrder)) return;
  const idx = meta.chapterOrder.indexOf(chId);
  meta.chapterOrder.splice(idx < 0 ? meta.chapterOrder.length : idx + 1, 0, twinId);
  meta.chapterTitles = meta.chapterTitles || {};
  meta.chapterTitles[twinId] = twinChapterTitle(meta.chapterTitles[chId]);
  await writeBookMeta(bookId, meta);
}

// A sync program that found a chapter changed on two devices at once kept
// one and left the other beside it as a copy of its own (Syncthing's
// .sync-conflict-…, Dropbox's conflicted copy, iCloud's "… 2"; found by
// chapter:conflicts), which NEO would never show: each device saved its own
// words, then simply adopted the file it was handed. The copy's words become
// the chapter after, as a version NEO finds itself does, and once that
// chapter reads back from disk the copy moves to the book's sync-conflicts/
// folder (chapter:conflictDone), kept, never deleted. Its id
// comes from the copy's name, so two devices taking in the same copy make
// one chapter, not two. A copy of a chapter no longer in the book stays.
function conflictTwinId(file) {
  let h = 0x811c9dc5;
  for (let i = 0; i < file.length; i++) h = Math.imul(h ^ file.charCodeAt(i), 0x01000193) >>> 0;
  return 'ch-sync-' + h.toString(36);
}
// book.json's own conflict copies (book:conflicts): the other device's
// book.json, set aside when both saved it at once (every flush saves the
// caret's place in it, so this is common). The book.json that stands wins,
// as when both devices restructured (refreshFromDisk), but the chapters and
// loose cards are joined by both files' removals (book.removed, above): a
// chapter or card the copy took out goes here too, unless it holds words
// written here since, and nothing holding words is dropped. A chapter in the
// copy's order that this one lacks, that neither took out, whose file is
// there with words in it (a chapter just made on the other device), goes
// back in after the chapter before it there, with what the copy held for it
// (its title, kind, notes); so does a loose card with words this book
// lacks. The rest of the copy gives way, and the copy is kept as it was in
// sync-conflicts/.
async function takeBookConflictCopies(bookId) {
  for (const c of await window.neo.bookConflicts(bookId)) {
    if (!book || book.id !== bookId) return;
    const meta = c.meta;
    let back = 0;
    let noted = false; // only its removals were news: saved, with nothing to show
    if (meta && Array.isArray(meta.chapterOrder)) {
      const removed = mergeRemoved(book.removed, meta.removed);
      const files = {};
      for (const chId of meta.chapterOrder) {
        if (typeof chId !== 'string' || book.chapterOrder.includes(chId) || (removed[chId] && !removed[chId].back)) continue;
        files[chId] = await window.neo.readChapter(bookId, chId);
        if (!book || book.id !== bookId) return;
      }
      let stamps = null;
      if (window.neo.chapterStamps) {
        try { stamps = await window.neo.chapterStamps(bookId); } catch { stamps = null; }
        if (!book || book.id !== bookId) return;
      }
      const cards = book.looseCards || [];
      const j = joinStructure(book, meta, removed, stamps, (chId) => wordsBeyond(files[chId], ''));
      const gone = book.chapterOrder.filter((chId) => !j.order.includes(chId));
      const added = j.order.filter((chId) => !book.chapterOrder.includes(chId));
      // a card the copy had with no words in it stays behind
      const newCards = j.cards.filter((x) => cards.includes(x) || wordsBeyond((x.text || '') + ' ' + (x.html || ''), ''));
      back = added.length + gone.length + j.back.length +
        newCards.filter((x) => !cards.includes(x)).length + cards.filter((x) => !newCards.includes(x)).length;
      noted = JSON.stringify(removed) !== JSON.stringify(book.removed || {});
      for (const chId of added) {
        carryChapterFields(book, meta, chId);
        setChapterHTML(chId, files[chId], 'disk-new');
        savedHTML[chId] = files[chId];
        knowDisk(bookId, chId, files[chId]);
      }
      book.chapterOrder = j.order;
      book.looseCards = newCards;
      book.removed = removed;
      knowCards();
      if (gone.includes(currentChapterId)) currentChapterId = null;
      // kept here against a removal there: its file goes back for them
      for (const chId of j.back) if (j.order.includes(chId)) persistChapter(chId).catch(() => {});
    }
    if (back || noted) {
      rec.streams('disk-new'); // the titles and cards that came back with them
      await saveMeta();
      if (!book || book.id !== bookId || metaSig(book) !== savedMetaSig) continue; // not on disk yet: next look
    }
    if (back) {
      const caret = captureCaret();
      const keepScroll = $('#paper-scroll').scrollTop;
      renderChapters();
      $('#paper-scroll').scrollTop = keepScroll;
      if (caret) restoreCaret(caret);
      renderLooseCards();
      if (currentTab === 'outline') renderBoard();
      updateCounters();
      scheduleNavRefresh();
      toast(t('Updated from your other device'));
    }
    await window.neo.bookConflictDone(bookId, c.file);
  }
}

let takingConflicts = false;
async function takeConflictCopies(bookId) {
  if (takingConflicts || !window.neo.chapterConflicts) return;
  takingConflicts = true;
  try {
    if (window.neo.bookConflicts) await takeBookConflictCopies(bookId);
    for (const c of await window.neo.chapterConflicts(bookId)) {
      if (!book || book.id !== bookId) return;
      if (!book.chapterOrder.includes(c.chapterId)) continue;
      const twinId = conflictTwinId(c.file);
      if (!book.chapterOrder.includes(twinId) && wordsBeyond(c.html, chapterHTML[c.chapterId])) {
        await keepOtherDeviceVersion(bookId, c.chapterId, c.html, twinId);
        if ((await window.neo.readChapter(bookId, twinId)) !== c.html) continue; // not on disk yet: next look
      }
      await window.neo.chapterConflictDone(bookId, c.file);
    }
  } catch (err) {
    window.neo.logError('conflict copies: ' + ((err && err.message) || err));
  } finally {
    takingConflicts = false;
  }
}

function scheduleChapterSave(chId) {
  maybeDailySnapshot(); // SNAPSHOTS: the first change of the day keeps the day's start
  clearTimeout(saveTimers[chId]);
  const bookId = book && book.id;
  saveTimers[chId] = setTimeout(() => {
    if (!book) return; // the book closed before the timer fired; flushAllSaves already wrote it
    // another book is open, or the chapter was deleted or merged into the one
    // above while this save waited: its words are already where they belong,
    // and writing now would only leave an empty stray file in chapters/
    if (book.id !== bookId || !book.chapterOrder.includes(chId)) return;
    persistChapter(chId);
  }, 800);
}

// book.json minus the parts every device changes constantly, and minus
// empty defaults (NEO fills in chapterTitles: {} and friends after opening;
// the file on disk may not have them yet — same book either way)
function metaSig(m) {
  if (!m) return '';
  const c = {};
  for (const k of Object.keys(m).sort()) {
    if (k === 'lastPosition' || k === 'modified' || k === 'wordCount' || k === 'dailyCounts') continue; // bookkeeping, not the book
    const v = m[k];
    if (v === undefined || v === null || v === '') continue;
    if (typeof v === 'object' && Object.keys(v).length === 0) continue;
    c[k] = v;
  }
  return JSON.stringify(c);
}

function scheduleMetaSave() {
  clearTimeout(saveTimers.meta);
  saveTimers.meta = setTimeout(saveMeta, 800);
}
async function saveMeta() {
  if (!book || shelfExport) return;
  const bookId = book.id;
  // Nothing restructured here, only the caret moved: if another device has
  // restructured the book meanwhile, this book.json is the old one, and
  // writing it would put that back. The look at the disk takes theirs
  // first; the caret's place goes with the next save.
  if (metaSig(book) === savedMetaSig && !refreshing) {
    const disk = await window.neo.readBookMeta(bookId).catch(() => null);
    if (!book || book.id !== bookId) return;
    if (disk && Array.isArray(disk.chapterOrder) && metaSig(disk) !== savedMetaSig && metaSig(book) === savedMetaSig) {
      refreshFromDisk();
      return;
    }
  }
  noteStructure();
  rec.streams('edit', [Rec.STREAMS.titles, Rec.STREAMS.outline]); // what book.json holds of the writing
  const sig = metaSig(book);
  const stamp = await writeBookMeta(bookId, book);
  // the answer belongs to the book that was saved; another one may be open now
  if (!book || book.id !== bookId) return;
  if (typeof stamp === 'string') book.modified = stamp;
  savedMetaSig = sig;
}

function flushAllSaves(e) {
  if (!book || shelfExport) return;
  // remember where you were, for next session and for the other device:
  // the chapter, the paragraph and the letter (the same place on any
  // screen) plus the scroll (this screen's). `at` changes only when the
  // caret does, so a device that merely scrolled never calls the other
  // one back to an old spot.
  const prev = book.lastPosition || {};
  // On another tab, the manuscript's place is the one it had when you left
  // it (tabPlaces): the Notes page's scroll is not a place in the book.
  const writing = currentTab === 'manuscript';
  const kept = !writing ? tabPlaces.manuscript : null;
  const caret = writing ? captureCaret() : (kept && kept.caret) || null;
  const spot = caret
    ? { chapterId: caret.chId, pIdx: caret.pIdx, off: caret.off }
    : (!writing || prev.chapterId === currentChapterId) && prev.chapterId ? { chapterId: prev.chapterId, pIdx: prev.pIdx, off: prev.off } : { chapterId: currentChapterId };
  const scroll = writing ? $('#paper-scroll').scrollTop : kept && typeof kept.scroll === 'number' ? kept.scroll : (prev.scroll || 0);
  // …and the tab you were on, with its own scroll, so the book opens there
  const tab = currentTab || 'manuscript';
  const tabScroll = writing ? undefined : $('#paper-scroll').scrollTop;
  const newSpot = spot.chapterId !== prev.chapterId || spot.pIdx !== prev.pIdx;
  const newLetter = newSpot || spot.off !== prev.off;
  // the regular tick while writing saves a new paragraph; leaving NEO (a
  // blur, the app going to the background, closing) saves the exact letter
  const newTab = tab !== (prev.tab || 'manuscript') || (!writing && Math.abs((prev.tabScroll || 0) - tabScroll) > 40);
  const moved = newSpot || newTab || (e !== 'tick' && newLetter) || Math.abs((prev.scroll || 0) - scroll) > 40;
  if (moved) {
    book.lastPosition = { ...spot, scroll, at: newLetter ? Date.now() : (prev.at || Date.now()), tab };
    if (!writing) book.lastPosition.tabScroll = tabScroll;
  }
  for (const chId of book.chapterOrder) {
    if (chapterHTML[chId] !== undefined && chapterHTML[chId] !== savedHTML[chId]) {
      persistChapter(chId);
    }
  }
  flushAux();
  flushStickiesSave();
  flushSidecars();
  if (moved || metaSig(book) !== savedMetaSig) saveMeta();
  rec.flush(); // the recording since the last flush
}

/* ================================================================== */
/*  SNAPSHOTS                                                          */
/* ================================================================== */

// ⌘S takes a snapshot of the book: the chapters that changed since the last
// snapshot, plus the book's shape (order, titles, kinds) and a fingerprint of
// every chapter. NEO takes one on its own before the first change of each
// writing day. They're listed in the right-hand pane on the Darlings tab;
// picking one shows the book as it was, read-only, with what has gone since
// marked, and brings a chapter or the whole book back.
//
// book-…/snapshots/<name>/  one folder per snapshot, its files written once
// (main.js, Pocket's bridge): <chapterId>.html for each chapter that changed,
// then snapshot.json, last, so a folder without it is still being written.
// A chapter's text at a snapshot is in the newest snapshot at or before it
// that holds the file. The name carries what the list shows:
//   20261009T121400Z-k-3-84210-x7q2   when (UTC) · kind · chapters changed · words
// k: taken with ⌘S (kept until deleted) · d: the start of a writing day ·
// r: just before a snapshot was brought back. NEO's own (d, r) go after 30
// days; a snapshot that goes hands its chapters on to the next one first.
const SNAP_KEPT = 'k';
const SNAP_KEEP_DAYS = 30;
function snapName(ms, kind, changed, words, rand = Math.random().toString(36).slice(2, 6)) {
  const when = new Date(ms).toISOString().replace(/[-:]/g, '').slice(0, 15);
  return `${when}Z-${kind}-${Math.max(0, changed | 0)}-${Math.max(0, Math.round(words) || 0)}-${String(rand).replace(/[^a-z0-9]/g, '') || 'x'}`;
}
function parseSnapName(name) {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z-([a-z])-(\d+)-(\d+)-[a-z0-9]+$/.exec(name);
  if (!m) return null;
  return { name, at: Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]), kind: m[7], changed: +m[8], words: +m[9] };
}
// a short fingerprint of a chapter's text (cyrb53): equal text, equal print
function textHash(str) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36) + ':' + str.length;
}
// NEO's own snapshots older than a month go, by their names alone (so every
// device picks the same ones); ⌘S snapshots and the newest one stay
function snapsToThin(snaps, now) {
  const newest = snaps.reduce((a, s) => (!a || s.at > a.at ? s : a), null);
  return snaps.filter((s) => s !== newest && s.kind !== SNAP_KEPT && now - s.at > SNAP_KEEP_DAYS * 86400000).map((s) => s.name);
}
// where a chapter's text at snapshots[i] is: the newest snapshot at or
// before it holding the file (snapshots oldest first, each with `files`)
function snapHolder(snaps, i, chId) {
  for (let k = i; k >= 0; k--) if (snaps[k].files.has(chId + '.html')) return snaps[k];
  return null;
}
// Which words of an older text the chapter no longer has, paragraph by
// paragraph. A paragraph still there word for word is left alone; one with
// no near twin today is gone whole; one rewritten is compared word by word
// with today's paragraph that shares the most words with it.
// → for each old paragraph: null (still there), 'all', or its gone words' places
function wordsGone(oldParas, curParas) {
  const words = (s) => String(s).split(/\s+/).filter(Boolean);
  const curWords = curParas.map(words);
  const here = new Set(curWords.map((w) => w.join(' ')));
  const curSets = curWords.map((w) => new Set(w));
  return oldParas.map((text) => {
    const w = words(text);
    if (!w.length || here.has(w.join(' '))) return null;
    const mine = new Set(w);
    let best = -1;
    let bestScore = 0;
    curSets.forEach((set, i) => {
      let shared = 0;
      for (const x of mine) if (set.has(x)) shared++;
      const score = shared / Math.max(mine.size, set.size);
      if (score > bestScore) { bestScore = score; best = i; }
    });
    if (best < 0 || bestScore < 0.4) return 'all';
    const b = curWords[best];
    const n = w.length;
    const m = b.length;
    if (n * m > 4e6) return 'all';
    // the longest run of words the two share, in order; the rest is gone
    const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) L[i][j] = w[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    }
    const gone = [];
    for (let i = 0, j = 0; i < n;) {
      if (j < m && w[i] === b[j]) { i++; j++; } else if (j < m && L[i][j + 1] >= L[i + 1][j]) j++;
      else { gone.push(i); i++; }
    }
    return gone.length ? gone : null;
  });
}
// (the rules above are plain functions: scripts/snapshots.test.js)

// a chapter's saved HTML as an inert copy (a <template> loads no images)
function snapHolderEl(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html || '';
  tpl.content.querySelectorAll(UNCOUNTED).forEach((n) => n.remove());
  return tpl.content;
}
const htmlWords = (html) => countWords(plainText(snapHolderEl(html)));
const htmlParas = (html) => [...snapHolderEl(html).children].map((p) => p.textContent);
const snapsCan = () => !!(window.neo && window.neo.snapshotWrite);
const logSnap = (err) => window.neo.logError('snapshot: ' + ((err && err.message) || err));

// The book's snapshots, oldest first: { name, at, kind, changed, words, files: Set }.
// Only finished ones (snapshot.json written).
let snapCache = null;
async function loadSnaps(bookId, fresh) {
  if (!fresh && snapCache && snapCache.bookId === bookId) return snapCache.snaps;
  const raw = await window.neo.snapshotList(bookId);
  const snaps = [];
  for (const r of raw || []) {
    const s = parseSnapName(r.name);
    if (!s || !r.files.includes('snapshot.json')) continue;
    s.files = new Set(r.files);
    snaps.push(s);
  }
  snaps.sort((a, b) => a.at - b.at || (a.name < b.name ? -1 : 1));
  snapCache = { bookId, snaps };
  return snaps;
}
async function snapMeta(bookId, s) {
  if (!s.meta) {
    try { s.meta = JSON.parse(await window.neo.snapshotRead(bookId, s.name, 'snapshot.json')); } catch { s.meta = null; }
  }
  return s.meta;
}

// Takes a snapshot of the open book. `htmlOf` gives each chapter's text (by
// default what's on the page). Resolves to { snap, same } — same: nothing
// had changed since the last snapshot, so none was taken.
let snapChain = Promise.resolve();
function takeSnapshot(kind, htmlOf = (c) => chapterHTML[c] || '', { ifNoneToday = false } = {}) {
  const run = () => takeSnapshotNow(kind, htmlOf, { ifNoneToday });
  const p = snapChain.catch(() => {}).then(run);
  snapChain = p;
  return p;
}
async function takeSnapshotNow(kind, htmlOf, { ifNoneToday }) {
  if (!book || !snapsCan()) return null;
  const bookId = book.id;
  const order = [...book.chapterOrder];
  const titles = { ...(book.chapterTitles || {}) };
  const kinds = { ...(book.chapterKinds || {}) };
  const texts = {};
  for (const c of order) texts[c] = htmlOf(c);
  const snaps = await loadSnaps(bookId);
  const now = Date.now();
  if (ifNoneToday && snaps.some((s) => writingDay(new Date(s.at)) === writingDay(new Date(now)))) return null;
  const last = snaps[snaps.length - 1] || null;
  const lastMeta = last ? await snapMeta(bookId, last) : null;
  const hashes = {};
  const words = {};
  const changed = [];
  let total = 0;
  for (const c of order) {
    hashes[c] = textHash(texts[c]);
    words[c] = htmlWords(texts[c]);
    total += words[c];
    const known = lastMeta && lastMeta.hashes && lastMeta.hashes[c] === hashes[c] && snapHolder(snaps, snaps.length - 1, c);
    if (!known) changed.push(c);
  }
  if (!total && !lastMeta && kind !== SNAP_KEPT) return null; // nothing written yet
  const sameShape = lastMeta && JSON.stringify(lastMeta.chapterOrder) === JSON.stringify(order) &&
    order.every((c) => (lastMeta.chapterTitles || {})[c] === titles[c] && (lastMeta.chapterKinds || {})[c] === kinds[c]);
  if (!changed.length && sameShape && (kind !== SNAP_KEPT || last.kind === SNAP_KEPT)) return { snap: last, same: true };
  const name = snapName(now, kind, changed.length, total);
  for (const c of changed) await window.neo.snapshotWrite(bookId, name, c + '.html', texts[c]);
  const meta = { v: 1, at: new Date(now).toISOString(), kind, title: book.title || '', chapterOrder: order, chapterTitles: titles, chapterKinds: kinds, hashes, words, changed, total };
  await window.neo.snapshotWrite(bookId, name, 'snapshot.json', JSON.stringify(meta, null, 1));
  const snap = parseSnapName(name);
  snap.files = new Set([...changed.map((c) => c + '.html'), 'snapshot.json']);
  snap.meta = meta;
  snaps.push(snap);
  // while the book is recording, Writing History shows it as a tag on this moment
  if (rec.on && rec.bookId === bookId) rec.tag(null, null, { snapshot: name });
  // NEO's own old ones go, each handing its chapters on to the next first
  for (const gone of snapsToThin(snaps, now)) {
    const i = snaps.findIndex((s) => s.name === gone);
    const next = snaps[i + 1];
    if (i < 0 || !next) continue;
    for (const f of snaps[i].files) {
      if (!f.endsWith('.html') || next.files.has(f)) continue;
      const text = await window.neo.snapshotRead(bookId, snaps[i].name, f);
      await window.neo.snapshotWrite(bookId, next.name, f, text);
      next.files.add(f);
    }
    await window.neo.snapshotRemove(bookId, gone);
    snaps.splice(i, 1);
  }
  renderSnapList();
  return { snap, same: false };
}

// The first change of a writing day keeps the book as the day found it
// (what's on disk: savedHTML, before this change reaches it). The writer's
// day, as the goals and Writing History count it (writingDay)
const snapDay = {};
function maybeDailySnapshot() {
  if (!book || !snapsCan() || shelfExport) return;
  const today = writingDay();
  if (snapDay[book.id] === today) return;
  snapDay[book.id] = today;
  takeSnapshot('d', (c) => (typeof savedHTML[c] === 'string' ? savedHTML[c] : chapterHTML[c] || ''), { ifNoneToday: true }).catch(logSnap);
}

// ⌘S
async function snapshotNow() {
  if (!book || !snapsCan()) return;
  try {
    const r = await takeSnapshot(SNAP_KEPT);
    if (!r) return;
    const time = snapTime(r.snap.at);
    if (r.same) { toast(t('Nothing has changed since your last snapshot ({time}).', { time }), 3500); return; }
    const first = (await loadSnaps(book.id)).length === 1;
    toast(first ? t('Snapshot taken, {time}: the whole book. It’s on the Darlings tab.', { time })
      : t('Snapshot taken, {time}: {n} chapters changed. It’s on the Darlings tab.', { time, n: r.snap.changed }), 4000);
  } catch (err) {
    logSnap(err);
    toast(t('NEO couldn’t take a snapshot. Your book itself is saved as usual.'), 6000);
  }
}

const snapTime = (at) => new Date(at).toLocaleTimeString(NeoI18n.getLocale(), { hour: 'numeric', minute: '2-digit' });
function snapWhen(at) {
  const d = new Date(at);
  const today = new Date();
  const time = snapTime(at);
  if (d.toDateString() === today.toDateString()) return t('today at {time}', { time });
  if (d.toDateString() === new Date(today.getTime() - 86400000).toDateString()) return t('yesterday at {time}', { time });
  return d.toLocaleDateString(NeoI18n.getLocale(), { weekday: 'short', month: 'short', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' }) + ', ' + time;
}
function snapWhy(kind) {
  if (kind === SNAP_KEPT) return t('Taken by you');
  if (kind === 'd') return t('Start of the day');
  if (kind === 'r') return t('Before a restore');
  return '';
}

// ---- the list: the right-hand pane, while Darlings is up ----
let snapShown = null; // the snapshot on the page, or null for the darlings
function snapList() {
  let list = $('#snap-list');
  if (list) return list;
  const head = $('#side-head > span');
  if (head && !$('#side-head .side-title-snaps')) {
    head.classList.add('side-title-notes');
    const alt = document.createElement('span');
    alt.className = 'side-title-snaps';
    alt.textContent = t('Snapshots');
    head.after(alt);
  }
  list = document.createElement('div');
  list.id = 'snap-list';
  list.setAttribute('role', 'listbox');
  $('#sticky-list').after(list);
  return list;
}
async function renderSnapList() {
  if (!book || currentTab !== 'darlings') return;
  const list = snapList();
  const bookId = book.id;
  let snaps = [];
  try { snaps = await loadSnaps(bookId); } catch (err) { logSnap(err); }
  if (!book || book.id !== bookId) return;
  list.innerHTML = '';
  const item = (cls, title, sub, on, onClick) => {
    const b = document.createElement('button');
    b.className = 'snap-item ' + cls + (on ? ' on' : '');
    b.setAttribute('role', 'option');
    b.setAttribute('aria-selected', on ? 'true' : 'false');
    b.innerHTML = '<span class="snap-dot" aria-hidden="true"></span><span class="snap-line"><span class="snap-t"></span><span class="snap-s"></span></span>';
    b.querySelector('.snap-t').textContent = title;
    b.querySelector('.snap-s').textContent = sub;
    b.onclick = onClick;
    list.appendChild(b);
    return b;
  };
  item('snap-darlings', t('Darlings'), t('{n} darlings', { n: darlings.length }), !snapShown, () => showDarlingsAgain());
  if (!snaps.length) {
    const p = document.createElement('p');
    p.className = 'snap-empty';
    p.textContent = IS_MAC ? t('Press ⌘S to take a snapshot of your book. It costs only the chapters that changed.')
      : t('Press Ctrl+S to take a snapshot of your book. It costs only the chapters that changed.');
    if (recordingWanted()) p.textContent += ' ' + t('Writing History keeps every moment in between, and shows your snapshots there as tags.');
    list.appendChild(p);
    return;
  }
  let lastGroup = '';
  const today = new Date().toDateString();
  const yest = new Date(Date.now() - 86400000).toDateString();
  for (let i = snaps.length - 1; i >= 0; i--) {
    const s = snaps[i];
    const d = new Date(s.at).toDateString();
    const group = d === today ? t('Today') : d === yest ? t('Yesterday') : t('Earlier');
    if (group !== lastGroup) {
      const g = document.createElement('div');
      g.className = 'snap-group';
      g.textContent = group;
      list.appendChild(g);
      lastGroup = group;
    }
    const when = group === t('Earlier') ? new Date(s.at).toLocaleDateString(NeoI18n.getLocale(), { month: 'short', day: 'numeric' }) + ', ' + snapTime(s.at) : snapTime(s.at);
    const what = i === 0 ? t('The whole book') : s.changed ? t('{n} chapters changed', { n: s.changed }) : t('No chapters changed');
    const on = snapShown && snapShown.name === s.name;
    const b = item(s.kind === SNAP_KEPT ? 'snap-k' : 'snap-a', when, snapWhy(s.kind) + ' · ' + what, on, () => showSnapshot(s.name));
    b.title = t('{n} words', { n: s.words });
    b.addEventListener('contextmenu', async (e) => {
      e.preventDefault();
      const has = await snapHasHistory(bookId);
      const choice = await popMenu(e.clientX, e.clientY, [
        { label: t('Show This Snapshot'), value: 'show' },
        { label: t('Watch from Here'), value: 'watch', disabled: !has }
      ]);
      if (choice === 'show') showSnapshot(s.name);
      else if (choice === 'watch') snapWatch(s);
    });
    if (on && snapShown.diff && snapShown.diff.length) {
      // the chapters that differ from today, to jump to
      const sub = document.createElement('div');
      sub.className = 'snap-chapters';
      for (const c of snapShown.diff) {
        const a = document.createElement('button');
        a.className = 'snap-ch';
        a.textContent = c.label;
        a.onclick = () => { const el = document.querySelector(`#snap-view .snap-chapter[data-id="${c.chId}"]`); if (el) el.scrollIntoView({ block: 'start', behavior: scrollBehavior() }); };
        sub.appendChild(a);
      }
      list.appendChild(sub);
    }
  }
}

// ---- the page: the book as it was ----
function snapView() {
  let v = $('#snap-view');
  if (v) return v;
  v = document.createElement('div');
  v.id = 'snap-view';
  v.hidden = true;
  $('#darlings-list').after(v);
  // a passage picked from an old snapshot can go to Darlings
  v.addEventListener('contextmenu', async (e) => {
    const sel = window.getSelection();
    const text = sel && !sel.isCollapsed && v.contains(sel.anchorNode) ? sel.toString().trim() : '';
    if (!text) return;
    e.preventDefault();
    const range = sel.getRangeAt(0).cloneRange();
    const choice = await popMenu(e.clientX, e.clientY, [
      { label: t('Copy'), value: 'copy' },
      { label: t('Set Aside as a Darling'), value: 'darling' }
    ]);
    if (choice === 'copy') document.execCommand('copy');
    if (choice === 'darling') snapToDarling(range, text);
  });
  return v;
}

async function snapToDarling(range, text) {
  if (!book) return;
  const holder = document.createElement('div');
  holder.appendChild(range.cloneContents());
  const chEl = range.startContainer.parentElement && range.startContainer.parentElement.closest('.snap-chapter');
  const html = [...holder.querySelectorAll('p')].length ? holder.innerHTML : '<p>' + escHtml(text) + '</p>';
  darlings.unshift({
    id: 'd-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    html,
    text: text.slice(0, 2000),
    chapterId: chEl ? chEl.dataset.id : '',
    chapterLabel: chEl ? chEl.dataset.label : t('a snapshot'),
    date: new Date().toISOString()
  });
  await writeSidecar(book.id, 'darlings', darlings);
  renderSnapList();
  toast(t('Set aside in Darlings.'), 2500);
}

function showDarlingsAgain() {
  snapShown = null;
  if (window.CSS && CSS.highlights) CSS.highlights.delete('neo-snap-gone');
  const v = $('#snap-view');
  if (v) { v.hidden = true; v.innerHTML = ''; }
  if (currentTab !== 'darlings') return;
  $('#aux-title').textContent = t('Darlings');
  $('#darlings-list').hidden = false;
  renderDarlings();
  renderSnapList();
  $('#paper-scroll').scrollTop = 0;
}

// the snapshot's book, chapter by chapter: [{ chId, html }] in its order
async function snapshotBook(bookId, name) {
  const snaps = await loadSnaps(bookId, true);
  const i = snaps.findIndex((s) => s.name === name);
  if (i < 0) return null;
  const meta = await snapMeta(bookId, snaps[i]);
  if (!meta) return null;
  const chapters = [];
  for (const chId of meta.chapterOrder) {
    const at = snapHolder(snaps, i, chId);
    chapters.push({ chId, html: at ? await window.neo.snapshotRead(bookId, at.name, chId + '.html') : '' });
  }
  return { snap: snaps[i], meta, chapters };
}

async function showSnapshot(name) {
  if (!book) return;
  const bookId = book.id;
  const got = await snapshotBook(bookId, name).catch((err) => { logSnap(err); return null; });
  if (!book || book.id !== bookId || currentTab !== 'darlings') return;
  if (!got) { toast(t('NEO couldn’t read that snapshot.')); return; }
  const { snap, meta, chapters } = got;
  const shape = { ...book, chapterOrder: meta.chapterOrder, chapterTitles: meta.chapterTitles || {}, chapterKinds: meta.chapterKinds || {} };
  const label = (chId) => chapterHeading(chId, shape) || chapterName(chId, shape);
  const v = snapView();
  $('#darlings-list').hidden = true;
  $('#aux-title').textContent = t('Your book as it was');
  v.hidden = false;
  v.innerHTML = '';
  if (window.CSS && CSS.highlights) CSS.highlights.delete('neo-snap-gone');
  // which chapters differ from the book today
  const diff = [];
  for (const ch of chapters) {
    const now = book.chapterOrder.includes(ch.chId) ? (chapterHTML[ch.chId] || '') : null;
    ch.now = now;
    ch.same = now !== null && textHash(now) === textHash(ch.html);
    if (!ch.same) diff.push({ chId: ch.chId, label: label(ch.chId) });
  }
  const extra = book.chapterOrder.filter((c) => !meta.chapterOrder.includes(c)).length;
  snapShown = { name, snap, meta, chapters, diff };

  const band = document.createElement('div');
  band.className = 'snap-band';
  band.innerHTML = '<div class="snap-band-what"><span class="snap-band-when"></span><span class="snap-band-sub"></span></div><div class="snap-band-do"><button class="snap-back"></button><button class="snap-all"></button></div>';
  band.querySelector('.snap-band-when').textContent = t('Your book {when}', { when: snapWhen(snap.at) });
  band.querySelector('.snap-band-sub').textContent = (diff.length ? t('{n} chapters differ from now', { n: diff.length }) : t('Every chapter is the same as now'))
    + (extra ? ' · ' + t('{n} chapters added since', { n: extra }) : '');
  band.querySelector('.snap-back').textContent = t('Back to Darlings');
  band.querySelector('.snap-back').onclick = showDarlingsAgain;
  const all = band.querySelector('.snap-all');
  all.textContent = t('Restore Whole Book');
  all.disabled = !diff.length && !extra && JSON.stringify(meta.chapterOrder) === JSON.stringify(book.chapterOrder);
  all.onclick = () => restoreSnapshot(null);
  // Writing History from this snapshot's moment, while the book has one
  const watch = document.createElement('button');
  watch.className = 'snap-watch';
  watch.textContent = t('Watch from Here');
  watch.title = t('Writing History, playing from this snapshot');
  watch.hidden = true;
  watch.onclick = () => snapWatch(snap);
  band.querySelector('.snap-band-do').prepend(watch);
  snapHasHistory(bookId).then((has) => { watch.hidden = !has; });
  v.appendChild(band);

  const ranges = [];
  for (const ch of chapters) {
    const sec = document.createElement('section');
    sec.className = 'snap-chapter' + (ch.same ? ' same' : '');
    sec.dataset.id = ch.chId;
    sec.dataset.label = label(ch.chId);
    const head = document.createElement('div');
    head.className = 'snap-head';
    const h = document.createElement('h3');
    h.textContent = label(ch.chId);
    head.appendChild(h);
    const tag = document.createElement('span');
    tag.className = 'snap-tag';
    tag.textContent = ch.same ? t('Same as now') : ch.now === null ? t('No longer in the book') : t('Differs from now');
    head.appendChild(tag);
    if (!ch.same) {
      const b = document.createElement('button');
      b.className = 'snap-one';
      b.textContent = t('Restore This Chapter');
      b.onclick = () => restoreSnapshot(ch.chId);
      head.appendChild(b);
    }
    sec.appendChild(head);
    const body = document.createElement('div');
    body.className = 'chapter-body snap-body';
    if (isScript()) body.classList.add('sp-geom');
    body.appendChild(snapHolderEl(ch.html));
    sec.appendChild(body);
    v.appendChild(sec);
    if (ch.same) continue;
    const paras = [...body.children];
    if (ch.now === null) { paras.forEach((p) => p.classList.add('snap-gone')); continue; }
    const gone = wordsGone(paras.map((p) => p.textContent), htmlParas(ch.now));
    paras.forEach((p, k) => {
      const g = gone[k];
      if (!g) return;
      if (g === 'all') { p.classList.add('snap-gone'); return; }
      ranges.push(...wordRanges(p, new Set(g)));
    });
  }
  if (ranges.length && window.CSS && CSS.highlights && window.Highlight) CSS.highlights.set('neo-snap-gone', new Highlight(...ranges));
  renderSnapList();
  // to the first chapter that differs
  const first = diff.length && v.querySelector(`.snap-chapter[data-id="${diff[0].chId}"]`);
  if (first) first.scrollIntoView({ block: 'start' });
  else $('#paper-scroll').scrollTop = 0;
}

// Whether a book has a Writing History to watch
async function snapHasHistory(bookId) {
  if (!historyCanOpen()) return false;
  try { return ((await window.neo.recList(bookId)) || []).some((d) => d.sessions.length); } catch { return false; }
}
// Watch from Here: Writing History at the snapshot's tag
function snapWatch(s) {
  if (book) openHistory({ bookId: book.id, snapshot: { name: s.name, at: s.at } });
}

// ranges over the words of p at the given places (its text nodes end to end)
function wordRanges(p, at) {
  const nodes = [];
  let full = '';
  const walk = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) { nodes.push({ n, from: full.length }); full += n.data; }
  const spot = (pos) => {
    let k = nodes.length - 1;
    while (k > 0 && nodes[k].from > pos) k--;
    return [nodes[k].n, Math.min(pos - nodes[k].from, nodes[k].n.data.length)];
  };
  const out = [];
  let w = 0;
  for (const m of full.matchAll(/\S+/g)) {
    if (at.has(w)) {
      const r = document.createRange();
      r.setStart(...spot(m.index));
      r.setEnd(...spot(m.index + m[0].length));
      out.push(r);
    }
    w++;
  }
  return out;
}

// A chapter (chId) or the whole book (null) as the shown snapshot had it.
// The book as it stands is snapshotted first, and ⌘Z undoes the restore.
async function restoreSnapshot(chId) {
  const shown = snapShown;
  if (!book || !shown) return;
  try {
    await takeSnapshot('r');
  } catch (err) {
    logSnap(err); // never replace words that couldn't be kept
    toast(t('NEO couldn’t snapshot the book as it is now, so nothing was changed.'), 6000);
    return;
  }
  const { meta, chapters, snap } = shown;
  const byId = Object.fromEntries(chapters.map((c) => [c.chId, c.html]));
  snapshotStructure('snapshot');
  book.chapterTitles = book.chapterTitles || {};
  book.chapterKinds = book.chapterKinds || {};
  let gone = [];
  if (chId) {
    if (!book.chapterOrder.includes(chId)) {
      // back where it stood: after the nearest chapter before it that's still here
      const before = meta.chapterOrder.slice(0, meta.chapterOrder.indexOf(chId)).reverse().find((c) => book.chapterOrder.includes(c));
      book.chapterOrder.splice(before ? book.chapterOrder.indexOf(before) + 1 : 0, 0, chId);
      if ((meta.chapterTitles || {})[chId]) book.chapterTitles[chId] = meta.chapterTitles[chId];
      if ((meta.chapterKinds || {})[chId]) book.chapterKinds[chId] = meta.chapterKinds[chId];
    }
    setChapterHTML(chId, byId[chId], 'snapshot');
  } else {
    gone = book.chapterOrder.filter((c) => !meta.chapterOrder.includes(c));
    book.chapterOrder = [...meta.chapterOrder];
    for (const c of book.chapterOrder) {
      setChapterHTML(c, byId[c], 'snapshot');
      if ((meta.chapterTitles || {})[c] !== undefined) book.chapterTitles[c] = meta.chapterTitles[c]; else delete book.chapterTitles[c];
      if ((meta.chapterKinds || {})[c] !== undefined) book.chapterKinds[c] = meta.chapterKinds[c]; else delete book.chapterKinds[c];
    }
  }
  wordCache = {};
  rec.streams('snapshot');
  for (const c of chId ? [chId] : book.chapterOrder) await persistChapter(c);
  await saveMeta();
  // chapters added since: out of the book, their words in the snapshot just taken
  for (const c of gone) { dropChapterHTML(c, 'snapshot'); await window.neo.deleteChapter(book.id, c); }
  showDarlingsAgain();
  switchTab('manuscript');
  renderChapters();
  const el = chId && document.querySelector(`.chapter[data-id="${chId}"]`);
  if (el) { el.scrollIntoView({ block: 'start' }); focusChapterStart(chId); breakRun = 1; } // ⌘Z, before any typing, undoes it
  else $('#paper-scroll').scrollTop = 0;
  updateCounters();
  scheduleNavRefresh();
  const undo = IS_MAC ? '⌘Z' : 'Ctrl+Z';
  toast(chId ? t('Chapter restored from {when}. {undo} undoes it; the text it replaced is in a snapshot too.', { when: snapWhen(snap.at), undo })
    : t('Book restored from {when}. {undo} undoes it; the book as it was is in a snapshot too.', { when: snapWhen(snap.at), undo }), 7000);
}

// Esc on a snapshot goes back to the darlings (first, before the editor's
// own Esc, which would close the book)
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || e.isComposing || !snapShown || currentTab !== 'darlings') return;
  if (document.querySelector('.modal-backdrop:not([hidden]), .pop-menu') || !$('#searchbar').hidden) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  showDarlingsAgain();
}, true);

/* ================================================================== */
/*  REFRESH — picking up what another device wrote                     */
/*  A library shared over iCloud or Syncthing changes underneath NEO.  */
/*  Whenever NEO comes back into view it looks again: a chapter that   */
/*  changed on disk and not here is simply adopted; one that changed   */
/*  in both places keeps the local text on the page and lands the      */
/*  other device's version in a new chapter right after it, so that    */
/*  nothing is ever lost quietly.                                      */
/* ================================================================== */

// True when the disk copy of a chapter has no word the page lacks, but the
// page has words it lacks: an older copy, not an edit made somewhere else.
function onlyDrops(page, disk) {
  const bag = (html) => {
    const m = new Map();
    for (const w of String(html || '').replace(/<[^>]*>/g, ' ').split(/\s+/)) if (w) m.set(w, (m.get(w) || 0) + 1);
    return m;
  };
  const here = bag(page);
  const there = bag(disk);
  for (const [w, n] of there) if (n > (here.get(w) || 0)) return false;
  for (const [w, n] of here) if (n > (there.get(w) || 0)) return true;
  return false;
}

// book.removed: each chapter and loose card taken out of the book (deleted,
// joined to another, set on a card, a card placed or deleted), by id, with
// when and a fingerprint of what it held, { at, hash }; { at, back: true }
// once it came back under the same id (⌘Z). Two book.json files that
// disagree (the other device's, saved before it saw a change made here,
// every flush saving the caret's place; or a copy a sync program set aside)
// are joined by it: what either took out stays out, and what one lacks with
// no entry is something it never knew of, so it stays in. A chapter taken
// out there that has words here the other device may not have had (unsaved,
// or its file newer than the removal) stays, and goes back in there too.
// Entries go after a month.
const REMOVED_DAYS = 30;
function noteRemoved(id, hash) {
  if (!book) return;
  const removed = (book.removed = book.removed || {});
  if (removed[id] && !removed[id].back) return;
  removed[id] = { at: Date.now(), hash };
}
function noteBack(id) {
  const r = book && book.removed && book.removed[id];
  if (r && !r.back) book.removed[id] = { at: Date.now(), back: true };
}
function cardHash(card) {
  return textHash(JSON.stringify([card.title || '', card.text || '', card.html || '']));
}
// the loose cards as this device last saved or read them, id → cardHash
let cardsKnown = new Map();
function knowCards() {
  cardsKnown = new Map(((book && book.looseCards) || []).map((c) => [c.id, cardHash(c)]));
}
// Before book.json is written: the cards gone since it was last written,
// and whatever is back. (A chapter's removal is noted as it goes, in
// dropChapterHTML, while its text is still there to fingerprint.)
function noteStructure() {
  if (!book) return;
  const cards = new Set();
  for (const c of book.looseCards || []) { cards.add(c.id); noteBack(c.id); }
  for (const [id, hash] of cardsKnown) if (!cards.has(id)) noteRemoved(id, hash);
  knowCards();
  for (const id of book.chapterOrder || []) noteBack(id);
  const old = Date.now() - REMOVED_DAYS * 86400000;
  for (const [id, r] of Object.entries(book.removed || {})) if (!r || !(r.at >= old)) delete book.removed[id];
}
function mergeRemoved(a, b) {
  const out = { ...(a || {}) };
  for (const [id, r] of Object.entries(b || {})) {
    if (r && typeof r.at === 'number' && (!out[id] || out[id].at < r.at)) out[id] = r;
  }
  return out;
}
// A chapter taken out on another device, as this one holds it: can it go
// here too? Not with words unsaved here, nor when its file was written
// after (or just before) the removal with other text than went: those are
// words the other device may not have had. `stamps` are the chapter
// files' "mtime:size" (null when unknown: then it stays).
function goesToo(chId, r, stamps) {
  if (chapterHTML[chId] === undefined) return true;
  if (chapterHTML[chId] !== savedHTML[chId]) return false;
  if (r.hash === textHash(String(chapterHTML[chId]))) return true;
  if (!stamps) return false;
  if (!(chId in stamps)) return true; // its file is gone here too
  return parseFloat(stamps[chId]) < r.at - 120000;
}
// The chapters and loose cards of two book.json files, joined by `removed`
// (both files' removals): `base`'s order leads, and a chapter only `other`
// lists goes in after the one before it there when `wanted(id)` says so.
// What stays against a removal is marked back in `removed`.
function joinStructure(base, other, removed, stamps, wanted) {
  const back = new Set();
  const stays = (id) => {
    const r = removed[id];
    if (!r || r.back) return true;
    if (chapterHTML[id] === undefined || goesToo(id, r, stamps)) return false;
    back.add(id);
    return true;
  };
  const order = (base.chapterOrder || []).filter(stays);
  const from = Array.isArray(other.chapterOrder) ? other.chapterOrder : [];
  from.forEach((id, i) => {
    if (typeof id !== 'string' || order.includes(id) || !stays(id) || !wanted(id)) return;
    const prev = from.slice(0, i).reverse().find((x) => order.includes(x));
    order.splice(prev ? order.indexOf(prev) + 1 : 0, 0, id);
  });
  const cards = [];
  for (const c of [...(base.looseCards || []), ...(Array.isArray(other.looseCards) ? other.looseCards : [])]) {
    if (!c || typeof c !== 'object' || cards.some((x) => x.id === c.id)) continue;
    const r = removed[c.id];
    if (r && !r.back) {
      if (r.hash === cardHash(c)) continue;
      back.add(c.id); // changed after it went: kept
    }
    cards.push(c);
  }
  for (const id of back) removed[id] = { at: Date.now(), back: true };
  return { order, cards, back: [...back] };
}
// what `from` holds for a chapter (its title, kind, notes), where `into` has nothing
function carryChapterFields(into, from, chId) {
  for (const [k, v] of Object.entries(from)) {
    if (k === 'removed' || !v || typeof v !== 'object' || Array.isArray(v) || !(chId in v)) continue;
    if (into[k] === undefined) into[k] = {};
    if (into[k] && typeof into[k] === 'object' && !(chId in into[k])) into[k][chId] = v[chId];
  }
}

// True when `a` holds a word (or more of one) that `b` doesn't
function wordsBeyond(a, b) {
  const bag = (html) => {
    const m = new Map();
    for (const w of String(html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').split(/\s+/)) if (w) m.set(w, (m.get(w) || 0) + 1);
    return m;
  };
  const there = bag(b);
  for (const [w, n] of bag(a)) if (n > (there.get(w) || 0)) return true;
  return false;
}

let refreshing = false;
async function refreshFromDisk() {
  if (refreshing || shelfExport) return;
  refreshing = true;
  diskWordsAt = Date.now();
  bookMetaCache.clear(); // whatever another device wrote, the next redraw reads
  try {
    if (!book) {
      if (library && !$('#bookshelf-view').hidden) {
        const gen = libraryGeneration;
        const lib = applyDeviceLook(await window.neo.readLibrary());
        // a change made here while that read was out (a new shelf, a rename)
        // is newer than what came back: taking it would undo the change,
        // and the next save would make that stick. Look again next time.
        if (gen !== libraryGeneration || libraryWritesPending) return;
        if (lib && lib.firstRunDone && JSON.stringify(lib) !== JSON.stringify(library)) {
          library = lib;
          // proof, and the timestamp services, as another computer left them
          if (window.neo.proofSet) window.neo.proofSet(proofFlags()).catch(() => {});
          if (window.neo.recState) window.neo.recState();
          // answered there: the question here goes
          if (library.historyAsked === true && $('#history-ask')) $('#history-ask').remove();
          const shelf = $('#bookshelf-view');
          const keep = shelf.scrollTop;
          await renderShelves();
          shelf.scrollTop = keep;
        }
      }
      return;
    }
    const bookId = book.id;
    if (window.neo.refreshBook) await window.neo.refreshBook(bookId);
    const meta = await window.neo.readBookMeta(bookId);
    if (!book || book.id !== bookId || !meta) return;

    // First read everything that changed; the page is left alone until it is
    // all in. (Deciding chapter by chapter between reads let a keystroke land
    // on a page that no longer matched what NEO held, and reopening the book
    // for a new book.json dropped whatever was typed while it loaded.)
    const theirs = metaSig(meta) !== savedMetaSig && Array.isArray(meta.chapterOrder);
    const sigHere = metaSig(book);
    const mine = sigHere !== savedMetaSig; // restructured here too, not saved yet
    const incoming = {}; // chapters new to this device
    if (theirs) {
      for (const chId of meta.chapterOrder) {
        if (chapterHTML[chId] !== undefined) continue;
        incoming[chId] = await window.neo.readChapter(bookId, chId);
        if (!book || book.id !== bookId) return;
      }
    }
    // file times first, so only chapters that changed on disk are re-read
    // (a whole novel crossing the bridge every half minute is a hiccup)
    let stamps = null;
    if (window.neo.chapterStamps) {
      try { stamps = await window.neo.chapterStamps(bookId); } catch { stamps = null; }
    }
    const fresh = [];
    for (const chId of [...book.chapterOrder]) {
      if (writing[chId]) continue; // a save of ours is on its way: the file is ours, not news
      const st = stamps ? stamps[chId] : undefined;
      if (st !== undefined && st === diskStamps[chId]) continue;
      const before = savedHTML[chId];
      const disk = await window.neo.readChapter(bookId, chId);
      if (!book || book.id !== bookId) return;
      fresh.push({ chId, st, before, disk });
    }
    if (!book || book.id !== bookId) return;
    // Comments and Darlings are looked at every time, on their own: another
    // device can change them without touching book.json
    const sides = {};
    for (const name of ['stickies', 'darlings']) {
      const key = bookId + '/' + name;
      if (sidecarPending[key] || (name === 'stickies' && saveTimers.stickies)) continue; // ours is on its way
      const remote = await window.neo.readJSON(bookId, name, null);
      if (!book || book.id !== bookId) return;
      if (Array.isArray(remote)) sides[name] = remote;
    }

    // Then decide it all in one go: nothing waits from here to the page.
    let restructured = false;
    if (theirs && metaSig(book) === sigHere) {
      // The other device added, renamed or moved chapters, or saved a
      // book.json from before it saw a change made here. Whichever stands,
      // the chapters and loose cards are joined by both files' removals
      // (book.removed): what either took out stays out, and no chapter
      // holding words is dropped. Theirs keeps the chapters here they never
      // knew of (a file, or unsaved words), and ours (when this device
      // restructured too and hasn't saved yet) takes in the chapters they wrote.
      const removed = mergeRemoved(book.removed, meta.removed);
      const j = mine
        ? joinStructure(book, meta, removed, stamps, (chId) => /[^\s]/.test(String(incoming[chId] || '').replace(/<[^>]*>/g, '')))
        : joinStructure(meta, book, removed, stamps, (chId) => chapterHTML[chId] !== savedHTML[chId] || !stamps || chId in stamps);
      const order = j.order;
      const same = order.join('\n') === book.chapterOrder.join('\n') &&
        JSON.stringify(j.cards) === JSON.stringify(book.looseCards || []) &&
        JSON.stringify(removed) === JSON.stringify(book.removed || {});
      if (!mine || !same) {
        for (const chId of order) {
          if (!(chId in incoming)) continue;
          setChapterHTML(chId, incoming[chId], 'disk-new');
          savedHTML[chId] = incoming[chId];
          knowDisk(bookId, chId, incoming[chId]);
        }
        if (mine) {
          for (const chId of order) if (!book.chapterOrder.includes(chId)) carryChapterFields(book, meta, chId);
          book.chapterOrder = order;
          book.looseCards = j.cards;
          book.removed = removed;
        } else {
          const here = book;
          book = { ...meta, chapterOrder: order, looseCards: j.cards, removed, lastPosition: book.lastPosition };
          for (const chId of order) if (!meta.chapterOrder.includes(chId)) carryChapterFields(book, here, chId);
          savedMetaSig = metaSig(meta);
        }
        rec.streams('disk-adopt'); // their titles and outline
        knowCards();
        // kept here against a removal there: its file goes back for them
        for (const chId of j.back) if (order.includes(chId)) persistChapter(chId).catch(() => {});
        if (metaSig(book) !== savedMetaSig) scheduleMetaSave();
        if (!book.chapterOrder.includes(currentChapterId)) currentChapterId = null;
        undoStack = []; // snapshots of the old structure must not replay over the new one
        restructured = true;
      }
    }
    let sideChanged = false;
    for (const name of Object.keys(sides)) {
      const key = bookId + '/' + name;
      if (sidecarPending[key] || (name === 'stickies' && saveTimers.stickies)) continue;
      const remote = sides[name];
      const rj = JSON.stringify(remote);
      const base = sidecarBase[key];
      if (rj === base) continue;
      const local = name === 'stickies' ? stickies : darlings;
      const next = JSON.stringify(local) === base || base === undefined
        ? remote
        : mergeSidecar(JSON.parse(base), local, remote, name === 'darlings');
      sidecarBase[key] = rj;
      if (name === 'stickies') stickies = next; else darlings = next;
      if (JSON.stringify(next) !== rj) writeSidecar(bookId, name, next).catch(() => {});
      sideChanged = true;
    }
    if (sideChanged) {
      rec.streams('disk-adopt'); // their stickies
      renderStickies();
      if (currentTab === 'darlings') renderDarlings();
    }
    let adopted = 0;
    let conflicts = 0;
    const replaced = []; // page text a disk copy would otherwise have taken away
    for (const { chId, st, before, disk } of fresh) {
      if (!book.chapterOrder.includes(chId)) continue;
      // A save of ours crossed this read, so what came back can be older
      // than the page. Taking it put the old text back on the page, and the
      // next save made that stick. Look again next time.
      if (writing[chId] || savedHTML[chId] !== before) continue;
      if (typeof disk !== 'string') continue;
      if (disk === '' && savedHTML[chId]) continue; // unreadable or still downloading: not a change
      if (stamps) diskStamps[chId] = st; // seen; a file not read stays on the list
      if (disk === savedHTML[chId]) continue;
      if (chapterHTML[chId] === savedHTML[chId]) {
        // A copy with nothing new in it, only fewer words, is an older copy
        // coming back (or text cut on the other device): the page's version
        // goes to Darlings instead of nowhere.
        if (onlyDrops(chapterHTML[chId], disk)) {
          const holder = document.createElement('div');
          holder.innerHTML = chapterHTML[chId];
          replaced.push({
            id: 'd-' + Date.now().toString(36) + replaced.length,
            html: chapterHTML[chId],
            text: [...holder.children].map((p) => p.textContent).join('\n\n').slice(0, 2000),
            chapterId: chId,
            chapterLabel: t('Chapter {n}', { n: book.chapterOrder.indexOf(chId) + 1 }),
            date: new Date().toISOString()
          });
        }
        setChapterHTML(chId, disk, 'disk-adopt');
        savedHTML[chId] = disk;
        knowDisk(bookId, chId, disk);
        wordCache[chId] = null;
        adopted++;
      } else {
        savedHTML[chId] = disk; // what's on disk now; our text goes over it on the next save
        knowDisk(bookId, chId, disk);
        const idx = book.chapterOrder.indexOf(chId);
        const twinId = 'ch-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
        book.chapterOrder.splice(idx + 1, 0, twinId);
        book.chapterTitles = book.chapterTitles || {};
        book.chapterTitles[twinId] = twinChapterTitle(book.chapterTitles[chId]);
        setChapterHTML(twinId, disk, 'disk-twin');
        rec.streams('disk-twin');
        persistChapter(twinId, disk);
        persistChapter(chId);
        scheduleMetaSave();
        conflicts++;
      }
    }
    if (restructured || adopted || conflicts) {
      const caret = captureCaret();
      const keepScroll = $('#paper-scroll').scrollTop;
      renderChapters();
      $('#paper-scroll').scrollTop = keepScroll;
      if (caret) restoreCaret(caret);
      if (restructured) {
        const show = (el, text) => { if (el.textContent !== text) el.textContent = text; };
        show($('#tp-title'), isUntitled(book.title) ? '' : book.title);
        showTitleStyle();
        show($('#tp-subtitle'), book.subtitle || '');
        show($('#tp-author'), book.author || t('Anonymous'));
        $$('.tab[data-tab="notes"]')[0].textContent = tabName('notes');
        $$('.tab[data-tab="outline"]')[0].textContent = tabName('outline');
        renderStickies();
        if (currentTab === 'outline') renderOutline();
      }
      updateCounters();
      scheduleNavRefresh();
      if (replaced.length) {
        darlings.unshift(...replaced);
        writeSidecar(bookId, 'darlings', darlings);
      }
      if (currentTab === 'darlings' && (restructured || replaced.length)) renderDarlings();
      if (conflicts) toast(t('This chapter also changed on another device. That version is saved as the chapter after it.'), 8000);
      else if (replaced.length) toast(t('Updated from your other device — the text it replaced is in Darlings'), 8000);
      else toast(t('Updated from your other device'));
    }

    await takeConflictCopies(bookId);

    // The writer moved on to the other device since last touching this one:
    // the caret goes where they left off there. (Its chapter's words may
    // still be crossing over; the spot waits a little for its paragraph.)
    const there = meta.lastPosition;
    const here = book.lastPosition || {};
    if (there && typeof there.at === 'number' && there.at > (here.at || 0) && there.at > lastHereActivity &&
        currentTab === 'manuscript' && !document.querySelector('.modal-backdrop:not([hidden])') &&
        book.chapterOrder.includes(there.chapterId)) {
      const body = document.querySelector(`.chapter[data-id="${there.chapterId}"] .chapter-body`);
      const arrived = body && (typeof there.pIdx !== 'number' || body.querySelectorAll('p').length > there.pIdx);
      if ((arrived || Date.now() - there.at > 120000) && resumePosition(there)) {
        book.lastPosition = { ...there, scroll: $('#paper-scroll').scrollTop };
      }
    }
  } catch (err) {
    console.error(err);
  } finally {
    diskWordsAt = Date.now();
    refreshing = false;
  }
}
window.addEventListener('focus', () => setTimeout(refreshFromDisk, 300));
// and a quiet look every half minute while NEO is on screen, for the writer
// who left both machines open
setInterval(() => { if (document.visibilityState === 'visible') refreshFromDisk(); }, 30000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') setTimeout(refreshFromDisk, 300);
  else if (book) flushAllSaves(); // iOS may end a backgrounded app without warning
});

window.addEventListener('beforeunload', () => { flushAllSaves(); rec.end(); });
// flush whenever focus leaves NEO, and every 20 seconds
window.addEventListener('blur', () => { if (book) flushAllSaves(); });
setInterval(() => { if (book) flushAllSaves('tick'); }, 20000);

async function backToShelf() {
  if (reading) stopReadAloud(false);
  flushAllSaves();
  rec.end();
  tabPlaces = {};
  book = null;
  showWindowTitle();
  snapShown = null;
  snapCache = null;
  sideCardsKey = '';
  if ($('#side-cards')) $('#side-cards').innerHTML = '';
  currentChapterId = null;
  undoStack = [];
  $('#editor-view').hidden = true;
  $('#bookshelf-view').hidden = false;
  applyBright();
  spEditorMode(); // a script's pane, page and title page go
  spReportState();
  renderShelves();
}
$('#back-to-shelf').onclick = backToShelf;

/* ================================================================== */
/*  STRUCTURAL UNDO                                                    */
/*  Typing has the native ⌘Z. This covers the big moves — chapter      */
/*  deletes, replace-all, darlings — with snapshots of the whole       */
/*  structure.                                                         */
/* ================================================================== */

let undoStack = [];

// remember where the caret is — paragraph number plus offset within that
// paragraph, so even a caret in an EMPTY paragraph has an exact address
function captureCaret() {
  try {
    const sel = window.getSelection();
    if (!sel.rangeCount || currentTab !== 'manuscript') return null;
    const r = sel.getRangeAt(0);
    let el = r.startContainer;
    if (el.nodeType === Node.TEXT_NODE) el = el.parentElement;
    const bodyEl = el && el.closest ? el.closest('.chapter-body') : null;
    if (!bodyEl) return null;
    const blk = el.closest('p');
    const ps = [...bodyEl.querySelectorAll('p')];
    let off = 0;
    if (blk) {
      const pre = document.createRange();
      pre.selectNodeContents(blk);
      pre.setEnd(r.startContainer, r.startOffset);
      off = pre.toString().length;
    }
    return {
      chId: bodyEl.closest('.chapter').dataset.id,
      pIdx: blk ? ps.indexOf(blk) : 0, // container-level caret: treat as chapter start
      off,
      scroll: $('#paper-scroll').scrollTop
    };
  } catch { return null; }
}

function restoreCaret(caret) {
  if (!caret) return;
  const bodyEl = document.querySelector(`.chapter[data-id="${caret.chId}"] .chapter-body`);
  if (!bodyEl) return;
  bodyEl.focus({ preventScroll: true });
  const sel = window.getSelection();
  const finish = () => {
    currentChapterId = caret.chId;
    if (typeof caret.scroll === 'number') $('#paper-scroll').scrollTop = caret.scroll;
  };
  const ps = [...bodyEl.querySelectorAll('p')];
  const blk = ps[caret.pIdx] || ps[ps.length - 1];
  if (!blk) { finish(); return; }
  const w = document.createTreeWalker(blk, NodeFilter.SHOW_TEXT);
  let pos = 0, n;
  while ((n = w.nextNode())) {
    if (caret.off <= pos + n.data.length) {
      const r = document.createRange();
      r.setStart(n, caret.off - pos);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
      finish();
      return;
    }
    pos += n.data.length;
  }
  // empty paragraph, or offset past its end
  const r = document.createRange();
  r.selectNodeContents(blk);
  r.collapse(caret.off === 0);
  sel.removeAllRanges();
  sel.addRange(r);
  finish();
}

// Back where the writer left off, on this device or the other one: the caret
// at its letter, a third of the way down the window. A position from an
// older NEO (the scroll alone) gets the scroll.
function resumePosition(pos) {
  if (!book || !pos || !book.chapterOrder.includes(pos.chapterId)) return false;
  const body = document.querySelector(`.chapter[data-id="${pos.chapterId}"] .chapter-body`);
  if (!body) return false;
  const sc = $('#paper-scroll');
  if (typeof pos.pIdx !== 'number' || !body.isContentEditable) {
    currentChapterId = pos.chapterId;
    sc.scrollTop = pos.scroll || 0;
  } else {
    restoreCaret({ chId: pos.chapterId, pIdx: pos.pIdx, off: pos.off || 0 });
    const sel = window.getSelection();
    if (sel.rangeCount) {
      const r = sel.getRangeAt(0).cloneRange();
      let rect = r.getBoundingClientRect();
      if (!rect.height) {
        const node = r.startContainer.nodeType === Node.ELEMENT_NODE ? r.startContainer : r.startContainer.parentElement;
        if (node) rect = node.getBoundingClientRect();
      }
      sc.scrollTop += rect.top - sc.getBoundingClientRect().top - sc.clientHeight / 3;
    }
  }
  highlightNav();
  updateCounters();
  return true;
}

// When this device last did something to the page: a key, or a tap or click
// in the manuscript. A newer spot from the other device moves the caret only
// if it is newer than that (a scroll or a glance doesn't count).
let lastHereActivity = 0;
document.addEventListener('keydown', () => { lastHereActivity = Date.now(); }, true);
document.addEventListener('pointerdown', (e) => {
  if (e.target && e.target.closest && e.target.closest('#chapters')) lastHereActivity = Date.now();
}, true);

// The engine's undo history must never replay against a document NEO has
// rearranged by hand — clear it whenever such a rearrangement happens.
function resetNativeUndo() {
  const caret = captureCaret();
  if (!caret) return;
  const bodyEl = document.querySelector(`.chapter[data-id="${caret.chId}"] .chapter-body`);
  if (!bodyEl) return;
  bodyEl.contentEditable = 'false';
  bodyEl.contentEditable = 'true';
  restoreCaret(caret);
}

// The state right after a structural action, taken just before the first
// edit that follows it (or the next action): undoing the action later puts
// back only what the action changed, never over words typed since.
function sealUndo(snap) {
  if (!snap || snap.after) return;
  snap.after = { chapterHTML: { ...chapterHTML }, darlings: JSON.parse(JSON.stringify(darlings)), stickies: JSON.parse(JSON.stringify(stickies)) };
}
function sealUndoOnEdit() {
  const top = undoStack[undoStack.length - 1];
  if (top && top.armed) sealUndo(top);
}
function snapshotStructure(label, opts) {
  if (!book) return;
  maybeDailySnapshot();
  sealUndo(undoStack[undoStack.length - 1]);
  const snap = {
    armed: false, // the action's own edits, in this same moment, don't seal it
    label,
    rejoin: !!(opts && opts.rejoin),
    outlineFocus: (opts && opts.outlineFocus) || null, // the outline line to return to
    caret: captureCaret(),
    chapterOrder: [...book.chapterOrder],
    chapterKinds: { ...(book.chapterKinds || {}) },
    chapterHTML: { ...chapterHTML },
    chapterTitles: { ...(book.chapterTitles || {}) },
    chapterNotes: { ...(book.chapterNotes || {}) },
    sectionNotes: JSON.parse(JSON.stringify(book.sectionNotes || {})),
    looseCards: JSON.parse(JSON.stringify(book.looseCards || [])),
    sceneNotes: { ...(book.sceneNotes || {}) },
    darlings: JSON.parse(JSON.stringify(darlings)),
    stickies: JSON.parse(JSON.stringify(stickies))
  };
  undoStack.push(snap);
  setTimeout(() => { snap.armed = true; }, 30);
  if (undoStack.length > 10) undoStack.shift();
}

async function structuralUndo() {
  const snap = undoStack.pop();
  if (!snap || !book) return;
  sealUndo(snap); // nothing typed since: the state now is the action's own
  const after = snap.after;
  // Chapter by chapter: one the action changed and nothing touched since
  // goes back; one only typed in since keeps its words; one both changed
  // goes back too, and the words written into it since go to Darlings, so
  // the undo never takes away writing that came after it.
  const restored = { ...snap.chapterHTML };
  const displaced = [];
  for (const chId of new Set([...Object.keys(chapterHTML), ...Object.keys(after.chapterHTML)])) {
    const cur = chapterHTML[chId];
    const was = after.chapterHTML[chId];
    if (cur === undefined || cur === was) continue;
    const textOf = (h) => String(h || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').trim();
    if (snap.chapterHTML[chId] !== undefined && snap.chapterHTML[chId] === was) {
      restored[chId] = cur; // the action left this chapter alone
    } else if (textOf(cur) && wordsBeyond(cur, restored[chId] || '')) {
      displaced.push({ chId, html: cur });
    }
  }
  book.chapterOrder = snap.chapterOrder;
  book.chapterKinds = snap.chapterKinds;
  for (const chId of Object.keys(chapterHTML)) if (!(chId in restored)) dropChapterHTML(chId, 'undo-structural');
  for (const [chId, html] of Object.entries(restored)) setChapterHTML(chId, html, 'undo-structural');
  for (const { chId, html } of displaced) {
    const holder = document.createElement('div');
    holder.innerHTML = html;
    darlings.unshift({
      id: 'd-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      html,
      text: [...holder.children].map((p) => p.textContent).join('\n\n').slice(0, 2000),
      chapterId: chId,
      chapterLabel: book.chapterTitles && book.chapterTitles[chId] ? book.chapterTitles[chId] : t('Chapter {n}', { n: Math.max(1, snap.chapterOrder.indexOf(chId) + 1) }),
      date: new Date().toISOString()
    });
  }
  book.chapterTitles = snap.chapterTitles;
  book.chapterNotes = snap.chapterNotes;
  book.sectionNotes = snap.sectionNotes;
  book.looseCards = snap.looseCards || [];
  book.sceneNotes = snap.sceneNotes || {};
  // lists likewise: what the action changed goes back, anything added or
  // removed since stays that way (the displaced text above included)
  darlings = mergeSidecar(after.darlings, snap.darlings, darlings, true);
  stickies = mergeSidecar(after.stickies, snap.stickies, stickies, false);
  rec.streams('undo-structural');
  // resurrect any chapter files the action may have deleted
  for (const chId of book.chapterOrder) {
    if (chapterHTML[chId] === undefined) setChapterHTML(chId, '<p><br></p>', 'undo-structural');
    await persistChapter(chId, chapterHTML[chId] || '<p><br></p>');
  }
  // (a list that can't be written now stays queued, and is tried again)
  await writeSidecar(book.id, 'darlings', darlings).catch(() => {});
  await writeStickies(book.id, stickies, 'undo-structural').catch(() => {});
  await saveMeta();
  currentChapterId = book.chapterOrder.includes(currentChapterId) ? currentChapterId : null;
  renderChapters();
  renderStickies();
  if (currentTab === 'darlings') renderDarlings();
  if (currentTab === 'outline') { renderOutline(snap.outlineFocus || undefined); sidePaneForTab('outline'); }
  updateCounters();
  restoreCaret(snap.caret); // back to work, no announcement
  if (snap.rejoin) rejoinAtCaret();
  resetNativeUndo();
}

// after undoing a double-Enter break, close the split the gesture made:
// the caret's paragraph flows back into the one above it
function rejoinAtCaret() {
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  let el = sel.anchorNode;
  if (el && el.nodeType === Node.TEXT_NODE) el = el.parentElement;
  const blk = el && el.closest ? el.closest('p') : null;
  const body = blk && blk.closest('.chapter-body');
  if (!blk || !body) return;
  const prev = blk.previousElementSibling;
  if (!prev || prev.tagName !== 'P') return;
  if (prev.classList.contains('scene-break') || blk.classList.contains('scene-break')) return;
  if (prev.classList.contains('poetry') !== blk.classList.contains('poetry')) return;
  if (prev.classList.contains('flush') !== blk.classList.contains('flush')) return;
  const chId = body.closest('.chapter').dataset.id;
  const at = prev.textContent.length;
  if (blk.textContent.trim() === '') {
    blk.remove();
  } else {
    for (const junk of blk.querySelectorAll('br')) junk.remove();
    for (const junk of prev.querySelectorAll('br')) junk.remove(); // an empty line's placeholder must not survive the merge
    while (blk.firstChild) prev.appendChild(blk.firstChild);
    blk.remove();
    try { prev.normalize(); } catch { /* fine */ }
  }
  // caret lands at the healed seam
  const w = document.createTreeWalker(prev, NodeFilter.SHOW_TEXT);
  let pos = 0, n, placed = false;
  while ((n = w.nextNode())) {
    if (at <= pos + n.data.length) {
      const r = document.createRange();
      r.setStart(n, at - pos);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
      placed = true;
      break;
    }
    pos += n.data.length;
  }
  if (!placed) {
    const r = document.createRange();
    r.selectNodeContents(prev);
    r.collapse(false);
    sel.removeAllRanges();
    sel.addRange(r);
  }
  syncChapter(body, chId, 'undo-structural');
}

document.addEventListener('keydown', (e) => {
  if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.key.toLowerCase() !== 'z') return;
  if ($('#editor-view').hidden || !book || !undoStack.length) return;
  const ae = document.activeElement;
  // inside text, ⌘Z belongs to typing; outside it, it belongs to structure
  if (ae && (ae.isContentEditable || ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return;
  e.preventDefault();
  structuralUndo();
});

/* ================================================================== */
/*  READ ALOUD — ⌘⇧U (Ctrl+Shift+U)                                    */
/*  The computer's own voice reads from the caret, a sentence at a      */
/*  time, each one lit as it's read, on into the chapters after. ⌘⇧U   */
/*  again, Esc or a keystroke stops it, and the caret is left at the    */
/*  sentence it reached, so ⌘⇧U carries on from there. No keys, no      */
/*  cloud: the voices that come with macOS and Windows.                 */
/* ================================================================== */

let reading = null; // { item, gen } while the voice is going
let readGen = 0;

function readVoice() {
  const voices = window.speechSynthesis.getVoices();
  const lang = writingLanguage().toLowerCase();
  const base = lang.split('-')[0];
  const by = (f) => voices.find(f);
  return by((v) => v.lang.toLowerCase().replace('_', '-') === lang && v.default) ||
    by((v) => v.lang.toLowerCase().replace('_', '-') === lang) ||
    by((v) => v.lang.toLowerCase().startsWith(base) && v.localService) ||
    by((v) => v.lang.toLowerCase().startsWith(base)) ||
    by((v) => v.default) || voices[0] || null;
}
async function readVoicesReady() {
  if (window.speechSynthesis.getVoices().length) return true;
  await new Promise((resolve) => {
    const done = () => resolve();
    window.speechSynthesis.addEventListener('voiceschanged', done, { once: true });
    setTimeout(done, 1500);
  });
  return window.speechSynthesis.getVoices().length > 0;
}

// The paragraphs to read, from one, in order: the rest of its editor, then
// (in the manuscript) the chapters after it
function readParasFrom(p) {
  const out = [];
  const editor = p.closest('.chapter-body, #aux-editor');
  const ok = (q) => q.tagName === 'P' && !q.classList.contains('scene-break') && !q.classList.contains('ghost');
  const take = (root, from) => {
    let on = !from;
    for (const q of root.querySelectorAll('p')) {
      if (q === from) on = true;
      if (on && ok(q)) out.push(q);
    }
  };
  take(editor, p);
  if (editor.matches('.chapter-body')) {
    const bodies = [...document.querySelectorAll('#chapters .chapter-body')];
    for (const b of bodies.slice(bodies.indexOf(editor) + 1)) take(b, null);
  }
  return out;
}
// a paragraph's sentences, as character spans of its text, from an offset
function readSentences(p, from) {
  const text = p.textContent;
  const spans = [];
  if (window.Intl && Intl.Segmenter) {
    const seg = new Intl.Segmenter(writingLanguage(), { granularity: 'sentence' });
    for (const s of seg.segment(text)) spans.push([s.index, s.index + s.segment.length]);
  } else spans.push([0, text.length]);
  return spans
    .map(([a, b]) => [Math.max(a, from), b])
    .filter(([a, b]) => b > a && text.slice(a, b).trim());
}
function readRange(p, a, b) {
  const s = pointAt(p, a), e = pointAt(p, b);
  if (!s || !e) return null;
  const r = document.createRange();
  r.setStart(s.node, s.offset);
  r.setEnd(e.node, e.offset);
  return r;
}

async function toggleReadAloud() {
  if (reading) { stopReadAloud(true); return; }
  if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) { toast(t('Read aloud needs a voice on this computer')); return; }
  const sel = window.getSelection();
  let el = sel.rangeCount ? sel.anchorNode : null;
  if (el && el.nodeType === Node.TEXT_NODE) el = el.parentElement;
  let p = el && el.closest ? el.closest('.chapter-body p, #aux-editor p') : null;
  let from = 0;
  if (p) {
    const pre = document.createRange();
    pre.selectNodeContents(p);
    pre.setEnd(sel.anchorNode, sel.anchorOffset);
    from = pre.toString().length;
  } else {
    // no caret in the text: from the top of the chapter on screen
    const body = currentTab === 'manuscript'
      ? document.querySelector(`.chapter[data-id="${currentChapterId || (book && book.chapterOrder[0])}"] .chapter-body`)
      : $('#aux-editor');
    p = body && body.querySelector('p');
  }
  if (!p) return;
  if (!(await readVoicesReady())) { toast(t('Read aloud needs a voice on this computer')); return; }
  const paras = readParasFrom(p);
  // start at the beginning of the sentence the caret is in
  const first = readSentences(p, 0).find(([a, b]) => from >= a && from < b);
  if (first) from = first[0];
  const gen = ++readGen;
  reading = { gen, item: null };
  const queue = function* () {
    for (const [n, q] of paras.entries()) {
      for (const [a, b] of readSentences(q, n === 0 && q === p ? from : 0)) yield { p: q, a, b };
    }
  }();
  const voice = readVoice();
  const next = () => {
    if (!reading || reading.gen !== gen) return;
    const { value: item, done } = queue.next();
    if (done || !item.p.isConnected) { stopReadAloud(false); return; }
    reading.item = item;
    const u = new SpeechSynthesisUtterance(item.p.textContent.slice(item.a, item.b).trim());
    if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = writingLanguage();
    u.onstart = () => {
      if (!reading || reading.gen !== gen) return;
      const r = readRange(item.p, item.a, item.b);
      if (!r || !window.Highlight || !CSS.highlights) return;
      CSS.highlights.set('neo-speak', new Highlight(r));
      // keep the sentence on screen
      const sc = $('#paper-scroll');
      const box = r.getBoundingClientRect();
      const view = sc.getBoundingClientRect();
      if (box.top < view.top + 40 || box.bottom > view.bottom - 60) {
        sc.scrollTop += box.top - view.top - view.height / 3;
      }
    };
    u.onend = () => next();
    u.onerror = (ev) => { if (ev.error !== 'interrupted' && ev.error !== 'canceled') stopReadAloud(false); };
    window.speechSynthesis.speak(u);
  };
  window.speechSynthesis.cancel();
  next();
}
// leaveCaret: the writer stopped it, so the caret goes to the sentence reached
function stopReadAloud(leaveCaret) {
  const was = reading;
  reading = null;
  readGen++;
  try { window.speechSynthesis.cancel(); } catch { /* nothing speaking */ }
  if (window.CSS && CSS.highlights) CSS.highlights.delete('neo-speak');
  if (leaveCaret && was && was.item && was.item.p.isConnected) {
    const ed = was.item.p.closest('.chapter-body, #aux-editor');
    const pt = pointAt(was.item.p, was.item.a);
    if (ed && pt) {
      ed.focus({ preventScroll: true });
      const s = window.getSelection();
      s.removeAllRanges();
      const r = document.createRange();
      r.setStart(pt.node, pt.offset);
      r.collapse(true);
      s.addRange(r);
    }
  }
}
document.addEventListener('keydown', (e) => {
  const cmd = e.metaKey || e.ctrlKey;
  // on Linux, Ctrl+Shift+U belongs to the input method (it types a Unicode
  // character by its code), so Read Aloud there is Ctrl+Shift+K (#287)
  if (cmd && e.shiftKey && !e.altKey && e.code === (IS_LINUX ? 'KeyK' : 'KeyU')) {
    if (!book || $('#editor-view').hidden) return;
    e.preventDefault();
    e.stopPropagation();
    toggleReadAloud();
    return;
  }
  if (!reading || MODIFIER_KEYS.has(e.key)) return;
  // Esc stops the voice and nothing else; any other key stops it and goes on
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); }
  stopReadAloud(e.key === 'Escape');
}, true);

/* ================================================================== */
/*  FIND & REPLACE                                                     */
/* ================================================================== */

let searchState = { matches: [], idx: -1, query: '' };
// where the caret was on the page when Find opened, and whether vim's / opened
// it: Esc in the find bar goes back there (see returnFromSearch)
let searchHome = null;
let searchFromVim = false;

// the editable a range sits in: a chapter, the Notes, an outline line
function editableOf(range) {
  const n = range && (range.startContainer.nodeType === Node.TEXT_NODE ? range.startContainer.parentElement : range.startContainer);
  return (n && n.closest && n.closest('[contenteditable="true"]')) || null;
}

function openSearch(fromVim = false) {
  if ($('#editor-view').hidden || !book) { toast(t('Open a book first')); return; }
  const sel = window.getSelection();
  const preset = sel && !sel.isCollapsed ? sel.toString().slice(0, 80).trim() : '';
  // ⌘F again from the bar itself keeps the place it first came from
  if (sel && sel.rangeCount && editableOf(sel.getRangeAt(0))) searchHome = sel.getRangeAt(0).cloneRange();
  searchFromVim = fromVim;
  $('#searchbar').hidden = false;
  const inp = $('#search-input');
  if (preset) inp.value = preset;
  inp.focus();
  inp.select();
  runSearch();
}

function closeSearch() {
  $('#searchbar').hidden = true;
  searchState = { matches: [], idx: -1, query: '' };
  searchFromVim = false;
  if (window.CSS && CSS.highlights) {
    CSS.highlights.delete('neo-search');
    CSS.highlights.delete('neo-search-current');
  }
}

// Esc in the find bar. Hiding the bar took the caret with it, so the writer
// was nowhere, and the next Esc closed the book. Now the caret goes back to
// the page: to the match last gone to, or else where it was before Find.
// A search vim's / began goes back to moving, as in vim.
function returnFromSearch() {
  const m = searchState.idx >= 0 && searchState.matches[searchState.idx];
  let r = null;
  if (m && m.range.startContainer.isConnected) { r = m.range.cloneRange(); r.collapse(true); }
  else if (searchHome && searchHome.startContainer.isConnected) r = searchHome.cloneRange();
  const fromVim = searchFromVim;
  closeSearch();
  const ed = editableOf(r);
  if (!ed) return;
  ed.focus({ preventScroll: true });
  const s = window.getSelection();
  s.removeAllRanges();
  s.addRange(r);
  revealCaret();
  if (fromVim && vimEnabled && vimEditor(ed)) vimSetNav(true);
}

function paintHighlights() {
  if (!window.Highlight || !window.CSS || !CSS.highlights) return;
  const all = new Highlight();
  const cur = new Highlight();
  searchState.matches.forEach((m, i) => {
    (i === searchState.idx ? cur : all).add(m.range);
  });
  CSS.highlights.set('neo-search', all);
  CSS.highlights.set('neo-search-current', cur);
}

// Find searches the tab you're in: the whole manuscript, first chapter to
// last, or the Notes page, the outline's lines, the Darlings. Replace stays
// with the manuscript, where ⌘Z can take a Replace All back.
function searchRoots() {
  if (currentTab === 'manuscript') return book.chapterOrder.map((chId) => document.querySelector(`.chapter[data-id="${chId}"] .chapter-body`));
  if (currentTab === 'outline') return boardShowing() ? $$('#outline-board .ob-text, #loose-list .ob-text') : $$('#outline-list .ol-text');
  if (currentTab === 'darlings') return $$('#darlings-list .darling > :first-child');
  return [$('#aux-editor')];
}

// every place q appears in the tab, in reading order, any case
function findRanges(q) {
  const found = [];
  if (!q) return found;
  const ql = q.toLowerCase();
  for (const body of searchRoots()) {
    if (!body) continue;
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const tl = node.textContent.toLowerCase();
      let pos = 0;
      while ((pos = tl.indexOf(ql, pos)) !== -1) {
        const range = document.createRange();
        range.setStart(node, pos);
        range.setEnd(node, pos + q.length);
        found.push(range);
        pos += q.length;
      }
    }
  }
  return found;
}

// Scan the whole tab every time. Matches are highlighted, not selected.
function runSearch() {
  const q = $('#search-input').value;
  searchState = { matches: [], idx: -1, query: q, tab: currentTab };
  $('#searchbar').classList.toggle('find-only', currentTab !== 'manuscript');
  if (!q) {
    $('#search-count').textContent = '';
    paintHighlights();
    return;
  }
  searchState.matches = findRanges(q).map((range) => ({ range }));
  const n = searchState.matches.length;
  $('#search-count').textContent = n ? t('{n} found', { n }) : t('none');
  paintHighlights();
}

// only runs when the user asks (Enter / arrows)
function gotoMatch(i) {
  const m = searchState.matches;
  if (!m.length) return;
  searchState.idx = ((i % m.length) + m.length) % m.length;
  paintHighlights();
  try {
    const rect = m[searchState.idx].range.getBoundingClientRect();
    $('#paper-scroll').scrollTop += rect.top - window.innerHeight * 0.45;
  } catch { /* range collapsed by an edit; next search rebuilds */ }
  $('#search-count').textContent = t('{i} of {n}', { i: searchState.idx + 1, n: m.length });
}

function freshSearchIfStale() {
  if (searchState.query !== $('#search-input').value || searchState.tab !== currentTab) runSearch();
}

function replaceCurrent() {
  if (currentTab !== 'manuscript') return;
  freshSearchIfStale();
  if (!searchState.matches.length) { toast(t('No matches')); return; }
  if (searchState.idx < 0) searchState.idx = 0; // start from the very first match
  const m = searchState.matches[searchState.idx];
  const rep = $('#replace-input').value;
  // the match may have been edited away by hand since it was found: look
  // again rather than put the replacement where it no longer is
  if (m.range.toString().toLowerCase() !== String(searchState.query || '').toLowerCase()) { runSearch(); return; }
  let chapter = null;
  try {
    chapter = m.range.startContainer.parentElement.closest('.chapter');
    snapshotStructure('replace');
    breakRun++; // the engine never saw this change: ⌘Z goes to NEO's undo
    m.range.deleteContents();
    if (rep) m.range.insertNode(document.createTextNode(rep));
  } catch {
    runSearch();
    return;
  }
  if (chapter) syncChapter(chapter.querySelector('.chapter-body'), chapter.dataset.id, 'replace');
  const oldIdx = searchState.idx;
  runSearch();
  if (searchState.matches.length) gotoMatch(Math.min(oldIdx, searchState.matches.length - 1));
}

// Every chapter, front to back
function replaceAllMatches() {
  const q = $('#search-input').value;
  if (!q || currentTab !== 'manuscript') return;
  snapshotStructure('replace all');
  const rep = $('#replace-input').value;
  const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  let n = 0;
  for (const chId of book.chapterOrder) {
    const body = document.querySelector(`.chapter[data-id="${chId}"] .chapter-body`);
    if (!body) continue;
    const nodes = [];
    const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) nodes.push(node);
    let touched = false;
    for (const nd of nodes) {
      if (nd.textContent.toLowerCase().includes(q.toLowerCase())) {
        nd.textContent = nd.textContent.replace(re, () => { n++; return rep; });
        touched = true;
      }
    }
    if (touched) syncChapter(body, chId, 'replace-all');
  }
  if (n === 0) undoStack.pop(); // nothing changed, nothing to undo
  else breakRun++; // ⌘Z from inside the text reaches this undo too
  toast(n ? t('{n} replaced across the whole book — {key} to undo', { n, key: KZ }) : t('0 replaced'));
  runSearch();
}

$('#search-input').addEventListener('input', () => {
  clearTimeout(saveTimers.search);
  saveTimers.search = setTimeout(runSearch, 250);
});
$('#search-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); freshSearchIfStale(); gotoMatch(searchState.idx + (e.shiftKey ? -1 : 1)); }
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); returnFromSearch(); }
  if (e.key === 'Tab' && !e.shiftKey) {
    const m = searchState.matches[Math.max(0, searchState.idx)];
    if (m) {
      e.preventDefault();
      const sel = window.getSelection();
      const r = m.range.cloneRange();
      r.collapse(false);
      sel.removeAllRanges();
      sel.addRange(r);
      const body = m.range.startContainer.parentElement.closest('[contenteditable="true"]');
      if (body) body.focus();
    }
  }
});
$('#replace-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); replaceCurrent(); }
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); returnFromSearch(); }
});
$('#search-next').onclick = () => { freshSearchIfStale(); gotoMatch(searchState.idx + 1); };
$('#search-prev').onclick = () => { freshSearchIfStale(); gotoMatch(searchState.idx - 1); };
$('#replace-one').onclick = replaceCurrent;
$('#replace-all').onclick = replaceAllMatches;
$('#search-close').onclick = closeSearch;

/* ================================================================== */
/*  IMPORT                                                             */
/* ================================================================== */

const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Turn parsed manuscripts into books on a shelf — used by the file picker
// and by dropping files from Finder straight onto a shelf.
async function addImportedBooks(results, shelf) {
  shelf = shelf || shelvesFor(currentAuthor().id)[0] || library.shelves[0];
  let ok = 0;
  let scripts = 0;
  for (const r of results) {
    if (r.error) { toast(t('Couldn’t import {name}: {error}', { name: r.name, error: r.error }), 6000); continue; }
    if (r.script) {
      if (await importScript(r, shelf)) scripts++;
      else toast(t('Couldn’t import {name}: {error}', { name: r.name, error: t('no script in it') }), 6000);
      continue;
    }
    // title/byline harvested from the document beat the filename;
    // passing the title in gives the book folder a readable name too
    const meta = await window.neo.createBook({
      author: r.author || displayAuthor(),
      title: r.title || r.name
    });
    meta.title = r.title || r.name;
    meta.tabNames = {
      notes: (library.tabDefaults && library.tabDefaults.notes) || 'Notes',
      outline: (library.tabDefaults && library.tabDefaults.outline) || 'Outline'
    };
    let words = 0;
    meta.chapterTitles = {};
    for (const ch of r.chapters) {
      const chId = 'ch-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
      const html = ch.paras.map((p) => {
        if (p.scene) return '<p class="scene-break">***</p>';
        // hyphens set as dialogue dashes, the same as typing them
        return `<p>${importedEmphasis(escHtml(dialogueDashes(p.text || '', dashStyle())))}</p>`;
      }).join('') || '<p><br></p>';
      await window.neo.writeChapter(meta.id, chId, html);
      if (ch.title) meta.chapterTitles[chId] = ch.title;
      if (ch.role) meta[ch.role] = chId;
      meta.chapterOrder.push(chId);
      for (const p of ch.paras) words += countWords(p.text || '');
    }
    meta.wordCount = words;
    await writeBookMeta(meta.id, meta);
    await placeTitle(shelf, meta.id);
    ok++;
  }
  await writeLibrary(library);
  if (!$('#bookshelf-view').hidden) renderShelves();
  if (ok) toast(t('{n} books imported onto “{shelf}” — chapters and scene breaks detected', { n: ok, shelf: shelf.name }), 6000);
  else if (scripts) toast(t('{n} scripts imported onto “{shelf}”', { n: scripts, shelf: shelf.name }), 6000);
}

// **bold**, *italic* and _italic_ from an imported file, the way Markdown
// reads them: the markers hug a word (so "5 * 3 * 2" stays arithmetic) and
// an underscore inside a word ("file_name") is a letter. A backslash keeps
// the next * _ or \ as itself (a Word file's own asterisks arrive that way).
function importedEmphasis(text) {
  const kept = [];
  text = text.replace(/\\([\\*_])/g, (m, c) => { kept.push(c); return '\uE000' + (kept.length - 1) + '\uE001'; });
  text = text.replace(/\*\*(?=\S)([^*]*?\S)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*\p{L}\p{N}])\*(?=[^\s*])([^*]*?[^\s*])?\*(?![*\p{L}\p{N}])/gu, (m, pre, inner) => inner === undefined ? m : `${pre}<i>${inner}</i>`)
    .replace(/(^|[^\p{L}\p{N}_])_(?=\S)([^_]*?\S)_(?![\p{L}\p{N}_])/gu, '$1<i>$2</i>');
  return text.replace(/\uE000(\d+)\uE001/g, (m, i) => kept[+i]);
}

async function importBooks() {
  const results = await window.neo.importPick();
  if (results.length) await addImportedBooks(results, shelvesFor(currentAuthor().id)[0] || library.shelves[0]);
}

$('#import-btn').onclick = importBooks;

/* ================================================================== */
/*  SPELLCHECK PASS + TYPEWRITER SCROLLING                             */
/* ================================================================== */

/* NEO's own spellcheck pass: a bundled dictionary (via the main process),
   squiggles painted with the CSS Highlight API — the same machinery as
   search — and a right-click menu for suggestions. Chapters scan lazily
   as the caret reaches them. */
let spellOn = false;
let spellScanned = new Set();
let spellRanges = new Map();     // key → [Range]
const spellCache = new Map();    // word → correct?

const spellNorm = (w) => w.replace(/’/g, "'").replace(/^'+|'+$/g, '');

function spellElFor(key) {
  return key.startsWith('aux-')
    ? $('#aux-editor')
    : document.querySelector(`.chapter[data-id="${key}"] .chapter-body`);
}

async function spellScanEl(el, key) {
  if (!el || !spellOn) return;
  spellScanned.add(key);
  const occurrences = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  // letters of any alphabet, with their accents, so French and German
  // words reach the dictionary whole — hyphenated ones too (e-mail,
  // well-known, fazê-lo, dir-se-ia): the dictionary judges the whole word,
  // and only when it says no are the pieces underlined one by one
  const re = /[\p{L}\p{M}'’]+(?:-[\p{L}\p{M}'’]+)*/gu;
  const piece = /[\p{L}\p{M}'’]+/gu;
  const legal = (raw) => /^[\p{Lu}'’]+$/u.test(raw); // acronyms and shouting are legal
  // a stammer (E-eu, N-não, Wh-what): each short piece starts the next, and
  // only the word it lands on is judged
  const bare = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const stammers = (bits) => bits.length > 1 && bits.slice(0, -1).every((s, i) => s.length <= 3 && bare(bits[i + 1]).startsWith(bare(s)));
  let n;
  while ((n = walker.nextNode())) {
    const p = n.parentElement;
    if (p && p.closest('.scene-break, .ghost, .ph-mark')) continue;
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(n.data))) {
      const stammer = stammers(m[0].split('-'));
      const parts = [];
      piece.lastIndex = 0;
      let q;
      while ((q = piece.exec(m[0]))) {
        const word = spellNorm(q[0]);
        if (word.length < 2 || legal(q[0])) continue;
        if (stammer && q.index + q[0].length < m[0].length) continue;
        parts.push({ start: m.index + q.index, end: m.index + q.index + q[0].length, word });
      }
      if (!parts.length) continue;
      const whole = m[0].includes('-') && !stammer && !legal(m[0].replace(/-/g, '')) ? spellNorm(m[0]) : null;
      occurrences.push({ node: n, start: m.index, end: m.index + m[0].length, whole, parts });
    }
  }
  const words = new Set();
  for (const o of occurrences) {
    if (o.whole) words.add(o.whole);
    for (const pt of o.parts) words.add(pt.word);
  }
  const unknown = [...words].filter((w) => !spellCache.has(w));
  if (unknown.length) {
    const res = await window.neo.spellCheckWords(unknown);
    for (const w of unknown) spellCache.set(w, res[w] !== false);
  }
  if (!spellOn) return; // toggled off while we were checking
  const ranges = [];
  const mark = (node, start, end) => {
    try {
      const r = new Range();
      r.setStart(node, start);
      r.setEnd(node, end);
      ranges.push(r);
    } catch { /* node changed underneath us */ }
  };
  for (const o of occurrences) {
    if (!o.node.isConnected) continue;
    if (o.whole && spellCache.get(o.whole)) continue;
    const wrong = o.parts.filter((pt) => !spellCache.get(pt.word));
    if (wrong.length) for (const pt of wrong) mark(o.node, pt.start, pt.end);
    else if (o.whole) mark(o.node, o.start, o.end); // every piece fine, the whole not
  }
  const caps = capitalSlips(el);
  for (const r of caps) ranges.push(r);
  capsRanges.set(key, caps);
  spellRanges.set(key, ranges);
  rebuildSpellHighlight();
}

// Capitals the dictionary can't see, since it takes any word in lowercase:
// a sentence that starts small, and, in English, "i" for "I". Underlined
// like a misspelling; right-click offers the capital. Manuscript prose only
// (notes are the writer's scratch paper, and poetry sets its own case).
// Mid-paragraph, only a full stop ends a sentence: "Oh! how lovely",
// "— Quanto falta? — perguntou ele" and "…and then" are the writer's.
const capsRanges = new Map(); // key → [Range]
const CAPS_ABBREV = new Set(['mr', 'mrs', 'ms', 'dr', 'st', 'jr', 'sr', 'vs', 'etc', 'e.g', 'i.e', 'cf', 'approx', 'no', 'vol', 'pp', 'p', 'fig', 'ca', 'mt', 'ft', 'lt', 'sgt', 'capt', 'col', 'gen', 'prof', 'rev', 'hon', 'inc', 'ltd', 'co', 'ave', 'a.m', 'p.m', 'sra', 'sr', 'srta', 'dra', 'av', 'ex', 'z.b', 'bzw', 'ggf', 'usw', 'm', 'mme', 'mlle']);
function capitalSlips(el) {
  const out = [];
  if (typeof el.matches !== 'function' || !el.matches('.chapter-body')) return out;
  const english = /^en\b/.test(writingLanguage());
  for (const p of el.querySelectorAll('p:not(.poetry):not(.scene-break)')) {
    // the paragraph's text, and which node holds each stretch of it
    const segs = [];
    let text = '';
    const w = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      if (n.parentElement && n.parentElement.closest('.ghost, .ph-mark')) continue;
      segs.push({ node: n, at: text.length });
      text += n.data;
    }
    if (!text.trim()) continue;
    const seen = new Set();
    const mark = (i) => {
      if (seen.has(i)) return;
      seen.add(i);
      let s = segs[0];
      for (const g of segs) if (g.at <= i) s = g; else break;
      try {
        const r = new Range();
        r.setStart(s.node, i - s.at);
        r.setEnd(s.node, i - s.at + 1);
        out.push(r);
      } catch { /* changed underneath us */ }
    };
    // the paragraph's first letter, past opening quotes, brackets and dashes
    const lead = text.match(/^[\s"'“‘„«»(\[¿¡—–-]*/)[0].length;
    if (/\p{Ll}/u.test(text[lead] || '') && !/^\p{Ll}\./u.test(text.slice(lead, lead + 2))) mark(lead);
    // a letter after a full stop (not an ellipsis or an abbreviation)
    const stop = /(?<!\.)\.\s+["'“‘„«(\[]?(\p{Ll})/gu;
    let m;
    while ((m = stop.exec(text))) {
      const before = text.slice(0, m.index).match(/([\p{L}.]+)$/u);
      const word = before ? before[1].toLowerCase() : '';
      if (CAPS_ABBREV.has(word) || /^\p{L}$/u.test(word)) continue; // Mr. smith, J. r. r.
      mark(m.index + m[0].length - 1);
    }
    // English "i", "i'm", "i'd" … standing alone (not "i.e." or "(i)")
    if (english) {
      const eye = /(?<![\p{L}\p{M}\d'’.(-])i(?![\p{L}\p{M}\d.)-])(?!['’](?![mdv]|ll|re))/gu;
      while ((m = eye.exec(text))) mark(m.index);
    }
  }
  return out;
}

function rebuildSpellHighlight() {
  if (!spellOn) return;
  const hl = new Highlight();
  for (const list of spellRanges.values()) for (const r of list) hl.add(r);
  CSS.highlights.set('neo-spell', hl);
}

function scanSpellingIn(el, key) {
  if (!el || spellScanned.has(key)) return;
  spellScanEl(el, key);
}

// scan wherever the writer currently is
function scanSpellingHere() {
  if (currentTab === 'manuscript') {
    const body = currentChapterId && spellElFor(currentChapterId);
    if (body) scanSpellingIn(body, currentChapterId);
  } else {
    scanSpellingIn($('#aux-editor'), 'aux-' + ($('#aux-editor').dataset.kind || 'notes'));
  }
}

function scheduleSpellRescan(key, el) {
  clearTimeout(saveTimers['sp-' + key]);
  saveTimers['sp-' + key] = setTimeout(() => { if (spellOn) spellScanEl(el, key); }, 600);
}

function toggleSpellcheck() {
  spellOn = !spellOn;
  if (spellOn) {
    spellScanned = new Set();
    spellRanges = new Map();
    capsRanges.clear();
    scanSpellingHere();
  } else {
    CSS.highlights.delete('neo-spell');
    spellRanges = new Map();
    capsRanges.clear();
    document.querySelector('.spell-menu')?.remove();
  }
  toast(spellOn ? t('Spellcheck on') : t('Spellcheck off'));
}

// Edit → Spellcheck Language: swap the dictionary, remember the choice with
// the library, and re-check whatever is on screen
const SPELL_LANGUAGE_NAMES = {
  'en-US': t('US English'), 'en-GB': t('UK English'), 'en-CA': t('Canadian English'),
  'en-AU': t('Australian English'), fr: t('French'), es: t('Spanish'), de: t('German'),
  nl: t('Dutch'), pl: t('Polish'), 'pt-BR': t('Brazilian Portuguese'), ro: t('Romanian'), ru: t('Russian'), hu: t('Hungarian'), sv: t('Swedish')
};
async function changeSpellLanguage(code) {
  const ok = await window.neo.setSpellLanguage(code);
  if (!ok) { toast(t('That dictionary would not load')); return; }
  library.spellLanguage = code;
  await writeLibrary(library);
  spellCache.clear();
  if (spellOn) {
    spellScanned = new Set();
    spellRanges = new Map();
    capsRanges.clear();
    CSS.highlights.delete('neo-spell');
    scanSpellingHere();
  }
  toast(t('Spellcheck: {lang}', { lang: SPELL_LANGUAGE_NAMES[code] || code }));
}

// right-click a flagged word for suggestions
document.addEventListener('contextmenu', async (e) => {
  if (!spellOn) return;
  const editor = e.target.closest && e.target.closest('.chapter-body, #aux-editor');
  if (!editor) return;
  const pos = document.caretRangeFromPoint(e.clientX, e.clientY);
  if (!pos || pos.startContainer.nodeType !== Node.TEXT_NODE) return;
  const node = pos.startContainer;
  const text = node.data;
  // a capital slip (see capitalSlips): the letter's capital, and nothing to learn
  let ws = pos.startOffset;
  while (ws > 0 && /[\p{L}\p{M}]/u.test(text[ws - 1])) ws--;
  for (const list of capsRanges.values()) {
    const hit = list.find((r) => r.startContainer === node && r.startOffset === ws);
    if (!hit) continue;
    e.preventDefault();
    const at = hit.startOffset;
    const upper = text[at].toLocaleUpperCase(writingLanguage());
    const chEl = editor.closest('.chapter');
    showSpellMenu(e.clientX, e.clientY, text[at], [upper], {
      replace: (s) => {
        const sel = window.getSelection();
        const r = document.createRange();
        r.setStart(node, at); r.setEnd(node, at + 1);
        sel.removeAllRanges(); sel.addRange(r);
        rec.mark('spell');
        document.execCommand('insertText', false, s);
        if (chEl) spellScanEl(spellElFor(chEl.dataset.id), chEl.dataset.id);
      }
    });
    return;
  }
  const isW = (c) => /[\p{L}\p{M}'’]/u.test(c);
  let a = pos.startOffset, b = pos.startOffset;
  while (a > 0 && isW(text[a - 1])) a--;
  while (b < text.length && isW(text[b])) b++;
  if (a === b) return;
  let word = spellNorm(text.slice(a, b));
  if (spellCache.get(word) !== false) {
    // …or a hyphenated word underlined whole: every piece is a word, the
    // whole isn't (see spellScanEl)
    let wa = a, wb = b;
    while (text[wa - 1] === '-' && isW(text[wa - 2] || '')) { wa--; while (wa > 0 && isW(text[wa - 1])) wa--; }
    while (text[wb] === '-' && isW(text[wb + 1] || '')) { wb++; while (wb < text.length && isW(text[wb])) wb++; }
    const whole = spellNorm(text.slice(wa, wb));
    if (whole === word || spellCache.get(whole) !== false) return; // only flagged words get our menu
    if (text.slice(wa, wb).split('-').some((w) => spellCache.get(spellNorm(w)) === false)) return;
    a = wa; b = wb; word = whole;
  }
  e.preventDefault();
  const chEl = editor.closest ? editor.closest('.chapter') : null;
  const key = editor.id === 'aux-editor'
    ? 'aux-' + (editor.dataset.kind || 'notes')
    : (chEl ? chEl.dataset.id : null);
  const sugg = await window.neo.spellSuggest(word);
  showSpellMenu(e.clientX, e.clientY, word, sugg, {
    replace: (s) => {
      const sel = window.getSelection();
      const r = document.createRange();
      r.setStart(node, a); r.setEnd(node, b);
      sel.removeAllRanges(); sel.addRange(r);
      rec.mark('spell');
      document.execCommand('insertText', false, s);
      if (key) spellScanEl(spellElFor(key), key);
    },
    learn: async () => {
      library.customWords = library.customWords || [];
      if (!library.customWords.includes(word)) library.customWords.push(word);
      await writeLibrary(library);
      await window.neo.spellLearn(word);
      // Learning also accepts equivalent Unicode spellings. Recheck cached
      // failures so those variants lose their underlines in every editor.
      spellCache.clear();
      spellCache.set(word, true);
      for (const k of [...spellScanned]) spellScanEl(spellElFor(k), k);
    }
  });
});

function showSpellMenu(x, y, word, suggestions, actions) {
  document.querySelector('.spell-menu')?.remove();
  const menu = document.createElement('div');
  menu.className = 'spell-menu';
  if (suggestions.length) {
    for (const s of suggestions) {
      const btn = document.createElement('button');
      btn.textContent = s;
      btn.onclick = () => { menu.remove(); actions.replace(s); };
      menu.appendChild(btn);
    }
  } else {
    const none = document.createElement('button');
    none.textContent = t('No suggestions');
    none.disabled = true;
    menu.appendChild(none);
  }
  if (actions.learn) {
    const sep = document.createElement('div');
    sep.className = 'sm-sep';
    menu.appendChild(sep);
    const learn = document.createElement('button');
    learn.textContent = t('Add “{word}” to dictionary', { word });
    learn.onclick = () => { menu.remove(); actions.learn(); };
    menu.appendChild(learn);
  }
  document.body.appendChild(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.min(x, window.innerWidth - r.width - 10) + 'px';
  menu.style.top = Math.min(y + 4, window.innerHeight - r.height - 10) + 'px';
  const close = (ev) => {
    if (menu.contains(ev.target)) return;
    menu.remove();
    document.removeEventListener('mousedown', close, true);
  };
  document.addEventListener('mousedown', close, true);
}

let typewriterEnabled = false;

// ---- look up rules:
// macOS shows the system dictionary for a selected word; the menu only makes sense for one word,
// never for a phrase or a whole paragraph (#179).
const LOOK_UP_MAX_WORD = 60;
function lookUpWord(text) {
  const word = (text || '').trim();
  if (!word || word.length > LOOK_UP_MAX_WORD) return null;
  return /\s/.test(word) ? null : word;
}
// ---- end of look up rules ----

// macOS: a selected word in the manuscript or the notes gets the system "Look Up" — the panel
// Safari and Books show (#179). The listener runs in the bubble phase, after the spellcheck menu,
// and stands down when any other menu already answered the right-click.
document.addEventListener('contextmenu', (e) => {
  if (window.neo.platform !== 'darwin' || e.defaultPrevented) return;
  const editor = e.target.closest && e.target.closest('.chapter-body, #aux-editor');
  if (!editor) return;
  const sel = window.getSelection();
  const word = sel && sel.rangeCount && !sel.isCollapsed ? lookUpWord(sel.toString()) : null;
  if (!word) return;
  e.preventDefault();
  popMenu(e.clientX, e.clientY, [{ label: t('Look Up “{word}”', { word }), value: 'lookup' }]).then((choice) => {
    if (choice === 'lookup') window.neo.lookUpText();
  });
});

// The page needs empty room beneath its last line, or the caret can't be held
// at the centre once the end of the draft scrolls into view (body.typewriter
// deepens #paper's bottom margin; see styles.css). Only as much as the last
// page's own blank paper doesn't already give: a page that is mostly blank
// needs none, and a fixed 60vh left an empty scroll under it from line one.
function applyTypewriter() {
  document.body.classList.toggle('typewriter', typewriterEnabled);
  if (window.neo.typewriterState) window.neo.typewriterState(typewriterEnabled); // the Format menu's tick
  typewriterRoom();
}
function typewriterRoom() {
  const paper = $('#paper');
  const bodies = $$('#chapters .chapter-body');
  const last = bodies[bodies.length - 1];
  if (!typewriterEnabled || !last || paper.hidden) return;
  const line = parseFloat(getComputedStyle(last).lineHeight) || 30;
  // the last line must be able to rise to the writing height (45% of the
  // window, as in the selectionchange handler below)
  const below = paper.getBoundingClientRect().bottom - last.getBoundingClientRect().bottom;
  const room = $('#paper-scroll').clientHeight - window.innerHeight * 0.45 - below + line;
  paper.style.setProperty('--typewriter-room', Math.max(120, Math.ceil(room)) + 'px');
}
new ResizeObserver(() => typewriterRoom()).observe($('#chapters'));
window.addEventListener('resize', typewriterRoom);
function toggleTypewriter() {
  typewriterEnabled = !typewriterEnabled;
  library.typewriter = typewriterEnabled;
  writeLibrary(library);
  applyTypewriter();
  toast(typewriterEnabled ? t('Typewriter scrolling ON — your line stays centered') : t('Typewriter scrolling off'));
}


// The page follows the caret only while the writer is typing or moving by
// keyboard: a click to think about a sentence leaves the screen exactly as
// it was. The caret has a band of a few lines to move in before the page
// glides (not snaps) to bring it back to the writing height.
let typewriterByKeyboard = false;
document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const el = e.target;
  if (el && el.closest && el.closest('.chapter-body')) typewriterByKeyboard = true;
}, true);
document.addEventListener('mousedown', () => { typewriterByKeyboard = false; }, true);

document.addEventListener('selectionchange', () => {
  if (!typewriterEnabled || !book || currentTab !== 'manuscript' || !typewriterByKeyboard) return;
  const sel = window.getSelection();
  if (!sel.rangeCount || !sel.isCollapsed) return;
  let el = sel.anchorNode;
  if (el && el.nodeType === Node.TEXT_NODE) el = el.parentElement;
  if (!el || !el.closest || !el.closest('.chapter-body')) return;
  requestAnimationFrame(() => {
    try {
      let rect = sel.getRangeAt(0).getBoundingClientRect();
      if (!rect || (rect.top === 0 && rect.height === 0)) rect = el.getBoundingClientRect();
      const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 30;
      const diff = rect.top - window.innerHeight * 0.45;
      // a band of about three lines around the writing height
      if (Math.abs(diff) <= lineHeight * 1.5) return;
      const scroller = $('#paper-scroll');
      scroller.scrollTo({ top: scroller.scrollTop + diff, behavior: scrollBehavior() });
    } catch { /* selection mid-mutation; skip this frame */ }
  });
});

/* ================================================================== */
/*  FOCUS MODE: dim everything but the sentence or paragraph           */
/* ================================================================== */
// Painted with the CSS Custom Highlight API (like search and spellcheck),
// so the manuscript DOM is never touched and nothing leaks into saved HTML.
// also the order ⌘⇧O steps through: off → paragraph → sentence → off
const FOCUS_LEVELS = ['off', 'paragraph', 'sentence'];
const FOCUS_LABELS = { off: tk('Focus mode off'), sentence: tk('Focus: sentence'), paragraph: tk('Focus: paragraph') };
let focusLevel = 'off';

// The paragraph alignment the Format menu should tick. `null` means no tick belongs to the caret:
// outside the manuscript, or the caret is not inside a paragraph. No alignment rule IS left.
function currentAlign() {
  if (!book || currentTab !== 'manuscript') return null;
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  let el = sel.getRangeAt(0).startContainer;
  if (el.nodeType === Node.TEXT_NODE) el = el.parentElement;
  const body = el && el.closest ? el.closest('.chapter-body') : null;
  const p = el && el.closest ? el.closest('p') : null;
  if (!body || !p || !body.contains(p)) return null;
  const value = (p.style && p.style.textAlign) || 'left';
  return ['left', 'center', 'right', 'justify'].includes(value) ? value : null;
}

// the View and Format menus' ticks (focus level, page, brighter interface, body font, drop cap,
// alignment) follow the page. Selection changes call this often, so an unchanged payload is
// not sent again.
let viewStateSent = '';

// Brighter Interface, remembered two ways: while writing (where a faint
// interface keeps out of the way) and everywhere else in a book, the
// Outline, Notes and Darlings, where the tips need reading (bright unless
// the writer turns it down). The shelf goes with writing.
const brightAside = () => !!book && !$('#editor-view').hidden && currentTab !== 'manuscript';
function brightNow() {
  if (brightAside()) return library.uiBrightAside === undefined ? true : !!library.uiBrightAside;
  return library.uiBright === undefined ? SYSTEM_CONTRAST.matches : !!library.uiBright;
}
function applyBright() {
  if (!library) return;
  document.body.classList.toggle('bright', brightNow());
  reportViewState();
}
function reportViewState() {
  if (!window.neo.viewState || !library) return;
  const payload = {
    focus: focusLevel,
    pageTheme: library.pageTheme || 'night',
    uiBright: document.body.classList.contains('bright'),
    bodyFont: (library.fonts && library.fonts.body) || '',
    dropCap: (library.fonts && library.fonts.dropcap) || 'literary',
    align: currentAlign(),
  };
  const key = JSON.stringify(payload);
  if (key === viewStateSent) return;
  viewStateSent = key;
  window.neo.viewState(payload);
}

function applyFocus() {
  reportViewState();
  document.body.classList.toggle('focus-mode', focusLevel !== 'off');
  if (focusLevel === 'off') {
    if (window.CSS && CSS.highlights) CSS.highlights.delete('neo-focus');
  } else updateFocus();
}
function setFocus(level) {
  if (!FOCUS_LEVELS.includes(level)) return;
  focusLevel = level;
  library.focus = level;
  writeLibrary(library);
  applyFocus();
  toast(t(FOCUS_LABELS[level] || ''));
}
function cycleFocus() { setFocus(FOCUS_LEVELS[(FOCUS_LEVELS.indexOf(focusLevel) + 1) % FOCUS_LEVELS.length]); }

// the paragraph (direct <p> child of a chapter body) holding the caret
function focusParagraph() {
  const sel = window.getSelection();
  if (!sel.rangeCount) return null;
  let el = sel.focusNode;
  if (el && el.nodeType === Node.TEXT_NODE) el = el.parentElement;
  if (!el || !el.closest) return null;
  const body = el.closest('.chapter-body');
  if (!body) return null;
  let p = el;
  while (p && p.parentElement !== body) p = p.parentElement;
  return p && p.tagName === 'P' ? p : null;
}

// caret position as a character offset into p.textContent
function caretOffsetIn(p) {
  const sel = window.getSelection();
  const r = document.createRange();
  r.selectNodeContents(p);
  try { r.setEnd(sel.focusNode, sel.focusOffset); } catch { return 0; }
  return r.toString().length;
}

// character offsets within p → a DOM Range over its text nodes
function rangeFromOffsets(p, start, end) {
  const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
  const r = document.createRange();
  let pos = 0, n, startSet = false;
  while ((n = walker.nextNode())) {
    const len = n.textContent.length;
    if (!startSet && start <= pos + len) { r.setStart(n, start - pos); startSet = true; }
    if (startSet && end <= pos + len) { r.setEnd(n, end - pos); return r; }
    pos += len;
  }
  if (!startSet) return null;
  r.setEndAfter(p.lastChild || p);
  return r;
}

let focusSegmenter = null;
function sentenceRange(p) {
  const text = p.textContent;
  if (!text.trim()) return null;
  const at = caretOffsetIn(p);
  if (!focusSegmenter && window.Intl && Intl.Segmenter) {
    focusSegmenter = new Intl.Segmenter((library.spellLanguage || 'en').split('-')[0], { granularity: 'sentence' });
  }
  if (!focusSegmenter) return null;
  let hit = null, last = null;
  for (const seg of focusSegmenter.segment(text)) {
    last = seg;
    // caret at the very end of a sentence still belongs to it
    if (at >= seg.index && at <= seg.index + seg.segment.length) { hit = seg; if (at < seg.index + seg.segment.length) break; }
  }
  hit = hit || last;
  // trim trailing whitespace so the highlight hugs the words
  const start = hit.index;
  const end = hit.index + hit.segment.replace(/\s+$/, '').length;
  return rangeFromOffsets(p, start, Math.max(end, start));
}

function updateFocus() {
  if (focusLevel === 'off' || !book || currentTab !== 'manuscript') return;
  if (!window.Highlight || !window.CSS || !CSS.highlights) return;
  const p = focusParagraph();
  if (!p) return;   // caret elsewhere (title, panels): keep the last focus
  let r = null;
  if (isBreakPara(p)) r = null;
  else if (focusLevel === 'sentence') r = sentenceRange(p);
  else if (focusLevel === 'paragraph') { r = document.createRange(); r.selectNodeContents(p); }
  if (r) CSS.highlights.set('neo-focus', new Highlight(r));
  else CSS.highlights.delete('neo-focus');
  // highlights can't reach ::first-letter, so the drop cap gets a class
  // on its chapter body (a class on the body itself is never saved)
  document.querySelectorAll('.chapter-body.focus-cap').forEach((b) => b.classList.remove('focus-cap'));
  const body = p.parentElement;
  const first = body.querySelector('p[data-first]'); // the paragraph with the drop cap (openingPara)
  const firstText = first && document.createTreeWalker(first, NodeFilter.SHOW_TEXT).nextNode();
  if (r && firstText && r.comparePoint(firstText, 0) === 0) body.classList.add('focus-cap');
}
function isBreakPara(p) { return p.classList.contains('scene-break'); }

document.addEventListener('selectionchange', () => {
  if (focusLevel === 'off') return;
  requestAnimationFrame(() => { try { updateFocus(); } catch { /* mid-mutation */ } });
});
// the Format menu's alignment tick follows the caret
document.addEventListener('selectionchange', () => {
  requestAnimationFrame(() => { try { reportViewState(); } catch { /* mid-mutation */ } });
});
document.addEventListener('input', () => {
  if (focusLevel === 'off') return;
  requestAnimationFrame(() => { try { updateFocus(); } catch { /* mid-mutation */ } });
});

/* ================================================================== */
/*  GOALS, SPRINTS, AND THE CHART                                      */
/* ================================================================== */

let sprint = null;

function statsChartSvg() {
  const W = 520, H = 200, PAD = 6;
  const days = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(writingDay(d));
  }
  const counts = book.dailyCounts || {};
  const daily = days.map((d) => counts[d] ? Math.max(0, counts[d].end - counts[d].start) : 0);
  // cumulative: carry the last known total forward
  let last = 0;
  const firstKnown = days.find((d) => counts[d]);
  if (firstKnown) last = counts[firstKnown].start;
  const cumulative = days.map((d) => {
    if (counts[d]) last = counts[d].end;
    return last;
  });
  const goal = book.wordGoal || 0;
  const maxC = Math.max(...cumulative, goal, 1);
  const maxD = Math.max(...daily, library.dailyGoal || 0, 1);
  const bw = (W - PAD * 2) / 30;

  const bars = daily.map((v, i) => {
    const h = Math.round((v / maxD) * (H * 0.45));
    return `<rect x="${(PAD + i * bw).toFixed(1)}" y="${H - PAD - h}" width="${(bw - 2).toFixed(1)}" height="${h}" rx="1.5" fill="#3d5a4f"/>`;
  }).join('');
  const line = cumulative.map((v, i) => {
    const x = (PAD + i * bw + bw / 2).toFixed(1);
    const y = (H - PAD - (v / maxC) * (H - PAD * 2 - 20)).toFixed(1);
    return (i === 0 ? 'M' : 'L') + x + ',' + y;
  }).join(' ');
  const goalLine = goal
    ? `<line x1="${PAD}" x2="${W - PAD}" y1="${(H - PAD - (goal / maxC) * (H - PAD * 2 - 20)).toFixed(1)}" y2="${(H - PAD - (goal / maxC) * (H - PAD * 2 - 20)).toFixed(1)}" stroke="#c9a86a" stroke-dasharray="5,4" stroke-width="1" opacity="0.7"/>`
    : '';
  return `<svg id="stats-chart" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escHtml(t('Words written over the last 30 days')).replace(/"/g, '&quot;')}">
    ${bars}
    <path d="${line}" fill="none" stroke="#c9a86a" stroke-width="2"/>
    ${goalLine}
  </svg>
  <div class="stats-legend">
    <span>${t('30 days ago')}</span>
    <span class="sl-daily">▮ ${t('daily words')}</span>
    <span style="color:var(--accent)">— ${t('total')}${goal ? ' · - - ' + t('goal') : ''}</span>
    <span>${t('today')}</span>
  </div>`;
}

/* ================================================================== */
/*  COVER ART SETTINGS (File → Cover Art…)                             */
/* ================================================================== */

// One key per provider. The brief and the painting always come from the
// same provider, so a writer only ever needs one account.
const COVER_PROVIDERS = {
  openai: { name: 'OpenAI', keyHint: 'sk-…', where: tk('platform.openai.com → API keys'), text: 'gpt-5-mini', image: 'gpt-image-1-mini', quality: true, cost: tk('a few cents a picture') }
};
// shown in the window, so translated when read
const providerWhere = (p) => t(p.where);
const providerCost = (p) => t(p.cost);
// Key formats change under us, so the only test is "one token, long enough" —
// the provider does the rest.
const looksLikeKey = (k) => /^\S{20,}$/.test(k);
const coverSettings = () => library.coverArt || {};
const coverProvider = () => (COVER_PROVIDERS[coverSettings().provider] ? coverSettings().provider : 'openai');

function openCoverArt() {
  const cs = coverSettings();
  const bd = document.createElement('div');
  bd.className = 'modal-backdrop';
  const provOptions = Object.entries(COVER_PROVIDERS).map(([id, p]) =>
    `<option value="${id}"${coverProvider() === id ? ' selected' : ''}>${p.name}</option>`).join('');
  bd.innerHTML = `
    <div class="modal" style="width:540px">
      <h2 style="font-size:17px">${t('Cover art')}</h2>
      <p>${t('Every book gets a cover on the shelf: an abstract with the title set in type. With an OpenAI key, NEO can also read a story once it passes {n} words and paint a cover from the text. Paintings stay on your shelf — exports never include them.', { n: PAINT_AT })}</p>
      <div class="stats-row">
        <select id="ca-provider" hidden>${provOptions}</select>
        <label class="st-check"><input id="ca-auto" type="checkbox"${cs.auto === false ? '' : ' checked'}/> ${t('paint at {n} words', { n: PAINT_AT })}</label>
      </div>
      <div class="stats-row st-covers">
        <label>${t('API key')} <input id="ca-key" type="password" autocomplete="off" spellcheck="false" style="width:300px"/></label>
      </div>
      <p class="soft" id="ca-note" style="margin:-6px 0 12px;font-size:12px"></p>
      <details class="st-advanced">
        <summary class="soft">${t('Models')}</summary>
        <div class="stats-row">
          <label>${t('Brief')} <input id="ca-tmodel" type="text" spellcheck="false"/></label>
          <label>${t('Paint')} <input id="ca-imodel" type="text" spellcheck="false"/></label>
          <label id="ca-quality-wrap">${t('Quality')}
            <select id="ca-quality">
              ${['low', 'medium', 'high'].map((q) => `<option value="${q}"${(cs.quality || 'medium') === q ? ' selected' : ''}>${({ low: t('low'), medium: t('medium'), high: t('high') })[q]}</option>`).join('')}
            </select>
          </label>
        </div>
        <p class="soft" style="font-size:12px;margin:0 0 6px">${t('Leave blank for NEO’s defaults. Names drift; if a provider retires one, NEO tries its own list before giving up.')}</p>
      </details>
      <div style="text-align:right;margin-top:14px">
        <button class="m-cancel btn-quiet" style="margin-right:10px">${t('Cancel')}</button>
        <button class="m-ok btn-gold">${t('Save')}</button>
      </div>
    </div>`;
  document.body.appendChild(bd);
  const sel = bd.querySelector('#ca-provider');
  const key = bd.querySelector('#ca-key');
  const note = bd.querySelector('#ca-note');
  const models = (cs.models || {});
  // per-provider fields: key placeholder, stored model overrides, quality
  const showProvider = async () => {
    const id = sel.value, p = COVER_PROVIDERS[id];
    key.value = '';
    key.placeholder = t('{name} key ({hint})', { name: p.name, hint: p.keyHint });
    bd.querySelector('#ca-tmodel').value = (models[id] && models[id].text) || '';
    bd.querySelector('#ca-tmodel').placeholder = p.text;
    bd.querySelector('#ca-imodel').value = (models[id] && models[id].image) || '';
    bd.querySelector('#ca-imodel').placeholder = p.image;
    bd.querySelector('#ca-quality-wrap').style.display = p.quality ? '' : 'none';
    const has = await window.neo.hasSecret(id);
    if (sel.value !== id) return;
    note.textContent = has
      ? t('A {name} key is saved, encrypted, outside your library folder. Paste a new one to replace it, or type “{remove}” to forget it.', { name: p.name, remove: t('remove') })
      : t('Get a key at {where} ({cost}). It’s stored encrypted on this computer and only ever sent to {name}.', { where: providerWhere(p), cost: providerCost(p), name: p.name });
  };
  sel.onchange = showProvider;
  showProvider();
  const done = () => bd.remove();
  bd.querySelector('.m-cancel').onclick = done;
  bd.querySelector('.m-ok').onclick = async () => {
    const id = sel.value, p = COVER_PROVIDERS[id];
    const k = key.value.trim();
    if (k === 'remove' || k === t('remove')) await window.neo.setSecret(id, '');
    else if (k && !looksLikeKey(k)) { toast(t('That doesn’t look like an API key ({name} keys look like {hint}) — not saved', { name: p.name, hint: p.keyHint }), 6000); return; }
    else if (k) await window.neo.setSecret(id, k);
    models[id] = {
      text: bd.querySelector('#ca-tmodel').value.trim() || undefined,
      image: bd.querySelector('#ca-imodel').value.trim() || undefined
    };
    library.coverArt = {
      provider: id,
      auto: bd.querySelector('#ca-auto').checked,
      quality: bd.querySelector('#ca-quality').value,
      models
    };
    await writeLibrary(library);
    done();
    if (!(await window.neo.hasSecret(id))) toast(t('Saved. Add a {name} key to start painting.', { name: p.name }), 5000);
  };
  bd.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(); } });
  key.focus();
}

// An hour of the day as the writer's language says it: 1 am / 13 h / 13 Uhr,
// or 13:00 where the language's hour is a bare number
function hourLabel(h) {
  if (h === 0) return t('midnight');
  const loc = NeoI18n.getLocale();
  if (loc.startsWith('en')) {
    if (h === 12) return t('noon');
    return h < 12 ? t('{h} am', { h: String(h) }) : t('{h} pm', { h: String(h - 12) });
  }
  const at = new Date(2000, 0, 1, h);
  const hour = new Intl.DateTimeFormat(loc, { hour: 'numeric' }).format(at);
  return /^\d+$/.test(hour) ? new Intl.DateTimeFormat(loc, { hour: '2-digit', minute: '2-digit' }).format(at) : hour;
}

function openStats() {
  const hasBook = !!book;
  const today = hasBook ? (book.dailyCounts || {})[todayStr()] : null;
  const wordsToday = today ? Math.max(0, today.end - today.start) : 0;
  const total = hasBook ? bookWordCount() : 0;
  const bd = document.createElement('div');
  bd.className = 'modal-backdrop';
  bd.innerHTML = `
    <div class="modal" style="width:${hasBook ? 580 : 380}px">
      <h2 style="font-size:17px">${hasBook ? t('{title} — progress', { title: escHtml(shownTitle(book.title)) }) : t('Goals')}</h2>
      ${hasBook ? `
      <div class="stats-nums">
        <div><div class="big">${fmtNum(total)}</div><div class="lbl">${t('total words')}</div></div>
        <div><div class="big">${fmtNum(wordsToday)}</div><div class="lbl">${t('today')}</div></div>
        <div><div class="big">${book.wordGoal ? Math.min(100, Math.round(total / book.wordGoal * 100)) + '%' : '—'}</div><div class="lbl">${t('of book goal')}</div></div>
      </div>
      ${statsChartSvg()}` : ''}
      <div class="stats-row stats-goals" style="margin-top:${hasBook ? 18 : 6}px">
        <label>${t('Daily goal')} <input id="st-daily" type="number" min="0" value="${library.dailyGoal || ''}" placeholder="500"/></label>
        ${hasBook ? `<label>${t('Book goal')} <input id="st-book" type="number" min="0" value="${book.wordGoal || ''}" placeholder="80000"/></label>` : ''}
      </div>
      <div class="stats-row stats-goals">
        <label>${t('Day ends at')}
          <select id="st-dayends">
            ${Array.from({ length: 24 }, (_, h) => `<option value="${h}"${(library.dayEndsAt || 0) === h ? ' selected' : ''}>${hourLabel(h)}</option>`).join('')}
          </select>
        </label>
      </div>
      ${hasBook ? `
      <div class="stats-row stats-goals">
        <label>${t('Sprint')} <input id="st-sprint" type="number" min="50" value="${sprint ? sprint.target : 500}"/> ${t('words')}</label>
        <button id="st-sprint-btn" class="btn-gold" style="align-self: center;">${sprint && !sprint.done ? t('End sprint') : t('Start sprint')}</button>
      </div>` : ''}
      <div style="text-align:right;margin-top:14px">
        <button class="m-ok btn-gold">${t('Done')}</button>
      </div>
    </div>`;
  document.body.appendChild(bd);
  const close = async () => {
    library.dailyGoal = parseInt(bd.querySelector('#st-daily').value, 10) || 0;
    library.dayEndsAt = parseInt(bd.querySelector('#st-dayends').value, 10) || 0;
    if (hasBook) {
      book.wordGoal = parseInt(bd.querySelector('#st-book').value, 10) || 0;
      scheduleMetaSave();
    }
    await writeLibrary(library);
    bd.remove();
    if (hasBook) updateCounters();
  };
  bd.querySelector('.m-ok').onclick = close;
  // Esc closes from anywhere in the dialog (it takes focus on opening, so
  // the key reaches it even before a field is clicked); so does a click on
  // the dim page around it. Both keep the edits, like Done.
  bd.tabIndex = -1;
  bd.focus();
  bd.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  if (hasBook) {
    bd.querySelector('#st-sprint-btn').onclick = () => {
      if (sprint && !sprint.done) {
        const got = bookWordCount() - sprint.startCount;
        toast(t('Sprint ended — {n} words in {min} min', { n: got, min: Math.round((Date.now() - sprint.startTime) / 60000) }));
        sprint = null;
      } else {
        const target = parseInt(bd.querySelector('#st-sprint').value, 10) || 500;
        sprint = { target, startCount: bookWordCount(), startTime: Date.now(), done: false, bookId: book.id };
        toast(t('Sprint started — {n} words. Go.', { n: target }));
      }
      close();
    };
  }
}

$('#goal-counter').onclick = openStats;

/* ================================================================== */
/*  MENU: Help + fonts                                                 */
/* ================================================================== */

const DROPCAP_FONTS = {
  literary: '"Didot", "Bodoni 72", Georgia, serif',
  fantasy: '"Apple Chancery", "Snell Roundhand", cursive',
  scifi: 'Futura, "Avenir Next", "Helvetica Neue", sans-serif'
};
const BODY_FONTS = {
  'Georgia': 'Georgia, "Times New Roman", serif',
  'Palatino': '"Palatino", "Palatino Linotype", serif',
  'Baskerville': 'Baskerville, "Baskerville Old Face", Georgia, serif',
  'Hoefler Text': '"Hoefler Text", Georgia, serif',
  'Iowan Old Style': '"Iowan Old Style", Georgia, serif',
  'Cambria': 'Cambria, Georgia, serif',
  'Constantia': 'Constantia, Georgia, serif',
  // a sans-serif for those who write in one (bundled, so it's the same everywhere)
  'Jost': '"Jost", "Avenir Next", "Helvetica Neue", Arial, sans-serif',
  // iA Writer's own face, bundled too (SIL Open Font License)
  'iA Writer Quattro': '"iA Writer Quattro", "Helvetica Neue", Arial, sans-serif'
};

// Hoefler Text and Iowan Old Style ship only with macOS; elsewhere they
// would fall back to Georgia, so offer the fonts Windows actually has.
// Keep in step with bodyFonts in main.js.
const BODY_FONT_CHOICES = IS_MAC
  ? ['Georgia', 'Palatino', 'Baskerville', 'Hoefler Text', 'Iowan Old Style', 'Jost', 'iA Writer Quattro']
  : ['Georgia', 'Palatino', 'Baskerville', 'Cambria', 'Constantia', 'Jost', 'iA Writer Quattro'];

function applyFonts() {
  const f = library.fonts || {};
  if (f.body && typeof f.body === 'string') {
    document.documentElement.style.setProperty('--body-font', bodyFontStack(f.body));
  }
  if (f.dropcap && DROPCAP_FONTS[f.dropcap]) {
    document.documentElement.style.setProperty('--dropcap-font', DROPCAP_FONTS[f.dropcap]);
  }
  document.body.classList.toggle('no-dropcap', f.dropcap === 'none');
  document.body.classList.toggle('night', library.pageTheme === 'night');
  // Light: the paper page in a light room, the whole app with it
  document.body.classList.toggle('light', library.pageTheme === 'light');
  // the system's "Increase contrast" turns it on too, until the writer
  // chooses in the View menu
  applyBright();
  // View → Interface Size: everything but the page
  const uiZoom = [1, 1.25, 1.5, 2, 2.5, 3].includes(library.uiZoom) ? library.uiZoom : 1;
  document.documentElement.style.setProperty('--ui-zoom', uiZoom);
  document.documentElement.classList.toggle('ui-zoomed', uiZoom > 1);
  if (window.neo.uiZoomState) window.neo.uiZoomState(uiZoom);
  const size = Math.min(22, Math.max(14, library.editorFontSize || 17));
  document.documentElement.style.setProperty('--editor-size', size + 'px');
  applyPageZoom();
}

// A built-in choice, or a font the writer picked from their own computer.
// A library opened where that font is missing simply reads in Georgia.
function bodyFontStack(name) {
  return Object.hasOwn(BODY_FONTS, name) ? BODY_FONTS[name] : `"${name.replace(/["\\]/g, '')}", Georgia, serif`;
}

// Format → Body Font → Other Font…: every font installed on this computer,
// each shown in its own face. The panel sits top right, off the undimmed
// page, so hovering previews the font on the writer's own words. Resolves
// to a family name, or null on cancel.
async function pickLocalFont() {
  let families = [];
  try {
    // one entry per style; names starting with "." are the system's hidden fonts
    const faces = await window.queryLocalFonts();
    families = [...new Set(faces.map((f) => f.family))]
      .filter((n) => n && !n.startsWith('.'))
      .sort((a, b) => a.localeCompare(b));
  } catch {}
  if (!families.length) { toast(t('NEO couldn’t read the fonts on this computer')); return null; }
  return new Promise((resolve) => {
    const bd = document.createElement('div');
    bd.className = 'modal-backdrop font-picker';
    bd.innerHTML = `
      <div class="modal" style="width:320px">
        <h2 style="font-size:16px">${t('Other font')}</h2>
        <p class="font-now" style="font-size:13px;color:var(--muted);margin-bottom:10px"></p>
        <input type="text" spellcheck="false" placeholder="${t('Search {n} installed fonts', { n: families.length })}" />
        <div class="font-list"></div>
        <div style="text-align:right;margin-top:14px">
          <button class="m-cancel btn-quiet">${t('Cancel')}</button>
        </div>
      </div>`;
    document.body.appendChild(bd);
    const input = bd.querySelector('input');
    const list = bd.querySelector('.font-list');
    const current = (library.fonts || {}).body || 'Georgia';
    bd.querySelector('.font-now').textContent = t('Now: {font}', { font: current });
    const done = (val) => { bd.remove(); resolve(val); };
    const render = () => {
      const q = input.value.trim().toLowerCase();
      list.innerHTML = '';
      for (const name of families) {
        if (q && !name.toLowerCase().includes(q)) continue;
        const b = document.createElement('button');
        b.className = 'fr-font' + (name === current ? ' sel' : '');
        b.textContent = name;
        b.style.fontFamily = bodyFontStack(name);
        b.onmouseenter = () => { document.documentElement.style.setProperty('--body-font', bodyFontStack(name)); };
        b.onclick = () => done(name);
        list.appendChild(b);
      }
    };
    list.onmouseleave = applyFonts; // back to the saved font
    input.oninput = render;
    input.onkeydown = (e) => {
      if (e.key === 'Enter' && list.firstChild) done(list.firstChild.textContent);
      if (e.key === 'Escape') { e.stopPropagation(); done(null); } // as in askInput
    };
    bd.querySelector('.m-cancel').onclick = () => done(null);
    render();
    const sel = list.querySelector('.sel');
    if (sel) sel.scrollIntoView({ block: 'center' });
    input.focus();
  });
}

// Pinch (trackpad) or Ctrl+scroll: page and text zoom together.
// A pinch arrives as a wheel event with ctrlKey set.
function updateZoomDisplay() {
  const el = $('#zoom-level');
  // on the outline's cards, the zoom is the cards' size
  const z = boardShowing() ? cardZoom() : activePageZoom();
  if (el) el.textContent = Math.round(z * 100) + '%';
}
const boardShowing = () => !!book && currentTab === 'outline' && $('#editor-view').classList.contains('board-on');
// Zooming or resizing the text reflows the whole book, and the same scroll
// offset lands somewhere else. Pin a spot in the text first: the caret if
// it's on screen, otherwise the point being pinched, otherwise the middle
// of the page. Then scroll it back to where it was.
function keepReadingPlace(change, at) {
  const sc = $('#paper-scroll');
  if (!sc || $('#editor-view').hidden) { change(); return; }
  const box = sc.getBoundingClientRect();
  const topOf = (r) => {
    const rect = r.getBoundingClientRect();
    if (rect.height) return rect.top;
    const el = r.startContainer.nodeType === Node.ELEMENT_NODE ? r.startContainer : r.startContainer.parentElement;
    return el ? el.getBoundingClientRect().top : null; // an empty line has no text to measure
  };
  let anchor = null;
  const sel = window.getSelection();
  if (!at && sel.rangeCount && sc.contains(sel.anchorNode)) {
    const caret = sel.getRangeAt(0).cloneRange();
    caret.collapse(true);
    const y = topOf(caret);
    if (y !== null && y >= box.top && y <= box.bottom) anchor = caret;
  }
  if (!anchor) {
    const x = Math.min(box.right - 1, Math.max(box.left + 1, at ? at.x : box.left + box.width / 2));
    const y = Math.min(box.bottom - 1, Math.max(box.top + 1, at ? at.y : box.top + box.height / 2));
    const r = document.caretRangeFromPoint(x, y);
    if (r && sc.contains(r.startContainer)) anchor = r;
  }
  const before = anchor && topOf(anchor);
  change();
  if (before === null || before === undefined) return;
  const after = topOf(anchor); // reads the new layout
  if (after !== null) sc.scrollTop += after - before;
}

function setPageZoom(next, at) {
  // up to 300%: on a large monitor 160% still read small. The page itself
  // never grows past the window (max-width in styles.css), only the type does.
  next = Math.min(3, Math.max(0.75, next));
  if (next === activePageZoom()) return;
  rememberZoom(pageZoomKey(), next);
  keepReadingPlace(() => document.documentElement.style.setProperty('--page-zoom', next), at);
  updateZoomDisplay();
}
let cardWheel = 0;
let pageWheel = 0;
$('#editor-view').addEventListener('wheel', (e) => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  if (boardShowing()) {
    // a pinch steps the cards a size at a time
    cardWheel += e.deltaY;
    if (Math.abs(cardWheel) > 40) { stepCardZoom(cardWheel < 0 ? 1 : -1); cardWheel = 0; }
    return;
  }
  // …and the page a tenth at a time (#336: a smooth pinch left it at 101%)
  pageWheel += e.deltaY;
  if (Math.abs(pageWheel) > 40) {
    setPageZoom(tenth(activePageZoom() + (pageWheel < 0 ? 0.1 : -0.1)), { x: e.clientX, y: e.clientY });
    pageWheel = 0;
  }
}, { passive: false });
let shelfWheel = 0;
$('#bookshelf-view').addEventListener('wheel', (e) => {
  if (!e.ctrlKey) return;
  e.preventDefault();
  shelfWheel += e.deltaY;
  if (Math.abs(shelfWheel) > 40) { stepShelfZoom(shelfWheel < 0 ? 1 : -1); shelfWheel = 0; }
}, { passive: false });

// zoom control in the bottom bar: buttons, click-to-reset, and scroll
$('#zoom-in').onclick = () => (boardShowing() ? stepCardZoom(1) : setPageZoom(tenth(activePageZoom() + 0.1)));
$('#zoom-out').onclick = () => (boardShowing() ? stepCardZoom(-1) : setPageZoom(tenth(activePageZoom() - 0.1)));
$('#zoom-level').onclick = () => (boardShowing() ? stepCardZoom(0) : setPageZoom(1));
$('#zoom-control').addEventListener('wheel', (e) => {
  e.preventDefault();
  if (boardShowing()) {
    cardWheel += e.deltaY;
    if (Math.abs(cardWheel) > 40) { stepCardZoom(cardWheel < 0 ? 1 : -1); cardWheel = 0; }
    return;
  }
  setPageZoom(activePageZoom() * Math.exp(-e.deltaY * 0.002));
}, { passive: false });

// Format → Align Paragraph: applies to every paragraph the selection touches
function applyAlign(value) {
  if (!book || currentTab !== 'manuscript') { toast(t('Click into a paragraph first')); return; }
  const sel = window.getSelection();
  if (!sel.rangeCount) return;
  const r = sel.getRangeAt(0);
  let el = r.startContainer;
  if (el.nodeType === Node.TEXT_NODE) el = el.parentElement;
  const body = el && el.closest ? el.closest('.chapter-body') : null;
  if (!body) { toast(t('Click into a paragraph first')); return; }
  const chId = body.closest('.chapter').dataset.id;
  const ps = [...body.querySelectorAll('p')].filter(
    (p) => r.intersectsNode(p) && !p.classList.contains('scene-break')
  );
  for (const p of ps) {
    if (value === 'left') p.style.removeProperty('text-align');
    else p.style.textAlign = value;
    if (!p.getAttribute('style')) p.removeAttribute('style');
  }
  syncChapter(body, chId, 'format');
  reportViewState(); // the Format menu's alignment tick
}

// Menu accelerators and editor shortcuts, plus NEO's distinct writing gestures.
// Routine text entry, cursor movement and dialog controls are intentionally omitted.
function shortcutSections() {
  // with a script open, its keys come first, in place of a book's
  if (book && isScript()) {
    const sections = bookShortcutSections();
    sections[0] = { title: tk('Writing a script'), rows: [
      [tk('Enter'), tk('The next line: a speech after a name, action after a speech'), tk('On an empty line, Enter changes what it is: action becomes a character, so Enter twice after a speech brings in the next speaker. Enter again takes the gray name.')],
      ['Tab', tk('Take the gray suggestion, or step to the next element'), tk('In a speech, Tab trades dialogue and parenthetical. Shift+Tab steps back.')],
      ['→', tk('Take the gray suggestion')],
      [K('⌘1–⌘7', 'Ctrl+1–Ctrl+7'), tk('Scene heading, action, character, parenthetical, dialogue, transition, shot')],
      [['INT.', 'EXT.'], tk('At the start of a line: a scene heading')],
      [KPH, tk('Insert a placeholder note')],
      [KDA, tk('Move selected text to Darlings')]
    ] };
    return sections;
  }
  return bookShortcutSections();
}
function bookShortcutSections() {
  return [
    { title: tk('Writing'), rows: [
      [tk('Enter ×2'), tk('Insert a section break')],
      [tk('Enter ×3'), tk('Start a new chapter')],
      [K('⇧Enter', 'Shift+Enter'), tk('A paragraph with no indent'), tk('Again for another; Enter goes back to prose.')],
      [K('⌘⇧Enter', 'Ctrl+Shift+Enter'), tk('Start or continue a poetry paragraph'), tk('Also works from a chapter heading.')],
      [KPH, tk('Insert a placeholder note')],
      [KDA, tk('Move selected text to Darlings')],
      [K('⌘⇧U', IS_LINUX ? 'Ctrl+Shift+K' : 'Ctrl+Shift+U'), tk('Read aloud from the cursor'), tk('Again, Esc or any key stops it. Uses your computer’s own voice.')]
    ] },
    { title: tk('Formatting'), rows: [
      [['*…*', '**…**', '***…***'], tk('Italic, bold, the Markdown way'), tk('Typed around a word (or pasted). Undo right after keeps the asterisks. Format → Markdown Emphasis turns it off.')],
      [K('⌘U', 'Ctrl+U'), tk('Underline')],
      [K('⌘⇧S', 'Ctrl+Shift+S'), tk('Strikethrough'), tk('Or ~~…~~ around the words.')],
      [K('⌘⇧L', 'Ctrl+Shift+L'), tk('Align paragraph left')],
      [K('⌘⇧C', 'Ctrl+Shift+C'), tk('Center paragraph')],
      [K('⌘⇧R', 'Ctrl+Shift+R'), tk('Align paragraph right')],
      [K('⌘⇧J', 'Ctrl+Shift+J'), tk('Justify paragraph')],
      [K('⌘+', 'Ctrl++'), tk('Larger text')],
      [K('⌘−', 'Ctrl+−'), tk('Smaller text')],
      [K('⌘0', 'Ctrl+0'), tk('Reset text size and page zoom')]
    ] },
    { title: tk('Outline'), rows: [
      ['Tab', tk('Turn a chapter into a section'), tk('Only empty chapters after the first chapter.')],
      [K('⇧Tab', 'Shift+Tab'), tk('Turn a section into a chapter')]
    ] },
    { title: tk('Editing'), rows: [
      [K('⌘⌥⇧V', 'Ctrl+Shift+V'), tk('Paste and match style')],
      [K('⌘F', 'Ctrl+F'), tk('Find and replace')],
      [K('⌘;', 'Ctrl+;'), tk('Toggle spellcheck pass')]
    ] },
    { title: tk('App & files'), rows: [
      [KHELP, tk('Keyboard shortcuts')],
      [K('⌘S', 'Ctrl+S'), tk('Take a snapshot of the book'), tk('NEO saves as you type; a snapshot keeps the book as it stands now. They’re on the Darlings tab.')],
      [K('⌘,', 'Ctrl+,'), tk('Goals and writing sprints')],
      [K('⌘⇧I', 'Ctrl+Shift+I'), tk('Import manuscripts')],
      [K('⌘E', 'Ctrl+E'), tk('Email a draft to yourself')]
    ] },
    { title: tk('View & window'), rows: [
      [[K('⌘⇧F', 'Ctrl+Shift+F'), K('⌘Enter', 'Ctrl+Enter')], tk('Toggle full screen')],
      [K('⌘⇧T', 'Ctrl+Shift+T'), tk('Toggle typewriter scrolling')],
      [K('⌘⇧O', 'Ctrl+Shift+O'), tk('Cycle focus mode'), tk('Off → paragraph → sentence → off.')],
      [IS_MAC ? '⌥⌘↓' : ['Ctrl+Alt+↓', 'Ctrl+Page Down'], tk('Go to the next chapter')],
      [IS_MAC ? '⌥⌘↑' : ['Ctrl+Alt+↑', 'Ctrl+Page Up'], tk('Go to the previous chapter')],
      [K('⌥⌘→', 'Ctrl+Alt+→'), tk('Go to the next tab'), tk('Manuscript, Notes, Outline, Darlings, then round again.')],
      [K('⌥⌘←', 'Ctrl+Alt+←'), tk('Go to the previous tab')],
      [['F6', K('⌃Tab', 'Ctrl+Tab')], tk('Move between the page, the chapters, the notes and the bottom bar'), tk('Add Shift to go back. Esc returns to the page. On the shelf: the books, then the header.')],
      ...(IS_MAC ? [
        ['⌘H', tk('Hide NEO')],
        ['⌘⌥H', tk('Hide other apps')]
      ] : [])
    ] },
    // only for writers who turned them on (View → Vim Keys)
    ...(vimEnabled ? [{ title: tk('Vim keys'), rows: [
      ['Esc', tk('Stop writing and move around the page'), tk('i, a or o goes back to writing.')],
      ['h j k l', tk('Left, down, up, right')],
      ['w b e', tk('Next word, previous word, end of word')],
      ['0 $', tk('Start or end of the line')],
      ['( )', tk('Previous or next sentence')],
      ['{ }', tk('Previous or next paragraph')],
      ['gg G', tk('Top or end of the chapter')],
      ['[[ ]]', tk('Previous or next chapter')],
      [K('⌃d ⌃u', 'Ctrl+d Ctrl+u'), tk('Down or up half a screen')],
      ['i a I A', tk('Write here, after, at the start or end of the line')],
      ['o O', tk('Write in a new paragraph below or above')],
      ['v', tk('Select'), tk('Move to stretch it, then y to copy or d to cut.')],
      ['x', tk('Delete the letter under the caret')],
      ['/', tk('Find')],
      ['n N', tk('Next or previous match')]
    ] }] : [])
  ];
}

function showHelp() {
  const existing = $('#keyboard-shortcuts');
  if (existing) { existing.querySelector('.shortcuts-content').focus(); return; }
  const previousFocus = document.activeElement;
  const selection = window.getSelection();
  const previousRange = previousFocus.isContentEditable && selection.rangeCount
    ? selection.getRangeAt(0).cloneRange() : null;
  const bd = document.createElement('div');
  bd.id = 'keyboard-shortcuts';
  bd.className = 'modal-backdrop';
  bd.innerHTML = `
    <div class="modal shortcuts-modal" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title">
      <header class="shortcuts-header">
        <h2 id="shortcuts-title">${t('Keyboard shortcuts')}</h2>
      </header>
      <div class="shortcuts-content" tabindex="0" role="region" aria-label="${t('Shortcut reference')}"></div>
      <footer class="shortcuts-footer" role="none">
        <span>${t(K(tk('⌘ Command · ⇧ Shift · ⌥ Option · ⌃ Control'), tk('Ctrl Control · Shift · Alt')))}</span>
        <button class="m-ok btn-gold">${t('Done')}</button>
      </footer>
    </div>`;
  const keyName = (key) => key.replaceAll('⌘', t('Command') + ' ').replaceAll('⇧', t('Shift') + ' ')
    .replaceAll('⌥', t('Option') + ' ').replaceAll('⌃', t('Control') + ' ').replaceAll('−', '-');
  const content = bd.querySelector('.shortcuts-content');
  const sections = shortcutSections().map((section, index) => `
    <section class="shortcuts-section" style="order:${index}"><h3>${escHtml(t(section.title))}</h3><dl>${section.rows.map(([keys, label, detail]) => `
      <div class="shortcut-row">
        <dt>${escHtml(t(label))}${detail ? `<small>${escHtml(t(detail))}</small>` : ''}</dt>
        <dd>${[keys].flat().map((key) => t(key)).map((key) => `<kbd aria-label="${escHtml(keyName(key))}">${escHtml(key)}</kbd>`).join(`<span class="shortcut-or">${t('or')}</span>`)}</dd>
      </div>`).join('')}</dl></section>`);
  // Keep Writing and Formatting first, with similar amounts of content per column.
  // Vim keys, there only while they're on, runs across both below them.
  content.innerHTML = [[0, 2, 4, 5], [1, 3]].map((column) => `<div class="shortcuts-column">${
    column.map((index) => sections[index]).join('')
  }</div>`).join('') + (sections[6] ? `<div class="shortcuts-wide">${sections[6]}</div>` : '');
  const close = () => {
    document.removeEventListener('keydown', handleKeyDown, true);
    bd.remove();
    if (previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    if (previousRange && previousRange.startContainer.isConnected && previousRange.endContainer.isConnected) {
      selection.removeAllRanges();
      selection.addRange(previousRange);
    }
  };
  bd.querySelector('.m-ok').onclick = close;
  const handleKeyDown = (e) => {
    e.stopPropagation(); // The editor must not handle keys while reading help.
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    if (e.key === 'Tab') {
      const controls = [content, bd.querySelector('.m-ok')];
      const index = controls.indexOf(document.activeElement);
      e.preventDefault();
      controls[(index + (e.shiftKey ? controls.length - 1 : 1)) % controls.length].focus();
    }
  };
  document.addEventListener('keydown', handleKeyDown, true);
  document.body.appendChild(bd);
  content.focus();
}

/* ================================================================== */
/*  EXPORT + EMAIL                                                     */
/* ================================================================== */

// letters of every script stay (a Russian title keeps its name), only
// punctuation goes
function safeName(s) {
  const clean = (x) => x.replace(/[^\p{L}\p{M}\p{N}_\s-]/gu, '').trim().replace(/\s+/g, '-');
  return clean(s || '') || clean(t('Untitled'));
}

// Every paragraph is rebuilt from its text runs, so exports carry only
// author-meaningful markup: text, bold, italic, alignment, scene breaks.
// Stray spans, inline styles, trailing <br>s, and the no-break spaces the
// old engine planted all stop at this door (healStrayNbsp); the writer's
// own no-break spaces go through.
function parasFromHtml(html) {
  const holder = document.createElement('div');
  holder.innerHTML = html || '';
  // an unwritten outline section is a ghost paragraph plus the scene break
  // NEO planted for it; neither belongs in a book
  holder.querySelectorAll('p.ghost[data-sec-id]').forEach((g) => {
    const brk = holder.querySelector(`p.scene-break[data-sec-brk="${g.dataset.secId}"]`);
    if (brk) brk.remove();
  });
  holder.querySelectorAll('.darling-anchor, .ph-mark, .ghost').forEach((n) => n.remove());
  return [...holder.querySelectorAll('p')].map((p) => {
    const sceneBreak = p.classList.contains('scene-break');
    const poetry = p.classList.contains('poetry');
    const flush = !poetry && p.classList.contains('flush');
    const align = (p.style && p.style.textAlign) || '';
    const runs = paraRuns(p.innerHTML, true).filter((r) => r.text);
    const inner = runs.map((r) => runHtml(r)).join('');
    return {
      sceneBreak,
      poetry,
      flush,
      text: (healStrayNbsp(p), p.innerText).trim(),
      runs,
      align,
      html: `<p${poetry ? ' class="poetry"' : flush ? ' class="flush"' : ''}${align ? ` style="text-align:${align}"` : ''}>${inner}</p>`
    };
  }).filter((p) => p.sceneBreak || p.text);
}

// The book's entries as the builders lay them out. Chapters, a prologue and
// an epilogue are prose under their headings; a part is a page of its own
// (its first line its title); the pages a book carries are set the way books
// set them, and one left blank stays out. `toc` is the table of contents.
// The Contents entry, when the book has one, is where a printed contents
// page goes: what comes before it is the front of the book. Without one,
// the front is the copyright, dedication and epigraph that open the book.
const FRONT_PAGES = ['copyright', 'dedication', 'epigraph'];
function exportChapters() {
  const solo = soloStory();
  const sections = [];
  const toc = [];
  const push = (sec) => { sec.num = sections.length + 1; sections.push(sec); return sec; };
  let parts = 0;
  let inPart = false;
  let contentsAt = -1;
  for (const chId of book.chapterOrder) {
    const kind = chapterKind(chId);
    if (kind === 'part') { parts += 1; inPart = true; } else if (BACK_KINDS.includes(kind)) inPart = false;
    if (kind === 'contents') { if (contentsAt < 0) contentsAt = sections.length; continue; }
    const el = document.querySelector(`.chapter[data-id="${chId}"] .chapter-body`);
    const paras = parasFromHtml(el ? el.innerHTML : (chapterHTML[chId] || ''));
    if (FRONT_PAGES.includes(kind)) {
      if (paras.length) push({ kind, heading: '', label: kindName(kind), level: 0, paras });
      continue;
    }
    if (kind === 'acknowledgments' || kind === 'about') {
      if (!paras.length) continue;
      const sec = push({ kind, heading: kindName(kind), level: 0, paras });
      toc.push({ label: sec.heading, num: sec.num, level: 0, type: 'page' });
      continue;
    }
    if (kind === 'part') {
      // the page's first line is the part's title; what follows, a quote or a verse
      const titled = !!(paras[0] && !paras[0].sceneBreak && !isAttribution(paras[0]));
      const partTitle = titled ? paras[0].text : '';
      const sec = push({ kind: 'part', heading: partLabel(parts), partTitle, level: 0, paras: titled ? paras.slice(1) : paras });
      toc.push({ label: partTitle ? sec.heading + ': ' + partTitle : sec.heading, num: sec.num, level: 0, type: 'part' });
      continue;
    }
    // the story: chapterless stories export as continuous text
    const heading = chId === solo ? '' : chapterHeading(chId);
    const level = inPart ? 1 : 0;
    const sec = push({ kind: 'chapter', heading, paras, role: chapterRole(chId) || '', level, chId });
    toc.push({ label: heading || book.title, num: sec.num, level, type: 'chapter' });
  }
  if (contentsAt >= 0) sections.forEach((sec, i) => { sec.front = i < contentsAt; });
  else for (const sec of sections) { if (!FRONT_PAGES.includes(sec.kind)) break; sec.front = true; }
  return { sections, toc, contents: contentsAt >= 0 };
}

// The open book, packaged for the builders. Every builder takes an optional
// data object in this shape, good for anthologies.
function bookExportData() {
  // an EPUB wants a real UUID as its identifier; the book gets one the first
  // time it's exported and keeps it, so re-exports are the same book
  if (!book.uuid) {
    book.uuid = crypto.randomUUID();
    saveMeta();
  }
  const { sections, toc, contents } = exportChapters();
  return {
    id: book.id,
    uuid: book.uuid,
    title: book.title,
    subtitle: book.subtitle,
    author: book.author || t('Anonymous'), // the screen says so; the files should too
    language: writingLanguage(),
    coverSeed: book.coverSeed,
    coverImage: book.coverImage || null,
    sections,
    toc,
    // a printed contents page only where the writer put one; it lists the
    // chapters too (a book of books lists its titles instead)
    contents,
    contentsChapters: true
  };
}

/* ================================================================== */
/*  PRINT BOOK — a paperback for KDP                                   */
/*  File → Export → Paperback for KDP… lays the open book out as a     */
/*  print-ready interior PDF at one of KDP's four common trim sizes,   */
/*  and a cover template sized to its page count. This builds the      */
/*  book's HTML; main.js (print:paperback) lays it out in pages with   */
/*  Paged.js, hyphenates it, sets the inside margin KDP asks for at    */
/*  that page count, and prints both files.                            */
/* ================================================================== */

const PRINT_TRIMS = [
  { id: '5x8', label: '5 × 8 in', mm: '127 × 203 mm', size: 10.5, outside: 0.6, perPage: 250 },
  { id: '5.25x8', label: '5.25 × 8 in', mm: '133 × 203 mm', size: 10.75, outside: 0.6, perPage: 265 },
  { id: '5.5x8.5', label: '5.5 × 8.5 in', mm: '140 × 216 mm', size: 11, outside: 0.65, perPage: 290 },
  { id: '6x9', label: '6 × 9 in', mm: '152 × 229 mm', size: 11.5, outside: 0.75, perPage: 330 }
];
const PRINT_DIMS = { '5x8': [5, 8], '5.25x8': [5.25, 8], '5.5x8.5': [5.5, 8.5], '6x9': [6, 9] };
// a CSS string, for the running heads
// (a "<" as an escape too, so a name can't close the style block it sits in)
const cssString = (s) => '"' + String(s || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/</g, '\\3c ').replace(/[\n\r]+/g, ' ') + '"';

// The book's pages for print: the title page, the copyright page on its
// back, the dedication and epigraph, the contents where the writer put
// one, the story (each chapter on a right-hand page), the pages at the back,
// then the other books by the same name and a note to the reader.
function buildPrintHtml(d, o) {
  const trim = PRINT_TRIMS.find((x) => x.id === o.trim) || PRINT_TRIMS[0];
  const [W, H] = PRINT_DIMS[trim.id];
  const esc = (s) => escHtml(String(s || ''));
  const cap = (library.fonts || {}).dropcap === 'none' ? '' : exportDropCapFont();
  const year = String(new Date().getFullYear());
  // paragraphs of prose, hyphenated in main.js (class "hy")
  const prose = (paras, opening) => {
    let first = opening;
    let afterBreak = false;
    return paras.map((p) => {
      if (p.sceneBreak) { afterBreak = true; return '<p class="brk">*&#8195;*&#8195;*</p>'; }
      const inner = p.html.replace(/^<p[^>]*>|<\/p>$/g, '');
      if (p.poetry) { afterBreak = false; return `<p class="poetry"${p.align ? ` style="text-align:${p.align}"` : ''}>${inner}</p>`; }
      const cls = ['hy'];
      if (first) cls.push('first');
      if (first && OPENING_DASH.test(p.text)) cls.push('dialogue');
      if (afterBreak || p.flush) cls.push('flush');
      first = false;
      afterBreak = false;
      return `<p class="${cls.join(' ')}"${p.align ? ` style="text-align:${p.align}"` : ''}>${inner}</p>`;
    }).join('\n');
  };
  const lines = (paras) => paras.map((p) => {
    if (p.sceneBreak) return '<p class="brk">*&#8195;*&#8195;*</p>';
    const cls = [isAttribution(p) ? 'attr' : '', p.poetry ? 'poetry' : ''].filter(Boolean).join(' ');
    return `<p${cls ? ` class="${cls}"` : ''}>${p.html.replace(/^<p[^>]*>|<\/p>$/g, '')}</p>`;
  }).join('\n');

  let body = '';
  // the title page (page 1, a right-hand page)
  body += `<section class="fm titlepage"><h1>${esc(d.title)}</h1>${d.subtitle ? `<p class="sub">${esc(d.subtitle)}</p>` : ''}<p class="auth">${esc(d.author)}</p></section>`;
  // its back: the copyright page, the writer's own or the standard one
  const own = d.sections.find((s) => s.kind === 'copyright');
  let copy = own ? lines(own.paras) : [
    t('Copyright © {year} {name}', { year, name: d.author }),
    t('All rights reserved.'),
    t('No part of this book may be reproduced in any form or by any electronic or mechanical means, including information storage and retrieval systems, without written permission from the author, except for the use of brief quotations in a book review.'),
    ...(o.fiction ? [t('This is a work of fiction. Names, characters, places, and incidents either are the products of the author’s imagination or are used fictitiously. Any resemblance to actual persons, living or dead, events, or locales is entirely coincidental.')] : [])
  ].map((x) => `<p>${esc(x)}</p>`).join('\n');
  if (o.isbn && !/ISBN/i.test(copy)) copy += `\n<p>ISBN ${esc(o.isbn)}</p>`;
  body += `<section class="fm copyright"><div class="cp">${copy}</div></section>`;
  // the dedication and the epigraph, each on a right-hand page
  for (const s of d.sections.filter((x) => x.kind === 'dedication' || x.kind === 'epigraph')) {
    body += `<section class="fm ${s.kind}">${lines(s.paras)}</section>`;
  }
  // the contents, where the writer put a Contents page
  if (d.contents && d.toc && d.toc.length) {
    // (a part page before the story's first page has no number to show)
    const firstStory = d.sections.find((x) => x.kind === 'chapter');
    const unnumbered = new Set();
    for (const x of d.sections) { if (x === firstStory) break; unnumbered.add(x.num); }
    body += `<nav class="fm toc"><h2 class="toc-hd">${esc(t('Contents'))}</h2><ol>${d.toc.map((e) => `
      <li class="lv${e.level} t-${e.type}${unnumbered.has(e.num) ? ' nonum' : ''}"><a href="#s${e.num}"><span class="toc-t">${esc(e.label)}</span></a></li>`).join('')}</ol></nav>`;
  }
  // the story, then the pages at the back: the note to the reader first
  // (right after the last page, where a reader decides to say something),
  // then the writer's own pages, then the other books. The back starts on a
  // right-hand page; its pages after that run on, with no blank between.
  const backPages = [];
  // page 1 is the story's first page (a prologue or chapter 1): the pages
  // before it aren't counted, every page after it is, blank or not
  let numbered = false;
  for (const s of d.sections) {
    const id = 's' + s.num;
    if (['copyright', 'dedication', 'epigraph'].includes(s.kind)) continue;
    if (s.kind === 'part') {
      body += `<section class="fm part" id="${id}"><h2><span class="pl">${esc(s.heading)}</span>${s.partTitle ? `<span class="pt">${esc(s.partTitle)}</span>` : ''}</h2>${lines(s.paras)}</section>`;
      continue;
    }
    const back = s.kind === 'acknowledgments' || s.kind === 'about';
    if (back) { backPages.push(s); continue; }
    // a chapter's name and its title on lines of their own
    let label = '';
    let title = s.heading || '';
    if (s.chId && chapterKind(s.chId) !== 'unnumbered') {
      const own = ((book.chapterTitles || {})[s.chId] || '').trim();
      if (!(library.exportCustomChapterTitles && own)) { label = chapterName(s.chId); title = own; }
    }
    // a title that only repeats the label ("Chapter 1" under "Chapter One") isn't printed twice
    const word = label.split(/\s+/)[0];
    if (title && word && (title.toLowerCase() === label.toLowerCase() ||
        new RegExp('^' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s+([0-9]+|[ivxlcdm]+)\\.?$', 'i').test(title))) title = '';
    // "Chapter 7" over "Holston"; a chapter with no title, or a page at
    // the back, is its one line
    let head = '';
    if (label && title) head = `<p class="ch-num">${esc(label)}</p><h2 class="ch-title">${esc(title)}</h2>`;
    else if (label || title) head = `<h2 class="ch-title ch-only">${esc(label || title)}</h2>`;
    if (head) head = `<header class="ch-head">${head}</header>`;
    const pg1 = !back && !numbered;
    if (pg1) numbered = true;
    body += `<section class="${back ? 'backpage' : 'chapter'}${pg1 ? ' pg1' : ''}" id="${id}">${head}${prose(s.paras, !back && !!head)}</section>`;
  }
  const back = [];
  // a note to the reader: a review, and where to find the writer
  const links = o.links || {};
  const reach = [
    links.website && [t('Website'), links.website],
    links.newsletter && [t('Newsletter'), links.newsletter],
    links.email && [t('Email'), links.email],
    ...String(links.social || '').split('\n').map((x) => x.trim()).filter(Boolean).map((x) => ['', x])
  ].filter(Boolean);
  if (o.review || reach.length) {
    back.push(`<section class="backpage note"><header class="ch-head"><h2 class="ch-title ch-only">${esc(t('Thank You for Reading'))}</h2></header>
      ${o.review ? String(o.reviewWords || t('If you enjoyed {title}, please consider leaving a review on Amazon or Goodreads. Even a line or two helps other readers find the book, and it means a great deal to me.', { title: d.title })).split(/\n+/).map((x) => `<p class="hy flush">${esc(x)}</p>`).join('') : ''}
      ${reach.length ? `<p class="reach-hd">${esc(t('Stay in touch'))}</p>${reach.map(([k, v]) => `<p class="reach">${k ? `<span class="k">${esc(k)}</span> ` : ''}${esc(v)}</p>`).join('')}` : ''}
    </section>`);
  }
  // the writer's acknowledgments and about-the-author pages
  for (const s of backPages) {
    back.push(`<section class="backpage" id="s${s.num}"><header class="ch-head"><h2 class="ch-title ch-only">${esc(s.heading)}</h2></header>${prose(s.paras, false)}</section>`);
  }
  // other books by this name
  if (o.alsoBy && o.alsoBy.length) {
    back.push(`<section class="backpage also"><header class="ch-head"><h2 class="ch-title ch-only">${esc(t('Also by {author}', { author: d.author }))}</h2></header>${o.alsoBy.map((x) => `<p>${esc(x)}</p>`).join('')}</section>`);
  }
  body += back.map((x, i) => (i ? x.replace('class="backpage', 'class="backpage run-on') : x)).join('\n');

  const sz = trim.size;
  return `<!DOCTYPE html>
<html lang="${esc(d.language || writingLanguage())}"><head><meta charset="utf-8"><title>${esc(d.title)}</title>
<style>
${o.fonts || ''}
@page { size: ${W}in ${H}in; margin: 0.7in ${trim.outside}in 0.75in ${trim.outside}in; }
@page :left {
  margin-left: ${trim.outside}in; margin-right: __NEO_GUTTER__;
  @top-center { content: ${cssString(d.author)}; }
  @bottom-center { content: counter(page); }
}
@page :right {
  margin-left: __NEO_GUTTER__; margin-right: ${trim.outside}in;
  @top-center { content: ${cssString(d.title)}; }
  @bottom-center { content: counter(page); }
}
@page { @top-center { font-family: ${exportBodyFont()}; font-size: ${(sz * 0.7).toFixed(2)}pt; letter-spacing: 0.16em; text-transform: uppercase; color: #333; vertical-align: bottom; padding-bottom: 0.18in; }
        @bottom-center { font-family: ${exportBodyFont()}; font-size: ${(sz * 0.82).toFixed(2)}pt; color: #333; vertical-align: top; padding-top: 0.2in; } }
@page :blank { @top-center { content: none; } @bottom-center { content: none; } }
@page front { @top-center { content: none; } @bottom-center { content: none; } }
@page chapter:first { @top-center { content: none; } }
@page back { @top-center { content: none; } }
html, body { margin: 0; padding: 0; }
body { font-family: ${exportBodyFont()}; font-size: ${sz}pt; line-height: 1.42; color: #000; font-kerning: normal; font-variant-ligatures: common-ligatures; }
p { margin: 0; orphans: 2; widows: 2; }
.fm { page: front; break-before: right; text-align: center; }
.titlepage { padding-top: 1.6in; }
.titlepage h1 { font-size: ${(sz * 2.3).toFixed(1)}pt; line-height: 1.15; font-weight: normal; margin: 0; }
.titlepage .sub { font-style: italic; font-size: ${(sz * 1.15).toFixed(1)}pt; margin-top: 0.18in; }
.titlepage .auth { margin-top: 1.3in; font-size: ${(sz * 0.95).toFixed(1)}pt; letter-spacing: 0.2em; text-transform: uppercase; }
.copyright { break-before: left; text-align: left; height: ${(H - 0.7 - 0.75 - 0.05).toFixed(2)}in; position: relative; }
.copyright .cp { position: absolute; left: 0; right: 0; bottom: 0; font-size: ${(sz * 0.78).toFixed(2)}pt; line-height: 1.5; }
.copyright .cp p { margin: 0 0 0.75em; }
.dedication, .epigraph { padding-top: 1.7in; font-style: italic; }
.dedication p, .epigraph p { margin: 0 0 0.6em; }
.epigraph p.attr { font-style: normal; font-size: 0.9em; letter-spacing: 0.04em; margin-top: 0.8em; }
.toc { text-align: left; padding-top: 0.6in; }
.toc-hd { text-align: center; font-weight: normal; font-size: ${(sz * 1.05).toFixed(1)}pt; letter-spacing: 0.22em; text-transform: uppercase; margin: 0 0 0.45in; }
.toc ol { list-style: none; margin: 0; padding: 0; }
.toc li { margin: 0 0 0.35em; }
.toc li.lv1 { padding-left: 1.2em; }
.toc li.t-part { margin-top: 0.9em; letter-spacing: 0.1em; text-transform: uppercase; font-size: 0.92em; }
.toc a { color: inherit; text-decoration: none; display: flex; }
.toc .toc-t { flex: 1; }
.toc a::after { content: target-counter(attr(href url), page); padding-left: 1em; font-variant-numeric: lining-nums tabular-nums; }
.toc li.nonum a::after { content: none; }
.pg1 { counter-reset: page 1; }
.part { padding-top: 2.1in; }
.part h2 { font-weight: normal; margin: 0 0 0.5in; }
.part .pl { display: block; font-size: ${(sz * 1.05).toFixed(1)}pt; letter-spacing: 0.24em; text-transform: uppercase; }
.part .pt { display: block; font-size: ${(sz * 1.9).toFixed(1)}pt; line-height: 1.2; margin-top: 0.2in; }
.part p { font-style: italic; margin: 0 0.3in 0.6em; }
.chapter { page: chapter; break-before: right; }
.backpage { page: back; break-before: right; }
.backpage.run-on { break-before: page; }
.ch-head { padding-top: 1.35in; margin-bottom: 0.42in; text-align: center; break-after: avoid; }
.ch-num { font-size: ${(sz * 0.95).toFixed(1)}pt; letter-spacing: 0.24em; text-transform: uppercase; margin: 0 0 0.16in; }
.ch-title { font-weight: normal; font-size: ${(sz * 1.6).toFixed(1)}pt; line-height: 1.2; margin: 0; }
.ch-title.ch-only { font-size: ${(sz * 1.35).toFixed(1)}pt; letter-spacing: 0.06em; }
p.hy { text-align: justify; text-indent: 1.5em; hyphens: manual; -webkit-hyphens: manual; text-wrap: pretty; }
p.hy.first, p.hy.flush { text-indent: 0; }
${cap ? `p.first:not(.dialogue)::first-letter { initial-letter: 2; -webkit-initial-letter: 2; font-family: ${cap}; padding-right: 0.06em; }` : ''}
p.brk { text-align: center; margin: 0.7em 0; break-after: avoid; letter-spacing: 0.1em; }
p.poetry { margin: 0.5em 1.5em; text-align: left; }
p.poetry + p.poetry { margin-top: 0; }
.backpage p.hy { text-indent: 0; margin-bottom: 0.7em; }
.also p { text-align: center; font-style: italic; margin: 0 0 0.45em; }
.note .reach-hd { margin-top: 1.4em; text-align: center; letter-spacing: 0.18em; text-transform: uppercase; font-size: 0.85em; }
.note .reach { text-align: center; margin-top: 0.35em; }
.note .reach .k { font-variant-caps: all-small-caps; letter-spacing: 0.08em; }
.neo-pad { page: front; break-before: page; height: 1px; }
</style></head><body>
${body}
</body></html>`;
}

// File → Export → Paperback for KDP…: the size, the paper, and what goes
// at the back. The choices are kept: the book's with the book, the
// contact details with the name it's written under.
async function printPaperback() {
  if (!book) return;
  if (isScript()) { toast(t('A script exports as a PDF, Fountain or Final Draft; paperbacks are for books')); return; }
  // one at a time: the pages are set in a single window
  if (printPaperback.busy) { toast(t('Still setting the pages of the last paperback…')); return; }
  flushAllSaves();
  const author = currentAuthor();
  const bp = book.print || {};
  const ap = author.print || {};
  const hasDedication = book.chapterOrder.some((c) => chapterKind(c) === 'dedication');
  // the other books written under this name, newest first
  const others = [];
  for (const s of shelvesFor(author.id)) {
    for (const id of s.bookIds) {
      if (id === book.id) continue;
      const m = await shelfMeta(id);
      if (!m || isPageMeta(m) || isScript(m) || isUntitled(m.title)) continue;
      others.push({ id, title: m.title });
    }
  }
  // the Also by list is the writer's own, one title per line: it starts as
  // this name's other books in NEO, and can hold books written before NEO
  const alsoText = typeof ap.alsoByText === 'string' ? ap.alsoByText
    : Array.isArray(ap.alsoBy) ? others.filter((x) => ap.alsoBy.includes(x.id)).map((x) => x.title).join('\n')
      : others.map((x) => x.title).join('\n');
  const reviewDefault = t('If you enjoyed {title}, please consider leaving a review on Amazon or Goodreads. Even a line or two helps other readers find the book, and it means a great deal to me.', { title: book.title });
  const reviewText = ap.reviewText ? ap.reviewText.split('{title}').join(book.title) : reviewDefault;
  const field = (id, label, value, ph = '') => `<label>${label}<input id="${id}" type="text" spellcheck="false" value="${escHtml(value || '').replace(/"/g, '&quot;')}" placeholder="${escHtml(ph).replace(/"/g, '&quot;')}"/></label>`;
  const bd = document.createElement('div');
  bd.className = 'modal-backdrop';
  bd.innerHTML = `
    <div class="modal print-modal" style="width:560px">
      <h2 style="font-size:17px">${t('Paperback for KDP')}</h2>
      <p class="pm-hint">${t('A print-ready interior PDF and a cover template sized to its page count, for Amazon KDP.')}</p>
      <div class="pm-row pm-trims">${PRINT_TRIMS.map((x) => `
        <button type="button" class="fr-choice${(bp.trim || '5.5x8.5') === x.id ? ' sel' : ''}" data-trim="${x.id}"><strong>${x.label}</strong><span>${x.mm}</span></button>`).join('')}
      </div>
      <div class="pm-row">
        <label>${t('Paper')}
          <select id="pm-paper">
            ${[['cream', t('Cream')], ['white', t('White')], ['groundwood', t('Groundwood')]].map(([v, l]) => `<option value="${v}"${(bp.paper || 'cream') === v ? ' selected' : ''}>${l}</option>`).join('')}
          </select>
        </label>
        ${field('pm-isbn', t('ISBN (optional)'), bp.isbn, '979-8-…')}
      </div>
      <label class="pm-check"><input id="pm-fiction" type="checkbox"${bp.fiction !== false ? ' checked' : ''}/> ${t('The standard fiction notice on the copyright page')}</label>
      ${hasDedication ? '' : field('pm-dedication', t('Dedication (optional)'), '', t('For…'))}
      <h3>${t('At the back of the book, for {name}', { name: escHtml(author.name || displayAuthor()) })}</h3>
      <div class="pm-review-row"><label class="pm-check"><input id="pm-review" type="checkbox"${ap.review !== false ? ' checked' : ''}/> ${t('Ask readers for a review')}</label><button type="button" class="pm-edit btn-quiet">${t('Edit wording')}</button></div>
      <textarea id="pm-review-text" rows="3" hidden>${escHtml(reviewText)}</textarea>
      <div class="pm-row">
        ${field('pm-web', t('Website'), ap.website, 'example.com')}
        ${field('pm-news', t('Newsletter'), ap.newsletter, 'example.com/newsletter')}
      </div>
      <div class="pm-row">
        ${field('pm-email', t('Email'), ap.email)}
        <label>${t('Social media, one per line')}<textarea id="pm-social" rows="2" spellcheck="false">${escHtml(ap.social || '')}</textarea></label>
      </div>
      <label class="pm-also">${t('Also by {name}, one title per line', { name: escHtml(author.name || displayAuthor()) })}<textarea id="pm-also" rows="4" spellcheck="false">${escHtml(alsoText)}</textarea></label>
      <div style="text-align:right;margin-top:14px">
        <button class="m-cancel btn-quiet" style="margin-right:10px">${t('Cancel')}</button>
        <button class="m-ok btn-gold">${t('Make PDFs')}</button>
      </div>
    </div>`;
  document.body.appendChild(bd);
  bd.querySelector('.pm-edit').onclick = (e) => {
    const ta = bd.querySelector('#pm-review-text');
    ta.hidden = false;
    e.currentTarget.hidden = true;
    ta.focus();
  };
  let trim = bp.trim || '5.5x8.5';
  const selTrim = bd.querySelector('.fr-choice.sel');
  if (selTrim) selTrim.focus({ preventScroll: true });
  for (const b of bd.querySelectorAll('[data-trim]')) {
    b.onclick = () => { trim = b.dataset.trim; b.focus({ preventScroll: true }); bd.querySelectorAll('[data-trim]').forEach((x) => x.classList.toggle('sel', x === b)); };
  }
  const go = await new Promise((resolve) => {
    bd.querySelector('.m-ok').onclick = () => resolve(true);
    bd.querySelector('.m-cancel').onclick = () => resolve(false);
    bd.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); resolve(false); } });
  });
  const val = (id) => { const el = bd.querySelector('#' + id); return el ? el.value.trim() : ''; };
  const opts = {
    trim,
    paper: val('pm-paper') || 'cream',
    isbn: val('pm-isbn'),
    fiction: bd.querySelector('#pm-fiction').checked,
    review: bd.querySelector('#pm-review').checked,
    links: { website: val('pm-web'), newsletter: val('pm-news'), email: val('pm-email'), social: bd.querySelector('#pm-social').value.trim() },
    alsoByText: bd.querySelector('#pm-also').value.replace(/\r/g, '').split('\n').map((x) => x.trim()).filter(Boolean).join('\n'),
    reviewText: bd.querySelector('#pm-review-text').value.trim(),
    dedication: val('pm-dedication')
  };
  bd.remove();
  if (!go) return;
  // kept for next time
  book.print = { trim: opts.trim, paper: opts.paper, isbn: opts.isbn, fiction: opts.fiction };
  // The wording is kept with the title as a blank, so it fits the next
  // book. Left as it came, it stays what it was (NEO's own wording follows
  // its translations); edited, the book's title where it stands as a whole
  // becomes the blank again.
  let ownWording = ap.reviewText || '';
  if (opts.reviewText && opts.reviewText !== reviewText) {
    const tt = book.title.trim();
    const esc = tt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    ownWording = opts.reviewText === reviewDefault ? ''
      : tt.length > 1 ? opts.reviewText.replace(new RegExp('(^|[^\\p{L}\\p{N}])' + esc + '(?![\\p{L}\\p{N}])', 'gu'), '$1{title}') : opts.reviewText;
  }
  author.print = { review: opts.review, ...opts.links, alsoByText: opts.alsoByText, reviewText: ownWording };
  await saveMeta();
  await writeLibrary(library);
  // a dedication typed here becomes the book's own Dedication page
  if (opts.dedication && !hasDedication) {
    const at = book.chapterOrder.findIndex((c) => !['copyright'].includes(chapterKind(c)));
    const chId = newEntryId();
    book.chapterOrder.splice(at < 0 ? 0 : at, 0, chId);
    setChapterKind(chId, 'dedication');
    setChapterHTML(chId, `<p>${escHtml(opts.dedication)}</p>`, 'new');
    await persistChapter(chId);
    await saveMeta();
    renderChapters();
  }
  const d = bookExportData();
  opts.alsoBy = opts.alsoByText ? opts.alsoByText.split('\n') : [];
  opts.reviewWords = opts.reviewText || reviewDefault;
  const words = d.sections.reduce((n, s) => n + s.paras.reduce((m, p) => m + countWords(p.text || ''), 0), 0);
  const per = (PRINT_TRIMS.find((x) => x.id === opts.trim) || PRINT_TRIMS[0]).perPage;
  toast(t('Setting the pages…'), 600000);
  printPaperback.busy = true;
  try {
    const html = buildPrintHtml(d, { ...opts, fonts: await exportFontFaces(d) });
    const r = await window.neo.printPaperback({
      html, trim: opts.trim, paper: opts.paper, language: d.language,
      pagesGuess: Math.round(words / per) + d.sections.length * 1.5 + 8,
      title: d.title, author: d.author,
      defaultName: safeName(d.title) + ' - ' + t('paperback') + ' ' + opts.trim
    });
    if (!r) { toast(t('Not saved')); return; }
    let msg = t('Saved the interior ({pages} pages) and its cover template (spine {spine} in)', { pages: r.pages, spine: r.spine });
    if (r.tooFew) msg += ' · ' + t('KDP needs at least 24 pages');
    if (r.tooMany) msg += ' · ' + t('more pages than KDP prints on this paper');
    toast(msg, 9000);
  } catch (err) {
    window.neo.logError('paperback: ' + (err && err.stack || err));
    toast(t('Couldn’t export: {error}', { error: plainError(err) }), 8000);
  } finally {
    printPaperback.busy = false;
  }
}

// One chapter, on its own: the book's title page, then that chapter, headed
// as it is in the book (Chapter 7 — Holston). No cover image in a web page
// or PDF; an EPUB keeps the book's cover, since e-readers expect one.
function chapterExportData(chId) {
  const d = bookExportData();
  const sec = d.sections.find((s) => s.kind === 'chapter' && s.chId === chId);
  if (!sec) return null;
  Object.assign(sec, { num: 1, level: 0, front: false });
  return {
    ...d,
    sections: [sec],
    toc: [{ label: sec.heading || d.title, num: 1, level: 0, type: 'chapter' }],
    contents: false,
    chapterOnly: sec.heading || chapterName(chId)
  };
}

// a heading as plain text: a part's name with its title
const plainHeading = (ch) => (ch.partTitle ? `${ch.heading}: ${ch.partTitle}` : ch.heading);

function buildTxt(data) {
  const d = data || bookExportData();
  let out = `${d.title.toUpperCase()}\n`;
  if (d.subtitle) out += `${d.subtitle}\n`;
  out += t('by {author}', { author: d.author }) + '\n\n\n';
  for (const ch of d.sections) {
    if (ch.heading) out += `${plainHeading(ch).toUpperCase()}\n\n`;
    for (const p of ch.paras) out += p.sceneBreak ? '\n***\n\n' : (p.poetry ? '    ' : '') + p.text + '\n\n';
    out += '\n';
  }
  return out;
}

function buildMd(data) {
  const d = data || bookExportData();
  // a title like "Wool *Omnibus*" must not turn into markup (idea: nejcc, #70)
  const mdMeta = (s) => String(s || '').replace(/([\\`*_\[\]#<>])/g, '\\$1');
  // wrap a run in emphasis markers, keeping boundary spaces outside them
  // Markdown has strikethrough; underline goes as HTML, which it allows
  const mdMarks = [{ key: 'b', open: '**', close: '**' }, { key: 'i', open: '*', close: '*' },
    { key: 's', open: '~~', close: '~~' }, { key: 'u', open: '<u>', close: '</u>' }];
  const mdRuns = (runs) => markedRuns(runs, mdMarks, (t) => t.replace(/([\\*_`~])/g, '\\$1'));
  let out = `# ${mdMeta(d.title)}\n\n`;
  if (d.subtitle) out += `*${mdMeta(d.subtitle)}*\n\n`;
  out += `**${t('by {author}', { author: mdMeta(d.author) })}**\n\n`;
  for (const ch of d.sections) {
    if (ch.heading) out += `\n## ${mdMeta(plainHeading(ch))}\n\n`;
    for (const p of ch.paras) {
      out += p.sceneBreak ? '\n***\n\n' : (p.poetry ? '> ' : '') + mdRuns(p.runs) + '\n\n';
    }
  }
  return out;
}

// The Web Page and PDF read in the page's own typeface. A face NEO ships
// (the @font-face rules in styles.css, the body fonts on Linux) travels
// inside the file, so the PDF matches the page on any machine; a font the
// computer has goes by name, with the same fallbacks as the page.
const exportBodyFont = () => (getComputedStyle(document.documentElement).getPropertyValue('--body-font').trim() || 'Georgia, serif').replace(/[<>{};]/g, '');
// the drop cap too: its face is the page's, bundled or the computer's
const exportDropCapFont = () => (getComputedStyle(document.documentElement).getPropertyValue('--dropcap-font').trim() || 'Georgia, serif').replace(/[<>{};]/g, '');
const firstFamily = (stack) => stack.split(',')[0].trim().replace(/^["']|["']$/g, '');
async function exportFontFaces(d) {
  const family = firstFamily(exportBodyFont());
  // the drop cap sets one letter, upright and regular
  const cap = (library.fonts || {}).dropcap === 'none' ? '' : firstFamily(exportDropCapFont());
  const text = d.sections.map((ch) => ch.paras.map((p) => p.html).join('')).join('');
  // (the title is always bold; a dedication, an epigraph, a part's lines
  // and a title's subtitle are set in italic)
  const italic = !!d.subtitle || /<i[\s>]/.test(text)
    || d.sections.some((ch) => ['dedication', 'epigraph', 'part'].includes(ch.kind) || ch.subtitle);
  const boldItalic = italic && /<b[\s>]/.test(text);
  let css = '';
  for (const sheet of document.styleSheets) {
    let rules = [];
    try { rules = [...sheet.cssRules]; } catch { continue; }
    for (const r of rules) {
      if (!(r instanceof CSSFontFaceRule)) continue;
      const name = r.style.getPropertyValue('font-family').replace(/["']/g, '').trim();
      const style = r.style.getPropertyValue('font-style') || 'normal';
      const weight = r.style.getPropertyValue('font-weight') || '400';
      const forBody = name === family && !(style === 'italic' && !(parseInt(weight, 10) >= 600 ? boldItalic : italic));
      const forCap = name === cap && style === 'normal' && parseInt(weight, 10) === 400;
      if (!forBody && !forCap) continue;
      const src = r.style.getPropertyValue('src').match(/url\(["']?([^"')]+)["']?\)\s*(format\([^)]*\))?/);
      if (!src) continue;
      // a Russian face keeps its range and its measures, or it would stand
      // in for the Latin one at the Latin one's size
      const fit = ['unicode-range', 'size-adjust', 'ascent-override', 'descent-override', 'line-gap-override']
        .map((k) => r.style.getPropertyValue(k) && ` ${k}: ${r.style.getPropertyValue(k)};`).filter(Boolean).join('');
      try {
        const bytes = new Uint8Array(await (await fetch(new URL(src[1], sheet.href || location.href))).arrayBuffer());
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        const ext = src[1].split('.').pop().toLowerCase();
        css += `@font-face { font-family: '${name}'; src: url(data:font/${ext};base64,${btoa(bin)}) ${src[2] || ''}; font-weight: ${weight}; font-style: ${style};${fit} }\n`;
      } catch { /* the name still stands, with its fallbacks */ }
    }
  }
  return css;
}

// The pages of a book that aren't chapters, set the way books set them.
// A line that opens with a dash says who said the lines above it.
const isAttribution = (p) => /^(?:[—–]|--?\s)/.test(p.text || '');
// a section's heading level follows the contents: a part, the titles in
// it, their chapters (a single book's chapters are all level 0)
const headTag = (ch) => 'h' + Math.min(6, 2 + (ch.level || 0));

function buildHtml(data, opts = {}) {
  const d = data || bookExportData();
  const total = d.sections.filter((ch) => (ch.kind || 'chapter') === 'chapter')
    .reduce((s, ch) => s + ch.paras.reduce((n, p) => n + countWords(p.text || ''), 0), 0);
  const stamp = new Date().toLocaleString(NeoI18n.getLocale());
  // a chapter's text: only its opening paragraph gets the enlarged initial,
  // scene breaks resume ordinary body text
  const prose = (paras, initial) => {
    let first = initial;
    let afterBreak = false; // a story's line of speech after *** keeps its indent
    return paras.map((p) => {
      if (p.sceneBreak) { afterBreak = initial; return '<p class="brk">***</p>'; }
      if (p.poetry) { afterBreak = false; return p.html; }
      let html = p.html;
      if (first || afterBreak) {
        const h = document.createElement('div');
        h.innerHTML = html;
        if (h.firstElementChild) {
          if (first) h.firstElementChild.classList.add('first');
          if (OPENING_DASH.test(h.textContent)) h.firstElementChild.classList.add('dialogue');
          html = h.innerHTML;
        }
      }
      first = false;
      afterBreak = false;
      return html;
    }).join('\n');
  };
  // a page's lines, each set on its own
  const lines = (paras, attrs = true) => paras.map((p) => {
    if (p.sceneBreak) return '<p class="brk">***</p>';
    const cls = [attrs && isAttribution(p) ? 'attr' : '', p.poetry ? 'poetry' : ''].filter(Boolean).join(' ');
    return `<p${cls ? ` class="${cls}"` : ''}${p.align ? ` style="text-align:${p.align}"` : ''}>${p.html.replace(/^<p[^>]*>|<\/p>$/g, '')}</p>`;
  }).join('\n');
  // In the PDF, page 1 is the story's first page (a prologue or chapter 1):
  // the pages before it aren't counted; after it every page is, though a
  // page like a part's title still shows no number
  const firstStory = d.sections.find((x) => (x.kind || 'chapter') === 'chapter');
  let counting = false;
  const sectionHtml = (ch) => {
    const id = 's' + ch.num;
    const h = headTag(ch);
    const kind = ch.kind || 'chapter';
    if (ch === firstStory) counting = true;
    const counted = counting ? ' counted' : '';
    if (kind === 'copyright' || kind === 'dedication' || kind === 'epigraph') {
      return `
    <section class="page ${kind}${counted}" id="${id}"><div class="pg-in">${lines(ch.paras, kind !== 'copyright')}</div></section>`;
    }
    if (kind === 'part') {
      // the separator is there for the PDF's bookmarks ("Part I: Title"),
      // not for the eye
      return `
    <section class="page part${counted}" id="${id}">
      <${h} class="hd"><span class="pl">${escHtml(ch.heading)}</span>${ch.partTitle ? `<span class="sep">: </span><span class="pt">${escHtml(ch.partTitle)}</span>` : ''}</${h}>
      ${lines(ch.paras)}
    </section>`;
    }
    if (kind === 'opener') {
      return `
    <section class="page opener${counted}" id="${id}">
      <${h} class="hd">${escHtml(ch.heading)}</${h}>
      ${ch.subtitle ? `<p class="sub">${escHtml(ch.subtitle)}</p>` : ''}
      ${ch.byline ? `<p class="byline">${escHtml(ch.byline)}</p>` : ''}
    </section>`;
    }
    const back = kind === 'acknowledgments' || kind === 'about';
    return `
    <section class="chapter${back ? ' backpage' : ''}" id="${id}">
      ${ch.heading ? `<${h} class="hd">${escHtml(ch.heading)}</${h}>` : ''}
      ${ch.byline ? `<p class="byline">${escHtml(ch.byline)}</p>` : ''}
      ${prose(ch.paras, !back)}
    </section>`;
  };
  // Contents: the parts, the titles and the pages at the back. The page
  // numbers are filled in by the PDF printer (main.js), which prints the
  // book once to learn where everything landed.
  const contents = d.contents && d.toc && d.toc.length ? `
    <nav class="contents">
      <h2 class="hd">${escHtml(t('Contents'))}</h2>
      <ol>${d.toc.filter((e) => d.contentsChapters || e.type !== 'chapter').map((e) => `
        <li class="lv${e.level} t-${e.type}"><a href="#s${e.num}"><span class="toc-t">${escHtml(e.label)}</span><span class="toc-pg" data-for="s${e.num}"></span></a></li>`).join('')}
      </ol>${firstStory ? `<a class="p1-ref" href="#s${firstStory.num}" data-p1="s${firstStory.num}" aria-hidden="true" tabindex="-1">.</a>` : ''}
    </nav>` : '';
  // the contents follow the pages at the front of the book
  let body = '';
  let placed = !contents;
  for (const ch of d.sections) {
    if (!placed && !ch.front) { body += contents; placed = true; }
    body += sectionHtml(ch);
  }
  if (!placed) body += contents;
  return `<!DOCTYPE html>
<html lang="${escHtml(d.language || writingLanguage())}"><head><meta charset="utf-8"><title>${escHtml(d.title)}</title>
<style>
  ${opts.fonts || ''}
  body { font-family: ${exportBodyFont()}; color: #1c1c1c; max-width: 620px; margin: 40px auto; line-height: 1.7; font-size: 13pt; }
  .coverpage { text-align: center; margin: 0 0 40px; page-break-after: always; }
  .coverpage img { display: block; margin: 0 auto; width: 100%; max-width: 620px; max-height: 95vh; object-fit: contain; }
  .titlepage { text-align: center; margin: 30vh 0 20vh; page-break-after: always; }
  .titlepage h1 { font-size: 30pt; margin: 0; }
  .titlepage .sub { font-style: italic; color: #555; }
  .titlepage .auth { margin-top: 40px; letter-spacing: 3px; text-transform: uppercase; font-size: 11pt; }
  .chapter { page-break-before: always; }
  /* headings in small capitals rather than capitals, so the PDF's bookmarks
     read "Chapter 3", not "CHAPTER 3" */
  .chapter .hd, .contents .hd { text-align: center; letter-spacing: 4px; font-variant-caps: all-small-caps; font-variant-numeric: oldstyle-nums; font-size: 17pt; font-weight: normal; color: #555; margin: 54px 0 36px; }
  /* set like a printed book: justified, hyphenated in the book's language,
     no line left alone at the top or foot of a page */
  .chapter p { text-indent: 2em; margin: 0; text-align: justify; hyphens: auto; -webkit-hyphens: auto; widows: 2; orphans: 2; }
  .chapter p.poetry { text-align: left; hyphens: manual; -webkit-hyphens: manual; }
  .chapter .hd + p, .chapter .byline + p, .chapter .brk + p, .brk + p, .chapter p.first { text-indent: 0; }
  .chapter p.dialogue { text-indent: 2em; }
  /* the drop cap the page sets, two lines deep in its own face. An initial
     letter, not a float: it stays inside its word, so the PDF's copy,
     search, and screen readers still find "The" where a float leaves "T"
     and "he" (a gap much wider than 4px splits the word again). A browser
     that can't set one gets a raised initial. */
  ${(library.fonts || {}).dropcap === 'none' ? '' : `.chapter p.first:not(.dialogue)::first-letter { -webkit-initial-letter: 2; initial-letter: 2; padding-right: 4px; font-family: ${exportDropCapFont()}; }
  @supports not ((initial-letter: 2) or (-webkit-initial-letter: 2)) { .chapter p.first:not(.dialogue)::first-letter { font-size: 1.8em; line-height: 1; padding-right: 0; } }`}
  .chapter .brk, .brk { text-align: center; text-indent: 0 !important; letter-spacing: 8px; color: #888; margin: 2.5em 0; }
  .chapter p.poetry { text-indent: 0; margin: 0 2.5em; }
  .chapter p.flush { text-indent: 0 !important; }
  .chapter p:not(.poetry) + p.poetry, .chapter .hd + p.poetry { margin-top: 0.9em; }
  .chapter p.poetry + p:not(.poetry) { margin-top: 0.9em; }
  .chapter p.byline { text-align: center; margin: -24px 0 40px; letter-spacing: 3px; text-transform: uppercase; font-size: 10pt; color: #555; }
  /* the pages that aren't chapters */
  .page { page-break-before: always; text-align: center; }
  .page p { margin: 0 0 0.5em; }
  .page p.poetry { margin: 0 0 0.2em; }
  .page p.attr { font-style: normal; font-size: 10pt; letter-spacing: 1px; margin-top: 1.2em; }
  .page .brk { margin: 1.2em 0; }
  .copyright { min-height: 98vh; display: flex; flex-direction: column; justify-content: flex-end; text-align: left; font-size: 9pt; line-height: 1.6; color: #333; }
  .copyright p { margin: 0 0 0.9em; }
  .dedication { padding-top: 26vh; font-style: italic; }
  .epigraph { padding-top: 24vh; margin: 0 3em; font-style: italic; }
  .part { padding-top: 28vh; }
  .part .hd { font-weight: normal; margin: 0 0 2.4em; }
  .part .pl { display: block; font-size: 15.5pt; letter-spacing: 5px; font-variant-caps: all-small-caps; color: #555; }
  .part .sep { color: transparent; font-size: 1px; line-height: 0; white-space: pre; }
  .part .pt { display: block; font-size: 24pt; line-height: 1.25; margin-top: 14px; }
  .part p { font-style: italic; margin-left: 3em; margin-right: 3em; }
  .dedication i, .epigraph i, .part p i { font-style: normal; }
  .opener { padding-top: 28vh; }
  .opener .hd { font-size: 26pt; font-weight: normal; line-height: 1.25; margin: 0; }
  .opener .sub { font-style: italic; color: #555; margin-top: 12px; }
  .opener .byline { margin-top: 40px; letter-spacing: 3px; text-transform: uppercase; font-size: 10pt; }
  .contents { page-break-before: always; }
  .contents ol { list-style: none; margin: 0 1.5em; padding: 0; }
  .contents li { margin: 0.3em 0; }
  .contents a { display: flex; align-items: baseline; color: inherit; text-decoration: none; }
  .contents .toc-t { flex: 1; }
  .contents .toc-pg { flex: none; width: 3em; text-align: right; font-size: 13pt; font-variant-numeric: lining-nums tabular-nums; }
  .contents li.lv1 { margin-left: 1.6em; }
  .contents li.lv2 { margin-left: 3.2em; }
  .contents li.t-part { margin-top: 1.1em; font-size: 15pt; line-height: 1.5; letter-spacing: 2px; font-variant-caps: all-small-caps; }
  .contents li:not(.t-page) + li.t-page { margin-top: 1.2em; }
  .prov { margin-top: 80px; text-align: center; color: #999; font-size: 9pt; }
  /* printed pages carry their number at the foot; the cover, the title
     page and the pages that aren't chapters don't, the way books do it
     (only the PDF uses these rules) */
  @page { @bottom-center { content: counter(page); font-family: ${exportBodyFont()}; font-size: 9pt; color: #777; } }
  @page front { counter-increment: page 0; @bottom-center { content: none; } }
  @page quiet { @bottom-center { content: none; } }
  .coverpage, .titlepage, .page, .contents { page: front; }
  .page.counted { page: quiet; }
  /* (the link that tells the printer where page 1 is, unseen) */
  .contents .p1-ref { position: absolute; color: transparent; font-size: 1px; text-decoration: none; }
</style></head><body>
${opts.cover ? `<div class="coverpage"><img src="data:${opts.cover.mime};base64,${opts.cover.base64}" alt="${t('Cover')}"/></div>` : ''}
<div class="titlepage"><h1>${escHtml(d.title)}</h1>
${d.subtitle ? `<p class="sub">${escHtml(d.subtitle)}</p>` : ''}
<p class="auth">${escHtml(d.author)}</p></div>
${body}
${opts.stamp ? `<p class="prov">${t('{n} words · exported from NEO on {date}', { n: total, date: stamp })}</p>` : ''}
</body></html>`;
}

/* ---------- runs: paragraphs broken into styled text pieces ---------- */

// (characters XML 1.0 forbids, pasted in from a PDF or a terminal, come
// out: one of them makes a whole EPUB or Word file unreadable)
const escXml = (s) => String(s)
  // oxlint-disable-next-line no-control-regex
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

// Walk a paragraph's DOM and emit [{text, b, i}] so docx/epub get real bold/italic.
// In the manuscript an italic inside an italic is emphasis in a poetry
// paragraph (itself one italic), and it is set upright, the typesetter's
// way (flip). Pasted HTML often doubles its italics for nothing; not there.
// a run's text in the manuscript's own inline tags
function runHtml(r, esc = escHtml) {
  if (r.br) return '<br>';
  let t = esc(r.text);
  if (r.s) t = '<s>' + t + '</s>';
  if (r.u) t = '<u>' + t + '</u>';
  if (r.i) t = '<i>' + t + '</i>';
  if (r.b) t = '<b>' + t + '</b>';
  return t;
}
// A no-break space the writer put between two words (Dr. Müller, 5 km, a
// space that keeps a dash off the start of a line) stays wherever the text
// goes. The old editing engine planted others, beside a plain space or at
// a line's start or end, to hold doubled spaces open; those turn back into
// plain spaces. Paragraph by paragraph, so a space at the edge of italics
// still sees its neighbours.
function healStrayNbsp(root) {
  let blocks = root.querySelectorAll ? [...root.querySelectorAll('p')] : [];
  if (!blocks.length) blocks = [root];
  let changed = false;
  for (const block of blocks) {
    const nodes = [];
    const w = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) nodes.push(n);
    const all = nodes.map((x) => x.data).join('');
    if (!all.includes('\u00a0')) continue;
    const open = (c) => c === undefined || /\s/.test(c); // \s takes in no-break spaces too
    let at = 0;
    for (const x of nodes) {
      const d = x.data;
      let out = '';
      for (let i = 0; i < d.length; i++) {
        out += d[i] === '\u00a0' && (open(all[at + i - 1]) || open(all[at + i + 1])) ? ' ' : d[i];
      }
      at += d.length;
      if (out !== d) { x.data = out; changed = true; }
    }
  }
  return changed;
}
function paraRuns(pHtml, flip) {
  const holder = document.createElement('template'); // inert: nothing loads or runs
  holder.innerHTML = pHtml;
  healStrayNbsp(holder.content);
  const runs = [];
  const walk = (node, b, i, u, x) => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        if (child.textContent) runs.push({ text: child.textContent, b, i, u, s: x });
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        if (child.classList && child.classList.contains('ph-mark')) {
          runs.push({ mark: child.dataset.sid || '' });
          continue;
        }
        const tag = child.tagName;
        // a line break inside a paragraph (a chapter file written elsewhere)
        // stays a break, not two words run together
        if (tag === 'BR') {
          const rest = document.createRange();
          rest.setStartAfter(child);
          rest.setEnd(holder.content, holder.content.childNodes.length);
          if (rest.toString()) runs.push({ br: true, text: '\n', b, i, u, s: x }); // (the empty line's own <br> isn't one)
          continue;
        }
        // the engine writes bold italic as <b style="font-style: italic"> (or
        // the other way round) when ⌘I meets ⌘B: the style counts like a tag
        const st = child.style || {};
        const fw = String(st.fontWeight || '').toLowerCase();
        const it = tag === 'I' || tag === 'EM' || String(st.fontStyle || '').toLowerCase() === 'italic';
        const bo = tag === 'B' || tag === 'STRONG' || fw === 'bold' || parseInt(fw, 10) >= 600;
        // underline and strikethrough: the engine's tags, or a style
        const deco = String(st.textDecoration || st.textDecorationLine || '').toLowerCase();
        const un = tag === 'U' || tag === 'INS' || deco.includes('underline');
        const st2 = tag === 'S' || tag === 'STRIKE' || tag === 'DEL' || deco.includes('line-through');
        walk(child, b || bo, it ? (flip ? !i : true) : i, u || un, x || st2);
      }
    }
  };
  walk(holder.content, false, false, false, false);
  return runs;
}

/* ---------- DOCX ---------- */

function docxP(runs, opts = {}) {
  // the schema wants a paragraph's properties in this order
  const pPr = [];
  if (opts.style) pPr.push(`<w:pStyle w:val="${opts.style}"/>`);
  if (opts.keepNext) pPr.push('<w:keepNext/>');
  if (opts.pageBreak) pPr.push('<w:pageBreakBefore/>');
  if (opts.spaceBefore || opts.spaceAfter) {
    pPr.push(`<w:spacing${opts.spaceBefore ? ` w:before="${opts.spaceBefore}"` : ''}${opts.spaceAfter ? ` w:after="${opts.spaceAfter}"` : ''} w:line="360" w:lineRule="auto"/>`);
  }
  if (opts.poetry) pPr.push('<w:ind w:left="720" w:right="720"/>');
  else if (opts.indentLeft) pPr.push(`<w:ind w:left="${opts.indentLeft}"/>`);
  else if (opts.indent) pPr.push('<w:ind w:firstLine="480"/>');
  if (opts.align) pPr.push(`<w:jc w:val="${opts.align}"/>`);
  const rXml = runs.map((r) => {
    if (r.br) return '<w:r><w:br/></w:r>';
    const it = opts.flip ? !r.i : r.i;
    const caps = r.caps !== undefined ? r.caps : opts.caps;
    const size = r.size || opts.size;
    // italic and bold are character styles (Emphasis, Strong), so an editor
    // or typesetter can find and restyle them all at once
    const rStyle = r.b && it ? 'StrongEmphasis' : r.b ? 'Strong' : it ? 'Emphasis' : '';
    // in the order the schema wants them (Word is strict about it)
    const rPr = (rStyle ? `<w:rStyle w:val="${rStyle}"/>` : '')
      + (caps === true ? '<w:caps/>' : caps === false ? '<w:caps w:val="0"/>' : '')
      + (r.s ? '<w:strike/>' : '')
      + (opts.tracking ? `<w:spacing w:val="${opts.tracking}"/>` : '')
      + (size ? `<w:sz w:val="${size}"/>` : '')
      + (r.u ? '<w:u w:val="single"/>' : '');
    return `<w:r>${rPr ? '<w:rPr>' + rPr + '</w:rPr>' : ''}<w:t xml:space="preserve">${escXml(r.text)}</w:t></w:r>`;
  }).join('');
  return `<w:p><w:pPr>${pPr.join('')}</w:pPr>${rXml}</w:p>`;
}

function buildDocxEntries(data) {
  const d = data || bookExportData();
  const body = [];
  // headings carry Word's own heading styles, so the navigation pane and a
  // table of contents inserted in Word both see the book's shape
  const heading = (ch) => 'Heading' + Math.min(3, 1 + (ch.level || 0));
  // a page's lines: centered, upright where the page is italic
  const pageLines = (paras, italic, first) => paras.forEach((p, i) => {
    const lead = i === 0 ? first : {};
    if (p.sceneBreak) { body.push(docxP([{ text: '***' }], Object.assign({ align: 'center' }, lead))); return; }
    const attr = isAttribution(p);
    body.push(docxP(paraRuns(p.html), Object.assign({ align: 'center', flip: italic && !attr, size: attr ? 20 : undefined, spaceBefore: attr ? 240 : 0 }, lead)));
  });
  // title page
  body.push(docxP([{ text: d.title }], { style: 'Title' }));
  if (d.subtitle) body.push(docxP([{ text: d.subtitle }], { style: 'Subtitle' }));
  body.push(docxP([{ text: d.author }], { style: 'Author' }));
  const contents = () => {
    body.push(docxP([{ text: t('Contents') }], { align: 'center', pageBreak: true, spaceBefore: 1200, size: 28, caps: true }));
    body.push(docxP([], {}));
    for (const e of d.toc.filter((x) => d.contentsChapters || x.type !== 'chapter')) {
      body.push(docxP([{ text: e.label }], { indentLeft: 480 * e.level, spaceBefore: e.type === 'part' ? 240 : 0, caps: e.type === 'part' }));
    }
  };
  let placed = !(d.contents && d.toc && d.toc.length);
  d.sections.forEach((ch) => {
    if (!placed && !ch.front) { contents(); placed = true; }
    const kind = ch.kind || 'chapter';
    if (kind === 'copyright') {
      ch.paras.forEach((p, i) => body.push(docxP(p.sceneBreak ? [] : paraRuns(p.html), { pageBreak: i === 0, spaceBefore: i === 0 ? 6000 : 0, spaceAfter: 120, size: 18 })));
      return;
    }
    if (kind === 'dedication' || kind === 'epigraph') {
      pageLines(ch.paras, true, { pageBreak: true, spaceBefore: kind === 'dedication' ? 3600 : 3200 });
      return;
    }
    if (kind === 'part') {
      const runs = [{ text: ch.heading }];
      if (ch.partTitle) runs.push({ br: true }, { br: true }, { text: ch.partTitle, caps: false, size: 48 });
      body.push(docxP(runs, { style: heading(ch), spaceBefore: 3600, spaceAfter: 480 }));
      pageLines(ch.paras, true, {});
      return;
    }
    if (kind === 'opener') {
      body.push(docxP([{ text: ch.heading, caps: false, size: 44 }], { style: heading(ch), spaceBefore: 3600 }));
      if (ch.subtitle) body.push(docxP([{ text: ch.subtitle, i: true }], { align: 'center', size: 28 }));
      if (ch.byline) body.push(docxP([{ text: ch.byline }], { align: 'center', spaceBefore: 600, size: 20, caps: true }));
      return;
    }
    if (ch.heading) {
      body.push(docxP([{ text: ch.heading }], { style: heading(ch) }));
      if (ch.byline) body.push(docxP([{ text: ch.byline }], { align: 'center', size: 20, caps: true }));
      body.push(docxP([], {}));
    } else {
      body.push(docxP([], { pageBreak: true })); // headingless story still starts fresh
    }
    // the prose by paragraph style: Body Text (indented), Body Text No
    // Indent (a flush paragraph), Poetry, Scene Break; only a centered or
    // right-set line adds its alignment on top
    for (const p of ch.paras) {
      if (p.sceneBreak) body.push(docxP([{ text: '***' }], { style: 'SceneBreak' }));
      else if (p.poetry) body.push(docxP(paraRuns(p.html), { style: 'Poetry', align: p.align === 'center' || p.align === 'right' ? p.align : '' }));
      else if (p.align === 'center' || p.align === 'right') body.push(docxP(paraRuns(p.html), { style: 'BodyTextNoIndent', align: p.align }));
      else body.push(docxP(paraRuns(p.html), { style: p.flush ? 'BodyTextNoIndent' : 'BodyText' }));
    }
  });
  if (!placed) contents();
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join('')}
<w:sectPr>${(window.neo.paper || 'Letter') === 'A4' ? '<w:pgSz w:w="11906" w:h="16838"/>' : '<w:pgSz w:w="12240" w:h="15840"/>'}<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
</w:body></w:document>`;
  // the page's own typeface (on Linux, the bundled face it shows)
  const font = escXml(firstFamily(exportBodyFont()) || 'Georgia');
  const para = (id, name, pPr, next = 'BodyText', rPr = '') => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="${next}"/><w:qFormat/>${pPr ? '<w:pPr>' + pPr + '</w:pPr>' : ''}${rPr ? '<w:rPr>' + rPr + '</w:rPr>' : ''}</w:style>`;
  const chr = (id, name, rPr) => `<w:style w:type="character" w:styleId="${id}"><w:name w:val="${name}"/><w:qFormat/><w:rPr>${rPr}</w:rPr></w:style>`;
  const headingStyle = (n) => `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="BodyText"/><w:uiPriority w:val="9"/><w:qFormat/>
<w:pPr><w:keepNext/><w:pageBreakBefore/><w:spacing w:before="1200"/><w:jc w:val="center"/><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:caps/><w:sz w:val="28"/></w:rPr></w:style>`;
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}"/><w:sz w:val="24"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
${para('BodyText', 'Body Text', '<w:ind w:firstLine="480"/>')}
${para('BodyTextNoIndent', 'Body Text No Indent', '', 'BodyText')}
${para('Poetry', 'Poetry', '<w:ind w:left="720" w:right="720"/>')}
${para('SceneBreak', 'Scene Break', '<w:spacing w:before="240"/><w:jc w:val="center"/>', 'BodyText')}
${para('Title', 'Title', '<w:spacing w:before="3000"/><w:jc w:val="center"/>', 'Normal', '<w:b/><w:sz w:val="56"/>')}
${para('Subtitle', 'Subtitle', '<w:jc w:val="center"/>', 'Normal', '<w:i/><w:sz w:val="32"/>')}
${para('Author', 'Author', '<w:spacing w:before="800"/><w:jc w:val="center"/>')}
${[1, 2, 3].map(headingStyle).join('\n')}
${chr('Emphasis', 'Emphasis', '<w:i/>')}
${chr('Strong', 'Strong', '<w:b/>')}
${chr('StrongEmphasis', 'Strong Emphasis', '<w:b/><w:i/>')}
</w:styles>`;
  return [
    { path: '[Content_Types].xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>` },
    { path: '_rels/.rels', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>` },
    { path: 'word/_rels/document.xml.rels', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>` },
    { path: 'word/document.xml', content: documentXml },
    { path: 'word/styles.xml', content: stylesXml }
  ];
}

/* ---------- EPUB (KDP-friendly: EPUB 3, nav + NCX TOC, cover image) ---------- */

// The cover that travels with an export: the writer's own image if they
// gave one, otherwise the shelf's abstract with the title set in type,
// rendered at KDP size. NEO's paintings never leave the shelf.
async function exportCover(d) {
  if (d.coverImage) {
    const c = await window.neo.readCover(d.id, d.coverImage);
    if (c) return { base64: c.base64, mime: c.mime, ext: c.ext };
  }
  await NeoCovers.ready;
  const url = NeoCovers.renderFull(d).toDataURL('image/jpeg', 0.9);
  return { base64: url.split(',')[1], mime: 'image/jpeg', ext: 'jpg' };
}

// what each kind of section is, in the EPUB's own words
const EPUB_TYPES = {
  copyright: 'copyright-page', dedication: 'dedication', epigraph: 'epigraph', part: 'part',
  opener: 'volume', acknowledgments: 'acknowledgments', about: 'backmatter'
};

function chapterXhtml(ch, d) {
  const kind = ch.kind || 'chapter';
  const xhtmlRuns = (p) => paraRuns(p.html).map((r) => {
    if (r.br) return '<br/>';
    let t = escXml(r.text);
    if (r.s) t = '<s>' + t + '</s>';
    if (r.u) t = '<u>' + t + '</u>';
    if (r.i) t = '<em>' + t + '</em>';
    if (r.b) t = '<strong>' + t + '</strong>';
    return t;
  }).join('');
  // a page's lines, each set on its own
  const lines = () => ch.paras.map((p) => {
    if (p.sceneBreak) return '<p class="brk">* * *</p>';
    const cls = [kind !== 'copyright' && isAttribution(p) ? 'attr' : '', p.poetry ? 'poetry' : '', p.align === 'center' || p.align === 'right' ? p.align : ''].filter(Boolean);
    return `<p${cls.length ? ` class="${cls.join(' ')}"` : ''}>${xhtmlRuns(p)}</p>`;
  }).join('\n');
  let inner;
  if (kind === 'copyright' || kind === 'dedication' || kind === 'epigraph') {
    inner = `<section epub:type="${EPUB_TYPES[kind]}" class="${kind}">
${lines()}
</section>`;
  } else if (kind === 'part') {
    inner = `<section epub:type="part" class="part"><h1><span class="pl">${escXml(ch.heading)}</span>${ch.partTitle ? `<span class="pt">${escXml(ch.partTitle)}</span>` : ''}</h1>
${lines()}
</section>`;
  } else if (kind === 'opener') {
    inner = `<section epub:type="volume" class="opener"><h1>${escXml(ch.heading)}</h1>
${ch.subtitle ? `<p class="sub">${escXml(ch.subtitle)}</p>` : ''}${ch.byline ? `<p class="byline">${escXml(ch.byline)}</p>` : ''}
</section>`;
  } else {
    let first = true;
    const paras = ch.paras.map((p) => {
      if (p.sceneBreak) { first = true; return '<p class="brk">* * *</p>'; }
      const classes = [];
      if (p.poetry) classes.push('poetry');
      else if (p.flush) classes.push('flush');
      else if (first) {
        classes.push('first');
        // speech keeps its indent, in line with the lines that answer it
        if (OPENING_DASH.test(p.text || '')) classes.push('dialogue');
      }
      if (p.align === 'center' || p.align === 'right') classes.push(p.align);
      const cls = classes.length ? ` class="${classes.join(' ')}"` : '';
      if (!p.poetry) first = false;
      return `<p${cls}>${xhtmlRuns(p)}</p>`;
    }).join('\n');
    inner = `<section epub:type="${EPUB_TYPES[kind] || ch.role || 'chapter'}">${ch.heading ? `<h1>${escXml(ch.heading)}</h1>` : ''}${ch.byline ? `<p class="byline">${escXml(ch.byline)}</p>` : ''}
${paras}
</section>`;
  }
  // the language on the page too, so a reader hyphenates in the right one
  const lang = escXml(d.language || NeoI18n.getLocale());
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}">
<head><title>${escXml(ch.heading || ch.label || d.title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>${inner}</body></html>`;
}

async function buildEpubEntries(data) {
  const d = data || bookExportData();
  const chapters = d.sections;
  const uuid = 'urn:uuid:' + (d.uuid || crypto.randomUUID());
  const modified = new Date().toISOString().replace(/\.\d+Z$/, 'Z');

  // real cover art when the book has it; the shelf's cover otherwise
  const cover = await exportCover(d);
  const coverName = 'cover.' + cover.ext;
  const coverMime = cover.mime;
  const coverContent = cover.base64;
  // the pages at the front come before the contents in reading order
  const front = chapters.filter((ch) => ch.front);
  const rest = chapters.filter((ch) => !ch.front);
  const start = rest[0] || chapters[0];
  if (!start) throw new Error(t('There’s nothing in this book to export yet'));
  const chItems = chapters.map((ch) =>
    `<item id="ch${ch.num}" href="ch${ch.num}.xhtml" media-type="application/xhtml+xml"/>`).join('\n');
  const spineOf = (list) => list.map((ch) => `<itemref idref="ch${ch.num}"/>`).join('\n');
  // one entry per section for a single book; a book of books nests its
  // chapters under their titles and its titles under their parts
  const toc = tocTree(d.toc || chapters.map((ch) => ({ label: ch.heading || d.title, num: ch.num, level: 0 })));
  const navList = (nodes) => nodes.map((n) => `<li><a href="ch${n.e.num}.xhtml">${escXml(n.e.label)}</a>${n.children.length ? `
<ol>
${navList(n.children)}
</ol>` : ''}</li>`).join('\n');
  let playOrder = 1; // the title page is first
  const ncxPoints = (nodes) => nodes.map((n) => {
    playOrder += 1;
    return `
<navPoint id="ch${n.e.num}" playOrder="${playOrder}"><navLabel><text>${escXml(n.e.label)}</text></navLabel><content src="ch${n.e.num}.xhtml"/>${ncxPoints(n.children)}</navPoint>`;
  }).join('');
  const entryCount = (nodes) => nodes.reduce((n, x) => n + 1 + entryCount(x.children), 0);

  const entries = [
    { path: 'mimetype', content: 'application/epub+zip', store: true },
    { path: 'META-INF/container.xml', content: `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>` },
    { path: 'OEBPS/content.opf', content: `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="bookid">${uuid}</dc:identifier>
<dc:title>${escXml(d.title)}</dc:title>
<dc:creator>${escXml(d.author)}</dc:creator>
<dc:language>${escXml(d.language || NeoI18n.getLocale())}</dc:language>
<meta property="dcterms:modified">${modified}</meta>
<meta name="cover" content="cover-image"/>
</metadata>
<manifest>
<item id="cover-image" href="${coverName}" media-type="${coverMime}" properties="cover-image"/>
<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>
<item id="titlepage" href="title.xhtml" media-type="application/xhtml+xml"/>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
<item id="css" href="style.css" media-type="text/css"/>
${chItems}
</manifest>
<spine toc="ncx">
<itemref idref="cover" linear="no"/>
<itemref idref="titlepage"/>
${front.length ? spineOf(front) + '\n' : ''}<itemref idref="nav"${entryCount(toc) <= 1 ? ' linear="no"' : ''}/>
${spineOf(rest)}
</spine>
<guide>
<reference type="cover" title="${escXml(t('Cover'))}" href="cover.xhtml"/>
<reference type="toc" title="${escXml(t('Table of Contents'))}" href="nav.xhtml"/>
<reference type="text" title="${escXml(t('Beginning'))}" href="ch${start.num}.xhtml"/>
</guide>
</package>` },
    { path: 'OEBPS/nav.xhtml', content: `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>${escXml(t('Table of Contents'))}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body><nav epub:type="toc" id="toc"><h1>${escXml(t('Contents'))}</h1>
<ol>
<li><a href="title.xhtml">${escXml(t('Title Page'))}</a></li>
${navList(toc)}
</ol></nav>
<nav epub:type="landmarks" hidden=""><ol>
<li><a epub:type="cover" href="cover.xhtml">${escXml(t('Cover'))}</a></li>
<li><a epub:type="toc" href="nav.xhtml">${escXml(t('Table of Contents'))}</a></li>
<li><a epub:type="bodymatter" href="ch${start.num}.xhtml">${escXml(t('Beginning'))}</a></li>
</ol></nav>
</body></html>` },
    { path: 'OEBPS/toc.ncx', content: `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
<head><meta name="dtb:uid" content="${uuid}"/></head>
<docTitle><text>${escXml(d.title)}</text></docTitle>
<navMap>
<navPoint id="titlepage" playOrder="1"><navLabel><text>${escXml(t('Title Page'))}</text></navLabel><content src="title.xhtml"/></navPoint>${ncxPoints(toc)}
</navMap></ncx>` },
    { path: 'OEBPS/style.css', content: `body { font-family: serif; line-height: 1.5; margin: 1em; }
h1 { text-align: center; font-weight: normal; letter-spacing: 0.2em; text-transform: uppercase; font-size: 1.2em; margin: 3em 0 2em; }
p { text-indent: 1.2em; margin: 0; text-align: justify; -webkit-hyphens: auto; -epub-hyphens: auto; hyphens: auto; widows: 2; orphans: 2; }
h1, p.brk { -webkit-hyphens: none; -epub-hyphens: none; hyphens: none; }
p.poetry, .dedication p, .epigraph p, .part p, .copyright p { text-align: left; -webkit-hyphens: manual; -epub-hyphens: manual; hyphens: manual; }
p.first, p.brk + p, p.byline + p { text-indent: 0; }
p.first.dialogue:not(.center):not(.right) { text-indent: 1.2em; }
p.center { text-align: center; text-indent: 0; }
p.right { text-align: right; text-indent: 0; }
p.brk { text-align: center; text-indent: 0; margin: 2.5em 0; letter-spacing: 0.5em; }
p.poetry { text-indent: 0; margin: 0 2em; }
p.flush { text-indent: 0 !important; }
p:not(.poetry) + p.poetry, h1 + p.poetry { margin-top: 0.9em; }
p.poetry + p:not(.poetry) { margin-top: 0.9em; }
p.byline { text-align: center; text-indent: 0; letter-spacing: 0.2em; text-transform: uppercase; font-size: 0.8em; margin: -1em 0 2em; }
.copyright { margin-top: 40%; font-size: 0.8em; line-height: 1.5; }
.copyright p { text-indent: 0; margin: 0 0 0.9em; }
.dedication, .epigraph, .part, .opener { text-align: center; margin-top: 30%; }
.epigraph { margin-left: 2em; margin-right: 2em; }
.dedication p, .epigraph p, .part p { text-indent: 0; margin: 0 0 0.5em; font-style: italic; }
.dedication em, .epigraph em, .part p em { font-style: normal; }
.dedication p.poetry, .epigraph p.poetry, .part p.poetry { margin: 0 0 0.2em; }
p.attr { font-style: normal; font-size: 0.85em; letter-spacing: 0.05em; margin-top: 1em; }
.part h1 { margin: 0 0 2em; }
.part .pl { display: block; }
.part .pt { display: block; margin-top: 0.8em; font-size: 1.6em; letter-spacing: 0; text-transform: none; }
.opener h1 { margin: 0; font-size: 1.8em; letter-spacing: 0.02em; text-transform: none; }
.opener .sub { text-indent: 0; margin-top: 0.6em; font-style: italic; }
.opener .byline { margin: 3em 0 0; }
nav#toc ol { list-style: none; padding-left: 0; }
nav#toc ol ol { padding-left: 1.5em; }
.titlepage { text-align: center; margin-top: 30%; }
.titlepage h2 { font-size: 2em; margin: 0; }
.titlepage .sub { font-style: italic; }
.titlepage .auth { margin-top: 4em; letter-spacing: 0.3em; text-transform: uppercase; }
.coverimg { text-align: center; margin: 0; padding: 0; }
.coverimg img { max-width: 100%; max-height: 100%; }` },
    { path: 'OEBPS/cover.xhtml', content: `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>${escXml(t('Cover'))}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body><div class="coverimg"><img src="${coverName}" alt="${escXml(d.title)}"/></div></body></html>` },
    { path: 'OEBPS/title.xhtml', content: `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>${escXml(d.title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body><div class="titlepage"><h2>${escXml(d.title)}</h2>
${d.subtitle ? `<p class="sub">${escXml(d.subtitle)}</p>` : ''}
<p class="auth">${escXml(d.author)}</p></div></body></html>` },
    { path: 'OEBPS/' + coverName, content: coverContent, base64: true }
  ];
  for (const ch of chapters) {
    entries.push({ path: `OEBPS/ch${ch.num}.xhtml`, content: chapterXhtml(ch, d) });
  }
  return entries;
}

/* ---------- A BOOK OF BOOKS: a bound shelf, or a shelf as an anthology ---------- */

// Read a shelf from disk into export sections, in shelf order. Each section
// has a kind the builders lay out: 'copyright', 'dedication', 'epigraph'
// (front pages), 'part', 'opener' (a title's own first page), 'chapter',
// 'acknowledgments', 'about' (back pages). `toc` is the table of contents:
// {label, num (the section), level, type: part | title | chapter | page}.
// A bound shelf brings its cover and pages and numbers its chapters its own
// way; an unbound shelf is read as an anthology: titles only, each one's
// chapters counted from 1.
async function shelfBookData(shelf, opts = {}) {
  const bound = !!opts.bound;
  const through = bound && ((shelf.binding && shelf.binding.numbering) || 'through') !== 'restart';
  const metas = [];
  for (const id of shelf.bookIds) {
    const m = await window.neo.readBookMeta(id);
    if (m && (bound || !isPageMeta(m))) metas.push(m);
  }
  const cover = metas.find((m) => m.kind === 'cover') || null;
  const author = (cover && cover.author) || shelfAuthorName(shelf);
  const titles = metas.filter((m) => !isPageMeta(m));
  const single = titles.length === 1;
  const pageParas = async (m) => parasFromHtml(m.chapterOrder && m.chapterOrder[0]
    ? await window.neo.readChapter(m.id, m.chapterOrder[0]) : '');
  const sections = [];
  const toc = [];
  const push = (s) => { s.num = sections.length + 1; sections.push(s); return s; };
  let n = 0; // the chapter count
  let parts = 0;
  let inPart = false;
  for (const m of metas) {
    if (m.kind === 'cover') continue;
    if (PAGE_FRONT.includes(m.kind) || PAGE_BACK.includes(m.kind)) {
      const paras = await pageParas(m);
      if (!paras.length) continue; // a page left blank stays out of the book
      const back = PAGE_BACK.includes(m.kind);
      const s = push({ kind: m.kind, front: !back, heading: back ? pageKindName(m.kind) : '', label: pageKindName(m.kind), level: 0, paras });
      if (back) {
        toc.push({ label: s.heading, num: s.num, level: 0, type: 'page' });
        inPart = false;
      }
      continue;
    }
    if (m.kind === 'part') {
      parts += 1;
      const all = await pageParas(m);
      // the page's first line is the part's title; what follows, a quote or a verse
      const titled = !!(all[0] && !all[0].sceneBreak && !isAttribution(all[0]));
      const partTitle = titled ? all[0].text : '';
      const s = push({ kind: 'part', heading: partLabel(parts), partTitle, level: 0, paras: titled ? all.slice(1) : all });
      toc.push({ label: partTitle ? s.heading + ': ' + partTitle : s.heading, num: s.num, level: 0, type: 'part' });
      inPart = true;
      continue;
    }
    if (PAGE_WRITTEN.includes(m.kind)) {
      // the book's own prologue or epilogue: one unnumbered section (any
      // chapters the writer gave it run on, a scene break between them)
      const paras = [];
      for (const chId of m.chapterOrder || []) {
        const p = parasFromHtml(await window.neo.readChapter(m.id, chId));
        if (!p.length) continue;
        if (paras.length) paras.push({ sceneBreak: true, poetry: false, text: '', runs: [], align: '', html: '' });
        paras.push(...p);
      }
      if (!paras.length) continue;
      const heading = isUntitled(m.title) ? pageKindName(m.kind) : m.title.trim();
      const s = push({ kind: 'chapter', role: m.kind, heading, level: 0, paras });
      toc.push({ label: heading, num: s.num, level: 0, type: 'title' });
      inPart = false;
      continue;
    }
    // a title and its chapters: its story and its parts. The pages it
    // carries as a book of its own (its copyright, its dedication…) stay
    // with it; the bound book has pages of its own.
    if (!through) n = 0;
    const level = inPart ? 1 : 0;
    const chapters = [];
    for (const chId of m.chapterOrder || []) {
      const kind = chapterKind(chId, m);
      if (!STORY_KINDS.includes(kind) && kind !== 'part') continue;
      const paras = parasFromHtml(await window.neo.readChapter(m.id, chId));
      if (paras.length || kind === 'part') chapters.push({ chId, kind, paras });
    }
    while (chapters.length && chapters[chapters.length - 1].kind === 'part') chapters.pop();
    if (!chapters.length) continue;
    const byline = m.author && m.author !== author ? m.author : '';
    if (single && chapters.length === 1) {
      push({ kind: 'chapter', heading: '', paras: chapters[0].paras });
      continue;
    }
    if (chapters.length === 1) {
      // one chapter is one section, headed by the title's own name and left
      // out of the count: a prologue, an interlude, a short story
      const s = push({ kind: 'chapter', heading: m.title, byline, level, paras: chapters[0].paras });
      toc.push({ label: m.title, num: s.num, level, type: 'title' });
      continue;
    }
    let chLevel = level;
    if (!single) {
      const s = push({ kind: 'opener', heading: m.title, subtitle: m.subtitle || '', byline, level, paras: [] });
      toc.push({ label: m.title, num: s.num, level, type: 'title' });
      chLevel = level + 1;
    }
    // a title's own parts stand over the chapters that follow them
    let titleParts = 0;
    let underPart = false;
    for (const c of chapters) {
      if (c.kind === 'part') {
        titleParts += 1;
        if (m.restartNumbering) n = 0; // this title numbers its chapters part by part
        const titled = !!(c.paras[0] && !c.paras[0].sceneBreak && !isAttribution(c.paras[0]));
        const partTitle = titled ? c.paras[0].text : '';
        const s = push({ kind: 'part', heading: partLabel(titleParts), partTitle, level: chLevel, paras: titled ? c.paras.slice(1) : c.paras });
        toc.push({ label: partTitle ? s.heading + ': ' + partTitle : s.heading, num: s.num, level: chLevel, type: 'part' });
        underPart = true;
        continue;
      }
      const role = chapterRole(c.chId, m);
      if (role === 'epilogue') underPart = false;
      const chTitle = (m.chapterTitles || {})[c.chId];
      let heading;
      if (c.kind === 'unnumbered') heading = chTitle || '';
      else {
        if (role) heading = role === 'prologue' ? t('Prologue') : t('Epilogue');
        else { n += 1; heading = t('Chapter {n}', { n }); }
        if (chTitle) heading = library.exportCustomChapterTitles ? chTitle : heading + ' ' + headingDash() + ' ' + chTitle;
      }
      const lv = underPart ? chLevel + 1 : chLevel;
      const s = push({ kind: 'chapter', heading, level: lv, paras: c.paras, role: role || '' });
      toc.push({ label: heading, num: s.num, level: lv, type: 'chapter' });
    }
  }
  // an EPUB wants one identity per book: a bound book keeps the first it gets
  let uuid = null;
  if (bound) {
    if (!shelf.binding.uuid) {
      shelf.binding.uuid = crypto.randomUUID();
      await writeLibrary(library);
    }
    uuid = shelf.binding.uuid;
  }
  const title = opts.title || shelf.name;
  return {
    id: cover && cover.coverImage ? cover.id : 'shelf-' + shelf.id,
    uuid,
    title,
    subtitle: (cover && cover.subtitle) || '',
    author,
    language: writingLanguage(),
    coverSeed: cover ? cover.coverSeed : shelf.id + ':' + title,
    coverImage: (cover && cover.coverImage) || null,
    sections,
    toc,
    // a contents page in print for a book of several titles, or for one
    // title that has a Contents page of its own (which lists its chapters)
    contents: titles.length > 1 || (single && (titles[0].chapterOrder || []).some((c) => chapterKind(c, titles[0]) === 'contents')),
    contentsChapters: single
  };
}

async function shelfPayload(data, format) {
  const defaultName = safeName(data.title);
  if (format === 'docx') return { format, defaultName, zipEntries: buildDocxEntries(data) };
  if (format === 'epub') return { format, defaultName, zipEntries: await buildEpubEntries(data) };
  return { format: 'pdf', defaultName, content: buildHtml(data, { cover: await exportCover(data), fonts: await exportFontFaces(data) }) };
}

function shelfFormats() {
  return [
    { label: 'EPUB', desc: t('For ebook stores — the TOC lists every story.'), value: 'epub' },
    { label: 'Word (.docx)', desc: t('For editors — each story starts on a new page.'), value: 'docx' },
    { label: 'PDF', desc: t('For reading, sharing, and print.'), value: 'pdf' }
  ];
}

async function exportShelfAnthology(shelf) {
  if (!shelf.bookIds.length) { toast(t('This shelf has no books on it yet')); return; }
  const title = await askInput(t('Anthology title'), t('Shown on the title page, cover, and metadata'), shelf.name);
  if (title === null) return;
  const format = await optionModal(t('Export the anthology as…'), null, shelfFormats());
  if (!format) return;
  toast(t('Collecting the shelf…'));
  try {
    const data = await shelfBookData(shelf, { title: title || shelf.name });
    if (!data.sections.length) { toast(t('No words found on this shelf yet')); return; }
    const saved = await window.neo.exportSave(await shelfPayload(data, format));
    if (saved) toast(t('Anthology of {n} works exported: {file}', { n: shelf.bookIds.length, file: saved.split('/').pop() }), 6000);
  } catch (err) {
    window.neo.logError('export anthology: ' + (err && err.stack || err));
    toast(t('Couldn’t export the anthology: {error}', { error: plainError(err) }), 8000);
  }
}

// A bound shelf goes out as the book it is: no questions but the format
async function exportBoundBook(shelf) {
  const format = await optionModal(escHtml(t('Export “{title}”', { title: shelf.name })), null, shelfFormats());
  if (!format) return;
  toast(t('Collecting the shelf…'));
  try {
    const data = await shelfBookData(shelf, { bound: true });
    if (!data.sections.length) { toast(t('No words found on this shelf yet')); return; }
    const saved = await window.neo.exportSave(await shelfPayload(data, format));
    if (saved) toast(t('Exported: {file}', { file: saved.split('/').pop() }));
  } catch (err) {
    window.neo.logError('export bound book: ' + (err && err.stack || err));
    toast(t('Couldn’t export: {error}', { error: plainError(err) }), 8000);
  }
}

// Right-click a bound book's cover: its art, and the book's own choices
async function boundCoverMenu(shelf, meta, el) {
  const options = [];
  if (!NO_HOVER) {
    options.push({ label: meta.coverImage ? t('Replace cover art…') : t('Set cover art…'), desc: t('Pick an image (2:3 works best). Or just drag one from Finder onto the book.'), value: 'cover' });
  }
  if (meta.coverImage) {
    options.push({ label: t('Remove cover art'), desc: t('Deletes the image from the book folder. (To just hide it, use the ↻ on the book.)'), danger: true, value: 'uncover' });
  }
  options.push(
    { label: t('New cover'), value: 'refresh' },
    { label: t('Export the book…'), desc: t('EPUB, Word or PDF, with its cover, its pages and one table of contents.'), value: 'export' },
    { label: t('Unbind'), desc: t('A shelf of separate titles again. Its pages wait for the next binding.'), value: 'unbind' }
  );
  const choice = await optionModal(escHtml(t('“{name}” · one book', { name: shelf.name })), null, options);
  if (choice === 'cover') {
    const src = await window.neo.pickCover();
    if (!src) return;
    const fname = await window.neo.setCover(meta.id, src);
    if (!fname) return;
    const live = (await window.neo.readBookMeta(meta.id)) || meta;
    live.coverImage = fname;
    live.coverMode = 'image';
    await writeBookMeta(meta.id, live);
    renderShelves();
  } else if (choice === 'uncover') {
    await window.neo.removeCover(meta.id);
    const live = (await window.neo.readBookMeta(meta.id)) || meta;
    live.coverImage = null;
    await writeBookMeta(meta.id, live);
    renderShelves();
  } else if (choice === 'refresh') {
    await refreshCover(meta, el);
  } else if (choice === 'export') {
    await exportBoundBook(shelf);
  } else if (choice === 'unbind') {
    await unbindShelf(shelf);
  }
}

// flat {level} entries into a tree, for the EPUB's nested contents
function tocTree(entries) {
  const root = { children: [] };
  const stack = [root];
  for (const e of entries) {
    const level = Math.max(0, Math.min(e.level, stack.length - 1));
    stack.length = level + 1;
    const node = { e, children: [] };
    stack[level].children.push(node);
    stack.push(node);
  }
  return root.children;
}


// What went wrong, in the words a writer can use: Electron wraps a failure in
// the main process as "Error invoking remote method 'export:save': Error: …"
function plainError(err) {
  return String((err && err.message) || err).replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, '');
}

// the whole book, or with chId just that chapter
// A book exported straight from the shelf: read into the export's view of
// "the open book" for the moment it takes, then put away again. Nothing on
// screen changes, and nothing is saved on its behalf meanwhile (saves and
// looks at the disk stand aside while shelfExport is set).
async function exportFromShelf(bookId, format) {
  if (book || shelfExport) return;
  const meta = await window.neo.readBookMeta(bookId);
  if (!meta || !Array.isArray(meta.chapterOrder)) return;
  const html = {};
  for (const chId of meta.chapterOrder) html[chId] = await window.neo.readChapter(bookId, chId);
  if (book) return; // a book was opened meanwhile
  const hadUuid = !!meta.uuid;
  const keep = { chapterHTML, savedHTML };
  shelfExport = true;
  book = meta;
  chapterHTML = html;
  savedHTML = { ...html };
  try {
    await doExport(format);
  } finally {
    if (book === meta) {
      book = null;
      chapterHTML = keep.chapterHTML;
      savedHTML = keep.savedHTML;
    }
    shelfExport = false;
  }
  // an EPUB's identity is made once and kept, as when exported from inside
  if (!hadUuid && meta.uuid) await writeBookMeta(bookId, meta).catch(() => {});
}

async function doExport(format, chId = null) {
  if (!book) { toast(t('Open a book first')); return; }
  if (format === 'paperback') { await printPaperback(); return; }
  // a script leaves as a PDF set the way scripts print, or as Fountain
  if (isScript()) { await spExport(['pdf', 'fdx'].includes(format) ? format : 'fountain'); return; }
  flushAllSaves();
  const one = chId ? chapterExportData(chId) : null;
  if (chId && !one) return;
  const data = one || undefined;
  const defaultName = safeName(book.title) + (one ? '-' + safeName(one.chapterOnly) : '');
  try {
    let payload;
    if (format === 'docx') payload = { format, defaultName, zipEntries: buildDocxEntries(data) };
    else if (format === 'epub') payload = { format, defaultName, zipEntries: await buildEpubEntries(data) };
    else if (format === 'txt') payload = { format, defaultName, content: buildTxt(data) };
    else if (format === 'md') payload = { format, defaultName, content: buildMd(data) };
    else {
      const d = data || bookExportData();
      payload = { format, defaultName, content: buildHtml(d, { cover: one ? null : await exportCover(d), fonts: await exportFontFaces(d) }) };
    }
    const saved = await window.neo.exportSave(payload);
    if (saved) toast(t('Exported: {file}', { file: saved.split('/').pop() }));
  } catch (err) {
    // An export that saves nothing must never be silent: name the failure,
    // and put the stack in the error log for whatever bug report follows.
    window.neo.logError('export ' + format + ': ' + (err && err.stack || err));
    toast(t('Couldn’t export: {error}', { error: plainError(err) }), 8000);
  }
}

function chooseEmailMethod() {
  // Apple Mail only exists on Macs; elsewhere Gmail
  if (!navigator.platform.toLowerCase().includes('mac')) return Promise.resolve('gmail');
  return new Promise((resolve) => {
    const bd = document.createElement('div');
    bd.className = 'modal-backdrop';
    bd.innerHTML = `
      <div class="modal" style="width:440px">
        <h2 style="font-size:16px">${t('How should NEO email your drafts?')}</h2>
        <div class="fr-choices" style="margin-top:14px">
          <button class="fr-choice" data-m="gmail">
            <strong>Gmail</strong>
            <span>${t('Opens a pre-filled compose window in your browser. NEO shows you the PDF to drag into it.')}</span>
          </button>
          <button class="fr-choice" data-m="mail">
            <strong>Apple Mail</strong>
            <span>${t('Fully automatic — the PDF is attached and addressed. Just hit send.')}</span>
          </button>
        </div>
      </div>`;
    document.body.appendChild(bd);
    bd.querySelectorAll('.fr-choice').forEach((b) => {
      b.onclick = () => { bd.remove(); resolve(b.dataset.m); };
    });
  });
}

async function emailSettings() {
  const addr = await askInput(t('Email drafts to'), t('you@example.com'), library.emailAddress || '');
  if (addr === null) return false;
  if (addr) library.emailAddress = addr;
  library.emailMethod = await chooseEmailMethod();
  await writeLibrary(library);
  toast(t('Email settings saved'));
  return true;
}

async function manuscriptHash() {
  // SHA-256 of the manuscript text: a fingerprint for your provenance trail
  const text = book.title + '\n' + book.chapterOrder.map((c) => chapterText(c)).join('\n');
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function doEmailDraft() {
  if (!book) { toast(t('Open a book first')); return; }
  flushAllSaves();
  if (!library.emailAddress || !library.emailMethod) {
    const ok = await emailSettings();
    if (!ok) return;
  }
  const total = bookWordCount();
  const subject = t('NEO draft — {title} — {n} words — {date}', { title: shownTitle(book.title), n: total, date: fmtDate(new Date()) });
  const hash = await manuscriptHash();
  const body = t('Draft snapshot of “{title}” — {n} words.', { title: shownTitle(book.title), n: total }) + '\n'
    + t('Sent from NEO on {date}.', { date: new Date().toLocaleString(NeoI18n.getLocale()) }) + '\n\n'
    + t('SHA-256 fingerprint of the manuscript text:') + `\n${hash}\n\n`
    + (library.emailMethod === 'gmail'
      ? t('The PDF snapshot is in the Finder window NEO just opened — drag it into this email before sending.')
      : t('PDF snapshot attached.'));
  toast(t('Preparing your draft…'));
  const script = isScript();
  const snapshot = script ? null : bookExportData();
  const res = await window.neo.emailDraft({
    to: library.emailAddress,
    subject,
    body,
    // the email snapshot is a provenance record (a script's, as it prints)
    html: script ? await spPdfHtml() : buildHtml(snapshot, { stamp: true, fonts: await exportFontFaces(snapshot) }),
    print: script ? 'screenplay' : undefined,
    defaultName: safeName(book.title),
    method: library.emailMethod
  });
  if (res.method === 'gmail') toast(t('Gmail compose opened — drag in the PDF NEO revealed, then send'), 8000);
  else if (res.ok) toast(t('Draft handed to Mail — hit send for your timestamp'));
  else toast(t('Mail unavailable — snapshot saved to your Exports folder instead'));
}

// Help → Check for Update…: on-demand release lookup, only ever runs on a click
let updateDialog = null; // the Check for Update… window, while it's open

function updateDialogBox(res) {
  const bd = document.createElement('div');
  bd.className = 'modal-backdrop';
  bd.innerHTML = `
    <div class="modal" style="width:400px">
      <h2 style="font-size:16px">${t('NEO {version} is available', { version: res.latestVersion })}</h2>
      <p class="up-text">${t('You have {version}.', { version: res.currentVersion })}</p>
      <div class="up-bar" hidden><div class="up-fill"></div></div>
      <div style="text-align:right;margin-top:14px">
        <button class="m-cancel btn-quiet" style="margin-right:10px">${t('Later')}</button>
        <button class="m-ok btn-gold"></button>
      </div>
    </div>`;
  document.body.appendChild(bd);
  const close = () => { bd.remove(); if (updateDialog === bd) updateDialog = null; };
  bd.close = close;
  bd.querySelector('.m-cancel').onclick = close;
  bd.tabIndex = -1;
  bd.focus();
  bd.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  return bd;
}

// one function draws every state of the dialog, so a message from the
// updater can redraw it whenever it likes
function updateDialogShow(state, info = {}) {
  const bd = updateDialog;
  if (!bd) return;
  const text = bd.querySelector('.up-text');
  const bar = bd.querySelector('.up-bar');
  const fill = bd.querySelector('.up-fill');
  const ok = bd.querySelector('.m-ok');
  const later = bd.querySelector('.m-cancel');
  const mb = (n) => (n / 1048576).toFixed(0);
  later.hidden = false;
  ok.hidden = false;
  bar.hidden = true;
  if (state === 'downloading') {
    const pct = Math.max(0, Math.min(100, info.percent || 0));
    text.textContent = info.total
      ? t('Downloading… {done} of {total} MB', { done: mb(info.transferred || 0), total: mb(info.total) })
      : t('Downloading…');
    bar.hidden = false;
    fill.style.width = pct.toFixed(1) + '%';
    ok.hidden = true;
  } else if (state === 'ready') {
    text.textContent = t('Downloaded. NEO will save your work and restart.');
    ok.textContent = t('Restart to update');
    ok.onclick = () => { flushAllSaves(); setTimeout(() => window.neo.installUpdate(), 300); };
    ok.focus();
  } else if (state === 'error') {
    text.textContent = t('The update couldn’t be installed from here: {message}', { message: info.message || t('unknown error') })
      + ' ' + t('You can download it from the release page instead.');
    ok.textContent = t('View Release');
    ok.onclick = () => { window.neo.openRelease(); bd.close(); };
  } else if (state === 'release') {
    text.textContent = t('You have {version}.', { version: info.currentVersion });
    ok.textContent = t('View Release');
    ok.onclick = () => { window.neo.openRelease(); bd.close(); };
  }
}

async function checkForUpdate() {
  if (updateDialog) { updateDialog.focus(); return; }
  const res = await window.neo.checkForUpdate();
  // the answer comes in a window, like an update does: a line at the foot
  // of the screen was too easy to miss
  if (res.error) { updateNotice(t('Couldn’t check for updates — try again later')); return; }
  if (!res.hasUpdate) { updateNotice(t('NEO is up to date'), t('You have {version}.', { version: res.currentVersion })); return; }
  // NEO has been fetching it in the background since it was found: show
  // where that download is — usually done, with "Restart to update"
  updateDialog = updateDialogBox(res);
  if (!res.canInstall) updateDialogShow('release', res);
  else if (res.ready) updateDialogShow('ready', res);
  else if (res.state === 'error') updateDialogShow('error', res);
  else updateDialogShow('downloading', res);
}

function updateNotice(title, line) {
  const bd = document.createElement('div');
  bd.className = 'modal-backdrop';
  bd.innerHTML = `
    <div class="modal" style="width:400px" role="dialog" aria-modal="true">
      <h2 style="font-size:16px"></h2>
      <p class="up-text" hidden></p>
      <div style="text-align:right;margin-top:14px"><button class="m-ok btn-gold">${t('OK')}</button></div>
    </div>`;
  bd.querySelector('h2').textContent = title;
  if (line) { bd.querySelector('.up-text').hidden = false; bd.querySelector('.up-text').textContent = line; }
  document.body.appendChild(bd);
  const close = () => { bd.remove(); if (updateDialog === bd) updateDialog = null; };
  bd.close = close;
  bd.querySelector('.m-ok').onclick = close;
  bd.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); close(); }
  });
  updateDialog = bd; // asking again while it's open just brings it forward
  bd.querySelector('.m-ok').focus();
}

// messages from the updater in the main process
// (the download itself is silent: they only matter while the window is open)
function updateMessage(msg) {
  if (!updateDialog || !updateDialog.querySelector('.up-bar')) return; // nothing open to report to
  updateDialogShow(msg.state, msg);
}

// Help → About NEO: the version, plainly
async function showAbout() {
  const v = await window.neo.appVersion();
  const bd = document.createElement('div');
  bd.className = 'modal-backdrop';
  bd.innerHTML = `
    <div class="modal" style="width:340px;text-align:center">
      <h2 style="font-size:22px;letter-spacing:6px">NEO</h2>
      <p class="about-version">${t('Version {version}', { version: v })}</p>
      <p class="about-line">${t('A word processor for authors.')}</p>
      <div style="margin-top:16px">
        <button class="m-ok btn-gold">${t('Back to writing')}</button>
      </div>
    </div>`;
  document.body.appendChild(bd);
  const close = () => bd.remove();
  bd.querySelector('.m-ok').onclick = close;
  bd.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  bd.querySelector('.m-ok').focus();
}

// Text size and the reset travel with page zoom; the menu item and the
// keyboard fallback share this so the two cannot drift.
async function setEditorFontSize(value) {
  // ⌘+ and ⌘− on the shelf make the covers larger and smaller
  if (shelfShowing()) { stepShelfZoom(value); return; }
  // …on the outline's cards, the cards
  if (boardShowing()) { stepCardZoom(value); return; }
  // a script's type is the page's: larger and smaller zoom the page
  if (book && isScript()) {
    setPageZoom(value === 0 ? 1 : tenth(activePageZoom() + (value > 0 ? 0.1 : -0.1)));
    return;
  }
  const cur = library.editorFontSize || 17;
  library.editorFontSize = value === 0 ? 17 : Math.min(22, Math.max(14, cur + value));
  if (value === 0) rememberZoom(pageZoomKey(), 1); // ⌘0 resets this mode's pinch zoom too
  await writeLibrary(library);
  keepReadingPlace(applyFonts);
}

window.neo.onMenu(async (msg) => {
  // full screen and focus mode together hide the bottom bar until hovered
  // (styles.css); the window says when it goes in and out, whatever is open
  if (msg.type === 'fullScreen') { document.body.classList.toggle('full-screen', !!msg.value); return; }
  // Writing History open: its own (Find, ⌘S to tag) and the news the main
  // process sends of itself go on. Anything else picked from the menus
  // closes it first and then happens; by its shortcut, it does nothing
  // behind the dialog.
  if (historyShown && !['find', 'snapshot', 'update', 'uiLanguage'].includes(msg.type)) {
    if (msg.byKey || msg.type === 'history') return;
    historyShown();
  }
  if ($('#keyboard-shortcuts') && msg.type !== 'help') return;
  // a window the menu opens (⌘, for Goals, say) never stacks on one that's
  // already open: pressing it again used to pile up overlays
  const WINDOWS = ['stats', 'about', 'emailSettings', 'coverArt', 'reshelve', 'checkUpdate', 'history'];
  if (WINDOWS.includes(msg.type) && document.querySelector('.modal-backdrop:not([hidden])')) {
    if (msg.type === 'checkUpdate' && updateDialog) updateDialog.focus();
    return;
  }
  if (msg.type === 'help') showHelp();
  if (msg.type === 'about') showAbout();
  if (msg.type === 'checkUpdate') checkForUpdate();
  if (msg.type === 'update') updateMessage(msg);
  if (msg.type === 'export') doExport(msg.format);
  if (msg.type === 'exportHistory') { if (book && !$('#editor-view').hidden) exportWritingHistory(book.id); else toast(t('Open a book first')); }
  if (msg.type === 'scriptElement' && book && isScript()) spSetElement(msg.value);
  if (msg.type === 'scriptStyle') spToggleStyle(msg.value);
  if (msg.type === 'scriptPageBreak') spTogglePageBreak();
  if (msg.type === 'markdownEmphasis') {
    if (msg.checked) delete library.markdownOff; else library.markdownOff = true;
    await writeLibrary(library);
    toast(msg.checked ? t('Markdown emphasis on: *italic*, **bold**') : t('Markdown emphasis off: asterisks stay asterisks'));
  }
  if (msg.type === 'exportCustomChapterTitles') {
    library.exportCustomChapterTitles = msg.checked;
    await writeLibrary(library);
  }
  if (msg.type === 'emailDraft') doEmailDraft();
  // (in Writing History, ⌘S tags the moment shown instead)
  if (msg.type === 'snapshot') { if (historyShown && historyShown.tag) historyShown.tag(); else if (book && !$('#editor-view').hidden) snapshotNow(); }
  if (msg.type === 'emailSettings') emailSettings();
  if (msg.type === 'find') { if (historyShown) historyShown.focusFind(); else openSearch(); }
  if (msg.type === 'spellcheck') toggleSpellcheck();
  if (msg.type === 'spellLanguage') changeSpellLanguage(msg.value);
  if (msg.type === 'reshelve') reshelveBook();
  if (msg.type === 'typewriter') toggleTypewriter();
  if (msg.type === 'vim') toggleVim();
  if (msg.type === 'focus') setFocus(msg.value);
  if (msg.type === 'focusCycle') cycleFocus();
  if (msg.type === 'import') importBooks();
  if (msg.type === 'stats') openStats();
  if (msg.type === 'historyLevel') setHistoryLevel(msg.value);
  if (msg.type === 'tsaServices') openTsaServices();
  // never greyed out: with no book open it says so, as Export does
  if (msg.type === 'history') { if (book && !$('#editor-view').hidden) openHistory(); else toast(t('Open a book first')); }
  if (msg.type === 'chapterStep') gotoChapter(msg.value);
  if (msg.type === 'writingStyle') {
    library.writingStyle = msg.value;
    await writeLibrary(library);
    if (window.neo.writingStyleState) window.neo.writingStyleState(library.writingStyle);
  }
  if (msg.type === 'coverArt') openCoverArt();
  // a script's lines sit where they print: no alignment, poetry or flush
  if (msg.type === 'align' && !(book && isScript())) {
    applyAlign(msg.value);
  }
  if (msg.type === 'poetry' && !(book && isScript())) togglePoetry();
  if (msg.type === 'flush' && !(book && isScript())) toggleFlush();
  if (msg.type === 'uiLanguage') {
    // save every open page, then reload the window in the new language
    flushAllSaves();
    try { if (book && !$('#editor-view').hidden) sessionStorage.setItem('neo-reopen', book.id); } catch { /* a nicety */ }
    setTimeout(() => window.neo.reloadForLanguage(), 400);
  }
  if (msg.type === 'uiZoom') {
    library.uiZoom = msg.value;
    await writeLibrary(library);
    applyFonts();
  }
  if (msg.type === 'uiBright') {
    // the tab you're on decides which of the two settings this is
    if (brightAside()) library.uiBrightAside = !document.body.classList.contains('bright');
    else library.uiBright = !document.body.classList.contains('bright');
    await writeLibrary(library);
    applyFonts();
  }
  if (msg.type === 'pageTheme') {
    library.pageTheme = msg.value;
    await writeLibrary(library);
    applyFonts();
  }
  if (msg.type === 'fontSize') {
    await setEditorFontSize(msg.value);
  }
  if (msg.type === 'bodyFontPick') {
    const name = await pickLocalFont();
    if (name) {
      library.fonts = library.fonts || {};
      library.fonts.body = name;
      await writeLibrary(library);
    }
    applyFonts(); // also undoes a hover preview after Cancel
  }
  if (msg.type === 'bodyFont') {
    library.fonts = library.fonts || {};
    library.fonts.body = msg.value;
    await writeLibrary(library);
    applyFonts();
  }
  if (msg.type === 'dropCap') {
    library.fonts = library.fonts || {};
    library.fonts.dropcap = msg.value;
    await writeLibrary(library);
    applyFonts();
  }
});

/* ================================================================== */
/*  SAFETY NET — errors get logged, never eaten silently               */
/* ================================================================== */

let errorToastShown = false;
function reportError(msg) {
  window.neo.logError(msg);
  if (!errorToastShown) {
    errorToastShown = true;
    toast(t('Something hiccuped — your words are safe, and the details were logged'));
  }
}
window.addEventListener('error', (e) => reportError(`${e.message} @ ${e.filename}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => reportError('Unhandled: ' + (e.reason && e.reason.stack || e.reason)));

/* ================================================================== */
/*  Linux body fonts                                                   */
/*  Georgia, Palatino, Baskerville, Hoefler Text, and Iowan Old Style  */
/*  are not on Linux. The bundled faces below are what the Format menu */
/*  and the first-run picker offer instead. Old libraries still resolve */
/*  the macOS names, but those names stay out of the picker.           */
/* ================================================================== */

const LINUX_BODY_FONTS = {
  'Gelasio': '"Gelasio", Georgia, "Times New Roman", serif',
  'TeX Gyre Pagella': '"TeX Gyre Pagella", Palatino, "Palatino Linotype", serif',
  'Libre Baskerville': '"Libre Baskerville", Baskerville, Georgia, serif',
  'Alegreya': '"Alegreya", "Hoefler Text", Georgia, serif',
  'Source Serif Pro': '"Source Serif Pro", "Iowan Old Style", Georgia, serif',
  'Jost': '"Jost", "Avenir Next", "Helvetica Neue", Arial, sans-serif',
  'iA Writer Quattro': '"iA Writer Quattro", "Helvetica Neue", Arial, sans-serif'
};

function installLinuxBodyFonts() {
  if (IS_MAC || /win/i.test(navigator.platform)) return;
  const legacy = {
    Georgia: LINUX_BODY_FONTS.Gelasio,
    Palatino: LINUX_BODY_FONTS['TeX Gyre Pagella'],
    Baskerville: LINUX_BODY_FONTS['Libre Baskerville'],
    'Hoefler Text': LINUX_BODY_FONTS.Alegreya,
    'Iowan Old Style': LINUX_BODY_FONTS['Source Serif Pro'],
    Cambria: LINUX_BODY_FONTS['Source Serif Pro'],
    Constantia: LINUX_BODY_FONTS['Libre Baskerville']
  };
  for (const key of Object.keys(BODY_FONTS)) delete BODY_FONTS[key];
  Object.assign(BODY_FONTS, LINUX_BODY_FONTS);
  for (const [key, stack] of Object.entries(legacy)) {
    Object.defineProperty(BODY_FONTS, key, {
      value: stack, enumerable: false, writable: true, configurable: true
    });
  }
  DROPCAP_FONTS.literary = '"Libre Bodoni", "Didot", "Bodoni 72", Georgia, serif';
  DROPCAP_FONTS.fantasy = '"TeX Gyre Chorus", "Apple Chancery", "Snell Roundhand", cursive';
  DROPCAP_FONTS.scifi = '"Jost", Futura, "Avenir Next", "Helvetica Neue", sans-serif';
  // A shared choice list, when the renderer defines one, has to name these
  // bundled faces on Linux rather than fonts the machine does not have.
  if (typeof BODY_FONT_CHOICES !== 'undefined') {
    BODY_FONT_CHOICES.splice(0, BODY_FONT_CHOICES.length, ...Object.keys(LINUX_BODY_FONTS));
  }
}
installLinuxBodyFonts();

/* ================================================================== */
/*  ACCESSIBILITY: keyboard, screen readers, system settings           */
/* ================================================================== */
// NEO stays quiet by design; these make the quiet parts reachable. The
// system's own settings decide the rest: "Increase contrast" turns on the
// Brighter Interface, "Reduce motion" stills the fades and slides.

const SYSTEM_CONTRAST = window.matchMedia('(prefers-contrast: more)');
const SYSTEM_STILL = window.matchMedia('(prefers-reduced-motion: reduce)');
SYSTEM_CONTRAST.addEventListener('change', () => applyFonts());
function scrollBehavior() { return SYSTEM_STILL.matches ? 'auto' : 'smooth'; }

// Something clickable that isn't a <button>: Tab reaches it, Enter or Space
// presses it, and a screen reader hears its name.
function pressable(el, label) {
  el.tabIndex = 0;
  if (!el.getAttribute('role')) el.setAttribute('role', 'button');
  if (label) el.setAttribute('aria-label', label);
  el.addEventListener('keydown', (e) => {
    if (e.target !== el || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); }
  });
}
for (const id of ['#author-chip', '#goal-counter', '#word-counter', '#pos-counter', '#zoom-level']) pressable($(id));

// The mouse leaves nothing focused in the quiet chrome, as before these were
// focusable: after a click on a book, a chapter row, a tab, a counter or a
// button there, the writer's next keys don't press it again, wake the bottom
// bar or slide a pane open. (Text fields keep focus; they always show it.)
document.addEventListener('mouseup', () => {
  const el = document.activeElement;
  if (!el || el === document.body || el.matches(':focus-visible') || el.closest('.modal-backdrop')) return;
  if (el.closest('#bottombar, #nav-pane, #side-pane, #shelf-header, #shelves')) el.blur();
}, true);

// the tabs: Enter or Space opens one, ← → move along the row
$$('.tab').forEach((tab, i, all) => {
  tab.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tab.click(); }
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      all[(i + (e.key === 'ArrowRight' ? 1 : all.length - 1)) % all.length].focus();
    }
  });
});

// Dialogs: announced as dialogs, keyboard focus moves inside (so Esc and
// Enter reach them) and comes back to where it was when they close.
let focusBeforeDialog = null;
document.addEventListener('focusin', (e) => {
  if (e.target.closest('.modal-backdrop')) return;
  // only what the keyboard reached gets focus back when a dialog closes; after
  // a click, the next Space the writer types must not press that control again
  focusBeforeDialog = e.target.matches(':focus-visible') ? e.target : null;
}, true);
function dialogify(bd) {
  const box = bd.querySelector('.modal');
  if (!box || box.getAttribute('role')) return;
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  const h = box.querySelector('h2');
  if (h) {
    h.id = h.id || 'dlg-' + Math.random().toString(36).slice(2, 9);
    box.setAttribute('aria-labelledby', h.id);
  }
  bd._returnFocus = focusBeforeDialog;
  requestAnimationFrame(() => {
    if (bd.hidden || bd.contains(document.activeElement)) return;
    const first = box.querySelector('input:not([type=hidden]), select, textarea, .m-ok, button, [tabindex="0"]');
    if (first) first.focus({ preventScroll: true });
  });
}
new MutationObserver((muts) => {
  for (const m of muts) {
    m.addedNodes.forEach((n) => { if (n.nodeType === 1 && n.classList.contains('modal-backdrop')) dialogify(n); });
    m.removedNodes.forEach((n) => {
      const back = n._returnFocus;
      if (!back || !back.isConnected || back.isContentEditable) return; // the page restores its own caret
      if (document.activeElement && document.activeElement !== document.body) return;
      back.focus({ preventScroll: true });
    });
  }
}).observe(document.body, { childList: true });
$$('.modal-backdrop').forEach(dialogify);

// F6 walks the regions a mouse finds by hovering: the page, the chapters
// pane, the notes pane, the bottom bar. ⇧F6 walks back; Esc returns to
// the page from any of them. A pane opened this way closes when the
// keyboard leaves it, unless it is pinned.
let pagePlace = null; // where the caret was when the keyboard left the page
$('#paper-scroll').addEventListener('focusout', (e) => {
  if ($('#paper-scroll').contains(e.relatedTarget)) return;
  const sel = window.getSelection();
  if (sel.rangeCount && e.target.isContentEditable) pagePlace = { el: e.target, range: sel.getRangeAt(0).cloneRange() };
});
function focusPage() {
  if (pagePlace && pagePlace.el.isConnected && !pagePlace.el.closest('[hidden]')) {
    pagePlace.el.focus({ preventScroll: true });
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(pagePlace.range);
    return;
  }
  if (currentTab === 'manuscript' && book && book.chapterOrder.length) {
    focusChapter(currentChapterId || book.chapterOrder[0]);
    return;
  }
  const aux = $('#aux-paper');
  const target = aux.querySelector('[contenteditable="true"]:not([hidden] *), button');
  if (target) target.focus();
}
function openPaneFromKeyboard(pane, first) {
  if (!pane.classList.contains('open')) { pane.classList.add('open'); pane.dataset.kbd = '1'; }
  if (first) first.focus();
}
for (const pane of [$('#nav-pane'), $('#side-pane')]) {
  pane.addEventListener('focusout', (e) => {
    if (pane.contains(e.relatedTarget) || pane.dataset.kbd !== '1') return;
    // a list rebuilt under the keyboard hands focus straight back: wait a beat
    setTimeout(() => {
      if (pane.contains(document.activeElement) || pane.dataset.kbd !== '1') return;
      pane.dataset.kbd = '0';
      if (pane.dataset.pinned !== '1' && !chapterDragActive) pane.classList.remove('open');
    }, 0);
  });
}
const REGIONS = [
  { box: () => $('#paper-scroll'), enter: focusPage },
  {
    box: () => $('#nav-pane'),
    enter: () => {
      const rows = $$('#nav-list .n-row');
      const cur = $('#nav-list .nav-item.current .n-row');
      openPaneFromKeyboard($('#nav-pane'), cur || rows[0] || $('#nav-add'));
    }
  },
  {
    box: () => $('#side-pane'),
    enter: () => openPaneFromKeyboard($('#side-pane'), $('#sticky-list textarea') || $('#side-pin'))
  },
  { box: () => $('#bottombar'), enter: () => ($('.tab.active') || $('#back-to-shelf')).focus() }
];
// F6, or ⌃Tab: on a Mac the F-keys drive brightness and sound unless fn is
// held, so F6 alone would do nothing there.
const regionKey = (e) => e.key === 'F6' || (e.key === 'Tab' && e.ctrlKey && !e.metaKey && !e.altKey);
// On the shelf: the books, then the header (author, Import, + Shelf).
const SHELF_REGIONS = [
  { box: () => $('#shelves'), enter: () => { const b = $('#shelves .book') || $('#shelves .new-book'); if (b) b.focus(); } },
  { box: () => $('#shelf-header'), enter: () => $('#author-chip').focus() }
];
document.addEventListener('keydown', (e) => {
  if (document.querySelector('.modal-backdrop:not([hidden])')) return;
  if ($('#editor-view').hidden) {
    if (!regionKey(e)) return;
    e.preventDefault();
    const at = SHELF_REGIONS.findIndex((r) => r.box().contains(document.activeElement));
    SHELF_REGIONS[at < 0 ? 0 : (at + 1) % SHELF_REGIONS.length].enter();
    return;
  }
  const here = REGIONS.findIndex((r) => r.box().contains(document.activeElement));
  if (regionKey(e)) {
    e.preventDefault();
    // from nowhere in particular (a book just opened), forward starts at the page
    if (here < 0) { REGIONS[e.shiftKey ? REGIONS.length - 1 : 0].enter(); return; }
    REGIONS[(here + (e.shiftKey ? REGIONS.length - 1 : 1)) % REGIONS.length].enter();
    return;
  }
  // Esc from a pane or the bottom bar: back to the words, not to the shelf
  if (e.key === 'Escape' && !e.isComposing && here > 0 && $('#searchbar').hidden) {
    e.preventDefault();
    e.stopPropagation();
    focusPage();
  }
}, true);
// up and down the chapter list
$('#nav-list').addEventListener('keydown', (e) => {
  if (!e.target.classList.contains('n-row') || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
  e.preventDefault();
  const rows = $$('#nav-list .n-row');
  const i = rows.indexOf(e.target) + (e.key === 'ArrowDown' ? 1 : -1);
  if (rows[i]) rows[i].focus();
});

/* ================================================================== */

loadLibrary().then(() => {
  applyFonts();
  typewriterEnabled = !!library.typewriter;
  applyTypewriter();
  vimEnabled = !!library.vimKeys;
  applyVim();
  focusLevel = FOCUS_LEVELS.includes(library.focus) ? library.focus : 'off';
  applyFocus();
});
