# D&D 5E Character Creation Flow
# 角色创建完整流程文档

## Overview 概述

基于《D&D 5E玩家手册》的完整角色创建流程，采用分步骤向导式设计。

## User Flow 用户流程

### Step 0: Welcome 欢迎页
**Purpose**: 介绍角色创建流程
- 显示6个主要步骤的概览
- "开始创建" 按钮
- 可选："导入已有角色" 或 "快速创建"

### Step 1: Choose Race 选择种族
**Purpose**: 选择角色的种族和亚种

**UI Elements**:
- 种族卡片列表（9个核心种族）
  - 矮人 Dwarf
  - 精灵 Elf
  - 半身人 Halfling
  - 人类 Human
  - 龙裔 Dragonborn
  - 侏儒 Gnome
  - 半精灵 Half-Elf
  - 半兽人 Half-Orc
  - 提夫林 Tiefling

**Each Card Shows**:
- 种族图标/图片
- 种族名称（中英文）
- 简短描述（1句话）
- 属性加值预览（如：+2 体质）

**When Selected**:
- 展开显示详细信息：
  - 完整描述
  - 属性加值详情
  - 速度
  - 体型
  - 种族特性列表
  - 语言
  - 寿命

**If Has Subraces**:
- 显示亚种选择界面
- 亚种卡片（如：丘陵矮人/山地矮人）
- 显示亚种独有特性和额外属性加值

**Navigation**:
- "下一步" 按钮（需要完成种族和亚种选择）
- 进度条：1/6

---

### Step 2: Choose Class 选择职业
**Purpose**: 选择角色的职业

**UI Elements**:
- 职业卡片列表（12个核心职业）
  - 野蛮人 Barbarian
  - 吟游诗人 Bard
  - 牧师 Cleric
  - 德鲁伊 Druid
  - 战士 Fighter
  - 武僧 Monk
  - 圣武士 Paladin
  - 游侠 Ranger
  - 游荡者 Rogue
  - 术士 Sorcerer
  - 邪术师 Warlock
  - 法师 Wizard

**Each Card Shows**:
- 职业图标
- 职业名称（中英文）
- 生命骰（如：d12）
- 主要属性（如：力量）
- 简短描述

**When Selected**:
- 展开显示详细信息：
  - 完整职业描述
  - 生命骰类型
  - 主要属性
  - 豁免熟练项（2个属性）
  - 护甲熟练
  - 武器熟练
  - 工具熟练
  - 可选技能列表及数量（如：从6个技能中选2个）
  - 1级职业特性预览
  - 起始装备选项

**Skill Selection**:
- 显示可选技能列表
- 勾选框选择（限制数量，如2/2）
- 每个技能显示对应属性

**Navigation**:
- "上一步" 返回种族选择
- "下一步" 按钮（需要完成职业和技能选择）
- 进度条：2/6

---

### Step 3: Determine Ability Scores 决定属性值
**Purpose**: 分配角色的6项属性值

**选择分配方式**（3选1）:
1. **标准数组 Standard Array** ⭐推荐新手
   - 预设数组：15, 14, 13, 12, 10, 8
   - 拖拽分配到6个属性

2. **掷骰 Rolling**
   - 点击"掷骰"按钮6次
   - 每次掷4d6，去掉最小值
   - 显示骰子动画
   - 拖拽分配到6个属性

3. **点数购买 Point Buy** ⭐推荐高级玩家
   - 27点可用
   - 每个属性初始值8
   - 使用+/-按钮调整（8-15范围）
   - 实时显示消耗点数
   - 花费表格参考

**Ability Score Display**（6个属性卡片）:
```
┌─────────────────────────┐
│ 力量 STR (Strength)     │
│ ┌─────┐                 │
│ │ 15  │ 基础值           │
│ └─────┘                 │
│ +  2    种族加值 (山地矮人)│
│ ─────                   │
│   17    总值             │
│  (+3)   调整值           │
└─────────────────────────┘
```

**Each Ability Card Shows**:
- 属性名称（中英文+缩写）
- 属性描述
- 基础值输入/拖拽区
- 种族加值（自动计算，绿色显示）
- 总值（粗体大字）
- 调整值（公式：(总值-10)/2 向下取整）
- 重要职业提示（如："对战士很重要"）

**Real-time Feedback**:
- 显示当前已分配的属性值
- 标准数组：剩余未分配的数值
- 点数购买：剩余点数 XX/27
- 掷骰：剩余未分配的骰值

**Quick Recommendation**（可选辅助）:
- "推荐分配" 按钮
- 根据职业自动分配（如战士：力量15→力量，体质14→体质）

**Navigation**:
- "上一步" 返回职业选择
- "下一步" 按钮（需要完成全部6个属性分配）
- 进度条：3/6

---

### Step 4: Describe Your Character 描述角色
**Purpose**: 填写角色的个性化信息和背景故事

**Section 4.1: Basic Info 基本信息**
- **角色名称** Name *（必填）
  - 文本输入
  - 可选："随机生成"按钮（基于种族生成合适的名字）

- **性别** Gender
  - 选择：男/女/其他/不透露
  - 或自定义输入

- **年龄** Age
  - 数字输入
  - 种族成年年龄和寿命提示（如：矮人50岁成年，最多活350年）

- **身高** Height
  - 数字输入（英尺+英寸 或 厘米）
  - 种族平均身高参考

- **体重** Weight
  - 数字输入（磅 或 公斤）
  - 种族平均体重参考

- **外貌特征** Appearance
  - 眼睛颜色
  - 皮肤颜色
  - 头发颜色/样式
  - 特殊标记（疤痕、纹身等）

**Section 4.2: Personality 个性特征**

- **阵营** Alignment *（必填）
  - 9宫格选择器：
    ```
    守序善良 LG  中立善良 NG  混乱善良 CG
    守序中立 LN  绝对中立 N   混乱中立 CN
    守序邪恶 LE  中立邪恶 NE  混乱邪恶 CE
    ```
  - 每个阵营有简短描述
  - 显示种族倾向（如：矮人倾向守序善良）

- **个人特征** Personality Traits
  - 2个文本框（建议填2条）
  - 背景提供的建议选项（可选）
  - 例如："我喜欢在日落时唱歌"

- **理想** Ideals *（必填）
  - 1个文本框
  - 背景提供的建议选项（6个，对应不同阵营）
  - 例如："公平 - 没人应该凌驾于法律之上（守序）"

- **牵绊** Bonds *（必填）
  - 1个文本框
  - 背景提供的建议选项
  - 例如："我的家乡被敌人摧毁，我要重建它"

- **缺点** Flaws *（必填）
  - 1个文本框
  - 背景提供的建议选项
  - 例如："我对孤儿和弱者心软"

**Section 4.3: Background 背景故事**

- **背景选择** Background *（必填）
  - 下拉菜单或卡片选择
  - 选项（PHB第4章）：
    - 贵族 Noble
    - 平民英雄 Folk Hero
    - 学者 Sage
    - 士兵 Soldier
    - 罪犯 Criminal
    - 工匠 Guild Artisan
    - 隐士 Hermit
    - 娱乐者 Entertainer
    - 流浪者 Outlander
    - 侍僧 Acolyte
    - 水手 Sailor
    - 乞丐 Urchin

- **背景描述** Background Story
  - 多行文本框
  - 可选：使用背景模板填充
  - 提示："描述你的角色来历、过去的职业、以及如何成为冒险者"

**What Background Provides**（自动获得）:
- 技能熟练 +2个
- 工具熟练或语言
- 起始装备
- 背景特性（如贵族的"身份地位"）

**Navigation**:
- "上一步" 返回属性值
- "下一步" 按钮
- 进度条：4/6

---

### Step 5: Choose Equipment 选择装备
**Purpose**: 选择起始装备和武器

**选择方式**（2选1）:

**Option A: Starting Equipment 起始装备包** ⭐推荐新手
- 职业提供的标准装备包
- 背景提供的额外装备
- 显示装备列表（已选中）：
  - 护甲（如：链甲armor）
  - 武器（如：战斧+2把手斧）
  - 冒险用品包（如：探险者背包）
  - 工具（如：铁匠工具）
  - 其他物品

**Option B: Buy Equipment 购买装备** ⭐推荐有经验玩家
- 根据职业获得起始金币
  - 战士：5d4 × 10 gp = 50-200 gp（点击掷骰）
- 装备商店界面：
  - 分类：护甲/武器/冒险用品/工具
  - 显示价格、重量、属性
  - 添加到购物车
  - 实时显示剩余金币和总重量

**Equipment Details Display**:
每件装备显示：
- 名称（中英文）
- 类型
- 价格（gp）
- 重量（磅）
- 属性/效果（如：AC 16, +5攻击）

**For Spellcasters**:
- 额外选择起始法术
- 法术选择器（按环级分类）
- 显示法术数量限制（如：选择3个戏法+6个1环法术）

**Weapon/Armor Proficiency Check**:
- 自动高亮可用的装备（角色有熟练项）
- 标记不熟练的装备（警告图标）

**Weight Limit Check**:
- 显示总重量 vs 承载上限（力量×15磅）
- 超重时警告提示

**Free Trinket**（可选）:
- "选择一件饰品" 按钮
- 随机饰品列表（PHB第5章末尾）
- 纯粹装饰性，无游戏效果

**Navigation**:
- "上一步" 返回角色描述
- "下一步" 按钮
- 进度条：5/6

---

### Step 6: Review & Finalize 审核与完成
**Purpose**: 审核所有信息，生成完整角色卡

**Review Layout**（两栏布局）:

**Left Column: Character Summary**
```
┌─────────────────────────────────┐
│ 布鲁诺·战锤                      │
│ 山地矮人 战士 1级                │
│ 守序善良                         │
├─────────────────────────────────┤
│ 属性值                           │
│ STR 17 (+3)  INT  8 (-1)        │
│ DEX 10 (+0)  WIS 13 (+1)        │
│ CON 16 (+3)  CHA 12 (+1)        │
├─────────────────────────────────┤
│ 生命值: 13/13  AC: 18           │
│ 速度: 25尺    先攻: +0           │
│ 熟练加值: +2                     │
├─────────────────────────────────┤
│ 豁免熟练: 力量, 体质              │
│ 技能熟练: 运动, 威吓              │
├─────────────────────────────────┤
│ 种族特性:                        │
│ • 黑暗视觉 60尺                  │
│ • 矮人韧性                       │
│ • 矮人战斗训练                   │
│ • 矮人护甲训练                   │
├─────────────────────────────────┤
│ 职业特性:                        │
│ • 战斗风格: 防御                 │
│ • 第二次呼吸 (1次/短休)          │
└─────────────────────────────────┘
```

**Right Column: Detailed Info**
- **装备列表**
  - 护甲：链甲armor (AC 16) + 盾牌 (AC +2)
  - 武器：战斧 (+5攻击, 1d8+3伤害)
  - 背包内容列表

- **语言**: 通用语、矮人语

- **个性特征**:
  - 理想：公平
  - 牵绊：收复秘银厅
  - 缺点：对孤儿心软

- **背景**: 平民英雄
  - 背景特性：淳朴好客

- **外貌**:
  - 年龄：52岁
  - 身高：4尺5寸
  - 体重：150磅

**Calculated Values Display**（自动计算）:
- **生命值上限** = d10最大值(10) + 体质调整值(+3) = 13
- **护甲等级 AC** = 链甲armor(16) + 盾牌(+2) = 18
- **先攻 Initiative** = 敏捷调整值(+0) = +0
- **熟练加值** = +2（1级）
- **速度** = 25尺（矮人，不受重甲减速）

**Attack Calculations**:
```
战斧攻击:
- 攻击加值 = 力量调整值(+3) + 熟练加值(+2) = +5
- 伤害 = 1d8 + 力量调整值(+3)
```

**Spell Slots**（仅施法者）:
- 戏法：已知X个
- 1环法术槽：X个

**Action Buttons**:
- "编辑" 按钮（返回任意步骤修改）
- "导出PDF" 按钮（生成角色卡PDF）
- "保存角色" 按钮（保存到数据库）

**Final Confirmation**:
- "完成创建" 按钮 ⭐
  - 弹出确认对话框
  - 保存角色到服务器
  - 返回角色列表或进入游戏

**Navigation**:
- "上一步" 返回装备选择
- 进度条：6/6 ✓

---

## Key Features 关键功能

### 1. Real-time Validation 实时验证
- 每步都检查必填项
- 实时计算派生数值（AC, HP, 攻击加值等）
- 显示错误或警告信息

### 2. Auto-calculation 自动计算
- 属性总值 = 基础值 + 种族加值 + 亚种加值
- 调整值 = (属性值 - 10) / 2（向下取整）
- 技能加值 = 属性调整值 + 熟练加值（如有）
- 豁免加值 = 属性调整值 + 熟练加值（如有）
- 攻击加值 = 属性调整值 + 熟练加值（如有）
- AC、生命值、先攻等

### 3. Smart Suggestions 智能建议
- 根据职业推荐属性分配
- 根据种族生成合适的名字
- 根据阵营推荐理想
- 背景提供的个性选项

### 4. Progressive Disclosure 渐进式展示
- 只在需要时展示复杂信息
- 折叠/展开详细说明
- 工具提示显示规则解释

### 5. Visual Feedback 视觉反馈
- 进度条显示完成度
- 已完成步骤打勾标记
- 当前步骤高亮
- 错误状态红色标记

### 6. Save & Resume 保存和继续
- 自动保存草稿（localStorage）
- 可以随时退出和继续
- 在任何步骤都可以保存

### 7. Help System 帮助系统
- 每个步骤都有"帮助"按钮
- 弹出规则说明
- 术语解释（如：什么是豁免检定）
- 示例角色参考

---

## Data Flow 数据流

```
Step 1 (Race)
  ↓ raceId, subraceId
Step 2 (Class)
  ↓ classId, selectedSkills
Step 3 (Abilities)
  ↓ abilityScores {STR:15, DEX:14, ...}
Step 4 (Description)
  ↓ name, age, alignment, personality, background
Step 5 (Equipment)
  ↓ equipment[], spells[]
Step 6 (Review)
  ↓ Calculate all derived values
  ↓ Validation
  ↓ Submit to API
```

**Final Character Object**:
```json
{
  "name": "布鲁诺·战锤",
  "race": "dwarf",
  "subrace": "mountain_dwarf",
  "class": "fighter",
  "level": 1,
  "abilityScores": {
    "strength": 17,
    "dexterity": 10,
    "constitution": 16,
    "intelligence": 8,
    "wisdom": 13,
    "charisma": 12
  },
  "skills": ["athletics", "intimidation"],
  "alignment": "lawful_good",
  "background": "folk_hero",
  "personality": {
    "traits": ["谨慎而敏感", "用粗野掩饰温柔"],
    "ideals": "公平 - 没人可以凌驾于法律",
    "bonds": "收复秘银厅",
    "flaws": "对孤儿特别温柔"
  },
  "appearance": {
    "age": 52,
    "height": "4'5\"",
    "weight": "150 lbs",
    "eyes": "褐色",
    "skin": "浅古铜色",
    "hair": "红胡子"
  },
  "equipment": [
    {"id": "chain_mail", "equipped": true},
    {"id": "shield", "equipped": true},
    {"id": "battleaxe", "equipped": true},
    {"id": "handaxe", "quantity": 2}
  ],
  "spells": [],
  "hp": {
    "max": 13,
    "current": 13
  },
  "ac": 18,
  "speed": 25,
  "proficiencyBonus": 2
}
```

---

## UI/UX Principles UI/UX原则

1. **Clear Progress** - 用户始终知道自己在哪一步
2. **No Dead Ends** - 可以回退到任何步骤修改
3. **Smart Defaults** - 提供推荐选项但允许自定义
4. **Explain Rules** - 用简单语言解释D&D规则
5. **Visual Hierarchy** - 重要信息突出显示
6. **Mobile Friendly** - 响应式设计，支持触摸操作
7. **Fast Creation** - 新手可在15-20分钟完成
8. **Flexible** - 高级玩家可以深度自定义

---

## Technical Notes 技术要点

### State Management
- 使用 React Context 或 Zustand 管理创建流程状态
- 每步的数据独立但可互相引用
- 实时计算派生值

### Data Validation
- Zod schema 验证每步数据
- 实时验证用户输入
- 提交前最终验证

### Routing
- 使用 URL 参数保存当前步骤（如 `/character/create?step=3`）
- 支持浏览器前进/后退按钮
- 可通过URL直接跳转到某步（需要前置步骤已完成）

### Performance
- 懒加载大型数据（如装备列表）
- 优化种族/职业卡片渲染
- 使用虚拟滚动处理长列表

---

## Future Enhancements 未来增强

- AI辅助生成背景故事
- 语音朗读角色描述
- 3D角色模型预览
- 导入D&D Beyond角色
- 多语言支持（完整英文版）
- 扩展内容（Xanathar's Guide, Tasha's Cauldron等）
