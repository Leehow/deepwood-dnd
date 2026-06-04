# D&D 5E Experience & Leveling System Design

## Design Philosophy
**Frontend-Heavy, Backend-Light**: All XP calculations, level checks, and progression logic are handled on the frontend. The backend only stores XP values and broadcasts updates via WebSocket.

## System Overview

### Core Features
1. **XP Tracking**: Track experience points for each character
2. **Automatic Level Calculation**: Frontend calculates levels based on XP thresholds
3. **XP Awards**: DM can award XP to individual players or the entire party
4. **Milestone Leveling**: Optional alternative to XP-based progression
5. **Real-time Sync**: All XP changes broadcast to connected clients
6. **XP History**: Track XP gains with source and timestamp

## Database Schema

### Character Table Additions
```sql
-- Add to existing characters table
ALTER TABLE characters ADD COLUMN experience_points INTEGER DEFAULT 0;
ALTER TABLE characters ADD COLUMN milestone_level INTEGER DEFAULT NULL;  -- For milestone leveling
```

### XP History Table (New)
```sql
CREATE TABLE xp_history (
    id SERIAL PRIMARY KEY,
    character_id INTEGER REFERENCES characters(id) ON DELETE CASCADE,
    campaign_id INTEGER REFERENCES campaigns(id) ON DELETE CASCADE,
    xp_amount INTEGER NOT NULL,
    source VARCHAR(255),  -- "Combat", "Quest", "RP", "Manual", etc.
    description TEXT,
    awarded_by VARCHAR(50),  -- DM's user_id
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_xp_history_character ON xp_history(character_id);
CREATE INDEX idx_xp_history_campaign ON xp_history(campaign_id);
```

## Frontend Implementation

### 1. XP Thresholds Constants
```typescript
// frontend/app/data/rules/xp-thresholds.json
{
  "standard": {
    "1": 0,
    "2": 300,
    "3": 900,
    "4": 2700,
    "5": 6500,
    "6": 14000,
    "7": 23000,
    "8": 34000,
    "9": 48000,
    "10": 64000,
    "11": 85000,
    "12": 100000,
    "13": 120000,
    "14": 140000,
    "15": 165000,
    "16": 195000,
    "17": 225000,
    "18": 265000,
    "19": 305000,
    "20": 355000
  }
}
```

### 2. XP Calculation Hook
```typescript
// frontend/app/hooks/useCharacterLevel.ts
import xpThresholds from '@/data/rules/xp-thresholds.json';

export function useCharacterLevel(character: Character) {
  const calculateLevel = (xp: number): number => {
    const thresholds = Object.entries(xpThresholds.standard)
      .map(([level, xpRequired]) => ({ level: parseInt(level), xpRequired }))
      .sort((a, b) => b.xpRequired - a.xpRequired);

    for (const { level, xpRequired } of thresholds) {
      if (xp >= xpRequired) return level;
    }
    return 1;
  };

  const currentLevel = character.milestone_level || calculateLevel(character.experience_points || 0);
  const nextLevelXP = xpThresholds.standard[currentLevel + 1] || null;
  const currentLevelXP = xpThresholds.standard[currentLevel];
  const xpProgress = character.experience_points - currentLevelXP;
  const xpNeeded = nextLevelXP ? nextLevelXP - currentLevelXP : 0;

  return {
    level: currentLevel,
    xp: character.experience_points || 0,
    nextLevelXP,
    currentLevelXP,
    xpProgress,
    xpNeeded,
    progressPercentage: xpNeeded > 0 ? (xpProgress / xpNeeded) * 100 : 0,
    isMaxLevel: currentLevel >= 20,
    useMilestone: !!character.milestone_level
  };
}
```

### 3. XP Award Component (DM View)
```typescript
// frontend/app/components/campaign/XPAwardModal.tsx
interface XPAwardModalProps {
  isOpen: boolean;
  onClose: () => void;
  campaignId: string;
  characters: Character[];
}

export function XPAwardModal({ isOpen, onClose, campaignId, characters }: XPAwardModalProps) {
  const [awardType, setAwardType] = useState<'individual' | 'party'>('party');
  const [xpAmount, setXPAmount] = useState(0);
  const [source, setSource] = useState('Combat');
  const [description, setDescription] = useState('');
  const [selectedCharacters, setSelectedCharacters] = useState<string[]>([]);
  const { sendMessage } = useWebSocket();

  const handleAward = () => {
    const recipients = awardType === 'party'
      ? characters.map(c => c.id)
      : selectedCharacters;

    sendMessage({
      type: 'xp_award',
      campaign_id: campaignId,
      data: {
        recipients,
        amount: xpAmount,
        source,
        description,
        timestamp: new Date().toISOString()
      }
    });

    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Award Experience Points</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <RadioGroup value={awardType} onValueChange={setAwardType}>
            <RadioGroupItem value="party">Entire Party</RadioGroupItem>
            <RadioGroupItem value="individual">Specific Characters</RadioGroupItem>
          </RadioGroup>

          {awardType === 'individual' && (
            <CharacterMultiSelect
              characters={characters}
              selected={selectedCharacters}
              onChange={setSelectedCharacters}
            />
          )}

          <Input
            type="number"
            placeholder="XP Amount"
            value={xpAmount}
            onChange={(e) => setXPAmount(parseInt(e.target.value) || 0)}
          />

          <Select value={source} onValueChange={setSource}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Combat">Combat</SelectItem>
              <SelectItem value="Quest">Quest Completion</SelectItem>
              <SelectItem value="RP">Roleplay</SelectItem>
              <SelectItem value="Exploration">Exploration</SelectItem>
              <SelectItem value="Manual">Manual Award</SelectItem>
            </SelectContent>
          </Select>

          <Textarea
            placeholder="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />

          <Button onClick={handleAward} disabled={xpAmount <= 0}>
            Award {xpAmount} XP
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

### 4. XP Display Component (Player View)
```typescript
// frontend/app/components/character/XPDisplay.tsx
interface XPDisplayProps {
  character: Character;
  showHistory?: boolean;
}

export function XPDisplay({ character, showHistory = false }: XPDisplayProps) {
  const { level, xp, nextLevelXP, xpProgress, xpNeeded, progressPercentage, isMaxLevel } = useCharacterLevel(character);
  const [history, setHistory] = useState<XPHistoryEntry[]>([]);

  useEffect(() => {
    if (showHistory) {
      fetchXPHistory(character.id).then(setHistory);
    }
  }, [character.id, showHistory]);

  return (
    <div className="xp-display">
      <div className="xp-summary">
        <h3>Level {level}</h3>
        <div className="xp-current">{xp.toLocaleString()} XP</div>

        {!isMaxLevel && (
          <>
            <div className="xp-progress-bar">
              <div
                className="xp-progress-fill"
                style={{ width: `${progressPercentage}%` }}
              />
            </div>
            <div className="xp-next-level">
              {xpProgress.toLocaleString()} / {xpNeeded.toLocaleString()} to Level {level + 1}
            </div>
          </>
        )}
      </div>

      {showHistory && (
        <div className="xp-history">
          <h4>XP History</h4>
          <ul>
            {history.map((entry) => (
              <li key={entry.id}>
                <span>{entry.created_at}: </span>
                <span>+{entry.xp_amount} XP</span>
                <span> - {entry.source}</span>
                {entry.description && <span> ({entry.description})</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

### 5. Level Up Notification Component
```typescript
// frontend/app/components/character/LevelUpNotification.tsx
export function LevelUpNotification({ character, newLevel, onClose }: LevelUpNotificationProps) {
  const levelUpBenefits = useLevelUpBenefits(character.class_id, newLevel);

  return (
    <div className="level-up-notification">
      <div className="celebration-animation">
        <h2>Level Up!</h2>
        <p>{character.name} is now Level {newLevel}!</p>
      </div>

      <div className="level-up-benefits">
        <h3>You Gained:</h3>
        <ul>
          {levelUpBenefits.hitPoints && (
            <li>+{levelUpBenefits.hitPoints} Hit Points</li>
          )}
          {levelUpBenefits.features.map((feature) => (
            <li key={feature.id}>New Feature: {feature.name}</li>
          ))}
          {levelUpBenefits.spellSlots && (
            <li>New Spell Slots: {formatSpellSlots(levelUpBenefits.spellSlots)}</li>
          )}
          {levelUpBenefits.asi && (
            <li>Ability Score Improvement</li>
          )}
        </ul>
      </div>

      <Button onClick={onClose}>Continue</Button>
    </div>
  );
}
```

## Backend Implementation

### 1. Database Migration
```python
# backend/alembic/versions/add_xp_system_20251114.py
def upgrade():
    # Add XP fields to characters table
    op.add_column('characters', sa.Column('experience_points', sa.Integer(), nullable=False, server_default='0'))
    op.add_column('characters', sa.Column('milestone_level', sa.Integer(), nullable=True))

    # Create XP history table
    op.create_table('xp_history',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('character_id', sa.Integer(), nullable=False),
        sa.Column('campaign_id', sa.Integer(), nullable=False),
        sa.Column('xp_amount', sa.Integer(), nullable=False),
        sa.Column('source', sa.String(255), nullable=True),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('awarded_by', sa.String(50), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.PrimaryKeyConstraint('id'),
        sa.ForeignKeyConstraint(['character_id'], ['characters.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['campaign_id'], ['campaigns.id'], ondelete='CASCADE')
    )

    op.create_index('idx_xp_history_character', 'xp_history', ['character_id'])
    op.create_index('idx_xp_history_campaign', 'xp_history', ['campaign_id'])
```

### 2. Updated Character Model
```python
# backend/app/models/character.py (additions)
class Character(Base):
    # ... existing fields ...

    # XP and Leveling
    experience_points = Column(Integer, default=0, nullable=False)
    milestone_level = Column(Integer, nullable=True)  # Override calculated level for milestone progression
```

### 3. XP History Model
```python
# backend/app/models/xp_history.py
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from sqlalchemy.sql import func
from app.db.session import Base

class XPHistory(Base):
    """Track XP awards history"""
    __tablename__ = "xp_history"

    id = Column(Integer, primary_key=True, index=True)
    character_id = Column(Integer, ForeignKey("characters.id", ondelete="CASCADE"), nullable=False)
    campaign_id = Column(Integer, ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False)
    xp_amount = Column(Integer, nullable=False)
    source = Column(String(255))  # Combat, Quest, RP, etc.
    description = Column(Text)
    awarded_by = Column(String(50), nullable=False)  # DM's user_id
    created_at = Column(DateTime(timezone=True), server_default=func.now())
```

### 4. WebSocket Handler for XP
```python
# backend/app/services/websocket_handlers/xp_handler.py
from typing import Dict, Any
from fastapi import WebSocket
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.services.websocket_handlers.base import MessageHandler
from app.models.character import Character
from app.models.xp_history import XPHistory

class XPHandler(MessageHandler):
    """Handle XP award messages"""

    async def handle(
        self,
        message: Dict[str, Any],
        websocket: WebSocket,
        campaign_id: str,
        user_id: str,
        role: str,
        db: AsyncSession
    ) -> None:
        # Only DM can award XP
        if role != 'dm':
            await self.send_to_websocket({
                "type": "error",
                "message": "Only the DM can award experience points"
            }, websocket)
            return

        data = message.get("data", {})
        recipients = data.get("recipients", [])
        amount = data.get("amount", 0)
        source = data.get("source", "Manual")
        description = data.get("description", "")

        # Validate amount
        if amount <= 0:
            await self.send_to_websocket({
                "type": "error",
                "message": "XP amount must be positive"
            }, websocket)
            return

        # Award XP to each recipient
        updated_characters = []
        for character_id in recipients:
            # Get character
            result = await db.execute(
                select(Character).where(Character.id == character_id)
            )
            character = result.scalar_one_or_none()

            if not character:
                continue

            # Update XP
            old_xp = character.experience_points
            character.experience_points += amount

            # Create history entry
            history = XPHistory(
                character_id=character_id,
                campaign_id=int(campaign_id),
                xp_amount=amount,
                source=source,
                description=description,
                awarded_by=user_id
            )
            db.add(history)

            updated_characters.append({
                "id": character_id,
                "name": character.name,
                "old_xp": old_xp,
                "new_xp": character.experience_points,
                "xp_gained": amount
            })

        # Commit changes
        await db.commit()

        # Broadcast update to all connected clients
        await self.broadcast_to_campaign({
            "type": "xp_update",
            "campaign_id": campaign_id,
            "data": {
                "characters": updated_characters,
                "amount": amount,
                "source": source,
                "description": description,
                "awarded_by": user_id,
                "timestamp": message.get("timestamp")
            }
        }, campaign_id)
```

### 5. XP API Endpoints
```python
# backend/app/api/routes/characters.py (additions)
from app.models.xp_history import XPHistory

@router.get("/characters/{character_id}/xp-history")
async def get_xp_history(
    character_id: int,
    limit: int = 50,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get XP history for a character"""
    # Verify character access
    result = await db.execute(
        select(Character).where(
            Character.id == character_id,
            Character.user_id == current_user.id
        )
    )
    character = result.scalar_one_or_none()

    if not character:
        raise HTTPException(status_code=404, detail="Character not found")

    # Get history
    result = await db.execute(
        select(XPHistory)
        .where(XPHistory.character_id == character_id)
        .order_by(XPHistory.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    history = result.scalars().all()

    return {
        "history": [
            {
                "id": h.id,
                "xp_amount": h.xp_amount,
                "source": h.source,
                "description": h.description,
                "awarded_by": h.awarded_by,
                "created_at": h.created_at
            }
            for h in history
        ]
    }

@router.post("/characters/{character_id}/milestone-level")
async def set_milestone_level(
    character_id: int,
    level: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Set milestone level (DM only)"""
    # Verify DM access
    result = await db.execute(
        select(Character).where(Character.id == character_id)
    )
    character = result.scalar_one_or_none()

    if not character:
        raise HTTPException(status_code=404, detail="Character not found")

    # Validate level
    if level < 1 or level > 20:
        raise HTTPException(status_code=400, detail="Level must be between 1 and 20")

    character.milestone_level = level
    await db.commit()

    return {"message": f"Set {character.name} to level {level}"}
```

### 6. WebSocket Handler Registration
```python
# backend/app/services/websocket_handlers/registry.py (addition)
from app.services.websocket_handlers.xp_handler import XPHandler

# Register the XP handler
register_handler("xp_award", XPHandler())
```

## Frontend WebSocket Integration

### WebSocket Hook Updates
```typescript
// frontend/app/hooks/useWebSocket.ts (additions)
export function useWebSocket() {
  // ... existing code ...

  // Handle XP updates
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const message = JSON.parse(event.data);

      if (message.type === 'xp_update') {
        // Update local character state
        const updatedCharacters = message.data.characters;
        updatedCharacters.forEach((update: any) => {
          updateCharacterXP(update.id, update.new_xp);

          // Check for level up
          const oldLevel = calculateLevel(update.old_xp);
          const newLevel = calculateLevel(update.new_xp);

          if (newLevel > oldLevel) {
            showLevelUpNotification(update.id, newLevel);
          }
        });

        // Show XP gain toast
        toast({
          title: "Experience Gained!",
          description: `+${message.data.amount} XP from ${message.data.source}`,
          variant: "success"
        });
      }
    };

    ws.addEventListener('message', handleMessage);
    return () => ws.removeEventListener('message', handleMessage);
  }, [ws]);
}
```

## DM Tools Integration

### Quick XP Calculator
```typescript
// frontend/app/components/campaign/XPCalculator.tsx
export function XPCalculator({ onApply }: { onApply: (xp: number) => void }) {
  const [monsters, setMonsters] = useState<{ cr: string; count: number }[]>([]);
  const [partySize, setPartySize] = useState(4);
  const [partyLevel, setPartyLevel] = useState(1);

  const calculateXP = () => {
    const baseXP = monsters.reduce((total, m) => {
      return total + (CR_TO_XP[m.cr] || 0) * m.count;
    }, 0);

    const encounterMultiplier = getEncounterMultiplier(
      monsters.reduce((sum, m) => sum + m.count, 0),
      partySize
    );

    const adjustedXP = Math.floor(baseXP * encounterMultiplier);
    const xpPerPlayer = Math.floor(adjustedXP / partySize);

    return xpPerPlayer;
  };

  return (
    <div className="xp-calculator">
      <h3>Combat XP Calculator</h3>

      <MonsterList monsters={monsters} onChange={setMonsters} />

      <div className="party-info">
        <Input
          type="number"
          label="Party Size"
          value={partySize}
          onChange={(e) => setPartySize(parseInt(e.target.value))}
        />
        <Input
          type="number"
          label="Average Party Level"
          value={partyLevel}
          onChange={(e) => setPartyLevel(parseInt(e.target.value))}
        />
      </div>

      <div className="xp-result">
        <p>XP per Player: {calculateXP()}</p>
        <Button onClick={() => onApply(calculateXP())}>
          Award This XP
        </Button>
      </div>
    </div>
  );
}
```

## Testing Strategy

### Unit Tests
1. Test XP to level calculation accuracy
2. Test XP history recording
3. Test WebSocket message handling
4. Test permission checks (only DM can award)

### Integration Tests
1. Test XP award flow from DM to players
2. Test real-time sync across multiple connections
3. Test level up notifications
4. Test milestone vs XP leveling modes

### E2E Tests
```typescript
// frontend/tests/xp-system.spec.ts
test('DM can award XP to party', async ({ page }) => {
  // Login as DM
  // Open XP award modal
  // Award 300 XP to party
  // Verify all characters received XP
  // Verify level up if applicable
});

test('Player sees XP updates in real-time', async ({ page, context }) => {
  // Open DM view in one tab
  // Open player view in another tab
  // DM awards XP
  // Verify player sees update immediately
});
```

## Performance Considerations

1. **XP Calculations**: All done on frontend, no server round-trips
2. **History Pagination**: Load XP history in chunks of 50
3. **WebSocket Efficiency**: Only send changed data, not full character
4. **Database Indexes**: Indexed on character_id and campaign_id for fast queries

## Future Enhancements

1. **XP Presets**: Save common XP awards for quick access
2. **Encounter Builder**: Build encounters with auto-calculated XP
3. **XP Multipliers**: Campaign-wide XP rate adjustments
4. **Achievement System**: Bonus XP for specific accomplishments
5. **Party XP Pool**: Optional shared XP system
6. **Custom Progression**: Allow custom XP thresholds per campaign