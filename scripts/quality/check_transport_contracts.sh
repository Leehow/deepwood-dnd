#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"

check_empty_match() {
  local label="$1"
  local cmd="$2"
  local output
  output=$(eval "$cmd" || true)
  if [[ -n "$output" ]]; then
    echo "[FAIL] ${label}"
    echo "$output"
    exit 1
  fi
  echo "[PASS] ${label}"
}

check_empty_match \
  "Frontend transport identity params (X-User-ID/user_id/role)" \
  "rg -n --no-heading --color never 'X-User-ID|\\?user_id=|&user_id=|\\?role=|&role=' frontend/app"

check_empty_match \
  "Backend route identity aliases/queries" \
  "rg -n --no-heading --color never 'alias=\"X-User-ID\"|\\buser_id\\s*:\\s*.*Query\\(|\\brole\\s*:\\s*.*Query\\(' backend/app/api/routes"

raw_dispatch_matches=$(rg -n --no-heading --color never "window\\.dispatchEvent\\(new CustomEvent" frontend/app || true)
if [[ -n "$raw_dispatch_matches" ]]; then
  filtered=$(echo "$raw_dispatch_matches" | rg -v "frontend/app/(events/appEventBus.ts|utils/openEventBridge.ts|components/map/DamageNumberOverlay.tsx)" || true)
  if [[ -n "$filtered" ]]; then
    echo "[FAIL] Raw CustomEvent dispatch found outside allowlist"
    echo "$filtered"
    exit 1
  fi
fi

echo "[PASS] Raw CustomEvent dispatch only appears in allowlisted bridge files"
echo "Contract checks passed."
