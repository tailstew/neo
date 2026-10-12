/* NEO Pocket's Writing History worker: desktop NEO's history-worker.js, */
/* the same messages, in a web worker so the page never waits while a  */
/* year of writing is played. A worker can't reach Capacitor's files,  */
/* so each file it reads or writes is asked of the page (recIO in       */
/* pocket-bridge.js), which answers with its text.                      */
/* global importScripts, NeoHistory */
importScripts('recording.js', 'recording-files.js', 'history-worker.js');

const asked = new Map();
let seq = 0;
const ask = (method) => (...args) => new Promise((resolve, reject) => {
  const ioId = ++seq;
  asked.set(ioId, { resolve, reject });
  postMessage({ io: method, ioId, args });
});
const io = {
  join: (...parts) => parts.filter((x) => x !== '').join('/'),
  list: ask('list'),
  read: ask('read'),
  readGz: ask('readGz'),
  write: ask('write'),
  writeGz: ask('writeGz'),
  remove: ask('remove'),
  exists: ask('exists'),
  log: (source, err) => postMessage({ log: source, error: String(err && err.stack || err) })
};
const post = (m) => postMessage(m);

onmessage = async (e) => {
  const msg = e.data || {};
  if (msg.ioId) { // the page's answer
    const w = asked.get(msg.ioId);
    if (!w) return;
    asked.delete(msg.ioId);
    if (msg.ok) { w.resolve(msg.result); return; }
    const err = new Error(msg.error);
    if (msg.code) err.code = msg.code;
    w.reject(err);
    return;
  }
  try {
    post({ id: msg.id, ok: true, result: await NeoHistory.handle(msg, post, io) });
  } catch (err) {
    post({ id: msg.id, ok: false, error: String(err && err.stack || err) });
  }
};
