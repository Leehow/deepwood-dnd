# 经验值与货币奖励系统 - 快速实施指南

## 实施顺序（推荐）

### Phase 1: 数据库基础（Day 1）
1. 创建数据库迁移文件
2. 添加experience_points和milestone_level字段到characters表
3. 创建reward_history表
4. 运行迁移并测试

### Phase 2: 后端WebSocket（Day 2）
1. 创建reward_handler.py
2. 注册handler到registry
3. 扩展websocket_manager的send_to_users方法
4. 测试WebSocket消息流

### Phase 3: 前端基础组件（Day 3-4）
1. 创建useCharacterProgression Hook
2. 实现XP进度条显示组件
3. 实现货币显示组件
4. 集成到现有角色面板

### Phase 4: DM奖励界面（Day 5-6）
1. 扩展聊天面板的发放菜单
2. 实现XPRewardModal组件
3. 实现CurrencyRewardModal组件
4. 添加快捷奖励按钮

### Phase 5: 升级系统（Day 7）
1. 实现升级检测逻辑
2. 创建LevelUpNotification组件
3. 添加升级音效和动画
4. 测试升级流程

### Phase 6: 历史记录（Day 8）
1. 实现奖励历史API
2. 创建历史记录显示组件
3. 实现分页加载
4. 添加筛选功能

### Phase 7: 测试与优化（Day 9-10）
1. 编写单元测试
2. E2E测试关键流程
3. 性能优化
4. Bug修复

## 快速启动代码片段

### 1. 数据库迁移
```bash
cd backend
alembic revision --autogenerate -m "add_xp_and_reward_system"
# 编辑生成的迁移文件，添加必要字段
alembic upgrade head
```

### 2. 最小可行的XP显示
```typescript
// 快速集成到现有CharacterPanel
const XPQuickDisplay = ({ character }) => {
  const level = Math.floor(character.experience_points / 1000) + 1; // 简化计算
  return (
    <div>
      Level {level} - {character.experience_points} XP
    </div>
  );
};
```

### 3. 快速WebSocket处理
```python
# 添加到现有websocket.py
if message_type == "reward_grant":
    # 简化处理，仅更新XP
    character_id = data.get("character_id")
    xp_amount = data.get("amount")

    # 更新数据库
    # 广播消息
    await broadcast({
        "type": "xp_update",
        "character_id": character_id,
        "xp_amount": xp_amount
    })
```

## 测试检查清单

- [ ] DM可以打开发放菜单
- [ ] XP奖励可以成功发送
- [ ] 玩家实时收到XP更新
- [ ] 等级自动计算正确
- [ ] 私密奖励只对接收者可见
- [ ] 货币奖励正确更新
- [ ] 升级通知正常显示
- [ ] 奖励历史记录正确
- [ ] 多玩家同时更新无冲突
- [ ] 断线重连后数据一致

## 常见问题解决

### Q: WebSocket消息没有广播
A: 检查reward_handler是否正确注册到registry.py

### Q: XP更新后等级没变化
A: 确保前端的calculateLevel函数正确导入和调用

### Q: 私密奖励所有人都能看到
A: 检查send_to_users方法实现和is_private标志传递

### Q: 升级通知没有显示
A: 确保监听xp_update消息并比较新旧等级

## 依赖包

### 前端新增依赖
```json
{
  "canvas-confetti": "^1.9.2",  // 升级特效
  "react-hot-toast": "^2.4.1"   // 通知提示
}
```

### 后端依赖（已有）
- SQLAlchemy
- FastAPI
- asyncio

## 配置文件更新

### 环境变量
```env
# .env
ENABLE_REWARD_SYSTEM=true
MAX_REWARD_HISTORY_DAYS=90
DEFAULT_XP_SOURCE=Manual
```

## 监控与日志

### 关键日志点
```python
logger.info(f"DM {dm_id} awarded {xp_amount} XP to {len(recipients)} characters")
logger.info(f"Character {character_id} leveled up from {old_level} to {new_level}")
logger.warning(f"Failed to award reward: {error}")
```

### 性能监控指标
- WebSocket消息延迟
- 奖励处理时间
- 数据库查询性能
- 前端渲染性能

## 下一步扩展

1. **批量奖励模板**：预设常用奖励组合
2. **自动奖励规则**：基于战斗结果自动发放
3. **奖励审计日志**：DM操作历史追踪
4. **经济平衡工具**：分析战役经济状况