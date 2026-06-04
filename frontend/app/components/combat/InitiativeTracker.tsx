import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { publishAppEvent, subscribeAppEvent } from "~/events/appEventBus";
import type { Token } from "../map/types/TacticalMapTypes";
import { fetchCampaignCombatStateCached } from "~/utils/combatStateCache";
import { getAssetUrl } from "~/utils/asset-url";
import { getCombatTurnIndex } from "~/utils/combatTurnIndex";

interface InitiativeTrackerProps {
  isDM: boolean;
  campaignId: string;
  userId?: string;
  selectedCharacterId?: number | null;
  tokens: Token[];
}

interface CombatParticipant {
  token_id: number;
  name: string;
  faction: 1 | 2;
  initiative?: number;
}
interface CombatStateLite {
  status: "setup" | "in_progress" | "ended";
  order: number[];
  current_index?: number;
  current_turn_index?: number;
  participants: CombatParticipant[];
  round?: number;
  turn_actions?: { attacksUsed: number; bonusActionUsed: boolean; movementRemaining: number; movementMax: number };
  participant_turn_actions?: Record<number, { attacksUsed: number; bonusActionUsed: boolean; movementRemaining: number; movementMax: number }>;
}

// --------------- Audio ---------------
function playTurnChime() {
  try {
    const ctx = new AudioContext();
    const now = ctx.currentTime;
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.6);
    const osc1 = ctx.createOscillator();
    osc1.type = "sine"; osc1.frequency.value = 523.25;
    osc1.connect(gain); osc1.start(now); osc1.stop(now + 0.25);
    const osc2 = ctx.createOscillator();
    osc2.type = "sine"; osc2.frequency.value = 659.25;
    osc2.connect(gain); osc2.start(now + 0.2); osc2.stop(now + 0.55);
    setTimeout(() => ctx.close().catch(() => {}), 1000);
  } catch { /* silent */ }
}

function playCombatStartSound() {
  try {
    const ctx = new AudioContext();
    const now = ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const t = now + i * 0.25;
      const g = ctx.createGain();
      g.connect(ctx.destination);
      g.gain.setValueAtTime(0.4, t);
      g.gain.exponentialRampToValueAtTime(0.01, t + 0.2);
      const d = ctx.createOscillator();
      d.type = "sine"; d.frequency.setValueAtTime(80, t);
      d.frequency.exponentialRampToValueAtTime(40, t + 0.15);
      d.connect(g); d.start(t); d.stop(t + 0.2);
    }
    const hg = ctx.createGain();
    hg.connect(ctx.destination);
    hg.gain.setValueAtTime(0, now + 0.6);
    hg.gain.linearRampToValueAtTime(0.2, now + 0.75);
    hg.gain.exponentialRampToValueAtTime(0.01, now + 1.3);
    const h = ctx.createOscillator();
    h.type = "sawtooth"; h.frequency.setValueAtTime(440, now + 0.6);
    h.frequency.exponentialRampToValueAtTime(880, now + 1.0);
    h.connect(hg); h.start(now + 0.6); h.stop(now + 1.3);
    setTimeout(() => ctx.close().catch(() => {}), 2000);
  } catch { /* silent */ }
}

// --------------- Avatar helper ---------------
function resolveAvatarUrl(url: string | undefined | null): string | null {
  if (!url) return null;
  if (url.startsWith("/assets/")) return getAssetUrl(url.slice(1));
  return url;
}

function getTokenAvatar(token: Token | null, isDM: boolean): string | null {
  if (!token) return null;
  if (!isDM && token.disguise_data?.disguise_avatar) {
    return resolveAvatarUrl(token.disguise_data.disguise_avatar);
  }
  if (token.transformation_data && (token.transformation_data as any).avatar) {
    return resolveAvatarUrl((token.transformation_data as any).avatar);
  }
  return resolveAvatarUrl(token.avatar);
}

// --------------- Effect Icon (image with emoji fallback) ---------------
function EffectIconImg({ effect, size }: { effect: any; size: number }) {
  const [err, setErr] = useState(false);
  const url = useMemo(() => {
    const ip = effect.icon_path || effect.iconPath;
    if (ip) return resolveAvatarUrl(ip);
    const sid = effect.spell_id || effect.spellId || effect.sourceSpell || effect.source_spell;
    if (sid) return getAssetUrl(`assets/spell-icons/${sid.replace(/-/g, "_")}.png`);
    if (effect.condition) return getAssetUrl(`assets/condition-icons/${effect.condition}.png`);
    if (effect.id) return getAssetUrl(`assets/class-feature-icons/${effect.id}.png`);
    return null;
  }, [effect.id, effect.icon_path, effect.spell_id, effect.condition]);
  if (url && !err) {
    return <img src={url} className="rounded-full object-cover" style={{ width: size, height: size }} onError={() => setErr(true)} draggable={false} />;
  }
  return <span className="flex items-center justify-center leading-none" style={{ width: size, height: size, fontSize: size * 0.7 }}>{effect.icon || "●"}</span>;
}

// --------------- Condition combat effects (brief, combat-focused) ---------------
const CONDITION_COMBAT_DESC: Record<string, string> = {
  blinded: "攻击骰劣势；对你的攻击骰优势；无法看到目标",
  charmed: "不能攻击施术者；施术者社交检定优势",
  deafened: "自动失败需要听觉的检定",
  exhaustion: "累积6级：1级检定劣势→2级速度减半→3级攻击/豁免劣势→4级HP上限减半→5级速度0→6级死亡",
  frightened: "恐惧源可见时攻击骰/属性检定劣势；不能主动靠近恐惧源",
  grappled: "速度变为0；不受任何速度加成",
  incapacitated: "不能进行动作或反应",
  invisible: "隐形攻击优势；被攻击劣势（位置被发现仍可攻击）",
  paralyzed: "失能+力/敏豁免自动失败；被攻击优势；5尺内命中自动暴击",
  petrified: "失能+力/敏豁免自动失败；全伤害抗性；免疫毒素和疾病",
  poisoned: "攻击骰和属性检定劣势",
  prone: "只能匍匐移动（速度减半）；近战攻击劣势；5尺内被攻击优势，5尺外被攻击劣势",
  restrained: "速度0；攻击骰劣势；敏捷豁免劣势；被攻击优势",
  stunned: "失能+力/敏豁免自动失败；被攻击优势",
  unconscious: "失能+倒地；力/敏豁免自动失败；被攻击优势；5尺内命中自动暴击",
  silenced: "无法说话或施放需要言语成分(V)的法术",
  confused: "每回合随机行动；无法使用反应",
};

// --------------- InitiativeCard ---------------
function InitiativeCard({
  participant, token, isActive, isDead, isDM, showDetails, isMyTurn,
  showEndTurn, onEndTurn, canResetMovement, onResetMovement,
}: {
  participant: CombatParticipant;
  token: Token | null;
  isActive: boolean;
  isDead: boolean;
  isDM: boolean;
  showDetails: boolean;
  isMyTurn: boolean;
  showEndTurn: boolean;
  onEndTurn: () => void;
  canResetMovement: boolean;
  onResetMovement: () => void;
}) {
  const [effectsExpanded, setEffectsExpanded] = useState(false);
  const avatarRef = useRef<HTMLDivElement>(null);
  const [panelPos, setPanelPos] = useState<{ top: number; left: number } | null>(null);

  // Close expanded panel on outside click
  useEffect(() => {
    if (!effectsExpanded) return;
    const close = () => { setEffectsExpanded(false); setPanelPos(null); };
    const timer = setTimeout(() => window.addEventListener("click", close), 0);
    return () => { clearTimeout(timer); window.removeEventListener("click", close); };
  }, [effectsExpanded]);

  const toggleEffects = useCallback(() => {
    setEffectsExpanded((v) => {
      if (!v && avatarRef.current) {
        const rect = avatarRef.current.getBoundingClientRect();
        setPanelPos({ top: rect.bottom + 4, left: rect.left + rect.width / 2 });
      }
      return !v;
    });
  }, []);
  const isEnemy = participant.faction === 2;
  // Always show disguise/transformation appearance for everyone
  const avatarUrl = getTokenAvatar(token, false);
  // DM: small indicator showing the real avatar when disguised/transformed
  const hasDisguise = !!(token?.disguise_data?.disguise_avatar || (token?.transformation_data && (token.transformation_data as any).avatar));
  const realAvatarUrl = (isDM && hasDisguise) ? resolveAvatarUrl(token?.avatar) : null;
  const displayName = participant.name || token?.instance_name || token?.character_name || token?.monster_name_cn || "???";

  const maxHp = token?.max_hp ?? 0;
  const curHp = Math.max(0, token?.current_hp ?? 0);
  const hpPercent = maxHp > 0 ? Math.min(100, (curHp / maxHp) * 100) : 100;
  const hpColor = hpPercent > 50 ? "bg-green-500" : hpPercent > 25 ? "bg-yellow-500" : "bg-red-500";
  const hasTempHp = (token?.temp_hp ?? 0) > 0;

  // Status effects visible to all (physically observable); HP hidden from enemy faction
  const effects = token?.active_effects || [];
  const concentration = token?.concentration_spell || null;
  const initial = displayName.charAt(0);
  const borderColor = isEnemy ? "border-red-500/80" : "border-blue-400/80";
  const avatarSize = isActive ? 48 : 36; // px

  return (
    <div className="flex-shrink-0 flex flex-col items-center">
      <div
        className={[
          "relative flex flex-col items-center rounded-lg border px-1 pt-1.5 pb-1 transition-all duration-300",
          isActive
            ? `w-[72px] bg-gray-900/95 ${borderColor} ${isMyTurn ? "animate-[goldPulse_2s_ease-in-out_infinite]" : ""}`
            : `w-[58px] border-gray-600/40 bg-gray-800/90`,
          isDead && "opacity-40 grayscale",
        ].join(" ")}
        style={isActive ? {
          boxShadow: isEnemy ? "0 0 14px rgba(239,68,68,0.5)" : "0 0 14px rgba(96,165,250,0.5)",
          borderWidth: 2,
        } : undefined}
      >
        {/* Initiative badge — top-left corner */}
        {participant.initiative != null && (
          <span className="absolute top-0.5 left-0.5 text-[7px] text-gray-400 leading-none" title="先攻值">
            ⚡{participant.initiative}
          </span>
        )}

        {/* Avatar with overlapping effects */}
        <div ref={avatarRef} className="relative" style={{ width: avatarSize, height: avatarSize }}>
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={displayName}
              className={[
                "rounded-full object-cover border-2 w-full h-full",
                borderColor,
                isDead && "grayscale",
              ].filter(Boolean).join(" ")}
              draggable={false}
            />
          ) : (
            <div
              className={[
                "rounded-full flex items-center justify-center font-bold text-white border-2 w-full h-full",
                isActive ? "text-lg" : "text-sm",
                isEnemy ? "bg-red-800 border-red-500/80" : "bg-blue-800 border-blue-400/80",
              ].join(" ")}
            >
              {initial}
            </div>
          )}

          {/* Dead skull */}
          {isDead && (
            <span className="absolute inset-0 flex items-center justify-center text-lg drop-shadow-md">💀</span>
          )}

          {/* DM: real avatar indicator when disguised/transformed */}
          {realAvatarUrl && (
            <img
              src={realAvatarUrl}
              className="absolute -bottom-1 -right-1 rounded-full object-cover border border-gray-500/80 shadow-md"
              style={{ width: isActive ? 18 : 14, height: isActive ? 18 : 14 }}
              title="真实形象"
              draggable={false}
            />
          )}

          {/* Concentration badge — top-right of avatar */}
          {concentration && (
            <span
              className="absolute -top-1 -right-1 px-1 py-px rounded text-[7px] font-bold bg-purple-600 text-white leading-none border border-purple-400/60 shadow-[0_0_4px_rgba(168,85,247,0.6)] cursor-default"
              title={`专注: ${concentration.spell_name}`}
            >
              专注
            </span>
          )}

          {/* Status effect icons — stacked at bottom of avatar, clickable */}
          {effects.length > 0 && !isDead && (
            <div
              className="absolute -bottom-1 left-1/2 -translate-x-1/2 flex gap-px cursor-pointer"
              onClick={(e) => { e.stopPropagation(); toggleEffects(); }}
              title="点击查看状态效果"
            >
              {effects.slice(0, 3).map((eff: any, i: number) => (
                <span
                  key={eff.id ?? i}
                  className="w-[14px] h-[14px] rounded-full bg-gray-900/90 border border-gray-500/60 flex items-center justify-center overflow-hidden"
                  style={eff.color ? { borderColor: eff.color } : undefined}
                >
                  <EffectIconImg effect={eff} size={12} />
                </span>
              ))}
              {effects.length > 3 && (
                <span className="w-[14px] h-[14px] rounded-full bg-gray-900/90 border border-gray-500/60 flex items-center justify-center text-[7px] text-amber-400 font-bold leading-none">
                  +{effects.length - 3}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Effects expanded panel — rendered via portal to escape scroll overflow */}
        {effectsExpanded && effects.length > 0 && panelPos && createPortal(
          <div
            className="fixed z-[400] bg-gray-900/95 border border-gray-600 rounded-md p-1.5 shadow-xl min-w-[140px] max-w-[220px]"
            style={{ top: panelPos.top, left: panelPos.left, transform: "translateX(-50%)" }}
            onClick={(e) => e.stopPropagation()}
          >
            {effects.map((eff: any, i: number) => {
              const dur = eff.duration ?? eff.duration_rounds ?? eff.roundsRemaining;
              const condDesc = eff.condition ? CONDITION_COMBAT_DESC[eff.condition] : null;
              return (
                <div key={eff.id ?? i} className="py-0.5">
                  <div className="flex items-center gap-1">
                    <EffectIconImg effect={eff} size={14} />
                    <span className="text-[9px] text-gray-200 truncate flex-1">{eff.name}</span>
                    {dur != null && <span className="text-[8px] text-gray-400 flex-shrink-0">{dur}轮</span>}
                  </div>
                  {condDesc && (
                    <p className="text-[8px] text-amber-300/80 leading-tight mt-0.5 ml-[18px]">{condDesc}</p>
                  )}
                </div>
              );
            })}
            {concentration && (
              <div className="flex items-center gap-1 py-0.5 border-t border-gray-700 mt-0.5 pt-0.5">
                <span className="text-[10px] leading-none">🔮</span>
                <span className="text-[9px] text-purple-300 truncate flex-1">{concentration.spell_name}</span>
              </div>
            )}
          </div>,
          document.body,
        )}

        {/* Name */}
        <span
          className={[
            "w-full text-center truncate mt-1 leading-tight",
            isActive ? "text-[11px] text-gray-100 font-medium" : "text-[10px] text-gray-300",
          ].join(" ")}
          title={displayName}
        >
          {displayName}
        </span>

        {/* HP bar + value (faction-gated) */}
        {showDetails && maxHp > 0 && !isDead && (
          <div className="w-full mt-0.5">
            <div className={`w-full h-[3px] rounded-full overflow-hidden ${hasTempHp ? "bg-blue-900/60" : "bg-gray-700/80"}`}>
              <div
                className={`h-full rounded-full transition-all duration-500 ${hpColor}`}
                style={{ width: `${hpPercent}%` }}
              />
            </div>
            <span className="block text-center text-[8px] text-gray-400 leading-none mt-px">
              {curHp}/{maxHp}{hasTempHp ? <span className="text-cyan-400">+{token!.temp_hp}</span> : ""}
            </span>
          </div>
        )}
      </div>

      {/* Action buttons — same row: ↩移动 + 结束回合 */}
      {showEndTurn && isActive && !isDead && (
        <div className="flex items-center gap-1 mt-1">
          {canResetMovement && (
            <button
              onClick={onResetMovement}
              className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-sky-700/80 hover:bg-sky-600 text-white transition-colors whitespace-nowrap"
              title="撤回移动：回到回合开始位置，恢复全部移动力"
            >
              ↩移动
            </button>
          )}
          <button
            onClick={onEndTurn}
            className="px-2 py-0.5 rounded text-[10px] font-medium bg-amber-600/80 hover:bg-amber-500 text-white transition-colors whitespace-nowrap"
          >
            结束回合
          </button>
        </div>
      )}
    </div>
  );
}

// --------------- Main Component ---------------
export function InitiativeTracker({
  isDM, campaignId, userId, selectedCharacterId, tokens,
}: InitiativeTrackerProps) {
  const [combat, setCombat] = useState<CombatStateLite | null>(null);
  const [showMyTurnPulse, setShowMyTurnPulse] = useState(false);
  const [confirmEndTurn, setConfirmEndTurn] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const prevIsMyTurnRef = useRef(false);
  const prevStatusRef = useRef<string | null>(null);
  const prevActiveTokenIdRef = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Track turn-start position per token for movement reset
  const turnStartPosRef = useRef<Record<number, { x: number; y: number }>>({});

  // Subscribe to combat storage events
  useEffect(() => {
    const onUpdate = (obj: any) => {
      if (obj?.object_type === "combat" && obj?.object_id === "current") {
        setCombat(obj.data as CombatStateLite);
      }
    };
    const onDelete = (obj: any) => {
      if (!obj || obj.data?.object_type === "combat" || (obj.object_type === "combat" && obj.object_id === "current")) {
        setCombat(null);
      }
    };
    const unsubscribeStorageUpdated = subscribeAppEvent("combatStorageUpdated", onUpdate as any);
    const unsubscribeStorageDeleted = subscribeAppEvent("combatStorageDeleted", onDelete as any);
    return () => {
      unsubscribeStorageUpdated();
      unsubscribeStorageDeleted();
    };
  }, []);

  // Initial fetch
  useEffect(() => {
    if (!campaignId) return;
    fetchCampaignCombatStateCached(campaignId, { userId })
      .then((obj) => {
        if (obj?.is_active !== false && obj?.data?.status === "in_progress") {
          setCombat(obj.data as CombatStateLite);
        }
      })
      .catch(() => {});
  }, [campaignId]);

  // Derived data
  const activeTokenId = useMemo(() => {
    if (!combat?.order?.length) return null;
    const idx = getCombatTurnIndex(combat, combat.order.length);
    return combat.order[idx] ?? null;
  }, [combat]);

  const activeToken = useMemo(
    () => tokens.find((t) => t.id === activeTokenId) || null,
    [tokens, activeTokenId],
  );

  const isMyTurn = useMemo(() => {
    if (isDM) return false;
    if (!activeToken) return false;
    if (userId && activeToken.user_id === userId) return true;
    if (selectedCharacterId && activeToken.character_id === selectedCharacterId) return true;
    return false;
  }, [isDM, activeToken, userId, selectedCharacterId]);

  const myFaction = useMemo(() => {
    if (isDM) return null;
    const myToken = tokens.find(
      (t) =>
        (userId && t.user_id === userId) ||
        (selectedCharacterId && t.character_id === selectedCharacterId),
    );
    if (!myToken) return null;
    const myP = combat?.participants?.find((p) => p.token_id === myToken.id);
    return myP?.faction ?? null;
  }, [isDM, userId, selectedCharacterId, tokens, combat?.participants]);

  // Rotated order: active token first
  const rotatedParticipants = useMemo(() => {
    if (!combat?.order?.length) return [];
    const currentIdx = getCombatTurnIndex(combat, combat.order.length);
    const rotated = [
      ...combat.order.slice(currentIdx),
      ...combat.order.slice(0, currentIdx),
    ];
    return rotated
      .map((tokenId) => {
        const participant = combat.participants?.find((p) => p.token_id === tokenId);
        const token = tokens.find((t) => t.id === tokenId) ?? null;
        if (!participant) return null;
        const isDead = token?.current_hp != null && Number(token.current_hp) <= 0;
        return { tokenId, participant, token, isDead };
      })
      .filter(Boolean) as { tokenId: number; participant: CombatParticipant; token: Token | null; isDead: boolean }[];
  }, [combat, tokens]);

  // Record turn-start position ONLY when active token changes (new turn)
  // Do NOT depend on `tokens` — that would overwrite the saved start position on every token move
  useEffect(() => {
    if (!activeTokenId) return;
    const tok = tokens.find((t) => t.id === activeTokenId);
    if (tok) {
      turnStartPosRef.current = { [activeTokenId]: { x: tok.position_x, y: tok.position_y } };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTokenId]);

  // Check if reset movement is available: only movement used, no attacks/bonus actions
  const canResetMovement = useMemo(() => {
    if (!combat || !activeTokenId) return false;
    const ta = combat.turn_actions ?? combat.participant_turn_actions?.[activeTokenId];
    if (!ta) return false;
    // Must have used some movement
    if (ta.movementRemaining >= ta.movementMax) return false;
    // Must not have used attacks or bonus action
    if (ta.attacksUsed > 0 || ta.bonusActionUsed) return false;
    // Must have a saved start position different from current
    const startPos = turnStartPosRef.current[activeTokenId];
    if (!startPos) return false;
    const tok = tokens.find((t) => t.id === activeTokenId);
    if (!tok) return false;
    return tok.position_x !== startPos.x || tok.position_y !== startPos.y;
  }, [combat, activeTokenId, tokens]);

  // Sound effects
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = combat?.status ?? null;
    if (prev !== null && prev !== "in_progress" && combat?.status === "in_progress") {
      playCombatStartSound();
    }
  }, [combat?.status]);

  useEffect(() => {
    if (!combat || combat.status !== "in_progress" || !activeTokenId) return;
    const prevId = prevActiveTokenIdRef.current;
    prevActiveTokenIdRef.current = activeTokenId;
    setConfirmEndTurn(false);
    if (prevId !== null && prevId !== activeTokenId) {
      const participant = combat.participants?.find((p) => p.token_id === activeTokenId);
      if (participant) {
        publishAppEvent("combatTurnNotification", {
          name: participant.name,
          round: combat.round ?? 1,
        });
      }
    }
  }, [activeTokenId, combat]);

  useEffect(() => {
    const was = prevIsMyTurnRef.current;
    prevIsMyTurnRef.current = isMyTurn;
    if (!was && isMyTurn) {
      playTurnChime();
      setShowMyTurnPulse(true);
    } else if (was && !isMyTurn) {
      setShowMyTurnPulse(false);
    }
  }, [isMyTurn]);

  // Handlers
  const handleEndTurnClick = useCallback(() => setConfirmEndTurn(true), []);
  const handleEndTurnConfirm = useCallback(() => {
    setConfirmEndTurn(false);
    publishAppEvent("combatEndTurn", { source: "initiative-tracker" });
  }, []);
  const handleEndTurnCancel = useCallback(() => setConfirmEndTurn(false), []);

  const handleResetMovement = useCallback(() => {
    if (!activeTokenId || !combat) return;
    const startPos = turnStartPosRef.current[activeTokenId];
    if (!startPos) return;
    const ta = combat.turn_actions ?? combat.participant_turn_actions?.[activeTokenId];
    const usedMovement = ta ? ta.movementMax - ta.movementRemaining : 0;
    if (usedMovement <= 0) return;
    publishAppEvent("combatRestoreMovement", {
      tokenId: activeTokenId,
      toX: startPos.x,
      toY: startPos.y,
      restoreDistance: usedMovement,
    });
  }, [activeTokenId, combat]);

  const combatActive = combat?.status === "in_progress";
  const round = combat?.round ?? 1;

  if (!combatActive) return null;

  return (
    <div
      className="pointer-events-none fixed top-0 left-0 right-0 z-[300] flex justify-center"
      style={{ animation: "initTrackerSlideDown 0.4s ease-out", paddingTop: collapsed ? "6px" : "42px" }}
    >
      <style>{`
        @keyframes initTrackerSlideDown {
          from { transform: translateY(-100%); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        @keyframes goldPulse {
          0%, 100% { box-shadow: 0 0 12px rgba(245, 158, 11, 0.4); }
          50% { box-shadow: 0 0 20px rgba(245, 158, 11, 0.7); }
        }
      `}</style>

      <div
        ref={scrollRef}
        className="pointer-events-auto flex items-start gap-1.5 overflow-x-auto px-3 pb-1 max-w-[90vw]"
        style={{
          scrollbarWidth: "thin",
          scrollbarColor: "#4b5563 transparent",
          maskImage: "linear-gradient(to right, transparent 0, black 16px, black calc(100% - 16px), transparent 100%)",
          WebkitMaskImage: "linear-gradient(to right, transparent 0, black 16px, black calc(100% - 16px), transparent 100%)",
        }}
      >
        {/* Round badge + collapse toggle */}
        {collapsed ? (
          <button
            onClick={() => setCollapsed(false)}
            className="flex-shrink-0 pointer-events-auto flex items-center gap-1 px-2 py-1 rounded-full bg-gray-900/90 border border-gray-600/50 hover:border-amber-500/50 transition-colors"
            title="展开先攻条"
          >
            <span className="text-xs font-bold text-amber-300">⚔ {round}</span>
            <span className="text-[8px] text-gray-400">▼</span>
          </button>
        ) : (
          <div className="flex-shrink-0 flex flex-col items-center justify-center px-2 py-1.5 min-w-[44px] rounded-lg bg-gray-900/90 border border-gray-600/50">
            <span className="text-[9px] text-gray-300 leading-none font-medium tracking-wider">ROUND</span>
            <span className="text-xl font-bold text-amber-300 leading-none mt-1 drop-shadow-[0_0_6px_rgba(245,158,11,0.5)]">{round}</span>
            <button
              onClick={() => setCollapsed(true)}
              className="mt-1 text-[9px] text-gray-400 hover:text-gray-200 transition-colors"
              title="收起先攻条"
            >
              ▲ 收起
            </button>
          </div>
        )}

        {/* Participant cards — hidden when collapsed */}
        {!collapsed && rotatedParticipants.map(({ tokenId, participant, token, isDead }, idx) => {
          const showDetails = isDM || myFaction === participant.faction;
          const isActive = idx === 0;
          const canEnd = isActive && (isDM || (isMyTurn && idx === 0));
          return (
            <InitiativeCard
              key={tokenId}
              participant={participant}
              token={token}
              isActive={isActive}
              isDead={isDead}
              isDM={isDM}
              showDetails={showDetails}
              isMyTurn={isActive && showMyTurnPulse}
              showEndTurn={canEnd}
              onEndTurn={handleEndTurnClick}
              canResetMovement={isActive && canEnd && canResetMovement}
              onResetMovement={handleResetMovement}
            />
          );
        })}
      </div>

      {/* End Turn confirmation */}
      {confirmEndTurn && (
        <div className="pointer-events-auto fixed inset-0 z-[400] flex items-center justify-center bg-black/40">
          <div className="bg-gray-800 border border-gray-600 rounded-xl p-5 shadow-2xl flex flex-col items-center gap-3 min-w-[220px]">
            <span className="text-sm text-gray-200">确认结束当前回合？</span>
            <div className="flex gap-3">
              <button
                onClick={handleEndTurnConfirm}
                className="px-4 py-1.5 rounded-lg text-sm font-medium bg-amber-600 hover:bg-amber-500 text-white transition-colors"
              >
                确认
              </button>
              <button
                onClick={handleEndTurnCancel}
                className="px-4 py-1.5 rounded-lg text-sm font-medium bg-gray-600 hover:bg-gray-500 text-gray-200 transition-colors"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
