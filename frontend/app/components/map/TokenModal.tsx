/**
 * TokenModal
 * Modal view for player interactions with tokens (and fallback for DM).
 * DM now primarily uses FloatingTokenPanel; this modal is kept for player use.
 */
import { useEffect, useMemo, useState, useCallback } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import type { Token, AuraVisual } from './types/TacticalMapTypes';
import type { CharacterSheet, SpellSlot } from '~/types';
import { publishAppEvent } from '~/events/appEventBus';
import { characterService } from '~/services/character.service';
import { chatService } from '~/services/chat.service';
import { apiFetch } from '~/utils/api-client';
import { createLogger } from '~/utils/logger';
import { SpellDetailModal } from '~/components/spell/SpellSelectableCard';
import { TokenStatsTab } from './TokenStatsTab';

const logger = createLogger('TokenModal');

interface ActiveEffect {
  id: string; name: string; icon?: string; color?: string;
  duration?: number | { persistent: true };
}

interface Props {
  token: Token | null;
  isOpen: boolean;
  onClose: () => void;
  isDM: boolean;
  campaignId: string;
  currentUserId?: string;
  selectedCharacterId?: number | null;
  activeEffects?: ActiveEffect[];
  onRemoveEffect?: (effectId: string) => void;
  onEscapeAttempt?: (tokenId: number, effectId: string) => void;
  onOngoingSave?: (tokenId: number, effectId: string) => void;
  onConditionSave?: (tokenId: number, effectId: string) => void;
  onWakeUp?: (tokenId: number, effectId: string) => void;
  onStandUp?: (tokenId: number, effectId: string) => void;
  auraVisuals?: AuraVisual[];
  setEditingTokenId: (id: number | null) => void;
  setEditingTokenHP: (hp: number) => void;
  onUpdateHP: () => Promise<void>;
  onDeleteToken: (tokenId?: number) => Promise<void>;
}

export function TokenModal(props: Props) {
  const {
    token, isOpen, onClose, isDM, campaignId, currentUserId, selectedCharacterId,
    activeEffects = [], onRemoveEffect, onEscapeAttempt, onOngoingSave, onConditionSave, onWakeUp, onStandUp,
    auraVisuals = [], onDeleteToken,
  } = props;

  const authedFetch = useCallback(
    (input: RequestInfo | URL, init?: RequestInit) =>
      apiFetch(input, { ...init, userId: currentUserId }),
    [currentUserId]
  );

  const [actorSheet, setActorSheet] = useState<CharacterSheet | null>(null);
  const [spellDetail, setSpellDetail] = useState<SpellSlot | null>(null);
  const [improviseText, setImproviseText] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const isSelf = useMemo(() => {
    if (!token) return false;
    if (currentUserId && token.user_id && token.user_id === currentUserId) return true;
    if (selectedCharacterId && token.character_id && token.character_id === selectedCharacterId) return true;
    return false;
  }, [token, currentUserId, selectedCharacterId]);

  const selfOrDM = isSelf || isDM;

  const displayName = useMemo(() => {
    if (!token) return '';
    return token.instance_name || token.character_name || token.monster_name || `Token#${token.id}`;
  }, [token]);

  const avatarUrl = token?.avatar || undefined;

  // Fetch actor sheet for player interactions with other tokens
  useEffect(() => {
    if (selfOrDM || !selectedCharacterId || !isOpen) { setActorSheet(null); return; }
    let cancelled = false;
    characterService.getCharacterSheet(selectedCharacterId).then(sheet => {
      if (!cancelled) setActorSheet(sheet);
    }).catch(e => logger.error('Failed to fetch actor sheet:', e));
    return () => { cancelled = true; };
  }, [selfOrDM, selectedCharacterId, isOpen]);

  useEffect(() => { setShowDeleteConfirm(false); }, [token?.id]);

  const close = () => { setSpellDetail(null); onClose(); };

  const sendChat = async (content: string) => {
    try {
      await chatService.sendMessage(campaignId, { content, message_type: 'system' }, currentUserId, isDM ? 'dm' : 'player');
    } catch (e) { logger.error('Failed to send chat:', e); }
  };

  const handleAction = async (category: string, name: string) => {
    if (!token) return;
    await sendChat(`【${category}】你 对 ${displayName} 发起：${name}`);
    publishAppEvent("openRightPanelTab", { tab: "chat" });
  };

  const handleImprovise = async () => {
    if (!token || !improviseText.trim()) return;
    await sendChat(`【即兴】你 对 ${displayName}：${improviseText.trim()}`);
    setImproviseText('');
  };

  const handleCastSpell = async (spell: SpellSlot) => {
    if (!token) return;
    await sendChat(`【施法】你 对 ${displayName} 施放：${spell.name}`);
    setSpellDetail(null);
  };

  const deleteToken = async () => {
    if (!token) return;
    try { await onDeleteToken(token.id); setShowDeleteConfirm(false); onClose(); }
    catch (e) { logger.error('Delete token failed:', e); }
  };

  const spellsForActor = selfOrDM ? [] : (actorSheet?.character.spells || []);
  const preparedSpells = spellsForActor.filter((s) => s.prepared === true);
  const showSpells = preparedSpells.length > 0 ? preparedSpells : spellsForActor;

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && close()} modal={false}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[9998]" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-gradient-to-b from-slate-900 to-slate-950 border border-slate-700/50 rounded-xl shadow-2xl w-[92vw] max-w-3xl max-h-[88dvh] overflow-hidden z-[9999]">
          {/* Header */}
          <div className="relative px-5 py-4 border-b border-slate-700/50 bg-slate-800/30">
            <Dialog.Title className="flex items-center gap-4">
              {avatarUrl && (
                <div className="relative">
                  <img src={avatarUrl} alt={displayName} className="w-14 h-14 rounded-lg object-cover ring-2 ring-amber-500/30" />
                  <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-green-500 rounded-full border-2 border-slate-900" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="text-xl font-bold text-amber-400 truncate">
                  {displayName}
                  {isDM && token && (
                    <span className="ml-2 text-xs font-normal text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded">
                      #{token.id}
                      {token.character_id && ` · char:${token.character_id}`}
                      {token.monster_instance_id && ` · monster:${token.monster_instance_id}`}
                    </span>
                  )}
                </div>
                {token?.instance_name && token.instance_name !== displayName && (
                  <div className="text-sm text-slate-400">{token.character_name || token.monster_name}</div>
                )}
              </div>
            </Dialog.Title>
            <div className="absolute top-4 right-4 flex items-center gap-2">
              {isDM && (
                <button
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${showDeleteConfirm ? 'bg-red-600 text-white' : 'bg-red-600/20 hover:bg-red-600/40 text-red-400 hover:text-red-300'}`}
                  onClick={() => showDeleteConfirm ? deleteToken() : setShowDeleteConfirm(true)}
                  onBlur={() => setShowDeleteConfirm(false)} title="移除此Token"
                >
                  {showDeleteConfirm ? '确认移除？' : '移除'}
                </button>
              )}
              <Dialog.Close className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg bg-slate-700/50 hover:bg-slate-600/50 text-slate-400 hover:text-white transition-colors">✕</Dialog.Close>
            </div>
          </div>

          {/* Content */}
          <div className="p-5 space-y-4 max-h-[calc(88dvh-140px)] overflow-y-auto">
            {selfOrDM ? (
              /* DM/Self: use extracted TokenStatsTab */
              <TokenStatsTab
                token={token} isDM={isDM} campaignId={campaignId}
                currentUserId={currentUserId} selectedCharacterId={selectedCharacterId}
                activeEffects={activeEffects} onRemoveEffect={onRemoveEffect}
                onEscapeAttempt={onEscapeAttempt} onOngoingSave={onOngoingSave} onConditionSave={onConditionSave} onWakeUp={onWakeUp} onStandUp={onStandUp}
                auraVisuals={auraVisuals} onDeleteToken={onDeleteToken} onClose={close}
              />
            ) : (
              /* Player interacting with other token: action buttons */
              <div className="space-y-4">
                <details open className="bg-slate-800/50 rounded-lg border border-slate-700/30 overflow-hidden">
                  <summary className="cursor-pointer px-4 py-2.5 text-amber-400 font-medium flex items-center gap-2 hover:bg-slate-700/30 transition-colors">普通动作</summary>
                  <div className="p-3 grid grid-cols-2 md:grid-cols-3 gap-2">
                    {[{ name: '打招呼', key: 'greet' },{ name: '对话', key: 'talk' },{ name: '赠送物品', key: 'give' },{ name: '偷窃', key: 'steal' },{ name: '鼓励', key: 'encourage' }].map(action => (
                      <button key={action.name} className="relative px-2 py-8 rounded text-white text-sm font-bold shadow-lg overflow-hidden group transition-transform hover:scale-105"
                        style={{ backgroundImage: `url(/images/action-buttons/${action.key}.png)`, backgroundSize: 'cover', backgroundPosition: 'center' }}
                        onClick={() => handleAction('普通动作', action.name)}>
                        <div className="absolute inset-0 bg-black/40 group-hover:bg-black/20 transition-colors" />
                        <span className="relative z-10 drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">{action.name}</span>
                      </button>
                    ))}
                  </div>
                </details>

                <details open className="bg-slate-800/50 rounded-lg border border-slate-700/30 overflow-hidden">
                  <summary className="cursor-pointer px-4 py-2.5 text-amber-400 font-medium flex items-center gap-2 hover:bg-slate-700/30 transition-colors">战斗动作</summary>
                  <div className="p-3 grid grid-cols-2 md:grid-cols-3 gap-2">
                    {[{ name: '攻击', key: 'attack' },{ name: '冲刺', key: 'dash' },{ name: '脱离', key: 'disengage' },{ name: '闪避', key: 'dodge' },{ name: '躲藏', key: 'hide' },{ name: '准备', key: 'ready' },{ name: '搜寻', key: 'search' },{ name: '使用物品', key: 'use-item' }].map(action => (
                      <button key={action.name} className="relative px-2 py-8 rounded text-white text-sm font-bold shadow-lg overflow-hidden group transition-transform hover:scale-105"
                        style={{ backgroundImage: `url(/images/action-buttons/${action.key}.png)`, backgroundSize: 'cover', backgroundPosition: 'center' }}
                        onClick={() => handleAction('战斗动作', action.name)}>
                        <div className="absolute inset-0 bg-black/40 group-hover:bg-black/20 transition-colors" />
                        <span className="relative z-10 drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">{action.name}</span>
                      </button>
                    ))}
                  </div>
                  <div className="p-3 flex items-center gap-2">
                    <input className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-white" placeholder="即兴动作内容"
                      value={improviseText} onChange={(e) => setImproviseText(e.target.value)} />
                    <button className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-white text-sm" onClick={handleImprovise}>即兴动作</button>
                  </div>
                </details>

                {actorSheet?.actions?.some(a => a.action_type === 'bonus_action') && (
                  <details className="bg-slate-800/50 rounded-lg border border-slate-700/30 overflow-hidden">
                    <summary className="cursor-pointer px-4 py-2.5 text-amber-400 font-medium flex items-center gap-2 hover:bg-slate-700/30 transition-colors">附赠动作</summary>
                    <div className="p-3 grid grid-cols-1 md:grid-cols-2 gap-2">
                      {actorSheet.actions.filter(a => a.action_type === 'bonus_action').map(a => (
                        <button key={a.id} className="text-left px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-white text-sm"
                          onClick={() => handleAction('附赠动作', a.name)}>{a.name}</button>
                      ))}
                    </div>
                  </details>
                )}

                {showSpells.length > 0 && (
                  <details className="bg-slate-800/50 rounded-lg border border-slate-700/30 overflow-hidden">
                    <summary className="cursor-pointer px-4 py-2.5 text-amber-400 font-medium flex items-center gap-2 hover:bg-slate-700/30 transition-colors">施法</summary>
                    <div className="p-3 grid grid-cols-1 md:grid-cols-2 gap-2">
                      {showSpells.map((s, idx) => (
                        <button key={idx} className="text-left text-sm text-slate-300 hover:text-white bg-slate-900/50 rounded-lg p-3 border border-slate-700/20"
                          onClick={() => setSpellDetail(s)}>
                          <div className="text-white font-medium">{s.name}</div>
                          <div className="text-xs text-slate-400">{s.school} · {s.casting_time} · {s.range}</div>
                        </button>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            )}
          </div>

          <SpellDetailModal
            spell={spellDetail ? { ...spellDetail, id: spellDetail.name, castingTime: spellDetail.casting_time } : null}
            onClose={() => setSpellDetail(null)}
            zOverlay="z-[10000]" zContent="z-[10001]"
            actions={spellDetail && (
              <div className="flex justify-end gap-2 px-5 py-3 flex-shrink-0"
                style={{ background: 'linear-gradient(135deg, #2e2519, #342a20, #2b2319)', borderTop: '1px solid rgba(180,120,40,0.15)' }}>
                <button className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 rounded-lg text-white font-medium transition-colors" onClick={() => handleCastSpell(spellDetail)}>释放</button>
                <button className="px-4 py-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-white font-medium transition-colors" onClick={() => setSpellDetail(null)}>关闭</button>
              </div>
            )}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
