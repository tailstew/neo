// Writing History's cache, built in its own process (docs/neo-recording-plan.md,
// Days, seeking and search). main.js forks this with Electron's
// utilityProcess, as it does the spellchecker, so the window never waits
// while a year of writing is played. It only reads the recording, every
// device's; what it writes is the cache in userData
// (recording-cache/<book>/), which can always be built again:
//
//   days.json.gz          the index: every day built, with its sessions'
//                         stats and day stats
//   day-<day>.json.gz     a day's end state of each chapter it changed, on
//                         the page and on each device that wrote that day,
//                         whole or as a paragraph diff
//
// A day is every device's sessions of that writer's day, in the order they
// began (Rec.sessionOrder), played through one Rec.Page.
//
// Messages: { id, type: 'days', key, root, cache } answers at once with the
// days already built, then posts { type: 'kept', key, entries, done, total }
// with the days the cache holds (the answer can come before the worker has
// read them), builds the rest oldest first, posting
// { type: 'progress', key, entry, done, total } after each, and
// { type: 'built', key, open } at the end, with the stats of the sessions
// still open (never cached). { id, type: 'dayStart', key, day } answers with
// the page and each device's chapters as they were when that day began.
//
// { id, type: 'search', key, phrase, sid } waits for the build, answers with
// the first pass over the day states, then looks inside the days that pass
// can't see into, posting { type: 'search', key, sid, done, total } as it
// goes and { type: 'search', key, sid, findings, finished } at the end.
// { type: 'searchStop', key } stops it.
//
// { id, type: 'track', key, day, part: { ch, a, b }, from } carries a part
// of a chapter, as `day` ended (`from`, the chapter's HTML then), on to the
// last day built, a day's end to the next (Rec.partDays), for a restore.
//
// { id, type: 'evidence', key, chapters, texts } answers with the evidence
// report's figures (Rec.evidence) over every session, or only the lines of
// `chapters`, the devices' names, the time cover from each device's seals
// (desktop only), and with `texts` the sessions themselves, for an
// exported replay page.
//
// Each message names the book's recording/ folder (`root`), its cache
// (`cache`), and its backup mirror (`mirror`, Backups/recordings/<book
// folder>/), where a closed session the book has lost, or holds broken, is
// read from.
//
// It reads and writes through an `io` (recording-files.js): Node's files
// here, Capacitor's in Pocket, where this file runs in a web worker
// (pocket/www/pocket-history.js) as self.NeoHistory.
(function (root, factory) {
  const node = typeof module === 'object' && module.exports;
  const api = node ? factory(require('./recording.js'), require('./recording-files.js')) : factory(root.NeoRecording, root.NeoRecordingFiles);
  if (node) module.exports = api;
  else root.NeoHistory = api;
})(typeof self !== 'undefined' ? self : this, function (R, Files) {
  'use strict';

  const node = typeof process === 'object' && !!(process.versions && process.versions.node);
  let nodeIO = null;
  if (node) {
    const fs = require('fs');
    const path = require('path');
    const zlib = require('zlib');
    const crypto = require('crypto');
    // Node's SHA-256: the same hashes as recording.js's own, many times faster
    R.setDigest((data) => crypto.createHash('sha256').update(data).digest().subarray(0, 16).toString('base64url'));
    // a cache file written whole or not at all (no fsync: it can be built again)
    const write = (file, data) => {
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, data);
      fs.renameSync(tmp, file);
    };
    // `sync`: its answers come at once, so day files are read as they're needed
    nodeIO = { ...Files.nodeIO({ fs, path, zlib, write, log: (source, err) => console.error(source, err) }), sync: true };
  }

  const DAY = /^\d{4}-\d\d-\d\d$/;
  const INDEX = 2; // the index file's own shape

  const byDay = (a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0);
  const later = () => new Promise((resolve) => (typeof setImmediate === 'function' ? setImmediate(resolve) : setTimeout(resolve, 0)));

  // One book's days: root is recording/ in the book (a folder per device),
  // mirror its backup, cache the book's folder in recording-cache/, io how
  // to reach them
  class BookDays {
    constructor({ root, mirror = null, cache, io = nodeIO }) {
      this.root = root;
      this.mirror = mirror;
      this.cache = cache;
      this.io = io;
      this.entries = [];   // the days built, oldest first
      this.open = [];      // the sessions still being written: { id, device, open, stats }
      this.live = [];      // …and where they are: { id, device, day }
      this.building = null;
      this.loaded = new Map(); // day -> its file, read ahead where io answers later (Pocket)
    }

    get indexFile() { return this.io.join(this.cache, 'days.json.gz'); }
    dayFile(day) {
      if (!DAY.test(day)) throw new Error('Invalid day');
      return this.io.join(this.cache, `day-${day}.json.gz`);
    }
    // A day's file, or null. recording.js asks for them as it goes, so where
    // io answers later, loadDays has read them ahead.
    readDay(day) {
      if (this.loaded.has(day)) return this.loaded.get(day);
      if (!this.io.sync) throw new Error('Writing History: day ' + day + ' was not read ahead');
      try { return JSON.parse(this.io.readGz(this.dayFile(day))); } catch { return null; }
    }
    // a day's file, which must be there
    needDay(day) {
      const f = this.readDay(day);
      if (!f) throw new Error('The Writing History cache lost ' + day);
      return f;
    }
    // the files of the first `upto` days that changed anything, read ahead
    async loadDays(upto) {
      if (this.io.sync) return;
      const want = this.entries.slice(0, upto)
        .filter((e) => !this.loaded.has(e.day) && (Object.keys(e.kinds || {}).length || Object.keys(e.devices || {}).length));
      for (let i = 0; i < want.length; i += 8) {
        await Promise.all(want.slice(i, i + 8).map(async (e) => {
          let f = null;
          try { f = JSON.parse(await this.io.readGz(this.dayFile(e.day))); } catch { /* lost, as readDay says */ }
          this.loaded.set(e.day, f);
        }));
      }
    }

    async readIndex() {
      try {
        const idx = JSON.parse(await this.io.readGz(this.indexFile));
        if (idx && idx.v === INDEX && idx.player === R.PLAYER && Array.isArray(idx.entries)) return idx;
      } catch { /* none yet, or unreadable: built again */ }
      return { v: INDEX, player: R.PLAYER, days: {}, entries: [] };
    }
    async writeIndex(idx) {
      await this.io.writeGz(this.indexFile, JSON.stringify({ ...idx, entries: this.entries }));
    }

    dir(device) {
      if (!Files.DEVICE.test(device)) throw new Error('Invalid recording device');
      return this.io.join(this.root, device);
    }

    copy(device) { return this.mirror ? this.io.join(this.mirror, device) : null; }

    // every device's closed sessions and open ones, the mirror's too: [{ id, device }]
    async list() {
      const closed = [];
      const open = [];
      for (const d of await Files.list(this.io, this.root, null, this.mirror)) {
        for (const s of d.sessions) (s.open ? open : closed).push({ id: s.id, device: d.device });
      }
      return { closed: closed.sort(R.sessionOrder), open: open.sort(R.sessionOrder) };
    }

    async closedText(s) { return Files.readClosed(this.io, this.dir(s.device), s.id, this.copy(s.device)); }

    // An open session's parts, joined. Its own device may roll them up while
    // they're read (readParts looks again), or close it.
    async openText(s) {
      try {
        return R.joinParts(await Files.readParts(this.io, this.io.join(this.dir(s.device), s.id))).text;
      } catch (err) {
        if (!err || err.code !== 'ENOENT') throw err;
        try { return await this.closedText(s); } catch { return ''; } // it closed meanwhile
      }
    }

    async text(s) {
      if (s.open) return this.openText(s);
      try { return await this.closedText(s); } catch { return ''; }
    }

    // Builds every day not yet in the cache, oldest first. kept(entries,
    // total) first, with the days the cache already holds, then
    // progress(entry, done, total) after each day built; yields between days so other messages are
    // answered meanwhile. A session left open on a day before the last any
    // device closed one is built with the closed ones: its device stopped
    // (it closes it, crashed, when it opens the book again, and that day is
    // built again). The open sessions on that day or later are still being
    // written, so they're never cached: they're played on from the last day.
    async build(progress = () => {}, kept = () => {}) {
      const idx = await this.readIndex();
      const { closed, open } = await this.list();
      const texts = new Map();
      const name = (s) => s.device + '/' + s.id;
      const dayOf = (s, text) => R.sessionDay(R.parseSession(text).header) || s.id.slice(0, 10);
      let looked = false;
      // the day of each closed session, from its header (kept in the index)
      for (const s of closed) {
        s.day = idx.days[name(s)];
        if (!s.day) {
          let text;
          try { text = await this.closedText(s); } catch { s.day = null; continue; } // unreadable: a gap
          texts.set(name(s), text);
          s.day = idx.days[name(s)] = dayOf(s, text);
          looked = true;
        }
      }
      const last = closed.reduce((m, s) => (s.day && s.day > m ? s.day : m), '');
      const stale = [];
      this.live = [];
      for (const s of open) {
        const text = await this.openText({ ...s });
        if (!text) continue;
        s.day = dayOf(s, text);
        s.open = true;
        texts.set(name(s), text);
        (s.day < last ? stale : this.live).push(s);
      }
      const days = new Map();
      for (const s of [...closed.filter((x) => x.day), ...stale]) {
        if (!days.has(s.day)) days.set(s.day, []);
        days.get(s.day).push(s);
      }
      const groups = [...days.keys()].sort().map((day) => ({ day, list: days.get(day).sort(R.sessionOrder) }));
      // The days already built, as long as they hold the same sessions, and a
      // session that was open when its day was built (idx.open, its last `h`)
      // the same lines: closed sessions are never written again.
      idx.open = idx.open || {};
      const chain = async (s) => {
        if (!texts.has(name(s))) texts.set(name(s), await this.text(s));
        return R.verifyChain(texts.get(name(s)));
      };
      // (one built damaged is looked at again: the mirror may hold it whole)
      const same = async (x, s) => x.id === s.id && x.device === s.device &&
        (x.stats && x.stats.damaged ? !(await chain(s)).ok
          : !s.open && !idx.open[name(s)] ? true : x.head === (await chain(s)).last);
      let keep = 0;
      const was = idx.entries;
      for (; keep < was.length && keep < groups.length; keep++) {
        const e = was[keep];
        const g = groups[keep];
        if (e.day !== g.day || e.sessions.length !== g.list.length) break;
        let ok = true;
        for (let i = 0; ok && i < e.sessions.length; i++) ok = await same(e.sessions[i], g.list[i]);
        if (!ok || !(await this.io.exists(this.dayFile(e.day)))) break;
      }
      this.entries = was.slice(0, keep);
      for (const g of groups.slice(keep)) this.loaded.delete(g.day); // built again
      if (keep) kept(this.entries.slice(), groups.length);
      let builder = null;
      // (the end state is needed only to build on, or to play the open sessions from)
      if (keep && (keep < groups.length || this.live.length)) {
        try {
          await this.loadDays(keep);
          builder = R.DayBuilder.after(this.entries, (day) => this.needDay(day));
        } catch { keep = 0; this.entries = []; }
      }
      const todo = groups.slice(keep);
      if (!builder && (todo.length || this.live.length)) builder = new R.DayBuilder();
      let since = 0;
      for (let i = 0; i < todo.length; i++) {
        const g = todo[i];
        const sessions = [];
        for (const s of g.list) {
          let text = texts.get(name(s));
          if (text === undefined) text = await this.text(s);
          texts.delete(name(s));
          if (s.open) idx.open[name(s)] = true; else delete idx.open[name(s)];
          sessions.push({ id: s.id, device: s.device, text });
        }
        const { entry, file } = builder.day(g.day, sessions);
        await this.io.writeGz(this.dayFile(g.day), JSON.stringify(file));
        this.entries.push(entry);
        progress(entry, keep + i + 1, groups.length);
        if (++since >= 10 || i === todo.length - 1) { await this.writeIndex(idx); since = 0; }
        await later();
      }
      if (!todo.length && looked) await this.writeIndex(idx);
      // the sessions still open: played on from where the days end
      this.open = [];
      for (const s of this.live) {
        const stats = R.playSession(texts.get(name(s)), null, { page: builder.page, device: s.device });
        stats.id = stats.id || s.id;
        this.open.push({ id: s.id, device: s.device, open: true, stats });
      }
      return { entries: this.entries, open: this.open };
    }

    // The days to search: each built day, and the sessions still open on
    // their own day or the last one's. upto: the days of the index before it.
    searchDays() {
      const units = this.entries.map((e, i) => ({ day: e.day, list: e.sessions.map((s) => ({ id: s.id, device: s.device, open: false })), upto: i }));
      for (const o of this.live) {
        let u = units.find((x) => x.day === o.day);
        if (!u) {
          u = { day: o.day, list: [], upto: this.entries.length };
          units.push(u);
          units.sort(byDay);
        }
        u.list.push({ id: o.id, device: o.device, open: true });
      }
      for (const u of units) u.list.sort(R.sessionOrder);
      return units;
    }

    async sessionTexts(u) {
      const out = [];
      for (const s of u.list) out.push({ id: s.id, device: s.device, text: await this.text(s), open: s.open });
      return out;
    }

    // the page and every device's chapters once the first `upto` days are built
    async state(upto) {
      await this.loadDays(upto);
      return R.pageState(this.entries, upto, (d) => this.needDay(d));
    }

    // The first pass of a search: the day states, then the open sessions
    // played on from the last of them. Returns the findings and the days.
    async searchFirst(phrase) {
      const units = this.searchDays();
      await this.loadDays(this.entries.length);
      const { days, tally } = R.phraseDays(this.entries, (d) => this.needDay(d), phrase);
      const tail = units.filter((u) => u.list.some((s) => s.open));
      if (tail.length) {
        const page = await this.state(this.entries.length);
        for (const u of tail) {
          let d = days.find((x) => x.day === u.day);
          if (!d) { d = { day: u.day, before: tally.total, after: tally.total, changes: [] }; days.push(d); }
          const open = await this.sessionTexts({ list: u.list.filter((s) => s.open) });
          for (const c of R.phraseSessions(open, page, tally, { writes: false, check: false })) {
            const was = d.changes.find((x) => x.ch === c.ch);
            if (was) was.now = c.now; else d.changes.push({ ch: c.ch, was: c.was, now: c.now, lost: false });
          }
          d.after = tally.total;
          d.changes = d.changes.filter((c) => c.was !== c.now);
        }
        days.sort(byDay);
      }
      return { findings: R.phraseFindings(days, tally), units };
    }

    // The second pass: what the day states can't see, a phrase that came and
    // went within a day. First written can only move earlier, into the days
    // before it, played oldest first from nothing; Last written (and Written
    // out with it) only later, into the days after it, each played newest
    // first from its start state. A day counts once the book's count, at one
    // of its writes, goes above both the write before and the day's start.
    async searchWithin(phrase, first, stopped, progress) {
      const f = { ...first };
      const units = this.searchDays();
      const at = (day) => units.findIndex((u) => u.day === day);
      const fi = f.first ? at(f.first.day) : units.length;
      let total = fi + (f.last ? units.length - 1 - at(f.last.day) : 0);
      let done = 0;
      const step = async () => { progress(++done, total); await later(); return stopped(); };
      // a day's events, as the player finds them in the same day (phraseEvents)
      const play = async (u, page, tally) => {
        const start = tally.total;
        return { start, events: R.phraseSessions(await this.sessionTexts(u), page, tally) };
      };
      // earlier: every day before the first pass's first, from the beginning
      if (fi > 0) {
        const page = new R.Page();
        const tally = new R.PhraseTally(phrase);
        for (let i = 0; i < fi; i++) {
          const p = await play(units[i], page, tally);
          const hit = R.phrasePick(p.events, p.start, 'first');
          if (hit) { f.first = { day: units[i].day, ch: hit.ch }; break; }
          if (await step()) return { findings: f, finished: false };
        }
      }
      // a phrase never there at a day's end came and went on its first day
      if (f.first && !f.last) f.last = { ...f.first };
      if (f.first && !f.out && !f.total) f.out = { ...f.first };
      if (!f.last) return { findings: f, finished: true };
      // later: the days after the last, newest first
      const li = at(f.last.day);
      total = done + units.length - 1 - li;
      for (let i = units.length - 1; i > li; i--) {
        const u = units[i];
        await this.loadDays(u.upto);
        const page = R.pageState(this.entries, u.upto, (d) => this.readDay(d) || { chapters: {}, devices: {} });
        const tally = new R.PhraseTally(phrase);
        for (const [ch, c] of Object.entries(page.doc)) tally.set(ch, c.parts);
        const p = await play(u, page, tally);
        const hit = R.phrasePick(p.events, p.start, 'last');
        if (hit) {
          f.last = { day: u.day, ch: hit.ch };
          const gone = R.phrasePick(p.events, p.start, 'out');
          if (!f.total && gone) f.out = { day: u.day, ch: gone.ch };
          break;
        }
        if (await step()) return { findings: f, finished: false };
      }
      return { findings: f, finished: true };
    }

    // A part of a chapter as `day` ended, carried on to the last day built
    async track(day, part, from) {
      let n = 0;
      while (n < this.entries.length && this.entries[n].day <= day) n++;
      await this.loadDays(this.entries.length);
      return R.partDays(this.entries, n, (d) => this.needDay(d), part, String(from));
    }

    // The page and each device's chapters as they were when `day` began
    // (HTML by chapter id), and which device's copy the page showed of each:
    // { page, devices: { device: chapters }, links }. A session still open
    // from a day before is played on.
    async dayStart(day) {
      let upto = 0;
      while (upto < this.entries.length && this.entries[upto].day < day) upto++;
      let page;
      try { page = await this.state(upto); } catch (err) {
        await this.io.remove(this.indexFile);
        throw new Error(err.message + ': it is built again');
      }
      if (upto === this.entries.length) {
        for (const s of this.live) {
          if (s.day < day) R.playSession(await this.openText(s), null, { page, device: s.device });
        }
      }
      const html = (doc) => Object.fromEntries(Object.entries(doc).map(([ch, c]) => [ch, c.toString()]));
      const devices = {};
      for (const [d, doc] of Object.entries(page.docs)) devices[d] = html(doc);
      return { page: html(page.doc), devices, links: page.links() };
    }

    // Every session, every device's, oldest first ({ id, device, name, open,
    // text }); with `chapters`, only those chapters' lines (Rec.keepChapters),
    // as an exported replay page holds them
    async allTexts(chapters = null) {
      const out = [];
      for (const d of await Files.list(this.io, this.root, null, this.mirror)) {
        for (const s of d.sessions) {
          const r = await Files.read(this.io, this.dir(d.device), s.id, this.copy(d.device)).catch(() => null);
          if (!r || !r.text) continue;
          out.push({ id: s.id, device: d.device, name: d.name, open: r.open, text: chapters ? R.keepChapters(r.text, chapters) : r.text });
        }
      }
      return out.sort(R.sessionOrder);
    }

    // The evidence report: Rec.evidence over every session (with `chapters`,
    // over only their lines), and on the desktop the time cover, each
    // device's seals checked (proof.js) against its sessions, whole. The
    // same book and chapters give the same answer, so it's kept.
    // { evidence, names, cover: [{ device, seals, stamped, key, cover, problems }] | null }
    async evidence({ chapters = null, texts = false } = {}) {
      const list = await this.allTexts(chapters);
      const sig = JSON.stringify([chapters, list.map((s) => [s.device, s.id, s.open, s.text.length])]);
      if (!this.evMemo || this.evMemo.sig !== sig) {
        const names = {};
        for (const s of list) names[s.device] = s.name;
        const evidence = R.evidence(list);
        this.evMemo = { sig, result: { evidence, names, cover: node ? await this.cover(evidence, chapters ? null : list) : null } };
      }
      return texts ? { ...this.evMemo.result, texts: list } : this.evMemo.result;
    }

    // Each device's seals and the time cover of its sessions, or null when
    // no device has sealed. `list`: the sessions whole (a cut-down list is
    // read again, since a seal covers whole sessions).
    async cover(evidence, list) {
      const fs = require('fs');
      const P = require('./proof.js');
      const devices = fs.existsSync(this.root) ? fs.readdirSync(this.root).filter((d) => Files.DEVICE.test(d)) : [];
      if (!devices.some((d) => fs.existsSync(this.io.join(this.dir(d), 'seals')))) return null;
      if (!list) list = await this.allTexts();
      const out = [];
      for (const device of devices) {
        const mine = list.filter((s) => s.device === device);
        const hashes = new Map(mine.map((s) => [s.id, P.chainHashes(s.text)]));
        const v = await P.verifyDevice(this.dir(device), { sessions: hashes });
        if (!v.seals.length) continue;
        const spans = new Map(evidence.sessions.filter((s) => s.device === device).map((s) => [s.id, s]));
        const sessions = mine.map((s) => ({ id: s.id, open: s.open, last: R.verifyChain(s.text).last, from: (spans.get(s.id) || {}).from || null, to: (spans.get(s.id) || {}).to || null }));
        out.push({
          device, key: v.publicKey, seals: v.seals.length,
          stamped: v.seals.filter((s) => s.by !== null).length,
          first: v.seals[0].at, last: v.seals[v.seals.length - 1].at,
          bad: v.seals.filter((s) => !s.ok).length,
          stamps: [...new Set(v.seals.flatMap((s) => s.stamps.filter((x) => x.ok && x.trusted).map((x) => (P.TSAS.find((a) => a.id === x.tsa) || { name: x.tsa }).name)))],
          cover: P.timeCover(sessions, v.seals)
        });
      }
      return out;
    }
  }

  /* ---------- messages ---------- */

  const books = new Map(); // key -> BookDays

  function bookDays(msg, io) {
    let d = books.get(msg.key);
    if (!d) {
      d = new BookDays({ root: msg.root, mirror: msg.mirror || null, cache: msg.cache, io });
      books.set(msg.key, d);
    }
    return d;
  }

  // io: Pocket hands in its own; the desktop's is Node's
  async function handle(msg, post, io = nodeIO) {
    // { type: 'forget' }: let go of every book (Pocket, once History closes)
    if (msg.type === 'forget') { books.clear(); return true; }
    const d = bookDays(msg, io);
    if (msg.type === 'days') {
      if (!d.building) {
        d.building = d.build((entry, done, total) => post({ type: 'progress', key: msg.key, entry, done, total }),
          (entries, total) => post({ type: 'kept', key: msg.key, entries, done: entries.length, total }))
          .then((r) => post({ type: 'built', key: msg.key, entries: r.entries.length, open: r.open }))
          .catch((err) => post({ type: 'built', key: msg.key, error: String(err && err.stack || err), open: [] }))
          .finally(() => { d.building = null; });
      }
      return { entries: d.entries, building: true };
    }
    if (msg.type === 'search') {
      while (d.building) await d.building.catch(() => {});
      if (!d.entries.length && !d.open.length) await d.build().catch(() => {});
      d.search = msg.sid;
      const first = await d.searchFirst(msg.phrase);
      const stopped = () => d.search !== msg.sid;
      // (answered first: the window shows the first pass while the second runs)
      later().then(() => {
        d.searchWithin(msg.phrase, first.findings, stopped, (done, total) => {
          if (!stopped()) post({ type: 'search', key: msg.key, sid: msg.sid, done, total });
        }).then((r) => { if (!stopped()) post({ type: 'search', key: msg.key, sid: msg.sid, findings: r.findings, finished: r.finished }); })
          .catch((err) => post({ type: 'search', key: msg.key, sid: msg.sid, error: String(err && err.stack || err) }));
      });
      return { findings: first.findings };
    }
    if (msg.type === 'searchStop') {
      d.search = null;
      return true;
    }
    if (msg.type === 'track') {
      while (d.building) await d.building.catch(() => {});
      return d.track(msg.day, msg.part, msg.from);
    }
    if (msg.type === 'evidence') return d.evidence({ chapters: Array.isArray(msg.chapters) ? msg.chapters.map(String) : null, texts: !!msg.texts });
    if (msg.type === 'dayStart') {
      // a day can start once every day before it is built
      while (d.building && !(d.entries.length && d.entries[d.entries.length - 1].day >= msg.day)) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return d.dayStart(msg.day);
    }
    throw new Error('Unknown message ' + msg.type);
  }

  if (node && process.parentPort) {
    const post = (m) => process.parentPort.postMessage(m);
    process.parentPort.on('message', async (e) => {
      const msg = e.data;
      try {
        post({ id: msg.id, ok: true, result: await handle(msg, post) });
      } catch (err) {
        post({ id: msg.id, ok: false, error: String(err && err.stack || err) });
      }
    });
  }

  return { BookDays, handle };
});
