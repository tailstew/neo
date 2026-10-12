'use strict';

// Proof of when I wrote (docs/neo-recording-plan.md, phase 5): seals over
// the recording, signed and timestamped. scripts/fixtures/proof/ holds a
// book's recording sealed twice and stamped by DigiCert and Sectigo for
// real (on 2026-10-12), so the tokens are checked here offline, as anyone
// would check them years later. Nothing here touches the network.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { test } = require('node:test');
const R = require('../recording.js');
const P = require('../proof.js');
const OTS = require('../ots.js');
const { verifyBook } = require('./verify-recording.js');

const FIX = path.join(__dirname, 'fixtures', 'proof');
const DEV = 'd-0123456789abcdef';
const SEALS = path.join(FIX, 'recording', DEV, 'seals');
const fixture = (f) => fs.readFileSync(path.join(SEALS, f));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'neo-proof-'));
const put = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); };
const copyDir = (from, to) => fs.cpSync(from, to, { recursive: true });

/* ---------- RFC 3161 tokens ---------- */

test('real tokens from DigiCert and Sectigo check offline, chained to the pinned roots', () => {
  for (const seq of ['000001', '000002']) {
    const digest = crypto.createHash('sha256').update(fixture(seq + '.json')).digest();
    for (const tsa of ['digicert', 'sectigo']) {
      const c = P.checkToken(fixture(`${seq}.${tsa}.tsr`), { digest });
      assert.equal(c.ok, true, c.problems.join('; '));
      assert.equal(c.trusted, true, c.problems.join('; '));
      assert.equal(c.hash, 'sha256');
      assert.ok(c.genTime >= Date.parse('2026-10-12T16:40:00Z') && c.genTime < Date.parse('2026-10-12T16:41:00Z'));
      assert.match(c.tsa, tsa === 'digicert' ? /DigiCert/ : /Sectigo/);
    }
  }
});

test('a token for other bytes, with another nonce, or with a byte changed fails', () => {
  const tok = fixture('000001.digicert.tsr');
  const digest = crypto.createHash('sha256').update(fixture('000001.json')).digest();
  assert.deepEqual(P.checkToken(tok, { digest: crypto.randomBytes(32) }).problems, ['it stamps something else']);
  assert.ok(P.checkToken(tok, { digest, nonce: Buffer.from('0102030405060708', 'hex') }).problems.includes('its nonce isn’t the one asked for'));
  // a byte of the TSTInfo, and a byte of the signature
  for (const at of [tok.indexOf(digest) + 3, tok.length - 600]) {
    const bad = Buffer.from(tok);
    bad[at] ^= 1;
    const c = P.checkToken(bad, { digest });
    assert.equal(c.ok, false, 'byte ' + at);
  }
  assert.equal(P.checkToken(Buffer.from('not a token'), { digest }).ok, false);
});

test('a token whose chain ends at a root NEO doesn’t pin is good but not trusted', () => {
  const digest = crypto.createHash('sha256').update(fixture('000001.json')).digest();
  const c = P.checkToken(fixture('000001.digicert.tsr'), { digest, anchors: [] });
  assert.equal(c.ok, true);
  assert.equal(c.trusted, false);
  assert.match(c.problems[0], /root NEO knows/);
});

test('a TimeStampReq is version 1, a SHA-256 imprint, the nonce, and certReq', () => {
  const digest = crypto.randomBytes(32);
  const nonce = Buffer.from('80aa000000000001', 'hex'); // a top bit set: an INTEGER needs a 00 before it
  const req = P.tsaRequest(digest, nonce);
  const top = P.der(req);
  const [ver, imp, n, cert] = P.kids(req, top);
  assert.equal(req[ver.body], 1);
  const [alg, hash] = P.kids(req, imp);
  assert.equal(P.oidOf(req, P.kids(req, alg)[0]), '2.16.840.1.101.3.4.2.1');
  assert.ok(req.subarray(hash.body, hash.end).equals(digest));
  assert.equal(req.subarray(n.body, n.end).toString('hex'), '00' + nonce.toString('hex'));
  assert.deepEqual([...req.subarray(cert.start, cert.end)], [1, 1, 0xff]);
  assert.equal(req.length, 70); // 32 bytes of hash and 8 of nonce, in 70
});

/* ---------- keys and signatures ---------- */

test('a seal’s signature is over canonical JSON, whatever the key order', () => {
  const key = P.keyOf(P.newKey());
  const sig = P.sign(key.privateKey, { b: 1, a: [1, { d: 2, c: 3 }] });
  assert.equal(P.verifySignature(key.publicKey, { a: [1, { c: 3, d: 2 }], b: 1 }, sig), true);
  assert.equal(P.verifySignature(key.publicKey, { a: [1, { c: 3, d: 2 }], b: 2 }, sig), false);
  assert.equal(P.verifySignature(P.keyOf(P.newKey()).publicKey, { b: 1, a: [1, { d: 2, c: 3 }] }, sig), false);
});

/* ---------- checking a device's seals ---------- */

const hashesOf = (dir) => new Map(fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl.gz'))
  .map((f) => [f.slice(0, -9), P.chainHashes(zlib.gunzipSync(fs.readFileSync(path.join(dir, f))).toString())]));

test('the fixture’s seals verify: signatures, chain, heads, covered stamps, drand rounds', async () => {
  const dir = path.join(FIX, 'recording', DEV);
  const r = await P.verifyDevice(dir, { sessions: hashesOf(dir) });
  assert.equal(r.seals.length, 2);
  for (const s of r.seals) {
    assert.equal(s.ok, true, s.problems.join('; '));
    assert.deepEqual(s.problems, []);
    assert.equal(s.stamps.length, 2);
    assert.ok(s.after <= s.at && s.at - s.after < 10000, 'the drand round is seconds before the seal');
    assert.ok(Math.abs(s.by - s.at) < 5000, 'stamped within seconds');
  }
});

test('a seal changed, a session it seals changed, or a stamp it covers changed fails', async () => {
  // a seal edited by hand: its signature, and the next one's prev
  let dir = path.join(tmp(), DEV);
  copyDir(path.join(FIX, 'recording', DEV), dir);
  const f = path.join(dir, 'seals', '000001.json');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('"seq": 1', '"seq":1'));
  let r = await P.verifyDevice(dir, { sessions: hashesOf(dir) });
  assert.equal(r.seals[0].ok, false); // its stamps are for other bytes now
  assert.ok(r.seals[1].problems.includes('it doesn’t name the seal before it'));

  // the recording no longer holds what the seal sealed
  dir = path.join(tmp(), DEV);
  copyDir(path.join(FIX, 'recording', DEV), dir);
  const h = hashesOf(dir);
  h.set('2026-10-08T08-30-00Z-t4g5', new Set(['something else']));
  r = await P.verifyDevice(dir, { sessions: h });
  assert.equal(r.seals[0].ok, true);
  assert.deepEqual(r.seals[1].problems, ['session 2026-10-08T08-30-00Z-t4g5 doesn’t hold what it seals']);

  // a stamp swapped for another after a later seal covered it
  dir = path.join(tmp(), DEV);
  copyDir(path.join(FIX, 'recording', DEV), dir);
  fs.copyFileSync(path.join(dir, 'seals', '000002.digicert.tsr'), path.join(dir, 'seals', '000001.digicert.tsr'));
  r = await P.verifyDevice(dir, { sessions: hashesOf(dir) });
  assert.equal(r.seals[0].ok, false);
  assert.ok(r.seals[1].problems.includes('the stamp 000001.digicert.tsr isn’t what it covered'));
});

test('verify-recording checks the fixture book whole, and finds a missing session', async () => {
  const ok = await verifyBook(FIX);
  assert.equal(ok.ok, true, JSON.stringify(ok.devices.map((d) => d.problems)));
  const d = ok.devices[0];
  assert.equal(d.replay.bad, 0);
  assert.ok(d.replay.writes > 0);
  // sealed days after they were written: said, not hidden
  assert.ok(d.cover.every((c) => /timestamped later, on 2026-10-12/.test(c.gap)));

  const book = tmp();
  copyDir(path.join(FIX, 'recording'), path.join(book, 'recording'));
  fs.rmSync(path.join(book, 'recording', DEV, '2026-10-07T20-01-44Z-q7m2.jsonl.gz'));
  const bad = await verifyBook(book, { mirror: path.join(book, 'no-mirror') });
  assert.equal(bad.ok, false);
  const problems = bad.devices[0].problems.join('\n');
  assert.match(problems, /2026-10-08T08-30-00Z-t4g5 doesn’t follow the one before it/);
  assert.match(problems, /seal 1: session 2026-10-07T20-01-44Z-q7m2 isn’t in the recording/);
});

/* ---------- sealing ---------- */

// a fake network: drand, and authorities that answer as told
function network({ drand = true, tsa = {} } = {}) {
  const calls = [];
  const sig = crypto.randomBytes(48).toString('hex');
  const round = { round: 33000000, signature: sig, randomness: crypto.createHash('sha256').update(Buffer.from(sig, 'hex')).digest('hex') };
  const fetch = async (url, opts = {}) => {
    calls.push(url);
    const json = (v) => ({ ok: true, status: 200, json: async () => v, text: async () => JSON.stringify(v) });
    if (url.includes('/public/')) {
      if (!drand) throw new Error('offline');
      return json(drand === 'liar' ? { ...round, randomness: '00'.repeat(32) } : round);
    }
    const id = Object.keys(tsa).find((k) => url.includes(k));
    if (!id || tsa[id] === 'down') throw new Error('offline');
    const body = Buffer.concat([Buffer.from('TOKEN:' + id + ':'), opts.body]);
    return { ok: true, status: 200, arrayBuffer: async () => body };
  };
  return { fetch, calls, round };
}
const TSAS = [
  { id: 'one', name: 'One', url: 'https://one.test' },
  { id: 'two', name: 'Two', url: 'https://two.test' },
  { id: 'three', name: 'Three', url: 'https://three.test' }
];
// stands in for checkToken: a fake token is good if it holds the request
const fakeCheck = (reply) => ({ ok: reply.toString('latin1').startsWith('TOKEN:'), trusted: true, problems: [] });

// a device folder with closed sessions, and one still open
function deviceFolder() {
  const dir = path.join(tmp(), 'recording', DEV);
  const src = path.join(__dirname, 'fixtures', 'recording-v1');
  const [a, b, c] = fs.readdirSync(src).sort();
  put(path.join(dir, a + '.gz'), zlib.gzipSync(fs.readFileSync(path.join(src, a))));
  put(path.join(dir, b + '.gz'), zlib.gzipSync(fs.readFileSync(path.join(src, b))));
  // the third is open: a chunk of it, then another
  const lines = fs.readFileSync(path.join(src, c), 'utf8');
  const raw = R.splitLines(lines).lines;
  const firstH = raw.findIndex((l) => l.includes('"h"'));
  const open = path.join(dir, c.slice(0, -6));
  put(path.join(open, 'c-000001.jsonl'), raw.slice(0, firstH + 1).map((l) => l + '\n').join(''));
  return { dir, open, rest: raw.slice(firstH + 1), firstChunkLines: firstH + 1 };
}

function sealer(dir, net, more = {}) {
  let clock = Date.parse('2026-11-01T10:00:00Z');
  const s = new P.Sealer({
    dir, book: 'book-x', device: DEV, key: P.keyOf(P.newKey()), now: () => new Date(clock), fetch: net.fetch,
    write: put, tsas: TSAS, check: fakeCheck, ...more
  });
  s.tick = (ms) => { clock += ms; };
  return s;
}

test('a seal holds every session’s last h, the open one’s too, and its drand round', async () => {
  const { dir, open } = deviceFolder();
  const net = network();
  const s = sealer(dir, net);
  const seal = await s.seal();
  assert.deepEqual(Object.keys(seal.heads).sort(), ['2026-10-06T09-14-03Z-k3f9', '2026-10-07T20-01-44Z-q7m2', path.basename(open)]);
  const openText = R.joinParts([{ name: 'c-000001.jsonl', text: fs.readFileSync(path.join(open, 'c-000001.jsonl'), 'utf8') }]).text;
  assert.equal(seal.heads[path.basename(open)], R.verifyChain(openText).last);
  assert.deepEqual(seal.after, [{ beacon: 'drand-quicknet', ...net.round }]);
  assert.equal(seal.prev, null);
  assert.equal(seal.seq, 1);
  const { sig, ...signed } = JSON.parse(fs.readFileSync(path.join(dir, 'seals', '000001.json')));
  assert.equal(P.verifySignature(seal.publicKey, signed, sig), true);
});

test('nothing changed, no seal; the open session goes on, a seal of it alone, chained', async () => {
  const { dir, open, rest } = deviceFolder();
  const s = sealer(dir, network());
  const first = await s.seal();
  assert.equal(await s.seal(), null);
  // the session writes its next chunk
  const n = R.splitLines(fs.readFileSync(path.join(open, 'c-000001.jsonl'), 'utf8')).lines.length;
  put(path.join(open, `c-${String(n + 1).padStart(6, '0')}.jsonl`), rest.map((l) => l + '\n').join(''));
  s.tick(3600e3);
  const second = await s.seal();
  assert.deepEqual(Object.keys(second.heads), [path.basename(open)]);
  assert.notEqual(second.heads[path.basename(open)], first.heads[path.basename(open)]);
  assert.equal(second.prev, crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, 'seals', '000001.json'))).digest('hex'));
  // a NEO started again reads the seals and agrees nothing changed
  assert.equal(await sealer(dir, network()).seal(), null);
});

test('no drand, no `after`, and the seal is made anyway; a round that doesn’t add up is left out', async () => {
  for (const drand of [false, 'liar']) {
    const { dir } = deviceFolder();
    const seal = await sealer(dir, network({ drand })).seal();
    assert.equal(seal.after, undefined);
    assert.equal(seal.seq, 1);
  }
});

test('two authorities stamp the newest seal; one down, the next is asked; none, it waits', async () => {
  let { dir } = deviceFolder();
  let net = network({ tsa: { one: 'down', two: 'up', three: 'up' } });
  let s = sealer(dir, net);
  await s.seal();
  assert.deepEqual(await s.stamp(), ['two', 'three']);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'seals')).sort(), ['000001.json', '000001.three.tsr', '000001.two.tsr']);
  assert.deepEqual(await s.stamp(), []); // two is enough: nobody is asked again
  assert.equal(net.calls.filter((u) => u.includes('.test')).length, 3);

  ({ dir } = deviceFolder());
  net = network({ tsa: {} });
  s = sealer(dir, net);
  await s.seal();
  assert.deepEqual(await s.stamp(), []);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'seals')), ['000001.json']);
  // the network comes back: the seal waiting is stamped
  s.fetch = network({ tsa: { one: 'up', two: 'up' } }).fetch;
  assert.deepEqual(await s.stamp(), ['one', 'two']);
  assert.deepEqual(s.status().stamps, ['One', 'Two']);
});

test('a reply that isn’t a good token for this seal is never kept', async () => {
  const { dir } = deviceFolder();
  const s = sealer(dir, network({ tsa: { one: 'up', two: 'up', three: 'up' } }), { check: () => ({ ok: false, problems: ['nope'] }) });
  await s.seal();
  assert.deepEqual(await s.stamp(), []);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'seals')), ['000001.json']);
});

test('the next seal covers the stamps before it; a renewal seals them alone, a year on', async () => {
  const { dir, open, rest } = deviceFolder();
  const s = sealer(dir, network({ tsa: { one: 'up', two: 'up' } }));
  await s.seal();
  await s.stamp();
  const n = R.splitLines(fs.readFileSync(path.join(open, 'c-000001.jsonl'), 'utf8')).lines.length;
  put(path.join(open, `c-${String(n + 1).padStart(6, '0')}.jsonl`), rest.map((l) => l + '\n').join(''));
  s.tick(3600e3);
  const second = await s.seal();
  const hex = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, 'seals', f))).digest('hex');
  assert.deepEqual(second.tokens, { '000001.one.tsr': hex('000001.one.tsr'), '000001.two.tsr': hex('000001.two.tsr') });
  await s.stamp();
  assert.equal(s.renewDue(), false);
  s.tick(340 * 24 * 3600e3);
  assert.equal(s.renewDue(), true);
  assert.equal(await s.seal(), null); // nothing written: no seal unless renewing
  const renewal = await s.seal({ force: true });
  assert.deepEqual(renewal.heads, {});
  assert.deepEqual(Object.keys(renewal.tokens).sort(), ['000002.one.tsr', '000002.two.tsr']);
  assert.equal(s.renewDue(), false);
});

test('a seal file is never written twice', async () => {
  const { dir } = deviceFolder();
  const a = sealer(dir, network());
  await a.seal();
  // another NEO that hasn't seen the seal yet would number its seal the same
  const b = sealer(dir, network());
  b.state = { seals: [], sealed: new Map(), covered: new Set() };
  await assert.rejects(() => b.seal(), /already there/);
  assert.equal(fs.readdirSync(path.join(dir, 'seals')).length, 1);
});

test('the heads of closed sessions are remembered outside the library', async () => {
  const { dir } = deviceFolder();
  const cacheFile = path.join(tmp(), 'cache', 'heads.json');
  await sealer(dir, network(), { cacheFile }).seal();
  const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
  assert.deepEqual(Object.keys(cached).sort(), ['2026-10-06T09-14-03Z-k3f9', '2026-10-07T20-01-44Z-q7m2']);
});

/* ---------- OpenTimestamps and drand ---------- */

test('the OpenTimestamps reference proof parses and round-trips byte for byte', () => {
  const buf = fs.readFileSync(path.join(FIX, 'hello-world.txt.ots'));
  const proof = OTS.parseProof(buf);
  assert.ok(proof.digest.equals(OTS.sha256(fs.readFileSync(path.join(FIX, 'hello-world.txt')))));
  assert.deepEqual(OTS.attestations(proof).filter((a) => a.type === 'bitcoin').map((a) => a.height), [358391]);
  assert.ok(OTS.serializeProof(proof).equals(buf));
});

test('a drand round’s time comes from quicknet’s genesis; a round that doesn’t hash is refused', async () => {
  assert.equal(P.roundTime(1), P.DRAND.genesis * 1000);
  assert.equal(P.roundTime(33006614), Date.parse('2026-10-12T16:40:06Z'));
  await assert.rejects(() => P.drandRound(network({ drand: 'liar' }).fetch));
});

/* ---------- backups ---------- */

test('the backup mirror copies seals and stamps once; a pending Bitcoin proof waits', async () => {
  const Files = require('../recording-files.js');
  const io = Files.nodeIO({ fs, path, zlib, write: put, log: () => {} });
  const root = path.join(tmp(), 'recording');
  copyDir(path.join(FIX, 'recording'), root);
  const seals = path.join(root, DEV, 'seals');
  put(path.join(seals, '000002.pending.ots'), 'waiting');
  const mirror = path.join(tmp(), 'mirror');
  await Files.sweep(io, root, mirror, DEV);
  assert.deepEqual(fs.readdirSync(path.join(mirror, DEV, 'seals')).sort(),
    ['000001.digicert.tsr', '000001.json', '000001.sectigo.tsr', '000002.digicert.tsr', '000002.json', '000002.sectigo.tsr']);
  // a copy is never written again
  const copy = path.join(mirror, DEV, 'seals', '000001.json');
  fs.writeFileSync(copy, 'kept as it was');
  await Files.sweep(io, root, mirror, DEV);
  assert.equal(fs.readFileSync(copy, 'utf8'), 'kept as it was');

  // another device's: only once it's a week old
  const other = path.join(tmp(), 'mirror2');
  await Files.sweep(io, root, other, 'd-fedcba9876543210');
  assert.equal(fs.existsSync(path.join(other, DEV, 'seals')), false);
  await Files.sweep(io, root, other, 'd-fedcba9876543210', { now: Date.now() + 8 * 24 * 3600e3 });
  assert.equal(fs.readdirSync(path.join(other, DEV, 'seals')).length, 6);
});

test('an authority asked moments ago is passed over for the next, not waited for', async () => {
  const tsas = [{ id: 'polite', name: 'Polite', url: 'https://polite.test', gap: 60000 }, ...TSAS.slice(1)];
  const net = network({ tsa: { polite: 'up', two: 'up', three: 'up' } });
  const { dir, open, rest } = deviceFolder();
  const s = sealer(dir, net, { tsas });
  await s.seal();
  assert.deepEqual(await s.stamp(), ['polite', 'two']);
  const n = R.splitLines(fs.readFileSync(path.join(open, 'c-000001.jsonl'), 'utf8')).lines.length;
  put(path.join(open, `c-${String(n + 1).padStart(6, '0')}.jsonl`), rest.map((l) => l + '\n').join(''));
  await s.seal();
  const t0 = Date.now();
  assert.deepEqual(await s.stamp(), ['two', 'three']);
  assert.ok(Date.now() - t0 < 5000);
});
