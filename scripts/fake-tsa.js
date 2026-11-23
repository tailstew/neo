// A timestamp authority for the tests, on 127.0.0.1: it answers an RFC 3161
// TimeStampReq with a real token (CMS SignedData over a TSTInfo, ECDSA
// P-256), under certificates it makes as it loads (`makeSet`): a root and a
// timestamping certificate it issues, with keys that live only in this
// process, so nothing secret is ever written down or committed.
// NEO checks its tokens exactly as it checks DigiCert's: with its root among
// the anchors (`trust`) they're trusted, without it they're good but not
// trusted, as a service the writer added is.
//
//   const tsa = await require('./fake-tsa.js').start();
//   tsa.url, tsa.mode = 'up' | 'down' | 'refuse', tsa.delay = ms, tsa.asked
//   tsa.rootPem, tsa.trust(require('../proof.js')), tsa.stop()
//   require('./fake-tsa.js').start({ certs: 'added' }): a root nobody trusts

'use strict';

const crypto = require('crypto');
const http = require('http');

/* ---------- DER ---------- */

function tlv(id, body) {
  const l = body.length;
  const len = l < 0x80 ? [l] : l < 0x100 ? [0x81, l] : l < 0x10000 ? [0x82, l >> 8, l & 0xff] : [0x83, l >> 16, (l >> 8) & 0xff, l & 0xff];
  return Buffer.concat([Buffer.from([id, ...len]), body]);
}
const seq = (...xs) => tlv(0x30, Buffer.concat(xs));
const set = (...xs) => tlv(0x31, Buffer.concat(xs));
const octets = (b) => tlv(0x04, b);
const int = (b) => tlv(0x02, b[0] & 0x80 ? Buffer.concat([Buffer.from([0]), b]) : b);
function oid(s) {
  const p = s.split('.').map(Number);
  const out = [p[0] * 40 + p[1]];
  for (const n of p.slice(2)) {
    const b = [n & 0x7f];
    for (let v = Math.floor(n / 128); v; v = Math.floor(v / 128)) b.unshift((v & 0x7f) | 0x80);
    out.push(...b);
  }
  return tlv(0x06, Buffer.from(out));
}
function node(buf, pos = 0) {
  let len = buf[pos + 1];
  let body = pos + 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + buf[body++];
  }
  return { id: buf[pos], start: pos, body, end: body + len };
}
function kids(buf, n) {
  const out = [];
  for (let p = n.body; p < n.end;) { const k = node(buf, p); out.push(k); p = k.end; }
  return out;
}
const whole = (buf, n) => buf.subarray(n.start, n.end);
const gentime = (ms) => tlv(0x18, Buffer.from(new Date(ms).toISOString().replace(/[-:T]/g, '').replace(/\.\d+Z$/, 'Z')));

/* ---------- certificates ---------- */

const ECDSA_SHA256 = seq(oid('1.2.840.10045.4.3.2'));
const bits = (b, unused = 0) => tlv(0x03, Buffer.concat([Buffer.from([unused]), b]));
const name = (cn) => seq(set(seq(oid('2.5.4.3'), tlv(0x0c, Buffer.from(cn, 'utf8')))));
// UTCTime before 2050, GeneralizedTime from then on (RFC 5280)
const certTime = (ms) => {
  const iso = new Date(ms).toISOString().replace(/[-:T]/g, '').replace(/\.\d+Z$/, 'Z');
  return new Date(ms).getUTCFullYear() < 2050 ? tlv(0x17, Buffer.from(iso.slice(2))) : tlv(0x18, Buffer.from(iso));
};
const ext = (id, value) => seq(oid(id), Buffer.from([0x01, 0x01, 0xff]), octets(value)); // each one critical
// valid from 2000 to 2100: any moment a test moves the clock to is inside
const FROM = Date.UTC(2000, 0, 1);
const TO = Date.UTC(2100, 0, 1);

// An X.509 v3 certificate for `key`'s public half, signed by `signer`
function certificate({ subject, issuer, key, signer, ca }) {
  const spki = crypto.createPublicKey(key).export({ type: 'spki', format: 'der' });
  const exts = ca
    ? [ext('2.5.29.19', seq(Buffer.from([0x01, 0x01, 0xff]))), ext('2.5.29.15', bits(Buffer.from([0x06]), 1))] // CA; keyCertSign, cRLSign
    : [ext('2.5.29.19', seq()), ext('2.5.29.15', bits(Buffer.from([0x80]), 7)), ext('2.5.29.37', seq(oid('1.3.6.1.5.5.7.3.8')))]; // digitalSignature; timeStamping
  const tbs = seq(
    tlv(0xa0, int(Buffer.from([2]))), int(Buffer.concat([Buffer.from([0x01]), crypto.randomBytes(8)])), ECDSA_SHA256,
    name(issuer), seq(certTime(FROM), certTime(TO)), name(subject), spki, tlv(0xa3, seq(...exts))
  );
  return new crypto.X509Certificate(seq(tbs, ECDSA_SHA256, bits(crypto.sign('sha256', tbs, signer))));
}

// A root, and the timestamping certificate it issues, with their keys
function makeSet(label) {
  const ec = () => crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey;
  const rootKey = ec();
  const key = ec();
  const rootName = `NEO ${label} Root (tests only)`;
  const root = certificate({ subject: rootName, issuer: rootName, key: rootKey, signer: rootKey, ca: true });
  const cert = certificate({ subject: `NEO ${label} TSA (tests only)`, issuer: rootName, key, signer: rootKey, ca: false });
  // the signer named as its DER holds them: issuer, then serial
  const raw = cert.raw;
  const tbs = kids(raw, kids(raw, node(raw))[0]);
  return { root, rootPem: root.toString(), cert, key, sid: Buffer.concat([whole(raw, tbs[3]), whole(raw, tbs[1])]) };
}

// two sets: `test`, whose root e2e-neo.js trusts as NEO's own, and `added`,
// a root nobody trusts, for a service the writer adds
const SETS = { test: makeSet('Test'), added: makeSet('Test Added') };
const rootPem = SETS.test.rootPem;

const SHA256 = seq(oid('2.16.840.1.101.3.4.2.1'), Buffer.from([5, 0]));

let serial = 1;
// A TimeStampResp for a TimeStampReq, stamped at `at` (ms)
function reply(req, at = Date.now(), { key: tsaKey, cert: tsaCert, root: rootCert, sid } = SETS.test) {
  const r = kids(req, node(req));
  const imprint = whole(req, r[1]);
  const nonce = r.slice(2).find((k) => k.id === 0x02);
  const tst = seq(
    int(Buffer.from([1])), oid('1.3.6.1.4.1.99999.1'), imprint, int(Buffer.from([serial++ & 0x7f, crypto.randomBytes(1)[0]])), gentime(at),
    ...(nonce ? [whole(req, nonce)] : [])
  );
  const attrs = [
    seq(oid('1.2.840.113549.1.9.3'), set(oid('1.2.840.113549.1.9.16.1.4'))),
    seq(oid('1.2.840.113549.1.9.4'), set(octets(crypto.createHash('sha256').update(tst).digest()))),
    // ESS signingCertificateV2: the signer's certificate by its SHA-256
    seq(oid('1.2.840.113549.1.9.16.2.47'), set(seq(seq(seq(octets(crypto.createHash('sha256').update(tsaCert.raw).digest()))))))
  ];
  const signedAttrs = Buffer.concat(attrs);
  const signature = crypto.sign('sha256', tlv(0x31, signedAttrs), tsaKey);
  const signerInfo = seq(
    int(Buffer.from([1])), seq(sid), SHA256, tlv(0xa0, signedAttrs),
    seq(oid('1.2.840.10045.4.3.2')), octets(signature)
  );
  const signedData = seq(
    int(Buffer.from([3])), set(SHA256),
    seq(oid('1.2.840.113549.1.9.16.1.4'), tlv(0xa0, octets(tst))),
    tlv(0xa0, Buffer.concat([tsaCert.raw, rootCert.raw])),
    set(signerInfo)
  );
  const token = seq(oid('1.2.840.113549.1.7.2'), tlv(0xa0, signedData));
  return seq(seq(int(Buffer.from([0]))), token);
}

async function start({ certs = 'test' } = {}) {
  const pair = SETS[certs];
  const tsa = {
    mode: 'up', delay: 0, asked: 0, clock: () => Date.now(), rootPem: pair.rootPem, root: pair.root,
    // its root among a proof.js's anchors (the module's own list, which
    // checkToken and verifyDevice use when not told otherwise)
    trust(P) { if (!P.roots().some((c) => c.raw.equals(pair.root.raw))) P.roots().push(pair.root); }
  };
  const server = http.createServer((req, res) => {
    const parts = [];
    req.on('data', (d) => parts.push(d));
    req.on('end', async () => {
      tsa.asked++;
      if (tsa.delay) await new Promise((resolve) => setTimeout(resolve, tsa.delay));
      if (tsa.mode === 'down') { req.socket.destroy(); return; }
      if (tsa.mode === 'refuse') { res.writeHead(503); res.end(); return; }
      if (tsa.mode === 'html') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html>not a timestamp service</html>'); return; }
      try {
        const body = reply(Buffer.concat(parts), tsa.clock(), pair);
        res.writeHead(200, { 'Content-Type': 'application/timestamp-reply' });
        res.end(body);
      } catch {
        res.writeHead(400);
        res.end();
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  tsa.url = `http://127.0.0.1:${server.address().port}/tsr`;
  tsa.stop = () => new Promise((resolve) => server.close(resolve));
  return tsa;
}

module.exports = { start, reply, rootPem };
