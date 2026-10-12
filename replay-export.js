'use strict';
// Export replay… (docs/neo-recording-plan.md, part 2, Sharing): a book's
// Writing History as one HTML file that anyone can open in a browser, with
// no NEO and no network. It holds the sessions (gzip, base64), the player
// (replay-page.js over recording.js), the evidence report as NEO wrote it,
// and, when the whole book goes, each device's seals and timestamp tokens,
// which the page checks itself. A page of chosen chapters holds only their
// lines (Rec.keepChapters): it still replays to every write of them, but
// its chains and seals covered lines that aren't there, so it says that
// nothing in it fixes it in time.
//
// Main process, no Electron: main.js hands in what it read.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

// a seal, its stamps and its Bitcoin proof; never a .pending.ots
const SEAL_FILE = /^\d{6}\.(?:json|[a-z0-9-]+\.tsr|ots)$/;

// One device's seals folder as the page carries it: [{ name, b64 }], in order
function sealFiles(dir) {
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => SEAL_FILE.test(n)).sort(); } catch { /* no seals */ }
  return names.map((name) => ({ name, b64: fs.readFileSync(path.join(dir, name)).toString('base64') }));
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[c]);
// a script's text, safe inside <script>
const inline = (s) => String(s).replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');

// The page. `sessions`: [{ id, device, name, open, text }], oldest first;
// `seals`: { device: [{ name, b64 }] } (whole book only); `chapters`: [{ id,
// title }] in the book's order; `strings`: the page's words in the
// writer's language (English is the key); `report`: the evidence report's
// HTML, as NEO showed it; `evidence`: its figures (Rec.evidence), which the
// page works out again from the sessions and compares.
function build({ title, author = '', lang = 'en', strings = {}, report = '', evidence = null, sessions, seals = null, chapters = [], partial = false, made = new Date().toISOString(), version = '', dir = __dirname }) {
  const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
  const nonce = crypto.randomBytes(16).toString('base64');
  const data = {
    neoReplay: 1, title, author, made, version, partial, lang, chapters, strings, evidence,
    sessions: sessions.map((s) => ({ id: s.id, device: s.device, name: s.name || s.device, open: !!s.open, gz: zlib.gzipSync(Buffer.from(s.text, 'utf8')).toString('base64') })),
    seals: partial ? null : seals,
    roots: partial || !seals ? null : read('proof-roots.pem')
  };
  const T = (s, vars = {}) => String(strings[s] || s).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  const head = T('Writing History');
  return `<!doctype html>
<html lang="${esc(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; worker-src blob:; style-src 'unsafe-inline'; img-src data: blob:; font-src data:">
<meta name="generator" content="NEO ${esc(version)}">
<title>${esc(title)} — ${esc(head)}</title>
<style>${read('replay-page.css')}</style>
</head>
<body>
<header class="rx-top">
  <h1>${esc(title)}</h1>
  ${author ? `<p class="rx-by">${esc(author)}</p>` : ''}
  <p class="rx-lede">${esc(T('This is a timelapse of how this book was written, keystroke by keystroke, recorded by NEO as it happened.'))}</p>
  ${partial ? `<p class="rx-note">${esc(T('This page holds only some chapters. It replays them exactly, but it can’t show that they belong to a sealed whole, so nothing on it fixes them in time.'))}</p>` : ''}
  <noscript><p class="rx-note">${esc(T('Turn on JavaScript to play the replay and check it. The report below is as NEO wrote it.'))}</p></noscript>
</header>
<main>
  <section id="rx-player" class="rx-player" hidden></section>
  <section id="rx-checks" class="rx-checks" hidden></section>
  <section id="rx-report" class="rx-report">${report}</section>
</main>
<footer class="rx-foot">${esc(T('Made with NEO {version} on {date}.', { version, date: made.slice(0, 10) }))}</footer>
<script type="application/json" id="rx-data">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>
<script nonce="${nonce}">${inline(read('recording.js'))}</script>
<script nonce="${nonce}">${inline(read('replay-page.js'))}</script>
</body>
</html>
`;
}

module.exports = { build, sealFiles, SEAL_FILE };
