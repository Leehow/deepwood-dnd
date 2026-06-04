# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**深渊小屋 (Deepwood)** - Full-stack D&D 5E platform for managing campaigns, characters, and game sessions with real-time collaborative features. React Router v7 frontend (port 5174) + FastAPI backend (port 8174) + PostgreSQL.

**项目名称**: 深渊小屋 (英文: Deepwood)，注意不是"深木"！

**版权合规**: 本项目遵循威世智 Fan Content Policy（粉丝内容政策），可使用D&D 5E全部内容（包括PHB子职业、所有怪物等），但必须保持免费且包含法律声明。详见 `LEGAL.md`。

## Critical Rules

**删除/移除功能前必须先问用户！** 在实现任何需求时，如果涉及删除、移除、隐藏现有的按钮、功能、UI 元素或代码逻辑，**必须先明确询问用户是否同意**，不能自行决定删除。即使新功能看似替代了旧功能，也不能假设旧功能不再需要。只做用户明确要求的改动。

**禁止未经确认使用 git restore/checkout/reset 恢复文件！** 除非用户明确要求 git 恢复操作，否则**绝对不能**使用 `git checkout`、`git restore`、`git reset` 等命令恢复文件。即使用户提到了恢复，也必须再次确认。之前因为误恢复导致大量修改丢失。

**所有测试输出必须放在 `debug/test/` 目录下！** 任何测试脚本的输出文件（图片、报告、日志等）一律存放到 `debug/test/` 子目录中，**禁止**在项目根目录或其他业务目录下创建测试输出文件夹。测试脚本本身放在 `scripts/` 即可。

## Branch & Worktree Coordination

Follow the global Git safety and branch discipline in `~/.claude/CLAUDE.md`.
For Deepwood, use `codex/<topic>` for lead/integration branches,
`claude/<task-scope>` for worker branches, and `wip/<topic>` for personal
experiments. When practical, each worker should run in its own worktree, for
example:

```bash
git worktree add ../dw-worker-<scope> -b claude/<scope> <base>
```

## Tech Stack

**Frontend**: React Router v7 (framework mode, Vite) + React 18 + TypeScript, Zustand (state), React Query / `app/queries/` (server cache), Konva.js (canvas), Tailwind + Radix UI. Note: the project migrated from Remix v2 to React Router v7 — older docs and route file comments may still say "Remix"; treat the package.json scripts (`react-router dev`, `react-router build`) as authoritative.

**Backend**: FastAPI (async), PostgreSQL + asyncpg + SQLAlchemy 2.0, Alembic (migrations), WebSocket, Pydantic

**AI Services**: CST Cloud (chat), Qwen (images), Infini AI (alt chat), Doc2X (PDF), Tuzi (avatars), Mistral (OCR)

**Prerequisites**: Python 3.11+, Node.js 20+, PostgreSQL 15+, Redis (optional)

## Commands

**IMPORTANT**: Frontend port **5174**, Backend port **8174**. Kill occupied ports: `lsof -ti:5174,8174 | xargs kill -9 2>/dev/null`

```bash
# Development
./dev-start.sh                               # Start both (recommended)
cd backend && source venv/bin/activate       # Always activate venv first
python -m uvicorn app.main:app --reload --port 8174
cd frontend && npm run dev -- --port 5174

# Database
cd backend && alembic upgrade head           # Apply migrations
alembic revision --autogenerate -m "desc"    # Create migration

# Backend Testing (80% coverage required)
cd backend && pytest                         # All tests
pytest tests/test_file.py -v                 # Specific file
pytest -k "test_name"                        # By name pattern
pytest --no-cov                              # Skip coverage (faster)

# Frontend Testing
cd frontend && npm run test                  # Vitest unit tests
cd frontend && npx vitest run path/to/file   # Single Vitest file
npx playwright test --config=playwright.config.ts  # E2E (specs live in ./debug/, baseURL :5174)
npx playwright test debug/phase3_budget_smoke.spec.ts  # Single E2E spec

# Typecheck (no separate lint step — eslint config exists but no npm script)
cd frontend && npm run typecheck

# CI quality gates (must pass before PR — see .github/workflows/quality-gate.yml)
bash scripts/quality/check_transport_contracts.sh   # Forbids X-User-ID / ?user_id= / ?role= / raw window.dispatchEvent
bash scripts/quality/check_repo_hygiene.sh
```

**Don't run `npm run build` to verify frontend changes** — the Vite dev server hot-reloads; verify in the browser. Only build when explicitly asked.

## Critical Architecture Insights

### WebSocket Real-Time System

Campaign-scoped connection groups in `backend/app/services/websocket_manager.py`:

```python
active_connections: Dict[str, Set[WebSocket]] = {}  # {campaign_id: {ws1, ws2}}
```

**Handler architecture** (registry-based, consolidated):

- All handlers live in `backend/app/services/websocket_handlers/` — one file per domain (chat, dice, fog, map, terrain, drawing, ruler, music, rest, reward, trade, time, consumable, ai_marker, character_selection, system_notice). The old `app/api/websocket/handlers/` and `app/websocket_handlers/` are gone or empty — do not add new handlers there.
- `registry.py` routes incoming messages by type; `base.py` defines `BaseHandler`.
- Single `/ws/{campaign_id}` endpoint in `backend/app/api/routes/websocket_simplified.py` dispatches via the registry.
- Own-message filtering: `if ws != sender_ws: await ws.send_json()`

**Route-level broadcasts are forbidden.** Every `backend/app/api/routes/` file has been migrated off `manager.broadcast_to_campaign(...)` / `send_to_recipients(...)`. New side-effects must go through `realtime_publisher` (or a domain service that does) so audit / typing / ordering stay consistent. CI does not yet block direct broadcasts in routes, but adding one will regress the refactor — search for `realtime_publisher` usage in `combat.py`, `tokens.py`, `chat.py` for the pattern.

### Transport & Auth Contract (CI-enforced)

`scripts/quality/check_transport_contracts.sh` fails the build if any of these appear:

- **HTTP**: `X-User-ID` header, `?user_id=` / `?role=` query params, or `alias="X-User-ID"` / `Query(...)` for `user_id` / `role` on the backend side. All HTTP identity comes from the bearer token (`Authorization: Bearer ...`) — never from headers or query strings.
- **WebSocket**: identity comes from the token in the WS handshake only.
- **Frontend events**: raw `window.dispatchEvent(new CustomEvent(...))` is forbidden outside the typed bus at [frontend/app/events/appEventBus.ts](frontend/app/events/appEventBus.ts) (plus two grandfathered exceptions: `utils/openEventBridge.ts`, `components/map/DamageNumberOverlay.tsx`). Add new cross-component events as typed entries on the bus.

See [docs/architecture/TRANSPORT_AND_AUTH_GUIDE.md](docs/architecture/TRANSPORT_AND_AUTH_GUIDE.md) for the full contract.

### Dice System (3-Stage Execution)

1. **DM Command** → AI extracts parameters → `DiceRequest` persisted
2. **Player Rolls** → Physical dice values entered → Stored in `dice_rolls`
3. **AI Adjudication** → Validates results → Broadcasts outcome

Module-level lock prevents concurrent AI analysis:

```python
_analyze_lock = asyncio.Lock()  # backend/app/api/routes/dice.py
```

### Module Parsing Pipeline

Pipeline pattern in `backend/app/domain/parsing/pipeline.py`:

- 7 stages: Upload → Mistral OCR → OSS upload → Image classification → TOC extraction → Monster/Item extraction → DB persist
- Progress callback system for real-time UI updates
- JSON recovery handles malformed AI responses

### Database Design

**Token Polymorphism**: Single `map_tokens` table with nullable FKs (character_id, monster_instance_id, item_data JSONB) - exactly one non-NULL enforced by constraint.

**AI Settings (3NF)**: `ai_api_settings` → `ai_model_configs` with model_type enum (chat, image, tts, etc.)

**Cascade Deletes**: Campaign deletion cascades to 15+ related tables.

### Rules JSON Data Source

**禁止硬编码 JSON 文件路径！** 所有 JSON 数据文件统一存放在 `frontend/app/data/` 下，前后端共用此目录。不允许在业务代码中使用 `Path(__file__)` 或 `os.path.join` 拼接 JSON 路径。

**统一目录结构**:
```
frontend/app/data/
  rules/          <- 核心规则 + 参考数据（spells, equipment, conditions, magic-items 等）
  npc/            <- 预设怪物数据 (monsters.json)
  modules/        <- 静态模组数据 (lost_mine_of_phandelver/)
  backend/        <- 后端专有数据 (effects, companions, templates, dnd_api/)
  creator/        <- 模组创作知识库
```

**前端**: `frontend/app/data/` 是所有规则数据的唯一来源。

- **Always use** `import('~/data/rules/X.json')` (dynamic import) to load rules data
- **Never fetch** from `public/` 目录，所有数据已迁入 `app/data/`
- 路径常量参考：`frontend/app/config/data-paths.ts`

**后端**: `backend/app/utils/rules_cache.py` 是所有 JSON 数据路径的唯一管理点。

- 需要加载 JSON 数据时，**必须**从 `rules_cache` 导入对应的 loader 函数或路径常量
- 新增 JSON 数据文件时，先在 `rules_cache.py` 添加 loader，再在业务代码中调用
- `rules_cache` 提供 LRU 缓存，无需在业务代码中自建缓存

```python
# ✅ 正确：从 rules_cache 导入
from app.utils.rules_cache import get_spells_data, get_equipment_data, PROJECT_ROOT

# ❌ 禁止：在业务代码中硬编码路径
data_path = Path(__file__).parent.parent / "data" / "xxx.json"
path = os.path.join(os.path.dirname(__file__), "../../frontend/app/data/rules/xxx.json")
```

`rules_cache.py` 管理的路径常量：

| 常量 | 指向 | 用途 |
|------|------|------|
| `DATA_BASE_PATH` | `frontend/app/data/` | 统一数据根目录 |
| `RULES_BASE_PATH` | `frontend/app/data/rules/` | 规则数据（spells, equipment, conditions 等） |
| `NPC_DATA_PATH` | `frontend/app/data/npc/` | 预设怪物 |
| `BACKEND_DATA_PATH` | `frontend/app/data/backend/` | 后端专有数据（effects, companions, templates 等） |
| `CREATOR_KB_PATH` | `frontend/app/data/creator/` | 模组创作知识库 |
| `MODULES_DATA_PATH` | `frontend/app/data/modules/` | 静态模组数据 |
| `PROJECT_ROOT` | 项目根目录 | 通用路径解析 |

## Code Patterns

### Backend API Endpoint

```python
@router.post("/resource", response_model=ResponseSchema)
async def create_resource(data: RequestSchema, db: AsyncSession = Depends(get_db)):
    # 1. Permission check (campaign.dm_id == current_user.id)
    # 2. DB operation with async commit
    # 3. WebSocket broadcast: await manager.broadcast_to_campaign(...)
    return resource
```

### WebSocket Handler Pattern (New Registry)

```python
class TokenHandler(BaseHandler):
    async def handle(self, ws: WebSocket, data: dict, db: AsyncSession):
        # Update DB, then broadcast with exclude_sender=ws
```

### Frontend API Call

```typescript
const response = await fetch(`${API_BASE_URL}/endpoint`, {
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
});
if (!response.ok) throw new Error((await response.json()).detail);
```

## Key Files

### Architecture Docs (read these first for non-trivial work)

[docs/architecture/](docs/architecture/) is the canonical onboarding source — read the relevant file *before* large changes in that area:

- [ARCHITECTURE_REVIEW_2026.md](docs/architecture/ARCHITECTURE_REVIEW_2026.md) — current source-of-truth audit (hotspots, risks, priorities)
- [REFACTORING_ROADMAP_2026.md](docs/architecture/REFACTORING_ROADMAP_2026.md) — incremental roadmap (no big-bang rewrites)
- [TRANSPORT_AND_AUTH_GUIDE.md](docs/architecture/TRANSPORT_AND_AUTH_GUIDE.md) — HTTP bearer-only / WS token-only contract
- [SERVER_STATE_GUIDE.md](docs/architecture/SERVER_STATE_GUIDE.md) — Phase 3 server-state rules, single-owner first-paint
- [RUNTIME_SCHEMA_CATALOG.md](docs/architecture/RUNTIME_SCHEMA_CATALOG.md) — token / character / combat runtime schemas (entry points + acceptance gates)
- [SPELL_RUNTIME_ENGINE.md](docs/architecture/SPELL_RUNTIME_ENGINE.md) — `spell_runtime_instances` truth layer, trigger/verb registry
- [MODULE_REFACTOR_BATCH_2026_03_21.md](docs/architecture/MODULE_REFACTOR_BATCH_2026_03_21.md) — module_chat / modules / TacticalMap hotspot tracker

### Large Files (Need Refactoring — line counts as of 2026-05)

- [backend/app/api/routes/characters.py](backend/app/api/routes/characters.py) (~6500 lines) - Character operations; route-to-service extraction in progress
- [frontend/app/components/map/TacticalMap.client.tsx](frontend/app/components/map/TacticalMap.client.tsx) - Canvas orchestration; controllers being extracted into `useMap*Controller.ts` hooks
- [frontend/app/routes/modules.tsx](frontend/app/routes/modules.tsx) (~2700 lines) - Module UI components
- [backend/app/api/routes/modules.py](backend/app/api/routes/modules.py) (~2200 lines) - Module parsing & management; SSE/WS streams collapsed into `module_*_service.py`
- [backend/app/api/routes/websocket_simplified.py](backend/app/api/routes/websocket_simplified.py) (~430 lines) - WebSocket endpoint (registry-based)

Per `~/.claude/CLAUDE.md`: keep new/refactored files under ~400 lines. When touching these hotspots, prefer extracting into services/controllers (see existing `module_*_service.py`, `useMap*Controller.ts` for the pattern) over inlining new logic.

### Critical Integration Points

- [backend/app/services/websocket_manager.py](backend/app/services/websocket_manager.py) - Connection groups
- [backend/app/services/realtime_publisher.py](backend/app/services/realtime_publisher.py) - The only legitimate broadcast surface — call this from services, never `manager.broadcast_*` from routes
- [backend/app/services/websocket_handlers/registry.py](backend/app/services/websocket_handlers/registry.py) - Handler routing
- [backend/app/core/config.py](backend/app/core/config.py) - All environment variables
- [frontend/app/hooks/useWebSocket.ts](frontend/app/hooks/useWebSocket.ts) - Auto-reconnection
- [frontend/app/events/appEventBus.ts](frontend/app/events/appEventBus.ts) - Typed event bus (the only sanctioned `window.dispatchEvent` site)
- [frontend/app/queries/](frontend/app/queries/) - React Query entry points; legacy `*Cache` modules are thin wrappers around these — don't add new hand-written caches
- [frontend/app/campaign-shell/](frontend/app/campaign-shell/) - Campaign shell split into `bootstrap/`, `hotbar/`, `panel/`, `realtime/` — first-paint single-owner logic lives here

### Complex Business Logic

- `backend/app/api/routes/dice.py` - 3-stage dice execution
- `backend/app/domain/parsing/pipeline.py` - Module parsing pipeline
- `backend/app/services/ai_model_service.py` - Multi-provider AI orchestration
- `backend/app/services/monster_item_extractor.py` - Entity extraction from modules

## Environment Variables

**Backend `.env`**:

```env
DATABASE_URL=postgresql+asyncpg://user:pass@localhost/dbname
SECRET_KEY=your-jwt-secret-key
CST_API_KEY=xxx  CST_API_URL=https://...  # Chat
QWEN_API_KEY=xxx                           # Images
INFINI_API_KEY=xxx                         # Alt chat
DOC2X_API_KEY=xxx                          # PDF extraction
TUZI_API_KEY=xxx                           # Avatars
MISTRAL_API_KEY=xxx                        # OCR
```

**Frontend `.env`**:

```env
VITE_API_URL=http://localhost:8174
VITE_WS_URL=ws://localhost:8174
```

## Common Issues & Solutions

1. **WebSocket Not Broadcasting**: Check campaign_id matches connection, verify `exclude_sender` param
2. **Module Parsing Hangs**: Check AI API keys, verify `module_parse_progress.status` in DB
3. **Token Movement Lag**: Disable Konva `transition` during drag, use `requestAnimationFrame`
4. **AI Response Malformed**: JSON recovery is built-in; check token limits
5. **Migration Conflicts**: `alembic downgrade -1 && alembic upgrade head` (or `alembic stamp head`)
6. **Token 选中状态**：DM 选中 token 后，**禁止**在点击地面/背景时自动取消选中。DM 通过 ESC 键或点击另一个 token 来切换/取消选中。不要添加"点击空白区域取消选中"的逻辑。

## Performance Notes

- **Token Rendering**: >100 tokens cause lag, use viewport culling
- **WebSocket Messages**: Batch updates within 50ms window
- **Database Queries**: N+1 issues in character equipment, use eager loading
- **AI Calls**: Rate limited, use queue with retry logic

## Reusable UI Components

When implementing modals or detail views, **always check for existing components first**:

| Component | Path | Usage |
|-----------|------|-------|
| `SpellCard` | `components/spell/SpellCard.tsx` | 法术详情展示，支持 `compact`/`full` 两种模式。在任何需要展示法术信息的模态框中复用此组件 |
| `LatexText` | `components/ui/LatexText.tsx` | 渲染包含 LaTeX 的文本 |

**Example: SpellCard in modal**
```typescript
import { SpellCard } from '~/components/spell/SpellCard';
import type { Spell } from '~/types/spell';

// 如果后端返回的是 snake_case，需要转换
function convertToSpell(s: any): Spell {
  return {
    id: s.id,
    name: s.name,
    nameEn: s.nameEn || '',
    level: s.level ?? 0,
    school: s.school || 'evocation',
    castingTime: s.casting_time || s.castingTime,
    // ... 其他字段
  };
}

// 在模态框中使用
<SpellCard spell={convertToSpell(spellDetail)} variant="full" />
```

## Adding New LLM Usage Points

When adding a new feature that uses LLM, update `backend/app/api/routes/ai_settings.py`:

**1. Add to `DEFAULT_USAGE_CONFIGS`**:

```python
DEFAULT_USAGE_CONFIGS = {
    # ... existing configs
    "new_feature_name": "CHAT",  # or FAST, ADVANCED, etc.
}
```

**2. Add to `USAGE_CONFIG_CATEGORIES`** (for UI display):

```python
USAGE_CONFIG_CATEGORIES = {
    "module": {  # or character, resource, game, other
        "label": "模组相关",
        "items": [
            # ... existing items
            {"key": "new_feature_name", "label": "新功能名称"},
        ]
    },
}
```

**Current LLM usage points (25 total)**:

- Module: module_chat_query, module_analyze_entities, module_extract_monsters, module_extract_items, module_refresh_toc, module_title_generation
- Character: character_description, character_background, character_appearance, character_translation
- Resource: resource_chat, rules_chat, equipment_pack_parse
- Custom Creation: custom_creation, prompt_expansion
- Game: websocket_chat, dice_analyze, token_move_narrative, map_update_narrative
- Avatar: avatar_player, avatar_monster, avatar_npc, avatar_item, avatar_shop

Admin page: `/api-usage` - Configure which model type each feature uses.
