// CLI: run a config of the ICT engine over a list of symbols.
//
//   node run.mjs --symbols COMI,TMGH --preset tv-base
//   node run.mjs --all --preset tv-r4 --out out/r4 --cut 2026-11-04 --max-bars 5000
//   node run.mjs --symbols VLMRA --config '{"useTrailModel":true,"requireConfirmation":true}'
//
// Flags:
//   --symbols A,B,C | --list file.txt | --all   which data/egx/<SYM>.csv files to run (--all skips _*.csv)
//   --preset  tv-base | tv-r4 | pine-default   (see PRESETS in ict-engine.mjs); default tv-base
//   --config  '<json>'                          extra overrides on top of the preset
//   --cut YYYY-MM-DD                            drop bars after this date (also the index series)
//   --max-bars N                                keep only the last N bars (after --cut)
//   --out DIR                                   write DIR/trades.csv and DIR/trades.json
//   --data DIR                                  data directory (default data/egx)
import fs from 'node:fs';
import path from 'node:path';
import { runEngine, PRESETS, summarize } from './ict-engine.mjs';
import { DATA_DIR, loadSymbol, loadMeta, loadIndexBars, cutBars } from './data.mjs';

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) { const k = a.slice(2); const nx = process.argv[i + 1]; if (nx === undefined || nx.startsWith('--')) args[k] = true; else { args[k] = nx; i++; } }
}
const dir = args.data ? path.resolve(args.data) : DATA_DIR;
const meta = loadMeta(dir);
let symbols = [];
if (args.symbols) symbols = String(args.symbols).split(',').map((s) => s.trim()).filter(Boolean);
else if (args.list) symbols = fs.readFileSync(args.list, 'utf8').split(/[\s,]+/).filter(Boolean);
else if (args.all) symbols = fs.readdirSync(dir).filter((f) => f.endsWith('.csv') && !f.startsWith('_')).map((f) => f.slice(0, -4)).sort();
else { console.error('need --symbols, --list or --all'); process.exit(1); }

const preset = PRESETS[args.preset || 'tv-base'];
if (!preset) { console.error('unknown preset', args.preset); process.exit(1); }
const cfg = { ...preset, ...(args.config ? JSON.parse(args.config) : {}) };
const cutOpts = { endDate: args.cut, maxBars: args['max-bars'] ? +args['max-bars'] : undefined };

let indexBars = {};
if (cfg.requireIndexTrend) {
  const raw = loadIndexBars(dir);
  for (const k of Object.keys(raw)) indexBars[k] = cutBars(raw[k], { endDate: args.cut });
}

const all = [];
let tn = 0, tw = 0, tr = 0;
console.log('symbol      bars     n  wins       R');
for (const sym of symbols) {
  let bars;
  try { bars = cutBars(loadSymbol(sym, dir), cutOpts); } catch (e) { console.log(sym.padEnd(8), 'MISSING DATA'); continue; }
  const mintick = meta[sym]?.mintick ?? 0.01;
  const res = runEngine(bars, cfg, { symbol: sym, mintick, indexBars });
  const s = summarize(res.trades);
  tn += s.n; tw += s.wins; tr += s.r;
  console.log(sym.padEnd(8), String(bars.length).padStart(7), String(s.n).padStart(5), String(s.wins).padStart(5), s.r.toFixed(2).padStart(9));
  all.push(...res.trades);
}
console.log('TOTAL'.padEnd(8), ''.padStart(7), String(tn).padStart(5), String(tw).padStart(5), tr.toFixed(2).padStart(9), ' avgR/trade', tn ? (tr / tn).toFixed(3) : '-');

if (args.out) {
  fs.mkdirSync(args.out, { recursive: true });
  fs.writeFileSync(path.join(args.out, 'trades.json'), JSON.stringify(all));
  if (all.length) {
    const cols = Object.keys(all[0]);
    const csv = [cols.join(',')].concat(all.map((t) => cols.map((c) => (typeof t[c] === 'number' ? +t[c].toPrecision(10) : t[c])).join(','))).join('\n');
    fs.writeFileSync(path.join(args.out, 'trades.csv'), csv + '\n');
  }
  console.log('wrote', path.join(args.out, 'trades.{csv,json}'), all.length, 'trades');
}
