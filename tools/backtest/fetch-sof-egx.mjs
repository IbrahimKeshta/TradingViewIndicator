// Fetch the EGX data the Session Order Flow backtest needs: for every EGX30 + EGX70 name, daily bars
// (full history), 30-minute bars (intrabars of the daily chart) and 1-hour bars, dividend-adjusted like
// the user's charts. Output: data/sof/egx/<SYM>_<RES>.csv and data/sof/egx/_meta.json (mintick etc.).
//
//   node --experimental-websocket tools/backtest/fetch-sof-egx.mjs [SYM1,SYM2,...]

import fs from 'node:fs';
import path from 'node:path';
import { fetchSeries, writeBarsCsv } from './tv-feed.mjs';
import { EGX30_LIST, EGX70_LIST } from './ict-engine.mjs';

const outDir = path.resolve(process.env.SOF_EGX_DIR || 'data/sof/egx');
fs.mkdirSync(outDir, { recursive: true });
const list = (s) => s.split(',').map((x) => x.trim()).filter(Boolean);
const syms = process.argv[2] ? list(process.argv[2]) : [...list(EGX30_LIST), ...list(EGX70_LIST)];
const metaFile = path.join(outDir, '_meta.json');
const meta = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, 'utf8')) : {};
const RES = [['1D', 20000], ['30', 100000], ['60', 100000]];
const iso = (t) => new Date(t * 1000).toISOString().slice(0, 10);

let next = 0;
async function worker() {
  while (next < syms.length) {
    const sym = syms[next++];
    const rec = meta[sym] || {};
    for (const [res, maxBars] of RES) {
      const file = path.join(outDir, `${sym}_${res}.csv`);
      if (fs.existsSync(file)) continue;
      try {
        let r;
        try { r = await fetchSeries('EGX:' + sym, res, { maxBars, adjustment: 'dividends' }); }
        catch (e) { if (/symbol_error|no bars/.test(e.message)) throw e; await new Promise((z) => setTimeout(z, 1500)); r = await fetchSeries('EGX:' + sym, res, { maxBars, adjustment: 'dividends' }); }
        writeBarsCsv(file, r.bars);
        rec.mintick = r.meta.minmov / r.meta.pricescale; rec.type = r.meta.type; rec.timezone = r.meta.timezone;
        rec[res] = { bars: r.bars.length, first: iso(r.bars[0][0]), last: iso(r.bars[r.bars.length - 1][0]) };
      } catch (e) { rec[res] = { error: e.message }; }
    }
    meta[sym] = rec;
    fs.writeFileSync(metaFile, JSON.stringify(meta, null, 1));
    console.log(sym.padEnd(6), RES.map(([res]) => res + ':' + (rec[res] ? (rec[res].error ? 'ERR ' + rec[res].error.slice(0, 40) : rec[res].bars + ' ' + rec[res].first) : '?')).join('  '));
  }
}
await Promise.all([worker(), worker(), worker()]);
console.log('done', syms.length);
