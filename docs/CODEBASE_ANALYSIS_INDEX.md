# D&D 5E Platform - Codebase Analysis Index

## Documentation Overview

This directory contains a comprehensive analysis of the D&D 5E campaign management platform codebase. Three documents provide different levels of detail:

### 1. ARCHITECTURE_ANALYSIS.md (656 lines)
**Purpose**: Comprehensive system overview and architectural decisions

**Contents**:
- Executive summary of tech stack
- WebSocket architecture deep dive (connection management, message protocol, dice system, AI locking)
- Module parsing pipeline (orchestrator, appendix classification, parser base classes)
- State management patterns (frontend stores, backend schema relationships)
- Canvas/map system (Konva.js component extraction)
- Database schema design (3NF AI settings, cascade deletes)
- AI integration points (model service, model types, API patterns)
- Complex subsystems (character sheets, avatars, translation)
- Design patterns and conventions
- Critical architectural decisions with trade-offs
- Performance considerations
- Known limitations
- Recommended improvements

**Best for**: Getting complete architectural understanding, identifying patterns, understanding trade-offs

---

### 2. DEEP_DIVE_IMPLEMENTATION.md (583 lines)
**Purpose**: Detailed code examples and implementation patterns

**Contents**:
- WebSocket message routing (lifecycle, message type map, dice system flow)
- Dice system deep dive (check types, roll computation, contested checks, visibility)
- Module parsing details (appendix classification, JSON extraction, sanitization)
- State management patterns (token HP enrichment, optimistic updates)
- WebSocket state synchronization (own message filtering, debounced saves)
- AI integration details (model config lookup, strict JSON, fallback validation)
- Database transaction patterns (multi-step dice execution, cascade deletes)
- Connection health monitoring (frontend heartbeat)
- Konva.js integration (stage event handling)
- Character sheet computation (derived properties)

**Best for**: Understanding how specific features work, code examples, implementation details

---

### 3. This File (Index)
**Purpose**: Navigation and quick reference

---

## Quick Reference by Topic

### Real-Time Communication
- **File**: `backend/app/services/websocket_manager.py`
- **Architecture**: Campaign-scoped connection groups using Dict[str, Set[WebSocket]]
- **Read**: ARCHITECTURE_ANALYSIS.md §1.1-1.4, DEEP_DIVE_IMPLEMENTATION.md §1-2
- **Key Pattern**: Active connections organized by campaign_id, cleaned up on disconnect

### Dice System (Most Complex)
- **Files**: 
  - `backend/app/api/routes/websocket.py` (960 lines)
  - `backend/app/models/dice_request.py`
  - `backend/app/models/dice_roll.py`
  - `frontend/app/stores/diceOverlay.ts`
- **Flow**: DM analyzes → persists request → player rolls → AI adjudicates → broadcast
- **Read**: ARCHITECTURE_ANALYSIS.md §1.3, DEEP_DIVE_IMPLEMENTATION.md §2
- **Key Pattern**: Three-stage execution with DB recovery for browser refresh

### Module Parsing
- **Directory**: `backend/app/domain/parsing/`
- **Core Files**:
  - `orchestrator.py` - Multi-stage pipeline
  - `parsers/base.py` - Abstract base + JSON recovery
  - `parsers/{toc,content,monster,item,map}.py` - Specific parsers
- **Read**: ARCHITECTURE_ANALYSIS.md §2, DEEP_DIVE_IMPLEMENTATION.md §3
- **Key Pattern**: AI-powered appendix classification routes content to correct parser

### Frontend State Management
- **Directory**: `frontend/app/stores/` and `frontend/app/components/map/hooks/`
- **Core Pattern**: Zustand stores + custom hooks for data loading
- **Read**: ARCHITECTURE_ANALYSIS.md §3, DEEP_DIVE_IMPLEMENTATION.md §4-5
- **Key Files**:
  - `stores/diceOverlay.ts` - Dice request tracking
  - `hooks/useMapState.ts` - All state vars
  - `hooks/useMapData.ts` - Data loading
  - `hooks/useMapWebSocket.ts` - WS message routing
  - `hooks/useMapEvents.ts` - Konva event handlers

### Canvas/Map System
- **Files**: `frontend/app/components/map/TacticalMap.client.tsx` (410 lines, refactored from 1804)
- **Read**: ARCHITECTURE_ANALYSIS.md §4
- **Key Insight**: Originally monolithic, extracted to reusable hooks + components

### Database Design
- **SQLAlchemy Models**: `backend/app/models/*.py`
- **Key Tables**:
  - `campaigns` - Campaign metadata
  - `campaign_members` - Members with role + selected character
  - `characters` - Character sheets
  - `tokens` - Map tokens (polymorphic: character/monster/item)
  - `dice_requests` - DM-initiated check requests
  - `dice_rolls` - Individual roll results
  - `ai_api_settings` + `ai_model_configs` - 3NF normalized AI config
- **Read**: ARCHITECTURE_ANALYSIS.md §5

### AI Integration
- **Service Layer**: `backend/app/services/ai_model_service.py`, `ai_service.py`
- **Models Enum**: 8 types (CHAT, FAST, ADVANCED, VISION, AVATAR, IMAGE, TRANSLATION, MUSIC)
- **Read**: ARCHITECTURE_ANALYSIS.md §6, DEEP_DIVE_IMPLEMENTATION.md §6
- **Key Pattern**: OpenAI-compatible API with strict JSON enforcement + retries

---

## Architecture Highlights

### Unique Patterns

1. **Function-Level Singleton Lock** (Line 134 of websocket.py)
   - Ensures strictly sequential AI calls
   - Prevents race conditions
   - Unconventional but effective

2. **Campaign-Scoped Connection Grouping**
   - Each campaign has isolated connection set
   - No cross-campaign leakage
   - Set-based for O(1) operations

3. **Three-Stage Dice Execution**
   - Stage 1: DM analyzes description → persists DiceRequest
   - Stage 2: Player/DM rolls → computes modifier → AI adjudication
   - Stage 3: Broadcast result with DB recovery support

4. **JSON Recovery Algorithm (3-Tier Fallback)**
   - Fenced code blocks
   - Balanced bracket scanning
   - Sanitization of Python syntax

5. **Own Message Filtering Pattern**
   - DM draws fog → broadcasts back
   - Without filter: flashing/duplication
   - Pattern: sender ignores own messages

6. **Token Polymorphism via Nullable FKs**
   - One row per token (character_id OR monster_instance_id OR item_data)
   - Allows character/item/monster tokens on same map
   - Enforces unique constraint for character tokens

---

## Key Files by Size & Importance

### Large Files (Refactoring Candidates)
1. `websocket.py` (960 lines) - Monolithic message handler
2. `modules.py` (53KB) - Route file needs splitting
3. `content.py` (51KB) - Parser file needs modularization
4. Character creation component (55KB) - Form state complexity

### Service Layer
- `ai_model_service.py` - Model config management
- `ai_service.py` - OpenAI-compatible API client
- `character_sheet_service.py` - Derived property computation
- `avatar_service.py` - Avatar generation
- `translation_service.py` - Content translation

### Critical Components
- `TacticalMap.client.tsx` (410 lines, refactored)
- `useMapWebSocket.ts` (259 lines) - Message routing
- `DiceOverlay` store - Dice request tracking

---

## Architectural Decisions with Trade-offs

| Decision | Rationale | Trade-off |
|----------|-----------|-----------|
| Monolithic websocket.py | Simpler initial implementation | Harder to maintain/test |
| String campaign IDs | Consistency across systems | Requires normalization |
| Global asyncio.Lock | Prevents AI rate limiting | Throughput bottleneck |
| Server override of AI results | Safety/correctness | Complexity in validation |
| Cascade deletes on campaign | Data integrity | Can't recover deleted data |
| Zustand + localStorage | Client persistence | Offline-first risk |
| Component extraction via hooks | Reusability | 40+ prop drilling |

---

## Common Patterns to Reuse

### Pattern 1: Broadcast with Visibility Rules
```python
if is_private:
    await manager.send_to_recipients(payload, campaign_id, recipients)
else:
    await manager.broadcast_to_campaign(payload, campaign_id)
```

### Pattern 2: AI with Fallback
```python
try:
    ai_result = await ensure_strict_json(...)
except:
    ai_result = local_computation()  # Fallback
```

### Pattern 3: Optimistic Update
```typescript
// Frontend
store.add(optimisticData);  // Update immediately
// Backend
manager.broadcast(confirmation);  // Confirm when ready
```

### Pattern 4: Debounced Save
```typescript
if (timer) clearTimeout(timer);
timer = setTimeout(async () => {
    await save();
}, 1000);  // Save after 1s of inactivity
```

### Pattern 5: Own Message Filtering
```typescript
if (isDM && message.user_id === userId) return;  // Skip own
```

---

## Performance Considerations

### Database Indexes
- Composite index on (campaign_id, created_at) for dice requests/rolls
- Foreign key indexes on campaign_id, character_id, etc.
- Unique constraints on character tokens per map

### Query Optimization
- Eager loading via selectinload() for model configs
- Raw SQL text() to avoid PostgreSQL enum casting
- Debounced saves for viewport state

### WebSocket Optimization
- Own message filtering prevents echo
- Set-based connection tracking for O(1) operations
- Async-first throughout

---

## Known Limitations & Future Improvements

### Limitations
1. No connection health checks (only connect/disconnect)
2. Global AI lock prevents concurrent requests
3. Character HP denormalized (both character + token tables)
4. Large files exceed 400-line guideline

### Recommended Improvements
1. Extract websocket handlers into registry (follow CLAUDE.md pattern)
2. Replace function-level lock with context manager
3. Split large parsers (content.py, monster.py)
4. Add transaction wrappers for critical operations
5. Implement Redis caching for frequent queries
6. Normalize character HP (single source of truth)

---

## How to Use These Documents

### For Architecture Review
1. Start with ARCHITECTURE_ANALYSIS.md §1 (WebSocket)
2. Read §2 (Module Parsing) for complex subsystem
3. Read §5-6 (Database & AI) for integration points
4. Review §9-11 (Decisions, Performance, Limitations)

### For Feature Development
1. Read relevant section in ARCHITECTURE_ANALYSIS.md
2. Look up code examples in DEEP_DIVE_IMPLEMENTATION.md
3. Find pattern in "Common Patterns to Reuse" section
4. Check database schema in §5

### For Refactoring
1. Review "Recommended Improvements" in ARCHITECTURE_ANALYSIS.md §12
2. Look at large files section above
3. Study "Monolithic websocket.py" pattern in DEEP_DIVE_IMPLEMENTATION.md §1
4. Check CLAUDE.md for handler registry pattern

---

## Document Statistics

- ARCHITECTURE_ANALYSIS.md: 656 lines, 12 major sections
- DEEP_DIVE_IMPLEMENTATION.md: 583 lines, 10 detailed sections
- Total: 1,239 lines of analysis

---

## Related Files in Repository

- `CLAUDE.md` - Project instructions and architecture overview
- `README.md` - Quick start guide
- `dev-start.sh` - Development startup script
- `backend/alembic/` - Database migrations
- `backend/app/main.py` - FastAPI application setup

---

Generated: 2025-11-18
Last Updated: Analysis reflects current codebase state as of latest commit
