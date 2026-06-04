# 战士 (fighter)

### [战斗风格 / Fighting Style：各子选项] (Level 1)
- **问题类型**: 关键遗漏
- **SRD 原文**:  
  - "You gain a +2 bonus to attack rolls you make with ranged weapons."  
  - "While you are wearing armor, you gain a +1 bonus to AC."  
  - "When you are wielding a melee weapon in one hand and no other weapons, you gain a +2 bonus to damage rolls with that weapon."  
  - "When you roll a 1 or 2 on a damage die... you can reroll the die... The weapon must have the two-handed or versatile property..."  
  - "When a creature you can see attacks a target other than you that is within 5 feet of you, you can use your reaction to impose disadvantage... You must be wielding a shield."  
  - "When you engage in two-weapon fighting, you can add your ability modifier to the damage of the second attack."
- **我们的描述**:  
  - 战斗风格条目下仅列出子选项（箭术/防御/决斗/巨武器战斗/保护/双武器战斗），但每个子选项 `features: []`，没有任何规则文本。
- **问题**: SRD 中每个战斗风格子选项都有具体效果与限制条件；你们的数据把“可选项名字”列出来了，但完全缺失每个选项的规则效果，导致无法按规则使用。
- **建议修正**: 给每个子选项补上对应规则文本（可作为该选项的 feature/description）。例如：  
  - **箭术**：你用远程武器进行的攻击检定获得+2加值。  
  - **防御**：当你穿着护甲时，AC +1。  
  - **决斗**：当你单手持用一把近战武器且未持用其他武器时，该武器伤害掷骰+2。  
  - **巨武器战斗**：当你用双手持用的近战武器进行攻击并掷伤害骰时，若某个伤害骰掷出1或2，你可以重掷该骰，但必须使用新结果（即使仍为1或2）。该武器必须具有“双手”或“多用(versatile)”属性。  
  - **保护**：当你能看见的生物攻击一个位于你5尺内、且不是你的目标时，你可以用反应使该次攻击检定具有劣势。你必须持用盾牌。  
  - **双武器战斗**：当你进行双武器战斗时，你可以将你的属性调整值加到第二次攻击的伤害上。  

### [武术范型 / Martial Archetype] (Level 3)
- **问题类型**: 关键遗漏
- **SRD 原文**: "The archetype you choose grants you features at 3rd level and again at 7th, 10th, 15th, and 18th level."
- **我们的描述**: "你选择的范型会在你达到3级，并在7、10、15与18级时授予你特性。"
- **问题**: 你们的“职业本体”层面在7/10/15/18级用“范型特性：根据所选范型获得特性”占位是可以的；但你们随后提供的多个子职业（战斗大师、奥法骑士等）内容并非 SRD 对应子职业，且多处明显不是5e原规则（例如“战斗大师15级不屈：先攻掷骰为0时改为1”在5e中不成立；奥法骑士多条也不像5e原文）。按你的要求“子职业特性不对比”，这里不逐条展开；但需要提醒：如果你们目标是“SRD fighter”，你们的子职业数据与 SRD 将不匹配。
- **建议修正**: 若此数据集声明为“SRD fighter”，建议仅保留 SRD 的 Champion 子职业（或至少标注这些子职业为“非SRD/自定义/扩展内容”），避免与“SRD官方数据”对不上。  

✅ 除上述问题外（战斗风格子选项规则文本完全缺失是最大问题），其余战士本职特性（回气、动作如潮、额外攻击、不屈的次数与恢复）与 SRD 在关键规则点上未发现差异。
