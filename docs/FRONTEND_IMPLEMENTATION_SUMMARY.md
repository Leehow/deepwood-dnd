# Frontend Implementation Summary - Real-Time Character Level Up

## Overview

Implemented real-time character level up synchronization for DM view, allowing DM to see complete player character data changes (ability scores, skills, spells, HP) immediately after level up without manual refresh.

## Implementation Date

2025-11-20

## Changes Made

### 1. DM Page WebSocket Listener (`frontend/app/routes/campaign.$id.dm.tsx`)

**Location**: Lines 115-135

**Changes**:
- Added `character_level_up` message handler in the existing `onMessage` callback
- Dispatches two custom events:
  - `characterLevelUp`: For character list refresh (consumed by CharacterPanel)
  - `tokenHPUpdate`: For map token HP update (consumed by TacticalMap)
- Logs level up event with character name and new level

**Code**:
```typescript
// Handle character level up notifications
if (message.type === "character_level_up" && message.data) {
  logger.debug("[DM] Character level up received:", message.data);

  // Dispatch event for character list refresh
  window.dispatchEvent(new CustomEvent('characterLevelUp', {
    detail: message.data
  }));

  // Dispatch event for token HP update (if character is on map)
  window.dispatchEvent(new CustomEvent('tokenHPUpdate', {
    detail: {
      characterId: message.data.character_id,
      maxHp: message.data.max_hp,
      currentHp: message.data.current_hp
    }
  }));

  // Log notification (toast component will be added later)
  logger.info(`[DM] 🎉 ${message.data.character_name} leveled up to level ${message.data.level}!`);
}
```

**Also added**:
- Import statement for `LevelUpNotification` component (line 13)
- Rendered `<LevelUpNotification />` component in JSX (line 503)

---

### 2. Character Panel Event Listener (`frontend/app/components/character/CharacterPanel.tsx`)

**Location**: Lines 238-248

**Changes**:
- Added `useEffect` hook to listen for `characterLevelUp` custom events
- Calls `loadRoster()` to refresh the character list when event is received
- Logs received data including character name, level, and complete level up data

**Code**:
```typescript
// Listen for character level up events to refresh character roster
useEffect(() => {
  const handler = (e: any) => {
    const data = e.detail;
    logger.debug(`[CharacterPanel] Character level up received: ${data.character_name} -> Level ${data.level}`);
    logger.debug("[CharacterPanel] Complete level up data:", data);
    loadRoster();
  };
  window.addEventListener('characterLevelUp', handler as EventListener);
  return () => window.removeEventListener('characterLevelUp', handler as EventListener);
}, [loadRoster]);
```

**Pattern**: Follows the existing pattern for `rewardUpdate` events (lines 228-236)

---

### 3. Tactical Map Token HP Update (`frontend/app/components/map/TacticalMap.client.tsx`)

**Location**: Lines 149-177

**Changes**:
- Added `useEffect` hook to listen for `tokenHPUpdate` custom events
- Updates token HP values if the character has a token on the current map
- Uses `setTokens` to update token state with new `current_hp` and `max_hp`

**Code**:
```typescript
// Listen for token HP updates from character level up
useEffect(() => {
  const handler = (e: any) => {
    const { characterId, maxHp, currentHp } = e?.detail || {};
    if (typeof characterId !== 'number') return;

    logger.debug(`[TacticalMap] Token HP update for character ${characterId}: ${currentHp}/${maxHp}`);

    // Update token HP if it exists on the map
    setTokens((prevTokens) =>
      prevTokens.map((token) => {
        if (token.character_id === characterId) {
          logger.debug(`[TacticalMap] Updating token ${token.id} HP: ${currentHp}/${maxHp}`);
          return {
            ...token,
            params: {
              ...(token as any).params,
              current_hp: currentHp || (token as any).params?.current_hp,
              max_hp: maxHp || (token as any).params?.max_hp,
            },
          };
        }
        return token;
      })
    );
  };
  window.addEventListener('tokenHPUpdate', handler as any);
  return () => window.removeEventListener('tokenHPUpdate', handler as any);
}, [setTokens]);
```

**Pattern**: Follows the existing pattern for `openTokenParamsEditor` events (lines 137-147)

---

### 4. Level Up Notification Component (NEW FILE)

**File**: `frontend/app/components/ui/LevelUpNotification.tsx`

**Purpose**: Display animated notification when character levels up

**Features**:
- Listens to `characterLevelUp` custom events
- Shows character name, new level, class, max HP, and ability scores
- Auto-dismisses after 8 seconds
- Manual dismiss button
- Progress bar animation showing time until auto-dismiss
- Multiple notifications can stack vertically
- Slide-in animation from right

**Component Structure**:
```typescript
interface LevelUpData {
  character_id: number;
  character_name: string;
  user_id: string;
  level: number;
  class_id: string;
  subclass_id?: string;
  ability_scores: Record<string, number>;
  current_hp?: number;
  max_hp: number;
  timestamp: string;
}
```

**Styling**:
- Gradient background (amber to yellow)
- Fixed position: top-right corner (`top-20 right-4`)
- Z-index: 9999 (above all other UI elements)
- Min width: 320px, Max width: 400px
- Border with amber accent

---

### 5. CSS Animations (`frontend/app/styles/tailwind.css`)

**Location**: Lines 43-72

**Added Animations**:

1. **slide-in-right**: Entry animation for notifications
   ```css
   @keyframes slide-in-right {
     from {
       transform: translateX(100%);
       opacity: 0;
     }
     to {
       transform: translateX(0);
       opacity: 1;
     }
   }
   ```

2. **shrink-width**: Progress bar countdown animation
   ```css
   @keyframes shrink-width {
     from {
       width: 100%;
     }
     to {
       width: 0%;
     }
   }
   ```

**Utility Classes**:
- `.animate-slide-in-right`: 0.3s ease-out entry animation
- `.animate-shrink-width`: Linear countdown animation (duration set inline)

---

## Data Flow

```
Player Levels Up (HTTP POST /characters/{id}/level-up)
    ↓
Backend broadcasts complete character data via WebSocket
    ↓
DM Page WebSocket Handler receives "character_level_up" message
    ↓
Dispatches custom events:
    ├── 'characterLevelUp' → CharacterPanel → loadRoster()
    ├── 'tokenHPUpdate' → TacticalMap → Update token HP
    └── → LevelUpNotification → Show toast notification
```

## Message Structure

**WebSocket Message** (from backend):
```typescript
{
  type: "character_level_up",
  campaign_id: "123",
  data: {
    character_id: 456,
    character_name: "Ragnar",
    user_id: "player-123",
    level: 5,
    class_id: "fighter",
    subclass_id: "champion",
    multiclass_data: null,
    ability_scores: {
      strength: 18,
      dexterity: 14,
      constitution: 16,
      intelligence: 10,
      wisdom: 12,
      charisma: 8
    },
    current_hp: 45,
    max_hp: 52,
    selected_skills: ["athletics", "perception", "intimidation"],
    expertise_skills: [],
    fighting_style: { id: "defense", name: "Defense" },
    selected_spells: null,
    spell_slots_state: null,
    timestamp: "2025-11-20T10:30:00Z"
  }
}
```

## Testing Checklist

### Prerequisites
1. ✅ Backend server running (port 8174)
2. ✅ Frontend server running (port 5174)
3. ✅ PostgreSQL database running
4. ✅ At least one campaign with characters

### Test Scenario 1: Basic Level Up
1. **DM Setup**:
   - Open DM view for campaign
   - Open character panel (right sidebar, "角色" tab)
   - Check console logs for WebSocket connection

2. **Player Action**:
   - Player opens character sheet modal
   - Click "Level Up" button
   - Complete level up process (select class features, etc.)
   - Click "Confirm Level Up"

3. **Expected DM Results**:
   - ✅ Character list updates immediately (no refresh needed)
   - ✅ Character shows new level number
   - ✅ Character shows updated HP (max_hp increased)
   - ✅ Animated notification appears in top-right corner
   - ✅ Notification shows character name, new level, class, and HP
   - ✅ Notification auto-dismisses after 8 seconds
   - ✅ Console logs show:
     ```
     [DM] Character level up received: {...}
     [CharacterPanel] Character level up received: Ragnar -> Level 5
     [CharacterPanel] Complete level up data: {...}
     ```

### Test Scenario 2: Token HP Update
1. **DM Setup**:
   - Have character token on map
   - Note current HP display on token

2. **Player Action**:
   - Player levels up character

3. **Expected DM Results**:
   - ✅ Token HP bar updates immediately
   - ✅ Max HP increases (green bar scales)
   - ✅ Current HP maintains or adjusts proportionally
   - ✅ Console logs show:
     ```
     [TacticalMap] Token HP update for character 456: 45/52
     [TacticalMap] Updating token 789 HP: 45/52
     ```

### Test Scenario 3: Multiple Level Ups
1. **Setup**:
   - Multiple players in campaign
   - DM has DM view open

2. **Action**:
   - Two players level up within 10 seconds of each other

3. **Expected Results**:
   - ✅ Both notifications appear stacked vertically
   - ✅ Both characters update in character list
   - ✅ Both tokens update if on map
   - ✅ Notifications dismiss independently after 8s each

### Test Scenario 4: Notification Interaction
1. **Setup**:
   - Trigger level up notification

2. **Actions & Expected Results**:
   - ✅ Click dismiss button (×) → Notification closes immediately
   - ✅ Progress bar animates from full to empty over 8s
   - ✅ Notification slides in from right on appearance
   - ✅ Multiple notifications don't overlap (stack vertically with gap)

### Test Scenario 5: Edge Cases
1. **Character not on map**:
   - Level up character without token
   - ✅ Character list updates
   - ✅ Notification shows
   - ✅ No token update errors in console

2. **DM refreshes page**:
   - Level up character
   - DM refreshes page before seeing notification
   - ✅ Character list shows updated data after refresh
   - ⚠️ Notification won't show (WebSocket message already sent)

3. **WebSocket disconnection**:
   - Disconnect WebSocket (simulate network issue)
   - Level up character
   - ✅ Connection status indicator shows disconnected
   - ⚠️ No real-time update (expected behavior)
   - ✅ Manual refresh shows updated data

### Debug Commands

**Browser Console** (DM page):
```javascript
// Check if event listeners are attached
window.getEventListeners?.(window)

// Manually trigger test notification
window.dispatchEvent(new CustomEvent('characterLevelUp', {
  detail: {
    character_id: 1,
    character_name: "Test Character",
    level: 10,
    class_id: "wizard",
    max_hp: 68,
    current_hp: 68,
    ability_scores: {
      strength: 8,
      dexterity: 14,
      constitution: 16,
      intelligence: 20,
      wisdom: 12,
      charisma: 10
    },
    timestamp: new Date().toISOString()
  }
}));

// Check WebSocket connection
// (Check connection indicator in top bar)
```

**Backend Logs** (terminal):
```bash
# Watch for level up broadcasts
tail -f logs/backend.log | grep "character_level_up"

# Or with uvicorn --reload:
# Check terminal output for WebSocket messages
```

## Known Limitations

1. **Historical notifications**: DM only sees notifications for level ups that occur while they have the page open. Past level ups won't trigger notifications.

2. **Notification persistence**: Notifications are not persisted to database, they're ephemeral UI elements.

3. **Network issues**: If WebSocket disconnects during level up, DM must manually refresh to see updates.

4. **Token-only HP updates**: Only HP is updated on tokens in real-time. Other stat changes (AC, speed, etc.) require token recreation or manual update.

5. **Multiple campaign tabs**: If DM has multiple campaign tabs open, each will receive the notification independently.

## Future Enhancements (Optional)

See `LEVEL_UP_SYSTEM_IMPROVEMENTS.md` for additional improvements:
- DM XP/currency reward UI (pending)
- Level up history viewer
- Character sheet diff viewer
- Roll20-style level up announcements in chat

## Files Modified

### Frontend Files (4 modified, 1 created)
1. ✅ `frontend/app/routes/campaign.$id.dm.tsx` (Lines 13, 115-135, 503)
2. ✅ `frontend/app/components/character/CharacterPanel.tsx` (Lines 238-248)
3. ✅ `frontend/app/components/map/TacticalMap.client.tsx` (Lines 149-177)
4. ✅ `frontend/app/styles/tailwind.css` (Lines 43-72)
5. ✅ `frontend/app/components/ui/LevelUpNotification.tsx` (NEW FILE - 147 lines)

### Backend Files (Previously Completed)
See `IMPLEMENTATION_SUMMARY.md` for backend changes:
- `backend/app/schemas/character_sheet.py`
- `backend/app/api/routes/characters.py`
- `backend/app/services/websocket_handlers/__init__.py`
- `backend/app/api/routes/websocket_simplified.py`
- `backend/app/services/websocket_handlers/level_up_handler.py` (DELETED)

## Validation

All TypeScript files pass syntax checks:
- ✅ No TypeScript compilation errors
- ✅ All imports resolved correctly
- ✅ Event listener patterns consistent with existing code
- ✅ Component props properly typed
- ✅ CSS animations properly scoped

## Commit Message Suggestion

```
feat(frontend): add real-time character level up sync for DM

- Add WebSocket listener for character_level_up events in DM page
- Implement CharacterPanel auto-refresh on level up
- Implement TacticalMap token HP auto-update
- Create LevelUpNotification component with animations
- Add custom events: characterLevelUp, tokenHPUpdate

DM can now see complete character data changes (ability scores,
skills, spells, HP) immediately after player level up without
manual refresh. Includes animated notification with 8s auto-dismiss.

Related: IMPLEMENTATION_SUMMARY.md, WEBSOCKET_INTEGRATION_GUIDE.md
```
