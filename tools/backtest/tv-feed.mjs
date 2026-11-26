// Generic TradingView websocket bar fetcher: any symbol, any resolution (1, 5, 15, 30, 60, 240, 1D, ...).
//
//   import { fetchSeries } from './tv-feed.mjs';
//   const { meta, bars } = await fetchSeries('BINANCE:BTCUSDT', '1', { maxBars: 200000 });
//   bars: [[time(sec), open, high, low, close, volume], ...] ascending
//
// CLI:  node --experimental-websocket tools/backtest/tv-feed.mjs <TVSYMBOL> <RES> <outCsv> [maxBars] [adjustment]
//
// Unauthenticated feed (same request fetch-egx.mjs makes). History is extended with request_more_data until
// the oldest bar stops changing or maxBars is reached. The unauthenticated feed caps how deep intraday
// history goes; the result reports what it actually got, nothing is invented.

import fs from 'node:fs';

const rnd = () => Math.random().toString(36).slice(2, 14);
const enc = (m, p) => { const s = JSON.stringify({ m, p }); return '~m~' + s.length + '~m~' + s; };

export function fetchSeries(symbol, resolution, { adjustment = 'dividends', maxBars = 20000, step = 5000, timeoutMs = 180000, session } = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('wss://data.tradingview.com/socket.io/websocket?type=chart', { headers: { Origin: 'https://www.tradingview.com' } });
    const cs = 'cs_' + rnd();
    const bars = new Map();
    let meta = null, done = false, lastOldest = null, lastCount = 0, rounds = 0;
    const finish = (err, val) => { if (done) return; done = true; clearTimeout(timer); try { ws.close(); } catch {} err ? reject(err) : resolve(val); };
    const timer = setTimeout(() => finish(new Error('timeout ' + symbol + ' ' + resolution)), timeoutMs);
    ws.onerror = () => finish(new Error('ws error'));
    ws.onclose = () => finish(new Error('ws closed early'));
    ws.onopen = () => {
      ws.send(enc('set_auth_token', ['unauthorized_user_token']));
      ws.send(enc('chart_create_session', [cs, '']));
      const sym = { symbol, adjustment };
      if (session) sym.session = session;
      ws.send(enc('resolve_symbol', [cs, 'sds_sym_1', '=' + JSON.stringify(sym)]));
      ws.send(enc('create_series', [cs, 'sds_1', 's1', 'sds_sym_1', resolution, Math.min(step, maxBars), '']));
    };
    const result = () => ({ meta, bars: [...bars.values()].sort((a, b) => a[0] - b[0]).map(v => [v[0], v[1], v[2], v[3], v[4], v[5] == null ? 0 : v[5]]), rounds });
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
          const stuck = bars.size === lastCount && oldest === lastOldest;
          lastCount = bars.size; lastOldest = oldest; rounds++;
          if (stuck || bars.size >= maxBars || rounds > 400) { finish(null, result()); return; }
          ws.send(enc('request_more_data', [cs, 'sds_1', Math.min(step, maxBars - bars.size)]));
        }
      }
    };
  });
}

export function writeBarsCsv(file, bars) {
  const lines = ['time,open,high,low,close,volume'];
  for (const b of bars) lines.push(b.join(','));
  fs.writeFileSync(file, lines.join('\n') + '\n');
}

export function readBarsCsv(file) {
  const rows = fs.readFileSync(file, 'utf8').trim().split('\n').slice(1);
  return rows.map(r => r.split(',').slice(0, 6).map(Number));
}

if (process.argv[1] && process.argv[1].endsWith('tv-feed.mjs')) {
  const [sym, res, out, maxBars, adj] = process.argv.slice(2);
  const { meta, bars, rounds } = await fetchSeries(sym, res, { maxBars: Number(maxBars || 20000), adjustment: adj || 'dividends' });
  writeBarsCsv(out, bars);
  const iso = t => new Date(t * 1000).toISOString().slice(0, 16);
  console.log(sym, res, 'bars=' + bars.length, iso(bars[0][0]) + '..' + iso(bars[bars.length - 1][0]), 'rounds=' + rounds, 'tz=' + (meta && meta.timezone), 'session=' + (meta && meta.session), 'mintick=' + (meta && meta.minmov / meta.pricescale), 'type=' + (meta && meta.type));
}
