// ThndrX Session Order Flow overlay entry point: the SOF app run by the shared overlay loop (overlay.mjs). Its extra
// step is the intrabars: after the chart's bars load, prepare() reads the lower-timeframe bars Pine's
// request.security_lower_tf would use from Thndr's own datafeed (sof-ltf.mjs); refresh() tops them up when a bar closes
// and, for the live dashboard, at most once a minute. Without the datafeed the engine runs on the chart bars' own
// direction (Pine's fallback) and the dashboard's Data row says so.
import { startOverlay } from './overlay.mjs';
import { createUi } from './ui.mjs';
import { SOF_INPUTS, sofDefaults, sofIsValid, loadSofValues, saveSofValues } from './sof-inputs.mjs';
import { sofMessagePanel } from './sof-panel.mjs';
import { buildSofPlan, symbolMeta } from './sof-plan.mjs';
import { ltfFor, baseFor, aggregate, findDatafeed, resolveSymbol, loadBase, refreshTail, createLtfCache } from './sof-ltf.mjs';

const PANEL_TAIL_SEC = 60; // the live dashboard tops the intrabars up at most this often (seconds of the loop's clock)

export const sofUi = createUi({
  prefix: 'thndrx-sof', buttonText: 'SOF', buttonTitle: 'Session Order Flow settings', title: 'Session Order Flow · Settings',
  inputs: SOF_INPUTS, defaults: sofDefaults, isValid: sofIsValid, slot: 1,
});

const nearestText = (e) => (e && e.message ? e.message : String(e));

// The intrabars for the session's chart window: { meta, ltfRows, base, ltfMin, baseRows, df, si, key, tailAt, note }.
export async function prepareLtf(sess, h, cache) {
  const values = h.values();
  const df = findDatafeed(sess.iframe.contentWindow);
  if (!df) return { meta: symbolMeta(null), note: 'Intrabars unavailable on this ThndrX build: chart bars used' };
  let si;
  try { si = await resolveSymbol(df, sess.chart.symbol()); } catch (e) {
    return { meta: symbolMeta(null), note: 'Intrabars unavailable (' + nearestText(e) + '): chart bars used' };
  }
  const meta = symbolMeta(si);
  const ltfMin = ltfFor(sess.info.resolution, values.deltaTfInput);
  if (ltfMin == null || !sess.bars.length) return { meta, df, si };
  const base = baseFor(ltfMin), key = (si.ticker || sess.chart.symbol()) + '|' + base;
  const fromSec = Number.isFinite(sess.start) ? sess.start : sess.bars[0].time;
  try {
    const baseRows = await loadBase({
      df, si, base, key, fromSec, nowSec: h.now(), cache, cancelled: h.cancelled,
      onProgress: (p) => h.status(`Loading ${ltfMin}m intrabars… ${Math.round(p * 100)}%`),
    });
    if (baseRows === null) return null; // cancelled: a newer load owns the session
    return { meta, df, si, base, key, ltfMin, baseRows, ltfRows: aggregate(baseRows, ltfMin, meta), tailAt: h.now() };
  } catch (e) {
    h.log('warn', 'intrabar load failed', e);
    return { meta, df, si, note: 'Intrabars unavailable (' + nearestText(e) + '): chart bars used' };
  }
}

export async function refreshLtf(sess, h, reason, cache) {
  const x = sess.extra;
  if (!x || !x.baseRows) return;
  if (reason !== 'paint' && h.now() - x.tailAt < PANEL_TAIL_SEC) return;
  x.tailAt = h.now();
  try {
    const baseRows = await refreshTail({ df: x.df, si: x.si, base: x.base, key: x.key, rows: x.baseRows, nowSec: h.now(), cache });
    if (h.cancelled() || sess.extra !== x || baseRows === x.baseRows) return;
    sess.extra = { ...x, baseRows, ltfRows: aggregate(baseRows, x.ltfMin, x.meta) };
  } catch (e) {
    h.log('warn', 'intrabar refresh failed', e);
  }
}

export function makeSofApp(cache) {
  return Object.freeze({
    tag: '[thndrx-sof]',
    ui: sofUi,
    loadValues: loadSofValues,
    saveValues: saveSofValues,
    messagePanel: sofMessagePanel,
    buildPlan: buildSofPlan,
    prepare: (sess, h) => prepareLtf(sess, h, cache),
    refresh: (sess, h, reason) => refreshLtf(sess, h, reason, cache),
    // A different lower timeframe needs other intrabars; everything else is a repaint on what is loaded.
    onSaved: async (sess, h, prev, next) => {
      if (prev.deltaTfInput === next.deltaTfInput) return;
      const extra = await prepareLtf(sess, h, cache);
      if (extra && !h.cancelled()) sess.extra = extra;
    },
  });
}

// opts.now / opts.onPaint as in overlay.mjs; opts.cache replaces the browser cache (tests).
export function startSof(win = window, opts = {}) {
  const cache = opts.cache || createLtfCache({ idb: win.indexedDB || null });
  return startOverlay(makeSofApp(cache), win, opts);
}
