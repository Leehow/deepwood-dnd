/**
 * DM Dice Request Bubble Event System
 * 用于在 DM 头像旁显示骰子请求气泡
 */
import { publishAppEvent, subscribeAppEvent } from "~/events/appEventBus";

export interface DiceRequestBubble {
  requestId: string;
  messageId: string;
  checkType: 'check' | 'save' | 'contest';
  skill?: string;
  ability?: string;
  dc?: number;
  dice?: string;
  description?: string;
  isPrivate: boolean;
  timestamp: number;
}

// 事件名称
export const DM_DICE_REQUEST_EVENT = 'dmDiceRequest';
export const DM_DICE_REQUEST_RESPOND_EVENT = 'dmDiceRequestRespond';
export const DM_DICE_REQUEST_DISMISS_EVENT = 'dmDiceRequestDismiss';

/**
 * 触发骰子请求事件（显示气泡）
 */
export function showDiceRequestBubble(request: Omit<DiceRequestBubble, 'timestamp'>) {
  publishAppEvent(DM_DICE_REQUEST_EVENT, {
    ...request,
    timestamp: Date.now(),
  });
}

/**
 * 监听骰子请求事件
 */
export function onDiceRequestBubble(callback: (request: DiceRequestBubble) => void) {
  return subscribeAppEvent(DM_DICE_REQUEST_EVENT, callback);
}

export interface CompanionActor {
  type: "monster";
  monster_instance_id: number;
  name: string;
}

/**
 * 触发骰子响应事件（玩家点击投骰）
 */
export function triggerDiceRequestRespond(requestId: string, messageId: string, companionActor?: CompanionActor) {
  publishAppEvent(DM_DICE_REQUEST_RESPOND_EVENT, { requestId, messageId, companionActor });
}

/**
 * 监听骰子响应事件
 */
export function onDiceRequestRespond(callback: (data: { requestId: string; messageId: string; companionActor?: CompanionActor }) => void) {
  return subscribeAppEvent(DM_DICE_REQUEST_RESPOND_EVENT, callback);
}

/**
 * 触发忽略/取消骰子请求事件
 */
export function triggerDiceRequestDismiss(requestId: string) {
  publishAppEvent(DM_DICE_REQUEST_DISMISS_EVENT, { requestId });
}

/**
 * 监听忽略骰子请求事件
 */
export function onDiceRequestDismiss(callback: (data: { requestId: string }) => void) {
  return subscribeAppEvent(DM_DICE_REQUEST_DISMISS_EVENT, callback);
}
