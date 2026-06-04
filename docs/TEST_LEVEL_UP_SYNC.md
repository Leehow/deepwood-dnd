# 实时升级同步功能测试指南

## 快速启动

### 1. 启动后端服务器
```bash
cd /Users/haoli/leehow/code/dw/backend
source venv/bin/activate
python -m uvicorn app.main:app --reload --port 8174
```

### 2. 启动前端服务器（新终端）
```bash
cd /Users/haoli/leehow/code/dw/frontend
npm run dev
```

## 测试步骤

### 测试 1: 基础升级通知

**前提条件**:
- 已创建至少一个战役
- 战役中有至少一个角色（Level < 20）

**步骤**:

1. **打开 DM 视图**
   - 浏览器 1: 打开 `http://localhost:5174/campaign/{campaign_id}/dm`
   - 确认右上角显示"已连接"（绿色）
   - 打开右侧面板的"角色"标签页

2. **打开玩家视图**（使用无痕模式或另一个浏览器）
   - 浏览器 2: 打开 `http://localhost:5174/campaign/{campaign_id}/player`

3. **玩家执行升级**
   - 在玩家视图中，点击角色卡片
   - 点击"Level Up"按钮
   - 完成升级流程（选择职业特性、技能等）
   - 点击"确认升级"

4. **观察 DM 视图**

   **预期结果** ✅:

   a) **通知弹窗出现**（右上角）:
   - 滑入动画
   - 显示角色名称
   - 显示新等级
   - 显示职业
   - 显示最大生命值
   - 显示属性值
   - 8秒后自动消失（带进度条动画）

   b) **角色列表自动更新**:
   - 角色等级数字立即更新
   - 最大生命值更新
   - 无需手动刷新页面

   c) **控制台日志**:
   ```
   [DM] Character level up received: {...}
   [CharacterPanel] Character level up received: {角色名} -> Level {新等级}
   [CharacterPanel] Complete level up data: {...}
   ```

### 测试 2: 地图 Token HP 更新

**前提条件**:
- 角色已在地图上有 token

**步骤**:

1. **DM 视图准备**
   - 确保地图上有该角色的 token
   - 注意 token 的生命值显示

2. **玩家升级角色**
   - 按照测试1的步骤升级

3. **观察 Token 变化**

   **预期结果** ✅:
   - Token 的生命值条自动更新
   - 最大生命值增加
   - 当前生命值保持或按比例调整

   **控制台日志**:
   ```
   [TacticalMap] Token HP update for character {id}: {current_hp}/{max_hp}
   [TacticalMap] Updating token {token_id} HP: {current_hp}/{max_hp}
   ```

### 测试 3: 多重通知

**步骤**:

1. 打开 DM 视图
2. 让两个玩家在10秒内分别升级
3. 观察通知

**预期结果** ✅:
- 两个通知垂直堆叠显示
- 每个通知独立倒计时
- 每个通知独立消失
- 两个角色的数据都更新

### 测试 4: 手动测试通知（调试用）

在 DM 页面的浏览器控制台执行：

```javascript
// 触发测试通知
window.dispatchEvent(new CustomEvent('characterLevelUp', {
  detail: {
    character_id: 999,
    character_name: "测试角色",
    level: 10,
    class_id: "wizard",
    max_hp: 68,
    current_hp: 68,
    ability_scores: {
      strength: 8,
      dexterity: 14,
      constitution: 16,
      intelligence: 20,
      wisdom: 12,
      charisma: 10
    },
    timestamp: new Date().toISOString()
  }
}));
```

**预期结果** ✅:
- 立即出现通知
- 显示"测试角色"升到10级
- 8秒后自动消失

### 测试 5: 手动关闭通知

**步骤**:
1. 触发升级通知
2. 点击通知右上角的 ✕ 按钮

**预期结果** ✅:
- 通知立即消失
- 不等待8秒倒计时

## 调试技巧

### 查看 WebSocket 消息

**浏览器控制台**（DM 页面）:
```javascript
// 检查 WebSocket 连接状态
// 查看顶部工具栏的连接状态指示器
// 绿色 = 已连接，红色 = 断开连接
```

### 查看后端日志

```bash
# 如果使用 dev-start.sh
tail -f logs/backend.log | grep "character_level_up"

# 或者直接查看 uvicorn 输出
# 应该看到类似：
# [WebSocket] Broadcasting character_level_up to campaign {id}
```

### 常见问题排查

#### 问题: 通知没有出现

**检查**:
1. DM 页面的 WebSocket 是否连接（查看顶部连接状态）
2. 浏览器控制台是否有错误
3. 后端是否发送了 WebSocket 消息

**解决**:
- 刷新 DM 页面重新连接 WebSocket
- 检查后端日志确认消息发送
- 检查浏览器控制台是否有 JavaScript 错误

#### 问题: 角色列表没有更新

**检查**:
1. 控制台是否有 `[CharacterPanel] Character level up received` 日志
2. 角色面板是否可见

**解决**:
- 打开角色面板（右侧栏"角色"标签）
- 手动刷新页面验证数据是否已更新

#### 问题: Token HP 没有更新

**检查**:
1. 角色是否在地图上有 token
2. 控制台是否有 `[TacticalMap] Token HP update` 日志

**解决**:
- 确保角色在当前地图上有 token
- 检查 token 是否关联了正确的 character_id

#### 问题: WebSocket 断开

**症状**:
- 连接状态显示"断开连接"（红色）
- 没有实时更新

**解决**:
1. 检查后端服务器是否运行
2. 刷新 DM 页面重新连接
3. 检查网络连接

## 性能检查

### 内存使用

打开浏览器任务管理器：
- Chrome: Shift + Esc
- 检查 DM 页面标签的内存使用
- 多次触发通知，确认没有内存泄漏

### 渲染性能

1. 打开 Chrome DevTools Performance 面板
2. 录制升级过程
3. 检查是否有长任务（> 50ms）
4. 确认动画流畅（60fps）

## 成功标准

所有以下条件都满足时，测试通过 ✅:

- [ ] 玩家升级后，DM 看到动画通知（无需刷新）
- [ ] 通知显示正确的角色名、等级、HP、属性
- [ ] 通知8秒后自动消失
- [ ] 可以手动关闭通知
- [ ] 角色列表自动更新显示新等级
- [ ] 地图 token HP 自动更新（如果 token 存在）
- [ ] 多个通知可以同时显示且不重叠
- [ ] 控制台无错误日志
- [ ] WebSocket 连接稳定

## 测试完成后

如果所有测试通过，标记 todo 为完成：
```
✅ 测试完整流程 - DONE
```

如果有问题，记录：
1. 具体的错误信息
2. 复现步骤
3. 浏览器控制台截图
4. 后端日志相关部分

## 下一步（可选）

测试完成后，可以考虑实施：
- DM 发放 XP/金币 UI
- 升级历史查看
- 角色数据变更对比视图
