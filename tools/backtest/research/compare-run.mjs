// Trade-by-trade diff: Session Order Flow's liquidity-run model on TradingView (Pine Logs export of
// `Log Closed Trades`, lines starting "RUN") against the research simulator that produced the backtest
// (family F8, "F4 pool ema200 trail8"), costs off.
//
//   node tools/backtest/research/compare-run.mjs --log <pine-logs.csv> --chart <bars.csv> --res 1D|240|60 --type stock|crypto [--ltf <bars.csv>] [--mintick 0.01]
import fs from 'node:fs';
import { readBarsCsv } from '../tv-feed.mjs';
import { buildChart } from '../sof-data.mjs';
import { featuresFromChart } from './features.mjs';
import { simulate } from './sim.mjs';
import { families } from './families.mjs';

const arg = (k, d = null) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const res = arg('res'), stock = arg('type') === 'stock';
const chart = buildChart({ symbol: 'X', bars: readBarsCsv(arg('chart')), ltfBars: arg('ltf') ? readBarsCsv(arg('ltf')) : null, tfSecs: res === '1D' ? 86400 : Number(res) * 60, symType: stock ? 'stock' : 'crypto', exTz: stock ? 'Africa/Cairo' : 'Etc/UTC', weekStart: stock ? 0 : 1, mintick: Number(arg('mintick', '0.01')) });
const f = featuresFromChart(chart, 'X');
const fam = families().find((x) => x.name === (arg('name') || 'F8 F4 pool ema200 trail8'));
const iso = (t) => new Date(t * 1000).toISOString().slice(0, 16);
const port = simulate(f, fam, { pct: 0 }).map((t) => ({ open: iso(t.openTime), close: iso(t.closeTime), dir: t.dir, r: t.grossR, why: t.why }));
const tv = [];
for (const line of fs.readFileSync(arg('log'), 'utf8').split(/\r?\n/)) {
  const m = /RUN open=(\S+) close=(\S+) dir=(-?1) entry=(\S+) stop=(\S+) exit=(\S+) outcome=(\S+) r=(\S+)/.exec(line);
  if (m) tv.push({ open: m[1], close: m[2], dir: +m[3], r: +m[8], why: m[7] });
}
tv.sort((a, b) => a.open.localeCompare(b.open));
const P = port.filter((x) => x.open >= (tv[0] ? tv[0].open : ''));
const pm = new Map(P.map((x) => [x.open + x.dir, x]));
let same = 0; const diffs = [];
for (const t of tv) {
  const p = pm.get(t.open + t.dir);
  if (p && p.close === t.close && Math.abs(p.r - t.r) < 0.001) same++;
  else diffs.push(['TV  ', t, p]);
}
const tvKeys = new Set(tv.map((t) => t.open + t.dir));
for (const p of P) if (!tvKeys.has(p.open + p.dir)) diffs.push(['port', p]);
const sum = (a) => a.reduce((s, x) => s + x.r, 0);
console.log(`TV ${tv.length} trades ${sum(tv).toFixed(2)}R | port ${P.length} trades ${sum(P).toFixed(2)}R | identical ${same} | differences ${diffs.length}`);
for (const d of diffs.slice(0, 10)) console.log(d[0], JSON.stringify(d[1]), d[2] ? '\n     port ' + JSON.stringify(d[2]) : '');
