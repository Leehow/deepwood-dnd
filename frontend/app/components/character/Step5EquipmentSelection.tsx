import { useState, useEffect } from "react";
import equipmentData from "~/data/rules/equipment.json";
import { EquipmentCategorySelector } from "./EquipmentCategorySelector";
import { tDamageType } from "~/utils/i18n";
import * as Dialog from "@radix-ui/react-dialog";

interface Step5Props {
  character: any;
  setCharacter: (updater: (prev: any) => any) => void;
  selectedClass: any;
}

interface EquipmentChoice {
  choose: number;
  from: Array<string[] | string>;
}

interface SelectedEquipment {
  id: string;
  name: string;
  nameEn?: string;
  quantity: number;
  category: string;
  isCategory?: boolean;
  equipmentType?: string;
  iconPath?: string;
  // Weapon properties
  damage?: string;
  damageType?: string;
  properties?: string[];
  range?: { normal: number; long: number };
  // Armor properties
  ac?: string;
  acBonus?: number;
  strengthRequired?: number | null;
  stealthDisadvantage?: boolean;
  // Common properties
  weight?: number;
  cost?: any;
  description?: string;
}

// Helper function to get equipment name by ID from equipment.json
// This function searches through all equipment categories to find the Chinese name
const getEquipmentNameById = (itemId: string): string => {
  // Search in armor (including shields)
  const armor = equipmentData.armor;
  for (const category of ["light", "medium", "heavy", "shield"]) {
    const found = armor[category as keyof typeof armor]?.find((item: any) => item.id === itemId);
    if (found) return found.name;
  }

  // Search in weapons
  const weapons = equipmentData.weapons;
  for (const proficiency of ["simple", "martial"]) {
    const prof = weapons[proficiency as keyof typeof weapons] as any;
    for (const type of ["melee", "ranged"]) {
      const found = prof[type as "melee" | "ranged"]?.find((item: any) => item.id === itemId);
      if (found) return found.name;
    }
  }

  // Search in packs
  if (equipmentData.packs) {
    const found = equipmentData.packs.find((item: any) => item.id === itemId);
    if (found) return found.name;
  }

  // Search in adventuring gear
  const gear = equipmentData.adventuringGear;
  for (const category of Object.keys(gear)) {
    const found = gear[category as keyof typeof gear]?.find((item: any) => item.id === itemId);
    if (found) return found.name;
  }

  // Search in tools
  if (equipmentData.tools) {
    for (const category of Object.keys(equipmentData.tools)) {
      const found = equipmentData.tools[category as keyof typeof equipmentData.tools]?.find((item: any) => item.id === itemId);
      if (found) return found.name;
    }
  }

  // If not found, return the ID itself
  return itemId;
};

export function Step5EquipmentSelection({ character, setCharacter, selectedClass }: Step5Props) {
  const [selectedChoices, setSelectedChoices] = useState<Record<number, number>>({});
  // Track specific item selections for category choices
  // Key format: "choiceIndex-optionIndex-itemIndex"
  const [categorySelections, setCategorySelections] = useState<Record<string, string>>({});

  if (!selectedClass || !selectedClass.startingEquipment) {
    return (
      <div className="text-center text-gray-400 py-20">
        请先选择职业以查看可用装备
      </div>
    );
  }

  const { choices = [], fixed = [] } = selectedClass.startingEquipment;

  // Helper function to expand equipment references
  const expandEquipment = (itemRef: string, specificItemId?: string): any => {
    // Handle quantity notation (e.g., "javelin:4" means 4 javelins)
    const [itemId, quantityStr] = itemRef.split(":");
    const quantity = quantityStr ? parseInt(quantityStr) : 1;

    // Map incorrect armor IDs from classes.json to correct equipment.json IDs
    const armorIdMap: Record<string, string> = {
      leather_armor: "leather",
      studded_leather_armor: "studded_leather",
      hide_armor: "hide",
      chain_shirt_armor: "chain_shirt",
      scale_mail_armor: "scale_mail",
      breastplate_armor: "breastplate",
      half_plate_armor: "half_plate",
      ring_mail_armor: "ring_mail",
      chain_mail_armor: "chain_mail",
      splint_armor: "splint",
      plate_armor: "plate",
      wooden_shield: "shield",
    };

    // Apply armor ID mapping if needed
    const mappedItemId = armorIdMap[itemId] || itemId;

    // Check if it's a category reference (not a specific pack)
    const specificPacks = [
      "explorers_pack", "dungeoneers_pack", "dungeoneer_pack", "priests_pack",
      "scholars_pack", "diplomats_pack", "entertainers_pack", "burglars_pack"
    ];
    const isSpecificPack = specificPacks.includes(mappedItemId);

    const categoryKeywords = [
      "_weapon", "_armor", "_focus", "_symbol",
      "musical_instrument", "artisan_tools"
    ];
    // Only treat as category if it matches a keyword AND is not a known concrete item
    const matchesCategoryKeyword = !isSpecificPack && categoryKeywords.some(keyword => mappedItemId.includes(keyword));
    const isCategory = matchesCategoryKeyword && !findEquipmentById(mappedItemId);

    if (isCategory) {
      // If a specific item is selected for this category, use it
      if (specificItemId) {
        const item = findEquipmentById(specificItemId);
        if (item) {
          return {
            ...item,
            quantity,
            category: "item",
          };
        }
      }

      // Otherwise return the category placeholder
      return {
        id: mappedItemId,
        name: getCategoryName(mappedItemId),
        quantity,
        category: "category",
        isCategory: true,
      };
    }

    // Find actual equipment item
    const item = findEquipmentById(mappedItemId);
    if (item) {
      return {
        ...item,
        quantity,
        category: "item",
      };
    }

    // If not found, try to get name from category map (for packs)
    const categoryName = getCategoryName(mappedItemId);
    return {
      id: mappedItemId,
      name: categoryName !== mappedItemId ? categoryName : mappedItemId,
      quantity,
      category: "unknown",
    };
  };

  // Find equipment by ID in the equipment data
  const findEquipmentById = (id: string): any => {
    // Search in armor (including shields)
    const armor = equipmentData.armor;
    for (const category of ["light", "medium", "heavy", "shield"]) {
      const found = armor[category as keyof typeof armor]?.find((item: any) => item.id === id);
      if (found) return { ...found, equipmentType: "armor" };
    }

    // Search in weapons
    const weapons = equipmentData.weapons;
    for (const proficiency of ["simple", "martial"]) {
      const prof = weapons[proficiency as keyof typeof weapons] as any;
      for (const type of ["melee", "ranged"]) {
        const found = prof[type as "melee" | "ranged"]?.find((item: any) => item.id === id);
        if (found) return { ...found, equipmentType: "weapon" };
      }
    }

    // Search in packs
    if (equipmentData.packs) {
      const found = equipmentData.packs.find((item: any) => item.id === id);
      if (found) return { ...found, equipmentType: "pack" };
    }

    // Search in adventuring gear (including spellcasting focus, tools, etc.)
    const gear = equipmentData.adventuringGear;
    for (const category of Object.keys(gear)) {
      const found = gear[category as keyof typeof gear]?.find((item: any) => item.id === id);
      if (found) return { ...found, equipmentType: "gear" };
    }

    // Search in tools
    if (equipmentData.tools) {
      const tools = equipmentData.tools;
      for (const category of Object.keys(tools)) {
        const found = tools[category as keyof typeof tools]?.find((item: any) => item.id === id);
        if (found) return { ...found, equipmentType: "tool" };
      }
    }

    // Search in background items (incense, vestments, etc.)
    if ((equipmentData as any).backgroundItems) {
      const bgItems = (equipmentData as any).backgroundItems;
      if (Array.isArray(bgItems)) {
        const found = bgItems.find((item: any) => item.id === id);
        if (found) return { ...found, equipmentType: "gear" };
      }
    }

    return null;
  };

  // Get human-readable category name
  const getCategoryName = (categoryId: string): string => {
    const categoryMap: Record<string, string> = {
      // Weapons
      simple_weapon: "简易武器（任选一件）",
      martial_weapon: "军用武器（任选一件）",
      simple_melee_weapon: "简易近战武器（任选一件）",
      martial_melee_weapon: "军用近战武器（任选一件）",
      simple_ranged_weapon: "简易远程武器（任选一件）",
      martial_ranged_weapon: "军用远程武器（任选一件）",
      // Armor
      light_armor: "轻甲（任选一件）",
      medium_armor: "中甲（任选一件）",
      heavy_armor: "重甲（任选一件）",
      shield: "盾牌",
      shields: "盾牌",
      // Packs
      explorers_pack: "探险者套装",
      dungeoneers_pack: "地下城探险套装",
      dungeoneer_pack: "地下城探险套装",
      priests_pack: "牧师套装",
      scholars_pack: "学者套装",
      diplomats_pack: "外交官套装",
      entertainers_pack: "表演者套装",
      burglars_pack: "盗贼套装",
      // Spellcasting Focus
      holy_symbol: "圣徽（任选一件）",
      druidic_focus: "德鲁伊法器（任选一件）",
      arcane_focus: "奥术法器（任选一件）",
      // Instruments & Tools
      musical_instrument: "乐器（任选一件）",
      artisan_tools: "工匠工具（任选一件）",
    };
    return categoryMap[categoryId] || categoryId;
  };

  // Helper function to expand pack contents into individual items
  const expandPackContents = (packItem: any): SelectedEquipment[] => {
    if (!packItem.contents || !Array.isArray(packItem.contents)) {
      return [packItem];
    }

    // Find container in pack (backpack, pouch, sack, etc.)
    const containerTypes = ["backpack", "pouch", "sack", "bag", "chest", "basket", "case"];
    let containerId: string | null = null;
    for (const content of packItem.contents) {
      const cid = content.item;
      if (containerTypes.includes(cid) || containerTypes.some(ct => cid?.includes(ct))) {
        containerId = cid;
        break;
      }
    }

    const expandedItems: SelectedEquipment[] = [];
    packItem.contents.forEach((content: { item: string; quantity: number }) => {
      const item = findEquipmentById(content.item);
      if (item) {
        expandedItems.push({
          ...item,
          quantity: content.quantity,
          category: "item",
          // Place non-container items inside the container
          ...(containerId && content.item !== containerId ? { containerId } : {}),
        } as any);
      }
    });

    return expandedItems;
  };

  // Update character equipment whenever selections change
  const updateCharacterEquipment = (
    currentSelections: Record<number, number>,
    currentCategorySelections: Record<string, string>
  ) => {
    // Use Map to merge duplicate equipment by ID
    const equipmentMap = new Map<string, SelectedEquipment>();

    // Helper to add item to map, merging quantity if duplicate
    const addToEquipment = (item: SelectedEquipment) => {
      const existing = equipmentMap.get(item.id);
      if (existing) {
        existing.quantity += item.quantity;
      } else {
        equipmentMap.set(item.id, { ...item });
      }
    };

    // First, add background equipment (from Step 5 background selection)
    if (character.backgroundEquipment && Array.isArray(character.backgroundEquipment)) {
      character.backgroundEquipment.forEach((item: SelectedEquipment) => {
        addToEquipment(item);
      });
    }

    // Add fixed equipment
    fixed.forEach((itemRef: string) => {
      const item = expandEquipment(itemRef);
      if (item && !item.isCategory) {
        // If it's a pack, expand its contents
        if (item.equipmentType === "pack" && item.contents) {
          expandPackContents(item).forEach(addToEquipment);
        } else {
          addToEquipment(item);
        }
      }
    });

    // Add selected choices
    choices.forEach((choice: EquipmentChoice, choiceIndex: number) => {
      const selectedOptionIndex = currentSelections[choiceIndex];
      if (selectedOptionIndex !== undefined) {
        const option = choice.from[selectedOptionIndex];
        if (Array.isArray(option)) {
          option.forEach((itemRef, itemIndex) => {
            const categoryKey = `${choiceIndex}-${selectedOptionIndex}-${itemIndex}`;
            const specificItemId = currentCategorySelections[categoryKey];
            const item = expandEquipment(itemRef, specificItemId);
            if (item && !item.isCategory) {
              // If it's a pack, expand its contents
              if (item.equipmentType === "pack" && item.contents) {
                expandPackContents(item).forEach(addToEquipment);
              } else {
                addToEquipment(item);
              }
            }
          });
        } else {
          const categoryKey = `${choiceIndex}-${selectedOptionIndex}-0`;
          const specificItemId = currentCategorySelections[categoryKey];
          const item = expandEquipment(option, specificItemId);
          if (item && !item.isCategory) {
            // If it's a pack, expand its contents
            if (item.equipmentType === "pack" && item.contents) {
              expandPackContents(item).forEach(addToEquipment);
            } else {
              addToEquipment(item);
            }
          }
        }
      }
    });

    const equipment = Array.from(equipmentMap.values());

    // Extract gold from pouch_with_Xgp items → currency
    let startingGold = 0;
    const finalEquipment = equipment.filter(item => {
      const match = item.id?.match(/^pouch_with_(\d+)gp$/);
      if (match) {
        startingGold += parseInt(match[1], 10) * (item.quantity || 1);
        return false; // Remove pouch from equipment list
      }
      return true;
    });

    setCharacter((prev: any) => ({
      ...prev,
      equipment: finalEquipment,
      currency: { cp: 0, sp: 0, ep: 0, gp: startingGold, pp: 0 },
    }));
  };

  // Initial merge on mount: ensure background + fixed equipment are combined
  // even if user makes no selection changes
  useEffect(() => {
    updateCharacterEquipment(selectedChoices, categorySelections);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle selection change
  const handleChoiceSelect = (choiceIndex: number, optionIndex: number) => {
    const newSelections = {
      ...selectedChoices,
      [choiceIndex]: optionIndex,
    };
    setSelectedChoices(newSelections);

    // Update character equipment with new selections
    updateCharacterEquipment(newSelections, categorySelections);
  };

  // Handle category item selection
  const handleCategoryItemSelect = (
    choiceIndex: number,
    optionIndex: number,
    itemIndex: number,
    itemId: string
  ) => {
    const categoryKey = `${choiceIndex}-${optionIndex}-${itemIndex}`;
    const newCategorySelections = {
      ...categorySelections,
      [categoryKey]: itemId,
    };
    setCategorySelections(newCategorySelections);

    // Update character equipment with new selections
    updateCharacterEquipment(selectedChoices, newCategorySelections);
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-xl font-bold text-amber-400 mb-2">选择装备</h3>
        <p className="text-gray-400 text-sm">
          根据你的职业（{selectedClass.name}），选择初始装备
        </p>
      </div>

      {/* Equipment Choices */}
      {choices.length > 0 && (
        <div className="space-y-4">
          <h4 className="font-semibold text-gray-300">装备选择</h4>
          {choices.map((choice: EquipmentChoice, choiceIndex: number) => (
            <div key={choiceIndex} className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
              <div className="mb-3 text-sm text-gray-400">
                选择 {choice.choose} 项：
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {choice.from.map((option: string[] | string, optionIndex: number) => {
                  const items = Array.isArray(option) ? option : [option];
                  const isSelected = selectedChoices[choiceIndex] === optionIndex;

                  return (
                    <label
                      key={optionIndex}
                      className={`flex items-start p-3 rounded-lg cursor-pointer transition-all ${
                        isSelected
                          ? "bg-amber-900/30 border-2 border-amber-600"
                          : "bg-gray-700/30 border-2 border-transparent hover:border-gray-600"
                      }`}
                    >
                      <input
                        type="radio"
                        name={`choice-${choiceIndex}`}
                        checked={isSelected}
                        onChange={() => handleChoiceSelect(choiceIndex, optionIndex)}
                        className="mt-1 mr-3"
                      />
                      <div className="flex-1 space-y-2">
                        <div className="space-y-3">
                          {items.map((itemRef, itemIndex) => {
                            const categoryKey = `${choiceIndex}-${optionIndex}-${itemIndex}`;
                            const specificItemId = categorySelections[categoryKey];
                            // Get the base item info (without specific selection)
                            const baseItem = expandEquipment(itemRef);
                            const isCategory = baseItem.isCategory;
                            // Get the display item (with specific selection if available)
                            const item = expandEquipment(itemRef, specificItemId);

                            return (
                              <div key={itemIndex} className="w-full">
                                {/* Show category selector if this is a category item */}
                                {isCategory ? (
                                  <div>
                                    <div className="font-medium text-gray-200 mb-2">
                                      {baseItem.name}
                                    </div>
                                    <EquipmentCategorySelector
                                      categoryId={baseItem.id}
                                      selectedItemId={specificItemId}
                                      onSelect={(itemId) =>
                                        handleCategoryItemSelect(
                                          choiceIndex,
                                          optionIndex,
                                          itemIndex,
                                          itemId
                                        )
                                      }
                                    />
                                  </div>
                                ) : (
                                  <div>
                                    {/* Item name with icon */}
                                    <div className="flex items-center gap-2">
                                      {/* Equipment Icon */}
                                      {item.iconPath && (
                                        <img
                                          src={item.iconPath}
                                          alt={item.name}
                                          className="w-8 h-8 rounded flex-shrink-0 object-cover"
                                          onError={(e) => {
                                            e.currentTarget.style.display = 'none';
                                          }}
                                        />
                                      )}
                                      <div className="font-medium text-gray-200">
                                        {item.name}
                                        {item.quantity > 1 && (
                                          <span className="ml-2 text-amber-400 text-sm">×{item.quantity}</span>
                                        )}
                                        {item.nameEn && (
                                          <span className="ml-2 text-xs text-gray-500">({item.nameEn})</span>
                                        )}
                                      </div>
                                    </div>

                                    {/* Item details */}
                                    <div className="mt-1 text-xs text-gray-400 space-y-1">
                                      {/* Pack description (without contents list) */}
                                      {item.description && (
                                        <div>{item.description}</div>
                                      )}

                                      {/* Weapon info */}
                                      {item.damage && (
                                        <div>
                                          <span className="text-amber-400">伤害:</span> {item.damage}
                                          {item.damageType && ` (${tDamageType(item.damageType)})`}
                                        </div>
                                      )}

                                      {/* Armor info */}
                                      {item.ac && (
                                        <Dialog.Root>
                                          <Dialog.Trigger asChild>
                                            <div className="inline-flex items-center gap-1 cursor-pointer hover:text-amber-300 transition-colors">
                                              <span className="text-amber-400">AC:</span> {item.ac}
                                              <span className="text-xs text-gray-500">ℹ️</span>
                                            </div>
                                          </Dialog.Trigger>
                                          <Dialog.Portal>
                                            <Dialog.Overlay className="fixed inset-0 bg-black/60 z-[100]" />
                                            <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-gray-800 border-2 border-amber-400 rounded-lg shadow-2xl z-[101] w-[90vw] max-w-md p-6">
                                              <div className="flex items-center justify-between mb-3">
                                                <Dialog.Title className="text-xl font-bold text-amber-400">
                                                  护甲等级 (Armor Class)
                                                </Dialog.Title>
                                                <Dialog.Close className="w-7 h-7 flex items-center justify-center rounded-lg bg-gray-700/50 hover:bg-gray-600/50 text-gray-400 hover:text-white transition-colors">
                                                  ✕
                                                </Dialog.Close>
                                              </div>
                                              <div className="text-gray-300 space-y-2">
                                                <p>决定敌人攻击你的难度，数值越高越难被击中。</p>
                                                <p className="text-sm text-gray-400">
                                                  当敌人攻击你时，需要投掷 d20 并加上攻击加值，结果必须大于或等于你的 AC 才能命中。
                                                </p>
                                              </div>
                                              <Dialog.Close asChild>
                                                <button className="mt-4 w-full px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded transition-colors">
                                                  知道了
                                                </button>
                                              </Dialog.Close>
                                            </Dialog.Content>
                                          </Dialog.Portal>
                                        </Dialog.Root>
                                      )}
                                      {item.acBonus && (
                                        <Dialog.Root>
                                          <Dialog.Trigger asChild>
                                            <div className="inline-flex items-center gap-1 cursor-pointer hover:text-amber-300 transition-colors">
                                              <span className="text-amber-400">AC加值:</span> +{item.acBonus}
                                              <span className="text-xs text-gray-500">ℹ️</span>
                                            </div>
                                          </Dialog.Trigger>
                                          <Dialog.Portal>
                                            <Dialog.Overlay className="fixed inset-0 bg-black/60 z-[100]" />
                                            <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-gray-800 border-2 border-amber-400 rounded-lg shadow-2xl z-[101] w-[90vw] max-w-md p-6">
                                              <div className="flex items-center justify-between mb-3">
                                                <Dialog.Title className="text-xl font-bold text-amber-400">
                                                  护甲等级加值
                                                </Dialog.Title>
                                                <Dialog.Close className="w-7 h-7 flex items-center justify-center rounded-lg bg-gray-700/50 hover:bg-gray-600/50 text-gray-400 hover:text-white transition-colors">
                                                  ✕
                                                </Dialog.Close>
                                              </div>
                                              <div className="text-gray-300 space-y-2">
                                                <p>额外增加你的护甲等级，让你更难被击中。</p>
                                                <p className="text-sm text-gray-400">
                                                  例如盾牌提供 +2 AC 加值，会直接加到你的总 AC 上。
                                                </p>
                                              </div>
                                              <Dialog.Close asChild>
                                                <button className="mt-4 w-full px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded transition-colors">
                                                  知道了
                                                </button>
                                              </Dialog.Close>
                                            </Dialog.Content>
                                          </Dialog.Portal>
                                        </Dialog.Root>
                                      )}

                                      {/* Weight and cost */}
                                      {(item.weight || item.cost) && (
                                        <div className="flex gap-3">
                                          {item.weight && <span>重量: {item.weight}磅</span>}
                                          {item.cost && (
                                            <span>
                                              价格: {Object.entries(item.cost)
                                                .map(([unit, value]: [string, any]) => `${value}${unit.toUpperCase()}`)
                                                .join(" ")}
                                            </span>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Fixed Equipment */}
      {fixed.length > 0 && (
        <div className="space-y-3">
          <h4 className="font-semibold text-gray-300">固定装备</h4>
          <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
            <div className="flex flex-wrap gap-2">
              {fixed.map((itemRef: string, index: number) => {
                const item = expandEquipment(itemRef);
                return (
                  <div
                    key={index}
                    className="inline-flex items-center px-3 py-2 bg-gray-700 rounded-lg text-sm"
                  >
                    <span className="text-green-400 mr-2">✓</span>
                    <span className="text-gray-300">{item.name}</span>
                    {item.quantity > 1 && (
                      <span className="ml-1 text-amber-400">×{item.quantity}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Selected Equipment Summary */}
      {character.equipment && character.equipment.length > 0 && (
        <div className="space-y-3">
          <h4 className="font-semibold text-gray-300">已选装备汇总</h4>
          <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
            <div className="space-y-3">
              {character.equipment.map((item: SelectedEquipment, index: number) => (
                <div
                  key={index}
                  className="p-3 bg-gray-700/50 rounded-lg border border-gray-600"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        {/* Equipment Icon */}
                        {(item as any).iconPath && (
                          <img
                            src={(item as any).iconPath}
                            alt={item.name}
                            className="w-8 h-8 rounded flex-shrink-0 object-cover"
                            onError={(e) => {
                              e.currentTarget.style.display = 'none';
                            }}
                          />
                        )}
                        <div className="flex-1">
                          <div className="font-medium text-gray-200">
                            {item.name}
                            {item.quantity > 1 && (
                              <span className="ml-2 text-amber-400 text-sm">×{item.quantity}</span>
                            )}
                          </div>
                          {item.nameEn && (
                            <div className="text-xs text-gray-500 mt-1">{item.nameEn}</div>
                          )}
                        </div>
                      </div>

                      {/* Equipment details */}
                      <div className="mt-2 space-y-1 text-sm">
                        {/* Pack description and contents */}
                        {item.description && (
                          <div className="text-gray-400 mb-2">
                            <span className="text-amber-400">描述:</span> {item.description}
                          </div>
                        )}
                        {(item as any).contents && (item as any).contents.length > 0 && (
                          <div className="text-gray-400 mt-2">
                            <span className="text-amber-400">包含物品:</span>
                            <ul className="ml-4 mt-1 list-disc list-inside text-xs">
                              {(item as any).contents.map((content: any, idx: number) => (
                                <li key={idx}>
                                  {getEquipmentNameById(content.item)} ×{content.quantity}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* Weapon info */}
                        {item.damage && (
                          <div className="text-gray-400">
                            <span className="text-amber-400">伤害:</span> {item.damage}
                            {item.damageType && (
                              <span className="ml-2">
                                ({item.damageType === "slashing" ? "挥砍" :
                                  item.damageType === "piercing" ? "穿刺" :
                                  item.damageType === "bludgeoning" ? "钝击" : item.damageType})
                              </span>
                            )}
                          </div>
                        )}

                        {/* Armor info */}
                        {item.ac && (
                          <Dialog.Root>
                            <Dialog.Trigger asChild>
                              <div className="text-gray-400 inline-flex items-center gap-1 cursor-pointer hover:text-amber-300 transition-colors">
                                <span className="text-amber-400">AC:</span> {item.ac}
                                <span className="text-xs text-gray-500">ℹ️</span>
                              </div>
                            </Dialog.Trigger>
                            <Dialog.Portal>
                              <Dialog.Overlay className="fixed inset-0 bg-black/60 z-[100]" />
                              <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-gray-800 border-2 border-amber-400 rounded-lg shadow-2xl z-[101] w-[90vw] max-w-md p-6">
                                <div className="flex items-center justify-between mb-3">
                                  <Dialog.Title className="text-xl font-bold text-amber-400">
                                    护甲等级 (Armor Class)
                                  </Dialog.Title>
                                  <Dialog.Close className="w-7 h-7 flex items-center justify-center rounded-lg bg-gray-700/50 hover:bg-gray-600/50 text-gray-400 hover:text-white transition-colors">
                                    ✕
                                  </Dialog.Close>
                                </div>
                                <div className="text-gray-300 space-y-2">
                                  <p>决定敌人攻击你的难度，数值越高越难被击中。</p>
                                  <p className="text-sm text-gray-400">
                                    当敌人攻击你时，需要投掷 d20 并加上攻击加值，结果必须大于或等于你的 AC 才能命中。
                                  </p>
                                </div>
                                <Dialog.Close asChild>
                                  <button className="mt-4 w-full px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded transition-colors">
                                    知道了
                                  </button>
                                </Dialog.Close>
                              </Dialog.Content>
                            </Dialog.Portal>
                          </Dialog.Root>
                        )}
                        {item.acBonus && (
                          <Dialog.Root>
                            <Dialog.Trigger asChild>
                              <div className="text-gray-400 inline-flex items-center gap-1 cursor-pointer hover:text-amber-300 transition-colors">
                                <span className="text-amber-400">AC加值:</span> +{item.acBonus}
                                <span className="text-xs text-gray-500">ℹ️</span>
                              </div>
                            </Dialog.Trigger>
                            <Dialog.Portal>
                              <Dialog.Overlay className="fixed inset-0 bg-black/60 z-[100]" />
                              <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-gray-800 border-2 border-amber-400 rounded-lg shadow-2xl z-[101] w-[90vw] max-w-md p-6">
                                <div className="flex items-center justify-between mb-3">
                                  <Dialog.Title className="text-xl font-bold text-amber-400">
                                    护甲等级加值
                                  </Dialog.Title>
                                  <Dialog.Close className="w-7 h-7 flex items-center justify-center rounded-lg bg-gray-700/50 hover:bg-gray-600/50 text-gray-400 hover:text-white transition-colors">
                                    ✕
                                  </Dialog.Close>
                                </div>
                                <div className="text-gray-300 space-y-2">
                                  <p>额外增加你的护甲等级，让你更难被击中。</p>
                                  <p className="text-sm text-gray-400">
                                    例如盾牌提供 +2 AC 加值，会直接加到你的总 AC 上。
                                  </p>
                                </div>
                                <Dialog.Close asChild>
                                  <button className="mt-4 w-full px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded transition-colors">
                                    知道了
                                  </button>
                                </Dialog.Close>
                              </Dialog.Content>
                            </Dialog.Portal>
                          </Dialog.Root>
                        )}
                        {item.strengthRequired && (
                          <div className="text-gray-400">
                            <span className="text-amber-400">力量要求:</span> {item.strengthRequired}
                          </div>
                        )}
                        {item.stealthDisadvantage && (
                          <div className="text-red-400 text-xs">隐匿检定劣势</div>
                        )}

                        {/* Properties */}
                        {item.properties && item.properties.length > 0 && (
                          <div className="text-gray-400">
                            <span className="text-amber-400">属性:</span>{" "}
                            {item.properties.map((p: string) => {
                              const propMap: Record<string, string> = {
                                light: "轻型", finesse: "灵巧", thrown: "投掷",
                                versatile: "双用", "two-handed": "双手", ammunition: "弹药",
                                loading: "填弹", heavy: "重型", reach: "触及", special: "特殊"
                              };
                              return propMap[p] || p;
                            }).join(", ")}
                          </div>
                        )}

                        {/* Range */}
                        {item.range && (
                          <div className="text-gray-400">
                            <span className="text-amber-400">{item.properties?.some((p: string) => p === 'thrown' || p.includes('投掷')) ? '投掷射程' : '射程'}:</span> {item.range.normal}/{item.range.long}尺
                          </div>
                        )}

                        {/* Weight and cost */}
                        <div className="flex gap-4 text-xs text-gray-500">
                          {item.weight && <span>重量: {item.weight}磅</span>}
                          {item.cost && (
                            <span>
                              价格: {Object.entries(item.cost)
                                .map(([unit, value]: [string, any]) => `${value}${unit.toUpperCase()}`)
                                .join(" ")}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Helpful Notes */}
      <div className="bg-blue-900/20 border border-blue-700/50 rounded-lg p-4">
        <h4 className="font-semibold text-blue-400 mb-2">📝 提示</h4>
        <ul className="text-sm text-gray-400 space-y-1">
          <li>• 固定装备会自动添加到你的装备栏</li>
          <li>• 请为每个选项做出选择</li>
          <li>• 某些选项允许你从某类装备中任选一件</li>
          <li>• 你可以在游戏中购买或发现更多装备</li>
        </ul>
      </div>
    </div>
  );
}
