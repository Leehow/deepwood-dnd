# Unified Level Tracking System Design

## Overview
Implement comprehensive level tracking for all character progression elements, similar to the spell level tracking system. This ensures proper restoration when characters level down or reset.

## Elements Requiring Level Tracking

### 1. Skills & Proficiencies
- **selected_skills**: Track which skills were gained at which level
  - Background skills (level 1)
  - Class skills (level 1)
  - Subclass skills (varies by subclass)
  - Feat skills (ASI levels)

- **expertise_skills**: Track when expertise was gained
  - Rogue (levels 1, 6)
  - Bard (levels 3, 10)
  - Feat-based (ASI levels)

### 2. Class Features
- **fighting_style**:
  - Fighter (level 1)
  - Ranger (level 2)
  - Paladin (level 2)

- **favored_enemy** & **favored_terrain**:
  - Ranger (levels 1, 6, 14)

- **eldritch_invocations**:
  - Warlock (levels 2, 5, 7, 9, 12, 15, 18)

### 3. Subclass
- **subclass_id**: Track when subclass was chosen
  - Varies by class (level 1-3)

- **subclass_choices**: Track feature choices from subclass
  - Various levels depending on subclass

### 4. Ability Scores & Feats
- **ability_score_improvements**: New field to track ASIs
  - Most classes: levels 4, 8, 12, 16, 19
  - Fighter: additional at 6, 14
  - Rogue: additional at 10

- **feats**: New field to track feats taken instead of ASIs

### 5. Multiclass Data
- Track when each class was added
- Track progression in each class

## Data Structure Design

### Unified Selection Format
```typescript
interface LevelTrackedSelection<T = string> {
  value: T;                    // The actual value (skill ID, feat name, etc.)
  level_acquired: number;      // Character level when acquired
  source: string;              // Source (class, subclass, background, feat, etc.)
  source_detail?: string;      // Additional context (e.g., "expertise_rogue_1")
}
```

### Updated Character Model Fields

```python
# Skills & Proficiencies
selected_skills: List[LevelTrackedSelection]  # Was: List[str]
expertise_skills: List[LevelTrackedSelection]  # Was: List[str]

# Class Features
fighting_style: Optional[LevelTrackedSelection]  # Was: Optional[str]
favored_enemies: List[LevelTrackedSelection]  # Was: str, now supports multiple
favored_terrains: List[LevelTrackedSelection]  # Was: str, now supports multiple
eldritch_invocations: List[LevelTrackedSelection]  # Was: List[str]

# New fields
ability_score_improvements: List[Dict]  # Track all ASIs and their distribution
feats: List[LevelTrackedSelection]  # Track feats taken

# Subclass tracking
subclass_history: List[Dict]  # Track subclass choices at each level
```

### Example Data

```json
{
  "selected_skills": [
    {
      "value": "investigation",
      "level_acquired": 1,
      "source": "background",
      "source_detail": "sage"
    },
    {
      "value": "arcana",
      "level_acquired": 1,
      "source": "wizard"
    },
    {
      "value": "history",
      "level_acquired": 1,
      "source": "wizard"
    }
  ],
  "expertise_skills": [
    {
      "value": "investigation",
      "level_acquired": 3,
      "source": "subclass",
      "source_detail": "lore_bard"
    }
  ],
  "fighting_style": {
    "value": "defense",
    "level_acquired": 2,
    "source": "paladin"
  },
  "ability_score_improvements": [
    {
      "level": 4,
      "type": "asi",
      "improvements": {"intelligence": 2}
    },
    {
      "level": 8,
      "type": "feat",
      "feat_id": "war_caster"
    }
  ]
}
```

## Implementation Plan

### Phase 1: Database Schema Update
1. Create migration to update all relevant fields to new format
2. Preserve existing data with default level_acquired = 1
3. Add helper functions for data conversion

### Phase 2: Backend API Updates
1. Update character.py helper functions:
   ```python
   def normalize_skill_list(skills, default_level=1, default_source="migration")
   def filter_skills_by_level(skills, max_level)
   def extract_skill_ids(skills)
   ```

2. Update level_up_character to track acquisitions:
   - Record level for new skills
   - Record level for expertise
   - Record level for features
   - Track ASIs and feats

3. Update level_down_character:
   - Filter all tracked elements by level
   - Restore only features available at target level

4. Update reset_to_level_one:
   - Keep only level 1 acquisitions
   - Clear all higher-level features

### Phase 3: Frontend Updates
1. Create helper utilities:
   ```typescript
   // utils/levelTrackingHelpers.ts
   export function extractValues<T>(selections: LevelTrackedSelection<T>[] | T[]): T[]
   export function normalizeSelections<T>(values: T[], level: number, source: string)
   export function filterByLevel<T>(selections: LevelTrackedSelection<T>[], maxLevel: number)
   ```

2. Update types:
   ```typescript
   // types/Character.ts
   export interface LevelTrackedSelection<T = string> {
     value: T;
     level_acquired: number;
     source: string;
     source_detail?: string;
   }
   ```

3. Update components:
   - EnhancedLevelUpModal
   - CharacterDisplay
   - Character creation wizard

### Phase 4: Testing & Validation
1. Test level up with various feature acquisitions
2. Test level down to ensure proper filtering
3. Test reset to level 1
4. Verify multiclass compatibility
5. Check data migration for existing characters

## Benefits
1. **Accurate Level Down**: Characters properly lose features gained at higher levels
2. **Better History Tracking**: Clear record of when each feature was acquired
3. **Multiclass Support**: Track which class provided which feature
4. **Debugging**: Easier to diagnose character progression issues
5. **Future Features**: Foundation for feat chains, prerequisite tracking

## Migration Strategy

### For Existing Characters
1. All existing selections assumed to be from level 1 or earliest possible level
2. Source inferred from class/background/race data
3. Gradual migration as characters level up

### Database Migration Script
```sql
-- Example migration for selected_skills
UPDATE characters
SET selected_skills = (
  SELECT json_agg(
    json_build_object(
      'value', skill,
      'level_acquired', 1,
      'source', 'migration',
      'source_detail', NULL
    )
  )
  FROM json_array_elements_text(selected_skills) AS skill
)
WHERE selected_skills IS NOT NULL;
```

## Backward Compatibility
- Helper functions handle both old (string/primitive) and new (object) formats
- Frontend components use extraction functions for compatibility
- API responses include both formats during transition period

## Timeline
- Phase 1: Database schema and migration - 2 days
- Phase 2: Backend implementation - 3 days
- Phase 3: Frontend implementation - 3 days
- Phase 4: Testing and validation - 2 days

Total estimated time: 10 days

## Related Files to Update
- `/backend/app/models/character.py`
- `/backend/app/api/routes/characters.py`
- `/backend/app/schemas/character_sheet.py`
- `/frontend/app/components/character/CharacterDisplay/types/Character.ts`
- `/frontend/app/utils/levelTrackingHelpers.ts` (new)
- `/frontend/app/components/character/EnhancedLevelUpModal.tsx`
- `/backend/alembic/versions/unified_level_tracking_YYYYMMDD.py` (new)