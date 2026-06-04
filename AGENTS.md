# Repository Guidelines

## Project Structure & Module Organization
- Monorepo roots: `backend/` (FastAPI service under `app/`, migrations in `alembic/`, tests in `tests/`), `frontend/` (Remix + React with `app/components`, `app/routes`, assets in `public/`). 
- Supporting folders: `docs/` (notes), `logs/` (dev-start output), `dnd-platform/` (module data/config), Playwright artifacts in `frontend/test-results/`.
- Use `dev-start.sh` in repo root to boot both apps and stream logs; manual runs are fine when isolating frontend or backend changes.

## Build, Test, and Development Commands
- Backend setup: `cd backend && python -m venv venv && source venv/bin/activate && pip install -r requirements.txt`.
- Database migrations: `cd backend && alembic upgrade head` before running servers or tests.
- Backend dev server: `cd backend && uvicorn app.main:app --reload --port 8174`.
- Frontend dependencies and dev: `cd frontend && npm install` then `npm run dev` (port 5174); production bundle via `npm run build && npm start`. Type safety: `npm run typecheck`.
- One-command stack: `chmod +x dev-start.sh && ./dev-start.sh` (writes `logs/frontend.log` and `logs/backend.log`).

## Coding Style & Naming Conventions
- Python (3.11): Black at 100 columns; Ruff checks PEP8, naming, bugbear (see `backend/pyproject.toml`). Keep modules snake_case, prefer typed functions, and use Alembic (not ad-hoc scripts) for schema changes.
- TypeScript/React: ESLint extends Remix defaults (`frontend/.eslintrc.json`); `no-console` except warn/error, prefer `const`, forbid `var`, `_`-prefixed params ignored for unused-var warnings. Tailwind + Radix UI; colocate UI under `app/components` and route logic under `app/routes`.

## Testing Guidelines
- Backend: `cd backend && pytest` discovers `tests/test_*.py`; use markers `-m unit` or `-m integration`. Coverage: `pytest --cov=app --cov-report=term-missing`. Keep fixtures reusable via `conftest.py`.
- Frontend E2E: `npx playwright test frontend/tests --config=playwright.config.ts` (bootstraps `npm run dev`, baseURL http://localhost:5174). Store specs as `*.spec.ts`; favor `page.waitForSelector` over long timeouts.

## Branch & Worktree Coordination
- Follow the global Git safety and branch discipline in `~/.codex/AGENTS.md`.
- Local naming convention: `codex/<topic>` for lead/integration branches,
  `claude/<task-scope>` for worker lanes, and `wip/<topic>` for personal
  experiments.
- When practical, each independent Claude Code worker should use its own
  worktree such as `git worktree add ../dw-worker-<scope> -b claude/<scope>
  <base>`.

## Autonomous Refactor Policy
- For large refactors, do not stop for sub-step confirmation. Inspect the impact surface, batch related code/test/doc updates, validate the batch, then keep going.
- If an explicit skill is useful, prefer `$dw-big-refactor` for repository-wide long refactors and `$dw-modules-refactor` for `module_chat / modules / TacticalMap / campaign-shell` hotspot work.
- Prefer grouped delivery over micro-edits. If the change crosses subsystems or is likely to exceed short-term context, create or update a design note under `docs/architecture/` before major edits.
- For long refactors, build an ordered next-slice queue, not just one batch. When a batch is done and validated, automatically continue into the next adjacent unresolved slice from the same hotspot, current batch note, or roadmap.
- Do not stop merely because the first named task chain is complete if the surrounding hotspot is still clearly overloaded and the next cut is already evident from the docs or code.
- Do not end a long refactor with “the next step would be ...” unless you are blocked or the current hotspot is genuinely exhausted. If the next step is clear and safe, do it in the same run.
- If a run-state JSON or handoff note is provided by the caller, read it first and update it before finishing so outer loop tooling can decide whether to continue automatically.
- In a driver-managed refactor run, treat the state file as authoritative:
  - keep `current_hotspot` and `remaining_queue` current
  - default `status=continue` while an adjacent slice remains
  - only use `status=done` when `scope_exhausted=true` and the remaining queue is empty or intentionally deferred
  - never end a pass with a passive summary if the driver should immediately continue
- Keep route files thin. When practical, move payload shaping, orchestration, and side-effect coordination into service or usecase modules in the same batch.
- After each batch, run the narrowest relevant checks:
  - Backend: focused `PYTHONPATH=. pytest --noconftest ...` and `python -m py_compile ...`
  - Frontend: `npm run typecheck` and focused `npx vitest run ...`
- Stop only for missing credentials/secrets, irreversible destructive actions, ambiguity that would materially change public API, database schema, or production behavior, or because the current hotspot is genuinely exhausted.
- When architecture boundaries or maintenance workflows change, update the relevant files under `docs/architecture/` in the same batch.

## Commit & Pull Request Guidelines
- History favors conventional commits (`feat(frontend): ...`, `refactor(backend): ...`, `docs: ...`; occasional localized subjects). Keep verbs imperative and scopes lowercase.
- PRs should describe intent, link issues, call out affected surfaces (frontend/backend), attach screenshots or GIFs for UI touches, and list checks run (`pytest`, `npm run typecheck`, Playwright). Note migration impacts and required env vars when applicable.

## Security & Configuration Tips
- Do not commit secrets. Copy `backend/.env.example` and `frontend/.env.example`, fill DB/Redis/AI keys locally. 
- Alembic is the schema source of truth: `alembic revision --autogenerate` then `alembic upgrade head`.
- Logs from `dev-start.sh` live in `logs/`; inspect with `tail -f logs/backend.log` or `tail -f logs/frontend.log`.
