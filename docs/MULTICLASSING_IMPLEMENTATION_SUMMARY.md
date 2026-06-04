# 兼职系统实施总结

## 已完成的实施

### 1. 数据库层 ✅
- **迁移文件**: `backend/alembic/versions/add_multiclass_support.py`
  - 添加 `multiclass_data` JSON 字段到 characters 表
  - 自动迁移现有角色数据到新格式

### 2. 前端配置 ✅
- **兼职要求配置**: `frontend/app/data/rules/multiclass-requirements.json`
  - D&D 5E 标准属性要求
  - 职业中文名映射
  - Hit Dice 配置

### 3. 前端Hooks ✅
- **useMulticlass Hook**: `frontend/app/hooks/useMulticlass.ts`
  - 兼职数据管理
  - 属性要求验证
  - 职业显示格式化
  - 获取可用兼职选项

### 4. 前端组件 ✅
- **LevelUpModal**: `frontend/app/components/character/LevelUpModal.tsx`
  - 升级职业选择界面
  - 现有职业/兼职选项展示
  - 属性要求提示
  - 升级预览

- **ProgressionManager**: `frontend/app/components/character/ProgressionManager.tsx`
  - 监听XP变化
  - 自动检测升级
  - 触发升级模态框

- **CharacterDisplay 更新**:
  - 集成 useMulticlass hook
  - 显示兼职组合（如"战士4/游荡者2"）
  - 紫色高亮兼职角色

### 5. 后端Handler ✅
- **LevelUpHandler**: `backend/app/services/websocket_handlers/level_up_handler.py`
  - 处理 level_up WebSocket 消息
  - 更新 multiclass_data
  - 权限验证（角色拥有者或DM）
  - 广播升级通知

### 6. Handler 注册 ✅
- 在 `websocket_handlers/__init__.py` 导出 LevelUpHandler
- 在 `websocket_simplified.py` 注册 'level_up' 消息类型

## 使用方法

### 1. 运行数据库迁移
```bash
cd backend
# 首先设置 down_revision 为最新的 revision ID
# 编辑 alembic/versions/add_multiclass_support.py
# 然后运行迁移
alembic upgrade head
```

### 2. 集成到角色面板
在你的角色面板组件中添加 ProgressionManager：

```typescript
import { ProgressionManager } from '~/components/character/ProgressionManager';
import { useWebSocket } from '~/hooks/useWebSocket';

function CharacterPanel({ character, campaignId }) {
  const { sendMessage } = useWebSocket();

  const handleLevelUp = (characterId: number, newLevel: number, classChoice: string) => {
    sendMessage({
      type: 'level_up',
      campaign_id: campaignId,
      data: {
        character_id: characterId,
        new_level: newLevel,
        class_choice: classChoice,
        timestamp: new Date().toISOString()
      }
    });
  };

  return (
    <div>
      {/* 现有的角色显示 */}
      <CharacterDisplay character={character} />

      {/* 添加升级管理器 */}
      <ProgressionManager
        character={character}
        onLevelUp={handleLevelUp}
      />
    </div>
  );
}
```

### 3. 监听升级广播
在 WebSocket 消息处理中添加：

```typescript
useWebSocket({
  campaignId,
  userId,
  role,
  onMessage: (message) => {
    if (message.type === 'character_level_up') {
      const { character_id, new_level, class_choice, multiclass_data } = message.data;

      // 更新本地角色数据
      updateCharacter(character_id, {
        level: new_level,
        multiclass_data
      });

      // 显示通知
      toast.success(`${message.data.character_name} 升级到 ${new_level} 级！`);
    }
  }
});
```

## WebSocket消息格式

### 升级请求
```json
{
  "type": "level_up",
  "campaign_id": "123",
  "data": {
    "character_id": 456,
    "new_level": 5,
    "class_choice": "rogue",
    "timestamp": "2024-01-01T00:00:00Z"
  }
}
```

### 升级广播
```json
{
  "type": "character_level_up",
  "campaign_id": "123",
  "data": {
    "character_id": 456,
    "character_name": "Aragorn",
    "new_level": 5,
    "class_choice": "rogue",
    "multiclass_data": {
      "classes": [
        {"class_id": "fighter", "level": 4, "subclass_id": "champion"},
        {"class_id": "rogue", "level": 1, "subclass_id": null}
      ],
      "level_history": [...]
    },
    "timestamp": "2024-01-01T00:00:00Z"
  }
}
```

## 数据结构

### multiclass_data 格式
```json
{
  "classes": [
    {
      "class_id": "fighter",
      "level": 4,
      "subclass_id": "champion"
    },
    {
      "class_id": "rogue",
      "level": 2,
      "subclass_id": null
    }
  ],
  "level_history": [
    {
      "level": 1,
      "class": "fighter",
      "timestamp": "2024-01-01T00:00:00Z"
    },
    {
      "level": 2,
      "class": "fighter",
      "timestamp": "2024-01-02T00:00:00Z"
    }
  ]
}
```

## 属性要求示例

- **战士**: 力量13 或 敏捷13
- **游荡者**: 敏捷13
- **法师**: 智力13
- **牧师**: 感知13
- **圣武士**: 力量13 且 魅力13
- **武僧**: 敏捷13 且 感知13

## UI 特性

### 升级模态框
- ✅ 清晰区分现有职业和可兼职选项
- ✅ 实时验证属性要求
- ✅ 升级预览显示
- ✅ 紫色高亮兼职选项
- ✅ 绿色高亮新职业

### 角色显示
- ✅ 单职业：显示为 "战士5"
- ✅ 兼职：显示为 "战士4/游荡者2"（紫色）
- ✅ 总等级始终正确计算

## 待办事项

### 短期
- [ ] 测试数据库迁移
- [ ] 测试升级流程
- [ ] 测试多职业组合
- [ ] 添加升级音效和动画

### 中期
- [ ] 实现生命值计算（基于多职业HD）
- [ ] 实现法术位计算（多施法职业）
- [ ] 添加职业特性冲突检测（如额外攻击）
- [ ] 添加熟练项管理（兼职时的受限熟练项）

### 长期
- [ ] DM配置选项（允许/禁止兼职）
- [ ] 自定义属性要求
- [ ] 兼职建议系统
- [ ] 职业组合分析工具

## 测试检查清单

- [ ] 单职业角色正常升级
- [ ] 满足属性要求可以兼职
- [ ] 不满足属性要求无法兼职
- [ ] 升级后职业显示正确
- [ ] WebSocket消息正确广播
- [ ] 多玩家同时升级无冲突
- [ ] 旧数据迁移成功

## 常见问题

### Q: 现有角色会受影响吗？
A: 不会。迁移脚本会自动将现有数据转换为 multiclass_data 格式，保持向后兼容。

### Q: 如何禁用兼职？
A: 可以在 LevelUpModal 中添加配置检查，或在 DM 设置中添加开关。

### Q: 属性不满足但玩家想兼职怎么办？
A: DM 可以通过后台 API 直接修改数据，或在前端添加"忽略要求"选项（需要权限）。

### Q: 法术位如何计算？
A: 需要额外实现多职业施法位计算规则（全施法者、半施法者、三分之一施法者）。

## 文件清单

### 后端
- `backend/alembic/versions/add_multiclass_support.py` - 数据库迁移
- `backend/app/models/character.py` - Character模型（添加multiclass_data字段）
- `backend/app/services/websocket_handlers/level_up_handler.py` - 升级处理器
- `backend/app/services/websocket_handlers/__init__.py` - 导出更新
- `backend/app/api/routes/websocket_simplified.py` - Handler注册

### 前端
- `frontend/app/data/rules/multiclass-requirements.json` - 兼职配置
- `frontend/app/hooks/useMulticlass.ts` - 兼职管理Hook
- `frontend/app/components/character/LevelUpModal.tsx` - 升级选择界面
- `frontend/app/components/character/ProgressionManager.tsx` - 升级流程管理
- `frontend/app/components/character/CharacterDisplay.tsx` - 角色显示更新

### 文档
- `docs/MULTICLASSING_SYSTEM_DESIGN.md` - 完整设计文档
- `docs/MULTICLASSING_IMPLEMENTATION_SUMMARY.md` - 本实施总结
