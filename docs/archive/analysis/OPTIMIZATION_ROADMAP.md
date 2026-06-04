# Codebase Optimization Roadmap
**Last Updated:** November 10, 2025

Quick reference guide for implementing optimizations identified in CODEBASE_ANALYSIS.md

---

## Critical Issues (Implement First)

### 1. File Size Refactoring

#### ChatPanel.tsx (1702 lines) → Extract Custom Hooks
```bash
# Path: frontend/app/components/ui/ChatPanel.tsx

# Create these files:
frontend/app/components/ui/hooks/useChatMessages.ts   # Message state & operations
frontend/app/components/ui/hooks/useChatAI.ts         # AI streaming state
frontend/app/components/ui/hooks/useChatSearch.ts     # Search functionality
frontend/app/components/ui/hooks/useChatUI.ts         # Modal, tab, dropdown state

# ChatPanel.tsx becomes thin composition layer (~300 lines)
```

#### modules.py (1515 lines) → Split into 4 Files
```bash
# Path: backend/app/api/routes/modules.py

# New structure:
backend/app/api/routes/modules_upload.py      # File upload handling
backend/app/api/routes/modules_parsing.py     # Parse coordination
backend/app/api/routes/modules_status.py      # Status endpoints
backend/app/utils/file_processors.py          # ZIP extraction, validation

# modules.py becomes router aggregator
```

#### websocket.py (947 lines) → Split into Handler Modules
```bash
# Path: backend/app/api/routes/websocket.py

# New structure:
backend/app/api/routes/websocket.py           # Core connection (150 lines)
backend/app/services/websocket_handlers/
  ├── chat_handler.py                         # Chat message logic
  ├── dice_handler.py                         # Dice roll processing
  ├── map_handler.py                          # Map/token updates
  └── drawing_handler.py                      # Drawing/fog updates
```

---

## High Priority Fixes

### 2. Type Safety - Replace 'any' Types

**Affected Files (69+):**

```typescript
// Step 1: Create comprehensive type definitions
frontend/app/types/
  ├── campaign.ts          # Campaign, CampaignMember, Campaign data
  ├── character.ts         # Character, Spell, Equipment
  ├── module.ts           # Module, ModuleMap, Content
  ├── dice.ts             # DiceCheck, DiceRoll, DiceRequest
  ├── websocket.ts        # WebSocketMessage types
  └── game.ts             # Token, Monster, Shop, etc.

// Step 2: Update ChatPanel.tsx specifically
// Replace line 26: meta?: any
interface Message {
  id: string;
  dbId?: number;
  user: string;
  senderUserId?: string;
  senderRole?: string;
  content: string;
  type: "chat" | "system" | "dice";
  timestamp: Date;
  createdAt?: string;
  recipients?: string[];
  isDeleted?: boolean;
  meta?: Record<string, unknown>;  // Instead of any
}

// Step 3: Update campaign.$id.dm.tsx
// Replace line 29: const [moduleMaps, setModuleMaps] = useState<any[]>([])
interface ModuleMap {
  id: number;
  name: string;
  imageUrl: string;
  width: number;
  height: number;
}
const [moduleMaps, setModuleMaps] = useState<ModuleMap[]>([])
```

### 3. Backend Service Layer - Extract Helpers

```python
# Create: backend/app/services/ai_model_service.py
from sqlalchemy.ext.asyncio import AsyncSession
from app.models.ai_settings import AIModelConfig, ModelType
from fastapi import HTTPException, status

async def get_model_config(
    db: AsyncSession,
    model_type: ModelType,
    user_id: str = "global"
) -> AIModelConfig:
    """Extract from ai_settings.py lines 26-86"""
    pass

async def get_all_settings(
    db: AsyncSession,
    user_id: str = "global"
) -> AIAPISettings:
    """Extract from ai_settings.py lines 89-120"""
    pass

async def validate_model_config(config: AIModelConfig) -> bool:
    """New validation logic"""
    pass

# Update imports in all routes:
# REMOVE: from app.api.routes.ai_settings import get_model_config
# ADD:    from app.services.ai_model_service import get_model_config
```

### 4. Database Query Optimization

#### shops.py - Fix N+1 Query (Line 327-330)
```python
# BEFORE (N+1 queries):
for idx, e in enumerate(equip_list):
    res_item = await db.execute(select(Item).where(Item.id == e['item_id']))
    item = res_item.scalar_one_or_none()

# AFTER (Single query):
item_ids = [e['item_id'] for e in equip_list]
stmt = select(Item).where(Item.id.in_(item_ids))
items_result = await db.execute(stmt)
item_map = {item.id: item for item in items_result.scalars()}

for idx, e in enumerate(equip_list):
    item = item_map.get(e['item_id'])
```

#### All Routes - Add Eager Loading
```python
# Pattern for all relationships:
from sqlalchemy.orm import selectinload

# Instead of:
stmt = select(Campaign)

# Use:
stmt = select(Campaign).options(
    selectinload(Campaign.members),
    selectinload(Campaign.characters)
)
```

### 5. Remove Console Logging / Add Logger Utility

```typescript
// Create: frontend/app/utils/logger.ts
export const createLogger = (module: string) => {
  const isDev = process.env.NODE_ENV === 'development';
  
  return {
    debug: (message: string, data?: any) => {
      if (isDev) console.log(`[${module}] ${message}`, data);
    },
    error: (message: string, error?: any) => {
      if (isDev) console.error(`[${module}] ${message}`, error);
    },
    warn: (message: string, data?: any) => {
      if (isDev) console.warn(`[${module}] ${message}`, data);
    }
  };
};

// Usage in ChatPanel.tsx:
// REMOVE: console.log("[ChatPanel]", ...)
// ADD:
const logger = createLogger('ChatPanel');
logger.debug('message received', messageData);
```

### 6. Fix Hardcoded User IDs

```typescript
// Update: frontend/app/components/campaign/ModuleScriptPanel.tsx
// Line 46-50
// BEFORE:
const response = await fetch(endpoint, {
  headers: {
    'X-User-ID': '0' // TODO: 从实际用户上下文获取
  }
});

// AFTER:
import { useAuth } from '~/contexts/AuthContext';  // Need to create this

const { userId } = useAuth();
const response = await fetch(endpoint, {
  headers: {
    'X-User-ID': userId
  }
});
```

---

## Medium Priority Improvements

### 7. Frontend Service Layer

```typescript
// Create: frontend/app/services/moduleService.ts
export const moduleService = {
  async uploadModule(file: File, userId: string) {
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch(`${API_URL}/api/modules/upload`, {
      method: 'POST',
      headers: { 'X-User-ID': userId },
      body: formData
    });
    return response.json();
  },

  async getParseStatus(moduleId: string) {
    const response = await fetch(`${API_URL}/api/modules/${moduleId}/parse-status`, {
      headers: { 'X-User-ID': getCurrentUserId() }
    });
    return response.json();
  },

  // ... other methods
};

// Create: frontend/app/services/campaignService.ts
// Create: frontend/app/services/chatService.ts
// Create: frontend/app/services/characterService.ts
```

### 8. React Hook Optimization

```typescript
// ChatPanel.tsx - Consolidate state
// BEFORE: 24 separate useState calls
const [messages, setMessages] = useState<Message[]>([]);
const [input, setInput] = useState("");
const [selectedRecipient, setSelectedRecipient] = useState<string | null>(null);
const [aiTyping, setAiTyping] = useState(false);
// ... 20 more

// AFTER: Group related state with useReducer
interface ChatState {
  messages: Message[];
  input: string;
  selectedRecipient: string | null;
  aiTyping: boolean;
  editingMessageId: number | null;
  // ... others
}

const [state, dispatch] = useReducer(chatReducer, initialState);
```

### 9. WebSocket Pattern Improvements

```python
# Create handler registry in websocket.py
MESSAGE_HANDLERS: Dict[str, Callable] = {
    'chat': handle_chat_message,
    'dice_roll': handle_dice_roll,
    'token_move': handle_token_move,
    'map_update': handle_map_update,
    'drawing': handle_drawing,
    'fog_update': handle_fog_update,
}

# Main loop becomes cleaner:
async def websocket_endpoint(...):
    # ... connection setup
    while True:
        data = await websocket.receive_json()
        message_type = data.get('type')
        handler = MESSAGE_HANDLERS.get(message_type)
        if handler:
            await handler(data, websocket, campaign_id, user_id, db)
```

### 10. Context API for Campaign Data

```typescript
// Create: frontend/app/contexts/CampaignContext.tsx
interface CampaignContextType {
  campaignId: string;
  userId: string;
  isDM: boolean;
  currentMapUrl: string | null;
  mapImageScale: number;
  selectedTool: string;
  // ... other campaign-wide state
}

export const CampaignProvider = ({ children }: { children: React.ReactNode }) => {
  // Centralize all campaign state here
  return (
    <CampaignContext.Provider value={value}>
      {children}
    </CampaignContext.Provider>
  );
};

export const useCampaign = () => {
  const context = useContext(CampaignContext);
  if (!context) throw new Error('useCampaign must be used within CampaignProvider');
  return context;
};

// Update route:
// Wrap components in CampaignProvider
// Replace prop drilling with useCampaign() hook
```

---

## Low Priority Enhancements

### 11. Code Duplication Cleanup

```python
# Create: backend/app/services/avatar_generation_service.py
class AvatarGenerator:
    def __init__(self, model_config: AIModelConfig):
        self.model_config = model_config
        self.semaphore = asyncio.Semaphore(1)
    
    async def generate_avatar(
        self,
        entity_type: str,  # 'monster', 'shop', 'equipment', 'item'
        name: str,
        description: str,
        appearance: str = "",
        output_dir: Path = Path("frontend/public/images")
    ) -> str:
        """Generate and save avatar, return URL"""
        async with self.semaphore:
            prompt = self._build_prompt(entity_type, name, description, appearance)
            image_data = await self._call_avatar_api(prompt)
            file_path = await self._save_image(image_data, entity_type, output_dir)
            return f"/images/{entity_type}/{file_path.name}"
    
    # Helper methods extracted from individual routes

# Update routes to use:
avatar_gen = AvatarGenerator(await get_model_config(db, ModelType.AVATAR))
avatar_url = await avatar_gen.generate_avatar('shop', shop.name, shop.description)
```

### 12. Add WebSocket Heartbeat

```python
# In websocket.py - Add to connection manager
async def send_heartbeat(campaign_id: str):
    while True:
        await asyncio.sleep(30)  # Every 30 seconds
        await manager.broadcast_to_campaign(
            {
                "type": "heartbeat",
                "timestamp": datetime.utcnow().isoformat()
            },
            campaign_id
        )

# In websocket endpoint:
# Start heartbeat task when campaign connection first made
heartbeat_task = asyncio.create_task(send_heartbeat(campaign_id))
```

### 13. Database Connection Pool Configuration

```python
# In backend/app/core/config.py
DATABASE_URL = "postgresql+asyncpg://user:password@host/db?pool_size=20&max_overflow=10"

# Or explicitly in session.py:
engine = create_async_engine(
    DATABASE_URL,
    echo=settings.DEBUG,
    poolclass=NullPool,  # Or AsyncioPool
    pool_size=20,
    max_overflow=10,
    pool_pre_ping=True  # Verify connection health
)
```

---

## Implementation Timeline

### Week 1 (Immediate)
- [ ] Create ai_model_service.py and update imports
- [ ] Create logger utility and replace console.logs
- [ ] Fix hardcoded user IDs in ModuleScriptPanel.tsx, ModuleSelector.tsx
- [ ] Create type definitions for campaign, character, module, dice, websocket

### Week 2
- [ ] Extract ChatPanel.tsx into 4 custom hooks
- [ ] Fix N+1 queries in shops.py
- [ ] Add eager loading to campaigns.py and other routes
- [ ] Create JSONFileManager for modules.py metadata loading

### Week 3
- [ ] Refactor modules.py into 4 separate files
- [ ] Create frontend service layer (moduleService, campaignService, etc.)
- [ ] Implement CampaignContext to replace prop drilling
- [ ] Add WebSocket message handler registry

### Week 4+
- [ ] Refactor websocket.py into handler modules
- [ ] Add comprehensive test suite
- [ ] Avatar generation service consolidation
- [ ] WebSocket heartbeat implementation
- [ ] Performance profiling and optimization

---

## Verification Checklist

After completing optimizations:

- [ ] No files exceed 400 lines (except config/data files)
- [ ] No 'any' types in TypeScript (use unknown | specific types)
- [ ] Console.log usage < 50 total (production-gated only)
- [ ] All database queries use eager loading where applicable
- [ ] No circular dependencies between routes/services
- [ ] All API calls use centralized service layer
- [ ] Unit tests for new services (target 80%+ coverage)
- [ ] WebSocket message handling uses handler registry
- [ ] Campaign context replaces 50%+ of prop drilling

---

## Files Reference

Full analysis: `/Users/haoli/leehow/code/dw/CODEBASE_ANALYSIS.md`
Roadmap: `/Users/haoli/leehow/code/dw/OPTIMIZATION_ROADMAP.md`

---

End of Roadmap
