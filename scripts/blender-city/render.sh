#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BLENDER_BIN="${BLENDER_BIN:-/opt/homebrew/bin/blender}"

"$BLENDER_BIN" \
  -b \
  --factory-startup \
  --python-exit-code 1 \
  --python "$SCRIPT_DIR/build_city.py" \
  -- "$@"
