// The Session Order Flow script's 60 inputs as data (declaration order; labels, groups, bounds and tooltips copied
// from src/session-orderflow.pine by a parser, not by hand), validation, localStorage persistence, and the mapping
// into the engine config. Inline session fields have no label in Pine; they get one here.

export const SOF_STORAGE_KEY = 'thndrx-sof:inputs:v1';

// Types: 'int' | 'float' | 'bool' | 'string' | 'session' | 'color' | 'timeframe'.
export const SOF_INPUTS = Object.freeze([
  {"id":"marketMode","label":"Market Mode","group":"Market","type":"string","def":"Auto","options":["Auto","24h sessions","Single session"],"tooltip":"24h sessions: Asia / London / New York boxes, and the Asia range is the reference range for the sweep state. Meant for crypto, forex, CFDs and futures.\n\nSingle session: one opening-range box per day, and the prior day's high and low are the reference range. Meant for exchange-hours markets such as EGX.\n\nAuto picks 24h sessions for crypto, forex, CFD and futures symbols and Single session for everything else."},
  {"id":"sessionTimezone","label":"Session Timezone","group":"Sessions (24h mode)","type":"string","def":"America/New_York","tooltip":"The default hours below are quoted in New York time, which lets Pine's DST-aware session matching follow the real opens. Change the hours too if you change this."},
  {"id":"showAsia","label":"Show Asia","group":"Sessions (24h mode)","type":"bool","def":true},
  {"id":"asiaSession","label":"Asia Hours","group":"Sessions (24h mode)","type":"session","def":"1800-0000"},
  {"id":"showLondon","label":"Show London","group":"Sessions (24h mode)","type":"bool","def":true},
  {"id":"londonSession","label":"London Hours","group":"Sessions (24h mode)","type":"session","def":"0200-0500"},
  {"id":"showNewYork","label":"Show New York","group":"Sessions (24h mode)","type":"bool","def":true},
  {"id":"newYorkSession","label":"New York Hours","group":"Sessions (24h mode)","type":"session","def":"0700-1000"},
  {"id":"showOpenRange","label":"Show Opening Range","group":"Opening Range (single-session mode)","type":"bool","def":true},
  {"id":"openRangeMins","label":"Opening Range Length (minutes)","group":"Opening Range (single-session mode)","type":"int","def":30,"min":5,"max":240,"step":5,"tooltip":"The first N minutes of each trading day. The box is only drawn when the chart timeframe is no larger than this."},
  {"id":"avgRangeLen","label":"Average Range Length (periods)","group":"Range Used","type":"int","def":14,"min":2,"max":60,"tooltip":"Periods are days on an intraday chart, weeks on a daily chart, months on a weekly chart. The average is built from completed periods on the chart, so it needs that many periods of loaded history."},
  {"id":"exhaustedPct","label":"Exhausted At (% of average range)","group":"Range Used","type":"float","def":85,"min":10,"step":5},
  {"id":"showPools","label":"Show Chart-Timeframe Pools","group":"Liquidity Pools","type":"bool","def":true,"tooltip":"BSL (buy-side liquidity) sits above an unswept swing high, SSL (sell-side) below an unswept swing low: where stop orders are likely to be resting."},
  {"id":"pivotLen","label":"Swing Length (bars each side)","group":"Liquidity Pools","type":"int","def":10,"min":2,"max":50},
  {"id":"showHtfPools","label":"Show Higher-Timeframe Pools","group":"Liquidity Pools","type":"bool","def":true},
  {"id":"htfInput","label":"Higher Timeframe","group":"Liquidity Pools","type":"timeframe","def":"60","tooltip":"If this is not above the chart timeframe it is bumped automatically: to daily on an intraday chart, weekly on a daily chart, monthly on a weekly chart."},
  {"id":"htfPivotLen","label":"HTF Swing Length (HTF bars each side)","group":"Liquidity Pools","type":"int","def":3,"min":1,"max":20},
  {"id":"maxPools","label":"Max Pools Kept (per side, per tier)","group":"Liquidity Pools","type":"int","def":5,"min":1,"max":20},
  {"id":"keepTaken","label":"Taken Pools Kept (faded)","group":"Liquidity Pools","type":"int","def":3,"min":0,"max":30,"tooltip":"How many of the most recently taken pools stay on the chart in grey. 0 removes them as soon as they are taken.\n\nA pool is resolved on the close of the first bar that trades through it: 'swept' if that bar closes back inside, 'run' if it closes beyond."},
  {"id":"poolThickMult","label":"Band Thickness (x ATR)","group":"Liquidity Pools","type":"float","def":0.1,"min":0.01,"step":0.05},
  {"id":"colBsl","label":"BSL","group":"Liquidity Pools","type":"color","def":"#9C27B0"},
  {"id":"colSsl","label":"SSL","group":"Liquidity Pools","type":"color","def":"#3D6FB5"},
  {"id":"showProfile","label":"Show Developing POC / Value Area","group":"Volume Profile","type":"bool","def":true,"tooltip":"Built for the current period: the day on an intraday chart, the week on a daily chart. Each chart bar is split into lower-timeframe bars (see Volume Delta settings) and each small bar's volume is spread evenly across the price rows it covers, so the profile reads the same on different chart timeframes wherever that history is available.\n\nPOC (point of control) is the price row with the most volume. The value area is the band around it holding the chosen share of the period's volume."},
  {"id":"showPrevProfile","label":"Show Prior Period POC / Value Area","group":"Volume Profile","type":"bool","def":true},
  {"id":"vpRows","label":"Rows Per Average Range","group":"Volume Profile","type":"int","def":40,"min":10,"max":200,"tooltip":"Row height is the average period range divided by this. More rows is finer but noisier."},
  {"id":"vaPct","label":"Value Area (% of volume)","group":"Volume Profile","type":"float","def":70,"min":10,"max":95,"step":5},
  {"id":"prevKeep","label":"Prior-Level Sets Kept On Chart","group":"Volume Profile","type":"int","def":2,"min":1,"max":20,"tooltip":"Each new period draws the previous period's POC and value area across it. This is how many of those sets stay visible."},
  {"id":"colPoc","label":"POC / Value Area","group":"Volume Profile","type":"color","def":"#FFEB3B"},
  {"id":"deltaTfInput","label":"Lower Timeframe (delta and profile)","group":"Volume Delta","type":"string","def":"Auto","options":["Auto","1","3","5","15","30","60","240"],"tooltip":"The small bars each chart bar is split into. They build the volume profile and the delta estimate.\n\nDelta is an estimate: each lower-timeframe bar's whole volume is counted as buying if it closed up and selling if it closed down. Auto uses 1-minute bars on intraday charts, 30-minute on daily and 4-hour above that.\n\nTradingView only serves a limited depth of lower-timeframe history; older chart bars fall back to the chart bar's own direction. If the choice is not below the chart timeframe, the chart bar's own direction is used throughout."},
  {"id":"pressureLen","label":"Pressure Window (bars)","group":"Volume Delta","type":"int","def":20,"min":2,"max":200},
  {"id":"domPct","label":"Dominance Threshold (% of volume)","group":"Volume Delta","type":"float","def":55,"min":51,"max":90,"step":1,"tooltip":"Buying (or selling) share of volume over the pressure window needed to call one side dominant. If one side is dominant but price has not moved its way over the same window, the state reads Absorption instead."},
  {"id":"showTrades","label":"Enable Trade Module","group":"Trade Module (experimental)","type":"bool","def":false,"tooltip":"Draws entries, stops and exits for the chosen Entry Model and keeps a record of how those trades would have gone. The record ignores spread, commission and slippage."},
  {"id":"entryModel","label":"Entry Model","group":"Trade Module (experimental)","type":"string","def":"Liquidity run (trend)","options":["Liquidity run (trend)","Sweep reversal"],"tooltip":"Liquidity run (trend): a liquidity pool is traded through and the bar CLOSES beyond it, in the direction of the trend EMA. Entry at that close; the stop starts the chosen ATR multiple away and trails that far behind the best close. No target: the trend is held until the trailing stop is hit. Backtested 2026-11-21 on unseen data: profitable on EGX daily and 1H and on crypto 4H, not on crypto 1H or 15m. Most of the profit came from long trades.\n\nSweep reversal: the original model (a level traded through, then closed back inside; fade it). It lost on every market in the same backtest. The Conditions Filter and the stop / target settings below apply only to this model."},
  {"id":"runStopAtr","label":"Liquidity Run: Stop And Trail (x ATR)","group":"Trade Module (experimental)","type":"float","def":8,"min":1,"step":0.5,"tooltip":"Initial stop distance and trailing distance, in ATR(14). The trail follows the best close since entry and only ever tightens. 8 is the tested value."},
  {"id":"runTrendLen","label":"Liquidity Run: Trend EMA Length","group":"Trade Module (experimental)","type":"int","def":200,"min":10,"tooltip":"Longs only above this EMA, shorts only below it. 200 is the tested value."},
  {"id":"tradeGate","label":"Conditions Filter","group":"Trade Module (experimental)","type":"string","def":"Not against bias","options":["Favourable only","Not against bias","Any except Avoid","No filter"],"tooltip":"Which sweeps become trades.\n\nFavourable only: the verdict is FAVOURABLE for the trade's side.\nNot against bias: verdict is not AVOID and the bias is not opposite.\nAny except Avoid: verdict is not AVOID.\nNo filter: every sweep. Use this as the baseline to see whether the filter is adding anything."},
  {"id":"trigPools","label":"Trigger On Liquidity Pool Sweeps","group":"Trade Module (experimental)","type":"bool","def":true},
  {"id":"trigRef","label":"Trigger On Reference High / Low Sweeps","group":"Trade Module (experimental)","type":"bool","def":true},
  {"id":"stopBufAtr","label":"Stop Buffer Beyond Sweep Wick (x ATR)","group":"Trade Module (experimental)","type":"float","def":0.1,"min":0,"step":0.05},
  {"id":"minRiskAtr","label":"Minimum Stop Distance (x ATR)","group":"Trade Module (experimental)","type":"float","def":0.5,"min":0.1,"step":0.1,"tooltip":"A stop closer than this is widened to it, so ordinary noise does not take the trade out."},
  {"id":"maxRiskAtr","label":"Maximum Stop Distance (x ATR)","group":"Trade Module (experimental)","type":"float","def":3,"min":0.5,"step":0.5,"tooltip":"A sweep whose stop would be further than this is skipped."},
  {"id":"tp1R","label":"TP1 (R)","group":"Trade Module (experimental)","type":"float","def":1,"min":0.25,"step":0.25,"tooltip":"R is the distance from entry to the initial stop. 1.0 means TP1 is as far from entry as the stop is."},
  {"id":"tp2MinR","label":"TP2 Minimum (R)","group":"Trade Module (experimental)","type":"float","def":1.5,"min":0.5,"step":0.25,"tooltip":"TP2 is the nearest opposing liquidity pool, reference level or POC that is at least this far away."},
  {"id":"tp2MaxR","label":"TP2 Maximum (R)","group":"Trade Module (experimental)","type":"float","def":4,"min":1,"step":0.5,"tooltip":"If the nearest such level is further than this, or there is none, the fallback is used instead."},
  {"id":"tp2FallbackR","label":"TP2 Fallback (R)","group":"Trade Module (experimental)","type":"float","def":2,"min":0.5,"step":0.25},
  {"id":"beAfterTp1","label":"Move Stop To Entry After TP1","group":"Trade Module (experimental)","type":"bool","def":true},
  {"id":"maxTradeBars","label":"Close Trade After N Bars (0 = never)","group":"Trade Module (experimental)","type":"int","def":0,"min":0},
  {"id":"logTrades","label":"Log Closed Trades (Pine Logs)","group":"Trade Module (experimental)","type":"bool","def":false,"tooltip":"Writes one line per closed trade to the Pine Logs panel (open and close time, side, entry, stop, targets, outcome, R). Use the panel's Download logs to export the whole history, for example to check the record against an offline backtest. Pine Logs only work on personal, unpublished scripts.","unavailable":"Not available on ThndrX: Pine Logs exist only on TradingView."},
  {"id":"lowVolRatio","label":"Low-Volume Threshold (x normal)","group":"Conditions","type":"float","def":0.7,"min":0.1,"max":1,"step":0.05,"tooltip":"Recent volume (over the pressure window) below this fraction of the longer-run average counts as low participation."},
  {"id":"labelStyle","label":"Session Label Style","group":"Display","type":"string","def":"Auto","options":["Auto","Full","Compact"],"tooltip":"Full: 'ASIA BULL BREAKOUT'. Compact: 'ASIA ▲'. Auto uses Full in 24h mode and Compact in single-session mode, where boxes are narrow."},
  {"id":"showRefLines","label":"Show Reference High / Low","group":"Display","type":"bool","def":true},
  {"id":"showDashboard","label":"Show Dashboard","group":"Display","type":"bool","def":true},
  {"id":"dashDetail","label":"Dashboard Detail","group":"Display","type":"string","def":"Full","options":["Full","Compact"],"tooltip":"Compact shows only the conditions verdict, its reason, what to look for, and the bias."},
  {"id":"dashTextSize","label":"Dashboard Text Size","group":"Display","type":"string","def":"Small","options":["Tiny","Small","Normal"]},
  {"id":"dashPosition","label":"Dashboard Position","group":"Display","type":"string","def":"Top right","options":["Top right","Top left","Bottom right","Bottom left"]},
  {"id":"colBull","label":"Bull","group":"Display","type":"color","def":"#26C6DA"},
  {"id":"colBear","label":"Bear","group":"Display","type":"color","def":"#FF1F5A"},
  {"id":"colAccum","label":"Accumulation","group":"Display","type":"color","def":"#D4C98A"},
  {"id":"colRef","label":"Reference","group":"Display","type":"color","def":"#B0B0B0"},
  {"id":"boxFillTransp","label":"Box Fill Transparency","group":"Display","type":"int","def":90,"min":50,"max":100},].map((i) => Object.freeze(i)));

export function sofDefaults() {
  const v = {};
  for (const i of SOF_INPUTS) v[i.id] = i.def;
  return v;
}

const HEX6 = /^#[0-9a-f]{6}$/i;
const RGBA = /^rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d*\.?\d+)\s*\)$/i;
const TIMEFRAMES = /^(\d+|1?[DWM])$/i; // what the engine reads: minutes, D / W / M or 1D / 1W / 1M
function validColor(v) {
  if (typeof v !== 'string') return false;
  if (HEX6.test(v)) return true;
  const m = RGBA.exec(v);
  return !!m && [m[1], m[2], m[3]].every((x) => +x <= 255) && +m[4] <= 1;
}
function validTimeZone(v) {
  if (typeof v !== 'string' || v === '') return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: v }); return true; } catch { return false; }
}

export function sofIsValid(input, v) {
  switch (input.type) {
    case 'bool': return typeof v === 'boolean';
    case 'int': case 'float':
      return Number.isFinite(v) && (input.type !== 'int' || Number.isInteger(v))
        && (input.min === undefined || v >= input.min) && (input.max === undefined || v <= input.max);
    case 'color': return validColor(v);
    case 'session': return typeof v === 'string' && /^\d{4}-\d{4}$/.test(v) && +v.slice(0, 2) < 24 && +v.slice(2, 4) < 60 && +v.slice(5, 7) <= 24 && +v.slice(7, 9) < 60;
    case 'timeframe': return typeof v === 'string' && TIMEFRAMES.test(v) && v !== '0';
    default:
      if (input.id === 'sessionTimezone') return validTimeZone(v);
      return typeof v === 'string' && v !== '' && (!input.options || input.options.includes(v));
  }
}

export function loadSofValues(storage) {
  const values = sofDefaults();
  let saved = null;
  try { saved = JSON.parse(storage.getItem(SOF_STORAGE_KEY)); } catch { /* corrupt or absent: defaults */ }
  if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
    for (const input of SOF_INPUTS) if (input.id in saved && sofIsValid(input, saved[input.id])) values[input.id] = saved[input.id];
  }
  return values;
}

export function saveSofValues(storage, values) {
  const clean = {};
  for (const input of SOF_INPUTS) clean[input.id] = sofIsValid(input, values[input.id]) ? values[input.id] : input.def;
  storage.setItem(SOF_STORAGE_KEY, JSON.stringify(clean));
}

// Input values -> runSof options (tools/backtest/sof-engine.mjs). Ids the engine names differently are mapped; the
// display-only inputs (colours, labels, dashboard) stay with the plan. render: the overlay always wants the drawings.
const ENGINE_KEY = { sessionTimezone: 'sessionTz', deltaTfInput: 'deltaTf' };
const DISPLAY_ONLY = new Set(['colBsl', 'colSsl', 'colPoc', 'logTrades', 'labelStyle', 'showDashboard', 'dashDetail', 'dashTextSize', 'dashPosition', 'colBull', 'colBear', 'colAccum', 'colRef', 'boxFillTransp']);
export function sofEngineCfg(values) {
  const cfg = { deltaTieRule: 'tick', beSameBar: true, render: true };
  for (const { id } of SOF_INPUTS) if (!DISPLAY_ONLY.has(id)) cfg[ENGINE_KEY[id] ?? id] = values[id];
  return cfg;
}
