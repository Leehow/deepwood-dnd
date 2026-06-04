# D&D 5E 经验值与货币奖励系统 - 详细设计文档

## 1. 系统概述

### 1.1 设计理念
- **前端主导计算**：所有等级计算、货币换算、进度追踪等复杂逻辑均在前端实现
- **后端轻量存储**：后端仅负责数据持久化和WebSocket消息广播
- **实时同步**：通过WebSocket确保所有玩家看到的数据始终一致
- **私密奖励**：支持DM向特定玩家私密发放奖励，其他玩家不可见

### 1.2 核心功能
1. **经验值系统**
   - 自动等级计算（1-20级）
   - XP/里程碑双轨升级
   - 升级通知与奖励展示
   - XP历史记录

2. **货币系统**
   - D&D 5E标准货币（铜币CP、银币SP、金币GP、铂金PP、伊莱币EP）
   - 自动汇率换算
   - 货币历史记录

3. **DM奖励工具**
   - 聊天面板快捷发放
   - 支持公开/私密发放
   - 批量/个人奖励
   - 预设奖励模板

## 2. 数据库设计

### 2.1 Character表扩展
```sql
-- 现有字段
currency JSON DEFAULT '{"cp": 0, "sp": 0, "ep": 0, "gp": 0, "pp": 0}'

-- 新增字段
experience_points INTEGER DEFAULT 0
milestone_level INTEGER DEFAULT NULL  -- 里程碑等级（覆盖计算等级）
```

### 2.2 奖励历史表
```sql
CREATE TABLE reward_history (
    id SERIAL PRIMARY KEY,
    character_id INTEGER REFERENCES characters(id) ON DELETE CASCADE,
    campaign_id INTEGER REFERENCES campaigns(id) ON DELETE CASCADE,
    reward_type VARCHAR(20) NOT NULL,  -- 'xp', 'currency'

    -- XP相关
    xp_amount INTEGER,
    xp_source VARCHAR(100),  -- 'Combat', 'Quest', 'Roleplay', 'Exploration', 'Manual'

    -- 货币相关
    currency_changes JSON,  -- {"cp": 100, "gp": -10} 正数为收入，负数为支出
    currency_source VARCHAR(100),  -- 'Loot', 'Quest', 'Trade', 'Manual', 'Shop'

    -- 通用字段
    description TEXT,
    is_private BOOLEAN DEFAULT FALSE,  -- 是否为私密奖励
    awarded_by VARCHAR(50) NOT NULL,  -- DM的user_id
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- 索引
    INDEX idx_reward_character (character_id),
    INDEX idx_reward_campaign (campaign_id),
    INDEX idx_reward_type (reward_type),
    INDEX idx_reward_created (created_at DESC)
);
```

### 2.3 奖励模板表（可选）
```sql
CREATE TABLE reward_templates (
    id SERIAL PRIMARY KEY,
    campaign_id INTEGER REFERENCES campaigns(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    reward_type VARCHAR(20) NOT NULL,  -- 'xp', 'currency', 'mixed'
    xp_amount INTEGER,
    currency_amounts JSON,  -- {"cp": 0, "sp": 0, "gp": 100}
    description TEXT,
    created_by VARCHAR(50) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

## 3. 前端实现详细设计

### 3.1 核心数据结构

#### 等级阈值配置
```typescript
// frontend/app/data/rules/xp-thresholds.json
{
  "standard": {
    "1": 0,
    "2": 300,
    "3": 900,
    "4": 2700,
    "5": 6500,
    "6": 14000,
    "7": 23000,
    "8": 34000,
    "9": 48000,
    "10": 64000,
    "11": 85000,
    "12": 100000,
    "13": 120000,
    "14": 140000,
    "15": 165000,
    "16": 195000,
    "17": 225000,
    "18": 265000,
    "19": 305000,
    "20": 355000
  }
}
```

#### 货币汇率配置
```typescript
// frontend/app/data/rules/currency.json
{
  "rates": {
    "cp": 1,     // 1 铜币 = 1 铜币
    "sp": 10,    // 1 银币 = 10 铜币
    "ep": 50,    // 1 伊莱币 = 50 铜币
    "gp": 100,   // 1 金币 = 100 铜币
    "pp": 1000   // 1 铂金 = 1000 铜币
  },
  "display_order": ["pp", "gp", "ep", "sp", "cp"],
  "colors": {
    "cp": "#8B4513",  // 铜色
    "sp": "#C0C0C0",  // 银色
    "ep": "#4169E1",  // 蓝色（伊莱币）
    "gp": "#FFD700",  // 金色
    "pp": "#E5E4E2"   // 铂金色
  }
}
```

### 3.2 核心Hooks实现

#### 等级计算Hook
```typescript
// frontend/app/hooks/useCharacterProgression.ts
import xpThresholds from '@/data/rules/xp-thresholds.json';
import currencyRates from '@/data/rules/currency.json';

interface CharacterProgression {
  // XP相关
  level: number;
  xp: number;
  nextLevelXP: number | null;
  currentLevelXP: number;
  xpProgress: number;
  xpNeeded: number;
  progressPercentage: number;
  isMaxLevel: boolean;
  useMilestone: boolean;

  // 货币相关
  currency: Currency;
  totalWealth: number;  // 以铜币计算的总财富
  formattedWealth: string;  // 格式化显示
}

export function useCharacterProgression(character: Character): CharacterProgression {
  // 计算等级
  const calculateLevel = (xp: number): number => {
    const thresholds = Object.entries(xpThresholds.standard)
      .map(([level, xpRequired]) => ({
        level: parseInt(level),
        xpRequired: xpRequired as number
      }))
      .sort((a, b) => b.xpRequired - a.xpRequired);

    for (const { level, xpRequired } of thresholds) {
      if (xp >= xpRequired) return level;
    }
    return 1;
  };

  // 计算总财富（以铜币为单位）
  const calculateTotalWealth = (currency: Currency): number => {
    return Object.entries(currency).reduce((total, [type, amount]) => {
      return total + (amount * currencyRates.rates[type]);
    }, 0);
  };

  // 格式化货币显示
  const formatCurrency = (currency: Currency): string => {
    const parts = [];
    for (const type of currencyRates.display_order) {
      if (currency[type] > 0) {
        parts.push(`${currency[type]}${type.toUpperCase()}`);
      }
    }
    return parts.join(' ') || '0CP';
  };

  const currentLevel = character.milestone_level ||
                       calculateLevel(character.experience_points || 0);
  const nextLevelXP = currentLevel < 20 ?
                      xpThresholds.standard[currentLevel + 1] : null;
  const currentLevelXP = xpThresholds.standard[currentLevel];
  const xpProgress = (character.experience_points || 0) - currentLevelXP;
  const xpNeeded = nextLevelXP ? nextLevelXP - currentLevelXP : 0;

  return {
    // XP数据
    level: currentLevel,
    xp: character.experience_points || 0,
    nextLevelXP,
    currentLevelXP,
    xpProgress,
    xpNeeded,
    progressPercentage: xpNeeded > 0 ? (xpProgress / xpNeeded) * 100 : 0,
    isMaxLevel: currentLevel >= 20,
    useMilestone: !!character.milestone_level,

    // 货币数据
    currency: character.currency || { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    totalWealth: calculateTotalWealth(character.currency || {}),
    formattedWealth: formatCurrency(character.currency || {})
  };
}
```

### 3.3 DM奖励界面组件

#### 聊天面板集成
```typescript
// frontend/app/components/ui/ChatPanel.tsx (修改)
export function ChatPanel({ isDM, campaignId, userId, currentMapUrl }: ChatPanelProps) {
  // ... existing code ...

  // 扩展发放菜单状态
  const [showGrantMenu, setShowGrantMenu] = useState(false);
  const [showRewardModal, setShowRewardModal] = useState<'xp' | 'currency' | null>(null);
  const [selectedRecipients, setSelectedRecipients] = useState<string[]>([]);

  // 发放菜单UI
  const renderGrantMenu = () => {
    if (!isDM) return null;

    return (
      <div className="relative">
        <button
          onClick={() => setShowGrantMenu(v => !v)}
          className="text-xs px-2 py-1 border border-amber-600 bg-amber-600/20 hover:bg-amber-600/30 text-amber-200 rounded flex items-center gap-1"
          title="向玩家发放奖励"
        >
          发放 ▼
        </button>

        {showGrantMenu && (
          <div className="absolute right-0 top-full mt-1 bg-gray-800 border border-gray-600 rounded shadow-xl min-w-[160px] z-20">
            {/* 休息选项 */}
            <div className="border-b border-gray-700">
              <div className="px-3 py-1 text-xs text-gray-400">休息</div>
              <button
                onClick={() => handleGrantRest('short')}
                className="block w-full px-4 py-2 text-left text-sm hover:bg-gray-700"
              >
                <span className="text-green-400">⚡</span> 短休
              </button>
              <button
                onClick={() => handleGrantRest('long')}
                className="block w-full px-4 py-2 text-left text-sm hover:bg-gray-700"
              >
                <span className="text-blue-400">🛌</span> 长休
              </button>
            </div>

            {/* 奖励选项 */}
            <div className="border-b border-gray-700">
              <div className="px-3 py-1 text-xs text-gray-400">奖励</div>
              <button
                onClick={() => {
                  setShowRewardModal('xp');
                  setShowGrantMenu(false);
                }}
                className="block w-full px-4 py-2 text-left text-sm hover:bg-gray-700"
              >
                <span className="text-purple-400">⭐</span> 经验值
              </button>
              <button
                onClick={() => {
                  setShowRewardModal('currency');
                  setShowGrantMenu(false);
                }}
                className="block w-full px-4 py-2 text-left text-sm hover:bg-gray-700"
              >
                <span className="text-yellow-400">💰</span> 货币
              </button>
            </div>

            {/* 快捷选项 */}
            <div>
              <div className="px-3 py-1 text-xs text-gray-400">快捷奖励</div>
              <button
                onClick={() => quickReward('combat_easy')}
                className="block w-full px-4 py-2 text-left text-sm hover:bg-gray-700"
              >
                简单战斗 (50 XP)
              </button>
              <button
                onClick={() => quickReward('combat_medium')}
                className="block w-full px-4 py-2 text-left text-sm hover:bg-gray-700"
              >
                中等战斗 (150 XP)
              </button>
              <button
                onClick={() => quickReward('quest_complete')}
                className="block w-full px-4 py-2 text-left text-sm hover:bg-gray-700"
              >
                任务完成 (300 XP + 50 GP)
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      {/* 现有聊天界面 */}
      {/* ... */}

      {/* 奖励模态框 */}
      {showRewardModal === 'xp' && (
        <XPRewardModal
          isOpen={true}
          onClose={() => setShowRewardModal(null)}
          campaignId={campaignId}
          characters={characters}
          members={members}
        />
      )}

      {showRewardModal === 'currency' && (
        <CurrencyRewardModal
          isOpen={true}
          onClose={() => setShowRewardModal(null)}
          campaignId={campaignId}
          characters={characters}
          members={members}
        />
      )}
    </>
  );
}
```

#### XP奖励模态框
```typescript
// frontend/app/components/rewards/XPRewardModal.tsx
import { useState } from 'react';
import { useWebSocket } from '~/hooks/useWebSocket';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/Dialog';

interface XPRewardModalProps {
  isOpen: boolean;
  onClose: () => void;
  campaignId: string;
  characters: Character[];
  members: Member[];
}

export function XPRewardModal({
  isOpen,
  onClose,
  campaignId,
  characters,
  members
}: XPRewardModalProps) {
  const { sendMessage } = useWebSocket();

  // 状态管理
  const [rewardType, setRewardType] = useState<'public' | 'private'>('public');
  const [targetType, setTargetType] = useState<'all' | 'selected'>('all');
  const [selectedCharacters, setSelectedCharacters] = useState<string[]>([]);
  const [xpAmount, setXPAmount] = useState(0);
  const [source, setSource] = useState('Combat');
  const [description, setDescription] = useState('');

  // XP计算器状态
  const [useCalculator, setUseCalculator] = useState(false);
  const [monsters, setMonsters] = useState<MonsterEntry[]>([]);
  const [partySize, setPartySize] = useState(characters.length);

  // 发送奖励
  const handleAward = () => {
    const recipients = targetType === 'all'
      ? characters.map(c => c.id)
      : selectedCharacters;

    if (recipients.length === 0) {
      toast.error('请选择至少一个角色');
      return;
    }

    if (xpAmount <= 0) {
      toast.error('请输入有效的经验值');
      return;
    }

    // 发送WebSocket消息
    sendMessage({
      type: 'reward_grant',
      campaign_id: campaignId,
      data: {
        reward_type: 'xp',
        recipients,
        amount: xpAmount,
        source,
        description,
        is_private: rewardType === 'private',
        timestamp: new Date().toISOString()
      }
    });

    // 显示确认提示
    const recipientNames = recipients
      .map(id => characters.find(c => c.id === id)?.name)
      .filter(Boolean)
      .join(', ');

    toast.success(
      `已${rewardType === 'private' ? '私密' : '公开'}发放 ${xpAmount} XP 给 ${recipientNames}`
    );

    onClose();
  };

  // 战斗XP计算器
  const calculateCombatXP = () => {
    const CR_TO_XP: Record<string, number> = {
      '0': 10, '1/8': 25, '1/4': 50, '1/2': 100,
      '1': 200, '2': 450, '3': 700, '4': 1100,
      '5': 1800, '6': 2300, '7': 2900, '8': 3900,
      '9': 5000, '10': 5900, '11': 7200, '12': 8400,
      '13': 10000, '14': 11500, '15': 13000, '16': 15000,
      '17': 18000, '18': 20000, '19': 22000, '20': 25000
    };

    const totalXP = monsters.reduce((sum, m) =>
      sum + (CR_TO_XP[m.cr] || 0) * m.count, 0
    );

    // 遭遇难度倍数
    const monsterCount = monsters.reduce((sum, m) => sum + m.count, 0);
    let multiplier = 1;
    if (monsterCount === 2) multiplier = 1.5;
    else if (monsterCount <= 6) multiplier = 2;
    else if (monsterCount <= 10) multiplier = 2.5;
    else if (monsterCount <= 14) multiplier = 3;
    else multiplier = 4;

    const adjustedXP = Math.floor(totalXP * multiplier);
    const xpPerPlayer = Math.floor(adjustedXP / partySize);

    setXPAmount(xpPerPlayer);
    setSource('Combat');
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl bg-gray-900 text-white">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold">
            发放经验值
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* 发放方式选择 */}
          <div className="flex gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                checked={rewardType === 'public'}
                onChange={() => setRewardType('public')}
                className="form-radio"
              />
              <span>公开发放</span>
              <span className="text-xs text-gray-400">（所有人可见）</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                checked={rewardType === 'private'}
                onChange={() => setRewardType('private')}
                className="form-radio"
              />
              <span>私密发放</span>
              <span className="text-xs text-gray-400">（仅接收者可见）</span>
            </label>
          </div>

          {/* 目标选择 */}
          <div className="space-y-2">
            <label className="text-sm font-medium">发放对象</label>
            <div className="flex gap-4 mb-2">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={targetType === 'all'}
                  onChange={() => setTargetType('all')}
                />
                <span>全体队员</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={targetType === 'selected'}
                  onChange={() => setTargetType('selected')}
                />
                <span>选定角色</span>
              </label>
            </div>

            {targetType === 'selected' && (
              <div className="grid grid-cols-2 gap-2 p-3 bg-gray-800 rounded">
                {characters.map(char => {
                  const member = members.find(m =>
                    m.selected_character_id === char.id
                  );
                  return (
                    <label
                      key={char.id}
                      className="flex items-center gap-2 cursor-pointer hover:bg-gray-700 p-2 rounded"
                    >
                      <input
                        type="checkbox"
                        checked={selectedCharacters.includes(char.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedCharacters([...selectedCharacters, char.id]);
                          } else {
                            setSelectedCharacters(
                              selectedCharacters.filter(id => id !== char.id)
                            );
                          }
                        }}
                      />
                      <span>{char.name}</span>
                      {member && (
                        <span className="text-xs text-gray-400">
                          ({member.user_id})
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {/* XP输入或计算器 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">经验值</label>
              <button
                type="button"
                onClick={() => setUseCalculator(!useCalculator)}
                className="text-xs text-blue-400 hover:text-blue-300"
              >
                {useCalculator ? '手动输入' : '使用计算器'}
              </button>
            </div>

            {!useCalculator ? (
              <input
                type="number"
                value={xpAmount}
                onChange={(e) => setXPAmount(parseInt(e.target.value) || 0)}
                className="w-full p-2 bg-gray-800 rounded"
                placeholder="输入经验值"
                min="0"
              />
            ) : (
              <div className="p-3 bg-gray-800 rounded space-y-3">
                <div className="text-sm font-medium mb-2">战斗XP计算器</div>

                {/* 怪物列表 */}
                <div className="space-y-2">
                  {monsters.map((monster, idx) => (
                    <div key={idx} className="flex gap-2">
                      <select
                        value={monster.cr}
                        onChange={(e) => {
                          const newMonsters = [...monsters];
                          newMonsters[idx].cr = e.target.value;
                          setMonsters(newMonsters);
                        }}
                        className="flex-1 p-1 bg-gray-700 rounded text-sm"
                      >
                        <option value="">选择CR</option>
                        {['0', '1/8', '1/4', '1/2', ...Array.from(
                          {length: 20}, (_, i) => String(i + 1)
                        )].map(cr => (
                          <option key={cr} value={cr}>CR {cr}</option>
                        ))}
                      </select>
                      <input
                        type="number"
                        value={monster.count}
                        onChange={(e) => {
                          const newMonsters = [...monsters];
                          newMonsters[idx].count = parseInt(e.target.value) || 1;
                          setMonsters(newMonsters);
                        }}
                        className="w-20 p-1 bg-gray-700 rounded text-sm"
                        min="1"
                        placeholder="数量"
                      />
                      <button
                        onClick={() => {
                          setMonsters(monsters.filter((_, i) => i !== idx));
                        }}
                        className="px-2 py-1 bg-red-600 hover:bg-red-500 rounded text-sm"
                      >
                        删除
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() => setMonsters([...monsters, { cr: '1', count: 1 }])}
                    className="w-full py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm"
                  >
                    + 添加怪物
                  </button>
                </div>

                <div className="flex gap-4">
                  <div className="flex-1">
                    <label className="text-xs text-gray-400">队伍人数</label>
                    <input
                      type="number"
                      value={partySize}
                      onChange={(e) => setPartySize(parseInt(e.target.value) || 1)}
                      className="w-full p-1 bg-gray-700 rounded text-sm"
                      min="1"
                    />
                  </div>
                  <button
                    onClick={calculateCombatXP}
                    className="px-4 py-1 bg-blue-600 hover:bg-blue-500 rounded"
                  >
                    计算
                  </button>
                </div>

                {xpAmount > 0 && (
                  <div className="text-center text-green-400">
                    每人获得: {xpAmount} XP
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 来源选择 */}
          <div className="space-y-2">
            <label className="text-sm font-medium">XP来源</label>
            <select
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="w-full p-2 bg-gray-800 rounded"
            >
              <option value="Combat">战斗</option>
              <option value="Quest">任务完成</option>
              <option value="Roleplay">角色扮演</option>
              <option value="Exploration">探索发现</option>
              <option value="Puzzle">解谜</option>
              <option value="Manual">手动奖励</option>
            </select>
          </div>

          {/* 描述 */}
          <div className="space-y-2">
            <label className="text-sm font-medium">
              描述
              <span className="text-xs text-gray-400 ml-2">（可选）</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full p-2 bg-gray-800 rounded h-20 resize-none"
              placeholder="例如：击败了地精营地的首领"
            />
          </div>

          {/* 操作按钮 */}
          <div className="flex justify-end gap-2 pt-4">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded"
            >
              取消
            </button>
            <button
              onClick={handleAward}
              disabled={xpAmount <= 0 || (targetType === 'selected' && selectedCharacters.length === 0)}
              className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 disabled:opacity-50 rounded"
            >
              发放 {xpAmount} XP
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

#### 货币奖励模态框
```typescript
// frontend/app/components/rewards/CurrencyRewardModal.tsx
import { useState } from 'react';
import currencyRates from '@/data/rules/currency.json';

interface CurrencyRewardModalProps {
  isOpen: boolean;
  onClose: () => void;
  campaignId: string;
  characters: Character[];
  members: Member[];
}

interface CurrencyAmount {
  cp: number;
  sp: number;
  ep: number;
  gp: number;
  pp: number;
}

export function CurrencyRewardModal({
  isOpen,
  onClose,
  campaignId,
  characters,
  members
}: CurrencyRewardModalProps) {
  const { sendMessage } = useWebSocket();

  const [rewardType, setRewardType] = useState<'public' | 'private'>('private');
  const [targetType, setTargetType] = useState<'all' | 'selected'>('all');
  const [selectedCharacters, setSelectedCharacters] = useState<string[]>([]);
  const [currency, setCurrency] = useState<CurrencyAmount>({
    cp: 0, sp: 0, ep: 0, gp: 0, pp: 0
  });
  const [source, setSource] = useState('Loot');
  const [description, setDescription] = useState('');

  // 快捷金额按钮
  const quickAmounts = [
    { label: '10 GP', amount: { gp: 10 } },
    { label: '50 GP', amount: { gp: 50 } },
    { label: '100 GP', amount: { gp: 100 } },
    { label: '500 GP', amount: { gp: 500 } },
    { label: '1000 GP', amount: { gp: 1000 } },
    { label: '1 PP', amount: { pp: 1 } },
  ];

  // 计算总价值（以金币显示）
  const calculateTotalValue = (): number => {
    const copperTotal = Object.entries(currency).reduce((sum, [type, amount]) => {
      return sum + (amount * currencyRates.rates[type as keyof typeof currencyRates.rates]);
    }, 0);
    return copperTotal / 100; // 转换为金币
  };

  const handleAward = () => {
    const recipients = targetType === 'all'
      ? characters.map(c => c.id)
      : selectedCharacters;

    // 检查是否有任何货币值
    const hasValue = Object.values(currency).some(v => v > 0);
    if (!hasValue) {
      toast.error('请输入至少一种货币');
      return;
    }

    sendMessage({
      type: 'reward_grant',
      campaign_id: campaignId,
      data: {
        reward_type: 'currency',
        recipients,
        currency_changes: currency,
        source,
        description,
        is_private: rewardType === 'private',
        timestamp: new Date().toISOString()
      }
    });

    const totalGP = calculateTotalValue();
    toast.success(
      `已${rewardType === 'private' ? '私密' : '公开'}发放 ${totalGP.toFixed(2)} GP 等值货币`
    );

    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl bg-gray-900 text-white">
        <DialogHeader>
          <DialogTitle>发放货币</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* 发放方式选择 */}
          <div className="flex gap-4">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={rewardType === 'public'}
                onChange={() => setRewardType('public')}
              />
              <span>公开发放</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={rewardType === 'private'}
                onChange={() => setRewardType('private')}
              />
              <span>私密发放</span>
            </label>
          </div>

          {/* 目标选择（同XP） */}
          {/* ... */}

          {/* 货币输入 */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">货币金额</label>
              <span className="text-xs text-gray-400">
                总价值: {calculateTotalValue().toFixed(2)} GP
              </span>
            </div>

            {/* 快捷按钮 */}
            <div className="flex flex-wrap gap-2">
              {quickAmounts.map(({ label, amount }) => (
                <button
                  key={label}
                  onClick={() => {
                    setCurrency({
                      ...currency,
                      ...amount
                    });
                  }}
                  className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm"
                >
                  {label}
                </button>
              ))}
            </div>

            {/* 货币输入网格 */}
            <div className="grid grid-cols-5 gap-2">
              {Object.entries(currencyRates.rates).map(([type]) => (
                <div key={type} className="text-center">
                  <label
                    className="text-xs font-medium mb-1 block"
                    style={{ color: currencyRates.colors[type] }}
                  >
                    {type.toUpperCase()}
                  </label>
                  <input
                    type="number"
                    value={currency[type as keyof CurrencyAmount]}
                    onChange={(e) => setCurrency({
                      ...currency,
                      [type]: parseInt(e.target.value) || 0
                    })}
                    className="w-full p-2 bg-gray-800 rounded text-center"
                    min="0"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* 来源和描述 */}
          <div className="space-y-2">
            <label className="text-sm font-medium">来源</label>
            <select
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="w-full p-2 bg-gray-800 rounded"
            >
              <option value="Loot">战利品</option>
              <option value="Quest">任务奖励</option>
              <option value="Trade">交易所得</option>
              <option value="Treasure">宝藏</option>
              <option value="Manual">手动发放</option>
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">描述</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full p-2 bg-gray-800 rounded h-20"
              placeholder="例如：地精首领的宝箱"
            />
          </div>

          {/* 操作按钮 */}
          <div className="flex justify-end gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded"
            >
              取消
            </button>
            <button
              onClick={handleAward}
              className="px-4 py-2 bg-yellow-600 hover:bg-yellow-500 rounded"
            >
              发放货币
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

### 3.4 玩家端显示组件

#### 经验和货币显示
```typescript
// frontend/app/components/character/ProgressionDisplay.tsx
export function ProgressionDisplay({ character }: { character: Character }) {
  const progression = useCharacterProgression(character);
  const [showHistory, setShowHistory] = useState(false);
  const [rewardHistory, setRewardHistory] = useState<RewardHistory[]>([]);

  useEffect(() => {
    if (showHistory) {
      fetchRewardHistory(character.id).then(setRewardHistory);
    }
  }, [character.id, showHistory]);

  return (
    <div className="progression-display bg-gray-800 rounded-lg p-4">
      {/* 等级和XP */}
      <div className="xp-section mb-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-lg font-bold">
            Level {progression.level}
            {progression.useMilestone && (
              <span className="text-xs text-gray-400 ml-2">(里程碑)</span>
            )}
          </h3>
          <span className="text-sm text-gray-300">
            {progression.xp.toLocaleString()} XP
          </span>
        </div>

        {!progression.isMaxLevel && !progression.useMilestone && (
          <>
            <div className="relative h-6 bg-gray-700 rounded-full overflow-hidden">
              <div
                className="absolute top-0 left-0 h-full bg-gradient-to-r from-purple-600 to-purple-400 transition-all duration-500"
                style={{ width: `${progression.progressPercentage}%` }}
              />
              <div className="absolute inset-0 flex items-center justify-center text-xs">
                {progression.xpProgress} / {progression.xpNeeded}
              </div>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              距离 Level {progression.level + 1} 还需 {progression.xpNeeded - progression.xpProgress} XP
            </p>
          </>
        )}
      </div>

      {/* 货币 */}
      <div className="currency-section mb-4">
        <h4 className="text-sm font-medium mb-2">财富</h4>
        <div className="flex gap-3">
          {Object.entries(progression.currency).map(([type, amount]) => {
            if (amount === 0) return null;
            return (
              <div
                key={type}
                className="flex items-center gap-1"
                style={{ color: currencyRates.colors[type] }}
              >
                <span className="font-bold">{amount}</span>
                <span className="text-xs">{type.toUpperCase()}</span>
              </div>
            );
          })}
          {Object.values(progression.currency).every(v => v === 0) && (
            <span className="text-gray-500 text-sm">无财产</span>
          )}
        </div>
        <p className="text-xs text-gray-400 mt-1">
          总价值: {(progression.totalWealth / 100).toFixed(2)} GP
        </p>
      </div>

      {/* 历史记录按钮 */}
      <button
        onClick={() => setShowHistory(!showHistory)}
        className="text-xs text-blue-400 hover:text-blue-300"
      >
        {showHistory ? '隐藏' : '查看'}奖励历史
      </button>

      {/* 奖励历史 */}
      {showHistory && (
        <div className="mt-4 max-h-60 overflow-y-auto">
          <h4 className="text-sm font-medium mb-2">最近奖励</h4>
          <div className="space-y-2">
            {rewardHistory.map((entry) => (
              <div
                key={entry.id}
                className="text-xs p-2 bg-gray-700 rounded flex justify-between"
              >
                <div>
                  {entry.reward_type === 'xp' ? (
                    <span className="text-purple-400">
                      +{entry.xp_amount} XP
                    </span>
                  ) : (
                    <span className="text-yellow-400">
                      {formatCurrencyChanges(entry.currency_changes)}
                    </span>
                  )}
                  <span className="text-gray-400 ml-2">
                    {entry.source}
                  </span>
                  {entry.is_private && (
                    <span className="text-xs text-red-400 ml-1">[私密]</span>
                  )}
                </div>
                <span className="text-gray-500">
                  {formatRelativeTime(entry.created_at)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

#### 升级通知组件
```typescript
// frontend/app/components/character/LevelUpNotification.tsx
import { useEffect, useState } from 'react';
import confetti from 'canvas-confetti';
import { useLevelUpBenefits } from '~/hooks/useLevelUpBenefits';

interface LevelUpNotificationProps {
  character: Character;
  oldLevel: number;
  newLevel: number;
  onClose: () => void;
}

export function LevelUpNotification({
  character,
  oldLevel,
  newLevel,
  onClose
}: LevelUpNotificationProps) {
  const benefits = useLevelUpBenefits(character.class_id, newLevel);

  useEffect(() => {
    // 播放升级音效
    const audio = new Audio('/sounds/levelup.mp3');
    audio.play().catch(() => {});

    // 彩带效果
    confetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 },
      colors: ['#8B5CF6', '#7C3AED', '#6D28D9']
    });
  }, []);

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
      <div className="bg-gradient-to-br from-purple-900 to-purple-700 rounded-lg p-8 max-w-lg animate-scale-up">
        {/* 升级动画 */}
        <div className="text-center mb-6">
          <div className="text-6xl mb-4 animate-pulse">⭐</div>
          <h2 className="text-3xl font-bold text-white mb-2">
            LEVEL UP!
          </h2>
          <p className="text-xl text-purple-200">
            {character.name} 达到了 Level {newLevel}!
          </p>
        </div>

        {/* 获得的能力 */}
        <div className="bg-black/30 rounded p-4 mb-6">
          <h3 className="text-lg font-bold text-white mb-3">
            你获得了：
          </h3>
          <ul className="space-y-2 text-purple-100">
            {/* HP增长 */}
            {benefits.hitPoints && (
              <li className="flex items-center gap-2">
                <span className="text-red-400">❤️</span>
                +{benefits.hitPoints} 生命值
              </li>
            )}

            {/* 新特性 */}
            {benefits.features.map((feature) => (
              <li key={feature.id} className="flex items-center gap-2">
                <span className="text-yellow-400">✨</span>
                {feature.name}
                {feature.description && (
                  <span className="text-xs text-gray-400">
                    - {feature.description}
                  </span>
                )}
              </li>
            ))}

            {/* 法术位 */}
            {benefits.spellSlots && (
              <li className="flex items-center gap-2">
                <span className="text-blue-400">🔮</span>
                新法术位: {formatSpellSlots(benefits.spellSlots)}
              </li>
            )}

            {/* ASI */}
            {benefits.asi && (
              <li className="flex items-center gap-2">
                <span className="text-green-400">📈</span>
                属性值提升或专长
              </li>
            )}

            {/* 熟练加值 */}
            {benefits.proficiencyBonus && (
              <li className="flex items-center gap-2">
                <span className="text-orange-400">🎯</span>
                熟练加值提升至 +{benefits.proficiencyBonus}
              </li>
            )}
          </ul>
        </div>

        {/* 关闭按钮 */}
        <button
          onClick={onClose}
          className="w-full py-3 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded transition-colors"
        >
          继续冒险！
        </button>
      </div>
    </div>
  );
}
```

## 4. 后端实现详细设计

### 4.1 数据模型

#### Character模型扩展
```python
# backend/app/models/character.py
from sqlalchemy import Column, Integer, String, JSON, DateTime
from sqlalchemy.sql import func
from app.db.session import Base

class Character(Base):
    __tablename__ = "characters"

    # ... existing fields ...

    # 新增字段
    experience_points = Column(Integer, default=0, nullable=False)
    milestone_level = Column(Integer, nullable=True)

    # 货币已存在
    # currency = Column(JSON)  # {"cp": 0, "sp": 0, "ep": 0, "gp": 0, "pp": 0}
```

#### 奖励历史模型
```python
# backend/app/models/reward_history.py
from sqlalchemy import Column, Integer, String, Text, Boolean, DateTime, ForeignKey, JSON
from sqlalchemy.sql import func
from app.db.session import Base

class RewardHistory(Base):
    """奖励历史记录"""
    __tablename__ = "reward_history"

    id = Column(Integer, primary_key=True, index=True)
    character_id = Column(Integer, ForeignKey("characters.id", ondelete="CASCADE"), nullable=False, index=True)
    campaign_id = Column(Integer, ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False, index=True)

    reward_type = Column(String(20), nullable=False, index=True)  # 'xp', 'currency'

    # XP相关
    xp_amount = Column(Integer)
    xp_source = Column(String(100))

    # 货币相关
    currency_changes = Column(JSON)  # {"cp": 100, "gp": -10}
    currency_source = Column(String(100))

    # 通用字段
    description = Column(Text)
    is_private = Column(Boolean, default=False)
    awarded_by = Column(String(50), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
```

### 4.2 WebSocket处理器

#### 奖励处理器
```python
# backend/app/services/websocket_handlers/reward_handler.py
from typing import Dict, Any, List
from fastapi import WebSocket
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import datetime
import json

from .base import MessageHandler
from app.models.character import Character
from app.models.reward_history import RewardHistory
from app.models.campaign import Campaign

class RewardHandler(MessageHandler):
    """处理奖励发放消息"""

    async def handle(
        self,
        message: Dict[str, Any],
        websocket: WebSocket,
        campaign_id: str,
        user_id: str,
        role: str,
        db: AsyncSession
    ) -> None:
        """处理奖励发放请求"""

        # 只有DM可以发放奖励
        if role != 'dm':
            await self.send_to_websocket({
                "type": "error",
                "message": "只有DM可以发放奖励"
            }, websocket)
            return

        data = message.get("data", {})
        reward_type = data.get("reward_type")  # 'xp' or 'currency'
        recipients = data.get("recipients", [])
        is_private = data.get("is_private", False)
        description = data.get("description", "")

        if not recipients:
            await self.send_to_websocket({
                "type": "error",
                "message": "请选择至少一个接收者"
            }, websocket)
            return

        # 处理不同类型的奖励
        if reward_type == "xp":
            await self._handle_xp_reward(
                data, recipients, campaign_id, user_id,
                description, is_private, db
            )
        elif reward_type == "currency":
            await self._handle_currency_reward(
                data, recipients, campaign_id, user_id,
                description, is_private, db
            )
        else:
            await self.send_to_websocket({
                "type": "error",
                "message": f"未知的奖励类型: {reward_type}"
            }, websocket)

    async def _handle_xp_reward(
        self,
        data: Dict[str, Any],
        recipients: List[str],
        campaign_id: str,
        dm_id: str,
        description: str,
        is_private: bool,
        db: AsyncSession
    ):
        """处理XP奖励"""
        xp_amount = data.get("amount", 0)
        source = data.get("source", "Manual")

        if xp_amount <= 0:
            return

        updated_characters = []

        # 更新每个角色的XP
        for character_id in recipients:
            # 获取角色
            result = await db.execute(
                select(Character).where(Character.id == character_id)
            )
            character = result.scalar_one_or_none()

            if not character:
                continue

            old_xp = character.experience_points
            character.experience_points += xp_amount

            # 创建历史记录
            history = RewardHistory(
                character_id=character_id,
                campaign_id=int(campaign_id),
                reward_type="xp",
                xp_amount=xp_amount,
                xp_source=source,
                description=description,
                is_private=is_private,
                awarded_by=dm_id
            )
            db.add(history)

            updated_characters.append({
                "id": character_id,
                "user_id": character.user_id,
                "name": character.name,
                "old_xp": old_xp,
                "new_xp": character.experience_points,
                "xp_gained": xp_amount
            })

        await db.commit()

        # 准备广播消息
        broadcast_msg = {
            "type": "reward_update",
            "reward_type": "xp",
            "campaign_id": campaign_id,
            "data": {
                "characters": updated_characters,
                "amount": xp_amount,
                "source": source,
                "description": description,
                "is_private": is_private,
                "awarded_by": dm_id,
                "timestamp": datetime.utcnow().isoformat()
            }
        }

        if is_private:
            # 私密奖励：只发送给DM和接收者
            recipient_user_ids = [char["user_id"] for char in updated_characters]
            recipient_user_ids.append(dm_id)  # DM也能看到

            from app.services.websocket_manager import manager
            await manager.send_to_users(broadcast_msg, campaign_id, recipient_user_ids)
        else:
            # 公开奖励：广播给所有人
            await self.broadcast_to_campaign(broadcast_msg, campaign_id)

    async def _handle_currency_reward(
        self,
        data: Dict[str, Any],
        recipients: List[str],
        campaign_id: str,
        dm_id: str,
        description: str,
        is_private: bool,
        db: AsyncSession
    ):
        """处理货币奖励"""
        currency_changes = data.get("currency_changes", {})
        source = data.get("source", "Manual")

        # 验证货币数据
        if not any(amount != 0 for amount in currency_changes.values()):
            return

        updated_characters = []

        for character_id in recipients:
            # 获取角色
            result = await db.execute(
                select(Character).where(Character.id == character_id)
            )
            character = result.scalar_one_or_none()

            if not character:
                continue

            # 更新货币
            old_currency = character.currency or {"cp": 0, "sp": 0, "ep": 0, "gp": 0, "pp": 0}
            new_currency = old_currency.copy()

            for currency_type, amount in currency_changes.items():
                if currency_type in new_currency:
                    new_currency[currency_type] = max(0, new_currency[currency_type] + amount)

            character.currency = new_currency

            # 创建历史记录
            history = RewardHistory(
                character_id=character_id,
                campaign_id=int(campaign_id),
                reward_type="currency",
                currency_changes=currency_changes,
                currency_source=source,
                description=description,
                is_private=is_private,
                awarded_by=dm_id
            )
            db.add(history)

            updated_characters.append({
                "id": character_id,
                "user_id": character.user_id,
                "name": character.name,
                "old_currency": old_currency,
                "new_currency": new_currency,
                "currency_changes": currency_changes
            })

        await db.commit()

        # 准备广播消息
        broadcast_msg = {
            "type": "reward_update",
            "reward_type": "currency",
            "campaign_id": campaign_id,
            "data": {
                "characters": updated_characters,
                "currency_changes": currency_changes,
                "source": source,
                "description": description,
                "is_private": is_private,
                "awarded_by": dm_id,
                "timestamp": datetime.utcnow().isoformat()
            }
        }

        if is_private:
            # 私密奖励
            recipient_user_ids = [char["user_id"] for char in updated_characters]
            recipient_user_ids.append(dm_id)

            from app.services.websocket_manager import manager
            await manager.send_to_users(broadcast_msg, campaign_id, recipient_user_ids)
        else:
            # 公开奖励
            await self.broadcast_to_campaign(broadcast_msg, campaign_id)
```

### 4.3 WebSocket管理器扩展

```python
# backend/app/services/websocket_manager.py (扩展)
class ConnectionManager:
    # ... existing code ...

    async def send_to_users(
        self,
        message: dict,
        campaign_id: str,
        user_ids: List[str]
    ) -> None:
        """发送消息给特定用户列表"""
        if campaign_id in self.active_connections:
            tasks = []
            for conn_id, (ws, metadata) in self.active_connections[campaign_id].items():
                if metadata.get("user_id") in user_ids:
                    tasks.append(ws.send_json(message))

            if tasks:
                await asyncio.gather(*tasks, return_exceptions=True)
```

### 4.4 API路由

```python
# backend/app/api/routes/rewards.py
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List, Optional

from app.db.session import get_db
from app.models.reward_history import RewardHistory
from app.models.character import Character
from app.core.auth import get_current_user

router = APIRouter()

@router.get("/characters/{character_id}/rewards")
async def get_reward_history(
    character_id: int,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    reward_type: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """获取角色的奖励历史"""

    # 验证角色访问权限
    result = await db.execute(
        select(Character).where(Character.id == character_id)
    )
    character = result.scalar_one_or_none()

    if not character:
        raise HTTPException(status_code=404, detail="Character not found")

    # 只有角色拥有者或DM可以查看
    # TODO: 验证DM权限
    if character.user_id != current_user.id:
        # 检查是否为私密奖励
        query = select(RewardHistory).where(
            RewardHistory.character_id == character_id,
            RewardHistory.is_private == False
        )
    else:
        query = select(RewardHistory).where(
            RewardHistory.character_id == character_id
        )

    # 筛选奖励类型
    if reward_type:
        query = query.where(RewardHistory.reward_type == reward_type)

    # 排序和分页
    query = query.order_by(RewardHistory.created_at.desc()).limit(limit).offset(offset)

    result = await db.execute(query)
    history = result.scalars().all()

    return {
        "history": [
            {
                "id": h.id,
                "reward_type": h.reward_type,
                "xp_amount": h.xp_amount,
                "xp_source": h.xp_source,
                "currency_changes": h.currency_changes,
                "currency_source": h.currency_source,
                "description": h.description,
                "is_private": h.is_private,
                "awarded_by": h.awarded_by,
                "created_at": h.created_at
            }
            for h in history
        ],
        "total": len(history),
        "limit": limit,
        "offset": offset
    }

@router.post("/characters/{character_id}/milestone-level")
async def set_milestone_level(
    character_id: int,
    level: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """设置里程碑等级（DM专用）"""
    # TODO: 验证DM权限

    if level < 1 or level > 20:
        raise HTTPException(status_code=400, detail="Level must be between 1 and 20")

    result = await db.execute(
        select(Character).where(Character.id == character_id)
    )
    character = result.scalar_one_or_none()

    if not character:
        raise HTTPException(status_code=404, detail="Character not found")

    character.milestone_level = level
    await db.commit()

    return {"message": f"Set {character.name} to milestone level {level}"}
```

## 5. WebSocket消息协议

### 5.1 奖励发放消息

#### 请求（DM -> Server）
```json
{
  "type": "reward_grant",
  "campaign_id": "123",
  "data": {
    "reward_type": "xp",  // or "currency"
    "recipients": ["char_id_1", "char_id_2"],
    "amount": 300,  // for XP
    "currency_changes": {  // for currency
      "cp": 0,
      "sp": 0,
      "gp": 100,
      "ep": 0,
      "pp": 0
    },
    "source": "Combat",
    "description": "击败了哥布林首领",
    "is_private": false,
    "timestamp": "2024-01-01T12:00:00Z"
  }
}
```

#### 响应（Server -> Clients）
```json
{
  "type": "reward_update",
  "reward_type": "xp",
  "campaign_id": "123",
  "data": {
    "characters": [
      {
        "id": "char_id_1",
        "user_id": "user_1",
        "name": "Aragorn",
        "old_xp": 2500,
        "new_xp": 2800,
        "xp_gained": 300
      }
    ],
    "amount": 300,
    "source": "Combat",
    "description": "击败了哥布林首领",
    "is_private": false,
    "awarded_by": "dm_user_id",
    "timestamp": "2024-01-01T12:00:00Z"
  }
}
```

## 6. 前端状态管理

### 6.1 Zustand Store
```typescript
// frontend/app/stores/character.ts
interface CharacterStore {
  // ... existing state ...

  // 新增状态
  experience_points: number;
  milestone_level: number | null;
  currency: Currency;
  rewardHistory: RewardHistory[];

  // 新增方法
  updateXP: (characterId: string, newXP: number) => void;
  updateCurrency: (characterId: string, newCurrency: Currency) => void;
  addRewardHistory: (reward: RewardHistory) => void;
  checkLevelUp: (characterId: string) => boolean;
}

export const useCharacterStore = create<CharacterStore>()(
  persist(
    (set, get) => ({
      // ... existing implementation ...

      updateXP: (characterId, newXP) => {
        set((state) => {
          const character = state.characters.find(c => c.id === characterId);
          if (character) {
            const oldLevel = calculateLevel(character.experience_points);
            character.experience_points = newXP;
            const newLevel = calculateLevel(newXP);

            if (newLevel > oldLevel) {
              // 触发升级通知
              showLevelUpNotification(character, oldLevel, newLevel);
            }
          }
          return { ...state };
        });
      },

      updateCurrency: (characterId, newCurrency) => {
        set((state) => {
          const character = state.characters.find(c => c.id === characterId);
          if (character) {
            character.currency = newCurrency;
          }
          return { ...state };
        });
      }
    }),
    {
      name: 'character-storage'
    }
  )
);
```

## 7. 测试计划

### 7.1 单元测试
```typescript
// frontend/tests/unit/xp-calculation.test.ts
describe('XP Calculation', () => {
  it('should calculate correct level from XP', () => {
    expect(calculateLevel(0)).toBe(1);
    expect(calculateLevel(300)).toBe(2);
    expect(calculateLevel(900)).toBe(3);
    expect(calculateLevel(355000)).toBe(20);
  });

  it('should calculate XP progress correctly', () => {
    const progress = calculateProgress(1500);  // Level 3
    expect(progress.currentLevel).toBe(3);
    expect(progress.xpProgress).toBe(600);  // 1500 - 900
    expect(progress.xpNeeded).toBe(1800);  // 2700 - 900
  });
});
```

### 7.2 集成测试
```python
# backend/tests/test_rewards.py
async def test_xp_reward_grant():
    """测试XP奖励发放"""
    # 创建测试数据
    # 发送奖励请求
    # 验证数据库更新
    # 验证WebSocket广播
    pass

async def test_private_reward():
    """测试私密奖励只对特定用户可见"""
    pass
```

### 7.3 E2E测试
```typescript
// e2e/rewards.spec.ts
test('DM can award XP through chat panel', async ({ page }) => {
  // DM登录并进入战役
  // 点击发放按钮
  // 选择XP奖励
  // 输入金额并确认
  // 验证角色收到XP
});

test('Private rewards are only visible to recipients', async ({ page, context }) => {
  // 开启多个浏览器标签
  // DM发放私密奖励
  // 验证只有接收者看到通知
});
```

## 8. 部署和迁移

### 8.1 数据库迁移步骤
```bash
# 1. 创建迁移文件
cd backend
alembic revision --autogenerate -m "add_reward_system"

# 2. 审查迁移文件
# 确保包含：
# - characters表的experience_points和milestone_level字段
# - reward_history表的创建
# - 必要的索引

# 3. 执行迁移
alembic upgrade head
```

### 8.2 配置更新
```yaml
# docker-compose.yml
services:
  backend:
    environment:
      - ENABLE_REWARD_SYSTEM=true
      - MAX_REWARD_HISTORY=1000
```

## 9. 性能优化

### 9.1 前端优化
- 使用React.memo优化奖励组件渲染
- 奖励历史分页加载
- 升级动画使用CSS动画而非JS
- WebWorker计算复杂XP公式

### 9.2 后端优化
- 批量更新角色数据
- 使用数据库事务确保一致性
- 奖励历史定期归档
- WebSocket消息压缩

## 10. 安全考虑

### 10.1 权限验证
- 只有DM可以发放奖励
- 私密奖励的访问控制
- 防止XP/货币溢出

### 10.2 数据验证
- 奖励金额必须为正数
- 货币类型验证
- 防止重复发放

## 11. 未来扩展

### 11.1 短期计划
1. 奖励模板系统
2. 批量导入奖励
3. 奖励撤销功能
4. 自动奖励规则

### 11.2 长期计划
1. 成就系统集成
2. 多币种支持（自定义货币）
3. 经济系统模拟
4. 跨战役角色导入

## 12. 用户指南

### 12.1 DM操作指南
1. 点击聊天面板的"发放"按钮
2. 选择奖励类型（XP/货币）
3. 选择公开或私密发放
4. 选择接收角色
5. 输入金额和描述
6. 确认发放

### 12.2 玩家查看指南
1. 在角色面板查看当前XP和货币
2. 点击"查看历史"查看奖励记录
3. 私密奖励标记为[私密]
4. 升级时自动显示通知

---

本设计文档提供了完整的D&D 5E经验值与货币奖励系统实现方案，遵循"重前端轻后端"的设计理念，确保系统高效、实时、用户友好。