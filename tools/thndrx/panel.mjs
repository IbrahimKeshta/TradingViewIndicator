// Info panel rows for the ThndrX overlay: the Pine table (src/ict-rsi-ma-indicator.pine lines 1909-2091) as plain data.
// Row order, texts and colours follow Pine; the line numbers below point at it. No DOM here: the painter draws the rows.
import { PINE_COLORS, colorNew } from './colors.mjs';
import { fmtNum, fmtPrice } from './format.mjs';

const C = PINE_COLORS;
const HEADER_BG = colorNew(C.gray, 50); // color.new(color.gray, 50)
const POSITIONS = { 'Top Right': 'top_right', 'Top Left': 'top_left', 'Bottom Right': 'bottom_right' }; // anything else: bottom_left (2006-2010)

const cell = (text, color, bg) => (bg ? { text, color, bg } : { text, color });
const row = (label, text, color) => ({ cells: [cell(label, C.silver), cell(text, color)] });
const headerRow = (left, right, rightColor) => ({ cells: [cell(left, C.white, HEADER_BG), cell(right, rightColor, HEADER_BG)] });

// "+0.34R" / "-1.20R" (1911-1912)
const rText = (v) => (v >= 0 ? '+' : '') + fmtNum(v, '0.00') + 'R';
const signColor = (v) => (v >= 0 ? C.lime : C.red);

// Pine openRof (1726-1732): open R against the last close, always on the initial stop.
function openRof(t, lastClose) {
  const r = Math.abs(t.entry - t.initialStop);
  if (!(r > 0)) return NaN;
  return (t.side === 'long' ? lastClose - t.entry : t.entry - lastClose) / r;
}

// Six rows for one live trade (1919-1946).
function tradeBlock(t, openR, tag, structAtr, mintick, display) {
  const isLong = t.side === 'long';
  const rT = Math.abs(t.entry - t.initialStop);
  const rTxt = rT > 0 ? fmtNum(openR, '0.00') + 'R' : '—';
  const beMark = (isLong ? t.stop >= t.entry : t.stop <= t.entry) ? ' · BE+' : '';
  const sideTxt = (isLong ? 'LONG' : 'SHORT') + (t.runner ? ' · RUN' : '');
  const atrTxt = Number.isFinite(structAtr) && structAtr > 0 ? '  ·  ' + fmtNum(rT / structAtr, '0.0') + 'x ATR' : '';
  const rMult = (price) => ' (' + fmtNum(rT > 0 ? Math.abs(price - t.entry) / rT : 0, '0.0') + 'R)';
  const tick = (n) => (t.tpHit >= n ? ' ✓' : '');
  return [
    {
      cells: [
        cell(tag + 'TRADE', C.white, HEADER_BG),
        cell(sideTxt + ' · ' + t.grade + ' · ' + t.score + '/' + t.scoreOf, isLong ? display.tradeLongColor : display.tradeShortColor, HEADER_BG),
      ],
    },
    row('Entry', fmtPrice(t.entry, mintick) + atrTxt, C.white),
    row('Stop', fmtPrice(t.stop, mintick) + beMark + ' · ' + fmtNum(rT > 0 ? Math.abs(t.entry - t.stop) / rT : 0, '0.0') + 'R', display.tradeStopColor),
    row('TP1 / TP2', fmtPrice(t.tp1, mintick) + tick(1) + rMult(t.tp1) + '  ' + fmtPrice(t.tp2, mintick) + tick(2) + rMult(t.tp2), display.tradeTargetColor),
    row('TP3', fmtPrice(t.tp3, mintick) + tick(3) + rMult(t.tp3), display.tradeTargetColor),
    row('Open R', rTxt, openR >= 0 ? C.lime : C.red),
  ];
}

// Per-model counters from the engine's trade records, as the Pine stat arrays hold them (1531-1555).
function modelStats(trades, model) {
  const s = { n: 0, sumR: 0, wins: 0, losses: 0, grade: { A: { n: 0, sum: 0 }, B: { n: 0, sum: 0 }, C: { n: 0, sum: 0 } }, points: Array.from({ length: 7 }, () => ({ t: 0, tSum: 0, f: 0, fSum: 0 })) };
  for (const t of trades) {
    if (t.model !== model) continue;
    s.n++; s.sumR += t.r;
    if (t.r > 0) s.wins++; else if (t.r < 0) s.losses++;
    const g = s.grade[t.grade];
    g.n++; g.sum += t.r;
    [t.kz, t.mom, t.ma, t.maj, t.brk, t.part, t.ichi].forEach((flag, i) => {
      const p = s.points[i];
      if (flag) { p.t++; p.tSum += t.r; } else { p.f++; p.fSum += t.r; }
    });
  }
  return s;
}

// 7 rows once the model has a closed trade, 2 before that (1951-1980).
function statsBlock(s, title) {
  const rows = [headerRow(title, 'n = ' + s.n, C.silver)];
  if (s.n === 0) { rows.push(row('No closed trades', '—', C.gray)); return rows; }
  const avgR = s.sumR / s.n;
  rows.push(
    row('Win rate', fmtNum(100 * s.wins / s.n, '0') + '%  (' + s.wins + 'W / ' + s.losses + 'L)', C.white),
    row('Avg R', rText(avgR), signColor(avgR)),
    row('Total R', rText(s.sumR), signColor(s.sumR)),
  );
  for (const name of ['A', 'B', 'C']) {
    const g = s.grade[name], avg = g.n > 0 ? g.sum / g.n : 0;
    rows.push(row(name + ' grade', g.n > 0 ? rText(avg) + '  (' + g.n + ')' : '—  (0)', g.n === 0 ? C.gray : signColor(avg)));
  }
  return rows;
}

const POINT_NAMES = ['Killzone', 'Momentum', 'MA', 'Major Agree', 'Break Strength', 'Participation', 'Ichimoku'];

// Header plus 7 point rows (1985-2001).
function pointBlock(s, title) {
  const half = (count, sum) => (count > 0 ? rText(sum / count) + ' (' + count + ')' : '— (0)');
  return [
    headerRow(title, 'true / false', C.silver),
    ...s.points.map((p, i) => row(POINT_NAMES[i], half(p.t, p.tSum) + ' / ' + half(p.f, p.fSum), C.white)),
  ];
}

// extra: { lastClose, warnings } come from the bars and from buildRenderPlan, which the engine result does not carry.
export function buildPanel(res, resolved, ctx, { lastClose = NaN, warnings = [] } = {}) {
  const { engineCfg, display, presetTag } = resolved;
  if (!display.showStructurePanel) return null;
  const { majorSt, intSt, inRange, gate, pbTrade, trTrade } = res.final;
  const trail = engineCfg.useTrailModel;

  // Last event: the internal tier when it broke after the major one (2011-2015); lastBar -1 means never.
  const useInt = intSt.lastBar >= 0 && (majorSt.lastBar < 0 || intSt.lastBar > majorSt.lastBar);
  const evt = useInt ? intSt : majorSt;
  const evtText = evt.lastType == null ? '—' : evt.lastType + ' · ' + (useInt ? 'INTERNAL' : 'MAJOR') + ' · ' + fmtNum(evt.lastStrength, '0.0') + 'x';
  const trendText = majorSt.trend == null ? '—' : majorSt.trend.toUpperCase();
  const trendCol = majorSt.trend === 'up' ? C.lime : majorSt.trend === 'down' ? C.red : C.gray;
  const internalText = majorSt.trend == null || intSt.trend == null ? '—' : intSt.trend === majorSt.trend ? 'aligned' : 'pullback';

  const rows = [
    headerRow('STRUCTURE', '', C.white),
    row('Major trend', trendText, trendCol),
    row('Range', inRange ? 'YES' : 'no', inRange ? C.orange : C.gray),
    row('Last event', evtText, C.white),
    row('Internal', internalText, C.aqua),
  ];
  if (display.showConfirmPanel && gate) rows.push(row('Confirm', `Mom ${gate.marks.mom} · Part ${gate.marks.part} · Ichi ${gate.marks.ichi}`, C.white));
  if (display.showGatePanel && gate) {
    const reason = gate.reason === 'READY' && ctx.lastBarOpen ? 'bar not closed' : gate.reason;
    const trailMark = trail ? ' · T:' + (res.series.trailDir[res.series.trailDir.length - 1] === 1 ? 'L' : 'S') : '';
    rows.push(row('Gate', (gate.long ? 'L' : 'S') + ' · ' + reason + ' · ' + gate.score + '/' + gate.of + trailMark, reason === 'READY' ? C.lime : reason === 'score short' ? C.orange : C.gray));
  }

  const structAtr = res.series.structAtr[res.series.structAtr.length - 1];
  if (display.showTradePanel) {
    if (pbTrade) rows.push(...tradeBlock(pbTrade, openRof(pbTrade, lastClose), '', structAtr, ctx.mintick, display));
    if (trTrade) rows.push(...tradeBlock(trTrade, openRof(trTrade, lastClose), 'TRAIL ', structAtr, ctx.mintick, display));
  }

  const pb = modelStats(res.trades, 'PB'), tr = modelStats(res.trades, 'TR');
  if (display.showStatsPanel) {
    rows.push(...statsBlock(pb, (trail ? 'PERFORMANCE · PULLBACK' : 'PERFORMANCE') + presetTag));
    if (trail) rows.push(...statsBlock(tr, 'PERFORMANCE · TRAIL' + presetTag));
  }
  if (display.showPointStats) {
    if (pb.n > 0) rows.push(...pointBlock(pb, trail ? 'POINTS · PULLBACK' : 'POINTS'));
    if (trail && tr.n > 0) rows.push(...pointBlock(tr, 'POINTS · TRAIL'));
  }

  if (warnings.length > 0) rows.push(row('Data', warnings.join(' · '), C.orange));
  return { position: POSITIONS[display.panelPos] ?? 'bottom_left', bg: display.panelBg, rows };
}

// A one-row panel for a status message ('Loading…', 'History load timed out'), placed like the full panel. `values`
// are the raw inputs (no engine run behind a message); hidden, like the full panel, when Show Structure Panel is off.
export function messagePanel(values, text) {
  if (!values.showStructurePanel) return null;
  return { position: POSITIONS[values.panelPosInput] ?? 'bottom_left', bg: values.panelBgColor, rows: [{ cells: [cell(text, C.white, HEADER_BG)] }] };
}
