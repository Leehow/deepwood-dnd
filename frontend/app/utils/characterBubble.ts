/**
 * Character Bubble Event System
 * 用于在角色头像旁显示消息气泡
 */
import { publishAppEvent, subscribeAppEvent } from "~/events/appEventBus";

export interface CharacterBubble {
  characterId: number | string;
  characterName: string;
  message: string;
  type: 'chat' | 'dice' | 'action' | 'combat';
  diceResult?: number;
  diceExpression?: string; // 如 "1d20", "2d6+3" 等
  messageId?: string; // 消息 ID，用于引用
  senderUserId?: string; // 发送者用户 ID
  avatarUrl?: string; // 角色/怪物头像 URL
  timestamp: number;
}

// 事件名称
export const CHARACTER_BUBBLE_EVENT = 'characterBubble';

/**
 * 触发角色气泡事件
 */
export function showCharacterBubble(bubble: Omit<CharacterBubble, 'timestamp'>) {
  publishAppEvent(CHARACTER_BUBBLE_EVENT, {
    ...bubble,
    timestamp: Date.now(),
  });
}

/**
 * 监听角色气泡事件
 */
export function onCharacterBubble(callback: (bubble: CharacterBubble) => void) {
  return subscribeAppEvent(CHARACTER_BUBBLE_EVENT, callback);
}

// 引用消息事件
export const REPLY_TO_MESSAGE_EVENT = 'replyToMessage';

export interface ReplyToMessagePayload {
  messageId: string;
  senderUserId: string;
  senderName: string;
  content: string;
}

/**
 * 触发回复消息事件（切换到聊天 tab 并设置引用）
 */
export function triggerReplyToMessage(payload: ReplyToMessagePayload) {
  publishAppEvent(REPLY_TO_MESSAGE_EVENT, payload);
}

/**
 * 监听回复消息事件
 */
export function onReplyToMessage(callback: (payload: ReplyToMessagePayload) => void) {
  return subscribeAppEvent(REPLY_TO_MESSAGE_EVENT, callback);
}

// 私信事件
export const START_PRIVATE_MESSAGE_EVENT = 'startPrivateMessage';

export interface StartPrivateMessagePayload {
  targetUserId: string;
  targetName: string;
}

/**
 * 触发私信事件（切换到聊天 tab 并设置私信对象）
 */
export function triggerStartPrivateMessage(payload: StartPrivateMessagePayload) {
  publishAppEvent(START_PRIVATE_MESSAGE_EVENT, payload);
}

/**
 * 监听私信事件
 */
export function onStartPrivateMessage(callback: (payload: StartPrivateMessagePayload) => void) {
  return subscribeAppEvent(START_PRIVATE_MESSAGE_EVENT, callback);
}
