#!/usr/bin/env bash
# PreToolUse hook (Bash and PowerShell): refuse `gh pr create` until the docs-sync skill has run.
# Proof is a line starting "Docs-sync:" in the PR body, given inline (--body) or via --body-file / -F.
# Reads the tool call as JSON on stdin; no jq on this machine, so it matches the raw text.
in=$(cat)

case "$in" in
  *"gh pr create"*) ;;
  *) exit 0 ;;
esac

case "$in" in
  *"Docs-sync:"*) exit 0 ;;
esac

# --body-file <path> / -F <path>: look inside the file. Paths with backslashes are JSON-escaped in the
# payload, so un-double them before reading.
file=$(printf '%s' "$in" | sed -nE 's/.*(--body-file|[[:space:]]-F)[= ]+(\\"|'"'"')?([^ "'"'"']+).*/\3/p' | head -n1)
file=${file%\\}
file=${file//\\\\/\\}
if [ -n "$file" ] && [ -f "$file" ] && grep -q "Docs-sync:" "$file"; then
  exit 0
fi

cat <<'JSON'
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Blocked: run the docs-sync skill before opening a PR. Update README.md + README.ar.md, CHANGELOG.md [Unreleased], CLAUDE.md and project skills as the diff requires, then end the PR body with a '## Docs' section containing a line 'Docs-sync: <what was updated, or why nothing was>'."}}
JSON
exit 0
