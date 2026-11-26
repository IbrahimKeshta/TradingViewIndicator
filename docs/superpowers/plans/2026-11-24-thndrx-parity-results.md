# ThndrX overlay — parity with the Pine on TradingView (Task 9)

Date: 2026-11-24. TradingView driven with Playwright on the user's account (Basic plan), in a fresh **unsaved**
layout (never saved). Script: `src/ict-rsi-ma-indicator.pine` pasted into the Pine Editor (2147 lines, status bar
`Line 2148, Col 1`), added to the chart, no compile errors. **ADJ on** (dividend-adjusted), so TradingView's bars equal
the `fetch-egx.mjs ADJ=dividends` CSVs the Node side reads (`G:/TradingViewIndicator/data/egx-div-1d-parity`).

Node side: `node tools/thndrx/parity.mjs --data <dir> --symbol <SYM> --tf 1D [--preset 'EGX Daily']`, which runs the
overlay's own `runPlanEngine` + `buildRenderPlan` and prints the panel rows.

Criterion (ruling R23): every panel row equal, text for text. The PERFORMANCE block pins the full closed-trade record
(n, wins, losses, average and total R to two decimals, and the per-grade split), which only matches if the trades do.
The Pine Logs download was not reachable from automation this session; it was not needed once the panels matched.

## Results

| Case | TradingView panel | Node panel | Match |
|---|---|---|---|
| COMI 1D, defaults | DOWN · no · CHoCH · INTERNAL · 1.0x · pullback · Mom ✗ Part ✗ Ichi ✗ · L · no zone touch · 2/7 · n = 130 · 38% (50W / 80L) · +0.09R · +11.54R · A +0.28R (14) · B +0.15R (57) · C −0.01R (59) | identical | ✅ |
| COMI 1D, EGX Daily | same structure rows · PERFORMANCE · EGX DAILY · n = 41 · 54% (22W / 19L) · +0.86R · +35.36R · A +1.43R (1) · B +0.98R (20) · C +0.72R (20) | identical | ✅ |
| VLMRA 1D, EGX Daily | DOWN · no · BOS · INTERNAL · 0.6x · aligned · Mom ✗ Part ✗ Ichi ✓ · S · no zone touch · 4/7 · n = 16 · 25% (4W / 12L) · −0.27R · −4.33R · A −1.86R (1) · B −0.10R (10) · C −0.30R (5) | identical | ✅ |
| VLMRA 1D, defaults | live TRADE block SHORT · C · 5/7 · Entry 27.41 · 1.6x ATR · Stop 25.60 · BE+ · 1.5R · TP1/TP2 25.00 ✓ (2.0R) 23.78 ✓ (2.9R) · TP3 21.16 (5.1R) · Open R 2.28R · n = 24 · 33% (8W / 16L) · −0.05R · −1.28R · A +0.50R (2) · B +0.02R (15) · C −0.38R (7) | identical | ✅ |

Screenshots (local only): `.playwright-mcp/tv-comi-1d.png`, `tv-comi-egx.png`, `tv-vlmra-egx.png`,
`tv-vlmra-custom.png`.

## Not covered

- **Intraday:** TradingView's Basic plan blocks intraday intervals on EGX ("Unlock intraday intervals"), so the 60m
  cases could not be run against the Pine (ruling R24). Intraday rests on the Node unit tests (HTF resampling anchored
  at the 10:00 session open, killzone bands equal to the engine's session series, `futureTime`) and the live ThndrX
  run on 60m (`2026-11-24-thndrx-live-results.md`).
- **Colour hex values and `-0.0` formatting** were not pinned against TradingView's renderer; on screen the overlay's
  colours read the same as TradingView's at a glance.
- TMGH and SWDY (ruling R13).
