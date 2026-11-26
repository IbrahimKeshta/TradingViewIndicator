// node --test tools/thndrx/build.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BUILD = fileURLToPath(new URL('./build.mjs', import.meta.url));
const DIST = fileURLToPath(new URL('./dist/thndrx-ict.user.js', import.meta.url));
const VERSION = fs.readFileSync(new URL('./VERSION', import.meta.url), 'utf8').trim();

test('bundle has the header, no imports and starts', () => {
  execFileSync(process.execPath, [BUILD]);
  const js = fs.readFileSync(DIST, 'utf8');
  assert.match(js, /^\/\/ ==UserScript==$/m);
  assert.match(js, /@name\s+ThndrX ICT \+ RSI\/MA Confluence$/m);
  assert.match(js, /@match\s+https:\/\/x\.thndr\.app\/\*/);
  assert.match(js, /@grant\s+none$/m);
  assert.match(js, /@run-at\s+document-idle$/m);
  assert.match(js, new RegExp(`@version\\s+${VERSION.replace(/\./g, '\\.')}$`, 'm'));
  assert.doesNotMatch(js, /^\s*(import|export)\s/m);
  assert.match(js, /start\(\);\s*\}\)\(\);\s*$/);
  new Function(js.replace(/start\(\);\s*\}\)\(\);\s*$/, '})();')); // parses
});

test('bundle evaluates without throwing when no chart iframe exists', () => {
  execFileSync(process.execPath, [BUILD]);
  const js = fs.readFileSync(DIST, 'utf8');
  const timers = [];
  const document = { querySelector: () => null, getElementById: () => null };
  const window = {
    document, localStorage: { getItem: () => null, setItem: () => {} },
    setInterval: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearInterval: () => {},
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout: () => {},
  };
  new Function('window', 'document', js)(window, document);
  assert.ok(timers.length >= 1, 'start() keeps watching for the chart');
  for (const t of timers) t.fn(); // a watch round with no iframe must not throw either
});

test('every module the bundle carries is registered once, in dependency order', () => {
  execFileSync(process.execPath, [BUILD]);
  const js = fs.readFileSync(DIST, 'utf8');
  const ids = [...js.matchAll(/^__m\['([^']+)'\] = /gm)].map((m) => m[1]);
  assert.deepEqual(ids, [
    'backtest/ict-engine.mjs', 'thndrx/colors.mjs', 'thndrx/format.mjs', 'thndrx/inputs.mjs', 'thndrx/htf.mjs',
    'thndrx/panel.mjs', 'thndrx/render-plan.mjs', 'thndrx/painter.mjs', 'thndrx/chart-port.mjs', 'thndrx/ui.mjs', 'thndrx/main.mjs',
  ]);
});

test('module transform rewrites imports and exports, and refuses what it cannot resolve', async () => {
  const { transformModule } = await import('./build.mjs');
  const known = new Set(['thndrx/x.mjs', 'backtest/ict-engine.mjs']);
  const src = [
    "import { a, b as c } from './x.mjs';",
    "import {\n  runEngine,\n  inSession,\n} from '../backtest/ict-engine.mjs';",
    'export const K = 1;',
    'export function f() { return a + c; }',
    'export async function g() {}',
    'export class C {}',
    'const hidden = 2;',
  ].join('\n');
  const out = transformModule(src, 'thndrx/y.mjs', known);
  assert.match(out.code, /^const \{ a, b: c \} = __m\['thndrx\/x\.mjs'\];$/m);
  assert.match(out.code, /^const \{ runEngine, inSession \} = __m\['backtest\/ict-engine\.mjs'\];$/m);
  assert.doesNotMatch(out.code, /^\s*(import|export)\s/m);
  assert.deepEqual(out.exports, ['K', 'f', 'g', 'C']);
  assert.deepEqual(out.deps, ['thndrx/x.mjs', 'backtest/ict-engine.mjs']);
  assert.throws(() => transformModule("import fs from 'node:fs';", 'thndrx/y.mjs', known), /cannot resolve/);
  assert.throws(() => transformModule("import { readFileSync } from 'node:fs';", 'thndrx/y.mjs', known), /cannot resolve/);
  assert.throws(() => transformModule("import { z } from './missing.mjs';", 'thndrx/y.mjs', known), /cannot resolve/);
  assert.throws(() => transformModule('export default 1;', 'thndrx/y.mjs', known), /unsupported/);
  assert.throws(() => transformModule('export { hidden };', 'thndrx/y.mjs', known), /unsupported/);
  assert.throws(() => transformModule('const u = import.meta.url;', 'thndrx/y.mjs', known), /unsupported/);
});
