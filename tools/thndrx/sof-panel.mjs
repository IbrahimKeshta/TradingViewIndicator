// Session Order Flow dashboard rows: the Pine table (src/session-orderflow.pine lines 988-1087) as plain data, from
// the engine's last-bar values (runSof result.final). Texts, colours, number formats and row order follow Pine.
import { PINE_COLORS, colorNew } from './colors.mjs';
import { fmtNum, fmtPrice, fmtVolume } from './format.mjs';

const C = PINE_COLORS;
const TABLE_BG = colorNew('#0d1321', 15);           // table.new(..., bgcolor = color.new(#0d1321, 15))
const CELL_BORDER = colorNew(C.gray, 85);           // border_color = color.new(color.gray, 85)
const POSITIONS = { 'Top right': 'top_right', 'Top left': 'top_left', 'Bottom right': 'bottom_right', 'Bottom left': 'bottom_left' };
const TEXT_PX = { Tiny: 9, Small: 11, Normal: 13 }; // size.tiny / small / normal

const isNa = (v) => v == null || Number.isNaN(v);
const row = (k, v, vc) => ({ cells: [{ text: k, color: C.gray }, { text: v, color: vc }] });
const sign = (v) => (v >= 0 ? '+' : '');

// Pine poolText (346-347) with htfLabel (335).
export function htfLabel(htfSecs, htfTf) {
  return htfSecs < 3600 ? fmtNum(htfSecs / 60, '#.##') + 'm' : htfSecs < 86400 ? fmtNum(htfSecs / 3600, '#.##') + 'h' : htfTf;
}
export const poolText = (isHigh, htf, label) => (htf ? 'HTF ' : '') + (isHigh ? 'BSL' : 'SSL') + (htf ? ' [' + label + ']' : '');

const FLOW_TEXT = {
  na: 'n/a', buyAbsorbed: 'Absorption — buying absorbed', sellAbsorbed: 'Absorption — selling absorbed',
  buyDom: 'Buying dominance', sellDom: 'Selling dominance', balanced: 'Balanced',
};

// res: the runSof result (final, trades, runTrades). values: the raw inputs. ctx: { mintick, symType, warnings }.
export function sofPanel(res, values, ctx) {
  if (!values.showDashboard) return null;
  const f = res.final;
  const px = (v) => fmtPrice(v, ctx.mintick);
  const colBull = values.colBull, colBear = values.colBear, colAccum = values.colAccum;
  const biasWord = f.bias > 0 ? 'Bullish' : f.bias < 0 ? 'Bearish' : 'Neutral';
  const biasCol = f.bias > 0 ? colBull : f.bias < 0 ? colBear : C.white;
  const dirWord = f.bias > 0 ? 'Longs' : 'Shorts';
  const flowState = FLOW_TEXT[f.flow];

  let verdictText, whyText, lookText, verdictCol;
  if (f.verdict === 0) {
    verdictText = 'AVOID'; verdictCol = colBear;
    whyText = fmtNum(f.rangeUsedPct, '#') + '% of the average ' + f.anchorName + ' range is already used';
    lookText = 'Avoid chasing. This resets when a new ' + f.anchorName + ' opens.';
  } else if (f.verdict === 2) {
    verdictText = 'FAVOURABLE — ' + (f.bias > 0 ? 'long side' : 'short side'); verdictCol = biasCol;
    whyText = 'Bias and flow agree, price is inside value, range is available';
    const target = f.bias > 0 ? f.nearBsl : f.nearSsl;
    lookText = dirWord + ' favoured. ' + (isNa(target) ? 'No liquidity pool ahead.' : 'Next pool ' + px(target) + '.') + ' Bias fails ' + (f.bias > 0 ? 'below' : 'above') + ' POC ' + px(f.devPoc) + '.';
  } else {
    verdictText = 'WAIT'; verdictCol = colAccum;
    if (f.bias === 0) {
      whyText = isNa(f.devPoc) ? 'No volume profile, so no bias' : "Price is between today's POC and the prior POC";
      lookText = isNa(f.devPoc) ? 'This symbol reports no volume.' : 'Wait for price to hold above or below both POCs.';
    } else if (f.extended) {
      const counter = f.valuePos === -f.bias;
      whyText = counter ? 'Price has left the value area against the bias' : 'Price is extended beyond the value area';
      lookText = counter ? 'Wait for price to get back inside value (' + px(f.devVal) + ' – ' + px(f.devVah) + ').' : 'Wait for a pullback toward ' + (f.bias > 0 ? 'VAH ' + px(f.devVah) : 'VAL ' + px(f.devVal)) + ' or POC ' + px(f.devPoc) + '.';
    } else if (f.flowAgainst) {
      whyText = 'Order flow disagrees with the bias (' + flowState + ')';
      lookText = 'Wait for flow to turn, or for the absorption to resolve.';
    } else {
      whyText = 'Volume is thin (' + fmtNum(f.volRecent / f.volNormal * 100, '#') + '% of normal)';
      lookText = 'Wait for participation to return.';
    }
  }

  const rows = [
    row('Conditions', verdictText, verdictCol),
    row('Why', whyText, C.white),
    row('Look for', lookText, C.white),
    row('Bias', biasWord + (isNa(f.devPoc) ? '' : isNa(f.prevPoc) ? '  (vs POC ' + px(f.devPoc) + ')' : '  (POC ' + px(f.devPoc) + ', prior POC ' + px(f.prevPoc) + ')'), biasCol),
  ];

  if (values.dashDetail === 'Full') {
    rows.push(row('Range used', isNa(f.rangeUsedPct) ? 'n/a (needs more history)' : fmtNum(f.rangeUsedPct, '#') + '% of avg ' + f.anchorName + (f.rangeExhausted ? '  [EXHAUSTED]' : ''), f.rangeExhausted ? colBear : C.white));
    rows.push(row(f.refName + ' range', 'High ' + f.hiStatus + (isNa(f.refHi) ? '' : ' @ ' + px(f.refHi)) + '  ·  Low ' + f.loStatus + (isNa(f.refLo) ? '' : ' @ ' + px(f.refLo)),
      f.hiStatus === 'Swept' || f.loStatus === 'Swept' ? colAccum : C.white));
    rows.push(row('Value area', isNa(f.devPoc) ? (f.sawVolume ? 'n/a' : 'n/a (no volume on this symbol)') : (f.valuePos > 0 ? 'Above value' : f.valuePos < 0 ? 'Below value' : 'Inside value') + '  (' + px(f.devVal) + ' – ' + px(f.devVah) + ')',
      f.valuePos > 0 ? colBull : f.valuePos < 0 ? colBear : C.white));
    const bslText = isNa(f.nearBsl) ? 'BSL none above' : 'BSL ' + px(f.nearBsl) + ' (' + fmtNum((f.nearBsl - f.close) / f.atrValue, '#.#') + ' ATR)';
    const sslText = isNa(f.nearSsl) ? 'SSL none below' : 'SSL ' + px(f.nearSsl) + ' (' + fmtNum((f.close - f.nearSsl) / f.atrValue, '#.#') + ' ATR)';
    rows.push(row('Liquidity', bslText + '  ·  ' + sslText, C.white));
    const label = htfLabel(f.htfSecs, f.htfTf);
    const lastText = f.lastLiq ? poolText(f.lastLiq.isHigh, f.lastLiq.htf, label) + (f.lastLiq.accepted ? ' run' : ' swept') + ' @ ' + px(f.lastLiq.level) : 'none yet';
    rows.push(row('Last taken', lastText + (isNa(f.lastLiqBarsAgo) ? '' : '  (' + f.lastLiqBarsAgo + ' bars ago)'), C.white));
    const tickVolNote = ctx.symType === 'forex' || ctx.symType === 'cfd' ? '  (tick volume)' : '';
    const flowColor = f.flow === 'na' ? C.gray : f.flow === 'buyAbsorbed' || f.flow === 'sellAbsorbed' ? colAccum : f.flow === 'buyDom' ? colBull : f.flow === 'sellDom' ? colBear : C.white;
    rows.push(row('Flow (est.)', !f.sawVolume ? 'n/a (no volume on this symbol)' : flowState + '  ·  ' + (isNa(f.buyPct) ? '' : fmtNum(f.buyPct, '#') + '% buy  ·  ') + 'net Δ ' + sign(f.cumDelta) + fmtVolume(f.cumDelta) + tickVolNote, flowColor));
    rows.push(row('Mode', f.is24hMode ? (f.sessionsOn ? '24h sessions' : '24h, no session boxes on this timeframe') : (f.openRangeOn ? 'Single session' : 'Single session, no opening-range box on this timeframe'), C.gray));
  }

  if (values.showTrades && values.entryModel === 'Liquidity run (trend)') {
    let runText = 'No open trade  ·  waiting for a liquidity run with the trend', runCol = C.gray;
    if (f.run) {
      const openR = (f.close - f.run.entry) * f.run.dir / f.run.risk;
      runText = (f.run.dir > 0 ? 'LONG' : 'SHORT') + '  entry ' + px(f.run.entry) + '  ·  trailing stop ' + px(f.run.stop) + '  ·  open ' + sign(openR) + fmtNum(openR, '0.00') + 'R';
      runCol = f.run.dir > 0 ? colBull : colBear;
    }
    rows.push(row('Trade (run)', runText, runCol));
    const t = res.runTrades, n = t.length;
    let rec = 'No closed trades yet';
    const total = t.reduce((s, x) => s + x.r, 0);
    if (n > 0) {
      const wins = t.filter((x) => x.r > 0).length;
      const best = Math.max(...t.map((x) => x.r)), worst = Math.min(...t.map((x) => x.r));
      rec = n + ' trades  ·  avg ' + sign(total) + fmtNum(total / n, '0.00') + 'R  ·  total ' + sign(total) + fmtNum(total, '0.0') + 'R\nwin ' + fmtNum(wins * 100 / n, '0') + '%  ·  best ' + fmtNum(best, '0.0') + 'R  ·  worst ' + fmtNum(worst, '0.0') + 'R\nbefore costs, ' + fmtNum(values.runStopAtr, '0.#') + ' ATR trail, EMA ' + values.runTrendLen;
    }
    rows.push(row('Record (run)', rec, n === 0 ? C.gray : total >= 0 ? colBull : colBear));
  } else if (values.showTrades) {
    let tradeText = 'No open trade', tradeCol = C.gray;
    if (f.trade) {
      const tr = f.trade;
      tradeText = (tr.dir > 0 ? 'LONG' : 'SHORT') + '  entry ' + px(tr.entry) + '  ·  SL ' + px(tr.stop) + '  ·  TP1 ' + px(tr.tp1) + (tr.tp1Hit ? ' ✓' : '') + '  ·  TP2 ' + px(tr.tp2);
      tradeCol = tr.dir > 0 ? colBull : colBear;
    }
    rows.push(row('Trade (exp.)', tradeText, tradeCol));
    const t = res.trades, n = t.length;
    let rec = 'No closed trades yet';
    const total = t.reduce((s, x) => s + x.grossR, 0);
    if (n > 0) {
      const pct = (o) => fmtNum(t.filter((x) => x.outcome === o).length * 100 / n, '#');
      const timeouts = t.filter((x) => x.outcome === 'timeout').length;
      rec = n + ' trades  ·  avg ' + sign(total) + fmtNum(total / n, '#.##') + 'R  ·  total ' + sign(total) + fmtNum(total, '#.#') + 'R\nstopped ' + pct('stopped') + '%  ·  TP1 only ' + pct('tp1only') + '%  ·  TP2 ' + pct('tp2') + '%' + (timeouts > 0 ? '  ·  timed out ' + pct('timeout') + '%' : '') + '\nbefore costs, ' + values.tradeGate;
    }
    rows.push(row('Record (exp.)', rec, n === 0 ? C.gray : total >= 0 ? colBull : colBear));
  }

  if (ctx.warnings && ctx.warnings.length) rows.push(row('Data', ctx.warnings.join(' · '), C.orange));
  return { position: POSITIONS[values.dashPosition] ?? 'top_right', bg: TABLE_BG, rows, pre: true, fontSize: TEXT_PX[values.dashTextSize] ?? 11, cellBorder: CELL_BORDER };
}

// A one-row panel for a status message ('Loading…', 'Loading intrabars… 40%'), placed like the dashboard.
export function sofMessagePanel(values, text) {
  if (!values.showDashboard) return null;
  return { position: POSITIONS[values.dashPosition] ?? 'top_right', bg: TABLE_BG, rows: [{ cells: [{ text, color: C.white }] }], pre: true, fontSize: TEXT_PX[values.dashTextSize] ?? 11 };
}
