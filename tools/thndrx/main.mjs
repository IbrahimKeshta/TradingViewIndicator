// ThndrX overlay entry point: watches for the chart iframe, loads the bars, builds the render plan, paints it and shows
// the panel; reloads on symbol / interval change and on a new chart iframe.
//
// Ruling R25 (any change to an existing drawing makes Thndr re-save the user's own drawings): the chart drawings are
// computed from CLOSED bars only and repainted only on load, on settings save and when a bar closes, at most once per
// REPAINT_MIN_MS. Ticks only refresh the HTML panel, which is computed with the forming bar, as Pine shows it.
import { buildRenderPlan, applyPineCaps, priceRange } from './render-plan.mjs';
import { Painter } from './painter.mjs';
import { loadValues, saveValues } from './inputs.mjs';
import {
  probeChart, loadAllBars, readTail, mergeTail, chartInfo, isLastBarOpen, planWindow, windowStart, closedBars, subscribe, makePort,
} from './chart-port.mjs';
import { messagePanel } from './panel.mjs';
import { renderPanel, mountButton, hasButton, openSettings, placeUi, unmountUi } from './ui.mjs';

const WATCH_MS = 2000;          // chart iframe watch (ThndrX workspaces can drop and recreate the chart widget)
const MIN_PANEL_MS = 2000;      // live updates recompute the panel at most this often
const REPAINT_MIN_MS = 60000;   // a closed bar repaints the drawings at most this often (R25)
const RELOAD_DEBOUNCE_MS = 500; // symbol and interval events can arrive together
const TAG = '[thndrx-ict]';
const LOADING_TEXT = 'Loading…', TIMEOUT_TEXT = 'History load timed out';
export const INCOMPLETE_NOTE = 'History incomplete: the chart stopped loading';

// Time of the newest closed bar (undefined when none): what a paint draws up to.
function lastClosedTime(bars, resolution, nowSec) {
  const closed = isLastBarOpen(bars, resolution, nowSec) ? bars.length - 2 : bars.length - 1;
  return closed >= 0 ? bars[closed].time : undefined;
}

// opts.now: the wall clock in ms (tests set it); opts.onPaint(result): called after every finished paint.
export function start(win = window, { now = () => Date.now(), onPaint = () => {} } = {}) {
  const log = (level, ...args) => { try { win.console[level](TAG, ...args); } catch { /* no console */ } };
  let values = loadValues(win.localStorage);
  let s = null; // the attached chart session

  function attach(found) {
    const port = makePort(found.chart);
    const sess = {
      ...found, doc: found.iframe.contentDocument, painter: new Painter(port),
      gen: 0, bars: [], volumeMissing: false, info: null, ready: false, busy: false, reloadTimer: null, loading: null,
      start: -Infinity, bandSpan: null, loadNote: null, // fixed per load: plan window start (I1), band price span, history note
      paintedTime: undefined, lastPaint: -Infinity, paintWanted: false, lastPanel: -Infinity, panelDirty: false,
    };
    s = sess;
    mountSettings(sess);
    sess.off = subscribe(found.chart, { onReload: () => scheduleReload(sess), onTick: () => tick(sess) }, win);
    reload(sess);
  }

  // Every reload trigger after attach goes through here: symbol and interval events can arrive together.
  function scheduleReload(sess) {
    win.clearTimeout(sess.reloadTimer);
    sess.reloadTimer = win.setTimeout(() => reload(sess), RELOAD_DEBOUNCE_MS);
  }

  // Settings save = store, re-read (so the values are the validated ones) and repaint on the bars already loaded.
  function mountSettings(sess) {
    mountButton(sess.doc, () => openSettings(sess.doc, values, (next) => {
      saveValues(win.localStorage, next);
      values = loadValues(win.localStorage);
      paint(sess).catch((err) => log('error', 'repaint after save failed', err));
    }));
  }

  function detach() {
    const sess = s;
    s = null;
    sess.gen++;
    win.clearTimeout(sess.reloadTimer);
    try { sess.off(); } catch { /* chart gone */ }
    sess.painter.clear().catch(() => {});
    try { unmountUi(sess.doc); } catch { /* document gone */ }
  }

  // Full reload, one history load per session at a time: the new generation cancels the running load, which leaves
  // through its view restore; only then does the next load read the user's view. Older waiting reloads drop out.
  // A load that hangs ends after loadAllBars' timeout, so it cannot block later reloads for longer than that.
  async function reload(sess) {
    const gen = ++sess.gen;
    sess.ready = false;
    if (sess.loading) await sess.loading; // never rejects: load() logs its own errors
    if (gen !== sess.gen || s !== sess) return;
    const run = load(sess, gen);
    sess.loading = run;
    await run;
    if (sess.loading === run) sess.loading = null;
  }

  // Drop our drawings, show 'Loading…' (never the old symbol's rows), pull the history, then paint from scratch.
  async function load(sess, gen) {
    const current = () => gen === sess.gen && s === sess;
    try {
      await sess.painter.clear();
      renderPanel(sess.doc, messagePanel(values, LOADING_TEXT));
      const info = chartInfo(sess.chart);
      const res = await loadAllBars(sess.chart, {
        sleep: (ms) => new Promise((resolve) => win.setTimeout(resolve, ms)),
        cancelled: () => !current(),
        now: () => now() / 1000,
        resolution: info.resolution,
        timers: win,
      });
      if (!current()) return;
      if (res.timedOut) {
        log('warn', 'history load timed out');
        renderPanel(sess.doc, messagePanel(values, TIMEOUT_TEXT));
        return;
      }
      const cur = chartInfo(sess.chart);
      if (cur.symbol !== info.symbol || cur.resolution !== info.resolution) { scheduleReload(sess); return; } // changed while loading
      if (!res.complete) log('warn', `history did not settle; running on ${res.bars.length} bars`);
      const startTime = windowStart(res.bars);
      Object.assign(sess, {
        bars: res.bars, volumeMissing: res.volumeMissing, info: cur, ready: true,
        start: startTime, bandSpan: priceRange(planWindow(res.bars, now() / 1000, startTime).bars),
        loadNote: res.complete ? null : INCOMPLETE_NOTE,
      });
      await paint(sess);
    } catch (err) {
      log('error', 'reload failed', err);
    }
  }

  function planCtx(sess, bars, nowSec, windowNote) {
    return {
      ...sess.info,
      lastBarOpen: isLastBarOpen(bars, sess.info.resolution, nowSec),
      historyNote: [windowNote, sess.loadNote].filter(Boolean).join(' · ') || null,
      volumeMissing: sess.volumeMissing,
    };
  }

  // The panel plan: on every bar of the window, the forming one included.
  function panelPlan(sess, nowSec) {
    const { bars, note } = planWindow(sess.bars, nowSec, sess.start);
    sess.lastPanel = now();
    sess.panelDirty = false;
    return { bars, note, plan: buildRenderPlan(bars, values, planCtx(sess, bars, nowSec, note)) };
  }

  // Drawings from the closed bars, with the band span fixed at load; the panel with the forming bar.
  async function paint(sess) {
    if (!sess.ready || s !== sess) return;
    const gen = sess.gen, nowSec = now() / 1000;
    sess.paintWanted = false;
    sess.lastPaint = now();
    sess.paintedTime = lastClosedTime(sess.bars, sess.info.resolution, nowSec);
    const { bars, note, plan: shown } = panelPlan(sess, nowSec);
    const closed = closedBars(bars, sess.info.resolution, nowSec);
    const drawn = closed === bars ? shown : buildRenderPlan(closed, values, planCtx(sess, closed, nowSec, note));
    if (gen !== sess.gen || s !== sess) return;
    renderPanel(sess.doc, shown.panel);
    const plan = applyPineCaps({ ...drawn, meta: { ...drawn.meta, ...sess.bandSpan } });
    const result = await sess.painter.apply(plan, sess.painter.begin());
    if (result === 'stale') return;
    if (result.failed) log('warn', `${result.failed} drawings failed`);
    onPaint(result);
  }

  async function refreshPanel(sess) {
    const gen = sess.gen;
    const { plan } = panelPlan(sess, now() / 1000);
    if (gen === sess.gen && s === sess && sess.ready) renderPanel(sess.doc, plan.panel);
  }

  // Live poll (every 2 s): read the bars from the last known one on. A newly closed bar repaints the drawings, at
  // most once per REPAINT_MIN_MS; one that closes inside that wait is painted by the first poll after it. Anything
  // else (the forming bar moving) only refreshes the panel, at most every 2 s.
  async function tick(sess) {
    if (!sess.ready || sess.busy || s !== sess) return;
    sess.busy = true;
    try {
      const info = chartInfo(sess.chart);
      if (info.symbol !== sess.info.symbol || info.resolution !== sess.info.resolution) { scheduleReload(sess); return; } // a missed event
      if (!sess.bars.length) { // the load found nothing: reload once the chart has bars
        if ((await readTail(sess.chart)).bars.length) scheduleReload(sess);
        return;
      }
      const gen = sess.gen;
      const { bars: tail } = await readTail(sess.chart, sess.bars[sess.bars.length - 1].time);
      if (gen !== sess.gen || !sess.ready) return;
      const merged = mergeTail(sess.bars, tail);
      if (merged.changed) { sess.bars = merged.bars; sess.panelDirty = true; }
      const t = now();
      if (lastClosedTime(sess.bars, sess.info.resolution, t / 1000) !== sess.paintedTime) sess.paintWanted = true;
      if (sess.paintWanted && t - sess.lastPaint >= REPAINT_MIN_MS) await paint(sess);
      else if ((sess.panelDirty || sess.paintWanted) && t - sess.lastPanel >= MIN_PANEL_MS) await refreshPanel(sess);
    } catch (err) {
      log('error', 'live update failed', err);
    } finally {
      sess.busy = false;
    }
  }

  function watch() {
    try {
      const found = probeChart(win);
      if (s && (!found || found.iframe !== s.iframe || found.api !== s.api || !s.iframe.isConnected)) detach();
      if (!s && found) attach(found);
      if (s && !hasButton(s.doc)) mountSettings(s); // the chart rebuilt its layout and dropped the button
      if (s) placeUi(s.doc);
    } catch (err) {
      log('error', 'watch failed', err);
    }
  }

  watch();
  const timer = win.setInterval(watch, WATCH_MS);
  return () => { win.clearInterval(timer); if (s) detach(); };
}
