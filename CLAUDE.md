# TradingView indicators: project context

Four Pine Script v6 indicators (`src/*.pine`), a generated Strategy Tester twin, Node ports of two of them
(`tools/backtest/`), and ThndrX userscripts that draw those two on Thndr's chart (`tools/thndrx/`).
README.md is the user manual; README.ar.md is its Arabic mirror.

## Rules

- **Every PR ships its docs.** Run the `docs-sync` skill before `gh pr create`; a hook blocks the PR until
  the body has a `Docs-sync:` line. README.md and README.ar.md always change together.
- **Pine and ThndrX move together.** A change to `src/ict-rsi-ma-indicator.pine` or `src/session-orderflow.pine`
  is ported to its engine (`tools/backtest/ict-engine.mjs` / `sof-engine.mjs`) and `tools/thndrx/` in the same PR.
- **Versions live in CHANGELOG.md**, one SemVer per component; changes go under `[Unreleased]` in the PR that
  makes them. Releases, tags and TradingView update notes: the `release-notes` skill. Never tag, push a tag or
  create a GitHub release without the user's go-ahead.
- `src/ict-rsi-ma-strategy.pine` is generated: edit the indicator or `src/strategy-layer.pine`, then rebuild.
- Pine has no compiler or test runner here. A Pine change is verified by careful read-back and, when
  possible, live on TradingView; never claim it compiles without having seen it compile.

## Commands

Node is not on PATH. In Bash: `export PATH="/c/Users/PC/AppData/Roaming/fnm/aliases/default:$PATH"`.

```bash
node --test tools/thndrx/ tools/backtest/ tools/release/        # unit tests
node tools/thndrx/build.mjs                                     # rebuild both userscripts into tools/thndrx/dist/
node tools/release/changelog.mjs check | status | notes <slug>  # changelog validation and release notes
powershell -NoProfile -ExecutionPolicy Bypass -File tools/build-strategy.ps1 [-Check]   # strategy twin
```

## Where to read more

- Indicator behaviour, settings, alerts: README.md
- Backtest engine and data: `tools/backtest/README.md`; ThndrX build and install: `tools/thndrx/README.md`
- Design specs and plans: `docs/superpowers/specs/`, `docs/superpowers/plans/`
