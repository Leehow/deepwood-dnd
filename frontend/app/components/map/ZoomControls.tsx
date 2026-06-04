/**
 * ZoomControls Component
 * Displays zoom level, zoom control buttons, and player avatars with chat bubbles
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { onCharacterBubble, triggerReplyToMessage, type CharacterBubble } from '~/utils/characterBubble';
import {
  onDiceRequestBubble,
  triggerDiceRequestRespond,
  triggerDiceRequestDismiss,
  type DiceRequestBubble,
  type CompanionActor,
} from '~/utils/diceRequestBubble';
import { DiceIcon } from '~/components/ui/DiceIcons';
import { DMAvatarIcon } from '~/components/ui/DMAvatarIcon';
import { useVoiceStore } from '~/stores/voiceStore';

interface PlayerAvatar {
  id: number | string;  // character_id 或 monster_instance_id（带前缀 "m_"）
  name: string;
  avatar_url?: string;
  isOnline?: boolean;
  type?: 'player' | 'monster';  // 区分玩家角色和怪物
  userId?: number;  // 用户 ID，用于匹配语音参与者
}

interface ActiveBubble extends CharacterBubble {
  id: number;
}

interface ZoomControlsProps {
  stageScale: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onZoomSet?: (scale: number) => void;
  playerAvatars?: PlayerAvatar[];
  onAvatarClick?: (characterId: number | string) => void;
  isDM?: boolean;  // 是否是 DM，DM 不显示骰子请求气泡
  dmBubbleMessage?: string | null;  // DM action bubble message (monster actions)
  gridUnitLength?: number;  // 网格单位长度（英尺）
  onGridUnitLengthClick?: () => void;  // DM 点击修改网格单位
  rightOffset?: number;  // 右侧偏移（跟踪右侧面板宽度）
  playerCompanions?: Array<{
    monster_instance_id: number;
    name: string;
    control_type: string;
  }>;
}

// 技能名称映射
const SKILL_NAMES: Record<string, string> = {
  athletics: '运动', acrobatics: '体操', sleight_of_hand: '巧手', stealth: '隐匿',
  arcana: '奥秘', history: '历史', investigation: '调查', nature: '自然', religion: '宗教',
  animal_handling: '驯兽', insight: '洞悉', medicine: '医药', perception: '感知', survival: '求生',
  deception: '欺瞒', intimidation: '威吓', performance: '表演', persuasion: '游说',
};

// 属性名称映射
const ABILITY_NAMES: Record<string, string> = {
  strength: '力量', dexterity: '敏捷', constitution: '体质',
  intelligence: '智力', wisdom: '感知', charisma: '魅力',
  str: '力量', dex: '敏捷', con: '体质', int: '智力', wis: '感知', cha: '魅力',
};

export function ZoomControls({
  stageScale,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  onZoomSet,
  playerAvatars = [],
  onAvatarClick,
  isDM = false,
  dmBubbleMessage,
  gridUnitLength,
  onGridUnitLengthClick,
  rightOffset = 16,
  playerCompanions = [],
}: ZoomControlsProps) {
  const [bubbles, setBubbles] = useState<ActiveBubble[]>([]);
  const [diceRequestBubble, setDiceRequestBubble] = useState<DiceRequestBubble | null>(null);
  const [isEditingZoom, setIsEditingZoom] = useState(false);
  const [zoomInputValue, setZoomInputValue] = useState('');
  const [hotbarHeight, setHotbarHeight] = useState(0);
  const zoomInputRef = useRef<HTMLInputElement>(null);
  const bubbleIdRef = useRef(0);

  // 语音状态 - 使用 WebSocket 同步的全局语音用户列表
  const voiceUserIds = useVoiceStore((state) => state.voiceUserIds);
  const isUserInVoice = useCallback((userId?: number) => {
    if (!userId) return false;
    return voiceUserIds.includes(userId);
  }, [voiceUserIds]);

  // 监听角色气泡事件
  useEffect(() => {
    const unsubscribe = onCharacterBubble((bubble) => {
      bubbleIdRef.current += 1;
      const newId = bubbleIdRef.current;

      setBubbles(prev => {
        const filtered = prev.filter(b =>
          String(b.characterId) !== String(bubble.characterId)
        );
        return [...filtered, { ...bubble, id: newId }];
      });

      setTimeout(() => {
        setBubbles(prev => prev.filter(b => b.id !== newId));
      }, 3000);
    });

    return unsubscribe;
  }, []);

  // 监听骰子请求气泡事件（只有玩家显示）
  useEffect(() => {
    if (isDM) return;

    const unsubscribe = onDiceRequestBubble((request) => {
      setDiceRequestBubble(request);
    });

    return unsubscribe;
  }, [isDM]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const updateHotbarHeight = () => {
      const hotbarRoot = document.querySelector<HTMLElement>('[data-hotbar-root="true"]');
      if (!hotbarRoot) {
        setHotbarHeight(0);
        return;
      }
      const rect = hotbarRoot.getBoundingClientRect();
      setHotbarHeight(Math.max(0, Math.round(rect.height)));
    };

    updateHotbarHeight();

    const hotbarRoot = document.querySelector<HTMLElement>('[data-hotbar-root="true"]');
    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(updateHotbarHeight)
      : null;
    if (hotbarRoot && resizeObserver) {
      resizeObserver.observe(hotbarRoot);
    }

    const mutationObserver = new MutationObserver(updateHotbarHeight);
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'data-hotbar-root'],
    });

    window.addEventListener('resize', updateHotbarHeight);
    return () => {
      resizeObserver?.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener('resize', updateHotbarHeight);
    };
  }, []);

  // 处理投骰（角色自己）
  const handleDiceRoll = useCallback(() => {
    if (!diceRequestBubble) return;
    triggerDiceRequestRespond(diceRequestBubble.requestId, diceRequestBubble.messageId);
    setDiceRequestBubble(null);
  }, [diceRequestBubble]);

  // 处理伙伴投骰
  const handleCompanionDiceRoll = useCallback((companion: { monster_instance_id: number; name: string }) => {
    if (!diceRequestBubble) return;
    const companionActor: CompanionActor = {
      type: "monster",
      monster_instance_id: companion.monster_instance_id,
      name: companion.name,
    };
    triggerDiceRequestRespond(diceRequestBubble.requestId, diceRequestBubble.messageId, companionActor);
    setDiceRequestBubble(null);
  }, [diceRequestBubble]);

  // 处理忽略
  const handleDismiss = useCallback(() => {
    if (!diceRequestBubble) return;
    triggerDiceRequestDismiss(diceRequestBubble.requestId);
    setDiceRequestBubble(null);
  }, [diceRequestBubble]);

  const getBubbleForPlayer = useCallback((playerId: number | string) => {
    return bubbles.find(b => String(b.characterId) === String(playerId));
  }, [bubbles]);

  // 获取检定类型的中文名
  const getCheckTypeLabel = (checkType: string) => {
    switch (checkType) {
      case 'save': return '豁免';
      case 'contest': return '对抗';
      default: return '检定';
    }
  };

  return (
    <>
      {/* 右下角缩放控制区域 */}
      <div
        className="absolute z-[150] flex flex-wrap items-center justify-end gap-1.5 max-md:!right-2 transition-[bottom] duration-200"
        style={{
          right: rightOffset + 'px',
          bottom: `calc(16px + ${hotbarHeight}px + var(--sab,0px))`,
        }}
      >
        <button
          onClick={onZoomOut}
          className="w-8 h-8 max-md:w-6 max-md:h-6 bg-gray-800/90 hover:bg-gray-700 text-white rounded flex items-center justify-center transition-colors"
          title="缩小画布 (Zoom Out Canvas)"
          disabled={stageScale <= 0.1}
        >
          <span className="text-lg max-md:text-sm font-bold">−</span>
        </button>
        {isEditingZoom ? (
          <input
            ref={zoomInputRef}
            type="text"
            value={zoomInputValue}
            onChange={(e) => setZoomInputValue(e.target.value.replace(/[^0-9]/g, ''))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const val = parseInt(zoomInputValue, 10);
                if (val >= 10 && val <= 500 && onZoomSet) {
                  onZoomSet(val / 100);
                }
                setIsEditingZoom(false);
              } else if (e.key === 'Escape') {
                setIsEditingZoom(false);
              }
            }}
            onBlur={() => {
              const val = parseInt(zoomInputValue, 10);
              if (val >= 10 && val <= 500 && onZoomSet) {
                onZoomSet(val / 100);
              }
              setIsEditingZoom(false);
            }}
            className="bg-gray-700 text-white text-sm max-md:text-xs text-center rounded w-[70px] max-md:w-[54px] h-8 max-md:h-6 px-1 outline-none border border-gray-500 focus:border-amber-400"
            maxLength={3}
          />
        ) : (
          <button
            onClick={() => {
              if (onZoomSet) {
                setZoomInputValue(String(Math.round(stageScale * 100)));
                setIsEditingZoom(true);
                setTimeout(() => zoomInputRef.current?.select(), 0);
              }
            }}
            className="bg-gray-800/90 hover:bg-gray-700 px-3 max-md:px-1.5 py-1.5 max-md:py-0.5 rounded text-sm max-md:text-xs text-gray-300 min-w-[70px] max-md:min-w-[54px] text-center transition-colors cursor-pointer"
            title="点击输入缩放百分比"
          >
            {Math.round(stageScale * 100)}%
          </button>
        )}
        <button
          onClick={onZoomIn}
          className="w-8 h-8 max-md:w-6 max-md:h-6 bg-gray-800/90 hover:bg-gray-700 text-white rounded flex items-center justify-center transition-colors"
          title="放大画布 (Zoom In Canvas)"
          disabled={stageScale >= 5}
        >
          <span className="text-lg max-md:text-sm font-bold">+</span>
        </button>
        {gridUnitLength != null && (
          isDM && onGridUnitLengthClick ? (
            <button
              onClick={onGridUnitLengthClick}
              className="bg-gray-800/90 hover:bg-gray-700 px-2.5 max-md:px-1.5 py-1.5 max-md:py-0.5 rounded text-sm max-md:text-xs text-amber-400 hover:text-amber-300 transition-colors cursor-pointer"
              title="设置网格单位长度"
            >
              {gridUnitLength}尺
            </button>
          ) : (
            <div
              className="bg-gray-800/90 px-2.5 max-md:px-1.5 py-1.5 max-md:py-0.5 rounded text-sm max-md:text-xs text-gray-400"
              title={`每格 ${gridUnitLength} 尺`}
            >
              {gridUnitLength}尺
            </div>
          )
        )}
      </div>

      {/* 左下角头像列表 */}
      <div
        className="absolute left-2 z-[150] flex flex-col gap-1.5 items-center transition-[bottom] duration-200"
        style={{ bottom: `calc(16px + ${hotbarHeight}px + var(--sab,0px))` }}
      >
        {/* 角色头像（玩家 + 怪物） */}
        {playerAvatars.map((player) => {
          const bubble = getBubbleForPlayer(player.id);
          const isMonster = player.type === 'monster';
          return (
            <div
              key={player.id}
              className="relative group cursor-pointer"
              title={`${player.name}${isMonster ? '（怪物）' : ''}`}
              onClick={() => onAvatarClick?.(player.id)}
            >
              <div
                className={`w-10 h-10 rounded-full overflow-hidden border-2 ${
                  isMonster
                    ? 'border-red-500'
                    : player.isOnline ? 'border-green-500' : 'border-gray-600'
                } bg-gray-700 hover:border-amber-400 transition-colors`}
              >
                {player.avatar_url ? (
                  <img
                    src={player.avatar_url}
                    alt={player.name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-400 text-sm">
                    {player.name.charAt(0)}
                  </div>
                )}
              </div>
              {player.isOnline && (
                <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 rounded-full border-2 border-gray-900" />
              )}
              {/* 语音通话指示器 */}
              {isUserInVoice(player.userId) && (
                <div className="absolute -top-1 -left-1 w-4 h-4 bg-green-500 rounded-full border-2 border-gray-900 flex items-center justify-center">
                  <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                  </svg>
                </div>
              )}

              {/* 消息气泡 */}
              {bubble && (
                <div
                  className="absolute left-12 top-1/2 -translate-y-1/2 z-[260] animate-fade-in-slide cursor-pointer"
                  style={{ animationDuration: '0.2s' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (bubble.messageId && bubble.senderUserId) {
                      triggerReplyToMessage({
                        messageId: bubble.messageId,
                        senderUserId: bubble.senderUserId,
                        senderName: bubble.characterName,
                        content: bubble.message,
                      });
                    }
                  }}
                  title="点击引用回复"
                >
                  <div className={`
                    relative px-4 py-3 rounded-lg shadow-lg min-w-[200px] max-w-[450px]
                    hover:scale-105 transition-transform
                    ${bubble.type === 'dice'
                      ? 'bg-amber-600/95 border border-amber-400/50'
                      : bubble.type === 'action'
                      ? 'bg-purple-600/95 border border-purple-400/50'
                      : bubble.type === 'combat'
                      ? 'bg-red-700/95 border border-red-400/50'
                      : 'bg-gray-800/95 border border-gray-600/50'
                    }
                  `}>
                    <div className={`
                      absolute left-0 top-1/2 -translate-x-full -translate-y-1/2
                      border-8 border-transparent
                      ${bubble.type === 'dice'
                        ? 'border-r-amber-600/95'
                        : bubble.type === 'action'
                        ? 'border-r-purple-600/95'
                        : bubble.type === 'combat'
                        ? 'border-r-red-700/95'
                        : 'border-r-gray-800/95'
                      }
                    `} />

                    {bubble.type === 'dice' && bubble.diceResult !== undefined && (
                      <div className="flex items-center gap-2">
                        <DiceIcon
                          expression={bubble.diceExpression}
                          size={24}
                          className="text-white drop-shadow-lg"
                        />
                        <span className="text-2xl font-bold text-white drop-shadow-lg">
                          {bubble.diceResult}
                        </span>
                      </div>
                    )}

                    {bubble.type === 'combat' && (
                      <div className="flex items-center gap-2">
                        <span className="text-lg">⚔️</span>
                        <span className="text-sm font-semibold text-white">
                          {bubble.message}
                        </span>
                      </div>
                    )}

                    {bubble.type !== 'dice' && bubble.type !== 'combat' && (() => {
                      const msg = bubble.message;
                      const replyMatch = msg.match(/^> (.+?): .+?\n\n([\s\S]*)$/);
                      if (replyMatch) {
                        const [, replyTo, actualMessage] = replyMatch;
                        return (
                          <div className="text-sm text-white break-words">
                            <div className="text-xs text-gray-400 mb-1">回复 {replyTo}</div>
                            <div className="line-clamp-4">{actualMessage}</div>
                          </div>
                        );
                      }
                      return (
                        <div className="text-sm text-white line-clamp-4 break-words">
                          {msg}
                        </div>
                      );
                    })()}

                    {bubble.type === 'dice' && bubble.message && (
                      <div className="text-xs text-amber-100/80 mt-1 line-clamp-1">
                        {bubble.message}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {!bubble && (
              <div className="absolute left-12 top-1/2 -translate-y-1/2 z-[260] bg-gray-800 px-2 py-1 rounded text-xs text-white whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                  {player.name}
                </div>
              )}
            </div>
          );
        })}

        {/* DM 头像 */}
        <div
          className="relative group cursor-pointer"
          title="城主 (Dungeon Master)"
        >
          <div className={`w-10 h-10 rounded-full overflow-hidden border-2 transition-colors ${
            diceRequestBubble ? 'border-amber-400 animate-pulse' : 'border-amber-500 hover:border-amber-400'
          }`}>
            <DMAvatarIcon className="w-full h-full" />
          </div>

          {/* 骰子请求气泡 - 向上显示避免超出屏幕 */}
          {diceRequestBubble && (
            <div
              className="absolute left-12 bottom-0 z-[200] animate-fade-in-slide-up"
              style={{ animationDuration: '0.2s' }}
            >
              <div className="relative bg-gradient-to-r from-amber-900/95 to-amber-800/95 border border-amber-500/50 rounded-lg p-3 shadow-lg min-w-[180px] max-w-[280px]">
                {/* 气泡箭头 - 指向左下 */}
                <div className="absolute left-0 bottom-3 -translate-x-full border-8 border-transparent border-r-amber-900/95" />

                {/* 关闭按钮 */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDismiss();
                  }}
                  className="absolute -top-2 -right-2 w-5 h-5 bg-gray-700 hover:bg-gray-600 rounded-full flex items-center justify-center text-gray-400 hover:text-white text-xs transition-colors"
                  title="忽略"
                >
                  ✕
                </button>

                {/* 标题 */}
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-base">🎲</span>
                  <span className="font-semibold text-amber-300 text-sm">
                    请投{getCheckTypeLabel(diceRequestBubble.checkType)}
                  </span>
                  {diceRequestBubble.isPrivate && (
                    <span className="text-[10px] px-1 py-0.5 rounded bg-purple-500/30 text-purple-300 border border-purple-500/50">
                      🔒
                    </span>
                  )}
                </div>

                {/* 检定信息 */}
                <div className="flex flex-wrap items-center gap-1.5 mb-2">
                  {diceRequestBubble.skill && (
                    <span className="px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 border border-blue-500/40 text-xs font-medium">
                      {SKILL_NAMES[diceRequestBubble.skill] || diceRequestBubble.skill}
                    </span>
                  )}
                  {!diceRequestBubble.skill && diceRequestBubble.ability && (
                    <span className="px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 text-xs font-medium">
                      {ABILITY_NAMES[diceRequestBubble.ability] || diceRequestBubble.ability}
                    </span>
                  )}
                  {diceRequestBubble.dc != null && (
                    <span className="px-1.5 py-0.5 rounded bg-red-500/20 text-red-300 border border-red-500/40 text-xs font-medium">
                      DC {diceRequestBubble.dc}
                    </span>
                  )}
                </div>

                {/* 描述 */}
                {diceRequestBubble.description && (
                  <div className="text-xs text-gray-400 italic mb-2 line-clamp-2">
                    {diceRequestBubble.description}
                  </div>
                )}

                {/* 投骰按钮 */}
                <div className="flex flex-col gap-1.5">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDiceRoll();
                    }}
                    className="w-full py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition-colors flex items-center justify-center gap-1"
                  >
                    <DiceIcon
                      expression={diceRequestBubble.dice || '1d20'}
                      size={16}
                      className="text-white"
                    />
                    <span>投出 {diceRequestBubble.dice || '1d20'}</span>
                  </button>
                  {/* 伙伴投骰按钮 */}
                  {playerCompanions.map((comp) => (
                    <button
                      key={comp.monster_instance_id}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCompanionDiceRoll(comp);
                      }}
                      className="w-full py-1.5 rounded bg-amber-700 hover:bg-amber-600 text-white text-xs font-medium transition-colors flex items-center justify-center gap-1"
                    >
                      <span>🐾</span>
                      <span className="truncate">{comp.name}投骰</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* DM 行动气泡 - 怪物/NPC 行动时显示 */}
          {(dmBubbleMessage || getBubbleForPlayer("dm")) && !diceRequestBubble && (
            <div
              className="absolute left-12 top-1/2 -translate-y-1/2 z-[200] animate-fade-in-slide"
              style={{ animationDuration: '0.2s' }}
            >
              <div className={`relative rounded-lg px-4 py-3 shadow-lg min-w-[200px] max-w-[350px] ${
                dmBubbleMessage
                  ? 'bg-red-700/95 border border-red-400/50'
                  : 'bg-gray-800/95 border border-gray-600/50'
              }`}>
                {/* 气泡箭头 */}
                <div className={`absolute left-0 top-1/2 -translate-x-full -translate-y-1/2 border-8 border-transparent ${
                  dmBubbleMessage ? 'border-r-red-700/95' : 'border-r-gray-800/95'
                }`} />
                <div className="text-sm text-white break-words">
                  {dmBubbleMessage || getBubbleForPlayer("dm")?.message}
                </div>
              </div>
            </div>
          )}

          {/* Hover tooltip - 只在没有骰子请求和DM气泡时显示 */}
          {!diceRequestBubble && !dmBubbleMessage && !getBubbleForPlayer("dm") && (
            <div className="absolute left-12 top-1/2 -translate-y-1/2 bg-gray-800 px-2 py-1 rounded text-xs text-white whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
              城主
            </div>
          )}
        </div>
      </div>

      {/* 气泡动画样式 */}
      <style>{`
        @keyframes fade-in-slide {
          from {
            opacity: 0;
            transform: translateX(-10px) translateY(-50%);
          }
          to {
            opacity: 1;
            transform: translateX(0) translateY(-50%);
          }
        }
        .animate-fade-in-slide {
          animation: fade-in-slide 0.2s ease-out forwards;
        }
        @keyframes fade-in-slide-up {
          from {
            opacity: 0;
            transform: translateX(-10px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
        .animate-fade-in-slide-up {
          animation: fade-in-slide-up 0.2s ease-out forwards;
        }
      `}</style>
    </>
  );
}
