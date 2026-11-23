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

test('every word the page shows is in app/history.js’s list, so it goes out in the writer’s language', () => {
  const app = require('./app-files').appSource();
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
  assert.equal((html.match(/<script nonce="/g) || []).length, 3);
  assert.equal((html.match(new RegExp(`<script nonce="${nonce.replace(/[+/=]/g, '\\$&')}">`, 'g')) || []).length, 3);
  assert.ok(!/unsafe-inline'[^"]*script|script-src[^;"]*unsafe/.test(html));
  assert.equal(html.split('</script>').length - 1, 4);
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

test('a page of some chapters checks the seals over their own lines, and places its timestamps by them', async () => {
  const { verifyBook } = require('./verify-recording.js');
  const book = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-chapters-'));
  const root = path.join(book, 'recording');
  fs.cpSync(path.join(FIX, 'recording'), root, { recursive: true });
  // sealed again by a NEO whose seals hold chapters
  fs.rmSync(path.join(root, DEV, 'seals'), { recursive: true });
  const round = { round: 33000000, signature: 'ab'.repeat(48) };
  round.randomness = crypto.createHash('sha256').update(Buffer.from(round.signature, 'hex')).digest('hex');
  const seal = await new P.Sealer({
    dir: path.join(root, DEV), book: 'book-x', device: DEV, key: P.keyOf(P.newKey()), now: () => new Date('2026-11-01T10:00:00Z'),
    fetch: async () => ({ ok: true, status: 200, json: async () => round }), tsas: [],
    write: (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); }
  }).seal();
  assert.ok(Object.keys(seal.chapters[DEV]).length);
  const v = await verifyBook(book);
  assert.equal(v.ok, true, JSON.stringify(v.devices.map((d) => d.problems)));

  const opts = { root, cache: fs.mkdtempSync(path.join(os.tmpdir(), 'neo-replay-')) };
  const whole = await handle({ ...opts, key: 'ch-' + Math.random(), type: 'evidence', texts: true }, () => {});
  const pick = [Object.keys(whole.evidence.words)[0]];
  const r = await handle({ ...opts, key: 'ch-' + Math.random(), type: 'evidence', texts: true, chapters: pick }, () => {});
  const html = Export.build({ title: 'B', evidence: r.evidence, sessions: r.texts, seals: { [DEV]: Export.sealFiles(path.join(root, DEV, 'seals')) }, partial: true, kept: pick });
  assert.ok(!html.includes('its timestamps can’t be verified'));
  const data = dataOf(html);
  assert.equal(data.seals[DEV].length, 1);
  assert.ok(data.roots.includes('BEGIN CERTIFICATE'));
  const sessions = await Page.loadSessions(data);
  const res = await Page.runChecks({ sessions, partial: true, seals: data.seals, evidence: data.evidence });
  const checked = res.seals[DEV].seals[0];
  assert.equal(checked.ok, true, checked.problems.join('; '));
  assert.ok(checked.kept >= 1);
  // its fingerprint is the seal file's, as verify-recording shows it; the
  // seals also cover the book's other chapters, as hashes
  const sealFile = fs.readFileSync(path.join(root, DEV, 'seals', '000001.json'));
  assert.equal(checked.fingerprint, crypto.createHash('sha256').update(sealFile).digest('hex'));
  assert.equal(v.devices[0].seals.seals[0].fingerprint, checked.fingerprint);
  const others = new Set(Object.values(seal.chapters[DEV]).flatMap((chs) => Object.keys(chs)).filter((ch) => ch !== pick[0]));
  assert.equal(res.otherChapters, others.size);
  assert.ok(!sessions.some((s) => /"tag"/.test(s.text)));
  // the timestamps fall on the last line of the chapter each seal reached
  checked.by = Date.parse('2026-11-01T10:00:05Z');
  const map = Page.stampsOf(sessions, res.seals);
  const chains = Page.chapterChains(sessions, false);
  const placed = Object.entries(map).filter(([, list]) => list.length);
  assert.ok(placed.length >= 1);
  for (const [k, list] of placed) {
    for (const e of list) {
      assert.equal(e.ch, pick[0]);
      assert.equal(e.by, checked.by);
      assert.equal(e.n, chains[k][pick[0]].nos[seal.chapters[DEV][k.split('/')[1]][pick[0]][0] - 1]);
    }
  }

  // a moment of the chapter moved: the seal no longer holds it
  const at = sessions.findIndex((s) => R.chapterLines(R.parseSession(s.text).lines).some((c) => c && c.ch === pick[0] && !/^\[null/.test(c.text)));
  const lines = R.splitLines(sessions[at].text).lines;
  const per = R.chapterLines(R.parseSession(sessions[at].text).lines);
  const i = per.findIndex((c) => c && c.ch === pick[0] && !/^\[null/.test(c.text)) + 1;
  lines[i] = lines[i].replace(/^\[(\d+)/, (m, d) => '[' + (+d + 1));
  const moved = sessions.map((s, j) => (j === at ? { ...s, text: lines.map((l) => l + '\n').join('') } : s));
  const bad = await Page.runChecks({ sessions: moved, partial: true, seals: data.seals, evidence: null });
  assert.equal(bad.seals[DEV].seals[0].ok, false);
  assert.ok(bad.seals[DEV].seals[0].problems.includes('a chapter it seals isn’t what it sealed'));
});

test('a page of some chapters holds only their lines, no seals made before seals held chapters, and still replays exactly', async () => {
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

test('a page of some chapters shows only the days and tags where they changed, and still plays from where they were', async () => {
  const DEVICE = 'd-1';
  const html = { a: '<p>A.</p>', b: '<p>B.</p>' };
  let tagN = 0;
  const day = (date, steps) => {
    const id = date + 'T09-00-00Z-aaaa';
    const w = new R.SessionWriter({ neoRec: 1, session: id, device: DEVICE, book: 'b', day: date, startedAt: date + 'T09:00:00.000Z', tz: 'UTC', prev: null });
    const seen = new Set();
    let cur = null;
    for (const st of steps) {
      if (st.tag) { w.push([1000, 'tag', 't' + (++tagN), null, null, { snapshot: 'snap-' + tagN }]); continue; }
      const ch = st.type;
      if (!seen.has(ch)) { w.push([0, 'b', ch, html[ch], R.digest(html[ch]), date === '2026-10-01' ? 'baseline' : 'continue'].map((v, i) => (i === 3 && date !== '2026-10-01' ? null : v))); seen.add(ch); cur = ch; } else if (cur !== ch) { w.push([0, 'ch', ch]); cur = ch; }
      const at = html[ch].length - 4;
      w.push([1000, 'e', at, 0, 'x', 'iT']);
      html[ch] = R.applyEdit(html[ch], at, 0, 'x');
    }
    for (const ch of seen) w.push([0, 'w', R.digest(html[ch]), ch]);
    return { id, device: DEVICE, text: w.chunk().text };
  };
  const whole = [
    day('2026-10-01', [{ type: 'a' }, { type: 'b' }, { tag: 1 }]),
    day('2026-10-02', [{ type: 'b' }, { tag: 1 }]),        // only b: nothing of a to see
    day('2026-10-03', [{ tag: 1 }, { type: 'a' }, { tag: 1 }]) // a snapshot before a changed, then one after
  ];
  const sessions = whole.map((s) => {
    const text = R.keepChapters(s.text, ['a']);
    const header = R.parseSession(text).header;
    return { ...s, text, header, day: R.sessionDay(header) };
  });
  const book = new Page.Book(sessions, true);
  assert.deepEqual(book.all.map((d) => d.day), ['2026-10-01', '2026-10-02', '2026-10-03']);
  assert.deepEqual(book.days.map((d) => d.day), ['2026-10-01', '2026-10-03']);
  // the last day shown starts where the first ended, and ends as the chapter did
  const first = await book.day(0);
  const last = await book.day(1);
  assert.equal(last.state(0).a, first.state(first.steps.length).a);
  assert.equal(last.state(last.steps.length).a, html.a);
  // an export of some chapters carries no tags: a writer's names for
  // moments aren't for sharing a chapter in public
  assert.deepEqual(Page.tagsIn(sessions), []);
  assert.ok(sessions.every((s) => !/"tag"/.test(s.text)));
  // where tags are there, only those with a change since the last: day 1's,
  // and day 3's after a changed; not day 2's, nor day 3's first, which is
  // the same text as day 1's
  const withDays = whole.map((s) => ({ ...s, day: R.sessionDay(R.parseSession(s.text).header) }));
  const tags = Page.tagsIn(withDays);
  assert.equal(tags.length, 4);
  const shown = Page.tagsShown(tags, book);
  assert.deepEqual(shown.map((t) => t.id), ['t1', 't4']);
  // the whole book's page shows every day and every tag
  const all = new Page.Book(withDays);
  assert.equal(all.days.length, 3);
  assert.equal(Page.tagsShown(tags, all).length, 4);
});

test('History’s days: a chapter picked shows only the days it was written on, and the whole book leaves out days with nothing written, in NEO and the page alike', () => {
  const DEVICE = 'd-1';
  const html = { a: '<p>A.</p>', b: '<p>B.</p>' };
  const day = (date, chs) => {
    const id = date + 'T09-00-00Z-aaaa';
    const w = new R.SessionWriter({ neoRec: 1, session: id, device: DEVICE, book: 'b', day: date, startedAt: date + 'T09:00:00.000Z', tz: 'UTC', prev: null });
    for (const ch of chs) {
      w.push([0, 'b', ch, html[ch], R.digest(html[ch]), 'baseline']);
      const at = html[ch].length - 4;
      w.push([1000, 'e', at, 0, 'x', 'iT']);
      html[ch] = R.applyEdit(html[ch], at, 0, 'x');
      w.push([0, 'w', R.digest(html[ch]), ch]);
    }
    return w.chunk().text;
  };
  // a day with nothing written: NEO open, the window focused, and another
  // device's words taken in from disk, as on a day after a sync
  const quiet = (date) => {
    const id = date + 'T09-00-00Z-bbbb';
    const w = new R.SessionWriter({ neoRec: 1, session: id, device: DEVICE, book: 'b', day: date, startedAt: date + 'T09:00:00.000Z', tz: 'UTC', prev: null });
    w.push([0, 'f', 'visible']);
    w.push([10, 'b', 'b', null, R.digest(html.b), 'continue']);
    w.push([1, 'x', 'disk-adopt']);
    const at = html.b.length - 4;
    w.push([0, 'e', at, 0, 'y']);
    html.b = R.applyEdit(html.b, at, 0, 'y');
    w.push([0, 'w', R.digest(html.b), 'b']);
    return w.chunk().text;
  };
  const texts = [day('2026-10-01', ['a', 'b']), day('2026-10-02', ['b']), quiet('2026-10-03'), day('2026-10-04', ['a']), quiet('2026-10-05')];
  const pg = new R.Page();
  const stats = texts.map((text) => [R.playSession(text, null, { page: pg, device: DEVICE })]);
  assert.equal(R.dayShows(stats[2]), false, 'nothing written on the 3rd');
  assert.equal(R.dayShows(stats[1]), true);
  // the whole book: the days with something to see, and the last, which ends as the book is
  assert.deepEqual(Page.daysFor(stats, ''), [0, 1, 3, 4]);
  assert.deepEqual(Page.daysFor(stats, 'a'), [0, 3]);
  assert.deepEqual(Page.daysFor(stats, 'b'), [0, 1]);
  // a day not worked out yet is shown until it is
  assert.deepEqual(Page.daysFor([stats[0], null, stats[2], stats[3], stats[4]], 'b'), [0, 1]);
  assert.deepEqual(Page.daysFor([stats[0], stats[1], null, stats[3], stats[4]], ''), [0, 1, 2, 3, 4]);
  // a chapter written on no day: every day, as NEO goes back to the whole book
  assert.deepEqual(Page.daysFor(stats, 'gone'), [0, 1, 2, 3, 4]);
  // a tag is something to see
  assert.equal(R.dayShows([{ chapters: {}, lost: [], tags: [{ id: 't' }] }]), true);
});

test('a token’s time is its TSTInfo’s genTime', () => {
  const tok = fs.readFileSync(path.join(SEALS, '000001.sectigo.tsr'));
  const digest = crypto.createHash('sha256').update(fs.readFileSync(path.join(SEALS, '000001.json'))).digest();
  assert.equal(Page.genTime(new Uint8Array(tok)), P.checkToken(tok, { digest }).genTime);
  assert.equal(Page.genTime(new Uint8Array([1, 2, 3])), null);
  assert.equal(Page.canonical({ b: 1, a: [2, { d: undefined, c: 'x' }] }), P.canonical({ b: 1, a: [2, { d: undefined, c: 'x' }] }));
});

test('the page places each timestamp where NEO’s own player does, and finds the tags', async () => {
  const r = await ask({ type: 'evidence', texts: true });
  const data = dataOf(Export.build({ title: 'B', evidence: r.evidence, sessions: r.texts, seals: { [DEV]: Export.sealFiles(SEALS) } }));
  const sessions = await Page.loadSessions(data);
  const heads = new Map(sessions.map((s) => [s.id, Page.heads(s.text)]));
  const page = Page.stampsOf(sessions, { [DEV]: await Page.checkSeals(data.seals[DEV], heads) });
  const neo = await ask({ type: 'stamps', sessions: r.texts.map((s) => ({ id: s.id, device: s.device, open: s.open })) });
  assert.deepEqual(page, neo);
  assert.ok(Object.values(neo).every((list) => list.length && list.every((e) => e.n > 1 && e.by > 0)));
  assert.equal(Page.stampsOf(sessions, {}), null);
  // the tags, as the stats NEO keeps of each session list them
  const stats = sessions.map((x) => ({ id: x.id, device: x.device, day: x.day, stats: R.playSession(x.text, {}) }));
  const tags = Page.tagsIn(sessions);
  assert.ok(tags.length >= 1);
  assert.deepEqual(tags.map((t) => [t.id, t.label, t.at, t.day]), R.tagsOf(stats).map((t) => [t.id, t.label, t.at, t.day]));
});

test('the page’s tags carry a tag’s note, as NEO’s own do', () => {
  const w = new R.SessionWriter({ neoRec: 1, session: 's-note', device: 'd-1', book: 'book-x', startedAt: '2026-10-08T09:00:00.000Z', prev: null });
  const html = '<p>Rain.</p>';
  w.push([0, 'b', 'c1', html, R.digest(html), 'baseline']);
  w.push([100, 'tag', 't1', 'Draft 2', null, null, 'A note\nover two lines']);
  w.push([100, 'tag', 't2', 'Plain', null]);
  w.push([100, 'w', R.digest(html)]);
  const sessions = [{ id: 's-note', device: 'd-1', day: '2026-10-08', text: w.chunk().text }];
  const tags = Page.tagsIn(sessions);
  assert.deepEqual(tags.map((x) => [x.id, x.note]), [['t1', 'A note\nover two lines'], ['t2', null]]);
  const stats = sessions.map((x) => ({ id: x.id, device: x.device, day: x.day, stats: R.playSession(x.text, {}) }));
  assert.deepEqual(tags.map((x) => x.note), R.tagsOf(stats).map((x) => x.note));
});

test('a phone’s sessions sealed by a computer: NEO, the page and verify-recording all count them covered', async () => {
  const { verifyBook } = require('./verify-recording.js');
  const PHONE = 'd-00000000000000aa';
  const LAPTOP = 'd-00000000000000bb';
  const book = fs.mkdtempSync(path.join(os.tmpdir(), 'neo-phone-'));
  const root = path.join(book, 'recording');
  fs.cpSync(path.join(FIX, 'recording'), root, { recursive: true });
  // the phone wrote what the fixture's computer wrote, and seals nothing
  fs.mkdirSync(path.join(root, PHONE));
  for (const f of fs.readdirSync(path.join(root, DEV))) if (f.endsWith('.jsonl.gz')) fs.copyFileSync(path.join(root, DEV, f), path.join(root, PHONE, f));
  // a laptop with nothing of its own seals the phone's (and not the fixture
  // computer's, which seals its own); no stamps, so nothing is fixed by them
  const round = { round: 33000000, signature: 'ab'.repeat(48) };
  round.randomness = crypto.createHash('sha256').update(Buffer.from(round.signature, 'hex')).digest('hex');
  const sealer = new P.Sealer({
    dir: path.join(root, LAPTOP), book: 'book-x', device: LAPTOP, key: P.keyOf(P.newKey()), now: () => new Date('2026-11-01T10:00:00Z'), settle: 0,
    fetch: async () => ({ ok: true, status: 200, json: async () => round }), tsas: [],
    write: (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, data); }
  });
  const seal = await sealer.seal({ ifOthers: true });
  assert.deepEqual(Object.keys(seal.others), [PHONE]);
  assert.deepEqual(seal.heads, {});

  const opts = { key: 'phone-' + Math.random(), root, cache: fs.mkdtempSync(path.join(os.tmpdir(), 'neo-replay-')) };
  const r = await handle({ ...opts, type: 'evidence', texts: true }, () => {});
  const phone = r.cover.find((d) => d.device === PHONE);
  assert.equal(phone.seals, 0);
  assert.equal(phone.cover.length, 3);
  assert.equal(r.cover.find((d) => d.device === LAPTOP).bad, 0);
  // the page's checks agree, and its timestamps' track is NEO's
  const seals = { [DEV]: Export.sealFiles(path.join(root, DEV, 'seals')), [LAPTOP]: Export.sealFiles(path.join(root, LAPTOP, 'seals')) };
  const data = dataOf(Export.build({ title: 'B', evidence: r.evidence, sessions: r.texts, seals }));
  const sessions = await Page.loadSessions(data);
  const res = await Page.runChecks({ sessions, partial: false, seals: data.seals, evidence: data.evidence });
  for (const d of [DEV, LAPTOP]) assert.ok(res.seals[d].seals.every((s) => s.ok), d + ': ' + res.seals[d].seals.flatMap((s) => s.problems).join('; '));
  const neo = await handle({ ...opts, type: 'stamps', sessions: r.texts.map((s) => ({ id: s.id, device: s.device, open: s.open })) }, () => {});
  assert.deepEqual(Page.stampsOf(sessions, res.seals), neo);
  assert.ok(Object.keys(neo).filter((k) => k.startsWith(PHONE + '/')).every((k) => neo[k].length === 1));
  // verify-recording: the phone sealed by the laptop
  const v = await verifyBook(book);
  assert.equal(v.ok, true, JSON.stringify(v.devices.map((d) => d.problems)));
  assert.deepEqual(v.devices.find((d) => d.device === PHONE).sealedBy, [LAPTOP]);
  // the book's time cover, what each puts first: the same figures in all three
  const fromNeo = R.coverSummary(r.cover.flatMap((d) => d.cover));
  assert.deepEqual(res.cover, fromNeo, 'the page and How It Was Written…');
  assert.deepEqual(v.cover, fromNeo, 'verify-recording and How It Was Written…');
  assert.ok(fromNeo.sessions > 0);
  // a phone session changed after it was sealed: the laptop's seal fails
  const zlib = require('node:zlib');
  const first = fs.readdirSync(path.join(root, PHONE)).sort()[0];
  const text = zlib.gunzipSync(fs.readFileSync(path.join(root, PHONE, first))).toString();
  fs.writeFileSync(path.join(root, PHONE, first), zlib.gzipSync(text.replace(/"h",(\d+),"./, '"h",$1,"~')));
  const bad = await verifyBook(book, { mirror: path.join(book, 'no-mirror') });
  assert.ok(bad.devices.find((d) => d.device === LAPTOP).problems.some((p) => p.includes('of ' + PHONE)));
});
