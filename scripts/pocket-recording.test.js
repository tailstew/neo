'use strict';

// Writing History in NEO Pocket (docs/neo-recording-plan.md, phase 4e). The
// bridge (pocket/www/pocket-bridge.js) and its history worker
// (pocket/www/pocket-history.js) run here in vm contexts, against a fake
// Capacitor Filesystem that keeps its files in a temporary folder, with
// Node's own CompressionStream. What Pocket writes must be what desktop NEO
// writes from the same lines, byte for byte once ungzipped, and what it
// reads back and builds must be what the desktop's own code makes of them.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');
const { test } = require('node:test');
const R = require('../recording.js');
const Files = require('../recording-files.js');
const { BookDays } = require('../history-worker.js');

const ROOT = path.join(__dirname, '..');
const WWW = path.join(ROOT, 'pocket', 'www');
const BOOK = 'book-test-abc';
const OTHER = 'd-fedcba9876543210'; // a computer that wrote the book too

// Capacitor's Filesystem, as Android's plugin answers, over a real folder
function fakeFilesystem(base) {
  const where = ({ path: p, directory }) => {
    assert.ok(directory === 'DOCUMENTS' || directory === 'DATA', 'a directory the bridge names: ' + directory);
    return path.join(base, directory, p);
  };
  const nope = (what) => Promise.reject(new Error(what + ' does not exist.'));
  return {
    async readdir(o) {
      const d = where(o);
      if (!fs.existsSync(d)) return nope('Directory');
      return { files: fs.readdirSync(d).map((name) => ({ name, type: fs.statSync(path.join(d, name)).isDirectory() ? 'directory' : 'file' })) };
    },
    async readFile(o) {
      const f = where(o);
      if (!fs.existsSync(f)) return nope('File');
      const b = fs.readFileSync(f);
      return { data: o.encoding === 'utf8' ? b.toString('utf8') : b.toString('base64') };
    },
    async writeFile(o) {
      const f = where(o);
      if (o.recursive) fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, o.encoding === 'utf8' ? Buffer.from(o.data, 'utf8') : Buffer.from(o.data, 'base64'));
      return { uri: 'file://' + f };
    },
    async stat(o) {
      const f = where(o);
      if (!fs.existsSync(f)) return nope('File');
      const st = fs.statSync(f);
      return { type: st.isDirectory() ? 'directory' : 'file', size: st.size, mtime: st.mtimeMs };
    },
    async deleteFile(o) {
      const f = where(o);
      if (!fs.existsSync(f)) return nope('File');
      fs.unlinkSync(f);
    },
    async rmdir(o) { fs.rmSync(where(o), { recursive: true, force: true }); },
    async mkdir(o) { fs.mkdirSync(where(o), { recursive: true }); }
  };
}

const globalsFor = (ctx) => Object.assign(ctx, {
  console, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, structuredClone,
  atob, btoa, Blob, Response, TextEncoder, TextDecoder, CompressionStream, DecompressionStream,
  crypto: globalThis.crypto
});

// A web worker: the script in a context of its own, messages cloned both ways
const workers = []; // every one started, to see which are still running
class FakeWorker {
  constructor(url) {
    workers.push(this);
    this.terminated = false;
    this.onmessage = null;
    this.onerror = null;
    const self = globalsFor({});
    self.self = self;
    self.importScripts = (...names) => {
      for (const n of names) vm.runInContext(fs.readFileSync(path.join(fs.existsSync(path.join(WWW, n)) ? WWW : ROOT, n), 'utf8'), self, { filename: n });
    };
    self.postMessage = (m) => { const c = structuredClone(m); setTimeout(() => !this.terminated && this.onmessage && this.onmessage({ data: c }), 0); };
    vm.createContext(self);
    this.self = self;
    vm.runInContext(fs.readFileSync(path.join(WWW, url), 'utf8'), self, { filename: url });
  }
  postMessage(m) {
    assert.ok(!this.terminated, 'a message to a worker that was stopped');
    const c = structuredClone(m);
    setTimeout(() => this.self.onmessage({ data: c }), 0);
  }
  terminate() { this.terminated = true; }
}

// The page: recording.js, recording-files.js and the bridge, as index.html
// loads them. worker: false, a web view whose workers don't start.
function pocket(base, { worker = true } = {}) {
  const noop = () => {};
  const el = () => ({ style: {}, classList: { contains: () => false, add: noop, remove: noop }, addEventListener: noop, appendChild: noop, remove: noop });
  const head = el();
  // a <script> added to the page runs, then says so
  head.appendChild = (s) => setTimeout(() => {
    vm.runInContext(fs.readFileSync(path.join(fs.existsSync(path.join(WWW, s.src)) ? WWW : ROOT, s.src), 'utf8'), page, { filename: s.src });
    s.onload();
  }, 0);
  const page = globalsFor({
    navigator: { language: 'en', userAgent: 'Mozilla/5.0 (Linux; Android 14; K)', platform: 'Linux armv8l' },
    document: { addEventListener: noop, getElementById: () => null, querySelector: () => null, createElement: el, body: el(), documentElement: el(), head },
    fetch: () => Promise.reject(new Error('no dictionaries here')),
    Worker: worker ? FakeWorker : class { constructor() { throw new Error('no workers here'); } },
    MutationObserver: class { observe() {} },
    localStorage: { removeItem: noop },
    getComputedStyle: () => ({}),
    Capacitor: {
      getPlatform: () => 'android',
      registerPlugin: () => ({ set: () => Promise.resolve(), keyboard: () => Promise.resolve({}) }),
      Plugins: { Filesystem: fakeFilesystem(base) }
    }
  });
  page.window = page;
  page.self = page;
  vm.createContext(page);
  for (const f of ['recording.js', 'recording-files.js', 'pocket/www/pocket-bridge.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), page, { filename: f });
  }
  return page;
}

// Sessions on one device, as SessionWriter writes them: [day, hour, lines]
function written(device, steps) {
  let prev = null;
  return steps.map(([day, hour, lines], k) => {
    const id = `${day}T${String(hour).padStart(2, '0')}-00-00Z-pk${k}${device.slice(-2)}`;
    const w = new R.SessionWriter({ neoRec: 1, session: id, device, book: BOOK, day, startedAt: `${day}T${String(hour).padStart(2, '0')}:00:00.000Z`, tz: 'UTC', prev });
    const chunks = [];
    for (const l of lines) {
      if (l === '|') { const c = w.chunk(); if (c) chunks.push(c); continue; }
      w.push([l[0] === 'e' ? 120 : 0, ...l]);
    }
    w.push([100, 'end', {}]);
    chunks.push(w.chunk());
    prev = w.H;
    return { id, device, day, chunks, text: w.lines.join('\n') + '\n' };
  });
}
const typed = (at, text) => [...text].map((c, i) => ['e', at + i, 0, c, 'iT']);
const baseline = (ch, html) => ['b', ch, html, R.digest(html), 'baseline'];
const carryOn = (ch, html) => ['b', ch, null, R.digest(html), 'continue'];

const gunzipFile = (f) => zlib.gunzipSync(fs.readFileSync(f)).toString('utf8');
const tree = (dir) => {
  const out = {};
  const walk = (d, rel) => {
    for (const n of fs.readdirSync(d).sort()) {
      const f = path.join(d, n);
      const r = rel ? rel + '/' + n : n;
      if (fs.statSync(f).isDirectory()) walk(f, r);
      else out[r] = n.endsWith('.gz') ? gunzipFile(f) : fs.readFileSync(f, 'utf8');
    }
  };
  if (fs.existsSync(dir)) walk(dir, '');
  return out;
};
const plain = (x) => JSON.parse(JSON.stringify(x));

// The desktop's io over a folder, as main.js makes it
const desktopIO = () => Files.nodeIO({ fs, path, zlib, write: (f, d) => fs.writeFileSync(f, d), log: () => {} });

test('Pocket records what the desktop records, and reads it back the same', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-pocket-'));
  try {
    const page = pocket(base);
    const neo = page.window.neo;
    assert.equal(typeof neo.recStart, 'function', 'a web view with CompressionStream records');
    const library = path.join(base, 'DOCUMENTS', 'NEO Library');
    const recRoot = path.join(library, BOOK, 'recording');

    const start = await neo.recStart(BOOK);
    assert.match(start.device, Files.DEVICE);
    assert.deepEqual(plain(start.known), {});
    assert.equal((await neo.recStart(BOOK)).device, start.device, 'the device keeps its id');
    assert.ok(fs.existsSync(path.join(base, 'DATA', 'recording-device.json')), 'kept in the app’s own folder, not the library');

    const html = '<p>The rain.</p>';
    const [s1, s2] = written(start.device, [
      ['2026-11-01', 9, [baseline('ch-a', html), ...typed(12, ' It fell'), '|', ...typed(20, ' all night'), '|', ['w', R.digest('<p>The rain. It fell all night</p>')]]],
      ['2026-11-02', 9, [carryOn('ch-a', '<p>The rain. It fell all night</p>'), ...typed(30, '. Ma'), '|', ...typed(34, 'ra')]]
    ]);

    // the first session: chunk, chunk, a rollup, the last chunk, closed
    await neo.recChunk(BOOK, s1.id, s1.chunks[0].first, s1.chunks[0].text);
    await neo.recChunk(BOOK, s1.id, s1.chunks[1].first, s1.chunks[1].text);
    assert.equal(await neo.recRollup(BOOK, s1.id), 2);
    for (const c of s1.chunks.slice(2)) await neo.recChunk(BOOK, s1.id, c.first, c.text);
    const dir = path.join(recRoot, start.device);
    assert.deepEqual(fs.readdirSync(path.join(dir, s1.id)).sort(), [`c-${String(s1.chunks[2].first).padStart(6, '0')}.jsonl`, `s-000001-${String(s1.chunks[2].first - 1).padStart(6, '0')}.jsonl.gz`]);
    const open = await neo.recRead(BOOK, start.device, s1.id);
    assert.equal(open.text, s1.text);
    assert.equal(open.open, true);
    await neo.recClose(BOOK, s1.id);
    assert.equal(gunzipFile(path.join(dir, s1.id + '.jsonl.gz')), s1.text, 'a closed session is the lines, gzipped');
    assert.ok(!fs.existsSync(path.join(dir, s1.id)), 'its folder goes');
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'device.json'), 'utf8')).name, 'Android');
    assert.ok(fs.readFileSync(path.join(recRoot, 'README.txt'), 'utf8').startsWith('This is NEO’s Writing History'));

    // the second left open, as when Android ends a backgrounded app: closed, crashed, when the book opens again
    for (const c of s2.chunks.slice(0, -1)) await neo.recChunk(BOOK, s2.id, c.first, c.text);
    const desk = path.join(base, 'desk');
    fs.cpSync(dir, desk, { recursive: true });
    const again = await neo.recStart(BOOK);
    const want = await Files.start(desktopIO(), desk, start.device, path.join(base, 'desk-known.json'));
    assert.deepEqual(plain({ prev: again.prev, known: again.known, edited: again.edited }), plain(want), 'where the recording left each chapter, as the desktop works it out');
    assert.deepEqual(tree(dir), tree(desk), 'the same files, the same lines');
    assert.match(gunzipFile(path.join(dir, s2.id + '.jsonl.gz')), /"end",\{"crashed":true\}/);

    // the list and a closed session's text, as the desktop's
    const list = await neo.recList(BOOK);
    assert.deepEqual(plain(list), plain(await Files.list(desktopIO(), recRoot, start.device)));
    assert.equal((await neo.recRead(BOOK, start.device, s1.id)).text, s1.text);
    await assert.rejects(neo.recRead(BOOK, '../x', s1.id));
    await assert.rejects(neo.recChunk('../elsewhere', s1.id, 1, 'x'));
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('Pocket’s history worker builds the days, starts each, and searches as the desktop’s does', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-pocket-'));
  try {
    const page = pocket(base);
    const neo = page.window.neo;
    const me = (await neo.recStart(BOOK)).device;
    const recRoot = path.join(base, 'DOCUMENTS', 'NEO Library', BOOK, 'recording');
    const a0 = '<p>The rain.</p>';
    const a1 = '<p>The rain. John came in</p>';
    const mine = written(me, [
      ['2026-11-01', 9, [baseline('ch-a', a0), ...typed(12, ' John came in')]],
      // the other computer's words caught up, then John renamed
      ['2026-11-03', 9, [carryOn('ch-a', a1), ['x', 'catch-up'], ['e', 25, 0, ', wet'], ['e', 13, 4, '', 'dWB'], ...typed(13, 'Ivo')]]
    ]);
    const theirs = written(OTHER, [
      ['2026-11-02', 14, [baseline('ch-a', a1), ...typed(25, ', wet')]]
    ]);
    const put = (s, open) => {
      const d = path.join(recRoot, s.device);
      fs.mkdirSync(d, { recursive: true });
      if (!open) { fs.writeFileSync(path.join(d, s.id + '.jsonl.gz'), zlib.gzipSync(s.text)); return; }
      fs.mkdirSync(path.join(d, s.id), { recursive: true });
      fs.writeFileSync(path.join(d, s.id, 'c-000001.jsonl'), s.text);
    };
    put(mine[0]);
    put(theirs[0]);
    put(mine[1], true); // the session being written

    const news = [];
    neo.onRecProgress((m) => news.push(m));
    const built = new Promise((resolve) => neo.onRecProgress((m) => { if (m.type === 'built') resolve(m); }));
    await neo.recDays(BOOK);
    const done = await built;
    assert.equal(done.error, undefined);

    const desk = new BookDays({ root: recRoot, cache: path.join(base, 'desk-cache') });
    const r = await desk.build();
    assert.deepEqual(news.filter((m) => m.type === 'progress').map((m) => plain(m.entry)), plain(r.entries), 'the days, as the desktop builds them');
    assert.deepEqual(plain(done.open), plain(r.open), 'and the session still open, played on');
    assert.ok(fs.existsSync(path.join(base, 'DATA', 'recording-cache', BOOK, 'days.json.gz')), 'the cache in the app’s own folder');
    assert.ok(!fs.existsSync(path.join(base, 'DOCUMENTS', 'NEO Library', 'recording-cache')), 'never the library');

    for (const day of ['2026-11-01', '2026-11-02', '2026-11-03', '2099-01-01']) {
      assert.deepEqual(plain(await neo.recDayStart(BOOK, day)), plain(await desk.dayStart(day)), day);
    }
    assert.equal((await neo.recDayStart(BOOK, '2099-01-01')).page['ch-a'], '<p>The rain. Ivo came in, wet</p>');

    // search: the first pass answers; the second comes as news
    const found = {};
    for (const phrase of ['John', 'came in, wet', 'Ivo', { text: 'ivo', cs: true }, { text: 'iv', word: false }, { text: 'iv' }]) {
      const name = JSON.stringify(phrase);
      const sid = news.length + 1;
      const last = new Promise((resolve) => neo.onRecProgress((m) => { if (m.type === 'search' && m.sid === sid && (m.findings || m.error)) resolve(m); }));
      const first = await neo.recSearch(BOOK, phrase, sid);
      const want = await desk.searchFirst(phrase);
      assert.deepEqual(plain(first.findings), plain(want.findings), name + ': the first pass');
      const both = await last;
      const wantBoth = await desk.searchWithin(phrase, want.findings, () => false, () => {});
      assert.deepEqual(plain(both.findings), plain(wantBoth.findings), name + ': within the days');
      found[name] = !!both.findings.first;
    }
    // the options reach the worker
    assert.deepEqual([found['"Ivo"'], found['{"text":"ivo","cs":true}'], found['{"text":"iv","word":false}'], found['{"text":"iv"}']], [true, false, true, false]);
    // opened again: nothing is built twice
    const page2 = pocket(base);
    const progress = [];
    const built2 = new Promise((resolve) => page2.window.neo.onRecProgress((m) => { progress.push(m); if (m.type === 'built') resolve(m); }));
    await page2.window.neo.recDays(BOOK);
    await built2;
    assert.deepEqual(progress.filter((m) => m.type === 'progress'), []);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('a web view without CompressionStream records nothing, and offers no history', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-pocket-'));
  const saved = globalThis.CompressionStream;
  try {
    globalThis.CompressionStream = undefined;
    const page = pocket(base);
    assert.equal(page.window.neo.recStart, undefined);
    assert.equal(page.window.neo.recList, undefined);
  } finally {
    globalThis.CompressionStream = saved;
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('a web view whose workers don’t start builds the history on the page, the same', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-pocket-'));
  try {
    const neo = pocket(base, { worker: false }).window.neo;
    const me = (await neo.recStart(BOOK)).device;
    const recRoot = path.join(base, 'DOCUMENTS', 'NEO Library', BOOK, 'recording');
    const [s] = written(me, [['2026-11-01', 9, [baseline('ch-a', '<p>One.</p>'), ...typed(7, ' Two')]]]);
    for (const c of s.chunks) await neo.recChunk(BOOK, s.id, c.first, c.text);
    await neo.recClose(BOOK, s.id);
    const built = new Promise((resolve) => neo.onRecProgress((m) => { if (m.type === 'built') resolve(m); }));
    await neo.recDays(BOOK);
    assert.equal((await built).error, undefined);
    const desk = new BookDays({ root: recRoot, cache: path.join(base, 'desk-cache') });
    await desk.build();
    assert.deepEqual(plain(await neo.recDayStart(BOOK, '2099-01-01')), plain(await desk.dayStart('2099-01-01')));
    assert.equal((await neo.recDayStart(BOOK, '2099-01-01')).page['ch-a'], '<p>One. Two</p>');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('the history worker goes once History closes, after a build in progress, and comes back for the next', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-pocket-'));
  try {
    const neo = pocket(base).window.neo;
    const me = (await neo.recStart(BOOK)).device;
    const ss = written(me, [
      ['2026-11-01', 9, [baseline('ch-a', '<p>One.</p>'), ...typed(7, ' Two')]],
      ['2026-11-02', 9, [carryOn('ch-a', '<p>One. Two</p>'), ...typed(11, ' Three')]]
    ]);
    for (const x of ss) {
      for (const c of x.chunks) await neo.recChunk(BOOK, x.id, c.first, c.text);
      await neo.recClose(BOOK, x.id);
    }
    const builtOnce = () => new Promise((resolve) => neo.onRecProgress((m) => { if (m.type === 'built') resolve(m); }));
    const progress = [];
    neo.onRecProgress((m) => { if (m.type === 'progress') progress.push(m.entry.day); });

    // closed while the first build runs: the worker finishes it, then goes
    const before = workers.length;
    const built = builtOnce();
    await neo.recDays(BOOK);
    const w = workers[before];
    neo.recHistoryClosed();
    assert.equal(w.terminated, false, 'not in the middle of a build');
    await built;
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(w.terminated, true, 'gone once the build is done');
    assert.deepEqual(progress, ['2026-11-01', '2026-11-02']);
    assert.ok(fs.existsSync(path.join(base, 'DATA', 'recording-cache', BOOK, 'day-2026-11-02.json.gz')));

    // opened again: a new worker, which builds nothing twice and plays the same
    const again = builtOnce();
    await neo.recDays(BOOK);
    await again;
    assert.equal(workers.length, before + 2);
    assert.deepEqual(progress, ['2026-11-01', '2026-11-02']);
    assert.equal((await neo.recDayStart(BOOK, '2099-01-01')).page['ch-a'], '<p>One. Two Three</p>');
    neo.recHistoryClosed();
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(workers[before + 1].terminated, true, 'idle: gone at once');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
