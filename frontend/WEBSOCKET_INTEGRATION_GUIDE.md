# WebSocket 角色升级通知集成指南

> 如何在前端处理完整的角色升级数据

---

## 📡 后端已完成

后端现在广播包含完整关键数据的升级通知：

```typescript
{
  type: 'character_level_up',
  campaign_id: '123',
  data: {
    character_id: 456,
    character_name: '玩家A',
    user_id: 'user-123',
    level: 4,
    class_id: 'fighter',
    subclass_id: 'champion',
    multiclass_data: {...},
    ability_scores: {
      strength: 18,
      dexterity: 14,
      constitution: 16,
      intelligence: 10,
      wisdom: 12,
      charisma: 8
    },
    current_hp: 42,
    max_hp: 42,
    selected_skills: [...],
    expertise_skills: [...],
    fighting_style: {...},
    selected_cantrips: [...],
    selected_spells: [...],
    prepared_spells: [...],
    spell_slots_state: [4, 3, 0, 0, 0, 0, 0, 0, 0],
    timestamp: '2025-01-20T10:30:00Z'
  }
}
```

---

## 🔧 前端集成步骤

### 方式1：在 Campaign DM 页面中集成

**文件：** `frontend/app/routes/campaign.$id.dm.tsx`

```tsx
import { useWebSocket } from '~/hooks/useWebSocket';
import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';

export default function CampaignDMPage() {
  const { campaignId } = useParams();
  const [characters, setCharacters] = useState([]);
  const [tokens, setTokens] = useState([]);

  // WebSocket 连接
  const { sendMessage } = useWebSocket({
    campaignId,
    userId,
    role: 'dm',
    onMessage: (message) => {
      // 处理升级通知
      if (message.type === 'character_level_up') {
        handleLevelUpNotification(message.data);
      }

      // 处理其他消息类型...
    }
  });

  const handleLevelUpNotification = (characterData: any) => {
    console.log('[LevelUp] Received full character data:', characterData);

    // 1. 显示详细通知
    toast.success(
      <div className="space-y-1">
        <div className="font-bold">
          🎉 {characterData.character_name} 升级到了 {characterData.level} 级！
        </div>
        <div className="text-sm text-gray-600">
          职业：{characterData.class_id}
          {characterData.subclass_id && ` (${characterData.subclass_id})`}
        </div>
        <div className="text-xs">
          HP: {characterData.current_hp || characterData.max_hp}/{characterData.max_hp}
        </div>
        <div className="text-xs">
          {Object.entries(characterData.ability_scores || {})
            .slice(0, 3)
            .map(([stat, value]) => `${stat.slice(0, 3).toUpperCase()}: ${value}`)
            .join(' | ')}
        </div>
      </div>,
      { duration: 8000 }
    );

    // 2. 直接更新角色列表（无需重新fetch）
    setCharacters(prev => prev.map(char =>
      char.id === characterData.character_id
        ? {
            ...char,
            // 更新所有关键字段
            level: characterData.level,
            class_id: characterData.class_id,
            subclass_id: characterData.subclass_id,
            multiclass_data: characterData.multiclass_data,
            ability_scores: characterData.ability_scores,
            current_hp: characterData.current_hp,
            selected_skills: characterData.selected_skills,
            expertise_skills: characterData.expertise_skills,
            fighting_style: characterData.fighting_style,
            eldritch_invocations: characterData.eldritch_invocations,
            selected_cantrips: characterData.selected_cantrips,
            selected_spells: characterData.selected_spells,
            prepared_spells: characterData.prepared_spells,
            spell_slots_state: characterData.spell_slots_state,
          }
        : char
    ));

    // 3. 更新地图上的token（如果角色在地图上）
    setTokens(prev => prev.map(token =>
      token.character_id === characterData.character_id
        ? {
            ...token,
            name: characterData.character_name,
            max_hp: characterData.max_hp,
            current_hp: characterData.current_hp || characterData.max_hp,
            level: characterData.level,
          }
        : token
    ));

    // 4. 可选：触发其他UI更新
    // 例如：刷新聊天面板、更新角色详情等
  };

  return (
    <div>
      {/* DM界面内容 */}
      <CharacterList characters={characters} />
      <TacticalMap tokens={tokens} />
    </div>
  );
}
```

---

### 方式2：创建专用的升级通知Hook

**新建文件：** `frontend/app/hooks/useLevelUpNotification.ts`

```typescript
import { useCallback } from 'react';
import toast from 'react-hot-toast';

export interface LevelUpData {
  character_id: number;
  character_name: string;
  level: number;
  class_id: string;
  subclass_id?: string;
  ability_scores: Record<string, number>;
  max_hp: number;
  current_hp?: number;
  // ... other fields
}

export function useLevelUpNotification() {
  const showLevelUpToast = useCallback((data: LevelUpData) => {
    toast.success(
      <div className="space-y-2">
        <div className="font-bold text-lg">
          🎉 {data.character_name} 升级到了 {data.level} 级！
        </div>
        <div className="text-sm">
          <span className="text-gray-600">职业：</span>
          <span className="font-medium">{data.class_id}</span>
          {data.subclass_id && (
            <span className="text-gray-500"> ({data.subclass_id})</span>
          )}
        </div>
        <div className="text-sm">
          <span className="text-gray-600">HP：</span>
          <span className="font-medium">
            {data.current_hp || data.max_hp}/{data.max_hp}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-1 text-xs">
          {Object.entries(data.ability_scores).slice(0, 6).map(([stat, value]) => (
            <div key={stat}>
              <span className="text-gray-500">{stat.slice(0, 3).toUpperCase()}</span>
              <span className="font-medium ml-1">{value}</span>
            </div>
          ))}
        </div>
      </div>,
      {
        duration: 10000,
        icon: '🎉',
        style: {
          minWidth: '300px',
          borderLeft: '4px solid #10b981'
        }
      }
    );
  }, []);

  const updateCharacterInList = useCallback((
    characters: any[],
    characterData: LevelUpData
  ) => {
    return characters.map(char =>
      char.id === characterData.character_id
        ? { ...char, ...characterData }
        : char
    );
  }, []);

  return {
    showLevelUpToast,
    updateCharacterInList
  };
}
```

**使用示例：**

```tsx
import { useLevelUpNotification } from '~/hooks/useLevelUpNotification';

export default function CampaignDMPage() {
  const { showLevelUpToast, updateCharacterInList } = useLevelUpNotification();
  const [characters, setCharacters] = useState([]);

  useWebSocket({
    campaignId,
    userId,
    role: 'dm',
    onMessage: (message) => {
      if (message.type === 'character_level_up') {
        const data = message.data;

        // 显示通知
        showLevelUpToast(data);

        // 更新角色列表
        setCharacters(prev => updateCharacterInList(prev, data));
      }
    }
  });
}
```

---

### 方式3：创建升级通知组件（完整UI）

**新建文件：** `frontend/app/components/notifications/LevelUpNotification.tsx`

```tsx
import { useState } from 'react';
import { X, ChevronDown, ChevronUp } from 'lucide-react';

interface LevelUpNotificationProps {
  data: {
    character_id: number;
    character_name: string;
    level: number;
    class_id: string;
    subclass_id?: string;
    ability_scores: Record<string, number>;
    max_hp: number;
    current_hp?: number;
    selected_skills?: any[];
    expertise_skills?: any[];
    selected_spells?: any[];
    fighting_style?: any;
  };
  onClose: () => void;
}

export function LevelUpNotification({ data, onClose }: LevelUpNotificationProps) {
  const [showDetails, setShowDetails] = useState(false);

  return (
    <div className="fixed top-4 right-4 bg-white shadow-2xl rounded-lg p-4 max-w-md border-2 border-blue-500 animate-slide-in-right z-50">
      {/* 头部 */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-2">
          <span className="text-2xl">🎉</span>
          <div>
            <div className="font-bold text-lg">{data.character_name}</div>
            <div className="text-sm text-gray-600">
              升级到了 {data.level} 级！
            </div>
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 transition-colors"
        >
          <X size={20} />
        </button>
      </div>

      {/* 关键信息 */}
      <div className="space-y-2 text-sm">
        {/* 职业 */}
        <div className="flex justify-between">
          <span className="text-gray-600">职业：</span>
          <span className="font-medium">
            {data.class_id}
            {data.subclass_id && ` (${data.subclass_id})`}
          </span>
        </div>

        {/* HP */}
        <div className="flex justify-between">
          <span className="text-gray-600">HP：</span>
          <span className="font-medium">
            {data.current_hp || data.max_hp} / {data.max_hp}
          </span>
        </div>

        {/* 属性 */}
        <div className="border-t pt-2">
          <div className="grid grid-cols-3 gap-2">
            {Object.entries(data.ability_scores || {}).map(([stat, value]) => (
              <div key={stat} className="text-center">
                <div className="text-xs text-gray-500 uppercase">
                  {stat.slice(0, 3)}
                </div>
                <div className="font-bold">{value as number}</div>
                <div className="text-xs text-gray-400">
                  {Math.floor(((value as number) - 10) / 2) >= 0 ? '+' : ''}
                  {Math.floor(((value as number) - 10) / 2)}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 展开详情按钮 */}
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="w-full flex items-center justify-center gap-2 text-blue-600 hover:text-blue-700 text-sm mt-2 py-1 hover:bg-blue-50 rounded transition-colors"
        >
          {showDetails ? (
            <>
              <ChevronUp size={16} />
              收起详情
            </>
          ) : (
            <>
              <ChevronDown size={16} />
              查看详情
            </>
          )}
        </button>

        {/* 详细信息 */}
        {showDetails && (
          <div className="border-t pt-2 space-y-2 max-h-64 overflow-y-auto">
            {/* 技能 */}
            {data.selected_skills && data.selected_skills.length > 0 && (
              <div>
                <div className="font-medium text-xs text-gray-600 mb-1">技能：</div>
                <div className="text-xs flex flex-wrap gap-1">
                  {data.selected_skills.map((skill: any, idx: number) => (
                    <span key={idx} className="bg-blue-100 text-blue-800 px-2 py-1 rounded">
                      {typeof skill === 'string' ? skill : skill.value}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* 专精 */}
            {data.expertise_skills && data.expertise_skills.length > 0 && (
              <div>
                <div className="font-medium text-xs text-gray-600 mb-1">专精：</div>
                <div className="text-xs flex flex-wrap gap-1">
                  {data.expertise_skills.map((skill: any, idx: number) => (
                    <span key={idx} className="bg-purple-100 text-purple-800 px-2 py-1 rounded">
                      {typeof skill === 'string' ? skill : skill.value}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* 战斗风格 */}
            {data.fighting_style && (
              <div>
                <div className="font-medium text-xs text-gray-600 mb-1">战斗风格：</div>
                <div className="text-xs bg-gray-100 px-2 py-1 rounded inline-block">
                  {typeof data.fighting_style === 'string'
                    ? data.fighting_style
                    : data.fighting_style.value}
                </div>
              </div>
            )}

            {/* 法术 */}
            {data.selected_spells && data.selected_spells.length > 0 && (
              <div>
                <div className="font-medium text-xs text-gray-600 mb-1">法术：</div>
                <div className="text-xs text-gray-500">
                  共 {data.selected_spells.length} 个法术
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 底部按钮 */}
      <div className="mt-4 flex gap-2">
        <button
          onClick={() => {
            window.open(`/characters/${data.character_id}`, '_blank');
          }}
          className="flex-1 bg-blue-600 text-white px-3 py-2 rounded text-sm hover:bg-blue-700 transition-colors"
        >
          查看完整详情
        </button>
        <button
          onClick={onClose}
          className="px-3 py-2 bg-gray-200 text-gray-700 rounded text-sm hover:bg-gray-300 transition-colors"
        >
          关闭
        </button>
      </div>
    </div>
  );
}
```

**使用组件：**

```tsx
import { LevelUpNotification } from '~/components/notifications/LevelUpNotification';

export default function CampaignDMPage() {
  const [levelUpNotifications, setLevelUpNotifications] = useState<any[]>([]);

  useWebSocket({
    campaignId,
    userId,
    role: 'dm',
    onMessage: (message) => {
      if (message.type === 'character_level_up') {
        // 添加通知到队列
        setLevelUpNotifications(prev => [...prev, message.data]);

        // 10秒后自动关闭
        setTimeout(() => {
          setLevelUpNotifications(prev =>
            prev.filter(n => n.character_id !== message.data.character_id)
          );
        }, 10000);
      }
    }
  });

  return (
    <div>
      {/* DM界面 */}

      {/* 渲染升级通知 */}
      {levelUpNotifications.map((notification, index) => (
        <div
          key={notification.character_id}
          style={{ top: `${16 + index * 120}px` }}
        >
          <LevelUpNotification
            data={notification}
            onClose={() => {
              setLevelUpNotifications(prev =>
                prev.filter(n => n.character_id !== notification.character_id)
              );
            }}
          />
        </div>
      ))}
    </div>
  );
}
```

---

## 🎨 CSS 动画（可选）

**文件：** `frontend/app/styles/animations.css`

```css
@keyframes slide-in-right {
  from {
    transform: translateX(100%);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}

.animate-slide-in-right {
  animation: slide-in-right 0.3s ease-out;
}

@keyframes fade-out {
  from {
    opacity: 1;
  }
  to {
    opacity: 0;
  }
}

.animate-fade-out {
  animation: fade-out 0.3s ease-out;
}
```

---

## 📋 TypeScript 类型定义

**文件：** `frontend/app/types/websocket.ts`

```typescript
export interface CharacterLevelUpData {
  character_id: number;
  character_name: string;
  user_id: string;

  // Level and class
  level: number;
  class_id: string;
  subclass_id?: string;
  multiclass_data?: any;

  // Ability scores
  ability_scores: {
    strength: number;
    dexterity: number;
    constitution: number;
    intelligence: number;
    wisdom: number;
    charisma: number;
  };

  // HP
  current_hp?: number;
  max_hp: number;

  // Skills and proficiencies
  selected_skills: Array<string | { value: string; level_acquired: number; source: string }>;
  expertise_skills: Array<string | { value: string; level_acquired: number; source: string }>;

  // Class features
  fighting_style?: string | { value: string; level_acquired: number; source: string };
  favored_enemy?: string | { value: string; level_acquired: number; source: string };
  favored_terrain?: string | { value: string; level_acquired: number; source: string };
  eldritch_invocations?: Array<string | { value: string; level_acquired: number; source: string }>;

  // Spells
  selected_cantrips?: Array<string | { id: string; level_learned: number; source: string }>;
  selected_spells?: Array<string | { id: string; level_learned: number; source: string }>;
  prepared_spells?: string[];
  spell_slots_state?: number[];

  // Timestamp
  timestamp: string;
}

export interface WebSocketMessage {
  type: string;
  campaign_id?: string;
  data?: any;
}

export interface CharacterLevelUpMessage extends WebSocketMessage {
  type: 'character_level_up';
  data: CharacterLevelUpData;
}
```

---

## ✅ 实施检查清单

- [ ] 在DM页面添加 `character_level_up` 消息处理
- [ ] 实现角色列表自动更新（直接更新状态，无需fetch）
- [ ] 实现地图token自动更新
- [ ] 显示升级通知（Toast或弹窗）
- [ ] 可选：创建升级通知组件
- [ ] 可选：添加动画效果
- [ ] 测试：玩家升级后DM能实时看到所有数据
- [ ] 测试：多个玩家同时升级

---

## 🎯 预期效果

完成后，当玩家升级时，DM将：

1. ✅ **立即收到完整数据**（无需刷新或fetch）
2. ✅ **看到详细通知**（等级、属性、HP、技能等）
3. ✅ **角色列表自动更新**
4. ✅ **地图token自动更新**
5. ✅ **可点击查看完整详情**

**数据延迟：** < 100ms（WebSocket实时推送）

**无需操作：** DM不需要任何手动刷新或重新加载

---

## 📚 相关文档

- [WebSocket架构](../REALTIME_CHARACTER_SYNC.md)
- [升级系统改进计划](../LEVEL_UP_SYSTEM_IMPROVEMENTS.md)
- [后端API文档](../backend/app/api/README.md)

**最后更新：** 2025-01-20
