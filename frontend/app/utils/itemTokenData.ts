import type { EquipmentItem } from "~/components/character/CharacterDisplay/types/Character";
import {
  findAnyMetaById,
  findAnyMetaByKey,
  findArmorMetaByKey,
  findWeaponMetaByKey,
  getIconPath,
} from "~/components/character/CharacterDisplay/utils/rules";
import { getAssetUrl } from "~/utils/asset-url";

type AnyRecord = Record<string, any>;
type NormalizedDamageObject = {
  dice: string;
  type?: string;
  formula?: string;
  [key: string]: any;
};
const LIBRARY_ITEM_ID_RE = /^library-item-(\d+)$/i;
const CUSTOM_ITEM_ID_RE = /^custom-item-(\d+)$/i;

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

const toNumberOrUndefined = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
};

const toAssetPath = (value: unknown): string | undefined => {
  if (!isNonEmptyString(value)) return undefined;
  if (value.startsWith("/assets/") || value.startsWith("assets/")) {
    return value.replace(/^\/+/, "");
  }
  return undefined;
};

const toRenderableImageUrl = (value: unknown): string | undefined => {
  if (!isNonEmptyString(value)) return undefined;
  if (
    value.startsWith("http://")
    || value.startsWith("https://")
    || value.startsWith("data:")
    || value.startsWith("blob:")
  ) {
    return value;
  }
  const assetPath = toAssetPath(value);
  if (assetPath) return getAssetUrl(assetPath);
  return value;
};

const toRange = (value: unknown): string | { normal: number; long?: number } | undefined => {
  if (typeof value === "string" && value.trim().length > 0) return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;

  const normal = toNumberOrUndefined((value as AnyRecord).normal);
  const long = toNumberOrUndefined((value as AnyRecord).long);

  if (normal == null && long == null) return undefined;

  const range: { normal: number; long?: number } = { normal: normal ?? 0 };
  if (long != null) range.long = long;
  return range;
};

const toDamage = (
  value: unknown,
  explicitDamageType?: unknown,
): { damage?: string | NormalizedDamageObject; damageType?: string } => {
  if (typeof value === "string" && value.trim().length > 0) {
    return {
      damage: value,
      damageType: isNonEmptyString(explicitDamageType) ? explicitDamageType : undefined,
    };
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      damageType: isNonEmptyString(explicitDamageType) ? explicitDamageType : undefined,
    };
  }

  const damageObject = value as AnyRecord;
  const dice = isNonEmptyString(damageObject.dice)
    ? damageObject.dice
    : (isNonEmptyString(damageObject.formula) ? damageObject.formula : undefined);
  const damageType = isNonEmptyString(explicitDamageType)
    ? explicitDamageType
    : (isNonEmptyString(damageObject.type) ? damageObject.type : undefined);

  if (!dice) {
    return { damageType };
  }

  const normalizedDamage: NormalizedDamageObject = { ...damageObject, dice };
  if (!isNonEmptyString(normalizedDamage.formula) && isNonEmptyString(damageObject.formula)) {
    normalizedDamage.formula = damageObject.formula;
  }
  if (damageType) {
    normalizedDamage.type = damageType;
  }

  return { damage: normalizedDamage, damageType };
};

const resolveCategory = (item: AnyRecord, armorMeta: AnyRecord | null, weaponMeta: AnyRecord | null): string | undefined => {
  if (isNonEmptyString(item.category)) return item.category;
  if (weaponMeta) return "weapon";
  if (armorMeta) return armorMeta.tier === "shield" ? "shield" : "armor";
  return undefined;
};

const resolveEquipmentType = (
  item: AnyRecord,
  category: string | undefined,
  armorMeta: AnyRecord | null,
  weaponMeta: AnyRecord | null,
): string => {
  if (isNonEmptyString(item.equipmentType)) return item.equipmentType;
  if (weaponMeta) return "weapon";
  if (armorMeta) return "armor";
  if (category === "weapon" || category === "ammunition") return "weapon";
  if (category === "armor" || category === "shield") return "armor";
  if (category === "tool") return "tool";
  return "gear";
};

const resolveCanonicalMeta = (item: AnyRecord): AnyRecord | null => {
  const idKey = isNonEmptyString(item.id) ? item.id : undefined;
  const nameKey = isNonEmptyString(item.name)
    ? item.name
    : (isNonEmptyString(item.name_cn) ? item.name_cn : undefined);
  const allowNameLookup = !Boolean(item.is_custom);

  return (
    (idKey ? findAnyMetaById(idKey) : null)
    || (idKey ? findAnyMetaByKey(idKey) : null)
    || (allowNameLookup && nameKey ? findAnyMetaByKey(nameKey) : null)
  );
};

const resolveWeaponMeta = (item: AnyRecord) => {
  const idKey = isNonEmptyString(item.id) ? item.id : undefined;
  const nameKey = isNonEmptyString(item.name)
    ? item.name
    : (isNonEmptyString(item.name_cn) ? item.name_cn : undefined);
  const allowNameLookup = !Boolean(item.is_custom);
  return (
    (idKey ? findWeaponMetaByKey(idKey) : null)
    || (allowNameLookup && nameKey ? findWeaponMetaByKey(nameKey) : null)
  );
};

const resolveArmorMeta = (item: AnyRecord) => {
  const idKey = isNonEmptyString(item.id) ? item.id : undefined;
  const nameKey = isNonEmptyString(item.name)
    ? item.name
    : (isNonEmptyString(item.name_cn) ? item.name_cn : undefined);
  const allowNameLookup = !Boolean(item.is_custom);
  return (
    (idKey ? findArmorMetaByKey(idKey) : null)
    || (allowNameLookup && nameKey ? findArmorMetaByKey(nameKey) : null)
  );
};

const resolveRawIconPath = (item: AnyRecord, canonicalMeta?: AnyRecord | null): string | undefined => {
  return toAssetPath(item.iconPath) || toAssetPath(canonicalMeta?.iconPath);
};

const resolveExplicitAvatarUrl = (item: AnyRecord): string | undefined => {
  return toRenderableImageUrl(item.avatar_url);
};

const resolveLibraryItemId = (item: AnyRecord): number | undefined => {
  const explicitLibraryItemId = toNumberOrUndefined(item.libraryItemId);
  if (explicitLibraryItemId != null) return explicitLibraryItemId;

  if (typeof item.id === "number" && Number.isFinite(item.id)) {
    return item.id;
  }

  if (typeof item.id === "string") {
    const libraryItemMatch = item.id.match(LIBRARY_ITEM_ID_RE);
    if (libraryItemMatch) {
      return Number(libraryItemMatch[1]);
    }
    if (Boolean(item.is_custom)) {
      const customItemMatch = item.id.match(CUSTOM_ITEM_ID_RE);
      if (customItemMatch) {
        return Number(customItemMatch[1]);
      }
    }

    const numericId = toNumberOrUndefined(item.id);
    if (numericId != null) return numericId;
  }

  return undefined;
};

const resolveCanonicalItemId = (
  item: AnyRecord,
  canonicalMeta: AnyRecord | null,
  libraryItemId?: number,
): string => {
  if (Boolean(item.is_custom)) {
    if (isNonEmptyString(item.id) && !/^\d+$/.test(item.id) && !LIBRARY_ITEM_ID_RE.test(item.id)) {
      return item.id;
    }
    if (libraryItemId != null) {
      return `custom-item-${libraryItemId}`;
    }
  }
  if (isNonEmptyString(item.id) && !/^\d+$/.test(item.id)) {
    return item.id;
  }
  if (isNonEmptyString(canonicalMeta?.id)) {
    return canonicalMeta.id;
  }
  if (libraryItemId != null) {
    return `library-item-${libraryItemId}`;
  }
  if (isNonEmptyString(item.name)) {
    return item.name;
  }
  if (isNonEmptyString(item.name_cn)) {
    return item.name_cn;
  }
  return "unknown-item";
};

const resolveArmorFields = (
  item: AnyRecord,
  canonicalMeta: AnyRecord | null,
  equipmentType: string,
): { ac?: number | string; acBonus?: number; armorClass?: AnyRecord | number | string } => {
  const rawArmorClass = item.armor_class ?? canonicalMeta?.armor_class;
  const rawAc = item.ac ?? canonicalMeta?.ac ?? rawArmorClass;

  let ac: number | string | undefined;
  if (typeof rawAc === "number" || typeof rawAc === "string") {
    ac = rawAc;
  } else if (rawAc && typeof rawAc === "object") {
    const base = (rawAc as AnyRecord).base ?? (rawAc as AnyRecord).ac ?? (rawAc as AnyRecord).value;
    if (typeof base === "number" || typeof base === "string") ac = base;
  }

  let acBonus = toNumberOrUndefined(item.acBonus ?? canonicalMeta?.acBonus);
  if (acBonus == null && equipmentType === "armor") {
    acBonus = toNumberOrUndefined(item.magic_bonus);
  }

  const armorClass = rawArmorClass != null
    ? rawArmorClass
    : (ac != null ? ac : undefined);

  return { ac, acBonus, armorClass };
};

const resolveStrengthRequirement = (
  item: AnyRecord,
  canonicalMeta: AnyRecord | null,
): number | undefined => {
  return toNumberOrUndefined(
    item.strengthRequired
    ?? item.strength_requirement
    ?? canonicalMeta?.strengthRequired
    ?? canonicalMeta?.strength_requirement,
  );
};

const resolveStealthDisadvantage = (
  item: AnyRecord,
  canonicalMeta: AnyRecord | null,
): boolean | undefined => {
  const rawValue = item.stealthDisadvantage
    ?? item.stealth_disadvantage
    ?? canonicalMeta?.stealthDisadvantage
    ?? canonicalMeta?.stealth_disadvantage;
  return typeof rawValue === "boolean" ? rawValue : undefined;
};

export const resolveTokenItemImageUrl = (item: AnyRecord | null | undefined): string | null => {
  if (!item) return null;

  const explicitAvatarUrl = resolveExplicitAvatarUrl(item);
  const iconUrl = toRenderableImageUrl(item.icon);
  const rawIconPath = resolveRawIconPath(item, resolveCanonicalMeta(item));

  if (iconUrl) return iconUrl;
  if (explicitAvatarUrl) return explicitAvatarUrl;
  if (rawIconPath) return getAssetUrl(rawIconPath);

  return getIconPath({
    id: isNonEmptyString(item.id) ? item.id : String(item.id ?? ""),
    name: isNonEmptyString(item.name) ? item.name : item.name_cn,
    iconPath: rawIconPath,
    avatar_url: explicitAvatarUrl,
  });
};

export const serializeItemToTokenData = (item: AnyRecord): AnyRecord => {
  const canonicalMeta = resolveCanonicalMeta(item);
  const weaponMeta = resolveWeaponMeta(item);
  const armorMeta = resolveArmorMeta(item);
  const libraryItemId = resolveLibraryItemId(item);
  const canonicalId = resolveCanonicalItemId(item, canonicalMeta, libraryItemId);
  const category = resolveCategory(item, armorMeta, weaponMeta) ?? item.category;
  const equipmentType = resolveEquipmentType(item, category, armorMeta, weaponMeta);
  const rawIconPath = resolveRawIconPath(item, canonicalMeta);
  const explicitAvatarUrl = resolveExplicitAvatarUrl(item);
  const resolvedIcon = resolveTokenItemImageUrl(item) ?? undefined;
  const { damage, damageType } = toDamage(
    item.damage ?? canonicalMeta?.damage,
    item.damageType ?? item.damage?.type ?? canonicalMeta?.damageType ?? canonicalMeta?.damage?.type,
  );
  const range = toRange(item.range ?? canonicalMeta?.range);
  const { ac, acBonus, armorClass } = resolveArmorFields(item, canonicalMeta, equipmentType);
  const strengthRequirement = resolveStrengthRequirement(item, canonicalMeta);
  const stealthDisadvantage = resolveStealthDisadvantage(item, canonicalMeta);
  const weight = toNumberOrUndefined(item.weight ?? canonicalMeta?.weight);
  const name = isNonEmptyString(item.name)
    ? item.name
    : (isNonEmptyString(item.name_cn) ? item.name_cn : "物品");

  const {
    id: _id,
    quantity: _quantity,
    equippedSlot: _equippedSlot,
    containerId: _containerId,
    gripMode: _gripMode,
    ...rest
  } = item;

  return {
    ...rest,
    id: canonicalId,
    name,
    icon: resolvedIcon,
    iconPath: rawIconPath,
    avatar_url: explicitAvatarUrl,
    avatar_url_large: toRenderableImageUrl(item.avatar_url_large) ?? explicitAvatarUrl,
    libraryItemId,
    category,
    equipmentType,
    weight,
    damage,
    damageType,
    range,
    ac,
    acBonus,
    armor_class: armorClass,
    strengthRequired: strengthRequirement,
    strength_requirement: strengthRequirement,
    stealthDisadvantage,
    stealth_disadvantage: stealthDisadvantage,
  };
};

export const convertTokenItemToEquipment = (
  itemData: AnyRecord,
  quantity = 1,
): EquipmentItem => {
  const canonicalMeta = resolveCanonicalMeta(itemData);
  const weaponMeta = resolveWeaponMeta(itemData);
  const armorMeta = resolveArmorMeta(itemData);
  const category = resolveCategory(itemData, armorMeta, weaponMeta) ?? itemData.category;
  const equipmentType = resolveEquipmentType(itemData, category, armorMeta, weaponMeta);
  const rawIconPath = resolveRawIconPath(itemData, canonicalMeta);
  const explicitAvatarUrl = resolveExplicitAvatarUrl(itemData);
  const resolvedIconUrl = resolveTokenItemImageUrl(itemData) ?? undefined;
  const { damage, damageType } = toDamage(
    itemData.damage ?? canonicalMeta?.damage,
    itemData.damageType ?? itemData.damage?.type ?? canonicalMeta?.damageType ?? canonicalMeta?.damage?.type,
  );
  const range = toRange(itemData.range ?? canonicalMeta?.range);
  const { ac, acBonus, armorClass } = resolveArmorFields(itemData, canonicalMeta, equipmentType);
  const strengthRequirement = resolveStrengthRequirement(itemData, canonicalMeta);
  const stealthDisadvantage = resolveStealthDisadvantage(itemData, canonicalMeta);
  const libraryItemId = resolveLibraryItemId(itemData);
  const normalizedId = resolveCanonicalItemId(itemData, canonicalMeta, libraryItemId);
  const weight = toNumberOrUndefined(itemData.weight ?? canonicalMeta?.weight);
  const name = isNonEmptyString(itemData.name)
    ? itemData.name
    : (isNonEmptyString(itemData.name_cn) ? itemData.name_cn : (canonicalMeta?.name || "物品"));

  return {
    ...itemData,
    id: normalizedId,
    name,
    quantity,
    libraryItemId,
    is_custom: Boolean(itemData.is_custom),
    category,
    equipmentType,
    weight,
    damage,
    damageType,
    properties: Array.isArray(itemData.properties)
      ? itemData.properties.map(String)
      : (Array.isArray(canonicalMeta?.properties) ? canonicalMeta.properties.map(String) : undefined),
    range,
    ac,
    acBonus,
    strengthRequired: strengthRequirement,
    strength_requirement: strengthRequirement,
    stealthDisadvantage,
    stealth_disadvantage: stealthDisadvantage,
    description: isNonEmptyString(itemData.description)
      ? itemData.description
      : (isNonEmptyString(itemData.description_cn) ? itemData.description_cn : undefined),
    iconPath: rawIconPath,
    avatar_url: explicitAvatarUrl || (!rawIconPath ? resolvedIconUrl : undefined),
    avatar_url_large: toRenderableImageUrl(itemData.avatar_url_large)
      ?? explicitAvatarUrl
      ?? (!rawIconPath ? resolvedIconUrl : undefined),
    rarity: itemData.rarity ?? canonicalMeta?.rarity,
    requires_attunement: itemData.requires_attunement,
    extra_damage: itemData.extra_damage,
    magic_bonus: equipmentType !== "armor" ? toNumberOrUndefined(itemData.magic_bonus) : undefined,
    armor_class: armorClass,
  };
};

export const getEquipmentStackIdentity = (item: AnyRecord | null | undefined): string => {
  const libraryItemId = item ? resolveLibraryItemId(item) : undefined;
  const isCustomItem = Boolean(item?.is_custom);
  if (libraryItemId != null) {
    return `${isCustomItem ? "custom-library" : "library"}:${libraryItemId}`;
  }

  if (isNonEmptyString(item?.id)) {
    return `${isCustomItem ? "custom-id" : "id"}:${item.id.trim().toLowerCase()}`;
  }

  if (item?.id != null) {
    return `${isCustomItem ? "custom-id" : "id"}:${String(item.id).trim().toLowerCase()}`;
  }

  if (isNonEmptyString(item?.name)) {
    return `${isCustomItem ? "custom-name" : "name"}:${item.name.trim().toLowerCase()}`;
  }

  if (isNonEmptyString(item?.name_cn)) {
    return `${isCustomItem ? "custom-name" : "name"}:${item.name_cn.trim().toLowerCase()}`;
  }

  return "unknown-item";
};

export const isSameEquipmentStackItem = (existing: AnyRecord, incoming: EquipmentItem): boolean => {
  return getEquipmentStackIdentity(existing) === getEquipmentStackIdentity(incoming);
};

export const mergeTokenItemIntoEquipment = (
  equipment: AnyRecord[],
  itemData: AnyRecord,
  quantity = 1,
): { equipment: AnyRecord[]; item: EquipmentItem; stacked: boolean } => {
  const normalizedItem = convertTokenItemToEquipment(itemData, quantity);
  const stackTarget = (equipment || []).find((item) => !item?.equippedSlot && isSameEquipmentStackItem(item, normalizedItem));

  if (!stackTarget) {
    return {
      equipment: [...(equipment || []), normalizedItem],
      item: normalizedItem,
      stacked: false,
    };
  }

  return {
    equipment: (equipment || []).map((item) =>
      item === stackTarget
        ? { ...item, quantity: (toNumberOrUndefined(item.quantity) ?? 1) + (normalizedItem.quantity ?? 1) }
        : item
    ),
    item: normalizedItem,
    stacked: true,
  };
};
