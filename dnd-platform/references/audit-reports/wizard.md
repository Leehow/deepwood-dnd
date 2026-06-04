# 法师 (wizard)

### [施法] (Level 1)
- **问题类型**: 关键遗漏
- **SRD 原文**: `As a student of arcane magic, you have a spellbook containing spells that show the first glimmerings of your true power.`
- **我们的描述**: `你通过研习奥术施展法术……（后续为完整的法师施法与法术书规则）`
- **问题**: SRD 这里其实只给了一句非常简略的“你有一本法术书”。你们的描述远比 SRD 完整，不构成规则错误；但严格按“逐条对比 SRD 特性描述”，你们的“施法”条目混入了大量不在该条 SRD 文本中的细节，导致无法与 SRD 逐句核对（数据对齐问题）。这会在后续做自动校验/追溯 SRD 来源时产生困难。
- **建议修正**: 将该条目拆分为与 SRD 对齐的最小描述，例如：  
  `你拥有一本法术书，记录你的法师法术。`  
  其余“准备法术、仪式施法、抄录法术、初始6个法术”等放到你们自定义的“施法（详细规则）/法术书/学习法术”等条目中，或明确标注“非 SRD 句子扩展”。

---

### [学习法术] (Level 1；以及 Level 2-20 的重复条目)
- **问题类型**: 缺失特性（SRD 中无此“职业特性”）/ 数据问题（条目重复）
- **SRD 原文**: （SRD 法师职业特性列表中 **没有** “Spell Learning” 这一独立特性条目）
- **我们的描述**: `学习法术（Spell Learning）……每次法师升级加入2个法术……抄录法术耗时与花费……`（并在1-20级大量重复出现）
- **问题**:  
  1) **SRD 对比口径下属于“多出来的特性”**：SRD 的 wizard 特性列表并不包含“Spell Learning”独立条目。你们把“法术书/抄录/升级加法术”拆成了独立特性，这会导致与 SRD 列表逐条对比时出现“SRD没有但我们有”的不一致。  
  2) **重复建模**：同一段“学习法术”在 1-20 级反复出现，容易造成前端展示重复、以及后续维护时出现版本不一致。
- **建议修正**:  
  - 若目标是“对齐 SRD 特性列表”：删除“学习法术(Spell Learning)”作为独立职业特性，把内容并入“施法/法术书”条目。  
  - 若保留作为你们系统的拆分：至少只保留一次（例如 Level 1），不要每级重复；或改为“每次升级时的规则”放在施法系统说明里，而不是按等级生成重复特性。

---

### [缺失特性清单]（按 SRD Wizard 职业特性列表口径）
- **问题类型**: ✅ 未发现缺失特性
- **SRD 原文**: SRD 列表包含：Arcane Recovery、Spellcasting、Arcane Tradition、Spell Mastery、Signature Spell（以及 ASI 与“Arcane Tradition feature”占位）
- **我们的描述**: 对应均存在（奥术回复、施法、奥术传统、法术精通、签名法术；并且用“传统特性”覆盖 6/10/14 的占位）
- **问题**: 无
- **建议修正**: 无

---

### [奥术回复] (Level 1)
- **问题类型**: ✅ 未发现问题
- **SRD 原文**: `Once per day when you finish a short rest... combined level ... equal to or less than half your wizard level (rounded up)... none ... 6th level or higher.`
- **我们的描述**: `每天一次，当你完成一次短休后...总环位不超过你法师等级的一半（向上取整）...不能恢复6环或更高...`
- **问题**: 无
- **建议修正**: 无

---

### [法术精通] (Level 18)
- **问题类型**: ✅ 未发现问题
- **SRD 原文**: `Choose a 1st-level ... and a 2nd-level ... in your spellbook... cast ... without expending a spell slot when you have them prepared... By spending 8 hours in study, you can exchange...`
- **我们的描述**: 与 SRD 等价
- **问题**: 无
- **建议修正**: 无

---

### [签名法术] (Level 20)
- **问题类型**: ✅ 未发现问题
- **SRD 原文**: `Choose two 3rd-level wizard spells in your spellbook... always have these spells prepared... you can cast each of them once at 3rd level without expending... regain after a short or long rest...`
- **我们的描述**: 与 SRD 等价
- **问题**: 无
- **建议修正**: 无
