'use strict';
// Proof of when I wrote (docs/neo-recording-plan.md, part 2): seals over
// Writing History, signed with this device's key and timestamped by
// independent services. Opt-in. Only fingerprints leave the computer: a
// seal's SHA-256 goes to two RFC 3161 timestamp authorities. Never a word
// of the book.
//
// A seal is recording/<device>/seals/NNNNNN.json, written once:
//
//   { neoSeal: 1, seq, at, book, device, publicKey,
//     after: [{ beacon: 'drand-quicknet', round, randomness, signature }],  (when it answered)
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
//
// No file is ever rewritten. Only the newest seal is stamped: each seal
// names the one before by its hash, so a seal made offline is fixed in time
// by the next one stamped. Anyone can check a stamp without NEO:
// `openssl ts -verify -data NNNNNN.json -in NNNNNN.digicert.tsr -CAfile <root>`.
// scripts/verify-recording.js checks all of it.
//
// A main-process module with no Electron in it: NEO hands in the key (kept
// with safeStorage), a clock, fetch, and its durable write.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const R = require('./recording.js');
const Files = require('./recording-files.js');

// Node's own SHA-256 for the chains, as history-worker.js does: the same
// hashes, much faster than recording.js's own
R.setDigest((data) => crypto.createHash('sha256').update(data).digest().subarray(0, 16).toString('base64url'));

const SEAL = /^(\d{6})\.json$/;
const TOKEN = /^(\d{6})\.([a-z0-9-]+)\.tsr$/;
// the root of a service the writer added, beside the seals it stamped
const ROOT_FILE = /^root-[0-9a-f]{16}\.pem$/;
const pad = (n) => String(n).padStart(6, '0');
const sha256 = (b) => crypto.createHash('sha256').update(b).digest();
const sha256hex = (b) => sha256(b).toString('hex');

/* ---------- the authorities ---------- */

// Asked in this order until two have stamped a seal. DigiCert's and
// Sectigo's are free and public, built for code signing and for anyone's
// RFC 3161 client; Sectigo asks that a script wait 15 s between requests.
// GlobalSign's is tried when one of them fails. These are the defaults: the
// writer can turn them off, reorder them, and add their own (main.js keeps
// that in settings.json, and hands the Sealer the list).
const TSAS = [
  { id: 'digicert', name: 'DigiCert', url: 'http://timestamp.digicert.com' },
  { id: 'sectigo', name: 'Sectigo', url: 'https://timestamp.sectigo.com', gap: 15000 },
  { id: 'globalsign', name: 'GlobalSign', url: 'http://timestamp.globalsign.com/tsa/r45standard' }
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
// Mozilla's list as Node ships it, the same in every NEO: a root the
// writer's own service chains to is public when it's here
let MOZILLA = null;
function mozilla() {
  if (!MOZILLA) MOZILLA = require('tls').rootCertificates.map((p) => new crypto.X509Certificate(p));
  return MOZILLA;
}
const isPublic = (cert) => roots().some((r) => r.raw.equals(cert.raw)) || mozilla().some((r) => r.raw.equals(cert.raw));
const pemOf = (cert) => cert.toString().trim() + '\n';
// the file a service's root is kept in beside the seals
const rootFileName = (cert) => 'root-' + sha256hex(cert.raw).slice(0, 16) + '.pem';
const certsIn = (pem) => (String(pem).match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) || []).map((p) => new crypto.X509Certificate(p));
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
    // (for findRoot: the signer and what it carries, not part of the answer)
    Object.defineProperty(out, 'carried', { value: { signer, certs } });
    const c = chainOf(signer, certs, anchors, out.genTime);
    out.trusted = out.ok && c.trusted;
    if (c.root) Object.defineProperty(out, 'root', { value: c.root });
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
    if (anchors.some((r) => r.raw.equals(cert.raw))) return { trusted: true, root: cert };
    const root = anchors.find((r) => cert.checkIssued(r) && cert.verify(r.publicKey));
    if (root) return validAt(root, at) ? { trusted: true, root } : { trusted: false, reason: 'its root wasn’t valid when it stamped' };
    seen.push(cert);
    const up = pool.find((p) => !seen.includes(p) && cert.checkIssued(p) && cert.verify(p.publicKey));
    if (!up) return { trusted: false, reason: 'its certificates don’t lead to a root NEO knows' };
    cert = up;
  }
  return { trusted: false, reason: 'its certificate chain is too long' };
}

/* ---------- the writer's own services ---------- */

// The certificates a caIssuers link gives: one, DER or PEM, or a
// PKCS#7 bundle (.p7c) of several
function certsFrom(buf) {
  if (/^-----BEGIN/.test(buf.subarray(0, 20).toString('latin1'))) return certsIn(buf.toString('latin1'));
  try { return [new crypto.X509Certificate(buf)]; } catch { /* a bundle, then */ }
  const k = kids(buf, der(buf));
  if (oidOf(buf, k[0]) !== OID.signedData) return [];
  const set = kids(buf, kids(buf, k[1])[0]).find((n) => n.id === 0xa0);
  return set ? kids(buf, set).filter((c) => c.id === 0x30).map((c) => new crypto.X509Certificate(whole(buf, c))) : [];
}

// The certificate that issued `cert`, fetched from its caIssuers link
// (Authority Information Access), or null
async function fetchIssuer(cert, fetchFn) {
  const urls = [...String(cert.infoAccess || '').matchAll(/CA Issuers - URI:(https?:\/\/\S+)/g)].map((m) => m[1]);
  for (const url of urls) {
    try {
      const res = await fetchFn(url, { headers: { 'User-Agent': 'NEO' }, signal: AbortSignal.timeout(15000) });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 256 * 1024) continue;
      const up = certsFrom(buf).find((c) => cert.checkIssued(c) && cert.verify(c.publicKey));
      if (up) return up;
    } catch { /* the next link */ }
  }
  return null;
}

// A timestamp service's root, from one of its replies: a public root it
// chains to (proof-roots.pem, or Mozilla's list), else the self-signed top
// of its chain, found in what the token carries and up the caIssuers links.
// { ok, root (X509), public, tsa, problems }
async function findRoot(reply, { fetch: fetchFn = globalThis.fetch, digest = null, nonce = null } = {}) {
  const c = checkToken(reply, { digest, nonce, anchors: [...roots(), ...mozilla()] });
  if (!c.ok) return { ok: false, problems: c.problems };
  if (c.trusted) return { ok: true, root: c.root, public: true, tsa: c.tsa, problems: [] };
  const pool = [...c.carried.certs];
  let cert = c.carried.signer;
  for (let depth = 0; ; depth++) {
    if (cert.checkIssued(cert) && cert.verify(cert.publicKey)) break; // self-signed: the root
    let up = pool.find((p) => p !== cert && !p.raw.equals(cert.raw) && cert.checkIssued(p) && cert.verify(p.publicKey));
    if (!up && depth < 8) up = await fetchIssuer(cert, fetchFn);
    if (!up || depth >= 8) return { ok: false, problems: ['its root certificate couldn’t be found'] };
    pool.push(up);
    cert = up;
  }
  const again = checkToken(reply, { digest, nonce, anchors: [cert] });
  if (!again.trusted) return { ok: false, problems: again.problems };
  return { ok: true, root: cert, public: isPublic(cert), tsa: c.tsa, problems: [] };
}

// A service the writer is adding, tried with one request for a random
// fingerprint: whether it answers with a good token, and its root.
// { ok, root, public, tsa, problems }
async function tryService(url, { fetch: fetchFn = globalThis.fetch } = {}) {
  const digest = crypto.randomBytes(32);
  const nonce = crypto.randomBytes(8);
  let reply;
  try {
    const res = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/timestamp-query', 'User-Agent': 'NEO' },
      body: tsaRequest(digest, nonce),
      signal: AbortSignal.timeout(20000)
    });
    if (!res.ok) return { ok: false, problems: ['it answered ' + res.status] };
    reply = Buffer.from(await res.arrayBuffer());
  } catch (err) {
    return { ok: false, problems: ['it couldn’t be reached (' + (err.cause && err.cause.code || err.message) + ')'] };
  }
  return findRoot(reply, { fetch: fetchFn, digest, nonce });
}

// A service's id, from its URL: the host as a file-name part, unlike
// any in `taken`
function serviceId(url, taken = []) {
  const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  const base = host.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'service';
  let id = base;
  for (let n = 2; taken.includes(id); n++) id = base + '-' + n;
  return id;
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
    tsas = TSAS, anchors = null, cacheFile = null, check = checkToken }) {
    Object.assign(this, { dir, book, device, key, now, fetch, log, tsas, cacheFile, check });
    this.anchors = anchors;
    this.put = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); write(file, data); };
    this.io = Files.nodeIO({ fs, path, zlib, write: this.put, log });
    this.state = null;
    this.closedHeads = null;
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
      if (TOKEN.test(f) && !st.covered.has(f)) tokens[f] = sha256hex(fs.readFileSync(path.join(this.sealsDir, f)));
    }
    // what nobody knew before: asked first, so the seal comes after it
    const after = [];
    try { after.push(await drandRound(this.fetch)); } catch (err) { this.log('proof drand', err); }
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
  // another, the next tried when one fails). Older seals are left: the
  // newest names them. Returns the authorities that stamped it now.
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
        // a service the writer added: its root beside the seals first,
        // once, so anyone reading the book can check its stamps
        if (tsa.root) {
          const root = certsIn(tsa.root)[0];
          const file = path.join(this.sealsDir, rootFileName(root));
          if (!fs.existsSync(file)) this.put(file, pemOf(root));
        }
        this.put(path.join(this.sealsDir, `${stem}.${tsa.id}.tsr`), reply);
        have.add(tsa.id);
        done.push(tsa.id);
      } catch (err) { this.log('proof stamp', err); }
    }
    return done;
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
      stampedAt: stamped
    };
  }
}

/* ---------- checking ---------- */

// One device's seals checked: each one's signature, its place in the chain,
// its stamps, its `after`, and the stamps it says it covers. `sessions`
// maps a session to the `h` hashes its chain holds (chainHashes), to check
// the heads; `online` asks drand too.
// { device, publicKey, seals: [{ seq, at, ok, by, after, stamps, problems }], problems }
async function verifyDevice(dir, { sessions = null, online = false, fetch: fetchFn = globalThis.fetch, anchors = roots() } = {}) {
  const sealsDir = path.join(dir, 'seals');
  let files = [];
  try { files = fs.readdirSync(sealsDir).sort(); } catch { /* none */ }
  const out = { device: path.basename(dir), publicKey: null, seals: [], problems: [] };
  let prevHash = null;
  // roots of services the writer added: trusted when they're public, and
  // otherwise only said to be theirs
  const added = [];
  for (const f of files) {
    if (!ROOT_FILE.test(f)) continue;
    try { added.push(...certsIn(fs.readFileSync(path.join(sealsDir, f), 'latin1'))); } catch { out.problems.push(f + ' can’t be read'); }
  }
  const publicAdded = added.filter((r) => mozilla().some((m) => m.raw.equals(r.raw)));
  const privateAdded = added.filter((r) => !publicAdded.includes(r));
  anchors = [...anchors, ...publicAdded];
  for (const f of files) {
    const m = SEAL.exec(f);
    if (!m) continue;
    const s = { file: f, seq: +m[1], at: null, ok: true, by: null, after: null, stamps: [], problems: [] };
    out.seals.push(s);
    const bad = (why) => { s.ok = false; s.problems.push(why); };
    let bytes;
    let body;
    try { bytes = fs.readFileSync(path.join(sealsDir, f)); body = JSON.parse(bytes); } catch { bad('it can’t be read'); prevHash = null; continue; }
    s.at = Date.parse(body.at);
    s.heads = body.heads || {};
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
      }
    }
    // stamps
    for (const t of files) {
      const tm = TOKEN.exec(t);
      if (!tm || +tm[1] !== s.seq) continue;
      const tok = fs.readFileSync(path.join(sealsDir, t));
      const c = checkToken(tok, { digest, anchors });
      let mine = false;
      if (c.ok && !c.trusted && privateAdded.length && checkToken(tok, { digest, anchors: privateAdded }).trusted) {
        mine = true;
        c.problems = ['its root was added by the writer and isn’t in a public list'];
      }
      s.stamps.push({ tsa: tm[2], file: t, ok: c.ok, trusted: c.trusted, added: mine, genTime: c.genTime, name: c.tsa, problems: c.problems });
      if (!c.ok) bad(tm[2] + '’s stamp: ' + c.problems.join('; '));
      else if (!c.trusted) s.problems.push(tm[2] + '’s stamp: ' + c.problems.join('; '));
      else {
        if (c.genTime < s.at - 5 * 60000) bad(tm[2] + ' stamped it before it says it was made');
        s.by = s.by === null ? c.genTime : Math.min(s.by, c.genTime);
      }
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

// The time cover of one device's sessions: when each was first timestamped
// in part (a seal over the session while it was open) and when as a whole
// (a seal naming its last `h`), from the seals verifyDevice checked.
// Sessions are { id, open, last (its last h), from, to }. A closed session
// with no whole stamp, or one stamped more than a day after it ended, is a
// gap: [{ session, from, to, firstStamped, wholeBy, gap: 'never' | 'late' }]
const DAY_MS = 24 * 3600 * 1000;
function timeCover(sessions, seals) {
  const bySession = new Map();
  for (const s of seals) {
    const when = s.by !== null ? s.by : s.byLater || null;
    for (const [id, h] of Object.entries(s.heads || {})) {
      const was = bySession.get(id) || { first: null, whole: null };
      if (was.first === null && when) was.first = when;
      if (was.whole === null && s.ok && when && h === (sessions.find((x) => x.id === id) || {}).last) was.whole = when;
      bySession.set(id, was);
    }
  }
  return sessions.map((s) => {
    const b = bySession.get(s.id) || { first: null, whole: null };
    const c = { session: s.id, from: s.from, to: s.to, firstStamped: b.first, wholeBy: b.whole };
    if (!b.whole && !s.open) c.gap = 'never';
    else if (b.whole && s.to !== null && b.whole - s.to > DAY_MS) c.gap = 'late';
    return c;
  });
}

module.exports = {
  TSAS, DRAND, STAMPS_WANTED, ROOT_FILE, timeCover,
  der, kids, oidOf, tsaRequest, checkToken, roots, mozilla, isPublic, pemOf, certsIn, rootFileName,
  findRoot, tryService, serviceId,
  newKey, keyOf, canonical, sign, verifySignature,
  drandRound, roundTime, chainHashes,
  Sealer, verifyDevice, sha256hex
};
