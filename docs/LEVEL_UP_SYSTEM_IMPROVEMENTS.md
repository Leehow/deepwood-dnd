# 升级系统改进计划

> 生成时间：2025-01-20
> 项目：D&D 5E Platform
> 目标：统一架构、补全功能、优化用户体验

---

## 📋 目录

1. [架构统一](#1-架构统一-高优先级)
2. [功能补全](#2-功能补全-中优先级)
3. [用户体验优化](#3-用户体验优化-低优先级)
4. [代码质量改进](#4-代码质量改进)
5. [测试计划](#5-测试计划)

---

## 1. 架构统一 (高优先级)

### 1.1 移除 WebSocket 升级 Handler

**问题描述：**
- 当前有两套升级逻辑：HTTP API 和 WebSocket Handler
- HTTP API 功能完整（330行），WebSocket Handler 功能简化（100行）
- 导致功能不一致、维护困难、代码重复

**解决方案：**
采用 CQRS 模式：**命令用 HTTP，通知用 WebSocket**

#### 1.1.1 删除 WebSocket Handler

```bash
# 删除文件
rm backend/app/services/websocket_handlers/level_up_handler.py

# 从 __init__.py 移除导入
# 文件：backend/app/services/websocket_handlers/__init__.py
```

**修改前：**
```python
from .level_up_handler import LevelUpHandler

__all__ = [
    'MessageHandler',
    'HandlerRegistry',
    'registry',
    'ChatHandler',
    'MapHandler',
    'FogHandler',
    'RulerHandler',
    'DrawingHandler',
    'DiceHandler',
    'RestHandler',
    'LevelUpHandler',  # ❌ 删除
    'RewardHandler',
]
```

**修改后：**
```python
# 移除 LevelUpHandler 相关的所有引用
__all__ = [
    'MessageHandler',
    'HandlerRegistry',
    'registry',
    'ChatHandler',
    'MapHandler',
    'FogHandler',
    'RulerHandler',
    'DrawingHandler',
    'DiceHandler',
    'RestHandler',
    # 'LevelUpHandler',  # 已删除
    'RewardHandler',
]
```

#### 1.1.2 从 WebSocket 路由移除注册

**文件：** `backend/app/api/routes/websocket_simplified.py`

**修改前：**
```python
def register_handlers():
    """Register all message handlers"""
    # ... 其他handlers ...

    # Level up handler
    level_up_handler = LevelUpHandler()
    registry.register('level_up', level_up_handler)

    # Reward handler
    reward_handler = RewardHandler()
    registry.register('reward_grant', reward_handler)
```

**修改后：**
```python
def register_handlers():
    """Register all message handlers"""
    # ... 其他handlers ...

    # ❌ 移除 Level up handler
    # 升级操作统一使用 HTTP API: POST /api/characters/{id}/level-up
    # WebSocket 只用于广播升级通知: character_level_up

    # Reward handler
    reward_handler = RewardHandler()
    registry.register('reward_grant', reward_handler)
```

#### 1.1.3 确认 HTTP API 正常广播

**文件：** `backend/app/api/routes/characters.py:1189-1209`

**当前代码（无需修改）：**
```python
@router.post("/{character_id}/level-up", response_model=CharacterResponse)
async def level_up_character(
    character_id: int,
    req: LevelUpRequest,
    db: AsyncSession = Depends(get_db),
):
    # ... 业务逻辑 ...

    await db.commit()
    await db.refresh(character)

    # ✅ 已有广播逻辑，无需修改
    # Broadcast level up to all campaigns where this character has tokens
    tokens_result = await db.execute(
        select(Token.campaign_id).where(Token.character_id == character_id).distinct()
    )
    campaign_ids = [row[0] for row in tokens_result.fetchall()]

    for campaign_id in campaign_ids:
        await manager.broadcast_to_campaign(
            {
                "type": "character_level_up",
                "campaign_id": campaign_id,
                "data": {
                    "character_id": character_id,
                    "character_name": character.name,
                    "new_level": new_level,
                    "class_choice": req.class_choice,
                    "multiclass_data": multiclass_data,
                }
            },
            str(campaign_id),
        )

    return character
```

#### 1.1.4 检查并更新前端调用

**需要检查的文件：**
```bash
# 搜索前端是否还在使用 WebSocket level_up
grep -r "type.*['\"]level_up['\"]" frontend/app/
grep -r "level.up" frontend/app/ --include="*.tsx" --include="*.ts"
```

**如果发现 WebSocket 调用，改为：**

**修改前（错误）：**
```typescript
// ❌ 不要通过 WebSocket 发送命令
ws.send(JSON.stringify({
  type: 'level_up',
  campaign_id: campaignId,
  data: {
    character_id: characterId,
    new_level: newLevel,
    class_choice: classChoice
  }
}));
```

**修改后（正确）：**
```typescript
// ✅ 使用 HTTP API
const response = await fetch(`/api/characters/${characterId}/level-up`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify({
    class_choice: classChoice,
    feature_choices: featureChoices
  })
});

if (!response.ok) {
  const error = await response.json();
  throw new Error(error.detail || 'Level up failed');
}

const updatedCharacter = await response.json();
```

**WebSocket 只用于接收通知：**
```typescript
// ✅ 监听升级通知
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);

  if (message.type === 'character_level_up') {
    // 其他玩家的角色升级了，刷新角色列表
    if (message.data.character_id !== myCharacterId) {
      refetchCharacters();
    }
    // 显示通知
    toast.success(`${message.data.character_name} 升级到了 ${message.data.new_level} 级！`);
  }
};
```

---

## 2. 功能补全 (中优先级)

### 2.1 DM 发放经验值和金币 UI

**问题：**
- 后端 RewardHandler 已实现
- 前端缺少 DM 发放奖励的界面

**解决方案：**
创建 `RewardPanel.tsx` 组件

#### 2.1.1 创建 RewardPanel 组件

**新建文件：** `frontend/app/components/dm/RewardPanel.tsx`

```typescript
import { useState } from 'react';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { Select } from '~/components/ui/select';
import { Checkbox } from '~/components/ui/checkbox';
import { Card } from '~/components/ui/card';

interface Character {
  id: number;
  name: string;
  user_id: string;
}

interface RewardPanelProps {
  campaignId: string;
  characters: Character[];
  sendWebSocketMessage: (type: string, data: any) => void;
}

type RewardType = 'xp' | 'currency';
type XPSource = 'Combat' | 'Quest' | 'Roleplay' | 'Exploration' | 'Puzzle' | 'Social' | 'Manual';

export function RewardPanel({ campaignId, characters, sendWebSocketMessage }: RewardPanelProps) {
  const [rewardType, setRewardType] = useState<RewardType>('xp');
  const [selectedCharacters, setSelectedCharacters] = useState<number[]>([]);
  const [xpAmount, setXpAmount] = useState<number>(0);
  const [xpSource, setXpSource] = useState<XPSource>('Combat');
  const [currency, setCurrency] = useState({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 });
  const [description, setDescription] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);

  const handleSubmit = () => {
    if (selectedCharacters.length === 0) {
      alert('请至少选择一个角色');
      return;
    }

    const data: any = {
      reward_type: rewardType,
      recipients: selectedCharacters,
      description,
      is_private: isPrivate
    };

    if (rewardType === 'xp') {
      if (xpAmount <= 0) {
        alert('请输入有效的经验值');
        return;
      }
      data.amount = xpAmount;
      data.source = xpSource;
    } else {
      // Currency reward
      const hasNonZero = Object.values(currency).some(v => v !== 0);
      if (!hasNonZero) {
        alert('请至少输入一种货币数量');
        return;
      }
      data.currency_changes = currency;
      data.source = 'Loot';
    }

    sendWebSocketMessage('reward_grant', data);

    // Reset form
    setSelectedCharacters([]);
    setXpAmount(0);
    setCurrency({ cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 });
    setDescription('');
  };

  const toggleCharacter = (characterId: number) => {
    setSelectedCharacters(prev =>
      prev.includes(characterId)
        ? prev.filter(id => id !== characterId)
        : [...prev, characterId]
    );
  };

  const selectAll = () => {
    setSelectedCharacters(characters.map(c => c.id));
  };

  const deselectAll = () => {
    setSelectedCharacters([]);
  };

  return (
    <Card className="p-6 space-y-4">
      <h3 className="text-xl font-bold">发放奖励</h3>

      {/* Reward Type Selection */}
      <div className="space-y-2">
        <Label>奖励类型</Label>
        <div className="flex gap-4">
          <Button
            variant={rewardType === 'xp' ? 'default' : 'outline'}
            onClick={() => setRewardType('xp')}
          >
            ⚡ 经验值
          </Button>
          <Button
            variant={rewardType === 'currency' ? 'default' : 'outline'}
            onClick={() => setRewardType('currency')}
          >
            💰 金币
          </Button>
        </div>
      </div>

      {/* Character Selection */}
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <Label>选择角色</Label>
          <div className="space-x-2">
            <Button size="sm" variant="ghost" onClick={selectAll}>全选</Button>
            <Button size="sm" variant="ghost" onClick={deselectAll}>清空</Button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto border rounded p-2">
          {characters.map(char => (
            <label key={char.id} className="flex items-center space-x-2 cursor-pointer">
              <Checkbox
                checked={selectedCharacters.includes(char.id)}
                onCheckedChange={() => toggleCharacter(char.id)}
              />
              <span>{char.name}</span>
            </label>
          ))}
        </div>
        <p className="text-sm text-gray-500">
          已选择 {selectedCharacters.length} / {characters.length} 个角色
        </p>
      </div>

      {/* XP Amount */}
      {rewardType === 'xp' && (
        <>
          <div className="space-y-2">
            <Label htmlFor="xp-amount">经验值数量</Label>
            <Input
              id="xp-amount"
              type="number"
              min="0"
              value={xpAmount}
              onChange={(e) => setXpAmount(Number(e.target.value))}
              placeholder="例如：300"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="xp-source">来源</Label>
            <Select
              id="xp-source"
              value={xpSource}
              onValueChange={(value) => setXpSource(value as XPSource)}
            >
              <option value="Combat">战斗</option>
              <option value="Quest">任务</option>
              <option value="Roleplay">角色扮演</option>
              <option value="Exploration">探索</option>
              <option value="Puzzle">谜题</option>
              <option value="Social">社交</option>
              <option value="Manual">手动</option>
            </Select>
          </div>
        </>
      )}

      {/* Currency Amount */}
      {rewardType === 'currency' && (
        <div className="space-y-2">
          <Label>货币数量</Label>
          <div className="grid grid-cols-5 gap-2">
            {(['cp', 'sp', 'ep', 'gp', 'pp'] as const).map(type => (
              <div key={type}>
                <Label htmlFor={`currency-${type}`} className="text-xs uppercase">
                  {type}
                </Label>
                <Input
                  id={`currency-${type}`}
                  type="number"
                  value={currency[type]}
                  onChange={(e) => setCurrency(prev => ({ ...prev, [type]: Number(e.target.value) }))}
                  placeholder="0"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Description */}
      <div className="space-y-2">
        <Label htmlFor="description">描述（可选）</Label>
        <Input
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="例如：击败哥布林首领"
        />
      </div>

      {/* Private Checkbox */}
      <label className="flex items-center space-x-2 cursor-pointer">
        <Checkbox
          checked={isPrivate}
          onCheckedChange={(checked) => setIsPrivate(checked as boolean)}
        />
        <span className="text-sm">🔒 私密奖励（只有DM和接收者可见）</span>
      </label>

      {/* Submit Button */}
      <Button onClick={handleSubmit} className="w-full">
        {rewardType === 'xp' ? '⚡ 发放经验值' : '💰 发放金币'}
      </Button>
    </Card>
  );
}
```

#### 2.1.2 集成到 DM 界面

**文件：** `frontend/app/routes/campaigns.$id.tsx` (或 DM 面板)

```typescript
import { RewardPanel } from '~/components/dm/RewardPanel';

export default function CampaignPage() {
  // ... 现有代码 ...

  // 在 DM 视图中添加
  {role === 'dm' && (
    <Tabs>
      <TabsList>
        <TabsTrigger value="map">地图</TabsTrigger>
        <TabsTrigger value="rewards">奖励</TabsTrigger>
        <TabsTrigger value="npcs">NPC</TabsTrigger>
      </TabsList>

      <TabsContent value="rewards">
        <RewardPanel
          campaignId={campaignId}
          characters={campaignCharacters}
          sendWebSocketMessage={(type, data) => {
            if (wsRef.current?.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({
                type,
                campaign_id: campaignId,
                data
              }));
            }
          }}
        />
      </TabsContent>
    </Tabs>
  )}
}
```

### 2.2 奖励和升级历史查看

**问题：**
- 后端有 `reward_history` 表和 `level_history` 字段
- 前端无法查看历史记录

**解决方案：**

#### 2.2.1 添加历史查询 API

**文件：** `backend/app/api/routes/characters.py`

```python
@router.get("/{character_id}/level-history", response_model=List[Dict])
async def get_level_history(
    character_id: int,
    db: AsyncSession = Depends(get_db)
):
    """Get character level up history"""
    result = await db.execute(
        select(Character).where(Character.id == character_id)
    )
    character = result.scalar_one_or_none()

    if not character:
        raise HTTPException(status_code=404, detail="Character not found")

    return character.level_history or []


@router.get("/{character_id}/reward-history", response_model=List[Dict])
async def get_reward_history(
    character_id: int,
    db: AsyncSession = Depends(get_db)
):
    """Get character reward history"""
    from app.models.reward_history import RewardHistory

    result = await db.execute(
        select(RewardHistory)
        .where(RewardHistory.character_id == character_id)
        .order_by(RewardHistory.created_at.desc())
    )
    rewards = result.scalars().all()

    return [
        {
            "id": r.id,
            "reward_type": r.reward_type,
            "xp_amount": r.xp_amount,
            "xp_source": r.xp_source,
            "currency_changes": r.currency_changes,
            "currency_source": r.currency_source,
            "description": r.description,
            "is_private": r.is_private,
            "awarded_by": r.awarded_by,
            "created_at": r.created_at.isoformat()
        }
        for r in rewards
    ]
```

#### 2.2.2 创建历史查看组件

**新建文件：** `frontend/app/components/character/CharacterHistory.tsx`

```typescript
import { useEffect, useState } from 'react';
import { Card } from '~/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '~/components/ui/tabs';

interface LevelHistoryEntry {
  level: number;
  class_id: string;
  subclass_id?: string;
  timestamp: string;
  feature_choices?: any;
}

interface RewardHistoryEntry {
  id: number;
  reward_type: 'xp' | 'currency';
  xp_amount?: number;
  xp_source?: string;
  currency_changes?: Record<string, number>;
  currency_source?: string;
  description?: string;
  created_at: string;
}

export function CharacterHistory({ characterId }: { characterId: number }) {
  const [levelHistory, setLevelHistory] = useState<LevelHistoryEntry[]>([]);
  const [rewardHistory, setRewardHistory] = useState<RewardHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchHistory = async () => {
      try {
        const [levelRes, rewardRes] = await Promise.all([
          fetch(`/api/characters/${characterId}/level-history`),
          fetch(`/api/characters/${characterId}/reward-history`)
        ]);

        setLevelHistory(await levelRes.json());
        setRewardHistory(await rewardRes.json());
      } catch (error) {
        console.error('Failed to fetch history:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchHistory();
  }, [characterId]);

  if (loading) return <div>加载中...</div>;

  return (
    <Card className="p-4">
      <Tabs defaultValue="level">
        <TabsList>
          <TabsTrigger value="level">升级历史</TabsTrigger>
          <TabsTrigger value="rewards">奖励历史</TabsTrigger>
        </TabsList>

        <TabsContent value="level" className="space-y-2">
          {levelHistory.length === 0 ? (
            <p className="text-gray-500">暂无升级记录</p>
          ) : (
            levelHistory.map((entry, idx) => (
              <div key={idx} className="border-l-4 border-blue-500 pl-4 py-2">
                <div className="font-bold">等级 {entry.level}</div>
                <div className="text-sm text-gray-600">
                  职业: {entry.class_id}
                  {entry.subclass_id && ` (${entry.subclass_id})`}
                </div>
                <div className="text-xs text-gray-400">
                  {new Date(entry.timestamp).toLocaleString('zh-CN')}
                </div>
              </div>
            ))
          )}
        </TabsContent>

        <TabsContent value="rewards" className="space-y-2">
          {rewardHistory.length === 0 ? (
            <p className="text-gray-500">暂无奖励记录</p>
          ) : (
            rewardHistory.map((entry) => (
              <div
                key={entry.id}
                className={`border-l-4 pl-4 py-2 ${
                  entry.reward_type === 'xp' ? 'border-yellow-500' : 'border-green-500'
                }`}
              >
                {entry.reward_type === 'xp' ? (
                  <>
                    <div className="font-bold">⚡ +{entry.xp_amount} XP</div>
                    <div className="text-sm text-gray-600">
                      来源: {entry.xp_source}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="font-bold">💰 金币奖励</div>
                    <div className="text-sm text-gray-600">
                      {Object.entries(entry.currency_changes || {})
                        .filter(([_, amt]) => amt !== 0)
                        .map(([type, amt]) => `${amt > 0 ? '+' : ''}${amt}${type}`)
                        .join(', ')}
                    </div>
                  </>
                )}
                {entry.description && (
                  <div className="text-sm italic">{entry.description}</div>
                )}
                <div className="text-xs text-gray-400">
                  {new Date(entry.created_at).toLocaleString('zh-CN')}
                </div>
              </div>
            ))
          )}
        </TabsContent>
      </Tabs>
    </Card>
  );
}
```

#### 2.2.3 集成到角色面板

**文件：** `frontend/app/components/character/CharacterPanel.tsx`

```typescript
import { CharacterHistory } from './CharacterHistory';

export function CharacterPanel({ character }) {
  return (
    <Tabs>
      <TabsList>
        <TabsTrigger value="stats">属性</TabsTrigger>
        <TabsTrigger value="spells">法术</TabsTrigger>
        <TabsTrigger value="history">历史</TabsTrigger>
      </TabsList>

      <TabsContent value="history">
        <CharacterHistory characterId={character.id} />
      </TabsContent>
    </Tabs>
  );
}
```

### 2.3 等级回滚功能前端

**问题：**
- 后端有 `POST /{id}/level-down` 和 `POST /{id}/reset-to-level-one`
- 前端未暴露这些功能

**解决方案：**

**文件：** `frontend/app/components/character/CharacterActions.tsx`

```typescript
export function CharacterActions({ character, onUpdate }) {
  const [showConfirm, setShowConfirm] = useState(false);

  const handleLevelDown = async () => {
    if (!confirm(`确认将 ${character.name} 降级到 ${character.level - 1} 级吗？`)) {
      return;
    }

    try {
      const response = await fetch(`/api/characters/${character.id}/level-down`, {
        method: 'POST',
      });

      if (!response.ok) throw new Error('Level down failed');

      const updated = await response.json();
      onUpdate(updated);
      toast.success(`${character.name} 已降级到 ${updated.level} 级`);
    } catch (error) {
      toast.error('降级失败：' + error.message);
    }
  };

  const handleResetToLevelOne = async () => {
    if (!confirm(`⚠️ 确认将 ${character.name} 重置到 1 级吗？此操作不可撤销！`)) {
      return;
    }

    try {
      const response = await fetch(`/api/characters/${character.id}/reset-to-level-one`, {
        method: 'POST',
      });

      if (!response.ok) throw new Error('Reset failed');

      const updated = await response.json();
      onUpdate(updated);
      toast.success(`${character.name} 已重置到 1 级`);
    } catch (error) {
      toast.error('重置失败：' + error.message);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon">
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onClick={handleLevelDown}>
          ⬇️ 降级 (回滚)
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleResetToLevelOne} className="text-red-600">
          ⚠️ 重置到 1 级
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

---

## 3. 用户体验优化 (低优先级)

### 3.1 升级通知优化

**当前：** 升级成功后只有 WebSocket 广播
**改进：** 添加 Toast 通知和动画效果

```typescript
// 在 EnhancedLevelUpModal 中
const handleConfirm = async (classChoice: string, featureChoices: any) => {
  try {
    const response = await fetch(`/api/characters/${character.id}/level-up`, {
      method: 'POST',
      body: JSON.stringify({ class_choice: classChoice, feature_choices: featureChoices })
    });

    if (!response.ok) throw new Error('Level up failed');

    const updated = await response.json();

    // ✅ 添加成功通知
    toast.success(
      <div>
        <div className="font-bold">🎉 升级成功！</div>
        <div>{character.name} 现在是 {updated.level} 级了！</div>
      </div>,
      { duration: 5000 }
    );

    // ✅ 触发庆祝动画
    triggerConfetti();

    onConfirm(classChoice, featureChoices);
  } catch (error) {
    toast.error('升级失败：' + error.message);
  }
};
```

### 3.2 经验值进度条

**新建组件：** `frontend/app/components/character/XPProgressBar.tsx`

```typescript
import xpThresholds from '~/data/rules/xp-thresholds.json';

export function XPProgressBar({ currentXP, level }: { currentXP: number; level: number }) {
  const currentLevelXP = xpThresholds.standard[level] || 0;
  const nextLevelXP = xpThresholds.standard[level + 1] || currentLevelXP;
  const xpInLevel = currentXP - currentLevelXP;
  const xpNeeded = nextLevelXP - currentLevelXP;
  const progress = Math.min((xpInLevel / xpNeeded) * 100, 100);

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span>经验值</span>
        <span>{currentXP} / {nextLevelXP} XP</span>
      </div>
      <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all duration-500"
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="text-xs text-gray-500">
        距离下一级还需 {nextLevelXP - currentXP} XP ({progress.toFixed(1)}%)
      </div>
    </div>
  );
}
```

### 3.3 里程碑升级模式

**问题：** `character.milestone_level` 字段未充分利用

**解决方案：**

**文件：** `backend/app/api/routes/campaigns.py`

```python
class CampaignSettings(BaseModel):
    leveling_mode: str = "xp"  # "xp" or "milestone"
    # ... 其他设置 ...

@router.patch("/{campaign_id}/settings")
async def update_campaign_settings(
    campaign_id: int,
    settings: CampaignSettings,
    db: AsyncSession = Depends(get_db)
):
    """Update campaign settings"""
    # ... 保存设置 ...
```

**前端自动升级逻辑：**

```typescript
// ProgressionManager.tsx
useEffect(() => {
  if (campaign.leveling_mode === 'milestone') {
    // 里程碑模式：使用 milestone_level
    if (character.milestone_level && character.milestone_level > character.level) {
      setPendingLevel(character.milestone_level);
      setShowLevelUpModal(true);
    }
  } else {
    // XP 模式：根据经验值计算
    const newLevel = calculateLevel(character.experience_points);
    if (newLevel > character.level) {
      setPendingLevel(newLevel);
      setShowLevelUpModal(true);
    }
  }
}, [character.experience_points, character.milestone_level, campaign.leveling_mode]);
```

---

## 4. 代码质量改进

### 4.1 错误处理增强

**文件：** `backend/app/api/routes/characters.py`

**当前问题：** 缺少详细的错误信息

**改进：**

```python
@router.post("/{character_id}/level-up", response_model=CharacterResponse)
async def level_up_character(
    character_id: int,
    req: LevelUpRequest,
    db: AsyncSession = Depends(get_db),
):
    try:
        # ... 业务逻辑 ...

        # ✅ 添加验证
        if character.level >= 20:
            raise HTTPException(
                status_code=400,
                detail="Character is already at max level (20)"
            )

        # ✅ 验证兼职需求
        if req.class_choice != character.class_id:
            # Check multiclass requirements
            requirements = multiclass_config.get(req.class_choice, {})
            for stat, min_value in requirements.items():
                if character.ability_scores.get(stat, 0) < min_value:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Multiclass requirement not met: {stat} must be at least {min_value}"
                    )

        # ... 执行升级 ...

    except HTTPException:
        raise
    except Exception as e:
        print(f"[ERROR] Level up failed: {e}")
        raise HTTPException(status_code=500, detail=f"Level up failed: {str(e)}")
```

### 4.2 日志增强

**文件：** `backend/app/api/routes/characters.py`

```python
import logging

logger = logging.getLogger(__name__)

@router.post("/{character_id}/level-up", response_model=CharacterResponse)
async def level_up_character(...):
    logger.info(f"[LevelUp] Character {character_id} attempting level up to {character.level + 1}")
    logger.debug(f"[LevelUp] Class choice: {req.class_choice}, Feature choices: {req.feature_choices}")

    # ... 业务逻辑 ...

    logger.info(f"[LevelUp] Success: {character.name} is now level {character.level}")
    return character
```

### 4.3 数据验证

**文件：** `backend/app/schemas/character_sheet.py`

```python
from pydantic import BaseModel, Field, validator

class LevelUpRequest(BaseModel):
    class_choice: str = Field(..., description="Class to level up in")
    feature_choices: Optional[Dict[str, Any]] = Field(None, description="Feature selections")

    @validator('class_choice')
    def validate_class(cls, v):
        valid_classes = ['barbarian', 'bard', 'cleric', 'druid', 'fighter',
                        'monk', 'paladin', 'ranger', 'rogue', 'sorcerer',
                        'warlock', 'wizard']
        if v not in valid_classes:
            raise ValueError(f'Invalid class: {v}')
        return v

    @validator('feature_choices')
    def validate_features(cls, v):
        if v is None:
            return v

        # Validate structure
        allowed_keys = ['subclass', 'spells', 'cantrips', 'expertise',
                       'fighting_style', 'invocations', 'asi']
        for key in v.keys():
            if key not in allowed_keys:
                raise ValueError(f'Unknown feature choice: {key}')

        return v
```

---

## 5. 测试计划

### 5.1 单元测试

**新建文件：** `backend/tests/test_level_up.py`

```python
import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

@pytest.mark.asyncio
async def test_level_up_success(client: AsyncClient, test_character, test_db: AsyncSession):
    """Test successful level up"""
    response = await client.post(
        f"/api/characters/{test_character.id}/level-up",
        json={
            "class_choice": "fighter",
            "feature_choices": {
                "asi": {"strength": 1, "constitution": 1}
            }
        }
    )

    assert response.status_code == 200
    data = response.json()
    assert data["level"] == test_character.level + 1
    assert data["ability_scores"]["strength"] == test_character.ability_scores["strength"] + 1


@pytest.mark.asyncio
async def test_level_up_multiclass(client: AsyncClient, test_character, test_db: AsyncSession):
    """Test multiclassing"""
    # Set up character with sufficient ability scores
    test_character.ability_scores = {
        "strength": 15,
        "dexterity": 13,
        "constitution": 14,
        "intelligence": 10,
        "wisdom": 12,
        "charisma": 8
    }
    await test_db.commit()

    response = await client.post(
        f"/api/characters/{test_character.id}/level-up",
        json={
            "class_choice": "rogue",  # Different from current class
            "feature_choices": {
                "expertise": ["stealth", "sleight_of_hand"]
            }
        }
    )

    assert response.status_code == 200
    data = response.json()
    assert len(data["multiclass_data"]["classes"]) == 2


@pytest.mark.asyncio
async def test_level_up_max_level(client: AsyncClient, test_character, test_db: AsyncSession):
    """Test level up at max level"""
    test_character.level = 20
    await test_db.commit()

    response = await client.post(
        f"/api/characters/{test_character.id}/level-up",
        json={"class_choice": "fighter"}
    )

    assert response.status_code == 400
    assert "max level" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_level_down(client: AsyncClient, test_character, test_db: AsyncSession):
    """Test level down (rollback)"""
    # First level up
    await client.post(
        f"/api/characters/{test_character.id}/level-up",
        json={"class_choice": "fighter"}
    )

    # Then level down
    response = await client.post(
        f"/api/characters/{test_character.id}/level-down"
    )

    assert response.status_code == 200
    data = response.json()
    assert data["level"] == test_character.level  # Back to original
```

### 5.2 集成测试

**新建文件：** `backend/tests/test_reward_system.py`

```python
import pytest
from httpx import AsyncClient

@pytest.mark.asyncio
async def test_xp_reward_flow(client: AsyncClient, test_campaign, test_character, websocket_client):
    """Test XP reward through WebSocket"""
    # DM grants XP
    await websocket_client.send_json({
        "type": "reward_grant",
        "campaign_id": test_campaign.id,
        "data": {
            "reward_type": "xp",
            "recipients": [test_character.id],
            "amount": 300,
            "source": "Combat",
            "description": "Defeated goblin",
            "is_private": False
        }
    })

    # Should receive broadcast
    message = await websocket_client.receive_json()
    assert message["type"] == "reward_update"
    assert message["data"]["characters"][0]["xp_gained"] == 300

    # Verify character XP updated
    response = await client.get(f"/api/characters/{test_character.id}")
    data = response.json()
    assert data["experience_points"] == 300


@pytest.mark.asyncio
async def test_auto_level_up_on_xp(client: AsyncClient, test_character):
    """Test that XP triggers level up modal in frontend"""
    # Grant enough XP to level up (300 for level 2)
    test_character.experience_points = 0

    # Grant 300 XP
    # ... (WebSocket grant) ...

    # Frontend should detect level up
    new_level = calculate_level(300)
    assert new_level == 2
```

### 5.3 E2E 测试 (Playwright)

**新建文件：** `tests/e2e/level-up.spec.ts`

```typescript
import { test, expect } from '@playwright/test';

test.describe('Level Up Flow', () => {
  test('DM grants XP and player levels up', async ({ page, context }) => {
    // Login as DM
    await page.goto('/login');
    await page.fill('[name="email"]', 'dm@test.com');
    await page.fill('[name="password"]', 'password');
    await page.click('button[type="submit"]');

    // Go to campaign
    await page.goto('/campaigns/1');

    // Open reward panel
    await page.click('text=奖励');

    // Grant XP
    await page.click('text=⚡ 经验值');
    await page.check('text=TestCharacter'); // Select character
    await page.fill('[id="xp-amount"]', '300');
    await page.selectOption('[id="xp-source"]', 'Combat');
    await page.click('text=发放经验值');

    // Open player page in new tab
    const playerPage = await context.newPage();
    await playerPage.goto('/characters/1');

    // Wait for level up modal
    await playerPage.waitForSelector('text=升级', { timeout: 5000 });

    // Verify modal shows correct info
    await expect(playerPage.locator('text=升级到 2 级')).toBeVisible();

    // Select class and features
    await playerPage.click('text=战士 (Fighter)');
    await playerPage.click('text=下一步');

    // Confirm level up
    await playerPage.click('text=确认升级');

    // Verify success
    await expect(playerPage.locator('text=等级: 2')).toBeVisible();
  });
});
```

---

## 📅 实施优先级和时间估算

| 任务 | 优先级 | 预估时间 | 依赖 |
|------|--------|----------|------|
| 1.1 移除WebSocket Handler | 🔴 高 | 2小时 | 无 |
| 2.1 DM发放奖励UI | 🟡 中 | 4小时 | 1.1完成 |
| 2.2 历史查看功能 | 🟡 中 | 3小时 | 无 |
| 2.3 等级回滚UI | 🟡 中 | 2小时 | 无 |
| 3.1 升级通知优化 | 🟢 低 | 1小时 | 无 |
| 3.2 经验值进度条 | 🟢 低 | 1小时 | 无 |
| 3.3 里程碑模式 | 🟢 低 | 2小时 | 无 |
| 4.1-4.3 代码质量 | 🟡 中 | 3小时 | 无 |
| 5.1-5.3 测试 | 🟡 中 | 4小时 | 所有功能 |

**总计：** 约22小时（3个工作日）

---

## 🚀 实施顺序建议

### 第一天：架构统一
1. ✅ 检查前端WebSocket调用
2. ✅ 移除WebSocket Level Up Handler
3. ✅ 确认HTTP API广播正常
4. ✅ 更新文档

### 第二天：功能补全
1. ✅ 实现DM奖励面板
2. ✅ 添加历史查询API
3. ✅ 实现历史查看组件
4. ✅ 添加等级回滚UI

### 第三天：优化和测试
1. ✅ 添加进度条和通知
2. ✅ 增强错误处理
3. ✅ 编写单元测试
4. ✅ 执行E2E测试
5. ✅ 更新文档

---

## 📝 检查清单

完成后请确认：

- [ ] WebSocket不再处理level_up命令
- [ ] HTTP API正常工作且广播通知
- [ ] DM可以发放XP和金币
- [ ] 玩家可以查看历史记录
- [ ] 等级回滚功能正常
- [ ] 所有测试通过
- [ ] 文档已更新（CLAUDE.md）
- [ ] 代码已review
- [ ] 已创建git commit

---

## 📚 相关文档

- [WebSocket架构文档](./CLAUDE.md#websocket-real-time-system)
- [数据库模型文档](./backend/app/models/README.md)
- [API文档](./backend/app/api/README.md)

---

**生成时间：** 2025-01-20
**最后更新：** -
**负责人：** Claude Code
**审核人：** 待定
