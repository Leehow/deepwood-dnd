# 法术系统数值化分析报告

> 生成日期: 2026-02-27 | 数据源: `frontend/app/data/rules/spells.json` (356 个法术)

## 一、当前数据结构

### 1.1 Spell 接口定义 (`frontend/app/types/spell.ts`)

共 **28 个字段**，分为以下几组：

| 组别 | 字段 | 类型 | 说明 |
|------|------|------|------|
| **核心元数据** | `id` | string | 法术唯一标识，如 `"fireball"` |
| | `name` | string | 中文名 |
| | `nameEn` | string | 英文名 |
| | `level` | number | 0-9，0=戏法 |
| | `school` | SchoolType | 8 大学派 |
| | `classes` | string[] | 可学职业列表 |
| **施法参数** | `castingTime` | string | `"1 动作"` / `"1 附赠动作"` / `"1 反应"` 等 |
| | `range` | string | `"触及"` / `"自身"` / `"120尺"` 等 |
| | `duration` | string | `"即时"` / `"专注，至多1分钟"` 等 |
| | `components` | string[] | `["V", "S", "M"]` |
| | `materials` | string? | 材料描述 |
| | `ritual` | boolean | 是否可作为仪式施放 |
| | `concentration` | boolean | 是否需要专注 |
| **伤害系统** | `damage` | string? | 骰子公式，如 `"8d6"` |
| | `damageType` | DamageType? | 伤害类型 |
| | `damageTypeCn` | string? | 伤害类型中文 |
| | `damageAtSlotLevel` | Record<string,string>? | 升环伤害 `{ "3":"8d6", "4":"9d6" }` |
| | `damageAtCharacterLevel` | Record<string,string>? | 戏法成长 `{ "5":"2d10", "11":"3d10" }` |
| **攻击与豁免** | `attackType` | AttackType? | `melee_spell` / `ranged_spell` / `save` / `auto` / `utility` |
| | `saveType` | SaveType? | 豁免属性 |
| | `saveTypeCn` | string? | 豁免属性中文 |
| | `saveEffect` | string? | `"half"` / `"none"` / `"partial"` |
| **治疗** | `healing` | string? | 骰子公式，如 `"1d8"` |
| | `healingAtSlotLevel` | Record<string,string>? | 升环治疗 |
| **范围效果** | `areaOfEffect` | AreaOfEffect? | `{ type: "sphere", size: 20 }` |
| **控制效果** | `isControlSpell` | boolean? | 是否为控制法术 |
| | `controlEffect` | ControlEffect? | 结构化控制效果（见下文） |
| **文本描述** | `description` | string | 法术完整描述（纯文本） |
| | `atHigherLevels` | string? | 升环效果说明 |

### 1.2 ControlEffect 结构

控制法术拥有独立的结构化字段，是目前数值化程度最高的复杂效果：

```typescript
interface ControlEffect {
  condition: ConditionType;          // "paralyzed" | "restrained" | "frightened" 等
  conditionCn: string;               // "麻痹" | "束缚" | "恐惧" 等
  durationRounds: number | null;     // 持续回合数，null=依赖专注
  effectType: "target" | "zone";     // 单体 vs 区域
  zoneTrigger?: string;              // "enter" | "start_turn" | "enter_or_start"
  ongoingSave?: {                    // 后续豁免
    timing: "end_of_turn" | "start_of_turn";
    saveType: string;
  };
  escapeAction?: boolean;            // 可用动作挣脱？
  breakConditions?: string[];        // 结束条件列表
  escapeHint?: string;               // UI 提示文本
}
```

---

## 二、数据统计总览

### 2.1 法术环级分布

| 环级 | 数量 | 占比 | 可视化 |
|------|------|------|--------|
| 0 (戏法) | 26 | 7.3% | `████` |
| 1 环 | 62 | 17.4% | `█████████` |
| 2 环 | 57 | 16.0% | `████████` |
| 3 环 | 49 | 13.8% | `███████` |
| 4 环 | 34 | 9.6% | `█████` |
| 5 环 | 42 | 11.8% | `██████` |
| 6 环 | 32 | 9.0% | `█████` |
| 7 环 | 20 | 5.6% | `███` |
| 8 环 | 18 | 5.1% | `███` |
| 9 环 | 16 | 4.5% | `██` |

### 2.2 法术学派分布

| 学派 | 英文 | 数量 | 占比 | 可视化 |
|------|------|------|------|--------|
| 塑能 | evocation | 74 | 20.8% | `███████████` |
| 变化 | transmutation | 62 | 17.4% | `█████████` |
| 咒法 | conjuration | 60 | 16.9% | `████████` |
| 防护 | abjuration | 44 | 12.4% | `██████` |
| 惑控 | enchantment | 34 | 9.6% | `█████` |
| 预言 | divination | 28 | 7.9% | `████` |
| 死灵 | necromancy | 27 | 7.6% | `████` |
| 幻术 | illusion | 27 | 7.6% | `████` |

### 2.3 结构化字段覆盖率

| 字段 | 有值数量 | 占 356 总数 | 状态 |
|------|----------|-------------|------|
| `attackType` | 158 | 44.4% | 部分覆盖 |
| `concentration` = true | 154 | 43.3% | 完整 |
| `saveType` | 133 | 37.4% | 部分覆盖 |
| `damage` | 102 | 28.7% | 仅伤害型 |
| `areaOfEffect` | 96 | 27.0% | 部分覆盖 |
| `damageType` | 89 | 25.0% | 部分覆盖 |
| `damageAtSlotLevel` | 55 | 15.4% | 仅升环伤害 |
| `controlEffect` | 35 | 9.8% | 仅控制型 |
| `isControlSpell` | 29 | 8.1% | 仅控制型 |
| `ritual` = true | 27 | 7.6% | 完整 |
| `healing` | 12 | 3.4% | 仅治疗型 |
| `damageAtCharacterLevel` | 10 | 2.8% | 仅戏法 |
| `healingAtSlotLevel` | 10 | 2.8% | 仅升环治疗 |

**综合覆盖率**：

- **225 个法术 (63.2%)** 至少有一个结构化战斗字段 (damage/healing/controlEffect/saveType/attackType/areaOfEffect)
- **131 个法术 (36.8%)** 完全没有结构化战斗数据 — 全靠文本描述

---

## 三、伤害类型分布

### 3.1 按伤害类型统计

| 伤害类型 | 英文 | 数量 | 可视化 |
|----------|------|------|--------|
| 火焰 | fire | 17 | `█████████` |
| 黯蚀 | necrotic | 11 | `██████` |
| 光耀 | radiant | 10 | `█████` |
| 力场 | force | 9 | `█████` |
| 钝击 | bludgeoning | 7 | `████` |
| 穿刺 | piercing | 7 | `████` |
| 心灵 | psychic | 7 | `████` |
| 雷鸣 | thunder | 6 | `███` |
| 闪电 | lightning | 5 | `███` |
| 寒冷 | cold | 4 | `██` |
| 强酸 | acid | 3 | `██` |
| 毒素 | poison | 2 | `█` |
| 挥砍 | slashing | 1 | `█` |

### 3.2 伤害法术：单体 vs 范围

| 类别 | 数量 | 占伤害法术 |
|------|------|-----------|
| 单体伤害 | 63 | 61.8% |
| 范围伤害 | 39 | 38.2% |

**范围伤害按形状分布**：

| 形状 | 英文 | 数量 | 典型法术 |
|------|------|------|----------|
| 球形 | sphere | 15 | 火球术 (20尺)、灼热金属 |
| 立方 | cube | 8 | 雷鸣波 (15尺) |
| 线形 | line | 7 | 闪电束 (100×5尺) |
| 柱形 | cylinder | 6 | 月光束 (5尺半径) |
| 锥形 | cone | 3 | 燃烧之手 (15尺) |

### 3.3 豁免属性分布

| 属性 | 数量 | 占比 | 典型场景 |
|------|------|------|----------|
| 敏捷 | 41 | 30.8% | 躲避范围伤害 (火球、闪电束) |
| 感知 | 39 | 29.3% | 抵抗惑控/幻术 (定身术、暗示术) |
| 体质 | 30 | 22.6% | 抵抗毒素/维持集中 (石化术) |
| 魅力 | 13 | 9.8% | 抵抗放逐/驱散 (放逐术) |
| 力量 | 8 | 6.0% | 抵抗束缚/推拉 (纠缠术) |
| 智力 | 2 | 1.5% | 罕见 (幻像杀手) |

> **数据质量问题**: `saveType` 存在混合格式 — 92 个用缩写 (`wis`/`dex`/`con`)，41 个用全称 (`wisdom`/`dexterity`/`constitution`)。TypeScript 类型定义仅接受全称，但 `spell-constants.ts` 的 `saveTypeNames` 兼容两种格式。建议统一为全称。

---

## 四、法术功能归类

按**游戏机制效果**，将 356 个法术分为 8 大类：

### 4.1 直接伤害型 (~102 个)

**数值化程度: ★★★★☆ (80%)**

当前已有 `damage`、`damageType`、`damageAtSlotLevel`、`damageAtCharacterLevel` 等字段。

| 子类 | 数量 (估) | 已数值化 | 代表法术 |
|------|-----------|---------|----------|
| 单体直伤 | ~63 | damage + damageType | 魔法飞弹、灼热射线、精灵火 |
| 范围直伤 | ~39 | damage + areaOfEffect | 火球术、闪电束、寒冰锥 |
| 持续伤害 (DoT) | ~10 | 仅 damage | 巫术箭、月光束、感召闪电 |
| 戏法伤害 | ~10 | damageAtCharacterLevel | 火焰箭、神圣火焰、魔能爆发 |

**缺失字段**：

```typescript
// 建议增加：持续伤害结构
ongoingDamage?: {
  dice: string;                    // "1d12"
  trigger: "start_of_turn"         // 目标回合开始时
    | "end_of_turn"                // 目标回合结束时
    | "enter_zone"                 // 进入区域时
    | "first_time_on_turn";        // 每回合首次进入
  saveToEnd?: SaveType;            // 豁免可结束效果
}
```

**数据质量问题**: 13 个法术有 `damage` 但缺少 `damageType`：

| 法术 | damage | 应补充的 damageType |
|------|--------|-------------------|
| 荆棘鞭 (Thorn Whip) | 1d6 | piercing |
| 不协和之声 (Dissonant Whispers) | 3d6 | psychic |
| 巫术箭 (Witch Bolt) | 1d12 | lightning |
| 忿怒惩击 (Wrathful Smite) | 1d6 | psychic |
| 灼热惩击 (Searing Smite) | 1d6 | fire |
| 猎人印记 (Hunter's Mark) | 1d6 | (跟随武器类型) |
| 七彩喷射 (Chromatic Orb) | 3d8 | (施法时选择) |
| 致病射线 (Ray of Sickness) | 2d8 | poison |
| 纠缠打击 (Ensnaring Strike) | 1d6 | piercing |
| 云雾之刃 (Cloud of Daggers) | 4d4 | slashing |
| 目盲惩击 (Blinding Smite) | 3d8 | radiant |
| 活化物体 (Animate Objects) | 1d4+4 | (物理) |
| 虹光喷射 (Prismatic Spray) | 10d6 | (随机) |

### 4.2 控制/限制型 (~40 个)

**数值化程度: ★★★★☆ (75%)**

`controlEffect` 结构是目前最完善的复合效果数据。已覆盖 35 个法术，仍有约 5-10 个遗漏。

| 子类 | 代表法术 | 状态 |
|------|----------|------|
| 硬控 (行动完全剥夺) | 定身人/怪 → paralyzed | 已数值化 |
| 软控 (行动受限) | 纠缠术 → restrained, 缓慢术 → slowed | 已数值化 |
| 恐惧 | 恐惧术 → frightened | 已数值化 |
| 魅惑 | 魅惑人类 → charmed | 已数值化 |
| 放逐 | 放逐术 → 移出位面 | 已数值化 |
| 区域控制 | 蛛网术 (zone + restrained) | 已数值化 |

**已覆盖的状态条件**:

`blinded`, `charmed`, `deafened`, `frightened`, `grappled`, `incapacitated`, `invisible`, `paralyzed`, `petrified`, `poisoned`, `prone`, `restrained`, `stunned`, `unconscious`

### 4.3 Buff/增益型 (~50 个)

**数值化程度: ★☆☆☆☆ (5%) — 最大缺口**

这是目前数值化空白最严重的类别。所有效果都只存在于 `description` 文本中。

| 子类 | 数量 (估) | 代表法术 | 效果 (纯文本) |
|------|-----------|----------|-------------|
| AC 增益 | ~8 | 护盾术 (Shield) | +5 AC 至下回合 |
| | | 法师护甲 (Mage Armor) | AC = 13 + DEX |
| | | 树肤术 (Barkskin) | AC 不低于 16 |
| 攻击增益 | ~5 | 祝福术 (Bless) | 攻击骰/豁免 +1d4 |
| | | 妖火 (Faerie Fire) | 被攻击时有优势 |
| 属性增益 | ~6 | 增强属性 (Enhance Ability) | 指定属性检定优势 |
| | | 加速术 (Haste) | +2 AC, 双倍速度, 额外动作 |
| 抗性增益 | ~5 | 元素防护 (Prot. from Energy) | 指定元素伤害抗性 |
| | | 石肤术 (Stoneskin) | 物理伤害抗性 |
| 临时 HP | ~4 | 英雄气概 (Heroism) | 每回合获得临时 HP |
| | | 援助术 (Aid) | HP 上限 +5 |
| 隐身/掩蔽 | ~6 | 隐身术 (Invisibility) | 攻击/施法前不可见 |
| | | 朦胧术 (Blur) | 被攻击时有劣势 |
| 移动增益 | ~5 | 大步奔行 (Longstrider) | 速度 +10 尺 |
| | | 飞行术 (Fly) | 获得 60 尺飞行速度 |
| 武器增益 | ~4 | 魔化武器 (Magic Weapon) | +1/+2/+3 攻击和伤害 |
| | | 神圣武器 (Holy Weapon) | +2d8 光耀伤害 |

**建议的数据结构**:

```typescript
buffEffect?: {
  target: "self" | "ally" | "allies_30ft" | "touched";
  modifiers: BuffModifier[];
}

type BuffModifier =
  | { type: "ac_bonus"; value: number }                    // Shield: +5
  | { type: "ac_formula"; formula: string }                // Mage Armor: "13 + DEX"
  | { type: "ac_minimum"; value: number }                  // Barkskin: min 16
  | { type: "attack_bonus"; dice: string }                 // Bless: "1d4"
  | { type: "save_bonus"; dice: string }                   // Bless: "1d4"
  | { type: "damage_bonus"; dice: string; damageType?: string }  // Holy Weapon: "2d8 radiant"
  | { type: "advantage"; on: "attack" | "save" | "check"; ability?: string }
  | { type: "disadvantage_against"; on: "attack" }         // Blur
  | { type: "resistance"; damageType: string }             // Prot. from Energy
  | { type: "speed_bonus"; value: number }                 // Longstrider: +10
  | { type: "speed_set"; value: number; mode: "fly" | "swim" | "climb" }  // Fly: 60
  | { type: "temp_hp"; dice: string; perTurn?: boolean }   // Heroism: CHA/turn
  | { type: "hp_max_bonus"; value: number }                // Aid: +5
  | { type: "extra_attack"; count: number }                // Haste: 1
  | { type: "condition_immunity"; condition: string }      // Freedom of Movement
  | { type: "invisible"; breakOn: "attack" | "spell" | "none" };
```

### 4.4 Debuff/减益型 (~20 个)

**数值化程度: ★★☆☆☆ (20%)**

部分通过 `controlEffect` 覆盖了状态附加，但数值减益完全未结构化。

| 子类 | 代表法术 | 效果 |
|------|----------|------|
| 攻击减益 | 灾祸术 (Bane) | 攻击骰/豁免 -1d4 |
| AC 减益 | 灼热金属 (Heat Metal) | 攻击有劣势 |
| 速度减益 | 缓慢术 (Slow) | 速度减半, 失去反应, -2 AC |
| 属性减益 | 弱智术 (Feeblemind) | INT/CHA 降为 1 |
| 负面光环 | 枯萎术 (Blight) | 植物生物劣势 |

**建议的数据结构** (可复用 BuffModifier 取反):

```typescript
debuffEffect?: {
  target: "enemy" | "enemies_in_area";
  modifiers: DebuffModifier[];
  saveToResist?: SaveType;
}

type DebuffModifier =
  | { type: "attack_penalty"; dice: string }          // Bane: "-1d4"
  | { type: "save_penalty"; dice: string }            // Bane: "-1d4"
  | { type: "ac_penalty"; value: number }             // Slow: -2
  | { type: "speed_multiplier"; value: number }       // Slow: 0.5
  | { type: "disadvantage"; on: "attack" | "check"; ability?: string }
  | { type: "ability_set"; ability: string; value: number }  // Feeblemind: INT=1
  | { type: "lose_reaction" }                         // Slow
  | { type: "lose_multiattack" };                     // Slow
```

### 4.5 治疗/恢复型 (~15 个)

**数值化程度: ★★★★☆ (80%)**

基础治疗已有 `healing` + `healingAtSlotLevel`，但状态移除未结构化。

| 子类 | 代表法术 | 已数值化 |
|------|----------|---------|
| 直接治疗 | 治疗创伤 (Cure Wounds) | healing="1d8" |
| 群体治疗 | 群体治疗创伤 (Mass Cure Wounds) | healing="3d8" |
| 治疗之语 | 治疗之语 (Healing Word) | healing="1d4" |
| 状态移除 | 次级复原术 (Lesser Restoration) | 无结构化数据 |
| 复活 | 复生术 (Revivify) | 无结构化数据 |

**建议增加**:

```typescript
removesConditions?: ConditionType[];  // Lesser Restoration: ["blinded","deafened","paralyzed","poisoned"]
resurrection?: {
  timeLimitDays: number;              // Revivify: 1 分钟, Raise Dead: 10 天
  materialCostGP: number;            // Revivify: 300, Raise Dead: 500
  penalties?: string;                 // Raise Dead: -4 攻击/豁免/检定
}
```

### 4.6 召唤型 (~15 个)

**数值化程度: ★☆☆☆☆ (0%)**

| 子类 | 代表法术 | 需要的数据 |
|------|----------|-----------|
| 生物召唤 | 召唤动物群 (Conjure Animals) | 召唤物 CR、数量、行动方式 |
| 精魂武器 | 灵体武器 (Spiritual Weapon) | 攻击骰、伤害、移动 |
| 仆从 | 隐形仆从 (Unseen Servant) | 能力、持续时间 |
| 元素 | 召唤元素 (Conjure Elemental) | 元素类型、CR |

**建议结构**:

```typescript
summon?: {
  creatureType: string;         // "beast" | "elemental" | "construct"
  crMax: number;                // 最高 CR
  count: number | string;       // 数量或公式
  duration: string;             // "1 小时"
  requiresConcentration: boolean;
  statBlockId?: string;         // 引用怪物数据
}
```

### 4.7 移动/位移型 (~25 个)

**数值化程度: ★☆☆☆☆ (5%)**

| 子类 | 代表法术 | 效果 |
|------|----------|------|
| 瞬移 (自身) | 迷踪步 (Misty Step) | 30 尺瞬移 |
| 瞬移 (双人) | 任意门 (Dimension Door) | 500 尺 + 1 生物 |
| 强制位移 | 雷鸣波 (Thunderwave) | 推 10 尺 |
| 飞行 | 飞行术 (Fly) | 60 尺飞行速度 |
| 长距传送 | 传送术 (Teleport) | 任意距离 |

**建议结构**:

```typescript
movement?: {
  type: "teleport" | "push" | "pull" | "fly" | "swim" | "climb";
  distance: number;          // 尺
  target: "self" | "ally" | "enemy" | "willing";
  additionalTargets?: number; // Dimension Door: +1
}
```

### 4.8 探索/工具型 (~50 个)

**数值化程度: N/A — 数值化意义低**

这些法术效果以叙事为主，不涉及战斗数值。

| 子类 | 代表法术 |
|------|----------|
| 感知/侦测 | 侦测魔法、生物探知、真知 |
| 通讯 | 传讯术、短讯术、心灵感应 |
| 预言 | 占卜术、预言术、通灵术 |
| 变形 | 变形术、驯化石头 |
| 幻象 | 次级幻影、沉默术、镜影 |
| 创造 | 魔法阵、秘法锁 |

---

## 五、数值化覆盖总览

```
法术总数: 356
          ┌─────────────────────────────────────────────────────────────────────┐
 直接伤害 │████████████████████████████░░░░│ 102 (28.7%) — 已数值化 80%        │
          │                                                                     │
 控制效果 │████████████░░░░░░░░░░░░░░░░░░░│  40 (11.2%) — 已数值化 75%        │
          │                                                                     │
 Buff增益 │░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│  50 (14.0%) — 已数值化 5%   ← 重点│
          │                                                                     │
 Debuff   │░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│  20  (5.6%) — 已数值化 20%        │
          │                                                                     │
 治疗恢复 │██████████░░░░░░░░░░░░░░░░░░░░░│  15  (4.2%) — 已数值化 80%        │
          │                                                                     │
 召唤     │░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│  15  (4.2%) — 已数值化 0%         │
          │                                                                     │
 移动位移 │░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│  25  (7.0%) — 已数值化 5%         │
          │                                                                     │
 探索工具 │                                │  50 (14.0%) — 无需数值化          │
          │                                                                     │
 未分类   │                                │  39 (11.0%) — 混合效果            │
          └─────────────────────────────────────────────────────────────────────┘
          ████ = 已数值化    ░░░░ = 未数值化
```

---

## 六、数值化优先级建议

### P0 — 立即可做 (补全 + 修数据)

| 任务 | 工作量 | 影响 |
|------|--------|------|
| 统一 `saveType` 格式 (缩写 → 全称) | 小 | 消除运行时格式兼容代码 |
| 补全 13 个缺失 `damageType` 的法术 | 小 | 伤害统计更准确 |
| 给 `attackType` 为空但有 save/damage 的法术补充类型 | 中 | UI 展示更准确 |

### P1 — 高价值 (结构化新字段)

| 任务 | 工作量 | 影响 | 原因 |
|------|--------|------|------|
| **控制效果扩展**：未覆盖的控制法术补充 controlEffect | 中 | 高 | 框架已有，只需填数据 |
| **持续伤害 (DoT)**: 新增 `ongoingDamage` 字段 | 中 | 高 | 月光束/巫术箭等核心法术 |
| **治疗扩展**: 新增 `removesConditions` | 小 | 中 | 次级/高等复原术 |

### P2 — 中等价值 (新系统)

| 任务 | 工作量 | 影响 | 原因 |
|------|--------|------|------|
| **Buff 效果结构化** | 大 | 高 | 影响 50 个法术，modifier 类型复杂多样 |
| **Debuff 效果结构化** | 中 | 中 | 可复用 buff 的 modifier 系统 |
| **强制位移**: 新增 `forcedMovement` 字段 | 小 | 中 | 雷鸣波/排斥术等 |

### P3 — 低优先级 (未来)

| 任务 | 工作量 | 影响 | 原因 |
|------|--------|------|------|
| 召唤物数据关联 | 大 | 低 | 需要独立的召唤物 stat block 系统 |
| 探索/工具法术结构化 | 中 | 极低 | 主要靠 AI 叙事驱动 |
| 法术交互规则 | 极大 | 中 | Counterspell/Dispel Magic 的对抗系统 |

---

## 七、核心挑战与思考

### 7.1 Buff 系统的复杂度问题

同为"增加 AC"，三个法术的机制完全不同：

| 法术 | 效果 | 建模难点 |
|------|------|---------|
| Shield | 即时反应, +5 AC 到下回合 | 临时性, 触发时机特殊 |
| Mage Armor | 8 小时, AC = 13 + DEX | 替换基础 AC 计算公式 |
| Barkskin | 专注 1 小时, AC 不低于 16 | AC 下限而非加值 |

这意味着不能用简单的 `{ stat: "ac", value: +5 }` 统一建模，需要区分：
- `ac_bonus` (加值)
- `ac_formula` (替换公式)
- `ac_minimum` (下限)

### 7.2 持续效果追踪的缺失

当前系统没有"活跃法术实例"的概念：

```
现状:  角色 → 已知/已准备法术列表 (静态)
缺失:  角色 → 当前生效的法术列表 (动态) → 含: 剩余时长, 专注标记, 施法者, 目标
```

如果要做完整的 buff/debuff 自动计算，需要后端增加类似：

```python
class ActiveSpellInstance(Base):
    id: int
    spell_id: str
    caster_id: int
    target_id: int              # 角色或怪物
    campaign_id: str
    remaining_rounds: int | None
    concentration: bool
    applied_modifiers: JSON     # 实际生效的 modifiers 快照
    created_at: datetime
```

### 7.3 效果叠加规则

D&D 5E 核心规则：
- **同名效果不叠加** — 两个 Bless 只取较好的一个
- **不同效果可叠加** — Bless (+1d4) + Guidance (+1d4) 可同时生效
- **同类 AC 公式不叠加** — Mage Armor + Barkskin 只取较高者
- **临时 HP 不叠加** — 只保留较高的临时 HP 值

这些规则需要效果管理器来实现，数值化本身不解决叠加问题。

### 7.4 渐进式策略

建议采用"数据先行，逻辑后补"的策略：

1. **Phase 1**: 先在 JSON 数据中增加结构化字段（buffEffect/debuffEffect 等），前端可立即用于展示
2. **Phase 2**: 后端增加 ActiveSpellInstance 模型，实现专注追踪和持续时间倒计时
3. **Phase 3**: 实现 modifier 自动计算引擎，自动调整 AC/攻击/豁免等数值
4. **Phase 4**: 效果叠加规则、Dispel Magic 交互等高级功能

---

## 八、附录

### A. 131 个完全无结构化战斗数据的法术

这些法术目前仅有元数据 (name/level/school/components/duration) 和文本描述，是数值化的主要目标。

其中包括：
- **高战斗相关** (应优先数值化): Shield, Mage Armor, Bless, Bane, Haste, Slow, Counterspell, Dispel Magic, Misty Step, Fly 等
- **中等战斗相关**: Invisibility, Blur, Mirror Image, Greater Invisibility, Freedom of Movement 等
- **低战斗相关** (叙事为主): Detect Magic, Identify, Comprehend Languages, Speak with Dead 等

### B. 数据文件位置

| 文件 | 路径 | 说明 |
|------|------|------|
| 法术类型定义 | `frontend/app/types/spell.ts` | Spell 接口 |
| 前端法术数据 | `frontend/app/data/rules/spells.json` | 356 条，camelCase |
| 后端法术数据 | `backend/data/spells/all_spells.json` | 356 条，snake_case |
| 法术常量 | `frontend/app/components/spell/spell-constants.ts` | 学派/伤害类型颜色映射 |
| 数据标准化 | `frontend/app/components/spell/normalizeSpell.ts` | snake_case ↔ camelCase |
| 施法规则 | `frontend/app/components/character/CharacterDisplay/utils/spellcasting.ts` | 职业施法规则 |
| 法术修饰器 | `frontend/app/utils/spellModifiers.ts` | 邪术祈唤等修改法术属性 |
| 法术卡片 | `frontend/app/components/spell/SpellCard.tsx` | 法术展示组件 |
| 法术详情 | `frontend/app/components/spell/SpellCardFull.tsx` | 完整法术详情 |
| 效果数据 | `backend/app/data/effects.json` | 30+ 状态效果定义 |

### C. 现有常量定义

**8 个学派**: abjuration, conjuration, divination, enchantment, evocation, illusion, necromancy, transmutation

**13 个伤害类型**: acid, bludgeoning, cold, fire, force, lightning, necrotic, piercing, poison, psychic, radiant, slashing, thunder

**6 个豁免属性**: strength, dexterity, constitution, intelligence, wisdom, charisma

**5 个范围形状**: sphere, cone, cube, line, cylinder

**5 个攻击类型**: melee_spell, ranged_spell, save, auto, utility
