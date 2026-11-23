// Shared by compare-log.mjs and tools/thndrx/parity.mjs: parse the Pine "Log Closed Trades" CSV ("Date,Message",
// message `TRADE,...`, see logTrade in src/ict-rsi-ma-indicator.pine) and diff it against the port's trades.

const cairoFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Cairo', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
});

// Pine str.format_time(t, "yyyy-MM-dd HH:mm", "Africa/Cairo") for a unix-seconds time.
export function formatCairoTime(sec) {
  const p = {};
  for (const { type, value } of cairoFmt.formatToParts(new Date(sec * 1000))) p[type] = value;
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

// dateOnly cuts open/close to the first 10 characters (the day), which is how the daily comparison has always keyed.
export function parseTradeLog(text, { dateOnly = false } = {}) {
  const cut = (s) => (dateOnly ? s.slice(0, 10) : s);
  return text.split(/\r?\n/).slice(1).map((l) => { const m = /"(TRADE,.*)"/.exec(l); return m ? m[1].split(',') : null; }).filter(Boolean)
    .map((c) => ({ model: c[1], open: cut(c[4]), close: cut(c[5]), side: c[6], grade: c[7], score: +c[8], of: +c[9], zone: c[10], entry: +c[11], stop: +c[12], tp1: +c[13], tp2: +c[14], tp3: +c[15], tpHit: +c[16], reason: c[17], exit: +c[18], r: +c[19], mfe: +c[20], mae: +c[21], bars: +c[22], riskAtr: +c[23], flags: c.slice(24, 31).join(''), period: c[31] }));
}

// An engine trade in the shape parseTradeLog returns; `open` / `close` are whatever string form the caller keys on.
export function portTrade(t, open, close) {
  return { model: t.model, open, close, side: t.side, grade: t.grade, score: t.score, of: t.of, zone: t.zone, entry: t.entry, stop: t.stop, tp1: t.tp1, tp2: t.tp2, tp3: t.tp3, tpHit: t.tpHit, reason: t.reason, exit: t.exit, r: t.r, mfe: t.mfeR, mae: t.maeR, bars: t.bars, riskAtr: t.riskAtr, flags: [t.kz, t.mom, t.ma, t.maj, t.brk, t.part, t.ichi].join(''), period: t.period };
}

export const tradeKey = (t) => t.model + '|' + t.open + '|' + t.side;

// Prints the diff (one line per missing / extra / differing trade, then totals) and returns the counts.
export function diffTrades(tv, mine, log = console.log) {
  const mm = new Map(mine.map((t) => [tradeKey(t), t]));
  let matched = 0, fieldDiff = 0, missing = 0;
  log('TV trades', tv.length, ' port trades', mine.length);
  for (const t of tv) {
    const m = mm.get(tradeKey(t));
    if (!m) { missing++; log('MISSING in port:', t.model, t.open, t.side, t.zone, 'entry', t.entry, 'r', t.r, t.reason, 'close', t.close); continue; }
    mm.delete(tradeKey(t)); matched++;
    const d = [];
    const near = (a, b) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a));
    for (const f of ['close', 'grade', 'score', 'of', 'zone', 'tpHit', 'reason', 'bars', 'flags', 'period']) if (t[f] !== m[f]) d.push(`${f}:${t[f]}/${m[f]}`);
    for (const f of ['entry', 'stop', 'tp1', 'tp2', 'tp3', 'exit']) if (!near(t[f], m[f])) d.push(`${f}:${t[f]}/${m[f].toPrecision(8)}`);
    if (Math.abs(t.r - m.r) > 0.011) d.push(`r:${t.r}/${m.r.toFixed(2)}`);
    if (Math.abs(t.mfe - m.mfe) > 0.011) d.push(`mfe:${t.mfe}/${m.mfe.toFixed(2)}`);
    if (Math.abs(t.mae - m.mae) > 0.011) d.push(`mae:${t.mae}/${m.mae.toFixed(2)}`);
    if (Math.abs(t.riskAtr - m.riskAtr) > 0.011) d.push(`riskAtr:${t.riskAtr}/${m.riskAtr.toFixed(2)}`);
    if (d.length) { fieldDiff++; log('DIFF', t.model, t.open, t.side, d.join(' ')); }
  }
  for (const m of mm.values()) log('EXTRA in port:', m.model, m.open, m.side, m.zone, 'entry', m.entry, 'r', m.r.toFixed(2), m.reason, 'close', m.close);
  log('matched', matched, 'with field diffs', fieldDiff);
  return { matched, fieldDiff, missing, extra: mm.size };
}
