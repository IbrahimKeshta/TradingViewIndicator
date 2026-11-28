# Changelog

Release notes for everything in this repository that someone installs: the four Pine indicators and the
ThndrX userscripts. Research code under `tools/backtest`, the dashboard and the forward scanner are not
released; their changes live in their own READMEs and in the pull requests.

## How this file works

The format is [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Each component has its own
[Semantic Version](https://semver.org/), because each is installed on its own.

| Slug | Component | Files | Version also in | Git tag |
|---|---|---|---|---|
| `ict` | ICT + RSI/MA Confluence and its Strategy Tester twin | `src/ict-rsi-ma-indicator.pine`, `src/ict-rsi-ma-strategy.pine` (generated) | — | `ict/vX.Y.Z` |
| `sof` | Session Order Flow | `src/session-orderflow.pine` | — | `sof/vX.Y.Z` |
| `egx-trust` | EGX Trust Score | `src/egx-trust-indicator.pine` | — | `egx-trust/vX.Y.Z` |
| `gann` | Gann Angles | `src/gann-angles.pine` | — | `gann/vX.Y.Z` |
| `thndrx` | ThndrX userscripts (ICT and SOF overlays, built together) | `tools/thndrx/` | `tools/thndrx/VERSION` | `thndrx/vX.Y.Z` |

What a version number promises someone who already has the script on a chart:

- **Major**: they must act. An input was removed, renamed or retyped (TradingView drops its saved value), an
  alert was removed or renamed (their alerts stop firing), or a default changed so their chart now shows
  different setups or trades.
- **Minor**: something new, and their chart looks the same until they switch it on.
- **Patch**: a fix. If the fix changes setups or trades, the entry starts with **Behaviour change:**.

Every change goes under `[Unreleased]` in the pull request that makes it, written for the user, not the
coder. `node tools/release/changelog.mjs check` validates the file; `notes <slug>` prints a release's notes.

## ict — ICT + RSI/MA Confluence

### [Unreleased]

### [1.0.0] - 2026-11-26

First versioned release: the script as of pull request #15. Earlier work was not versioned.

#### Added

- Market structure engine: swings, BOS and CHoCH trend state, range state and the structure panel.
- Order blocks, fair value gaps and session killzones, scored into graded setups with entry zone, stop,
  targets and a trailing stop.
- Trade filters: higher-timeframe bias, displacement and confirmation, with a root-cause trade log (#2).
- Strategy Tester twin, generated from the indicator (#3).
- EGX Daily preset; the killzone point counts as earned under the preset (#6, #8).
- The second entry model (trail model) and its trade panel rows.

## sof — Session Order Flow

### [Unreleased]

### [1.0.0] - 2026-11-26

First versioned release: the script as of pull request #15. Earlier work was not versioned.

#### Added

- Session ranges, liquidity pools, a developing volume profile and an estimated volume delta, read as
  favourable / wait / avoid (#4).
- Optional experimental trade module, off by default (#4).
- Liquidity run entry model: pool run, EMA200 filter and 8-ATR trail (#12).

#### Fixed

- **Behaviour change:** the cumulative volume delta now accumulates correctly (#12).

## egx-trust — EGX Trust Score

### [Unreleased]

### [1.0.0] - 2026-11-26

First versioned release. This includes the "v2" profit-first scoring described in the README; v1 and v2
were research goals, not published versions.

#### Added

- Long-only pullback entries for EGX stocks, gated by the EGX30 or EGX70 index regime.
- Trust score per entry, running track record per score band, stop, first target and trail.
- Results panel split into tuning and test periods.

## gann — Gann Angles

### [Unreleased]

### [1.0.0] - 2026-11-26

First versioned release.

#### Added

- Gann price levels in three modes from an automatic or manual anchor, Square of 9 scaling, time cycles and
  the levels table.

## thndrx — ThndrX userscripts

### [Unreleased]

### [0.2.0] - 2026-11-26

#### Added

- Session Order Flow overlay on ThndrX's TradingView chart, using real intrabars from Thndr's datafeed (#15).

#### Fixed

- When both overlays load together, neither one gets stuck on "Loading…" any more. Install both scripts
  from the same build (#15).
- Closed-bar drawings no longer count the forming bar's intrabars (#15).

### [0.1.0] - 2026-11-26

#### Added

- The ICT + RSI/MA indicator drawn on ThndrX's TradingView chart, with the trade panel and settings UI (#11).
