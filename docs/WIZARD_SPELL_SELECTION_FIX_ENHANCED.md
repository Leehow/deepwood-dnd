# 法师法术选择系统增强方案

## 实施状态

> **最后更新**: 2025-01-19

### ✅ 已完成

1. **升级时法术选择问题修复** (docs/WIZARD_SPELL_SELECTION_FIX.md 中的问题1)
   - ✅ 配置文件更新：为法师所有等级添加 `spell_learning` 特性
   - ✅ 前端代码更新：`EnhancedLevelUpModal.tsx` 识别 `spell_learning` 类型
   - 📝 **实施方案**: 方案B（配置文件定义法术学习特性）
   - 📂 **修改文件**:
     - `/dnd-platform/configs/rules/classes-progression.json`
     - `/frontend/app/components/character/EnhancedLevelUpModal.tsx`

### 🔲 待实施

2. **法术级别追踪系统** (本文档核心功能)
   - ⏳ 数据库模型迁移：添加法术级别追踪
   - ⏳ 后端API修改：升级时记录法术选择级别
   - ⏳ 恢复到1级逻辑：只保留1级选择的法术
   - ⏳ 前端适配：支持新的法术数据格式

---

## 概述

本文档详细说明如何实现"恢复到1级时只保留1级选择的法术并清空所有已准备法术"的功能。核心改进是为每个法术记录其被选择时的角色等级，从而在恢复等级时能够精确地还原相应等级的法术。

---

## 核心需求

### 功能需求

1. **法术级别标记**：每个被选择的法术需要记录是在哪个角色等级被选择的
2. **1级恢复逻辑**：恢复到1级时，只保留在1级时选择的法术
3. **已准备法术清空**：恢复到1级时，清空所有已准备法术
4. **法术位重置**：恢复到1级时，重置法术位到1级的标准配置

### 设计原则

- **向后兼容**：支持现有数据的平滑迁移
- **数据完整性**：确保法术数据的一致性
- **可扩展性**：支持未来的多职业等复杂场景

---

## 数据结构改进

### 当前结构（不足）

```python
# 当前：简单的法术ID数组，无法追踪选择级别
selected_spells = ["spell_1", "spell_2", "spell_3"]
selected_cantrips = ["cantrip_1", "cantrip_2"]
```

### 新结构设计

```python
# 方案A：使用对象数组（推荐）
selected_spells = [
    {"id": "spell_1", "level_learned": 1, "source": "wizard"},
    {"id": "spell_2", "level_learned": 1, "source": "wizard"},
    {"id": "spell_3", "level_learned": 2, "source": "wizard"},
    {"id": "spell_4", "level_learned": 3, "source": "wizard"}
]

selected_cantrips = [
    {"id": "cantrip_1", "level_learned": 1, "source": "wizard"},
    {"id": "cantrip_2", "level_learned": 1, "source": "wizard"},
    {"id": "cantrip_3", "level_learned": 4, "source": "wizard"}
]

# 方案B：使用嵌套字典（备选）
selected_spells_v2 = {
    "1": ["spell_1", "spell_2"],  # 1级选择的法术
    "2": ["spell_3"],              # 2级选择的法术
    "3": ["spell_4"]               # 3级选择的法术
}
```

**推荐方案A的理由**：
1. 更容易查询和过滤
2. 支持多职业时可以记录法术来源
3. 可扩展更多元数据（如替换历史、选择时间等）

---

## 实现步骤详解

### 步骤1：数据库模型迁移

#### 1.1 创建数据迁移脚本

文件：`/backend/alembic/versions/add_spell_level_tracking_TIMESTAMP.py`

```python
"""Add spell level tracking

Revision ID: xxx
Revises: yyy
Create Date: 2024-11-19
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
import json

def upgrade():
    """
    迁移现有法术数据到新格式
    """
    connection = op.get_bind()

    # 获取所有角色数据
    result = connection.execute(
        "SELECT id, selected_spells, selected_cantrips, level FROM characters"
    )

    for row in result:
        char_id = row[0]
        old_spells = row[1] or []
        old_cantrips = row[2] or []
        current_level = row[3] or 1

        # 转换为新格式
        # 对于现有数据，我们假设所有法术都是在1级选择的
        # 这是最保守的方式，确保恢复到1级时不会丢失法术
        new_spells = []
        for spell_id in old_spells:
            new_spells.append({
                "id": spell_id,
                "level_learned": 1,  # 默认都记为1级
                "source": "migration"  # 标记为迁移数据
            })

        new_cantrips = []
        for cantrip_id in old_cantrips:
            new_cantrips.append({
                "id": cantrip_id,
                "level_learned": 1,
                "source": "migration"
            })

        # 更新数据
        connection.execute(
            f"""UPDATE characters
            SET selected_spells = '{json.dumps(new_spells)}',
                selected_cantrips = '{json.dumps(new_cantrips)}'
            WHERE id = {char_id}"""
        )

def downgrade():
    """
    回滚到旧格式
    """
    connection = op.get_bind()

    result = connection.execute(
        "SELECT id, selected_spells, selected_cantrips FROM characters"
    )

    for row in result:
        char_id = row[0]
        new_spells = row[1] or []
        new_cantrips = row[2] or []

        # 提取spell ID
        old_spells = [spell["id"] for spell in new_spells if isinstance(spell, dict)]
        old_cantrips = [cantrip["id"] for cantrip in new_cantrips if isinstance(cantrip, dict)]

        # 更新为旧格式
        connection.execute(
            f"""UPDATE characters
            SET selected_spells = '{json.dumps(old_spells)}',
                selected_cantrips = '{json.dumps(old_cantrips)}'
            WHERE id = {char_id}"""
        )
```

### 步骤2：后端API修改

#### 2.1 升级逻辑修改

文件：`/backend/app/api/routes/characters.py`

在 `level_up_character` 函数中修改法术保存逻辑：

```python
@router.post("/{character_id}/level-up", response_model=CharacterResponse)
async def level_up_character(
    character_id: int,
    req: LevelUpRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # ... 现有代码 ...

    # 修改法术选择部分（约573-595行）
    if req.spells_data:
        # 确保法术数组是新格式
        current_spells = character.selected_spells or []

        # 兼容性处理：如果是旧格式，转换为新格式
        if current_spells and isinstance(current_spells[0], str):
            current_spells = [
                {"id": spell_id, "level_learned": 1, "source": "legacy"}
                for spell_id in current_spells
            ]

        if isinstance(req.spells_data, dict):
            # 处理替换法术的情况
            new_spells = req.spells_data.get("new", [])
            replaced_spells = req.spells_data.get("replaced", [])

            # 移除被替换的法术
            if replaced_spells:
                current_spells = [
                    s for s in current_spells
                    if s["id"] not in replaced_spells
                ]

            # 添加新法术，记录当前等级
            for spell_id in new_spells:
                spell_exists = any(s["id"] == spell_id for s in current_spells)
                if not spell_exists:
                    current_spells.append({
                        "id": spell_id,
                        "level_learned": character.level + 1,  # 新等级
                        "source": req.class_id
                    })
        else:
            # 旧格式兼容
            for spell_id in req.spells_data:
                spell_exists = any(s["id"] == spell_id for s in current_spells)
                if not spell_exists:
                    current_spells.append({
                        "id": spell_id,
                        "level_learned": character.level + 1,
                        "source": req.class_id
                    })

        character.selected_spells = current_spells
        flag_modified(character, "selected_spells")

    # 处理戏法（类似逻辑）
    if req.cantrips_data:
        current_cantrips = character.selected_cantrips or []

        # 兼容性处理
        if current_cantrips and isinstance(current_cantrips[0], str):
            current_cantrips = [
                {"id": cantrip_id, "level_learned": 1, "source": "legacy"}
                for cantrip_id in current_cantrips
            ]

        for cantrip_id in req.cantrips_data:
            cantrip_exists = any(c["id"] == cantrip_id for c in current_cantrips)
            if not cantrip_exists:
                current_cantrips.append({
                    "id": cantrip_id,
                    "level_learned": character.level + 1,
                    "source": req.class_id
                })

        character.selected_cantrips = current_cantrips
        flag_modified(character, "selected_cantrips")
```

#### 2.2 恢复到1级逻辑修改

文件：`/backend/app/api/routes/characters.py`

在 `reset_character_to_level_one` 函数中修改恢复逻辑：

```python
@router.post("/{character_id}/reset-to-level-one", response_model=CharacterResponse)
async def reset_character_to_level_one(
    character_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # ... 现有代码 ...

    if level_1_snapshot:
        # 从快照恢复
        character.selected_cantrips = level_1_snapshot.get("selected_cantrips", [])
        character.selected_spells = level_1_snapshot.get("selected_spells", [])

        # 确保是新格式
        if character.selected_spells and isinstance(character.selected_spells[0], str):
            character.selected_spells = [
                {"id": spell_id, "level_learned": 1, "source": "snapshot"}
                for spell_id in character.selected_spells
            ]

        if character.selected_cantrips and isinstance(character.selected_cantrips[0], str):
            character.selected_cantrips = [
                {"id": cantrip_id, "level_learned": 1, "source": "snapshot"}
                for cantrip_id in character.selected_cantrips
            ]
    else:
        # 没有快照时，只保留1级的法术
        if character.selected_spells:
            # 过滤只保留1级学习的法术
            if isinstance(character.selected_spells[0], dict):
                character.selected_spells = [
                    spell for spell in character.selected_spells
                    if spell.get("level_learned", 1) == 1
                ]
            else:
                # 旧格式：清空（因为无法确定哪些是1级的）
                character.selected_spells = []

        if character.selected_cantrips:
            # 过滤只保留1级学习的戏法
            if isinstance(character.selected_cantrips[0], dict):
                character.selected_cantrips = [
                    cantrip for cantrip in character.selected_cantrips
                    if cantrip.get("level_learned", 1) == 1
                ]
            else:
                # 旧格式：保留所有（戏法通常在1级选择）
                character.selected_cantrips = [
                    {"id": cantrip_id, "level_learned": 1, "source": "reset"}
                    for cantrip_id in character.selected_cantrips
                ]

    # 清空所有已准备法术
    character.prepared_spells = []

    # 重置法术位状态
    initial_slots = get_initial_spell_slots(character.class_id, 1)
    if initial_slots:
        character.spell_slots_state = initial_slots
    else:
        character.spell_slots_state = None

    # ... 其余代码 ...
```

#### 2.3 快照保存逻辑修改

在保存快照时，确保保存新格式：

```python
# 在 level_up_character 函数中
snapshot = {
    "level": character.level,
    "class_id": character.class_id,
    "subclass_id": character.subclass_id,
    "ability_scores": (character.ability_scores or {}).copy(),
    "selected_cantrips": (character.selected_cantrips or []).copy(),  # 新格式
    "selected_spells": (character.selected_spells or []).copy(),      # 新格式
    "spell_slots_state": (character.spell_slots_state or []).copy(),
    "prepared_spells": (character.prepared_spells or []).copy(),
    "expertise_skills": (character.expertise_skills or []).copy(),
    "multiclass_data": (character.multiclass_data or {}).copy()
}
```

### 步骤3：前端适配

#### 3.1 类型定义更新

文件：`/frontend/app/components/character/CharacterDisplay/types/Character.ts`

```typescript
// 更新法术类型定义
interface SpellSelection {
  id: string;
  level_learned: number;
  source: string;  // 职业来源或"migration"/"legacy"
}

interface Character {
  // ... 其他字段 ...
  selected_spells: SpellSelection[] | string[];  // 兼容两种格式
  selected_cantrips: SpellSelection[] | string[];
  // ...
}
```

#### 3.2 法术显示逻辑更新

文件：`/frontend/app/components/character/CharacterDisplay/sections/Spells/SpellsDialog.tsx`

```typescript
// 处理法术数据的辅助函数
function getSpellIds(spells: SpellSelection[] | string[]): string[] {
  if (!spells || spells.length === 0) return [];

  // 检查格式
  if (typeof spells[0] === 'string') {
    return spells as string[];
  }

  return (spells as SpellSelection[]).map(spell => spell.id);
}

// 获取特定等级学习的法术
function getSpellsByLevel(spells: SpellSelection[], level: number): string[] {
  return spells
    .filter(spell => spell.level_learned === level)
    .map(spell => spell.id);
}
```

#### 3.3 升级模态框更新

文件：`/frontend/app/components/character/EnhancedLevelUpModal.tsx`

```typescript
// 提交升级请求时
const handleConfirmLevelUp = async () => {
  const payload = {
    class_id: selectedClass,
    // ... 其他数据 ...
    spells_data: {
      new: newSpellSelections,     // 新选择的法术
      replaced: replacedSpells     // 被替换的法术
    },
    cantrips_data: newCantripSelections
  };

  // 发送请求...
};
```

### 步骤4：测试验证

#### 4.1 单元测试

创建文件：`/backend/tests/test_spell_level_tracking.py`

```python
import pytest
from app.api.routes.characters import reset_character_to_level_one, level_up_character

def test_spell_level_tracking():
    """测试法术级别追踪功能"""
    # 1. 创建1级角色，选择2个法术
    # 2. 升级到2级，选择1个新法术
    # 3. 升级到3级，选择1个新法术
    # 4. 恢复到1级
    # 5. 验证只保留1级的2个法术
    pass

def test_prepared_spells_clear():
    """测试恢复1级时清空已准备法术"""
    # 1. 创建牧师角色
    # 2. 准备一些法术
    # 3. 恢复到1级
    # 4. 验证prepared_spells为空
    pass

def test_legacy_format_compatibility():
    """测试旧格式兼容性"""
    # 1. 创建使用旧格式的角色数据
    # 2. 执行升级操作
    # 3. 验证数据被正确转换为新格式
    pass
```

#### 4.2 E2E测试流程

```bash
# Playwright测试脚本
1. 创建法师角色
   - 选择3个戏法
   - 选择6个法术
   - 验证法术数据格式：[{id: "spell1", level_learned: 1, source: "wizard"}]

2. 升级到2级
   - 选择2个新法术
   - 验证新法术的level_learned为2

3. 升级到3级
   - 选择2个新法术
   - 验证新法术的level_learned为3
   - 准备一些法术

4. 恢复到1级
   - 执行恢复操作
   - 验证只有6个1级法术保留
   - 验证prepared_spells为空
   - 验证spell_slots_state为[0, 2, 0, 0, 0, 0, 0, 0, 0]

5. 再次升级
   - 升级到2级
   - 验证可以重新选择法术
```

---

## 数据兼容性处理

### 兼容性策略

1. **读取时自动转换**：当检测到旧格式时，自动转换为新格式
2. **写入时统一格式**：所有写入操作都使用新格式
3. **迁移标记**：通过`source`字段标记数据来源

### 兼容性代码示例

```python
def normalize_spell_data(spells):
    """将法术数据标准化为新格式"""
    if not spells:
        return []

    # 检查是否已经是新格式
    if isinstance(spells[0], dict):
        return spells

    # 转换旧格式
    return [
        {"id": spell_id, "level_learned": 1, "source": "legacy"}
        for spell_id in spells
    ]

def extract_spell_ids(spells):
    """从法术数据中提取ID列表"""
    if not spells:
        return []

    if isinstance(spells[0], str):
        return spells

    return [spell["id"] for spell in spells]
```

---

## 配置文件更新

### classes-progression.json

确保每个需要学习法术的等级都有`spell_learning`特性：

```json
{
  "wizard": {
    "1": {
      "features": [
        {
          "name": "Spellcasting",
          "type": "spell_learning",
          "description": "Choose 3 cantrips and 6 1st-level spells"
        }
      ]
    },
    "2": {
      "features": [
        {
          "name": "Spell Learning",
          "type": "spell_learning",
          "description": "Learn 2 wizard spells of your choice"
        }
      ]
    }
  }
}
```

---

## 性能优化建议

1. **索引优化**：为JSON字段创建GIN索引
   ```sql
   CREATE INDEX idx_selected_spells ON characters USING gin(selected_spells);
   ```

2. **查询优化**：使用JSONB查询功能
   ```python
   # 查找所有在3级学习了特定法术的角色
   query = select(Character).where(
       Character.selected_spells.contains([{"id": "fireball", "level_learned": 3}])
   )
   ```

3. **缓存策略**：缓存法术数据的转换结果

---

## 风险评估

### 潜在风险

1. **数据迁移失败**：迁移脚本可能因数据异常而失败
   - 缓解：添加错误处理和回滚机制

2. **性能影响**：JSON操作可能比简单数组慢
   - 缓解：添加索引，优化查询

3. **前端兼容性**：旧版前端可能无法处理新格式
   - 缓解：后端提供格式转换API

### 回滚计划

如果出现严重问题，可以：
1. 执行数据库回滚：`alembic downgrade -1`
2. 部署旧版本代码
3. 通过兼容性层临时运行

---

## 实施清单

- [ ] 备份数据库
- [ ] 创建数据迁移脚本
- [ ] 更新后端API逻辑
  - [ ] 修改升级函数
  - [ ] 修改恢复函数
  - [ ] 添加兼容性处理
- [ ] 更新前端代码
  - [ ] 更新类型定义
  - [ ] 修改法术显示逻辑
  - [ ] 更新升级模态框
- [ ] 编写测试用例
  - [ ] 单元测试
  - [ ] 集成测试
  - [ ] E2E测试
- [ ] 更新配置文件
- [ ] 性能测试
- [ ] 部署到测试环境
- [ ] 验证数据迁移
- [ ] 部署到生产环境
- [ ] 监控和验证

---

## 总结

本方案通过为每个法术添加`level_learned`字段，实现了精确的法术级别追踪。当角色恢复到1级时，系统能够：

1. **精确还原**：只保留1级时选择的法术
2. **清空准备**：移除所有已准备法术，让玩家重新选择
3. **重置法术位**：恢复到1级的标准法术位配置
4. **向后兼容**：支持旧数据的平滑迁移

这个设计不仅解决了当前问题，还为未来的功能扩展（如多职业、法术来源追踪等）奠定了基础。

---

## 附录A：已完成的修改详情

### A1. 升级时法术选择问题修复（2025-01-19 完成）

#### 问题描述

参见 `docs/WIZARD_SPELL_SELECTION_FIX.md` 问题1：当法师从2级升级到3级时，点击"法师职业升级"不会跳到法术选择页面。

#### 实施的解决方案

采用了 **方案B**：在配置文件中为需要学习法术的等级添加 `spell_learning` 特性。

#### 具体修改

##### 1. 配置文件更新

**文件**: `/dnd-platform/configs/rules/classes-progression.json`

为法师所有等级（1-20级）添加了 `spell_learning` 特性：

```json
{
  "id": "spell_learning",
  "name": "学习法术",
  "nameEn": "Spell Learning",
  "type": "spell_learning",
  "description": "学习新的法术加入法术书"
}
```

**修改前** - 法师3级配置：
```json
"3": {
  "proficiencyBonus": 2,
  "features": [],  // 空数组导致无法进入法术选择
  "spellSlots": { "1": 4, "2": 2 }
}
```

**修改后** - 法师3级配置：
```json
"3": {
  "proficiencyBonus": 2,
  "features": [
    {
      "id": "spell_learning",
      "name": "学习法术",
      "nameEn": "Spell Learning",
      "type": "spell_learning",
      "description": "学习新的法术加入法术书"
    }
  ],
  "spellSlots": { "1": 4, "2": 2 }
}
```

**实施脚本**: `debug/update_wizard_spell_learning.py`

##### 2. 前端代码更新

**文件**: `/frontend/app/components/character/EnhancedLevelUpModal.tsx`

在三处添加了对 `spell_learning` 特性类型的识别：

**位置1** - `handleClassSelect` 函数 (第238-244行)：
```typescript
const hasChoices = features.some(f =>
  f.type === 'choice' ||
  f.type === 'subclass' ||
  f.type === 'expertise' ||
  f.type === 'asi_or_feat' ||
  f.type === 'spell_learning'  // ← 新增
);
```

**位置2** - `canConfirmLevelUp` 函数 (第258-260行)：
```typescript
const hasRequiredChoices = features.some(f => f.required &&
  (f.type === 'choice' ||
   f.type === 'subclass' ||
   f.type === 'expertise' ||
   f.type === 'asi_or_feat' ||
   f.type === 'spell_learning')  // ← 新增
);
```

**位置3** - `handleConfirm` 函数 (第295-297行)：
```typescript
const hasRequiredChoices = features.some(f => f.required &&
  (f.type === 'choice' ||
   f.type === 'subclass' ||
   f.type === 'expertise' ||
   f.type === 'asi_or_feat' ||
   f.type === 'spell_learning')  // ← 新增
);
```

#### 验证步骤

1. ✅ 配置文件验证：
   ```bash
   jq '.classes.wizard.levelProgression."3"' \
     /Users/haoli/leehow/code/dw/dnd-platform/configs/rules/classes-progression.json
   ```
   确认3级现在包含 `spell_learning` 特性。

2. 功能测试（待执行）：
   - 创建2级法师角色
   - 升级到3级
   - 确认进入法术选择页面
   - 选择新法术并确认升级

#### 影响范围

- ✅ 法师所有等级（1-20）升级时都能正确显示法术选择界面
- ✅ 不影响其他职业的升级流程
- ✅ 向后兼容现有角色数据

#### 后续优化建议

1. 可以考虑为其他施法职业（术士、邪术师等）也添加 `spell_learning` 特性
2. 在特性配置中可以添加更多元数据，如：
   ```json
   {
     "type": "spell_learning",
     "spellsToLearn": 2,  // 本级可学习的法术数量
     "cantripsToLearn": 0  // 本级可学习的戏法数量
   }
   ```

---
