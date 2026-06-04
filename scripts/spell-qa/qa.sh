#!/usr/bin/env bash
# QA arena helpers. Requires QA_MODE=true backend and env:
#   QA_API_ORIGIN (default http://localhost:8174)
#   QA_TOKEN      (bearer token for the test DM; never commit it)
set -euo pipefail
API="${QA_API_ORIGIN:-http://localhost:8174}"
AUTH="Authorization: Bearer ${QA_TOKEN:?set QA_TOKEN}"

case "${1:-}" in
  seed)   curl -s -X POST "$API/api/qa/seed" -H "$AUTH" ;;
  reset)  curl -s -X POST "$API/api/qa/reset" -H "$AUTH" -H "Content-Type: application/json" \
            -d "{\"campaign_id\": ${2:?campaign_id}, \"spell_id\": \"${3:-}\"}" ;;
  forced) curl -s -X POST "$API/api/qa/forced-roll" -H "$AUTH" -H "Content-Type: application/json" \
            -d "{\"rolls\": [${2:?comma-separated rolls}]}" ;;
  snap)   curl -s "$API/api/qa/snapshot?campaign_id=${2:?campaign_id}" -H "$AUTH" ;;
  *) echo "usage: qa.sh {seed|reset <cid> [spell]|forced <r1,r2>|snap <cid>}" >&2; exit 2 ;;
esac
