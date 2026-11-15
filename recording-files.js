// Writing History's files (docs/neo-recording-plan.md, Storage): what each
// device writes in the book's recording/ folder, and how they're read back.
// Each device writes only its own folder, recording/<device>/, so iCloud and
// Syncthing never see two devices write one file. Every file is written once
// and never changed: a chunk per flush, a rollup of the chunks every ten
// minutes, then one gzipped file per session when it closes. Other devices'
// folders are only read. What the lines mean: recording.js.
//
// The same code runs on the desktop (main.js, history-worker.js) and in
// Pocket (pocket-bridge.js and its history worker). Each hands in an `io`,
// the files as that platform reaches them. Its methods may answer at once
// (Node's fs) or with a promise (Capacitor's Filesystem):
//
//   join(...parts)      a path
//   list(dir)           the names in a folder; throws, with err.code
//                       'ENOENT', when it isn't there
//   read(file)          a file's text (the same throw when it isn't there)
//   readGz(file)        a gzipped file's text
//   write(file, text)   a file written whole, its folder made
//   writeGz(file, text) the same, gzipped
//   remove(path)        a file or folder gone, if it was there
//   exists(path)
//   log(source, err)    an error kept for later
//
// and, only where backups are made (the desktop's Node io):
//
//   copy(from, to)      a file's bytes copied whole, read back and checked
//   mtime(file)         when a file last changed, in ms
//
// The backup mirror, Backups/recordings/<book folder>/ in the library, is
// the book's recording/ folder again with only closed sessions in it (and
// each device's device.json). A closed session the book's folder lacks, or
// holds broken, is read from there; nothing read from it is copied back
// into the book. The functions that read take it as `mirror`, which may be
// left out.
//
// No DOM. `require`d by main.js, history-worker.js and the tests; in Pocket,
// window.NeoRecordingFiles (and self.NeoRecordingFiles in its worker).
(function (root, factory) {
  const node = typeof module === 'object' && module.exports;
  const api = factory(node ? require('./recording.js') : root.NeoRecording);
  if (node) module.exports = api;
  else root.NeoRecordingFiles = api;
})(typeof self !== 'undefined' ? self : this, function (R) {
  'use strict';

  const DEVICE = /^d-[0-9a-f]{16}$/;
  const SESSION = /^\d{4}-\d\d-\d\dT\d\d-\d\d-\d\dZ-[a-z0-9]{4,12}$/;
  const CHUNK = /^c-(\d+)\.jsonl$/;
  const ROLLUP = /^s-(\d+)-(\d+)\.jsonl\.gz$/;
  // a seal, its stamps, and the root of a service the writer added (proof.js)
  const SEAL_FILE = /^(?:\d{6}\.(json|[a-z0-9-]+\.tsr)|root-[0-9a-f]{16}\.pem)$/;
  const pad = (n) => String(n).padStart(6, '0');
  // a closed session's file name, or null
  const closedName = (n) => (n.endsWith('.jsonl.gz') && SESSION.test(n.slice(0, -9)) ? n.slice(0, -9) : null);
  const gone = (err) => err && err.code === 'ENOENT';
  const names = async (io, dir) => { try { return await io.list(dir); } catch { return []; } };

  // A closed session's text: the book's copy, or the mirror's when the
  // book's is missing, won't read, or its chain doesn't verify, and the
  // mirror's is that session and does. Throws when neither reads.
  async function readClosed(io, dir, session, mirror) {
    let text = null;
    let err = null;
    try {
      text = await io.readGz(io.join(dir, session + '.jsonl.gz'));
      if (!mirror || R.verifyChain(text).ok) return text;
    } catch (e) { err = e; }
    if (mirror) {
      try {
        const copy = await io.readGz(io.join(mirror, session + '.jsonl.gz'));
        const head = R.parseSession(copy).header;
        if (head && head.session === session && R.verifyChain(copy).ok) return copy;
        if (text === null && copy) text = copy; // broken too, but more than nothing
      } catch { /* not mirrored */ }
    }
    if (text === null) throw err;
    return text;
  }

  // The closed sessions of one device's folder and its mirror, sorted
  async function closedNames(io, dir, mirror) {
    const all = new Set((await names(io, dir)).map(closedName).filter(Boolean));
    if (mirror) for (const n of await names(io, mirror)) if (closedName(n)) all.add(closedName(n));
    return [...all].sort();
  }

  // An open session's rollups and chunks, read. Its device may roll its
  // chunks up while they're being read: a file gone means look again.
  async function readParts(io, folder) {
    for (let attempt = 0; ; attempt++) {
      try {
        const parts = [];
        for (const name of await io.list(folder)) {
          if (CHUNK.test(name)) parts.push({ name, text: await io.read(io.join(folder, name)) });
          else if (ROLLUP.test(name)) parts.push({ name, text: await io.readGz(io.join(folder, name)) });
        }
        return parts;
      } catch (err) {
        if (!gone(err) || attempt >= 3) throw err;
      }
    }
  }

  // The chunks since the last rollup, joined into one gzipped file. It is read
  // back and checked before the chunks it holds are deleted, so a crash at any
  // point leaves every line in at least one file. Returns how many it joined.
  async function rollup(io, folder) {
    const names = await io.list(folder);
    let covered = 0;
    for (const n of names) { const m = ROLLUP.exec(n); if (m) covered = Math.max(covered, +m[2]); }
    const chunks = names.map((n) => CHUNK.exec(n)).filter(Boolean)
      .map((m) => ({ name: m[0], first: +m[1] })).sort((a, b) => a.first - b.first);
    const used = [];
    let text = '';
    let next = 0;
    for (const c of chunks) {
      if (c.first <= covered) continue; // a rollup already holds it
      if (used.length && c.first !== next) break;
      const part = await io.read(io.join(folder, c.name));
      const { lines, torn } = R.splitLines(part);
      if (torn || !lines.length) break;
      if (!used.length) next = c.first;
      text += part;
      next += lines.length;
      used.push(c);
    }
    if (used.length) {
      const file = io.join(folder, `s-${pad(used[0].first)}-${pad(next - 1)}.jsonl.gz`);
      await io.writeGz(file, text);
      if (await io.readGz(file) !== text) throw new Error('recording: a rollup did not read back whole: ' + file);
      covered = next - 1;
    }
    for (const c of chunks) if (c.first <= covered) await io.remove(io.join(folder, c.name));
    return used.length;
  }

  // A session's folder becomes one file, <session>.jsonl.gz, checked before
  // the folder goes. A session NEO didn't close itself (it quit or crashed)
  // gets an `end` line saying so.
  async function closeSession(io, dir, name, crashed) {
    if (!SESSION.test(name)) throw new Error('Invalid recording session');
    const folder = io.join(dir, name);
    const file = io.join(dir, name + '.jsonl.gz');
    const joined = R.joinParts(await readParts(io, folder));
    if (joined.gaps.length || joined.bad.length) {
      io.log('recording', `${folder}: missing lines ${JSON.stringify(joined.gaps)}; unreadable ${joined.bad.join(', ') || 'none'}`);
    }
    let text = joined.text;
    if (text && crashed && !R.parseSession(text).lines.slice(-2).some((l) => Array.isArray(l) && l[1] === 'end')) {
      text = R.appendLines(text, [[0, 'end', { crashed: true }]]);
    }
    if (text) {
      let done = false;
      try { done = await io.readGz(file) === text; } catch { /* not there yet */ }
      if (!done) {
        await io.writeGz(file, text);
        if (await io.readGz(file) !== text) throw new Error('recording: a closed session did not read back whole: ' + file);
      }
    }
    await io.remove(folder);
  }

  // Where this device's recordings left each chapter, replayed from its closed
  // sessions in `dir`, and how much each has been edited since its last full
  // `b` (an anchor comes once that is enough). `cacheFile` (outside the
  // library) remembers the replay, so only sessions closed since are read.
  // A session the book has lost is read from the mirror.
  async function known(io, dir, device, cacheFile, mirror) {
    const closed = (await closedNames(io, dir, mirror)).map((n) => n + '.jsonl.gz');
    let cache = null;
    try { cache = JSON.parse(await io.read(cacheFile)); } catch { /* none yet */ }
    let chapters = {};
    let edited = {};
    let prev = null;
    let done = [];
    if (cache && cache.device === device && cache.edited && Array.isArray(cache.sessions) && cache.sessions.length <= closed.length &&
        cache.sessions.every((s, i) => s && s.name === closed[i])) {
      chapters = cache.chapters || {};
      edited = cache.edited;
      prev = cache.prev || null;
      done = cache.sessions;
    }
    const todo = closed.slice(done.length);
    if (!todo.length) return { chapters, edited, prev };
    for (const name of todo) {
      let text;
      try { text = await readClosed(io, dir, closedName(name), mirror); } catch (err) { io.log('recording', err); continue; }
      const r = R.replay([text], chapters, { edited });
      chapters = r.chapters;
      edited = r.edited;
      // a chapter the replay lost track of starts over from a full baseline
      for (const p of r.problems) if (p.chapter) delete chapters[p.chapter];
      const v = R.verifyChain(text);
      if (v.last) prev = v.last;
      done.push({ name, last: v.last });
    }
    try {
      await io.write(cacheFile, JSON.stringify({ device, sessions: done, prev, chapters, edited }));
    } catch (err) { io.log('recording cache', err); }
    return { chapters, edited, prev };
  }

  // A book opens on this device: the sessions it left open are closed, and
  // the answer says where the last recording left each chapter. A session
  // folder beside a closed file that reads (in the book or the mirror) is
  // what a backup zip from before the mirror brings back when it's unzipped
  // over the library: the start of a session closed long since, which every
  // line of it holds. It goes, rather than closing that session again.
  async function start(io, dir, device, cacheFile, mirror) {
    for (const n of await names(io, dir)) {
      if (!SESSION.test(n)) continue;
      try {
        let done = false;
        try { done = !!(await readClosed(io, dir, n, mirror)); } catch { /* not closed */ }
        if (done) await io.remove(io.join(dir, n));
        else await closeSession(io, dir, n, true);
      } catch (err) { io.log('recording', err); }
    }
    const k = await known(io, dir, device, cacheFile, mirror);
    return { prev: k.prev, known: k.chapters, edited: k.edited };
  }

  // The device's folder, with the book's README.txt and its device.json made
  // the first time: `readme` the README's text, `info` device.json's
  async function prepare(io, root, device, readme, info) {
    const dir = io.join(root, device);
    const file = io.join(root, 'README.txt');
    if (!(await io.exists(file))) await io.write(file, readme);
    const about = io.join(dir, 'device.json');
    if (!(await io.exists(about))) await io.write(about, JSON.stringify(info, null, 2));
    return dir;
  }

  // Whether an open session's folder still holds its start, a chunk or a
  // rollup from line 1. Not once the book's history was deleted on another
  // device while this one recorded, and a sync program took the folder from
  // under it: the lines after can't be played without the ones before.
  async function hasStart(io, folder) {
    for (const n of await names(io, folder)) {
      const m = CHUNK.exec(n) || ROLLUP.exec(n);
      if (m && +m[1] === 1) return true;
    }
    return false;
  }

  async function chunk(io, dir, session, first, text) {
    if (!SESSION.test(session) || !Number.isInteger(first) || first < 1 || typeof text !== 'string') throw new Error('Invalid recording chunk');
    await io.write(io.join(dir, session, `c-${pad(first)}.jsonl`), text);
  }

  // Every device's sessions for a book (`root` its recording/ folder, and
  // `mirror` its backup): [{ device, name, mine, sessions: [{ id, open }] }].
  // A session closed in either is closed, whatever folder of it is left.
  async function list(io, root, mine, mirror) {
    const out = [];
    const devices = new Set((await names(io, root)).filter((d) => DEVICE.test(d)));
    if (mirror) for (const d of await names(io, mirror)) if (DEVICE.test(d)) devices.add(d);
    for (const device of [...devices].sort()) {
      const dir = io.join(root, device);
      const copy = mirror ? io.join(mirror, device) : null;
      let name = device;
      for (const d of copy ? [dir, copy] : [dir]) {
        try { name = JSON.parse(await io.read(io.join(d, 'device.json'))).name || device; break; } catch { /* unnamed */ }
      }
      const closed = new Set(await closedNames(io, dir, copy));
      const sessions = [...closed].map((id) => ({ id, open: false }));
      for (const n of await names(io, dir)) if (SESSION.test(n) && !closed.has(n)) sessions.push({ id: n, open: true });
      if (!sessions.length && !(await io.exists(dir))) continue;
      sessions.sort((a, b) => a.id.localeCompare(b.id));
      out.push({ device, name, mine: device === mine, sessions });
    }
    return out;
  }

  // One session's text, closed or still open, from any device's folder (and
  // its mirror, `mirror`): { text, open, gaps, bad }, or null. A session
  // closed is read closed, whatever folder of it is left.
  async function read(io, dir, session, mirror) {
    if (!SESSION.test(session)) throw new Error('Invalid recording session');
    try {
      return { text: await readClosed(io, dir, session, mirror), open: false, gaps: [], bad: [] };
    } catch { /* still open, or nowhere */ }
    const folder = io.join(dir, session);
    if (await io.exists(folder)) {
      try {
        const joined = R.joinParts(await readParts(io, folder));
        return { text: joined.text, open: true, gaps: joined.gaps, bad: joined.bad };
      } catch (err) {
        if (!gone(err)) throw err; // (gone: it closed while being read)
      }
    }
    try {
      return { text: await readClosed(io, dir, session, mirror), open: false, gaps: [], bad: [] };
    } catch {
      return null;
    }
  }

  /* ---------- the backup mirror (the desktop's: its io copies) ---------- */

  const DAY_MS = 24 * 3600 * 1000;
  // when a session began, from its name
  const began = (session) => Date.parse(session.slice(0, 10) + 'T' + session.slice(11, 19).replace(/-/g, ':') + 'Z');

  // A file copied into the mirror once and never written again; io.copy
  // checks the copy against the original, and removes one that isn't, so
  // the next sweep tries again. Returns whether it copied.
  async function mirrorFile(io, from, to) {
    if (await io.exists(to)) return false;
    await io.copy(from, to);
    return true;
  }

  // One device's folder of a book into the mirror (`copy`): its
  // device.json, and each closed session the mirror lacks that
  // `want(session, file)` says to copy (every one, when it's left out). A
  // session whose chain doesn't verify isn't copied: the mirror is for when
  // the book's copy breaks. Returns how many sessions it copied.
  async function mirrorDevice(io, dir, copy, want) {
    let n = 0;
    const closed = (await names(io, dir)).map(closedName).filter(Boolean);
    for (const s of closed) {
      const from = io.join(dir, s + '.jsonl.gz');
      const to = io.join(copy, s + '.jsonl.gz');
      try {
        if (await io.exists(to)) continue;
        if (want && !(await want(s, from))) continue;
        if (!R.verifyChain(await io.readGz(from)).ok) { io.log('recording backup', new Error(from + ' is broken; not mirrored')); continue; }
        if (await mirrorFile(io, from, to)) n++;
      } catch (err) { io.log('recording backup', err); }
    }
    const about = io.join(dir, 'device.json');
    try {
      if ((await io.exists(copy)) && (await io.exists(about))) await mirrorFile(io, about, io.join(copy, 'device.json'));
    } catch (err) { io.log('recording backup', err); }
    // Proof's seals, their stamps and roots (proof.js), which nothing could make
    // again: each written once, so copied once.
    for (const f of await names(io, io.join(dir, 'seals'))) {
      if (!SEAL_FILE.test(f)) continue;
      const from = io.join(dir, 'seals', f);
      try {
        if (want && !(await want(null, from))) continue;
        await mirrorFile(io, from, io.join(copy, 'seals', f));
      } catch (err) { io.log('recording backup', err); }
    }
    return n;
  }

  // A book's recording into its mirror (`root` its recording/ folder): this
  // device's (`mine`) closed sessions, every one, and another device's only
  // once it closed more than `days` ago and the mirror still lacks it. That
  // device mirrors its own, and two devices writing one file in a synced
  // folder can leave a conflict copy even when the bytes match; one that
  // hasn't in a week isn't coming back (a retired laptop), or can't
  // (Pocket). Returns how many it copied.
  async function sweep(io, root, mirror, mine, { now = Date.now(), days = 7 } = {}) {
    let n = 0;
    const old = async (s, file) => {
      let at = s ? began(s) : 0;
      try { at = Math.max(at, await io.mtime(file)); } catch { /* by its name */ }
      return now - at > days * DAY_MS;
    };
    for (const device of await names(io, root)) {
      if (!DEVICE.test(device)) continue;
      n += await mirrorDevice(io, io.join(root, device), io.join(mirror, device), device === mine ? null : old);
    }
    return n;
  }

  // Node's files, for main.js and history-worker.js: `write(file, data)`
  // puts a whole file in place (main.js's writeFileDurable, or the worker's
  // plainer one for its cache). A copy is read back and compared with what
  // it copied, and removed if it differs.
  function nodeIO({ fs, path, zlib, write, log }) {
    const put = (file, data) => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      write(file, data);
    };
    return {
      join: path.join,
      list: (dir) => fs.readdirSync(dir),
      read: (file) => fs.readFileSync(file, 'utf8'),
      readGz: (file) => zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'),
      write: (file, text) => put(file, text),
      writeGz: (file, text) => put(file, zlib.gzipSync(Buffer.from(text, 'utf8'))),
      remove: (p) => fs.rmSync(p, { recursive: true, force: true }),
      exists: (p) => fs.existsSync(p),
      copy: (from, to) => {
        const data = fs.readFileSync(from);
        put(to, data);
        if (!fs.readFileSync(to).equals(data)) {
          fs.rmSync(to, { force: true });
          throw new Error('recording: a copy did not read back whole: ' + to);
        }
      },
      mtime: (file) => fs.statSync(file).mtimeMs,
      log
    };
  }

  return { DEVICE, SESSION, CHUNK, ROLLUP, closedName, readParts, readClosed, closedNames, rollup, closeSession, known, start, prepare, hasStart, chunk, list, read, mirrorDevice, sweep, nodeIO };
});
