---
name: release-notes
description: Use when cutting a release of a Pine indicator or the ThndrX userscripts, bumping a version, writing release notes or a TradingView "publish update" text, tagging, creating a GitHub release, or when asked what changed since the last version or what version something is on. Also use when CHANGELOG.md, tools/thndrx/VERSION or a component/vX.Y.Z tag is involved.
---

# Release notes and versions

`CHANGELOG.md` is the source of truth for every version in this repo. Each shipped component has its own
SemVer and its own section; the table and the bump rules sit at the top of that file. Read them before
deciding a version, and use `tools/release/changelog.mjs` rather than parsing the file by eye.

Node is not on PATH here: prefix `export PATH="/c/Users/PC/AppData/Roaming/fnm/aliases/default:$PATH";` in Bash.

```bash
node tools/release/changelog.mjs status                         # newest version + pending entries per component
node tools/release/changelog.mjs check                          # exit 1 if the file or a VERSION file is inconsistent
node tools/release/changelog.mjs notes ict                      # markdown notes of the newest ict release
node tools/release/changelog.mjs notes ict 1.1.0 --format tradingview   # plain text for TradingView's update box
```

## Cutting a release

1. `status` → pick the component(s) with pending entries. Nothing pending = nothing to release.
2. Choose the bump from the `[Unreleased]` entries, using the rules at the top of `CHANGELOG.md`. The
   question is always "what must someone with this script already on a chart do?". Check the diff, not just
   the entries: `git diff <slug>/v<last>..HEAD -- <files>` (or since the release's date if the tag is absent).
   Any `input.*` call removed or renamed, an `alertcondition` title changed, or a default changed means **major**.
3. Rename `### [Unreleased]` to `### [X.Y.Z] - YYYY-MM-DD` (today) and put a fresh empty
   `### [Unreleased]` above it.
4. Component-specific steps:
   - `thndrx`: write the version to `tools/thndrx/VERSION`, run `node tools/thndrx/build.mjs`, commit both
     rebuilt `dist/*.user.js`. Tampermonkey only offers an update when `@version` goes up, so every change
     to `dist/` needs a new version.
   - `ict`: if the indicator changed, the generated `src/ict-rsi-ma-strategy.pine` must be rebuilt
     (`powershell -NoProfile -ExecutionPolicy Bypass -File tools/build-strategy.ps1`; `-Check` verifies it
     is current) in the same release.
5. Verify: `changelog.mjs check` and `node --test tools/release/ tools/thndrx/` pass.
6. Commit as `release(<slug>): vX.Y.Z` (one commit per component).
7. **Stop and ask the user** before anything that leaves the machine. Show them the notes and the exact commands:
   ```bash
   git tag -a <slug>/vX.Y.Z -m "<title> X.Y.Z"
   git push origin <slug>/vX.Y.Z
   node tools/release/changelog.mjs notes <slug> X.Y.Z > /tmp/notes.md
   gh release create <slug>/vX.Y.Z --title "<title> X.Y.Z" --notes-file /tmp/notes.md
   ```
   For a Pine component, also give them `--format tradingview` output: they paste it into TradingView's
   *Publish → Update* box themselves. You cannot publish to TradingView.

## Writing an entry

Entries are for the person using the indicator. Say what they will see or must do, not how the code changed.

| Instead of | Write |
|---|---|
| Refactored stop calculation into `calcStop()` | (nothing: no user-visible change, no entry) |
| Fixed off-by-one in killzone index | **Behaviour change:** setups in the last killzone bar of the session now count it as in the killzone |
| Renamed `atrLen` input | **Breaking:** the "ATR Length" input is now "Stop ATR Length"; re-enter your value |

Mention the PR number at the end of an entry: `(#16)`.

## Common mistakes

- Bumping `tools/thndrx/VERSION` without a matching `CHANGELOG.md` release (or the reverse). `check` fails on it.
- One version for the whole repo. Components are installed separately; each has its own.
- Releasing `ict` without rebuilding the strategy twin, so the Tester runs old logic.
- Tagging or creating the GitHub release without the user's go-ahead.
- Calling a default change "minor" because nothing was added. A changed default changes users' charts: major.
