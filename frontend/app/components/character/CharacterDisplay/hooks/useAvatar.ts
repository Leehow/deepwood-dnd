import { useCallback, useState } from "react";
import type { Character, EquipmentItem, EquipSlot } from "../types/Character";
import { apiFetch } from "~/utils/api-client";
import { getAssetUrl } from "~/utils/asset-url";
import { createLogger } from '~/utils/logger';
const logger = createLogger('useAvatar');

const SLOT_LABELS: Record<EquipSlot, string> = {
  main_hand: "主手", off_hand: "副手", armor: "护甲",
  ammo: "弹药", quick_item: "快捷", clothing: "衣物", accessory: "首饰",
};

interface UseAvatarArgs {
  character: Character;
  userId: string;
  onAvatarUpdated?: () => void;
  onPlaceToken?: () => Promise<void>;
  equipmentLocal?: EquipmentItem[];
}

export function useAvatar({ character, userId, onAvatarUpdated, onPlaceToken, equipmentLocal }: UseAvatarArgs) {
  const [genLoading, setGenLoading] = useState(false);
  const [regenEquipLoading, setRegenEquipLoading] = useState(false);

  const handleGenerateAvatar = useCallback(async (expressionDesc?: string) => {
    try {
      setGenLoading(true);
      const app = character.appearance || {};
      const traits: string[] = (character.personality?.traits || []).slice(0, 3);
      const appearance_description = [
        app.height ? `height: ${app.height}` : null,
        app.weight ? `weight: ${app.weight}` : null,
        app.eyes ? `eyes: ${app.eyes}` : null,
        app.skin ? `skin: ${app.skin}` : null,
        app.hair ? `hair: ${app.hair}` : null,
        app.distinguishingMarks ? `marks: ${app.distinguishingMarks}` : null,
      ]
        .filter(Boolean)
        .join(", ");

      // Use subrace image if available, otherwise race image
      const raceImageId = character.subrace_id || character.race_id;
      const raceRefUrl = raceImageId ? getAssetUrl(`images/races/${raceImageId}.png`) : undefined;

      const resp = await apiFetch("/api/ai-settings/generate-avatar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          race: character.race_id,
          subrace: character.subrace_id || null,
          character_class: character.class_id,
          background: character.background_id || null,
          name: character.name,
          age: character.age,
          gender: character.gender,
          appearance_description,
          personality_traits: traits,
          race_reference_image: raceRefUrl,
          expression_description: expressionDesc || undefined,
        }),
      });
      if (!resp.ok) {
        const t = await resp.text();
        logger.error("Avatar generation failed:", t);
        alert("头像生成失败，请检查后端日志或API设置");
        return;
      }
      const data = await resp.json();

      // Debug: log what we're about to do
      logger.info("Avatar generated, saving to character:", character.id, "image URL:", data.image?.slice(0, 100));

      if (!character.id) {
        logger.error("Character ID is undefined, cannot save avatar");
        alert("角色ID无效，无法保存头像");
        return;
      }

      const patchUrl = `/api/characters/${character.id}/avatar`;
      logger.info("PATCH URL:", patchUrl);

      const patch = await apiFetch(patchUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatar: data.image }),
        userId,
      });
      if (!patch.ok) {
        const t = await patch.text();
        logger.error(`Avatar update failed: ${patch.status} - ${t}`);
        alert(`头像保存失败: ${patch.status} - ${t.slice(0, 200)}`);
        return;
      }

      // Notify avatar updated
      onAvatarUpdated?.();

      // Auto-place token on map after avatar generation
      if (onPlaceToken) {
        logger.info("Auto-placing token after avatar generation");
        await onPlaceToken();
      }
    } catch (e) {
      logger.error("Avatar generation error:", e);
      alert("头像生成异常，请打开控制台查看详情");
    } finally {
      setGenLoading(false);
    }
  }, [character, userId, onAvatarUpdated, onPlaceToken]);

  /** Regenerate avatar based on currently equipped items, using current avatar as reference */
  const handleRegenerateWithEquipment = useCallback(async () => {
    if (!character.avatar || !equipmentLocal) return;
    try {
      setRegenEquipLoading(true);

      // Build equipment description from equipped items
      const equipped = equipmentLocal.filter(it => it.equippedSlot);
      if (equipped.length === 0) {
        alert("当前没有装备任何物品");
        return;
      }
      const desc = equipped
        .map(it => {
          const slotLabel = SLOT_LABELS[it.equippedSlot!] || it.equippedSlot;
          const name = (it as any).name_cn || it.name || it.id;
          return `${slotLabel}：${name}`;
        })
        .join("，");

      const app = character.appearance || {};
      const appearance_description = [
        app.height ? `height: ${app.height}` : null,
        app.weight ? `weight: ${app.weight}` : null,
        app.eyes ? `eyes: ${app.eyes}` : null,
        app.skin ? `skin: ${app.skin}` : null,
        app.hair ? `hair: ${app.hair}` : null,
      ].filter(Boolean).join(", ");

      const resp = await apiFetch("/api/ai-settings/generate-avatar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          race: character.race_id,
          subrace: character.subrace_id || null,
          character_class: character.class_id,
          name: character.name,
          gender: character.gender,
          appearance_description,
          reference_image: character.avatar,
          equipment_description: desc,
        }),
      });
      if (!resp.ok) {
        const t = await resp.text();
        logger.error("Equipment regen failed:", t);
        alert("根据装备重新生成头像失败");
        return;
      }
      const data = await resp.json();

      // Save avatar
      const patch = await apiFetch(`/api/characters/${character.id}/avatar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatar: data.image }),
        userId,
      });
      if (!patch.ok) {
        alert("头像保存失败");
        return;
      }
      onAvatarUpdated?.();
    } catch (e) {
      logger.error("Equipment regen error:", e);
      alert("换装生成异常");
    } finally {
      setRegenEquipLoading(false);
    }
  }, [character, userId, equipmentLocal, onAvatarUpdated]);

  const handleUploadAvatar = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async (e: any) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async (event) => {
        const base64 = event.target?.result as string;
        try {
          const patch = await apiFetch(`/api/characters/${character.id}/avatar`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ avatar: base64 }),
            userId,
          });
          if (!patch.ok) {
            const t = await patch.text();
            logger.error("Avatar upload failed:", t);
            alert("头像保存失败");
            return;
          }
          onAvatarUpdated?.();
        } catch (e) {
          logger.error("Avatar upload error:", e);
          alert("上传失败");
        }
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }, [character, onAvatarUpdated]);

  return { genLoading, regenEquipLoading, handleGenerateAvatar, handleUploadAvatar, handleRegenerateWithEquipment };
}
