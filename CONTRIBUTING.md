# Contributing to 深渊小屋 (Deepwood)

Thanks for your interest in contributing! Deepwood is a full-stack D&D 5E
platform (FastAPI + React Router v7 + PostgreSQL). This guide covers the
basics for getting set up and submitting changes.

## Code of conduct

Be respectful and constructive. Assume good faith, keep discussions on-topic,
and help keep the community welcoming.

## Before you start

- Read the [README](./README.md) for setup and the development workflow.
- For non-trivial changes, skim the architecture docs under
  [`docs/architecture/`](./docs/architecture/) — they are the canonical
  onboarding source for the WebSocket system, transport/auth contract, and
  server-state rules.
- Review [`LEGAL.md`](./LEGAL.md) and [`NOTICE.md`](./NOTICE.md). **Do not add
  copyrighted D&D book text, scanned/OCR'd book content, PDFs, or other
  copyright-sensitive material to the repository.** Only SRD/Open Game Content
  and original work belong here.
- Keep the license boundary clear. Apache-2.0 covers Deepwood software code,
  not D&D content or third-party assets/data. Contributions that add rules
  text, lore, modules, maps, art, uploads, generated campaign content, or
  reference data must be legally redistributable and clearly documented.

## Development setup

See the README's *Quick Start*. In short:

```bash
# Backend
cd backend && python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env          # then fill in your own values

# Frontend
cd frontend && npm install
cp .env.example .env

# Run both
./dev-start.sh
```

Frontend runs on **5174**, backend on **8174**.

## Making changes

1. Create a feature branch off `main`.
2. Keep changes focused and reasonably small. New or refactored files should
   stay under ~400 lines where practical.
3. Follow the existing code style and patterns in the area you are touching.
4. **Never hardcode secrets.** Read keys and connection strings from
   environment variables. `.env` files are gitignored.
5. Do not introduce identity via HTTP headers or query strings — identity comes
   from the bearer token (and the WS handshake token). The CI transport-contract
   check enforces this.

## Tests and quality gates

Run the relevant checks before opening a pull request:

```bash
# Backend (80% coverage required)
cd backend && pytest

# Frontend
cd frontend && npm run test
cd frontend && npm run typecheck

# Repo quality gates
bash scripts/quality/check_transport_contracts.sh
bash scripts/quality/check_repo_hygiene.sh
```

CI runs the quality gate defined in `.github/workflows/quality-gate.yml`; it
must pass before a PR can merge.

## Submitting a pull request

1. Push your branch and open a PR against `main`.
2. Describe **what** changed and **why**, and link any related issue.
3. Confirm tests and quality gates pass.
4. Be responsive to review feedback.

## Licensing of contributions

By contributing, you agree that your contributions to the application code are
licensed under the project's [Apache License 2.0](./LICENSE). Do not contribute
material you do not have the right to license under those terms.

## Reporting security issues

Please follow [`SECURITY.md`](./SECURITY.md) — report vulnerabilities privately
rather than via public issues.
