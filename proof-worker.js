// NEO — Proof of when I wrote, in a process of its own (main.js: proofRun)
//
// A seal reads the book's Writing History: this computer's sessions and
// seals, and the sessions other devices' recordings brought here by sync.
// On a Mac a file iCloud hasn't downloaded yet holds a read until iCloud
// hands it over, forever if iCloud is stuck; done in NEO's main process,
// that froze the window. Here a stuck read holds up only the seals, and
// main.js ends this process if a job overruns.
//
// main.js keeps the policy (when to seal, one job at a time per book, the
// key, the writer's timestamp services); this process keeps a Sealer per
// book and does what they read, write and ask the network for.
//
// Messages in (each with an `id`, answered with the same `id`):
//   { type: 'key', pem }                          the signing key, once
//   { type: 'services', tsas, added }             who stamps (tsas), and the PEM roots of those the writer added
//   { type: 'run', bookId, how, sealer, now }     a seal (`how` as proofRun's), then the stamps the newest lacks
//   { type: 'status', bookId, sealer, now }       Sealer.status()
//   { type: 'forget', bookId }                    its history went: the Sealer goes too
//   { type: 'others', libraryDir, me }            the books holding another device's recording
// Messages out: { id, ok: true, result } or { id, ok: false, error }

'use strict';

const fs = require('fs');
const Proof = require('./proof.js');

let key = null;
let tsas = Proof.TSAS;
let added = [];
const sealers = new Map(); // bookId -> Sealer

// as main.js writes: beside the real name, every byte pushed to the disk, then swapped in
function writeDurable(file, data) {
  const tmp = file + '.tmp';
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const fd = fs.openSync(tmp, 'w');
  try {
    for (let off = 0; off < buf.length;) {
      const n = fs.writeSync(fd, buf, off, buf.length - off);
      if (!(n > 0)) throw Object.assign(new Error('Short write: ' + tmp), { code: 'EIO' });
      off += n;
    }
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
}

const anchors = () => [...Proof.roots(), ...added.flatMap((pem) => Proof.certsIn(pem))];

// main.js's clock for the job (its tests move it on): the difference from
// this process's, held while the job runs
let skew = 0;
const now = () => new Date(Date.now() + skew);

function sealerFor(bookId, opts) {
  let s = sealers.get(bookId);
  if (!s) {
    if (!key) throw new Error('proof: no key yet');
    s = new Proof.Sealer({
      ...opts, key, write: writeDurable, now,
      fetch: (...a) => globalThis.fetch(...a), // (looked up each time, so the tests can stand in for the network)
      log: (source, err) => send({ log: source, error: String((err && err.stack) || err) }),
      tsas: tsas.filter((t) => t.on !== false), anchors: anchors()
    });
    sealers.set(bookId, s);
  }
  return s;
}

const port = process.parentPort
  ? { on: (fn) => process.parentPort.on('message', (e) => fn(e.data)), send: (m) => process.parentPort.postMessage(m) }
  : { on: (fn) => process.on('message', fn), send: (m) => process.send(m) };
const send = (m) => port.send(m);

async function handle(msg) {
  switch (msg.type) {
    case 'key':
      key = Proof.keyOf(msg.pem);
      return true;
    case 'services':
      tsas = msg.tsas;
      added = msg.added || [];
      for (const s of sealers.values()) Object.assign(s, { tsas: tsas.filter((t) => t.on !== false), anchors: anchors() });
      return true;
    case 'forget':
      sealers.delete(msg.bookId);
      return true;
    case 'others': {
      // the books whose recording holds another device's folder: what Pocket
      // writes reaches this computer by sync, and is sealed here, open or not
      const out = [];
      let names = [];
      try { names = fs.readdirSync(msg.libraryDir); } catch { return out; }
      const DEVICE = require('./recording-files.js').DEVICE;
      for (const name of names) {
        if (!name.startsWith('book-')) continue;
        try {
          if (fs.readdirSync(require('path').join(msg.libraryDir, name, 'recording')).some((d) => DEVICE.test(d) && d !== msg.me)) out.push(name);
        } catch { /* no recording */ }
      }
      return out;
    }
    case 'status': {
      skew = (msg.now || Date.now()) - Date.now();
      return sealerFor(msg.bookId, msg.sealer).status();
    }
    case 'run': {
      skew = (msg.now || Date.now()) - Date.now();
      const s = sealerFor(msg.bookId, msg.sealer);
      const how = msg.how;
      const made = how === 'start' || how === 'retry'
        ? await s.seal({ force: how === 'start' && s.renewDue(), ifOthers: true, ifWords: how === 'start' })
        : await s.seal();
      const stamped = await s.stamp();
      return { made: !!made, stamped: stamped.length };
    }
    default:
      throw new Error('proof worker: no such message ' + msg.type);
  }
}

// a book's jobs one at a time, in the order sent (main.js queues them too);
// another book's, and a status, needn't wait behind a slow stamp
const chains = new Map(); // bookId -> the promise of its last job
port.on((msg) => {
  const run = () => Promise.resolve().then(() => handle(msg)).then(
    (result) => send({ id: msg.id, ok: true, result }),
    (err) => send({ id: msg.id, ok: false, error: String((err && err.stack) || err) })
  );
  if (msg.type !== 'run') { run(); return; }
  const next = (chains.get(msg.bookId) || Promise.resolve()).then(run);
  chains.set(msg.bookId, next);
  next.then(() => { if (chains.get(msg.bookId) === next) chains.delete(msg.bookId); });
});
