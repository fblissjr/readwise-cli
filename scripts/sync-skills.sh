#!/bin/bash
# Sync skills from readwise-skills repo into this CLI's skills/ directory.
# Usage: ./scripts/sync-skills.sh [path-to-readwise-skills]

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLI_ROOT="$(dirname "$SCRIPT_DIR")"
SKILLS_REPO="${1:-$(dirname "$CLI_ROOT")/readwise-skills}"

if [ ! -d "$SKILLS_REPO/skills" ]; then
  echo "Error: readwise-skills repo not found at $SKILLS_REPO"
  echo "Usage: $0 [path-to-readwise-skills]"
  exit 1
fi

echo "Syncing skills from $SKILLS_REPO/skills/ → $CLI_ROOT/skills/"

rm -rf "$CLI_ROOT/skills"
mkdir -p "$CLI_ROOT/skills"

for skill_dir in "$SKILLS_REPO/skills"/*/; do
  skill_name=$(basename "$skill_dir")
  if [ -f "$skill_dir/SKILL.md" ]; then
    mkdir -p "$CLI_ROOT/skills/$skill_name"
    cp "$skill_dir/SKILL.md" "$CLI_ROOT/skills/$skill_name/SKILL.md"
    echo "  ✓ $skill_name"
  fi
done

echo "Done."
