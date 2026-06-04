# 设计：多发射物攻击法术 + aid 生命上限缩放

**日期**：2026-05-31 ｜ **分支**：feat/spell-qa-harness ｜ **状态**：已批准

## 背景与目标

法术 QA harness 发现三个缩放/多攻击建模缺口（cantrip 骰子缩放、magic_missile 平摊已修），剩余三个：

1. **eldritch_blast 束数不缩放** —— 始终 1 束（1d10 + 击退，1 次攻击骰），RAW 在 L5/11/17 增至 2/3/4 束，每束独立攻击骰。
2. **scorching_ray 射线数未建模** —— 2 环只出 1 道（2d6，单攻击骰），RAW 2 环=3 道、每高一环 +1 道，每道独立攻击骰 2d6；当前升环错误地加骰（`extra_dice`）。
3. **aid 生命上限加成不随升环缩放** —— `heal` 正确缩放（+5/环，4 环=15），但 `modify_stat max_hp` 每环恒为 5。

(1)(2) 共同需要引擎支持「一个 phase 发射 N 个独立攻击骰」（projectiles/beams 计数），当前单攻击/phase 模型不支持。

## 已核实的承重事实（证据）

- **A**：`backend/app/services/spell_resolver.py:404` 是全文件唯一 `attack_d20 = qa_randint(1, 20)`，位于 `for target in targets` 内、无发射物循环 → 每目标每 phase 仅 1 次攻击骰。
- **B**：`is_formula("5+10")=False`（无骰子无变量）→ 修正消费方 `effect_service.py:303-317` 走 `int("5+10")` → ValueError → **加成被静默丢弃**。故 aid 缩放后必须**预求值成 int**（`_safe_eval_arithmetic("5+10")=15`），不可存裸字符串。
- **C**：`get_modifiers_for_target` 全部 8 个调用点 target ∈ {saving_throw, ability_check, attack_roll, incoming_attack, opportunity_attack_provoked}，**无一查 hp_max/max_hp** → aid 的 max_hp 加成当前从未进入有效最大 HP。
- **D**：`eldritch_blast`(spells.json:1548) `damageAtCharacterLevel` 四档全 `1d10`（只缩束不缩骰）；`scorching_ray`(8133) `scaling.extra_dice:"2d6"`（错误地加骰）。两者 description 文字均已写明 RAW 多束/多射线规则，仅 `effects` 机械编码缺失。
- **E**：`AttackConfig/ScalingConfig/EffectPhase`（`schemas/spell_effect.py:54/60/152`）全仓库仅有定义、从不 `model_validate` 法术 JSON；resolver 读原始 dict；类为普通 `BaseModel`（默认忽略额外字段）→ 加字段非破坏性。

## 决策

- 多目标分配：**轮流（round-robin），总数 N**（1 目标→全部 N 发命中它）；单发射物法术（projectile_count==1）**完全保持原逐目标循环**，零行为改动。
- aid #3：**端到端接线**有效最大 HP（不止修复缩放）。
- EB 击退 phase 原样保留（非攻击 phase，每目标挪一次），不动。

## 设计

### 1. 数据驱动 projectiles 机制（通用）
新增可选字段（原始 dict 读取 + 加进 schema 作文档，非破坏）：
- `phase.attack.projectiles: int = 1` —— 基础数（SR=3）
- `phase.attack.projectilesAtCharacterLevel: {lvl: count}` —— 角色等级缩放（EB=`{"1":1,"5":2,"11":3,"17":4}`）
- `scaling.extra_projectiles: int` —— 每高于 `per_slot_above` 一环 +N（SR=1）

计数 `_projectile_count(attack_cfg, scaling, ctx)`：底数 = 有 `projectilesAtCharacterLevel` 取「≤ caster_level 最高档」否则 `attack.projectiles`；+ `extra_projectiles × (slot_level − per_slot_above)`（升环）；clamp ≥ 1。

### 2. Resolver：N 次独立攻击骰
`_execute_phase`（`spell_resolver.py:317`）中，phase 有 attack 且 `projectile_count > 1` 时：发 N 个发射物，每个各自 `qa_randint(1,20)`→命中/暴击→`deal_damage`，在合格目标间轮流分配；各自产 `EffectResult`（独立 attack_roll/attack_hit/critical_hit），`total_damage` 累加。单发射物/豁免/增益 phase 走原逐目标循环。**重构**：抽出「逐(目标,攻击结果)效果派发块」为 helper，两路径共用（避免复制 ~150 行，文件保持 <400 行）。

### 3. 法术数据（frontend/app/data/rules/spells.json）
- eldritch_blast：`effects[0].attack` 加 `projectilesAtCharacterLevel {1:1,5:2,11:3,17:4}`；伤害仍 1d10；击退 phase 不动。
- scorching_ray：`effects[0].attack` 加 `projectiles:3`；`scaling` 改 `{per_slot_above:2, extra_projectiles:1}`（去掉 extra_dice）；每道仍 2d6。

### 4. aid：缩放修复 + 有效最大 HP 接线
- `effect_engine/handlers/modifier.py`：(a) `modify_stat` 值用 phase scaling（extra_value）缩放并**预求值成 int**（2环→5，4环→15）；(b) `_stat_to_modifier_target` 加 `max_hp→hp_max`。
- `effect_service.py`：新增 `get_max_hp_bonus(active_effects) -> int`（复用 `get_modifiers_for_target(active_effects, "hp_max")` 汇总 bonus）。
- `combat_resolution_service.py` `resolve_effective_target_hp`（:296）：把该加成累加进 `effective_max_hp`（无 buff 时 0，不影响未受 buff 生物）。

### 5. 回归测试（backend/tests/unit/，仿 test_spell_qa_correctness_fixes.py）
`SpellResolver` + `push_forced_rolls` + `QA_MODE` + mock db：
- scorching_ray 2 环→3 条 deal_damage、攻击骰各异（forced `[18,2,18]`→命中/未命中/命中）；4 环→5 条。
- eldritch_blast caster_level 1/5/11/17/20 → 1/2/3/4/4 束。
- aid：2 环存储 hp_max 修正求值=5，4 环=15；且施放后 `resolve_effective_target_hp` → effective_max_hp = base+5 / base+15。

## 范围外 / 备注
- EB 击退保持 one-push-per-target（建模 Repelling Blast，pre-existing）；per-beam push 为后续。
- magic_missile（已修，自动命中无攻击骰）不动。
- UI 等其他 max-HP 消费方可后续复用 `get_max_hp_bonus`。
