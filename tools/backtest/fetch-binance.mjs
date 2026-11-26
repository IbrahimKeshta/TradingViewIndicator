// Download Binance spot 1-minute klines from the public archive (data.binance.vision, monthly zips)
// into one binary file per symbol: data/sof/binance/<SYM>_1m.bin = Float64 rows [time(sec), o, h, l, c, v].
//
//   node tools/backtest/fetch-binance.mjs BTCUSDT,ETHUSDT 2023-11 2026-10 [outDir]
//
// Each zip is extracted by Windows' bsdtar into its own fresh directory, parsed, and deleted.
// Archive timestamps are milliseconds before 2025 and microseconds from 2025; both are normalised.
// These are the same exchange prints TradingView shows for BINANCE:<SYM>.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const [symArg, fromArg, toArg, outArg] = process.argv.slice(2);
const outDir = path.resolve(outArg || 'data/sof/binance');
const tmpRoot = path.resolve('data/sof/binance-tmp');
const TAR = 'C:\\Windows\\System32\\tar.exe';
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(tmpRoot, { recursive: true });

function months(from, to) {
  const out = []; let [y, m] = from.split('-').map(Number); const [ty, tm] = to.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) { out.push(`${y}-${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; y++; } }
  return out;
}

async function getMonth(sym, ym) {
  const url = `https://data.binance.vision/data/spot/monthly/klines/${sym}/1m/${sym}-1m-${ym}.zip`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const buf = Buffer.from(await res.arrayBuffer());
      const dir = fs.mkdtempSync(path.join(tmpRoot, `${sym}-${ym}-`));
      const zip = path.join(dir, 'k.zip');
      fs.writeFileSync(zip, buf);
      const x = path.join(dir, 'x'); fs.mkdirSync(x);
      execFileSync(TAR, ['-xf', zip, '-C', x]);
      const csv = fs.readdirSync(x).find((f) => f.endsWith('.csv'));
      const text = fs.readFileSync(path.join(x, csv), 'utf8');
      fs.rmSync(dir, { recursive: true, force: true });
      const rows = [];
      for (const line of text.split('\n')) {
        if (!line || line.charCodeAt(0) > 57) continue; // skip a header line if present
        const c = line.split(',');
        let t = Number(c[0]); t = t > 1e14 ? Math.floor(t / 1e6) : t > 1e11 ? Math.floor(t / 1e3) : t;
        rows.push([t, +c[1], +c[2], +c[3], +c[4], +c[5]]);
      }
      return rows;
    } catch (e) {
      if (attempt === 2) throw new Error(`${sym} ${ym}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

const syms = symArg.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
const ms = months(fromArg, toArg);
for (const sym of syms) {
  const file = path.join(outDir, `${sym}_1m.bin`);
  if (fs.existsSync(file)) { console.log(sym, 'exists, skipped'); continue; }
  const chunks = new Array(ms.length);
  let next = 0;
  const worker = async () => { while (next < ms.length) { const k = next++; chunks[k] = await getMonth(sym, ms[k]); } };
  await Promise.all([worker(), worker(), worker(), worker()]);
  const all = chunks.filter(Boolean).flat();
  all.sort((a, b) => a[0] - b[0]);
  const arr = new Float64Array(all.length * 6);
  let k = 0, prev = -1, dup = 0;
  for (const r of all) { if (r[0] === prev) { dup++; continue; } prev = r[0]; arr.set(r, k); k += 6; }
  fs.writeFileSync(file, Buffer.from(arr.buffer, 0, k * 8));
  const missing = ms.filter((_, i) => !chunks[i]);
  const iso = (t) => new Date(t * 1000).toISOString().slice(0, 16);
  console.log(sym, 'rows=' + k / 6, iso(arr[0]) + '..' + iso(arr[k - 6]), dup ? 'dups=' + dup : '', missing.length ? 'missing months: ' + missing.join(' ') : '');
}
