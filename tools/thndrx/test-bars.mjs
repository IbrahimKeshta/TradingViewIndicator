// Synthetic bar helper shared by the ThndrX overlay tests (node:test), so every test builds bars the same way.
//
// makeBars(closes, { start, stepSec, volume }) -> [{ time, date, open, high, low, close, volume }]
//   closes   array of close prices; bar i opens at the previous close (the first bar opens at its own close)
//   high/low open/close extreme padded by a fixed 1% wick (high = max(o,c) * 1.01, low = min(o,c) * 0.99)
//   start    unix seconds of bar 0 (default 2024-01-01T08:00:00Z, i.e. 03:00 New York, inside the London killzone)
//   stepSec  seconds between bars (default 86400 = daily; 3600 hourly, 300 = 5m)
//   volume   volume of every bar (default 1000)
//   date     the bar's calendar date 'YYYY-MM-DD' in Africa/Cairo (what the real EGX CSV bars carry)

const cairoDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' });

export const DEFAULT_START = Date.parse('2024-01-01T08:00:00Z') / 1000;

export function makeBars(closes, { start = DEFAULT_START, stepSec = 86400, volume = 1000 } = {}) {
  return closes.map((close, i) => {
    const open = i === 0 ? close : closes[i - 1];
    const time = start + i * stepSec;
    return {
      time, date: cairoDate.format(new Date(time * 1000)),
      open, high: Math.max(open, close) * 1.01, low: Math.min(open, close) * 0.99, close, volume,
    };
  });
}
