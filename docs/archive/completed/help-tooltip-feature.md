# D&D参数帮助提示功能

## 功能概述

为角色面板中的所有D&D参数添加了"?"帮助图标，点击后弹出模态框显示详细的规则说明，帮助新手玩家理解各项参数的含义和用途。

## 用户需求

用户反馈："这种参数旁边放一个？点击用模态框展示这是什么"

**背景：**
- 用户看到"熟练+2"不理解是什么意思
- D&D 5E有大量专业术语（HP、AC、熟练加值、六大属性等）
- 新手玩家需要即时的规则说明，而不是查阅手册

## 实现方案

### 1. 通用帮助提示组件

**文件：** `frontend/app/components/shared/HelpTooltip.tsx`

**功能：**
- 显示一个问号图标（QuestionMarkCircledIcon）
- 点击后弹出Radix UI Dialog模态框
- 支持自定义标题和内容（文本或React节点）
- 支持三种尺寸（size: "1" | "2" | "3"）

**特性：**
- 灰色图标，悬停时变为琥珀色（符合D&D主题）
- 模态框标题使用琥珀色（text-amber-400）
- 内容区域支持富文本（列表、代码块、强调等）
- 底部有"知道了"按钮关闭对话框

**使用示例：**
```tsx
<HelpTooltip 
  title="熟练加值" 
  content={DND_HELP_TEXTS.proficiency.content} 
  size="1" 
/>
```

### 2. D&D规则帮助文本配置

**文件：** `frontend/app/data/dnd-help-texts.tsx`

**包含的规则说明：**

#### 基础属性（4个）
1. **HP（生命值）**
   - 定义：代表角色能承受多少伤害
   - 计算：职业生命骰 + 体质调整值
   - 说明：降到0时濒死，可通过休息/治疗恢复

2. **AC（护甲等级）**
   - 定义：代表有多难被击中
   - 计算：基础AC = 10 + 敏捷调整值
   - 说明：穿戴护甲会改变计算方式，盾牌+2 AC

3. **速度**
   - 定义：每回合能移动多远
   - 单位：英尺（1英尺 ≈ 0.3米）
   - 说明：大多数种族30尺，战术地图上5尺=1格

4. **熟练加值**
   - 定义：基于等级的通用加值
   - 等级对应表：
     - 1-4级：+2
     - 5-8级：+3
     - 9-12级：+4
     - 13-16级：+5
     - 17-20级：+6
   - 应用场景：
     - 技能检定（熟练的技能）
     - 攻击检定（熟练的武器）
     - 豁免检定（熟练的豁免）
     - 法术攻击
   - 示例：1级游侠用长弓攻击 = 1d20 + 敏捷调整值 + 熟练加值(+2)

#### 六大属性
1. **力量（STR）**
   - 影响：近战武器攻击/伤害、运动/攀爬技能、负重能力
   - 豁免：抵抗被推、拉等效果

2. **敏捷（DEX）**
   - 影响：AC、先攻、远程武器攻击、隐匿/巧手技能
   - 豁免：闪避火球等范围效果

3. **体质（CON）**
   - 影响：HP（每级HP = 生命骰 + 体质调整值）
   - 豁免：抵抗毒素、疾病
   - 其他：长时间行军、憋气等耐力检定

4. **智力（INT）**
   - 施法：法师的关键属性
   - 影响：奥秘/历史/调查等知识技能
   - 豁免：抵抗心灵控制法术

5. **感知（WIS）**
   - 施法：牧师、德鲁伊的关键属性
   - 影响：察觉/洞悉/医药技能、被动察觉
   - 豁免：抵抗魅惑、恐惧

6. **魅力（CHA）**
   - 施法：术士、吟游诗人、圣武士的关键属性
   - 影响：说服/欺瞒/威吓/表演等社交技能
   - 豁免：抵抗放逐等效果

#### 其他概念
- **属性调整值**：计算公式、对应表
- **等级**：经验值、升级奖励
- **先攻**：战斗顺序

### 3. 集成到角色面板

**文件：** `frontend/app/components/character/CharacterPanel.tsx`

**修改内容：**

1. **导入依赖**
```tsx
import { HelpTooltip } from "../shared/HelpTooltip";
import { DND_HELP_TEXTS } from "~/data/dnd-help-texts";
```

2. **添加辅助函数**
```tsx
function getAbilityHelpText(abilityKey: string) {
  const map: Record<string, keyof typeof DND_HELP_TEXTS> = {
    strength: "strength",
    dexterity: "dexterity",
    constitution: "constitution",
    intelligence: "intelligence",
    wisdom: "wisdom",
    charisma: "charisma",
  };
  return DND_HELP_TEXTS[map[abilityKey]];
}
```

3. **角色卡片 - 战斗属性**
```tsx
<div className="text-gray-500 flex items-center justify-center gap-0.5">
  HP
  <HelpTooltip title={DND_HELP_TEXTS.hp.title} content={DND_HELP_TEXTS.hp.content} size="1" />
</div>
```

4. **角色卡片 - 能力值**
```tsx
const helpText = getAbilityHelpText(key);
<div className="text-gray-500 flex items-center justify-center gap-0.5">
  {key.slice(0, 3).toUpperCase()}
  <HelpTooltip title={helpText.title} content={helpText.content} size="1" />
</div>
```

5. **查看对话框 - 战斗属性**
```tsx
<div className="text-gray-500 text-xs flex items-center gap-1">
  生命值 (HP)
  <HelpTooltip title={DND_HELP_TEXTS.hp.title} content={DND_HELP_TEXTS.hp.content} size="1" />
</div>
```

6. **查看对话框 - 能力值**
```tsx
<div className="text-gray-500 text-xs mb-1 flex items-center justify-center gap-1">
  {label}
  <HelpTooltip title={helpText.title} content={helpText.content} size="1" />
</div>
```

## 应用位置

### 玩家视图（campaign.$id.player.tsx）

**"我的角色"标签页：**
- 角色卡片中的HP、AC、速度、熟练（4个）
- 角色卡片中的6个能力值（STR、DEX、CON、INT、WIS、CHA）

**"查看"对话框：**
- 战斗属性部分：生命值、护甲等级、速度、熟练加值（4个）
- 能力值部分：力量、敏捷、体质、智力、感知、魅力（6个）

### DM视图（campaign.$id.dm.tsx）

**角色名册：**
- 同样的帮助图标位置（DM也需要快速查阅规则）

## 技术亮点

### 1. 组件化设计
- `HelpTooltip`是通用组件，可在任何地方复用
- 配置与展示分离（`dnd-help-texts.tsx`独立管理内容）

### 2. 类型安全
```tsx
export type HelpTextKey = keyof typeof DND_HELP_TEXTS;
```
- TypeScript类型检查，防止拼写错误

### 3. 富文本支持
```tsx
content: (
  <div className="space-y-2">
    <p><strong>熟练加值</strong>是基于等级的通用加值。</p>
    <div className="p-2 bg-gray-800 rounded">
      <p className="text-xs font-mono">等级 1-4：+2</p>
    </div>
  </div>
)
```
- 支持React节点，可以包含列表、代码块、强调等

### 4. 主题一致性
- 琥珀色标题（text-amber-400）符合D&D暗黑奇幻主题
- 悬停效果（hover:text-amber-400）提供视觉反馈
- 灰色图标不干扰主要内容

### 5. 可扩展性
- 新增规则说明只需在`dnd-help-texts.tsx`添加配置
- 新增帮助图标只需添加`<HelpTooltip />`组件

## 用户体验改进

### 之前
- 看到"熟练+2"不知道是什么
- 需要查阅玩家手册或询问DM
- 新手玩家学习曲线陡峭

### 现在
- 每个参数旁边都有"?"图标
- 点击即可查看详细说明
- 包含计算公式、应用场景、实际示例
- 降低新手玩家的学习门槛

## 文件清单

### 新增文件（3个）
1. `frontend/app/components/shared/HelpTooltip.tsx` - 通用帮助提示组件
2. `frontend/app/data/dnd-help-texts.tsx` - D&D规则帮助文本配置
3. `debug/test-help-tooltips.md` - 测试指南
4. `docs/help-tooltip-feature.md` - 本文档

### 修改文件（1个）
1. `frontend/app/components/character/CharacterPanel.tsx` - 集成帮助提示

## 后续扩展建议

### 1. 添加更多规则说明
- 技能列表（隐匿、察觉、说服等）
- 装备类型（武器、护甲、工具）
- 法术机制（法术位、专注、仪式施法）
- 战斗规则（先攻、动作类型、机会攻击）

### 2. 多语言支持
- 英文/中文切换
- 使用i18n管理文本

### 3. 搜索功能
- 全局规则搜索
- 快捷键打开规则手册

### 4. 个性化
- 用户可以标记"已理解"的规则
- 隐藏已理解规则的帮助图标

## 总结

本次功能实现了完整的D&D参数帮助系统，覆盖了角色面板中的所有关键参数（HP、AC、速度、熟练加值、六大属性）。通过点击"?"图标，玩家可以即时查看详细的规则说明，大大降低了新手玩家的学习门槛，提升了用户体验。

**实现状态：✅ 完成**  
**测试状态：⏳ 待测试**  
**文档状态：✅ 完成**

