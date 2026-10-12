'use strict';
// Proof of when I wrote (docs/neo-recording-plan.md, part 2): seals over
// Writing History, signed with this device's key and timestamped by
// independent services. Opt-in. Only fingerprints leave the computer: a
// seal's SHA-256 goes to two RFC 3161 timestamp authorities (and, when the
// writer asks, to the OpenTimestamps calendars, which anchor it in Bitcoin).
// Never a word of the book.
//
// A seal is recording/<device>/seals/NNNNNN.json, written once:
//
//   { neoSeal: 1, seq, at, book, device, publicKey,
//     after: [{ beacon: 'drand-quicknet', round, randomness, signature },
//             { beacon: 'bitcoin', height, hash }],      (each when it answered)
//     heads: { <session>: <its last h line's hash> },     (those changed since the last seal)
//     tokens: { <file in seals/>: <sha256 hex> },         (stamps written since the last seal)
//     prev: <sha256 hex of the previous seal's bytes>, sig }
//
// `heads` takes the session still being written too, so a long session is
// fixed in time hour by hour. `after` is a value nobody knew before it was
// published, so the seal was made after it; its stamps say it existed by
// then. `tokens` puts each earlier stamp under the next seal's stamps, so a
// stamp whose authority's certificate expires stays covered by a newer one
// (RFC 4998's archive timestamps, in one field). Beside each seal:
//
//   NNNNNN.<tsa>.tsr     an RFC 3161 TimeStampResp, as the authority sent it
//   NNNNNN.pending.ots   an OpenTimestamps proof waiting for Bitcoin
//   NNNNNN.ots           the same once Bitcoin holds it (the pending one goes)
//
// No file is ever rewritten. Only the newest seal is stamped: each seal
// names the one before by its hash, so a seal made offline is fixed in time
// by the next one stamped. Anyone can check a stamp without NEO:
// `openssl ts -verify -data NNNNNN.json -in NNNNNN.digicert.tsr -CAfile <root>`,
// or `ots verify` on the .ots. scripts/verify-recording.js checks all of it.
//
// A main-process module with no Electron in it: NEO hands in the key (kept
// with safeStorage), a clock, fetch, and its durable write.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const R = require('./recording.js');
const Files = require('./recording-files.js');
const OTS = require('./ots.js');

// Node's own SHA-256 for the chains, as history-worker.js does: the same
// hashes, much faster than recording.js's own
R.setDigest((data) => crypto.createHash('sha256').update(data).digest().subarray(0, 16).toString('base64url'));

const SEAL = /^(\d{6})\.json$/;
const TOKEN = /^(\d{6})\.([a-z0-9-]+)\.tsr$/;
const OTS_FILE = /^(\d{6})\.ots$/;
const OTS_PENDING = /^(\d{6})\.pending\.ots$/;
const pad = (n) => String(n).padStart(6, '0');
const sha256 = (b) => crypto.createHash('sha256').update(b).digest();
const sha256hex = (b) => sha256(b).toString('hex');

/* ---------- the authorities ---------- */

// Asked in this order until two have stamped a seal. DigiCert's and
// Sectigo's are free and public, built for code signing and for anyone's
// RFC 3161 client; Sectigo asks that a script wait 15 s between requests.
// GlobalSign's is tried when one of them fails.
const TSAS = [
  { id: 'digicert', name: 'DigiCert', url: 'http://timestamp.digicert.com' },
  { id: 'sectigo', name: 'Sectigo', url: 'https://timestamp.sectigo.com', gap: 15000 },
  { id: 'globalsign', name: 'GlobalSign', url: 'http://timestamp.globalsign.com/tsa/r6advanced1' }
];
const STAMPS_WANTED = 2;

/* ---------- DER, as much as a timestamp token needs ---------- */

function der(buf, pos = 0) {
  if (pos + 2 > buf.length) throw new Error('DER ends early');
  const id = buf[pos];
  if ((id & 0x1f) === 0x1f) throw new Error('DER: long tag');
  let len = buf[pos + 1];
  let body = pos + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (!n || n > 4) throw new Error('DER: bad length');
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + buf[body++];
  }
  const end = body + len;
  if (end > buf.length) throw new Error('DER ends early');
  return { id, tag: id & 0x1f, cls: id >> 6, start: pos, body, end };
}
function kids(buf, n) {
  const out = [];
  for (let p = n.body; p < n.end;) { const k = der(buf, p); out.push(k); p = k.end; }
  return out;
}
const content = (buf, n) => buf.subarray(n.body, n.end);
const whole = (buf, n) => buf.subarray(n.start, n.end);
function oidOf(buf, n) {
  if (n.id !== 0x06) throw new Error('DER: expected an OID');
  const b = content(buf, n);
  const out = [Math.floor(b[0] / 40), b[0] % 40];
  let v = 0;
  for (let i = 1; i < b.length; i++) {
    v = v * 128 + (b[i] & 0x7f);
    if (!(b[i] & 0x80)) { out.push(v); v = 0; }
  }
  return out.join('.');
}
// an INTEGER as hex, without leading zeros
const intHex = (buf, n) => content(buf, n).toString('hex').replace(/^(00)+(?=.)/, '');
function timeOf(buf, n) {
  const s = content(buf, n).toString('latin1');
  const m = /^(\d{2}|\d{4})(\d\d)(\d\d)(\d\d)(\d\d)(\d\d)?(\.\d+)?Z$/.exec(s);
  if (!m) throw new Error('DER: bad time ' + s);
  let y = +m[1];
  if (m[1].length === 2) y += y < 50 ? 2000 : 1900; // UTCTime
  return Date.UTC(y, +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0), m[7] ? Math.round(parseFloat(m[7]) * 1000) : 0);
}
function tlv(id, body) {
  const l = body.length;
  const len = l < 0x80 ? [l] : l < 0x100 ? [0x81, l] : [0x82, l >> 8, l & 0xff];
  return Buffer.concat([Buffer.from([id, ...len]), body]);
}

const OID = {
  signedData: '1.2.840.113549.1.7.2',
  tstInfo: '1.2.840.113549.1.9.16.1.4',
  contentType: '1.2.840.113549.1.9.3',
  messageDigest: '1.2.840.113549.1.9.4',
  signingCert: '1.2.840.113549.1.9.16.2.12',
  signingCertV2: '1.2.840.113549.1.9.16.2.47',
  timeStamping: '1.3.6.1.5.5.7.3.8'
};
const HASHES = {
  '1.3.14.3.2.26': 'sha1',
  '2.16.840.1.101.3.4.2.1': 'sha256',
  '2.16.840.1.101.3.4.2.2': 'sha384',
  '2.16.840.1.101.3.4.2.3': 'sha512'
};
// signature algorithms: the hash they sign with (null: the signer's digest algorithm)
const SIGS = {
  '1.2.840.113549.1.1.1': null, // rsaEncryption
  '1.2.840.113549.1.1.5': 'sha1',
  '1.2.840.113549.1.1.11': 'sha256',
  '1.2.840.113549.1.1.12': 'sha384',
  '1.2.840.113549.1.1.13': 'sha512',
  '1.2.840.10045.2.1': null, // ecPublicKey
  '1.2.840.10045.4.3.2': 'sha256',
  '1.2.840.10045.4.3.3': 'sha384',
  '1.2.840.10045.4.3.4': 'sha512'
};
const PSS = '1.2.840.113549.1.1.10';

// A TimeStampReq for a SHA-256 digest: version 1, the imprint, a nonce, and
// the authority's certificate asked for, so the token can be checked alone
function tsaRequest(digest, nonce) {
  const alg = tlv(0x30, Buffer.concat([tlv(0x06, Buffer.from('608648016503040201', 'hex')), Buffer.from([0x05, 0x00])]));
  const imprint = tlv(0x30, Buffer.concat([alg, tlv(0x04, digest)]));
  const n = nonce[0] & 0x80 ? Buffer.concat([Buffer.from([0]), nonce]) : nonce;
  return tlv(0x30, Buffer.concat([tlv(0x02, Buffer.from([1])), imprint, tlv(0x02, n), Buffer.from([0x01, 0x01, 0xff])]));
}

let ROOTS = null;
function roots() {
  if (!ROOTS) {
    const pem = fs.readFileSync(path.join(__dirname, 'proof-roots.pem'), 'utf8');
    ROOTS = (pem.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) || []).map((p) => new crypto.X509Certificate(p));
  }
  return ROOTS;
}
const cnOf = (cert) => {
  const m = /(?:^|\n)CN=([^\n]+)/.exec(cert.subject);
  return m ? m[1] : cert.subject.split('\n').pop();
};
const validAt = (cert, at) => Date.parse(cert.validFrom) <= at && at <= Date.parse(cert.validTo);

// Checks a timestamp token (a TimeStampResp, or the bare token): that the
// authority granted it, that it stamps `digest` (and `nonce`, when given),
// that its signature is the certificate's, and whether that certificate
// chains to a root NEO knows (`trusted`), valid when it was stamped.
// { ok, trusted, genTime (ms), tsa, serial, problems }; `ok` is the token
// alone, `trusted` the chain.
function checkToken(buf, { digest = null, nonce = null, anchors = roots() } = {}) {
  const out = { ok: false, trusted: false, genTime: null, tsa: null, serial: null, hash: null, problems: [] };
  try {
    let top = der(buf);
    let k = kids(buf, top);
    // a TimeStampResp starts with its status; a token with its content type
    if (k[0] && k[0].id === 0x30) {
      const status = kids(buf, k[0]);
      const code = parseInt(intHex(buf, status[0]) || '0', 16);
      if (code > 1) { out.problems.push('the authority refused it (status ' + code + ')'); return out; }
      if (!k[1]) { out.problems.push('no token in the reply'); return out; }
      top = k[1];
      k = kids(buf, top);
    }
    if (oidOf(buf, k[0]) !== OID.signedData) throw new Error('not signed data');
    const sd = kids(buf, kids(buf, k[1])[0]);
    const encap = kids(buf, sd[2]);
    if (oidOf(buf, encap[0]) !== OID.tstInfo) throw new Error('not a timestamp');
    const tstBytes = content(buf, kids(buf, encap[1])[0]);
    // TSTInfo: version, policy, messageImprint, serialNumber, genTime, …, nonce
    const tst = kids(tstBytes, der(tstBytes));
    const imp = kids(tstBytes, tst[2]);
    out.hash = HASHES[oidOf(tstBytes, kids(tstBytes, imp[0])[0])] || null;
    const stamped = content(tstBytes, imp[1]);
    out.serial = intHex(tstBytes, tst[3]);
    out.genTime = timeOf(tstBytes, tst[4]);
    const tokNonce = tst.slice(5).find((n) => n.id === 0x02);
    if (digest && !(out.hash === 'sha256' && stamped.equals(digest))) out.problems.push('it stamps something else');
    if (nonce && !(tokNonce && intHex(tstBytes, tokNonce) === nonce.toString('hex').replace(/^(00)+(?=.)/, ''))) out.problems.push('its nonce isn’t the one asked for');

    // the certificates it carries, and the one signer
    let i = 3;
    const certs = [];
    if (sd[i] && sd[i].id === 0xa0) {
      for (const c of kids(buf, sd[i])) if (c.id === 0x30) certs.push(new crypto.X509Certificate(whole(buf, c)));
      i++;
    }
    if (sd[i] && sd[i].id === 0xa1) i++;
    const signers = kids(buf, sd[i]);
    if (signers.length !== 1) throw new Error('not one signer');
    const si = kids(buf, signers[0]);
    // version, sid, digestAlgorithm, [0] signedAttrs, signatureAlgorithm, signature
    const sid = si[1];
    const digestAlg = HASHES[oidOf(buf, kids(buf, si[2])[0])];
    if (!digestAlg) throw new Error('an unknown digest');
    const attrsNode = si[3];
    if (!attrsNode || attrsNode.id !== 0xa0) throw new Error('no signed attributes');
    const sigAlgNode = kids(buf, si[4]);
    const sigAlg = oidOf(buf, sigAlgNode[0]);
    const signature = content(buf, si[5]);
    const attrs = {};
    for (const a of kids(buf, attrsNode)) {
      const ak = kids(buf, a);
      attrs[oidOf(buf, ak[0])] = kids(buf, ak[1])[0];
    }
    if (!attrs[OID.contentType] || oidOf(buf, attrs[OID.contentType]) !== OID.tstInfo) throw new Error('signed for another content type');
    if (!attrs[OID.messageDigest] || !content(buf, attrs[OID.messageDigest]).equals(crypto.createHash(digestAlg).update(tstBytes).digest())) {
      out.problems.push('its signature covers something else');
      return out;
    }
    // ESS: the signer's certificate, named by its hash
    let essHash = null;
    let essAlg = null;
    const ess = attrs[OID.signingCertV2] || attrs[OID.signingCert];
    if (ess) {
      const first = kids(buf, kids(buf, ess)[0])[0];
      const id = kids(buf, first);
      if (attrs[OID.signingCertV2]) {
        essAlg = id[0].id === 0x30 ? HASHES[oidOf(buf, kids(buf, id[0])[0])] : 'sha256';
        essHash = content(buf, id[0].id === 0x30 ? id[1] : id[0]);
      } else {
        essAlg = 'sha1';
        essHash = content(buf, id[0]);
      }
    }
    const sidSerial = sid.id === 0x30 ? intHex(buf, kids(buf, sid)[1]) : null;
    const signed = Buffer.from(whole(buf, attrsNode));
    signed[0] = 0x31; // signed as a SET
    let signer = null;
    for (const cert of certs) {
      if (essHash) {
        if (!crypto.createHash(essAlg).update(cert.raw).digest().equals(essHash)) continue;
      } else if (sidSerial && cert.serialNumber.toLowerCase().replace(/^(00)+(?=.)/, '') !== sidSerial) continue;
      if (verifyWith(cert, sigAlg, sigAlgNode, buf, digestAlg, signed, signature)) { signer = cert; break; }
    }
    if (!signer) {
      out.problems.push(certs.length ? 'its signature doesn’t verify' : 'it carries no certificate to check it with');
      return out;
    }
    out.tsa = cnOf(signer);
    if (!signer.keyUsage || !signer.keyUsage.includes(OID.timeStamping)) out.problems.push('its certificate isn’t for timestamping');
    if (!out.problems.length) out.ok = true;
    const c = chainOf(signer, certs, anchors, out.genTime);
    out.trusted = out.ok && c.trusted;
    if (!c.trusted) out.problems.push(c.reason);
  } catch (err) {
    out.problems.push('it can’t be read (' + err.message + ')');
    out.ok = false;
  }
  return out;
}

function verifyWith(cert, sigAlg, sigAlgNode, buf, digestAlg, data, signature) {
  try {
    if (sigAlg === PSS) {
      // RSASSA-PSS-params: [0] hash, [1] mask, [2] salt length
      let hash = 'sha1';
      let salt = 20;
      if (sigAlgNode[1]) {
        for (const p of kids(buf, sigAlgNode[1])) {
          const inner = kids(buf, p)[0];
          if (p.id === 0xa0) hash = HASHES[oidOf(buf, kids(buf, inner)[0])] || hash;
          if (p.id === 0xa2) salt = parseInt(intHex(buf, inner), 16);
        }
      }
      return crypto.verify(hash, data, { key: cert.publicKey, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: salt }, signature);
    }
    if (!(sigAlg in SIGS)) return false;
    return crypto.verify(SIGS[sigAlg] || digestAlg, data, cert.publicKey, signature);
  } catch {
    return false;
  }
}

// From the signer up through the token's certificates to a known root,
// each valid when the token was made
function chainOf(signer, pool, anchors, at) {
  let cert = signer;
  const seen = [];
  for (let depth = 0; depth < 8; depth++) {
    if (!validAt(cert, at)) return { trusted: false, reason: '“' + cnOf(cert) + '” wasn’t valid when it stamped' };
    if (anchors.some((r) => r.raw.equals(cert.raw))) return { trusted: true };
    const root = anchors.find((r) => cert.checkIssued(r) && cert.verify(r.publicKey));
    if (root) return validAt(root, at) ? { trusted: true } : { trusted: false, reason: 'its root wasn’t valid when it stamped' };
    seen.push(cert);
    const up = pool.find((p) => !seen.includes(p) && cert.checkIssued(p) && cert.verify(p.publicKey));
    if (!up) return { trusted: false, reason: 'its certificates don’t lead to a root NEO knows' };
    cert = up;
  }
  return { trusted: false, reason: 'its certificate chain is too long' };
}

/* ---------- the device key ---------- */

const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex'); // Ed25519 public key, DER

// a new Ed25519 private key, as PKCS#8 PEM (NEO keeps it with safeStorage)
const newKey = () => crypto.generateKeyPairSync('ed25519').privateKey.export({ format: 'pem', type: 'pkcs8' });
function keyOf(pem) {
  const privateKey = crypto.createPrivateKey(pem);
  const raw = crypto.createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(SPKI_PREFIX.length);
  return { privateKey, publicKey: raw.toString('base64') };
}

// JSON with sorted keys, so a signature doesn't depend on property order
function canonical(v) {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).filter((k) => v[k] !== undefined).sort()
      .map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  }
  return JSON.stringify(v);
}
const sign = (privateKey, obj) => crypto.sign(null, Buffer.from(canonical(obj)), privateKey).toString('base64');
function verifySignature(publicKeyB64, obj, sigB64) {
  try {
    const raw = Buffer.from(publicKeyB64, 'base64');
    if (raw.length !== 32) return false;
    const key = crypto.createPublicKey({ key: Buffer.concat([SPKI_PREFIX, raw]), format: 'der', type: 'spki' });
    return crypto.verify(null, Buffer.from(canonical(obj)), key, Buffer.from(sigB64, 'base64'));
  } catch {
    return false;
  }
}

/* ---------- after: what nobody knew before ---------- */

// drand's quicknet: the League of Entropy's public randomness, a round
// every 3 s since its genesis. A round's randomness is the SHA-256 of its
// BLS signature; checking the signature itself needs pairing maths NEO
// doesn't carry, so a verifier asks drand for the round (or uses drand's
// own client).
const DRAND = {
  beacon: 'drand-quicknet',
  chain: '52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971',
  genesis: 1692803367,
  period: 3,
  urls: ['https://api.drand.sh', 'https://api2.drand.sh', 'https://api3.drand.sh', 'https://drand.cloudflare.com']
};
const roundTime = (round) => (DRAND.genesis + (round - 1) * DRAND.period) * 1000;

async function getJSON(fetchFn, url, ms = 8000) {
  const res = await fetchFn(url, { headers: { 'User-Agent': 'NEO' }, signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(url + ' answered ' + res.status);
  return res.json();
}
async function getText(fetchFn, url, ms = 8000) {
  const res = await fetchFn(url, { headers: { 'User-Agent': 'NEO' }, signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(url + ' answered ' + res.status);
  return (await res.text()).trim();
}

// the round asked for (`round`), or the latest
async function drandRound(fetchFn, round = 'latest') {
  let last = null;
  for (const base of DRAND.urls) {
    try {
      const r = await getJSON(fetchFn, `${base}/${DRAND.chain}/public/${round}`);
      if (!Number.isInteger(r.round) || !/^[0-9a-f]{96}$/.test(r.signature || '') ||
          sha256hex(Buffer.from(r.signature, 'hex')) !== r.randomness) throw new Error(base + ' answered a round that doesn’t add up');
      return { beacon: DRAND.beacon, round: r.round, randomness: r.randomness, signature: r.signature };
    } catch (err) { last = err; }
  }
  throw last || new Error('drand didn’t answer');
}

const EXPLORERS = ['https://blockstream.info/api', 'https://mempool.space/api'];
// Bitcoin's newest block
async function bitcoinTip(fetchFn) {
  let last = null;
  for (const api of EXPLORERS) {
    try {
      const height = parseInt(await getText(fetchFn, `${api}/blocks/tip/height`), 10);
      const hash = await getText(fetchFn, `${api}/block-height/${height}`);
      if (!Number.isInteger(height) || !/^[0-9a-f]{64}$/.test(hash)) throw new Error(api + ' answered something else');
      return { beacon: 'bitcoin', height, hash };
    } catch (err) { last = err; }
  }
  throw last || new Error('no block explorer answered');
}

/* ---------- reading a recording's heads ---------- */

// Every `h` hash a session's verified chain holds: a seal made while it was
// open names one of them
function chainHashes(text) {
  const v = R.verifyChain(text);
  const out = new Set();
  const { lines } = R.splitLines(text);
  for (let i = 1; i < Math.min(lines.length, v.verified); i++) {
    if (!lines[i].includes('"h"')) continue;
    try {
      const l = JSON.parse(lines[i]);
      if (Array.isArray(l) && l[1] === 'h') out.add(l[3]);
    } catch { /* unreadable, so not verified either */ }
  }
  return out;
}

/* ---------- the sealer ---------- */

// When each authority was last asked, for Sectigo’s 15 s between requests
const asked = new Map();

// One device's seals of one book. `dir` is recording/<device>; `cacheFile`
// (outside the library) remembers the heads of closed sessions, which never
// change. One at a time per book: NEO queues the calls. (`check` is
// checkToken; the tests hand in their own.)
class Sealer {
  constructor({ dir, book, device, key, now = () => new Date(), fetch = globalThis.fetch, write, log = () => {},
    tsas = TSAS, bitcoin = false, anchors = null, cacheFile = null, check = checkToken }) {
    Object.assign(this, { dir, book, device, key, now, fetch, log, tsas, bitcoin, cacheFile, check });
    this.anchors = anchors;
    this.put = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); write(file, data); };
    this.io = Files.nodeIO({ fs, path, zlib, write: this.put, log });
    this.state = null;
    this.closedHeads = null;
    this.upgradedAt = 0;
  }

  get sealsDir() { return path.join(this.dir, 'seals'); }
  files() { try { return fs.readdirSync(this.sealsDir).sort(); } catch { return []; } }

  // What the seals so far say: the last head sealed for each session, the
  // stamps already under a seal, and the newest seal
  load() {
    if (this.state) return this.state;
    const st = { seals: [], sealed: new Map(), covered: new Set() };
    for (const f of this.files()) {
      if (!SEAL.test(f)) continue;
      try {
        const bytes = fs.readFileSync(path.join(this.sealsDir, f));
        const body = JSON.parse(bytes);
        st.seals.push({ file: f, seq: body.seq, at: body.at, hash: sha256hex(bytes) });
        for (const [s, h] of Object.entries(body.heads || {})) st.sealed.set(s, h);
        for (const t of Object.keys(body.tokens || {})) st.covered.add(t);
      } catch (err) { this.log('proof', new Error(f + ': ' + err.message)); }
    }
    this.state = st;
    return st;
  }

  last() { const s = this.load().seals; return s.length ? s[s.length - 1] : null; }

  // Each session's last `h`, the open ones' too
  async heads() {
    if (!this.closedHeads) {
      this.closedHeads = {};
      if (this.cacheFile) try { this.closedHeads = JSON.parse(fs.readFileSync(this.cacheFile, 'utf8')) || {}; } catch { /* none yet */ }
    }
    const out = new Map();
    let names = [];
    try { names = fs.readdirSync(this.dir); } catch { return out; }
    let learnt = false;
    const closed = new Set();
    for (const n of names) {
      const s = Files.closedName(n);
      if (!s) continue;
      closed.add(s);
      if (!this.closedHeads[s]) {
        try {
          const h = R.verifyChain(this.io.readGz(path.join(this.dir, n))).last;
          if (h) { this.closedHeads[s] = h; learnt = true; }
        } catch (err) { this.log('proof', err); }
      }
      if (this.closedHeads[s]) out.set(s, this.closedHeads[s]);
    }
    for (const n of names) {
      if (!Files.SESSION.test(n) || closed.has(n)) continue;
      try {
        const text = R.joinParts(await Files.readParts(this.io, path.join(this.dir, n))).text;
        const h = text && R.verifyChain(text).last;
        if (h) out.set(n, h);
      } catch (err) { if (err.code !== 'ENOENT') this.log('proof', err); }
    }
    if (learnt && this.cacheFile) {
      try { this.put(this.cacheFile, JSON.stringify(this.closedHeads)); } catch (err) { this.log('proof cache', err); }
    }
    return out;
  }

  // A seal of whatever changed since the last one; null when nothing did,
  // unless `force` (a yearly renewal, which seals the stamps alone)
  async seal({ force = false } = {}) {
    const st = this.load();
    const changed = {};
    for (const [s, h] of await this.heads()) if (st.sealed.get(s) !== h) changed[s] = h;
    if (!Object.keys(changed).length && !force) return null;
    const tokens = {};
    for (const f of this.files()) {
      if ((TOKEN.test(f) || OTS_FILE.test(f)) && !st.covered.has(f)) tokens[f] = sha256hex(fs.readFileSync(path.join(this.sealsDir, f)));
    }
    // what nobody knew before: asked first, so the seal comes after it
    const after = [];
    try { after.push(await drandRound(this.fetch)); } catch (err) { this.log('proof drand', err); }
    if (this.bitcoin) try { after.push(await bitcoinTip(this.fetch)); } catch (err) { this.log('proof bitcoin', err); }
    const prev = this.last();
    const body = {
      neoSeal: 1,
      seq: prev ? prev.seq + 1 : 1,
      at: this.now().toISOString(),
      book: this.book,
      device: this.device,
      publicKey: this.key.publicKey,
      after: after.length ? after : undefined,
      heads: changed,
      tokens: Object.keys(tokens).length ? tokens : undefined,
      prev: prev ? prev.hash : null
    };
    body.sig = sign(this.key.privateKey, body);
    const bytes = Buffer.from(JSON.stringify(body, null, 1) + '\n', 'utf8');
    const file = path.join(this.sealsDir, pad(body.seq) + '.json');
    if (fs.existsSync(file)) throw new Error('proof: ' + file + ' is already there');
    this.put(file, bytes);
    st.seals.push({ file: path.basename(file), seq: body.seq, at: body.at, hash: sha256hex(bytes) });
    for (const [s, h] of Object.entries(changed)) st.sealed.set(s, h);
    for (const t of Object.keys(tokens)) st.covered.add(t);
    return body;
  }

  // The newest seal stamped by authorities until two have (one asked after
  // another, the next tried when one fails), and, when the writer asked,
  // sent to the OpenTimestamps calendars. Older seals are left: the newest
  // names them. Returns the authorities that stamped it now.
  async stamp() {
    const seal = this.last();
    if (!seal) return [];
    const bytes = fs.readFileSync(path.join(this.sealsDir, seal.file));
    const digest = sha256(bytes);
    const stem = pad(seal.seq);
    const have = new Set(this.files().filter((f) => f.startsWith(stem + '.') && f.endsWith('.tsr')).map((f) => TOKEN.exec(f)[2]));
    const done = [];
    for (const tsa of this.tsas) {
      if (have.size >= STAMPS_WANTED) break;
      if (have.has(tsa.id)) continue;
      // asked moments ago (a tag sealed just after the hour's seal): the
      // next authority instead, rather than hold the seals up
      if (tsa.gap && Date.now() - (asked.get(tsa.id) || 0) < tsa.gap) continue;
      try {
        asked.set(tsa.id, Date.now());
        const nonce = crypto.randomBytes(8);
        const res = await this.fetch(tsa.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/timestamp-query', 'User-Agent': 'NEO' },
          body: tsaRequest(digest, nonce),
          signal: AbortSignal.timeout(20000)
        });
        if (!res.ok) throw new Error(tsa.url + ' answered ' + res.status);
        const reply = Buffer.from(await res.arrayBuffer());
        const c = this.check(reply, { digest, nonce, anchors: this.anchors || undefined });
        if (!c.ok) throw new Error(tsa.name + '’s stamp: ' + c.problems.join('; '));
        if (!c.trusted) this.log('proof', new Error(tsa.name + '’s stamp: ' + c.problems.join('; ')));
        this.put(path.join(this.sealsDir, `${stem}.${tsa.id}.tsr`), reply);
        have.add(tsa.id);
        done.push(tsa.id);
      } catch (err) { this.log('proof stamp', err); }
    }
    if (this.bitcoin && !this.files().some((f) => f === stem + '.ots' || f === stem + '.pending.ots')) {
      try { this.put(path.join(this.sealsDir, stem + '.pending.ots'), await OTS.stamp(digest)); } catch (err) { this.log('proof ots', err); }
    }
    return done;
  }

  // Pending OpenTimestamps proofs asked after, at most every `every` ms:
  // one Bitcoin holds is written as NNNNNN.ots, and the pending one goes
  async upgrade({ every = 3 * 3600 * 1000 } = {}) {
    if (Date.now() - this.upgradedAt < every) return 0;
    this.upgradedAt = Date.now();
    let n = 0;
    for (const f of this.files()) {
      const m = OTS_PENDING.exec(f);
      if (!m) continue;
      try {
        const r = await OTS.upgrade(fs.readFileSync(path.join(this.sealsDir, f)));
        if (!OTS.attestations(OTS.parseProof(r.proof)).some((a) => a.type === 'bitcoin')) continue;
        const done = path.join(this.sealsDir, m[1] + '.ots');
        if (!fs.existsSync(done)) this.put(done, r.proof);
        fs.rmSync(path.join(this.sealsDir, f), { force: true });
        n++;
      } catch (err) { this.log('proof ots', err); }
    }
    return n;
  }

  // Whether the newest seal is old enough that its stamps want a newer
  // seal over them (a year less a month, so a book opened once a year
  // renews before its stamps' certificates can lapse)
  renewDue(ms = 335 * 24 * 3600 * 1000) {
    const l = this.last();
    return !!l && this.now() - Date.parse(l.at) > ms;
  }

  // For the dialog: how many seals, the newest, and who stamped it
  status() {
    const l = this.last();
    if (!l) return { seals: 0 };
    const stem = pad(l.seq);
    const files = this.files();
    const stamps = files.filter((f) => f.startsWith(stem + '.') && TOKEN.test(f)).map((f) => TOKEN.exec(f)[2]);
    // the newest seal any authority stamped
    let stamped = null;
    for (const s of [...this.load().seals].reverse()) {
      if (files.some((f) => f.startsWith(pad(s.seq) + '.') && TOKEN.test(f))) { stamped = s.at; break; }
    }
    return {
      seals: this.load().seals.length,
      at: l.at,
      stamps: stamps.map((id) => (this.tsas.find((t) => t.id === id) || { name: id }).name),
      stampedAt: stamped,
      bitcoin: files.some((f) => OTS_FILE.test(f)),
      pendingBitcoin: files.some((f) => OTS_PENDING.test(f))
    };
  }
}

/* ---------- checking ---------- */

// One device's seals checked: each one's signature, its place in the chain,
// its stamps, its `after`, and the stamps it says it covers. `sessions`
// maps a session to the `h` hashes its chain holds (chainHashes), to check
// the heads; `online` asks drand and a block explorer too.
// { device, publicKey, seals: [{ seq, at, ok, by, after, stamps, ots, problems }], problems }
async function verifyDevice(dir, { sessions = null, online = false, fetch: fetchFn = globalThis.fetch, anchors = roots() } = {}) {
  const sealsDir = path.join(dir, 'seals');
  let files = [];
  try { files = fs.readdirSync(sealsDir).sort(); } catch { /* none */ }
  const out = { device: path.basename(dir), publicKey: null, seals: [], problems: [] };
  let prevHash = null;
  for (const f of files) {
    const m = SEAL.exec(f);
    if (!m) continue;
    const s = { file: f, seq: +m[1], at: null, ok: true, by: null, after: null, stamps: [], ots: null, problems: [] };
    out.seals.push(s);
    const bad = (why) => { s.ok = false; s.problems.push(why); };
    let bytes;
    let body;
    try { bytes = fs.readFileSync(path.join(sealsDir, f)); body = JSON.parse(bytes); } catch { bad('it can’t be read'); prevHash = null; continue; }
    s.at = Date.parse(body.at);
    if (body.neoSeal !== 1) bad('it is in a format this NEO doesn’t know');
    if (body.seq !== s.seq) bad('its number isn’t its file’s');
    if (body.seq !== out.seals.length) bad('seals before it are missing');
    if (body.device !== out.device) bad('it names another device');
    const { sig, ...signed } = body;
    if (!verifySignature(body.publicKey, signed, sig)) bad('its signature doesn’t verify');
    if (out.publicKey === null) out.publicKey = body.publicKey;
    else if (body.publicKey !== out.publicKey) bad('it is signed with another key than the first seal');
    if ((body.prev || null) !== (out.seals.length > 1 ? prevHash : null)) bad('it doesn’t name the seal before it');
    prevHash = sha256hex(bytes);
    const digest = sha256(bytes);
    // the heads it seals are in the recording
    if (sessions) {
      for (const [session, h] of Object.entries(body.heads || {})) {
        const known = sessions.get(session);
        if (!known) bad('session ' + session + ' isn’t in the recording');
        else if (!known.has(h)) bad('session ' + session + ' doesn’t hold what it seals');
      }
    }
    for (const [t, hash] of Object.entries(body.tokens || {})) {
      let held = null;
      try { held = sha256hex(fs.readFileSync(path.join(sealsDir, t))); } catch { /* gone */ }
      if (held === null) s.problems.push('the stamp ' + t + ' it covers is missing');
      else if (held !== hash) bad('the stamp ' + t + ' isn’t what it covered');
    }
    // after
    for (const a of body.after || []) {
      if (a.beacon === DRAND.beacon) {
        let ok = sha256hex(Buffer.from(String(a.signature), 'hex')) === a.randomness && Number.isInteger(a.round);
        if (ok && online) {
          try { ok = (await drandRound(fetchFn, a.round)).randomness === a.randomness; } catch { s.problems.push('drand couldn’t be asked about round ' + a.round); }
        }
        if (!ok) bad('its drand round isn’t drand’s');
        else s.after = Math.max(s.after || 0, roundTime(a.round));
        if (roundTime(a.round) > s.at + 60000) bad('its drand round is later than the seal says it was made');
      } else if (a.beacon === 'bitcoin' && online) {
        try {
          const res = await fetchFn(`${EXPLORERS[0]}/block/${a.hash}`, { signal: AbortSignal.timeout(10000) });
          const block = res.ok ? await res.json() : null;
          if (!block || block.height !== a.height) bad('its Bitcoin block isn’t Bitcoin’s');
          else s.after = Math.max(s.after || 0, block.timestamp * 1000);
        } catch { s.problems.push('no block explorer could be asked about block ' + a.height); }
      }
    }
    // stamps
    for (const t of files) {
      const tm = TOKEN.exec(t);
      if (!tm || +tm[1] !== s.seq) continue;
      const c = checkToken(fs.readFileSync(path.join(sealsDir, t)), { digest, anchors });
      s.stamps.push({ tsa: tm[2], file: t, ok: c.ok, trusted: c.trusted, genTime: c.genTime, name: c.tsa, problems: c.problems });
      if (!c.ok) bad(tm[2] + '’s stamp: ' + c.problems.join('; '));
      else if (!c.trusted) s.problems.push(tm[2] + '’s stamp: ' + c.problems.join('; '));
      else {
        if (c.genTime < s.at - 5 * 60000) bad(tm[2] + ' stamped it before it says it was made');
        s.by = s.by === null ? c.genTime : Math.min(s.by, c.genTime);
      }
    }
    // OpenTimestamps
    const otsFile = files.find((x) => x === pad(s.seq) + '.ots') || files.find((x) => x === pad(s.seq) + '.pending.ots');
    if (otsFile) {
      try {
        const proof = OTS.parseProof(fs.readFileSync(path.join(sealsDir, otsFile)));
        if (!proof.digest.equals(digest)) bad('its OpenTimestamps proof is for other bytes');
        const btc = OTS.attestations(proof).filter((a) => a.type === 'bitcoin');
        s.ots = { file: otsFile, heights: btc.map((a) => a.height), checked: null };
        if (online && btc.length) {
          const r = await OTS.checkBitcoin(btc[0].height, btc[0].msg);
          s.ots.checked = r.ok;
          if (r.ok) s.by = s.by === null ? r.time.getTime() : Math.min(s.by, r.time.getTime());
          else if (!r.offline) bad('its OpenTimestamps proof: ' + r.reason);
        }
      } catch (err) { bad('its OpenTimestamps proof can’t be read (' + err.message + ')'); }
    }
  }
  // a seal not stamped itself is fixed in time by the next stamped one,
  // which names it through the chain
  let later = null;
  for (let i = out.seals.length - 1; i >= 0; i--) {
    const s = out.seals[i];
    if (s.by !== null && s.ok) later = s.by;
    else if (s.by === null) { s.byLater = later; }
    if (!s.ok) later = null; // the chain breaks here
  }
  return out;
}

module.exports = {
  TSAS, DRAND, STAMPS_WANTED,
  der, kids, oidOf, tsaRequest, checkToken, roots,
  newKey, keyOf, canonical, sign, verifySignature,
  drandRound, roundTime, bitcoinTip, chainHashes,
  Sealer, verifyDevice, sha256hex
};
