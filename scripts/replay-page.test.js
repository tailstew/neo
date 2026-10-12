'use strict';
// Export replay… (docs/neo-recording-plan.md, part 2, Sharing): the page
// replay-export.js builds, and the checks replay-page.js runs in it, over
// the proof fixture (a recording sealed twice and stamped by DigiCert and
// Sectigo for real). The page's checks run here in Node, which has the
// same WebCrypto and DecompressionStream a browser has: npm test.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { test } = require('node:test');
const R = require('../recording.js');
const P = require('../proof.js');
const Page = require('../replay-page.js');
const Export = require('../replay-export.js');
const { handle } = require('../history-worker.js');

const ROOT = path.join(__dirname, '..');
const FIX = path.join(__dirname, 'fixtures', 'proof');
const DEV = 'd-0123456789abcdef';
const SEALS = path.join(FIX, 'recording', DEV, 'seals');

const ask = (msg) => handle({ key: 'fixture-' + Math.random(), root: path.join(FIX, 'recording'), cache: fs.mkdtempSync(path.join(os.tmpdir(), 'neo-replay-')), ...msg }, () => {});
const dataOf = (html) => JSON.parse(/<script type="application\/json" id="rx-data">([^]*?)<\/script>/.exec(html)[1]);

test('every word the page shows is in app.js’s list, so it goes out in the writer’s language', () => {
  const app = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  const list = /const REPLAY_PAGE_WORDS = \[([^]*?)\n\];/.exec(app)[1];
  const listed = new Set([...list.matchAll(/tk\('((?:[^'\\\n]|\\.)*)'\)/g)].map((m) => m[1]));
  const page = fs.readFileSync(path.join(ROOT, 'replay-page.js'), 'utf8') + fs.readFileSync(path.join(ROOT, 'replay-export.js'), 'utf8');
  const used = [...page.matchAll(/(?<![\w$.])T\(\s*'((?:[^'\\\n]|\\.)*)'/g)].map((m) => m[1]);
  assert.ok(used.length > 40);
  for (const s of used) assert.ok(listed.has(s), 'not in REPLAY_PAGE_WORDS: ' + s);
});

test('the whole book’s page holds every session and its seals, and checks them all', async () => {
  const r = await ask({ type: 'evidence', texts: true });
  assert.equal(r.texts.length, 3);
  assert.equal(r.cover.length, 1);
  assert.equal(r.cover[0].seals, 2);
  assert.deepEqual(r.cover[0].stamps.sort(), ['DigiCert', 'Sectigo']);
  const html = Export.build({
    title: 'The </script> Book', author: 'A. Writer', strings: { 'Play': 'Lire' }, report: '<p>report</p>', evidence: r.evidence,
    sessions: r.texts, seals: { [DEV]: Export.sealFiles(SEALS) }, chapters: [{ id: 'ch-a', title: 'One' }], version: '9.9.9'
  });
  // one script per source, each carrying the nonce the policy names; the title can't end one
  const nonce = /script-src 'nonce-([^']+)'/.exec(html)[1];
  assert.equal((html.match(/<script nonce="/g) || []).length, 2);
  assert.equal((html.match(new RegExp(`<script nonce="${nonce.replace(/[+/=]/g, '\\$&')}">`, 'g')) || []).length, 2);
  assert.ok(!/unsafe-inline'[^"]*script|script-src[^;"]*unsafe/.test(html));
  assert.equal(html.split('</script>').length - 1, 3);
  assert.ok(html.includes('The &lt;/script&gt; Book'));
  const data = dataOf(html);
  assert.equal(data.partial, false);
  assert.equal(data.strings.Play, 'Lire');
  assert.ok(data.roots.includes('BEGIN CERTIFICATE'));
  const sessions = await Page.loadSessions(data);
  assert.deepEqual(sessions.map((s) => s.text), r.texts.map((s) => s.text));
  // chains, replay, the figures
  const chains = Page.checkChains(sessions, false)[DEV];
  assert.deepEqual(chains, { sessions: 3, whole: 3, broken: [], unchained: [] });
  const rp = (await Page.checkReplay(sessions))[DEV];
  assert.ok(rp.writes > 0);
  assert.equal(rp.bad + rp.problems, 0);
  assert.equal(Page.checkEvidence(sessions, data.evidence), true);
  // the seals: signatures, chain, heads, covered stamps, drand, and each token stamps its seal
  const heads = new Map(sessions.map((s) => [s.id, Page.heads(s.text)]));
  for (const [id, hs] of heads) assert.deepEqual([...hs].sort(), [...P.chainHashes(sessions.find((s) => s.id === id).text)].sort());
  const sealed = await Page.checkSeals(data.seals[DEV], heads);
  assert.equal(sealed.ed25519, true);
  assert.equal(sealed.seals.length, 2);
  for (const s of sealed.seals) {
    assert.equal(s.ok, true, s.problems.join('; '));
    assert.equal(s.stamps.length, 2);
    assert.ok(s.after !== null && s.after <= s.at);
    // the time each token says, as proof.js's DER reader reads it
    for (const st of s.stamps) {
      assert.equal(st.stamped, true);
      const digest = crypto.createHash('sha256').update(fs.readFileSync(path.join(SEALS, String(s.seq).padStart(6, '0') + '.json'))).digest();
      assert.equal(st.at, P.checkToken(fs.readFileSync(path.join(SEALS, st.file)), { digest }).genTime);
    }
  }
});

test('the page’s seal check catches a changed seal, a swapped token, and a session that isn’t what was sealed', async () => {
  const files = Export.sealFiles(SEALS);
  const r = await ask({ type: 'evidence', texts: true });
  const heads = new Map(r.texts.map((s) => [s.id, Page.heads(s.text)]));
  // a byte of the first seal changed: its signature fails, and the next no longer names it
  const changed = files.map((f) => {
    if (f.name !== '000001.json') return f;
    const b = Buffer.from(f.b64, 'base64').toString('utf8').replace('"seq": 1', '"seq":  1');
    return { name: f.name, b64: Buffer.from(b).toString('base64') };
  });
  let v = await Page.checkSeals(changed, heads);
  assert.equal(v.seals[1].ok, false);
  assert.ok(v.seals[1].problems.some((p) => /name the seal before/.test(p)));
  assert.ok(v.seals[0].problems.some((p) => /stamps something else/.test(p)));
  // seal 2's tokens swapped for seal 1's
  const swapped = files.map((f) => (/^000002\.(digicert|sectigo)\.tsr$/.test(f.name) ? { name: f.name, b64: files.find((x) => x.name === f.name.replace('000002', '000001')).b64 } : f));
  v = await Page.checkSeals(swapped, heads);
  assert.equal(v.seals[0].ok, true);
  assert.equal(v.seals[1].ok, false);
  // a session with a line changed: the heads it held aren't there
  const other = new Map([...heads].map(([id, hs]) => [id, new Set([...hs].map((h) => h.slice(1) + 'x'))]));
  v = await Page.checkSeals(files, other);
  assert.ok(v.seals.every((s) => !s.ok && s.problems.some((p) => /isn’t what it sealed/.test(p))));
});

test('a page of some chapters holds only their lines, no seals, and still replays exactly', async () => {
  const whole = await ask({ type: 'evidence', texts: true });
  const chs = Object.keys(whole.evidence.words);
  assert.ok(chs.length >= 1);
  const pick = [chs[0]];
  const r = await ask({ type: 'evidence', texts: true, chapters: pick });
  const html = Export.build({ title: 'B', evidence: r.evidence, sessions: r.texts, seals: { [DEV]: Export.sealFiles(SEALS) }, partial: true });
  const data = dataOf(html);
  assert.equal(data.partial, true);
  assert.equal(data.seals, null);
  assert.equal(data.roots, null);
  const sessions = await Page.loadSessions(data);
  for (const s of sessions) {
    assert.deepEqual(s.header.kept, pick);
    assert.ok(!/"h"/.test(s.text));
  }
  assert.deepEqual(Page.checkChains(sessions, true)[DEV], { sessions: 3, whole: 0, broken: [], unchained: [] });
  const rp = (await Page.checkReplay(sessions))[DEV];
  assert.equal(rp.bad + rp.problems, 0);
  assert.equal(Page.checkEvidence(sessions, data.evidence), true);
  assert.equal(R.replayCheck(sessions.map((s) => s.text)).chapters[pick[0]], R.replayCheck(whole.texts.filter((s) => s.device === DEV).map((s) => s.text)).chapters[pick[0]]);
});

test('the page plays each day from the end of the day before, to where the recording ends', async () => {
  const r = await ask({ type: 'evidence', texts: true });
  const data = dataOf(Export.build({ title: 'B', evidence: r.evidence, sessions: r.texts }));
  const sessions = await Page.loadSessions(data);
  const book = new Page.Book(sessions);
  assert.equal(book.days.length, 3);
  const end = R.replayCheck(sessions.map((s) => s.text)).chapters;
  const h = await book.day(book.days.length - 1);
  const last = h.state(h.steps.length);
  for (const [ch, html] of Object.entries(end)) if (!R.isStream(ch)) assert.equal(last[ch], html, ch);
  // each day starts where the one before ended
  for (let k = 1; k < book.days.length; k++) {
    const before = await book.day(k - 1);
    const start = (await book.day(k)).state(0);
    const ended = before.state(before.steps.length);
    for (const ch of Object.keys(ended)) if (!R.isStream(ch)) assert.equal(start[ch], ended[ch], `day ${k}, ${ch}`);
  }
});

test('a token’s time is its TSTInfo’s genTime', () => {
  const tok = fs.readFileSync(path.join(SEALS, '000001.sectigo.tsr'));
  const digest = crypto.createHash('sha256').update(fs.readFileSync(path.join(SEALS, '000001.json'))).digest();
  assert.equal(Page.genTime(new Uint8Array(tok)), P.checkToken(tok, { digest }).genTime);
  assert.equal(Page.genTime(new Uint8Array([1, 2, 3])), null);
  assert.equal(Page.canonical({ b: 1, a: [2, { d: undefined, c: 'x' }] }), P.canonical({ b: 1, a: [2, { d: undefined, c: 'x' }] }));
});
