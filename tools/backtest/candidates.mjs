// EGX100 discovery phase: run every candidate from the protocol through the ENGINE (config options, defaults off) and apply the pick rule.
//
//   node candidates.mjs --data data/egx [--out file.md]
//
// Discovery only: non-holdout symbols, trades opened before 2023-01-01. Nothing opened later is summarised or printed.
//
// ---- GRIDS (declared in the protocol-results doc BEFORE this script was first run; every point is reported) ----
//   S1  stopExtraAtr k           {0.25, 0.5, 1.0}
//   S2  stopSwingTier            {Internal, Major}
//   S3  stopOnCloseOnly          {true}                      (existing Pine "Stop on Close" input)
//   S4  phantomGuard             {on}  (added by Amendment 1 AFTER the first candidate table had been produced)
//   R1  reentryBars              {5}
//   RSI band [min,max]           {[40,65], [45,70], [50,70], [50,80], [55,75]}
//   ADX(14) >=                   {15, 20, 25, 30}
//   close > SMA200               {on}
//   EGX30 > SMA50(EGX30)         {on}
//   60-bar RS vs EGX30 >         {-0.05, 0, 0.05, 0.10}
//   volume / SMA20(vol) >=       {0.8, 1.0, 1.2, 1.5}
//   (close - SMA20)/ATR <=       {0.5, 1, 2, 3}
//   weekly close > SMA30 weekly  {on}
//   CMF(20) >                    {-0.05, 0, 0.05, 0.10}
//   MFI(14) band [min,max]       {[30,70], [40,70], [40,80], [50,80], [50,100]}
// ---- PICK RULE (mechanical) ----
//   a grid point QUALIFIES when avg R lift >= +0.03 AND total R >= 90% of base total R.
//   Per family the single threshold kept is the qualifying grid point with the largest total-R lift (candidate total - base total).
//   The (at most) three qualifying families with the largest total-R lift are the picks.
import fs from 'node:fs';
import { loadUniverse, runAll, isDisc, stats, parseArgs, fmt, pct, DISC_END } from './egx100-common.mjs';

const args = parseArgs();
const U = loadUniverse(args.data);

const FAMILIES = [
  { fam: 'S1 stop - k*ATR', pts: [0.25, 0.5, 1.0].map((k) => ({ label: `k=${k}`, cfg: { stopExtraAtr: k } })) },
  { fam: 'S2 stop below newest confirmed swing low', pts: ['Internal', 'Major'].map((t) => ({ label: `tier=${t}`, cfg: { stopSwingTier: t } })) },
  { fam: 'S3 stop on close only', pts: [{ label: 'on', cfg: { stopOnCloseOnly: true } }] },
  { fam: 'S4 phantom-wick guard', pts: [{ label: 'on', cfg: { phantomGuard: true } }] },
  { fam: 'R1 sweep re-entry', pts: [{ label: 'within 5 bars', cfg: { reentryBars: 5 } }] },
  { fam: 'F RSI(14) band', pts: [[40, 65], [45, 70], [50, 70], [50, 80], [55, 75]].map(([a, b]) => ({ label: `[${a},${b}]`, cfg: { filtRsiMin: a, filtRsiMax: b } })) },
  { fam: 'F ADX(14) >=', pts: [15, 20, 25, 30].map((x) => ({ label: `>=${x}`, cfg: { filtAdxMin: x } })) },
  { fam: 'F close > SMA200', pts: [{ label: 'on', cfg: { filtAboveSma200: true } }] },
  { fam: 'F EGX30 > SMA50', pts: [{ label: 'on', cfg: { filtIdxAboveSma50: true } }] },
  { fam: 'F 60-bar RS vs EGX30 >', pts: [-0.05, 0, 0.05, 0.1].map((x) => ({ label: `>${x}`, cfg: { filtRs60Min: x } })) },
  { fam: 'F volume / SMA20(vol) >=', pts: [0.8, 1.0, 1.2, 1.5].map((x) => ({ label: `>=${x}`, cfg: { filtVolRatioMin: x } })) },
  { fam: 'F (close-SMA20)/ATR <=', pts: [0.5, 1, 2, 3].map((x) => ({ label: `<=${x}`, cfg: { filtDist20MaxAtr: x } })) },
  { fam: 'F weekly close > SMA30w', pts: [{ label: 'on', cfg: { filtWeekly30: true } }] },
  { fam: 'F CMF(20) >', pts: [-0.05, 0, 0.05, 0.1].map((x) => ({ label: `>${x}`, cfg: { filtCmfMin: x } })) },
  { fam: 'F MFI(14) band', pts: [[30, 70], [40, 70], [40, 80], [50, 80], [50, 100]].map(([a, b]) => ({ label: `[${a},${b}]`, cfg: { filtMfiMin: a, filtMfiMax: b } })) },
];

const baseAll = runAll(U);
const baseD = baseAll.filter(isDisc);
const B = stats(baseD);

// avg R lift after removing the single chart with the largest candidate - base total-R gap
function liftExTop(cand, base) {
  let best = null, bestGap = -Infinity;
  for (const s of new Set([...cand.per.keys(), ...base.per.keys()])) { const g = (cand.per.get(s) || 0) - (base.per.get(s) || 0); if (g > bestGap) { bestGap = g; best = s; } }
  const f = (t) => t.symbol !== best;
  return { sym: best, gap: bestGap, ...((c, b) => ({ lift: c.avg - b.avg }))(stats(cand.trades.filter(f)), stats(base.trades.filter(f))) };
}
B.trades = baseD;

const rows = [];
for (const F of FAMILIES) {
  for (const p of F.pts) {
    const all = runAll(U, p.cfg), d = all.filter(isDisc);
    const s = stats(d); s.trades = d;
    const lift = s.avg - B.avg, tl = s.total - B.total, keep = s.total >= 0.9 * B.total;
    let sd = 0; for (const t of d) sd += (t.r - s.avg) ** 2; sd = Math.sqrt(sd / (d.length - 1));
    const ex = liftExTop(s, B);
    rows.push({ fam: F.fam, label: p.label, cfg: p.cfg, s, lift, tl, keep, qual: lift >= 0.03 && keep, se: sd / Math.sqrt(d.length), ex, reentries: d.filter((t) => t.reentry).length });
  }
}

const lines = [];
const out = (x = '') => lines.push(x);
out(`## C. Candidates run through the engine (discovery: ${U.symbols.length} symbols, trades opened before ${DISC_END})`);
out();
out(`Base: n ${B.n}, win ${pct(B.win, 1)}, avg R ${fmt(B.avg, 3)}, total R ${fmt(B.total)}, charts R>0 ${B.chartsPos}/${B.charts} (${pct(B.chartsPos / B.charts)}). 90% of base total R = ${fmt(0.9 * B.total)}. Base avg-R standard error about ${fmt(Math.sqrt(baseD.reduce((a, t) => a + (t.r - B.avg) ** 2, 0) / (B.n - 1)) / Math.sqrt(B.n), 3)}.`);
out();
out('Every grid point is shown. "lift" = candidate avg R - base avg R (per trade). "dTotal" = candidate total R - base total R. "keeps 90%" = total R >= 90% of base. "qual" = lift >= +0.03 AND keeps 90%. "lift ex top chart" = avg-R lift after removing the one chart with the largest candidate - base total-R gap (informational; it is pass-rule 5 on the later sets).');
out();
out('| family | point | n | win % | avg R | total R | lift | dTotal | charts R>0 (n>=5) | keeps 90% | qual | se(avg R) | lift ex top chart (chart) | avg gross R | avg cost R |');
out('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
const gc = (d) => [d.reduce((a, t) => a + t.grossR, 0) / d.length, d.reduce((a, t) => a + t.costR, 0) / d.length];
out(`| BASE | tv-base | ${B.n} | ${pct(B.win, 1)} | ${fmt(B.avg, 3)} | ${fmt(B.total)} | 0 | 0 | ${B.chartsPos}/${B.charts} | yes | - | - | - | ${gc(baseD).map((x) => fmt(x, 3)).join(' | ')} |`);
for (const r of rows) {
  out(`| ${r.fam} | ${r.label} | ${r.s.n}${r.reentries ? ` (${r.reentries} re-entries)` : ''} | ${pct(r.s.win, 1)} | ${fmt(r.s.avg, 3)} | ${fmt(r.s.total)} | ${r.lift >= 0 ? '+' : ''}${fmt(r.lift, 3)} | ${r.tl >= 0 ? '+' : ''}${fmt(r.tl)} | ${r.s.chartsPos}/${r.s.charts} (${pct(r.s.chartsPos / r.s.charts)}) | ${r.keep ? 'yes' : 'no'} | ${r.qual ? 'YES' : 'no'} | ${fmt(r.se, 3)} | ${r.ex.lift >= 0 ? '+' : ''}${fmt(r.ex.lift, 3)} (${r.ex.sym}) | ${gc(r.s.trades).map((x) => fmt(x, 3)).join(' | ')} |`);
}
out();

// ---- pick rule ----
out('## D. Pick rule applied mechanically');
out();
const famBest = [];
for (const F of FAMILIES) {
  const rs = rows.filter((r) => r.fam === F.fam);
  const q = rs.filter((r) => r.qual).sort((a, b) => b.tl - a.tl);
  const bestAvg = [...rs].sort((a, b) => b.lift - a.lift)[0];
  out(`- ${F.fam}: ${q.length ? `qualifying points ${q.map((r) => r.label).join(', ')}; kept ${q[0].label} (dTotal ${q[0].tl >= 0 ? '+' : ''}${fmt(q[0].tl)}, lift +${fmt(q[0].lift, 3)})` : `no qualifying point (best avg-R lift: ${bestAvg.label} ${bestAvg.lift >= 0 ? '+' : ''}${fmt(bestAvg.lift, 3)}, total ${fmt(bestAvg.s.total)} = ${pct(bestAvg.s.total / B.total)} of base)`}`);
  if (q.length) famBest.push(q[0]);
}
out();
famBest.sort((a, b) => b.tl - a.tl);
const picks = famBest.slice(0, 3);
out(picks.length ? '**Picks (at most three, ranked by total-R lift):**' : '**No candidate qualifies; nothing goes forward.**');
out();
picks.forEach((p, i) => out(`${i + 1}. ${p.fam}, ${p.label}: engine config \`${JSON.stringify({ preset: 'tv-base', ...p.cfg })}\`; discovery n ${p.s.n}, avg R ${fmt(p.s.avg, 3)} (lift +${fmt(p.lift, 3)}), total R ${fmt(p.s.total)} (${p.tl >= 0 ? '+' : ''}${fmt(p.tl)} vs base), charts R>0 ${p.s.chartsPos}/${p.s.charts}.`));
if (famBest.length > 3) { out(); out(`Qualifying but outside the top three: ${famBest.slice(3).map((p) => `${p.fam} ${p.label}`).join('; ')}.`); }
out();

// ---- sensitivity (Amendment 1; reported, not candidates): scale-free floor and 0.3%/side costs ----
out('## E. Sensitivity runs (discovery; not candidates)');
out();
out('Each scenario re-runs the base, S4 and the picks with the changed assumption; lift is vs the base of the SAME scenario. "floor 0.5%" = Min Risk 10 ticks replaced by risk >= 0.5% of entry price. "cost 0.3%" = slippage 0.3%/side instead of 0.1% (commission unchanged).');
out();
const SCEN = [['as run (10 ticks, 0.1%/side)', {}], ['floor 0.5% of price', { minRiskTicks: 0, minRiskPct: 0.5 }], ['cost 0.3%/side', { slippagePct: 0.3 }], ['floor 0.5% + cost 0.3%', { minRiskTicks: 0, minRiskPct: 0.5, slippagePct: 0.3 }]];
const sensCands = [{ name: 'S4 phantom guard', cfg: { phantomGuard: true } }, ...picks.map((p) => ({ name: `${p.fam} ${p.label}`, cfg: p.cfg }))];
out('| scenario | candidate | n | win % | avg R | total R | lift vs scenario base | charts R>0 (n>=5) |');
out('|---|---|---|---|---|---|---|---|');
for (const [sn, sc] of SCEN) {
  const bs = stats(runAll(U, sc).filter(isDisc));
  out(`| ${sn} | BASE | ${bs.n} | ${pct(bs.win, 1)} | ${fmt(bs.avg, 3)} | ${fmt(bs.total)} | 0 | ${bs.chartsPos}/${bs.charts} (${pct(bs.chartsPos / bs.charts)}) |`);
  for (const c of sensCands) {
    const cs = stats(runAll(U, { ...sc, ...c.cfg }).filter(isDisc));
    out(`| ${sn} | ${c.name} | ${cs.n} | ${pct(cs.win, 1)} | ${fmt(cs.avg, 3)} | ${fmt(cs.total)} | ${cs.avg - bs.avg >= 0 ? '+' : ''}${fmt(cs.avg - bs.avg, 3)} | ${cs.chartsPos}/${cs.charts} (${pct(cs.chartsPos / cs.charts)}) |`);
  }
}
out();

const md = lines.join('\n');
console.log(md);
if (args.out) fs.writeFileSync(args.out, md + '\n');
if (args.json) fs.writeFileSync(args.json, JSON.stringify(rows.map((r) => ({ fam: r.fam, label: r.label, cfg: r.cfg, n: r.s.n, avg: r.s.avg, total: r.s.total, lift: r.lift, qual: r.qual })), null, 1));
