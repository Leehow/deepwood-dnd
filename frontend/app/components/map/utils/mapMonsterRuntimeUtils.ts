type JsonRecord = Record<string, unknown>;

type AbilityScores = {
  strength: number;
  dexterity: number;
  constitution: number;
  intelligence: number;
  wisdom: number;
  charisma: number;
};

function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as JsonRecord;
}

export function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((entry) => String(entry || "").trim()).filter(Boolean)));
}

export function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.trim().replace(/^\+/, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function getAbilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

export function getProficiencyBonus(level: number): number {
  return Math.floor((Math.max(level, 1) - 1) / 4) + 2;
}

export function getMonsterAbilityScores(monsterData: unknown): AbilityScores {
  const root = asRecord(monsterData);
  const containers = [
    asRecord(root?.ability_scores),
    asRecord(root?.abilityScores),
    asRecord(root?.stats),
    root,
  ].filter((entry): entry is JsonRecord => Boolean(entry));

  const resolveScore = (keys: string[]): number => {
    for (const container of containers) {
      for (const key of keys) {
        const numeric = toFiniteNumber(container[key]);
        if (numeric !== null) return numeric;
      }
    }
    return 10;
  };

  return {
    strength: resolveScore(["strength", "str"]),
    dexterity: resolveScore(["dexterity", "dex"]),
    constitution: resolveScore(["constitution", "con"]),
    intelligence: resolveScore(["intelligence", "int"]),
    wisdom: resolveScore(["wisdom", "wis"]),
    charisma: resolveScore(["charisma", "cha"]),
  };
}

export function getMonsterSavingThrowOverride(monsterData: unknown, saveType: string): number | null {
  const root = asRecord(monsterData);

  const saveKeyMap: Record<string, string[]> = {
    strength: ["strength", "str"],
    dexterity: ["dexterity", "dex"],
    constitution: ["constitution", "con"],
    intelligence: ["intelligence", "int"],
    wisdom: ["wisdom", "wis"],
    charisma: ["charisma", "cha"],
  };
  const keys = saveKeyMap[saveType] || [saveType];
  const saveContainers = [asRecord(root?.saving_throws), asRecord(root?.savingThrows)].filter(
    (entry): entry is JsonRecord => Boolean(entry),
  );

  for (const container of saveContainers) {
    for (const key of keys) {
      const numeric = toFiniteNumber(container[key]);
      if (numeric !== null) return numeric;
    }
  }

  return null;
}
