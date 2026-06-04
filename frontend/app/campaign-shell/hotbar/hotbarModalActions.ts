import type { Dispatch, SetStateAction } from "react";
import { publishAppEvent } from "~/events/appEventBus";
import { showDamageNumber } from "~/components/map/DamageNumberOverlay";
import { apiFetch } from "~/utils/api-client";
import { getAssetUrl } from "~/utils/asset-url";
import { showCharacterBubble } from "~/utils/characterBubble";
import type { CampaignAbilityConfirm } from "~/campaign-shell/hotbar/hotbarTypes";

type HotbarCharacterLike = {
  name?: string | null;
  avatar_url?: string | null;
} | null | undefined;

type HotbarCharacterSetter = Dispatch<SetStateAction<any>>;

function playAudio(assetPath: string) {
  const audio = new Audio(getAssetUrl(assetPath));
  audio.volume = 0.5;
  audio.play().catch(() => {});
}

function getCharacterName(hotbarCharacter: HotbarCharacterLike, fallback: string) {
  return hotbarCharacter?.name || fallback;
}

function getCharacterAvatar(hotbarCharacter: HotbarCharacterLike) {
  return hotbarCharacter?.avatar_url || undefined;
}

function updateHotbarSpellSlots(
  setHotbarCharacter: HotbarCharacterSetter | undefined,
  spellSlotsState: unknown,
) {
  if (!setHotbarCharacter || !spellSlotsState) {
    return;
  }

  setHotbarCharacter((prev: any) => (prev ? { ...prev, spell_slots_state: spellSlotsState } : prev));
}

export async function confirmLayOnHandsAction(params: {
  campaignId: string | number;
  abilityConfirm: CampaignAbilityConfirm;
  hotbarCharacter?: HotbarCharacterLike;
  healAmount: number;
  cureDisease: boolean;
  curePoison: boolean;
}) {
  const {
    campaignId,
    abilityConfirm,
    hotbarCharacter,
    healAmount,
    cureDisease,
    curePoison,
  } = params;
  const { sourceCharacterId, targetTokenId, targetName } = abilityConfirm;

  const response = await apiFetch(`/api/characters/${sourceCharacterId}/lay-on-hands`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      target_token_id: targetTokenId,
      heal_amount: healAmount,
      cure_disease: cureDisease,
      cure_poison: curePoison,
      campaign_id: Number(campaignId),
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "圣疗术使用失败" }));
    console.error("Lay on Hands failed:", error.detail);
    return { ok: false as const, error };
  }

  playAudio("sounds/spells/heal_cast.mp3");

  const parts: string[] = [];
  if (healAmount > 0) parts.push(`治疗 ${targetName} ${healAmount} 点HP`);
  if (cureDisease) parts.push("治愈疾病");
  if (curePoison) parts.push("中和毒素");

  showCharacterBubble({
    characterId: sourceCharacterId,
    characterName: getCharacterName(hotbarCharacter, "圣武士"),
    message: `圣疗术 — ${parts.join("、")}`,
    type: "action",
    avatarUrl: getCharacterAvatar(hotbarCharacter),
  });

  if (healAmount > 0) {
    showDamageNumber({
      targetTokenId,
      damage: healAmount,
      hit: true,
      critical: false,
      fumble: false,
      heal: true,
    });
  }

  return { ok: true as const };
}

export async function confirmDivineSmiteAction(params: {
  campaignId: string | number;
  abilityConfirm: CampaignAbilityConfirm;
  hotbarCharacter?: HotbarCharacterLike;
}) {
  const { campaignId, abilityConfirm, hotbarCharacter } = params;
  const { sourceCharacterId, targetTokenId, targetName, spellSlotLevel } = abilityConfirm;

  const response = await apiFetch(`/api/characters/${sourceCharacterId}/divine-smite`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      target_token_id: targetTokenId,
      spell_slot_level: spellSlotLevel,
      campaign_id: Number(campaignId),
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "神圣惩击使用失败" }));
    console.error("Divine Smite failed:", error.detail);
    return { ok: false as const, error };
  }

  const data = await response.json();
  playAudio("sounds/attacks/sword_hit.mp3");

  showCharacterBubble({
    characterId: sourceCharacterId,
    characterName: getCharacterName(hotbarCharacter, "圣武士"),
    message: `神圣惩击 — 对 ${targetName} 造成 ${data.damage ?? "?"} 点光耀伤害（${spellSlotLevel}环位）`,
    type: "action",
    avatarUrl: getCharacterAvatar(hotbarCharacter),
  });

  if (data.damage) {
    showDamageNumber({
      targetTokenId,
      damage: data.damage,
      hit: true,
      critical: false,
      fumble: false,
    });
  }

  publishAppEvent("classFeatureUsesUpdated", { characterId: sourceCharacterId });

  return { ok: true as const, data };
}

export async function confirmSpellSlotRecoveryAction(params: {
  campaignId: string | number;
  sourceCharacterId: number;
  endpoint: "arcane-recovery" | "natural-recovery";
  recoveries: Record<string | number, number>;
  hotbarCharacter?: HotbarCharacterLike;
  setHotbarCharacter?: HotbarCharacterSetter;
  defaultCharacterName: string;
  bubbleMessage: string;
  onPlaySound?: () => void;
}) {
  const {
    campaignId,
    sourceCharacterId,
    endpoint,
    recoveries,
    hotbarCharacter,
    setHotbarCharacter,
    defaultCharacterName,
    bubbleMessage,
    onPlaySound,
  } = params;

  const response = await apiFetch(`/api/characters/${sourceCharacterId}/${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      slot_recoveries: Object.fromEntries(
        Object.entries(recoveries).map(([key, value]) => [String(key), value]),
      ),
      campaign_id: Number(campaignId),
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: `${endpoint} 使用失败` }));
    console.error(`${endpoint} failed:`, error.detail);
    return { ok: false as const, error };
  }

  const data = await response.json();
  updateHotbarSpellSlots(setHotbarCharacter, data.spell_slots_state);
  onPlaySound?.();

  showCharacterBubble({
    characterId: sourceCharacterId,
    characterName: getCharacterName(hotbarCharacter, defaultCharacterName),
    message: bubbleMessage,
    type: "action",
    avatarUrl: getCharacterAvatar(hotbarCharacter),
  });

  publishAppEvent("classFeatureUsesUpdated", { characterId: sourceCharacterId });

  return { ok: true as const, data };
}

export async function confirmFlexibleCastingAction(params: {
  campaignId: string | number;
  sourceCharacterId: number;
  action: string;
  slotLevel: number;
  hotbarCharacter?: HotbarCharacterLike;
  setHotbarCharacter?: HotbarCharacterSetter;
  onPlaySound?: () => void;
}) {
  const {
    campaignId,
    sourceCharacterId,
    action,
    slotLevel,
    hotbarCharacter,
    setHotbarCharacter,
    onPlaySound,
  } = params;

  const response = await apiFetch(`/api/characters/${sourceCharacterId}/flexible-casting`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action,
      slot_level: slotLevel,
      campaign_id: Number(campaignId),
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: "灵活施法使用失败" }));
    console.error("Flexible Casting failed:", error.detail);
    return { ok: false as const, error };
  }

  const data = await response.json();
  updateHotbarSpellSlots(setHotbarCharacter, data.spell_slots_state);
  onPlaySound?.();

  showCharacterBubble({
    characterId: sourceCharacterId,
    characterName: getCharacterName(hotbarCharacter, "术士"),
    message:
      action === "create_slot"
        ? `灵活施法 — 创造了 ${slotLevel} 环法术位`
        : `灵活施法 — 转化 ${slotLevel} 环法术位`,
    type: "action",
    avatarUrl: getCharacterAvatar(hotbarCharacter),
  });

  publishAppEvent("classFeatureUsesUpdated", { characterId: sourceCharacterId });

  return { ok: true as const, data };
}
