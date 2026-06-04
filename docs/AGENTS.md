# Repository Guidelines

## Project Structure & Module Organization
- `backend/` FastAPI service; `app/api` routes (ai_settings, campaigns, tokens, chat, etc.), core config, db, models, services; `alembic/` migrations; `tests/` for unit/integration; `scripts/` for helpers.
- `frontend/` Remix app; `app/routes`, `app/components`, `hooks`, and utilities/stores; `public/` static assets; `scripts/` for data/import helpers.
- `debug/` diagnostic scripts plus Playwright specs for regressions (`*.spec.ts`); keep ad-hoc files out of release branches unless intentional.
- `dev-start.sh` orchestrates both services with logs in `logs/`; `docs/` stores design notes; `dnd-platform/` and `config/` hold module data and parsed assets.

## Build, Test, and Development Commands
- `./dev-start.sh` from repo root to boot backend (8174) and frontend (5174) with log streaming/rotation.
- Backend: `cd backend && source venv/bin/activate && pip install -r requirements.txt && alembic upgrade head && uvicorn app.main:app --reload --port 8174`.
- Backend quality: `cd backend && black app && ruff check app && mypy app` (configured via `pyproject.toml`).
- Backend tests: `cd backend && pytest` or `pytest --cov=app --cov-report=term-missing`.
- Frontend: `cd frontend && npm install && npm run dev` for local; `npm run build && npm start` for prod-like runs; `npm run typecheck` for TS health.
- E2E: `npx playwright test --config=playwright.config.ts` (starts frontend dev server; ensure backend is running).

## Coding Style & Naming Conventions
- Python: Black 100-char lines; snake_case modules; type hints encouraged; keep API routes under `app/api/routes` aligned to services/models; avoid mutating Alembic history outside migrations.
- Linting: Ruff rules enabled; treat warnings as issues; mypy is lenient on missing imports but prefer typed boundaries.
- TypeScript/TSX: 2-space indent; PascalCase components/files, camelCase hooks/utils; keep Remix loaders/actions colocated with routes; prefer Tailwind utility classes over inline styles; log via shared logger utilities.

## Testing Guidelines
- Backend tests live in `backend/tests` with `test_*.py` and `Test*` classes; mark unit/integration when relevant and keep fixtures lightweight; aim for coverage via `pytest --cov`.
- Playwright specs live in `debug/*.spec.ts` and `frontend/tests`; they use baseURL `http://localhost:5174` and expect the API on `8174`. Capture traces/screenshots when debugging (`npx playwright show-trace <path>`).
- New features should include at least one automated check (pytest or Playwright) covering the critical path.

## Commit & Pull Request Guidelines
- Follow Git history style: conventional-ish prefixes such as `feat(backend): ...`, `fix(frontend): ...`, `docs:`; keep subjects imperative and under ~72 chars.
- PRs should state what changed, why, how to reproduce, and test evidence (pytest output or Playwright trace/screenshot). Add UI screenshots/gifs when visuals change.
- Link issues/tasks when available and call out breaking changes or database migrations explicitly in the PR body.

## Security & Configuration Tips
- Copy `.env.example` to `.env` in backend and frontend; never commit filled secrets. PostgreSQL and Redis URLs are required for backend; frontend relies on matching API base URLs.
- Logs under `logs/` may capture user or token data; avoid committing them. Keep sample modules in `dnd-platform/` synced with backend expectations when updating data.
