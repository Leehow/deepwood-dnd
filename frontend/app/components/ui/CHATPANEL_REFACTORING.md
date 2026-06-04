# ChatPanel.tsx 重构指南

## 重构概述

将 `ChatPanel.tsx`（1675行，24个hooks）拆分为以下模块：

### 拆分计划

#### 1. 自定义 Hooks

**useChatMessages.ts** (~150行)
- 消息状态管理
- loadDiceRollHistory
- handleScroll (分页)
- deleteMessageById
- clearChat

**useDiceRolls.ts** (~100行)
- 骰子状态管理
- clearDiceResults
- 骰子历史记录

**useRestActions.ts** (~100行)
- 休息操作
- takeRestFromMessage
- loadMapTokens

**useMessageEdit.ts** (~80行)
- 消息编辑状态
- saveEdit
- generateAiDc

#### 2. 子组件

**ChatMessageList.tsx** (~200行)
- 消息列表渲染
- 滚动处理
- 消息分组

**ChatInput.tsx** (~150行)
- 输入框
- 发送按钮
- 图片上传

**DiceRollPanel.tsx** (~200行)
- 骰子掷骰界面
- 骰子历史
- 骰子结果显示

**RestActionPanel.tsx** (~150行)
- 休息操作按钮
- 角色选择
- 休息结果

**ChatMessageItem.tsx** (~150行)
- 单条消息渲染
- 编辑功能
- AI DC生成

**ChatHeader.tsx** (~80行)
- 标题栏
- 清除按钮
- 设置

## 文件结构

```
app/components/chat/
├── ChatPanel.tsx (主组件 ~300行)
├── ChatMessageList.tsx
├── ChatMessageItem.tsx
├── ChatInput.tsx
├── ChatHeader.tsx
├── DiceRollPanel.tsx
├── RestActionPanel.tsx
├── hooks/
│   ├── useChatMessages.ts
│   ├── useDiceRolls.ts
│   ├── useRestActions.ts
│   └── useMessageEdit.ts
└── index.ts
```

## 重构步骤

### 步骤1：提取自定义Hooks

```typescript
// hooks/useChatMessages.ts
export function useChatMessages(campaignId: string) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  const loadDiceRollHistory = useCallback(async () => {
    // ... 原代码
  }, [campaignId]);

  const handleScroll = useCallback(async () => {
    // ... 原代码
  }, [/* deps */]);

  return {
    messages,
    isLoading,
    hasMore,
    loadDiceRollHistory,
    handleScroll,
    // ...
  };
}
```

### 步骤2：提取子组件

```typescript
// ChatMessageList.tsx
interface ChatMessageListProps {
  messages: Message[];
  onScroll: () => void;
  onEdit: (id: number) => void;
  onDelete: (id: number) => void;
}

export function ChatMessageList({ messages, onScroll, onEdit, onDelete }: ChatMessageListProps) {
  return (
    <div onScroll={onScroll}>
      {messages.map(msg => (
        <ChatMessageItem
          key={msg.id}
          message={msg}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}
```

### 步骤3：重构主组件

```typescript
// ChatPanel.tsx
export function ChatPanel({ isDM, campaignId, userId, currentMapUrl }: ChatPanelProps) {
  // 使用自定义hooks
  const { messages, loadDiceRollHistory, handleScroll } = useChatMessages(campaignId);
  const { diceResults, clearDiceResults } = useDiceRolls(campaignId);
  const { takeRest, loadMapTokens } = useRestActions(campaignId);

  return (
    <div className="chat-panel">
      <ChatHeader onClear={clearChat} />
      <ChatMessageList
        messages={messages}
        onScroll={handleScroll}
      />
      <DiceRollPanel results={diceResults} onClear={clearDiceResults} />
      <ChatInput onSend={sendMessage} />
    </div>
  );
}
```

## 性能优化

1. **React.memo** - 对子组件使用memo减少重渲染
2. **useCallback** - 稳定回调函数引用
3. **useMemo** - 缓存计算结果
4. **虚拟列表** - 对长消息列表使用虚拟化

## 测试策略

1. 为每个hook编写单元测试
2. 为每个子组件编写组件测试
3. 集成测试验证完整流程

## 注意事项

1. 保持WebSocket连接的正确处理
2. 确保消息状态同步
3. 维护滚动位置
4. 处理并发请求
