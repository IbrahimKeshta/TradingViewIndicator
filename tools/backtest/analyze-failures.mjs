// EGX100 discovery phase: base run + failure taxonomy of the losing trades.
//
//   node analyze-failures.mjs --data data/egx [--out file.md]
//
// Discovery only: non-holdout symbols, trades opened before 2023-01-01. Nothing opened later is summarised or printed.
// (Trades that were opened before 2023 but closed after are included and counted; price bars after an exit are used for the
//  recovery measurements, they are not trade results.)
import fs from 'node:fs';
import { loadUniverse, runAll, isDisc, stats, parseArgs, quantile, fmt, pct, DISC_END, HOLDOUT } from './egx100-common.mjs';

const args = parseArgs();
const U = loadUniverse(args.data);
const all = runAll(U);
const D = all.filter(isDisc);
const closedAfter = D.filter((t) => t.closeDate >= DISC_END).length;
const lines = [];
const out = (s = '') => lines.push(s);
const table = (head, rows) => { out('| ' + head.join(' | ') + ' |'); out('|' + head.map(() => '---').join('|') + '|'); for (const r of rows) out('| ' + r.join(' | ') + ' |'); out(); };

// ---------------- A. base ----------------
const S = stats(D);
out('## A. Base run on discovery');
out();
out(`Symbols run: ${U.symbols.length} (holdout excluded: ${HOLDOUT.length}); data: \`${args.data || 'data/egx'}\`. Discovery trades = opened before ${DISC_END}.`);
out();
table(['n', 'win %', 'avg R', 'total R', 'charts with n>=5', 'charts R>0', '% R>0', 'opened <2023, closed >=2023'],
  [[S.n, pct(S.win, 1), fmt(S.avg, 3), fmt(S.total), S.charts, S.chartsPos, pct(S.chartsPos / S.charts), closedAfter]]);

// ---------------- taxonomy ----------------
const losers = D.filter((t) => !(t.r > 0));
const winners = D.filter((t) => t.r > 0);
const isInit = (t) => t.reason === 'Stopped' && t.tpHit === 0;
const byReason = {};
for (const t of losers) { const k = isInit(t) ? 'Initial stop, no target' : t.reason === 'Stopped' ? 'Stopped after TP1 (BE / trail), net <= 0' : t.reason; byReason[k] = (byReason[k] || 0) + 1; }
out('## B. Failure taxonomy (discovery)');
out();
out(`Winners (net R > 0): ${winners.length}. Losers (net R <= 0): ${losers.length}.`);
out();
table(['loser exit type', 'n', '% of losers', 'sum R', 'avg R'], Object.entries(byReason).map(([k, v]) => {
  const rs = losers.filter((t) => (isInit(t) ? 'Initial stop, no target' : t.reason === 'Stopped' ? 'Stopped after TP1 (BE / trail), net <= 0' : t.reason) === k);
  return [k, v, pct(v / losers.length, 1), fmt(rs.reduce((a, t) => a + t.r, 0)), fmt(rs.reduce((a, t) => a + t.r, 0) / v, 3)];
}));

// helpers for post-stop price paths
const barsOf = (t) => U.bars[t.symbol];
const WIN = [5, 10, 20, 40];
function post(t) {
  const b = barsOf(t), c = t.closeIdx, risk = t.entry - t.stop;
  const res = { risk, rec: {}, rec1R: {}, recEntry: {}, sameBarTp1: b[c].high >= t.tp1, truncated: false };
  const firstAt = (level) => { for (let j = c + 1; j < b.length && j <= c + 40; j++) if (b[j].high >= level) return j; return -1; };
  const jt = firstAt(t.tp1), j1 = firstAt(t.entry + risk), je = firstAt(t.entry);
  for (const N of WIN) { res.rec[N] = jt >= 0 && jt <= c + N; res.rec1R[N] = j1 >= 0 && j1 <= c + N; res.recEntry[N] = je >= 0 && je <= c + N; }
  res.jt = jt; res.j1 = j1;
  res.truncated = c + 40 >= b.length;
  const under = (j) => { let m = Infinity; for (let k = c; k <= j; k++) m = Math.min(m, b[k].low); return m; };
  res.underTp1 = jt >= 0 && jt <= c + 20 ? (t.stop - under(jt)) / risk : NaN;
  res.underTp1Atr = jt >= 0 && jt <= c + 20 ? (t.stop - under(jt)) / t.entryAtr : NaN;
  res.under1R = j1 >= 0 && j1 <= c + 20 ? (t.stop - under(j1)) / risk : NaN;
  return res;
}
const init = losers.filter(isInit);
for (const t of init) t.P = post(t);
out(`### B1. Recovery after the initial stop (${init.length} initial-stop losers; windows counted from the bar AFTER the stop bar)`);
out();
table(['window (bars after stop bar)', 'high reached TP1', 'high reached entry + 1R', 'high got back to entry'],
  WIN.map((N) => [N, pct(init.filter((t) => t.P.rec[N]).length / init.length, 1) + ` (${init.filter((t) => t.P.rec[N]).length})`, pct(init.filter((t) => t.P.rec1R[N]).length / init.length, 1), pct(init.filter((t) => t.P.recEntry[N]).length / init.length, 1)]));
out(`Same-bar note: ${init.filter((t) => t.P.sameBarTp1).length} initial-stop losers had a stop-bar high already at/above TP1 (stop assumed first, as the engine does). Windows truncated by end of data: ${init.filter((t) => t.P.truncated).length}.`);
out();
const recovered20 = init.filter((t) => t.P.rec[20]);
const late = init.filter((t) => !t.P.rec[20] && t.P.rec[40]);
const never = init.filter((t) => !t.P.rec[40]);
out(`Stopped-then-recovered (TP1 within 20 bars): **${recovered20.length}** = ${pct(recovered20.length / init.length, 1)} of initial-stop losers, ${pct(recovered20.length / losers.length, 1)} of all losers, ${pct(recovered20.length / D.length, 1)} of all trades. Late recovery (21-40 bars): ${late.length}. Never worked (no TP1 within 40 bars): **${never.length}** = ${pct(never.length / init.length, 1)} of initial-stop losers, ${pct(never.length / losers.length, 1)} of all losers.`);
out();

out('### B2. Undershoot: lowest low from the stop bar to the recovery bar, in R below the stop (recovered trades only)');
out();
const qs = [0.25, 0.5, 0.75, 0.9];
table(['recovery target', 'n', 'p25', 'p50', 'p75', 'p90', 'share with undershoot <= 0.25R / 0.5R / 1R / 2R'],
  [['TP1 within 20 bars', recovered20.length, ...qs.map((q) => fmt(quantile(recovered20.map((t) => t.P.underTp1), q), 2)),
    [0.25, 0.5, 1, 2].map((x) => pct(recovered20.filter((t) => t.P.underTp1 <= x).length / recovered20.length)).join(' / ')],
  ['entry+1R within 20 bars', init.filter((t) => Number.isFinite(t.P.under1R)).length, ...qs.map((q) => fmt(quantile(init.map((t) => t.P.under1R), q), 2)),
    [0.25, 0.5, 1, 2].map((x) => pct(init.filter((t) => t.P.under1R <= x).length / init.filter((t) => Number.isFinite(t.P.under1R)).length)).join(' / ')]]);
out('Same undershoot in ATR(14) at entry (TP1 within 20 bars): ' + qs.map((q) => 'p' + q * 100 + ' = ' + fmt(quantile(recovered20.map((t) => t.P.underTp1Atr), q), 2)).join(', ') + '.');
out();
out('Share of ALL initial-stop losers that recovered to TP1 within 20 bars with undershoot <= x R (the trades a stop x R wider could in principle have kept, ignoring path effects):');
out();
table(['x (R below the stop)', '0.25', '0.5', '1.0', '2.0'], [['share of initial-stop losers', ...[0.25, 0.5, 1, 2].map((x) => pct(recovered20.filter((t) => t.P.underTp1 <= x).length / init.length, 1))]]);

// ---------------- B3. context ----------------
const gap = (t) => t.exit < t.stop - 1e-9;
function roundInfo(price, atr) {
  const u = 5 * Math.pow(10, Math.floor(Math.log10(price)) - 1);
  const lvl = Math.round(price / u) * u;
  return { near: Math.abs(price - lvl) <= 0.15 * atr, expected: Math.min(1, 0.3 * atr / u) };
}
const dayChg = (t) => { const b = barsOf(t), c = t.closeIdx; return c > 0 ? { range: (b[c].high - b[c].low) / b[c - 1].close, down: (b[c - 1].close - b[c].low) / b[c - 1].close } : { range: NaN, down: NaN }; };
const groups = [['Winners', winners], ['Stopped, recovered <=20 bars', recovered20], ['Stopped, recovered 21-40 bars', late], ['Stopped, never worked (no TP1 in 40)', never]];
const med = (a) => fmt(quantile(a, 0.5), 2);
const qtxt = (a, d = 2) => [0.25, 0.5, 0.75].map((q) => fmt(quantile(a, q), d)).join(' / ');
const share = (arr, f) => pct(arr.filter(f).length / Math.max(arr.length, 1), 0);
out('### B3. Winners vs stopped-and-recovered vs stopped-and-never-worked');
out();
const rowsCtx = (title, f) => [title, ...groups.map(([, g]) => f(g))];
const head = ['metric', ...groups.map(([n, g]) => `${n} (n=${g.length})`)];
table(head, [
  rowsCtx('avg R', (g) => fmt(g.reduce((a, t) => a + t.r, 0) / g.length, 3)),
  rowsCtx('MFE before exit, R (p25 / p50 / p75)', (g) => qtxt(g.map((t) => t.mfeR))),
  rowsCtx('share that never reached +0.5R / +1R before exit', (g) => `${share(g, (t) => t.mfeR < 0.5)} / ${share(g, (t) => t.mfeR < 1)}`),
  rowsCtx('bars held (p25 / p50 / p75)', (g) => qtxt(g.map((t) => t.bars), 0)),
  rowsCtx('risk in entry ATR (p25 / p50 / p75)', (g) => qtxt(g.map((t) => (t.entry - t.stop) / t.entryAtr))),
  rowsCtx('risk as % of entry (p25 / p50 / p75)', (g) => qtxt(g.map((t) => 100 * (t.entry - t.stop) / t.entry), 1)),
  rowsCtx('stop vs most recent confirmed INTERNAL swing low at entry: (stop - swing)/ATR, p50; share stop is ABOVE the swing low', (g) => `${med(g.map((t) => (t.stop - t.swIntRecent) / t.entryAtr))}; ${share(g, (t) => t.stop > t.swIntRecent)}`),
  rowsCtx('same vs most recent confirmed MAJOR swing low', (g) => `${med(g.map((t) => (t.stop - t.swMajRecent) / t.entryAtr))}; ${share(g, (t) => t.stop > t.swMajRecent)}`),
  rowsCtx('next INTERNAL swing low below the stop: distance in R below the stop (p25 / p50 / p75)', (g) => qtxt(g.map((t) => (t.stop - t.swIntNearBeyondStop) / (t.entry - t.stop)))),
  rowsCtx('gap through stop (exit price < stop)', (g) => (g === winners ? 'n/a' : share(g, gap))),
  rowsCtx('stop within 0.15 ATR of a round level (share; share expected if uniform)', (g) => { const r = g.map((t) => roundInfo(t.stop, t.entryAtr)); return `${pct(r.filter((x) => x.near).length / g.length)}; ${pct(r.reduce((a, x) => a + x.expected, 0) / g.length)}`; }),
  rowsCtx('stop bar range, % of prev close (p50); share with low >= 9.5% below prev close (limit-down region)', (g) => (g === winners ? 'n/a' : `${fmt(100 * quantile(g.map((t) => dayChg(t).range), 0.5), 1)}%; ${share(g, (t) => dayChg(t).down >= 0.095)}`)),
  rowsCtx('EGX30 close above its SMA50 at entry', (g) => share(g, (t) => t.fIdxAbove50 === 1)),
  rowsCtx('bars from zone creation to entry (p25 / p50 / p75)', (g) => qtxt(g.map((t) => t.zoneBars), 0)),
  rowsCtx('zone type FVG / OB-MAJOR / OB-INTERNAL', (g) => ['FVG', 'OB-MAJOR', 'OB-INTERNAL'].map((z) => share(g, (t) => t.zone === z)).join(' / ')),
  rowsCtx('grade A / B / C', (g) => ['A', 'B', 'C'].map((z) => share(g, (t) => t.grade === z)).join(' / ')),
  rowsCtx('score (mean of 7)', (g) => fmt(g.reduce((a, t) => a + t.score, 0) / g.length, 2)),
]);
out('Entry-bar indicator medians (descriptive only; no thresholds are taken from this table):');
out();
const feats = [['RSI(14)', 'fRsi'], ['ADX(14)', 'fAdx'], ['close / SMA200 - 1', 'fSma200Dist'], ['60-bar RS vs EGX30', 'fRs60'], ['volume / SMA20(vol)', 'fVolRatio'], ['(close-SMA20)/ATR', 'fDist20Atr'], ['close / weekly SMA30 - 1', 'fWeekly30Dist'], ['CMF(20)', 'fCmf'], ['MFI(14)', 'fMfi']];
table(['feature (p50)', ...groups.map(([n]) => n)], feats.map(([nm, f]) => [nm, ...groups.map(([, g]) => fmt(quantile(g.map((t) => t[f]), 0.5), 3))]));

// ---------------- B5. phantom touches (Amendment 1) ----------------
out('### B5. Phantom-touch stop bars (Amendment 1)');
out();
out('Phantom touch = initial-stop exit whose stop bar has |open - prev close| <= 1 tick AND |low - open| <= 1 tick AND close > stop. "Synthetic open" = |open - prev close| <= 1 tick only; "low at open" = |low - open| <= 1 tick only. Era = year of the stop bar. Recovery = high reached TP1 within 20 bars after the stop bar. (Risk-in-ATR in this document is always computed at the entry bar, never from the logged riskAtr, which is measured on the exit bar.)');
out();
const tickOf = (t) => U.meta[t.symbol]?.mintick ?? 0.01;
const eraY = (y) => (y < 2012 ? 'pre-2012' : y < 2018 ? '2012-2017' : '2018+');
const eraOf = (t) => eraY(+t.closeDate.slice(0, 4));
for (const t of init) {
  const b = barsOf(t), c = t.closeIdx, k = tickOf(t) + 1e-9;
  t.synth = c > 0 && Math.abs(b[c].open - b[c - 1].close) <= k;
  t.lowAtOpen = Math.abs(b[c].low - b[c].open) <= k;
  t.phantom = t.synth && t.lowAtOpen && b[c].close > t.stop;
}
const eras = ['pre-2012', '2012-2017', '2018+'];
const rr = (g) => (g.length ? pct(g.filter((t) => t.P.rec[20]).length / g.length, 1) + ' (' + g.filter((t) => t.P.rec[20]).length + '/' + g.length + ')' : 'n/a');
const phRow = (name, g) => [name, g.length, pct(g.filter((t) => t.synth).length / g.length), pct(g.filter((t) => t.lowAtOpen).length / g.length), pct(g.filter((t) => t.phantom).length / g.length, 1) + ' (' + g.filter((t) => t.phantom).length + ')', rr(g.filter((t) => t.phantom)), rr(g.filter((t) => !t.phantom))];
table(['era of stop bar', 'initial-stop exits', 'synthetic open', 'low at open', 'phantom touch', 'recovery<=20 bars: phantom', 'recovery<=20 bars: real (non-phantom)'],
  [...eras.map((e) => phRow(e, init.filter((t) => eraOf(t) === e))), phRow('all', init)]);
out('Recovery to TP1 within 20 bars by whether the stop bar had a synthetic open:');
out();
table(['era', 'synthetic-open stop bars', 'real-open stop bars'], eras.map((e) => { const g = init.filter((t) => eraOf(t) === e); return [e, rr(g.filter((t) => t.synth)), rr(g.filter((t) => !t.synth))]; }));
// bar-level prevalence in the data actually used (non-holdout bars through 2022)
const prev = {};
for (const sym of U.symbols) {
  const b = U.bars[sym], k = (U.meta[sym]?.mintick ?? 0.01) + 1e-9;
  for (let j = 1; j < b.length; j++) {
    if (b[j].date >= DISC_END) break;
    const p = (prev[eraY(+b[j].date.slice(0, 4))] ||= { n: 0, synth: 0, up: 0, upLowPrev: 0 });
    p.n++; if (Math.abs(b[j].open - b[j - 1].close) <= k) p.synth++;
    if (b[j].close > b[j - 1].close) { p.up++; if (Math.abs(b[j].low - b[j - 1].close) <= k) p.upLowPrev++; }
  }
}
out('Bar-level prevalence in this data set (all non-holdout bars through 2022; note data/egx is the splits-only download):');
out();
table(['era', 'bars', 'open within 1 tick of prev close', 'up days with low within 1 tick of prev close'], eras.map((e) => [e, prev[e].n, pct(prev[e].synth / prev[e].n), pct(prev[e].upLowPrev / prev[e].up)]));

// ---------------- extra descriptive: the same share of wins/losses by year ----------------
const byYear = {};
for (const t of D) { const y = t.openDate.slice(0, 4); (byYear[y] ||= []).push(t); }
out('### B4. By year of entry (discovery)');
out();
table(['year', 'n', 'win %', 'avg R', 'initial-stop share of trades', 'recovered<=20 share of trades'], Object.entries(byYear).sort().map(([y, g]) => [y, g.length, pct(g.filter((t) => t.r > 0).length / g.length), fmt(g.reduce((a, t) => a + t.r, 0) / g.length, 3), pct(g.filter(isInit).length / g.length), pct(g.filter((t) => isInit(t) && t.P.rec[20]).length / g.length)]));

const md = lines.join('\n');
console.log(md);
if (args.out) fs.writeFileSync(args.out, md + '\n');
