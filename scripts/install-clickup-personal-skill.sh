#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SOURCE_SKILL_DIR="$REPO_ROOT/ops/personal-skills/clickup-pro"

if [[ ! -f "$SOURCE_SKILL_DIR/SKILL.md" ]]; then
    echo "Missing source skill template at $SOURCE_SKILL_DIR/SKILL.md" >&2
    exit 1
fi

TARGET_ROOT="${1:-$HOME/.agents/skills}"
TARGET_SKILL_DIR="$TARGET_ROOT/clickup-pro"

mkdir -p "$TARGET_SKILL_DIR"
cp "$SOURCE_SKILL_DIR/SKILL.md" "$TARGET_SKILL_DIR/SKILL.md"

if [[ -d "$REPO_ROOT/skills/clickup-pro/scripts" ]]; then
    rm -rf "$TARGET_SKILL_DIR/scripts"
    cp -R "$REPO_ROOT/skills/clickup-pro/scripts" "$TARGET_SKILL_DIR/scripts"
fi

chmod 755 "$TARGET_SKILL_DIR"
chmod 644 "$TARGET_SKILL_DIR/SKILL.md"

echo "Installed personal ClickUp override to $TARGET_SKILL_DIR"
echo "Restart OpenClaw or start a new session so the override is picked up."
