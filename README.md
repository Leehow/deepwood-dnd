# 深渊小屋 (Deepwood)

**深渊小屋 (Deepwood)** is a free, full-stack **Dungeons & Dragons 5th Edition**
platform for running campaigns online: managing characters, parsing modules, and
playing sessions on a shared tactical map with real-time, collaborative features.

> **Not affiliated with Wizards of the Coast.** Deepwood is unofficial Fan
> Content. D&D content is used under the Open Gaming License (SRD) and the
> Wizards Fan Content Policy. See **Legal & Content Boundary** below.

## Features

- **Campaigns & characters** — create and manage 5E characters, level-ups,
  multiclassing, spells, equipment, and currency.
- **Real-time tabletop** — a Konva-based tactical map with tokens, fog of war,
  drawing, rulers, terrain, and music, synchronized over WebSocket.
- **Dice system** — a three-stage DM → player → adjudication roll flow.
- **Module pipeline** — upload an adventure (PDF/Markdown), OCR and parse it into
  structured chapters, monsters, items, and maps.
- **AI assists** — optional integrations for chat, image/avatar generation, and
  OCR via pluggable providers (configured with your own API keys).

## Tech Stack

**Frontend**

- React Router v7 (framework mode) + React 18 + TypeScript
- Zustand (client state), React Query / `app/queries/` (server cache)
- Konva.js (canvas/map), Tailwind CSS + Radix UI
- Vite

> Note: the project migrated from Remix v2 to React Router v7. Some older code
> comments may still say "Remix"; the `package.json` scripts
> (`react-router dev` / `react-router build`) are authoritative.

**Backend**

- FastAPI (async), PostgreSQL + asyncpg + SQLAlchemy 2.0
- Alembic (migrations), WebSocket, Pydantic
- Redis (optional, caching)

**AI services (optional, bring your own keys)**

- Chat / adjudication, image & avatar generation, and OCR via configurable
  providers. Identity and keys are supplied through environment variables and
  in-app settings — none are bundled.

## Quick Start

### Prerequisites

- Python 3.11+
- Node.js 20+
- PostgreSQL 15+
- Redis (optional)

### Setup

1. Clone the repository:

   ```bash
   git clone <repository-url>
   cd deepwood   # or your clone directory
   ```

2. Backend environment:

   ```bash
   cd backend
   python -m venv venv
   source venv/bin/activate      # Windows: venv\Scripts\activate
   pip install -r requirements.txt
   ```

3. Frontend:

   ```bash
   cd frontend
   npm install
   ```

4. Configure environment variables (copy the examples, then fill in your own
   values — never commit the resulting `.env` files):

   ```bash
   cp backend/.env.example backend/.env
   cp frontend/.env.example frontend/.env
   ```

5. Run database migrations:

   ```bash
   cd backend
   alembic upgrade head
   ```

## Development

The easiest way to start everything is the helper script, which launches the
frontend (**port 5174**) and backend (**port 8174**) together with color-coded
logging:

```bash
chmod +x dev-start.sh   # first time only
./dev-start.sh
```

Then open:

- Frontend: <http://localhost:5174>
- Backend API docs (Swagger): <http://localhost:8174/docs>

### Manual start

```bash
# Backend
cd backend
python -m uvicorn app.main:app --reload --port 8174

# Frontend
cd frontend
npm run dev -- --port 5174
```

### Free a busy port

```bash
lsof -ti:5174,8174 | xargs kill -9 2>/dev/null
```

## Testing

```bash
# Backend (80% coverage required)
cd backend && pytest
pytest tests/test_file.py -v       # specific file
pytest --no-cov                    # skip coverage (faster)

# Frontend
cd frontend && npm run test        # Vitest unit tests
cd frontend && npm run typecheck   # TypeScript check
npx playwright test                # E2E (specs live in ./debug/)
```

### Quality gates (must pass before a PR)

```bash
bash scripts/quality/check_transport_contracts.sh
bash scripts/quality/check_repo_hygiene.sh
```

These are also enforced by `.github/workflows/quality-gate.yml`.

## Project Structure

```
.
├── backend/         # FastAPI backend (app/, alembic/, tests/)
├── frontend/        # React Router v7 frontend (app/, public/)
├── scripts/         # Data/maintenance utilities (read keys from env vars)
├── docs/            # Architecture and design documentation
├── debug/           # E2E specs and dev/debug scripts
├── dnd-platform/    # SRD reference data + runtime upload/parsed dirs*
└── dev-start.sh     # Development startup script
```

\* `dnd-platform/upload/`, `dnd-platform/configs/modules/`, and
`dnd-platform/modules/` are runtime working directories. They are created on
demand and intentionally **not** tracked in Git (see below).

## Environment Variables

### Backend (`backend/.env`)

```env
DATABASE_URL=postgresql+asyncpg://user:password@localhost/dbname
SECRET_KEY=your-jwt-secret-key
REDIS_URL=redis://localhost:6379/0
# AI providers (optional) — supply your own keys
DEFAULT_AI_API_KEY=your-api-key-here
```

See `backend/.env.example` for the full list.

### Frontend (`frontend/.env`)

```env
VITE_API_URL=http://localhost:8174
VITE_WS_URL=ws://localhost:8174
```

## Legal & Content Boundary

Deepwood is **unofficial Fan Content** and is **not** affiliated with, endorsed,
or approved by Wizards of the Coast. Dungeons & Dragons is a trademark of
Wizards of the Coast LLC.

- **Application code** — Apache License 2.0; see [`LICENSE`](./LICENSE).
- **License boundary** — Apache-2.0 covers only the Deepwood software/product
  code. It does not grant rights to D&D rules text, trademarks, lore, official
  books/adventures, artwork, maps, modules, uploads, generated campaign
  content, or third-party data/assets.
- **Open Game Content (SRD 5.1)** — used under OGL v1.0a; see
  [`LICENSE-OGL.md`](./LICENSE-OGL.md).
- **Fan Content Policy** — Deepwood is free to access and non-commercial; see
  [`LEGAL.md`](./LEGAL.md).
- **Third-party / content summary** — see [`NOTICE.md`](./NOTICE.md).

Commercial use of the Deepwood software may be allowed by Apache-2.0, but
commercial use of any D&D-related content or branding is separate. If you build
a commercial product or service with Deepwood, you must independently comply
with the applicable D&D/Wizards/SRD/OGL/Fan Content Policy and third-party
rights requirements. We provide the product code; we do not provide D&D content
rights.

### Content intentionally excluded from this repository

To respect copyright and keep the public repo clean, the following are **not**
included and are blocked by `.gitignore`:

- Scanned or OCR-converted copies of official D&D books and published adventures
  (Player's Handbook, Dungeon Master's Guide, Monster Manual, etc.).
- Uploaded source files and their parsed/converted output
  (`dnd-platform/upload/`, `dnd-platform/configs/modules/`,
  `dnd-platform/modules/`).
- PDFs, CHM archives, and other distributed book formats.
- Local environment files and secrets (`.env`, API keys).

If you self-host Deepwood and upload your own books or modules, you are
responsible for holding the necessary rights and for complying with the Wizards
Fan Content Policy.

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md). Please report security issues
privately per [`SECURITY.md`](./SECURITY.md).

## License

Apache License 2.0 for the application code — see [`LICENSE`](./LICENSE). Game
content is governed separately as described in **Legal & Content Boundary**
above.
