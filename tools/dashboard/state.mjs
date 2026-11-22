// Pure views over scan results for the dashboard: the provisional ("if it closed now") diff, open-trade rows, the day
// by day list and the per-stock evaluation. Inputs are runUniverse() results from tools/backtest/scan-core.mjs.
import { tradeKey, nextTarget, openPct } from '../backtest/scan-core.mjs';

const keyOf = (t) => tradeKey(t.symbol, t.openDate, t.model);

// withRun: the universe run with today's forming bar treated as closed; withoutRun: the same run without it. Whatever
// happens on `today` in withRun is what the close would do if prices held.
export function provisional(withRun, withoutRun, today) {
  if (!Object.values(withRun.lastDate).includes(today)) return { exits: [], entries: [], targets: [] };
  const exits = withRun.closedAll.filter((t) => t.closeDate === today);
  const entries = [...withRun.closedAll, ...withRun.openAll].filter((t) => t.openDate === today);
  const before = new Map(withoutRun.openAll.map((t) => [keyOf(t), t]));
  const targets = [];
  for (const t of withRun.openAll) {
    const b = before.get(keyOf(t));
    if (b && t.tpHit > b.tpHit) targets.push({ symbol: t.symbol, model: t.model, openDate: t.openDate, from: b.tpHit, to: t.tpHit, level: t['tp' + t.tpHit] });
  }
  return { exits, entries, targets };
}

// Open trades with the distance from the last price to the current stop, in % of price and in R (initial risk).
export function openRows(openAll) {
  return openAll.map((t) => {
    const dir = t.side === 'long' ? 1 : -1;
    const risk = Math.abs(t.entry - t.stop);
    const dist = dir * (t.close - t.curStop);
    return { ...t, openPct: openPct(t), toStopPct: t.close > 0 ? 100 * dist / t.close : null, toStopR: risk > 0 ? dist / risk : null, next: t.tpHit >= 3 ? null : nextTarget(t) };
  });
}

// sessionDates: every distinct bar date in the universe, any order. Returns the last `sessions` of them that had an
// entry or an exit, newest first.
export function dayByDay(closedAll, openAll, sessionDates, sessions = 60) {
  const recent = [...new Set(sessionDates)].sort().slice(-sessions);
  const out = [];
  for (const date of recent.reverse()) {
    const entries = [...closedAll, ...openAll].filter((t) => t.openDate === date);
    const exits = closedAll.filter((t) => t.closeDate === date);
    if (entries.length || exits.length) out.push({ date, entries, exits });
  }
  return out;
}

export function stats(trades) {
  const n = trades.length, wins = trades.filter((t) => t.r > 0).length, totalR = trades.reduce((a, t) => a + t.r, 0);
  return { n, wins, winPct: n ? 100 * wins / n : null, totalR, avgR: n ? totalR / n : null };
}

const minusDays = (date, days) => new Date(Date.parse(date + 'T00:00:00Z') - days * 86400000).toISOString().slice(0, 10);

// One row per stock (every symbol in `symbols`, plus any that has a trade), PB and TR separately, all history and the
// last 12 months (trades closed after asOf - 365 days).
export function evaluate(closedAll, openAll, asOf, symbols = []) {
  const from12 = minusDays(asOf, 365);
  const syms = [...new Set([...symbols, ...closedAll.map((t) => t.symbol), ...openAll.map((t) => t.symbol)])].sort();
  const pick = (list, m, recent) => list.filter((t) => t.model === m && (!recent || t.closeDate > from12));
  const rows = syms.map((symbol) => {
    const mine = closedAll.filter((t) => t.symbol === symbol);
    const last = mine.reduce((a, t) => (!a || t.closeDate > a.closeDate ? t : a), null);
    return {
      symbol,
      PB: stats(pick(mine, 'PB')), TR: stats(pick(mine, 'TR')), PB12: stats(pick(mine, 'PB', true)), TR12: stats(pick(mine, 'TR', true)),
      open: openAll.filter((t) => t.symbol === symbol),
      last: last && { model: last.model, openDate: last.openDate, closeDate: last.closeDate, reason: last.reason, r: last.r },
    };
  });
  const totals = { PB: stats(pick(closedAll, 'PB')), TR: stats(pick(closedAll, 'TR')), PB12: stats(pick(closedAll, 'PB', true)), TR12: stats(pick(closedAll, 'TR', true)) };
  return { rows, totals, from12 };
}
