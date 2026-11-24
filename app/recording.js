'use strict';

/* ================================================================== */
/*  RECORDING                                                          */
/*  Writing History (docs/neo-recording-plan.md). Every change to a   */
/*  chapter's HTML comes through setChapterHTML with its cause, and   */
/*  the recorder keeps it, with the keys, caret, clipboard and focus  */
/*  around it, as lines in recording.js's format. The lines go to     */
/*  disk as a chunk in flushAllSaves (every 20 s, and on blur, hide   */
/*  and close). A crash can leave a chapter up to 20 s ahead of the   */
/*  recording; the next session's `b` line catches it up, so the      */
/*  words are kept, only those seconds' keys are not. persistChapter  */
/*  reconciles first: a change the recorder didn't see is logged as   */
/*  `unobserved`. Off when library.recordWriting is false, and where  */
/*  window.neo has no recStart (Pocket in a web view without gzip).   */
/*  In the console:                                                    */
/*    rec.check()        replays this session against the page        */
/*    rec.verbose = true logs each line as it is recorded             */
/*    rec.strict = true  also notices the page drifting between events */
/* ================================================================== */

const Rec = window.NeoRecording;
const REC_IDLE = 60000;         // no keys or edits this long: an `idle` line
const REC_WALL = 5 * 60000;     // a wall-clock line this often
const REC_ROLLUP = 10 * 60000;  // chunks joined into one file this often

// Writing History's one setting (Options → Writing History) has three
// levels: 'off', 'record', and 'timestamp' (recorded, then sealed and
// timestamped: Proof of when I wrote). It's kept as recordWriting and
// proveWriting. Unlike a feature, it's on (Record and Timestamp) from the
// start: neither a history nor a timestamp can be made afterwards, so a
// writer who turned them on later would have nothing for what came before.
// Recording is off only once the writer turns it off (recordWriting false).
// Timestamping sends fingerprints out, so nothing is sent until the writer
// has said yes once (proveWriting true; unset, Options shows it as chosen
// and askProofOnce asks). Pocket can't timestamp: there it's Record Only.
const historyCan = () => !!(Rec && window.neo.recStart);
const recordingWanted = () => !!(historyCan() && library && library.recordWriting !== false);
const historyLevel = () => (!recordingWanted() ? 'off' : window.neo.proofSet && library.proveWriting !== false ? 'timestamp' : 'record');

function recSessionId() {
  return new Date().toISOString().replace(/\.\d+Z$/, 'Z').replace(/:/g, '-') + '-' +
    Math.random().toString(36).slice(2, 6).padEnd(4, '0');
}

// A place in a chapter as an `s` line holds it: the paragraph's index among
// the body's Rec.CARET_BLOCKs, and the letters before it within that
// paragraph. Changing what's counted is a new recording format.
function recPoint(body, node, offset) {
  const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
  const p = el && el.closest ? el.closest(Rec.CARET_BLOCK) : null;
  if (!p || !body.contains(p)) return [0, 0];
  const r = document.createRange();
  r.selectNodeContents(p);
  r.setEnd(node, offset);
  return [[...body.querySelectorAll(Rec.CARET_BLOCK)].indexOf(p), r.toString().length];
}
const recBodyOf = (n) => {
  const el = n && (n.nodeType === Node.TEXT_NODE ? n.parentElement : n);
  return el && el.closest ? el.closest('.chapter-body') : null;
};
// [chapter, anchor pIdx, off, focus pIdx, off], or null outside the chapters
function recSelection() {
  const sel = window.getSelection();
  if (!sel.rangeCount) return null;
  const body = recBodyOf(sel.focusNode);
  if (!body) return null;
  const f = recPoint(body, sel.focusNode, sel.focusOffset);
  const a = recBodyOf(sel.anchorNode) === body ? recPoint(body, sel.anchorNode, sel.anchorOffset) : f;
  return [body.closest('.chapter').dataset.id, ...a, ...f];
}

const rec = {
  on: false,
  bookId: null,
  device: null,
  appVersion: '',
  prev: null,        // the last hash of this device's previous session for the book
  w: null,           // the session's Rec.SessionWriter
  session: null,     // { id, day }
  model: {},         // chapterId -> HTML as the recorder last saw it (and each stream's text)
  wrote: {},         // stream -> its text at its last `w`
  known: {},         // chapterId -> HTML where this device's recordings left it
  unseen: new Set(), // chapters in the book as it opened that this device never recorded (baseUnseen)
  startKnown: {},    // known, as this session began
  edited: {},        // chapterId -> characters inserted and deleted since its last full `b` (anchors)
  inSession: new Set(), // chapters with a `b` line this session
  cur: null,         // the chapter the lines apply to
  clock: 0,          // performance.now() of the last event, rounded
  lastKind: '',
  key: null,         // the key that is down: { code }
  lastKeyAt: -1e9,
  lastPointerAt: -1e9,
  pointerDown: false,
  sel: '',           // the last caret or selection seen
  copied: [],        // hashes of what was copied or cut in NEO lately
  copiedFrom: new Map(), // hash -> the moment of Writing History it was copied from: [session, line, device]
  orderSig: '',
  live: false,       // the session holds a change: worth keeping
  chunks: 0,         // sent since the last rollup
  retry: [],
  counts: { keys: 0, edits: 0, bases: 0, drops: 0, writes: 0, unobserved: 0, drift: 0 },
  idleTimer: 0,
  verbose: false,
  strict: false,

  async begin(bookId) {
    this.end();
    this.bookId = bookId;
    this.model = {};
    this.wrote = {};
    this.unseen = new Set();
    if (!recordingWanted()) return;
    let info;
    try { info = await window.neo.recStart(bookId, proofFlags()); } catch (err) {
      window.neo.logError('recording start: ' + (err && err.message || err));
      return;
    }
    if (this.bookId !== bookId || !info) return; // another book opened meanwhile
    this.device = info.device;
    this.appVersion = info.app || '';
    this.prev = info.prev || null;
    this.known = info.known || {};
    this.edited = info.edited || {};
    this.on = true;
    this.newSession();
  },

  newSession() {
    const now = new Date();
    this.session = { id: recSessionId(), day: writingDay(now) };
    this.w = new Rec.SessionWriter({
      neoRec: Rec.FORMAT, session: this.session.id, device: this.device, app: this.appVersion,
      book: this.bookId, day: this.session.day, startedAt: now.toISOString(),
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone || '', prev: this.prev
    });
    this.startKnown = { ...this.known };
    this.inSession = new Set();
    this.cur = null;
    this.sel = '';
    this.orderSig = '';
    this.live = false;
    this.chunks = 0;
    this.retry = [];
    this.sending = new Set(); // chunks on their way to the disk, which a close waits for
    this.clock = Math.round(performance.now());
    this.lastKind = '';
    this.counts = { keys: 0, edits: 0, bases: 0, drops: 0, writes: 0, unobserved: 0, drift: 0 };
  },

  // The session's last line, its last chunk, and the folder joined into one
  // file. A session that never changed a chapter leaves nothing behind.
  // The promise is the close reaching the disk. The close waits for every
  // chunk sent, the last one with `end` above all: the close joins what's on
  // disk and removes the folder, so a chunk that lands after it is lost.
  // (Pocket's writes are a few awaits each, and the close won that race.)
  closeSession() {
    clearTimeout(this.idleTimer);
    if (!this.live) return Promise.resolve();
    const { keys, edits, unobserved } = this.counts;
    this.event(['end', { keys, edits, unobserved }]);
    this.flush();
    const sent = Promise.all([...this.sending]);
    for (const chId of this.inSession) {
      if (chId in this.model) this.known[chId] = this.model[chId];
      else delete this.known[chId];
    }
    this.prev = this.w.H;
    this.live = false;
    const bookId = this.bookId, id = this.session.id;
    return sent.then(() => window.neo.recClose(bookId, id)).catch((err) => window.neo.logError('recording close: ' + (err && err.message || err)));
  },

  end() {
    let closed = Promise.resolve();
    if (this.on) {
      closed = this.closeSession();
      if (this.counts.unobserved) console.warn('[rec] closed with', this.counts.unobserved, 'unobserved changes');
    }
    this.on = false;
    this.bookId = null;
    return closed;
  },

  // a session is at most the writer's day (the goals' day, which ends at
  // library.dayEndsAt): when it ends the next one starts
  tick() {
    if (this.session.day === writingDay()) return;
    this.closeSession();
    this.newSession();
  },

  // an event, dt after the one before (or at the same moment, dt 0)
  event(fields, sameMoment = false) {
    let dt = 0;
    if (!sameMoment) {
      const now = Math.round(performance.now());
      dt = Math.max(0, now - this.clock);
      this.clock = now;
    }
    this.put([dt, ...fields]);
  },
  // a description of what follows: dt 0, and the clock stays
  meta(fields) { this.put([0, ...fields]); },
  put(line) {
    this.w.push(line);
    this.lastKind = line[1];
    if (this.verbose) console.debug('[rec]', JSON.stringify(line).slice(0, 300));
  },

  focusChapter(chId) {
    if (this.cur === chId) return;
    this.cur = chId;
    this.meta(['ch', chId]);
  },

  order() {
    if (!book || !this.live) return;
    const sig = book.chapterOrder.join(' ');
    if (sig === this.orderSig) return;
    this.orderSig = sig;
    this.meta(['o', [...book.chapterOrder]]);
  },

  // Chapters in the book as it opened that this device never recorded
  // (unseen) get their baseline once the session first records anything,
  // all together, so History shows each on every day it was in the book,
  // not only from its first edit; opening a book alone records nothing.
  // They're one moment, and true when there were any, so the line that
  // brought them shares it (the player's first moment is after them all).
  baseUnseen() {
    if (!this.unseen.size) return false;
    const ids = [...this.unseen].filter((id) => this.model[id] !== undefined);
    this.unseen.clear();
    ids.forEach((id, i) => this.establish(id, this.model[id], i > 0));
    return ids.length > 0;
  },

  // The first time this session touches a chapter, a `b` line says what it
  // was: as the last recording left it (only its hash, or all of it again
  // when an anchor is due), then the change made while nothing was
  // recording (catch-up); or, for a chapter never recorded, all of it
  // (baseline). Rec.baseLines decides.
  establish(chId, html, same = false) {
    if (this.inSession.has(chId)) return;
    this.unseen.delete(chId);
    if (this.baseUnseen()) same = true;
    this.inSession.add(chId);
    this.live = true;
    this.counts.bases++;
    Rec.baseLines(chId, html, this.known[chId], this.edited[chId] || 0).forEach((line, i) => {
      if (line[0] === 'b' && line[2] !== null) this.edited[chId] = 0;
      if (line[0] === 'e') this.counted(chId, line[2], line[3]);
      this.event(line, same || i > 0);
    });
    this.cur = chId;
    this.order();
  },

  // what an anchor waits on: the characters inserted and deleted
  counted(chId, del, ins) {
    this.edited[chId] = (this.edited[chId] || 0) + del + ins.length;
  },

  change(chId, html, cause, opts = {}) {
    if (!this.on) return;
    html = html == null ? '' : String(html);
    if (cause === 'open') { // the book as it opened: nothing happened yet
      this.model[chId] = html;
      if (Rec.isStream(chId)) this.wrote[chId] = html;
      // a chapter changed while nothing recorded (a file put back from a
      // backup, another program) is caught up now, not at its first edit,
      // so History shows the book as it is; one never recorded here waits
      // for the session's first line (baseUnseen)
      else if (this.known[chId] === undefined) this.unseen.add(chId);
      else if (this.known[chId] !== html) this.establish(chId, html);
      if (this.live) this.baseUnseen();
      return;
    }
    this.tick(); // (a new day's session starts before the change, not after)
    const old = this.model[chId];
    this.model[chId] = html;
    if (old === undefined) {
      // a chapter new to the page: all of it, with what made it (and, for a
      // restore, the moment it came from)
      const same = this.baseUnseen();
      this.inSession.add(chId);
      this.live = true;
      this.counts.bases++;
      this.edited[chId] = 0;
      if (opts.ref) this.event(['x', cause, ...opts.ref], same);
      this.event(['b', chId, html, Rec.digest(html), cause], same || !!opts.ref);
      this.cur = chId;
      this.order();
      this.noteCaret();
      return;
    }
    if (old === html) return;
    this.establish(chId, old);
    this.focusChapter(chId);
    this.counts.edits++;
    if (cause === 'input') {
      let sp = Rec.splice(old, html, opts.hint);
      // what a key typed happened when the key went down
      let now = !!this.key && this.lastKind === 'k';
      // A key that comes with a tidy elsewhere in the chapter (the junk
      // spans an open strips, saved with the next change): the tidy as its
      // own changes, a splice per run of paragraphs, and only the run at the
      // caret as what was typed, so a letter isn't the chapter between
      if ((sp.ins + old.slice(sp.at, sp.at + sp.del)).includes('</p>')) {
        const runs = Rec.splices(old, html);
        const h = typeof opts.hint === 'function' ? opts.hint(html) : opts.hint;
        const k = runs.length > 1 && typeof h === 'number' ? runs.findIndex((r) => h >= r.at && h <= r.at + r.ins.length) : -1;
        if (k >= 0) {
          this.event(['x', 'tidy'], now);
          now = true;
          // right to left, each where the HTML was before any of them, so
          // the typed run is where Rec.splices put it once they're made
          let delta = 0;
          const at = runs.map((r) => { const a = r.at - delta; delta += r.ins.length - r.del; return a; });
          let tidied = old;
          for (let j = runs.length - 1; j >= 0; j--) {
            if (j === k) continue;
            this.counted(chId, runs[j].del, runs[j].ins);
            this.event(['e', at[j], runs[j].del, runs[j].ins], true);
            tidied = Rec.applyEdit(tidied, at[j], runs[j].del, runs[j].ins);
          }
          // (placed by the caret, as typing is, among repeated letters)
          sp = Rec.splice(tidied, html, opts.hint);
        }
      }
      const line = ['e', sp.at, sp.del, sp.ins, Rec.inputCode(opts.inputType)];
      if (!this.key) line.push(0); // no key was down: dictation, autocorrect, a tool
      this.counted(chId, sp.del, sp.ins);
      this.event(line, now);
      this.active();
    } else {
      // NEO's own moves change a chapter all at once: a splice per run of
      // paragraphs they changed, so a name replaced on the first page and
      // the last is two small splices, not the chapter between them. A
      // restore says the moment it came from: [session, line, device]
      this.event(['x', cause, ...(opts.ref || [])]);
      for (const sp of Rec.splices(old, html)) {
        this.counted(chId, sp.del, sp.ins);
        this.event(['e', sp.at, sp.del, sp.ins], true);
      }
      this.order();
    }
    this.noteCaret();
  },

  drop(chId, cause) {
    if (!this.on || !(chId in this.model)) return;
    this.tick();
    this.establish(chId, this.model[chId]); // its words are in the history before it goes
    delete this.model[chId];
    this.counts.drops++;
    this.event(['d', chId, cause]);
    this.order();
  },

  // Titles, the outline and stickies, as the book holds them now: what
  // changed since the recorder last looked is recorded with `cause`. Those
  // in `written` were just written to disk (book.json, stickies.json): a
  // `w` for each that changed since its last.
  streams(cause = 'edit', written = []) {
    if (!this.on || !book || book.id !== this.bookId) return;
    for (const [id, text] of Object.entries(Rec.streamTexts(book, stickies))) {
      if (this.model[id] === undefined) continue; // not opened yet
      if (this.model[id] !== text) this.change(id, text, cause);
      if (written.includes(id) && this.wrote[id] !== text) this.reconcile(id, text);
    }
  },

  // Just before a chapter is written: the write is explained by what the
  // recording already holds, or the difference is logged as unobserved.
  // Then the write itself. It reaches the disk with the next flush.
  reconcile(chId, html) {
    if (!this.on) return;
    html = html == null ? '' : String(html);
    this.tick();
    if (this.model[chId] !== html) {
      this.counts.unobserved++;
      console.warn('[rec] unobserved change to', chId, Rec.splice(this.model[chId] || '', html));
      this.change(chId, html, 'unobserved');
    }
    this.establish(chId, html);
    if (Rec.isStream(chId)) this.wrote[chId] = html;
    this.counts.writes++;
    this.event(chId === this.cur ? ['w', Rec.digest(html)] : ['w', Rec.digest(html), chId]);
  },

  keyDown(e, chId) {
    if (['Shift', 'Control', 'Alt', 'Meta', 'AltGraph'].includes(e.key)) return; // shown as the mods of the key they go with
    this.tick();
    this.focusChapter(chId); // before the key, so what it types can join a run
    const mods = (e.shiftKey ? Rec.MOD.shift : 0) | (e.ctrlKey ? Rec.MOD.ctrl : 0) | (e.altKey ? Rec.MOD.alt : 0) |
      (e.metaKey ? Rec.MOD.meta : 0) | (e.repeat ? Rec.MOD.repeat : 0) | (e.isTrusted ? 0 : Rec.MOD.untrusted);
    this.counts.keys++;
    this.event(['k', e.code || '', mods]);
    this.key = { code: e.code };
    this.lastKeyAt = performance.now();
    this.active();
  },

  keyUp(e) {
    if (this.key && this.key.code === e.code) this.key = null;
  },

  // where an edit leaves the caret goes without saying
  noteCaret() {
    const s = recSelection();
    if (s) this.sel = s.join(' ');
  },

  selection() {
    const s = recSelection();
    if (!s) return;
    const sig = s.join(' ');
    if (sig === this.sel) return;
    this.sel = sig;
    this.tick();
    const [chId, ap, ao, fp, fo] = s;
    this.focusChapter(chId);
    const line = ap === fp && ao === fo ? ['s', fp, fo] : ['s', ap, ao, fp, fo];
    // moved by the pointer, by NEO itself, or (unmarked) by a key
    const now = performance.now();
    if (this.pointerDown || (this.lastPointerAt > this.lastKeyAt && now - this.lastPointerAt < 1000)) line.push('p');
    else if (now - this.lastKeyAt >= 1000) line.push('n');
    this.event(line);
  },

  clip(kind, text, flavour) {
    this.tick();
    const hash = Rec.digest(text);
    const line = ['c', kind, text.length, flavour, hash];
    if (kind === 'paste') {
      line.push(this.copied.includes(hash));
      // copied from a moment of Writing History: that moment
      if (this.copiedFrom.has(hash)) line.push(this.copiedFrom.get(hash));
    } else {
      this.copied.push(hash);
      if (this.copied.length > 50) this.copied.shift();
    }
    this.event(line);
  },

  context(what) {
    if (!this.on) return;
    this.tick();
    this.event(['f', what]);
    if (what === 'focus') this.wallClock();
  },

  wallClock() {
    if (!this.on) return;
    this.tick();
    this.event(['T', new Date().toISOString()]);
  },

  // keys or edits: the `idle` line waits for a minute without either
  // What the engine's next change is, when NEO has it made as typing (a
  // spelling suggestion picked: `spell`): an `x` line before it, so the
  // evidence doesn't count it as text that came with no key
  mark(cause) {
    if (!this.on || !this.w) return;
    this.tick();
    this.event(['x', cause]);
  },

  active() {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.context('idle'), REC_IDLE);
  },

  // A tag: a name on a moment of the history (Rec.tagsOf). `label` null is
  // one NEO makes for its own reasons (`made`), named when shown; `at` null
  // is this moment, else [session, line, device, iso]. It goes to disk at
  // once. `note`, a longer text beside the name, goes in only when there is
  // one (an older NEO ignores it). Returns null when nothing is recording,
  // else { ref: the moment the tag is on, saved: true once it's on disk,
  // false if it couldn't be }.
  tag(label, at = null, made = null, id = 't-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), note = null) {
    if (!this.on || !this.w) return null;
    this.tick();
    this.baseUnseen();
    this.live = true;
    this.order();
    const line = ['tag', id, label, at];
    if (typeof note === 'string' && note) line.push(made || null, note);
    else if (made) line.push(made);
    this.event(line);
    const c = this.flush();
    if (!c) return null;
    // the tag's own line, counted as History counts lines (the header is 1)
    const k = c.chunk.text.split('\n').findIndex((s) => s.includes('"tag"') && s.includes(JSON.stringify(id)));
    // with proof on, a tag the writer named, or a note another program left
    // (feedback), is sealed at once, not at the next hour, so "Sent to my
    // agent" is timestamped minutes after it's said
    const bookId = this.bookId;
    if ((typeof label === 'string' || (made && made.from)) && proofFlags().on) c.saved.then((ok) => ok && window.neo.proofSeal(bookId)).catch(() => {});
    return { id, ref: [this.session.id, c.chunk.first + k, this.device], saved: c.saved };
  },

  // The lines so far, as one chunk, to disk: from flushAllSaves, and when
  // a session closes, a tag is made or the history is opened. Returns the
  // chunk and a promise of whether it reached the disk, or null for none.
  flush() {
    if (!this.on || !this.live) return null;
    this.order();
    const c = this.w.chunk();
    if (!c) return null;
    const { bookId } = this;
    const id = this.session.id;
    const send = (part) => {
      const sent = window.neo.recChunk(bookId, id, part.first, part.text).then((r) => {
        if (r && r.lost) { this.lost(bookId, id); return false; }
        this.chunks++;
        return true;
      }, (err) => {
        window.neo.logError('recording chunk: ' + (err && err.message || err));
        if (this.session && this.session.id === id) this.retry.push(part); // tried again with the next
        return false;
      });
      const sending = this.sending;
      sending.add(sent);
      sent.then(() => sending.delete(sent));
      return sent;
    };
    for (const part of this.retry.splice(0)) send(part);
    return { chunk: c, saved: send(c) };
  },

  // The book's history was deleted on another device while this session
  // was open (rec:chunk found its start gone): it ends, and a new one starts
  // from the book as it is, as after a delete here. Nothing is said: the
  // words are all on the page, and the new session's baselines hold them.
  lost(bookId, id) {
    if (!this.on || this.bookId !== bookId || !this.session || this.session.id !== id || this.losing) return;
    this.losing = true;
    this.retry = [];
    window.neo.logError('recording: this book’s history was deleted on another device; starting again');
    Promise.resolve(this.end()).catch(() => {}).then(() => {
      this.losing = false;
      if (book && book.id === bookId && recordingWanted()) return recRestart(bookId);
    }).catch((err) => window.neo.logError('recording restart: ' + (err && err.message || err)));
  },

  rollup() {
    if (!this.on || !this.chunks) return;
    this.chunks = 0;
    window.neo.recRollup(this.bookId, this.session.id).catch((err) => window.neo.logError('recording rollup: ' + (err && err.message || err)));
  },

  // In strict mode, before a key, a paste or an input is handled: a page
  // that no longer matches chapterHTML was changed by something that
  // didn't say so. It's counted and shown, and the next change takes it in.
  drift(chId, body) {
    if (!this.strict || !this.on || chapterHTML[chId] === undefined) return;
    const html = captureBody(body);
    if (html === chapterHTML[chId]) return;
    this.counts.drift++;
    console.warn('[rec] page drifted from chapterHTML in', chId, Rec.splice(chapterHTML[chId], html));
  },

  // Replays this session and compares it with the book in memory.
  check() {
    if (!this.w) return { ok: true, lines: 0, mismatched: [], badWrites: [], problems: [], ...this.counts };
    this.streams(); // (titles, the outline and stickies are looked at when they're saved)
    this.w.endRun();
    const text = this.w.lines.join('\n') + '\n';
    const r = Rec.replayCheck([text], this.startKnown);
    const mismatched = [];
    const texts = book ? Rec.streamTexts(book, stickies) : {};
    const want = (chId) => {
      if (recIsNotes(chId)) return recNotesNow(chId);
      if (Rec.isStream(chId)) return book ? texts[chId] : this.model[chId];
      return chapterHTML[chId] == null ? undefined : String(chapterHTML[chId]);
    };
    for (const chId of this.inSession) if (r.chapters[chId] !== want(chId)) mismatched.push(chId);
    const notesPages = [Rec.STREAMS.notes, ...Object.keys(this.model).filter((id) => recIsNotes(id) && id !== Rec.STREAMS.notes)];
    if (this.on) for (const chId of [...Object.keys(chapterHTML), ...Object.keys(texts), ...notesPages]) if (!this.inSession.has(chId) && this.model[chId] !== want(chId)) mismatched.push(chId);
    const badWrites = r.bad.map((w) => w.line);
    const result = {
      ok: !mismatched.length && !badWrites.length && !r.problems.length && !this.counts.unobserved,
      ...this.counts, lines: this.w.lines.length, mismatched, badWrites, problems: r.problems
    };
    console.log('[rec] check', result);
    return result;
  }
};

// Every change to chapterHTML comes through here, with what caused it:
// 'input' (typing, paste, dictation: anything the engine did, with its
// inputType) or one of NEO's own moves ('split', 'merge', 'new', …).
function setChapterHTML(chId, html, cause, opts) {
  chapterHTML[chId] = html;
  rec.change(chId, html, cause, opts);
}
function dropChapterHTML(chId, cause) {
  noteRemoved(chId, textHash(String(chapterHTML[chId] || ''))); // so another device's book.json can't bring it back
  delete chapterHTML[chId];
  rec.drop(chId, cause);
}

// The book's other writing as it opened (notes.html, and the titles,
// outline and stickies as book.json and stickies.json hold them): what the
// recorder's first look at each is measured from
async function recOpenStreams(bookId) {
  if (!rec.on || rec.bookId !== bookId) return;
  const notes = await window.neo.readAux(bookId, 'notes');
  if (!rec.on || rec.bookId !== bookId || !book || book.id !== bookId) return;
  rec.change(Rec.STREAMS.notes, notes || '', 'open');
  for (const [id, text] of Object.entries(Rec.streamTexts(book, stickies))) rec.change(id, text, 'open');
}

// The notes pages: the book's (notes.html, the stream :notes) and each
// chapter's own (notes-<chapter>.html, the stream :notes-<chapter>), named
// after their files. A stream is any id that starts with ':', so every
// reader already sets them apart from the chapters.
const recNotesId = (kind) => (kind === 'notes' ? Rec.STREAMS.notes : ':' + kind);
const recIsNotesKind = (kind) => kind === 'notes' || /^notes-./.test(kind || '');
const recIsNotes = (id) => id === Rec.STREAMS.notes || /^:notes-./.test(id || '');

// The Notes tab, as it reads a page: text that isn't what the recorder
// last saw came from another device. recNotesShown is the page as the
// tab drew it, so a page drawn differently (the browser tidies HTML it's
// given) is a tidy of its own, not part of the first key. A chapter's page
// is first recorded when it is first read.
let recNotesShown = null;
function recNotesRead(html, bookId, kind = 'notes') {
  if (!rec.on || rec.bookId !== bookId) return;
  const id = recNotesId(kind);
  if (rec.model[id] === undefined) rec.change(id, html, 'open');
  else if (rec.model[id] !== html) rec.change(id, html, 'disk-adopt');
}
function recNotesInput(e) {
  if (!rec.on) return;
  const ed = $('#aux-editor');
  const id = recNotesId(ed.dataset.kind);
  if (recNotesShown !== null && rec.model[id] !== undefined && rec.model[id] !== recNotesShown) rec.change(id, recNotesShown, 'tidy');
  recNotesShown = null;
  rec.change(id, ed.innerHTML, 'input', { inputType: e.inputType });
}
// a notes page as it is now: on the page while the Notes tab shows it
function recNotesNow(id = Rec.STREAMS.notes) {
  const ed = $('#aux-editor');
  return currentTab === 'notes' && recIsNotesKind(ed.dataset.kind) && recNotesId(ed.dataset.kind) === id && !ed.hidden ? ed.innerHTML : rec.model[id];
}
// A notes page NEO itself rewrites (a joined chapter's notes folded into
// the page of the one it joined): `was` what the page held, `html` what
// is written, with its cause and then its write
function recNotesWrite(bookId, kind, was, html, cause) {
  if (!rec.on || rec.bookId !== bookId) return;
  const id = recNotesId(kind);
  if (rec.model[id] === undefined) rec.change(id, was || '', 'open');
  else if (rec.model[id] !== (was || '')) rec.change(id, was || '', 'disk-adopt');
  rec.change(id, html, cause);
  rec.reconcile(id, html);
}

// Where the caret sits in a chapter's HTML: the length of what captureBody
// would write for everything before it, or -1 when that can't be said.
// Only asked for when a splice could sit in more than one place.
function caretHtmlOffset(body, html) {
  const sel = window.getSelection();
  if (!sel.rangeCount || !sel.isCollapsed || !body.contains(sel.focusNode)) return -1;
  const r = document.createRange();
  r.selectNodeContents(body);
  r.setEnd(sel.focusNode, sel.focusOffset);
  const holder = document.createElement('div');
  holder.appendChild(r.cloneContents());
  const before = captureBody(holder).replace(/(<\/[a-z0-9]+>)+$/i, '');
  return html.startsWith(before) ? before.length : -1;
}

// What happens around the chapters. Capture phase, so a key is in the
// recording before NEO's own handlers act on it.
// the chapter (or the notes) a key or a clipboard event is in, or null
function recWhere(target) {
  if (!rec.on) return null;
  const body = recBodyOf(target);
  if (body) return body.closest('.chapter').dataset.id;
  const el = target && (target.nodeType === Node.TEXT_NODE ? target.parentElement : target);
  // a footnote's box, beside its chapter's text: that chapter's
  const fb = el && el.closest ? el.closest('.fn-box') : null;
  if (fb) return typeof fnBox !== 'undefined' && fnBox && fnBox.el === fb ? fnBox.chId : null;
  const notes = el && el.closest ? el.closest('#aux-editor') : null;
  return notes && recIsNotesKind(notes.dataset.kind) ? recNotesId(notes.dataset.kind) : null;
}
const recInChapter = (target) => !!recWhere(target);
// the notes' caret isn't recorded, so neither are the keys that only move it
const REC_CARET_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);
document.addEventListener('keydown', (e) => {
  const id = recWhere(e.target);
  if (id && !(Rec.isStream(id) && REC_CARET_KEYS.has(e.key))) rec.keyDown(e, id);
}, true);
document.addEventListener('keyup', (e) => rec.keyUp(e), true);
document.addEventListener('pointerdown', () => { rec.pointerDown = true; rec.lastPointerAt = performance.now(); }, true);
document.addEventListener('pointerup', () => { rec.pointerDown = false; rec.lastPointerAt = performance.now(); }, true);
document.addEventListener('selectionchange', () => { if (rec.on) rec.selection(); });
for (const kind of ['copy', 'cut']) {
  document.addEventListener(kind, (e) => { if (recInChapter(e.target)) rec.clip(kind, String(window.getSelection()), 'text'); }, true);
}
document.addEventListener('paste', (e) => {
  if (!recInChapter(e.target)) return;
  const data = e.clipboardData;
  rec.clip('paste', data ? data.getData('text/plain') : '', data && [...data.types].includes('text/html') ? 'html' : 'text');
}, true);
document.addEventListener('compositionstart', (e) => { if (recInChapter(e.target)) rec.context('compose'); }, true);
document.addEventListener('compositionend', (e) => { if (recInChapter(e.target)) rec.context('composed'); }, true);
window.addEventListener('focus', () => rec.context('focus'));
window.addEventListener('blur', () => rec.context('blur'));
document.addEventListener('visibilitychange', () => rec.context(document.visibilityState === 'visible' ? 'visible' : 'hidden'));
setInterval(() => rec.wallClock(), REC_WALL);
setInterval(() => rec.rollup(), REC_ROLLUP);

// Off, Record only, or Record and timestamp, from Options. With `asked` the
// writer chose it having read what each level means; otherwise timestamping
// asks first, in plain words, before anything is sent.
// Returns the level it's at now.
async function setHistoryLevel(level, { asked = false } = {}) {
  if (level === 'timestamp' && !window.neo.proofSet) level = 'record';
  const wasRecording = recordingWanted();
  const wasProving = proofFlags().on;
  if (level === 'timestamp' && !wasProving && !asked && !await proofConsent()) {
    if (window.neo.recState) window.neo.recState();
    return historyLevel();
  }
  library.recordWriting = level !== 'off';
  // (Pocket can't timestamp: it leaves the desktop's choice alone, unless off)
  if (window.neo.proofSet || level === 'off') library.proveWriting = level === 'timestamp';
  await writeLibrary(library);
  if (window.neo.proofSet) await window.neo.proofSet(proofFlags()).catch(() => {});
  if (window.neo.recState) window.neo.recState();
  paintHistoryShows();
  if (wasRecording && level === 'off') {
    rec.end();
    if (!asked) toast(t('Writing History is off. Nothing already recorded is touched.'), 6000);
  } else if (!wasRecording && level !== 'off') {
    if (!asked) toast(t('NEO records every keystroke so you can watch how your book was written, and bring back any earlier version. It stays with your book, and your words are never sent anywhere.'), 8000);
    if (book) await recRestart(book.id);
  }
  // the book open is sealed now, rather than at the next hour
  if (level === 'timestamp' && !wasProving && book && rec.on && rec.bookId === book.id) {
    const c = rec.flush();
    if (c) await c.saved;
    window.neo.proofSeal(book.id).catch(() => {});
  }
  return level;
}

// Proof of when I wrote (docs/neo-recording-plan.md, part 2): on with
// Writing History once the writer has said yes (askProofOnce), unless they
// turn it off in Options. The main process seals and
// stamps (proof.js); the window only says whether it's wanted. Pocket has
// no proofSet, so it never offers it.
const proofFlags = () => ({
  on: !!(window.neo.proofSet && library && library.proveWriting === true && recordingWanted()),
  // the timestamp services the writer chose (Timestamp services…)
  tsas: library && Array.isArray(library.proofTsas) ? library.proofTsas : null
});

// Record and timestamp, from Options or asked once (askProofOnce): asked in
// plain words before anything is sent. True on yes; with `first`, false on
// Record Only and null when put aside (Esc, a click beside it).
async function proofConsent({ first = false } = {}) {
  const sure = await confirmModal({
    title: t('Timestamp your writing history?'),
    points: [
      t('NEO can record timestamps to prove when your writing happened. Every hour you write, NEO sends a fingerprint of your writing history (never your words) to two independent timestamp services. Their signed receipts show your writing existed by that time.'),
      ...await proofWhoSays(),
      t('Your timestamps are signed with a key kept on this computer, and stay with your book in its Writing History. The timestamps can be verified without NEO.'),
      t('Timestamps can’t be added retrospectively: they cover what you write from now on, as you write it. What you wrote before stays in your Writing History, but there’s no timestamp that fixes it in time.'),
      t('A timestamp shows when your writing existed, not who wrote it. Your Writing History shows how you wrote it.'),
      ...(first ? [t('You can change this at any time in {options} → Writing History.', { options: t('Options…') })] : [])
    ],
    ok: t('Turn on timestamping'),
    cancel: first ? t('Record Only') : ''
  });
  return first ? sure : !!sure;
}

// Timestamping is NEO's default, but nothing leaves the computer until the
// writer has said yes, once, for every device on the library: asked on the
// shelf with nothing else open (first run, What's New), never over a book
// being written. Yes is Record and Timestamp, Record Only is that; put
// aside, it's asked again the next time NEO starts. Pocket never asks.
let proofAskDone = false;
async function askProofOnce() {
  if (proofAskDone || !window.neo.proofSet || !library || 'proveWriting' in library || !recordingWanted()) return;
  if ($('#bookshelf-view').hidden || !$('#firstrun').hidden) return;
  if ([...document.querySelectorAll('.modal-backdrop')].some((b) => !b.hidden && b.getClientRects().length > 0)) return;
  proofAskDone = true;
  const yes = await proofConsent({ first: true });
  if (yes === null || 'proveWriting' in library) return; // (or another device answered meanwhile)
  library.proveWriting = yes;
  await writeLibrary(library);
  await window.neo.proofSet(proofFlags()).catch(() => {});
  if (window.neo.recState) window.neo.recState();
}
setInterval(() => { askProofOnce().catch(() => {}); }, 1000);

// Who the opt-in says the fingerprint goes to: the services the writer's
// library asks first (Timestamp services…), DigiCert and Sectigo unless changed
async function proofWhoSays() {
  let on = [];
  try { on = (await window.neo.proofServices()).filter((s) => s.on); } catch { /* the defaults, then */ }
  if (!on.length || on.slice(0, 2).map((s) => s.id).join() === 'digicert,sectigo') {
    return [t('The fingerprint goes to DigiCert and Sectigo, the companies that timestamp signed software, and each timestamp carries a public random number from drand, so it can’t have been made before then.')];
  }
  const names = new Intl.ListFormat(NeoI18n.getLocale(), { type: 'conjunction' }).format(on.map((s) => s.name));
  return [t('The fingerprint goes to {services}, the timestamp services you chose, and each timestamp carries a public random number from drand, so it can’t have been made before then.', { services: names })];
}

// Timestamp services… (docs/neo-recording-plan.md, The writer's own
// services): who stamps the seals, opened from Options → Writing
// History → Timestamp Services…. NEO's three and any the writer added, in the order they're
// asked; the first two that answer stamp each seal. Every change is kept at
// once, in library.proofTsas, so the writer's other computers ask the same
// services; main.js hands back each change as keep, roots and all.
// Resolves when closed.
async function openTsaServices() {
  if (!window.neo.proofServices) return;
  let list = [];
  try {
    await window.neo.proofSet(proofFlags()); // (the library as it is now)
    list = await window.neo.proofServices();
  } catch { return; }
  const kept = (r) => {
    if (!r || !Array.isArray(r.list)) return list;
    if (r.keep) library.proofTsas = r.keep;
    else delete library.proofTsas;
    writeLibrary(library);
    return r.list;
  };
  return new Promise((resolve) => {
    const bd = document.createElement('div');
    bd.className = 'modal-backdrop tsa-backdrop';
    bd.innerHTML = `
      <div class="modal tsa-modal" role="dialog" aria-modal="true">
        <h2></h2>
        <p class="tsa-lede"></p>
        <ul class="tsa-list"></ul>
        <p class="tsa-warn" hidden></p>
        <div class="tsa-add" hidden>
          <div class="tsa-row"><input type="url" spellcheck="false" autocomplete="off"><button class="tsa-try btn-quiet" type="button"></button></div>
          <p class="tsa-said" hidden></p>
          <div class="tsa-row tsa-yes" hidden><button class="tsa-cancel btn-quiet" type="button"></button><button class="tsa-ok btn-gold" type="button"></button></div>
        </div>
        <div class="tsa-foot">
          <button class="tsa-new btn-quiet" type="button"></button>
          <button class="tsa-reset btn-quiet" type="button"></button>
          <button class="m-ok btn-gold" type="button"></button>
        </div>
      </div>`;
    const $q = (sel) => bd.querySelector(sel);
    const title = t('Timestamp services');
    $q('h2').textContent = title;
    $q('.modal').setAttribute('aria-label', title);
    $q('.tsa-lede').textContent = t('Each hour’s fingerprint, never your words, goes to these services in this order, until two have timestamped it. A service whose box is clear is never asked.');
    $q('.tsa-new').textContent = t('Add a service…');
    $q('.tsa-reset').textContent = t('Restore the defaults');
    $q('.m-ok').textContent = t('Done');
    const input = $q('.tsa-add input');
    input.placeholder = 'https://…';
    input.setAttribute('aria-label', t('The service’s web address'));
    $q('.tsa-try').textContent = t('Check');
    $q('.tsa-cancel').textContent = t('Cancel');
    const ul = $q('.tsa-list');
    const warn = $q('.tsa-warn');

    const save = async (next) => {
      try { list = kept(await window.neo.proofServicesSet(next.map((s) => ({ id: s.id, on: s.on })))); } catch { /* shown as it was */ }
      render();
    };
    function render(focusId = null, focusSel = null) {
      ul.textContent = '';
      list.forEach((s, i) => {
        const li = document.createElement('li');
        const label = document.createElement('label');
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = s.on;
        box.addEventListener('change', () => save(list.map((x) => (x === s ? { ...x, on: box.checked } : x))));
        const name = document.createElement('span');
        name.className = 'tsa-name';
        name.textContent = s.name;
        label.append(box, ' ', name);
        const about = document.createElement('span');
        about.className = 'tsa-about';
        about.textContent = s.added
          ? (s.public
            ? t('Added by you. Its root, {root}, is in Mozilla’s list.', { root: s.rootName })
            : t('Added by you. Its root, {root}, is in no public list, so its stamps are proof only to someone who trusts {name}.', { root: s.rootName, name: s.name }))
          : s.url;
        about.title = s.url;
        const acts = document.createElement('span');
        acts.className = 'tsa-acts';
        const btn = (txt, label, cls, disabled, fn) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'tsa-move ' + cls;
          b.textContent = txt;
          b.title = label;
          b.setAttribute('aria-label', label + ': ' + s.name);
          b.disabled = disabled;
          b.addEventListener('click', fn);
          acts.append(b);
        };
        const move = (by, sel) => () => {
          const next = list.slice();
          next.splice(i, 1);
          next.splice(i + by, 0, s);
          save(next).then(() => render(s.id, sel));
        };
        btn('↑', t('Move up'), 'tsa-up', i === 0, move(-1, '.tsa-up'));
        btn('↓', t('Move down'), 'tsa-down', i === list.length - 1, move(1, '.tsa-down'));
        if (s.added) {
          btn('×', t('Take out'), 'tsa-x', false, async () => {
            try { list = kept(await window.neo.proofServiceRemove(s.id)); } catch { /* as it was */ }
            render();
            $q('.tsa-new').focus();
          });
        }
        li.dataset.id = s.id;
        li.append(label, acts, about);
        ul.append(li);
      });
      const on = list.filter((s) => s.on);
      const notPublic = on.slice(0, 2).find((s) => s.added && !s.public);
      warn.textContent = !on.length
        ? t('With none on, your writing is still recorded, but nothing timestamps it.')
        : on.length < 2
          ? t('With one on, your writing gets one timestamp each hour instead of two. Two services from different companies make a much harder story to argue with.')
          : notPublic
            ? t('Stamps from {name} rest on a root you added, so they don’t count toward the time cover in Evidence.', { name: notPublic.name })
            : '';
      warn.hidden = !warn.textContent;
      if (focusId) {
        const li = ul.querySelector(`li[data-id="${focusId}"]`);
        const b = li && li.querySelector(focusSel);
        (b && !b.disabled ? b : li && li.querySelector('input')).focus();
      }
    }
    render();

    // Adding: the address, one test request, what it said, then yes or no
    const said = $q('.tsa-said');
    const yes = $q('.tsa-yes');
    let tried = null;
    const resetAdd = () => { tried = null; said.hidden = true; yes.hidden = true; $q('.tsa-try').disabled = false; };
    $q('.tsa-new').addEventListener('click', () => {
      $q('.tsa-add').hidden = false;
      $q('.tsa-new').hidden = true;
      input.focus();
    });
    input.addEventListener('input', resetAdd);
    async function check() {
      const url = input.value.trim();
      if (!url) return;
      resetAdd();
      $q('.tsa-try').disabled = true;
      said.hidden = false;
      said.textContent = t('Asking it for a timestamp…');
      let r;
      try { r = await window.neo.proofServiceTry(/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : 'https://' + url); } catch (err) { r = { ok: false, problems: [String(err && err.message || err)] }; }
      if (!bd.isConnected || input.value.trim() !== url) return;
      $q('.tsa-try').disabled = false;
      if (!r.ok) {
        said.textContent = t('NEO couldn’t use it: {why}', { why: (r.problems || []).join('; ') });
        return;
      }
      tried = r;
      said.textContent = r.public
        ? t('{name} answered with a good timestamp. Its root, {root}, is in Mozilla’s list of trusted roots.', { name: r.name, root: r.rootName })
        : t('{name} answered with a good timestamp, but its root, {root}, is in no public list. NEO keeps the root in your library and in each book it stamps, so its stamps can be checked, but they’re independent proof only to someone who trusts {name}.', { name: r.name, root: r.rootName });
      $q('.tsa-ok').textContent = r.public ? t('Add') : t('Add anyway');
      yes.hidden = false;
      $q('.tsa-ok').focus();
    }
    $q('.tsa-try').addEventListener('click', check);
    input.addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Enter') { e.preventDefault(); check(); }
    });
    const closeAdd = () => {
      input.value = '';
      resetAdd();
      $q('.tsa-add').hidden = true;
      $q('.tsa-new').hidden = false;
      $q('.tsa-new').focus();
    };
    $q('.tsa-cancel').addEventListener('click', closeAdd);
    $q('.tsa-ok').addEventListener('click', async () => {
      if (!tried) return;
      try { list = kept(await window.neo.proofServiceAdd(tried.url)); } catch { /* as it was */ }
      closeAdd();
      render();
    });

    $q('.tsa-reset').addEventListener('click', async () => {
      const added = list.filter((s) => s.added);
      if (added.length) {
        const sure = await confirmModal({
          title: t('Restore the defaults?'),
          points: [
            t('DigiCert, Sectigo and GlobalSign, in that order, all on.'),
            t('The services you added are taken out. Their stamps already in your books stay there, and can still be checked.')
          ],
          ok: t('Restore the defaults')
        });
        if (!sure || !bd.isConnected) { $q('.tsa-reset').focus(); return; }
      }
      try { list = kept(await window.neo.proofServicesReset()); } catch { /* as it was */ }
      render();
      $q('.tsa-reset').focus();
    });

    const done = () => { bd.remove(); resolve(); };
    $q('.m-ok').addEventListener('click', done);
    bd.addEventListener('keydown', (e) => {
      e.stopPropagation(); // (not to History behind it)
      if (e.key === 'Escape') {
        e.preventDefault();
        if (!$q('.tsa-add').hidden && document.activeElement && $q('.tsa-add').contains(document.activeElement)) closeAdd();
        else done();
      }
    });
    document.body.appendChild(bd);
    const first = ul.querySelector('input');
    (first || $q('.m-ok')).focus();
  });
}

// Recording the open book from now, as it is now
async function recRestart(bookId) {
  await rec.begin(bookId);
  if (!book || book.id !== bookId) return;
  for (const [chId, html] of Object.entries(chapterHTML)) rec.change(chId, html, 'open');
  await recOpenStreams(bookId);
  takeHistoryNotes(bookId); // notes left while nothing recorded
}

// A row that scrolls sideways (History's days): a mouse drags it as a
// finger does, the wheel scrolls it sideways, and an edge with more beyond
// it fades out (.edge-l, .edge-r: NEO's sign of more off screen). A drag
// that moved doesn't also click what it started on. The exported page has
// its own copy (replay-page.js, sideScroll).
function sideScroll(el) {
  const edges = () => {
    const max = el.scrollWidth - el.clientWidth;
    el.classList.toggle('edge-l', el.scrollLeft > 2);
    el.classList.toggle('edge-r', max - el.scrollLeft > 2);
  };
  el.addEventListener('scroll', edges, { passive: true });
  new ResizeObserver(edges).observe(el);
  new MutationObserver(edges).observe(el, { childList: true });
  el.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || el.scrollWidth <= el.clientWidth) return;
    el.scrollLeft += e.deltaY;
    e.preventDefault();
  }, { passive: false });
  let drag = null;
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' || e.button !== 0) return; // a finger scrolls it already
    drag = { x: e.clientX, left: el.scrollLeft, id: e.pointerId, moved: false };
  });
  el.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) < 6) return;
    if (!drag.moved) { drag.moved = true; el.setPointerCapture(e.pointerId); el.classList.add('dragging'); }
    el.scrollLeft = drag.left - dx;
  });
  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (drag.moved) {
      el.classList.remove('dragging');
      // the click this drag ends with (if one comes, it comes now) isn't a pick
      const eat = (c) => { c.stopPropagation(); c.preventDefault(); };
      el.addEventListener('click', eat, { capture: true, once: true });
      setTimeout(() => el.removeEventListener('click', eat, { capture: true }), 0);
    }
    drag = null;
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  edges();
}
