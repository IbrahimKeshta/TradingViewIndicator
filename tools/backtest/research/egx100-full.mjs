// Reference only: the liquidity-run model over the FULL EGX100 history (discovery + validation combined).
// EGX100 was used to choose the model, so this is not an out-of-sample result; the final exam is.
import { loadFeatures } from './features.mjs';
import { simulate, stats } from './sim.mjs';
import { families } from './families.mjs';
import { egxMeta_ } from '../sof-data.mjs';
import { EGX30_LIST, EGX70_LIST } from '../ict-engine.mjs';
const fam = families().find((x) => x.name === 'F8 F4 pool ema200 trail8');
const list = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
const costs = { pct: 0.1, commission: 2, positionSize: 100000 };
for (const [set, res] of [['eD', '1D'], ['e60', '60']]) {
  const syms = [...list(EGX30_LIST), ...list(EGX70_LIST)].filter((s) => { const m = egxMeta_()[s]; return m && m[res] && !m[res].error; });
  let all = [];
  for (const s of syms) all = all.concat(simulate(loadFeatures(set, s), fam, costs));
  const st = stats(all), cap = stats(all.map((t) => ({ ...t, r: Math.min(t.r, 10) }))), L = stats(all.filter((t) => t.dir > 0));
  const since = stats(all.filter((t) => t.openTime >= Date.UTC(2015, 0, 1) / 1000));
  const rs = all.map((t) => t.r).sort((a, b) => a - b);
  console.log(`EGX100 ${res}: ${syms.length} stocks, ${st.n} trades | avg ${st.avg.toFixed(3)}R | capped at +10R ${cap.avg.toFixed(3)} | win ${(st.win * 100).toFixed(0)}% | PF ${st.pf.toFixed(2)} | stocks positive ${(st.symPos * 100).toFixed(0)}% of ${st.symN} | long ${st.longAvg.toFixed(3)} (${st.nL}) short ${st.shortAvg.toFixed(3)} (${st.nS}) | long-only stocks + ${(L.symPos * 100).toFixed(0)}% | since 2015 ${since.avg.toFixed(3)} (${since.n}) | median ${rs[rs.length >> 1].toFixed(2)}R`);
}
