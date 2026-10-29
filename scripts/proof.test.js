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
  assert.deepEqual(Object.keys(cached.devices[DEV]).sort(), ['2026-10-06T09-14-03Z-k3f9', '2026-10-07T20-01-44Z-q7m2']);
  // an older NEO's cache, this device's heads alone, is read as this device's
  fs.writeFileSync(cacheFile, JSON.stringify(cached.devices[DEV]));
  const s = sealer(dir, network(), { cacheFile });
  assert.deepEqual(s.knownHeads(DEV), cached.devices[DEV]);
});

/* ---------- another device's sessions ---------- */

const PHONE = 'd-00000000000000aa';
const LAPTOP = 'd-00000000000000bb';

// a book's recording/ with this computer's folder (deviceFolder's) and a
// phone's, which seals nothing: one closed session and one open
function withPhone() {
  const f = deviceFolder();
  const phone = path.join(path.dirname(f.dir), PHONE);
  const src = path.join(__dirname, 'fixtures', 'recording-v1');
  const [a, , c] = fs.readdirSync(src).sort();
  put(path.join(phone, a + '.gz'), zlib.gzipSync(fs.readFileSync(path.join(src, a))));
  const raw = R.splitLines(fs.readFileSync(path.join(src, c), 'utf8')).lines;
  const firstH = raw.findIndex((l) => l.includes('"h"'));
  const open = path.join(phone, c.slice(0, -6));
  put(path.join(open, 'c-000001.jsonl'), raw.slice(0, firstH + 1).map((l) => l + '\n').join(''));
  return { ...f, phone, phoneOpen: open, phoneRest: raw.slice(firstH + 1), closedPhone: a.slice(0, -6) };
}
const nextChunk = (open, rest) => {
  const n = R.splitLines(fs.readFileSync(path.join(open, 'c-000001.jsonl'), 'utf8')).lines.length;
  put(path.join(open, `c-${String(n + 1).padStart(6, '0')}.jsonl`), rest.map((l) => l + '\n').join(''));
};

test('a seal holds a phone’s sessions as `others`, each head once, and signs them', async () => {
  const { dir, phone, phoneOpen, phoneRest, closedPhone } = withPhone();
  const s = sealer(dir, network());
  const first = await s.seal();
  assert.deepEqual(Object.keys(first.others), [PHONE]);
  assert.deepEqual(Object.keys(first.others[PHONE]).sort(), [closedPhone, path.basename(phoneOpen)].sort());
  assert.equal(first.others[PHONE][closedPhone], R.verifyChain(zlib.gunzipSync(fs.readFileSync(path.join(phone, closedPhone + '.jsonl.gz'))).toString()).last);
  const { sig, ...signed } = JSON.parse(fs.readFileSync(path.join(dir, 'seals', '000001.json')));
  assert.equal(P.verifySignature(first.publicKey, signed, sig), true);
  // nothing new anywhere: no seal, and none for the phone alone either
  assert.equal(await s.seal(), null);
  assert.equal(await s.seal({ ifOthers: true }), null);
  // the phone writes on, and its chunk arrives: sealed though nothing was written here
  nextChunk(phoneOpen, phoneRest);
  const second = await s.seal({ ifOthers: true });
  assert.deepEqual(second.heads, {});
  assert.deepEqual(Object.keys(second.others[PHONE]), [path.basename(phoneOpen)]);
  // another NEO on this computer, started again, reads the seals and agrees
  assert.equal(await sealer(dir, network()).seal({ ifOthers: true }), null);
});

test('writing here alone is no reason to seal with ifOthers; a phone head another computer sealed isn’t sealed again', async () => {
  const { dir, open, rest, phoneOpen, phoneRest } = withPhone();
  // a laptop sealed the phone's sessions first
  const laptop = path.join(path.dirname(dir), LAPTOP);
  fs.mkdirSync(laptop);
  const l = sealer(laptop, network());
  l.device = LAPTOP;
  const theirs = await l.seal();
  // (this computer's too: it hadn't sealed yet)
  assert.deepEqual(Object.keys(theirs.others), [PHONE, DEV]);
  // here: this computer's own sessions, and nothing of the phone's or the laptop's (it seals its own)
  const s = sealer(dir, network());
  const mine = await s.seal();
  assert.equal(mine.others, undefined);
  assert.equal(Object.keys(mine.heads).length, 3);
  // written here: ifOthers still makes no seal
  nextChunk(open, rest);
  assert.equal(await s.seal({ ifOthers: true }), null);
  // the phone again: then here, with this computer's words too
  nextChunk(phoneOpen, phoneRest);
  const next = await s.seal({ ifOthers: true });
  assert.deepEqual(Object.keys(next.others[PHONE]), [path.basename(phoneOpen)]);
  assert.deepEqual(Object.keys(next.heads), [path.basename(open)]);
});

test('a phone session still arriving isn’t remembered as closed, and an unreadable seal is read again', async () => {
  const { dir, phone, closedPhone } = withPhone();
  const file = path.join(phone, closedPhone + '.jsonl.gz');
  const whole = fs.readFileSync(file);
  const text = zlib.gunzipSync(whole).toString();
  const lines = R.splitLines(text).lines;
  // half of it: its chain doesn't verify whole
  fs.writeFileSync(file, zlib.gzipSync(lines.slice(0, Math.floor(lines.length / 2)).map((x) => x + '\n').join('')));
  const s = sealer(dir, network());
  await s.seal();
  assert.equal(s.knownHeads(PHONE)[closedPhone], undefined);
  fs.writeFileSync(file, whole);
  const next = await s.seal({ ifOthers: true });
  assert.equal(next.others[PHONE][closedPhone], R.verifyChain(text).last);
  assert.equal(s.knownHeads(PHONE)[closedPhone], R.verifyChain(text).last);

  // a laptop's seal half synced: not read, so not taken for a sealing device, till it reads
  const laptopSeals = path.join(path.dirname(dir), LAPTOP, 'seals');
  put(path.join(laptopSeals, '000001.json'), '{"neoSeal":1,"he');
  assert.ok(!s.sealsNamed().sealing.has(LAPTOP));
  fs.writeFileSync(path.join(laptopSeals, '000001.json'), JSON.stringify({ neoSeal: 1, seq: 1, heads: {} }));
  assert.ok(s.sealsNamed().sealing.has(LAPTOP));
});

test('a seal’s `others` are checked against the phone’s sessions, and cover them in time', async () => {
  const { dir, phone, closedPhone, phoneOpen } = withPhone();
  const s = sealer(dir, network({ tsa: { one: 'up' } }));
  await s.seal();
  const hashesIn = (d) => {
    const m = hashesOf(d);
    for (const n of fs.readdirSync(d)) {
      if (!/^\d{4}-.*Z-[a-z0-9]+$/.test(n)) continue;
      m.set(n, P.chainHashes(R.joinParts([{ name: 'c-000001.jsonl', text: fs.readFileSync(path.join(d, n, 'c-000001.jsonl'), 'utf8') }]).text));
    }
    return m;
  };
  const others = new Map([[DEV, hashesIn(dir)], [PHONE, hashesIn(phone)]]);
  let v = await P.verifyDevice(dir, { sessions: others.get(DEV), others });
  assert.equal(v.seals[0].ok, true, v.seals[0].problems.join('; '));
  assert.deepEqual(Object.keys(v.seals[0].others), [PHONE]);
  // the phone's copy isn't what was sealed
  const wrong = new Map([...others, [PHONE, new Map([...others.get(PHONE)].map(([id, hs]) => [id, id === closedPhone ? new Set(['x']) : hs]))]]);
  v = await P.verifyDevice(dir, { sessions: others.get(DEV), others: wrong });
  assert.deepEqual(v.seals[0].problems, [`session ${closedPhone} of ${PHONE} doesn’t hold what it seals`]);
  // missing altogether
  v = await P.verifyDevice(dir, { sessions: others.get(DEV), others: new Map([[DEV, others.get(DEV)]]) });
  assert.equal(v.seals[0].ok, false);

  // the time cover of the phone's sessions comes from this computer's seal
  v = await P.verifyDevice(dir, { sessions: others.get(DEV), others });
  v.seals[0].by = Date.parse('2026-11-01T10:00:05Z');
  const over = R.sealsOver(PHONE, { [DEV]: v });
  assert.equal(over.length, 1);
  assert.equal(over[0].sealedBy, DEV);
  const last = R.verifyChain(zlib.gunzipSync(fs.readFileSync(path.join(phone, closedPhone + '.jsonl.gz'))).toString()).last;
  const cover = P.timeCover([{ id: closedPhone, open: false, last, from: 0, to: Date.parse('2026-11-01T09:00:00Z') }, { id: path.basename(phoneOpen), open: true, last: 'later', from: 0, to: null }], over);
  assert.equal(cover[0].wholeBy, v.seals[0].by);
  assert.equal(cover[0].gap, undefined);
  assert.equal(cover[1].firstStamped, v.seals[0].by);
  assert.equal(R.sealsOver(DEV, { [DEV]: v })[0].heads, v.seals[0].heads);
});

test('the time cover takes the earliest seal, whatever order the seals come in', () => {
  const sessions = [{ id: 's', open: false, last: 'h2', from: 0, to: 1000 }];
  const seals = [
    { ok: true, by: 5000, heads: { s: 'h2' } },
    { ok: true, by: 2000, heads: { s: 'h2' } },
    { ok: true, by: 1500, heads: { s: 'h1' } }
  ];
  const [c] = P.timeCover(sessions, seals);
  assert.equal(c.wholeBy, 2000);
  assert.equal(c.firstStamped, 1500);
});

test('a seal after a session’s last words covers it whole; only the caret, focus and the clock came after', () => {
  const text = fs.readFileSync(path.join(__dirname, 'fixtures', 'recording-v1', fs.readdirSync(path.join(__dirname, 'fixtures', 'recording-v1')).sort()[0]), 'utf8');
  const v = R.verifyChain(text);
  assert.equal(v.wrote, true);
  assert.deepEqual(v.settled, [v.last], 'the fixture ends on words');
  // then focus moves, the clock, the end: none of it words
  const later = R.appendLines(R.appendLines(text, [[900, 'f', 'blur'], [60000, 'T', '2026-11-01T10:00:00.000Z']]), [[10, 's', 0, 3], [5, 'end', {}]]);
  const w = R.verifyChain(later);
  assert.deepEqual(w.settled, [v.last, R.verifyChain(R.appendLines(text, [[900, 'f', 'blur'], [60000, 'T', '2026-11-01T10:00:00.000Z']])).last, w.last]);
  const sessions = [{ id: 's', open: false, last: w.last, settled: w.settled, wrote: true, from: 0, to: 1000 }];
  const [c] = P.timeCover(sessions, [{ ok: true, by: 2000, heads: { s: v.last } }]);
  assert.equal(c.wholeBy, 2000);
  assert.equal(c.gap, undefined);
  // a word after it, and the same seal no longer covers it
  const more = R.verifyChain(R.appendLines(later, [[10, 'e', 0, 0, 'x']]));
  assert.deepEqual(more.settled, [more.last]);
  const [d] = P.timeCover([{ ...sessions[0], last: more.last, settled: more.settled }], [{ ok: true, by: 2000, heads: { s: v.last } }]);
  assert.equal(d.gap, 'never');
  // a session that wrote nothing is no gap, sealed or not
  const [e] = P.timeCover([{ id: 'q', open: false, last: 'h', settled: ['h'], wrote: false, from: 0, to: 1 }], []);
  assert.equal(e.gap, undefined);
});

test('a book opened seals words NEO quit or crashed before sealing, and not a caret moved since', async () => {
  const { dir, open, rest } = deviceFolder();
  const s = sealer(dir, network());
  await s.seal();
  const joined = () => R.joinParts(fs.readdirSync(open).sort().map((name) => ({ name, text: fs.readFileSync(path.join(open, name), 'utf8') }))).text;
  const chunk = (lines) => {
    const was = joined();
    const n = R.splitLines(was).lines.length;
    const now = R.appendLines(was, lines);
    put(path.join(open, `c-${String(n + 1).padStart(6, '0')}.jsonl`), R.splitLines(now).lines.slice(n).map((l) => l + '\n').join(''));
  };
  // focus and the caret since the seal: nothing to seal
  chunk([[900, 'f', 'blur'], [100, 's', 0, 1]]);
  assert.equal(await s.seal({ ifOthers: true, ifWords: true }), null);
  assert.equal(await s.seal({ ifOthers: true }), null);
  // words since it, in the fixture's own next chunk (in that one's place):
  // ifOthers alone waits for the next words; ifWords seals them
  nextChunk(open, rest);
  assert.equal(fs.readdirSync(open).length, 2);
  assert.ok(R.verifyChain(joined()).wrote);
  assert.equal(await s.seal({ ifOthers: true }), null);
  const made = await sealer(dir, network()).seal({ ifOthers: true, ifWords: true });
  assert.deepEqual(Object.keys(made.heads), [path.basename(open)]);
});

/* ---------- drand ---------- */

test('a drand round’s time comes from quicknet’s genesis; a round that doesn’t hash is refused', async () => {
  assert.equal(P.roundTime(1), P.DRAND.genesis * 1000);
  assert.equal(P.roundTime(33006614), Date.parse('2026-10-12T16:40:06Z'));
  await assert.rejects(() => P.drandRound(network({ drand: 'liar' }).fetch));
});

/* ---------- backups ---------- */

test('the backup mirror copies seals and stamps once', async () => {
  const Files = require('../recording-files.js');
  const io = Files.nodeIO({ fs, path, zlib, write: put, log: () => {} });
  const root = path.join(tmp(), 'recording');
  copyDir(path.join(FIX, 'recording'), root);
  // just arrived, as by sync: Windows' copy keeps the fixture's own times
  const seals = path.join(root, DEV, 'seals');
  for (const f of fs.readdirSync(seals)) fs.utimesSync(path.join(seals, f), new Date(), new Date());
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

/* ---------- the writer's own services ---------- */

// Real replies from two services NEO doesn't build in, fetched on
// 2026-10-13: SSL.com's (its chain ends in Mozilla's list) and FreeTSA's
// (its own root, in no public list), each over services/<name>.txt; and a
// seal stamped by both as services the writer added, with their roots
// beside it as the Sealer wrote them.
const SVC = path.join(FIX, 'services');
const svc = (f) => fs.readFileSync(path.join(SVC, f));
const sha = (b) => crypto.createHash('sha256').update(b).digest();
const noNet = async (url) => { throw new Error('no network in the tests: ' + url); };
const SVC_SEALS = path.join(SVC, 'recording', DEV, 'seals');

// DER with long lengths, for a token rebuilt without one of its certificates
function tlv(id, body) {
  const l = body.length;
  const len = l < 0x80 ? [l] : l < 0x100 ? [0x81, l] : l < 0x10000 ? [0x82, l >> 8, l & 255] : [0x83, l >> 16, (l >> 8) & 255, l & 255];
  return Buffer.concat([Buffer.from([id, ...len]), body]);
}
// a TimeStampResp with the certificates `drop` picks taken out (they aren't
// under the signature, so the token still checks)
function withoutCerts(reply, drop) {
  const whole = (n) => reply.subarray(n.start, n.end);
  const [status, tok] = P.kids(reply, P.der(reply));
  const tk = P.kids(reply, tok);
  const sd = P.kids(reply, P.kids(reply, tk[1])[0]);
  const parts = sd.map((n) => (n.id === 0xa0
    ? tlv(0xa0, Buffer.concat(P.kids(reply, n).filter((c) => !drop(new crypto.X509Certificate(whole(c)))).map(whole)))
    : whole(n)));
  return tlv(0x30, Buffer.concat([whole(status), tlv(0x30, Buffer.concat([whole(tk[0]), tlv(0xa0, tlv(0x30, Buffer.concat(parts)))]))]));
}

test('a service whose chain ends in Mozilla’s list is public, found with no network', async () => {
  const r = await P.findRoot(svc('sslcom.tsr'), { digest: sha(svc('sslcom.txt')), fetch: noNet });
  assert.equal(r.ok, true, r.problems.join('; '));
  assert.equal(r.public, true);
  assert.match(r.root.subject, /SSL\.com Root Certification Authority RSA/);
  assert.equal(P.isPublic(r.root), true);
});

test('a service with its own root: the self-signed top of what it carries, not public', async () => {
  const r = await P.findRoot(svc('freetsa.tsr'), { digest: sha(svc('freetsa.txt')), fetch: noNet });
  assert.equal(r.ok, true, r.problems.join('; '));
  assert.equal(r.public, false);
  assert.match(r.root.subject, /O=Free TSA/);
  assert.equal(r.root.issuer, r.root.subject);
  // for other bytes, it's no use
  const other = await P.findRoot(svc('freetsa.tsr'), { digest: crypto.randomBytes(32), fetch: noNet });
  assert.equal(other.ok, false);
});

test('a root the token doesn’t carry is fetched from its caIssuers link, and only there', async () => {
  const full = await P.findRoot(svc('freetsa.tsr'), { fetch: noNet });
  const root = full.root;
  const bare = withoutCerts(svc('freetsa.tsr'), (c) => c.raw.equals(root.raw));
  assert.equal(P.checkToken(bare, { anchors: [] }).ok, true); // still a good token
  const asked = [];
  const served = async (url) => {
    asked.push(url);
    if (url !== 'http://www.freetsa.org/files/cacert.pem') return { ok: false, status: 404 };
    return { ok: true, status: 200, arrayBuffer: async () => Buffer.from(P.pemOf(root)) };
  };
  const r = await P.findRoot(bare, { digest: sha(svc('freetsa.txt')), fetch: served });
  assert.equal(r.ok, true, (r.problems || []).join('; '));
  assert.ok(r.root.raw.equals(root.raw));
  assert.deepEqual(asked, ['http://www.freetsa.org/files/cacert.pem']);
  // the link down, or serving something that didn't issue it: not found
  assert.match((await P.findRoot(bare, { fetch: noNet })).problems[0], /root certificate couldn’t be found/);
  const ssl = (await P.findRoot(svc('sslcom.tsr'), { fetch: noNet })).root;
  const wrong = async () => ({ ok: true, status: 200, arrayBuffer: async () => Buffer.from(P.pemOf(ssl)) });
  assert.equal((await P.findRoot(bare, { fetch: wrong })).ok, false);
});

test('a service’s id is its host as a file-name part, never one already taken', () => {
  assert.equal(P.serviceId('https://www.FreeTSA.org/tsr'), 'freetsa-org');
  assert.equal(P.serviceId('https://freetsa.org/tsr', ['freetsa-org']), 'freetsa-org-2');
  assert.equal(P.serviceId('http://ts.ssl.com', ['digicert', 'sectigo', 'globalsign']), 'ts-ssl-com');
  for (const id of ['freetsa-org', 'ts-ssl-com']) assert.match(`000001.${id}.tsr`, /^(\d{6})\.([a-z0-9-]+)\.tsr$/);
});

test('an added service’s root goes beside the seals once, before its first stamp', async () => {
  const { dir, open, rest } = deviceFolder();
  const pem = fs.readFileSync(path.join(SVC_SEALS, fs.readdirSync(SVC_SEALS).find((f) => P.ROOT_FILE.test(f))), 'latin1');
  const name = P.rootFileName(P.certsIn(pem)[0]);
  const tsas = [{ id: 'mine', name: 'Mine', url: 'https://mine.test', root: pem }, TSAS[1]];
  const s = sealer(dir, network({ tsa: { mine: 'up', two: 'up' } }), { tsas });
  await s.seal();
  assert.deepEqual(await s.stamp(), ['mine', 'two']);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'seals')).sort(), ['000001.json', '000001.mine.tsr', '000001.two.tsr', name]);
  const at = fs.statSync(path.join(dir, 'seals', name)).mtimeMs;
  // the next seal: the root is there already, and isn't written again
  const n = R.splitLines(fs.readFileSync(path.join(open, 'c-000001.jsonl'), 'utf8')).lines.length;
  put(path.join(open, `c-${String(n + 1).padStart(6, '0')}.jsonl`), rest.map((l) => l + '\n').join(''));
  await s.seal();
  await s.stamp();
  assert.equal(fs.readdirSync(path.join(dir, 'seals')).filter((f) => P.ROOT_FILE.test(f)).length, 1);
  assert.equal(fs.statSync(path.join(dir, 'seals', name)).mtimeMs, at);
});

test('a stamp resting on a root the writer added is good but not trusted; one in Mozilla’s list is trusted', async () => {
  const dir = path.join(tmp(), DEV);
  copyDir(path.join(SVC, 'recording', DEV), dir);
  let v = await P.verifyDevice(dir);
  const [seal] = v.seals;
  assert.equal(seal.ok, true, seal.problems.join('; '));
  const free = seal.stamps.find((x) => x.tsa === 'freetsa-org');
  const ssl = seal.stamps.find((x) => x.tsa === 'ts-ssl-com');
  assert.deepEqual([free.ok, free.trusted, free.added], [true, false, true]);
  assert.deepEqual(free.problems, ['its root was added by the writer and isn’t in a public list']);
  assert.deepEqual([ssl.ok, ssl.trusted, ssl.added], [true, true, false]);
  assert.equal(seal.by, ssl.genTime); // only the trusted stamp fixes it in time
  // without the book's copy of SSL.com's root, its stamp isn't trusted:
  // NEO trusts its own three's roots, and those the book carries
  const sslRoot = fs.readdirSync(path.join(dir, 'seals')).find((f) => P.ROOT_FILE.test(f) && /SSL\.com/.test(P.certsIn(fs.readFileSync(path.join(dir, 'seals', f), 'latin1'))[0].subject));
  fs.rmSync(path.join(dir, 'seals', sslRoot));
  v = await P.verifyDevice(dir);
  assert.equal(v.seals[0].stamps.find((x) => x.tsa === 'ts-ssl-com').trusted, false);
  assert.equal(v.seals[0].by, null);
});

test('the mirror and an exported page carry the roots of the writer’s services', async () => {
  const Files = require('../recording-files.js');
  const ReplayExport = require('../replay-export.js');
  const io = Files.nodeIO({ fs, path, zlib, write: put, log: () => {} });
  const root = path.join(tmp(), 'recording');
  copyDir(path.join(SVC, 'recording'), root);
  const mirror = path.join(tmp(), 'mirror');
  await Files.sweep(io, root, mirror, DEV);
  const roots = fs.readdirSync(SVC_SEALS).filter((f) => P.ROOT_FILE.test(f)).sort();
  assert.equal(roots.length, 2);
  assert.deepEqual(fs.readdirSync(path.join(mirror, DEV, 'seals')).sort(), fs.readdirSync(SVC_SEALS).sort());
  const files = ReplayExport.sealFiles(SVC_SEALS);
  assert.deepEqual(files.map((f) => f.name).filter((n) => P.ROOT_FILE.test(n)), roots);
  const pem = ReplayExport.rootsPem((f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), { [DEV]: files });
  assert.ok(pem.startsWith(fs.readFileSync(path.join(__dirname, '..', 'proof-roots.pem'), 'utf8')));
  for (const r of roots) assert.ok(pem.includes(`(${r}):`), r);
  assert.equal(P.certsIn(pem).length, P.roots().length + 2);
});

test('NEO’s third authority is GlobalSign’s R45 address', () => {
  assert.deepEqual(P.TSAS.map((t) => t.id), ['digicert', 'sectigo', 'globalsign']);
  assert.equal(P.TSAS[2].url, 'http://timestamp.globalsign.com/tsa/r45standard');
});
