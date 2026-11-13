'use strict';

// A session's close waits for its chunks. closeSession writes the `end` line
// and sends it as the last chunk, then asks for the close, which joins the
// chunks on disk into the .jsonl.gz and removes the folder. Pocket's chunk
// write is a few awaits, and the close won the race: the last chunk, `end`
// and the last seconds of typing with it, was lost. The recorder (`rec` in
// app.js) is run here on its own, with a window.neo whose writes are slow.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const from = app.indexOf('const rec = {');
const to = from + app.slice(from).search(/\r?\n\};\r?\n/) + 4; // (CRLF on a Windows checkout)

function recorder(neo) {
  const context = vm.createContext({ window: { neo }, console, Promise, setTimeout, clearTimeout });
  vm.runInContext(app.slice(from, to) + '\nthis.rec = rec;', context);
  const { rec } = context;
  const lines = [];
  let first = 1;
  Object.assign(rec, {
    on: true, live: true, bookId: 'book-a', session: { id: 's1' },
    sending: new Set(), retry: [], chunks: 0, inSession: new Set(), model: {}, known: {},
    counts: { keys: 3, edits: 2, unobserved: 0 },
    order() {},
    event(line) { lines.push(line); },
    w: {
      H: 'h',
      chunk() {
        if (!lines.length) return null;
        const c = { first, text: lines.splice(0).map((l) => JSON.stringify(l)).join('\n') + '\n' };
        first += 1;
        return c;
      }
    }
  });
  return { rec, lines };
}

test('the close waits for the last chunk, the one with `end`, to reach the disk', async () => {
  const disk = [];
  const said = [];
  const neo = {
    recChunk: (book, session, first, text) => new Promise((resolve) => setTimeout(() => { disk.push(text); said.push('chunk'); resolve(); }, 20)),
    recClose: async () => { said.push('close ' + (disk.some((t) => t.includes('"end"')) ? 'with end' : 'without end')); },
    logError: (m) => { throw new Error(m); }
  };
  const { rec, lines } = recorder(neo);
  lines.push([0, 'k', 'KeyA', 0]);
  rec.flush(); // an ordinary flush, still on its way
  await rec.closeSession();
  assert.deepEqual(said, ['chunk', 'chunk', 'close with end']);
});

test('a chunk that fails doesn\'t keep the session from closing', async () => {
  const said = [];
  const neo = {
    recChunk: () => new Promise((resolve, reject) => setTimeout(() => reject(new Error('disk full')), 10)),
    recClose: async () => { said.push('close'); },
    logError: (m) => said.push(m)
  };
  const { rec } = recorder(neo);
  await rec.closeSession();
  assert.deepEqual(said, ['recording chunk: disk full', 'close']);
});
