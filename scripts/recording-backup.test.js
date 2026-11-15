'use strict';

// Writing History's backup (docs/neo-recording-plan.md, phase 4g): each
// closed session copied once into Backups/recordings/<book folder>/, not
// zipped every day; the mirror read when a book's copy is missing or broken;
// and a zip from before the mirror unzipped over the library.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const { test } = require('node:test');
const R = require('../recording.js');
const Files = require('../recording-files.js');
const { BookDays } = require('../history-worker.js');

R.setDigest((data) => crypto.createHash('sha256').update(data).digest().subarray(0, 16).toString('base64url'));

const DEV = 'd-0123456789abcdef';   // this computer
const DEV2 = 'd-fedcba9876543210';  // another
const pad = (n) => String(n).padStart(2, '0');
const DAY_MS = 24 * 3600 * 1000;
const io = Files.nodeIO({ fs, path, zlib, write: (file, data) => fs.writeFileSync(file, data), log: () => {} });

// A device's sessions, a day apart, each typing a few words into one chapter
function sessions(n, device = DEV, first = 1) {
  const WORDS = ['rain', 'door', 'John', 'quiet', 'boat', 'river'];
  let html = '<p>The rain.</p>';
  let known;
  let prev = null;
  const out = [];
  for (let i = 0; i < n; i++) {
    const day = `2026-11-${pad(first + i)}`;
    const id = `${day}T09-00-00Z-b${device.slice(-4)}${i}`;
    const w = new R.SessionWriter({ neoRec: 1, session: id, device, book: 'b', day, startedAt: `${day}T09:00:00.000Z`, tz: 'UTC', prev });
    for (const line of R.baseLines('ch-a', html, known, 0)) w.push([0, ...line]);
    for (let k = 0; k < 3; k++) {
      const ins = ' ' + WORDS[(i * 3 + k) % WORDS.length];
      const at = html.length - 4;
      w.push([120, 'e', at, 0, ins, 'iT']);
      html = R.applyEdit(html, at, 0, ins);
    }
    w.push([0, 'w', R.digest(html), 'ch-a']);
    w.push([200, 'end', {}]);
    w.chunk();
    known = html;
    prev = w.H;
    out.push({ id, device, day, text: w.lines.join('\n') + '\n', html });
  }
  return out;
}

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-backup-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
const close = (dir, s) => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, s.id + '.jsonl.gz'), zlib.gzipSync(s.text));
};
// a session with one word changed after it was sealed: its chain doesn't verify
const breakIt = (text) => {
  const out = text.replace(/" (rain|door|John|quiet|boat|river)"/, '" $1s"');
  assert.equal(R.verifyChain(out).ok, false);
  return out;
};
const listing = (dir) => { try { return fs.readdirSync(dir).sort(); } catch { return []; } };

test('a device mirrors its own sessions once; a second sweep copies nothing and a copy is never written again', async (t) => {
  const lib = tempDir(t);
  const root = path.join(lib, 'book-a', 'recording');
  const mirror = path.join(lib, 'Backups', 'recordings', 'book-a');
  const mine = sessions(3);
  for (const s of mine) close(path.join(root, DEV), s);
  fs.writeFileSync(path.join(root, DEV, 'device.json'), '{"name":"Desk"}');
  // a session still open isn't mirrored
  fs.mkdirSync(path.join(root, DEV, '2026-11-09T09-00-00Z-open'), { recursive: true });

  assert.equal(await Files.sweep(io, root, mirror, DEV), 3);
  const copy = path.join(mirror, DEV);
  assert.deepEqual(listing(copy), ['device.json', ...mine.map((s) => s.id + '.jsonl.gz')].sort());
  for (const s of mine) assert.ok(fs.readFileSync(path.join(copy, s.id + '.jsonl.gz')).equals(fs.readFileSync(path.join(root, DEV, s.id + '.jsonl.gz'))), 'the same bytes');

  assert.equal(await Files.sweep(io, root, mirror, DEV), 0, 'nothing the second time');
  // a copy is never written again, even when the book's file differs from it
  const one = path.join(copy, mine[0].id + '.jsonl.gz');
  const was = fs.readFileSync(one);
  fs.writeFileSync(path.join(root, DEV, mine[0].id + '.jsonl.gz'), zlib.gzipSync(mine[1].text));
  assert.equal(await Files.sweep(io, root, mirror, DEV), 0);
  assert.ok(fs.readFileSync(one).equals(was));
});

test('a session whose chain is broken isn’t mirrored, and a copy that doesn’t read back is tried again', async (t) => {
  const lib = tempDir(t);
  const root = path.join(lib, 'recording');
  const mirror = path.join(lib, 'mirror');
  const [a, b] = sessions(2);
  close(path.join(root, DEV), a);
  close(path.join(root, DEV), { ...b, text: breakIt(b.text) });
  const logged = [];
  let fail = true;
  const flaky = { ...io, log: (s, err) => logged.push(String(err)), copy: (from, to) => { if (fail) { fail = false; throw new Error('disk full'); } io.copy(from, to); } };
  assert.equal(await Files.sweep(flaky, root, mirror, DEV), 0, 'the copy failed');
  assert.ok(logged.some((m) => /disk full/.test(m)));
  assert.ok(logged.some((m) => /broken; not mirrored/.test(m)));
  assert.equal(await Files.sweep(flaky, root, mirror, DEV), 1, 'and is tried again');
  assert.deepEqual(listing(path.join(mirror, DEV)), [a.id + '.jsonl.gz']);
});

test('another device’s session is mirrored only once it closed more than 7 days ago and the mirror lacks it', async (t) => {
  const lib = tempDir(t);
  const root = path.join(lib, 'recording');
  const mirror = path.join(lib, 'mirror');
  const theirs = sessions(3, DEV2);
  for (const s of theirs) close(path.join(root, DEV2), s);
  // as the files say: each closed the day it began
  for (const s of theirs) {
    const at = new Date(Date.parse(s.day + 'T10:00:00Z'));
    fs.utimesSync(path.join(root, DEV2, s.id + '.jsonl.gz'), at, at);
  }
  // the second is already there: its own device mirrored it
  close(path.join(mirror, DEV2), theirs[1]);
  const now = Date.parse(theirs[1].day + 'T12:00:00Z') + 7 * DAY_MS;
  assert.equal(await Files.sweep(io, root, mirror, DEV, { now }), 1);
  assert.deepEqual(listing(path.join(mirror, DEV2)), [theirs[0].id, theirs[1].id].map((x) => x + '.jsonl.gz'), 'the first is old enough; the third isn’t yet');
  // a session that closed late (left open, then closed as crashed) waits from when it closed
  const late = path.join(root, DEV2, theirs[2].id + '.jsonl.gz');
  fs.utimesSync(late, new Date(now), new Date(now));
  assert.equal(await Files.sweep(io, root, mirror, DEV, { now: now + 6 * DAY_MS }), 0);
  assert.equal(await Files.sweep(io, root, mirror, DEV, { now: now + 8 * DAY_MS }), 1);
});

test('a conflict copy in the mirror is ignored', async (t) => {
  const lib = tempDir(t);
  const root = path.join(lib, 'recording');
  const mirror = path.join(lib, 'mirror');
  const [a, b] = sessions(2);
  close(path.join(root, DEV), b);
  close(path.join(mirror, DEV), a);
  close(path.join(mirror, DEV), b);
  // as iCloud and Syncthing name them
  fs.copyFileSync(path.join(mirror, DEV, a.id + '.jsonl.gz'), path.join(mirror, DEV, a.id + ' 2.jsonl.gz'));
  fs.copyFileSync(path.join(mirror, DEV, b.id + '.jsonl.gz'), path.join(mirror, DEV, b.id + '.sync-conflict-20261112-101010-ABCDEFG.jsonl.gz'));
  fs.mkdirSync(path.join(mirror, DEV + ' 2'));
  close(path.join(mirror, DEV + ' 2'), a);
  const list = await Files.list(io, root, DEV, mirror);
  assert.deepEqual(list.map((d) => d.device), [DEV]);
  assert.deepEqual(list[0].sessions, [{ id: a.id, open: false }, { id: b.id, open: false }]);
  const r = await Files.read(io, path.join(root, DEV), a.id, path.join(mirror, DEV));
  assert.equal(r.text, a.text, 'read from the mirror');
  assert.equal(await Files.sweep(io, root, mirror, DEV), 0);
});

test('a book’s history with a session deleted, or broken, plays whole from the mirror', async (t) => {
  const lib = tempDir(t);
  const all = [...sessions(4), ...sessions(3, DEV2, 5)];
  const whole = path.join(lib, 'whole');
  for (const s of all) close(path.join(whole, s.device), s);
  const want = await new BookDays({ root: whole, cache: path.join(lib, 'cache-whole') }).build();

  const root = path.join(lib, 'book', 'recording');
  const mirror = path.join(lib, 'mirror');
  for (const s of all) { close(path.join(root, s.device), s); close(path.join(mirror, s.device), s); }
  fs.rmSync(path.join(root, DEV, all[1].id + '.jsonl.gz')); // deleted
  const broken = breakIt(all[5].text);
  fs.writeFileSync(path.join(root, DEV2, all[5].id + '.jsonl.gz'), zlib.gzipSync(broken)); // broken
  fs.rmSync(path.join(root, DEV2, all[6].id + '.jsonl.gz')); // the other computer's last, only in the mirror

  const cache = path.join(lib, 'cache');
  const without = await new BookDays({ root, cache }).build();
  assert.notDeepEqual(JSON.parse(JSON.stringify(without.entries)), JSON.parse(JSON.stringify(want.entries)), 'without the mirror, it isn’t whole');

  // the same cache, now with the mirror: the day built from the broken copy is built again
  const d = new BookDays({ root, mirror, cache });
  const got = await d.build();
  assert.deepEqual(JSON.parse(JSON.stringify(got.entries)), JSON.parse(JSON.stringify(want.entries)));
  assert.equal((await d.dayStart('2099-01-01')).page['ch-a'], all[all.length - 1].html);
  // the player reads each session the same way
  for (const s of all) {
    const r = await Files.read(io, path.join(root, s.device), s.id, path.join(mirror, s.device));
    assert.equal(r.text, s.text, s.id);
  }
  // nothing was copied back into the book
  assert.equal(fs.existsSync(path.join(root, DEV, all[1].id + '.jsonl.gz')), false);
});

test('a day the cache built from a broken copy is built again once the mirror holds it whole', async (t) => {
  const lib = tempDir(t);
  const all = sessions(4);
  const whole = path.join(lib, 'whole');
  for (const s of all) close(path.join(whole, DEV), s);
  const want = await new BookDays({ root: whole, cache: path.join(lib, 'cache-whole') }).build();
  const root = path.join(lib, 'recording');
  const mirror = path.join(lib, 'mirror');
  for (const s of all) close(path.join(root, DEV), s);
  fs.writeFileSync(path.join(root, DEV, all[1].id + '.jsonl.gz'), zlib.gzipSync(breakIt(all[1].text)));
  const cache = path.join(lib, 'cache');
  const damaged = await new BookDays({ root, mirror, cache }).build();
  assert.ok(damaged.entries[1].sessions[0].stats.damaged, 'built damaged: the mirror didn’t have it yet');
  close(path.join(mirror, DEV), all[1]);
  const rebuilt = [];
  const got = await new BookDays({ root, mirror, cache }).build((entry) => rebuilt.push(entry.day));
  assert.deepEqual(rebuilt, all.slice(1).map((s) => s.day));
  assert.deepEqual(JSON.parse(JSON.stringify(got.entries)), JSON.parse(JSON.stringify(want.entries)));
});

test('where the recording left each chapter counts a session the book lost, from the mirror', async (t) => {
  const lib = tempDir(t);
  const mine = sessions(3);
  const dir = path.join(lib, 'recording', DEV);
  const copy = path.join(lib, 'mirror', DEV);
  for (const s of mine) { close(dir, s); close(copy, s); }
  fs.rmSync(path.join(dir, mine[2].id + '.jsonl.gz'));
  const r = await Files.start(io, dir, DEV, path.join(lib, 'known.json'), copy);
  assert.equal(r.known['ch-a'], mine[2].html);
  assert.equal(r.prev, R.verifyChain(mine[2].text).last);
});

test('a zip from before the mirror, unzipped over the library, doesn’t close a session twice or bring back its chunks', async (t) => {
  const lib = tempDir(t);
  const [a, b] = sessions(2);
  const dir = path.join(lib, 'recording', DEV);
  const copy = path.join(lib, 'mirror', DEV);
  // what the zip held: each session while it was still open, a rollup of its first lines
  const unzip = () => {
    for (const s of [a, b]) {
      const lines = s.text.split('\n');
      const cut = lines.findIndex((l, i) => i > 2 && l.includes('"h"'));
      const folder = path.join(dir, s.id);
      fs.mkdirSync(folder, { recursive: true });
      fs.writeFileSync(path.join(folder, `s-000001-${String(cut + 1).padStart(6, '0')}.jsonl.gz`), zlib.gzipSync(lines.slice(0, cut + 1).join('\n') + '\n'));
    }
  };
  close(dir, a);
  close(dir, b);
  close(copy, b);
  fs.rmSync(path.join(dir, b.id + '.jsonl.gz')); // b is only in the mirror now
  unzip();
  const before = fs.readFileSync(path.join(dir, a.id + '.jsonl.gz'));
  const r = await Files.start(io, dir, DEV, path.join(lib, 'known.json'), copy);
  assert.deepEqual(listing(dir), [a.id + '.jsonl.gz'], 'the folders went, and b wasn’t closed again from its start');
  assert.ok(fs.readFileSync(path.join(dir, a.id + '.jsonl.gz')).equals(before), 'a wasn’t closed again');
  assert.equal(r.known['ch-a'], b.html);
  // another device's folders, as the zip brought them back: read as closed
  unzip();
  const list = await Files.list(io, path.join(lib, 'recording'), DEV2, path.join(lib, 'mirror'));
  assert.deepEqual(list[0].sessions, [{ id: a.id, open: false }, { id: b.id, open: false }]);
  assert.equal((await Files.read(io, dir, a.id, copy)).text, a.text);
  const days = await new BookDays({ root: path.join(lib, 'recording'), mirror: path.join(lib, 'mirror'), cache: path.join(lib, 'cache') }).build();
  assert.equal(days.open.length, 0);
  assert.equal(days.entries.length, 2);
});

/* ---------- dailyBackup, in main.js ---------- */

function loadMain(userData) {
  const root = path.join(__dirname, '..');
  const localRequire = createRequire(path.join(root, 'main.js'));
  const electron = {
    app: {
      commandLine: { appendSwitch() {} },
      getPath: () => userData,
      getLocale: () => 'en',
      getVersion: () => '0.0.0',
      requestSingleInstanceLock: () => true,
      whenReady: () => ({ then() {} }),
      on() {}
    },
    ipcMain: { on() {}, handle() {} },
    BrowserWindow: { getFocusedWindow: () => null, getAllWindows: () => [] },
    Menu: { buildFromTemplate: (items) => items, setApplicationMenu() {} },
    dialog: {},
    // the backup's own process: the real backup-worker.js, as a Node child
    utilityProcess: {
      fork: (file) => {
        const child = require('node:child_process').fork(file, []);
        return {
          on: (ev, fn) => child.on(ev, ev === 'exit' ? (code) => fn(code || 0) : fn),
          postMessage: (m) => child.send(m),
          kill: () => child.kill()
        };
      }
    },
    screen: {}
  };
  const context = vm.createContext({
    require: (name) => name === 'electron' ? electron : localRequire(name),
    __dirname: root,
    process: { platform: process.platform, on() {} },
    console,
    Buffer,
    setTimeout,
    clearTimeout
  });
  vm.runInContext(fs.readFileSync(path.join(root, 'main.js'), 'utf8'), context, { filename: path.join(root, 'main.js') });
  return context;
}

test('the daily zip leaves recordings out and says where they are; the mirror and its README are written', async (t) => {
  const tmp = tempDir(t);
  const lib = path.join(tmp, 'NEO Library');
  const userData = path.join(tmp, 'userData');
  fs.mkdirSync(userData);
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ recordingDevice: DEV }));
  const main = loadMain(userData);
  main.libraryRoot = lib;
  vm.runInContext('LIBRARY_DIR = libraryRoot; LIBRARY_FILE = require("path").join(libraryRoot, "library.json");', main);

  const book = path.join(lib, 'book-tide-1');
  fs.mkdirSync(path.join(book, 'chapters'), { recursive: true });
  fs.writeFileSync(path.join(book, 'book.json'), '{"title":"Tide"}');
  fs.writeFileSync(path.join(book, 'chapters', 'ch-a.html'), '<p>The rain.</p>');
  const mine = sessions(2);
  for (const s of mine) close(path.join(book, 'recording', DEV), s);
  fs.writeFileSync(path.join(book, 'recording', 'README.txt'), 'about');
  fs.mkdirSync(path.join(book, 'recording', DEV, '2026-11-09T09-00-00Z-open'));
  fs.writeFileSync(path.join(book, 'recording', DEV, '2026-11-09T09-00-00Z-open', 'c-000001.jsonl'), '{}\n');
  const young = sessions(1, DEV2, 20)[0];
  close(path.join(book, 'recording', DEV2), young);

  await main.dailyBackup();
  const backups = path.join(lib, 'Backups');
  const zipName = listing(backups).find((n) => n.startsWith('neo-backup-'));
  const zip = await require('jszip').loadAsync(fs.readFileSync(path.join(backups, zipName)));
  const names = Object.keys(zip.files);
  assert.ok(names.includes('book-tide-1/chapters/ch-a.html'));
  assert.ok(names.includes('_recordings.txt'));
  assert.ok(!names.some((n) => n.includes('/recording/') || n.startsWith('Backups')), names.join(', '));
  assert.match(fs.readFileSync(path.join(backups, 'README.txt'), 'utf8'), /recordings\/<book folder>/);

  const copy = path.join(backups, 'recordings', 'book-tide-1');
  assert.deepEqual(listing(copy), [DEV], 'this computer’s, not another’s from this week');
  assert.deepEqual(listing(path.join(copy, DEV)), mine.map((s) => s.id + '.jsonl.gz').sort());

  // started again the same day: nothing more is copied, and the README stays
  const readme = path.join(backups, 'README.txt');
  const stamp = fs.statSync(readme).mtimeMs;
  assert.equal(await main.dailyBackup(), 0, 'nothing more is copied');
  assert.equal(fs.statSync(readme).mtimeMs, stamp);
});

test('an open session’s start: a chunk or a rollup from line 1; gone once a sync program took the folder from under it', async () => {
  const folder = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'neo-start-')), '2026-11-15T09-00-00Z-abcd');
  assert.equal(await Files.hasStart(io, folder), false, 'no folder at all');
  fs.mkdirSync(folder);
  fs.writeFileSync(path.join(folder, 'c-000001.jsonl'), '{}\n');
  fs.writeFileSync(path.join(folder, 'c-000002.jsonl'), '[0,"T","x"]\n');
  assert.equal(await Files.hasStart(io, folder), true, 'its first chunk');
  fs.rmSync(path.join(folder, 'c-000001.jsonl'));
  fs.writeFileSync(path.join(folder, 's-000001-000001.jsonl.gz'), zlib.gzipSync('{}\n'));
  assert.equal(await Files.hasStart(io, folder), true, 'a rollup from line 1');
  fs.rmSync(path.join(folder, 's-000001-000001.jsonl.gz'));
  assert.equal(await Files.hasStart(io, folder), false, 'only what came after the delete');
});
