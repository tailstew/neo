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

// opts.proof: the timestamp services and drand stand in for (fake-tsa.js),
// so Record and Timestamp seals and stamps with no network (neo.tsa)
module.exports = function e2e(name, library = {}, opts = {}) {
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
    authorName: '', penNames: [], firstRunDone: true, moreFeatures: true, proveWriting: false, pageTheme: 'night',
    shelves: [{ id: 'shelf-1', name: 'Works in Progress', bookIds: [] }],
    ...library
  }));
  const loadFile = BrowserWindow.prototype.loadFile;
  BrowserWindow.prototype.loadFile = function (file, o) {
    return loadFile.call(this, path.resolve(__dirname, '..', file), o);
  };
  const neo = { tmp, LIB, R, assert, book: null };

  /* ---------- the clock, the trash and the network, for the tests ---------- */

  // Timers of these lengths in the main process run after neo.shorten[ms]
  // instead (proof's five minutes after the writing stops); the half-hour
  // retry runs when a test calls neo.halfHour(). neo.mainAhead(ms) moves the
  // main process's clock on (Date.now and new Date()), 0 back.
  neo.shorten = {};
  const realTimeout = global.setTimeout;
  const realInterval = global.setInterval;
  global.setTimeout = function (fn, ms, ...a) { return realTimeout(fn, ms in neo.shorten ? neo.shorten[ms] : ms, ...a); };
  const halfHourly = [];
  global.setInterval = function (fn, ms, ...a) {
    if (ms === 30 * 60 * 1000) halfHourly.push(fn);
    return realInterval(fn, ms, ...a);
  };
  neo.halfHour = async () => { for (const fn of halfHourly) fn(); await neo.tick(300); };
  const RealDate = Date;
  let ahead = 0;
  class TestDate extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(RealDate.now() + ahead); }
    static now() { return RealDate.now() + ahead; }
  }
  neo.mainAhead = (ms) => { ahead = ms; global.Date = ms ? TestDate : RealDate; };

  // the system trash, as a folder of the test's own: what NEO trashes lands
  // in neo.trashed, and in <tmp>/Trash
  const { shell, utilityProcess } = require('electron');
  neo.trashed = [];
  shell.trashItem = async (p) => {
    const to = path.join(tmp, 'Trash', neo.trashed.length + '-' + path.basename(p));
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(p, to);
    neo.trashed.push({ from: p, to });
  };

  if (opts.proof) {
    const Proof = require('../proof.js');
    const FakeTsa = require('./fake-tsa.js');
    // three authorities on 127.0.0.1 in place of DigiCert, Sectigo and
    // GlobalSign (their names and addresses as NEO shows them), started in
    // neo.run; a fourth for a service the writer adds
    neo.tsa = {};
    neo.Proof = Proof;
    const HOSTS = { 'timestamp.digicert.com': 'digicert', 'timestamp.sectigo.com': 'sectigo', 'timestamp.globalsign.com': 'globalsign' };
    const realFetch = globalThis.fetch;
    neo.drandUp = false;
    globalThis.fetch = async (url, o) => {
      const u = new URL(String(url));
      if (HOSTS[u.hostname]) return realFetch(neo.tsa[HOSTS[u.hostname]].url, o);
      if (/drand/.test(u.hostname)) throw new Error('offline'); // no `after`: the seals are made without one
      if (u.hostname !== '127.0.0.1') throw new Error('the tests reach no network: ' + u.href);
      return realFetch(url, o);
    };
    neo.startTsas = async () => {
      for (const id of ['digicert', 'sectigo', 'globalsign', 'added', 'other']) neo.tsa[id] = await FakeTsa.start({ certs: id === 'added' ? 'added' : 'test' });
      neo.tsa.other.mode = 'html';
      // (Sectigo asks for 15 s between requests: tests that seal often would pass it over)
      Proof.TSAS.find((t) => t.id === 'sectigo').gap = 0;
      // the test root (made as fake-tsa.js loads) trusted as NEO's own roots
      // are, here and in History's worker
      neo.tsa.digicert.trust(Proof);
      const roots = path.join(tmp, 'test-roots.pem');
      fs.writeFileSync(roots, FakeTsa.rootPem);
      process.env.NEO_E2E_ROOTS = roots;
      // (and in the proof worker, which makes the seals: the authorities by the names NEO asks for)
      process.env.NEO_E2E_TSA_HOSTS = JSON.stringify(Object.fromEntries(Object.entries(HOSTS).map(([host, id]) => [host, neo.tsa[id].url])));
    };
    // (History's worker swapped for one that trusts the test root: if main.js
    // stops forking history-worker.js by that name, say so, rather than let
    // every timestamp in History quietly go untrusted)
    for (const w of ['history-worker.js', 'proof-worker.js']) {
      if (!fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8').includes(`'${w}'`)) {
        throw new Error(`e2e-neo.js: main.js no longer forks ${w}; update the worker swap below`);
      }
    }
    const fork = utilityProcess.fork;
    utilityProcess.fork = function (file, args, o) {
      if (/history-worker\.js$/.test(file)) file = path.join(__dirname, 'e2e-history-worker.js');
      if (/proof-worker\.js$/.test(file)) file = path.join(__dirname, 'e2e-proof-worker.js');
      return fork.call(this, file, args, o);
    };
    neo.sealsDir = () => path.join(neo.recDir(), 'seals');
    neo.seals = () => { try { return fs.readdirSync(neo.sealsDir()).sort(); } catch { return []; } };
  }

  require('../main.js');

  let wc;
  const js = neo.js = (code) => wc.executeJavaScript(code, true);
  const tick = neo.tick = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));
  neo.CTRL = process.platform === 'darwin' ? 'meta' : 'control';

  /* ---------- the writer's hands ---------- */

  const { editKey } = require('./e2e-keys');
  const key = neo.key = (keyCode, modifiers = []) => {
    // ⌘X, ⌘V, ⌘Z and the rest are the Edit menu's on a Mac: sent there as a writer's would be (e2e-keys.js)
    const edit = /^[xcvaz]$/i.test(keyCode) && modifiers[0] === neo.CTRL && (modifiers.length === 1 || (modifiers.length === 2 && modifiers[1] === 'shift' && /^z$/i.test(keyCode)));
    if (edit) return editKey(wc, keyCode, { shift: modifiers.includes('shift') });
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
  // the tag dialog (askTagNote) answered: the name, when it asks one, and the note
  neo.answerTagNote = async (name, note) => {
    await neo.waitFor(`!!document.querySelector('.tag-note-modal .tn-note')`);
    await js(`(() => {
      const bd = document.querySelector('.tag-note-modal');
      const n = bd.querySelector('.tn-name');
      if (!n.hidden) n.value = ${JSON.stringify(name || '')};
      bd.querySelector('.tn-note').value = ${JSON.stringify(note || '')};
      bd.querySelector('.m-ok').click();
    })()`);
    await neo.tick(300);
  };
  // the recording on disk: this computer's folder in the book
  neo.recDir = () => {
    const root = path.join(LIB, neo.book, 'recording');
    return path.join(root, fs.readdirSync(root).find((n) => n.startsWith('d-')));
  };
  neo.readPart = (file) => (file.endsWith('.gz') ? zlib.gunzipSync(fs.readFileSync(file)) : fs.readFileSync(file)).toString('utf8');

  /* ---------- running ---------- */

  const tests = [];
  const TEST_MS = 5 * 60 * 1000;
  neo.test = (title, fn) => tests.push({ title, fn });
  neo.run = (setup) => {
    (async () => {
      await app.whenReady();
      if (neo.startTsas) await neo.startTsas();
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
          const t0 = Date.now();
          try {
            // a test that never finishes fails, rather than holding up the rest
            let timer;
            await Promise.race([t.fn(), new Promise((resolve, reject) => { timer = realTimeout(() => reject(new Error('the test took over ' + TEST_MS / 1000 + ' s')), TEST_MS); })])
              .finally(() => clearTimeout(timer));
            const r = await js('rec.on ? rec.check() : { unobserved: 0, mismatched: [] }');
            assert.equal(r.unobserved || 0, 0, 'changes the recorder didn’t see');
            assert.deepEqual(r.mismatched || [], [], 'chapters the log doesn’t replay to');
            console.log('ok   ' + t.title + ` (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
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
