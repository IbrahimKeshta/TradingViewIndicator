// 2026-11-21 exit tests: backup stop (hardStopR) and time stop (timeStopBars) against the EGX Daily preset.
// Protocol and pass rules: docs/superpowers/plans/2026-11-21-egx-daily-exit-tests.md (declared before this ran).
//
//   node tools/backtest/exit-tests.mjs --data data/egx          (verdict set, 100 symbols)
//   node tools/backtest/exit-tests.mjs --data data/egx-div      (side check, does not vote)
import fs from 'node:fs';
import path from 'node:path';
import { runEngine, PRESETS } from './ict-engine.mjs';
import { DATA_DIR, loadSymbol, loadMeta, loadIndexBars } from './data.mjs';
import { DISC_END, parseArgs, fmt } from './egx100-common.mjs';

const args = parseArgs();
const dir = args.data ? path.resolve(args.data) : DATA_DIR;
const meta = loadMeta(dir), indexBars = loadIndexBars(dir);
const symbols = fs.readdirSync(dir).filter((f) => f.endsWith('.csv') && !f.startsWith('_')).map((f) => f.slice(0, -4)).sort();
const bars = Object.fromEntries(symbols.map((s) => [s, loadSymbol(s, dir)]));

const run = (over) => {
  const cfg = { ...PRESETS['egx-daily'], ...over };
  const out = [];
  for (const s of symbols) {
    const res = runEngine(bars[s], cfg, { symbol: s, mintick: meta[s]?.mintick ?? 0.01, indexBars });
    for (const t of res.trades) out.push(t);
  }
  return out;
};

function summ(tr) {
  const sum = (a) => a.reduce((x, t) => x + t.r, 0);
  const pre = tr.filter((t) => t.openDate < DISC_END), post = tr.filter((t) => t.openDate >= DISC_END);
  const per = new Map(), cnt = new Map();
  for (const t of tr) { per.set(t.symbol, (per.get(t.symbol) || 0) + t.r); cnt.set(t.symbol, (cnt.get(t.symbol) || 0) + 1); }
  const sorted = [...tr].sort((a, b) => (a.closeDate < b.closeDate ? -1 : a.closeDate > b.closeDate ? 1 : a.openDate < b.openDate ? -1 : 1));
  let run = 0, peak = 0, dd = 0;
  for (const t of sorted) { run += t.r; peak = Math.max(peak, run); dd = Math.max(dd, peak - run); }
  const reasons = {};
  for (const t of tr) reasons[t.reason] = (reasons[t.reason] || 0) + 1;
  const rs = tr.map((t) => t.r).sort((a, b) => a - b);
  return {
    n: tr.length, win: tr.filter((t) => t.r > 0).length / tr.length, avg: sum(tr) / tr.length, total: sum(tr),
    preN: pre.length, preAvg: sum(pre) / pre.length, preTotal: sum(pre),
    postN: post.length, postAvg: sum(post) / post.length, postTotal: sum(post),
    tail15: tr.filter((t) => t.r < -1.5).length / tr.length, worst: rs[0], p5: rs[Math.floor(0.05 * rs.length)],
    dd, per, cnt, reasons, bars: tr.reduce((x, t) => x + t.bars, 0) / tr.length,
  };
}

const base = summ(run({}));
const vsBase = (s) => {
  let better = 0, worse = 0, topSym = null, topGain = -Infinity;
  for (const [sym, c] of base.cnt) {
    if (c < 5) continue;
    const d = (s.per.get(sym) || 0) - base.per.get(sym);
    if (d > 1e-9) better++; else if (d < -1e-9) worse++;
  }
  for (const sym of new Set([...base.per.keys(), ...s.per.keys()])) {
    const d = (s.per.get(sym) || 0) - (base.per.get(sym) || 0);
    if (d > topGain) { topGain = d; topSym = sym; }
  }
  const exN = s.n - (s.cnt.get(topSym) || 0), exBN = base.n - (base.cnt.get(topSym) || 0);
  const liftEx = (s.total - (s.per.get(topSym) || 0)) / exN - (base.total - (base.per.get(topSym) || 0)) / exBN;
  return { better, worse, topSym, liftEx };
};

const grid = [
  ['B', 'hardStopR', 1.5], ['B', 'hardStopR', 2.0], ['B', 'hardStopR', 3.0],
  ['T', 'timeStopBars', 5], ['T', 'timeStopBars', 10], ['T', 'timeStopBars', 20],
];

const P = (b) => (b ? 'pass' : '**FAIL**');
const lines = [];
const L = (s = '') => lines.push(s);
L(`Data: \`${path.relative(process.cwd(), dir)}\`, ${symbols.length} symbols, full history. Base = preset \`egx-daily\`.`);
L();
L('| config | n | win % | avg R | pre-2023 avg R | 2023+ avg R | total R | pre-2023 total | 2023+ total | share R < -1.5 | p5 R | worst R | drawdown (R) | avg bars held | stocks better / worse | lift ex top stock (stock) | exits |');
L('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
const row = (name, s, v) => L(`| ${name} | ${s.n} | ${fmt(100 * s.win, 1)} | ${fmt(s.avg, 3)} | ${fmt(s.preAvg, 3)} | ${fmt(s.postAvg, 3)} | ${fmt(s.total, 1)} | ${fmt(s.preTotal, 1)} | ${fmt(s.postTotal, 1)} | ${fmt(100 * s.tail15, 1)}% | ${fmt(s.p5, 2)} | ${fmt(s.worst, 2)} | ${fmt(s.dd, 1)} | ${fmt(s.bars, 1)} | ${v ? `${v.better} / ${v.worse}` : '-'} | ${v ? `${fmt(v.liftEx, 3)} (${v.topSym})` : '-'} | ${Object.entries(s.reasons).sort((a, b) => b[1] - a[1]).map(([k, c]) => `${k} ${c}`).join(', ')} |`);
row('base (EGX Daily)', base, null);
const results = [];
for (const [fam, key, val] of grid) {
  const s = summ(run({ [key]: val }));
  const v = vsBase(s);
  results.push({ fam, key, val, s, v });
  row(`${fam}: ${key} ${val}`, s, v);
}
L();
L('### Pass grid (rules as declared)');
L();
L('| config | rule 1 | rule 2 | rule 3 | rule 4 | rule 5 | verdict |');
L('|---|---|---|---|---|---|---|');
for (const { fam, key, val, s, v } of results) {
  let r;
  if (fam === 'B') {
    r = [
      [s.tail15 < base.tail15, `R<-1.5 ${fmt(100 * s.tail15, 1)}% vs ${fmt(100 * base.tail15, 1)}%`],
      [s.dd <= base.dd, `DD ${fmt(s.dd, 1)} vs ${fmt(base.dd, 1)}`],
      [s.avg - base.avg >= -0.02 && s.preAvg - base.preAvg >= -0.02 && s.postAvg - base.postAvg >= -0.02,
        `dAvg ${fmt(s.avg - base.avg, 3)} / pre ${fmt(s.preAvg - base.preAvg, 3)} / 2023+ ${fmt(s.postAvg - base.postAvg, 3)}`],
      [s.total >= 0.95 * base.total, `total ${fmt(s.total, 1)} vs 95% ${fmt(0.95 * base.total, 1)}`],
    ];
  } else {
    r = [
      [s.avg - base.avg >= 0.03, `lift ${fmt(s.avg - base.avg, 3)}`],
      [s.preTotal >= base.preTotal && s.postTotal >= base.postTotal, `pre ${fmt(s.preTotal, 1)} vs ${fmt(base.preTotal, 1)}; 2023+ ${fmt(s.postTotal, 1)} vs ${fmt(base.postTotal, 1)}`],
      [s.preAvg >= base.preAvg && s.postAvg >= base.postAvg, `pre ${fmt(s.preAvg - base.preAvg, 3)} / 2023+ ${fmt(s.postAvg - base.postAvg, 3)}`],
      [v.better >= v.worse, `${v.better} better / ${v.worse} worse`],
      [v.liftEx >= 0, `${fmt(v.liftEx, 3)} ex ${v.topSym}`],
    ];
  }
  const all = r.every((x) => x[0]);
  const cells = [0, 1, 2, 3, 4].map((k) => (r[k] ? `${P(r[k][0])} ${r[k][1]}` : '-'));
  L(`| ${fam}: ${key} ${val} | ${cells.join(' | ')} | ${all ? '**PASS**' : 'FAIL'} |`);
}
const text = lines.join('\n');
console.log(text);
if (args.out) fs.writeFileSync(args.out, text + '\n');
