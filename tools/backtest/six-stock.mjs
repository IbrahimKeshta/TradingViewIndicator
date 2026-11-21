// Trade-by-trade deep dive on a few stocks: what happens after a Stop / "Invalidated" exit, against a base-rate control.
//   node tools/backtest/six-stock.mjs [--data data/egx-div] [--symbols MASR,BTFH,EMFD,EFID,ORWE,EEII] [--out data/six-stock-out]
// Writes <out>/trades-<SYM>-<cfg>.csv and <out>/deep-dive-tables.md (the per-symbol / control sections of the plan doc).
//
// Definitions (everything is measured on bars AFTER the exit bar, from the data of that stock only):
//   R        = initial risk = |entry - initial stop|, so -1.00R is the original stop level, measured from the ENTRY price.
//   exitKind = Stop (initial stop hit), Trail (stop had been trailed up before it was hit), Invalidated (internal CHoCH close), Target.
//   maxR_N   = (highest high in the N bars after the exit bar - entry) / R.
//   TP1 within N = some bar in the N bars after the exit bar has high >= TP1 (bars-to-TP1 counted from the exit bar).
//   lowR     = (lowest low from the exit bar+1 until TP1 was reached, or for 40 bars if it never was - entry) / R.
//   hold_N   = the trade simply held from entry with ONLY the original stop (wick or close per config), no targets, N bars:
//              R at the stop fill if stopped, else R at the close of bar entry+N. Gross of costs.
//   Control  = the same "reach this price within N bars" test started from EVERY bar of that stock, with the price distance each trade
//              needs from its exit close (TP1/close_exit - 1), over (a) all bars, (b) bars in an internal up-trend, (c) bars just after a
//              10-bar drop of about one median stop distance. Literal control: X = median TP1 distance in % of entry, from every bar.
import fs from 'node:fs';
import path from 'node:path';
import { runEngine, PRESETS } from './ict-engine.mjs';
import { loadSymbol, loadMeta, loadIndexBars } from './data.mjs';

const args = {};
for (let i = 2; i < process.argv.length; i++) { const a = process.argv[i]; if (a.startsWith('--')) { args[a.slice(2)] = process.argv[++i]; } }
const dir = path.resolve(args.data || 'data/egx-div');
const outDir = path.resolve(args.out || 'data/six-stock-out');
const SYMS = args.symbols === 'all' ? fs.readdirSync(dir).filter((f) => f.endsWith('.csv') && !f.startsWith('_')).map((f) => f.slice(0, -4)).sort() : (args.symbols || 'MASR,BTFH,EMFD,EFID,ORWE,EEII').split(',');
const TAG = args.tag || 'deep-dive';
const LISTS = args.lists !== 'no'; // --lists no: pooled table only
fs.mkdirSync(outDir, { recursive: true });
const meta = loadMeta(dir), indexBars = loadIndexBars(dir);
const CONFIGS = {
  base: { ...PRESETS['tv-base'] },
  rec: { ...PRESETS['tv-base'], stopOnCloseOnly: true, runnerMode: true, trailTier: 'Major', trailFromEntry: true },
};
const NS = [10, 20, 40];
const f2 = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '-');
const px = (x) => (x >= 100 ? x.toFixed(1) : x >= 10 ? x.toFixed(2) : x.toFixed(3));
const pc = (a, b) => (b ? (100 * a / b).toFixed(0) + '%' : '-');
const median = (a) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN; };
const mean = (a) => { const s = a.filter(Number.isFinite); return s.length ? s.reduce((x, y) => x + y, 0) / s.length : NaN; };

function exitKind(t) {
  if (t.reason === 'Invalidated') return 'Invalidated';
  if (t.reason === 'Target') return 'Target';
  return Math.abs(t.finalStop - t.stop) < 1e-9 ? 'Stop' : 'Trail';
}

// held-with-original-stop-only outcome
function hold(bars, t, N, closeMode) {
  const risk = t.entry - t.stop;
  if (t.openIdx + N >= bars.length) return NaN;
  for (let j = t.openIdx + 1; j <= t.openIdx + N; j++) {
    const b = bars[j];
    if (closeMode) { if (b.close <= t.stop) return (b.close - t.entry) / risk; }
    else if (b.low <= t.stop) return (Math.min(t.stop, b.open) - t.entry) / risk;
  }
  return (bars[t.openIdx + N].close - t.entry) / risk;
}

function analyse(bars, trades, cfgName) {
  const n = bars.length, closeMode = !!CONFIGS[cfgName].stopOnCloseOnly;
  return trades.map((t) => {
    const risk = t.entry - t.stop, kind = exitKind(t), r = { ...t, kind, risk, riskPct: risk / t.entry };
    for (const N of NS) {
      const full = t.closeIdx + N < n;
      let mh = -Infinity;
      for (let j = t.closeIdx + 1; j <= Math.min(n - 1, t.closeIdx + N); j++) mh = Math.max(mh, bars[j].high);
      r['maxR' + N] = full && mh > -Infinity ? (mh - t.entry) / risk : NaN;
      r['full' + N] = full;
    }
    for (const [k, tp] of [[1, t.tp1], [2, t.tp2], [3, t.tp3]]) {
      r['bars' + k] = NaN;
      for (let j = t.closeIdx + 1; j <= Math.min(n - 1, t.closeIdx + 40); j++) if (bars[j].high >= tp) { r['bars' + k] = j - t.closeIdx; break; }
    }
    // lowest low after exit before TP1 (or within 40 bars if never)
    const lim = Number.isFinite(r.bars1) ? t.closeIdx + r.bars1 : Math.min(n - 1, t.closeIdx + 40);
    let ml = Infinity;
    for (let j = t.closeIdx + 1; j <= lim; j++) ml = Math.min(ml, bars[j].low);
    r.lowR = ml < Infinity ? (ml - t.entry) / risk : NaN;
    r.hold20 = hold(bars, t, 20, closeMode); r.hold40 = hold(bars, t, 40, closeMode);
    r.tp1Pct = t.tp1 / t.entry - 1;
    r.wickOnly = bars[t.closeIdx].close > t.stop; // stop hit intraday, bar closed back above the stop (only meaningful for wick stops)
    // the first target not yet reached at exit (TP1 for a trade that never reached a target) and how long price takes to get there
    const nextTp = t.tpHit >= 3 ? NaN : [t.tp1, t.tp2, t.tp3][t.tpHit];
    r.nextTp = nextTp; r.barsNext = NaN;
    if (nextTp === nextTp) for (let j = t.closeIdx + 1; j <= Math.min(n - 1, t.closeIdx + 40); j++) if (bars[j].high >= nextTp) { r.barsNext = j - t.closeIdx; break; }
    r.needFromExit = nextTp / bars[t.closeIdx].close - 1;
    return r;
  });
}

// ---- control ----
function buildControl(bars, intTrend, medRiskPct) {
  const n = bars.length, C = bars.map((b) => b.close), H = bars.map((b) => b.high);
  const sets = { all: [], up: [], drop: [] };
  const maxRise = {}; // N -> Float64Array of maxH(j+1..j+N)/C[j]-1, NaN where the window is incomplete
  for (const N of [20, 40]) {
    const m = new Float64Array(n).fill(NaN);
    for (let j = 0; j + N < n; j++) { let mh = -Infinity; for (let k = j + 1; k <= j + N; k++) mh = Math.max(mh, H[k]); m[j] = mh / C[j] - 1; }
    maxRise[N] = m;
  }
  for (let j = 100; j < n; j++) {
    sets.all.push(j);
    if (intTrend[j] === 'up') sets.up.push(j);
    let mx = -Infinity; for (let k = Math.max(0, j - 10); k < j; k++) mx = Math.max(mx, C[k]);
    if (C[j] <= mx * (1 - medRiskPct)) sets.drop.push(j);
  }
  const rate = (set, N, X) => { let a = 0, b = 0; for (const j of sets[set]) { const v = maxRise[N][j]; if (v !== v) continue; b++; if (v >= X) a++; } return b ? a / b : NaN; };
  return { rate, sizes: { all: sets.all.length, up: sets.up.length, drop: sets.drop.length } };
}

const md = [];
const out = (x) => { if (LISTS) md.push(x); };
const allSummary = [];
for (const sym of SYMS) {
  if (!fs.existsSync(path.join(dir, sym + '.csv'))) { console.error('missing', sym); continue; }
  const bars = loadSymbol(sym, dir);
  const intTrend = new Array(bars.length).fill(null);
  const runs = {};
  for (const [cn, cfg] of Object.entries(CONFIGS)) {
    const res = runEngine(bars, cfg, { symbol: sym, mintick: meta[sym]?.mintick ?? 0.01, indexBars, onBar: cn === 'base' ? (i, st) => { intTrend[i] = st.intTrend; } : undefined });
    runs[cn] = { trades: analyse(bars, res.trades, cn), open: res.openTrades.length };
  }
  const medRisk = median(runs.base.trades.map((t) => t.riskPct));
  const ctl = buildControl(bars, intTrend, medRisk);
  out(`\n### ${sym}  (${bars[0].date} .. ${bars[bars.length - 1].date}, ${bars.length} bars; ${meta[sym]?.list || ''}; median initial risk ${(100 * medRisk).toFixed(1)}% of entry)\n`);
  for (const [cn, { trades, open }] of Object.entries(runs)) {
    // csv
    const cols = ['openDate', 'closeDate', 'entry', 'stop', 'tp1', 'tp2', 'tp3', 'kind', 'r', 'bars', 'maxR10', 'maxR20', 'maxR40', 'bars1', 'bars2', 'bars3', 'lowR', 'hold20', 'hold40'];
    if (LISTS) fs.writeFileSync(path.join(outDir, `trades-${sym}-${cn}.csv`), [cols.join(','), ...trades.map((t) => cols.map((c) => (typeof t[c] === 'number' ? +t[c].toFixed(4) : t[c])).join(','))].join('\n') + '\n');
    // summary
    const kinds = ['Stop', 'Trail', 'Invalidated', 'Target'];
    const by = Object.fromEntries(kinds.map((k) => [k, trades.filter((t) => t.kind === k)]));
    const tot = trades.reduce((a, t) => a + t.r, 0);
    out(`**${sym} / ${cn}**: ${trades.length} closed trades (${open} still open), net ${f2(tot)}R, wins ${trades.filter((t) => t.r > 0).length}. Exits: ` + kinds.map((k) => `${k} ${by[k].length} (avg ${f2(mean(by[k].map((t) => t.r)))}R)`).join(', ') + '.\n');
    const row = (label, set) => {
      const o = { sym, cfg: cn, label, n: set.length };
      for (const N of [20, 40]) {
        const ok = set.filter((t) => t.closeIdx + N < bars.length);
        const hit = ok.filter((t) => Number.isFinite(t.barsNext) && t.barsNext <= N).length;
        o['hit' + N] = hit; o['ok' + N] = ok.length;
        for (const s of ['all', 'up', 'drop']) {
          const ps = ok.map((t) => ctl.rate(s, N, t.needFromExit));
          o[`c${s}${N}`] = mean(ps);
          o[`e${s}${N}`] = ps.filter(Number.isFinite).reduce((a, b) => a + b, 0); // expected hits under the control
          o[`v${s}${N}`] = ps.filter(Number.isFinite).reduce((a, p) => a + p * (1 - p), 0); // binomial variance
        }
        o['lit' + N] = ctl.rate('all', N, median(trades.map((t) => t.tp1Pct)));
        o['litup' + N] = ctl.rate('up', N, median(trades.map((t) => t.tp1Pct)));
      }
      const w = (k, N) => { const v = set.map((t) => t[k + N]).filter(Number.isFinite); return v.length ? v.filter((x) => x > 0).length / v.length : NaN; };
      o.hold20 = w('hold', 20); o.hold40 = w('hold', 40);
      o.holdR40 = mean(set.map((t) => t.hold40));
      o.avgR = mean(set.map((t) => t.r));
      o.medMax20 = median(set.map((t) => t.maxR20));
      o.medBars = median(set.map((t) => t.bars));
      return o;
    };
    const pre = (a) => a.filter((t) => t.tpHit === 0), post = (a) => a.filter((t) => t.tpHit >= 1 && t.tpHit < 3);
    const wickStops = cn === 'base' ? pre(by.Stop) : [];
    const sets = [['Stop, no target reached', pre([...by.Stop, ...by.Trail])], ...(wickStops.length ? [['  of which closed back ABOVE the stop that day (wick only)', wickStops.filter((t) => t.wickOnly)], ['  of which closed at/below the stop', wickStops.filter((t) => !t.wickOnly)]] : []), ['Invalidated, no target reached', pre(by.Invalidated)], ['All pre-target exits (Stop+Invalidated)', pre([...by.Stop, ...by.Trail, ...by.Invalidated])],
      ['Invalidated after TP1+ (next target)', post(by.Invalidated)], ['Stop/trail after TP1+ (next target)', post([...by.Stop, ...by.Trail])]].filter(([, s]) => s.length);
    const rows = sets.map(([l, s]) => row(l, s));
    allSummary.push(...rows);
    out('| Exit set | n | next target within 20 bars | control 20 (all / up-trend / after-drop) | next target within 40 bars | control 40 (all / up-trend / after-drop) | median bars held | median max high 20 bars (R) | held 20 bars, orig. stop only: win % | held 40: win % | held 40: avg R |');
    out('|---|---|---|---|---|---|---|---|---|---|---|');
    for (const o of rows) out(`| ${o.label} | ${o.n} (avg ${f2(o.avgR)}R) | ${o.hit20}/${o.ok20} (${pc(o.hit20, o.ok20)}) | ${pc(o.call20, 1)} / ${pc(o.cup20, 1)} / ${pc(o.cdrop20, 1)} | ${o.hit40}/${o.ok40} (${pc(o.hit40, o.ok40)}) | ${pc(o.call40, 1)} / ${pc(o.cup40, 1)} / ${pc(o.cdrop40, 1)} | ${o.medBars} | ${f2(o.medMax20)} | ${f2(100 * o.hold20, 0)}% | ${f2(100 * o.hold40, 0)}% | ${f2(o.holdR40)} |`);
    out('');
    if (rows.length) out(`Literal control for ${cn} (X = median TP1 distance ${(100 * median(trades.map((t) => t.tp1Pct))).toFixed(1)}% of entry; any bar -> high reaches +X% within 20 / 40 bars; in an up-trend): ${pc(rows[0].lit20, 1)} / ${pc(rows[0].lit40, 1)}; up-trend ${pc(rows[0].litup20, 1)} / ${pc(rows[0].litup40, 1)}.\n`);
    // trade list
    out(`<details><summary>${sym} ${cn}: trade list</summary>\n`);
    out('| open | close | entry | stop | TP1 | TP2 | TP3 | exit | net R | max hi 10/20/40 (R) | TP1 / TP2 / TP3 after exit (bars) | low R before TP1 | hold 20 / 40 (R) |');
    out('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const t of trades) out(`| ${t.openDate} | ${t.closeDate} | ${px(t.entry)} | ${px(t.stop)} | ${px(t.tp1)} | ${px(t.tp2)} | ${px(t.tp3)} | ${t.kind}${t.tpHit ? ' tp' + t.tpHit : ''} | ${f2(t.r)} | ${f2(t.maxR10, 1)} / ${f2(t.maxR20, 1)} / ${f2(t.maxR40, 1)} | ${[t.bars1, t.bars2, t.bars3].map((x) => (Number.isFinite(x) ? x : '-')).join(' / ')} | ${f2(t.lowR)} | ${f2(t.hold20, 1)} / ${f2(t.hold40, 1)} |`);
    out('\n</details>\n');
  }
}
{
  const groups = new Map();
  for (const o of allSummary) { const k = o.cfg + '|' + o.label; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(o); }
  md.push('\n### Pooled over ' + SYMS.length + ' symbols\n');
  md.push('Hits = exits after which the next unreached target was reached within N bars; expected = what the control predicts (all bars of the same stock, same price distance from the exit close); z = (hits - expected) / sqrt(sum p(1-p)). Overlapping windows make z optimistic, so |z| < 2 means no evidence.\n');
  md.push('| Config | Exit set | n | hits 20 | expected 20 (all bars / up-trend / after-drop) | z 20 | hits 40 | expected 40 (all / up / drop) | z 40 |');
  md.push('|---|---|---|---|---|---|---|---|---|');
  const sum = (a, k) => a.reduce((x, o) => x + (Number.isFinite(o[k]) ? o[k] : 0), 0);
  for (const [k, a] of groups) {
    const [cfg, label] = k.split('|');
    const z = (N) => (sum(a, 'hit' + N) - sum(a, 'eall' + N)) / Math.sqrt(sum(a, 'vall' + N) || NaN);
    md.push(`| ${cfg} | ${label} | ${sum(a, 'n')} | ${sum(a, 'hit20')}/${sum(a, 'ok20')} (${pc(sum(a, 'hit20'), sum(a, 'ok20'))}) | ${f2(sum(a, 'eall20'), 1)} / ${f2(sum(a, 'eup20'), 1)} / ${f2(sum(a, 'edrop20'), 1)} | ${f2(z(20), 1)} | ${sum(a, 'hit40')}/${sum(a, 'ok40')} (${pc(sum(a, 'hit40'), sum(a, 'ok40'))}) | ${f2(sum(a, 'eall40'), 1)} / ${f2(sum(a, 'eup40'), 1)} / ${f2(sum(a, 'edrop40'), 1)} | ${f2(z(40), 1)} |`);
  }
  md.push('');
}
fs.writeFileSync(path.join(outDir, TAG + '-tables.md'), md.join('\n') + '\n');
fs.writeFileSync(path.join(outDir, TAG + '-summary.json'), JSON.stringify(allSummary, null, 1));
console.log('wrote', outDir);
