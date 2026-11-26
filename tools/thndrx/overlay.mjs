// The overlay loop both ThndrX userscripts run (ICT in main.mjs, Session Order Flow in sof-main.mjs): watches for the
// chart iframe, loads the bars, builds the app's render plan, paints it and shows the panel; reloads on symbol /
// interval change and on a new chart iframe.
//
// Ruling R25 (any change to an existing drawing makes Thndr re-save the user's own drawings): the chart drawings are
// computed from CLOSED bars only and repainted only on load, on settings save and when a bar closes, at most once per
// REPAINT_MIN_MS. Ticks only refresh the HTML panel, which is computed with the forming bar, as Pine shows it.
//
// app = {
//   tag: '[thndrx-ict]',                     console prefix
//   ui: createUi(...)                        renderPanel / mountButton / hasButton / openSettings / placeUi / unmountUi
//   loadValues(storage), saveValues(storage, values), messagePanel(values, text)
//   buildPlan(bars, values, ctx) -> plan     ctx: chartInfo + lastBarOpen, historyNote, volumeMissing, extra
//   finishPlan?(plan) -> plan                caps applied to the drawn plan (ICT: applyPineCaps)
//   prepare?(sess, h) -> Promise<extra>      after the bars load, before the first paint (SOF: the intrabars);
//                                            h = { cancelled(), status(text), now(), win, log }
//   refresh?(sess, h, reason) -> Promise     before a repaint ('paint') or a panel refresh ('panel'): top up extra
//   onSaved?(sess, h, prev, next) -> Promise after a settings save, before the repaint (SOF: re-prepare when needed)
// }
import { Painter } from './painter.mjs';
import {
  probeChart, loadAllBars, readTail, mergeTail, chartInfo, isLastBarOpen, planWindow, windowStart, closedBars, subscribe, makePort,
  priceRange, withHistoryLock,
} from './chart-port.mjs';

const WATCH_MS = 2000;          // chart iframe watch (ThndrX workspaces can drop and recreate the chart widget)
const MIN_PANEL_MS = 2000;      // live updates recompute the panel at most this often
const REPAINT_MIN_MS = 60000;   // a closed bar repaints the drawings at most this often (R25)
const RELOAD_DEBOUNCE_MS = 500; // symbol and interval events can arrive together
const LOADING_TEXT = 'Loading…', TIMEOUT_TEXT = 'History load timed out';
export const INCOMPLETE_NOTE = 'History incomplete: the chart stopped loading';

// Time of the newest closed bar (undefined when none): what a paint draws up to.
function lastClosedTime(bars, resolution, nowSec) {
  const closed = isLastBarOpen(bars, resolution, nowSec) ? bars.length - 2 : bars.length - 1;
  return closed >= 0 ? bars[closed].time : undefined;
}

// opts.now: the wall clock in ms (tests set it); opts.onPaint(result): called after every finished paint.
export function startOverlay(app, win = window, { now = () => Date.now(), onPaint = () => {} } = {}) {
  const log = (level, ...args) => { try { win.console[level](app.tag, ...args); } catch { /* no console */ } };
  const { ui } = app;
  let values = app.loadValues(win.localStorage);
  let s = null; // the attached chart session

  const helpers = (sess, current) => ({
    cancelled: () => !current(),
    status: (text) => { if (current()) ui.renderPanel(sess.doc, app.messagePanel(values, text)); },
    now: () => now() / 1000,
    values: () => values,
    win, log,
  });

  function attach(found) {
    const port = makePort(found.chart);
    const sess = {
      ...found, doc: found.iframe.contentDocument, painter: new Painter(port),
      gen: 0, bars: [], volumeMissing: false, info: null, ready: false, busy: false, reloadTimer: null, loading: null,
      start: -Infinity, bandSpan: null, loadNote: null, extra: null, // fixed per load: plan window start (I1), band price span, history note
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

  // Settings save = store, re-read (so the values are the validated ones), let the app react, repaint on the bars
  // already loaded.
  function mountSettings(sess) {
    ui.mountButton(sess.doc, () => ui.openSettings(sess.doc, values, async (next) => {
      const prev = values;
      app.saveValues(win.localStorage, next);
      values = app.loadValues(win.localStorage);
      try {
        const gen = sess.gen;
        if (app.onSaved && sess.ready) await app.onSaved(sess, helpers(sess, () => gen === sess.gen && s === sess), prev, values);
        await paint(sess);
      } catch (err) {
        log('error', 'repaint after save failed', err);
      }
    }));
  }

  function detach() {
    const sess = s;
    s = null;
    sess.gen++;
    win.clearTimeout(sess.reloadTimer);
    try { sess.off(); } catch { /* chart gone */ }
    sess.painter.clear().catch(() => {});
    try { ui.unmountUi(sess.doc); } catch { /* document gone */ }
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
      ui.renderPanel(sess.doc, app.messagePanel(values, LOADING_TEXT));
      const info = chartInfo(sess.chart);
      const res = await withHistoryLock(sess.iframe.contentWindow, () => (current()
        ? loadAllBars(sess.chart, {
          sleep: (ms) => new Promise((resolve) => win.setTimeout(resolve, ms)),
          cancelled: () => !current(),
          now: () => now() / 1000,
          resolution: info.resolution,
          timers: win,
        })
        : { bars: [], complete: false, volumeMissing: false, cancelled: true, timedOut: false }));
      if (!current()) return;
      if (res.timedOut) {
        log('warn', 'history load timed out');
        ui.renderPanel(sess.doc, app.messagePanel(values, TIMEOUT_TEXT));
        return;
      }
      const cur = chartInfo(sess.chart);
      if (cur.symbol !== info.symbol || cur.resolution !== info.resolution) { scheduleReload(sess); return; } // changed while loading
      if (!res.complete) log('warn', `history did not settle; running on ${res.bars.length} bars`);
      const startTime = windowStart(res.bars);
      Object.assign(sess, {
        bars: res.bars, volumeMissing: res.volumeMissing, info: cur,
        start: startTime, bandSpan: priceRange(planWindow(res.bars, now() / 1000, startTime).bars),
        loadNote: res.complete ? null : INCOMPLETE_NOTE, extra: null,
      });
      if (app.prepare) {
        const extra = await app.prepare(sess, helpers(sess, current));
        if (!current()) return;
        sess.extra = extra;
      }
      sess.ready = true;
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
      extra: sess.extra,
    };
  }

  // The panel plan: on every bar of the window, the forming one included.
  function panelPlan(sess, nowSec) {
    const { bars, note } = planWindow(sess.bars, nowSec, sess.start);
    sess.lastPanel = now();
    sess.panelDirty = false;
    return { bars, note, plan: app.buildPlan(bars, values, planCtx(sess, bars, nowSec, note)) };
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
    const drawn = closed === bars ? shown : app.buildPlan(closed, values, planCtx(sess, closed, nowSec, note));
    if (gen !== sess.gen || s !== sess) return;
    ui.renderPanel(sess.doc, shown.panel);
    const capped = app.finishPlan ? app.finishPlan(drawn) : drawn;
    const plan = { ...capped, meta: { ...capped.meta, ...sess.bandSpan } };
    const result = await sess.painter.apply(plan, sess.painter.begin());
    if (result === 'stale') return;
    if (result.failed) log('warn', `${result.failed} drawings failed`);
    onPaint(result);
  }

  async function refreshPanel(sess) {
    const gen = sess.gen;
    const { plan } = panelPlan(sess, now() / 1000);
    if (gen === sess.gen && s === sess && sess.ready) ui.renderPanel(sess.doc, plan.panel);
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
      const current = () => gen === sess.gen && s === sess && sess.ready;
      const { bars: tail } = await readTail(sess.chart, sess.bars[sess.bars.length - 1].time);
      if (!current()) return;
      const merged = mergeTail(sess.bars, tail);
      if (merged.changed) { sess.bars = merged.bars; sess.panelDirty = true; }
      const t = now();
      if (lastClosedTime(sess.bars, sess.info.resolution, t / 1000) !== sess.paintedTime) sess.paintWanted = true;
      if (sess.paintWanted && t - sess.lastPaint >= REPAINT_MIN_MS) {
        if (app.refresh) await app.refresh(sess, helpers(sess, current), 'paint');
        if (current()) await paint(sess);
      } else if ((sess.panelDirty || sess.paintWanted) && t - sess.lastPanel >= MIN_PANEL_MS) {
        if (app.refresh) await app.refresh(sess, helpers(sess, current), 'panel');
        if (current()) await refreshPanel(sess);
      }
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
      if (s && !ui.hasButton(s.doc)) mountSettings(s); // the chart rebuilt its layout and dropped the button
      if (s) ui.placeUi(s.doc);
    } catch (err) {
      log('error', 'watch failed', err);
    }
  }

  watch();
  const timer = win.setInterval(watch, WATCH_MS);
  return () => { win.clearInterval(timer); if (s) detach(); };
}
