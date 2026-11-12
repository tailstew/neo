// What an end-to-end test of NEO's window needs: a throwaway library, NEO
// started on it, and the writer's hands (keys, pastes, the caret) and eyes
// (History's state, the menus). Each *.e2e.js that uses it calls it first,
// before anything else of Electron's runs:
//
//   const neo = require('./e2e-neo.js')('history');
//   neo.test('…', async () => { … });
//   neo.run(async () => { /* the book the tests start from */ });
//
// recording.e2e.js and the others keep their own copies of these helpers;
// new tests use this.

'use strict';

const { app, BrowserWindow, Menu } = require('electron');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const R = require('../recording.js');

module.exports = function e2e(name, library = {}) {
  // A folder of its own for each run; earlier runs' folders go once their
  // process has ended (see words.e2e.js)
  const prefix = `neo-${name}-test-`;
  for (const n of fs.readdirSync(os.tmpdir())) {
    if (!n.startsWith(prefix)) continue;
    const pid = /^(\d+)-/.exec(n.slice(prefix.length));
    if (!pid || +pid[1] === process.pid) continue;
    try { process.kill(+pid[1], 0); continue; } catch (err) { if (err.code === 'EPERM') continue; }
    fs.rmSync(path.join(os.tmpdir(), n), { recursive: true, force: true });
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}${process.pid}-`));
  const LIB = path.join(tmp, 'NEO Library');
  app.setPath('userData', path.join(tmp, 'app'));
  app.setPath('documents', tmp);
  fs.mkdirSync(LIB);
  fs.writeFileSync(path.join(LIB, 'library.json'), JSON.stringify({
    authorName: '', penNames: [], firstRunDone: true, historyAsked: true, pageTheme: 'night',
    shelves: [{ id: 'shelf-1', name: 'Works in Progress', bookIds: [] }],
    ...library
  }));
  const loadFile = BrowserWindow.prototype.loadFile;
  BrowserWindow.prototype.loadFile = function (file, opts) {
    return loadFile.call(this, path.resolve(__dirname, '..', file), opts);
  };
  require('../main.js');

  const neo = { tmp, LIB, R, assert, book: null };
  let wc;
  const js = neo.js = (code) => wc.executeJavaScript(code, true);
  const tick = neo.tick = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
  neo.CTRL = process.platform === 'darwin' ? 'meta' : 'control';

  /* ---------- the writer's hands ---------- */

  const key = neo.key = (keyCode, modifiers = []) => {
    wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
  };
  // typed as keys: '\n' is Enter, '\b' Backspace
  neo.type = async (keys) => {
    for (const k of keys) {
      if (k === '\b') { key('Backspace'); continue; }
      const keyCode = k === '\n' ? 'Enter' : k;
      wc.sendInputEvent({ type: 'keyDown', keyCode });
      wc.sendInputEvent({ type: 'char', keyCode: k === '\n' ? '\r' : k });
      wc.sendInputEvent({ type: 'keyUp', keyCode });
    }
    await tick(300);
  };
  // A paste as the window gets one: a paste event at the caret carrying the
  // text (see recording.e2e.js: the system clipboard is shared, and flaky)
  neo.paste = async (data) => {
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
  };
  // Copy, as the window gets one: paragraph p of chapter n selected, and a
  // copy event on it. Returns the text copied.
  neo.copyParagraph = (n, p) => js(`(() => {
    const para = document.querySelectorAll('.chapter-body')[${n}].querySelectorAll('p')[${p}];
    const r = document.createRange();
    r.selectNodeContents(para);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
    para.dispatchEvent(new ClipboardEvent('copy', { clipboardData: new DataTransfer(), bubbles: true, cancelable: true, composed: true }));
    return String(getSelection());
  })()`);
  // the caret in chapter n (from 0), paragraph p, letter off (-1: the end)
  neo.caretAt = async (n, p, off) => {
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
  };
  neo.flush = async () => { await js('flushAllSaves()'); await tick(500); };
  neo.chapterIds = () => js('[...book.chapterOrder]');
  neo.html = (n) => js(`chapterHTML[book.chapterOrder[${n}]]`);
  neo.bookNow = () => js('Object.fromEntries(book.chapterOrder.map((c) => [c, chapterHTML[c]]))');
  neo.sessionLines = () => js('rec.w.lines.slice()').then((ls) => ls.map((l) => JSON.parse(l)));
  neo.snapList = () => js('window.neo.snapshotList(book.id)');
  // the writer's day moved on n more days (as the goals count it); back to the real one with n = 0
  neo.dayAhead = (n) => js(`(() => {
    window.__realDay = window.__realDay || writingDay;
    if (!${n}) { writingDay = window.__realDay; return writingDay(); }
    // from now on it's n days later than it was; a moment from before keeps its own day
    const from = Date.now();
    const real = writingDay;
    writingDay = (d = new Date()) => { const ms = new Date(d).getTime(); return real(new Date(ms >= from ? ms + ${n} * 86400000 : ms)); };
    return writingDay();
  })()`);

  /* ---------- what's on the screen ---------- */

  neo.waitFor = async (code, ms = 8000) => {
    for (const end = Date.now() + ms; Date.now() < end; await tick(50)) if (await js(code)) return;
    throw new Error('timed out waiting for ' + code + (/historyShown/.test(code) ? '\nHistory: ' + JSON.stringify(await neo.historyState()) : ''));
  };
  // A menu item by its path, top menu first: ('File', 'Writing History…')
  // is File's own item, not Export ▸ Writing History…
  neo.menuItem = (...labels) => {
    let items = Menu.getApplicationMenu().items;
    let item = null;
    for (const label of labels) {
      item = items.find((x) => x.label === label);
      if (!item) throw new Error('no menu item ' + labels.join(' ▸ '));
      items = item.submenu ? item.submenu.items : [];
    }
    return item;
  };
  // the newest dialog over the page (first run's is there too, hidden)
  neo.topModal = () => js(`(() => {
    const bd = [...document.querySelectorAll('.modal-backdrop')].filter((b) => !b.hidden && getComputedStyle(b).display !== 'none').pop();
    if (!bd) return null;
    const q = (s) => bd.querySelector(s);
    return { title: q('h2') ? q('h2').textContent : '', text: bd.textContent, ok: q('.m-ok') ? q('.m-ok').textContent : '' };
  })()`);
  neo.toastText = () => js('$("#hint").hidden ? "" : $("#hint").textContent');

  /* ---------- Writing History ---------- */

  neo.playerHTML = () => js(`(() => {
    const out = {};
    for (const sec of historyShown.player.paper.querySelectorAll('.rp-chapter')) {
      const body = sec.querySelector('.rp-body').cloneNode(true);
      body.querySelectorAll('.rp-caret').forEach((m) => m.remove());
      out[sec.dataset.ch] = captureBody(body);
    }
    return out;
  })()`);
  neo.historyState = () => js(`(() => {
    if (!historyShown) return { open: false };
    const p = historyShown.player;
    const h = p.h();
    const play = document.querySelector('.hs-play');
    return { open: true, view: p.view(), building: p.building(), loaded: p.loaded(), mode: p.mode(), day: h && h.day,
      pos: p.pos(), lead: p.lead(), steps: p.steps().length, part: !!p.part(), play: play && play.getAttribute('aria-label') };
  })()`).catch((err) => ({ error: String((err && err.message) || err) }));
  // History opened, with its days read and the day shown loaded
  neo.daysReady = async () => {
    await neo.waitFor('!!historyShown && !historyShown.player.building() && historyShown.player.view() === "days" && historyShown.player.loaded().state !== "loading"', 120000);
    const loaded = await js('historyShown.player.loaded()');
    assert.equal(loaded.state, 'ready', 'the days’ load: ' + JSON.stringify(loaded));
  };
  neo.openHistory = async (opts = {}) => {
    await js(`openHistory(${JSON.stringify(opts)})`);
    await neo.waitFor('!!historyShown'); // (fails at once if something else opened)
    await neo.daysReady();
  };
  neo.playerReady = async ({ drawn = true } = {}) => {
    await neo.waitFor('!!historyShown && historyShown.player.view() === "player" && historyShown.player.loaded().state !== "loading"', 120000);
    const loaded = await js('historyShown.player.loaded()');
    assert.equal(loaded.state, 'ready', 'the player’s load: ' + JSON.stringify(loaded));
    if (drawn) await neo.waitFor('!!historyShown.player.paper.querySelector(".rp-chapter")');
  };
  // closed, however far in it was
  neo.closeHistory = async () => {
    for (let i = 0; i < 4 && (await js('!!historyShown')); i++) { key('Escape'); await tick(250); }
    if (await js('!!historyShown')) await js('historyShown(); 0');
  };
  neo.listed = () => js(`[...document.querySelectorAll('.hs-list .hs-ch:not(.hs-tag-item)')].slice(1).map((b) => ({ name: b.querySelector('.hs-ch-name').textContent, absent: b.classList.contains('hs-ch-absent') }))`);
  neo.tagItems = () => js(`[...document.querySelectorAll('.hs-tag-item .hs-ch-name')].map((x) => x.textContent)`);
  // a tag's right-click menu, answered with `value`
  neo.tagMenu = (name, value) => js(`(() => {
    const real = popMenu;
    popMenu = async (x, y, items) => { popMenu = real; window.__menu = items.filter((i) => i && i.label).map((i) => ({ label: i.label, disabled: !!i.disabled })); return ${JSON.stringify(value)}; };
    const b = [...document.querySelectorAll('.hs-tag-item')].find((x) => x.querySelector('.hs-ch-name').textContent === ${JSON.stringify(name)});
    if (!b) { popMenu = real; return false; }
    b.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }));
    return true;
  })()`);
  // the input dialog NEO asks with (askInput), answered
  neo.answerInput = async (text) => {
    await neo.waitFor(`[...document.querySelectorAll('.modal-backdrop')].some((b) => !b.classList.contains('page-sheet-backdrop') && b.querySelector('input') && !b.hidden && getComputedStyle(b).display !== 'none')`);
    await js(`(() => {
      const bd = [...document.querySelectorAll('.modal-backdrop')].filter((b) => !b.classList.contains('page-sheet-backdrop') && b.querySelector('input') && !b.hidden && getComputedStyle(b).display !== 'none').pop();
      const i = bd.querySelector('input');
      i.value = ${JSON.stringify(text)};
      i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    })()`);
    await tick(300);
  };
  // the recording on disk: this computer's folder in the book
  neo.recDir = () => {
    const root = path.join(LIB, neo.book, 'recording');
    return path.join(root, fs.readdirSync(root).find((n) => n.startsWith('d-')));
  };
  neo.readPart = (file) => (file.endsWith('.gz') ? zlib.gunzipSync(fs.readFileSync(file)) : fs.readFileSync(file)).toString('utf8');

  /* ---------- running ---------- */

  const tests = [];
  neo.test = (title, fn) => tests.push({ title, fn });
  neo.run = (setup) => {
    (async () => {
      await app.whenReady();
      let failed = 0;
      try {
        let win;
        while (!(win = BrowserWindow.getAllWindows()[0])) await tick(50);
        wc = neo.wc = win.webContents;
        neo.win = win;
        // the player plays on animation frames: keep them coming unseen
        wc.setBackgroundThrottling(false);
        while (!(await js(`typeof library !== 'undefined' && !!library`).catch(() => false))) await tick(50);
        await tick(300);
        await js(`document.getElementById('firstrun').hidden = true`);
        await setup();
        win.focus();
        const only = process.env.NEO_E2E_ONLY ? new RegExp(process.env.NEO_E2E_ONLY, 'i') : null;
        let ran = 0;
        for (const t of tests) {
          if (only && !only.test(t.title)) continue;
          ran++;
          try {
            await t.fn();
            const r = await js('rec.on ? rec.check() : { unobserved: 0, mismatched: [] }');
            assert.equal(r.unobserved || 0, 0, 'changes the recorder didn’t see');
            assert.deepEqual(r.mismatched || [], [], 'chapters the log doesn’t replay to');
            console.log('ok   ' + t.title);
          } catch (err) {
            failed++;
            console.log('FAIL ' + t.title + '\n     ' + String(err && err.stack || err).replace(/\n/g, '\n     '));
            // a failed test can leave History or a dialog open: close them
            const left = await neo.historyState();
            if (left.open) console.log('     History left open: ' + JSON.stringify(left));
            // (dialogs are position: fixed, so offsetParent can't tell a shown one)
            await js(`(() => {
              if (historyShown) historyShown();
              document.querySelectorAll('.modal-backdrop:not(#firstrun)').forEach((b) => { if (!b.hidden && getComputedStyle(b).display !== 'none') b.remove(); });
              historyExporting = false;
            })()`).catch(() => {});
            await tick(400);
            // and back in the book the tests write in
            if (neo.book) await js(`(async () => { const id = ${JSON.stringify(neo.book)}; if (!book || book.id !== id || document.getElementById('editor-view').hidden) await openBook(id); })()`).catch(() => {});
            await tick(400);
          }
        }
        console.log(`\n${ran - failed} passed, ${failed} failed` + (ran < tests.length ? ` (${tests.length - ran} not run)` : ''));
      } catch (err) {
        failed++;
        console.error(err);
      } finally {
        app.exit(failed ? 1 : 0);
      }
    })();
  };
  return neo;
};
