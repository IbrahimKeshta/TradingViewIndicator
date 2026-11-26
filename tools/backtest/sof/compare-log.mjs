// Trade-by-trade diff: a Pine Logs export of Session Order Flow's `Log Closed Trades` against the port.
//
//   node tools/backtest/sof/compare-log.mjs --log <pine-logs.csv> --egx COMI --res 1D [--from 2024-03-01] [--cfg '{...}']
//   node tools/backtest/sof/compare-log.mjs --log <pine-logs.csv> --crypto BTCUSDT --res 15 [--from ...]
//   node tools/backtest/sof/compare-log.mjs --log <pine-logs.csv> --chart <bars.csv> --ltf <ltf.csv> --res 15 --type crypto
//
// A trade matches when open time, side, entry and outcome agree; R must agree to 0.001.
import fs from 'node:fs';
import { readBarsCsv } from '../tv-feed.mjs';
import { buildChart, loadEgxChart, loadCryptoChart } from '../sof-data.mjs';
import { runSof } from '../sof-engine.mjs';

const arg = (k, d = null) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const cfg = JSON.parse(arg('cfg', '{}'));
const res = arg('res', '1D');
const from = arg('from');
let chart;
if (arg('egx')) chart = loadEgxChart(arg('egx'), res);
else if (arg('crypto')) chart = loadCryptoChart(arg('crypto'), Number(res));
else chart = buildChart({ symbol: 'X', bars: readBarsCsv(arg('chart')), ltfBars: arg('ltf') ? readBarsCsv(arg('ltf')) : null, tfSecs: res === '1D' ? 86400 : Number(res) * 60, symType: arg('type', 'crypto'), exTz: arg('tz', 'Etc/UTC'), weekStart: arg('type') === 'stock' ? 0 : 1, mintick: Number(arg('mintick', '0.01')) });

const tv = [];
for (const line of fs.readFileSync(arg('log'), 'utf8').split(/\r?\n/)) {
  const m = /TRADE open=(\S+) close=(\S+) dir=(-?1) entry=(\S+) stop=(\S+) tp1=(\S+) tp2=(\S+) outcome=(\S+) r=(\S+)/.exec(line);
  if (m) tv.push({ open: m[1], close: m[2], dir: +m[3], entry: +m[4], stop: +m[5], tp1: +m[6], tp2: +m[7], outcome: m[8], r: +m[9] });
}
tv.sort((a, b) => a.open.localeCompare(b.open));
const iso = (t) => new Date(t * 1000).toISOString().slice(0, 16);
const port = runSof(chart, cfg).trades.map((t) => ({ open: iso(t.openTime), close: iso(t.closeTime), dir: t.dir, entry: t.entry, stop: t.stop - 0 === t.stop ? t.entry - t.dir * t.risk : t.stop, tp1: t.tp1, tp2: t.tp2, outcome: t.outcome, r: t.grossR }));
const inWin = (x) => (!from || x.open >= from) && x.open >= (tv[0] ? tv[0].open : '');
const P = port.filter(inWin), T = tv.filter((x) => !from || x.open >= from);
const key = (x) => x.open + '|' + x.dir;
const pm = new Map(P.map((x) => [key(x), x])), tm = new Map(T.map((x) => [key(x), x]));
let same = 0, diffFields = 0;
const rows = [];
for (const t of T) {
  const p = pm.get(key(t));
  if (!p) { rows.push(['TV only', t]); continue; }
  const tick = chart.mintick * 0.51;
  const ok = Math.abs(p.entry - t.entry) <= tick && Math.abs(p.tp2 - t.tp2) <= tick && p.outcome === t.outcome && Math.abs(p.r - t.r) < 0.001 && p.close === t.close;
  if (ok) same++; else { diffFields++; rows.push(['DIFF', t, p]); }
}
for (const p of P) if (!tm.has(key(p))) rows.push(['port only', p]);
const sum = (a) => a.reduce((s, x) => s + x.r, 0);
console.log(`window ${from || T[0]?.open} .. : TV ${T.length} trades ${sum(T).toFixed(2)}R | port ${P.length} trades ${sum(P).toFixed(2)}R | identical ${same}, field diffs ${diffFields}, TV-only ${rows.filter((r) => r[0] === 'TV only').length}, port-only ${rows.filter((r) => r[0] === 'port only').length}`);
const f = (x) => `${x.open} ${x.dir > 0 ? 'L' : 'S'} e=${x.entry} sl=${+x.stop.toFixed(6)} tp2=${+x.tp2.toFixed(6)} ${x.outcome} r=${x.r.toFixed(3)} close=${x.close}`;
for (const r of rows.slice(0, Number(arg('show', '25')))) console.log(r[0].padEnd(9), f(r[1]), r[2] ? '\n          port: ' + f(r[2]) : '');
