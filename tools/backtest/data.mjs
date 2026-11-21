// CSV / meta loading for the offline backtest. Header-driven, so column order does not matter.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'egx');

export function loadCsv(file) {
  const lines = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/);
  const head = lines[0].split(',');
  const ix = Object.fromEntries(head.map((h, i) => [h.trim(), i]));
  const bars = [];
  for (let k = 1; k < lines.length; k++) {
    const c = lines[k].split(',');
    bars.push({
      time: +c[ix.time], date: c[ix.date],
      open: +c[ix.open], high: +c[ix.high], low: +c[ix.low], close: +c[ix.close],
      volume: c[ix.volume] === '' || c[ix.volume] === undefined ? NaN : +c[ix.volume],
    });
  }
  return bars;
}
export function loadSymbol(sym, dir = DATA_DIR) { return loadCsv(path.join(dir, sym + '.csv')); }
export function loadMeta(dir = DATA_DIR) {
  const f = path.join(dir, '_meta.json');
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
}
export function loadIndexBars(dir = DATA_DIR) {
  const out = {};
  const f30 = path.join(dir, '_EGX30.csv'), f70 = path.join(dir, '_EGX70EWI.csv');
  if (fs.existsSync(f30)) out.EGX30 = loadCsv(f30);
  if (fs.existsSync(f70)) out.EGX70 = loadCsv(f70);
  return out;
}
// Truncate history: keep bars dated <= endDate, then (optionally) only the last maxBars of those.
export function cutBars(bars, { endDate, maxBars } = {}) {
  let b = bars;
  if (endDate) b = b.filter((x) => x.date <= endDate);
  if (maxBars && b.length > maxBars) b = b.slice(b.length - maxBars);
  return b;
}
