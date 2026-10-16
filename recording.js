// Writing History: the recording's pure engine (docs/neo-recording-plan.md).
// No DOM and no Node APIs, so the same file runs in the window
// (window.NeoRecording), in main.js, in the tests and in any script that
// wants to read a recording.
//
// A session is lines of JSON: a header object, then one array per line,
// each starting with dt, the milliseconds since the line before. The
// header's neoRec is the format; a change to what a line means takes the
// next number, and readers leave a session in a format they don't know.
//
//   b   chapter, html | null, hash, cause    first sight of a chapter this session (cause: baseline,
//                                            continue, anchor, catch-up, or the move that made it)
//   ch  chapter                              the chapter the lines below apply to
//   K   char, code, mods                     layout: this key types this character
//                                            (only where it isn't the usual key, see usualKey)
//   r   text, [dt…][, at]                    typing run: one character per key
//   rd  n | keys, [dt…][, caret]             deleting run: n Backspaces, or keys (see delKeys);
//                                            one UTF-16 unit each; caret: where it was before the first
//   n   keys, [dt…][, [moves…]]              caret keys and where each left the caret
//   k   code, mods                           any other key
//   e   at, del, ins[, input[, 0]]           any other splice of the HTML
//   s   pIdx, off[, pIdx, off][, cause]      caret or selection
//   c   kind, length, flavour, hash[, internal[, from]]  copy, cut or paste (from: a paste
//                                            copied out of Writing History, the moment as x restore's)
//   x   cause, …                             what made the edits below (restore: session, line,
//                                            device, the moment it came from; before the `b` of a
//                                            chapter it put back)
//   w   hash[, chapter]                      the chapter as it went to disk (chapter: when not the current one)
//   d   chapter, cause                       the chapter left the book
//   tag id, label, at[, made]                a name on a moment of the history (tagsOf): label
//                                            null for one NEO made (named when shown), false to
//                                            remove it; at null for this moment, or [session, line,
//                                            device, iso] for an earlier one; made: { snapshot:
//                                            folder } or { restore: the moment restored to, as at }
//   o   [chapter…]                           the book's chapter order
//   f   what                                 focus, blur, hidden, visible, idle, tab:…
//   T   iso                                  wall-clock checkpoint
//   h   n, hash                              hash chain: ends every chunk
//   end {counts}
//
// A later `tag` line with the same id takes the earlier one's place, so a
// tag is renamed or removed by a line, never by rewriting a file.
//
// K, ch, o and h carry dt 0: they describe, they don't happen. An `e` line
// with an input code came from the engine (typing, paste, dictation); a
// trailing 0 says no key was down when it came. Without a code it belongs
// to the last `x` cause. An `x spell` just before one with a code says NEO
// had the engine make it: a spelling suggestion picked from its menu. Mods are a bitmask: 1 Shift, 2 Ctrl, 4 Alt, 8 Meta,
// 16 auto-repeat, 32 not trusted (made by a script, not a keyboard).
//
// A hash is the first 128 bits of SHA-256, in base64url (22 characters).
// A chunk keeps only the last `w` of each chapter: a write between two
// others is the same check made again a few seconds earlier.
//
// An `n` run is arrow keys and their kin, one letter each (NAV_KEYS):
// capital alone, small with Shift, `*` after an auto-repeat. Each key's
// `s` line is where the key would leave the caret one letter on (navGuess);
// moves lists the others as [i, pIdx, off[, pIdx, off]], or [i] for a key
// that didn't move it. The `s` comes at its key's moment; the last dt is
// how long after the last key its `s` came.
//
// Streams: the book's other writing, each with an id where a chapter's
// would be, that no chapter id can be (it starts with a colon), and the
// same `b`, `ch`, `e`, `x`, `d` and `w` lines as a chapter. `:notes` is
// notes.html, typed like a chapter (keys and runs; no caret lines); the
// others are JSON, written as streamTexts writes them: `:titles` the
// chapters' titles, `:outline` the outline's notes (a chapter's, a
// section's, a scene's) and loose cards,
// `:stickies` stickies.json. A stream's `w` is the hash of notes.html's
// bytes, or of the stream's text when book.json or stickies.json was
// written. Streams aren't chapters: they're in no `o` line, and the
// words, the day maps and search leave them out.

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NeoRecording = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // The format this NEO writes, and every format it still reads. A change
  // to what a line means takes the next number; the old number stays in
  // READS, with its own branch wherever a line means something else in it,
  // so a writer's earlier sessions keep playing. Dropping one is losing them.
  const FORMAT = 1;
  const READS = [1];

  // What the player and the cache make of the same lines (compileSession,
  // History, playSession, DayBuilder). A change to what they come out as
  // takes the next number, so days cached by an earlier NEO are built again
  // instead of used.
  const PLAYER = 5;

  // What an `s` line's pIdx counts: the chapter body's elements that match
  // this, in document order (recPoint and historyPoint in app.js). Counting
  // other blocks changes where every recorded caret lands: a new FORMAT.
  const CARET_BLOCK = 'p';

  // inputType, shortened. Anything not listed is kept as its DOM name.
  const INPUT_TYPES = {
    insertText: 'iT', insertParagraph: 'iP', insertLineBreak: 'iL', insertFromPaste: 'iFP',
    insertFromDrop: 'iFD', insertReplacementText: 'iRT', insertCompositionText: 'iC',
    insertHTML: 'iH', insertFromYank: 'iFY', insertTranspose: 'iTr',
    deleteContentBackward: 'dB', deleteContentForward: 'dF', deleteWordBackward: 'dWB',
    deleteWordForward: 'dWF', deleteSoftLineBackward: 'dSLB', deleteSoftLineForward: 'dSLF',
    deleteHardLineBackward: 'dHLB', deleteHardLineForward: 'dHLF', deleteByCut: 'dX',
    deleteByDrag: 'dD', deleteContent: 'dC',
    historyUndo: 'hU', historyRedo: 'hR',
    formatBold: 'fB', formatItalic: 'fI', formatUnderline: 'fU', formatStrikeThrough: 'fS'
  };
  const INPUT_NAMES = {};
  for (const [name, code] of Object.entries(INPUT_TYPES)) INPUT_NAMES[code] = name;
  const inputCode = (type) => INPUT_TYPES[type] || type || '';
  const inputName = (code) => INPUT_NAMES[code] || code;

  const MOD = { shift: 1, ctrl: 2, alt: 4, meta: 8, repeat: 16, untrusted: 32 };

  /* ---------- streams: the book's writing beside its chapters ---------- */

  // Renaming one is a new FORMAT: earlier sessions name them so.
  const STREAMS = { notes: ':notes', titles: ':titles', outline: ':outline', stickies: ':stickies' };
  const isStream = (id) => typeof id === 'string' && id[0] === ':';

  // JSON with its keys in order and an entry a line, so a change is a
  // splice of the lines it changed and the same book is the same text
  function sorted(v) {
    if (Array.isArray(v)) return v.map(sorted);
    if (!v || typeof v !== 'object') return v;
    const out = {};
    for (const k of Object.keys(v).sort()) if (v[k] !== undefined) out[k] = sorted(v[k]);
    return out;
  }
  const streamJSON = (v) => JSON.stringify(sorted(v), null, 1);
  // a map without its empty entries (a chapter with no notes, no title)
  function filled(map) {
    const out = {};
    for (const [k, v] of Object.entries(map || {})) {
      if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) continue;
      out[k] = v;
    }
    return out;
  }

  // The JSON streams' text, from book.json (`meta`) and stickies.json: what
  // the recorder records, and what a check of the files on disk compares
  function streamTexts(meta, stickies) {
    const m = meta || {};
    const outline = {};
    const chapters = filled(m.chapterNotes);
    const sections = filled(m.sectionNotes);
    const scenes = filled(m.sceneNotes);
    if (Object.keys(chapters).length) outline.chapterNotes = chapters;
    if (Object.keys(sections).length) outline.sectionNotes = sections;
    if (Object.keys(scenes).length) outline.sceneNotes = scenes;
    if (Array.isArray(m.looseCards) && m.looseCards.length) outline.looseCards = m.looseCards;
    return {
      [STREAMS.titles]: streamJSON(filled(m.chapterTitles)),
      [STREAMS.outline]: streamJSON(outline),
      [STREAMS.stickies]: streamJSON(Array.isArray(stickies) ? stickies : [])
    };
  }

  /* ---------- SHA-256 over UTF-8 ---------- */

  const K256 = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ]);

  function utf8(s) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s);
    const out = [];
    for (const ch of s) {
      let c = ch.codePointAt(0);
      if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd; // a lone surrogate, as TextEncoder writes it
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return Uint8Array.from(out);
  }

  // SHA-256 of bytes (a Uint8Array) or of a string's UTF-8, as 32 bytes
  function sha256Bytes(data) {
    const bytes = typeof data === 'string' ? utf8(data) : data;
    const len = bytes.length;
    const total = ((len + 9 + 63) >> 6) << 6;
    const m = new Uint8Array(total);
    m.set(bytes);
    m[len] = 0x80;
    const bits = len * 8;
    const dv = new DataView(m.buffer);
    dv.setUint32(total - 8, Math.floor(bits / 0x100000000));
    dv.setUint32(total - 4, bits >>> 0);
    const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    const w = new Uint32Array(64);
    for (let off = 0; off < total; off += 64) {
      for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
      for (let i = 16; i < 64; i++) {
        const a = w[i - 15], b = w[i - 2];
        const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
        const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }
      let [a, b, c, d, e, f, g, hh] = h;
      for (let i = 0; i < 64; i++) {
        const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        const t1 = (hh + S1 + ((e & f) ^ (~e & g)) + K256[i] + w[i]) | 0;
        const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
    }
    const out = new Uint8Array(32);
    const ov = new DataView(out.buffer);
    for (let i = 0; i < 8; i++) ov.setUint32(i * 4, h[i]);
    return out;
  }

  // SHA-256, as hex
  function sha256(data) {
    let hex = '';
    for (const b of sha256Bytes(data)) hex += b.toString(16).padStart(2, '0');
    return hex;
  }

  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  function b64url(bytes) {
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
      const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
      const left = Math.min(3, bytes.length - i);
      out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (left > 1 ? B64[(n >> 6) & 63] : '') + (left > 2 ? B64[n & 63] : '');
    }
    return out;
  }
  function unb64url(s) {
    const out = [];
    let n = 0;
    let bits = 0;
    for (const c of s) {
      const v = B64.indexOf(c);
      if (v < 0) return null;
      n = (n << 6) | v;
      bits += 6;
      if (bits >= 8) { bits -= 8; out.push((n >> bits) & 255); }
    }
    return Uint8Array.from(out);
  }

  // The recording's hash: SHA-256 cut to 128 bits, as 22 base64url characters.
  // Where there's a native SHA-256 (Node, in history-worker.js), setDigest
  // hands it in: the same hash, many times faster.
  let nativeDigest = null;
  function digest(data) {
    return nativeDigest ? nativeDigest(data) : b64url(sha256Bytes(data).subarray(0, 16));
  }
  function setDigest(fn) { nativeDigest = fn || null; }

  // One link of the chain: digest(previous H as 16 bytes ‖ the lines' bytes)
  function chainHash(prev, text) {
    const a = unb64url(prev) || new Uint8Array(0);
    const b = utf8(text);
    const both = new Uint8Array(a.length + b.length);
    both.set(a);
    both.set(b, a.length);
    return digest(both);
  }

  /* ---------- splices ---------- */

  // The one splice { at, del, ins } that turns a into b, or null when they're
  // the same. A change among repeated characters (an "l" typed after an "l")
  // could sit in more than one place; the text comes out the same wherever
  // it goes, so `hint`, the offset in b where the caret is (or a function
  // that finds it), picks the place that ends there.
  function splice(a, b, hint) {
    if (a === b) return null;
    const n = Math.min(a.length, b.length);
    let p = 0;
    while (p < n && a.charCodeAt(p) === b.charCodeAt(p)) p++;
    let s = 0;
    while (s < n - p && a.charCodeAt(a.length - 1 - s) === b.charCodeAt(b.length - 1 - s)) s++;
    const del = a.length - p - s;
    const len = b.length - p - s;
    // the same splice moved one place left is the same change when the
    // character it gives up matches the one it takes on, in both strings
    let lo = p;
    while (lo > 0 && a.charCodeAt(lo - 1) === a.charCodeAt(lo - 1 + del) && b.charCodeAt(lo - 1) === b.charCodeAt(lo - 1 + len)) lo--;
    let at = p;
    if (lo < p && hint !== undefined) {
      const h = typeof hint === 'function' ? hint(b) : hint;
      if (typeof h === 'number' && h - len >= lo && h - len <= p) at = h - len;
    }
    return { at, del, ins: b.slice(at, at + len) };
  }

  function applyEdit(html, at, del, ins) {
    return html.slice(0, at) + ins + html.slice(at + del);
  }

  /* ---------- paragraphs ---------- */

  // A chapter's HTML cut after each </p>: the pieces the player holds, a
  // change made all at once is matched by, and a day state is a diff of.
  // Whatever follows the last </p> is a piece too, so they always join back.
  function paragraphs(html) {
    const out = [];
    let i = 0;
    for (let j; (j = html.indexOf('</p>', i)) >= 0; i = j + 4) out.push(html.slice(i, j + 4));
    if (i < html.length) out.push(html.slice(i));
    return out;
  }

  // The splices that turn a into b for a change made all at once (a
  // catch-up, Replace All, an Outline move, a structural undo): one for each
  // run of paragraphs that changed, cut to the characters that changed in
  // it, each placed in the HTML as the ones before it left it. One splice
  // from the first change to the last is the whole chapter for a name
  // changed on its first and last pages. The paragraphs kept are found as
  // patience diff finds lines: those that are once in each, in the longest
  // run of them still in order, then the equal paragraphs on either side of
  // each gap between them. So a section moved is a delete where it was and an
  // insert where it went, and a script's cues ("JOHN", a hundred times over)
  // stay matched around the lines they cue.
  function splices(a, b) {
    if (a === b) return [];
    const P = paragraphs(a);
    const C = paragraphs(b);
    const count = (xs) => { const m = new Map(); for (const x of xs) m.set(x, (m.get(x) || 0) + 1); return m; };
    const nP = count(P);
    const nC = count(C);
    const once = new Map();
    P.forEach((p, j) => { if (nP.get(p) === 1 && nC.get(p) === 1) once.set(p, j); });
    const js = C.map((p) => (once.has(p) ? once.get(p) : -1));
    // the longest increasing run of their old places (patience sorting)
    const tails = [];
    const back = new Array(C.length).fill(-1);
    for (let k = 0; k < C.length; k++) {
      if (js[k] < 0) continue;
      let lo = 0;
      let hi = tails.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (js[tails[m]] < js[k]) lo = m + 1; else hi = m; }
      back[k] = lo ? tails[lo - 1] : -1;
      tails[lo] = k;
    }
    const kept = [];
    for (let k = tails.length ? tails[tails.length - 1] : -1; k >= 0; k = back[k]) kept.push([k, js[k]]);
    kept.reverse();
    kept.push([C.length, P.length]);
    const start = [0];
    for (const p of P) start.push(start[start.length - 1] + p.length);
    const out = [];
    let delta = 0;
    let pk = -1;
    let pj = -1;
    for (const [k, j] of kept) {
      let o0 = pj + 1;
      let n0 = pk + 1;
      let o1 = j;
      let n1 = k;
      while (o0 < o1 && n0 < n1 && P[o0] === C[n0]) { o0++; n0++; }
      while (o1 > o0 && n1 > n0 && P[o1 - 1] === C[n1 - 1]) { o1--; n1--; }
      const was = P.slice(o0, o1).join('');
      const now = C.slice(n0, n1).join('');
      const sp = splice(was, now);
      if (sp) {
        out.push({ at: start[o0] + delta + sp.at, del: sp.del, ins: sp.ins });
        delta += now.length - was.length;
      }
      pk = k;
      pj = j;
    }
    return out;
  }

  // A chapter's paragraphs from the ones it had before, as a day state keeps
  // them: [from, count] copies a run of the old ones, a string is new
  function paraDiff(prev, cur) {
    const at = new Map();
    prev.forEach((p, i) => { if (!at.has(p)) at.set(p, []); at.get(p).push(i); });
    const ops = [];
    let run = null;
    for (const p of cur) {
      const js = at.get(p);
      const next = run ? run[0] + run[1] : -1;
      const j = !js ? -1 : js.includes(next) ? next : js[0];
      if (j < 0) { run = null; ops.push(p); } else if (j === next) run[1]++; else { run = [j, 1]; ops.push(run); }
    }
    return ops;
  }
  function paraPatch(prev, ops) {
    const out = [];
    for (const o of ops) {
      if (typeof o === 'string') out.push(o);
      else for (let i = o[0]; i < o[0] + o[1]; i++) out.push(prev[i]);
    }
    return out;
  }

  // A chapter as the player and the day builder hold it: its paragraphs,
  // with their lengths summed in a Fenwick tree, so a splice finds its
  // paragraph in log time and copies only the paragraphs it touches. A 300 KB
  // script is one chapter: held as one string, every key copied all of it.
  // toString() is the HTML, joined once until the next change.
  class ChapterText {
    constructor(html = '') { this.reset(paragraphs(String(html))); }

    static of(parts) {
      const c = Object.create(ChapterText.prototype);
      c.reset(parts);
      return c;
    }

    reset(parts) {
      const n = parts.length;
      const t = new Float64Array(n + 1);
      let len = 0;
      for (let k = 1; k <= n; k++) {
        t[k] += parts[k - 1].length;
        len += parts[k - 1].length;
        const up = k + (k & -k);
        if (up <= n) t[up] += t[k];
      }
      this.parts = parts;
      this.tree = t;
      this.length = len;
      this.s = n ? null : '';
    }

    // where piece i starts
    startOf(i) {
      let s = 0;
      for (let k = i; k > 0; k -= k & -k) s += this.tree[k];
      return s;
    }

    // the piece holding offset `at` (the last one, for the very end)
    find(at) {
      const n = this.parts.length;
      let pos = 0;
      let step = 1;
      while (step * 2 <= n) step *= 2;
      for (; step; step >>= 1) {
        if (pos + step <= n && this.tree[pos + step] <= at) { pos += step; at -= this.tree[pos]; }
      }
      return Math.min(pos, n - 1);
    }

    // false when the splice doesn't fit the chapter
    splice(at, del, ins) {
      if (!(at >= 0) || !(del >= 0) || at + del > this.length) return false;
      if (!del && !ins) return true;
      const parts = this.parts;
      if (!parts.length) { this.reset(paragraphs(ins)); return true; }
      const i = this.find(at);
      let j = del ? this.find(at + del - 1) : i;
      const s = this.startOf(i);
      let html = parts[i];
      for (let k = i + 1; k <= j; k++) html += parts[k];
      html = html.slice(0, at - s) + ins + html.slice(at - s + del);
      // a paragraph whose </p> went runs on into the next
      while (j + 1 < parts.length && !html.endsWith('</p>')) html += parts[++j];
      const next = paragraphs(html);
      if (next.length === j - i + 1) {
        for (let k = 0; k < next.length; k++) {
          const d = next[k].length - parts[i + k].length;
          if (d) for (let x = i + k + 1; x < this.tree.length; x += x & -x) this.tree[x] += d;
          parts[i + k] = next[k];
        }
        this.length += ins.length - del;
        this.s = null;
      } else {
        this.reset(parts.slice(0, i).concat(next, parts.slice(j + 1)));
      }
      return true;
    }

    toString() {
      if (this.s === null) this.s = this.parts.join('');
      return this.s;
    }

    clone() {
      const c = Object.create(ChapterText.prototype);
      c.parts = this.parts.slice();
      c.tree = this.tree.slice();
      c.length = this.length;
      c.s = this.s;
      return c;
    }

    // up to n characters of the HTML just before offset `at`
    before(at, n) {
      if (this.s !== null) return this.s.slice(Math.max(0, at - n), at);
      if (!this.parts.length || at <= 0) return '';
      let i = this.find(at - 1);
      let out = this.parts[i].slice(Math.max(0, at - n - this.startOf(i)), at - this.startOf(i));
      while (out.length < n && i > 0) out = this.parts[--i].slice(-(n - out.length)) + out;
      return out;
    }
  }

  // chapters by id, as ChapterTexts of their own (from HTML or ChapterTexts)
  function docOf(chapters) {
    const doc = {};
    for (const [ch, v] of Object.entries(chapters || {})) {
      if (v instanceof ChapterText) doc[ch] = v.clone();
      else if (typeof v === 'string') doc[ch] = new ChapterText(v);
    }
    return doc;
  }
  function htmlOf(doc) {
    const out = {};
    for (const [ch, c] of Object.entries(doc)) out[ch] = c.toString();
    return out;
  }

  /* ---------- words ---------- */

  const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ' };
  function decodeEntities(s) {
    return s.replace(/&(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z][a-z0-9]{1,30});/gi, (m, e) => {
      if (e[0] !== '#') return NAMED[e.toLowerCase()] !== undefined ? NAMED[e.toLowerCase()] : m;
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1);
      try { return String.fromCodePoint(n); } catch { return m; }
    });
  }

  // A chapter's prose, a paragraph a line: tags gone, entities read. A ghost
  // (an Outline note waiting on the page) isn't prose, nor is a ⚑ mark.
  function textOf(html) {
    const out = [];
    for (const p of paragraphs(html)) { const x = paraText(p); if (x !== null) out.push(x); }
    return out.join('\n');
  }
  // one paragraph's prose (null for a ghost)
  function paraText(p) {
    if (/^<p\b[^>]*\bclass="[^"]*\bghost\b/.test(p)) return null;
    return decodeEntities(p.replace(/<br\b[^>]*>/gi, ' ').replace(/<[^>]*>/g, '')).replace(/⚑/g, '').replace(/\n/g, ' ');
  }

  const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;
  // each word of a chapter, case-folded, and how often it's there
  function wordBag(html) {
    const bag = new Map();
    for (const w of textOf(html).toLowerCase().match(WORD) || []) bag.set(w, (bag.get(w) || 0) + 1);
    return bag;
  }
  // A paragraph's words, remembered: a chapter's paragraphs mostly stay the
  // same from one session to the next
  const PARA_WORDS = new Map();
  function paraWords(p) {
    let n = PARA_WORDS.get(p);
    if (n === undefined) {
      const x = paraText(p);
      n = x === null ? 0 : (x.match(WORD) || []).length;
      if (PARA_WORDS.size >= 100000) PARA_WORDS.clear();
      PARA_WORDS.set(p, n);
    }
    return n;
  }

  // The words that came and went between two versions of a chapter (HTML,
  // or its paragraphs): a word there more often counts as added, less often
  // as removed. Moving a sentence changes nothing; rewording it counts both
  // ways. Paragraphs in both are the same words on both sides, so only the
  // others are counted; words is how many the second version has.
  function wordChange(a, b) {
    const A = Array.isArray(a) ? a : paragraphs(a);
    const B = Array.isArray(b) ? b : paragraphs(b);
    const left = new Map();
    for (const p of A) left.set(p, (left.get(p) || 0) + 1);
    const came = [];
    let words = 0;
    for (const p of B) {
      words += paraWords(p);
      const n = left.get(p);
      if (n) left.set(p, n - 1); else came.push(p);
    }
    const went = [];
    for (const [p, n] of left) for (let k = 0; k < n; k++) went.push(p);
    const was = wordBag(went.join(''));
    const now = wordBag(came.join(''));
    let added = 0;
    let removed = 0;
    for (const [w, n] of now) { const d = n - (was.get(w) || 0); if (d > 0) added += d; }
    for (const [w, n] of was) { const d = n - (now.get(w) || 0); if (d > 0) removed += d; }
    return { added, removed, words };
  }
  const countWords = (html) => (textOf(html).match(WORD) || []).length;

  /* ---------- runs ---------- */

  // Where typing in each chapter last left off, which chapter the lines
  // apply to, and where the caret was last seen: the encoder, the expander
  // and the replay all keep this the same way, so a run without a position
  // lands where the encoder meant.
  function newPlace() { return { cur: null, end: {}, sel: null }; }
  function track(place, line) {
    const kind = line[1];
    if (kind === 'b') { place.cur = line[2]; delete place.end[line[2]]; place.sel = null; }
    else if (kind === 'ch') { place.cur = line[2]; place.sel = null; }
    else if (kind === 'd') delete place.end[line[2]];
    else if (kind === 'e') place.end[place.cur] = line[2] + line[4].length;
    else if (kind === 's') {
      const n = line.slice(2).filter((v) => typeof v === 'number');
      place.sel = n.length >= 4 ? n.slice(0, 4) : [n[0], n[1], n[0], n[1]];
    }
  }

  const oneChar = (s) => s.length > 0 && s.length <= 2 && [...s].length === 1 && !/[<>&]/.test(s);

  // The key that usually types a character, as "code mods": a `K` line is
  // written only for a character some other key typed.
  function usualKey(c) {
    if (c.length !== 1) return undefined;
    if (c >= 'a' && c <= 'z') return 'Key' + c.toUpperCase() + ' 0';
    if (c >= 'A' && c <= 'Z') return 'Key' + c + ' ' + MOD.shift;
    if (c >= '0' && c <= '9') return 'Digit' + c + ' 0';
    if (c === ' ') return 'Space 0';
    return undefined;
  }

  // Caret keys, as an `n` run spells them
  const NAV_KEYS = { ArrowLeft: 'L', ArrowRight: 'R', ArrowUp: 'U', ArrowDown: 'D', Home: 'H', End: 'E', PageUp: 'P', PageDown: 'N' };
  const NAV_CODES = {};
  for (const [code, letter] of Object.entries(NAV_KEYS)) NAV_CODES[letter] = code;
  const isNav = (line) => line[1] === 'k' && NAV_KEYS[line[2]] !== undefined && !(line[3] & ~(MOD.shift | MOD.repeat));
  const navLetter = (line) => {
    const c = NAV_KEYS[line[2]];
    return ((line[3] & MOD.shift) ? c.toLowerCase() : c) + ((line[3] & MOD.repeat) ? '*' : '');
  };
  function navParse(text) {
    const keys = [];
    for (const c of text) {
      if (c === '*') { if (keys.length) keys[keys.length - 1].mods |= MOD.repeat; continue; }
      const up = c.toUpperCase();
      keys.push({ code: NAV_CODES[up] || '', mods: c === up ? 0 : MOD.shift });
    }
    return keys;
  }
  // a caret `s` line without a cause: one a key moved
  const plainSel = (line) => line[1] === 's' && (line.length === 4 || line.length === 6) && line.slice(2).every((v) => typeof v === 'number');
  const selNums = (sel) => (sel[0] === sel[2] && sel[1] === sel[3] ? [sel[0], sel[1]] : sel.slice(0, 4));

  // Where a caret key leaves the caret, as a guess: Left and Right one letter
  // along, with Shift moving only the selection's focus. null when there's
  // no guessing.
  function navGuess(sel, code, mods) {
    const step = code === 'ArrowLeft' ? -1 : code === 'ArrowRight' ? 1 : 0;
    if (!sel || !step) return null;
    const [ap, ao, fp, fo] = sel;
    if (fo + step < 0) return null;
    if (mods & MOD.shift) return [ap, ao, fp, fo + step];
    if (ap !== fp || ao !== fo) return null;
    return [fp, fo + step, fp, fo + step];
  }

  // A deleting run's keys: a number is that many Backspaces; a string has
  // a letter per key, B Backspace and D Delete, small for an auto-repeat.
  const DEL_LETTERS = { Backspace: 'B', Delete: 'D' };
  function delKeys(field) {
    if (typeof field === 'number') return Array.from({ length: field }, () => ({ code: 'Backspace', mods: 0, back: true }));
    return [...String(field)].map((c) => ({ code: c.toUpperCase() === 'D' ? 'Delete' : 'Backspace', mods: c === c.toUpperCase() ? 0 : MOD.repeat, back: c.toUpperCase() !== 'D' }));
  }

  // An `n` run back into its `k` and `s` lines, keeping place.sel
  function navLines(line, place) {
    const keys = navParse(line[2]);
    const dts = line[3] || [];
    const moves = new Map((line[4] || []).map((m) => [m[0], m.slice(1)]));
    const out = [];
    keys.forEach(({ code, mods }, i) => {
      out.push([i === 0 ? line[0] : dts[i - 1] || 0, 'k', code, mods]);
      let nums;
      if (moves.has(i)) {
        nums = moves.get(i);
        if (!nums.length) return; // the key didn't move the caret
      } else {
        const guess = navGuess(place.sel, code, mods);
        if (!guess) return;
        nums = selNums(guess);
      }
      const s = [i === keys.length - 1 ? dts[i] || 0 : 0, 's', ...nums];
      track(place, s);
      out.push(s);
    });
    return out;
  }

  // Turns per-key lines into runs as they arrive: a `k` followed at once (dt
  // 0) by the one-character insertText, Backspace or Delete it made, where the
  // last edit in the chapter ended, joins the run. A caret key and the
  // caret line it caused join an `n` run. Anything else ends a run.
  class RunEncoder {
    constructor() {
      this.place = newPlace();
      this.layout = {}; // char -> "code mods", where a K line said so
      this.run = null;  // { kind, dt0, dts, text | n | keys, at }
      this.key = null;  // a `k` waiting to see what it typed
      this.nav = null;  // a caret key waiting to see where the caret went
    }

    push(line) {
      const out = [];
      if (this.nav) {
        const k = this.nav;
        this.nav = null;
        if (plainSel(line)) { this.navAdd(k, line, out); return out; }
        this.navAdd(k, null, out);
      }
      if (this.key) {
        const k = this.key;
        this.key = null;
        if (line[1] === 'e' && this.joins(k, line, out)) return out;
        this.endRun(out);
        out.push(k);
      }
      if (isNav(line)) {
        if (this.run && this.run.kind !== 'n') this.endRun(out);
        this.nav = line;
        return out;
      }
      if (line[1] === 'k' && !(line[3] & MOD.untrusted) && (!(line[3] & MOD.repeat) || DEL_LETTERS[line[2]])) {
        this.key = line; // the run waits to see what it does
        return out;
      }
      this.endRun(out);
      track(this.place, line);
      out.push(line);
      return out;
    }

    end() {
      const out = [];
      if (this.nav) { this.navAdd(this.nav, null, out); this.nav = null; }
      const k = this.key;
      this.key = null;
      this.endRun(out);
      if (k) out.push(k);
      return out;
    }

    endRun(out) {
      const r = this.run;
      if (!r) return;
      this.run = null;
      if (r.kind === 'n') {
        const line = [r.dt0, 'n', r.keys, [...r.dts, r.tail]];
        if (r.moves.length) line.push(r.moves);
        out.push(line);
        return;
      }
      if (r.pre) out.push(...r.pre);
      const line = r.kind === 'r' ? [r.dt0, 'r', r.text, r.dts] : [r.dt0, 'rd', /^B+$/.test(r.keys) ? r.keys.length : r.keys, r.dts];
      if (r.at !== undefined) line.push(r.at);
      out.push(line);
    }

    // a caret key, with the caret line it caused (or null), into the `n` run
    navAdd(k, s, out) {
      if (this.run && this.run.kind !== 'n') this.endRun(out);
      let r = this.run;
      if (!r) r = this.run = { kind: 'n', dt0: k[0], dts: [], keys: '', moves: [], i: 0, tail: 0 };
      else { r.dts.push(r.tail + k[0]); r.tail = 0; }
      r.keys += navLetter(k);
      if (s) {
        const nums = s.slice(2);
        const guess = navGuess(this.place.sel, k[2], k[3]);
        if (!guess || JSON.stringify(selNums(guess)) !== JSON.stringify(nums)) r.moves.push([r.i, ...nums]);
        track(this.place, s);
        r.tail = s[0];
      } else r.moves.push([r.i]);
      r.i++;
    }

    joins(k, e, out) {
      if (e[0] !== 0 || e.length !== 6) return false;
      const [, , at, del, ins, input] = e;
      const ch = this.place.cur;
      const end = this.place.end[ch];
      if (input === 'iT' && del === 0 && oneChar(ins) && !(k[3] & MOD.repeat)) {
        const want = k[2] + ' ' + k[3];
        const had = this.layout[ins] !== undefined ? this.layout[ins] : usualKey(ins);
        // a character this run typed with another key needs a run of its own
        if (this.run && (this.run.kind !== 'r' || at !== end || (had !== want && this.run.text.includes(ins)))) this.endRun(out);
        if (this.run) {
          this.run.text += ins;
          this.run.dts.push(k[0]);
        } else {
          this.run = { kind: 'r', dt0: k[0], dts: [], text: ins, pre: [] };
          if (at !== end) this.run.at = at;
        }
        if (had !== want) {
          this.layout[ins] = want;
          this.run.pre.push([0, 'K', ins, k[2], k[3]]); // written just before the run
        }
        this.place.end[ch] = at + ins.length;
        return true;
      }
      const back = k[2] === 'Backspace';
      if (del === 1 && ins === '' && !(k[3] & ~MOD.repeat) && input === (back ? 'dB' : 'dF') && DEL_LETTERS[k[2]]) {
        const caret = back ? at + 1 : at; // where the caret was before the key
        if (this.run && (this.run.kind !== 'rd' || caret !== end)) this.endRun(out);
        const letter = (k[3] & MOD.repeat) ? DEL_LETTERS[k[2]].toLowerCase() : DEL_LETTERS[k[2]];
        if (this.run) {
          this.run.keys += letter;
          this.run.dts.push(k[0]);
        } else {
          this.run = { kind: 'rd', dt0: k[0], dts: [], keys: letter };
          if (caret !== end) this.run.at = caret;
        }
        this.place.end[ch] = at;
        return true;
      }
      return false;
    }
  }

  function encodeRuns(lines) {
    const enc = new RunEncoder();
    const out = [];
    for (const line of lines) out.push(...enc.push(line));
    out.push(...enc.end());
    return out;
  }

  // Runs back into one `k` and one `e` (or `s`) per key, on the same clock.
  // `K` lines are used up. Everything else passes through.
  function expandRuns(lines) {
    const place = newPlace();
    const layout = {};
    const out = [];
    for (const line of lines) {
      const kind = line[1];
      if (kind === 'K') { layout[line[2]] = [line[3], line[4]]; continue; }
      if (kind === 'n') { out.push(...navLines(line, place)); continue; }
      if (kind === 'r') {
        const chars = [...line[2]];
        let pos = line.length > 4 ? line[4] : place.end[place.cur];
        chars.forEach((c, i) => {
          const usual = (usualKey(c) || ' 0').split(' ');
          const [code, mods] = layout[c] || [usual[0], +usual[1]];
          out.push([i === 0 ? line[0] : line[3][i - 1], 'k', code, mods]);
          const e = [0, 'e', pos, 0, c, 'iT'];
          out.push(e);
          track(place, e);
          pos += c.length;
        });
        continue;
      }
      if (kind === 'rd') {
        let pos = line.length > 4 ? line[4] : place.end[place.cur];
        delKeys(line[2]).forEach(({ code, mods, back }, i) => {
          out.push([i === 0 ? line[0] : line[3][i - 1], 'k', code, mods]);
          if (back) pos--;
          const e = [0, 'e', pos, 1, '', back ? 'dB' : 'dF'];
          out.push(e);
          track(place, e);
        });
        continue;
      }
      track(place, line);
      out.push(line);
    }
    return out;
  }

  /* ---------- writing a session ---------- */

  const DESCRIBES = new Set(['K', 'ch', 'o', 'h']); // lines that keep dt 0

  // Holds a session's lines as they're made: turns typing into runs, and
  // cuts them into numbered chunks that each end with an `h` line. A chunk
  // keeps only the last `w` of each chapter; the time of one it leaves out
  // goes to the line after it.
  class SessionWriter {
    constructor(header) {
      this.header = JSON.stringify(header);
      this.H = digest(this.header + '\n');
      this.n = 1;          // lines in chunks so far, the header being line 1
      this.first = 1;      // the number of the next chunk's first line
      this.pending = [];   // { line, ch } not yet in a chunk; ch: the chapter a `w` is for
      this.done = [this.header]; // the lines in chunks, for checks
      this.cur = null;     // the chapter the lines apply to
      this.enc = new RunEncoder();
    }

    // the whole session so far, as text lines
    get lines() { return this.done.concat(this.pending.map((p) => JSON.stringify(p.line))); }

    push(line) { for (const l of this.enc.push(line)) this.add(l); }
    endRun() { for (const l of this.enc.end()) this.add(l); }

    add(line) {
      if (line[1] === 'b' || line[1] === 'ch') this.cur = line[2];
      this.pending.push({ line, ch: line[1] === 'w' ? (line.length > 3 ? line[3] : this.cur) : null });
    }

    // the lines since the last chunk, closed with an `h`, or null if none
    chunk() {
      this.endRun();
      if (!this.pending.length) return null;
      const lastWrite = {};
      this.pending.forEach((p, i) => { if (p.ch !== null) lastWrite[p.ch] = i; });
      const lines = [];
      let carry = 0;
      this.pending.forEach((p, i) => {
        let line = p.line;
        if (p.ch !== null && lastWrite[p.ch] !== i) { carry += line[0]; return; }
        if (carry && !DESCRIBES.has(line[1])) { line = [line[0] + carry, ...line.slice(1)]; carry = 0; }
        lines.push(JSON.stringify(line));
      });
      const body = lines.map((s) => s + '\n').join('');
      this.H = chainHash(this.H, body);
      this.n += lines.length + 1;
      const h = JSON.stringify([0, 'h', this.n, this.H]);
      this.done.push(...lines, h);
      const text = (this.first === 1 ? this.header + '\n' : '') + body + h + '\n';
      const out = { first: this.first, last: this.n, text };
      this.first = this.n + 1;
      this.pending = [];
      return out;
    }
  }

  // Lines added to the end of a finished text, chained on from its last
  // `h` (used to close a session NEO didn't get to close itself).
  function appendLines(text, lines) {
    const raw = splitLines(text).lines;
    if (!raw.length) return text;
    let H = digest(raw[0] + '\n');
    let from = 1;
    for (let i = raw.length - 1; i > 0; i--) {
      const l = parseLine(raw[i]);
      if (Array.isArray(l) && l[1] === 'h') { H = l[3]; from = i + 1; break; }
    }
    // any lines after the last `h` go into this link too
    const added = lines.map((l) => JSON.stringify(l) + '\n').join('');
    const body = raw.slice(from).map((s) => s + '\n').join('') + added;
    const n = raw.length + lines.length + 1;
    const h = JSON.stringify([0, 'h', n, chainHash(H, body)]);
    return raw.map((s) => s + '\n').join('') + added + h + '\n';
  }

  /* ---------- reading ---------- */

  function parseLine(s) {
    try { return JSON.parse(s); } catch { return undefined; }
  }

  // A text's whole lines, and whether it ended mid-line
  function splitLines(text) {
    const lines = text.split('\n');
    const last = lines.pop();
    return { lines, torn: last !== '' };
  }

  function parseSession(text) {
    const { lines: raw } = splitLines(text);
    const header = raw.length ? parseLine(raw[0]) : undefined;
    const head = header && !Array.isArray(header) ? header : null;
    // a session in a format this NEO doesn't know is left unread
    const known = !!head && READS.includes(head.neoRec);
    return { header: head, known, format: known ? head.neoRec : null, raw, lines: known ? raw.slice(1).map(parseLine) : [] };
  }

  // The first line number a part holds: c-000412.jsonl, s-000001-000411.jsonl.gz,
  // or a closed session (line 1).
  function partFirst(name) {
    const m = /^(?:c|s)-(\d+)/.exec(name);
    return m ? +m[1] : 1;
  }

  // An open session's rollups and chunks (or a closed session) into one
  // text, in line order. Lines a rollup already holds are skipped, so a
  // crash between writing a rollup and deleting its chunks costs nothing.
  // Missing lines and parts that won't read whole come back as gaps.
  function joinParts(parts) {
    const sorted = parts
      .map((p) => ({ ...p, first: partFirst(p.name), split: splitLines(p.text) }))
      .sort((a, b) => a.first - b.first || b.split.lines.length - a.split.lines.length);
    let next = 1;
    let text = '';
    const gaps = [];
    const bad = [];
    for (const p of sorted) {
      const { lines, torn } = p.split;
      if (torn || lines.some((l) => parseLine(l) === undefined)) { bad.push(p.name); continue; }
      const last = p.first + lines.length - 1;
      if (last < next) continue;
      if (p.first > next) gaps.push({ from: next, to: p.first - 1 });
      const skip = Math.max(0, next - p.first);
      text += lines.slice(skip).map((l) => l + '\n').join('');
      next = last + 1;
    }
    return { text, lines: next - 1, gaps, bad };
  }

  // Checks the hash chain: where the verified part ends, and every break.
  function verifyChain(text) {
    const { lines: raw, torn } = splitLines(text);
    const breaks = [];
    if (!raw.length) return { ok: false, verified: 0, lines: 0, last: null, breaks: [{ line: 0, reason: 'empty' }] };
    let H = digest(raw[0] + '\n');
    let body = '';
    let verified = 0;
    let sinceH = 0;
    for (let i = 1; i < raw.length; i++) {
      const no = i + 1;
      const line = parseLine(raw[i]);
      if (!Array.isArray(line)) { breaks.push({ line: no, reason: 'unreadable' }); body += raw[i] + '\n'; sinceH++; continue; }
      if (line[1] !== 'h') { body += raw[i] + '\n'; sinceH++; continue; }
      const want = chainHash(H, body);
      if (line[2] !== no) breaks.push({ line: no, reason: 'numbering' });
      if (line[3] !== want) breaks.push({ line: no, reason: 'hash' });
      else if (line[2] === no && !breaks.length) verified = no;
      H = line[3];
      body = '';
      sinceH = 0;
    }
    if (sinceH) breaks.push({ line: raw.length, reason: 'unsealed' });
    if (torn) breaks.push({ line: raw.length + 1, reason: 'torn' });
    return { ok: !breaks.length, verified, lines: raw.length, last: H, breaks };
  }

  /* ---------- replay ---------- */

  // An anchor: the first time a session touches a chapter edited this much
  // since its last full `b` (characters inserted and deleted), the `b` holds
  // the whole chapter again instead of continuing. It bounds how much any
  // replay of the chapter has to play, and is where a replay picks up again
  // after a session went missing. Readers see only the cause, so the rule
  // can change without a new format.
  const ANCHOR_CHARS = 200000;
  const ANCHOR_TIMES = 4;
  const anchorDue = (edited, length) => edited >= Math.max(ANCHOR_CHARS, ANCHOR_TIMES * length);

  // What the recorder writes the first time a session touches a chapter
  // (without dt): `was` is where this device's recordings left it (undefined
  // if they never saw it), `edited` its edits since its last full `b`. A
  // chapter never recorded is all there (baseline). Otherwise a `b` that
  // continues from the hash, or the whole of `was` again when an anchor is
  // due, then, if the chapter changed while nothing was recording, the
  // catch-up: a splice per run of paragraphs that changed.
  function baseLines(chId, html, was, edited = 0) {
    if (was === undefined) return [['b', chId, html, digest(html), 'baseline']];
    const out = [anchorDue(edited, was.length) ? ['b', chId, was, digest(was), 'anchor'] : ['b', chId, null, digest(was), 'continue']];
    const sps = splices(was, html);
    if (sps.length) {
      out.push(['x', 'catch-up']);
      for (const sp of sps) out.push(['e', sp.at, sp.del, sp.ins]);
    }
    return out;
  }

  /* ---------- devices: one page ---------- */

  // Changes a device makes to its own copy of a chapter that say nothing new
  // about the book: its `b` lines (as its last recording left the chapter,
  // or all of it again), and text that came from elsewhere (while nothing
  // was recording, a copy adopted from another device, a chapter that
  // arrived from one). They count as nobody's words.
  const QUIET = new Set(['continue', 'anchor', 'baseline', 'catch-up', 'disk-adopt', 'disk-new']);

  // The book as every device wrote it (docs/neo-recording-plan.md, 4d). Each
  // device plays its lines onto its own copy of each chapter (docs), since a
  // `continue` means where that device's recording left the chapter. The
  // page (doc) is what the player shows: each of its chapters is the very
  // ChapterText of the device that last changed it, so a change there is a
  // change on the page. A change from another device takes the page over
  // (take), and is a sync when that device's copy isn't what the page
  // showed. A quiet change to a copy the page doesn't show leaves the page
  // alone, until its run ends somewhere the page isn't (settle).
  const LINKED = 'linked';
  const TAKE = 'take';
  class Page {
    // chapters as HTML or ChapterTexts: the page, each device's, and which
    // device's copy the page shows of each (links: ch -> device)
    constructor({ page = {}, devices = {}, links = {} } = {}) {
      this.doc = docOf(page);
      this.docs = {};
      for (const [d, chs] of Object.entries(devices)) this.docs[d] = docOf(chs);
      this.link(links);
      this.changes = 0; // how often the page has changed, so a look can tell
    }

    // one device's chapters, which the page shows
    static one(chapters = {}, device = '') {
      const p = new Page();
      p.docs[device] = docOf(chapters);
      p.doc = { ...p.docs[device] };
      return p;
    }

    device(d) { return this.docs[d] || (this.docs[d] = {}); }

    // the page shows these devices' copies, where they are what it shows
    link(links) {
      for (const [ch, d] of Object.entries(links || {})) {
        const c = this.docs[d] && this.docs[d][ch];
        if (c && this.doc[ch] && c.toString() === this.doc[ch].toString()) this.doc[ch] = c;
      }
    }

    // which device's copy the page shows of each chapter
    links() {
      const out = {};
      for (const [d, doc] of Object.entries(this.docs)) {
        for (const [ch, c] of Object.entries(doc)) if (this.doc[ch] === c) out[ch] = d;
      }
      return out;
    }

    // Before device d changes chapter ch: whether the page goes with it.
    // LINKED: it shows that copy already; TAKE: it takes that copy over (a
    // sync when it showed something else); null: it stays as it is.
    take(d, ch, quiet) {
      const p = this.doc[ch];
      if (p !== undefined && p === this.device(d)[ch]) return LINKED;
      return quiet && p !== undefined ? null : TAKE;
    }

    // what a TAKE puts on the page before the change: the device's copy,
    // when that isn't what the page shows (undefined when it is)
    syncOf(d, ch) {
      const c = this.device(d)[ch];
      const p = this.doc[ch];
      return c !== undefined && (p === undefined || p.toString() !== c.toString()) ? c.toString() : undefined;
    }

    // …and after the change: the page shows the device's copy. `edits`:
    // false for a change that leaves the copy as it was (a `continue`)
    after(d, ch, how, edits = true) {
      if (!how) return;
      const c = this.device(d)[ch];
      const p = this.doc[ch];
      if (c !== undefined) this.doc[ch] = c; else delete this.doc[ch];
      if (edits || (how === TAKE && (p === undefined || c === undefined ? p !== c : p.toString() !== c.toString()))) this.changes++;
    }

    // A run of quiet changes to ch on device d has ended: if that copy isn't
    // what the page shows, the page takes it, and its HTML is returned
    settle(d, ch) {
      const c = this.device(d)[ch];
      const p = this.doc[ch];
      if (c === undefined || p === c || (p !== undefined && p.toString() === c.toString())) return undefined;
      this.doc[ch] = c;
      this.changes++;
      return c.toString();
    }

    // device d lost track of ch: so does the page, where it showed that copy
    lose(d, ch) {
      const c = this.device(d)[ch];
      if (c === undefined) return false;
      if (this.doc[ch] === c) { delete this.doc[ch]; this.changes++; }
      delete this.docs[d][ch];
      return true;
    }
  }

  // Whether the lines from j on carry on a run of quiet changes to ch (with
  // `cause` the `x` standing then). Lines that make no step of the player's
  // come between; an `o` too. History.quietGoesOn says the same of steps.
  function quietGoesOn(lines, j, ch, cause) {
    for (; j < lines.length; j++) {
      const l = lines[j];
      if (!Array.isArray(l)) continue;
      const k = l[1];
      if (k === 'h' || k === 'K' || k === 'T' || k === 'w' || k === 'k' || k === 'o') continue;
      if (k === 'ch') { if (l[2] !== ch) return false; continue; }
      if (k === 'x') { if (!QUIET.has(l[2])) return false; cause = l[2]; continue; }
      return k === 'e' && !l[5] && QUIET.has(cause);
    }
    return false;
  }

  // The order a day's sessions play in, whichever device wrote them: by when
  // they began (a session's name starts with its UTC time), then device
  const sessionOrder = (a, b) => {
    const x = String(a.id).slice(0, 20);
    const y = String(b.id).slice(0, 20);
    if (x !== y) return x < y ? -1 : 1;
    const da = a.device || '';
    const db = b.device || '';
    if (da !== db) return da < db ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };

  // One session's lines played onto doc (chapter id -> ChapterText), in
  // place. `edited` counts each chapter's edits since its last full `b`.
  // With `page` (a Page), they are device `device`'s, played onto its own
  // copies, and the page goes with them as Page says. `on` hears what
  // happens, before it happens: edit(ch, at, del, ins,
  // cause, t), base(ch, html, cause), drop(ch, cause), order(list), key(t),
  // wall(ms, t), write(ch, t); and whole(ch, t) just after a `b` line has
  // set a chapter whole. Returns the session's length on its own clock.
  function playLines(lines, doc, opts) {
    const p = linePlayer(lines, doc, opts);
    for (let i = 0; i < lines.length; i++) p.play(i);
    return p.time();
  }

  // …a line at a time: play(i) plays line i (in order), time() is the clock
  function linePlayer(lines, doc, { si = 0, edited = null, on = {}, writes = null, problems = [], page = null, device = '' } = {}) {
    if (page) doc = page.device(device);
    // the page, after a quiet change to ch at line i, once its run is over
    const settle = (i, ch, why) => {
      if (page && QUIET.has(why) && !quietGoesOn(lines, i + 1, ch, cause)) page.settle(device, ch);
    };
    const place = newPlace();
    const where = (i) => ({ session: si, line: i + 2 }); // line numbers count the header
    let t = 0;
    let cause = 'input';
    const edit = (pos, del, ins, i, why) => {
      const ch = place.cur;
      const c = doc[ch];
      if (c === undefined || pos === undefined || !(pos >= 0) || pos + del > c.length) {
        problems.push({ ...where(i), reason: 'edit', chapter: ch });
        return false;
      }
      const how = page && page.take(device, ch, QUIET.has(why));
      if (on.edit) on.edit(ch, pos, del, ins, why, t);
      c.splice(pos, del, ins);
      if (page) { page.after(device, ch, how); settle(i, ch, why); }
      if (edited) edited[ch] = (edited[ch] || 0) + del + ins.length;
      return true;
    };
    const play = (i) => {
      const line = lines[i];
      if (!Array.isArray(line)) return;
      const kind = line[1];
      if (kind === 'r' || kind === 'rd') {
        const chars = kind === 'r' ? [...line[2]] : null;
        const dels = chars ? null : delKeys(line[2]);
        let pos = line.length > 4 ? line[4] : place.end[place.cur];
        let ok = true;
        for (let j = 0; j < (chars || dels).length; j++) {
          t += (j === 0 ? line[0] : line[3][j - 1]) || 0;
          if (on.key) on.key(t);
          if (!ok) continue;
          if (chars) {
            ok = edit(pos, 0, chars[j], i, 'input');
            pos += chars[j].length;
          } else {
            if (dels[j].back) pos--;
            ok = edit(pos, 1, '', i, 'input');
          }
        }
        place.end[place.cur] = pos;
        return;
      }
      if (kind === 'n') {
        const n = navParse(line[2]).length;
        const dts = line[3] || [];
        for (let j = 0; j < n; j++) {
          t += (j === 0 ? line[0] : dts[j - 1]) || 0;
          if (on.key) on.key(t);
        }
        t += dts[n - 1] || 0;
        return; // (where the caret went doesn't change the text)
      }
      t += line[0] || 0;
      if (kind === 'b') {
        const [, , chId, html, hash, why] = line;
        const how = page && page.take(device, chId, QUIET.has(why));
        if (html === null) {
          if (doc[chId] === undefined || digest(doc[chId].toString()) !== hash) {
            problems.push({ ...where(i), reason: 'continue', chapter: chId });
            delete doc[chId];
          } else if (page) { page.after(device, chId, how, false); settle(i, chId, why); }
        } else {
          if (on.base) on.base(chId, html, why);
          doc[chId] = new ChapterText(html);
          if (page) { page.after(device, chId, how); settle(i, chId, why); }
          if (on.whole) on.whole(chId, t);
          if (edited) edited[chId] = 0;
          if (digest(html) !== hash) problems.push({ ...where(i), reason: 'base hash', chapter: chId });
        }
      } else if (kind === 'e') {
        edit(line[2], line[3], line[4], i, line[5] ? 'input' : cause);
      } else if (kind === 'x') {
        cause = line[2];
      } else if (kind === 'k') {
        if (on.key) on.key(t);
      } else if (kind === 'd') {
        const how = page && page.take(device, line[2], QUIET.has(line[3]));
        if (on.drop) on.drop(line[2], line[3]);
        delete doc[line[2]];
        if (page) page.after(device, line[2], how);
      } else if (kind === 'o') {
        if (on.order) on.order(line[2]);
      } else if (kind === 'tag') {
        if (on.tag) on.tag(line, t, i);
      } else if (kind === 'T') {
        if (on.wall) on.wall(Date.parse(line[2]), t);
      } else if (kind === 'w') {
        const chId = line.length > 3 ? line[3] : place.cur;
        const c = doc[chId];
        if (on.write) on.write(chId, t);
        if (writes) writes.push({ ...where(i), chapter: chId, hash: line[2], ok: c !== undefined && digest(c.toString()) === line[2] });
      }
      track(place, line);
    };
    return { play, time: () => t };
  }

  // When each of a session's lines happened: walls (the time of day, NaN
  // where the header gives none) and ts (on the session's own clock), at
  // the line's first key for a run, as playLines and compileSession count
  function lineWalls(header, lines) {
    const walls = new Float64Array(lines.length);
    const ts = new Float64Array(lines.length);
    let t = 0;
    let wallAt = header ? Date.parse(header.startedAt) : NaN;
    let wallT = 0;
    lines.forEach((line, i) => {
      const first = Array.isArray(line) ? t + (line[0] || 0) : t;
      if (Array.isArray(line) && line[1] === 'T') {
        const w = Date.parse(line[2]);
        if (Number.isFinite(w)) { wallAt = w; wallT = first; }
      }
      ts[i] = first;
      walls[i] = Number.isFinite(wallAt) ? wallAt + first - wallT : NaN;
      if (!Array.isArray(line)) return;
      const kind = line[1];
      t = first;
      if (kind === 'r' || kind === 'rd') {
        const n = kind === 'r' ? [...line[2]].length : delKeys(line[2]).length;
        for (let j = 1; j < n; j++) t += line[3][j - 1] || 0;
      } else if (kind === 'n') {
        const n = navParse(line[2]).length;
        const dts = line[3] || [];
        for (let j = 1; j < n; j++) t += dts[j - 1] || 0;
        t += dts[n - 1] || 0;
      }
    });
    return { walls, ts };
  }

  // The order several sessions' lines play in, as they were written: by the
  // time of day of each, the earlier session first where two are the same,
  // so sessions that overlap (NEO open on two computers) interleave. A line
  // with no time takes the one before it, and a session with none at all
  // follows the session before. Returns [session, line] pairs.
  function interleave(walls) {
    let prev = 0;
    const W = walls.map((w) => {
      const out = Float64Array.from(w);
      let at = out.find((x) => Number.isFinite(x));
      if (at === undefined) at = prev;
      for (let i = 0; i < out.length; i++) { if (Number.isFinite(out[i])) at = out[i]; else out[i] = at; }
      if (out.length) prev = out[out.length - 1];
      return out;
    });
    const pos = W.map(() => 0);
    const order = [];
    for (;;) {
      let best = -1;
      for (let s = 0; s < W.length; s++) {
        if (pos[s] < W[s].length && (best < 0 || W[s][pos[s]] < W[best][pos[best]])) best = s;
      }
      if (best < 0) return order;
      order.push([best, pos[best]++]);
    }
  }

  // Sessions played together, a line at a time in the order interleave
  // gives: each player is { walls, play(i) }; end(si) once a session's last
  // line has played (a session with no lines, before any line plays)
  function playInterleaved(players, end = () => {}) {
    const left = players.map((p) => p.walls.length);
    const order = interleave(players.map((p) => p.walls));
    players.forEach((p, si) => { if (!left[si]) end(si); });
    for (const [si, li] of order) {
      players[si].play(li);
      if (--left[si] === 0) end(si);
    }
  }

  // Plays sessions forward. `initial` is the chapters as earlier recordings
  // left them (for `b` lines that continue). Returns the chapters as the
  // last session leaves them, every `w` and whether the replay hashed to
  // it, every place the replay couldn't follow, and each chapter's edits
  // since its last full `b` (counted on from opts.edited).
  function replay(sessions, initial = {}, opts = {}) {
    const doc = docOf(initial);
    const edited = { ...(opts.edited || {}) };
    const writes = [];
    const problems = [];
    sessions.forEach((session, si) => {
      let lines = session;
      if (typeof session === 'string') {
        const parsed = parseSession(session);
        if (!parsed.known) { problems.push({ session: si, line: 1, reason: 'format' }); return; }
        lines = parsed.lines;
      }
      playLines(lines, doc, { si, edited, writes, problems });
    });
    return { chapters: htmlOf(doc), writes, problems, edited };
  }

  // The core check: every write in these sessions is what replaying them gives.
  function replayCheck(sessions, initial = {}) {
    const r = replay(sessions, initial);
    const bad = r.writes.filter((w) => !w.ok);
    return { ok: !bad.length && !r.problems.length, writes: r.writes.length, bad, problems: r.problems, chapters: r.chapters };
  }

  /* ---------- days ---------- */

  // The writer's day a session belongs to: its header's `day`, or (before
  // sessions carried one) the date it started in its own time zone
  function sessionDay(header) {
    if (!header) return null;
    if (typeof header.day === 'string' && /^\d{4}-\d\d-\d\d$/.test(header.day)) return header.day;
    const ms = Date.parse(header.startedAt);
    if (!Number.isFinite(ms)) return null;
    try {
      const parts = {};
      const f = new Intl.DateTimeFormat('en-US', { timeZone: header.tz || undefined, year: 'numeric', month: '2-digit', day: '2-digit' });
      for (const p of f.formatToParts(new Date(ms))) parts[p.type] = p.value;
      if (parts.year && parts.month && parts.day) return `${parts.year}-${parts.month}-${parts.day}`;
    } catch { /* a time zone this engine doesn't know */ }
    return new Date(ms).toISOString().slice(0, 10);
  }

  // How many bins a chapter's marks are counted in, on the overview: one per
  // 500 words, at least 8 and at most 64
  const binsFor = (words) => Math.max(8, Math.min(64, Math.ceil(words / 500)));
  const ACTIVE_GAP = 60000; // keys or edits further apart than this aren't time spent writing

  // One session played onto doc (in place), and what it did, for the
  // overview and the list of days: when it ran and for how long it was
  // written in (gaps of a minute or more left out), its keys, and for each
  // chapter it changed the words added and removed, its words at the end,
  // and the characters its splices inserted and deleted in each bin
  // (placed by where the splice was, as a share of the chapter's length
  // then; a paragraph written and thrown away in one sitting is seen). Also
  // the chapter order it left, chapters born (with how) and deleted, and
  // chapters it lost track of. Text that came while nothing was recording
  // (catch-up), from another device (QUIET) and text written before the
  // recording began (baseline) count as nobody's words. With `page`, the
  // session is `device`'s, played onto its copies (doc is ignored).
  function playSession(text, doc, opts) {
    const p = sessionPlayer(text, doc, opts);
    for (let i = 0; i < p.walls.length; i++) p.play(i);
    return p.finish();
  }

  // …a line at a time, to play with others (playInterleaved): { walls,
  // play(i), finish() }, finish() giving the stats
  function sessionPlayer(text, doc, { edited = null, si = 0, page = null, device = '' } = {}) {
    if (page) doc = page.device(device);
    const parsed = parseSession(text);
    const head = parsed.header || {};
    const wall0 = Date.parse(head.startedAt);
    const out = {
      id: head.session || null, day: sessionDay(parsed.header), start: Number.isFinite(wall0) ? wall0 : null, end: null,
      ms: 0, keys: 0, chapters: {}, streams: [], order: null, lost: [], caught: {}, problems: []
    };
    if (!parsed.known) {
      out.problems.push({ session: si, line: 1, reason: 'format' });
      out.end = out.start;
      return { walls: [], play() {}, finish: () => out };
    }
    const start = {}; // ch -> its HTML when the session first changed it
    const marks = {}; // ch -> [share, inserted, deleted] for every splice
    const born = {};
    const gone = {};
    let lastActive = null;
    const active = (t) => {
      if (lastActive !== null && t - lastActive < ACTIVE_GAP) out.ms += t - lastActive;
      lastActive = t;
    };
    const touch = (ch) => { if (!(ch in start)) start[ch] = doc[ch] ? doc[ch].toString() : ''; };
    // Words that came quietly after the session began changing a chapter (a
    // copy adopted from another device) aren't its words either: each such
    // run's words are taken off what the chapter's start and end say
    const quiet = {}; // ch -> the chapter as such a run began
    const taken = {}; // ch -> [added, removed] by those runs
    const unquiet = (ch) => {
      if (quiet[ch] === undefined) return;
      const wc = wordChange(quiet[ch], doc[ch] ? doc[ch].toString() : '');
      delete quiet[ch];
      const x = taken[ch] || (taken[ch] = [0, 0]);
      x[0] += wc.added;
      x[1] += wc.removed;
    };
    let wallAt = out.start;
    let wallT = 0;
    const on = {
      edit(ch, at, del, ins, why, t) {
        active(t);
        if (QUIET.has(why)) {
          out.caught[ch] = (out.caught[ch] || 0) + del + ins.length;
          if (ch in start && quiet[ch] === undefined) quiet[ch] = doc[ch].toString();
          return;
        }
        unquiet(ch);
        touch(ch);
        const len = doc[ch].length;
        (marks[ch] = marks[ch] || []).push([len ? at / len : 0, ins.length, del]);
      },
      base(ch, html, why) {
        if (QUIET.has(why)) {
          if (!(ch in doc) && !(ch in start)) start[ch] = html; // as it was: nobody's words
          return;
        }
        unquiet(ch);
        touch(ch);
        if (!doc[ch]) born[ch] = why;
        delete gone[ch];
      },
      drop(ch, why) {
        unquiet(ch);
        touch(ch);
        if (!doc[ch]) return;
        const text = textOf(doc[ch].toString());
        const lead = (text.split('\n').find((p) => p.trim()) || '').trim().replace(/\s+/g, ' ');
        gone[ch] = { why, words: (text.match(WORD) || []).length, lead: lead.length > 40 ? lead.slice(0, 38).trimEnd() + '…' : lead };
      },
      order(list) { out.order = list.slice(); },
      // (only a session with tags has the field, so the stats of one without are as they were)
      tag(line, t, i) {
        (out.tags || (out.tags = [])).push({ id: line[2], label: line[3], at: line[4] || null, made: line[5] || null, wall: wallAt === null ? null : wallAt + t - wallT, line: i + 2 });
      },
      key(t) { out.keys++; active(t); },
      wall(ms, t) { if (Number.isFinite(ms)) { wallAt = ms; wallT = t; } }
    };
    const lp = linePlayer(parsed.lines, doc, { si, edited, on, problems: out.problems, page, device });
    return { walls: lineWalls(parsed.header, parsed.lines).walls, play: lp.play, finish: () => finish(lp.time()) };

    function finish(t) {
      for (const ch of Object.keys(quiet)) unquiet(ch);
      out.end = wallAt === null ? null : wallAt + t - wallT;
      for (const ch of new Set([...Object.keys(start), ...Object.keys(marks)])) {
        const now = doc[ch] ? doc[ch].toString() : '';
        const was = start[ch] !== undefined ? start[ch] : now;
        if (was === now && !marks[ch] && !born[ch] && !gone[ch]) continue;
        // notes, titles, the outline, stickies: written in, but no chapter's words
        if (isStream(ch)) { out.streams.push(ch); continue; }
        const wc = wordChange(was, now);
        const words = doc[ch] ? wc.words : gone[ch] ? gone[ch].words : 0;
        const n = binsFor(words);
        const ins = new Array(n).fill(0);
        const del = new Array(n).fill(0);
        for (const [share, i, d] of marks[ch] || []) {
          const k = Math.min(n - 1, Math.floor(share * n));
          ins[k] += i;
          del[k] += d;
        }
        const [ta, tr] = taken[ch] || [0, 0];
        const c = { added: Math.max(0, wc.added - ta), removed: Math.max(0, wc.removed - tr), words, ins, del };
        if (born[ch]) c.born = born[ch];
        if (gone[ch] && !doc[ch]) { c.gone = gone[ch].why; c.lead = gone[ch].lead; }
        out.chapters[ch] = c;
      }
      for (const p of out.problems) if (p.chapter && !doc[p.chapter] && !out.lost.includes(p.chapter)) out.lost.push(p.chapter);
      return out;
    }
  }

  // A day's numbers, from its sessions' stats: sessions, time spent
  // writing, keys, words added and removed, the chapters it touched, and
  // the streams (notes, titles, outline, stickies) it changed
  function dayStats(stats) {
    const out = { sessions: stats.length, ms: 0, keys: 0, added: 0, removed: 0, chapters: [], streams: [], start: null, end: null };
    const touched = new Set();
    const streams = new Set();
    for (const s of stats) {
      out.ms += s.ms;
      out.keys += s.keys;
      for (const [ch, c] of Object.entries(s.chapters)) { out.added += c.added; out.removed += c.removed; touched.add(ch); }
      for (const ch of s.streams || []) streams.add(ch);
      if (s.start !== null && (out.start === null || s.start < out.start)) out.start = s.start;
      if (s.end !== null && (out.end === null || s.end > out.end)) out.end = s.end;
    }
    out.chapters = [...touched];
    out.streams = [...streams];
    return out;
  }

  // The tags of a history, from its sessions' stats ({ id, device, day,
  // stats }, every device's): the last line for each id is the tag, and
  // one whose last line has label false was removed. A tag's moment (at) is
  // [session, line, device]: its own line, or the earlier moment it names.
  // Tags whose moment is in a session the history doesn't hold are left
  // out. Oldest moment first: { id, label (null: NEO's own), made, at,
  // when (the moment's time), day, session (index into sessions), madeAt }
  function tagsOf(sessions) {
    const where = new Map(sessions.map((s, i) => [(s.device || '') + '/' + s.id, i]));
    const lines = [];
    sessions.forEach((s, si) => { for (const x of (s.stats && s.stats.tags) || []) lines.push({ ...x, si }); });
    const wall = (x) => (Number.isFinite(x.wall) ? x.wall : 0);
    lines.sort((a, b) => wall(a) - wall(b) || a.si - b.si || a.line - b.line);
    const last = new Map();
    for (const x of lines) last.set(x.id, x);
    const out = [];
    for (const x of last.values()) {
      if (x.label === false || typeof x.id !== 'string') continue;
      const s = sessions[x.si];
      const past = Array.isArray(x.at);
      const at = past ? x.at.slice(0, 3) : [s.id, x.line, s.device || ''];
      const k = where.get((at[2] || '') + '/' + at[0]);
      if (k === undefined || !Number.isInteger(at[1])) continue;
      const when = past ? Date.parse(x.at[3]) : x.wall;
      out.push({
        id: x.id, label: typeof x.label === 'string' ? x.label : null, made: x.made || null, at,
        when: Number.isFinite(when) ? when : null, day: sessions[k].day, session: k, madeAt: Number.isFinite(x.wall) ? x.wall : null
      });
    }
    return out.sort((a, b) => (a.when || 0) - (b.when || 0) || a.session - b.session || a.at[1] - b.at[1]);
  }

  // Where a moment [session, line, device] is in a History: the steps played
  // once every line of that session up to `line` has (line 1: the session's
  // start), or -1 when the History doesn't hold the session
  function momentStep(h, ref) {
    const k = h.sessions.findIndex((x) => x && x.id === ref[0] && (x.device || '') === (ref[2] || ''));
    if (k < 0) return -1;
    const x = h.sessions[k];
    let n = x.from + 1;
    for (let i = x.from; i < x.to; i++) if (h.steps[i].session === k && h.steps[i].line <= ref[1]) n = i + 1;
    return Math.min(n, h.steps.length);
  }

  // Where skipping to an earlier (dir -1) or later (dir 1) session lands,
  // from session `from` of `sessions` (each with its stats): with `ch`,
  // only on sessions that changed that chapter. Going back from inside a
  // session goes to its own start first, as a music player's back button
  // does; from its start (atStart), to the one before. -1: nowhere to go.
  function sessionSkip(sessions, from, dir, { ch = null, atStart = false } = {}) {
    const fits = (i) => !ch || !!(sessions[i] && sessions[i].stats && sessions[i].stats.chapters[ch]);
    if (dir < 0 && !atStart && fits(from)) return from;
    for (let i = from + dir; i >= 0 && i < sessions.length; i += dir) if (fits(i)) return i;
    return -1;
  }

  // The chapters a session's lines name, for a session that can't be read
  // through: its replay stops for them.
  function chaptersNamed(text) {
    const out = new Set();
    for (const raw of splitLines(text).lines) {
      const l = parseLine(raw);
      if (!Array.isArray(l)) continue;
      if (l[1] === 'b' || l[1] === 'ch' || l[1] === 'd') out.add(l[2]);
      else if (l[1] === 'w' && l.length > 3) out.add(l[3]);
    }
    return [...out];
  }

  // Builds the cache's days for a book, oldest first, from every device's
  // sessions (each day's in sessionOrder). Each day is played from the end
  // of the day before through a Page, and comes out as an entry for the
  // index and a file:
  //   entry  { day, key, sessions: [{ id, device, head, stats }], stats,
  //            kinds, devices: { device: kinds }, links, lost }
  //   file   { day, chapters: { ch: { full } | { ops } | null },
  //            devices: { device: { ch: { full } | { ops } | null | { page: 1 } } } }
  // chapters is the page's end state of each chapter the day changed there,
  // and devices each device's own (a `continue` resolves against it). A
  // chapter is kept whole the first day it has one, and again once the
  // diffs since its last whole state come to more than it would; otherwise
  // as a paragraph diff (paraDiff) from the day before. kinds says which,
  // for each chapter the day changed: 0 whole, n the diff's size, -1 gone
  // (deleted, or lost track of), and on a device's, -2 the page's copy
  // (the page showed that device's copy at the day's end: { page: 1 }).
  // null in the file is gone. links: which device's copy the page showed of
  // each chapter at the day's end. A day's key is a hash of PLAYER and every
  // session up to its end, so a day whose sessions (or any before them)
  // changed is built again. A session whose chain doesn't verify isn't
  // played: the chapters it names are lost until their next full `b`.
  class DayBuilder {
    constructor(doc = {}, { key = 'player ' + PLAYER, since = {}, page = null } = {}) {
      this.page = page || Page.one(doc);
      this.key = key;
      this.since = { page: {}, ...since }; // stream -> ch -> the size of its diffs since its last whole state
    }

    // the page's chapters
    get doc() { return this.page.doc; }

    day(day, sessions) {
      const pg = this.page;
      const snap = (doc) => {
        const out = {};
        for (const [ch, c] of Object.entries(doc)) out[ch] = c.parts.slice();
        return out;
      };
      const devices = [...new Set(sessions.map((s) => s.device || ''))];
      const before = { page: snap(pg.doc) };
      for (const d of devices) before[d] = snap(pg.device(d));
      const entry = { day, key: null, sessions: [], stats: null, kinds: {}, devices: {}, links: {}, lost: [] };
      const file = { day, chapters: {}, devices: {} };
      // the sessions, their lines in the order they were written (interleave)
      const stats = [];
      const players = sessions.map((s, si) => {
        const device = s.device || '';
        const chain = verifyChain(s.text);
        this.key = sha256(this.key + ':' + device + '/' + s.id + ':' + (chain.last || ''));
        entry.sessions.push({ id: s.id, device, head: chain.last, stats: null });
        if (chain.ok) {
          const p = sessionPlayer(s.text, null, { si, page: pg, device });
          return { walls: p.walls, play: p.play, finish: p.finish };
        }
        // where it began: the chapters it names are lost
        const head = parseSession(s.text).header;
        const wall = head ? Date.parse(head.startedAt) : NaN;
        const st = { id: s.id, day, start: Number.isFinite(wall) ? wall : null, end: Number.isFinite(wall) ? wall : null, ms: 0, keys: 0, chapters: {}, streams: [], order: null, lost: [], caught: {}, problems: [{ session: si, line: chain.verified + 1, reason: 'chain' }], damaged: true };
        return { walls: [wall], play: () => { for (const ch of chaptersNamed(s.text)) if (pg.lose(device, ch)) st.lost.push(ch); }, finish: () => st };
      });
      playInterleaved(players, (si) => { stats[si] = players[si].finish(); });
      entry.sessions.forEach((x, si) => {
        x.stats = stats[si];
        for (const ch of x.stats.lost) if (!entry.lost.includes(ch)) entry.lost.push(ch);
      });
      entry.key = this.key;
      // what changed on the page, then on each device that played
      const kept = (stream, was, doc, kinds, out, asPage) => {
        const since = this.since[stream] || (this.since[stream] = {});
        for (const ch of new Set([...Object.keys(was), ...Object.keys(doc)])) {
          if (!doc[ch]) {
            if (was[ch]) { out[ch] = null; kinds[ch] = -1; delete since[ch]; }
            continue;
          }
          const now = doc[ch].parts;
          const w = was[ch];
          if (w && w.length === now.length && w.every((p, i) => p === now[i])) continue;
          if (asPage && asPage(ch)) {
            out[ch] = { page: 1 };
            kinds[ch] = -2;
            since[ch] = 0;
            continue;
          }
          const ops = w && paraDiff(w, now);
          const size = ops ? JSON.stringify(ops).length : 0;
          if (!ops || (since[ch] || 0) + size > doc[ch].length) {
            out[ch] = { full: doc[ch].toString() };
            kinds[ch] = 0;
            since[ch] = 0;
          } else {
            out[ch] = { ops };
            kinds[ch] = Math.max(1, size);
            since[ch] = (since[ch] || 0) + size;
          }
        }
      };
      kept('page', before.page, pg.doc, entry.kinds, file.chapters, null);
      for (const d of devices) {
        const kinds = {};
        const out = {};
        const doc = pg.device(d);
        kept(d, before[d], doc, kinds, out, (ch) => pg.doc[ch] === doc[ch]);
        if (Object.keys(kinds).length) { entry.devices[d] = kinds; file.devices[d] = out; }
      }
      entry.links = pg.links();
      entry.stats = dayStats(entry.sessions.map((x) => x.stats));
      return { entry, file };
    }

    // A builder that carries on after the days in `entries` (an index), its
    // state rebuilt from their files
    static after(entries, readDay) {
      const since = { page: {} };
      const add = (stream, kinds) => {
        const s = since[stream] || (since[stream] = {});
        for (const [ch, k] of Object.entries(kinds || {})) {
          if (k === -1) delete s[ch]; else s[ch] = k === 0 || k === -2 ? 0 : (s[ch] || 0) + k;
        }
      };
      for (const e of entries) {
        add('page', e.kinds);
        for (const [d, kinds] of Object.entries(e.devices || {})) add(d, kinds);
      }
      const b = new DayBuilder({}, { key: entries.length ? entries[entries.length - 1].key : undefined, since, page: pageState(entries, entries.length, readDay) });
      return b;
    }
  }

  // A stream of the cache's days: the page's, or a device's
  const kindsOf = (e, stream) => (stream === 'page' ? e.kinds : e.devices && e.devices[stream]) || {};
  const devicesOf = (entries, upto = entries.length) => {
    const out = new Set();
    for (let i = 0; i < upto; i++) for (const d of Object.keys(entries[i].devices || {})) out.add(d);
    return [...out];
  };

  // The chapters as the first `upto` days of an index left them (the start
  // state of day `upto`) on one stream (the page, unless a device is named),
  // from each chapter's last whole state and the diffs after it. readDay(day)
  // gives that day's file; it reads at most the files that hold each
  // chapter's last whole state and the diffs since (and, for a device's copy
  // that was the page's, the page's).
  function dayState(entries, upto, readDay, stream = 'page') {
    const files = new Map();
    const read = (i) => {
      if (!files.has(i)) files.set(i, readDay(entries[i].day));
      return files.get(i);
    };
    // a chapter's paragraphs once the first n days have been played, or null
    const at = (s, ch, n) => {
      let li = n - 1;
      while (li >= 0 && kindsOf(entries[li], s)[ch] === undefined) li--;
      if (li < 0) return null;
      let f = li;
      for (;;) {
        if (f < 0) return null; // no whole state to start from: lost
        const k = kindsOf(entries[f], s)[ch];
        if (k === 0 || k === -2) break;
        if (k === -1) return null;
        f--;
      }
      let parts = null;
      for (let i = f; i <= li; i++) {
        const k = kindsOf(entries[i], s)[ch];
        if (k === undefined) continue;
        if (k === -2) { parts = at('page', ch, i + 1); if (!parts) return null; continue; }
        const file = read(i);
        const chs = file && (s === 'page' ? file.chapters : file.devices && file.devices[s]);
        const d = chs ? chs[ch] : undefined;
        if (!d) return null;
        parts = d.full !== undefined ? paragraphs(d.full) : parts && paraPatch(parts, d.ops);
        if (!parts) return null;
      }
      return parts;
    };
    const chs = new Set();
    for (let i = 0; i < upto; i++) for (const ch of Object.keys(kindsOf(entries[i], stream))) chs.add(ch);
    const doc = {};
    for (const ch of chs) {
      const parts = at(stream, ch, upto);
      if (parts) doc[ch] = ChapterText.of(parts);
    }
    return doc;
  }

  // The page and every device's copies as the first `upto` days left them
  // (the start of day `upto`), as a Page to play on from
  function pageState(entries, upto, readDay) {
    const cache = new Map();
    const read = (day) => {
      if (!cache.has(day)) cache.set(day, readDay(day));
      return cache.get(day);
    };
    const p = new Page();
    p.doc = dayState(entries, upto, read, 'page');
    for (const d of devicesOf(entries, upto)) p.docs[d] = dayState(entries, upto, read, d);
    p.link(upto ? entries[upto - 1].links : {});
    return p;
  }

  /* ---------- search ---------- */

  // Text as search matches it: case-folded (unless `cs`, a search in the
  // same case), NFC, curly quotes as straight ones, any run of whitespace
  // one space. normMap also says where each
  // character came from in the text (from[k] to to[k]), so a match can be
  // drawn on the page: a letter and the accents after it are folded
  // together, and a character that folds to two keeps the place of one.
  const SPACE = /\s/u;
  const QUOTE = { '’': '\'', '‘': '\'', 'ʼ': '\'', '“': '"', '”': '"' };
  const QUOTES = /[’‘ʼ“”]/g;
  const FINAL_SIGMA = /ς/g; // a word's last sigma is a sigma
  function normMap(text, cs = false) {
    let s = '';
    const from = [];
    const to = [];
    const seg = /\P{M}\p{M}*|\p{M}+/gu;
    let m;
    while ((m = seg.exec(text))) {
      const a = m.index;
      const b = a + m[0].length;
      let x;
      if (SPACE.test(m[0][0])) {
        if (s.endsWith(' ')) { to[to.length - 1] = b; continue; }
        x = ' ';
      } else x = QUOTE[m[0]] || fold(m[0].normalize('NFC'), cs);
      for (let k = 0; k < x.length; k++) { from.push(a); to.push(b); }
      s += x;
    }
    return { s, from, to };
  }
  // (the same without the places, as search tests every paragraph)
  const normText = (text, cs = false) => fold(String(text).normalize('NFC'), cs)
    .replace(QUOTES, (c) => QUOTE[c]).replace(/\s+/gu, ' ');
  function fold(s, cs) { return cs ? s : s.toLowerCase().replace(FINAL_SIGMA, 'σ'); }

  // Where a folded phrase is in folded text: with `word` (the default), a
  // phrase that starts or ends with a letter or digit is a match only where
  // it starts or ends a word, so "John" is in "John's" and not in
  // "Johnson"; without it, anywhere. Never overlapping.
  const WORDCH = /[\p{L}\p{N}]/u;
  function phraseIn(s, q, word = true) {
    const out = [];
    if (!q) return out;
    const head = word && WORDCH.test(q[0]);
    const tail = word && WORDCH.test(q[q.length - 1]);
    for (let i = s.indexOf(q); i >= 0; i = s.indexOf(q, i + 1)) {
      if (head && i > 0 && WORDCH.test(s[i - 1])) continue;
      if (tail && i + q.length < s.length && WORDCH.test(s[i + q.length])) continue;
      out.push(i);
      i += q.length - 1;
    }
    return out;
  }

  // A search: the phrase and how it matches, { text, word, cs }. word: only
  // whole words (on unless false); cs: only in the same case. A string is
  // the phrase with both defaults. Returns { q (the phrase folded), word, cs }.
  function phraseQuery(phrase) {
    const p = phrase && typeof phrase === 'object' ? phrase : { text: phrase };
    const cs = !!p.cs;
    return { q: normText(p.text == null ? '' : p.text, cs).trim(), word: p.word !== false, cs };
  }

  // How often a phrase is in each chapter, kept a paragraph at a time: a
  // phrase never crosses a paragraph, so a chapter brought up to date
  // tests only the paragraphs between what's the same at its start and its
  // end. set(ch, parts) gives a chapter its paragraphs now (null: gone) and
  // returns [was, now], its count before and after.
  class PhraseTally {
    constructor(phrase) {
      Object.assign(this, phraseQuery(phrase));
      this.chapters = {}; // ch -> { parts, counts, total }
      this.total = 0;
    }

    count(p) {
      const x = paraText(p);
      return x === null ? 0 : phraseIn(normText(x, this.cs), this.q, this.word).length;
    }

    of(ch) { return this.chapters[ch] ? this.chapters[ch].total : 0; }

    set(ch, parts) {
      if (isStream(ch)) return [0, 0]; // search looks in the chapters
      const st = this.chapters[ch];
      const was = st ? st.total : 0;
      if (!parts) {
        if (st) { delete this.chapters[ch]; this.total -= was; }
        return [was, 0];
      }
      let counts;
      let now;
      if (!st) {
        counts = parts.map((p) => this.count(p));
        now = counts.reduce((a, b) => a + b, 0);
      } else {
        const old = st.parts;
        let a = 0;
        const n = Math.min(old.length, parts.length);
        while (a < n && old[a] === parts[a]) a++;
        let oe = old.length;
        let ne = parts.length;
        while (oe > a && ne > a && old[oe - 1] === parts[ne - 1]) { oe--; ne--; }
        if (a === oe && a === ne) return [was, was];
        const mid = [];
        now = was;
        // a paragraph the same as one the chapter had keeps its count (a
        // chapter kept whole again in the cache is new strings, mostly the same)
        const had = oe - a > 4 ? new Map() : null;
        for (let k = a; k < oe; k++) { now -= st.counts[k]; if (had) had.set(old[k], st.counts[k]); }
        for (let k = a; k < ne; k++) {
          const c = had && had.has(parts[k]) ? had.get(parts[k]) : this.count(parts[k]);
          mid.push(c);
          now += c;
        }
        counts = st.counts.slice(0, a).concat(mid, st.counts.slice(oe));
      }
      // (a ChapterText changes its parts in place: the tally keeps its own copy)
      this.chapters[ch] = { parts: parts.slice(), counts, total: now };
      this.total += now - was;
      return [was, now];
    }
  }

  // Search's first pass (docs/neo-recording-plan.md, Search): a walk through
  // the cache's day states, oldest first, counting the phrase in each
  // chapter as each day left it. A day's diff names the paragraphs it kept,
  // so only its new paragraphs are tested. Returns, for each of the first
  // `upto` days, { day, before, after (the book's count), changes: [{ ch,
  // was, now, lost }] }, with the tally and each chapter's paragraphs at the
  // end, to play on from.
  function phraseDays(entries, readDay, phrase, upto = entries.length) {
    const tally = new PhraseTally(phrase);
    const parts = {};
    const days = [];
    for (let i = 0; i < upto; i++) {
      const e = entries[i];
      const before = tally.total;
      const changes = [];
      const chs = Object.keys(e.kinds);
      const file = chs.length ? readDay(e.day) : null;
      for (const ch of chs) {
        const d = file && file.chapters ? file.chapters[ch] : undefined;
        let next = null;
        if (e.kinds[ch] !== -1 && d) next = d.full !== undefined ? paragraphs(d.full) : parts[ch] ? paraPatch(parts[ch], d.ops) : null;
        if (next) parts[ch] = next; else delete parts[ch];
        const [was, now] = tally.set(ch, next);
        if (was !== now) changes.push({ ch, was, now, lost: !next && (e.lost || []).includes(ch) });
      }
      days.push({ day: e.day, before, after: tally.total, changes });
    }
    return { days, tally, parts };
  }

  // Sessions ({ text, device }, in the order they play) played onto a Page
  // (or one device's chapters), with the tally of the page kept up at every
  // `w`, every `b` that sets a chapter whole, and each session's end (or,
  // with `writes` false, only at its end): the moments the recording says
  // what a chapter was. Returns an event for each look that found a chapter's count
  // changed, { si, ch, was, now, before, after } (before and after: the
  // book's, see phraseGroups). A session whose chain doesn't verify isn't
  // played, as the day builder doesn't play it: the chapters it names go.
  function phraseSessions(sessions, page, tally, { writes = true, check = true } = {}) {
    if (!(page instanceof Page)) { const p = new Page(); p.docs[''] = page; p.doc = { ...page }; page = p; }
    const doc = page.doc; // (the page's chapters: Page changes them in place)
    const events = [];
    // a new group once the page changes
    const look = (si, ch) => {
      const before = tally.total;
      const [was, now] = tally.set(ch, doc[ch] ? doc[ch].parts : null);
      if (was !== now) events.push({ si, ch, was, now, before, after: tally.total, g: page.changes });
    };
    const players = sessions.map((s, si) => {
      const text = typeof s === 'string' ? s : s.text;
      const device = (s && s.device) || '';
      const parsed = parseSession(text);
      if (check && !verifyChain(text).ok) {
        const wall = parsed.header ? Date.parse(parsed.header.startedAt) : NaN;
        return { walls: [wall], play: () => { for (const ch of chaptersNamed(text)) { page.lose(device, ch); look(si, ch); } } };
      }
      if (!parsed.known) return { walls: [], play() {} };
      const on = {};
      if (writes) { on.write = (ch) => look(si, ch); on.whole = (ch) => look(si, ch); }
      const lp = linePlayer(parsed.lines, null, { si, on, page, device });
      return { walls: lineWalls(parsed.header, parsed.lines).walls, play: lp.play };
    });
    // and at each session's end
    playInterleaved(players, (si) => { for (const ch of new Set([...Object.keys(doc), ...Object.keys(tally.chapters)])) look(si, ch); });
    return phraseGroups(events);
  }

  // Looks with no change to the text between them are one moment (a chunk's
  // writes, a session's end): each event in it gets the book's count before
  // the first and after the last, so the order chapters are looked at in
  // never matters. g: the group.
  function phraseGroups(events) {
    for (let a = 0; a < events.length;) {
      let b = a + 1;
      while (b < events.length && events[b].g === events[a].g) b++;
      const before = events[a].before;
      const after = events[b - 1].after;
      for (let k = a; k < b; k++) { events[k].before = before; events[k].after = after; delete events[k].g; }
      a = b;
    }
    return events;
  }

  // What the passes found, from days as phraseDays gives them (the open
  // sessions' day may follow, made the same way):
  //   first  the first day the phrase was in the book at the day's end
  //   last   the last day the book's count of it went up
  //   out    the day it left the book for good, if it has
  //   moved  each day it left one chapter and came into another
  // each { day, ch } (moved: { day, from, to }), and `now`: how often it is
  // in each chapter at the end.
  function phraseFindings(days, tally) {
    const out = { first: null, last: null, out: null, moved: [], now: {}, total: tally.total };
    const rise = (d) => d.changes.filter((c) => c.now > c.was).sort((a, b) => (b.now - b.was) - (a.now - a.was))[0];
    for (const d of days) {
      if (!out.first && d.before === 0 && d.after > 0) out.first = { day: d.day, ch: rise(d).ch };
      if (d.after > d.before) out.last = { day: d.day, ch: rise(d).ch };
      const fell = d.changes.filter((c) => c.now < c.was && !c.lost);
      if (d.before > 0 && d.after === 0 && fell.length) out.out = { day: d.day, ch: fell[0].ch };
      const up = d.changes.filter((c) => c.now > c.was);
      for (const f of fell) for (const u of up) if (u.ch !== f.ch) { out.moved.push({ day: d.day, from: f.ch, to: u.ch }); break; }
    }
    if (tally.total > 0) out.out = null;
    for (const [ch, c] of Object.entries(tally.chapters)) if (c.total) out.now[ch] = c.total;
    return out;
  }

  // A day the player has built, looked at as search's second pass looks at
  // sessions (phraseSessions): each chapter's count is taken at each of its
  // `w` lines, at each `b` that sets it whole, and at every session's end. Returns the book's count at the
  // day's start and an event for each look that found a chapter's count
  // changed, { n (steps played then), ch, was, now, before, after (the
  // book's), step }. step is the step after which the chapter's count
  // reached `now` and stayed there until the look, so a name passed through
  // while typing a longer one ("John" on the way to "Johnson") is never the
  // moment.
  function phraseEvents(h, phrase) {
    const live = new PhraseTally(phrase);
    const doc = docOf(h.start || {});
    for (const [ch, c] of Object.entries(doc)) live.set(ch, c.parts);
    const saved = {};
    for (const [ch, c] of Object.entries(live.chapters)) saved[ch] = c.total;
    const start = live.total;
    let total = start;
    const changes = {}; // ch -> [[step, before, after]] since its last look
    const events = [];
    let g = 0; // a new group once the text changes
    const look = (ch, n) => {
      const was = saved[ch] || 0;
      const now = live.of(ch);
      const cs = changes[ch] || [];
      delete changes[ch];
      if (now === was) return;
      let step = -1;
      for (let k = cs.length - 1; k >= 0; k--) {
        const [i, b, a] = cs[k];
        if (now > was ? b < now && a >= now : b > now && a <= now) { step = i; break; }
      }
      if (now) saved[ch] = now; else delete saved[ch];
      events.push({ n, ch, was, now, before: total, after: total + now - was, step, g });
      total += now - was;
    };
    const ends = new Set(h.sessions.map((s) => s.to));
    let wi = 0;
    const lookAt = (n) => {
      while (wi < h.writes.length && h.writes[wi].n <= n) { const w = h.writes[wi++]; look(w.ch, w.n); }
      if (ends.has(n)) for (const ch of new Set([...Object.keys(live.chapters), ...Object.keys(saved)])) look(ch, n);
    };
    for (let i = 0; i < h.steps.length; i++) {
      lookAt(i);
      const s = h.steps[i];
      if (h.bad.has(i)) continue;
      h.apply(doc, i);
      // (a step another device's copy took and the page didn't changes nothing)
      if (s.ch && (s.k === 'b' || s.k === 'e' || s.k === 'd') && (s.page !== false || s.sync !== undefined)) {
        const [b, a] = live.set(s.ch, doc[s.ch] ? doc[s.ch].parts : null);
        if (a !== b) (changes[s.ch] = changes[s.ch] || []).push([i, b, a]);
        if (s.k !== 'b' || typeof s.html === 'string' || s.sync !== undefined) g++;
        if (s.k === 'b' && typeof s.html === 'string') look(s.ch, i + 1); // the chapter as recorded whole
      }
    }
    lookAt(h.steps.length);
    return { start, events: phraseGroups(events) };
  }

  // The event a finding means, in a day's events (from phraseEvents, or
  // phraseSessions with the day's start): first, a chapter it came into as
  // the book's count went up from none; last, the last that came into a
  // chapter as the count went above both the look before and the day's
  // start (a sentence moved within the day doesn't count); out, the last
  // that left a chapter as the count went to none; moved, the first time it
  // came into chapter `to`. null when the day has none.
  function phrasePick(events, start, kind, to = null) {
    if (kind === 'first') return events.find((e) => e.before === 0 && e.after > 0 && e.now > e.was) || null;
    if (kind === 'moved') return events.find((e) => e.ch === to && e.now > e.was) || null;
    for (let k = events.length - 1; k >= 0; k--) {
      const e = events[k];
      if (kind === 'last' ? e.after > e.before && e.after > start && e.now > e.was : e.before > 0 && e.after === 0 && e.now < e.was) return e;
    }
    return null;
  }

  /* ---------- history: what the player plays ---------- */

  // Where a tag that opens at i closes, minding quoted attribute values
  function tagEnd(html, i) {
    let q = 0;
    for (let j = i + 1; j < html.length; j++) {
      const c = html.charCodeAt(j);
      if (q) { if (c === q) q = 0; } else if (c === 34 || c === 39) q = c; else if (c === 62) return j;
    }
    return html.length;
  }
  const ENTITY = /^&(#\d{1,7}|#x[0-9a-f]{1,6}|[a-z][a-z0-9]{1,30});/i;

  // How many characters of text come before `at` in a chapter's HTML: what a
  // walk over the rendered chapter's text nodes counts. Tags count nothing
  // (a <br> too), an entity counts as the character it stands for, and an
  // offset inside a tag or an entity counts from where it starts.
  function textOffset(html, at) {
    const end = Math.min(at, html.length);
    let n = 0;
    let i = 0;
    while (i < end) {
      const c = html.charCodeAt(i);
      if (c === 60) {
        i = tagEnd(html, i) + 1;
        continue;
      }
      if (c === 38) {
        const m = ENTITY.exec(html.slice(i, i + 40));
        if (m) {
          if (i + m[0].length > end) return n;
          const num = m[1][0] === '#' ? (m[1][1] === 'x' || m[1][1] === 'X' ? parseInt(m[1].slice(2), 16) : +m[1].slice(1)) : 0;
          n += num > 0xffff && num <= 0x10ffff ? 2 : 1;
          i += m[0].length;
          continue;
        }
      }
      n++;
      i++;
    }
    return n;
  }

  // A session's lines as the player's steps, on the session's own clock: t
  // is milliseconds from its header, wall the time of day it happened (from
  // the header, set again by every `T` line, so a computer asleep shows as a
  // jump in wall time, not as speed). Typing runs come out one step per
  // character. Every step has k (its kind), t, wall and line (its line
  // number, the header being 1), and:
  //   b  ch, html (null: as the last recording left it), hash, cause
  //   e  ch, at, del, ins, cause ('input' or the `x` it follows), input (its
  //      inputType code), key (a key was down: false for dictation and tools)
  //   s  ch, a [pIdx, off], f [pIdx, off], by ('' key, 'p' pointer, 'n' NEO)
  //   c  ch, what (copy, cut, paste), len, internal
  //   x  ch, cause, ref          d  ch, cause       o  order
  //   f  what                    end info
  // keys holds the moment of every key press.
  function compileSession(text) {
    const { header, lines } = parseSession(text);
    const steps = [];
    const keys = [];
    const keyLines = []; // the line each key is on
    const writes = []; // { ch, n: the steps before it, t, li: its line }
    let t = 0;
    let wallAt = header ? Date.parse(header.startedAt) : NaN;
    let wallT = 0;
    let cause = 'input';
    let head = null;
    const place = newPlace();
    const step = (s, i) => {
      s.t = t;
      s.wall = Number.isFinite(wallAt) ? wallAt + t - wallT : null;
      s.line = i + 2;
      steps.push(s);
    };
    lines.forEach((line, i) => {
      if (!Array.isArray(line)) return;
      const kind = line[1];
      const ch = place.cur;
      if (kind === 'r' || kind === 'rd') {
        const chars = kind === 'r' ? [...line[2]] : null;
        const dels = chars ? null : delKeys(line[2]);
        const count = chars ? chars.length : dels.length;
        let pos = line.length > 4 ? line[4] : place.end[ch];
        for (let j = 0; j < count; j++) {
          t += (j === 0 ? line[0] : line[3][j - 1]) || 0;
          keys.push(t);
          keyLines.push(i);
          if (chars) {
            step({ k: 'e', ch, at: pos, del: 0, ins: chars[j], cause: 'input', key: true }, i);
            pos += chars[j].length;
          } else {
            if (dels[j].back) pos--;
            step({ k: 'e', ch, at: pos, del: 1, ins: '', cause: 'input', key: true }, i);
          }
        }
        place.end[ch] = pos;
        return;
      }
      if (kind === 'n') {
        for (const l of navLines(line, place)) {
          t += l[0] || 0;
          if (l[1] === 'k') { keys.push(t); keyLines.push(i); }
          else step({ k: 's', ch, a: [l[2], l[3]], f: l.length >= 6 ? [l[4], l[5]] : [l[2], l[3]], by: '' }, i);
        }
        return;
      }
      t += line[0] || 0;
      if (kind === 'b') step({ k: 'b', ch: line[2], html: line[3], hash: line[4], cause: line[5] }, i);
      else if (kind === 'k') { keys.push(t); keyLines.push(i); } else if (kind === 'e') {
        const input = line[5];
        step({ k: 'e', ch, at: line[2], del: line[3], ins: line[4], cause: input ? 'input' : cause, input: input || '', key: !!input && line[6] !== 0 }, i);
      } else if (kind === 's') {
        const nums = line.slice(2).filter((v) => typeof v === 'number');
        const by = typeof line[line.length - 1] === 'string' ? line[line.length - 1] : '';
        const f = nums.length >= 4 ? [nums[2], nums[3]] : [nums[0], nums[1]];
        step({ k: 's', ch, a: [nums[0], nums[1]], f, by }, i);
      } else if (kind === 'c') step({ k: 'c', ch, what: line[2], len: line[3], internal: line[6] === true }, i);
      else if (kind === 'x') {
        cause = line[2];
        step({ k: 'x', ch, cause: line[2], ref: line.slice(3) }, i);
      } else if (kind === 'd') step({ k: 'd', ch: line[2], cause: line[3] }, i);
      else if (kind === 'o') step({ k: 'o', order: line[2] }, i);
      else if (kind === 'f') step({ k: 'f', what: line[2] }, i);
      else if (kind === 'T') {
        const w = Date.parse(line[2]);
        if (Number.isFinite(w)) { wallAt = w; wallT = t; }
      } else if (kind === 'h') head = line[3];
      else if (kind === 'end') step({ k: 'end', info: line[2] }, i);
      else if (kind === 'w') writes.push({ ch: line.length > 3 ? line[3] : ch, n: steps.length, t, li: i });
      track(place, line);
    });
    const { walls, ts } = lineWalls(header, lines);
    return { header, steps, keys, keyLines, duration: t, head, writes, walls, ts, lines: lines.length };
  }

  // Sessions (a day's, in the dialog; every device's, in sessionOrder) as
  // one timeline: their steps on one clock, a line at a time in the order
  // they were written (interleave), so sessions that overlap interleave.
  // A session that begins with none under way starts `gap` milliseconds
  // after the last one ended; one that overlaps another starts where the
  // time of day puts it. Each session starts with a step { k: 'session' };
  // its from and to are where its steps begin and end (another's can come
  // between). build(start) plays it all once from the chapters as they
  // were before it and keeps keyframes; state(n) is then the chapters
  // after n steps, as HTML, and doc(n) the same as ChapterTexts to play on.
  class History {
    constructor(sessions, { gap = 1500 } = {}) {
      this.steps = [];
      this.keys = [];
      this.sessions = [];
      this.orders = []; // indexes of the `o` steps
      this.writes = []; // { ch, n }: a `w` line, after n steps
      const cs = sessions.map((s) => compileSession(s.text));
      const next = cs.map(() => ({ step: 0, key: 0, write: 0 }));
      const shift = cs.map(() => 0); // a session's clock, on this one
      let T = 0;            // the clock at the last step
      let lastEnd = null;   // where the last session to end ended
      let lastWall = NaN;   // the time of day of the last line played
      let under = 0;        // sessions begun and not ended
      const begin = (si) => {
        const c = cs[si];
        const s = sessions[si];
        if (under && Number.isFinite(c.walls[0]) && Number.isFinite(lastWall)) shift[si] = T + Math.max(0, c.walls[0] - lastWall) - c.ts[0];
        else shift[si] = lastEnd === null ? 0 : lastEnd + gap;
        under++;
        const wall0 = c.header ? Date.parse(c.header.startedAt) : NaN;
        const t0 = Math.max(T, shift[si]);
        this.sessions[si] = {
          id: s.id, device: s.device, open: !!s.open, header: c.header, head: c.head, day: sessionDay(c.header),
          from: this.steps.length, to: this.steps.length, t0, t1: t0,
          wall0: Number.isFinite(wall0) ? wall0 : null, wall1: Number.isFinite(wall0) ? wall0 : null
        };
        this.steps.push({ k: 'session', t: t0, wall: this.sessions[si].wall0, line: 1, session: si });
        T = t0;
      };
      const end = (si) => {
        const x = this.sessions[si];
        x.to = this.steps.length;
        x.t1 = Math.max(x.t1, shift[si] + cs[si].duration);
        lastEnd = lastEnd === null ? x.t1 : Math.max(lastEnd, x.t1);
        under--;
      };
      const line = (si, li) => {
        const c = cs[si];
        const at = next[si];
        if (li === 0) begin(si);
        for (; at.step < c.steps.length && c.steps[at.step].line === li + 2; at.step++) {
          const st = c.steps[at.step];
          st.t = Math.max(T, st.t + shift[si]);
          T = st.t;
          st.session = si;
          if (st.k === 'o') this.orders.push(this.steps.length);
          this.steps.push(st);
          this.sessions[si].t1 = st.t;
          if (st.wall !== null) this.sessions[si].wall1 = st.wall;
        }
        for (; at.key < c.keys.length && c.keyLines[at.key] === li; at.key++) this.keys.push(c.keys[at.key] + shift[si]);
        for (; at.write < c.writes.length && c.writes[at.write].li === li; at.write++) this.writes.push({ ch: c.writes[at.write].ch, n: this.steps.length });
        if (Number.isFinite(c.walls[li])) lastWall = c.walls[li];
        if (li === c.lines - 1) end(si);
      };
      // (a session with no lines is where it begins, before any line plays)
      cs.forEach((c, si) => { if (!c.lines) { begin(si); end(si); } });
      for (const [si, li] of interleave(cs.map((c) => c.walls))) line(si, li);
      this.keys.sort((a, b) => a - b);
      this.duration = this.sessions.reduce((m, x) => Math.max(m, x.t1), 0);
      this.keyframes = [{ at: 0, chapters: {} }];
      this.bad = new Set();
      this.end = {};
    }

    // Plays every step once from `initial`, keeping the page every `every`
    // steps so a seek never plays more than that. A keyframe shares the
    // chapters that didn't change since the one before; none of them is
    // ever played on. `initial` is the page and each device's copies as the
    // day began ({ page, devices, links }, see Page), or one device's
    // chapters (HTML or ChapterTexts by chapter). Each step plays on its own
    // device's copy, and the page goes with it as Page says: a step it
    // doesn't go with gets `page: false`, and one where the page takes that
    // device's copy over, as it was, gets it as `sync`, so playing steps on
    // the page alone (apply) comes to the same page.
    build(initial = {}, { every = 2000 } = {}) {
      const pg = initial instanceof Page ? initial : initial && initial.page && initial.devices
        ? new Page(initial) : Page.one(initial, this.sessions.length ? this.sessions[0].device || '' : '');
      const doc = pg.doc;
      let kf = {};
      for (const [ch, c] of Object.entries(doc)) kf[ch] = c.clone();
      this.keyframes = [{ at: 0, chapters: kf }];
      this.start = htmlOf(doc);
      this.bad = new Set();
      let dirty = new Set();
      for (let i = 0; i < this.steps.length; i++) {
        if (i && i % every === 0) {
          kf = { ...kf };
          for (const ch of dirty) { if (doc[ch]) kf[ch] = doc[ch].clone(); else delete kf[ch]; }
          dirty = new Set();
          this.keyframes.push({ at: i, chapters: kf });
        }
        const st = this.steps[i];
        if (!st.ch || !(st.k === 'b' || st.k === 'e' || st.k === 'd')) continue;
        delete st.page;
        delete st.sync;
        const d = this.sessions[st.session].device || '';
        const quiet = QUIET.has(st.cause);
        const how = pg.take(d, st.ch, quiet);
        // the page takes this device's copy over: as it was, where that isn't what the page shows
        const sync = how === TAKE && (st.k === 'e' || (st.k === 'b' && typeof st.html !== 'string')) ? pg.syncOf(d, st.ch) : undefined;
        if (!this.apply(pg.device(d), i, true)) { this.bad.add(i); continue; }
        if (!how) st.page = false;
        if (sync !== undefined) st.sync = sync;
        pg.after(d, st.ch, how, !(st.k === 'b' && typeof st.html !== 'string'));
        if (quiet && !this.quietGoesOn(i + 1, st.ch)) {
          const html = pg.settle(d, st.ch);
          if (html !== undefined) st.sync = html; // (st.page is false: the page didn't go with it)
        }
        dirty.add(st.ch);
      }
      this.page = pg;
      this.endDoc = doc;
      this.end = htmlOf(doc);
    }

    // Whether the steps from j on carry on a run of quiet changes to ch in
    // the same session (quietGoesOn, for steps)
    quietGoesOn(j, ch) {
      const si = j > 0 ? this.steps[j - 1].session : -1;
      for (; j < this.steps.length; j++) {
        const s = this.steps[j];
        if (s.session !== si || s.k === 'session') return false;
        if (s.k === 'o') continue;
        if (s.k === 'x') { if (!QUIET.has(s.cause)) return false; continue; }
        return s.k === 'e' && s.ch === ch && QUIET.has(s.cause);
      }
      return false;
    }

    // Step i played onto doc (chapter id -> ChapterText): the page, or
    // (checking, while building) the copies of the step's own device. False
    // when it can't be: an edit that doesn't fit, or (checking) a chapter
    // that isn't where the recording says it was left.
    apply(doc, i, checking = false) {
      const s = this.steps[i];
      if (!checking) {
        if (s.sync !== undefined) doc[s.ch] = new ChapterText(s.sync);
        if (s.page === false) return true;
      }
      if (s.k === 'b') {
        if (typeof s.html === 'string') { doc[s.ch] = new ChapterText(s.html); return true; }
        if (!checking) return true;
        if (doc[s.ch] !== undefined && digest(doc[s.ch].toString()) === s.hash) return true;
        delete doc[s.ch]; // what it was isn't known: its edits can't be followed
        return false;
      }
      if (s.k === 'e') {
        const c = doc[s.ch];
        return c !== undefined && c.splice(s.at, s.del, s.ins);
      }
      if (s.k === 'd') delete doc[s.ch];
      return true;
    }

    // The chapters once n steps have been played, as ChapterTexts to play on
    doc(n) {
      n = Math.max(0, Math.min(n, this.steps.length));
      const kfs = this.keyframes;
      let lo = 0;
      let hi = kfs.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (kfs[mid].at <= n) lo = mid; else hi = mid - 1;
      }
      const doc = {};
      for (const [ch, c] of Object.entries(kfs[lo].chapters)) doc[ch] = c.clone();
      for (let i = kfs[lo].at; i < n; i++) if (!this.bad.has(i)) this.apply(doc, i);
      return doc;
    }

    // …and as HTML
    state(n) { return htmlOf(this.doc(n)); }

    // The book's chapter order once n steps have been played: the last `o`
    // line before then, or null if there was none yet
    order(n) {
      let found = null;
      let lo = 0;
      let hi = this.orders.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (this.orders[mid] < n) { found = this.orders[mid]; lo = mid + 1; } else hi = mid - 1;
      }
      return found === null ? null : this.steps[found].order;
    }

    // Every chapter the recording ever saw, in the order it first appeared:
    // { ch, first, last (wall times of its first and last change), edits,
    // dropped (it left the book and never came back), lastStep }
    chapters() {
      const by = new Map();
      this.steps.forEach((s, i) => {
        if (!s.ch || isStream(s.ch) || !(s.k === 'b' || s.k === 'e' || s.k === 'd') || (s.page === false && s.sync === undefined)) return;
        let c = by.get(s.ch);
        if (!c) { c = { ch: s.ch, first: s.wall, last: s.wall, edits: 0, dropped: false, firstStep: i, lastStep: i }; by.set(s.ch, c); }
        if (s.k === 'e') c.edits++;
        if (s.k !== 'd') c.last = s.wall;
        c.dropped = s.k === 'd';
        c.lastStep = i;
      });
      return [...by.values()];
    }
  }

  /* ---------- a part of a chapter, through its changes ---------- */

  // A part of a chapter is offsets a…b of its HTML (whole paragraphs, as the
  // player picks it): { ch, a, b }. partThrough carries it through a splice
  // that took `cut` characters at `at` and put `put` there, and says
  // whether the splice changed it: a change inside it, or across its edge.
  // Going back through a splice (`back`) is the same with cut and put
  // swapped. A part a change reached grows to hold the change; one a change
  // took whole is empty (a = b), and going back through that change brings
  // it back. `ins` is the text the splice put in, going forward (or took
  // out, going back): a paragraph made just after the part can be recorded
  // as starting before its </p> (Enter at the end of it), and one made just
  // before it as ending after its <p> (Enter at the start); neither is a
  // change to it.
  function partThrough(part, at, cut, put, ins = '', back = false) {
    const { a, b } = part;
    if (a === b) {
      // a part taken out: back through the change that took it, it's what that took
      if (back && !cut && put && at === a) { part.b = a + put; return true; }
      if (at + cut <= a) { part.a += put - cut; part.b += put - cut; }
      else if (at < a) part.a = part.b = at + put;
      return false;
    }
    if (ins && !cut !== !put && b - a > 4) {
      const L = ins.length;
      const fwd = !cut;
      if (at === b - 4 && ins.startsWith('</p>')) return false;
      const tag = /<p\b[^>]*>$/.exec(ins);
      if (tag && (fwd ? at : at + L) === a + tag[0].length) {
        part.a += put - cut;
        part.b += put - cut;
        return false;
      }
    }
    const end = at + cut;
    const changed = cut ? at < b && end > a : at > a && at < b;
    if (!changed) {
      if (end <= a) { part.a += put - cut; part.b += put - cut; }
      return false;
    }
    if (at <= a && end >= b) {
      // taken whole: what's left of it is what was put in its place, if anything
      part.a = at;
      part.b = at + put;
      if (!put) return true;
    } else {
      part.a = Math.min(a, at);
      part.b = Math.max(b, end) + put - cut;
    }
    return true;
  }

  // whether some HTML holds any words (not just tags and spaces)
  const hasWords = (html) => /[^\s\u00a0]/.test(html.replace(/<[^>]*>/g, '').replace(/&nbsp;|&#160;/g, ''));

  // …through splices ({ at, del, ins }, each placed as the ones before it
  // left the HTML), forward (dir 1) or back (-1). True when any changed it.
  // Going back, `after(k)` is the HTML once splice k was made: a part whose
  // words all came in a splice wasn't there before it (part.gone), so a
  // part goes back as far as it was first written, and no further.
  function partSplices(part, list, dir = 1, after = null) {
    let hit = false;
    if (dir > 0) {
      for (const s of list) hit = partThrough(part, s.at, s.del, s.ins.length, s.ins) || hit;
      if (hit && part.b <= part.a) part.gone = true; // taken out
      return hit;
    }
    for (let k = list.length - 1; k >= 0 && !part.gone; k--) {
      const s = list[k];
      const { a, b } = part;
      const L = s.ins.length;
      const h = partThrough(part, s.at, L, s.del, s.ins, true);
      hit = h || hit;
      // (typing inside it, the usual change, never wrote all of it)
      if (h && after && a < b && !(s.at > a && s.at + L < b)) {
        const html = after(k);
        const cl = (x) => Math.max(a, Math.min(b, x));
        if (!hasWords(html.slice(a, cl(s.at)) + html.slice(cl(s.at + L), b))) part.gone = true;
      }
    }
    return hit;
  }

  // Whether step i of a History changed the page (the steps History.apply
  // plays on it)
  function pageChanged(h, i) {
    const s = h.steps[i];
    if (!s.ch || h.bad.has(i)) return false;
    if (s.sync !== undefined) return true;
    if (s.k === 'e' || s.k === 'd') return s.page !== false;
    return s.k === 'b' && typeof s.html === 'string' && s.page !== false;
  }

  // The chapter's HTML after step i, and (for a change made whole, or an edit across paragraphs) the
  // splices it was, kept on the History: a part is carried through the
  // same steps again and again as the player moves
  function stepText(h, ch, n) { const c = h.doc(n)[ch]; return c ? c.toString() : ''; }
  function wholeSplices(h, i) {
    const memo = h.partMemo || (h.partMemo = new Map());
    if (!memo.has(i)) {
      const ch = h.steps[i].ch;
      const was = stepText(h, ch, i);
      const list = splices(was, stepText(h, ch, i + 1));
      const texts = [];
      let html = was;
      for (const s of list) { html = applyEdit(html, s.at, s.del, s.ins); texts.push(html); }
      memo.set(i, { list, texts });
      if (memo.size > 200) memo.delete(memo.keys().next().value);
    }
    return memo.get(i);
  }

  // The part through step i (dir 1), or back through it (-1): true when the
  // step changed it. part.gone when that leaves it out of the text: a
  // chapter deleted, or the part taken out (forward); the part not yet
  // written (back).
  function partStep(h, part, i, dir) {
    const s = h.steps[i];
    if (s.ch !== part.ch || !pageChanged(h, i) || part.gone) return false;
    if (s.k === 'd') {
      if (dir > 0) { part.gone = true; return true; }
      return false;
    }
    // (an edit that replaced paragraphs, a correction recorded from the
    // first change to the last, is a splice per run of paragraphs it changed)
    if (s.k === 'e' && s.sync === undefined && !(s.del && s.ins.includes('</p>'))) return partSplices(part, [s], dir, () => stepText(h, part.ch, i + 1));
    const w = wholeSplices(h, i);
    return partSplices(part, w.list, dir, (k) => w.texts[k]);
  }

  // The part, once n steps were played, carried to where it is once `to`
  // steps are
  function partMove(h, part, n, to) {
    if (to > n) for (let i = n; i < to; i++) partStep(h, part, i, 1);
    else for (let i = n - 1; i >= to; i--) partStep(h, part, i, -1);
    return part;
  }

  // The changes to a part come in bouts: a run of steps that change it, in
  // one session, with no change anywhere else between them and no pause
  // longer than `gap`. A change that set the chapter whole (a baseline, a
  // catch-up, another device's copy) is a bout of its own. partNext is where the first bout from n on ends
  // (n, the steps played once it has, and the part there), or null when
  // none does in this History; the part is then where the History ends.
  const PART_GAP = 120000;
  const partAlone = (s) => s.k !== 'e' || s.sync !== undefined;
  function partNext(h, part, n, { gap = PART_GAP } = {}) {
    let last = null;
    for (let i = n; i < h.steps.length; i++) {
      const s = h.steps[i];
      if (s.k === 'session') { if (last) break; continue; }
      if (!pageChanged(h, i)) continue;
      const was = { ...part };
      const hit = partStep(h, part, i, 1);
      if (last && (!hit || last.alone || partAlone(s) || s.session !== last.session || s.t - last.t > gap)) return { n: last.i + 1, part: was };
      if (hit) last = { i, session: s.session, t: s.t, alone: partAlone(s) };
      if (part.gone) break;
    }
    return last ? { n: last.i + 1, part: { ...part } } : null;
  }

  // partPrev is where the last bout to end before n ended (strictly before
  // n: from the end of a bout, the one before it, unless `strict` is false),
  // or null; the part is then where the History began. A bout still going
  // on at n doesn't count.
  function partPrev(h, part, n, { gap = PART_GAP, strict = true } = {}) {
    // the first change from n on, if the bout before n could run on into it
    let after = null;
    for (let i = n; i < h.steps.length; i++) {
      const s = h.steps[i];
      if (s.k === 'session') break;
      if (!pageChanged(h, i)) continue;
      after = { hit: partStep(h, { ...part }, i, 1), session: s.session, t: s.t, alone: partAlone(s) };
      break;
    }
    for (let i = n - 1; i >= 0; i--) {
      const s = h.steps[i];
      if (s.k === 'session') { after = null; continue; }
      if (!pageChanged(h, i)) continue;
      const was = { ...part };
      const hit = partStep(h, part, i, -1);
      if (hit) {
        const goesOn = after && after.hit && !after.alone && !partAlone(s) && after.session === s.session && after.t - s.t <= gap;
        if (!goesOn && (!strict || i + 1 < n)) return { n: i + 1, part: was };
      }
      after = { hit, session: s.session, t: s.t, alone: partAlone(s) };
      if (part.gone) break;
    }
    return null;
  }

  // A part of the page's chapter as the first n days left it (`from`, the
  // chapter's HTML then, as the player had it) carried on through every
  // later day that changed the chapter, from one day's end to the next: a
  // diff of the two (splices), so an edit inside its paragraphs keeps
  // them, and paragraphs moved within one day are lost (gone) like ones
  // taken out. For a restore: where those paragraphs are as the cache's
  // last day ends. Returns { part, html (the chapter then), gone, last
  // (the part's HTML just before it went), day (the day it went), chapter
  // (true when the chapter itself went) }.
  function partDays(entries, n, readDay, part, from) {
    const ch = part.ch;
    const out = { part: { ch, a: part.a, b: part.b }, html: from, gone: false, last: null, day: null, chapter: false };
    const go = (next, day) => {
      const was = { ...out.part };
      if (next === null) {
        Object.assign(out, { gone: true, last: out.html.slice(was.a, was.b), day, chapter: true });
        return;
      }
      partSplices(out.part, splices(out.html, next), 1);
      if (out.part.gone) Object.assign(out, { gone: true, last: out.html.slice(was.a, was.b), day });
      out.html = next;
    };
    // the cache's end of that day, where the player's differs (it can't, but a part is kept either way)
    const start = n ? dayState(entries, n, readDay, 'page')[ch] : undefined;
    let parts = start ? start.parts : paragraphs(from);
    if (start && start.toString() !== from) go(start.toString(), null);
    for (let i = n; i < entries.length && !out.gone; i++) {
      const k = kindsOf(entries[i], 'page')[ch];
      if (k === undefined) continue;
      const file = readDay(entries[i].day);
      const d = file && file.chapters ? file.chapters[ch] : undefined;
      parts = k !== -1 && d ? (d.full !== undefined ? paragraphs(d.full) : parts && paraPatch(parts, d.ops)) : null;
      go(parts ? parts.join('') : null, entries[i].day);
    }
    return out;
  }

  // The words of some HTML as shingles: each run of three words, folded
  // (each word, when there are fewer than three)
  function shingles(html) {
    const w = textOf(html).toLocaleLowerCase().match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) || [];
    if (w.length < 3) return new Set(w);
    const s = new Set();
    for (let i = 0; i + 2 < w.length; i++) s.add(w[i] + ' ' + w[i + 1] + ' ' + w[i + 2]);
    return s;
  }
  const likeness = (x, y) => {
    if (!x.size || !y.size) return 0;
    let both = 0;
    for (const v of x) if (y.has(v)) both++;
    return (2 * both) / (x.size + y.size);
  };

  // Where some paragraphs (`html`, as they were) are in a book now
  // (`chapters`: id -> HTML), by their words: each paragraph matched to the
  // most like one anywhere, at least half alike, and the chapter where
  // most of their words matched. { ch, a, b, likeness } (offsets of the
  // whole paragraphs, first matched to last), or null. Cheap: a novel is a
  // few thousand paragraphs, each made shingles once.
  function findParagraphs(html, chapters, { min = 0.5 } = {}) {
    const want = paragraphs(html).map((p) => ({ s: shingles(p), words: countWords(p) })).filter((p) => p.s.size);
    if (!want.length) return null;
    const total = want.reduce((n, p) => n + p.words, 0);
    let best = null;
    for (const [ch, chHtml] of Object.entries(chapters)) {
      if (isStream(ch) || !chHtml) continue;
      const ps = paragraphs(String(chHtml));
      const sh = ps.map(shingles);
      let words = 0;
      let score = 0;
      let lo = Infinity;
      let hi = -1;
      for (const p of want) {
        let top = 0;
        let at = -1;
        sh.forEach((s, i) => { const l = likeness(p.s, s); if (l > top) { top = l; at = i; } });
        if (top < min) continue;
        words += p.words;
        score += top * p.words;
        lo = Math.min(lo, at);
        hi = Math.max(hi, at);
      }
      if (hi < 0 || words * 2 < total) continue;
      if (!best || words > best.words || (words === best.words && score > best.score)) {
        let a = 0;
        for (let i = 0; i < lo; i++) a += ps[i].length;
        let b = a;
        for (let i = lo; i <= hi; i++) b += ps[i].length;
        best = { ch, a, b, words, score, likeness: score / words };
      }
    }
    return best && { ch: best.ch, a: best.a, b: best.b, likeness: best.likeness };
  }

  /* ---------- evidence: how the words came (plan, part 2) ---------- */

  // Gaps between keys are kept as histograms: EV_BINS bins to each doubling
  // of the gap, from 1 ms to a minute. A gap of a minute or more is time
  // away, not rhythm.
  const EV_BINS = 8;
  const EV_AWAY = 60000;
  const evBin = (ms) => Math.max(0, Math.floor(Math.log2(Math.max(1, ms)) * EV_BINS));
  const EV_SIZE = evBin(EV_AWAY - 1) + 1;
  const EV_RETURN = 200;  // typing this far (HTML characters) before where typing last was is going back
  const EV_INSIDE = 500;  // …and with this much of the chapter after it, it went in before the end
  const EV_FIX = 1000;    // a delete this soon after a typed character is a quick fix
  const EV_SOON = 10000;  // a paste this soon after coming back to NEO…
  const EV_BIG = 200;     // …this long, is counted on its own
  // The report's coarse view of the gaps between keys: these edges (ms),
  // each the bin edge nearest a round figure, make EV_GAPS.length + 1 bars
  const EV_GAPS = [50, 100, 200, 400, 800, 1600, 3200];
  // …and of deletions in a row: runs of 1, 2, 3–5, 6–10 and 11 or more keys
  const EV_RUNS = [1, 2, 3, 6, 11];

  function evScope() {
    return {
      keys: 0, typed: 0, deleted: 0, fixes: 0, bursts: 0, untrusted: 0, returns: 0, inside: 0, ms: 0,
      delInside: 0, runs: new Array(EV_RUNS.length).fill(0), spell: 0,
      gaps: new Array(EV_SIZE).fill(0),
      pause: { inside: new Array(EV_SIZE).fill(0), word: new Array(EV_SIZE).fill(0), sentence: new Array(EV_SIZE).fill(0), para: new Array(EV_SIZE).fill(0) },
      pastes: 0, pasted: 0, soon: 0, soonPasted: 0, own: 0, ownPasted: 0,
      nokey: 0, nokeyChars: 0, nokeyKinds: {},
      before: 0, outside: 0, days: new Set(), sessions: new Set(), first: null, last: null
    };
  }

  // What the characters before a typed letter say about where it went: the
  // start of a paragraph, of a sentence, of a word, or inside a word. Null
  // for anything else (punctuation, a space, a letter after a dash).
  function evPlace(before, c) {
    if (!WORDCH.test(c)) return null;
    let s = before.replace(/^[^<]*>/, '').replace(/&nbsp;|&#160;|&#xa0;/gi, ' ');
    if (before === '' || /<(p|div|li|h\d|br)\b[^>]*>(?:<[^>]*>)*$/i.test(s)) return 'para';
    s = s.replace(/<[^>]*>/g, '').replace(/&[a-z0-9#]+;/gi, 'x');
    if (!s) return null;
    if (/\s$/.test(s)) return /[.!?…][)"'”’»\]]*\s+$/.test(s) ? 'sentence' : 'word';
    return WORDCH.test(s[s.length - 1]) ? 'inside' : null;
  }

  // A book's sessions (every device's, in sessionOrder: { id, device, text })
  // read for what they show of how the words came, for the evidence report:
  // the rhythm of the keys, where the pauses fall, how much was revised as
  // it was typed and how much later, in earlier text, spelling suggestions
  // picked, what was pasted from outside NEO, what came with no key, and
  // what was never recorded. For
  // the book and for each chapter (streams aren't chapters, and aren't
  // counted). Plays them as one page (Page), so text from another device
  // that was recorded there counts once, as that device's.
  //   { v, book, chapters: { ch: scope }, words: { ch: n } (now), chars,
  //     order, sessions: [{ id, device, day, from, to, typed }] }
  // A scope's numbers are counts; gaps and pauses are histograms (evBin).
  // `chapters`: count only these.
  function evidence(sessions, { chapters = null } = {}) {
    const want = chapters ? new Set(chapters) : null;
    const counted = (ch) => typeof ch === 'string' && !isStream(ch) && (!want || want.has(ch));
    const book = evScope();
    const scopes = {};
    const scopeOf = (ch) => scopes[ch] || (scopes[ch] = evScope());
    const both = (ch, f) => { f(book); f(scopeOf(ch)); };
    const list = [];
    const page = new Page();
    let order = null;
    // words that reach the page while nothing recorded them being written
    const settle = page.settle.bind(page);
    page.settle = (d, ch) => {
      const was = page.doc[ch] ? page.doc[ch].toString() : '';
      const html = settle(d, ch);
      if (html !== undefined && counted(ch)) {
        const n = wordChange(was, html).added;
        both(ch, (s) => { s.outside += n; });
      }
      return html;
    };
    const based = new Set(); // chapters whose words before the recording are counted

    const players = sessions.map((sess, si) => {
      const parsed = parseSession(sess.text || '');
      const d = sess.device || '';
      const info = { id: sess.id, device: d, day: sessionDay(parsed.header), from: null, to: null, typed: 0 };
      list.push(info);
      if (!parsed.known) return { walls: [], play() {} };
      const lines = parsed.lines;
      const { walls } = lineWalls(parsed.header, lines);
      let li = 0;           // the line playing
      let cur = null;       // the chapter its lines apply to
      let keyT = null;      // the last key's moment
      let gap = null;       // …and the gap before it
      let used = true;      // whether an edit has taken that key yet
      let typedT = null;    // the last typed character's moment
      let dels = 0;         // deleting keys in a row
      let spellNext = false; // the next edit is a spelling suggestion picked (an `x spell`)
      let away = false;
      let backT = null;     // when the writer last came back to NEO
      const lastAt = {};    // ch -> where typing last left off
      const quiet = {};     // ch -> the chapter as a quiet run on the page began
      const doc = page.device(d);
      const seen = (ch, s) => {
        s.days.add(info.day);
        s.sessions.add(d + '/' + sess.id);
        const w = walls[li];
        if (Number.isFinite(w)) {
          if (s.first === null || w < s.first) s.first = w;
          if (s.last === null || w > s.last) s.last = w;
        }
      };
      const unquiet = (ch) => {
        if (quiet[ch] === undefined) return;
        const n = wordChange(quiet[ch], doc[ch] ? doc[ch].toString() : '').added;
        delete quiet[ch];
        if (counted(ch)) both(ch, (s) => { s.outside += n; });
      };
      const endRun = () => {
        if (dels && counted(cur)) {
          let b = EV_RUNS.length - 1;
          while (b > 0 && dels < EV_RUNS[b]) b--;
          both(cur, (s) => { s.runs[b]++; if (dels >= 3) s.bursts++; });
        }
        dels = 0;
      };
      // A spelling suggestion picked from NEO's menu: an `x spell` says so.
      // Sessions from before NEO wrote that line show one as typing with no
      // key, just after the caret was placed, that changes letters inside a
      // word and nothing else.
      const spellPick = (c, at, del, ins) => {
        let j = li - 1; // (past what only describes: a chunk's end, a write between)
        while (j > 0 && Array.isArray(lines[j]) && /^(h|w|ch|K|o|T)$/.test(lines[j][1])) j--;
        const prev = lines[j];
        if (!c || !Array.isArray(prev) || prev[1] !== 's' || lines[li][5] !== 'iT' || (!ins && !del) || /[\s<>&]/.test(ins) || ins.length > 40) return false;
        const L = /[\p{L}\p{M}'’]/u;
        return L.test(c.before(at, 1).slice(-1)) || L.test(c.toString().slice(at + del, at + del + 1));
      };
      const on = {
        key(t) {
          gap = keyT === null ? null : t - keyT;
          keyT = t;
          used = false;
          if (!counted(cur)) return;
          both(cur, (s) => {
            s.keys++;
            if (gap !== null && gap < EV_AWAY) { s.gaps[evBin(gap)]++; s.ms += gap; }
          });
          const line = lines[li];
          if (line[1] === 'k' && (line[3] & MOD.untrusted)) both(cur, (s) => { s.untrusted++; });
        },
        edit(ch, at, del, ins, why, t) {
          const line = lines[li];
          if (QUIET.has(why)) {
            // on the page already, it changes the page without anyone writing
            if (page.doc[ch] !== undefined && page.doc[ch] === doc[ch] && quiet[ch] === undefined) quiet[ch] = doc[ch].toString();
            return;
          }
          unquiet(ch);
          if (!counted(ch)) return;
          const kind = line[1];
          const run = kind === 'r' || kind === 'rd';
          const input = kind === 'e' ? line[5] : null;
          const spelled = spellNext;
          spellNext = false;
          if (input && line[6] === 0) {
            if (input === 'iFP' || input === 'iFD') return; // a paste: counted from its `c` line
            if (spelled || spellPick(doc[ch], at, del, ins)) { both(ch, (s) => { s.spell++; seen(ch, s); }); return; }
            const n = textOf(ins).length;
            both(ch, (s) => { s.nokey++; s.nokeyChars += n; s.nokeyKinds[inputName(input)] = (s.nokeyKinds[inputName(input)] || 0) + 1; seen(ch, s); });
            return;
          }
          if (!run && !input) return; // NEO's own move: Replace All, a merge, the Outline…
          if (input === 'iFP' || input === 'iFD') return;
          const c = doc[ch];
          const first = !used && t === keyT;
          used = true;
          if (ins && !del) {
            const n = run ? 1 : textOf(ins).length;
            if (!n) return; // Enter: a paragraph, no letters
            endRun();
            const where = first && gap !== null && gap < EV_AWAY && [...ins].length === 1 ? evPlace(c.before(at, 40), ins) : null;
            const back = lastAt[ch] !== undefined && at < lastAt[ch] - EV_RETURN;
            const inside = c.length - at >= EV_INSIDE ? n : 0;
            info.typed += n;
            both(ch, (s) => {
              s.typed += n;
              s.inside += inside;
              if (back) s.returns++;
              if (where) s.pause[where][evBin(gap)]++;
              seen(ch, s);
            });
            lastAt[ch] = at + ins.length;
            typedT = t;
          } else if (del) {
            const n = run ? 1 : Math.max(1, textOf(c.toString().slice(at, at + del)).length);
            const fix = first && typedT !== null && t - typedT <= EV_FIX && dels === 0;
            const inside = c.length - at - del >= EV_INSIDE ? n : 0;
            const back = lastAt[ch] !== undefined && at + del < lastAt[ch] - EV_RETURN;
            if (first) dels++;
            both(ch, (s) => {
              s.deleted += n;
              s.delInside += inside;
              if (back) s.returns++;
              if (fix) s.fixes++;
              seen(ch, s);
            });
            if (ins) {
              const m = textOf(ins).length;
              info.typed += m;
              both(ch, (s) => { s.typed += m; });
            }
            lastAt[ch] = at + ins.length;
          }
        },
        base(ch, html, why) {
          unquiet(ch);
          if (!QUIET.has(why) || page.doc[ch] !== undefined || !counted(ch)) return;
          // not on the page: words written before the recording began, or
          // ones that came while nothing was recording
          const n = countWords(html);
          if (why === 'baseline' && !based.has(ch)) { based.add(ch); both(ch, (s) => { s.before += n; }); } else if (why !== 'baseline') both(ch, (s) => { s.outside += n; });
        },
        drop(ch) { unquiet(ch); }
      };
      const lp = linePlayer(lines, null, { si, on, page, device: d });
      return {
        walls,
        play(i) {
          li = i;
          const line = lines[i];
          if (!Array.isArray(line)) return;
          const kind = line[1];
          if (kind === 'b' || kind === 'ch') { endRun(); cur = line[2]; }
          if (kind === 'x') spellNext = line[2] === 'spell';
          else if (kind === 'k' || kind === 'r' || kind === 'rd' || kind === 'n') spellNext = false;
          if (kind === 'n' || (kind === 'k' && !/^(Backspace|Delete)$/.test(line[2]))) endRun();
          lp.play(i);
          const w = walls[i];
          if (Number.isFinite(w)) { if (info.from === null) info.from = w; info.to = w; }
          const t = lp.time();
          if (kind === 'o') order = line[2].filter((ch) => !want || want.has(ch));
          else if (kind === 'f') {
            if (line[2] === 'blur' || line[2] === 'hidden') away = true;
            else if ((line[2] === 'focus' || line[2] === 'visible') && away) { away = false; backT = t; }
          } else if (kind === 'c' && line[2] === 'paste' && counted(cur)) {
            const n = Number(line[3]) || 0;
            const own = line[6] === true;
            const soon = !own && backT !== null && t - backT <= EV_SOON && n >= EV_BIG;
            both(cur, (s) => {
              if (own) { s.own++; s.ownPasted += n; } else { s.pastes++; s.pasted += n; }
              if (soon) { s.soon++; s.soonPasted += n; }
              seen(cur, s);
            });
          }
        },
        end() { for (const ch of Object.keys(quiet)) unquiet(ch); endRun(); }
      };
    });
    playInterleaved(players, (si) => { if (players[si].end) players[si].end(); });

    const flat = (s) => ({ ...s, days: s.days.size, sessions: s.sessions.size });
    const out = { v: 1, book: flat(book), chapters: {}, words: {}, chars: {}, order, sessions: list };
    for (const [ch, s] of Object.entries(scopes)) out.chapters[ch] = flat(s);
    for (const [ch, c] of Object.entries(page.doc)) {
      if (!counted(ch)) continue;
      const text = textOf(c.toString());
      out.words[ch] = (text.match(WORD) || []).length;
      out.chars[ch] = text.replace(/\s+/g, ' ').trim().length;
    }
    return out;
  }

  // the gap (ms) at quantile q of a histogram, or null when it's empty
  function evQuantile(hist, q) {
    const total = hist.reduce((a, b) => a + b, 0);
    if (!total) return null;
    let cum = 0;
    for (let b = 0; b < hist.length; b++) {
      cum += hist[b];
      if (cum >= q * total) return Math.round(2 ** ((b + 0.5) / EV_BINS));
    }
    return null;
  }
  const evCount = (hist) => hist.reduce((a, b) => a + b, 0);

  // A scope's numbers as the report says them. `chars`: the scope's text
  // now, for the share pasted. `rhythm` is the gaps between keys in coarse
  // bars, split at EV_GAPS; `runs` deletions in a row, by EV_RUNS. Deletions
  // and typing with EV_INSIDE or more of the chapter after them were in
  // earlier text; the rest went where the text was being written.
  function evidenceRead(s, chars = 0) {
    const med = (h) => evQuantile(h, 0.5);
    const rhythm = new Array(EV_GAPS.length + 1).fill(0);
    s.gaps.forEach((v, b) => {
      let k = 0;
      while (k < EV_GAPS.length && b >= evBin(EV_GAPS[k])) k++;
      rhythm[k] += v;
    });
    const out = {
      keys: s.keys, typed: s.typed, deleted: s.deleted, fixes: s.fixes, bursts: s.bursts, untrusted: s.untrusted,
      days: s.days, sessions: s.sessions, ms: s.ms, first: s.first, last: s.last,
      gap: med(s.gaps), gapLow: evQuantile(s.gaps, 0.25), gapHigh: evQuantile(s.gaps, 0.75), rhythm,
      pause: {}, pauseN: {},
      revised: s.typed ? s.deleted / s.typed : null,
      typedAtEnd: s.typed - s.inside, deletedAtEnd: s.deleted - s.delInside, runs: s.runs.slice(), spell: s.spell,
      returns: s.returns, inside: s.inside, delInside: s.delInside, insideShare: s.typed ? s.inside / s.typed : null,
      pastes: s.pastes, pasted: s.pasted, pastedShare: chars ? Math.min(1, s.pasted / chars) : null, soon: s.soon, soonPasted: s.soonPasted,
      own: s.own, ownPasted: s.ownPasted, nokey: s.nokey, nokeyChars: s.nokeyChars, nokeyKinds: s.nokeyKinds,
      before: s.before, outside: s.outside
    };
    for (const k of Object.keys(s.pause)) { out.pause[k] = med(s.pause[k]); out.pauseN[k] = evCount(s.pause[k]); }
    return out;
  }

  // A session with only some chapters' lines in it, for a replay page that
  // shows only those (Export replay…): every line about another chapter or
  // a stream goes, its time carried on to the next line kept, and so do the
  // `h` lines, since the chain covered lines that are gone. The header says
  // which chapters it keeps (`kept`). It still replays: every `w` of a
  // chapter kept hashes as it did.
  function keepChapters(text, ids) {
    const keep = new Set(ids);
    const { header, known, lines } = parseSession(text);
    if (!header || !known) return '';
    const out = [JSON.stringify({ ...header, kept: [...keep] })];
    const spanOf = (line) => {
      let n = line[0] || 0;
      if (line[1] === 'r' || line[1] === 'rd' || line[1] === 'n') for (const dt of line[3] || []) n += dt || 0;
      return n;
    };
    const PER = new Set(['r', 'rd', 'n', 'e', 's', 'c', 'k']); // lines about the chapter the caret is in
    let cur = null;
    let carry = 0;
    for (const line of lines) {
      if (!Array.isArray(line)) continue;
      const kind = line[1];
      if (kind === 'b' || kind === 'ch') cur = line[2];
      let ok;
      if (kind === 'h') ok = false;
      else if (kind === 'b' || kind === 'ch' || kind === 'd') ok = keep.has(line[2]);
      else if (kind === 'w') ok = keep.has(line.length > 3 ? line[3] : cur);
      else ok = !PER.has(kind) || keep.has(cur);
      if (!ok) { carry += spanOf(line); continue; }
      let l = line;
      if (kind === 'o') l = [line[0], 'o', line[2].filter((ch) => keep.has(ch))];
      if (carry && !(kind === 'K' || kind === 'ch' || kind === 'o')) {
        l = l.slice();
        l[0] = (l[0] || 0) + carry;
        carry = 0;
      }
      out.push(JSON.stringify(l));
    }
    return out.join('\n') + '\n';
  }

  return {
    FORMAT, READS, PLAYER, CARET_BLOCK, INPUT_TYPES, MOD, inputCode, inputName,
    STREAMS, isStream, streamTexts,
    sha256, digest, chainHash, utf8,
    splice, applyEdit, paragraphs, splices, paraDiff, paraPatch, ChapterText,
    textOf, wordBag, wordChange, countWords, setDigest,
    RunEncoder, encodeRuns, expandRuns,
    SessionWriter, appendLines,
    parseSession, splitLines, joinParts, verifyChain,
    replay, replayCheck, ANCHOR_CHARS, ANCHOR_TIMES, anchorDue, baseLines,
    QUIET, Page, sessionOrder,
    sessionDay, binsFor, playSession, dayStats, tagsOf, momentStep, sessionSkip, DayBuilder, dayState, pageState,
    textOffset, compileSession, History,
    normMap, normText, phraseIn, phraseQuery, PhraseTally, phraseDays, phraseSessions, phraseFindings, phraseEvents, phrasePick,
    partThrough, partSplices, partMove, partNext, partPrev, PART_GAP, partDays, findParagraphs,
    linePlayer, playInterleaved, lineWalls, htmlOf,
    EV_BINS, EV_GAPS, EV_RUNS, evidence, evidenceRead, evQuantile, keepChapters
  };
});
