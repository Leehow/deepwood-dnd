# CharacterCreationWizard 重构指南

## 当前状态

原文件 `CharacterCreationWizard.tsx` 有 **4271 行**，太大了！

## 已完成的工作

✅ **创建了以下文件：**

1. **`types.ts`** - 所有 TypeScript 类型定义
   - `Race`, `CharacterState`, `CharacterWizardProps`, `AbilityScoreMethod`

2. **`utils.ts`** - 所有工具函数
   - `getAbilityName()`, `getLanguageName()`, `getSkillName()` 等
   - `hasLevel1Subclass()`, `isSpellcaster()`, `usesPreparedSpells()`
   - `getFightingStyles()`, `getFavoredEnemies()`, `getFavoredTerrains()`
   - 常量: `ALL_SKILLS`, `STANDARD_ARRAY`, `POINT_BUY_COSTS` 等

3. **`Step1RaceSelection.tsx`** - 种族选择步骤（已完成）
   - 包含 `Step1RaceSelection` 组件
   - 包含 `RaceFeatureChoices` 组件（矮人工具、半精灵技能/属性/语言）

## 需要手动拆分的步骤

由于原文件太大，建议你手动完成以下拆分：

### Step 2: 职业选择 (约 283 行)

**位置：** 第 1173-1456 行

**创建文件：** `Step2ClassSelection.tsx`

**需要复制的内容：**
- `function Step2ClassSelection()` (第 1173 行开始)
- 所有相关的子组件和辅助函数

**需要导入：**
```typescript
import { CharacterState } from "./types";
import { getSkillName, getArmorName, getWeaponName } from "./utils";
import classesData from "~/data/rules/classes.json";
```

### Step 3: 职业特性 (约 1022 行)

**位置：** 第 1458-2480 行

**创建文件：** `Step3ClassFeatures.tsx`

**需要复制的内容：**
- `function Step3ClassFeatures()` (第 1458 行开始)
- 所有子职业选择、法术选择、战斗风格等组件

**需要导入：**
```typescript
import { useState } from "react";
import { CharacterState } from "./types";
import { 
  hasLevel1Subclass, 
  isSpellcaster, 
  usesPreparedSpells,
  getFightingStyles,
  getFavoredEnemies,
  getFavoredTerrains,
  getHumanoidRaces,
  getSkillName,
  getLanguageName
} from "./utils";
import { EldritchInvocationSelector } from "./EldritchInvocationSelector";
import spellsData from "~/data/rules/spells.json";
```

### Step 4: 属性分配 (约 955 行)

**位置：** 第 2482-3437 行

**创建文件：** `Step4AbilityScores.tsx`

**需要复制的内容：**
- `function Step4AbilityScores()` (第 2482 行开始)
- 标准数组、投骰、购点法等所有方法

**需要导入：**
```typescript
import { useState } from "react";
import { CharacterState, Race, AbilityScoreMethod } from "./types";
import { 
  getAbilityName, 
  getAbilityModifier, 
  formatModifier,
  STANDARD_ARRAY,
  POINT_BUY_TOTAL,
  POINT_BUY_MIN,
  POINT_BUY_MAX,
  POINT_BUY_COSTS
} from "./utils";
```

### Step 5: 角色描述 (约 834 行)

**位置：** 第 3439-4273 行

**创建文件：** `Step5CharacterDescription.tsx`

**需要复制的内容：**
- `function Step5CharacterDescription()` (第 3439 行开始)
- 所有外观、性格、背景相关组件

**需要导入：**
```typescript
import { useState } from "react";
import { TextArea } from "@radix-ui/themes";
import { CharacterState } from "./types";
import { ALIGNMENTS, GENDERS } from "./utils";
import backgroundsData from "~/data/rules/backgrounds.json";
```

## 最后一步：更新主文件

完成所有步骤拆分后，更新 `CharacterCreationWizard.tsx`：

1. **删除所有已拆分的组件代码**
2. **只保留：**
   - 导入语句
   - `STEPS` 常量
   - `CharacterCreationWizard` 主组件
   - 验证逻辑 (`getValidationError`)
   - 导航逻辑 (`nextStep`, `prevStep`, `goToStep`)
   - Dialog UI 结构

3. **添加导入：**
```typescript
import { Step1RaceSelection } from "./Step1RaceSelection";
import { Step2ClassSelection } from "./Step2ClassSelection";
import { Step3ClassFeatures } from "./Step3ClassFeatures";
import { Step4AbilityScores } from "./Step4AbilityScores";
import { Step5CharacterDescription } from "./Step5CharacterDescription";
import { Step5EquipmentSelection as Step6EquipmentSelection } from "./Step5EquipmentSelection";
import { Step6ReviewFinalize as Step7ReviewFinalize } from "./Step6ReviewFinalize";
```

## 快速拆分方法

1. 打开 `CharacterCreationWizard.tsx`
2. 找到对应的行号范围
3. 复制整个函数和相关代码
4. 创建新文件并粘贴
5. 添加必要的导入
6. 导出组件：`export function StepXXX(...) { ... }`

## 验证

拆分完成后，确保：
- ✅ 所有步骤组件都能正确导入
- ✅ TypeScript 没有类型错误
- ✅ 浏览器中角色创建流程正常工作
- ✅ 所有验证逻辑仍然有效

## 预期结果

拆分后的文件大小：
- `CharacterCreationWizard.tsx`: ~300 行（主向导逻辑）
- `Step1RaceSelection.tsx`: ~400 行 ✅
- `Step2ClassSelection.tsx`: ~300 行
- `Step3ClassFeatures.tsx`: ~1000 行
- `Step4AbilityScores.tsx`: ~950 行
- `Step5CharacterDescription.tsx`: ~800 行
- `types.ts`: ~110 行 ✅
- `utils.ts`: ~250 行 ✅

总共 8 个文件，每个文件都在可管理的范围内！

