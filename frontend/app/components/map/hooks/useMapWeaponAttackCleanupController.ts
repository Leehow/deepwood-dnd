import { useCallback, type Dispatch, type SetStateAction } from "react";

import type { AttackOption, SourceCharacterData } from "../SelectionContextMenu";
import type { Token } from "../types/TacticalMapTypes";
import { parseTokenSize } from "../utils/mapCalculations";
import { publishAppEvent } from "~/events/appEventBus";
import { serializeItemToTokenData } from "~/utils/itemTokenData";
import { createLogger } from "~/utils/logger";

const logger = createLogger("useMapWeaponAttackCleanupController");

type AuthedFetch = (input: string, init?: RequestInit) => Promise<Response>;

type ShowToast = (
  message: string,
  type?: "success" | "error" | "info" | "warning",
  duration?: number,
) => void;

interface StatusEffectLike {
  id: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

interface UseMapWeaponAttackCleanupControllerArgs {
  authedFetch: AuthedFetch;
  campaignId: string;
  currentMapUrl?: string | null;
  showToast: ShowToast;
  setTokens: Dispatch<SetStateAction<Token[]>>;
  setSourceCharacterData: Dispatch<SetStateAction<any>>;
  persistTokenActiveEffects: (tokenId: number, effects: StatusEffectLike[]) => Promise<void>;
  clearCloakOfShadowsEffect: (tokenId: number, reason: "attack" | "spell" | "turn_end" | "manual") => Promise<boolean>;
}

export function useMapWeaponAttackCleanupController({
  authedFetch,
  campaignId,
  currentMapUrl,
  showToast,
  setTokens,
  setSourceCharacterData,
  persistTokenActiveEffects,
  clearCloakOfShadowsEffect,
}: UseMapWeaponAttackCleanupControllerArgs) {
  const runAttackCleanup = useCallback(async (args: {
    attack: AttackOption;
    sourceToken: Token;
    sourceTokenId: number;
    targetToken?: Token | null;
    sourceCharacterData?: SourceCharacterData | null;
    attackerEffects: StatusEffectLike[];
    inspirationDie?: string | null;
    pendingAttackBonusEffectId?: string;
    pendingAttackBonusSource?: string;
    cloakOfShadowsActive: boolean;
  }) => {
    const {
      attack,
      sourceToken,
      sourceTokenId,
      targetToken,
      sourceCharacterData,
      attackerEffects,
      inspirationDie,
      pendingAttackBonusEffectId,
      pendingAttackBonusSource,
      cloakOfShadowsActive,
    } = args;

    const consumedEffectIds = [
      ...(inspirationDie ? ["bardic_inspiration"] : []),
      ...(pendingAttackBonusEffectId ? [pendingAttackBonusEffectId] : []),
    ];
    if (consumedEffectIds.length > 0) {
      const updatedEffects = attackerEffects.filter((effect) => !consumedEffectIds.includes(effect.id));
      try {
        await persistTokenActiveEffects(sourceTokenId, updatedEffects);
        if (inspirationDie) {
          showToast("激励骰已使用！", "info");
        }
        if (pendingAttackBonusEffectId) {
          showToast(`${pendingAttackBonusSource || "命中加值"}已结算`, "info");
        }
      } catch (error) {
        logger.error("Failed to remove consumed attack bonus effects", error);
      }
    }

    if (attack.needsAmmo && sourceCharacterData?.id && sourceCharacterData?.equipment) {
      try {
        const ammoMap: Record<string, string[]> = {
          longbow: ["arrows", "arrow"],
          shortbow: ["arrows", "arrow"],
          light_crossbow: ["crossbow_bolts", "crossbow_bolt", "bolts", "bolt"],
          heavy_crossbow: ["crossbow_bolts", "crossbow_bolt", "bolts", "bolt"],
          hand_crossbow: ["crossbow_bolts", "crossbow_bolt", "bolts", "bolt"],
          blowgun: ["blowgun_needles", "blowgun_needle", "needles", "needle"],
          sling: ["sling_bullets", "sling_bullet", "bullets", "bullet"],
        };

        const weaponMatch = attack.key.match(/weapon_([^_]+)/);
        const weaponId = weaponMatch ? weaponMatch[1].toLowerCase() : "";
        const validAmmoIds = ammoMap[weaponId] || [];
        const equipment = [...sourceCharacterData.equipment];

        let ammoIndex = equipment.findIndex((item: any) =>
          item.equippedSlot === "ammo" && validAmmoIds.includes(item.id?.toLowerCase()),
        );
        if (ammoIndex === -1) {
          ammoIndex = equipment.findIndex((item: any) =>
            validAmmoIds.includes(item.id?.toLowerCase()) && (item.quantity || 1) > 0,
          );
        }

        if (ammoIndex !== -1) {
          const ammoItem = equipment[ammoIndex];
          const newQuantity = (ammoItem.quantity || 1) - 1;
          if (newQuantity <= 0) {
            equipment.splice(ammoIndex, 1);
            showToast(`${attack.ammoName || "弹药"} 已耗尽!`, "warning");
          } else {
            equipment[ammoIndex] = { ...ammoItem, quantity: newQuantity };
          }

          await authedFetch(`/api/characters/${sourceCharacterData.id}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ equipment }),
          });

          setSourceCharacterData((previous: any) => previous ? { ...previous, equipment } : previous);
        }
      } catch (error) {
        logger.warn("Failed to consume ammunition", error);
      }
    }

    if (attack.isThrown && attack.thrownWeaponItem && sourceToken.character_id) {
      try {
        const characterId = sourceToken.character_id;
        const thrownItem = attack.thrownWeaponItem;

        let equipment: any[] = [];
        if (sourceCharacterData?.id === characterId && sourceCharacterData?.equipment) {
          equipment = [...sourceCharacterData.equipment];
        } else {
          const characterResponse = await authedFetch(`/api/characters/${characterId}`);
          if (characterResponse.ok) {
            const characterData = await characterResponse.json();
            equipment = [...(characterData.equipment || [])];
          }
        }

        const weaponIndex = equipment.findIndex((item: any) =>
          item.id === thrownItem.id && item.equippedSlot === thrownItem.equippedSlot,
        );
        if (weaponIndex !== -1) {
          const weaponItem = equipment[weaponIndex];
          const quantity = weaponItem.quantity || 1;

          if (quantity <= 1) {
            equipment.splice(weaponIndex, 1);
          } else {
            equipment[weaponIndex] = { ...weaponItem, quantity: quantity - 1 };
          }

          await authedFetch(`/api/characters/${characterId}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ equipment }),
          });

          setSourceCharacterData((previous: any) =>
            previous?.id === characterId ? { ...previous, equipment } : previous,
          );

          publishAppEvent("characterEquipmentUpdated", {
            characterId,
            needsBroadcast: true,
          });

          if (currentMapUrl && targetToken) {
            const targetSize = parseTokenSize(targetToken.token_size);
            const dropX = targetToken.position_x + targetSize.width;
            const dropY = targetToken.position_y;

            const tokenResponse = await authedFetch("/api/tokens/", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                campaign_id: Number.parseInt(campaignId, 10),
                position_x: dropX,
                position_y: dropY,
                token_size: "0.5x0.5",
                instance_name: `${thrownItem.name}(投掷落地)`,
                item_data: serializeItemToTokenData(thrownItem),
                item_quantity: 1,
                map_url: currentMapUrl,
              }),
            });

            if (tokenResponse.ok) {
              const newToken = await tokenResponse.json();
              setTokens((previous) => {
                const exists = previous.some((token) => token.id === newToken.id);
                return exists ? previous : [...previous, newToken];
              });
              showToast(`${thrownItem.name} 落在目标附近，可拾取`, "info");
            }
          }
        }
      } catch (error) {
        logger.warn("Failed to handle thrown weapon drop", error);
      }
    }

    if (cloakOfShadowsActive) {
      await clearCloakOfShadowsEffect(sourceTokenId, "attack");
    }
  }, [
    authedFetch,
    campaignId,
    clearCloakOfShadowsEffect,
    currentMapUrl,
    persistTokenActiveEffects,
    setSourceCharacterData,
    setTokens,
    showToast,
  ]);

  return { runAttackCleanup };
}
