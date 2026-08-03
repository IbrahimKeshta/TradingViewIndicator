# ICT + RSI/MA Confluence Indicator — Design

**Date:** 2026-08-04
**Status:** Approved for planning

## Purpose

A TradingView Pine Script indicator that combines classic technical analysis (RSI, Moving Average) with ICT (Inner Circle Trader) concepts — market structure, Fair Value Gaps, order blocks, and killzone sessions — into a single confluence-based signal with alerts. General-purpose: no assumed market or timeframe; all thresholds and sessions are configurable.

## Scope (v1)

- RSI + MA (standard technical indicators)
- Market structure: swing detection, BOS (Break of Structure) and CHoCH (Change of Character)
- Fair Value Gaps (FVG): 3-candle imbalance detection, auto-managed lifecycle
- Order blocks: last opposing candle before a structure-breaking move, auto-managed lifecycle
- Killzone sessions: London + New York, shaded on chart, timezone-configurable
- Confluence-based bullish/bearish signals combining all of the above
- TradingView alerts + on-chart visual markers

Explicitly out of scope for v1: backtestable strategy version (Strategy Tester), Asia session, additional ICT concepts (breaker blocks, optimal trade entry, liquidity pools beyond what structure/FVG/OB already imply). These can be follow-on work.

## Architecture

Single self-contained Pine Script v6 `indicator()`, overlay on the price chart. A reusable library split is deferred — not needed until/unless multiple scripts need to share this detection logic.

### Input groups
- RSI settings (length, overbought/oversold levels)
- MA settings (type, length)
- Market Structure settings (pivot lookback)
- FVG settings (max tracked, display toggle)
- Order Block settings (max tracked, display toggle)
- Killzone settings (session toggles, timezone string — default `"Africa/Cairo"`)
- Alerts/Display toggles (signal markers on/off)

### Modules
1. **RSI + MA** — standard calculation; RSI in a sub-pane, MA plotted on-chart.
2. **Market structure engine** — pivot-based swing detection (`ta.pivothigh`/`ta.pivotlow`, default lookback 5) tracks trend bias and labels BOS/CHoCH.
3. **FVG detector** — finds 3-candle imbalances, draws boxes, auto-removes on mitigation.
4. **Order block detector** — finds the last opposing-color candle before a structure-breaking move, draws boxes, auto-removes on mitigation.
5. **Killzone shading** — background shading for London + New York sessions, computed in a configurable timezone (default Egypt/`Africa/Cairo`).
6. **Confluence engine** — combines structure bias + retracement into a live FVG/OB + active killzone + RSI/MA agreement → bullish/bearish signal.
7. **Alerts & markers** — `alertcondition()` for bullish signal, bearish signal, and watch-zone heads-up; `plotshape` arrows/labels on confirmed signals.

## Detection Logic (Data Flow)

Evaluated per bar, in order:

1. **Swing pivots**: pivot high/low confirm with inherent lag (lookback bars on both sides) — this is expected, and is what keeps structure detection non-repainting.
2. **Structure bias**: a break of the most recent confirmed swing in the trend direction is a BOS; a break in the opposite direction flips bias (CHoCH). Bias persists until the next opposing break.
3. **FVG scan**: each new bar, check the 3-candle imbalance pattern; if found, draw a box from candle 1 to current bar. Removed the first time price trades back through it (mitigated).
4. **Order block scan**: triggered by a BOS/CHoCH — the last opposing-color candle before the impulsive move that caused the break becomes the order block box. Removed on mitigation, same rule as FVG.
5. **Killzone active**: boolean per bar based on session time in the configured timezone (London / New York ranges, independently toggleable).
6. **Confluence check**: bias set by BOS/CHoCH AND price currently inside an unmitigated FVG or OB formed during that structure move AND killzone active AND RSI/MA agree with bias direction → bullish or bearish signal fires once per setup (not every bar it remains true).
7. **Watch-zone heads-up**: fires earlier — price approaching an unmitigated FVG/OB during a killzone, before RSI/MA confirm — a lighter "pay attention" alert. Fires per-direction (bullish watch / bearish watch), matching the polarity of the zone being approached, same as the main confluence signals.

## Defaults

- RSI: length 14, overbought 70, oversold 30
- MA: 50-period EMA
- Pivot lookback: 5
- Killzones: London (02:00–05:00) + New York (07:00–10:00), computed in `Africa/Cairo` by default, timezone configurable
- Max tracked unmitigated FVGs / order blocks: 20 each (configurable), oldest dropped beyond the cap

## Error Handling & Limits

- **Repainting safety**: structure/FVG/OB detection only confirms on closed bars, so signals don't repaint after the fact.
- **Box/line caps**: TradingView limits drawable objects (500 boxes/lines per script). Tracked unmitigated FVGs and order blocks are capped (default 20 each), auto-deleting the oldest beyond that.
- **Session boundaries**: killzone shading uses Pine's built-in session/time functions with the configurable timezone, so daily resets and weekends are handled automatically.

## Testing / Verification

No automated test framework exists for Pine Script; verification is manual:

- Apply the script to a few symbols (e.g. EURUSD, BTCUSD, a stock) across a few timeframes (5m, 15m, 1H) to confirm RSI/MA, FVG/OB boxes, and killzone shading render correctly.
- Use TradingView's Bar Replay feature to confirm signals don't repaint — a signal on a historical bar should still show at the same bar when replayed live.
- Manually trigger each alert type via TradingView's "Create Alert" dialog to confirm all three alert conditions (bullish, bearish, watch-zone) are selectable and fire correctly.
