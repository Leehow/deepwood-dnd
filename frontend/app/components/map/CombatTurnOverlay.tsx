import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Token } from "./types/TacticalMapTypes";
import { fetchCampaignCombatStateCached } from "~/utils/combatStateCache";
import { getCombatTurnIndex } from "~/utils/combatTurnIndex";
import { showGlobalToast } from "../ui/Toast";
import { publishAppEvent, subscribeAppEvent } from "~/events/appEventBus";

interface CombatTurnOverlayProps {
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
}
interface CombatStateLite {
  status: "setup" | "in_progress" | "ended";
  order: number[];
  current_index?: number;
  current_turn_index?: number;
  participants: CombatParticipant[];
  round?: number;
}

// --------------- Audio: turn chime (Web Audio API) ---------------
function playTurnChime() {
  try {
    const ctx = new AudioContext();
    const now = ctx.currentTime;

    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.6);

    // Note 1: C5 (523 Hz)
    const osc1 = ctx.createOscillator();
    osc1.type = "sine";
    osc1.frequency.value = 523.25;
    osc1.connect(gain);
    osc1.start(now);
    osc1.stop(now + 0.25);

    // Note 2: E5 (659 Hz)
    const osc2 = ctx.createOscillator();
    osc2.type = "sine";
    osc2.frequency.value = 659.25;
    osc2.connect(gain);
    osc2.start(now + 0.2);
    osc2.stop(now + 0.55);

    setTimeout(() => ctx.close().catch(() => {}), 1000);
  } catch {
    // Silent failure - browser may block audio
  }
}

// --------------- Audio: combat start war drum (Web Audio API) ---------------
function playCombatStartSound() {
  try {
    const ctx = new AudioContext();
    const now = ctx.currentTime;

    // Low drum hits (80Hz)
    for (let i = 0; i < 3; i++) {
      const t = now + i * 0.25;
      const drumGain = ctx.createGain();
      drumGain.connect(ctx.destination);
      drumGain.gain.setValueAtTime(0.4, t);
      drumGain.gain.exponentialRampToValueAtTime(0.01, t + 0.2);

      const drum = ctx.createOscillator();
      drum.type = "sine";
      drum.frequency.setValueAtTime(80, t);
      drum.frequency.exponentialRampToValueAtTime(40, t + 0.15);
      drum.connect(drumGain);
      drum.start(t);
      drum.stop(t + 0.2);
    }

    // Horn sweep (440Hz → 880Hz)
    const hornGain = ctx.createGain();
    hornGain.connect(ctx.destination);
    hornGain.gain.setValueAtTime(0, now + 0.6);
    hornGain.gain.linearRampToValueAtTime(0.2, now + 0.75);
    hornGain.gain.exponentialRampToValueAtTime(0.01, now + 1.3);

    const horn = ctx.createOscillator();
    horn.type = "sawtooth";
    horn.frequency.setValueAtTime(440, now + 0.6);
    horn.frequency.exponentialRampToValueAtTime(880, now + 1.0);
    horn.connect(hornGain);
    horn.start(now + 0.6);
    horn.stop(now + 1.3);

    setTimeout(() => ctx.close().catch(() => {}), 2000);
  } catch {
    // Silent failure
  }
}

function getTokenTypeLabel(token: Token, tokens: Token[]): string {
  if (token.control_type) {
    const controller = token.controller_character_id
      ? tokens.find(t => t.character_id === token.controller_character_id)
      : null;
    const typeMap: Record<string, string> = {
      companion: "伙伴", familiar: "魔宠", summon: "召唤物", mount: "坐骑",
    };
    const typeName = typeMap[token.control_type] || token.control_type;
    return controller?.character_name ? `${controller.character_name}的${typeName}` : typeName;
  }
  if (token.entity_type === "npc") return "NPC";
  if (token.monster_instance_id) return "怪物";
  if (token.character_id) return token.user_id ? "玩家" : "虚拟角色";
  return "";
}

export function CombatTurnOverlay({
  isDM,
  campaignId,
  userId,
  selectedCharacterId,
  tokens,
}: CombatTurnOverlayProps) {
  const [combat, setCombat] = useState<CombatStateLite | null>(null);
  const [showMyTurnPulse, setShowMyTurnPulse] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const prevIsMyTurnRef = useRef(false);
  const prevStatusRef = useRef<string | null>(null);
  const prevActiveTokenIdRef = useRef<number | null>(null);

  // Subscribe to combat storage updates
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

  // Fetch initial combat state on mount (events only fire via WebSocket, not on page load)
  useEffect(() => {
    if (!campaignId) return;
    fetchCampaignCombatStateCached(campaignId, { userId })
      .then(obj => {
        if (obj?.is_active !== false && obj?.data?.status === "in_progress") {
          setCombat(obj.data as CombatStateLite);
        }
      })
      .catch(() => {});
  }, [campaignId]);

  const activeTokenId = useMemo(() => {
    if (!combat?.order?.length) return null;
    const idx = getCombatTurnIndex(combat, combat.order.length);
    return combat.order[idx] ?? null;
  }, [combat]);

  const activeToken = useMemo(() => tokens.find(t => t.id === activeTokenId) || null, [tokens, activeTokenId]);

  const isMyTurn = useMemo(() => {
    if (isDM) return false; // DM never gets "your turn" banner
    if (!activeToken) return false;
    if (userId && activeToken.user_id === userId) return true;
    if (selectedCharacterId && activeToken.character_id === selectedCharacterId) return true;
    return false;
  }, [isDM, activeToken, userId, selectedCharacterId]);

  const activeCharName = useMemo(() => {
    if (!combat?.participants || !activeTokenId) return "";
    const p = combat.participants.find(p => p.token_id === activeTokenId);
    return p?.name || "";
  }, [combat?.participants, activeTokenId]);

  const dismissTurnBanner = useCallback(() => {
    setShowMyTurnPulse(false);
    setDismissed(true);
  }, []);

  // Reset dismissed state when active token changes (new turn)
  useEffect(() => {
    setDismissed(false);
  }, [activeTokenId]);

  // Detect combat start: play war drum sound on status transition
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = combat?.status ?? null;

    if (prev !== null && prev !== "in_progress" && combat?.status === "in_progress") {
      playCombatStartSound();
    }
  }, [combat?.status]);

  // Detect turn change → dispatch chat notification event
  useEffect(() => {
    if (!combat || combat.status !== "in_progress" || !activeTokenId) return;

    const prevId = prevActiveTokenIdRef.current;
    prevActiveTokenIdRef.current = activeTokenId;

    // Only fire when activeTokenId actually changes (not on initial load)
    if (prevId !== null && prevId !== activeTokenId) {
      const participant = combat.participants.find(p => p.token_id === activeTokenId);
      if (participant) {
        publishAppEvent("combatTurnNotification", {
          name: participant.name,
          round: combat.round ?? 1,
        });
      }
    }
  }, [activeTokenId, combat]);

  // Detect "my turn" change: play chime + pulse effect (players only)
  useEffect(() => {
    const wasMyTurn = prevIsMyTurnRef.current;
    prevIsMyTurnRef.current = isMyTurn;

    if (!wasMyTurn && isMyTurn) {
      playTurnChime();
      showGlobalToast("轮到你了", "warning");
      setShowMyTurnPulse(true);
    } else if (wasMyTurn && !isMyTurn) {
      setShowMyTurnPulse(false);
    }
  }, [isMyTurn]);

  const combatActive = combat?.status === "in_progress";
  const round = combat?.round ?? 1;

  const typeLabel = useMemo(() => {
    if (!activeToken) return "";
    return getTokenTypeLabel(activeToken, tokens);
  }, [activeToken, tokens]);

  // Only render when combat is in progress
  if (!combatActive || dismissed) return null;

  const isMyTurnPulse = showMyTurnPulse;

  return (
    <div
      className="pointer-events-none fixed top-0 left-0 right-0 z-[300] flex justify-center pt-1.5"
      style={{ animation: "combatBannerSlideDown 0.4s ease-out" }}
    >
      <style>{`
        @keyframes combatBannerSlideDown {
          from { transform: translateY(-100%); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        @keyframes combatPulse {
          0%, 100% { box-shadow: 0 2px 12px rgba(245, 158, 11, 0.3); }
          50% { box-shadow: 0 2px 20px rgba(245, 158, 11, 0.6); }
        }
      `}</style>
      <div
        className={`pointer-events-auto rounded-full border px-4 py-1.5 flex items-center gap-2 shadow-lg transition-colors duration-500 ${
          isMyTurnPulse
            ? "bg-gradient-to-r from-amber-900/95 via-amber-800/95 to-amber-900/95 border-amber-500/60"
            : "bg-gradient-to-r from-red-900/90 via-red-800/90 to-red-900/90 border-red-500/50"
        }`}
        style={isMyTurnPulse ? { animation: "combatPulse 2s ease-in-out infinite" } : undefined}
      >
        <span className={isMyTurnPulse ? "text-amber-400 text-sm" : "text-red-400 text-sm"}>&#9876;</span>
        <span className={isMyTurnPulse ? "text-amber-100 font-bold text-sm" : "text-red-200 font-semibold text-xs"}>
          {isMyTurnPulse ? "你的回合!" : `第${round}轮`}
        </span>
        {activeCharName && (
          <span className={isMyTurnPulse ? "text-amber-300/80 text-sm" : "text-red-300/70 text-xs"}>
            {isMyTurnPulse ? `(${activeCharName})` : <><span className="text-red-400/60">轮到</span> <span className="text-white font-bold">{activeCharName}</span></>}
          </span>
        )}
        {typeLabel && (
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
            isMyTurnPulse
              ? "bg-amber-700/50 text-amber-300/80"
              : "bg-red-800/50 text-red-300/70"
          }`}>
            {typeLabel}
          </span>
        )}
        <button
          className={`ml-1 text-xs transition-colors ${
            isMyTurnPulse
              ? "text-amber-500/60 hover:text-amber-300"
              : "text-red-500/60 hover:text-red-300"
          }`}
          onClick={dismissTurnBanner}
          title="关闭"
        >
          &#10005;
        </button>
      </div>
    </div>
  );
}
