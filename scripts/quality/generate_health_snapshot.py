#!/usr/bin/env python3
"""Generate a reproducible architecture health snapshot for the DW monorepo."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def run(cmd: str, cwd: Path | None = None) -> tuple[int, str, str]:
    proc = subprocess.run(
        ["/bin/zsh", "-lc", cmd],
        cwd=str(cwd or ROOT),
        text=True,
        capture_output=True,
    )
    return proc.returncode, proc.stdout.strip(), proc.stderr.strip()


def rg_count(pattern: str, path_spec: str) -> int:
    code, out, _ = run(f"rg -n --no-heading --color never {json.dumps(pattern)} {path_spec} | wc -l")
    if code != 0 and not out:
        return 0
    try:
        return int(out.strip())
    except ValueError:
        return 0


def count_files(path: Path, suffixes: set[str]) -> int:
    total = 0
    for file_path in path.rglob("*"):
        if file_path.is_file() and file_path.suffix in suffixes:
            total += 1
    return total


def count_lines(path: Path) -> int:
    with path.open("r", encoding="utf-8", errors="ignore") as handle:
        return sum(1 for _ in handle)


def top_files(path: Path, suffixes: set[str], limit: int = 10) -> list[tuple[int, str]]:
    rows: list[tuple[int, str]] = []
    for file_path in path.rglob("*"):
        if not file_path.is_file() or file_path.suffix not in suffixes:
            continue
        rows.append((count_lines(file_path), str(file_path.relative_to(ROOT))))
    rows.sort(reverse=True)
    return rows[:limit]


def tracked_large_file_counts() -> tuple[int, int, int]:
    code, out, _ = run("git ls-files")
    if code != 0:
        return (0, 0, 0)
    sizes = []
    for rel in out.splitlines():
        candidate = ROOT / rel
        if candidate.is_file():
            sizes.append(candidate.stat().st_size)
    ge_1m = sum(size >= 1_000_000 for size in sizes)
    ge_5m = sum(size >= 5_000_000 for size in sizes)
    ge_10m = sum(size >= 10_000_000 for size in sizes)
    return ge_1m, ge_5m, ge_10m


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output",
        type=Path,
        default=ROOT / "docs/architecture/DW_HEALTH_SNAPSHOT_2026_03_23.md",
        help="Output markdown path",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    backend_route_dir = ROOT / "backend/app/api/routes"
    backend_service_dir = ROOT / "backend/app/services"
    frontend_components_dir = ROOT / "frontend/app/components"
    frontend_routes_dir = ROOT / "frontend/app/routes"

    code, tracked_files_text, _ = run("git ls-files | wc -l")
    tracked_files = int(tracked_files_text) if code == 0 and tracked_files_text else 0

    complexity = {
        "backend_py_files": count_files(ROOT / "backend/app", {".py"}),
        "frontend_ts_files": count_files(ROOT / "frontend/app", {".ts", ".tsx"}),
        "backend_route_files": count_files(backend_route_dir, {".py"}),
        "backend_service_files": count_files(backend_service_dir, {".py"}),
        "route_decorators": rg_count(r"@router\.(get|post|put|delete|patch)", "backend/app/api/routes"),
        "any_like_backend": rg_count(r"\bAny\b|Dict\[str, Any\]|dict\[str, Any\]", "backend/app/api/routes backend/app/services"),
        "top_backend_routes": top_files(backend_route_dir, {".py"}, limit=10),
        "top_frontend_components": top_files(frontend_components_dir, {".ts", ".tsx"}, limit=10),
        "top_frontend_routes": top_files(frontend_routes_dir, {".ts", ".tsx"}, limit=10),
    }

    quality = {
        "backend_test_files": count_files(ROOT / "backend/tests", {".py"}),
        "frontend_test_files": count_files(ROOT / "frontend/tests", {".ts", ".tsx"}),
        "backend_test_cases": rg_count(r"^def test_", "backend/tests"),
        "frontend_test_cases": rg_count(r"\b(it|test)\(", "frontend/tests"),
        "publish_subscribe_calls": rg_count(r"publishAppEvent\(|subscribeAppEvent\(", "frontend/app"),
        "raw_event_calls": rg_count(r"window\.dispatchEvent|new CustomEvent|addEventListener\(", "frontend/app"),
    }

    performance_contract = {
        "phase3_budget_smoke_exists": (ROOT / "debug/phase3_budget_smoke.spec.ts").exists(),
        "api_fetch_calls": rg_count(r"\bapiFetch\(", "frontend/app"),
        "use_query_calls": rg_count(r"\buseQuery\(|\buseMutation\(", "frontend/app"),
        "raw_fetch_calls": rg_count(r"\bfetch\(", "frontend/app"),
    }

    realtime = {
        "realtime_publisher_usage": rg_count(r"realtime_publisher|publish_", "backend/app"),
        "direct_broadcast_outside_publisher": rg_count(
            r"broadcast_to_campaign|send_to_recipients",
            "backend/app",
        ) - rg_count(r"broadcast_to_campaign|send_to_recipients", "backend/app/services/realtime_publisher.py"),
    }

    hygiene = {
        "tracked_files": tracked_files,
        "tracked_backend_venv_files": 0,
        "backend_print_calls": rg_count(r"\bprint\(", "backend/app"),
        "frontend_console_log_calls": rg_count(r"console\.log\(", "frontend/app"),
    }
    ge_1m, ge_5m, ge_10m = tracked_large_file_counts()
    hygiene["tracked_files_ge_1mb"] = ge_1m
    hygiene["tracked_files_ge_5mb"] = ge_5m
    hygiene["tracked_files_ge_10mb"] = ge_10m

    # We use shell for venv count because ripgrep over command substitution is not portable.
    code, out, _ = run("git ls-files 'backend/venv/**' | wc -l")
    if code == 0 and out:
        hygiene["tracked_backend_venv_files"] = int(out)

    generated_at = dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    lines: list[str] = []
    lines.append("# DW Health Snapshot (2026-03-23 Baseline)")
    lines.append("")
    lines.append(f"Generated at: `{generated_at}`")
    lines.append("")
    lines.append("## Scope")
    lines.append("- Repo: `/Users/haoli/leehow/code/dw`")
    lines.append("- Dimensions: complexity, quality/testing, performance budget readiness, realtime boundary, repo hygiene")
    lines.append("")
    lines.append("## Complexity")
    lines.append(f"- Tracked files: `{hygiene['tracked_files']}`")
    lines.append(f"- `backend/app` Python files: `{complexity['backend_py_files']}`")
    lines.append(f"- `frontend/app` TS/TSX files: `{complexity['frontend_ts_files']}`")
    lines.append(f"- Backend route files: `{complexity['backend_route_files']}`")
    lines.append(f"- Backend service files: `{complexity['backend_service_files']}`")
    lines.append(f"- Route decorators: `{complexity['route_decorators']}`")
    lines.append(f"- Any-like hints in routes/services: `{complexity['any_like_backend']}`")
    lines.append("")
    lines.append("### Hotspots (top lines)")
    lines.append("- Backend routes:")
    for line_count, rel in complexity["top_backend_routes"]:
        lines.append(f"  - `{rel}`: `{line_count}` lines")
    lines.append("- Frontend components:")
    for line_count, rel in complexity["top_frontend_components"]:
        lines.append(f"  - `{rel}`: `{line_count}` lines")
    lines.append("- Frontend routes:")
    for line_count, rel in complexity["top_frontend_routes"]:
        lines.append(f"  - `{rel}`: `{line_count}` lines")
    lines.append("")
    lines.append("## Quality And Testing")
    lines.append(f"- Backend test files: `{quality['backend_test_files']}`")
    lines.append(f"- Frontend test files: `{quality['frontend_test_files']}`")
    lines.append(f"- Backend test cases (`def test_`): `{quality['backend_test_cases']}`")
    lines.append(f"- Frontend test cases (`it/test`): `{quality['frontend_test_cases']}`")
    lines.append(f"- Typed bus usage (`publish/subscribe`): `{quality['publish_subscribe_calls']}`")
    lines.append(f"- Raw event bridge usage (`dispatch/addEventListener/CustomEvent`): `{quality['raw_event_calls']}`")
    lines.append("")
    lines.append("## Performance Budget Readiness")
    lines.append(f"- Phase 3 budget smoke exists: `{performance_contract['phase3_budget_smoke_exists']}`")
    lines.append(f"- `apiFetch` calls: `{performance_contract['api_fetch_calls']}`")
    lines.append(f"- `useQuery/useMutation` calls: `{performance_contract['use_query_calls']}`")
    lines.append(f"- Raw `fetch` calls: `{performance_contract['raw_fetch_calls']}`")
    lines.append("")
    lines.append("## Realtime Boundary")
    lines.append(f"- `realtime_publisher` usage signals: `{realtime['realtime_publisher_usage']}`")
    lines.append(
        f"- Direct broadcast calls outside `realtime_publisher.py`: `{realtime['direct_broadcast_outside_publisher']}`"
    )
    lines.append("")
    lines.append("## Repo Hygiene")
    lines.append(f"- Backend `print()` calls: `{hygiene['backend_print_calls']}`")
    lines.append(f"- Frontend `console.log()` calls: `{hygiene['frontend_console_log_calls']}`")
    lines.append(f"- Tracked files under `backend/venv/**`: `{hygiene['tracked_backend_venv_files']}`")
    lines.append(f"- Tracked files >= 1MB: `{hygiene['tracked_files_ge_1mb']}`")
    lines.append(f"- Tracked files >= 5MB: `{hygiene['tracked_files_ge_5mb']}`")
    lines.append(f"- Tracked files >= 10MB: `{hygiene['tracked_files_ge_10mb']}`")
    lines.append("")
    lines.append("## Reproduce")
    lines.append("```bash")
    lines.append("cd /Users/haoli/leehow/code/dw")
    lines.append("python scripts/quality/generate_health_snapshot.py")
    lines.append("```")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Wrote snapshot: {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
