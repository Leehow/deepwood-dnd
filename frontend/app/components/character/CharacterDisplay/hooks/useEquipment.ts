import { useCallback, useEffect, useMemo, useState } from "react";
import equipmentData from "~/data/rules/equipment.json";
import { getIconPath, findAnyMetaById, findAnyMetaByKey } from "../utils/rules";
import { getConsumableData, rollConsumableDice, formatConsumableResult, broadcastConsumableUsed } from "../utils/consumableUtils";
import { isTwoHandedWeapon, isVersatileWeapon } from "../utils/equipment";

import type { EquipmentItem, Character, EquipSlot, Currency } from "../types/Character";
import { apiFetch } from "~/utils/api-client";
import { publishAppEvent } from "~/events/appEventBus";
import { createLogger } from '~/utils/logger';
import { getEquipmentStackIdentity, serializeItemToTokenData } from "~/utils/itemTokenData";
const logger = createLogger('useEquipment');


export interface UseEquipmentArgs {
  character: Character;
  campaignId: string;
  currentMapUrl: string | null;
  persistCharacterPartial: (
    nextEquipment?: EquipmentItem[] | undefined,
    nextPreparedSpells?: string[] | undefined,
    nextCurrency?: Currency | undefined
  ) => Promise<boolean | any>;
  showToast: (message: string, type?: "success" | "error" | "info") => void;
}

const DEFAULT_EQUIPMENT: EquipmentItem[] = [];

export function useEquipment({
  character,
  campaignId,
  currentMapUrl,
  persistCharacterPartial,
  showToast,
}: UseEquipmentArgs) {
  const authedFetch = (input: RequestInfo | URL, init?: RequestInit) =>
    apiFetch(input, { ...init, userId: character.user_id });
  // Core equipment UI state
  const [equipDialogSlot, setEquipDialogSlot] = useState<EquipSlot | null>(null);
  const [equipDialogOpen, setEquipDialogOpen] = useState(false);
  const [bagOpen, setBagOpen] = useState(false);
  const [itemDetailOpen, setItemDetailOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<EquipmentItem | null>(null);
  const [equipmentLocal, setEquipmentLocal] = useState<EquipmentItem[]>(character.equipment || DEFAULT_EQUIPMENT);

  // Stack + discard
  const [splitQty, setSplitQty] = useState(1);
  const [splitLoading, setSplitLoading] = useState(false);
  const [mergeLoading, setMergeLoading] = useState(false);
  const [discardQuantity, setDiscardQuantity] = useState(1);
  const [discardLoading, setDiscardLoading] = useState(false);

  // Pack organization
  const [organizeLoading, setOrganizeLoading] = useState(false);
  const [organizedPacks, setOrganizedPacks] = useState<Record<string, any[]>>({});

  // Sync from character.id changes + normalize ids and names by rules
  useEffect(() => {
    const src = character.equipment || DEFAULT_EQUIPMENT;
    const normalized = (src || []).map((it: EquipmentItem) => {
      const key = it?.id || it?.name;
      if (!key) return it;
      const meta = findAnyMetaByKey(key) || (it?.name ? findAnyMetaByKey(it.name) : null);
      if (meta) {
        // Merge metadata into item, preserving existing values if already set
        const updated = { ...it };
        if ((meta as any).id) updated.id = (meta as any).id;
        if ((meta as any).name && !it.name?.match(/[\u4e00-\u9fa5]/)) {
          // Only update name if current name doesn't have Chinese characters
          updated.name = (meta as any).name;
        }
        if ((meta as any).nameEn && !updated.nameEn) updated.nameEn = (meta as any).nameEn;
        if ((meta as any).iconPath && !updated.iconPath) updated.iconPath = (meta as any).iconPath;
        if ((meta as any).damage && !updated.damage) updated.damage = (meta as any).damage;
        if ((meta as any).damageType && !updated.damageType) updated.damageType = (meta as any).damageType;
        if ((meta as any).ac && !updated.ac) updated.ac = (meta as any).ac;
        if ((meta as any).acFormula && !updated.acFormula) updated.acFormula = (meta as any).acFormula;
        if ((meta as any).weight !== undefined && updated.weight === undefined) updated.weight = (meta as any).weight;
        if ((meta as any).cost && !updated.cost) updated.cost = (meta as any).cost;
        return updated as EquipmentItem;
      }
      return it;
    });
    setEquipmentLocal(normalized);
  }, [character.id, character.equipment]);

  // Derived helpers
  const getEquipped = useCallback((slot: EquipSlot) => {
    const arr = equipmentLocal || [];
    return arr.find((x: EquipmentItem) => x?.equippedSlot === slot) || null;
  }, [equipmentLocal]);

  // Build weapon ID sets from equipment.json (simple + martial, melee + ranged)
  const weaponKeys = useMemo(() => {
    const ids = new Set<string>();
    const weapons = (equipmentData as any)?.weapons;
    if (weapons) {
      for (const category of ['simple', 'martial']) {
        for (const type of ['melee', 'ranged']) {
          const arr = weapons[category]?.[type] || [];
          for (const w of arr) {
            if (w.id) ids.add(w.id);
            if (w.name) ids.add(w.name);
            if (w.nameEn) ids.add(w.nameEn);
          }
        }
      }
    }
    return ids;
  }, []);

  const backpackWeapons = useMemo(() => (equipmentLocal || []).filter((it: EquipmentItem) =>
    !it?.equippedSlot && (it?.equipmentType === "weapon" || weaponKeys.has(it?.id) || weaponKeys.has(it?.name))
  ), [equipmentLocal, weaponKeys]);
  const backpackArmor = useMemo(() => (equipmentLocal || []).filter((it: EquipmentItem) => !it?.equippedSlot && it?.equipmentType === "armor" && it?.id !== "shield"), [equipmentLocal]);
  const backpackShield = useMemo(() => (equipmentLocal || []).filter((it: EquipmentItem) => !it?.equippedSlot && it?.id === "shield"), [equipmentLocal]);

  // Other hand-held items from backpack (focus, light sources, tools)
  const focusIds = useMemo(() => new Set<string>([
    ...(((equipmentData as any)?.adventuringGear?.arcaneFocus) || []).map((i: any) => i.id),
    ...(((equipmentData as any)?.adventuringGear?.druidicFocus) || []).map((i: any) => i.id),
    ...(((equipmentData as any)?.adventuringGear?.holySymbol) || []).map((i: any) => i.id),
  ]), []);
  const lightSourceIds = useMemo(() => new Set<string>((((equipmentData as any)?.adventuringGear?.lightSources) || []).map((i: any) => i.id)), []);
  const backpackOtherHandheld = useMemo(() => (equipmentLocal || []).filter((it: EquipmentItem) => {
    if (it?.equippedSlot) return false;
    if (it?.equipmentType !== "gear" && it?.equipmentType !== "tool") return false;
    return focusIds.has(it.id) || lightSourceIds.has(it.id) || it.equipmentType === "tool";
  }), [equipmentLocal, focusIds, lightSourceIds]);

  // Ammunition items
  const ammoIds = useMemo(() => new Set<string>(
    (((equipmentData as any)?.adventuringGear?.ammunition) || []).map((i: any) => i.id)
  ), []);
  const backpackAmmo = useMemo(() => (equipmentLocal || []).filter((it: EquipmentItem) =>
    !it?.equippedSlot && (ammoIds.has(it?.id) || ammoIds.has(it?.name))
  ), [equipmentLocal, ammoIds]);

  // Consumable items (potions, scrolls, etc.) for quick slot
  const consumableIds = useMemo(() => new Set<string>([
    ...(((equipmentData as any)?.adventuringGear?.potionsAndPoisons) || []).map((i: any) => i.id),
    ...(((equipmentData as any)?.adventuringGear?.survival) || []).map((i: any) => i.id),
  ]), []);
  const backpackConsumables = useMemo(() => (equipmentLocal || []).filter((it: EquipmentItem) =>
    !it?.equippedSlot && (consumableIds.has(it?.id) || consumableIds.has(it?.name) ||
    (it?.category === 'potion') || (it?.category === 'consumable'))
  ), [equipmentLocal, consumableIds]);

  // Clothing items (common clothes, fine clothes, robes, vestments, etc.)
  const clothingIds = useMemo(() => new Set<string>(
    (((equipmentData as any)?.adventuringGear?.clothing) || []).flatMap((i: any) => [i.id, i.name, i.nameEn].filter(Boolean))
  ), []);
  const extraClothingIds = new Set(['vestments', 'fine_clothes', 'common_clothes']);
  const backpackClothing = useMemo(() => (equipmentLocal || []).filter((it: EquipmentItem) =>
    !it?.equippedSlot && (clothingIds.has(it?.id) || clothingIds.has(it?.name) || extraClothingIds.has(it?.id))
  ), [equipmentLocal, clothingIds]);

  // Accessory items (holy symbols, signet ring, etc.)
  const accessoryIds = useMemo(() => new Set<string>([
    ...(((equipmentData as any)?.adventuringGear?.holySymbol) || []).flatMap((i: any) => [i.id, i.name, i.nameEn].filter(Boolean)),
    'holy_symbol', 'signet_ring',
  ]), []);
  const backpackAccessory = useMemo(() => (equipmentLocal || []).filter((it: EquipmentItem) =>
    !it?.equippedSlot && (accessoryIds.has(it?.id) || accessoryIds.has(it?.name))
  ), [equipmentLocal, accessoryIds]);

  // Armor sub-groups (match by id OR localized name to be robust)
  const lightArmorKeys = useMemo(() => new Set<string>(((((equipmentData as any)?.armor?.light) || []).flatMap((i: any) => [i.id, i.name, i.nameEn].filter(Boolean)))), []);
  const mediumArmorKeys = useMemo(() => new Set<string>(((((equipmentData as any)?.armor?.medium) || []).flatMap((i: any) => [i.id, i.name, i.nameEn].filter(Boolean)))), []);
  const heavyArmorKeys = useMemo(() => new Set<string>(((((equipmentData as any)?.armor?.heavy) || []).flatMap((i: any) => [i.id, i.name, i.nameEn].filter(Boolean)))), []);
  const backpackLightArmor = useMemo(() => (equipmentLocal || []).filter((it: EquipmentItem) => !it.equippedSlot && (lightArmorKeys.has(it.id) || lightArmorKeys.has(it.name))), [equipmentLocal, lightArmorKeys]);
  const backpackMediumArmor = useMemo(() => (equipmentLocal || []).filter((it: EquipmentItem) => !it.equippedSlot && (mediumArmorKeys.has(it.id) || mediumArmorKeys.has(it.name))), [equipmentLocal, mediumArmorKeys]);
  const backpackHeavyArmor = useMemo(() => (equipmentLocal || []).filter((it: EquipmentItem) => !it.equippedSlot && (heavyArmorKeys.has(it.id) || heavyArmorKeys.has(it.name))), [equipmentLocal, heavyArmorKeys]);

  // Container support - identify container items (by id or name, case-insensitive)
  const containerKeys = useMemo(() => {
    const containers = ((equipmentData as any)?.adventuringGear?.containers) || [];
    const keys = new Set<string>();
    for (const c of containers) {
      if (c.id) keys.add(c.id.toLowerCase());
      if (c.name) keys.add(c.name.toLowerCase());
      if (c.nameEn) keys.add(c.nameEn.toLowerCase());
    }
    return keys;
  }, []);

  // Get items inside a container
  const getContainerContents = useCallback((containerId: string) => {
    return (equipmentLocal || []).filter((it: EquipmentItem) => it.containerId === containerId);
  }, [equipmentLocal]);

  // Get available containers (ones that are in equipment)
  const availableContainers = useMemo(() => {
    return (equipmentLocal || []).filter((it: EquipmentItem) =>
      containerKeys.has(String(it.id || '').toLowerCase()) || containerKeys.has(String(it.name || '').toLowerCase())
    );
  }, [equipmentLocal, containerKeys]);

  // Book container detection: name contains "书"
  const isBookContainer = useCallback((itemIdOrName: string | number) => {
    const s = String(itemIdOrName || '');
    if (s.includes('书')) return true;
    // Also check English book-related ids
    const lower = s.toLowerCase();
    if (lower === 'book' || lower.includes('spellbook') || lower.includes('spell_book') || lower.includes('tome')) return true;
    return false;
  }, []);

  // Check if a container item (by its id) is a book — looks up the actual item in inventory
  const isBookContainerById = useCallback((containerId: string) => {
    if (isBookContainer(containerId)) return true;
    // Look up the actual container item to check its name
    const containerItem = (equipmentLocal || []).find(it => it.id === containerId);
    if (containerItem && (containerItem.name || '').includes('书')) return true;
    return false;
  }, [equipmentLocal, isBookContainer]);

  // Paper item detection: name contains "纸"
  const isPaperItem = useCallback((item: EquipmentItem) => {
    return (item.name || '').includes('纸');
  }, []);

  // Check if item is a container (by id or name, case-insensitive) — includes book containers
  const isContainer = useCallback((itemIdOrName: string | number) => {
    return containerKeys.has(String(itemIdOrName || '').toLowerCase()) || isBookContainer(itemIdOrName);
  }, [containerKeys, isBookContainer]);

  // Put item into a container
  const handlePutInContainer = useCallback(async (item: EquipmentItem, containerId: string) => {
    if (!item || !containerId) return;
    if (item.id === containerId) { showToast("容器不能放入自己", "error"); return; }
    if (item.containerId === containerId) { showToast("物品已在此容器中", "info"); return; }

    // Book containers only accept paper items
    if (isBookContainerById(containerId)) {
      if (!isPaperItem(item) && !item.writtenContent) {
        showToast("书本只能存放纸类物品", "error"); return;
      }
    }

    try {
      const newEquipment = (equipmentLocal || []).map((it: EquipmentItem) => {
        if (it === item || (it.id === item.id && it.quantity === item.quantity && it.containerId === item.containerId)) {
          return { ...it, containerId };
        }
        return it;
      });
      setEquipmentLocal(newEquipment);
      await persistCharacterPartial(newEquipment, undefined);
      setSelectedItem({ ...item, containerId });
      showToast(`已将 ${item.name} 放入容器`, "success");
    } catch (e) {
      logger.error("Put in container error:", e);
      showToast("放入容器失败", "error");
    }
  }, [equipmentLocal, persistCharacterPartial, showToast, isBookContainerById, isPaperItem]);

  // Put multiple items into a container (batch operation)
  const handlePutMultipleInContainer = useCallback(async (items: EquipmentItem[], containerId: string) => {
    if (!items.length || !containerId) return;

    // Filter out invalid items
    const validItems = items.filter(item =>
      item && item.id !== containerId && item.containerId !== containerId
    );
    if (!validItems.length) return;

    try {
      // Create a set of item keys for efficient lookup
      const itemKeys = new Set(validItems.map(item =>
        `${item.id}-${item.quantity || 1}-${item.containerId || 'root'}`
      ));

      const newEquipment = (equipmentLocal || []).map((it: EquipmentItem) => {
        const key = `${it.id}-${it.quantity || 1}-${it.containerId || 'root'}`;
        if (itemKeys.has(key)) {
          return { ...it, containerId };
        }
        return it;
      });

      setEquipmentLocal(newEquipment);
      await persistCharacterPartial(newEquipment, undefined);
      showToast(`已将 ${validItems.length} 件物品放入容器`, "success");
    } catch (e) {
      logger.error("Put multiple in container error:", e);
      showToast("放入容器失败", "error");
    }
  }, [equipmentLocal, persistCharacterPartial, showToast]);

  // Take item out of container
  const handleTakeOutOfContainer = useCallback(async (item: EquipmentItem) => {
    logger.info("[handleTakeOutOfContainer] Called with item:", item);
    if (!item || !item.containerId) {
      logger.warn("[handleTakeOutOfContainer] No item or containerId", { item, containerId: item?.containerId });
      return;
    }

    try {
      const newEquipment = (equipmentLocal || []).map((it: EquipmentItem) => {
        if (it === item || (it.id === item.id && it.quantity === item.quantity && it.containerId === item.containerId)) {
          const { containerId, ...rest } = it;
          return rest;
        }
        return it;
      });
      logger.info("[handleTakeOutOfContainer] New equipment:", newEquipment);
      setEquipmentLocal(newEquipment);
      await persistCharacterPartial(newEquipment, undefined);
      const { containerId, ...itemWithoutContainer } = item;
      setSelectedItem(itemWithoutContainer as EquipmentItem);
      showToast(`已将 ${item.name} 取出`, "success");
    } catch (e) {
      logger.error("Take out of container error:", e);
      showToast("取出容器失败", "error");
    }
  }, [equipmentLocal, persistCharacterPartial, showToast]);

  // Stack items: merge source item quantity into target item
  const handleStackItems = useCallback(async (sourceItem: EquipmentItem, targetItem: EquipmentItem) => {
    if (!sourceItem || !targetItem) return;
    if (sourceItem.id !== targetItem.id) {
      showToast("只能堆叠相同物品", "error");
      return;
    }
    if (sourceItem === targetItem) return;

    try {
      const sourceQty = sourceItem.quantity || 1;
      const targetQty = targetItem.quantity || 1;
      const newQty = sourceQty + targetQty;

      // Find and update items in equipment list
      const newEquipment = (equipmentLocal || [])
        .filter((it: EquipmentItem) => {
          // Remove source item (match by id, quantity, and containerId)
          const isSource = it.id === sourceItem.id &&
            it.quantity === sourceItem.quantity &&
            it.containerId === sourceItem.containerId &&
            it.equippedSlot === sourceItem.equippedSlot;
          return !isSource;
        })
        .map((it: EquipmentItem) => {
          // Update target item quantity
          const isTarget = it.id === targetItem.id &&
            it.quantity === targetItem.quantity &&
            it.containerId === targetItem.containerId &&
            it.equippedSlot === targetItem.equippedSlot;
          if (isTarget) {
            return { ...it, quantity: newQty };
          }
          return it;
        });

      setEquipmentLocal(newEquipment);
      await persistCharacterPartial(newEquipment, undefined);
      showToast(`已堆叠 ${sourceItem.name || sourceItem.id}，数量 ${newQty}`, "success");
    } catch (e) {
      logger.error("Stack items error:", e);
      showToast("堆叠失败", "error");
    }
  }, [equipmentLocal, persistCharacterPartial, showToast]);

  // Open equip dialog
  const openEquip = useCallback((slot: EquipSlot) => {
    setEquipDialogSlot(slot);
    setEquipDialogOpen(true);
  }, []);

  // Apply equip to slot
  const applyEquip = useCallback(async (item: EquipmentItem) => {
    if (!equipDialogSlot) return;
    const slot = equipDialogSlot;
    // 堆叠物品自动拆分（弹药槽除外，弹药整组装备）
    const shouldSplit = (item.quantity || 1) > 1 && slot !== "ammo";
    const next = (equipmentLocal || []).map((x: EquipmentItem) => {
      if (!x) return x;
      if (x === item) {
        if (shouldSplit) {
          return { ...x, quantity: (x.quantity || 1) - 1 };
        }
        const updated: EquipmentItem = { ...x, equippedSlot: slot };
        if (slot === "main_hand" && isVersatileWeapon(item)) {
          updated.gripMode = "one-hand";
        }
        return updated;
      }
      if (x.equippedSlot === slot) return { ...x, equippedSlot: undefined };
      if (slot === "main_hand" && isTwoHandedWeapon(item) && x.equippedSlot === "off_hand") {
        return { ...x, equippedSlot: undefined };
      }
      if (slot === "off_hand" && x.equippedSlot === "main_hand" && isTwoHandedWeapon(x)) {
        return { ...x, equippedSlot: undefined };
      }
      if (slot === "off_hand" && x.equippedSlot === "main_hand" && isVersatileWeapon(x) && x.gripMode === "two-hand") {
        return { ...x, gripMode: "one-hand" as const };
      }
      return x;
    });
    if (shouldSplit) {
      const equipped: EquipmentItem = { ...item, quantity: 1, equippedSlot: slot };
      if (slot === "main_hand" && isVersatileWeapon(item)) equipped.gripMode = "one-hand";
      next.push(equipped);
    }
    setEquipmentLocal(next);
    setEquipDialogOpen(false);
    await persistCharacterPartial(next, undefined);
    publishAppEvent('characterEquipmentUpdated', {
      characterId: character.id,
      equipment: next,
      needsBroadcast: true,
    });
  }, [equipDialogSlot, equipmentLocal, persistCharacterPartial, character.id]);

  // Apply equip directly with a given slot (for drag-to-slot)
  const applyEquipDirect = useCallback(async (item: EquipmentItem, slot: EquipSlot) => {
    const shouldSplit = (item.quantity || 1) > 1 && slot !== "ammo";
    const next = (equipmentLocal || []).map((x: EquipmentItem) => {
      if (!x) return x;
      if (x === item) {
        if (shouldSplit) {
          return { ...x, quantity: (x.quantity || 1) - 1 };
        }
        const updated: EquipmentItem = { ...x, equippedSlot: slot };
        if (slot === "main_hand" && isVersatileWeapon(item)) {
          updated.gripMode = "one-hand";
        }
        return updated;
      }
      if (x.equippedSlot === slot) return { ...x, equippedSlot: undefined };
      if (slot === "main_hand" && isTwoHandedWeapon(item) && x.equippedSlot === "off_hand") {
        return { ...x, equippedSlot: undefined };
      }
      if (slot === "off_hand" && x.equippedSlot === "main_hand" && isTwoHandedWeapon(x)) {
        return { ...x, equippedSlot: undefined };
      }
      if (slot === "off_hand" && x.equippedSlot === "main_hand" && isVersatileWeapon(x) && x.gripMode === "two-hand") {
        return { ...x, gripMode: "one-hand" as const };
      }
      return x;
    });
    if (shouldSplit) {
      const equipped: EquipmentItem = { ...item, quantity: 1, equippedSlot: slot };
      if (slot === "main_hand" && isVersatileWeapon(item)) equipped.gripMode = "one-hand";
      next.push(equipped);
    }
    setEquipmentLocal(next);
    await persistCharacterPartial(next, undefined);
    publishAppEvent('characterEquipmentUpdated', {
      characterId: character.id,
      equipment: next,
      needsBroadcast: true,
    });
  }, [equipmentLocal, persistCharacterPartial, character.id]);

  // Toggle grip mode for versatile weapon in main hand
  const toggleGripMode = useCallback(async () => {
    const mainHand = (equipmentLocal || []).find((x: EquipmentItem) => x?.equippedSlot === "main_hand");
    if (!mainHand || !isVersatileWeapon(mainHand)) return;

    const newMode: "one-hand" | "two-hand" = mainHand.gripMode === "two-hand" ? "one-hand" : "two-hand";
    const next = (equipmentLocal || []).map((x: EquipmentItem) => {
      if (!x) return x;
      if (x.equippedSlot === "main_hand" && x.id === mainHand.id) {
        return { ...x, gripMode: newMode };
      }
      // 切换到双手时清除副手装备
      if (newMode === "two-hand" && x.equippedSlot === "off_hand") {
        return { ...x, equippedSlot: undefined };
      }
      return x;
    });
    setEquipmentLocal(next);
    await persistCharacterPartial(next, undefined);
    publishAppEvent('characterEquipmentUpdated', {
      characterId: character.id,
      equipment: next,
      needsBroadcast: true,
    });
  }, [equipmentLocal, persistCharacterPartial, character.id]);

  // Split stack
  const handleSplitStack = useCallback(async () => {
    if (!selectedItem) return;
    const qty = selectedItem.quantity || 1;
    const q = Math.floor(Number(splitQty) || 0);
    if (qty <= 1) { showToast("此物品只有 1 件，无法拆分", "error"); return; }
    if (q <= 0 || q >= qty) { showToast("拆分数量非法", "error"); return; }
    try {
      setSplitLoading(true);
      const newEquipment = equipmentLocal.map((it: EquipmentItem) => (it === selectedItem ? { ...it, quantity: (qty - q) } : it));
      const splitEntry = { ...selectedItem, quantity: q, equippedSlot: undefined };
      newEquipment.push(splitEntry);
      await persistCharacterPartial(newEquipment, undefined);
      const idLower = (selectedItem.id || '').toLowerCase();
      const reselection = newEquipment.find((it: EquipmentItem) => (it.id || '').toLowerCase() === idLower && (!!it.equippedSlot) === (!!selectedItem.equippedSlot) && (it.quantity === (qty - q)))
        || newEquipment.find((it: EquipmentItem) => (it.id || '').toLowerCase() === idLower && (!!it.equippedSlot) === (!!selectedItem.equippedSlot));
      if (reselection) setSelectedItem(reselection);
      setSplitQty(1);
      showToast(`已拆分 ${selectedItem.name}：${q} 件`, "success");
    } catch (e) {
      logger.error("Split stack error:", e);
      showToast("拆分失败", "error");
    } finally {
      setSplitLoading(false);
    }
  }, [selectedItem, splitQty, equipmentLocal, persistCharacterPartial, showToast]);

  // Split stack (direct version for context menu - takes item and quantity as params)
  const splitStackDirect = useCallback(async (item: EquipmentItem, quantity: number) => {
    const qty = item.quantity || 1;
    if (qty <= 1) { showToast("此物品只有 1 件，无法拆分", "error"); return; }
    if (quantity <= 0 || quantity >= qty) { showToast("拆分数量非法", "error"); return; }
    try {
      setSplitLoading(true);
      const newEquipment = equipmentLocal.map((it: EquipmentItem) =>
        (it.id === item.id && it.containerId === item.containerId && it.quantity === item.quantity)
          ? { ...it, quantity: (qty - quantity) }
          : it
      );
      const splitEntry = { ...item, quantity, equippedSlot: undefined };
      newEquipment.push(splitEntry);
      await persistCharacterPartial(newEquipment, undefined);
      showToast(`已拆分 ${item.name}：${quantity} 件`, "success");
    } catch (e) {
      logger.error("Split stack error:", e);
      showToast("拆分失败", "error");
    } finally {
      setSplitLoading(false);
    }
  }, [equipmentLocal, persistCharacterPartial, showToast]);

  // Merge stacks
  const handleMergeStacks = useCallback(async () => {
    if (!selectedItem) return;
    const stackIdentity = getEquipmentStackIdentity(selectedItem);
    const sameUnequipped = (equipmentLocal || []).filter((it: EquipmentItem) =>
      getEquipmentStackIdentity(it) === stackIdentity && !it.equippedSlot
    );
    if (sameUnequipped.length <= 1) { showToast("没有可合并的未装备堆叠", "info"); return; }
    try {
      setMergeLoading(true);
      const total = sameUnequipped.reduce((sum: number, it: EquipmentItem) => sum + (it.quantity || 1), 0);
      const base = { ...sameUnequipped[0], quantity: total };
      const newEquipment = (equipmentLocal || []).filter((it: EquipmentItem) =>
        getEquipmentStackIdentity(it) !== stackIdentity || !!it.equippedSlot
      );
      newEquipment.push(base);
      await persistCharacterPartial(newEquipment, undefined);
      let reselection: any = null;
      if (selectedItem.equippedSlot) {
        reselection = newEquipment.find((it: EquipmentItem) => getEquipmentStackIdentity(it) === stackIdentity && !!it.equippedSlot);
      } else {
        reselection = newEquipment.find((it: EquipmentItem) => getEquipmentStackIdentity(it) === stackIdentity && !it.equippedSlot);
      }
      if (reselection) setSelectedItem(reselection);
      showToast("已合并同类未装备堆叠", "success");
    } catch (e) {
      logger.error("Merge stacks error:", e);
      showToast("合并失败", "error");
    } finally {
      setMergeLoading(false);
    }
  }, [selectedItem, equipmentLocal, persistCharacterPartial, showToast]);

  // Merge stacks (direct version for context menu)
  const mergeStacksDirect = useCallback(async (item: EquipmentItem) => {
    const stackIdentity = getEquipmentStackIdentity(item);
    const sameUnequipped = (equipmentLocal || []).filter((it: EquipmentItem) =>
      getEquipmentStackIdentity(it) === stackIdentity && !it.equippedSlot
    );
    if (sameUnequipped.length <= 1) { showToast("没有可合并的未装备堆叠", "info"); return; }
    try {
      setMergeLoading(true);
      const total = sameUnequipped.reduce((sum: number, it: EquipmentItem) => sum + (it.quantity || 1), 0);
      const base = { ...sameUnequipped[0], quantity: total };
      const newEquipment = (equipmentLocal || []).filter((it: EquipmentItem) =>
        getEquipmentStackIdentity(it) !== stackIdentity || !!it.equippedSlot
      );
      newEquipment.push(base);
      await persistCharacterPartial(newEquipment, undefined);
      showToast("已合并同类未装备堆叠", "success");
    } catch (e) {
      logger.error("Merge stacks error:", e);
      showToast("合并失败", "error");
    } finally {
      setMergeLoading(false);
    }
  }, [equipmentLocal, persistCharacterPartial, showToast]);

  // Batch take out of containers
  const handleBatchTakeOut = useCallback(async (items: EquipmentItem[]) => {
    const itemsInContainers = items.filter(it => it.containerId);
    if (!itemsInContainers.length) return;

    try {
      const itemKeys = new Set(itemsInContainers.map(item =>
        `${item.id}-${item.quantity || 1}-${item.containerId}`
      ));

      const newEquipment = (equipmentLocal || []).map((it: EquipmentItem) => {
        const key = `${it.id}-${it.quantity || 1}-${it.containerId}`;
        if (itemKeys.has(key)) {
          const { containerId, ...rest } = it;
          return rest;
        }
        return it;
      });

      setEquipmentLocal(newEquipment);
      await persistCharacterPartial(newEquipment, undefined);
      showToast(`已从容器取出 ${itemsInContainers.length} 件物品`, "success");
    } catch (e) {
      logger.error("Batch take out error:", e);
      showToast("批量取出失败", "error");
    }
  }, [equipmentLocal, persistCharacterPartial, showToast]);

  // Batch discard items
  const handleBatchDiscard = useCallback(async (items: EquipmentItem[]) => {
    if (!items.length) return;

    try {
      // Create item keys for efficient lookup
      const itemKeys = new Set(items.map(item =>
        `${item.id}-${item.quantity || 1}-${item.containerId || 'root'}`
      ));

      // Remove items from equipment
      const newEquipment = (equipmentLocal || []).filter((it: EquipmentItem) => {
        const key = `${it.id}-${it.quantity || 1}-${it.containerId || 'root'}`;
        return !itemKeys.has(key);
      });

      // Try to drop to map if context is available
      if (currentMapUrl && campaignId) {
        try {
          const tokensResp = await authedFetch(`/api/tokens/campaign/${campaignId}/map?map_url=${encodeURIComponent(currentMapUrl)}`);
          if (tokensResp.ok) {
            const tokensData = await tokensResp.json();
            const charToken = (tokensData.tokens || []).find((t: any) => t.character_id === character.id);
            if (charToken) {
              // Drop items to map near character
              for (const item of items) {
                const findEmptyPosition = (baseX: number, baseY: number, existingTokens: any[]) => {
                  const offsets = [[1,0],[0,1],[-1,0],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1],[2,0],[0,2],[-2,0],[0,-2]];
                  const used = new Set<string>((existingTokens || []).map((t: any) => `${t.position_x},${t.position_y}`));
                  for (const [dx,dy] of offsets) {
                    const nx = baseX + dx, ny = baseY + dy;
                    if (!used.has(`${nx},${ny}`)) return { x: nx, y: ny };
                  }
                  return { x: baseX + Math.random() * 2, y: baseY + Math.random() * 2 };
                };
                const emptyPos = findEmptyPosition(charToken.position_x, charToken.position_y, tokensData.tokens);
                const iconPath = getIconPath(item);
                const fullIconUrl = iconPath ? (iconPath.startsWith('http') ? iconPath : `${window.location.origin}${iconPath}`) : null;
                const qty = item.quantity || 1;
                const serializedItem = serializeItemToTokenData(item);

                await authedFetch("/api/tokens/", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    campaign_id: campaignId,
                    item_data: {
                      ...serializedItem,
                      icon: fullIconUrl ?? serializedItem.icon,
                    },
                    item_quantity: qty,
                    user_id: character.user_id,
                    map_url: currentMapUrl,
                    position_x: emptyPos.x,
                    position_y: emptyPos.y,
                    token_size: "0.5x0.5",
                    instance_name: `${item.name} ×${qty}`,
                  }),
                });
                // Update tokens data for next position calculation
                tokensData.tokens.push({ position_x: emptyPos.x, position_y: emptyPos.y });
              }
            }
          }
        } catch (e) {
          logger.warn("Failed to drop items to map:", e);
        }
      }

      setEquipmentLocal(newEquipment);
      await persistCharacterPartial(newEquipment, undefined);
      publishAppEvent('characterEquipmentUpdated', {
        characterId: character.id,
        equipment: newEquipment,
        needsBroadcast: true,
      });
      showToast(`已丢弃 ${items.length} 件物品`, "success");
    } catch (e) {
      logger.error("Batch discard error:", e);
      showToast("批量丢弃失败", "error");
    }
  }, [equipmentLocal, currentMapUrl, campaignId, character?.id, character?.user_id, persistCharacterPartial, showToast]);

  // Batch merge same type items
  const handleBatchMerge = useCallback(async (items: EquipmentItem[]) => {
    if (!items.length) return;

    try {
      // Group items by stack identity so resource-library items don't merge into similarly named base items.
      const groups = new Map<string, EquipmentItem[]>();
      for (const item of items) {
        const stackIdentity = getEquipmentStackIdentity(item);
        if (!groups.has(stackIdentity)) {
          groups.set(stackIdentity, []);
        }
        groups.get(stackIdentity)!.push(item);
      }

      // For each group with multiple items, merge them
      let mergedCount = 0;
      let newEquipment = [...(equipmentLocal || [])];

      for (const [stackIdentity, groupItems] of groups) {
        if (groupItems.length <= 1) continue;

        // Calculate total quantity
        const total = groupItems.reduce((sum, it) => sum + (it.quantity || 1), 0);

        // Create merged item based on first item
        const base = { ...groupItems[0], quantity: total };

        // Remove all items in group from equipment
        const itemKeys = new Set(groupItems.map(item =>
          `${item.id}-${item.quantity || 1}-${item.containerId || 'root'}`
        ));
        newEquipment = newEquipment.filter((it: EquipmentItem) => {
          const key = `${it.id}-${it.quantity || 1}-${it.containerId || 'root'}`;
          return !itemKeys.has(key) || getEquipmentStackIdentity(it) !== stackIdentity;
        });

        // Add merged item
        newEquipment.push(base);
        mergedCount++;
      }

      if (mergedCount === 0) {
        showToast("没有可合并的同类物品", "info");
        return;
      }

      setEquipmentLocal(newEquipment);
      await persistCharacterPartial(newEquipment, undefined);
      showToast(`已合并 ${mergedCount} 组同类物品`, "success");
    } catch (e) {
      logger.error("Batch merge error:", e);
      showToast("批量合并失败", "error");
    }
  }, [equipmentLocal, persistCharacterPartial, showToast]);

  // Organize pack via backend AI
  const handleOrganizePack = useCallback(async (packItem: any) => {
    if (!packItem || organizedPacks[packItem.id]) return;
    try {
      setOrganizeLoading(true);
      const response = await authedFetch("/api/equipment/organize-pack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pack_id: packItem.id,
          pack_name: packItem.name,
          pack_description: packItem.description || "",
        }),
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "Organize pack failed");
      }
      const data = await response.json();
      setOrganizedPacks((prev) => ({ ...prev, [packItem.id]: data.organized_items }));
      alert(data.message);
    } catch (e: any) {
      logger.error("Organize pack error:", e);
      alert(`整理套装失败: ${e.message}`);
    } finally {
      setOrganizeLoading(false);
    }
  }, [organizedPacks]);

  // Extract item from organized pack to backpack
  const handleExtractFromPack = useCallback(async (packItem: any, extractedItem: any) => {
    const organizedItems = organizedPacks[packItem.id];
    if (!organizedItems) return;
    try {
      const itemIndex = organizedItems.findIndex((item: EquipmentItem) => item.id === extractedItem.id);
      if (itemIndex === -1) return;
      const fullItemData = findAnyMetaById(extractedItem.id);
      if (!fullItemData) {
        alert(`无法找到物品: ${extractedItem.id}`);
        return;
      }
      const existingItem = equipmentLocal.find((item: any) => item.id === extractedItem.id);
      let newEquipment: any[];
      if (existingItem) {
        newEquipment = equipmentLocal.map((item: any) =>
          item.id === extractedItem.id ? { ...item, quantity: (item.quantity || 1) + extractedItem.quantity } : item
        );
      } else {
        newEquipment = [...equipmentLocal, { ...fullItemData, quantity: extractedItem.quantity }];
      }
      setEquipmentLocal(newEquipment);
      await persistCharacterPartial(newEquipment, undefined);
      const updatedOrganizedItems = organizedItems.filter((_: any, idx: number) => idx !== itemIndex);
      setOrganizedPacks((prev) => ({ ...prev, [packItem.id]: updatedOrganizedItems }));
      alert(`已取出 ${extractedItem.name} ×${extractedItem.quantity}`);
    } catch (e) {
      logger.error("Extract from pack error:", e);
      alert("取出物品失败");
    }
  }, [organizedPacks, equipmentLocal, persistCharacterPartial]);

  // Discard item to map (creates a token near character's token)
  const handleDiscardItem = useCallback(async () => {
    if (!selectedItem || !currentMapUrl || !campaignId) {
      showToast("无法丢弃物品：缺少必要信息", "error");
      return;
    }
    const itemQuantity = selectedItem.quantity || 1;
    if (discardQuantity > itemQuantity) { showToast(`丢弃数量不能超过拥有数量（${itemQuantity}）`, "error"); return; }
    if (discardQuantity <= 0) { showToast("丢弃数量必须大于0", "error"); return; }

    try {
      setDiscardLoading(true);
      const tokensResp = await authedFetch(`/api/tokens/campaign/${campaignId}/map?map_url=${encodeURIComponent(currentMapUrl)}`);
      if (!tokensResp.ok) throw new Error("Failed to fetch tokens");
      const tokensData = await tokensResp.json();
      const charToken = (tokensData.tokens || []).find((t: any) => t.character_id === character.id);
      if (!charToken) { showToast("角色尚未放置到地图上", "error"); return; }

      const findEmptyPosition = (baseX: number, baseY: number, existingTokens: any[]) => {
        const offsets = [ [1,0],[0,1],[-1,0],[0,-1], [1,1],[-1,1],[1,-1],[-1,-1], [2,0],[0,2],[-2,0],[0,-2] ];
        const used = new Set<string>((existingTokens || []).map((t: any) => `${t.position_x},${t.position_y}`));
        for (const [dx,dy] of offsets) { const nx = baseX + dx, ny = baseY + dy; if (!used.has(`${nx},${ny}`)) return { x: nx, y: ny }; }
        return { x: baseX + 1, y: baseY };
      };
      const emptyPos = findEmptyPosition(charToken.position_x, charToken.position_y, tokensData.tokens);

      const iconPath = getIconPath(selectedItem);
      const fullIconUrl = iconPath ? (iconPath.startsWith('http') ? iconPath : `${window.location.origin}${iconPath}`) : null;
      const serializedSelectedItem = serializeItemToTokenData(selectedItem);
      const itemTokenPayload = {
        campaign_id: campaignId,
        item_data: {
          ...serializedSelectedItem,
          icon: fullIconUrl ?? serializedSelectedItem.icon,
        },
        item_quantity: discardQuantity,
        user_id: character.user_id,
        map_url: currentMapUrl,
        position_x: emptyPos.x,
        position_y: emptyPos.y,
        token_size: "0.5x0.5",
        instance_name: `${selectedItem.name} ×${discardQuantity}`,
      };

      const createTokenResp = await authedFetch("/api/tokens/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(itemTokenPayload),
      });
      if (!createTokenResp.ok) throw new Error("Failed to create item token");

      // Update equipment locally: reduce or remove
      const currentEquipment = [...(equipmentLocal || [])];
      const newEquipment = currentEquipment.map((item: any) => {
        if (item.id === selectedItem.id) {
          const newQty = (item.quantity || 1) - discardQuantity;
          if (newQty <= 0) return null;
          return { ...item, quantity: newQty };
        }
        return item;
      }).filter((item: any) => item !== null) as any[];

      setEquipmentLocal(newEquipment);
      await persistCharacterPartial(newEquipment, undefined);
      // Dispatch event so TacticalMap can broadcast via WebSocket
      publishAppEvent('characterEquipmentUpdated', {
        characterId: character.id,
        equipment: newEquipment,
        needsBroadcast: true,
      });

      setItemDetailOpen(false);
      setSelectedItem(null);
      setDiscardQuantity(1);
      showToast(`已丢弃 ${selectedItem.name} ×${discardQuantity}`, "success");
    } catch (e) {
      logger.error("Discard item error:", e);
      showToast("丢弃物品失败", "error");
    } finally {
      setDiscardLoading(false);
    }
  }, [selectedItem, currentMapUrl, campaignId, discardQuantity, equipmentLocal, character?.id, character?.user_id, persistCharacterPartial, showToast]);

  // Discard item (direct version for context menu - takes item and quantity as params)
  // If on map with token, drops item to map. Otherwise, just removes from inventory.
  const discardItemDirect = useCallback(async (item: EquipmentItem, quantity: number) => {
    const itemQuantity = item.quantity || 1;
    if (quantity > itemQuantity) { showToast(`丢弃数量不能超过拥有数量（${itemQuantity}）`, "error"); return; }
    if (quantity <= 0) { showToast("丢弃数量必须大于0", "error"); return; }

    try {
      setDiscardLoading(true);

      // Try to drop to map if we have map context and character is on map
      let droppedToMap = false;
      if (currentMapUrl && campaignId) {
        try {
          const tokensResp = await authedFetch(`/api/tokens/campaign/${campaignId}/map?map_url=${encodeURIComponent(currentMapUrl)}`);
          if (tokensResp.ok) {
            const tokensData = await tokensResp.json();
            const charToken = (tokensData.tokens || []).find((t: any) => t.character_id === character.id);
            if (charToken) {
              // Character is on map, drop item there
              const findEmptyPosition = (baseX: number, baseY: number, existingTokens: any[]) => {
                const offsets = [ [1,0],[0,1],[-1,0],[0,-1], [1,1],[-1,1],[1,-1],[-1,-1], [2,0],[0,2],[-2,0],[0,-2] ];
                const used = new Set<string>((existingTokens || []).map((t: any) => `${t.position_x},${t.position_y}`));
                for (const [dx,dy] of offsets) { const nx = baseX + dx, ny = baseY + dy; if (!used.has(`${nx},${ny}`)) return { x: nx, y: ny }; }
                return { x: baseX + 1, y: baseY };
              };
              const emptyPos = findEmptyPosition(charToken.position_x, charToken.position_y, tokensData.tokens);

              const iconPath = getIconPath(item);
              const fullIconUrl = iconPath
                ? (iconPath.startsWith('http') ? iconPath : `${window.location.origin}${iconPath}`)
                : null;
              // Resolve iconPath for persistence: use item's own or look up from rules
              const resolvedItemIconPath = item.iconPath || (() => {
                const meta = findAnyMetaById(item.id) || findAnyMetaByKey(item.id) || (item.name ? findAnyMetaByKey(item.name) : null);
                return meta && (meta as any).iconPath ? (meta as any).iconPath : undefined;
              })();
              const serializedItem = serializeItemToTokenData({ ...item, iconPath: resolvedItemIconPath });
              const itemTokenPayload = {
                campaign_id: campaignId,
                item_data: {
                  ...serializedItem,
                  icon: fullIconUrl ?? serializedItem.icon,
                },
                item_quantity: quantity,
                user_id: character.user_id,
                map_url: currentMapUrl,
                position_x: emptyPos.x,
                position_y: emptyPos.y,
                token_size: "0.5x0.5",
                instance_name: `${item.name} ×${quantity}`,
              };

              const createTokenResp = await authedFetch("/api/tokens/", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(itemTokenPayload),
              });
              if (createTokenResp.ok) {
                droppedToMap = true;
              }
            }
          }
        } catch (e) {
          logger.warn("Failed to drop to map, will just remove from inventory:", e);
        }
      }

      // Update equipment locally: reduce or remove
      const currentEquipment = [...(equipmentLocal || [])];
      const newEquipment = currentEquipment.map((it: any) => {
        if (it.id === item.id && it.containerId === item.containerId && it.quantity === item.quantity) {
          const newQty = (it.quantity || 1) - quantity;
          if (newQty <= 0) return null;
          return { ...it, quantity: newQty };
        }
        return it;
      }).filter((it: any) => it !== null) as any[];

      setEquipmentLocal(newEquipment);
      await persistCharacterPartial(newEquipment, undefined);
      publishAppEvent('characterEquipmentUpdated', {
        characterId: character.id,
        equipment: newEquipment,
        needsBroadcast: true,
      });

      showToast(droppedToMap ? `已丢弃 ${item.name} ×${quantity} 到地图` : `已删除 ${item.name} ×${quantity}`, "success");
    } catch (e) {
      logger.error("Discard item error:", e);
      showToast("丢弃物品失败", "error");
    } finally {
      setDiscardLoading(false);
    }
  }, [currentMapUrl, campaignId, equipmentLocal, character?.id, character?.user_id, persistCharacterPartial, showToast]);

  // Use a consumable item (potion, antidote, etc.)
  const useConsumableDirect = useCallback(async (
    item: EquipmentItem,
    hpCurrent: number,
    hpMax: number,
    setHpLocal?: (updater: (prev: { current: number; max: number }) => { current: number; max: number }) => void
  ) => {
    const consumable = getConsumableData(item);
    if (!consumable) { showToast("此物品不是消耗品", "error"); return; }

    let toastMsg = '';
    let newHp = hpCurrent;
    let diceResult: ReturnType<typeof rollConsumableDice> | undefined;

    // 1. Healing consumable
    if (consumable.healing) {
      diceResult = rollConsumableDice(consumable.healing.formula);
      newHp = Math.min(hpCurrent + diceResult.total, hpMax);
      toastMsg = formatConsumableResult(item.name, consumable, diceResult, { before: hpCurrent, after: newHp, max: hpMax });

      // Update HP locally
      if (setHpLocal) {
        setHpLocal(prev => ({ ...prev, current: newHp }));
      }
      // Persist HP to backend
      try {
        const payload: Record<string, unknown> = { current_hp: newHp };
        if (campaignId) payload.broadcast_campaign_id = campaignId;
        await authedFetch(`/api/characters/${character.id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } catch (e) {
        logger.error("Persist HP after consumable error:", e);
      }
      // Dispatch HP update event
      publishAppEvent("characterHPUpdated", {
        characterId: character.id,
        current_hp: newHp,
        max_hp: hpMax,
      });
    } else {
      // 2. Buff / damage / generic consumable
      toastMsg = formatConsumableResult(item.name, consumable);
    }

    // 3. Consume item (reduce quantity or remove)
    if (consumable.consumed !== false) {
      const qty = item.quantity || 1;
      let newEquipment: EquipmentItem[];
      if (qty <= 1) {
        newEquipment = equipmentLocal.filter(it =>
          !(it.id === item.id && it.containerId === item.containerId && it.quantity === item.quantity)
        );
      } else {
        newEquipment = equipmentLocal.map(it =>
          (it.id === item.id && it.containerId === item.containerId && it.quantity === item.quantity)
            ? { ...it, quantity: qty - 1 }
            : it
        );
      }
      setEquipmentLocal(newEquipment);
      await persistCharacterPartial(newEquipment, undefined);
      publishAppEvent('characterEquipmentUpdated', {
        characterId: character.id,
        equipment: newEquipment,
        needsBroadcast: true,
      });
    }

    // Broadcast to chat
    broadcastConsumableUsed(authedFetch, campaignId, character.user_id, 'player', character.name, item.name, toastMsg, consumable, diceResult);

    showToast(toastMsg, "success");
  }, [equipmentLocal, character.id, character.user_id, character.name, campaignId, persistCharacterPartial, showToast, authedFetch]);

  // ===== Paper Writing System =====

  /** Write on a paper item: consume 1 paper, create a new written item */
  const handleWriteOnPaper = useCallback(async (paper: EquipmentItem, content: string) => {
    if (!content.trim()) { showToast("请输入内容", "error"); return; }
    const firstLine = content.trim().split('\n')[0].slice(0, 30);
    const baseName = (paper.name || '').replace(/\s*[xX×]\s*\d+$/i, '').trim();
    const newName = `${firstLine}（${baseName}）`;

    // Resolve icon: use paper's own iconPath/avatar_url, or look up from rules data
    const resolvedIcon = paper.iconPath || paper.avatar_url || (() => {
      const meta = findAnyMetaById(paper.id) || findAnyMetaByKey(paper.id) || (paper.name ? findAnyMetaByKey(paper.name) : null);
      return meta && (meta as any).iconPath ? (meta as any).iconPath : undefined;
    })();

    const newItem: EquipmentItem = {
      id: `written_paper_${Date.now()}`,
      name: newName,
      quantity: 1,
      weight: 0,
      writtenContent: content.trim(),
      sourceItemId: paper.id,
      sourceItemName: baseName,
      iconPath: resolvedIcon || paper.iconPath,
      avatar_url: paper.avatar_url,
      containerId: paper.containerId,
    };

    const qty = paper.quantity || 1;
    let newEquipment: EquipmentItem[];
    if (qty <= 1) {
      newEquipment = (equipmentLocal || []).filter(it => it !== paper && !(it.id === paper.id && it.containerId === paper.containerId && it.quantity === paper.quantity));
    } else {
      newEquipment = (equipmentLocal || []).map(it => {
        if (it === paper || (it.id === paper.id && it.containerId === paper.containerId && it.quantity === paper.quantity)) {
          return { ...it, quantity: qty - 1 };
        }
        return it;
      });
    }
    newEquipment.push(newItem);

    setEquipmentLocal(newEquipment);
    await persistCharacterPartial(newEquipment, undefined);
    showToast(`已书写: ${firstLine}`, "success");
  }, [equipmentLocal, persistCharacterPartial, showToast]);

  /** Edit a written paper's content */
  const handleEditWrittenPaper = useCallback(async (item: EquipmentItem, newContent: string) => {
    if (!newContent.trim()) { showToast("请输入内容", "error"); return; }
    const firstLine = newContent.trim().split('\n')[0].slice(0, 30);
    const suffix = item.sourceItemName ? `（${item.sourceItemName}）` : '';
    const newName = `${firstLine}${suffix}`;

    const newEquipment = (equipmentLocal || []).map(it => {
      if (it === item || (it.id === item.id && it.containerId === item.containerId)) {
        return { ...it, writtenContent: newContent.trim(), name: newName };
      }
      return it;
    });
    setEquipmentLocal(newEquipment);
    await persistCharacterPartial(newEquipment, undefined);
    showToast("内容已更新", "success");
  }, [equipmentLocal, persistCharacterPartial, showToast]);

  /** Copy a written paper: consume 1 blank paper, create duplicate */
  const handleCopyPaper = useCallback(async (item: EquipmentItem) => {
    if (!item.writtenContent) { showToast("此物品没有可复制的内容", "error"); return; }

    // Find blank paper in inventory
    const blankPaper = (equipmentLocal || []).find(it => isPaperItem(it) && !it.writtenContent && (it.quantity || 1) > 0);
    if (!blankPaper) { showToast("需要空白纸张才能复制", "error"); return; }

    const copy: EquipmentItem = {
      ...item,
      id: `written_paper_${Date.now()}`,
      containerId: blankPaper.containerId,
    };

    // Reduce blank paper
    const blankQty = blankPaper.quantity || 1;
    let newEquipment: EquipmentItem[];
    if (blankQty <= 1) {
      newEquipment = (equipmentLocal || []).filter(it => it !== blankPaper && !(it.id === blankPaper.id && it.containerId === blankPaper.containerId && it.quantity === blankPaper.quantity));
    } else {
      newEquipment = (equipmentLocal || []).map(it => {
        if (it === blankPaper || (it.id === blankPaper.id && it.containerId === blankPaper.containerId && it.quantity === blankPaper.quantity)) {
          return { ...it, quantity: blankQty - 1 };
        }
        return it;
      });
    }
    newEquipment.push(copy);

    setEquipmentLocal(newEquipment);
    await persistCharacterPartial(newEquipment, undefined);
    showToast("已复制文件", "success");
  }, [equipmentLocal, isPaperItem, persistCharacterPartial, showToast]);

  return {
    // state
    equipmentLocal, setEquipmentLocal,
    equipDialogSlot, setEquipDialogSlot,
    equipDialogOpen, setEquipDialogOpen,
    bagOpen, setBagOpen,
    itemDetailOpen, setItemDetailOpen,
    selectedItem, setSelectedItem,
    splitQty, setSplitQty,
    splitLoading, mergeLoading,
    discardQuantity, setDiscardQuantity,
    discardLoading,
    organizeLoading, organizedPacks, setOrganizedPacks,

    // derived
    getEquipped,
    backpackWeapons,
    backpackArmor,
    backpackShield,
    backpackOtherHandheld,
    backpackLightArmor,
    backpackMediumArmor,
    backpackHeavyArmor,
    backpackAmmo,
    backpackConsumables,
    backpackClothing,
    backpackAccessory,

    // container support
    containerKeys,
    availableContainers,
    isContainer,
    getContainerContents,
    handlePutInContainer,
    handlePutMultipleInContainer,
    handleTakeOutOfContainer,
    handleStackItems,

    // actions
    openEquip,
    applyEquip,
    applyEquipDirect,
    toggleGripMode,
    handleSplitStack,
    handleMergeStacks,
    handleOrganizePack,
    handleExtractFromPack,
    handleDiscardItem,
    // direct versions for context menu
    splitStackDirect,
    mergeStacksDirect,
    discardItemDirect,
    // batch operations
    handleBatchTakeOut,
    handleBatchDiscard,
    handleBatchMerge,
    // consumable
    useConsumableDirect,
    // paper writing system
    isBookContainer,
    isPaperItem,
    handleWriteOnPaper,
    handleEditWrittenPaper,
    handleCopyPaper,
  } as const;
}
