# 德鲁伊 (druid)

### [野性变身] (Level 2)
- **问题类型**: 关键遗漏  
- **SRD 原文**: “You can stay in a beast shape for a number of hours equal to half your druid level (rounded down). **You then revert to your normal form unless you expend another use of this feature.**”  
- **我们的描述**: “你可保持该形态的时间=你德鲁伊等级的一半（向下取整）小时；你可在自己回合用【附赠动作】提前解除。”  
- **问题**: 缺少“到时后会自动变回原形，除非再消耗一次野性变身使用次数以延长/再次变形”的关键规则。  
- **建议修正**: “你可保持该形态的时间=你德鲁伊等级的一半（向下取整）小时；时间结束后你会恢复原形，除非你再消耗一次野性变身使用次数。你也可在自己回合用【附赠动作】提前解除。”

---

### [野性变身] (Level 2)
- **问题类型**: 关键遗漏  
- **SRD 原文**: “Your game statistics are replaced by the statistics of the beast, but you retain… Intelligence, Wisdom, and Charisma scores… You also retain all of your skill and saving throw proficiencies, in addition to gaining those of the creature… If the creature has any legendary or lair actions, you can't use them.”  
- **我们的描述**: 已包含上述要点（游戏数据替换、保留心智三项属性、保留熟练并取高、不能用传奇/巢穴动作等）  
- **问题**: 未提及 SRD 条款：  
  - **“如果新形态不具备某特殊感官，你不能使用原本的特殊感官（如黑暗视觉）”**你写了“特殊感官需新形态也具备”，这点正确；但仍缺少一个常被需要的明确例示/定义不是硬性。  
- **建议修正**: 可不改（此处不构成错误）。  

> 注：本条经对照后，你们的表述在机制上已覆盖 SRD 关键点，未构成必须修改的问题；因此不计为问题输出。真正的问题在上一条“到时续用”缺失。

---

### [缺失特性：Wild Shape（CR 1/4 / 1/2 / 1）分段条目] (Level 4 / 8)
- **问题类型**: 规则错误（数据结构/重复导致的潜在冲突）  
- **SRD 原文**: SRD 将 Wild Shape 的完整规则在 2/4/8 级条目中重复呈现（每个条目都还是同一套完整规则），但其本质是同一特性的进阶阈值变化。  
- **我们的描述**: 你们在 2 级“野性变身”里已经写入了 2/4/8 级全部阈值；同时又在 4 级、8 级分别额外给了“野性变身（CR 1/2）”“野性变身（CR 1）”条目。  
- **问题**: 这会造成规则来源重复/可能被前端或玩家误解为“4级、8级又获得一次独立特性”，甚至在系统实现上出现叠加、覆盖或展示冲突（尤其当系统按条目当作独立 feature 处理时）。严格来说 SRD 的这些条目是“同一特性的分段说明”，你们既然已在 2 级主条目写全阈值，就不应再以独立特性重复给出。  
- **建议修正**: 二选一：  
  1) **只保留 2 级主条目**（含 2/4/8 阈值变化），删除 4 级与 8 级的两个“野性变身（CR …）”独立条目；或  
  2) **改成分段更新**：2级主条目只写 2级阈值；4级条目只写“阈值更新”；8级条目只写“阈值更新”，并在主条目注明“见后续等级阈值更新”。  

---

### [缺失特性] (Level 18)
- **问题类型**: ✅ 无（未发现问题）  
- **SRD 原文**: “Timeless Body… For every 10 years that pass, your body ages only 1 year.” / “Beast Spells… perform the somatic and verbal components… but… aren't able to provide material components.”  
- **我们的描述**: “衰老缓慢，每10年只老化1年” / “可完成语言与姿势成分，但不能提供材料成分。”  
- **问题**: 无。  
- **建议修正**: 无。  

---

## 结论
主要需要修正的点只有一个明确规则缺失：**野性变身持续时间结束后，除非再消耗一次使用次数，否则会恢复原形**。此外，数据层面建议避免把同一特性的“阈值更新”既写进 2 级主条目又在 4/8 级重复成独立特性，以免系统或读者误解。
