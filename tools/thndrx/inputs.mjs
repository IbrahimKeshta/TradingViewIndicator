// The Pine indicator's 125 inputs as data (declaration order, labels/groups/bounds/tooltips copied
// from src/ict-rsi-ma-indicator.pine), plus resolution into the engine config and the renderer's
// display settings.
import { DEFAULTS, PRESETS } from '../backtest/ict-engine.mjs';
import { PINE_COLORS, colorNew } from './colors.mjs';

const INDEX_UNAVAILABLE = 'Not available on ThndrX: the index needs a second data feed.';

// Types: 'int' | 'float' | 'bool' | 'string' | 'session' | 'color' | 'timeframe' | 'time'.
// `time` defaults are milliseconds, like Pine's input.time; resolveConfig converts to engine seconds.
export const INPUTS = Object.freeze([
  { id: "rsiLength", label: "RSI Length", group: "RSI", type: 'int', def: 14, min: 1 },
  { id: "rsiOverbought", label: "RSI Overbought Level", group: "RSI", type: 'int', def: 70, min: 1, max: 100 },
  { id: "rsiOversold", label: "RSI Oversold Level", group: "RSI", type: 'int', def: 30, min: 0, max: 99 },
  { id: "maTypeInput", label: "MA Type", group: "Moving Average", type: 'string', def: "EMA", options: ["EMA","SMA"] },
  { id: "maLength", label: "MA Length", group: "Moving Average", type: 'int', def: 50, min: 1 },
  { id: "majorLookback", label: "Major Swing Lookback", group: "Market Structure", type: 'int', def: 20, min: 2, max: 100, tooltip: "Bars either side a bar must dominate to count as a major swing. Major swings define the headline trend and the range test. Capped at 100 to stay inside Pine's default history buffer." },
  { id: "internalLookback", label: "Internal Swing Lookback", group: "Market Structure", type: 'int', def: 5, min: 2, max: 50, tooltip: "The fine-grained tier: pullback state, internal order blocks, and entry-level detail. Signals and watch-zone alerts read this tier's trend." },
  { id: "maxSwings", label: "Max Swings Kept (per side, per tier)", group: "Market Structure", type: 'int', def: 10, min: 2, max: 30, tooltip: "Broken swings are kept, not deleted — only this cap removes them, oldest first." },
  { id: "structAtrLength", label: "Structure ATR Length", group: "Market Structure", type: 'int', def: 14, min: 1, tooltip: "Scales the equal-level tolerance, the range band and break strength. Separate from the Watch-Zone ATR on purpose, so tuning proximity cannot reclassify structure." },
  { id: "eqTolMult", label: "Equal-Level Tolerance (x ATR)", group: "Market Structure", type: 'float', def: 0.15, min: 0, step: 0.05, tooltip: "Two consecutive swings within this distance are equal highs/lows (EQH/EQL) — resting liquidity, not a directional swing. They never change the trend." },
  { id: "rangeAtrMult", label: "Range Band (x ATR)", group: "Market Structure", type: 'float', def: 2.5, min: 0.1, step: 0.1, tooltip: "When the last two major highs and last two major lows all fit inside this band, structure is compressing and Range reads YES." },
  { id: "rangeLookbackBars", label: "Range Lookback (bars)", group: "Market Structure", type: 'int', def: 100, min: 10, tooltip: "Staleness guard for the range test. Without it, four pivots spread over hundreds of bars could sit in a narrow band and read as consolidation." },
  { id: "showFVG", label: "Show Fair Value Gaps", group: "Fair Value Gaps", type: 'bool', def: true },
  { id: "fvgMaxCount", label: "Max Tracked FVGs (per side)", group: "Fair Value Gaps", type: 'int', def: 20, min: 1, max: 50 },
  { id: "showOB", label: "Show Order Blocks", group: "Order Blocks", type: 'bool', def: true },
  { id: "obMaxCount", label: "Max Tracked Order Blocks (per side)", group: "Order Blocks", type: 'int', def: 20, min: 1, max: 50 },
  { id: "obSearchBars", label: "Order Block Backward Search (bars)", group: "Order Blocks", type: 'int', def: 50, min: 5, max: 200 },
  { id: "showInternalOb", label: "Include Internal-Tier Order Blocks", group: "Order Blocks", type: 'bool', def: true, tooltip: "Internal-tier breaks are what produced every order block before the two-tier structure engine existed, so this defaults on. Turn it off to keep only order blocks born from major structural breaks." },
  { id: "sessionTimezone", label: "Session Timezone", group: "Killzones", type: 'string', def: "America/New_York", tooltip: "London and New York killzone hours below are conventionally quoted in New York time. Evaluating them against America/New_York lets Pine's own DST-aware session matching track the real session opens automatically; changing this to another timezone re-interprets the same hour numbers against a different clock, which will not line up with the actual sessions unless you also recalculate the hours." },
  { id: "showLondonKZ", label: "Show London Killzone", group: "Killzones", type: 'bool', def: true },
  { id: "londonSession", label: "London Killzone Time", group: "Killzones", type: 'session', def: "0200-0500" },
  { id: "showNewYorkKZ", label: "Show New York Killzone", group: "Killzones", type: 'bool', def: true },
  { id: "newYorkSession", label: "New York Killzone Time", group: "Killzones", type: 'session', def: "0700-1000" },
  { id: "showAsiaKZ", label: "Show Asia Killzone", group: "Killzones", type: 'bool', def: false, tooltip: "Off by default — turning this on changes what Score: Killzone means on any existing saved chart, including single-session markets like EGX where a third always-on window would make the point easier to earn without adding signal. Turn on for 24-hour markets such as crypto, where Asian-session volume is not a rounding error." },
  { id: "asiaSession", label: "Asia Killzone Time", group: "Killzones", type: 'session', def: "2000-0000" },
  { id: "showSignalMarkers", label: "Show Signal Markers", group: "Alerts / Display", type: 'bool', def: true },
  { id: "showRsiReadout", label: "Show RSI Readout Label", group: "Alerts / Display", type: 'bool', def: true },
  { id: "watchZoneAtrLength", label: "Watch-Zone ATR Length", group: "Alerts / Display", type: 'int', def: 14, min: 1 },
  { id: "watchZoneAtrMult", label: "Watch-Zone Proximity (x ATR)", group: "Alerts / Display", type: 'float', def: 1, min: 0.1, step: 0.1 },
  { id: "showMajorTags", label: "Show Major Tags", group: "Structure Display", type: 'bool', def: true, tooltip: "HH / HL / LH / LL / EQH / EQL on each retained major swing." },
  { id: "showMajorRays", label: "Show Major Rays", group: "Structure Display", type: 'bool', def: true, tooltip: "Extends every unbroken major swing to the right as live support or resistance. Broken levels stop drawing." },
  { id: "showBreakLines", label: "Show Break Lines", group: "Structure Display", type: 'bool', def: true, tooltip: "Marks each major BOS and CHoCH where it happened. These stay on the chart as history rather than being redrawn." },
  { id: "showInternalRays", label: "Show Internal Rays", group: "Structure Display", type: 'bool', def: false, tooltip: "Entry-level detail. Off by default because on a fast timeframe these are near-continuous." },
  { id: "showInternalBreaks", label: "Show Internal Break Lines", group: "Structure Display", type: 'bool', def: false, tooltip: "Off by default. On a fast timeframe internal breaks are near-continuous, and their labels share the chart's 500-label budget with the trade result history — leave this off if you want a long track record to survive." },
  { id: "showStructurePanel", label: "Show Structure Panel", group: "Structure Display", type: 'bool', def: true },
  { id: "panelPosInput", label: "Panel Position", group: "Structure Display", type: 'string', def: "Bottom Right", options: ["Top Right","Top Left","Bottom Right","Bottom Left"], tooltip: "Where the STRUCTURE/PERFORMANCE panel renders. Defaults to Bottom Right rather than Top Right: TradingView's own expanded indicator-legend bar (the row of input values shown when the legend is hovered or pinned open) sits near the top of the chart and renders on top of whatever is there, cutting through panel rows instead of sitting behind them. The live price/symbol flag on the price scale can still cross whichever corner is chosen, since it tracks the current price rather than a fixed position." },
  { id: "panelBgColor", label: "Panel Background", group: "Structure Display", type: 'color', def: colorNew(PINE_COLORS.black, 80), tooltip: "Background for the whole STRUCTURE/PERFORMANCE/POINTS panel — header rows keep their own gray highlight on top of this. Use the color picker's own opacity slider for transparency." },
  { id: "majorTagColor", label: "Major Tag", group: "Structure Display", type: 'color', def: PINE_COLORS.orange },
  { id: "liquidityTagColor", label: "Liquidity Tag (EQH/EQL)", group: "Structure Display", type: 'color', def: PINE_COLORS.yellow },
  { id: "bosColor", label: "BOS", group: "Structure Display", type: 'color', def: PINE_COLORS.lime },
  { id: "chochColor", label: "CHoCH", group: "Structure Display", type: 'color', def: PINE_COLORS.fuchsia },
  { id: "rayColor", label: "Rays", group: "Structure Display", type: 'color', def: PINE_COLORS.gray },
  { id: "presetInput", label: "Preset", group: "Trade Engine", type: 'string', def: "Custom", options: ["Custom","EGX Daily"], tooltip: "Custom: every setting below is used exactly as set.\n\nEGX Daily: the best configuration found over 100 EGX stocks on daily bars, full history, after costs (2026-11-20). It FORCES these settings and ignores whatever their own boxes say: Stop on Close Only on, Runner on, Trailing Tier Major, Trail From Entry on, Long Trades Only on, Apply Costs on (with the slippage and commission set under Costs), Min Risk (ticks) 10, and the killzone point counted as earned (see Score: Killzone).\n\nIt does not switch the Trailing Stop Model on or off: that model has its own slot and its own PERFORMANCE rows.\n\nOn those stocks it took average R per trade from +0.10 to +0.48. Stop on Close and the runner settings each passed an out-of-sample test on their own; the combination was chosen from the full sample, so forward results are its real test. Measured on EGX daily charts only." },
  { id: "minScore", label: "Minimum Score", group: "Trade Engine", type: 'int', def: 5, min: 1, max: 15, tooltip: "How many scored points a setup needs, out of however many are switched on below. The panel shows both numbers — a disabled point is never counted in the denominator, so turning one off does not silently loosen or break the threshold.\n\nRaised from 4 to 5 when the confirmation points were added: at seven points, 4 would be a LOOSER gate than the old 4-of-5. TradingView keeps the value saved on an existing chart, so if this still reads 4, it was carried over and should be raised by hand." },
  { id: "scoreKillzone", label: "Score: Killzone", group: "Trade Engine", type: 'bool', def: true, tooltip: "One point when the signal bar falls inside a drawn killzone session. If both killzone sessions are disabled for display, this point excludes itself automatically whatever this is set to.\n\nOn EGX daily bars the bar opens inside the London window, so this point is earned on every bar: with it on, Minimum Score 5 means 4 of the other 6 points. Turning it off raises that to 5 of 6, which tested WORSE on 100 EGX stocks (+0.46R vs +0.51R per trade, fewer trades, worse in both periods). Leave it on for EGX daily. The EGX Daily preset counts it as earned whatever this is set to." },
  { id: "scoreMa", label: "Score: Moving Average", group: "Trade Engine", type: 'bool', def: true },
  { id: "scoreMajorAgree", label: "Score: Major Trend Agreement", group: "Trade Engine", type: 'bool', def: true, tooltip: "Whether the major tier agrees with the internal tier. A pullback entry against the major trend is a real setup — just a weaker one — so this scores rather than vetoes." },
  { id: "scoreBreakStrength", label: "Score: Break Strength", group: "Trade Engine", type: 'bool', def: true },
  { id: "strongBreakMult", label: "Strong Break (x ATR)", group: "Trade Engine", type: 'float', def: 1, min: 0.1, step: 0.1, tooltip: "The breaking candle's body must exceed this multiple of ATR to earn the break-strength point." },
  { id: "stopBufferMult", label: "Stop Buffer (x ATR)", group: "Trade Engine", type: 'float', def: 0.25, min: 0, step: 0.05, tooltip: "How far beyond the entry zone's far edge the stop sits, so an ordinary wick into the zone does not clip it. Also used by the trailing stop." },
  { id: "minRiskAtr", label: "Minimum Risk (x ATR)", group: "Trade Engine", type: 'float', def: 1, min: 0, step: 0.1, tooltip: "Reject a zone-touch setup whose entry-to-stop distance is below this multiple of the Structure ATR — the same floor the trailing model already applies to its own flips (Trail Minimum Risk), and for the same reason: a stop that thin sits inside a single bar's ordinary range, so the R multiple it produces is inflated on winners and enormous on losers, not a real read of the setup.\n\nSet to 0 to disable the floor and take every zone touch, which is what produced the earlier record." },
  { id: "minTargetR", label: "Minimum Target Distance (R)", group: "Trade Engine", type: 'float', def: 1, min: 0.1, step: 0.1, tooltip: "Structural levels closer than this are skipped. A target 0.3R away is a winner on paper and not worth the spread." },
  { id: "trailTierInput", label: "Trailing Tier", group: "Trade Engine", type: 'string', def: "Internal", options: ["Internal","Major"], tooltip: "Which tier's swings the stop trails behind once TP1 is hit. Internal trails tightly; Major gives the trade room." },
  { id: "stopOnCloseOnlyIn", label: "Stop on Close Only", group: "Trade Engine", type: 'bool', def: false, tooltip: "Exit only when a bar CLOSES beyond the stop, instead of the moment its wick touches. On thin or wicky instruments — EGX dailies especially — an intrabar touch hands back trades that the close never confirmed.\n\nThe exit is then recorded at that bar's close, not at the stop price, because the close is where the decision was actually made. That is a worse fill than the stop level and it is the honest one: the trade is giving up the extra distance in exchange for surviving wicks." },
  { id: "runnerModeIn", label: "Runner (no exit at TP3)", group: "Trade Engine", type: 'bool', def: false, tooltip: "Treat TP3 as a waypoint rather than the exit. The last third keeps running behind the trailing stop until the stop or a CHoCH takes it out, which is what lets one trade pay for several stopped ones on a trending instrument.\n\nThe scale-out accounting follows: with this on, a third leaves at TP1 and a third at TP2, and the FINAL third is priced at wherever the trade actually closed instead of at TP3." },
  { id: "trailFromEntryIn", label: "Trail From Entry", group: "Trade Engine", type: 'bool', def: false, tooltip: "Run the structural trail from the moment the trade opens, and skip the jump to breakeven at TP1.\n\nDefault behaviour jams the stop to entry on TP1, which on a strong continuation hands the trade back at 0R on the first ordinary pullback. With this on the stop instead follows the same swings it always would — looser early, and it can still lose a full R after TP1, which is the trade being made." },
  { id: "longOnlyIn", label: "Long Trades Only", group: "Trade Engine", type: 'bool', def: false, tooltip: "For cash-equity charts where shorting is unavailable. Bearish setups still mark and alert, but open no trade." },
  { id: "showTradeLevels", label: "Show Trade Levels", group: "Trade Engine", type: 'bool', def: true },
  { id: "showTradeHistory", label: "Show Trade History", group: "Trade Engine", type: 'bool', def: true, tooltip: "Leaves a result label in R at each closed trade's exit bar — the cheapest possible track record." },
  { id: "showTradePanel", label: "Show Trade Panel Rows", group: "Trade Engine", type: 'bool', def: true },
  { id: "showGatePanel", label: "Show Gate Panel Row", group: "Trade Engine", type: 'bool', def: true, tooltip: "One row naming what is currently stopping a trade, with the live score beside it. Without it the score is only ever rendered inside a live trade's rows, so on a bar where nothing fires there is no surface anywhere that reflects a scoring input you just changed." },
  { id: "showStatsPanel", label: "Show Performance Rows", group: "Trade Engine", type: 'bool', def: true, tooltip: "Win rate, average R, total R and a per-grade breakdown over every trade in the loaded history.\n\nResults assume one third of the position leaves at each target reached — the engine itself manages one unit, so this is an accounting convention. The live trade's Open R row is single-unit and will not match.\n\nThe counters run whether or not this is on; hiding the rows never resets them. The sample is whatever history TradingView loaded, so read n before trusting a percentage.\n\nA trade that closes at exactly 0.0R counts as neither a win nor a loss, so W + L can come to one less than n." },
  { id: "requireHtfBias", label: "Require HTF Bias", group: "Trade Filters", type: 'bool', def: false, tooltip: "Only take a pullback trade in the direction of higher-timeframe structure: the side of the last closed HTF bar's break through a confirmed HTF swing high or low. Until the HTF has broken a swing at all there is no bias, and no trade.\n\nRead one closed HTF bar back, so it never reports a bias the chart could not have seen at the time. Disables itself when the chart timeframe is at or above Bias Timeframe." },
  { id: "htfBiasTf", label: "Bias Timeframe", group: "Trade Filters", type: 'timeframe', def: "1D", tooltip: "Pick a timeframe well above the chart's: 1D for 1H–4H charts, 1W for a daily chart." },
  { id: "htfSwingLen", label: "HTF Swing Lookback", group: "Trade Filters", type: 'int', def: 5, min: 2, max: 50, tooltip: "Bars either side an HTF bar must dominate to count as a swing, measured in HTF bars." },
  { id: "requireDisplacement", label: "Require Displacement", group: "Trade Filters", type: 'bool', def: false, tooltip: "Only create zones that were born from a real impulse. A fair value gap must be at least Min FVG Size wide and its middle candle's body at least Displacement in the gap's direction; an order block is only kept when the candle that broke structure has a body of at least Displacement.\n\nApplied when a zone is created, so a rejected zone is never drawn, never alerts and never trades." },
  { id: "dispMult", label: "Displacement (x ATR)", group: "Trade Filters", type: 'float', def: 1, min: 0.1, step: 0.1, tooltip: "Minimum body of the impulse candle, in Structure ATR." },
  { id: "fvgMinAtr", label: "Min FVG Size (x ATR)", group: "Trade Filters", type: 'float', def: 0.3, min: 0, step: 0.05, tooltip: "Minimum gap height, in Structure ATR." },
  { id: "requireConfirmation", label: "Require Confirmation", group: "Trade Filters", type: 'bool', def: false, tooltip: "Root-cause finding 2026-09-17: over half of all pullback trades never even reach 1R in their favor before failing, drifting adversely for several bars rather than failing instantly — the signature of a touch that fires before the reversal has actually started.\n\nWith this on, a zone touch is remembered rather than traded immediately. Entry only fires once a later bar (up to Confirmation Max Wait bars after the touch) closes in the trade's direction without the zone having invalidated first. The entry price, stop and targets still come from the ORIGINAL touch's zone, not the confirmation bar — only the timing of the decision moves.\n\nOff by default; with it off the engine enters on the touch bar exactly as it always has." },
  { id: "confirmMaxWait", label: "Confirmation Max Wait (bars)", group: "Trade Filters", type: 'int', def: 3, min: 1, max: 20, tooltip: "A touch that hasn't produced a same-direction candle within this many bars is abandoned — that trade is never taken, not taken late." },
  { id: "requireAvwap", label: "Require Anchored VWAP", group: "Trade Filters", type: 'bool', def: false, tooltip: "Longs need the close above the VWAP anchored at the latest major swing low: the average price paid by everyone who bought since that low is below price, so they are in profit. Shorts need the close below the VWAP anchored at the latest major swing high. Applies to both entry models.\n\nThe anchor moves only once a swing is confirmed (Major Swing Lookback bars after it forms), so a past bar never sees a swing it could not have known about. Needs volume: with no anchored VWAP reading yet, the setup is blocked." },
  { id: "showAvwap", label: "Show Anchored VWAP", group: "Trade Filters", type: 'bool', def: false, tooltip: "Draw both anchored VWAP lines. Display only; the filter works with this off." },
  { id: "requireIndexTrend", label: "Require Index Trend", group: "Index Filter", type: 'bool', def: false, tooltip: "EGX symbols only. Longs need the stock's index (EGX30 or EGX70 EWI) not trending Down; shorts need it not trending Up. Up = index close above its MA with the MA rising over the slope lookback; Down = the mirror. Ignored on non-EGX symbols.", unavailable: INDEX_UNAVAILABLE },
  { id: "indexMode", label: "Index", group: "Index Filter", type: 'string', def: "Auto", options: ["Auto","EGX30","EGX70"], unavailable: INDEX_UNAVAILABLE },
  { id: "idxRegimeLen", label: "Index MA Length", group: "Index Filter", type: 'int', def: 50, min: 2, unavailable: INDEX_UNAVAILABLE },
  { id: "idxSlopeLen", label: "Index Slope Lookback (bars)", group: "Index Filter", type: 'int', def: 10, min: 1, unavailable: INDEX_UNAVAILABLE },
  { id: "applyCostsIn", label: "Apply Costs", group: "Costs", type: 'bool', def: false, tooltip: "Deduct slippage and commission from every closed trade's R. Off by default so existing charts keep their numbers." },
  { id: "slippagePct", label: "Slippage per Side (%)", group: "Costs", type: 'float', def: 0.1, min: 0, step: 0.05 },
  { id: "commissionPer", label: "Commission per Order", group: "Costs", type: 'float', def: 2, min: 0, step: 0.5, tooltip: "In the chart's currency." },
  { id: "positionSize", label: "Position Size", group: "Costs", type: 'float', def: 100000, min: 1, step: 10000, tooltip: "Only used to turn the per-order commission into R." },
  { id: "minRiskTicksIn", label: "Min Risk (ticks)", group: "Costs", type: 'int', def: 0, min: 0, tooltip: "Reject setups whose stop is closer than this many ticks, in both models. 0 = off. On split-adjusted EGX history a whole stop can sit inside one tick, and a few such trades can dominate Total R." },
  { id: "testStart", label: "Test Start", group: "Validation", type: 'time', def: Date.parse('2024-01-01T00:00:00+02:00'), tooltip: "Data Window totals split closed trades into Tuning (entered before) and Test (entered on or after). A trade entered before and closed after is counted in neither, only as straddle." },
  { id: "logTrades", label: "Log Closed Trades", group: "Trade Engine", type: 'bool', def: false, tooltip: "Writes one CSV line per closed trade to the Pine Logs panel: times, zone type, levels, result in R, best and worst excursion in R, bars held, and the seven confirmation points. For diagnosing losing trades one by one. Off by default." },
  { id: "showPointStats", label: "Show Confirmation Point Stats", group: "Trade Engine", type: 'bool', def: false, tooltip: "Per-confirmation-point breakdown: average R on closed trades where that point was true at entry, versus where it was false — independent of whether the point currently counts toward the score, so it also shows what a disabled point would have correlated with.\n\nOff by default: adds up to 7 rows per model to the panel, and exists to answer one question (does this specific point actually track the trades that worked) rather than for everyday use." },
  { id: "tradeLongColor", label: "Long", group: "Trade Engine", type: 'color', def: PINE_COLORS.teal },
  { id: "tradeShortColor", label: "Short", group: "Trade Engine", type: 'color', def: PINE_COLORS.maroon },
  { id: "tradeStopColor", label: "Stop", group: "Trade Engine", type: 'color', def: PINE_COLORS.red },
  { id: "tradeTargetColor", label: "Targets", group: "Trade Engine", type: 'color', def: PINE_COLORS.green },
  { id: "useTrailModel", label: "Enable Trailing Stop Model", group: "Trailing Stop Model", type: 'bool', def: false, tooltip: "Off by default. With this off the model never opens a trade, never accumulates and never draws — the pullback model's record is unchanged, which is the check to run first: its n and Total R must not move." },
  { id: "trailAtrLength", label: "Trail ATR Length", group: "Trailing Stop Model", type: 'int', def: 14, min: 1 },
  { id: "trailAtrMult", label: "Trail ATR Multiple", group: "Trailing Stop Model", type: 'float', def: 2, min: 0.1, step: 0.1, tooltip: "How far the trail sits from the running extreme. This IS the model's risk: entry to trail at the flip bar, so 2.0 means roughly two ATR of risk per trade — typically far wider than a zone-height stop, and correspondingly fewer, larger positions in R terms." },
  { id: "trailLookback", label: "Trail Extreme Lookback", group: "Trailing Stop Model", type: 'int', def: 22, min: 1, tooltip: "Bars in the running high/low the trail hangs from. Longer gives the trend more room and flips later." },
  { id: "trailMinTargetR", label: "Trail Minimum Target Distance (R)", group: "Trailing Stop Model", type: 'float', def: 1, min: 0.1, step: 0.1, tooltip: "This model's own target floor, separate from the pullback model's. Its R is an ATR multiple rather than a zone height, so a floor tuned for tight zone stops would push the first target somewhere price never goes." },
  { id: "trailRequireTrend", label: "Require Trend Agreement", group: "Trailing Stop Model", type: 'bool', def: true, tooltip: "Only take a flip that agrees with the internal structure trend. Off makes this a standalone trend system that ignores the structure engine entirely." },
  { id: "trailUseScore", label: "Apply Minimum Score", group: "Trailing Stop Model", type: 'bool', def: false, tooltip: "Gate this model on the same score the pullback model uses. OFF by default and deliberately so: on the record to date the score is anti-predictive — the highest-graded setups lose the most — so applying it here would import that problem into a model built to be measured independently. Turn it on only to test whether that finding holds for this model too." },
  { id: "trailMinRiskAtr", label: "Trail Minimum Risk (x ATR)", group: "Trailing Stop Model", type: 'float', def: 1, min: 0, step: 0.1, tooltip: "Reject a flip whose entry-to-trail distance is below this multiple of the model's ATR.\n\nA flip that fires with price almost on top of its own trail produces a stop inside a single bar's range, so an ordinary bar takes it out for a near-full R. Nothing else in the model bounds that distance — it is whatever the flip bar's close happens to be above the line.\n\nSet to 0 to disable the floor and take every flip, which is what produced the earlier record." },
  { id: "trailUsesOwnStop", label: "Trade Follows the Trail Line", group: "Trailing Stop Model", type: 'bool', def: true, tooltip: "The trade's stop ratchets along this model's own Chandelier line, from the moment it opens.\n\nOff reverts to the shared structural swing trail, which is what the pullback model uses. On this model that leaves the stop parked near entry while the very line that opened the trade flips against it — so Off exists only to reproduce the earlier record for comparison, not as a sensible way to run it." },
  { id: "showTrailStop", label: "Show Trail Line", group: "Trailing Stop Model", type: 'bool', def: false },
  { id: "scoreMomentum", label: "Score: Momentum", group: "Confirmations", type: 'bool', def: true, tooltip: "One point, earned when at least half the enabled members below agree with the trade's direction (2 of 3, 1 of 2, 1 of 1). If every member is switched off, this point removes itself from the denominator whatever this is set to." },
  { id: "momRsi", label: "Momentum: RSI", group: "Confirmations", type: 'bool', def: true, tooltip: "RSI above 50 for a long, below 50 for a short. This was 'Score: RSI' and was a point of its own; it is now a member of the Momentum vote." },
  { id: "momMacd", label: "Momentum: MACD", group: "Confirmations", type: 'bool', def: true, tooltip: "MACD line above its signal line for a long, below for a short." },
  { id: "momStoch", label: "Momentum: Stochastic", group: "Confirmations", type: 'bool', def: true, tooltip: "%K above %D for a long, below for a short. Read as a cross rather than an overbought/oversold level: in a trend the oscillator pins to its extreme and a level test would veto exactly the continuation setups this engine takes." },
  { id: "macdFast", label: "MACD Fast", group: "Confirmations", type: 'int', def: 12, min: 1 },
  { id: "macdSlow", label: "MACD Slow", group: "Confirmations", type: 'int', def: 26, min: 2 },
  { id: "macdSignalLen", label: "MACD Signal", group: "Confirmations", type: 'int', def: 9, min: 1 },
  { id: "stochLength", label: "Stochastic %K Length", group: "Confirmations", type: 'int', def: 14, min: 1 },
  { id: "stochSmoothK", label: "Stochastic %K Smoothing", group: "Confirmations", type: 'int', def: 3, min: 1 },
  { id: "stochDLength", label: "Stochastic %D Length", group: "Confirmations", type: 'int', def: 3, min: 1 },
  { id: "scoreParticipation", label: "Score: Participation", group: "Confirmations", type: 'bool', def: true, tooltip: "One point for evidence that someone is actually trading at this level. On a symbol that reports no volume at all — many forex feeds — both members disable themselves and this point leaves the denominator." },
  { id: "partVolume", label: "Participation: Volume Surge", group: "Confirmations", type: 'bool', def: true, tooltip: "Volume on the bar that touched the zone, against its own recent average." },
  { id: "partClimax", label: "Participation: Climax Candle", group: "Confirmations", type: 'bool', def: true, tooltip: "An exhaustion bar AGAINST the trade in the last few bars — for a long, a heavy down bar closing on its low into support. That is the pullback spending itself, which is where the reversal starts. A heavy up bar before you buy a pullback means you are late, and does not earn this." },
  { id: "volLen", label: "Volume Average Length", group: "Confirmations", type: 'int', def: 20, min: 1 },
  { id: "volMult", label: "Volume Surge (x average)", group: "Confirmations", type: 'float', def: 1.5, min: 0.1, step: 0.1 },
  { id: "climaxRangeMult", label: "Climax Range (x ATR)", group: "Confirmations", type: 'float', def: 2, min: 0.1, step: 0.1, tooltip: "Uses the Structure ATR, so climax detection and the stop buffer are scaled by the same measure." },
  { id: "climaxVolMult", label: "Climax Volume (x average)", group: "Confirmations", type: 'float', def: 2, min: 0.1, step: 0.1 },
  { id: "climaxBars", label: "Climax Lookback (bars)", group: "Confirmations", type: 'int', def: 3, min: 1, max: 20, tooltip: "Window ending at the current bar, inclusive. At 3 it covers this bar and the two before it." },
  { id: "scoreIchimoku", label: "Score: Ichimoku", group: "Confirmations", type: 'bool', def: true, tooltip: "One point when price sits clear of the cloud on the trade's side. Inside the cloud earns nothing — that is the region where the regime is undecided. Chikou is deliberately not used: it is displaced 26 bars backwards and would report confirmation that did not exist at the time." },
  { id: "tenkanLen", label: "Tenkan Length", group: "Confirmations", type: 'int', def: 9, min: 1 },
  { id: "kijunLen", label: "Kijun Length", group: "Confirmations", type: 'int', def: 26, min: 1 },
  { id: "senkouBLen", label: "Senkou B Length", group: "Confirmations", type: 'int', def: 52, min: 1 },
  { id: "ichiDisp", label: "Ichimoku Displacement", group: "Confirmations", type: 'int', def: 26, min: 1, max: 100, tooltip: "How far forward the cloud is drawn — and how far back the score has to look to read the cloud you actually see at this bar." },
  { id: "showKumo", label: "Show Kumo Cloud", group: "Confirmations", type: 'bool', def: false, tooltip: "Off by default. The chart already carries swing tags, rays, break lines, order blocks, fair value gaps and a full trade box; the cloud is the only part of this block that can be drawn on a price overlay at all." },
  { id: "showConfirmPanel", label: "Show Confirmation Panel Row", group: "Confirmations", type: 'bool', def: true },
  { id: "kumoBullColor", label: "Kumo Bullish", group: "Confirmations", type: 'color', def: colorNew(PINE_COLORS.green, 85) },
  { id: "kumoBearColor", label: "Kumo Bearish", group: "Confirmations", type: 'color', def: colorNew(PINE_COLORS.red, 85) },
].map(Object.freeze));

export const STORAGE_KEY = 'thndrx-ict:inputs:v1';

export function defaultValues() {
  return Object.fromEntries(INPUTS.map((i) => [i.id, i.def]));
}

// Pine input id -> engine config key, where they differ. Everything else keeps its name.
const ENGINE_KEY = {
  maTypeInput: 'maType',
  trailTierInput: 'trailTier',
  stopOnCloseOnlyIn: 'stopOnCloseOnly',
  runnerModeIn: 'runnerMode',
  trailFromEntryIn: 'trailFromEntry',
  longOnlyIn: 'longOnly',
  applyCostsIn: 'applyCosts',
  minRiskTicksIn: 'minRiskTicks',
};
// Inputs the preset resolves into engine keys (Pine lines 123-130); the display never reads their raw form.
const PRESET_RESOLVED = new Set(Object.keys(ENGINE_KEY).filter((id) => id !== 'maTypeInput'));

// Pine lines 123-132: the engine reads only resolved values, so a preset cannot be half-applied.
export function resolveConfig(values) {
  const engineCfg = {};
  for (const { id } of INPUTS) {
    const key = ENGINE_KEY[id] ?? id;
    if (key in DEFAULTS) engineCfg[key] = values[id];
  }
  engineCfg.testStart = values.testStart / 1000; // input.time is ms; the engine runs on seconds
  engineCfg.killzoneAlwaysEarned = false;
  engineCfg.requireIndexTrend = false; // the index needs a second data feed ThndrX does not give us

  const egx = values.presetInput === 'EGX Daily';
  if (egx) Object.assign(engineCfg, PRESETS['egx-daily']); // stopOnCloseOnly, runnerMode, trailFromEntry, longOnly, applyCosts, trailTier 'Major', minRiskTicks 10, killzoneAlwaysEarned

  const display = {};
  for (const { id } of INPUTS) if (!PRESET_RESOLVED.has(id) && id !== 'testStart') display[id] = values[id];
  display.panelPos = values.panelPosInput;
  display.panelBg = values.panelBgColor;
  return { engineCfg, display, presetTag: egx ? ' · EGX DAILY' : '' };
}

function validFor(input, v) {
  switch (input.type) {
    case 'bool': return typeof v === 'boolean';
    case 'int': case 'float': case 'time':
      return Number.isFinite(v) && (input.type !== 'int' || Number.isInteger(v))
        && (input.min === undefined || v >= input.min) && (input.max === undefined || v <= input.max);
    case 'color': return typeof v === 'string' && /^(#[0-9a-f]{3,8}|rgba?\(.*\))$/i.test(v);
    default: return typeof v === 'string' && v !== '' && (!input.options || input.options.includes(v));
  }
}

// Unknown ids are dropped, missing ids filled from defaults, wrong-typed or out-of-range values replaced by defaults.
export function loadValues(storage) {
  const values = defaultValues();
  let saved = null;
  try { saved = JSON.parse(storage.getItem(STORAGE_KEY)); } catch { /* corrupt or absent: defaults */ }
  if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
    for (const input of INPUTS) if (input.id in saved && validFor(input, saved[input.id])) values[input.id] = saved[input.id];
  }
  return values;
}

export function saveValues(storage, values) {
  const clean = {};
  for (const input of INPUTS) clean[input.id] = validFor(input, values[input.id]) ? values[input.id] : input.def;
  storage.setItem(STORAGE_KEY, JSON.stringify(clean));
}
