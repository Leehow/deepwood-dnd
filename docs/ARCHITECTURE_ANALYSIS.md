# D&D 5E Platform - Comprehensive Architecture Analysis

## Executive Summary

This is a full-stack D&D 5E campaign management platform with:

- **Frontend**: Remix (React) + Konva.js for real-time collaborative tactical maps
- **Backend**: FastAPI + PostgreSQL + async/await patterns
- **Real-time**: WebSocket-based event system with campaign-scoped connection groups
- **AI Integration**: Multi-model orchestration with OpenAI-compatible APIs
- **Module Parsing**: Pipeline-based PDF/Markdown parsing with AI-powered stage classification

---

## 1. WebSocket Architecture & Real-Time Features

### 1.1 Connection Management Pattern

**File**: `backend/app/services/websocket_manager.py`

The `ConnectionManager` class implements a **hierarchical connection grouping pattern**:

```python
# Core data structure
active_connections: Dict[str, Set[WebSocket]]  # campaign_id -> {ws1, ws2, ...}
connection_info: Dict[WebSocket, dict]         # ws -> {campaign_id, user_id, role}
```

**Key Design Decisions**:

1. **Campaign-scoped isolation**: Each campaign has its own connection set. No cross-campaign message leakage.
2. **String normalization**: Campaign IDs normalized to strings for consistency (supports both int/str inputs)
3. **Set-based tracking**: Uses sets instead of lists for O(1) disconnect operations
4. **Cleanup on empty**: Automatically removes empty campaign connection sets to prevent memory leaks

**Broadcast Methods**:

- `broadcast_to_campaign()`: All users in campaign
- `broadcast_to_role()`: Only DMs or players
- `send_to_recipients()`: Private messages to specific user_ids
- `send_personal_message()`: Single connection

### 1.2 WebSocket Message Protocol

**File**: `backend/app/api/routes/websocket_simplified.py` (~300 lines)

Single WebSocket endpoint delegates message handling to a registry-based handler system:

```python
@router.websocket("/ws/{campaign_id}")
async def websocket_endpoint(
    websocket: WebSocket,
    campaign_id: str,
    user_id: str = Query(...),
    role: str = Query(...),
):
    # Delegates to handler registry (see backend/app/services/websocket_handlers/registry.py)
    ...
```

**Note**: The project uses the handler-registry pattern under `backend/app/services/websocket_handlers/`.

### 1.3 Dice System Architecture

This is the most complex subsystem with **three-stage execution**:

#### Stage 1: Dice Analyze (DM-initiated)

```python
message_type == "dice_analyze"
  ├─ AI analyzes Chinese description → check parameters
  │  └─ Uses ensure_strict_json() for structured extraction
  ├─ Persists DiceRequest to DB with recipients list
  └─ Broadcasts dice_request to targets + DM
```

**Inputs**: User description like "火球术 DEX 豁免 DC15" or "我试图欺瞒守卫"
**AI Extraction**: Type (check/save/contest), ability/skill, DC, dice formula
**Database**: `DiceRequest` table with UUID request_id for recovery after refresh

#### Stage 2: Dice Execute (Player or DM rolls)

```python
message_type == "dice_execute"
  ├─ Authorization: Players roll for themselves; DMs roll for monsters
  ├─ Load character/monster stats for modifier calculation
  ├─ Roll expression with modifier
  ├─ AI adjudication (for saves and contests)
  │  ├─ Save adjudication: Validate DC success/failure
  │  └─ Contest adjudication: Compare two rolls (attacker vs defender)
  ├─ Generate narrative if description provided
  └─ Broadcast dice_roll with visibility rules
```

**Key Pattern**: Uses `AIService.ensure_strict_json()` for **strict output validation** with retry logic:

- Attempts up to 3 times to get valid JSON
- Falls back to local calculation if AI fails
- Server overrides invalid AI results (safety mechanism)

**Visibility Rules**:

- Public (明骰): Visible to all
- Private (暗投): Only visible to roller + DMs + recipients

#### Stage 3: Status Tracking

- `DiceRequest.completed_by`: Array of user_ids who've rolled
- `DiceRequest.is_completed`: True when all recipients have rolled
- Updates broadcast with each roll to track multi-target requests

### 1.4 AI Lock Pattern for Sequential Calls

**Critical Design**: Global asyncio.Lock on websocket_endpoint function

```python
if not hasattr(websocket_endpoint, "_ai_lock"):
    websocket_endpoint._ai_lock = asyncio.Lock()

async with websocket_endpoint._ai_lock:  # Prevents concurrent AI calls
    # AI operations (严禁并发)
```

This enforces **strictly sequential AI calls** to avoid rate limiting. This is a **function-level singleton pattern** - unconventional but effective.

---

## 2. Module Parsing Pipeline

### 2.1 Orchestrator Pattern

**File**: `backend/app/domain/parsing/orchestrator.py`

Implements **multi-stage pipeline orchestration** with 6 parsing stages:

```
Stage 1: TOC Extraction (Rules-based or AI-based)
Stage 2: Appendix Identification (AI classification)
Stage 3: Content Extraction
Stage 4: Monster Extraction
Stage 5: Item Extraction
Stage 6: Image Extraction
```

### 2.2 Unique Pattern: Appendix Type Classification

```python
async def _classify_appendix_with_ai(title: str, content_preview: str) -> str:
    # Classifies appendices into: monsters | items | spells | npcs | other
    # Uses FAST model for quick classification
    # Falls back to error if FAST model not configured
```

**Architecture**: Each appendix contains first 10,000 chars sent to AI for type determination, then routed to appropriate parser.

### 2.3 Parser Base Class Pattern

**File**: `backend/app/domain/parsing/parsers/base.py`

```python
class IParser(ABC):
    @abstractmethod
    async def parse(self, content: str, **kwargs) -> ParseResult
    
class BaseParser(IParser):
    # Shared utilities: JSON extraction, sanitization, colored logging
    def _extract_json_from_response_common(ai_response: str)
    def _sanitize_json(text: str)  # Fix Python booleans, trailing commas, escapes
```

**JSON Recovery Strategy**:

1. Extract from fenced code blocks (```json...```)
2. Scan for balanced {...} or [...]
3. Sanitize: `True→true`, `None→null`, fix backslash escapes

### 2.4 Output Structure

All parsed results saved to `/dnd-platform/upload/{user_id}/parsed/`:

```json
{
  "toc": [...],
  "chapters": [...],
  "monsters": [...],
  "items": [...],
  "images": [...],
  "metadata": {
    "total_chapters": N,
    "total_monsters": N,
    "total_items": N
  },
  "errors": [...]
}
```

---

## 3. State Management Patterns

### 3.1 Frontend State Management

#### Zustand Stores (with localStorage persistence)

**File**: `frontend/app/stores/diceOverlay.ts`

```typescript
interface DiceRequest {
  request_id: string;
  issuer_user_id: string;
  recipients?: string[];
  is_private?: boolean;
  check: any;
  completed_by?: string[];
  is_completed?: boolean;
}

export const useDiceOverlayStore = create<DiceOverlayState>((set, get) => ({
  requests: [],
  add: (req) => { ... },
  update: (id, partial) => { ... },
  remove: (id) => { ... },
  clear: () => { ... },
}));
```

**Pattern**: Optimistic updates - UI adds request immediately, server broadcasts confirmation/updates

#### Custom Hooks for Data Loading

**Files**: `frontend/app/components/map/hooks/useMapData.ts`

```typescript
interface UseMapDataProps {
  campaignId: string;
  currentMapUrl?: string | null;
  selectedCharacterId?: number | null;
  isDM?: boolean;
  // State setters
  setTokens: (tokens: Token[] | updater) => void;
  setFogData: (data: FogData | null) => void;
  // ... more setters
}
```

**Responsibilities**:

1. Load map image and verify dimensions
2. Load tokens for current map (filtered by map_url)
3. Load fog of war state
4. Load rulers and drawings
5. Hydrate token HP from character sheets when missing
6. Persist initial map viewport state

**HP Enrichment Logic**: Only persists HP for tokens with `current_hp === null/undefined/0`

### 3.2 Backend State Management

#### Database Schema Relationships

**Core Tables**:

- `campaigns` - Campaign metadata
- `campaign_members` - Members with role + selected character
- `characters` - Character sheets (normalized, ~50 JSON columns)
- `monster_instances` - Monster instances per campaign (with current_hp)
- `tokens` - Map tokens (character_id OR monster_instance_id OR item_data)

**Unique Constraint Pattern**:

```python
# Token has 3 nullable foreign keys:
character_id        # Character token (unique per map)
monster_instance_id # Monster token (multiple allowed per map)
item_data          # Item token (JSON data)

__table_args__ = (
    UniqueConstraint("campaign_id", "character_id", "map_url", 
                     name="uq_token_char_map"),
)
```

This allows:

- Max 1 character token per map
- Multiple monster instances on same map
- Multiple item stacks

#### Dice Request/Roll Persistence

**Tables**:

- `dice_requests` - DM-initiated check requests (request_id, recipients, is_completed)
- `dice_rolls` - Individual roll results (roll_id, request_id, roller_user_id, visible_to)

**Recovery Pattern**: On browser refresh, UI can recover pending requests from DB by campaign_id

---

## 4. Canvas/Map System (Konva.js)

### 4.1 Component Extraction Architecture

**File**: `frontend/app/components/map/TacticalMap.client.tsx` (410 lines)

Originally **1,804 lines → refactored to 410 lines** (commit de746a1) by extracting:

```
hooks/
  ├─ useMapState.ts      - All useState declarations
  ├─ useMapData.ts       - Data loading effects
  ├─ useMapEvents.ts     - Konva event handlers
  └─ useMapWebSocket.ts  - WebSocket message routing
utils/
  └─ mapCalculations.ts  - Geometry helpers
components/
  ├─ TokenComponent.tsx
  ├─ TokenModal.tsx
  ├─ FogOfWarRenderer.tsx
  ├─ RulerRenderer.tsx
  ├─ DrawingsRenderer.tsx
  └─ [others]
```

### 4.2 State Hook Composition

**useMapState.ts**: Returns 40+ state variables:

```typescript
containerRef, stageRef, saveViewStateTimerRef
stageSize, stagePos, stageScale
tokens, editingTokenId, editingTokenHP
fogBrushSize, fogData
rulers, gridUnitLength
drawings
mapImage, mapImageLoaded
```

**useMapData.ts**: Loads initial state

- Map image dimensions
- Campaign tokens filtered by current map_url
- Fog, rulers, drawings
- Grid unit length

**useMapWebSocket.ts**: Routes WebSocket messages to state setters

**Pattern**: Each hook is **independently testable** and **composable**

### 4.3 Token Handling Architecture

**Three Token Types**:

1. **Character Token**
   - Linked to `Character` table
   - Unique per map
   - Shows character avatar + name
   - HP tracked separately (current_hp on Token)

2. **Monster Token**
   - Linked to `MonsterInstance` (which has full monster_data JSON)
   - Multiple instances allowed per map
   - Shows avatar + instance name + current HP

3. **Item Token**
   - Stored entirely in `Token.item_data` (JSON)
   - Shows item icon + quantity
   - Stackable

**Token Size Format**: `"WxH"` (grid units)

- `"1x1"` - Medium character
- `"2x2"` - Large creature
- `"0.5x0.5"` - Item stack

### 4.4 View State Persistence

**WebSocket Message**: `map_view_state_update`

- Persists stage position (x, y)
- Persists stage scale (zoom level)
- Debounced save (timer-based)

---

## 5. Database Schema Design

### 5.1 3NF Normalized AI Settings

**Tables**:

```python
# Main settings table
ai_api_settings
├── id (PK)
├── user_id (unique, default="global")
├── created_at, updated_at
└── model_configs (one-to-many)

# Model configurations (one row per model type per user)
ai_model_configs
├── id (PK)
├── settings_id (FK → ai_api_settings, CASCADE)
├── model_type (Enum: CHAT, FAST, ADVANCED, VISION, AVATAR, IMAGE, TRANSLATION, MUSIC)
├── api_url
├── api_key (Text, not exposed in responses)
├── model_name
└── created_at, updated_at
```

**Cascade Delete**: Deleting settings cascades to all model configs

**Service Layer**: `AIModelService` provides:

- `get_model_config(db, model_type)` - Loads by type
- `get_all_settings(db)` - With eager loading
- `create_or_update_model_config()` - Upsert pattern

### 5.2 Chat Message Persistence

**Table**: `chat_messages`

```python
id
campaign_id (FK, CASCADE)
sender_user_id    # "ai" for AI messages
sender_role       # "dm", "player", "ai"
message_type      # "chat", "ai", etc.
content
recipients        # JSON array of user_ids (private chat)
is_private        # Boolean
mentions          # JSON array ["ai"] if @ai mentioned
meta              # JSON (flexible per message type)
reply_to_id       # Optional reference to replied message
created_at
```

**Unique Features**:

- AI messages stored with sender_user_id="ai"
- reply_to_id enables threading
- meta field extensible for future features

### 5.3 Cascade Delete Design

**Central Pattern**: Campaign deletion cascades to:

- campaign_members
- characters (user-specific, NOT deleted)
- tokens
- fog_of_war
- rulers, drawings
- dice_requests, dice_rolls
- monster_instances

All foreign keys use `ondelete="CASCADE"`

---

## 6. AI Integration Points

### 6.1 Model Configuration Service

**File**: `backend/app/services/ai_model_service.py`

**Key Methods**:

1. **get_model_config(model_type: ModelType)**
   - Uses raw SQL text() to avoid PostgreSQL enum issues
   - Raises HTTPException if not configured
   - Validates all required fields present

2. **list_available_models(user_id)**
   - Returns all models with is_configured flag

3. **create_or_update_model_config()**
   - Upsert pattern: update if exists, create if not

### 6.2 Model Types and Usage

| Type | Purpose | Used In |
|------|---------|---------|
| CHAT | General dialogue | Chat, dice analysis, narratives |
| FAST | Quick classification | Appendix type detection |
| ADVANCED | Complex tasks | Content extraction |
| VISION | Image analysis | (Future) image extraction |
| AVATAR | Avatar generation | Character/monster avatars |
| IMAGE | General image gen | (Future) map generation |
| TRANSLATION | Language | Module translation |
| MUSIC | Music generation | (Future) BGM generation |

### 6.3 AI Service Base

**File**: `backend/app/services/ai_service.py`

```python
class AIService:
    @staticmethod
    async def generate_completion(api_url, api_key, model, messages, 
                                  temperature=0.7, max_tokens=1000) -> str
    
    @staticmethod
    async def generate_completion_stream(...) -> AsyncGenerator[str, None]
    
    @staticmethod
    async def fetch_models(api_url, api_key) -> List[ModelInfo]
```

**Features**:

- OpenAI-compatible API support
- Qwen/Alibaba DashScope compatible mode
- Model-specific parameter support (gpt-5 excluded from sampling params)
- HTTP/1.1 only (avoids h2 dependency)

---

## 7. Complex Subsystems

### 7.1 Character Sheet Service

**File**: `backend/app/services/character_sheet_service.py`

Computes derived properties:

- HP (max_hp from class + CON modifier)
- AC (from armor + DEX modifier + class features)
- Skill bonuses (ability modifier + proficiency)
- Saving throw bonuses
- Spell casting ability + DC

### 7.2 Avatar Service

**File**: `backend/app/services/avatar_service.py`

Generates avatars for characters and monsters using configured IMAGE model

### 7.3 Translation Service

**File**: `backend/app/services/translation_service.py`

Handles module content translation (EN ↔ CN)

---

## 8. Design Patterns & Conventions

### 8.1 Async/Await Pattern

**Consistent throughout**:

- All database operations use AsyncSession
- WebSocket handlers are async
- Parsers are async
- Services are async-first

### 8.2 Error Handling

**WebSocket Level**:

```python
try:
    async with async_session_maker() as db:
        # operations
    await db.commit()
except Exception as e:
    print(f"[Context] Error message: {e}")
    # Continue or broadcast error
```

**Parser Level**:

```python
ParseResult.errors: List[str]  # Accumulate errors, don't crash
```

### 8.3 Logging Pattern

**Custom logger factory**:

```typescript
// Frontend
const logger = createLogger('ComponentName');
logger.debug(), logger.warn(), logger.error()

// Backend
self.logger = logger or logging.getLogger(__name__)
```

### 8.4 Module Normalization

`normalize_campaign_id()` ensures string consistency across WebSocket management

### 8.5 Singleton Service Pattern

```python
ai_model_service = AIModelService()  # Module-level singleton
```

Imported and used throughout backend

---

## 9. Critical Architectural Decisions

| Decision | Trade-off |
|----------|-----------|
| **Monolithic WebSocket handler** | Simplicity vs. maintainability (960 lines in one endpoint) |
| **Function-level asyncio.Lock** | Prevents race conditions but unconventional pattern |
| **String campaign IDs** | Consistency but requires normalization everywhere |
| **AI results with server override** | Safety vs. complexity (fallback validation) |
| **Full monster_data in JSON** | Flexibility but denormalized schema |
| **Set-based connection tracking** | O(1) operations but unordered |
| **3NF AI settings** | Normalized but requires joins for queries |
| **Component extraction via hooks** | Reusability but 40+ prop drilling |
| **Zustand + localStorage** | Client-side persistence but offline-first risk |

---

## 10. Performance Considerations

### 10.1 Database Indexes

```python
# Dice requests
Index("ix_dice_request_campaign_created", "campaign_id", "created_at")
Index("ix_dice_request_campaign_completed", "campaign_id", "is_completed")

# Dice rolls
Index("ix_dice_roll_campaign_created", "campaign_id", "created_at")

# Tokens
ForeignKey with index=True on campaign_id, character_id, etc.
```

### 10.2 Query Optimization

**Eager loading pattern**:

```python
selectinload(AIAPISettings.model_configs)  # Load all configs in one query
```

**Raw SQL for enum avoidance**:

```python
stmt = text("""
    SELECT ai_model_configs.*
    FROM ai_model_configs
    WHERE model_type = :model_type
""")  # Avoids PostgreSQL enum casting issues
```

### 10.3 WebSocket Optimization

- Ignore own messages (prevents UI flashing)
- Debounced view state saves
- Set-based duplicate prevention

---

## 11. Known Limitations

1. **Monolithic websocket.py** - Should use handler registry (700+ line endpoint)
2. **No connection health checks** - Only basic connect/disconnect
3. **AI call serialization** - Global lock prevents concurrent API calls (safety feature but throughput limiter)
4. **Character HP denormalized** - Stored in both character sheet and token table
5. **Parser content.py** - 51KB file exceeds modularization guideline
6. **modules.py** - 53KB route file needs splitting
7. **Form state** - Character creation is 55KB frontend component
8. **No transaction rollback** - dice_roll creation has no rollback on broadcast failure

---

## 12. Recommended Architecture Improvements

1. **Extract websocket message handlers** into handler registry (follow CLAUDE.md pattern)
2. **Replace function-level lock** with context manager or global service
3. **Split large parsers** (content.py, monster.py) into smaller modules
4. **Add database transaction wrappers** for critical operations
5. **Implement connection health monitoring** with heartbeat detection
6. **Normalize character HP** - single source of truth (character table only)
7. **Add parser retry logic** with exponential backoff for transient failures
8. **Implement Redis caching** for frequent queries (module metadata, model configs)
