// ThndrX overlay entry point: watches for the chart iframe, loads the bars, builds the render plan, paints it and shows
// the panel; reloads on symbol / interval change and on a new chart iframe, recomputes on live bar changes and on save.
import { buildRenderPlan, applyPineCaps } from './render-plan.mjs';
import { Painter } from './painter.mjs';
import { loadValues, saveValues } from './inputs.mjs';
import {
  probeChart, loadAllBars, readTail, mergeTail, chartInfo, isLastBarOpen, planWindow, subscribe, makePort,
} from './chart-port.mjs';
import { renderPanel, mountButton, hasButton, openSettings, placeUi, unmountUi } from './ui.mjs';

const WATCH_MS = 2000;          // chart iframe watch (ThndrX workspaces can drop and recreate the chart widget)
const MIN_RECOMPUTE_MS = 2000;  // live updates recompute at most this often
const RELOAD_DEBOUNCE_MS = 500; // symbol and interval events can arrive together
const TAG = '[thndrx-ict]';

export function start(win = window) {
  const log = (level, ...args) => { try { win.console[level](TAG, ...args); } catch { /* no console */ } };
  let values = loadValues(win.localStorage);
  let s = null; // the attached chart session

  function attach(found) {
    const port = makePort(found.chart);
    const sess = {
      ...found, doc: found.iframe.contentDocument, painter: new Painter(port),
      gen: 0, bars: [], volumeMissing: false, info: null, ready: false, busy: false, dirty: false, lastCompute: 0,
      reloadTimer: null, loading: null,
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

  // Settings save = store, re-read (so the values are the validated ones) and recompute on the bars already loaded.
  function mountSettings(sess) {
    mountButton(sess.doc, () => openSettings(sess.doc, values, (next) => {
      saveValues(win.localStorage, next);
      values = loadValues(win.localStorage);
      recompute(sess).catch((err) => log('error', 'recompute after save failed', err));
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

  // Drop our drawings, pull the whole history, then paint from scratch.
  async function load(sess, gen) {
    const current = () => gen === sess.gen && s === sess;
    try {
      await sess.painter.clear();
      const info = chartInfo(sess.chart);
      const { bars, complete, volumeMissing } = await loadAllBars(sess.chart, {
        sleep: (ms) => new Promise((resolve) => win.setTimeout(resolve, ms)),
        cancelled: () => !current(),
      });
      if (!current()) return;
      const now = chartInfo(sess.chart);
      if (now.symbol !== info.symbol || now.resolution !== info.resolution) { scheduleReload(sess); return; } // changed while loading
      if (!complete) log('warn', `history did not settle; running on ${bars.length} bars`);
      Object.assign(sess, { bars, volumeMissing, info: now, ready: true, dirty: false });
      await recompute(sess);
    } catch (err) {
      log('error', 'reload failed', err);
    }
  }

  async function recompute(sess) {
    if (!sess.ready || s !== sess) return;
    const gen = sess.gen;
    sess.lastCompute = Date.now();
    const nowSec = Date.now() / 1000;
    const { bars, note } = planWindow(sess.bars, nowSec); // newest 20000 bars (R20); the tail poll keeps them all
    const ctx = {
      ...sess.info,
      lastBarOpen: isLastBarOpen(bars, sess.info.resolution, nowSec),
      historyNote: note,
      volumeMissing: sess.volumeMissing,
    };
    const plan = buildRenderPlan(bars, values, ctx);
    if (gen !== sess.gen || s !== sess) return;
    renderPanel(sess.doc, plan.panel);
    const result = await sess.painter.apply(applyPineCaps(plan), sess.painter.begin());
    if (result !== 'stale' && result.failed) log('warn', `${result.failed} drawings failed`);
  }

  // Live poll: read the bars from the last known one on; recompute when they changed, at most every 2 s.
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
      if (merged.changed) { sess.bars = merged.bars; sess.dirty = true; }
      if (sess.dirty && Date.now() - sess.lastCompute >= MIN_RECOMPUTE_MS) {
        sess.dirty = false;
        await recompute(sess);
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
