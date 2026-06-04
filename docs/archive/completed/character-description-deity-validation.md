# 角色描述步骤 - 神祇选择与必填项验证

## 功能概述

为角色创建向导的"描述角色"步骤（Step 5）添加了神祇选择功能，并完善了必填项验证逻辑，确保用户填写所有必要信息后才能进入下一步。

## 用户需求

用户反馈：
1. **神祇选择不见了** - "创建角色卡里的描述角色里神祇选择不见了"
2. **必填项验证失效** - "描述角色必选项没填写也能点下一步不应该啊，应该不让点，然后显示缺少必填项"

## 实现方案

### 1. 添加神祇选择功能

**位置：** `frontend/app/components/character/Step5CharacterDescription.tsx`

**功能：**
- 在"基本信息"部分添加"信仰的神祇"字段
- 使用`DeitySelector`组件提供完整的神祇选择界面
- 根据职业显示不同的标签：
  - 牧师/圣武士：显示"(推荐)"
  - 其他职业：显示"(可选)"

**神祇选择后的行为：**
- 自动设置角色阵营为神祇的阵营
- 锁定阵营选择（禁用阵营按钮）
- 显示提示："💡 选择神祇后，角色阵营已自动设置为神祇的阵营"
- 阵营标签旁显示"(已由神祇锁定)"

**代码实现：**
```tsx
{/* Deity Selection */}
<div>
  <label className="text-sm text-gray-400 mb-2 block">
    信仰的神祇{character.classId === "cleric" || character.classId === "paladin" ? " (推荐)" : " (可选)"}
  </label>
  <DeitySelector
    selectedDeityId={character.deityId}
    characterClass={character.classId}
    onSelect={(deity, alignment) => {
      setCharacter(prev => ({
        ...prev,
        deityId: deity?.id || "",
        alignment: deity ? alignment : prev.alignment
      }));
    }}
  />
  {character.deityId && (
    <p className="text-xs text-gray-500 mt-2">
      💡 选择神祇后，角色阵营已自动设置为神祇的阵营
    </p>
  )}
</div>
```

**阵营锁定逻辑：**
```tsx
{/* Alignment */}
<div>
  <label className="text-sm text-gray-400 mb-2 block">
    阵营 *
    {character.deityId && (
      <span className="text-xs text-amber-400 ml-2">
        (已由神祇锁定)
      </span>
    )}
  </label>
  <div className="grid grid-cols-3 gap-2">
    {ALIGNMENTS.map(alignment => (
      <button
        key={alignment.id}
        disabled={!!character.deityId}
        className={`p-3 rounded border-2 transition-all text-left ${
          character.alignment === alignment.id
            ? "border-amber-400 bg-amber-400/10"
            : "border-gray-700 hover:border-gray-600"
        } ${character.deityId ? "opacity-50 cursor-not-allowed" : ""}`}
        onClick={() => !character.deityId && setCharacter(prev => ({ ...prev, alignment: alignment.id }))}
      >
        {/* ... */}
      </button>
    ))}
  </div>
</div>
```

### 2. 完善必填项验证

**位置：** `frontend/app/components/character/CharacterCreationWizardV2.tsx`

**验证规则：**
1. **角色名称** - 不能为空或仅包含空格
2. **阵营** - 必须选择一个阵营
3. **背景** - 必须选择一个背景

**验证函数：**
```typescript
const getStepValidationError = (): string => {
  switch (currentStep) {
    case 5: // Character Description
      if (!character.name || character.name.trim() === "") {
        return "请输入角色名称";
      }
      if (!character.alignment) {
        return "请选择阵营";
      }
      if (!character.backgroundId) {
        return "请选择背景";
      }
      return "";
    default:
      return "";
  }
};
```

**下一步按钮逻辑：**
```typescript
const nextStep = () => {
  const error = getStepValidationError();
  if (error) {
    alert(error);
    return;
  }

  setCurrentStep((s) => {
    const next = Math.min(6, s + 1);
    setVisitedSteps((prev) => new Set(prev).add(next));
    return next;
  });
};
```

**用户体验：**
- 点击"下一步"时，如果有必填项未填写，弹出`alert()`提示
- 停留在当前步骤，不进入下一步
- 用户可以看到具体缺少哪个必填项

### 3. 修复初始阵营默认值

**问题：**
- 之前初始阵营设置为`"N"`（绝对中立）
- 即使用户没有手动选择，验证也会通过

**修复：**
```typescript
const initialCharacterState: CharacterState = {
  // ...
  alignment: "", // Empty string to force user selection
  // ...
};
```

**效果：**
- 强制用户必须选择阵营
- 或者通过选择神祇自动设置阵营

## 技术亮点

### 1. 神祇与阵营联动

- 选择神祇后，阵营自动设置为神祇的阵营
- 阵营按钮被禁用，防止用户修改
- 清除神祇选择后，阵营恢复可编辑状态

### 2. 职业相关的神祇推荐

- `DeitySelector`组件根据职业推荐合适的神祇
- 牧师：推荐善良/中立阵营且拥有生命、光明或知识领域的神祇
- 圣武士：推荐守序善良和善良阵营的神祇
- 其他职业：所有神祇可选，无特殊推荐

### 3. 渐进式验证

- 只在用户点击"下一步"时验证
- 不在用户输入时实时验证（避免干扰）
- 验证失败时提供明确的错误提示

### 4. 符合D&D 5E规则

- 神祇选择对所有职业都是可选的
- 牧师和圣武士可以信仰理念而非特定神祇
- 神祇的阵营会影响角色的阵营选择

## 修改的文件

### 1. `frontend/app/components/character/Step5CharacterDescription.tsx`

**修改内容：**
- 添加`DeitySelector`组件导入
- 在UI中添加神祇选择字段（位于阵营之前）
- 阵营选择在有神祇时被禁用
- 显示神祇锁定提示

**修改行数：** 约60行（添加神祇选择UI + 阵营锁定逻辑）

### 2. `frontend/app/components/character/CharacterCreationWizardV2.tsx`

**修改内容：**
- 添加`getStepValidationError()`函数（验证Step 5的必填项）
- 修改`nextStep()`函数，调用验证并显示错误
- 修改初始阵营从`"N"`改为`""`

**修改行数：** 约30行（添加验证逻辑 + 修改初始值）

## 用户体验改进

### 之前的问题

❌ 神祇选择功能缺失  
❌ 必填项未填写也能进入下一步  
❌ 用户不知道缺少哪些必填项  
❌ 阵营有默认值，用户可能忘记选择  

### 现在的优势

✅ 神祇选择功能完整，支持搜索和筛选  
✅ 必填项验证生效，阻止进入下一步  
✅ 明确提示缺少哪个必填项  
✅ 阵营必须手动选择或通过神祇自动设置  
✅ 神祇选择后阵营自动锁定，避免冲突  

## 测试场景

### 场景1：神祇选择功能

1. 打开角色创建向导
2. 完成前4步，进入Step 5
3. 点击"信仰的神祇"选择按钮
4. 在弹出的对话框中选择一个神祇
5. 验证阵营自动设置为神祇的阵营
6. 验证阵营按钮被禁用

**预期结果：** ✅ 神祇选择成功，阵营自动设置并锁定

### 场景2：缺少角色名称

1. 不填写"角色名称"
2. 选择阵营和背景
3. 点击"下一步"

**预期结果：** ✅ 弹出`alert("请输入角色名称")`，停留在Step 5

### 场景3：缺少阵营

1. 填写"角色名称"
2. 不选择阵营（保持空）
3. 选择背景
4. 点击"下一步"

**预期结果：** ✅ 弹出`alert("请选择阵营")`，停留在Step 5

### 场景4：缺少背景

1. 填写"角色名称"
2. 选择阵营
3. 不选择背景（保持"-- 选择背景 --"）
4. 点击"下一步"

**预期结果：** ✅ 弹出`alert("请选择背景")`，停留在Step 5

### 场景5：所有必填项填写完整

1. 填写"角色名称"
2. 选择阵营
3. 选择背景
4. 点击"下一步"

**预期结果：** ✅ 成功进入Step 6（审核完成）

## 后续改进建议

### 1. 更友好的错误提示

- 使用Radix UI的Toast或Dialog替代`alert()`
- 在必填项旁边显示红色星号或错误提示
- 高亮未填写的必填项

### 2. 实时验证提示

- 在用户离开输入框时验证
- 在输入框下方显示错误提示
- 不阻止用户继续填写其他字段

### 3. 神祇详情展示

- 在选择神祇后，显示神祇的详细信息
- 包括神祇的描述、领域、信徒等
- 帮助用户更好地理解角色的信仰背景

### 4. 背景技能冲突检测

- 检测背景技能是否与职业技能重复
- 如果重复，允许用户选择替代技能
- 符合D&D 5E规则

## 总结

本次修复完成了以下工作：

1. **恢复神祇选择功能** - 在Step 5中添加了完整的神祇选择界面
2. **实现阵营联动** - 选择神祇后自动设置并锁定阵营
3. **完善必填项验证** - 验证角色名称、阵营、背景三个必填项
4. **修复初始值问题** - 阵营初始值改为空字符串，强制用户选择

**实现状态：✅ 完成**  
**测试状态：⏳ 待测试**  
**文档状态：✅ 完成**

所有修改符合D&D 5E规则，提升了用户体验，确保角色创建流程的完整性和正确性。

