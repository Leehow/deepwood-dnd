// Rules and equipment metadata lookup helpers
import equipmentData from "~/data/rules/equipment.json";
import { getAssetUrl } from "~/utils/asset-url";


// Lightweight metadata types for equipment lookups (non-breaking)
export type ArmorTier = "light" | "medium" | "heavy" | "shield";
export interface BaseMeta { id: string; name?: string; iconPath?: string; [key: string]: any }
export interface ArmorMeta extends BaseMeta {
  tier: ArmorTier;
  ac?: number | string;
  acBonus?: number;
  strengthRequired?: number;
  stealthDisadvantage?: boolean;
}
export interface WeaponMeta extends BaseMeta {
  damage?: string | { dice: string };
  damageType?: string;
  properties?: string[];
  range?: string | { normal: number; long?: number };
}

export const findArmorMetaById = (id: string): ArmorMeta | null => {
  const L = ((equipmentData as any)?.armor?.light || []).find((a: any) => a.id === id);
  if (L) return { ...L, tier: "light" };
  const M = ((equipmentData as any)?.armor?.medium || []).find((a: any) => a.id === id);
  if (M) return { ...M, tier: "medium" };
  const H = ((equipmentData as any)?.armor?.heavy || []).find((a: any) => a.id === id);
  if (H) return { ...H, tier: "heavy" };
  const S = ((equipmentData as any)?.armor?.shield || []).find((a: any) => a.id === id);
  if (S) return { ...S, tier: "shield" };
  return null;
};

// Match by id OR localized names (case-insensitive)
const matchByKey = (obj: any, key: string) => {
  if (typeof key !== 'string') return false;
  const keyLower = key.toLowerCase();
  return [obj?.id, obj?.name, obj?.nameEn]
    .filter(v => typeof v === 'string')
    .some(v => v.toLowerCase() === keyLower);
};

export const findArmorMetaByKey = (key: string): ArmorMeta | null => {
  const L = ((equipmentData as any)?.armor?.light || []).find((a: any) => matchByKey(a, key));
  if (L) return { ...L, tier: "light" };
  const M = ((equipmentData as any)?.armor?.medium || []).find((a: any) => matchByKey(a, key));
  if (M) return { ...M, tier: "medium" };
  const H = ((equipmentData as any)?.armor?.heavy || []).find((a: any) => matchByKey(a, key));
  if (H) return { ...H, tier: "heavy" };
  const S = ((equipmentData as any)?.armor?.shield || []).find((a: any) => matchByKey(a, key));
  if (S) return { ...S, tier: "shield" };
  return null;
};

export const findWeaponMetaByKey = (key: string): WeaponMeta | null => {
  const weapons = (equipmentData as any)?.weapons || {};
  for (const prof of ["simple", "martial"]) {
    const group = (weapons as any)[prof] || {};
    for (const type of ["melee", "ranged"]) {
      const arr: any[] = (group as any)[type] || [];
      const found = arr.find((w: any) => matchByKey(w, key));
      if (found) return found;
    }
  }
  return null;
};


export const findWeaponMetaById = (id: string): WeaponMeta | null => {
  const weapons = (equipmentData as any)?.weapons || {};
  for (const prof of ["simple", "martial"]) {
    const group = (weapons as any)[prof] || {};
    for (const type of ["melee", "ranged"]) {
      const arr: any[] = (group as any)[type] || [];
      const found = arr.find((i: any) => i.id === id);
      if (found) return found;
    }
  }
  return null;
};

export const findInObjectOfArrays = (obj: any, id: string): BaseMeta | null => {
  for (const key of Object.keys(obj || {})) {
    const arr: any[] = obj[key] || [];
    const found = arr.find((i: any) => i.id === id);
    if (found) return found;
  }
  return null;
};

export const findAnyMetaById = (id: string): (BaseMeta | ArmorMeta | WeaponMeta) | null => {
  return (
    findArmorMetaById(id) ||
    findWeaponMetaById(id) ||
    findInObjectOfArrays((equipmentData as any)?.adventuringGear, id) ||
    findInObjectOfArrays((equipmentData as any)?.tools, id) ||
    ((((equipmentData as any)?.packs || []) as any[]).find((i: any) => i.id === id) || null) ||
    ((((equipmentData as any)?.backgroundItems || []) as any[]).find((i: any) => i.id === id) || null)
  );
};

const findInObjectOfArraysByKey = (obj: any, key: string): BaseMeta | null => {
  for (const k of Object.keys(obj || {})) {
    const arr: any[] = obj[k] || [];
    const found = arr.find((i: any) => matchByKey(i, key));
    if (found) return found;
  }
  return null;
};

export const findAnyMetaByKey = (key: string): (BaseMeta | ArmorMeta | WeaponMeta) | null => {
  return (
    findArmorMetaByKey(key) ||
    findWeaponMetaByKey(key) ||
    findInObjectOfArraysByKey((equipmentData as any)?.adventuringGear, key) ||
    findInObjectOfArraysByKey((equipmentData as any)?.tools, key) ||
    ((((equipmentData as any)?.packs || []) as any[]).find((i: any) => matchByKey(i, key)) || null) ||
    ((((equipmentData as any)?.backgroundItems || []) as any[]).find((i: any) => matchByKey(i, key)) || null)
  );
};


export const getIconPath = (it: { id: string; name?: string; iconPath?: string; avatar_url?: string } | null | undefined): string | null => {
  if (!it) return null;
  if (it.iconPath) return getAssetUrl(it.iconPath.replace(/^\//, ''));
  if (it.avatar_url) return it.avatar_url as string; // fallback to custom avatar if any
  const meta =
    findAnyMetaById(it.id) ||
    findAnyMetaByKey(it.id) ||
    (it.name ? findAnyMetaByKey(it.name) : null);
  const iconPath = meta && (meta.iconPath as string) ? (meta.iconPath as string) : null;
  return iconPath ? getAssetUrl(iconPath.replace(/^\//, '')) : null;
};

export const getWeaponGroupAndType = (
  id: string
): { group: "simple" | "martial"; type: "melee" | "ranged" } | null => {
  const weapons = (equipmentData as any)?.weapons || {};
  for (const group of ["simple", "martial"] as const) {
    const g = (weapons as any)[group] || {};
    for (const type of ["melee", "ranged"] as const) {
      const arr: any[] = (g as any)[type] || [];
      if (arr.find((w: any) => w.id === id)) return { group, type };
    }
  }
  return null;
};

export const getWeaponGroupByKey = (
  key: string
): { group: "simple" | "martial"; type: "melee" | "ranged" } | null => {
  const weapons = (equipmentData as any)?.weapons || {};
  for (const group of ["simple", "martial"] as const) {
    const g = (weapons as any)[group] || {};
    for (const type of ["melee", "ranged"] as const) {
      const arr: any[] = (g as any)[type] || [];
      if (arr.find((w: any) => matchByKey(w, key))) return { group, type };
    }
  }
  return null;
};

