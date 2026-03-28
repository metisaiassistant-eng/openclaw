#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
USER_TEMPLATE="$REPO_ROOT/ops/personal-workspace/USER.template.md"
WORKSPACE_OVERRIDE="${1:-}"
SKILL_TARGET_ROOT="${2:-$HOME/.agents/skills}"

if [[ ! -f "$USER_TEMPLATE" ]]; then
    echo "Missing USER.md template at $USER_TEMPLATE" >&2
    exit 1
fi

resolve_workspace() {
    if [[ -n "$WORKSPACE_OVERRIDE" ]]; then
        printf '%s\n' "$WORKSPACE_OVERRIDE"
        return 0
    fi

    if command -v openclaw >/dev/null 2>&1; then
        local raw resolved
        raw="$(openclaw config get agents.defaults.workspace 2>/dev/null || true)"
        resolved="$(python3 - "$raw" <<'PY'
import os
import sys

raw = sys.argv[1].replace("\r", "").strip()
if not raw or raw.startswith("Config path not found"):
    raise SystemExit(1)
if raw.startswith('"') and raw.endswith('"'):
    raw = raw[1:-1]
print(os.path.expanduser(raw))
PY
        )" || true
        if [[ -n "$resolved" ]]; then
            printf '%s\n' "$resolved"
            return 0
        fi
    fi

    printf '%s\n' "$HOME/.openclaw/workspace"
}

WORKSPACE_DIR="$(resolve_workspace)"
mkdir -p "$WORKSPACE_DIR"

if [[ -f "$WORKSPACE_DIR/USER.md" ]] && ! cmp -s "$USER_TEMPLATE" "$WORKSPACE_DIR/USER.md"; then
    backup="$WORKSPACE_DIR/USER.md.bak.$(date +%Y%m%d-%H%M%S)"
    cp "$WORKSPACE_DIR/USER.md" "$backup"
    echo "Backed up existing USER.md to $backup"
fi

cp "$USER_TEMPLATE" "$WORKSPACE_DIR/USER.md"
echo "Installed USER.md to $WORKSPACE_DIR/USER.md"

OPENCLAW_SKIP_TIMEZONE_HINT=1 bash "$REPO_ROOT/scripts/install-clickup-personal-skill.sh" "$SKILL_TARGET_ROOT"

if command -v openclaw >/dev/null 2>&1; then
    openclaw config set agents.defaults.userTimezone America/Costa_Rica
    echo "Set agents.defaults.userTimezone to America/Costa_Rica"
else
    echo "Recommended follow-up: openclaw config set agents.defaults.userTimezone America/Costa_Rica"
fi

echo "METIS personal overrides installed. Restart OpenClaw or start a new session so the changes are picked up."
