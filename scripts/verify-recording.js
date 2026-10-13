#!/usr/bin/env node
'use strict';
// Checks a book's Writing History and its proof, for support and for anyone
// a writer shows their book to (docs/neo-recording-plan.md, part 2):
//
//   node scripts/verify-recording.js <book folder> [--online] [--json] [--mirror <dir>]
//
// For each device: every session's hash chain, and the sessions chained to
// each other; that replaying them hashes to every chapter write they record
// (replayCheck); each seal's signature, its place in the seals' chain, the
// sessions it seals, its stamps (RFC 3161 tokens checked against the roots
// in proof-roots.pem, and the roots of services the writer added that are
// in Mozilla's list) and its `after`; then the time cover: when each
// session was sealed, and every one that went more than a day unsealed.
// --online also asks drand for each seal's round and a block explorer for
// its Bitcoin blocks. A session the book lacks is read from the backup
// mirror (Backups/recordings/<book folder>, found beside the library, or
// --mirror). Exits 1 when anything fails.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const R = require('../recording.js');
const Files = require('../recording-files.js');
const P = require('../proof.js');

const iso = (ms) => (ms === null || ms === undefined ? '—' : new Date(ms).toISOString().replace('.000Z', 'Z'));

// A session's span: when it began, and its last wall-clock line (or the start)
function span(text) {
  const { header, lines } = R.parseSession(text);
  const from = header ? Date.parse(header.startedAt) : null;
  let to = from;
  for (const l of lines) if (Array.isArray(l) && l[1] === 'T') to = Math.max(to, Date.parse(l[2]));
  return { from, to };
}

async function verifyBook(bookDir, { online = false, mirror = null } = {}) {
  const root = path.join(bookDir, 'recording');
  if (!mirror) {
    const guess = path.join(path.dirname(bookDir), 'Backups', 'recordings', path.basename(bookDir));
    if (fs.existsSync(guess)) mirror = guess;
  }
  const io = Files.nodeIO({ fs, path, zlib, write: () => { throw new Error('read only'); }, log: () => {} });
  const report = { book: path.basename(bookDir), ok: true, devices: [] };
  for (const dev of await Files.list(io, root, null, mirror)) {
    const dir = path.join(root, dev.device);
    const d = { device: dev.device, name: dev.name, sessions: [], replay: null, seals: null, cover: [], problems: [] };
    report.devices.push(d);
    const texts = [];
    const hashes = new Map();
    let prevLast;
    for (const s of dev.sessions) {
      const r = await Files.read(io, dir, s.id, mirror && path.join(mirror, dev.device));
      if (!r || !r.text) { d.problems.push(`session ${s.id} can’t be read`); continue; }
      const v = R.verifyChain(r.text);
      const { header } = R.parseSession(r.text);
      const one = { id: s.id, open: r.open, lines: v.lines, chain: v.ok || (r.open && v.breaks.every((b) => b.reason === 'unsealed')), last: v.last, ...span(r.text) };
      if (!one.chain) d.problems.push(`session ${s.id}: its chain breaks at line ${v.breaks[0].line} (${v.breaks[0].reason})`);
      if (r.gaps.length || r.bad.length) d.problems.push(`session ${s.id}: lines missing or unreadable`);
      if (prevLast !== undefined && header && header.prev !== prevLast) one.unchained = true;
      prevLast = v.last;
      d.sessions.push(one);
      texts.push(r.text);
      hashes.set(s.id, P.chainHashes(r.text));
    }
    // a session whose `prev` isn't the last before it: one is missing between
    for (const s of d.sessions) if (s.unchained) d.problems.push(`session ${s.id} doesn’t follow the one before it: a session between them is missing`);
    const rc = R.replayCheck(texts);
    d.replay = { writes: rc.writes, bad: rc.bad.length, problems: rc.problems.length };
    if (rc.bad.length) d.problems.push(`${rc.bad.length} of ${rc.writes} chapter writes don’t replay to what was written`);
    if (rc.problems.length) d.problems.push(`${rc.problems.length} places the replay couldn’t follow (${[...new Set(rc.problems.map((p) => p.reason))].join(', ')})`);

    // seals
    const sealsDir = path.join(dir, 'seals');
    if (fs.existsSync(sealsDir)) {
      d.seals = await P.verifyDevice(dir, { sessions: hashes, online });
      for (const s of d.seals.seals) if (!s.ok) d.problems.push(`seal ${s.seq}: ${s.problems.join('; ')}`);
      // time cover: the first seal over each session's last line
      d.cover = P.timeCover(d.sessions, d.seals.seals).map((c) => (c.gap
        ? { ...c, gap: c.gap === 'never' ? 'never timestamped' : 'timestamped later, on ' + iso(c.wholeBy).slice(0, 10) } : c));
    }
    if (d.problems.length) report.ok = false;
  }
  return report;
}

function print(r) {
  const out = [];
  out.push(`${r.book}: ${r.ok ? 'everything checks' : 'PROBLEMS FOUND'}`);
  for (const d of r.devices) {
    out.push('', `Device ${d.device} (${d.name})`);
    out.push(`  ${d.sessions.length} sessions; chains ${d.sessions.every((s) => s.chain) ? 'whole' : 'broken'}; ${d.replay.writes} chapter writes replayed${d.replay.bad ? `, ${d.replay.bad} wrong` : ', all exact'}`);
    if (d.seals) {
      const ss = d.seals.seals;
      const stamped = ss.filter((s) => s.by !== null).length;
      out.push(`  ${ss.length} seals, signed by key ${d.seals.publicKey}; ${stamped} stamped, ${ss.filter((s) => s.by === null && s.byLater).length} fixed in time by a later seal`);
      for (const s of ss) {
        const who = s.stamps.filter((x) => x.ok).map((x) => `${x.tsa} ${iso(x.genTime)}${x.trusted ? '' : x.added ? ' (root added by the writer, in no public list)' : ' (untrusted)'}`).join(', ');
        out.push(`   ${String(s.seq).padStart(6, '0')} ${s.ok ? 'ok ' : 'BAD'} made ${iso(s.at)}; after ${iso(s.after)}; ${who || (s.byLater ? 'by ' + iso(s.byLater) + ' (a later seal)' : 'not stamped')}${s.ots ? `; Bitcoin ${s.ots.heights.join(', ') || 'pending'}` : ''}`);
      }
      const gaps = d.cover.filter((c) => c.gap);
      out.push(gaps.length ? `  Time cover: ${gaps.length} session(s) not timestamped within a day:` : '  Time cover: every closed session timestamped within a day of its end');
      for (const c of gaps) out.push(`   ${c.session} (${iso(c.from)} to ${iso(c.to)}): ${c.gap}`);
    } else {
      out.push('  No seals: proof was never turned on here, so nothing fixes this recording in time.');
    }
    for (const p of d.problems) out.push('  ! ' + p);
  }
  return out.join('\n');
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const book = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--mirror');
  if (!book) {
    console.error('usage: node scripts/verify-recording.js <book folder> [--online] [--json] [--mirror <dir>]');
    process.exit(2);
  }
  const m = args.indexOf('--mirror');
  verifyBook(path.resolve(book), { online: args.includes('--online'), mirror: m >= 0 ? path.resolve(args[m + 1]) : null })
    .then((r) => {
      console.log(args.includes('--json') ? JSON.stringify(r, null, 1) : print(r));
      process.exit(r.ok ? 0 : 1);
    }, (err) => { console.error(err); process.exit(2); });
}

module.exports = { verifyBook, print };
