// Trade-by-trade comparison against a TradingView Pine Logs export (logTrades CSV, "Date,Message").
//   node compare-log.mjs --log path/to/log.csv --symbol VLMRA --cfg '{...}' [--cut date] [--ties mode]
import fs from 'node:fs';
import { runEngine, PRESETS } from './ict-engine.mjs';
import path from 'node:path';
import { loadSymbol, loadMeta, cutBars, DATA_DIR } from './data.mjs';
const args = {};
for (let i = 2; i < process.argv.length; i++) { const a = process.argv[i]; if (a.startsWith('--')) { args[a.slice(2)] = process.argv[i + 1]; i++; } }
const sym = args.symbol;
const dir = args.data ? path.resolve(args.data) : DATA_DIR;
const cfg = { ...(args.preset ? PRESETS[args.preset] : {}), ...(args.cfg ? JSON.parse(args.cfg) : {}) };
if (args.ties) cfg.pivotTies = args.ties;
const tv = fs.readFileSync(args.log, 'utf8').split(/\r?\n/).slice(1).map((l) => { const m = /"(TRADE,.*)"/.exec(l); return m ? m[1].split(',') : null; }).filter(Boolean)
  .map((c) => ({ model: c[1], open: c[4].slice(0, 10), close: c[5].slice(0, 10), side: c[6], grade: c[7], score: +c[8], of: +c[9], zone: c[10], entry: +c[11], stop: +c[12], tp1: +c[13], tp2: +c[14], tp3: +c[15], tpHit: +c[16], reason: c[17], exit: +c[18], r: +c[19], mfe: +c[20], mae: +c[21], bars: +c[22], riskAtr: +c[23], flags: c.slice(24, 31).join(''), period: c[31] }));
const bars = cutBars(loadSymbol(sym, dir), { endDate: args.cut });
const res = runEngine(bars, cfg, { symbol: sym, mintick: loadMeta(dir)[sym]?.mintick ?? 0.01 });
const mine = res.trades.map((t) => ({ model: t.model, open: t.openDate, close: t.closeDate, side: t.side, grade: t.grade, score: t.score, of: t.of, zone: t.zone, entry: t.entry, stop: t.stop, tp1: t.tp1, tp2: t.tp2, tp3: t.tp3, tpHit: t.tpHit, reason: t.reason, exit: t.exit, r: t.r, mfe: t.mfeR, mae: t.maeR, bars: t.bars, riskAtr: t.riskAtr, flags: [t.kz, t.mom, t.ma, t.maj, t.brk, t.part, t.ichi].join(''), period: t.period }));
const key = (t) => t.model + '|' + t.open + '|' + t.side;
const mm = new Map(mine.map((t) => [key(t), t]));
let matched = 0, fieldDiff = 0;
console.log('TV trades', tv.length, ' port trades', mine.length);
for (const t of tv) {
  const m = mm.get(key(t));
  if (!m) { console.log('MISSING in port:', t.model, t.open, t.side, t.zone, 'entry', t.entry, 'r', t.r, t.reason, 'close', t.close); continue; }
  mm.delete(key(t)); matched++;
  const d = [];
  const near = (a, b) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a));
  for (const f of ['close', 'grade', 'score', 'of', 'zone', 'tpHit', 'reason', 'bars', 'flags', 'period']) if (t[f] !== m[f]) d.push(`${f}:${t[f]}/${m[f]}`);
  for (const f of ['entry', 'stop', 'tp1', 'tp2', 'tp3', 'exit']) if (!near(t[f], m[f])) d.push(`${f}:${t[f]}/${m[f].toPrecision(8)}`);
  if (Math.abs(t.r - m.r) > 0.011) d.push(`r:${t.r}/${m.r.toFixed(2)}`);
  if (Math.abs(t.mfe - m.mfe) > 0.011) d.push(`mfe:${t.mfe}/${m.mfe.toFixed(2)}`);
  if (Math.abs(t.mae - m.mae) > 0.011) d.push(`mae:${t.mae}/${m.mae.toFixed(2)}`);
  if (Math.abs(t.riskAtr - m.riskAtr) > 0.011) d.push(`riskAtr:${t.riskAtr}/${m.riskAtr.toFixed(2)}`);
  if (d.length) { fieldDiff++; console.log('DIFF', t.model, t.open, t.side, d.join(' ')); }
}
for (const m of mm.values()) console.log('EXTRA in port:', m.model, m.open, m.side, m.zone, 'entry', m.entry, 'r', m.r.toFixed(2), m.reason, 'close', m.close);
console.log('matched', matched, 'with field diffs', fieldDiff);
