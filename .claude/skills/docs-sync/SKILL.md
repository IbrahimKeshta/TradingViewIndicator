---
name: docs-sync
description: Use before opening or updating any pull request in this repo (gh pr create is blocked until it has run), and whenever a Pine script, ThndrX userscript, tool, input, alert, default, command or repo convention changed and the README, README.ar.md, CHANGELOG.md, CLAUDE.md or a project skill might now be stale.
---

# Docs sync before every PR

A pull request ships its documentation with it. Before `gh pr create`, walk the diff, update every document
it made stale, and record the result in the PR body. A hook (`.claude/hooks/require-docs-sync.sh`) refuses
`gh pr create` unless the body contains a line starting `Docs-sync:`, so the line is the proof the pass ran,
not a formality.

## 1. List what changed

```bash
git fetch origin master -q
git diff --name-only origin/master...HEAD; git status --short
```

## 2. Map each changed path to the documents it can stale

| Changed | Check and update |
|---|---|
| `src/<script>.pine` | README.md section for that script: settings table (input names, defaults, groups), alerts table, "Reading the chart", diagrams in `docs/img/*.svg` (hand-made: edit the SVG so it matches what the chart draws). **Then the same sections in README.ar.md.** CHANGELOG `[Unreleased]` for that component. |
| `src/ict-rsi-ma-indicator.pine` or `src/session-orderflow.pine` | Everything above, plus the ThndrX port: engine (`tools/backtest/ict-engine.mjs` / `sof-engine.mjs`), `tools/thndrx/` (inputs, UI), `tools/thndrx/README.md`, and a `thndrx` CHANGELOG entry. Pine and ThndrX change in the same PR. |
| `src/ict-rsi-ma-indicator.pine` or `src/strategy-layer.pine` | Rebuild the strategy twin; `tools/build-strategy.ps1 -Check` must pass. |
| `tools/thndrx/**` | `tools/thndrx/README.md`; README.md and README.ar.md "ThndrX overlay" sections if install or behaviour changed; `thndrx` CHANGELOG entry. |
| `tools/backtest/**`, `tools/dashboard/**`, `forward/**` | That folder's README (commands, options, output). Not released: no CHANGELOG entry. |
| A new component, script, tool folder or command | README.md + README.ar.md script table and repo layout; CHANGELOG component table and section; CLAUDE.md; the component lists in `.claude/skills/*`. |
| A convention, workflow or gotcha changed (how to build, test, release, where things live) | CLAUDE.md, and any project skill that states the old way. |

README.ar.md mirrors README.md section for section. Translate a changed section; keep script names, input
names, alert titles and code in English, as the existing file does. If you cannot translate it well, copy the
English paragraph into the Arabic file with a `<!-- TODO: translate -->` comment and say so in the PR, rather
than leaving the Arabic stale.

## 3. CHANGELOG entry

For every released component the diff touches (see the table at the top of `CHANGELOG.md`), add a bullet
under its `### [Unreleased]`, in the right `#### Added/Changed/Fixed/Removed` group, written for the user.
Prefix **Breaking:** or **Behaviour change:** where the release-notes rules say so. No user-visible change
(refactor, comments, tests) means no entry. Do not bump versions here: that is the `release-notes` skill.

Then run `node tools/release/changelog.mjs check` (Node: `export PATH="/c/Users/PC/AppData/Roaming/fnm/aliases/default:$PATH"`).

## 4. Context files

- **CLAUDE.md** holds what every session in this repo must know (layout, commands, rules). Update it when a
  path, command or rule it states is no longer true, or a new rule was agreed. Keep it short: link to the
  README or a skill instead of copying them.
- **Project skills** (`.claude/skills/*/SKILL.md`): fix any path, command or component list the diff made wrong.
- Personal or machine facts (plan tier, local paths, what was tried) go to memory, not the repo.

## 5. Record it in the PR body

End the PR body with a Docs section. The `Docs-sync:` line names what was updated, or why nothing was:

```markdown
## Docs
Docs-sync: README.md + README.ar.md (Session Order Flow settings), CHANGELOG sof + thndrx, tools/thndrx/README.md
```

```markdown
## Docs
Docs-sync: no doc impact (test-only change in tools/backtest)
```

Pass the body inline (`--body "$(cat <<'EOF' ... EOF)"`) or with `--body-file <path>`; the hook reads both.

## Common mistakes

- Updating README.md and forgetting README.ar.md. They always move together.
- A settings-table default that no longer matches the `input.*` default in the script. Check them side by side.
- Writing `Docs-sync: done`. Name the files, so a reviewer can check them.
- Changing a Pine script without the ThndrX port, or the reverse.
- Putting a release version bump in a feature PR. Entries go under `[Unreleased]`; releases are separate.
