// One-position-at-a-time trade simulator for the model search.
//
// Fills: entry at the signal bar's close. On later bars, in this order: a stop the bar OPENS beyond fills at
// the open (gap); else a stop the bar trades through fills at the stop; else a target fills at the target.
// So a bar reaching both stop and target counts as the stop. Trailing stops and breakeven are updated at the
// bar's close and apply from the next bar. Exit signals and time stops fill at the close.
//
// strat = { signal(f, i) -> null | { dir, stop? } , exit: {...} }
// exit  = { stopAtr, tpR, trailAtr, trailRef: 'close'|'extreme', beR, maxBars, exitOn(f, i, pos) -> bool }
// costs = { pct, commission, positionSize }   pct = % of price per side
export function simulate(f, strat, costs, { from = -Infinity, to = Infinity, longOnly = false, shortOnly = false } = {}) {
  const { time, open, high, low, close, atr } = f;
  const ex = strat.exit;
  const trades = [];
  let pos = null;
  for (let i = 1; i < f.n; i++) {
    if (pos) {
      const d = pos.dir;
      let exitPx = NaN, why = '';
      if (d > 0 ? open[i] <= pos.stop : open[i] >= pos.stop) { exitPx = open[i]; why = 'gap'; }
      else if (d > 0 ? low[i] <= pos.stop : high[i] >= pos.stop) { exitPx = pos.stop; why = pos.stop === pos.initStop ? 'stop' : 'trail'; }
      else if (pos.tp && (d > 0 ? high[i] >= pos.tp : low[i] <= pos.tp)) { exitPx = pos.tp; why = 'tp'; }
      if (exitPx !== exitPx) {
        if (ex.exitOn && ex.exitOn(f, i, pos)) { exitPx = close[i]; why = 'signal'; }
        else if (ex.maxBars && i - pos.i >= ex.maxBars) { exitPx = close[i]; why = 'time'; }
      }
      if (exitPx === exitPx) {
        const gross = (exitPx - pos.entry) * d / pos.risk;
        let cost = costs.pct / 100 * (pos.entry + exitPx) / pos.risk;
        if (costs.commission) cost += 2 * costs.commission / ((costs.positionSize / pos.entry) * pos.risk);
        trades.push({ sym: f.sym, dir: d, openTime: time[pos.i], closeTime: time[i], bars: i - pos.i, grossR: gross, costR: cost, r: gross - cost, why, riskPct: pos.risk / pos.entry * 100 });
        pos = null;
      } else {
        // end-of-bar management
        if (ex.trailAtr) {
          const ref = ex.trailRef === 'extreme' ? (d > 0 ? high[i] : low[i]) : close[i];
          pos.best = d > 0 ? Math.max(pos.best, ref) : Math.min(pos.best, ref);
          const ts = pos.best - d * ex.trailAtr * atr[i];
          if (d > 0 ? ts > pos.stop : ts < pos.stop) pos.stop = ts;
        }
        if (ex.beR && !pos.be && (d > 0 ? high[i] - pos.entry : pos.entry - low[i]) >= ex.beR * pos.risk) {
          pos.be = true;
          if (d > 0 ? pos.entry > pos.stop : pos.entry < pos.stop) pos.stop = pos.entry;
        }
      }
    }
    if (!pos && time[i] >= from && time[i] < to && atr[i] > close[i] * 1e-4) {
      const s = strat.signal(f, i);
      if (s && s.dir && !(longOnly && s.dir < 0) && !(shortOnly && s.dir > 0)) {
        const entry = close[i];
        let stop = s.stop != null ? s.stop : entry - s.dir * ex.stopAtr * atr[i];
        const risk = (entry - stop) * s.dir;
        if (risk > 0 && risk >= 0.2 * atr[i] && risk <= 10 * atr[i]) {
          pos = { dir: s.dir, i, entry, stop, initStop: stop, risk, best: entry, be: false, tp: ex.tpR ? entry + s.dir * ex.tpR * risk : 0 };
        }
      }
    }
  }
  return trades;
}

export function stats(trades) {
  const n = trades.length;
  if (!n) return { n: 0, avg: NaN, gross: NaN, tot: 0, win: NaN, symPos: NaN, symN: 0, longAvg: NaN, shortAvg: NaN, nL: 0, nS: 0, pf: NaN };
  let tot = 0, gross = 0, wins = 0, gw = 0, gl = 0;
  const by = new Map();
  let L = 0, nL = 0, S = 0, nS = 0;
  for (const t of trades) {
    tot += t.r; gross += t.grossR; if (t.r > 0) { wins++; gw += t.r; } else gl -= t.r;
    by.set(t.sym, (by.get(t.sym) || []).concat([t.r]));
    if (t.dir > 0) { L += t.r; nL++; } else { S += t.r; nS++; }
  }
  const elig = [...by.values()].filter((a) => a.length >= 5);
  const pos = elig.filter((a) => a.reduce((s, x) => s + x, 0) > 0).length;
  return { n, avg: tot / n, gross: gross / n, tot, win: wins / n, pf: gl ? gw / gl : Infinity, symPos: elig.length ? pos / elig.length : NaN, symN: elig.length, longAvg: nL ? L / nL : NaN, shortAvg: nS ? S / nS : NaN, nL, nS };
}
