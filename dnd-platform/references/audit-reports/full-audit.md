# D&D 5E 职业特性校对报告

对比来源: 5e-bits/5e-database SRD vs 本项目 classes-progression.json

校对模型: gpt-5.2

---

# 武僧 (monk)

### [无甲移动] (Level 2)
- **问题类型**: 关键遗漏
- **SRD 原文**: “At 9th level, you gain the ability to move along vertical surfaces and across liquids on your turn without falling during the move.”
- **我们的描述**: “不穿护甲且不持盾时速度增加。2级+10尺、6级+15尺、10级+20尺、14级+25尺、18级+30尺。”
- **问题**: SRD 将“9级获得沿垂直表面/液面移动且在移动中不坠落”的内容写在同一个 **Unarmored Movement** 特性里；我们把它拆成了 9 级的“无甲移动改良”，导致 **2级特性描述缺少 9级会获得的后续效果**（按 SRD 结构这是同一特性的一部分）。
- **建议修正**: 在2级“无甲移动”末尾补一句类似：  
  “此外，9级起，你在自己的回合中可以沿垂直表面或穿越液面移动；但仅在该次移动过程中你不会坠落（或沉入液体）。”

### [无甲移动改良] (Level 9)
- **问题类型**: 数值/结构错误（特性归属不一致）
- **SRD 原文**: “Unarmored Movement … At 9th level, you gain the ability …”
- **我们的描述**: “无甲移动改良（Unarmored Movement Improvement）……”
- **问题**: SRD 并没有单独的 “Unarmored Movement Improvement” 特性名称；9级效果属于 **Unarmored Movement** 的组成部分。你们这样拆分会造成与 SRD 对照/检索时出现“额外特性名”，以及2级条目看起来缺内容。
- **建议修正**: 合并回“无甲移动（Unarmored Movement）”条目：  
  - 保留你们9级条目的文字，但把它并入2级“无甲移动”描述（或至少在9级条目里标注“这是无甲移动在9级获得的改良效果”），避免出现一个 SRD 中不存在的独立特性名。

✅ 除上述“无甲移动”条目结构/归属导致的遗漏与命名不一致外，其余对照项（AC公式、气点恢复与DC、疾风连击/耐心防御/御风步动作类型与消耗、拨挡飞弹减伤公式与投掷射程、缓落、额外攻击、震慑打击豁免类型与持续时间、气劲强化打击、反射闪避、心如止水、纯净之体、日月之舌、金刚魂、永恒之体、空灵之体、完美自我、武艺骰阶梯）均未发现规则与数值错误。
