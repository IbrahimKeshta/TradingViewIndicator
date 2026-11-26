// Lower-timeframe bars (intrabars) for the Session Order Flow overlay, read from Thndr's own datafeed object inside
// the chart frame. The datafeed signs its own requests, so this module never sees a login token. Facts from the live
// recon (docs/superpowers/specs/2026-11-26-thndrx-sof-overlay-design.md):
//   - path: frame.ChartApiInstance._studyEngine._externalDatafeed (TradingView Datafeed API)
//   - getBars answers noData when countBack is 0; with countBack >= 1 it returns a chunk ending at `to`
//   - base resolutions 1, 5, 10, 60 minutes; bars { time (ms), open, high, low, close, volume }
// Rows here are [timeSec, open, high, low, close, volume], ascending, the form buildChart takes.

const DATAFEED_PATH = ['ChartApiInstance', '_studyEngine', '_externalDatafeed'];
const BASES = [60, 10, 5, 1];                                    // Thndr's intraday base resolutions, largest first
const SPAN_DAYS = { 1: 28, 5: 120, 10: 300, 60: 1500 };          // the `from` we ask for (the feed pads it anyway)
const REQUEST_TIMEOUT_MS = 20000;
const PAUSE_MS = 60;                                             // between page requests, to be gentle with the feed
const TAIL_DAYS = 3;                                             // a cached series is refreshed from this far back
const IDB_NAME = 'thndrx-sof', IDB_STORE = 'ltf', IDB_KEEP = 12, MEM_KEEP = 4;

// Pine timeframe.in_seconds for the strings the chart and the inputs use.
export function tfSeconds(tf) {
  const r = String(tf).toUpperCase();
  if (r === 'D' || r === '1D') return 86400;
  if (r === 'W' || r === '1W') return 604800;
  if (r === 'M' || r === '1M') return 2628003;
  if (/^\d+$/.test(r)) return Number(r) * 60;
  throw new Error(`unsupported timeframe ${tf}`);
}

// Pine (session-orderflow.pine 526-528): the lower timeframe in minutes, or null when it is not below the chart's
// (then the chart bar's own direction is used throughout, as in Pine).
export function ltfFor(chartRes, deltaTfInput) {
  const chartSecs = tfSeconds(chartRes);
  const auto = chartSecs < 86400 ? '1' : chartSecs === 86400 ? '30' : '240';
  const want = deltaTfInput === 'Auto' ? auto : deltaTfInput;
  return tfSeconds(want) < chartSecs ? Number(want) : null;
}

// The largest Thndr base resolution that divides the wanted minutes: 1,3 -> 1; 5,15 -> 5; 30 -> 10; 60,240 -> 60.
export const baseFor = (ltfMin) => BASES.find((b) => ltfMin % b === 0);

// Calendar parts in a time zone; offsets change only on whole hours, so one Intl call per UTC hour.
const fmtCache = new Map(), hourCache = new Map();
function localParts(timeSec, tz) {
  const hour = Math.floor(timeSec / 3600), key = tz + '|' + hour;
  let p = hourCache.get(key);
  if (!p) {
    let f = fmtCache.get(tz);
    if (!f) { f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); fmtCache.set(tz, f); }
    const o = {};
    for (const { type, value } of f.formatToParts(new Date(hour * 3600000))) o[type] = +value;
    p = { day: Date.UTC(o.year, o.month - 1, o.day) / 86400000, minutes: o.hour * 60 + o.minute };
    if (hourCache.size > 200000) hourCache.clear();
    hourCache.set(key, p);
  }
  const extra = Math.floor((timeSec - Math.floor(timeSec / 3600) * 3600) / 60);
  return { day: p.day, minutes: p.minutes + extra };
}

// Base rows -> ltfMin rows. With sessionStartMin the buckets start at the session open (EGX 10:00: 30m bars at
// 10:00, 10:30, ...; 4h bars 10:00-14:00 and 14:00-14:30), as TradingView builds session-aligned bars; without it
// they sit on the UTC grid. A bucket's time is its start; open/close come from its first/last base bar.
export function aggregate(rows, ltfMin, { tz = 'Etc/UTC', sessionStartMin = null } = {}) {
  const out = [];
  let cur = null, curKey = NaN;
  for (const r of rows) {
    let key, start;
    if (sessionStartMin == null) {
      start = Math.floor(r[0] / (ltfMin * 60)) * ltfMin * 60;
      key = start;
    } else {
      const p = localParts(r[0], tz);
      const k = Math.floor((p.minutes - sessionStartMin) / ltfMin);
      key = p.day * 100000 + k;
      start = r[0] - (p.minutes - (sessionStartMin + k * ltfMin)) * 60 - (r[0] % 60);
    }
    if (key !== curKey) { cur = [start, r[1], r[2], r[3], r[4], r[5]]; out.push(cur); curKey = key; }
    else { if (r[2] > cur[2]) cur[2] = r[2]; if (r[3] < cur[3]) cur[3] = r[3]; cur[4] = r[4]; cur[5] += r[5]; }
  }
  return out;
}

// The datafeed object, or null when this ThndrX build does not expose it (the overlay then falls back to chart bars).
export function findDatafeed(frameWin) {
  try {
    let o = frameWin;
    for (const k of DATAFEED_PATH) o = o && o[k];
    return o && typeof o.getBars === 'function' && typeof o.resolveSymbol === 'function' ? o : null;
  } catch {
    return null;
  }
}

export function resolveSymbol(df, name, timeoutMs = REQUEST_TIMEOUT_MS) {
  return withTimeout(new Promise((resolve, reject) => {
    try { df.resolveSymbol(name, resolve, (e) => reject(new Error(String(e))), {}); } catch (e) { reject(e); }
  }), timeoutMs, 'resolveSymbol');
}

function withTimeout(p, ms, what) {
  let h;
  return Promise.race([p, new Promise((_, reject) => { h = setTimeout(() => reject(new Error(`${what} timed out`)), ms); })]).finally(() => clearTimeout(h));
}

// One getBars call as a promise of { rows, noData }.
function getChunk(df, si, base, from, to) {
  return withTimeout(new Promise((resolve, reject) => {
    try {
      // Whole seconds only: Thndr fails a request whose end_timestamp has a fraction (seen live: CHART_REQUEST_FAILED).
      df.getBars(si, String(base), { from: Math.floor(from), to: Math.ceil(to), countBack: 1, firstDataRequest: false },
        (bars, meta) => resolve({ rows: (bars || []).map((b) => [Math.round(b.time / 1000), +b.open, +b.high, +b.low, +b.close, +b.volume || 0]), noData: !!(meta && meta.noData) }),
        (e) => reject(new Error(String(e))));
    } catch (e) { reject(e); }
  }), REQUEST_TIMEOUT_MS, 'getBars');
}

// A failed request is tried again twice, after 1.5 s and 4 s: the first request after the page sat idle can fail while
// Thndr renews its login (seen live as CHART_REQUEST_FAILED, the same request succeeding a moment later).
const RETRY_PAUSES_MS = [1500, 4000];
async function getChunkRetry(df, si, base, from, to, sleep, cancelled) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await getChunk(df, si, base, from, to);
    } catch (e) {
      if (attempt >= RETRY_PAUSES_MS.length || cancelled()) throw e;
      await sleep(RETRY_PAUSES_MS[attempt]);
    }
  }
}

// Base bars in [fromSec, toSec), paged backwards from toSec: each request returns a chunk ending at the cursor, the
// cursor moves to the chunk's first bar. Returns null if cancelled.
export async function pageBars(df, si, base, { fromSec, toSec, cancelled = () => false, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), onProgress = () => {} }) {
  const span = SPAN_DAYS[base] * 86400, chunks = [];
  let cursor = toSec, empties = 0;
  while (cursor > fromSec) {
    if (cancelled()) return null;
    const { rows } = await getChunkRetry(df, si, base, Math.max(fromSec, cursor - span), cursor, sleep, cancelled);
    const older = rows.filter((r) => r[0] < cursor);
    if (rows.length && !older.length) break; // Thndr's `to` is inclusive: only the cursor bar itself came back, so it is the feed's first bar
    if (!older.length) {
      // Nothing in this span: a quiet stretch, or before the feed (Thndr answers that with an empty chunk and a
      // nextTime hint, not noData). Two empty spans in a row end the series.
      if (++empties >= 2) break;
      cursor -= span;
    } else {
      empties = 0;
      chunks.push(older);
      cursor = older[0][0];
    }
    onProgress(Math.min(1, (toSec - cursor) / Math.max(1, toSec - fromSec)));
    if (cursor > fromSec) await sleep(PAUSE_MS);
  }
  const out = [];
  for (let k = chunks.length - 1; k >= 0; k--) for (const r of chunks[k]) if (r[0] >= fromSec) out.push(r);
  return out;
}

// ---- cache: a small in-memory map, backed by IndexedDB when the page has it ----

const flat = (rows) => { const a = new Float64Array(rows.length * 6); rows.forEach((r, k) => a.set(r, k * 6)); return a; };
const unflat = (a) => { const rows = []; for (let k = 0; k < a.length; k += 6) rows.push(Array.from(a.subarray(k, k + 6))); return rows; };

function idbStore(idb) {
  if (!idb) return null;
  let dbp = null;
  const open = () => (dbp ??= new Promise((resolve, reject) => {
    const req = idb.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE, { keyPath: 'key' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
  const tx = async (mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(IDB_STORE, mode), st = t.objectStore(IDB_STORE);
      let out;
      fn(st, (v) => { out = v; });
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  };
  return {
    get: (key) => tx('readonly', (st, set) => { const r = st.get(key); r.onsuccess = () => set(r.result || null); }),
    put: (entry) => tx('readwrite', (st) => {
      st.put(entry);
      const all = st.getAll();
      all.onsuccess = () => { const old = all.result.sort((a, b) => b.savedAt - a.savedAt).slice(IDB_KEEP); for (const o of old) st.delete(o.key); };
    }),
  };
}

// get(key) -> { from, rows } | null; put(key, { from, rows }). Storage failures only cost a refetch.
export function createLtfCache({ idb = null, now = () => Date.now() } = {}) {
  const mem = new Map(), db = idbStore(idb);
  return {
    async get(key) {
      if (mem.has(key)) return mem.get(key);
      if (!db) return null;
      try {
        const e = await db.get(key);
        if (!e) return null;
        const entry = { from: e.from, rows: unflat(e.rows) };
        mem.set(key, entry);
        return entry;
      } catch { return null; }
    },
    async put(key, entry) {
      mem.delete(key); mem.set(key, entry);
      while (mem.size > MEM_KEEP) mem.delete(mem.keys().next().value);
      if (db) { try { await db.put({ key, from: entry.from, rows: flat(entry.rows), savedAt: now() }); } catch { /* quota or private mode */ } }
    },
  };
}

// Rows of `older` before the first row of `newer`, then `newer` (the newest read of a bar wins).
export function mergeRows(older, newer) {
  if (!newer.length) return older;
  const t0 = newer[0][0];
  let k = older.length;
  while (k > 0 && older[k - 1][0] >= t0) k--;
  return older.slice(0, k).concat(newer);
}

// Whether two reads agree on the bars they share (all but the newest shared bar, which may still be forming).
// A split re-scales Thndr's whole history, so a disagreement means the cache is stale.
export function overlapAgrees(older, newer) {
  const byTime = new Map(older.map((r) => [r[0], r]));
  const shared = newer.filter((r) => byTime.has(r[0])).slice(0, -1);
  return shared.every((r) => { const o = byTime.get(r[0]); return [1, 2, 3, 4].every((j) => Math.abs(o[j] - r[j]) <= 1e-9 * Math.max(1, Math.abs(r[j]))); });
}

// Base rows covering [fromSec, nowSec] for one asset and base: the cached series topped up from TAIL_DAYS back, or a
// full read when the cache is missing, does not reach back to fromSec, or disagrees with the fresh tail.
export async function loadBase({ df, si, base, key, fromSec, nowSec, cache, cancelled = () => false, onProgress, sleep }) {
  const cached = await cache.get(key);
  if (cached && cached.from <= fromSec && cached.rows.length) {
    const last = cached.rows[cached.rows.length - 1][0];
    const tail = await pageBars(df, si, base, { fromSec: last - TAIL_DAYS * 86400, toSec: nowSec + 60, cancelled, sleep });
    if (tail === null) return null;
    if (overlapAgrees(cached.rows, tail)) {
      const rows = mergeRows(cached.rows, tail);
      await cache.put(key, { from: cached.from, rows });
      return rows.filter((r) => r[0] >= fromSec);
    }
  }
  const rows = await pageBars(df, si, base, { fromSec, toSec: nowSec + 60, cancelled, onProgress, sleep });
  if (rows === null) return null;
  await cache.put(key, { from: fromSec, rows });
  return rows;
}

// The newest bars only, folded into `rows` (the live refresh on a bar close and for the panel).
export async function refreshTail({ df, si, base, key, rows, nowSec, cache, sleep }) {
  if (!rows.length) return rows;
  const last = rows[rows.length - 1][0];
  const tail = await pageBars(df, si, base, { fromSec: last - 86400, toSec: nowSec + 60, sleep });
  if (!tail || !tail.length) return rows;
  const merged = mergeRows(rows, tail);
  const cached = await cache.get(key);
  if (cached) await cache.put(key, { from: cached.from, rows: mergeRows(cached.rows, tail) });
  return merged;
}
