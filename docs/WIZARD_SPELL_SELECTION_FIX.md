# 法师升级和恢复功能修复方案

## 概述

本文档详细说明了D&D平台中关于法师法术选择和恢复的两个关键问题及其解决方案。

---

## 问题 1：升级时不跳到法术选择页面

### 问题描述

当法师从2级升级到3级时，点击"法师职业升级"不会跳到法术选择页面，导致用户无法在升级过程中选择新的法术。

### 根本原因分析

#### 1.1 升级流程的设计

升级模态框（`EnhancedLevelUpModal.tsx`）采用两步流程：

```
第1步：选择职业
  ↓
检查该级别是否有"选择型特性"
  ├─ 有 → 进入第2步（特性选择）
  └─ 无 → 直接确认升级

第2步：特性选择
  ├─ 选择副职业（Subclass）
  ├─ 选择ASI或专长（Feat）
  ├─ 选择专精技能（Expertise）
  └─ 选择法术（Spells） ← 在这一步
```

#### 1.2 触发第2步的条件

在 `EnhancedLevelUpModal.tsx` 第219-248行，`handleClassSelect()` 函数中：

```typescript
const hasChoices = features.some(f =>
  f.type === 'choice' ||
  f.type === 'subclass' ||
  f.type === 'expertise' ||
  f.type === 'asi_or_feat'
);

if (hasChoices) {
  setCurrentStep('features');  // 进入第2步
}
```

**关键点**：触发条件只检查 `features` 数组中是否有特性，**不包括法术选择**。

#### 1.3 法师3级的配置

在 `/dnd-platform/configs/rules/classes-progression.json` 中：

```json
{
  "wizard": {
    "3": {
      "proficiencyBonus": 2,
      "features": [],              // ← 空数组！
      "spellSlots": {
        "1": 4,
        "2": 2
      }
    }
  }
}
```

法师3级的 `features` 数组为空，所以 `hasChoices = false`，不会进入第2步。

#### 1.4 法术选择器的位置

法术选择器在 `EnhancedLevelUpModal.tsx` 第610行，位于第2步（特性选择）内部：

```typescript
// 只在第2步显示
if (currentStep === 'features') {
  return (
    <div>
      {renderSpellSelection()}  // ← 法术选择在这里
      // ... 其他特性选择
    </div>
  );
}
```

### 影响范围

- **影响职业**：法师、术士、邪术师等有法术的职业
- **影响等级**：任何 `features` 数组为空但有法术学习的等级
- **影响用户**：用户无法在升级时学习新法术，必须手动补充

---

## 问题 2：恢复到1级后法术位没有重置

### 问题描述

当用户点击"恢复到1级"后，角色的法术位状态（spell_slots_state）没有被重置到1级的标准配置，导致显示的法术位数不正确。

### 根本原因分析

#### 2.1 法术相关的数据库字段

在 `Character` 模型中有4个法术相关字段：

```python
# backend/app/models/character.py

# 1. 已选择的戏法（Cantrips）- 无限使用
selected_cantrips = Column(JSON)  # List[str]

# 2. 已选择的法术（Spells）- 需要法术位
selected_spells = Column(JSON)    # List[str]

# 3. 已准备的法术（prepared_spells）- 仅限准备型职业
prepared_spells = Column(JSON)    # List[str]

# 4. 法术位状态（spell_slots_state）
spell_slots_state = Column(JSON, nullable=True)  # List[int]
# 数组含义：
# [0] = 0 (戏法不需要位)
# [1] = 一环位剩余数
# [2] = 二环位剩余数
# ...
# [9] = 九环位剩余数
```

#### 2.2 重置逻辑的实现

在 `/backend/app/api/routes/characters.py` 第388-483行，`reset_character_to_level_one()` 函数：

**有快照时的恢复**（第418-420行）：

```python
if level_1_snapshot:
    character.selected_cantrips = list(level_1_snapshot.get("selected_cantrips", []))
    character.selected_spells = list(level_1_snapshot.get("selected_spells", []))
    # ✗ 没有恢复 spell_slots_state
```

**无快照时的重置**（第431-433行）：

```python
else:
    character.selected_cantrips = []
    character.selected_spells = []
    # ✗ 没有处理 spell_slots_state
```

#### 2.3 实际影响

示例场景：

```
原始状态（1级法师）：
  spell_slots_state = [0, 2, 0, 0, ...]  # 2个一环位

升级到3级后（假设消耗了一个一环位）：
  spell_slots_state = [0, 1, 2, 0, ...]  # 1个一环位，2个二环位

恢复到1级后（错误！）：
  spell_slots_state = [0, 1, 2, 0, ...]  # ← 没有改变！应该是 [0, 2, 0, ...]
```

#### 2.4 其他受影响的职业

这个问题不仅影响法师，还影响所有有法术的职业：

- **全法术职业**（Full Caster）：法师、牧师、德鲁伊、吟游诗人、术士、人工智能
- **半法术职业**（Half Caster）：圣骑士、游侠
- **秘约法术**（Pact Magic）：邪术师
- **专业魔法**（Eldritch Knight、Arcane Trickster）

---

## 解决方案

### 方案 1：修复升级时的法术选择

#### 1.1 方案 A：修改触发条件（快速修复）

修改 `EnhancedLevelUpModal.tsx` 中的 `handleClassSelect()` 函数，使得有法术需要学习时也能进入第2步：

**文件**: `/frontend/app/components/character/EnhancedLevelUpModal.tsx`

**修改位置**: 第219-248行

```typescript
const handleClassSelect = (classId: string) => {
  setSelectedClass(classId);

  // ... 其他代码 ...

  const features = levelData?.features || [];
  const classInfo = CLASSES_DATA[classId];

  // 新增：检查是否需要选择法术
  const spellData = getSpellsToLearn(classId, newClassLevel);
  const needsSpellSelection = spellData && (spellData.cantripsToLearn > 0 || spellData.spellsToLearn > 0);

  // 修改：添加法术选择到条件判断
  const hasChoices = features.some(f =>
    f.type === 'choice' ||
    f.type === 'subclass' ||
    f.type === 'expertise' ||
    f.type === 'asi_or_feat'
  ) || needsSpellSelection;  // ← 添加这行

  if (hasChoices) {
    setCurrentStep('features');
  }
};
```

**优点**：

- 代码改动最小（只需添加一行）
- 快速解决问题

**缺点**：

- 不符合"特性"的配置结构
- 法术选择和其他特性选择混在一起

#### 1.2 方案 B：在配置中定义法术学习特性（推荐）

在 `classes-progression.json` 中为每个需要学习法术的职业等级添加 `spell_learning` 特性：

**文件**: `/dnd-platform/configs/rules/classes-progression.json`

**修改示例**：

```json
{
  "wizard": {
    "1": {
      "proficiencyBonus": 2,
      "features": [
        {
          "name": "Spellcasting",
          "type": "spell_learning",
          "description": "Learn spells"
        }
      ],
      "spellSlots": { "1": 2 }
    },
    "2": {
      "proficiencyBonus": 2,
      "features": [
        {
          "name": "Spell Learning",
          "type": "spell_learning"
        }
      ],
      "spellSlots": { "1": 3 }
    },
    "3": {
      "proficiencyBonus": 2,
      "features": [
        {
          "name": "Spell Learning",
          "type": "spell_learning"
        }
      ],
      "spellSlots": { "1": 4, "2": 2 }
    }
    // ... 其他等级
  }
}
```

**同时在后端检查此特性**：

在后端的特性检查中也需要识别 `spell_learning` 类型的特性。

**优点**：

- 符合系统设计哲学
- 配置清晰，易于维护
- 可以为法术学习添加额外信息

**缺点**：

- 需要修改配置文件和后端逻辑
- 工作量相对较大

#### 1.3 实现建议

**推荐采用方案 B**，理由：

1. 虽然工作量大，但后续维护和扩展更容易
2. 配置更清晰，其他开发者易于理解
3. 便于未来添加法术学习的其他属性

---
