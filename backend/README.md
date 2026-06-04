# DND 5E Platform Backend

FastAPI backend with WebSocket support, Redis caching, and PostgreSQL database.

## Features

- FastAPI async API
- WebSocket real-time communication
- PostgreSQL database with SQLAlchemy ORM
- Redis for caching
- OpenAI-compatible AI API integration
- AI settings management with 6 model types:
  - Chat model (对话模型)
  - Fast language model (快速语言模型)
  - Advanced language model (高级语言模型)
  - Vision recognition model (图像识别模型)
  - Avatar generation model (头像生成模型)
  - General image generation model (通用图像生成模型)

## Setup

### 1. Create Virtual Environment

```bash
cd backend
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

### 2. Install Dependencies

```bash
pip install -r requirements.txt
```

### 3. Set Up Environment Variables

Copy `.env.example` to `.env` and configure your settings:

```bash
cp .env.example .env
```

Edit `.env` and update:

- `DATABASE_URL`: PostgreSQL connection string
- `REDIS_URL`: Redis connection string
- `DEFAULT_AI_API_URL`: Default AI API URL
- `DEFAULT_AI_API_KEY`: Default AI API key

### 4. Start PostgreSQL and Redis

Make sure PostgreSQL and Redis are running:

```bash
# PostgreSQL (example with docker)
docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=password -e POSTGRES_DB=dnd_platform postgres:15

# Redis (example with docker)
docker run -d -p 6379:6379 redis:7
```

### 5. Database Migrations (Alembic)

Run Alembic migrations before starting the server:

```bash
cd backend
./venv/bin/alembic upgrade head
```

Notes:

- Use Alembic as the single source of truth for schema changes.
- Ad-hoc scripts under `backend/migrations/` (e.g., `run_*.py`) are deprecated and should not be used in CI/production.
- If your local DB was changed manually before, Alembic revisions are idempotent (guarded) to avoid duplicate errors.

### 5. Run the Server

```bash
python -m app.main
# or
uvicorn app.main:app --reload --host 0.0.0.0 --port 8174
```

The API will be available at `http://localhost:8174`

## API Documentation

Once the server is running, you can access:

- Swagger UI: `http://localhost:8174/docs`
- ReDoc: `http://localhost:8174/redoc`

## API Endpoints

### AI Settings

- `POST /api/ai-settings` - Create AI settings
- `GET /api/ai-settings/{user_id}` - Get AI settings
- `PUT /api/ai-settings/{user_id}` - Update AI settings
- `DELETE /api/ai-settings/{user_id}` - Delete AI settings
- `POST /api/ai-settings/{user_id}/fetch-models` - Fetch models from user's API
- `POST /api/ai-settings/test-connection` - Test API connection

### WebSocket

- `WS /ws/{campaign_id}?user_id=xxx&role=xxx` - Campaign WebSocket connection

## Project Structure

```text
backend/
├── app/
│   ├── api/
│   │   └── routes/
│   │       ├── ai_settings.py    # AI settings endpoints
│   │       └── websocket_simplified.py  # WebSocket endpoints
│   ├── core/
│   │   └── config.py             # Configuration
│   ├── db/
│   │   ├── session.py            # Database session
│   │   └── redis.py              # Redis client
│   ├── models/
│   │   └── ai_settings.py        # Database models
│   ├── schemas/
│   │   └── ai_settings.py        # Pydantic schemas
│   ├── services/
│   │   ├── ai_service.py         # AI API service
│   │   └── websocket_manager.py  # WebSocket manager
│   └── main.py                   # FastAPI app
├── .env.example
├── requirements.txt
└── README.md
```
