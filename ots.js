'use strict';
// OpenTimestamps, just the parts Writing History's proof needs (proof.js,
// the optional "Also anchor in Bitcoin"): stamp a digest with the public
// calendars, upgrade the proof once Bitcoin has confirmed it, and read a
// proof back to say which block it is anchored in. Ported from NEO Witness.
//
// The .ots files written here are ordinary OpenTimestamps proofs. Anyone can
// check them with the reference client (`ots verify`) without trusting NEO
// or the writer. NEO holds no Bitcoin and pays nothing: each calendar puts
// everyone's hashes into one transaction a round and pays for it.

const crypto = require('node:crypto');

const MAGIC = Buffer.concat([
  Buffer.from([0]), Buffer.from('OpenTimestamps'), Buffer.from([0, 0]),
  Buffer.from('Proof'), Buffer.from([0]), Buffer.from('bf89e2e884e89294', 'hex'),
]);
const MAJOR_VERSION = 1;

const TAG_PENDING = Buffer.from('83dfe30d2ef90c8e', 'hex');
const TAG_BITCOIN = Buffer.from('0588960d73d71901', 'hex');

const OP = { sha1: 0x02, ripemd160: 0x03, sha256: 0x08, keccak256: 0x67, append: 0xf0, prepend: 0xf1, reverse: 0xf2, hexlify: 0xf3 };
const BINARY_OPS = new Set([OP.append, OP.prepend]);
const UNARY_OPS = new Set([OP.sha1, OP.ripemd160, OP.sha256, OP.keccak256, OP.reverse, OP.hexlify]);
const MAX_MSG = 4096;

const CALENDARS = [
  'https://a.pool.opentimestamps.org',
  'https://b.pool.opentimestamps.org',
  'https://a.pool.eternitywall.com',
  'https://ots.btc.catallaxy.com',
];
// A proof names the calendars to ask for its upgrade. Only these are ever
// contacted, so a proof from someone else can't make us fetch arbitrary URLs.
const CALENDAR_URI = /^https:\/\/([a-z0-9-]+\.)+(calendar\.opentimestamps\.org|calendar\.eternitywall\.com|calendar\.catallaxy\.com)$/;
const EXPLORERS = ['https://blockstream.info/api', 'https://mempool.space/api'];

const sha256 = (b) => crypto.createHash('sha256').update(b).digest();

/* ---------------------------------------------------------------- bytes */

class Reader {
  constructor(buf) { this.buf = buf; this.pos = 0; }
  byte() {
    if (this.pos >= this.buf.length) throw new Error('Proof ends early');
    return this.buf[this.pos++];
  }
  bytes(n) {
    if (this.pos + n > this.buf.length) throw new Error('Proof ends early');
    const out = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return Buffer.from(out);
  }
  varuint() {
    let value = 0, mult = 1, b;
    do {
      b = this.byte();
      value += (b & 0x7f) * mult;
      mult *= 128;
      if (mult > 2 ** 56) throw new Error('Number in proof is too large');
    } while (b & 0x80);
    return value;
  }
  varbytes(max) {
    const n = this.varuint();
    if (n > max) throw new Error('Field in proof is too long');
    return this.bytes(n);
  }
  get done() { return this.pos === this.buf.length; }
}

class Writer {
  constructor() { this.parts = []; }
  byte(b) { this.parts.push(Buffer.from([b])); }
  bytes(b) { this.parts.push(Buffer.from(b)); }
  varuint(n) {
    const out = [];
    do {
      let b = n % 128;
      n = Math.floor(n / 128);
      if (n) b |= 0x80;
      out.push(b);
    } while (n);
    this.parts.push(Buffer.from(out));
  }
  varbytes(b) { this.varuint(b.length); this.bytes(b); }
  toBuffer() { return Buffer.concat(this.parts); }
}

/* ----------------------------------------------------------- operations */

function applyOp(op, msg) {
  let out;
  switch (op.tag) {
    case OP.append: out = Buffer.concat([msg, op.arg]); break;
    case OP.prepend: out = Buffer.concat([op.arg, msg]); break;
    case OP.reverse: out = Buffer.from(msg).reverse(); break;
    case OP.hexlify: out = Buffer.from(msg.toString('hex')); break;
    case OP.sha256: out = sha256(msg); break;
    case OP.sha1: out = crypto.createHash('sha1').update(msg).digest(); break;
    case OP.ripemd160: out = crypto.createHash('ripemd160').update(msg).digest(); break;
    case OP.keccak256: throw new Error('This proof uses keccak256, which NEO cannot check');
    default: throw new Error('Unknown operation in proof: 0x' + op.tag.toString(16));
  }
  if (out.length > MAX_MSG) throw new Error('Message in proof is too long');
  return out;
}

const sameOp = (a, b) => a.tag === b.tag && (!a.arg || a.arg.equals(b.arg));

/* ----------------------------------------------------------- timestamps */
// A timestamp is a tree: a message, the attestations made about it, and the
// operations that lead from it to further messages.

const node = (msg) => ({ msg, attestations: [], ops: [] });

function readAttestation(r) {
  const tag = r.bytes(8);
  const payload = r.varbytes(8192);
  const p = new Reader(payload);
  if (tag.equals(TAG_PENDING)) return { type: 'pending', uri: p.varbytes(1000).toString('utf8') };
  if (tag.equals(TAG_BITCOIN)) return { type: 'bitcoin', height: p.varuint() };
  return { type: 'unknown', tag, payload };
}

function writeAttestation(w, a) {
  const p = new Writer();
  if (a.type === 'pending') { w.bytes(TAG_PENDING); p.varbytes(Buffer.from(a.uri, 'utf8')); }
  else if (a.type === 'bitcoin') { w.bytes(TAG_BITCOIN); p.varuint(a.height); }
  else { w.bytes(a.tag); p.bytes(a.payload); }
  w.varbytes(p.toBuffer());
}

const attestationKey = (a) => {
  const w = new Writer();
  writeAttestation(w, a);
  return w.toBuffer();
};

function readTimestamp(r, msg, depth = 0) {
  if (depth > 256) throw new Error('Proof is nested too deeply');
  const ts = node(msg);
  const item = (tag) => {
    if (tag === 0x00) { ts.attestations.push(readAttestation(r)); return; }
    let op;
    if (BINARY_OPS.has(tag)) op = { tag, arg: r.varbytes(MAX_MSG) };
    else if (UNARY_OPS.has(tag)) op = { tag };
    else throw new Error('Unknown operation in proof: 0x' + tag.toString(16));
    ts.ops.push({ op, stamp: readTimestamp(r, applyOp(op, msg), depth + 1) });
  };
  let tag = r.byte();
  while (tag === 0xff) {
    item(r.byte());
    tag = r.byte();
  }
  item(tag);
  return ts;
}

// The reference client writes attestations first, then operations, each in
// sorted order. Writing the same order keeps our files byte-identical to it.
function compareOps(a, b) {
  if (a.tag !== b.tag) return a.tag - b.tag;
  return Buffer.compare(a.arg || Buffer.alloc(0), b.arg || Buffer.alloc(0));
}

function compareAttestations(a, b) {
  const tag = (x) => (x.type === 'pending' ? TAG_PENDING : x.type === 'bitcoin' ? TAG_BITCOIN : x.tag);
  const byTag = Buffer.compare(tag(a), tag(b));
  if (byTag) return byTag;
  if (a.type === 'pending') return a.uri < b.uri ? -1 : a.uri > b.uri ? 1 : 0;
  if (a.type === 'bitcoin') return a.height - b.height;
  return Buffer.compare(a.payload, b.payload);
}

function writeTimestamp(w, ts) {
  const atts = [...ts.attestations].sort(compareAttestations);
  const ops = [...ts.ops].sort((a, b) => compareOps(a.op, b.op));
  const items = [...atts.map((a) => ({ a })), ...ops.map((o) => ({ o }))];
  if (!items.length) throw new Error('Empty timestamp');
  items.forEach((it, i) => {
    if (i < items.length - 1) w.byte(0xff);
    if (it.a) {
      w.byte(0x00);
      writeAttestation(w, it.a);
    } else {
      w.byte(it.o.op.tag);
      if (it.o.op.arg) w.varbytes(it.o.op.arg);
      writeTimestamp(w, it.o.stamp);
    }
  });
}

function merge(into, from) {
  if (!into.msg.equals(from.msg)) throw new Error('Cannot merge timestamps of different messages');
  const have = new Set(into.attestations.map((a) => attestationKey(a).toString('hex')));
  for (const a of from.attestations) {
    if (!have.has(attestationKey(a).toString('hex'))) into.attestations.push(a);
  }
  for (const o of from.ops) {
    const same = into.ops.find((x) => sameOp(x.op, o.op));
    if (same) merge(same.stamp, o.stamp);
    else into.ops.push(o);
  }
}

function* walk(ts) {
  yield ts;
  for (const o of ts.ops) yield* walk(o.stamp);
}

/* --------------------------------------------------------------- proofs */

function parseProof(buf) {
  if (buf.length < MAGIC.length || !buf.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('Not an OpenTimestamps proof');
  const r = new Reader(buf);
  r.pos = MAGIC.length;
  const major = r.varuint();
  if (major !== MAJOR_VERSION) throw new Error('Unsupported proof version ' + major);
  const hashOp = r.byte();
  if (hashOp !== OP.sha256) throw new Error('Proof is not over a SHA-256 digest');
  const digest = r.bytes(32);
  const timestamp = readTimestamp(r, digest);
  if (!r.done) throw new Error('Unexpected bytes after the proof');
  return { digest, timestamp };
}

function serializeProof(proof) {
  const w = new Writer();
  w.bytes(MAGIC);
  w.varuint(MAJOR_VERSION);
  w.byte(OP.sha256);
  w.bytes(proof.digest);
  writeTimestamp(w, proof.timestamp);
  return w.toBuffer();
}

// Every attestation in the proof, with the message it attests to.
function attestations(proof) {
  const out = [];
  for (const ts of walk(proof.timestamp)) {
    for (const a of ts.attestations) out.push({ ...a, msg: ts.msg });
  }
  return out;
}

/* -------------------------------------------------------------- network */

async function request(url, opts = {}, timeoutMs = 15000) {
  const res = await fetch(url, {
    ...opts,
    headers: { 'User-Agent': 'NEO', ...opts.headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
  return res;
}

// Ask the calendars to timestamp `digest` (32 bytes). A random nonce is
// added first, as the reference client does, so calendars never see the
// digest itself. Resolves to the bytes of a pending .ots proof.
async function stamp(digest, { calendars = CALENDARS, minimum = 1 } = {}) {
  if (digest.length !== 32) throw new Error('Digest must be 32 bytes');
  const root = node(digest);
  const nonce = crypto.randomBytes(16);
  const appended = node(Buffer.concat([digest, nonce]));
  root.ops.push({ op: { tag: OP.append, arg: nonce }, stamp: appended });
  const hashed = node(sha256(appended.msg));
  appended.ops.push({ op: { tag: OP.sha256 }, stamp: hashed });

  const results = await Promise.allSettled(calendars.map(async (url) => {
    const res = await request(url + '/digest', {
      method: 'POST',
      headers: { Accept: 'application/vnd.opentimestamps.v1', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: hashed.msg,
    });
    if (!res.ok) throw new Error(`${url} answered ${res.status}`);
    return readTimestamp(new Reader(Buffer.from(await res.arrayBuffer())), hashed.msg);
  }));
  let ok = 0;
  const errors = [];
  for (const r of results) {
    if (r.status === 'fulfilled') { merge(hashed, r.value); ok++; }
    else errors.push(r.reason && r.reason.message);
  }
  if (ok < minimum) throw new Error('No timestamp calendar could be reached (' + errors.join('; ') + ')');
  return serializeProof({ digest, timestamp: root });
}

const hasBitcoin = (ts) => [...walk(ts)].some((n) => n.attestations.some((a) => a.type === 'bitcoin'));

// Ask each calendar named in the proof for the rest of the path to a Bitcoin
// block. Resolves to { proof: Buffer, changed: boolean }.
async function upgrade(buf) {
  const proof = parseProof(buf);
  const before = serializeProof(proof);
  const pendings = [];
  for (const ts of walk(proof.timestamp)) {
    for (const a of ts.attestations) if (a.type === 'pending') pendings.push({ ts, uri: a.uri });
  }
  for (const { ts, uri } of pendings) {
    if (hasBitcoin(ts)) continue;
    if (!CALENDAR_URI.test(uri)) continue;
    try {
      const res = await request(`${uri}/timestamp/${ts.msg.toString('hex')}`, { headers: { Accept: 'application/vnd.opentimestamps.v1' } });
      if (!res.ok) continue; // 404: not in a block yet
      merge(ts, readTimestamp(new Reader(Buffer.from(await res.arrayBuffer())), ts.msg));
    } catch { /* that calendar is away; another may answer, or the next try will */ }
  }
  const after = serializeProof(proof);
  return { proof: after, changed: !after.equals(before) };
}

// Check one Bitcoin attestation against a public block explorer. This trusts
// the explorer; `ots verify` against your own Bitcoin node trusts no one.
async function checkBitcoin(height, msg) {
  if (msg.length !== 32) return { ok: false, reason: 'attested message is not a block merkle root' };
  const want = Buffer.from(msg).reverse().toString('hex');
  let lastError;
  for (const api of EXPLORERS) {
    try {
      const hRes = await request(`${api}/block-height/${height}`);
      if (!hRes.ok) throw new Error(`${api} answered ${hRes.status}`);
      const hash = (await hRes.text()).trim();
      const bRes = await request(`${api}/block/${hash}`);
      if (!bRes.ok) throw new Error(`${api} answered ${bRes.status}`);
      const block = await bRes.json();
      if (block.merkle_root !== want) return { ok: false, reason: `does not match block ${height}`, explorer: api };
      return { ok: true, time: new Date(block.timestamp * 1000), explorer: api };
    } catch (err) {
      lastError = err;
    }
  }
  return { ok: false, offline: true, reason: 'no block explorer could be reached' + (lastError ? ` (${lastError.message})` : '') };
}

module.exports = {
  CALENDARS, MAGIC,
  Reader, Writer,
  parseProof, serializeProof, attestations, merge,
  stamp, upgrade, checkBitcoin,
  sha256,
};
