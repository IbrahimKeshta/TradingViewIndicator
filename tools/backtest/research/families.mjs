// Candidate entry families for the model search. Each family is a different hypothesis about why price moves;
// each comes with a deliberately small grid of settings, so the search cannot fit noise by sheer number.
//
//   F1 breakout   trend following: close beyond the prior N-bar range, optional 200-EMA trend filter
//   F2 pullback   trend pullback: in a 50/200-EMA trend, a bar dips to the 20-EMA and closes back with the trend
//   F3 favour     Session Order Flow verdict turns FAVOURABLE (the small EGX lean), optional trend filter
//   F4 run        Session Order Flow continuation: a liquidity pool / reference level is taken and the bar
//                 CLOSES beyond it (the opposite of the failed sweep-reversal), optional trend filter
//   F5 squeeze    volatility contraction (Bollinger width well below its average) then a 20-bar breakout
//   F6 meanrev    short-term mean reversion inside the trend: RSI(2) extreme against a 200-EMA trend,
//                 exit on the close back over the 5-EMA
const trendDir = (f, i) => (f.close[i] > f.ema200[i] ? 1 : f.close[i] < f.ema200[i] ? -1 : 0);
const strongTrend = (f, i) => (f.ema50[i] > f.ema200[i] && f.close[i] > f.ema200[i] ? 1 : f.ema50[i] < f.ema200[i] && f.close[i] < f.ema200[i] ? -1 : 0);
const exits = (stopAtr) => [
  { tag: `trail${stopAtr}`, stopAtr, trailAtr: stopAtr, trailRef: 'close' },
  { tag: 'tp2', stopAtr, tpR: 2 },
  { tag: 'tp3be', stopAtr, tpR: 3, beR: 1 },
];

export function families() {
  const out = [];
  // F1
  for (const N of [20, 55]) for (const tf of [false, true]) for (const m of [2, 3, 4]) {
    out.push({
      fam: 'F1 breakout', name: `F1 N${N}${tf ? ' trend' : ''} trail${m}`,
      signal: (f, i) => {
        const hh = N === 20 ? f.hh20[i] : f.hh55[i], ll = N === 20 ? f.ll20[i] : f.ll55[i];
        const d = f.close[i] > hh ? 1 : f.close[i] < ll ? -1 : 0;
        if (!d || (tf && trendDir(f, i) !== d)) return null;
        return { dir: d };
      },
      exit: { stopAtr: m, trailAtr: m, trailRef: 'close' },
    });
  }
  // F2
  for (const k of [1.5, 2.5]) for (const ex of exits(k)) {
    out.push({
      fam: 'F2 pullback', name: `F2 stop${k} ${ex.tag}`,
      signal: (f, i) => {
        const d = strongTrend(f, i); if (!d) return null;
        const touched = d > 0 ? f.low[i] <= f.ema20[i] && f.close[i] > f.ema20[i] && f.close[i] > f.open[i] : f.high[i] >= f.ema20[i] && f.close[i] < f.ema20[i] && f.close[i] < f.open[i];
        return touched ? { dir: d } : null;
      },
      exit: ex,
    });
  }
  // F3
  for (const tf of [false, true]) for (const k of [1.5, 2.5]) for (const ex of exits(k)) {
    out.push({
      fam: 'F3 favour', name: `F3${tf ? ' trend' : ''} stop${k} ${ex.tag}`,
      signal: (f, i) => {
        if (f.verdict[i] !== 2 || (f.verdict[i - 1] === 2 && f.bias[i - 1] === f.bias[i])) return null;
        const d = f.bias[i]; if (!d || (tf && trendDir(f, i) !== d)) return null;
        return { dir: d };
      },
      exit: ex,
    });
  }
  // F4
  for (const src of ['pool', 'ref', 'any']) for (const tf of [false, true]) for (const k of [1.5, 2.5]) for (const ex of [exits(k)[0], exits(k)[1]]) {
    const up = src === 'pool' ? 4 : src === 'ref' ? 64 : 68, dn = src === 'pool' ? 8 : src === 'ref' ? 128 : 136;
    out.push({
      fam: 'F4 run', name: `F4 ${src}${tf ? ' trend' : ''} stop${k} ${ex.tag}`,
      signal: (f, i) => {
        const e = f.ev[i]; const u = (e & up) !== 0, dd = (e & dn) !== 0;
        const d = u && !dd ? 1 : dd && !u ? -1 : 0;
        if (!d || (tf && trendDir(f, i) !== d)) return null;
        return { dir: d };
      },
      exit: ex,
    });
  }
  // F5
  for (const k of [2, 3]) for (const ex of [{ tag: `trail${k}`, stopAtr: k, trailAtr: k, trailRef: 'close' }, { tag: 'tp3be', stopAtr: k, tpR: 3, beR: 1 }]) {
    out.push({
      fam: 'F5 squeeze', name: `F5 stop${k} ${ex.tag}`,
      prep: (f) => { const a = new Float64Array(f.n).fill(NaN); let s = 0; for (let i = 0; i < f.n; i++) { const v = f.bbw[i] === f.bbw[i] ? f.bbw[i] : 0; s += v; if (i >= 100) s -= (f.bbw[i - 100] === f.bbw[i - 100] ? f.bbw[i - 100] : 0); if (i >= 120) a[i] = s / 100; } f._bbwAvg = a; },
      signal: (f, i) => {
        const sq = f.bbw[i - 1] < 0.6 * f._bbwAvg[i - 1];
        if (!sq) return null;
        const d = f.close[i] > f.hh20[i] ? 1 : f.close[i] < f.ll20[i] ? -1 : 0;
        return d ? { dir: d } : null;
      },
      exit: ex,
    });
  }
  // F6
  for (const lvl of [10, 5]) for (const k of [2, 3]) {
    out.push({
      fam: 'F6 meanrev', name: `F6 rsi2<${lvl} stop${k}`,
      signal: (f, i) => {
        const t = trendDir(f, i);
        if (t > 0 && f.rsi2[i] < lvl) return { dir: 1 };
        if (t < 0 && f.rsi2[i] > 100 - lvl) return { dir: -1 };
        return null;
      },
      exit: { stopAtr: k, maxBars: 10, exitOn: (f, i, p) => (p.dir > 0 ? f.close[i] > f.ema5[i] : f.close[i] < f.ema5[i]) },
    });
  }
  // F7 (round 2): refinements of the round-1 leaders (F1 breakout, F4 pool run), each with ONE added filter
  //   bias      Session Order Flow bias agrees with the trade (price above / below both POCs)
  //   noAvoid   the verdict is not AVOID (the period's range is not used up)
  //   risk1     the stop is at least 1% of price, so costs stay near 0.2R or less
  for (const base of ['F1 N20', 'F1 N55', 'F4 pool']) for (const m of [4, 5]) for (const filt of ['none', 'bias', 'noAvoid', 'risk1']) {
    out.push({
      fam: 'F7 refine', name: `F7 ${base} trend trail${m} ${filt}`,
      signal: (f, i) => {
        let d = 0;
        if (base === 'F4 pool') { const e = f.ev[i]; const u = (e & 4) !== 0, dd = (e & 8) !== 0; d = u && !dd ? 1 : dd && !u ? -1 : 0; }
        else { const hh = base === 'F1 N20' ? f.hh20[i] : f.hh55[i], ll = base === 'F1 N20' ? f.ll20[i] : f.ll55[i]; d = f.close[i] > hh ? 1 : f.close[i] < ll ? -1 : 0; }
        if (!d || trendDir(f, i) !== d) return null;
        if (filt === 'bias' && f.bias[i] !== d) return null;
        if (filt === 'noAvoid' && f.verdict[i] === 0) return null;
        if (filt === 'risk1' && m * f.atr[i] < 0.01 * f.close[i]) return null;
        return { dir: d };
      },
      exit: { stopAtr: m, trailAtr: m, trailRef: 'close' },
    });
  }
  // F8 (round 3, aimed at crypto 1H / 15m): slower trend filter (EMA 800 ~ the 4H 200-EMA on a 1H chart)
  // and wider trails, on the two round-2 leaders.
  for (const base of ['F4 pool', 'F1 N55']) for (const tl of [200, 800]) for (const m of [5, 8]) {
    out.push({
      fam: 'F8 slow', name: `F8 ${base} ema${tl} trail${m}`,
      prep: (f) => { if (!f._ema800) { const a = 2 / 801; let p = NaN; f._ema800 = Float64Array.from(f.close, (c) => (p = p !== p ? c : a * c + (1 - a) * p)); } },
      signal: (f, i) => {
        let d = 0;
        if (base === 'F4 pool') { const e = f.ev[i]; const u = (e & 4) !== 0, dd = (e & 8) !== 0; d = u && !dd ? 1 : dd && !u ? -1 : 0; }
        else d = f.close[i] > f.hh55[i] ? 1 : f.close[i] < f.ll55[i] ? -1 : 0;
        const e = tl === 200 ? f.ema200[i] : f._ema800[i];
        if (!d || (d > 0 ? f.close[i] <= e : f.close[i] >= e)) return null;
        return { dir: d };
      },
      exit: { stopAtr: m, trailAtr: m, trailRef: 'close' },
    });
  }
  return out;
}
