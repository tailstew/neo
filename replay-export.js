'use strict';
// Export Writing History… (docs/neo-recording-plan.md, part 2, Sharing): a book's
// Writing History as one HTML file that anyone can open in a browser, with
// no NEO and no network. It holds the sessions (gzip, base64), the player
// (replay-page.js over recording.js), the evidence report as NEO wrote it,
// and, when the whole book goes, each device's seals and timestamp tokens,
// which the page checks itself. An export of chosen chapters holds only
// their lines (Rec.keepChapters): it still replays to every write of them,
// and its sessions' chains covered lines that aren't there, so it can't
// check them; the seals also say what they seal of each chapter's own
// lines (`chapters`), and it carries and checks the seals that reach the
// chapters it holds. With none (seals made before they held chapters), it
// says nothing in it fixes it in time.
//
// Main process, no Electron: main.js hands in what it read.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

// a seal, its stamps, and the root of a service the writer added
const SEAL_FILE = /^(?:\d{6}\.(?:json|[a-z0-9-]+\.tsr)|root-[0-9a-f]{16}\.pem)$/;
const ROOT_FILE = /^root-[0-9a-f]{16}\.pem$/;

// proof-roots.pem as the page offers it: NEO's own roots, then the roots
// of services the writer added, which the book carries beside its seals
function rootsPem(read, seals) {
  const added = new Map();
  for (const files of Object.values(seals || {})) {
    for (const f of files) if (ROOT_FILE.test(f.name)) added.set(f.name, Buffer.from(f.b64, 'base64').toString('latin1'));
  }
  let pem = read('proof-roots.pem');
  for (const [name, text] of added) pem += `\n# Added by the writer, not one of NEO's own (${name}):\n${text.trim()}\n`;
  return pem;
}

// Whether any seal says what it sealed of one of these chapters
function sealsReach(seals, kept) {
  const want = new Set(kept || []);
  for (const files of Object.values(seals || {})) {
    for (const f of files) {
      if (!/^\d{6}\.json$/.test(f.name)) continue;
      let body;
      try { body = JSON.parse(Buffer.from(f.b64, 'base64').toString('utf8')); } catch { continue; }
      for (const ss of Object.values((body && body.chapters) || {})) {
        for (const chs of Object.values(ss || {})) if (Object.keys(chs || {}).some((ch) => want.has(ch))) return true;
      }
    }
  }
  return false;
}

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
// `seals`: { device: [{ name, b64 }] }; `kept`: the chapters an export of
// some chapters (`partial`) holds; `chapters`: [{ id, title }] in the book's order; `strings`: the page's words in the
// writer's language (English is the key); `report`: the evidence report's
// HTML, as NEO showed it; `evidence`: its figures (Rec.evidence), which the
// page works out again from the sessions and compares.
function build({ title, author = '', lang = 'en', strings = {}, report = '', evidence = null, sessions, seals = null, kept = null, chapters = [], partial = false, script = false, underline = false, kinds = {}, css = '', made = new Date().toISOString(), version = '', dir = __dirname }) {
  const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
  // some chapters: their seals only if one reaches them
  if (partial && !sealsReach(seals, kept)) seals = null;
  const nonce = crypto.randomBytes(16).toString('base64');
  const data = {
    neoReplay: 1, title, author, made, version, partial, lang, chapters, strings, evidence,
    // a screenplay: the page sets it as NEO does, scene headings underlined when the script has them
    script: !!script, underline: !!(script && underline),
    // each page's kind: the page sets it as NEO does (sheet.js), with NEO's own rules for a sheet (`css`)
    kinds,
    sessions: sessions.map((s) => ({ id: s.id, device: s.device, name: s.name || s.device, open: !!s.open, gz: zlib.gzipSync(Buffer.from(s.text, 'utf8')).toString('base64') })),
    seals,
    roots: seals ? rootsPem(read, seals) : null
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
<style>${String(css).replace(/<\/(style)/gi, '<\\/$1')}</style>
<style>${read('replay-page.css')}</style>
</head>
<body>
<div class="rx-app">
<header class="rx-top">
  <h1>${esc(title)}</h1>
  ${author ? `<p class="rx-by">${esc(author)}</p>` : ''}
  <div id="rx-actions" class="rx-actions" hidden></div>
  <p class="rx-lede">${esc(T('This export plays back how this book was written, keystroke by keystroke, as NEO recorded it.'))}</p>
  ${partial && !seals ? `<p class="rx-note">${esc(T('This export holds only some chapters, so its timestamps can’t be verified. Export the whole book for that.'))}</p>` : ''}
  <noscript><p class="rx-note">${esc(T('Turn on JavaScript to play the history and check it. The report below is as NEO wrote it.'))}</p></noscript>
</header>
<nav id="rx-side" class="rx-side" hidden></nav>
<main id="rx-player" class="rx-player" hidden></main>
</div>
<section id="rx-report" class="rx-report">${report}</section>
<section id="rx-checks" class="rx-checks" hidden></section>
<p id="rx-made" class="rx-made">${esc(T('Made with NEO {version} on {date}.', { version, date: made.slice(0, 10) }))}</p>
<script type="application/json" id="rx-data">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>
<script nonce="${nonce}">${inline(read('recording.js'))}</script>
<script nonce="${nonce}">${inline(read('sheet.js'))}</script>
<script nonce="${nonce}">${inline(read('replay-page.js'))}</script>
</body>
</html>
`;
}

module.exports = { build, sealFiles, sealsReach, rootsPem, SEAL_FILE };
