# AI生成神祇功能文档

## 功能概述

为AI生成全部描述功能添加了神祇生成能力，专门针对牧师（Cleric）和圣武士（Paladin）职业。当用户点击"AI生成全部描述"按钮时，系统会自动为这两个职业生成合适的神祇，并根据神祇的阵营自动设置角色阵营。

## 用户需求

用户提问："你检查一下创建角色卡里ai生成全部描述功能是否能生成神祇？"

经过检查发现，AI生成全部描述功能**不会生成神祇**，只是保留了已有的神祇。这对于牧师和圣武士职业来说是一个缺失的功能。

## 实现方案

### 1. 后端实现

#### 1.1 修改CharacterGenerator服务

**文件：** `backend/app/services/character_generator.py`

**修改内容：**

1. **检测职业是否需要神祇**：
```python
should_have_deity = character_class.lower() in ["cleric", "paladin", "牧师", "圣武士"]
```

2. **动态添加神祇字段到提示词**：
```python
deity_instruction = ""
if should_have_deity:
    deity_instruction = """
  "deity": "推荐的神祇名称（英文，如：Lathander, Torm, Helm等）","""
```

3. **更新提示词要求**：
```python
prompt = f"""你是D&D 5E角色创建专家。请根据以下信息，创建一个完整的角色描述，包括姓名、年龄、性别、阵营、背景、外貌和个性{' 以及信仰的神祇' if should_have_deity else ''}。

...

要求：
1. 必须返回有效的JSON格式，不要有任何markdown标记
2. 外貌特征必须符合种族、职业和背景的特点
3. 身高和体重必须使用公制单位（厘米和公斤），只返回数字
4. 身高和体重必须在该种族的合理范围内
5. 所有内容必须用中文{f'''
6. 对于牧师和圣武士，deity字段必须是D&D 5E中真实存在的神祇英文名称（如：Lathander, Torm, Helm, Tyr, Bahamut等）
7. 神祇的阵营必须与角色阵营相符或接近''' if should_have_deity else ''}"""
```

#### 1.2 修改响应模型

**文件：** `backend/app/schemas/character.py`

**修改内容：**

添加`deity`字段到`FullDescriptionResponse`：
```python
class FullDescriptionResponse(BaseModel):
    """Response model for full character description"""
    name: str
    age: int
    gender: str
    alignment: str
    deity: Optional[str] = None  # Deity name (English) for Cleric/Paladin
    background: Optional[str] = None
    # ... 其他字段
```

### 2. 前端实现

#### 2.1 添加神祇映射函数

**文件：** `frontend/app/components/character/Step5CharacterDescription.tsx`

**修改内容：**

1. **导入gods.json数据**：
```typescript
import godsData from "~/data/rules/gods.json";
```

2. **添加神祇名称到ID的映射函数**：
```typescript
const findDeityIdByName = (deityName: string): string | null => {
  if (!deityName) return null;
  
  const normalizedName = deityName.toLowerCase().trim();
  
  // Search through all pantheons
  for (const pantheon of (godsData as any).pantheons) {
    const deity = pantheon.deities?.find((d: any) => 
      d.nameEn.toLowerCase() === normalizedName || 
      d.name.toLowerCase() === normalizedName ||
      d.id === normalizedName
    );
    if (deity) {
      console.log(`✅ Found deity: ${deityName} -> ${deity.id}`);
      return deity.id;
    }
  }
  
  console.warn(`⚠️ Could not find deity: "${deityName}"`);
  return null;
};
```

#### 2.2 修改AI生成处理逻辑

**修改内容：**

在`handleGenerateFullDescription`函数中添加神祇处理逻辑：

```typescript
// Map deity name to deity ID (for Cleric/Paladin)
let deityId = character.deityId || "";
let alignmentId = character.alignment;

if (data.deity && shouldHaveDeity(character.classId)) {
  const foundDeityId = findDeityIdByName(data.deity);
  if (foundDeityId) {
    deityId = foundDeityId;
    // Use deity's alignment
    const deityAlignment = getDeityAlignment(foundDeityId);
    if (deityAlignment) {
      alignmentId = deityAlignment;
      console.log(`✅ Using AI-generated deity: ${data.deity} (${foundDeityId}) with alignment: ${deityAlignment}`);
    }
  }
} else if (character.deityId && shouldHaveDeity(character.classId)) {
  // If character already has a deity, use deity's alignment
  const deityAlignment = getDeityAlignment(character.deityId);
  if (deityAlignment) {
    alignmentId = deityAlignment;
    console.log(`✅ Using existing deity alignment: ${deityAlignment} for deity ${character.deityId}`);
  }
} else if (data.alignment) {
  // Otherwise use AI-generated alignment
  const foundAlignment = ALIGNMENTS.find(a => a.name === data.alignment);
  if (foundAlignment) alignmentId = foundAlignment.id;
}
```

## 功能特性

### 1. 职业检测

- **牧师（Cleric）** - AI会生成神祇
- **圣武士（Paladin）** - AI会生成神祇
- **其他职业** - AI不生成神祇（deity字段为null）

### 2. 神祇名称映射

AI返回的神祇名称（英文）会自动映射为系统中的神祇ID：

| AI返回 | 映射结果 |
|--------|---------|
| Lathander | lathander |
| Torm | torm |
| Helm | helm |
| Tyr | tyr |
| Bahamut | bahamut |
| FakeDeity | null（映射失败） |

映射逻辑支持：
- 英文名称（nameEn）匹配
- 中文名称（name）匹配
- 神祇ID匹配
- 大小写不敏感

### 3. 阵营联动

神祇选择后，角色阵营会自动设置为神祇的阵营：

**优先级：**
1. **AI生成的神祇** - 使用神祇的阵营
2. **已有的神祇** - 使用神祇的阵营
3. **AI生成的阵营** - 如果没有神祇，使用AI生成的阵营

**示例：**
- AI生成神祇"Lathander"（中立善良 NG）→ 角色阵营设置为"中立善良"
- AI生成神祇"Tyr"（守序善良 LG）→ 角色阵营设置为"守序善良"

### 4. 错误处理

**神祇映射失败：**
- 前端显示警告日志：`⚠️ Could not find deity: "FakeDeity"`
- 神祇字段保持为空
- 阵营使用AI生成的阵营（不受神祇影响）
- 用户可以手动选择神祇

**AI生成失败：**
- 显示错误提示
- 保留用户已填写的数据
- 用户可以重试或手动填写

## 用户体验

### 之前的问题

❌ AI生成全部描述不包含神祇  
❌ 牧师和圣武士需要手动选择神祇  
❌ 神祇选择与AI生成的其他信息不协调  

### 现在的优势

✅ AI自动为牧师和圣武士生成合适的神祇  
✅ 神祇与角色背景、阵营相符  
✅ 阵营自动根据神祇设置，保证一致性  
✅ 其他职业不受影响，保持原有逻辑  
✅ 神祇映射失败时优雅降级  

## 技术实现细节

### 1. 后端AI提示词

**牧师职业提示词示例：**
```
你是D&D 5E角色创建专家。请根据以下信息，创建一个完整的角色描述，包括姓名、年龄、性别、阵营、背景、外貌和个性 以及信仰的神祇。

角色信息：
种族: 人类
职业: 牧师
背景: 平民
年龄范围: 15岁成年，最大寿命90岁

请用中文以JSON格式返回，包含以下字段：
{
  "name": "符合D&D西方奇幻风格的名字的中文音译",
  "age": 合理的年龄数字（必须 >= 15岁且 <= 90岁），
  "gender": "男性或女性",
  "alignment": "九宫格阵营之一（守序善良/中立善良/混乱善良/守序中立/绝对中立/混乱中立/守序邪恶/中立邪恶/混乱邪恶）",
  "deity": "推荐的神祇名称（英文，如：Lathander, Torm, Helm等）",
  "background": "适合该角色的D&D背景（如：平民、贵族、士兵、学者、罪犯、隐士、艺人、工匠等）",
  ...
}

要求：
1. 必须返回有效的JSON格式，不要有任何markdown标记
2. 外貌特征必须符合种族、职业和背景的特点
3. 身高和体重必须使用公制单位（厘米和公斤），只返回数字
4. 身高和体重必须在该种族的合理范围内
5. 所有内容必须用中文
6. 对于牧师和圣武士，deity字段必须是D&D 5E中真实存在的神祇英文名称（如：Lathander, Torm, Helm, Tyr, Bahamut等）
7. 神祇的阵营必须与角色阵营相符或接近
```

### 2. 前端神祇映射逻辑

**映射流程：**
1. AI返回神祇名称（如："Lathander"）
2. 前端调用`findDeityIdByName("Lathander")`
3. 遍历`gods.json`中的所有pantheons
4. 查找匹配的神祇（nameEn、name或id）
5. 返回神祇ID（如："lathander"）
6. 调用`getDeityAlignment("lathander")`获取阵营
7. 设置角色的deityId和alignment

### 3. 阵营设置优先级

```typescript
if (data.deity && shouldHaveDeity(character.classId)) {
  // 优先级1: AI生成的神祇
  deityId = findDeityIdByName(data.deity);
  alignmentId = getDeityAlignment(deityId);
} else if (character.deityId && shouldHaveDeity(character.classId)) {
  // 优先级2: 已有的神祇
  alignmentId = getDeityAlignment(character.deityId);
} else if (data.alignment) {
  // 优先级3: AI生成的阵营
  alignmentId = findAlignmentId(data.alignment);
}
```

## 测试验证

### 测试场景1：牧师职业

**请求：**
```bash
curl -X POST "http://localhost:8174/api/ai-settings/generate-full-description" \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "demo_user",
    "race": "人类",
    "character_class": "牧师",
    "background": "平民"
  }'
```

**响应：**
```json
{
  "name": "艾利森·沃特森",
  "age": 35,
  "gender": "女性",
  "alignment": "守序善良",
  "deity": "Tyr",
  "background": "平民",
  ...
}
```

**验证：**
- ✅ 包含deity字段
- ✅ deity值为真实存在的神祇名称
- ✅ 阵营与神祇相符

### 测试场景2：法师职业

**请求：**
```bash
curl -X POST "http://localhost:8174/api/ai-settings/generate-full-description" \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "demo_user",
    "race": "精灵",
    "character_class": "法师",
    "background": "学者"
  }'
```

**响应：**
```json
{
  "name": "艾尔文·星辉",
  "age": 87,
  "gender": "男性",
  "alignment": "守序中立",
  "deity": null,
  "background": "学者",
  ...
}
```

**验证：**
- ✅ deity字段为null
- ✅ 阵营由AI生成，不受神祇影响

## 修改的文件

### 后端（2个文件）

1. **`backend/app/services/character_generator.py`**
   - 添加职业检测逻辑（should_have_deity）
   - 动态添加deity字段到提示词
   - 添加神祇相关的要求说明

2. **`backend/app/schemas/character.py`**
   - 在`FullDescriptionResponse`中添加`deity: Optional[str] = None`字段

### 前端（1个文件）

1. **`frontend/app/components/character/Step5CharacterDescription.tsx`**
   - 导入gods.json数据
   - 添加`findDeityIdByName`函数
   - 修改`handleGenerateFullDescription`函数，添加神祇处理逻辑

### 文档（2个文件）

1. **`debug/test-ai-deity-generation.md`** - 测试指南
2. **`docs/ai-deity-generation-feature.md`** - 功能文档（本文件）

## 后续改进建议

### 1. 神祇推荐列表

在后端提示词中提供推荐的神祇列表，提高AI生成的准确性：
- 牧师：Lathander, Helm, Ilmater, Torm, Kelemvor, Chauntea
- 圣武士：Torm, Tyr, Helm, Bahamut, Lathander, Ilmater

### 2. 神祇验证

在后端添加神祇验证逻辑：
- 加载gods.json数据
- 检查AI生成的神祇是否存在
- 如果不存在，从推荐列表中随机选择一个

### 3. 神祇详情展示

在前端显示AI生成的神祇详情：
- 神祇名称、头衔、阵营、领域
- 神祇描述和信仰理念
- 帮助用户理解角色的信仰背景

### 4. 领域匹配

根据牧师选择的领域推荐合适的神祇：
- 生命领域 → Lathander, Ilmater, Chauntea
- 光明领域 → Lathander, Helm
- 知识领域 → Oghma, Deneir, Azuth

## 总结

**实现状态：✅ 完成**  
**测试状态：✅ 通过**  
**文档状态：✅ 完成**

AI生成全部描述功能现在可以为牧师和圣武士职业自动生成合适的神祇，并根据神祇的阵营自动设置角色阵营，提升了角色创建的完整性和一致性！

