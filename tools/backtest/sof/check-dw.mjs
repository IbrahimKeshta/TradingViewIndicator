// Unit check: port's developing POC / VAH / VAL / prior POC / bar delta / net delta against values read
// off TradingView's Data Window on 2026-11-21 (see docs/superpowers/plans/2026-11-21-session-orderflow-backtest.md).
import { readBarsCsv } from '../tv-feed.mjs';
import { buildChart, loadEgxChart } from '../sof-data.mjs';
import { runSof } from '../sof-engine.mjs';

const fmt = (v) => (v !== v ? 'na' : Math.abs(v) >= 1000 ? v.toFixed(2) : v.toFixed(2));
function report(name, chart, cfg, checks) {
  const r = runSof(chart, { ...cfg, keepSeries: true });
  const s = r.series;
  let ok = 0, all = 0;
  for (const c of checks) {
    const i = chart.time.indexOf(c.t);
    if (i < 0) { console.log(name, new Date(c.t * 1000).toISOString(), 'BAR NOT FOUND'); continue; }
    const got = { poc: s.devPoc[i], vah: s.devVah[i], val: s.devVal[i], prevPoc: s.prevPoc[i], bar: s.barDelta[i], net: s.cumDelta[i] };
    const parts = [];
    for (const k of Object.keys(c.want)) {
      all++;
      const w = c.want[k], g = got[k], tol = (k === 'bar' || k === 'net') ? Math.max(0.6, Math.abs(w) * 1e-6) : 0.006;
      const pass = Math.abs(g - w) <= tol; if (pass) ok++;
      parts.push(`${k} ${fmt(g)}${pass ? '' : ' (TV ' + fmt(w) + ')'}${pass ? ' ok' : ' MISMATCH'}`);
    }
    console.log(name.padEnd(9), new Date(c.t * 1000).toISOString().slice(0, 16), parts.join(' | '));
  }
  return [ok, all];
}
const U = (y, mo, d, h, mi = 0) => Date.UTC(y, mo - 1, d, h, mi) / 1000;
let tot = [0, 0];
const add = ([a, b]) => { tot[0] += a; tot[1] += b; };

// COMI 1H (new rule), intrabars = TradingView 1m
{
  const chart = buildChart({ symbol: 'COMI', bars: readBarsCsv('data/sof/COMI_60.csv'), ltfBars: readBarsCsv('data/sof/COMI_1.csv'), tfSecs: 3600, symType: 'stock', exTz: 'Africa/Cairo', weekStart: 0, mintick: 0.01 });
  add(report('COMI 1H', chart, {}, [{ t: U(2026, 11, 19, 12), want: { poc: 127.53, vah: 128.10, val: 126.55, prevPoc: 128.01, bar: 253159, net: 272513 } }]));
}
// COMI 1D (old delta rule: read before the fix), intrabars = 30m
{
  const chart = loadEgxChart('COMI', '1D');
  const i = chart.time.length - 1;
  add(report('COMI 1D', chart, { deltaTieRule: 'zero' }, [{ t: chart.time[i], want: { poc: 128.17, vah: 128.70, val: 127.80, prevPoc: 130.73, bar: 636931, net: 3320516 } }]));
}
// BTC 15m (old delta rule), intrabars = TradingView 1m (from 16 Nov)
{
  const chart = buildChart({ symbol: 'BTCUSDT', bars: readBarsCsv('data/sof/BTC_15.csv'), ltfBars: readBarsCsv('data/sof/BTC_1.csv'), tfSecs: 900, symType: 'crypto', exTz: 'Etc/UTC', weekStart: 1, mintick: 0.01 });
  add(report('BTC 15m', chart, { deltaTieRule: 'zero' }, [
    { t: U(2026, 11, 21, 0, 15), want: { poc: 58959.06, vah: 59066.71, val: 58923.17, net: 73.90, bar: 77.10 } },
    { t: U(2026, 11, 20, 19), want: { poc: 61640.43, vah: 62594.82, val: 59435.46, net: -4136.69, bar: -137.96 } },
    { t: U(2026, 11, 20, 11), want: { poc: 62035.35, vah: 62134.08, val: 61541.70, net: 393.83, bar: -46.25 } },
    { t: U(2026, 11, 19, 23, 45), want: { poc: 63759.96, vah: 64080.72, val: 62512.56, net: -2281.09, bar: -61.53 } },
    { t: U(2026, 11, 19, 17), want: { poc: 63759.96, vah: 64080.72, val: 63011.52, net: -891.66, bar: -251.07 } },
  ]));
}
console.log(`\n${tot[0]}/${tot[1]} values match`);
