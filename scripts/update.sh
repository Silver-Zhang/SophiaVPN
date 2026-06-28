#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if command -v git >/dev/null 2>&1 && [[ -d "$ROOT_DIR/.git" ]]; then
  git pull --ff-only
else
  echo "No git repository found at $ROOT_DIR; skipping git pull."
fi

"$ROOT_DIR/scripts/install.sh"
