// NEO — the day's backup, in a process of its own (main.js: dailyBackup)
//
// The backup reads every file in the library. Done in NEO's main process, one
// file iCloud was slow to hand over (or a sync tool was holding) froze the
// whole app before its window could open, and every day after, because the
// backup runs at launch. Here a read that never comes back holds up only this
// process: each file gets a time limit, one that runs out is left out of the
// zip and named, and main.js ends this process if the whole job overruns.
//
// It also copies each book's closed Writing History sessions into the
// mirror, Backups/recordings/<book folder>/ (RecFiles.sweep), after the zip,
// so a session file that won't come can't cost the day's zip. The zip leaves
// every book's recording/ out.
//
// Message in:  { libraryDir, target (null: today's zip is made), keep, fileLimitMs?,
//                recordings?: { mirror, device }, recordingsNote? }
// Message out: { ok: true, missed: [...], away: [...], mirrored, errors: [...] } or { ok: false, error }

'use strict';

const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { execFile } = require('child_process');

const FILE_LIMIT_MS = 20000; // one file: as long as iCloud reasonably takes for a chapter
// (tests: a file with no blocks counts as in iCloud, as their placeholders have no flag)
const SPARSE_IS_CLOUD = process.env.NEO_TEST_SPARSE_IS_CLOUD === '1';
const SF_DATALESS = 0x40000000; // macOS: a file whose words are in iCloud, not on this Mac

// a read with a time limit: the read itself can't be cut short, but the backup
// stops waiting for it (it finishes, or not, on a thread of its own)
function readWithin(file, ms) {
  let timer;
  return Promise.race([
    fsp.readFile(file),
    new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error('took too long'), { code: 'ETIMEDOUT' })), ms);
    })
  ]).finally(() => clearTimeout(timer));
}

// the placeholders among these files (iCloud has their words, this Mac doesn't):
// no blocks for a file with a size, confirmed by the "dataless" flag
function cloudOnlyAmong(files) {
  if (SPARSE_IS_CLOUD) return Promise.resolve(new Set(files));
  if (process.platform !== 'darwin' || !files.length) return Promise.resolve(new Set());
  return new Promise((resolve) => {
    execFile('/usr/bin/stat', ['-f', '%Xf', ...files], { encoding: 'utf8', timeout: 10000, maxBuffer: 1 << 24 }, (err, stdout) => {
      const flags = !err && String(stdout).trim().split('\n');
      // no answer from stat: treat them all as away (the safe side)
      if (!flags || flags.length !== files.length) return resolve(new Set(files));
      resolve(new Set(files.filter((f, i) => parseInt(flags[i], 16) & SF_DATALESS)));
    });
  });
}

// as main.js writes: beside the real name, pushed to the disk, then swapped in
async function writeDurable(file, data) {
  const tmp = file + '.tmp';
  const fh = await fsp.open(tmp, 'w');
  try {
    await fh.writeFile(data);
    await fh.sync();
  } finally {
    await fh.close();
  }
  await fsp.rename(tmp, file);
}

async function zipLibrary({ libraryDir, target, keep, fileLimitMs = FILE_LIMIT_MS, recordingsNote }) {
  const JSZip = require('jszip');
  const zip = new JSZip();
  const missed = [];
  const files = []; // [full, relPath, maybeAway]
  const walk = async (dir, rel) => {
    let names = [];
    try { names = await fsp.readdir(dir); } catch (err) { missed.push(`${rel || '.'} (${err.code || err.message})`); return; }
    for (const name of names) {
      if (rel === '' && (name === 'Backups' || name === 'Exports')) continue;
      // only NEO's own things: a library kept in a busy folder (Dropbox,
      // Documents) doesn't zip everything else in there every day
      if (rel === '' && !(name.startsWith('book-') || name.startsWith('library.json') || name === '_catalog.txt')) continue;
      // a book's snapshots stay out: they're a history of their own; its
      // Writing History too: that's mirrored instead (recordings, below)
      if ((name === 'snapshots' || name === 'recording') && rel.startsWith('book-') && !rel.includes('/')) continue;
      if (name === '.DS_Store' || /^\..+\.icloud$/.test(name)) continue; // Finder litter; iCloud's stand-in for a file
      const full = path.join(dir, name);
      const relPath = rel ? rel + '/' + name : name;
      try {
        const st = await fsp.stat(full);
        if (st.isDirectory()) await walk(full, relPath);
        else if (st.isFile() || st.isFIFO()) files.push([full, relPath, (process.platform === 'darwin' || SPARSE_IS_CLOUD) && st.size > 0 && st.blocks === 0]);
      } catch (err) {
        missed.push(`${relPath} (${err.code || err.message})`);
      }
    }
  };
  await walk(libraryDir, '');
  // a file still in iCloud is safe up there: it's named, not waited on
  const away = await cloudOnlyAmong(files.filter((f) => f[2]).map((f) => f[0]));
  for (const [full, relPath] of files) {
    if (away.has(full)) { missed.push(`${relPath} (in iCloud, not on this Mac)`); continue; }
    try {
      zip.file(relPath, await readWithin(full, fileLimitMs));
    } catch (err) {
      missed.push(`${relPath} (${err.code === 'ETIMEDOUT' ? 'not handed over in time' : err.code || err.message})`);
    }
  }
  if (recordingsNote) zip.file('_recordings.txt', recordingsNote);
  if (missed.length) zip.file('_left-out-of-this-backup.txt', missed.join('\n') + '\n');
  const data = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  await JSZip.loadAsync(data); // reads back whole, or it doesn't count
  await writeDurable(target, data);
  // the oldest go once there are more than `keep`
  const dir = path.dirname(target);
  const backups = (await fsp.readdir(dir)).filter((f) => /^neo-backup-.*\.zip$/.test(f)).sort();
  while (backups.length > keep) await fsp.unlink(path.join(dir, backups.shift())).catch(() => {});
  return { missed, away: [...away] };
}

// Writing History's backup: each book's closed sessions copied once into the
// mirror, this device's every one, another device's once it closed more than
// 7 days ago and is still missing. Copies only what the mirror lacks, so a
// second run copies nothing. A copy is read back and compared before it stays.
async function recordings(libraryDir, { mirror, device }) {
  const zlib = require('zlib');
  const RecFiles = require('./recording-files.js');
  const errors = [];
  const io = RecFiles.nodeIO({
    fs, path, zlib,
    write: (file, data) => {
      const tmp = file + '.tmp';
      const fd = fs.openSync(tmp, 'w');
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
      try {
        // as main.js's writeFileDurable: on until every byte is down
        for (let off = 0; off < buf.length;) {
          const n = fs.writeSync(fd, buf, off, buf.length - off);
          if (!(n > 0)) throw Object.assign(new Error('Short write: ' + tmp), { code: 'EIO' });
          off += n;
        }
        fs.fsyncSync(fd);
      } finally { fs.closeSync(fd); }
      fs.renameSync(tmp, file);
    },
    log: (source, err) => errors.push(source + ': ' + String((err && err.stack) || err))
  });
  let mirrored = 0;
  let names = [];
  try { names = await fsp.readdir(libraryDir); } catch { return { mirrored, errors }; }
  for (const name of names) {
    if (!name.startsWith('book-')) continue;
    const root = path.join(libraryDir, name, 'recording');
    try { if (!(await fsp.stat(root)).isDirectory()) continue; } catch { continue; }
    try { mirrored += await RecFiles.sweep(io, root, path.join(mirror, name), device); } catch (err) { errors.push(name + ': ' + String((err && err.stack) || err)); }
  }
  return { mirrored, errors };
}

async function backup(job) {
  const zipped = job.target ? await zipLibrary(job) : { missed: [], away: [] };
  const rec = job.recordings ? await recordings(job.libraryDir, job.recordings) : { mirrored: 0, errors: [] };
  return { ...zipped, ...rec };
}

// Electron's utility process (parentPort); a plain Node child in the tests
const port = process.parentPort
  ? { on: (fn) => process.parentPort.on('message', (e) => fn(e.data)), send: (m) => process.parentPort.postMessage(m) }
  : { on: (fn) => process.on('message', fn), send: (m) => process.send(m) };
port.on(async (job) => {
  try {
    port.send({ ok: true, ...(await backup(job)) });
  } catch (err) {
    port.send({ ok: false, error: String((err && err.stack) || err) });
  }
});
