// Download full daily OHLCV history (split-adjusted by default; ADJ=dividends or --adjust dividends for dividend-adjusted) for EGX stocks + indices
// from TradingView's public websocket feed into CSV files.
//
// Usage (Node 20 needs the experimental WebSocket flag):
//   node --experimental-websocket tools/backtest/fetch-egx.mjs [outDir] [SYM1,SYM2,...]  [--adjust splits|dividends]   (or ADJ=dividends; the flag goes LAST)
//
//   outDir   default: data/egx
//   symbols  optional comma list of tickers (e.g. COMI,ABUK) or full TV ids
//            (e.g. EGX:COMI, EGX_DLY:EGX30). Default: every symbol in EGX30_LIST /
//            EGX70_LIST of src/egx-trust-indicator.pine plus the index candidates.
//
// Output:
//   <outDir>/<SYMBOL>.csv      header: time,open,high,low,close,volume,date
//                               time = unix seconds from the feed, date = YYYY-MM-DD (Africa/Cairo)
//   <outDir>/_EGX30.csv, _EGX70EWI.csv   indices (first candidate that resolves)
//   <outDir>/_meta.json        per symbol: list, bars, first, last, mintick, pricescale,
//                               minmov, timezone, session, description, type, tvSymbol, error?
// When a symbol list is given, _meta.json is merged into the existing one.
// History is fetched with create_series + request_more_data until the oldest bar
// stops changing. Sequential, 400 ms pause between symbols, one retry on failure.
// Unauthenticated feed: no account needed, no data is invented for missing symbols.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const pinePath = path.resolve(here, '../../src/egx-trust-indicator.pine');
// Price adjustment sent to TradingView: 'splits' (default, what data/egx holds) or 'dividends' (what the charts show with ADJ on; data/egx-div).
// Parsed and removed BEFORE the positional arguments are read: otherwise, with no symbol list, '--adjust' itself was taken as one.
const ai = process.argv.indexOf('--adjust');
const ADJ = (ai > 0 ? process.argv[ai + 1] : process.env.ADJ) || 'splits';
if (!['splits', 'dividends', 'none'].includes(ADJ)) throw new Error('bad adjustment ' + ADJ);
if (ai > 0) process.argv.splice(ai, 2);

const outDir = path.resolve(process.argv[2] || 'data/egx');
const only = process.argv[3] ? process.argv[3].split(',').map(s => s.trim()).filter(Boolean) : null;

const STEP = 5000;        // bars per request
const MAX_ROUNDS = 40;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rnd = () => Math.random().toString(36).slice(2, 14);
const enc = (m, p) => { const s = JSON.stringify({ m, p }); return '~m~' + s.length + '~m~' + s; };
const cairoDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' });

function fetchSymbol(symbol, timeoutMs = 90000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('wss://data.tradingview.com/socket.io/websocket?type=chart', { headers: { Origin: 'https://www.tradingview.com' } });
    const cs = 'cs_' + rnd();
    const bars = new Map();
    let meta = null, done = false, rounds = 0, lastOldest = null, lastCount = 0, stable = 0;
    const finish = (err, val) => { if (done) return; done = true; clearTimeout(timer); try { ws.close(); } catch {} err ? reject(err) : resolve(val); };
    const timer = setTimeout(() => finish(new Error('timeout')), timeoutMs);
    ws.onerror = () => finish(new Error('ws error'));
    ws.onclose = () => finish(new Error('ws closed early'));
    ws.onopen = () => {
      ws.send(enc('set_auth_token', ['unauthorized_user_token']));
      ws.send(enc('chart_create_session', [cs, '']));
      ws.send(enc('resolve_symbol', [cs, 'sds_sym_1', '=' + JSON.stringify({ symbol, adjustment: ADJ })]));
      ws.send(enc('create_series', [cs, 'sds_1', 's1', 'sds_sym_1', '1D', STEP, '']));
    };
    ws.onmessage = e => {
      for (const part of String(e.data).split(/~m~\d+~m~/).filter(Boolean)) {
        if (part.startsWith('~h~')) { ws.send('~m~' + part.length + '~m~' + part); continue; }
        let j; try { j = JSON.parse(part); } catch { continue; }
        if (j.m === 'symbol_resolved') meta = j.p[2];
        else if (j.m === 'timescale_update') {
          const s = (j.p[1] && j.p[1].sds_1 && j.p[1].sds_1.s) || [];
          for (const b of s) bars.set(b.v[0], b.v);
        } else if (j.m === 'symbol_error' || j.m === 'series_error' || j.m === 'critical_error') {
          finish(new Error(j.m + ' ' + JSON.stringify(j.p.slice(1)))); return;
        } else if (j.m === 'series_completed') {
          if (!bars.size) { finish(new Error('no bars')); return; }
          let oldest = Infinity; for (const k of bars.keys()) if (k < oldest) oldest = k;
          if (bars.size === lastCount && oldest === lastOldest) stable++; else stable = 0;
          lastCount = bars.size; lastOldest = oldest;
          if (stable >= 1 || ++rounds > MAX_ROUNDS) { finish(null, { meta, bars: [...bars.values()].sort((a, b) => a[0] - b[0]), rounds }); return; }
          ws.send(enc('request_more_data', [cs, 'sds_1', STEP]));
        }
      }
    };
  });
}

async function fetchRetry(symbol) {
  try { return await fetchSymbol(symbol); }
  catch (e) { if (/symbol_error|no bars/.test(e.message)) throw e; await sleep(1500); return await fetchSymbol(symbol); }
}

function writeCsv(file, bars) {
  const lines = ['time,open,high,low,close,volume,date'];
  for (const [t, o, h, l, c, v] of bars) lines.push([t, o, h, l, c, v == null ? 0 : v, cairoDate.format(new Date(t * 1000))].join(','));
  fs.writeFileSync(file, lines.join('\n') + '\n');
}

function check(bars) {
  const flags = [];
  if (bars.length < 250) flags.push('<250 bars');
  let dup = 0, bad = 0, hl = 0, maxGap = 0;
  for (let i = 0; i < bars.length; i++) {
    const [t, o, h, l, c] = bars[i];
    if (i && t === bars[i - 1][0]) dup++;
    if (i) maxGap = Math.max(maxGap, (t - bars[i - 1][0]) / 86400);
    if (!(o > 0 && h > 0 && l > 0 && c > 0)) bad++;
    if (h < l) hl++;
  }
  if (maxGap > 30) flags.push('gap ' + maxGap.toFixed(0) + 'd');
  if (bad) flags.push(bad + ' nonpositive-price bars');
  if (hl) flags.push(hl + ' high<low');
  if (dup) flags.push(dup + ' duplicate ts');
  return { flags, maxGap };
}

const pine = fs.readFileSync(pinePath, 'utf8');
const grab = name => { const m = pine.match(new RegExp(name + '\\s*=\\s*"([^"]*)"')); return (m ? m[1] : '').split(',').map(s => s.trim()).filter(Boolean); };
const e30 = grab('EGX30_LIST'), e70 = grab('EGX70_LIST');
const targets = [];
if (only) {
  for (const s of only) {
    const tick = s.includes(':') ? s.split(':')[1] : s;
    targets.push({ key: tick, list: e30.includes(tick) ? 'EGX30' : e70.includes(tick) ? 'EGX70' : 'OTHER', candidates: [s.includes(':') ? s : 'EGX:' + s] });
  }
} else {
  for (const s of e30) targets.push({ key: s, list: 'EGX30', candidates: ['EGX:' + s] });
  for (const s of e70) targets.push({ key: s, list: 'EGX70', candidates: ['EGX:' + s] });
  targets.push({ key: '_EGX30', list: 'INDEX', candidates: ['EGX:EGX30', 'EGX_DLY:EGX30'] });
  targets.push({ key: '_EGX70EWI', list: 'INDEX', candidates: ['EGX_DLY:EGX70EWI', 'EGX:EGX70EWI'] });
}

fs.mkdirSync(outDir, { recursive: true });
const metaPath = path.join(outDir, '_meta.json');
const prevMeta = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, 'utf8')) : {};
const allMeta = only ? { ...prevMeta } : {};

for (const t of targets) {
  let lastErr = null, ok = false;
  for (const cand of t.candidates) {
    try {
      const r = await fetchRetry(cand);
      const m = r.meta || {};
      const { flags } = check(r.bars);
      writeCsv(path.join(outDir, t.key + '.csv'), r.bars);
      const rec = {
        list: t.list, tvSymbol: cand, bars: r.bars.length,
        first: cairoDate.format(new Date(r.bars[0][0] * 1000)), last: cairoDate.format(new Date(r.bars[r.bars.length - 1][0] * 1000)),
        mintick: m.minmov / m.pricescale, pricescale: m.pricescale, minmov: m.minmov,
        timezone: m.timezone, session: m.session, description: m.description, type: m.type,
        rounds: r.rounds, adjustment: ADJ,
      };
      if (flags.length) rec.flags = flags;
      allMeta[t.key] = rec;
      console.log(t.key.padEnd(10) + ' ' + cand.padEnd(18) + ' bars=' + String(rec.bars).padStart(5) + ' ' + rec.first + '..' + rec.last + ' mintick=' + rec.mintick + (flags.length ? ' FLAGS: ' + flags.join('; ') : ''));
      ok = true; break;
    } catch (e) { lastErr = e; console.log(t.key.padEnd(10) + ' ' + cand.padEnd(18) + ' FAIL ' + e.message); await sleep(300); }
  }
  // A failed download leaves the old CSV in place; keep the old record (mintick above all) next to the error, so the
  // stock can still be scanned on the bars it has.
  if (!ok) allMeta[t.key] = { ...(prevMeta[t.key] || { list: t.list, bars: 0 }), error: String(lastErr && lastErr.message || lastErr), tried: t.candidates };
  fs.writeFileSync(metaPath, JSON.stringify(allMeta, null, 1));
  await sleep(400);
}
console.log('done ->', outDir);
