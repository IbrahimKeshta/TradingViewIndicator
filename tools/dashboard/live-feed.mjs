// Short tail fetch from TradingView's public websocket feed (the same unauthenticated feed as
// tools/backtest/fetch-egx.mjs), and the merge of that tail onto the full history on disk.
//
// fetchTail asks for the last n daily bars only, dividend-adjusted, in one create_series with no request_more_data, so
// it takes about a second per stock. During the session the newest bar is the one still forming. Node 20 needs
// --experimental-websocket for the global WebSocket.

const rnd = () => Math.random().toString(36).slice(2, 14);
const enc = (m, p) => { const s = JSON.stringify({ m, p }); return '~m~' + s.length + '~m~' + s; };
const cairoDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit' });

export function fetchTail(tvSymbol, n = 30, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    if (typeof WebSocket === 'undefined') { reject(new Error('no WebSocket: run node with --experimental-websocket')); return; }
    const ws = new WebSocket('wss://data.tradingview.com/socket.io/websocket?type=chart', { headers: { Origin: 'https://www.tradingview.com' } });
    const cs = 'cs_' + rnd();
    const bars = new Map();
    let done = false;
    const finish = (err, val) => { if (done) return; done = true; clearTimeout(timer); try { ws.close(); } catch {} err ? reject(err) : resolve(val); };
    const timer = setTimeout(() => finish(new Error('timeout')), timeoutMs);
    ws.onerror = () => finish(new Error('ws error'));
    ws.onclose = () => finish(new Error('ws closed early'));
    ws.onopen = () => {
      ws.send(enc('set_auth_token', ['unauthorized_user_token']));
      ws.send(enc('chart_create_session', [cs, '']));
      ws.send(enc('resolve_symbol', [cs, 'sds_sym_1', '=' + JSON.stringify({ symbol: tvSymbol, adjustment: 'dividends' })]));
      ws.send(enc('create_series', [cs, 'sds_1', 's1', 'sds_sym_1', '1D', n, '']));
    };
    ws.onmessage = (e) => {
      for (const part of String(e.data).split(/~m~\d+~m~/).filter(Boolean)) {
        if (part.startsWith('~h~')) { ws.send('~m~' + part.length + '~m~' + part); continue; }
        let j; try { j = JSON.parse(part); } catch { continue; }
        if (j.m === 'timescale_update' || j.m === 'du') {
          const s = (j.p[1] && j.p[1].sds_1 && j.p[1].sds_1.s) || [];
          for (const x of s) bars.set(x.v[0], x.v);
        } else if (j.m === 'symbol_error' || j.m === 'series_error' || j.m === 'critical_error') {
          finish(new Error(j.m + ' ' + JSON.stringify(j.p.slice(1))));
        } else if (j.m === 'series_completed') {
          if (!bars.size) { finish(new Error('no bars')); return; }
          finish(null, [...bars.values()].sort((a, b) => a[0] - b[0]).map(([t, o, h, l, c, v]) => ({
            time: t, date: cairoDate.format(new Date(t * 1000)), open: o, high: h, low: l, close: c, volume: v == null ? 0 : v,
          })));
        }
      }
    };
  });
}

// Merge a fresh tail onto the disk history without mutating either. Bars with the same time are replaced by the tail's,
// newer ones appended. readjusted: an overlapping bar other than the tail's last (which may be forming) differs on its
// close by more than tol, so dividend adjustment has rescaled the history and the disk copy is stale. gap: the tail
// starts after the disk's last bar, so bars in between are missing.
export function mergeTail(disk, tail, tol = 0.005) {
  if (!tail.length) return { bars: disk, readjusted: false, gap: false };
  const byTime = new Map(disk.map((x, i) => [x.time, i]));
  const out = disk.slice();
  let readjusted = false;
  const lastDisk = disk.length ? disk[disk.length - 1].time : -Infinity;
  const gap = disk.length > 0 && tail[0].time > lastDisk;
  for (let k = 0; k < tail.length; k++) {
    const x = tail[k];
    const i = byTime.get(x.time);
    if (i === undefined) { if (x.time > lastDisk) out.push(x); continue; }
    if (k < tail.length - 1 && Math.abs(x.close - disk[i].close) > tol * disk[i].close) readjusted = true;
    out[i] = x;
  }
  return { bars: out, readjusted, gap };
}
