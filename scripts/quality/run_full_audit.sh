#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT_DIR"

python scripts/quality/generate_health_snapshot.py
bash scripts/quality/check_transport_contracts.sh
bash scripts/quality/check_repo_hygiene.sh

echo "Quality audit baseline completed."
