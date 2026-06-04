# DW Optimization Audit And Backlog (2026-03-23)

## Summary
- Objective: establish a measurable and reproducible optimization baseline, then drive prioritization with explicit scoring.
- Baseline source of truth: `docs/architecture/DW_HEALTH_SNAPSHOT_2026_03_23.md` (generated from `scripts/quality/generate_health_snapshot.py`).
- Priority focus: stability and maintainability first, then performance and development throughput.

## Scoring Model
- Dimensions (1-5 each):
  - Impact: expected value if optimized (correctness, maintainability, incident reduction, throughput).
  - Risk: operational risk if we do nothing.
  - Effort: implementation cost/coordination cost.
- Total score: `impact + risk + effort`.
- Priority bands:
  - `P0`: `>= 12`
  - `P1`: `9-11`
  - `P2`: `<= 8`
- Owner defaults:
  - Backend Core, Frontend Core, Frontend Map, Frontend Chat, Platform/DevEx.

## Top 20 Optimization Candidates
| # | Candidate | Dimension | Impact | Risk | Effort | Score | Priority | Owner | Acceptance | ETA | Status |
|---|---|---|---:|---:|---:|---:|---|---|---|---|---|
| 1 | Split `backend/app/api/routes/combat.py` orchestration chain | Complexity | 5 | 5 | 3 | 13 | P0 | Backend Core | Reduce route LOC and move one major chain to service/usecase with focused pytest | 1-2w | Planned |
| 2 | Split `backend/app/api/routes/characters.py` orchestration chain | Complexity | 5 | 5 | 3 | 13 | P0 | Backend Core | Move one high-traffic action path to service; route remains thin | 1-2w | Planned |
| 3 | Reduce `frontend/app/components/ui/ChatPanel.tsx` by extracting filter/runtime helpers | Complexity | 4 | 4 | 4 | 12 | P0 | Frontend Chat | Extract pure utility layer with tests; no behavior change | 1w | In Progress |
| 4 | Reduce `frontend/app/components/map/TacticalMap.client.tsx` by extracting monster/runtime utilities | Complexity | 4 | 4 | 4 | 12 | P0 | Frontend Map | Move pure logic to utils + tests; maintain typed interfaces | 1w | In Progress |
| 5 | Add minimal CI quality gate (`.github/workflows/quality-gate.yml`) | Quality Gate | 5 | 4 | 3 | 12 | P0 | Platform/DevEx | CI runs typecheck, focused vitest, focused pytest, contract checks | 1d | Done (Batch A) |
| 6 | Enforce transport/auth contract checks via script | Contract | 5 | 4 | 3 | 12 | P0 | Platform/DevEx | Fail build on `X-User-ID/user_id/role` regressions and illegal raw dispatch | 1d | Done (Batch A) |
| 7 | Enforce repo hygiene checks (tracked `venv/log/tmp/output`) | Hygiene | 4 | 5 | 3 | 12 | P0 | Platform/DevEx | Failing check if generated/runtime artifacts are tracked | 1d | Done (Batch A) |
| 8 | Remove tracked `backend/venv/**` from git index | Hygiene | 4 | 5 | 2 | 11 | P1 | Platform/DevEx | `git ls-files 'backend/venv/**'` returns empty | 0.5d | Done (Batch A) |
| 9 | Replace high-frequency backend `print()` hotspots with structured logging | Logging | 4 | 4 | 4 | 12 | P0 | Backend Core | Convert selected hotspots to `logger.*`; preserve behavior | 1w | In Progress |
| 10 | Continue raw DOM bridge reduction outside typed bus | Frontend Boundary | 4 | 4 | 4 | 12 | P0 | Frontend Core | New cross-component events must use typed bus only | Ongoing | Planned |
| 11 | Unify server-state read path (increase Query coverage, reduce raw `fetch`) | State Layer | 4 | 4 | 4 | 12 | P0 | Frontend Core | Replace one domain's raw fetch path with query hooks | 1-2w | Planned |
| 12 | Reduce backend Any-like payload leakage (`Any`, `Dict[str, Any]`) | Type Safety | 4 | 4 | 4 | 12 | P0 | Backend Core | Convert one high-risk runtime payload path to schema normalization | 1-2w | Planned |
| 13 | Realtime boundary cleanup: reduce direct manager broadcast calls outside publisher | Realtime | 4 | 4 | 4 | 12 | P0 | Backend Core | Decrease non-publisher direct broadcast count in targeted path | 1-2w | Planned |
| 14 | Harden Playwright phase3 budget smoke as regular gate (env-gated) | Performance | 4 | 4 | 3 | 11 | P1 | Platform/DevEx | Smoke command available and documented in release checklist | 1w | Planned |
| 15 | Focused tests for P0 backend hotspots (`combat/characters`) | Testing | 4 | 4 | 3 | 11 | P1 | Backend Core | Add focused tests for extracted service chain | 1-2w | Planned |
| 16 | Focused tests for P0 frontend hotspots (`ChatPanel/TacticalMap`) | Testing | 4 | 4 | 3 | 11 | P1 | Frontend Core | Add utility/controller tests per extraction slice | 1-2w | In Progress |
| 17 | Dependency upgrade wave A (patch only) with regression gate | Dependencies | 3 | 4 | 3 | 10 | P1 | Platform/DevEx | Patch-level upgrades merged with green quality gate | 1w | Planned |
| 18 | Dependency upgrade wave B (minor) for frontend toolchain | Dependencies | 3 | 3 | 4 | 10 | P1 | Frontend Core | Minor updates validated via typecheck + focused tests | 1-2w | Planned |
| 19 | Dependency upgrade wave C (minor) for backend runtime | Dependencies | 3 | 3 | 4 | 10 | P1 | Backend Core | Minor updates validated via focused pytest + compile checks | 1-2w | Planned |
| 20 | Large-file/asset governance policy for tracked artifacts | Hygiene | 3 | 3 | 3 | 9 | P1 | Platform/DevEx | Document and enforce allowed binary/large tracked asset paths | 1w | Planned |

## 2-Week Delivery Board
- Day 1-2:
  - Freeze baseline snapshot and scoring board.
  - Land quality scripts and CI gate.
- Day 3-7:
  - Run six audit lines (complexity, boundary, realtime, performance, quality gaps, dependency/hygiene).
  - Start first hotspot extraction slices for backend and frontend.
- Day 8-14:
  - Complete P0 stop-bleeding batch (contracts, hygiene, logging, first thin-slice extraction, focused tests).
  - Refresh Top 20 scores and reorder queue by latest evidence.

## 6-8 Week Streams
- Stream A (Backend): route-thinning for `combat/characters` and realtime boundary cleanup.
- Stream B (Frontend): continue map/chat/controller decomposition and typed-bus-first communication.
- Stream C (State + Contracts): increase query coverage, schema normalization, reduce Any/raw payload leakage.
- Stream D (Platform): dependency wave upgrades and sustained quality gate hardening.

## Reproduce Audit Commands
```bash
cd /Users/haoli/leehow/code/dw
bash scripts/quality/run_full_audit.sh
```
