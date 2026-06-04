import racesData from "~/data/rules/races.json";
import { getPassiveFeatures } from "~/hooks/usePassiveFeatures";
import { getFeatPassiveBonuses } from "./featEffects";

const STORMBORN_BLOCKED_TERRAINS = new Set([
  "castle",
  "cave",
  "dungeon",
  "indoors",
  "indoor",
  "maze",
  "mine",
  "stronghold",
  "tavern",
  "temple",
  "tomb",
  "underdark",
  "underwater",
  "vault",
]);

// Unified speed calculation used by both Player and DM UIs
// - Base from race.speed (default 30)
// - Subrace override via subrace.speed (if present)
// - Subrace traits may grant `speedBonus` (additive) or `speed` (override)
// - Class passive features (Barbarian Fast Movement, Monk Unarmored Movement)
export const calculateSpeed = (character: any): number => {
  try {
    const raceId = character?.race_id ?? character?.raceId;
    const subraceId = character?.subrace_id ?? character?.subraceId;

    const race = (racesData as any)?.races?.find((r: any) => r.id === raceId);
    const subrace = race?.subraces?.find((sr: any) => sr.id === subraceId);

    let baseSpeed: number = typeof race?.speed === "number" ? race.speed : 30;

    // Subrace direct override
    if (typeof (subrace as any)?.speed === "number") {
      baseSpeed = (subrace as any).speed;
    }

    // Subrace traits adjustments
    const traits: any[] = (subrace as any)?.traits || [];
    for (const trait of traits) {
      if (typeof trait?.speedBonus === "number") {
        baseSpeed += trait.speedBonus;
      }
      if (typeof trait?.speed === "number") {
        baseSpeed = trait.speed; // explicit override
      }
    }

    // Class passive features (Fast Movement, Unarmored Movement)
    const classId = character?.class_id || character?.classId || "";
    const subclassId = character?.subclass_id || character?.subclassId;
    const level = character?.level || 1;

    if (classId) {
      const raceId = character?.race_id || character?.raceId;
      const subraceId = character?.subrace_id || character?.subraceId;
      const passiveFeatures = getPassiveFeatures({ classId, subclassId, level, raceId, subraceId });
      if (passiveFeatures.speedBonus > 0) {
        // Check armor condition for class speed bonuses
        // Barbarian: no heavy armor; Monk: no armor, no shield
        const equipment = character?.equipment || [];
        const armor = equipment.find((it: any) =>
          it?.equippedSlot === "armor" ||
          ["padded","leather","studded_leather","hide","chain_shirt","scale_mail",
           "breastplate","half_plate","ring_mail","chain_mail","splint","plate"].includes(it?.id)
        );
        const shield = equipment.find((it: any) => it?.equippedSlot === "off_hand" && it?.id === "shield");

        const isMonk = classId.toLowerCase() === "monk";
        const isBarbarian = classId.toLowerCase() === "barbarian";

        // Heavy armor IDs
        const heavyArmorIds = ["ring_mail", "chain_mail", "splint", "plate"];
        const hasHeavyArmor = armor && heavyArmorIds.includes(armor.id);

        // Monk: no armor and no shield
        if (isMonk && !armor && !shield) {
          baseSpeed += passiveFeatures.speedBonus;
        }
        // Barbarian: no heavy armor
        else if (isBarbarian && !hasHeavyArmor) {
          baseSpeed += passiveFeatures.speedBonus;
        }
      }
    }

    // Feat speed bonuses (e.g. Mobile: +10)
    const featBonuses = getFeatPassiveBonuses(character?.feats || []);
    if (featBonuses.speed_bonus) {
      baseSpeed += featBonuses.speed_bonus;
    }

    return baseSpeed;
  } catch {
    return 30;
  }
};

export const isStormbornEnvironmentActive = (globalTerrain?: string | null): boolean => {
  const terrain = String(globalTerrain || "").trim().toLowerCase();
  if (!terrain) return true;
  return !STORMBORN_BLOCKED_TERRAINS.has(terrain);
};

export const hasStormbornFeature = (character: any): boolean => {
  try {
    const classId = character?.class_id || character?.classId || "";
    const subclassId = character?.subclass_id || character?.subclassId;
    const level = character?.level || 1;
    const raceId = character?.race_id || character?.raceId;
    const subraceId = character?.subrace_id || character?.subraceId;

    if (!classId) return false;

    const passiveFeatures = getPassiveFeatures({ classId, subclassId, level, raceId, subraceId });
    return (passiveFeatures.allFeatures || []).some((feature: any) => feature?.id === "stormborn");
  } catch {
    return false;
  }
};

/**
 * Get flying speed for a character (if any, from class/subclass passive features)
 */
export const calculateFlyingSpeed = (character: any, globalTerrain?: string | null): number | undefined => {
  try {
    const classId = character?.class_id || character?.classId || "";
    const subclassId = character?.subclass_id || character?.subclassId;
    const level = character?.level || 1;
    const raceId = character?.race_id || character?.raceId;
    const subraceId = character?.subrace_id || character?.subraceId;
    const walkingSpeed = typeof character?.speed === "number" ? character.speed : calculateSpeed(character);

    if (!classId) return undefined;

    const passiveFeatures = getPassiveFeatures({ classId, subclassId, level, raceId, subraceId });

    let bestSpeed =
      passiveFeatures.flyingSpeed && passiveFeatures.flyingSpeed > 0
        ? passiveFeatures.flyingSpeed
        : undefined;

    for (const feature of passiveFeatures.allFeatures || []) {
      if (feature?.type !== "flying_speed") continue;

      if (feature.id === "stormborn" && !isStormbornEnvironmentActive(globalTerrain)) {
        continue;
      }

      if (feature?.effect?.flyingSpeedFormula === "walking_speed") {
        bestSpeed = Math.max(bestSpeed || 0, walkingSpeed);
      }

      if (typeof feature?.effect?.value === "number" && feature.effect.value > 0) {
        bestSpeed = Math.max(bestSpeed || 0, feature.effect.value);
      }
    }

    return bestSpeed && bestSpeed > 0 ? bestSpeed : undefined;
  } catch {
    return undefined;
  }
};

export const getEffectiveMovementSpeed = (character: any, globalTerrain?: string | null): number => {
  const walkingSpeed = typeof character?.speed === "number" ? character.speed : calculateSpeed(character);
  const flyingSpeed = calculateFlyingSpeed({ ...character, speed: walkingSpeed }, globalTerrain);
  return Math.max(walkingSpeed, flyingSpeed || 0);
};
