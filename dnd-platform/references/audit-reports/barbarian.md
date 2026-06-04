# 野蛮人 (barbarian)

### [狂暴] (Level 1)
- **问题类型**: 数值错误
- **SRD 原文**: `"When you make a melee weapon Attack using Strength, you gain a +2 bonus to the damage roll. This bonus increases as you level."`
- **我们的描述**: `②当你用力量进行一次近战武器攻击并掷伤害时，该伤害掷骰获得加值（1级+2，9级+3，16级+4）；`
- **问题**: 狂暴伤害加值的等级节点写错。SRD/PHB 的节点是 **9级+3、16级+4、20级+4**（即 16 级起为 +4，不是到 20 级才变化），你们这里虽然写了 16 级 +4，但缺少/未明确 **20 级仍为 +4**倒不是硬错；真正的问题在于你们的“数值数据 rageDamage”在 13-15 级仍为 3，与 SRD 的 16+4一致，但缺少对 20 级仍是 +4 的明确（文本与数值数据都未体现 20 单独节点，但 SRD 的确没有 20 单独提升，仍为 +4）。**此条更像“表述不清”**，但若你们的系统依赖“节点表”，可能会被误实现。
- **建议修正**: `…伤害掷骰获得加值（1级+2，9级+3，16级起+4）。`

### [狂暴] (Level 1)
- **问题类型**: 关键遗漏
- **SRD 原文**: `"Your rage lasts for 1 minute. It ends early if you are knocked Unconscious or if Your Turn ends and you haven't attacked a hostile creature since your last turn or taken damage since then."`
- **我们的描述**: `…或若你回合结束时，自你上个回合以来既未攻击过敌对生物也未受到伤害，则提前结束（此处“攻击”指进行过攻击，不要求命中）。`
- **问题**: SRD 写的是 **“haven't attacked a hostile creature”**，你们补充为“不要求命中”是对的；但你们没明确“攻击敌对生物”必须是“自上回合以来”，虽大体表达了。真正缺少的是：SRD 这里并未声明“攻击必须是武器攻击/近战攻击”，但你们的括注可能导致实现时把“攻击敌对生物”误限定成“进行过一次攻击动作/一次攻击检定”。如果你们系统把“攻击”严格等同于“Attack action”，会出错（SRD 仅要求“attacked”，通常理解为进行了攻击检定即可，哪怕是借机攻击、额外攻击等；不要求是攻击动作）。
- **建议修正**: `…若在你回合结束时，自你上个回合结束以来你既未对敌对生物进行过任何一次攻击（进行过攻击检定即可，不要求命中；也不要求必须是攻击动作）且未受到伤害，则狂暴提前结束。`

### [缺失特性：Danger Sense/鲁莽攻击等以外的主职特性检查]  
✅ 未发现“SRD 有但我们完全没有”的主职特性（已包含：Rage, Unarmored Defense, Danger Sense, Reckless Attack, Primal Path, Extra Attack, Fast Movement, Feral Instinct, Brutal Critical, Relentless Rage, Persistent Rage, Indomitable Might, Primal Champion；ASI 按要求不检查；Path feature 条目为占位可忽略）。

### [其他条目总体对比]
✅ 未发现明确的规则错误/数值错误（豁免类型、动作类型、持续时间、恢复方式等与 SRD 一致）。
