// History's worker for the end-to-end tests: the test timestamp authority's
// root (fake-tsa.js) among proof.js's roots, as e2e-neo.js puts it in the
// main process, then the worker itself.
'use strict';
const fs = require('fs');
const P = require('../proof.js');
if (process.env.NEO_E2E_ROOTS) for (const c of P.certsIn(fs.readFileSync(process.env.NEO_E2E_ROOTS, 'latin1'))) P.roots().push(c);
require('../history-worker.js');
