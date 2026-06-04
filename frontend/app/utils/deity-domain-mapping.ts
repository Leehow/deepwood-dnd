import godsData from "~/data/rules/gods.json";

/**
 * Domain to Chinese name mapping
 * Maps English domain names to Chinese equivalents
 */
const DOMAIN_NAME_MAP: Record<string, string> = {
  "knowledge": "知识",
  "life": "生命",
  "light": "光明",
  "nature": "自然",
  "tempest": "风暴",
  "trickery": "诡术",
  "war": "战争",
  "death": "死亡"
};

/**
 * Cleric domain ID to Chinese domain name mapping
 */
const CLERIC_DOMAIN_MAP: Record<string, string> = {
  "knowledge": "知识",
  "life": "生命",
  "light": "光明",
  "nature": "自然",
  "tempest": "风暴",
  "trickery": "诡术",
  "war": "战争"
};

/**
 * Get deities that match a specific domain
 * @param domainId - The cleric domain ID (e.g., "knowledge", "life")
 * @returns Array of deity IDs that match the domain
 */
export function getDeitiesByDomain(domainId: string): string[] {
  const domainName = CLERIC_DOMAIN_MAP[domainId];
  if (!domainName) return [];

  const matchingDeities: string[] = [];

  // Search through all pantheons
  godsData.pantheons.forEach((pantheon: any) => {
    pantheon.deities?.forEach((deity: any) => {
      if (deity.domains && deity.domains.includes(domainName)) {
        matchingDeities.push(deity.id);
      }
    });
  });

  return matchingDeities;
}

/**
 * Get a recommended deity for a cleric domain
 * Prioritizes good-aligned deities from Sundered Realms (裂隙诸境)
 * @param domainId - The cleric domain ID
 * @returns Deity ID or null if no match found
 */
export function getRecommendedDeityForDomain(domainId: string): string | null {
  const matchingDeities = getDeitiesByDomain(domainId);
  if (matchingDeities.length === 0) return null;

  // Get all deities data
  const allDeities: any[] = [];
  godsData.pantheons.forEach((pantheon: any) => {
    pantheon.deities?.forEach((deity: any) => {
      allDeities.push({ ...deity, pantheonId: pantheon.id });
    });
  });

  // Filter to matching deities
  const candidates = allDeities.filter(d => matchingDeities.includes(d.id));

  // Prioritize Sundered Realms (裂隙诸境)
  const srDeities = candidates.filter(d => d.pantheonId === "sundered_realms");
  if (srDeities.length > 0) {
    // Prioritize good-aligned deities
    const goodDeities = srDeities.filter(d =>
      d.alignment === "LG" || d.alignment === "NG" || d.alignment === "CG"
    );
    if (goodDeities.length > 0) {
      return goodDeities[0].id;
    }
    return srDeities[0].id;
  }

  // Fallback to first match
  return candidates[0]?.id || null;
}

/**
 * Get a recommended deity for a paladin oath
 * @param oathId - The paladin oath ID (e.g., "devotion", "ancients", "vengeance")
 * @returns Deity ID or null
 */
export function getRecommendedDeityForOath(oathId: string): string | null {
  // Map oaths to suitable domains
  const oathToDomain: Record<string, string> = {
    "devotion": "light",      // Devotion paladins often worship light/life deities
    "ancients": "nature",     // Ancients paladins are connected to nature
    "vengeance": "war"        // Vengeance paladins often worship war deities
  };

  const domainId = oathToDomain[oathId];
  if (!domainId) return null;

  return getRecommendedDeityForDomain(domainId);
}

/**
 * Check if a class can have a deity
 * @param classId - The character class ID
 * @returns true if the class can have a deity (all classes except warlock)
 */
export function canHaveDeity(classId: string): boolean {
  return classId !== "warlock";
}

/**
 * Check if a class should have a deity (strongly recommended)
 * @param classId - The character class ID
 * @returns true if the class typically has a deity (cleric and paladin)
 */
export function shouldHaveDeity(classId: string): boolean {
  return classId === "cleric" || classId === "paladin";
}

/**
 * Get deity alignment
 * @param deityId - The deity ID
 * @returns Alignment ID (e.g., "LG", "NG") or null
 */
export function getDeityAlignment(deityId: string): string | null {
  for (const pantheon of godsData.pantheons) {
    const deity = pantheon.deities?.find((d: any) => d.id === deityId);
    if (deity) {
      return deity.alignment;
    }
  }
  return null;
}

/**
 * Get deity name
 * @param deityId - The deity ID
 * @returns Deity name (Chinese) or null
 */
export function getDeityName(deityId: string): string | null {
  for (const pantheon of godsData.pantheons) {
    const deity = pantheon.deities?.find((d: any) => d.id === deityId);
    if (deity) {
      return deity.name;
    }
  }
  return null;
}

