#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"

fail_on_tracked() {
  local label="$1"
  local pattern="$2"
  local tracked
  tracked=$(git ls-files "$pattern")
  if [[ -n "$tracked" ]]; then
    echo "[FAIL] ${label}"
    echo "$tracked"
    exit 1
  fi
  echo "[PASS] ${label}"
}

fail_on_tracked "No tracked virtualenv files" "backend/venv/**"
fail_on_tracked "No tracked logs" "logs/**"
fail_on_tracked "No tracked tmp artifacts" "tmp/**"
fail_on_tracked "No tracked output artifacts" "output/**"

echo "Repository hygiene checks passed."
