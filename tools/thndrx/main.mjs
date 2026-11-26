// ThndrX ICT overlay entry point: the ICT app (render plan, inputs, panel, UI) run by the shared overlay loop
// (overlay.mjs, which holds the chart watch, history load, closed-bar repaint rules and live panel refresh).
import { startOverlay, INCOMPLETE_NOTE as NOTE } from './overlay.mjs';
import { buildRenderPlan, applyPineCaps } from './render-plan.mjs';
import { loadValues, saveValues } from './inputs.mjs';
import { messagePanel } from './panel.mjs';
import { ictUi } from './ict-ui.mjs';

export const INCOMPLETE_NOTE = NOTE;

export const ICT_APP = Object.freeze({
  tag: '[thndrx-ict]',
  ui: ictUi,
  loadValues,
  saveValues,
  messagePanel,
  buildPlan: buildRenderPlan,
  finishPlan: applyPineCaps,
});

// opts.now: the wall clock in ms (tests set it); opts.onPaint(result): called after every finished paint.
export function start(win = window, opts = {}) {
  return startOverlay(ICT_APP, win, opts);
}
