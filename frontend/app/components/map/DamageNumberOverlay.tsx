import { useEffect, useState, useCallback } from "react";
import type { Position, Token } from "./types/TacticalMapTypes";
import { GRID_SIZE } from "./types/TacticalMapTypes";

interface DamageNumberOverlayProps {
  tokens: Token[];
  stageScale: number;
  stagePos: Position;
}

interface DamageNumber {
  id: string;
  tokenId: number;
  value: string;
  type: "damage" | "miss" | "critical" | "fumble" | "heal";
  timestamp: number;
}

// Event name for triggering damage numbers
export const DAMAGE_NUMBER_EVENT = "showDamageNumber";

export interface DamageNumberEventData {
  targetTokenId: number;
  damage: number;
  hit: boolean;
  critical: boolean;
  fumble: boolean;
  heal?: boolean; // For healing effects
}

// Helper to trigger damage number display
export function showDamageNumber(data: DamageNumberEventData) {
  window.dispatchEvent(new CustomEvent(DAMAGE_NUMBER_EVENT, { detail: data }));
}

const ANIMATION_DURATION = 2500; // 2.5 seconds

export function DamageNumberOverlay({
  tokens,
  stageScale,
  stagePos,
}: DamageNumberOverlayProps) {
  const [damageNumbers, setDamageNumbers] = useState<DamageNumber[]>([]);

  // Listen for damage number events
  useEffect(() => {
    const handleDamageNumber = (e: CustomEvent<DamageNumberEventData>) => {
      const { targetTokenId, damage, hit, critical, fumble, heal } = e.detail;

      let value: string;
      let type: DamageNumber["type"];

      if (heal) {
        value = `+${damage}`;
        type = "heal";
      } else if (fumble) {
        value = "大失败";
        type = "fumble";
      } else if (!hit) {
        value = "MISS";
        type = "miss";
      } else if (critical) {
        value = `大成功 -${damage}`;
        type = "critical";
      } else {
        value = `-${damage}`;
        type = "damage";
      }

      const newNumber: DamageNumber = {
        id: `${targetTokenId}-${Date.now()}`,
        tokenId: targetTokenId,
        value,
        type,
        timestamp: Date.now(),
      };

      setDamageNumbers((prev) => [...prev, newNumber]);
    };

    window.addEventListener(DAMAGE_NUMBER_EVENT, handleDamageNumber as EventListener);
    return () => window.removeEventListener(DAMAGE_NUMBER_EVENT, handleDamageNumber as EventListener);
  }, []);

  // Cleanup expired numbers with a low-frequency timer instead of RAF
  useEffect(() => {
    if (damageNumbers.length === 0) return;

    const cleanup = setInterval(() => {
      const now = Date.now();
      setDamageNumbers((prev) => {
        const filtered = prev.filter((d) => now - d.timestamp < ANIMATION_DURATION);
        if (filtered.length === prev.length) return prev;
        return filtered;
      });
    }, 500);

    return () => clearInterval(cleanup);
  }, [damageNumbers.length === 0]);

  // Get screen position for a token
  const getScreenPosition = useCallback(
    (tokenId: number) => {
      const token = tokens.find((t) => t.id === tokenId);
      if (!token) return null;

      // Calculate token center position
      const tokenSize = token.token_size || "1x1";
      const [cols] = tokenSize.split("x").map(Number);
      const tokenCenterX = (token.position_x + cols / 2) * GRID_SIZE;
      const tokenTopY = token.position_y * GRID_SIZE;

      return {
        x: stagePos.x + tokenCenterX * stageScale,
        y: stagePos.y + tokenTopY * stageScale - 10, // Slightly above the token
      };
    },
    [tokens, stageScale, stagePos]
  );

  if (damageNumbers.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-[220]">
      {damageNumbers.map((d) => {
        const pos = getScreenPosition(d.tokenId);
        if (!pos) return null;

        // Color and effects based on type
        let colorClass = "";
        let textShadow = "";
        switch (d.type) {
          case "heal":
            colorClass = "text-green-400";
            textShadow = "0 0 8px rgba(74,222,128,0.9), 0 2px 4px rgba(0,0,0,0.9)";
            break;
          case "critical":
            colorClass = "text-yellow-300";
            textShadow = "0 0 10px rgba(250,204,21,0.9), 0 0 20px rgba(250,204,21,0.5), 0 2px 4px rgba(0,0,0,0.9)";
            break;
          case "fumble":
            colorClass = "text-purple-300";
            textShadow = "0 0 8px rgba(192,132,252,0.9), 0 2px 4px rgba(0,0,0,0.9)";
            break;
          case "miss":
            colorClass = "text-gray-300";
            textShadow = "0 0 6px rgba(156,163,175,0.6), 0 2px 4px rgba(0,0,0,0.9)";
            break;
          case "damage":
          default:
            colorClass = "text-red-400";
            textShadow = "0 0 8px rgba(248,113,113,0.9), 0 2px 4px rgba(0,0,0,0.9)";
            break;
        }

        return (
          <div
            key={d.id}
            className={`absolute font-bold ${colorClass} animate-damage-float`}
            style={{
              left: pos.x,
              top: pos.y,
              transform: "translateX(-50%)",
              fontSize: d.type === "critical" ? "28px" : "24px",
              fontWeight: 800,
              textShadow,
              letterSpacing: d.type === "miss" || d.type === "fumble" ? "2px" : "0",
            }}
          >
            {d.value}
          </div>
        );
      })}
    </div>
  );
}
