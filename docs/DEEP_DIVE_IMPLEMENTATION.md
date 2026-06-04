# D&D 5E Platform - Deep Dive: Implementation Details & Patterns

## 1. WebSocket Message Routing Patterns

### 1.1 Connection Lifecycle

```python
# CONNECT PHASE
await manager.connect(websocket, campaign_id, user_id, role)
  ├─ await websocket.accept()
  ├─ Add to active_connections[campaign_id]
  ├─ Store connection_info[websocket] = {campaign_id, user_id, role}
  └─ Send "connected" message to this client
  └─ Broadcast "user_joined" to others

# LISTEN PHASE (infinite loop)
while True:
    data = await websocket.receive_json()
    message_type = data.get("type")
    
    # Route by type and handle
    if message_type == "chat": ...
    elif message_type == "dice_analyze": ...
    # etc.

# DISCONNECT PHASE
on WebSocketDisconnect:
    manager.disconnect(websocket)  # Clean up data structures
    └─ Broadcast "user_left"
```

### 1.2 Message Type Routing Map

```
COMMUNICATION
├─ chat              (public message)
├─ ai_stream         (AI response chunks)
└─ connected/user_joined/user_left

DICE SYSTEM
├─ dice_analyze      (DM initiate request)
├─ dice_execute      (Player/DM roll)
├─ dice_request      (broadcast to targets)
└─ dice_roll         (broadcast result)

MAP STATE
├─ map_update        (generic map changes)
├─ token_move        (token position)
├─ token_placed      (new token)
├─ token_removed     (delete token)
├─ token_hp_update   (HP change)
├─ token_params_update (custom params)
├─ character_avatar_updated
├─ map_scale_update  (zoom level)
├─ grid_unit_update  (ruler scale)
└─ rest_grant        (grant rest to players)

FOG OF WAR
├─ fog_update        (incremental change)
├─ fog_fill_all      (fully reveal map)
└─ fog_clear_all     (fully hide map)

RULERS
├─ ruler_added
├─ ruler_removed
└─ rulers_cleared

DRAWINGS
├─ drawing_added
├─ drawing_updated
├─ drawing_removed
└─ drawings_cleared

SHOPS
└─ shop_transaction
```

## 2. Dice System Deep Dive

### 2.1 Check Type Definitions

```python
# From websocket.py analysis prompt
check = {
    "type": "check" | "save" | "contest",
    "ability": "strength" | "dexterity" | ... | None,
    "skill": "athletics" | "acrobatics" | ... | None,
    "dc": int | None,
    "dice": "1d20" | "2d6+3" | ...,  # default "1d20"
    "description": "narrative description",
    "contest": {  # Only for type="contest"
        "attacker": {"ability"?: str, "skill"?: str},
        "defender": {"ability"?: str, "skill"?: str},
        "tie_rule"?: "no_change" | "attacker" | "defender"
    }
}
```

### 2.2 Roll Computation Flow

```python
# Input: check config + character stats
result = roll_expression(final_expr)  # Evaluates "1d20+5"
  returns {
    "expression": "1d20+5",
    "rolls": [[20], [5]],  # Individual die rolls
    "modifier": 5,
    "total": 25
  }

# Validation
is_critical = (first_die == 20)  # Auto 20
is_fumble = (first_die == 1)     # Auto 1
success = (total >= dc) if dc else None

# AI Adjudication (optional)
if type == "save" and dc:
    ai_result = await ensure_strict_json(
        schema={
            "success": bool,
            "public_summary": str?,
            "private_detail": str?
        }
    )
    if ai_result.success != local_success:
        ai_result.success = local_success  # Server override
```

### 2.3 Contested Check Flow

```python
# TWO-PHASE EXECUTION
Phase 1: Attacker rolls
  ├─ Load attacker skill/ability
  ├─ Compute modifier
  ├─ Roll d20+modifier
  └─ Persist to dice_rolls with request_id

Phase 2: Defender rolls (later)
  ├─ Check if previous roll exists: SELECT * FROM dice_rolls WHERE request_id
  ├─ Determine I'm defender (not attacker)
  ├─ Load defender skill/ability  
  ├─ Compute modifier
  ├─ Roll d20+modifier
  ├─ AI adjudication: compare totals
  │  ├─ attacker_total vs defender_total
  │  ├─ Apply tie_rule if equal
  │  └─ Determine winner
  └─ Broadcast result with opposed_info
```

### 2.4 Visibility Model

```python
# Message construction
if is_private:  # 暗投 (secret roll)
    recipients = [issuer_user_id] + dm_ids
    message["visible_to"] = recipients
    manager.send_to_recipients(roll_payload, campaign_id, recipients)
else:  # 明骰 (public roll)
    message["visible_to"] = []
    manager.broadcast_to_campaign(roll_payload, campaign_id)

# Frontend receives
if message.visible_to and message.user_id != current_user:
    // Don't show to non-recipients
    return
else:
    // Display roll result
```

## 3. Module Parsing Pipeline Details

### 3.1 Appendix Classification Prompt

```python
prompt = """请分析以下D&D模组附录的标题和内容预览，判断这是什么类型的附录。

附录标题：{title}

内容预览（前10000字符）：
{content_preview}

请从以下类型中选择一个最合适的：
- monsters: 怪物/生物/敌人/友方NPC战斗单位（包含AC、HP、攻击等战斗属性）
- items: 魔法物品/装备/武器/护甲/神器
- spells: 法术/咒语/祷文
- npcs: 非战斗NPC/重要人物/角色介绍（不包含完整战斗属性）
- other: 其他类型

只输出一个单词（monsters/items/spells/npcs/other），不要有任何解释。"""

# PARSER ROUTING
if appendix_type == "monsters":
    result = await monster_parser.parse(...)
elif appendix_type == "items":
    result = await item_parser.parse(...)
# etc.
```

### 3.2 JSON Extraction Recovery Algorithm

```python
def _extract_json_from_response_common(ai_response: str):
    """Three-tier fallback strategy"""
    
    # TIER 1: Fenced code blocks
    fence_pattern = r"```(?:json)?\s*(.*?)```"
    for match in finditer(fence_pattern, ai_response):
        candidate = match.group(1).strip()
        try:
            return json.loads(sanitize_json(candidate))
        except:
            continue  # Try next block
    
    # TIER 2: Balanced bracket scan
    openings = [i for i, ch in enumerate(text) if ch in "[{"]
    for start in openings:
        stack = []
        for i in range(start, len(text)):
            ch = text[i]
            if ch in "[{":
                stack.append(ch)
            elif ch in "]}":
                if not stack or mismatch(stack[-1], ch):
                    break
                stack.pop()
                if not stack:
                    segment = text[start:i+1]
                    try:
                        return json.loads(sanitize_json(segment))
                    except:
                        continue
    
    # TIER 3: Failure
    return None
```

### 3.3 JSON Sanitization Rules

```python
def _sanitize_json(text: str) -> str:
    # RULE 1: Python booleans
    text = text.replace('True', 'true')
    text = text.replace('False', 'false')
    text = text.replace('None', 'null')
    
    # RULE 2: Trailing commas
    text = re.sub(r',(\s*[}\]])', r'\1', text)
    
    # RULE 3: Invalid backslash escapes
    # Valid escapes: \" \\ \/ \b \f \n \r \t \u
    text = re.sub(r'\\(?!["\\/bfnrtu])', r'\\\\', text)
    
    return text
```

## 4. State Management Patterns

### 4.1 Token HP Enrichment Logic

```typescript
// useMapData.ts - Hydration on load
const needCharHP = tokensRaw.filter(t => 
  !!t.character_id && (
    t.current_hp === null || 
    t.current_hp === undefined || 
    t.current_hp === 0
  )
);

// Only persist HP for tokens missing current_hp
const persistHPTokenIds = new Set(
  tokensRaw
    .filter(t => !!t.character_id && 
      (t.current_hp === null || t.current_hp === undefined || t.current_hp === 0))
    .map(t => t.id)
);

// Fetch character sheets
for (const cid of uniqueCharIds) {
    const char = await fetch(`/api/characters/${cid}`).then(r => r.json());
    const maxHp = computeAll(char).maxHp;
    
    // Update token HP only if needed
    if (persistHPTokenIds.has(token.id)) {
        await persistTokenHP(token.id, maxHp);
    }
}
```

### 4.2 Optimistic Update Pattern (Frontend)

```typescript
// Dice Overlay Store
const add = (req: DiceRequest) => {
    const exists = get().requests.some(r => r.request_id === req.request_id);
    if (exists) return;  // No duplicates
    set((state) => ({ requests: [...state.requests, req] }));
};

// On receive dice_request
useDiceOverlayStore.getState().add(message);

// On receive dice_roll
useDiceOverlayStore.getState().update(reqId, { 
    completed_by: new_list,
    is_completed: true
});

// On my roll completes
useDiceOverlayStore.getState().remove(reqId);
```

## 5. WebSocket State Synchronization

### 5.1 Own Message Filtering Pattern

```typescript
// useMapWebSocket.ts - Prevent Echo
const messageUserId = message.user_id;

if (isDM && messageUserId === userId) {
    logger.debug(`Ignoring own ${message.type}`);
    return;  // Skip my own messages
}

// Rationale: DM draws fog, broadcasts message back to self
// Without filter: DM sees flashing/duplication
// Pattern: Sender applies local optimistic update; server broadcasts back but sender ignores
```

### 5.2 Debounced State Saving

```typescript
// Viewport state saves
if (saveViewStateTimerRef.current) {
    clearTimeout(saveViewStateTimerRef.current);
}

saveViewStateTimerRef.current = setTimeout(async () => {
    const state = {
        stagePos: { x: stagePos.x, y: stagePos.y },
        stageScale: stageScale
    };
    await fetch(`/api/map_view_state/${campaignId}`, {
        method: "POST",
        body: JSON.stringify(state)
    });
}, 1000);  // Save 1s after last change
```

## 6. AI Integration Details

### 6.1 Model Configuration Lookup

```python
# ai_model_service.py
async def get_model_config(db, model_type: ModelType, user_id="global"):
    stmt = text("""
        SELECT ai_model_configs.*
        FROM ai_model_configs
        JOIN ai_api_settings 
            ON ai_api_settings.id = ai_model_configs.settings_id
        WHERE ai_api_settings.user_id = :user_id
        AND ai_model_configs.model_type = :model_type
    """)
    result = await db.execute(stmt, {
        "user_id": user_id, 
        "model_type": model_type.value
    })
    row = result.fetchone()
    
    if not row:
        raise HTTPException(404, f"{model_type.value} not configured")
    
    # Map raw row to AIModelConfig object
    config = AIModelConfig(
        id=row[0], settings_id=row[1], model_type=row[2],
        api_url=row[3], api_key=row[4], model_name=row[5],
        created_at=row[6], updated_at=row[7]
    )
    return config
```

### 6.2 Strict JSON Enforcement with Retries

```python
# From websocket.py dice_analyze section
schema_hint = '{"type":"string?","ability":"string?",...}'

parsed = await ensure_strict_json(
    api_url=config.api_url,
    api_key=config.api_key,
    model=config.model_name,
    messages=[
        {"role": "system", "content": sys_prompt},
        {"role": "user", "content": user_prompt},
    ],
    schema_hint=schema_hint,
    temperature=0.2,  # Low temp for consistency
    max_tokens=300,
    max_attempts=3    # Retry up to 3 times
)
```

### 6.3 Fallback Validation

```python
if isinstance(ai_result, dict):
    if ai_result.get("success") != local_success:
        # Server override
        ai_result["success"] = local_success
        ai_result["note"] = "server_override"
    if not check.get("description") and ai_result.get("public_summary"):
        narrative = ai_result.get("public_summary")
```

## 7. Database Transaction Patterns

### 7.1 Multi-Step Transaction in dice_execute

```python
async with async_session_maker() as db:
    # STEP 1: Load related data
    campaign = await db.get(Campaign, int(campaign_id))
    character = await db.get(Character, int(target_character_id))
    
    # STEP 2: Compute values
    modifier = skill_modifier(character_dict, skill_key)
    result = roll_expression(final_expr)
    
    # STEP 3: Create roll record
    db_roll = DiceRoll(
        roll_id=str(uuid.uuid4()),
        campaign_id=int(campaign_id),
        request_id=request_id,
        roller_user_id=target_user_id,
        is_private=is_private,
        roll=roll_payload.get("roll")
    )
    db.add(db_roll)
    
    # STEP 4: Update request status
    if request_id:
        dr = await db.execute(select(DiceRequest).where(...))
        dr = dr.scalar_one_or_none()
        if dr:
            done = set((dr.completed_by or []) + [target_user_id])
            dr.completed_by = list(done)
            if set(dr.recipients or []) <= done:
                dr.is_completed = True
    
    # STEP 5: Commit
    await db.commit()
    
    # STEP 6: Broadcast (after commit)
    await manager.broadcast_to_campaign(roll_payload, campaign_id)
```

### 7.2 Cascade Delete Implications

```python
# When campaign is deleted:
async with async_session_maker() as db:
    campaign = await db.get(Campaign, campaign_id)
    await db.delete(campaign)
    await db.commit()  # Cascades to:

# Automatically deleted:
# - campaign_members
# - monster_instances  
# - tokens
# - fog_of_war
# - rulers, drawings
# - dice_requests, dice_rolls
# - chat_messages
```

## 8. Connection Health Monitoring

### 8.1 Frontend Heartbeat (useWebSocket.ts)

```typescript
// Client-initiated ping
const measureLatency = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
        const timestamp = Date.now();
        pingTimestampRef.current[timestamp] = timestamp;
        
        wsRef.current.send(JSON.stringify({
            type: 'ping',
            timestamp: timestamp
        }));
    }
}, []);

// Receive pong, calculate latency
if (message.type === 'pong' && message.timestamp) {
    const sentTime = pingTimestampRef.current[message.timestamp];
    if (sentTime) {
        const latency = Date.now() - sentTime;
        setConnectionHealth({
            latency,
            lastHeartbeat: Date.now(),
            isHealthy: true
        });
    }
}

// Health check every 5s
const healthCheckInterval = setInterval(() => {
    const now = Date.now();
    if (connectionHealth.lastHeartbeat && 
        now - connectionHealth.lastHeartbeat > 45000) {
        setConnectionHealth(prev => ({
            ...prev,
            isHealthy: false
        }));
    }
}, 5000);
```

## 9. Konva.js Integration Pattern

### 9.1 Stage Event Handling

```typescript
// Canvas pinch-zoom
const handleWheel = (e: KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    
    const scaleBy = 1.05;
    const oldScale = stageRef.current.scaleX();
    const mousePointTo = {
        x: stageRef.current.getPointerPosition().x / oldScale - stageRef.current.x() / oldScale,
        y: stageRef.current.getPointerPosition().y / oldScale - stageRef.current.y() / oldScale,
    };
    
    const newScale = e.evt.deltaY > 0 ? oldScale * scaleBy : oldScale / scaleBy;
    stageRef.current.scale({ x: newScale, y: newScale });
    
    const newPos = {
        x: -(mousePointTo.x - stageRef.current.getPointerPosition().x / newScale) * newScale,
        y: -(mousePointTo.y - stageRef.current.getPointerPosition().y / newScale) * newScale,
    };
    
    setStagePos(newPos);
    setStageScale(newScale);
};
```

## 10. Character Sheet Computation

### 10.1 Derived Properties

```typescript
// CharacterDisplay/utils/derived.ts
export function computeAll(character: Character) {
    return {
        maxHp: computeMaxHP(character),
        ac: computeAC(character),
        initiativeBonus: computeInitiative(character),
        skillBonuses: computeSkillBonuses(character),
        savingThrows: computeSavingThrows(character),
        spellcastingAbility: getSpellcastingAbility(character),
        spellSaveDC: computeSpellSaveDC(character),
        spellAttackBonus: computeSpellAttackBonus(character),
    };
}

// Max HP = class base + (CON modifier * level)
function computeMaxHP(char: Character): number {
    const classData = getClassData(char.class_id);
    const hitDie = classData.hitDie;  // e.g., 8 for Fighter
    const baseHP = hitDie;  // First level
    const levelBonus = (char.level - 1) * hitDie;
    const conMod = getAbilityModifier(char.ability_scores.constitution);
    const totalBonus = conMod * char.level;
    return baseHP + levelBonus + totalBonus;
}
```

