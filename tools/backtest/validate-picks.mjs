// EGX100 VALIDATION phase: base + the three fixed picks, judged on T (82 non-holdout names, trades opened >= 2023-01-01)
// and H (18 holdout names, full history). The picks are fixed in docs/superpowers/plans/2026-11-20-egx100-failure-analysis.md.
//
//   node validate-picks.mjs --data data/egx [--out file.md]
//   node validate-picks.mjs --data data/egx-div --side "egx-div robustness (side check)" [--compare data/egx]
//
// Pass rules (protocol), judged per pick, per set, mechanically:
//   1. avg R > 0                      2. avg R lift vs base >= +0.03            3. total R >= 90% of base total R
//   4. >= 60% of charts with n >= 5 have total R > 0 (the pick's own charts)
//   5. avg R lift stays >= 0 after removing the one chart with the largest (pick - base) total-R gap
// Net return per trade (sizing independent) = R x risk%, risk% = |entry - initial stop| / entry (R is net of costs, so is this).
import fs from 'node:fs';
import path from 'node:path';
import { runEngine, PRESETS } from './ict-engine.mjs';
import { DATA_DIR, loadSymbol, loadMeta, loadIndexBars } from './data.mjs';
import { HOLDOUT, DISC_END, parseArgs, fmt, pct } from './egx100-common.mjs';

const args = parseArgs();
const dir = args.data ? path.resolve(args.data) : DATA_DIR;
const meta = loadMeta(dir), indexBars = loadIndexBars(dir);
const likeDir = args.like ? path.resolve(args.like) : null; // restrict to the symbols that exist in another data dir
const symbols = fs.readdirSync(dir).filter((f) => f.endsWith('.csv') && !f.startsWith('_')).map((f) => f.slice(0, -4)).filter((s) => !likeDir || fs.existsSync(path.join(likeDir, s + '.csv'))).sort();
const bars = Object.fromEntries(symbols.map((s) => [s, loadSymbol(s, dir)]));
const isH = (s) => HOLDOUT.includes(s);
const symT = symbols.filter((s) => !isH(s)), symH = symbols.filter(isH);

const CONFIGS = [
  ['base', {}],
  ['S3 stop on close', { stopOnCloseOnly: true }],
  ['S2 swing-low (Internal)', { stopSwingTier: 'Internal' }],
  ['S1 stop +1 ATR', { stopExtraAtr: 1 }],
];
const PICKS = CONFIGS.slice(1).map((c) => c[0]);

// run[config] = { trades: [...all closed], open: [{symbol, openDate}] }
function runConfigs(extra = {}) {
  const out = {};
  for (const [name, o] of CONFIGS) {
    const cfg = { ...PRESETS['tv-base'], ...o, ...extra };
    const trades = [], open = [];
    for (const s of symbols) {
      const res = runEngine(bars[s], cfg, { symbol: s, mintick: meta[s]?.mintick ?? 0.01, indexBars });
      for (const t of res.trades) trades.push(t);
      for (const t of res.openTrades) open.push({ symbol: s, openDate: bars[s][t.openBar].date });
    }
    out[name] = { trades, open };
  }
  return out;
}

const riskPct = (t) => (t.entry > 0 ? (Math.abs(t.entry - t.stop) / t.entry) * 100 : NaN);
const retPct = (t) => (t.entry > 0 ? t.r * (Math.abs(t.entry - t.stop) / t.entry) * 100 : NaN);
function stats(trades) {
  let n = 0, w = 0, r = 0, ret = 0, rk = 0;
  const per = new Map(), cnt = new Map();
  for (const t of trades) {
    n++; if (t.r > 0) w++; r += t.r; ret += retPct(t); rk += riskPct(t);
    per.set(t.symbol, (per.get(t.symbol) || 0) + t.r); cnt.set(t.symbol, (cnt.get(t.symbol) || 0) + 1);
  }
  let charts = 0, pos = 0;
  for (const [s, c] of cnt) if (c >= 5) { charts++; if (per.get(s) > 0) pos++; }
  return { n, wins: w, win: n ? w / n : NaN, avg: n ? r / n : NaN, total: r, ret: n ? ret / n : NaN, risk: n ? rk / n : NaN, charts, chartsPos: pos, per, cnt, trades };
}
function judge(base, c) {
  const lift = c.avg - base.avg;
  let best = null, gap = -Infinity;
  for (const s of new Set([...c.per.keys(), ...base.per.keys()])) { const g = (c.per.get(s) || 0) - (base.per.get(s) || 0); if (g > gap) { gap = g; best = s; } }
  const f = (t) => t.symbol !== best;
  const cx = stats(c.trades.filter(f)), bx = stats(base.trades.filter(f));
  const liftEx = cx.avg - bx.avg;
  const r = [c.avg > 0, lift >= 0.03, c.total >= 0.9 * base.total, c.charts > 0 && c.chartsPos / c.charts >= 0.6, liftEx >= 0];
  return { lift, best, gap, liftEx, rules: r, pass: r.every(Boolean), baseTotalNeg: base.total < 0 };
}

const lines = [];
const out = (x = '') => lines.push(x);
const sgn = (x, d = 3) => (x >= 0 ? '+' : '') + fmt(x, d);

function report(title, setName, run, filt, syms, note = '') {
  const S = {};
  for (const [name] of CONFIGS) S[name] = stats(run[name].trades.filter(filt));
  const base = S.base;
  out(`#### ${title}`);
  out();
  if (note) { out(note); out(); }
  out(`Symbols in set: ${syms.length}. Base closed trades: ${base.n}.`);
  out();
  out('| config | n | win % | avg R | total R | charts R>0 (n>=5) | avg net return / trade (% of entry) | avg initial risk (% of entry) | still open at data end |');
  out('|---|---|---|---|---|---|---|---|---|');
  for (const [name] of CONFIGS) {
    const s = S[name];
    const open = run[name].open.filter((o) => syms.includes(o.symbol) && (setName === 'T' ? o.openDate >= DISC_END : true)).length;
    out(`| ${name} | ${s.n} | ${pct(s.win, 1)} | ${fmt(s.avg, 3)} | ${fmt(s.total)} | ${s.chartsPos}/${s.charts} (${s.charts ? pct(s.chartsPos / s.charts) : 'NA'}) | ${fmt(s.ret, 2)}% | ${fmt(s.risk, 2)}% | ${open} |`);
  }
  out();
  out('| pick | 1 avg R > 0 | 2 lift >= +0.03 | 3 total >= 90% of base | 4 >= 60% charts R>0 | 5 lift >= 0 ex top chart | PASS |');
  out('|---|---|---|---|---|---|---|');
  const J = {};
  for (const name of PICKS) {
    const j = judge(base, S[name]); J[name] = j;
    const c = S[name];
    const cell = (ok, txt) => `${ok ? 'pass' : 'FAIL'} (${txt})`;
    out(`| ${name} | ${cell(j.rules[0], fmt(c.avg, 3))} | ${cell(j.rules[1], sgn(j.lift))} | ${cell(j.rules[2], `${fmt(c.total)} vs ${fmt(0.9 * base.total)}`)} | ${cell(j.rules[3], `${c.chartsPos}/${c.charts} = ${c.charts ? pct(c.chartsPos / c.charts) : 'NA'}`)} | ${cell(j.rules[4], `${sgn(j.liftEx)} without ${j.best}, gap ${sgn(j.gap, 2)}R`)} | **${j.pass ? 'PASS' : 'FAIL'}** |`);
  }
  out();
  if (base.total < 0) out(`Note: base total R is negative (${fmt(base.total)}), so rule 3 ("total R >= 90% of base") is applied literally as total >= ${fmt(0.9 * base.total)}.`), out();
  // per-chart table
  const all = new Set(); for (const [name] of CONFIGS) for (const t of run[name].trades.filter(filt)) all.add(t.symbol);
  const cell = (s, name) => { const tr = S[name]; const n = tr.cnt.get(s) || 0; if (!n) return '0'; const w = tr.trades.filter((t) => t.symbol === s && t.r > 0).length; return `${n}/${w}/${fmt(tr.per.get(s), 2)}`; };
  out(`<details><summary>Per-chart n / wins / total R, ${title}</summary>`);
  out();
  out(`| symbol | ${CONFIGS.map((c) => c[0]).join(' | ')} |`);
  out(`|---|${CONFIGS.map(() => '---').join('|')}|`);
  for (const s of [...all].sort()) out(`| ${s} | ${CONFIGS.map(([name]) => cell(s, name)).join(' | ')} |`);
  out();
  out('</details>');
  out();
  return { S, J };
}

const inT = (t) => !isH(t.symbol) && t.openDate >= DISC_END;
const inH = (t) => isH(t.symbol);
const inAllT = (t) => !isH(t.symbol);

const sideLabel = args.side || '';
out(`### Data: \`${path.relative(process.cwd(), dir) || dir}\`${sideLabel ? ` -- ${sideLabel}` : ''}`);
out();
out(`Symbols loaded: ${symbols.length} (${symT.length} non-holdout, ${symH.length} holdout). ${symbols.length < 30 ? 'Symbols: ' + symbols.join(', ') + '.' : ''}`);
out();

const runA = runConfigs();
const verdict = {};
if (symT.length) verdict.T = report(`T: ${symT.length} non-holdout names, trades opened on/after ${DISC_END} (0.1%/side costs)`, 'T', runA, inT, symT);
if (symH.length) verdict.H = report(`H: ${symH.length} holdout names, full history (0.1%/side costs)`, 'H', runA, inH, symH);
if (args.full && symT.length) report(`Informational: ${symT.length} non-holdout names, FULL history (includes discovery period)`, 'T', runA, inAllT, symT);

if (args.sens) {
  out('### Sensitivity: 0.3% slippage per side (commission unchanged); side check, not judged');
  out();
  const runB = runConfigs({ slippagePct: 0.3 });
  if (symT.length) report('T at 0.3%/side', 'T', runB, inT, symT);
  if (symH.length) report('H at 0.3%/side', 'H', runB, inH, symH);
}

const md = lines.join('\n');
console.log(md);
if (args.out) fs.writeFileSync(args.out, md + '\n');
if (args.json) fs.writeFileSync(args.json, JSON.stringify(Object.fromEntries(Object.entries(verdict).map(([k, v]) => [k, Object.fromEntries(PICKS.map((p) => [p, { pass: v.J[p].pass, rules: v.J[p].rules, lift: v.J[p].lift }]))])), null, 1));
