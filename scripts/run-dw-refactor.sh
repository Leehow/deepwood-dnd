#!/bin/bash

set -euo pipefail

REPO_ROOT="/Users/haoli/leehow/code/dw"
PROFILE="dw-big-refactor"
SKILL='$dw-big-refactor'
LOOP_MODE="true"
MAX_PASSES=8
MIN_PASSES=2
RUN_ID=""
RUN_DIR=""
STATE_FILE=""
HANDOFF_FILE=""
FINAL_SUMMARY_FILE=""
FINAL_SUMMARY_JSON=""
PASS_LOG_DIR=""

usage() {
  cat <<'EOF'
Usage:
  ./scripts/run-dw-refactor.sh [--modules] [--single-pass] [--max-passes N] [--min-passes N] [--run-id ID] "your refactor task"

Examples:
  ./scripts/run-dw-refactor.sh "继续拆 combat.py 的输出层并补回归"
  ./scripts/run-dw-refactor.sh --modules "继续拆 modules.py 的 translate 和 embed 任务流"
  ./scripts/run-dw-refactor.sh --modules --max-passes 12 "继续拆 modules.py 剩余 websocket parse 主流程"
EOF
}

if ! command -v codex >/dev/null 2>&1; then
  echo "Error: codex command not found" >&2
  exit 1
fi

if [[ $# -eq 0 ]]; then
  usage
  exit 1
fi

ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --modules)
      PROFILE="dw-big-refactor"
      SKILL='$dw-modules-refactor'
      shift
      ;;
    --single-pass)
      LOOP_MODE="false"
      shift
      ;;
    --max-passes)
      MAX_PASSES="${2:-}"
      shift 2
      ;;
    --min-passes)
      MIN_PASSES="${2:-}"
      shift 2
      ;;
    --run-id)
      RUN_ID="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      ARGS+=("$1")
      shift
      ;;
  esac
done

if [[ ${#ARGS[@]} -eq 0 ]]; then
  usage
  exit 1
fi

TASK="${ARGS[*]}"

if [[ -z "${RUN_ID}" ]]; then
  RUN_ID="$(date +%Y%m%d-%H%M%S)"
fi

RUN_DIR="${REPO_ROOT}/logs/refactor-runs/${RUN_ID}"
STATE_FILE="${RUN_DIR}/state.json"
HANDOFF_FILE="${RUN_DIR}/handoff.md"
FINAL_SUMMARY_FILE="${RUN_DIR}/final-summary.md"
FINAL_SUMMARY_JSON="${RUN_DIR}/final-summary.json"
PASS_LOG_DIR="${RUN_DIR}/passes"

mkdir -p "${RUN_DIR}"
mkdir -p "${PASS_LOG_DIR}"

python - "${STATE_FILE}" "${HANDOFF_FILE}" "${TASK}" "${SKILL}" "${MAX_PASSES}" <<'PY'
import json
import sys
from datetime import datetime
from pathlib import Path

state_path, handoff_path, task, skill, max_passes = sys.argv[1:]

state = {
    "status": "continue",
    "initial_task": task,
    "next_task": task,
    "current_hotspot": "",
    "remaining_queue": [],
    "handoff_summary": "Run initialized",
    "scope_exhausted": False,
    "blocker": "",
    "completed_passes": 0,
    "max_passes": int(max_passes),
    "skill": skill,
    "updated_at": datetime.now().isoformat(),
}

Path(state_path).write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
Path(handoff_path).write_text(
    "# Refactor Handoff\n\n"
    f"- Initial task: {task}\n"
    "- Current hotspot:\n"
    "- Completed passes:\n"
    "- Pending slices:\n",
    encoding="utf-8",
)
PY

build_prompt() {
  local pass_no="$1"
  local current_task="$2"
  cat <<EOF
Use ${SKILL} for the repository at ${REPO_ROOT}.

This is autonomous refactor pass ${pass_no}/${MAX_PASSES}.
Read these files first:
- ${STATE_FILE}
- ${HANDOFF_FILE}

Current task for this pass:
${current_task}

Rules for this pass:
- Continue autonomously in grouped batches.
- Do not stop just because one internal task chain is finished if the same hotspot still has a clear adjacent slice.
- If the first batch in this pass is narrow, keep going into the next adjacent slice in the same pass when practical.
- Do not end with “the next step would be ...” unless you are blocked or the hotspot is genuinely exhausted.
- Before finishing this pass, you MUST update ${HANDOFF_FILE} with what changed, validations run, and remaining slices.
- Before finishing this pass, you MUST update ${STATE_FILE} as valid JSON with:
  - status: continue | done | blocked
  - next_task: the next unresolved slice if status=continue
  - current_hotspot: the route, shell, or subsystem currently being thinned
  - remaining_queue: ordered unresolved adjacent slices
  - handoff_summary: short summary of what this pass changed
  - scope_exhausted: true only when the requested hotspot or scope is genuinely exhausted
  - blocker: empty unless status=blocked
  - completed_passes: incremented total
  - updated_at: ISO timestamp
- Set status=continue by default if there is any clear adjacent unresolved slice in the same hotspot or roadmap chain.
- Set status=done only when the requested scope or current hotspot is genuinely exhausted and remaining_queue is empty or intentionally deferred.
- Set status=blocked only for a real blocker.
EOF
}

read_state_json() {
  python - "${STATE_FILE}" <<'PY'
import json
import sys
from pathlib import Path

state_path = sys.argv[1]
data = json.loads(Path(state_path).read_text(encoding="utf-8"))
print(json.dumps(data, ensure_ascii=False))
PY
}

normalize_state_after_pass() {
  python - "${STATE_FILE}" "${TASK}" "${pass_no}" "${MIN_PASSES}" <<'PY'
import json
import sys
from datetime import datetime
from pathlib import Path

state_path, initial_task, pass_no, min_passes = sys.argv[1:]
path = Path(state_path)
data = json.loads(path.read_text(encoding="utf-8"))

status = data.get("status", "continue")
scope_exhausted = bool(data.get("scope_exhausted", False))
remaining_queue = data.get("remaining_queue") or []
next_task = (data.get("next_task") or "").strip()
blocker = (data.get("blocker") or "").strip()

if not next_task and remaining_queue:
    next_task = str(remaining_queue[0]).strip()

if not next_task:
    next_task = initial_task

if status == "done":
    should_force_continue = (not scope_exhausted) or bool(remaining_queue) or int(pass_no) < int(min_passes)
    if should_force_continue:
        data["status"] = "continue"
        data["next_task"] = next_task
        if int(pass_no) < int(min_passes) and not remaining_queue:
            data["handoff_summary"] = (
                (data.get("handoff_summary") or "").strip()
                + " | driver forced another pass to avoid stopping too early"
            ).strip(" |")

elif status == "blocked" and not blocker:
    data["status"] = "continue"
    data["next_task"] = next_task
    data["handoff_summary"] = (
        (data.get("handoff_summary") or "").strip()
        + " | driver ignored empty-blocker blocked state"
    ).strip(" |")
else:
    data["next_task"] = next_task

data.setdefault("current_hotspot", "")
data.setdefault("remaining_queue", remaining_queue)
data.setdefault("scope_exhausted", False)
data["updated_at"] = datetime.now().isoformat()

path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
PY
}

write_final_summary() {
  python - "${STATE_FILE}" "${HANDOFF_FILE}" "${FINAL_SUMMARY_FILE}" "${FINAL_SUMMARY_JSON}" "${RUN_ID}" "${PASS_LOG_DIR}" <<'PY'
import json
import sys
from pathlib import Path

state_path, handoff_path, summary_md_path, summary_json_path, run_id, pass_log_dir = sys.argv[1:]

state = json.loads(Path(state_path).read_text(encoding="utf-8"))
handoff = Path(handoff_path).read_text(encoding="utf-8")
pass_logs = sorted(p.name for p in Path(pass_log_dir).glob("pass-*.log"))

payload = {
    "run_id": run_id,
    "status": state.get("status"),
    "initial_task": state.get("initial_task"),
    "current_hotspot": state.get("current_hotspot"),
    "completed_passes": state.get("completed_passes"),
    "scope_exhausted": state.get("scope_exhausted"),
    "handoff_summary": state.get("handoff_summary"),
    "blocker": state.get("blocker"),
    "remaining_queue": state.get("remaining_queue") or [],
    "updated_at": state.get("updated_at"),
    "pass_logs": pass_logs,
}

Path(summary_json_path).write_text(
    json.dumps(payload, ensure_ascii=False, indent=2),
    encoding="utf-8",
)

remaining_queue = payload["remaining_queue"]
remaining_lines = "\n".join(f"- {item}" for item in remaining_queue) if remaining_queue else "- None"
pass_log_lines = "\n".join(f"- {name}" for name in pass_logs) if pass_logs else "- None"

summary_md = f"""# Refactor Run Summary

- Run ID: {run_id}
- Status: {payload['status']}
- Completed passes: {payload['completed_passes']}
- Current hotspot: {payload['current_hotspot'] or '(not set)'}
- Scope exhausted: {payload['scope_exhausted']}
- Updated at: {payload['updated_at']}

## Summary

{payload['handoff_summary'] or '(no summary)'}

## Remaining Queue

{remaining_lines}

## Pass Logs

{pass_log_lines}

## Handoff

{handoff}
"""

Path(summary_md_path).write_text(summary_md, encoding="utf-8")
PY
}

run_pass() {
  local pass_no="$1"
  local prompt="$2"
  local pass_log="${PASS_LOG_DIR}/pass-${pass_no}.log"
  codex exec --profile "${PROFILE}" "${prompt}" 2>&1 | tee "${pass_log}"
}

cd "${REPO_ROOT}"

if [[ "${LOOP_MODE}" == "false" ]]; then
  PROMPT="$(build_prompt 1 "${TASK}")"
  run_pass 1 "${PROMPT}"
  write_final_summary
  echo "Final summary: ${FINAL_SUMMARY_FILE}"
  exit 0
fi

pass_no=1
while (( pass_no <= MAX_PASSES )); do
  current_task="$(python - "${STATE_FILE}" <<'PY'
import json
import sys
from pathlib import Path

data = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
print((data.get("next_task") or "").strip())
PY
)"
  if [[ -z "${current_task}" ]]; then
    current_task="${TASK}"
  fi

  PROMPT="$(build_prompt "${pass_no}" "${current_task}")"
  run_pass "${pass_no}" "${PROMPT}"
  normalize_state_after_pass

  status="$(python - "${STATE_FILE}" <<'PY'
import json
import sys
from pathlib import Path

data = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
print(data.get("status", "continue"))
PY
)"
  case "${status}" in
    done)
      write_final_summary
      echo "Final summary: ${FINAL_SUMMARY_FILE}"
      exit 0
      ;;
    blocked)
      write_final_summary
      echo "Final summary: ${FINAL_SUMMARY_FILE}"
      exit 2
      ;;
    continue)
      pass_no=$((pass_no + 1))
      ;;
    *)
      echo "Error: invalid refactor state status '${status}' in ${STATE_FILE}" >&2
      exit 3
      ;;
  esac
done

write_final_summary
echo "Final summary: ${FINAL_SUMMARY_FILE}"
echo "Error: reached max passes (${MAX_PASSES}) before state became done/blocked" >&2
exit 4
