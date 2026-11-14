// The proof worker for the end-to-end tests: what e2e-neo.js does in the
// main process, done here too, then the worker itself. The test timestamp
// authorities (fake-tsa.js, on 127.0.0.1) stand in for DigiCert, Sectigo and
// GlobalSign, drand isn't reached, the tests reach no other network, the
// test root is among proof.js's roots, and Sectigo's 15 s between requests
// is waived.
'use strict';
const fs = require('fs');
const P = require('../proof.js');
if (process.env.NEO_E2E_ROOTS) for (const c of P.certsIn(fs.readFileSync(process.env.NEO_E2E_ROOTS, 'latin1'))) P.roots().push(c);
P.TSAS.find((t) => t.id === 'sectigo').gap = 0;
const hosts = JSON.parse(process.env.NEO_E2E_TSA_HOSTS || '{}'); // hostname -> the test authority's url
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, o) => {
  const u = new URL(String(url));
  if (hosts[u.hostname]) return realFetch(hosts[u.hostname], o);
  if (/drand/.test(u.hostname)) throw new Error('offline'); // no `after`: the seals are made without one
  if (u.hostname !== '127.0.0.1') throw new Error('the tests reach no network: ' + u.href);
  return realFetch(url, o);
};
require('../proof-worker.js');
