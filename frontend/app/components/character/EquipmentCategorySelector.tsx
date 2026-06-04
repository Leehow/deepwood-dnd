import { useState } from "react";
import equipmentData from "~/data/rules/equipment.json";
import { tDamageType } from "~/utils/i18n";

interface EquipmentCategorySelectorProps {
  categoryId: string;
  onSelect: (itemId: string) => void;
  selectedItemId?: string;
}

interface EquipmentItem {
  id: string;
  name: string;
  nameEn: string;
  [key: string]: any;
}

export function EquipmentCategorySelector({
  categoryId,
  onSelect,
  selectedItemId,
}: EquipmentCategorySelectorProps) {
  const [isOpen, setIsOpen] = useState(false);

  // Get all items in the category
  const getItemsInCategory = (): EquipmentItem[] => {
    const items: EquipmentItem[] = [];

    switch (categoryId) {
      case "simple_weapon":
        items.push(...equipmentData.weapons.simple.melee);
        items.push(...equipmentData.weapons.simple.ranged);
        break;
      case "martial_weapon":
        items.push(...equipmentData.weapons.martial.melee);
        items.push(...equipmentData.weapons.martial.ranged);
        break;
      case "simple_melee_weapon":
        items.push(...equipmentData.weapons.simple.melee);
        break;
      case "martial_melee_weapon":
        items.push(...equipmentData.weapons.martial.melee);
        break;
      case "simple_ranged_weapon":
        items.push(...equipmentData.weapons.simple.ranged);
        break;
      case "martial_ranged_weapon":
        items.push(...equipmentData.weapons.martial.ranged);
        break;
      case "light_armor":
        items.push(...equipmentData.armor.light);
        break;
      case "medium_armor":
        items.push(...equipmentData.armor.medium);
        break;
      case "heavy_armor":
        items.push(...equipmentData.armor.heavy);
        break;
      case "shield":
      case "shields":
        items.push(...equipmentData.armor.shield);
        break;
      case "holy_symbol":
        items.push(...equipmentData.adventuringGear.holySymbol);
        break;
      case "druidic_focus":
        items.push(...equipmentData.adventuringGear.druidicFocus);
        break;
      case "arcane_focus":
        items.push(...equipmentData.adventuringGear.arcaneFocus);
        break;
      case "musical_instrument":
        items.push(...equipmentData.tools.musicalInstruments);
        break;
      case "artisan_tools":
        items.push(...equipmentData.tools.artisansTools);
        break;
      default:
        break;
    }

    return items;
  };

  const items = getItemsInCategory();
  const selectedItem = items.find((item) => item.id === selectedItemId);

  // Get display info for an item
  const getItemDisplayInfo = (item: EquipmentItem): string => {
    const parts: string[] = [];

    // Weapon info
    if (item.damage) {
      parts.push(`伤害: ${item.damage}`);
      if (item.damageType) {
        parts.push(tDamageType(item.damageType));
      }
    }

    // Armor info
    if (item.ac) {
      parts.push(`AC: ${item.ac}`);
    }
    if (item.acBonus) {
      parts.push(`AC加值: +${item.acBonus}`);
    }

    // Properties
    if (item.properties && item.properties.length > 0) {
      const propertyMap: Record<string, string> = {
        light: "轻型",
        finesse: "灵巧",
        thrown: "投掷",
        versatile: "双用",
        "two-handed": "双手",
        ammunition: "弹药",
        loading: "填弹",
        heavy: "重型",
        reach: "触及",
        special: "特殊",
      };
      const propNames = item.properties
        .map((p: string) => propertyMap[p] || p)
        .join(", ");
      parts.push(propNames);
    }

    // Range
    if (item.range) {
      const isThrown = item.properties?.some((p: string) => p === 'thrown' || p.includes('投掷'));
      const rangeLabel = isThrown ? '投掷射程' : '射程';
      parts.push(`${rangeLabel}: ${item.range.normal}/${item.range.long}尺`);
    }

    // Weight and cost
    if (item.weight) {
      parts.push(`${item.weight}磅`);
    }
    if (item.cost) {
      const costStr = Object.entries(item.cost)
        .map(([unit, value]) => `${value}${unit.toUpperCase()}`)
        .join(" ");
      parts.push(costStr);
    }

    return parts.join(" · ");
  };

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full px-3 py-2 rounded-lg border-2 transition-all text-left ${
          selectedItem
            ? "border-amber-600 bg-amber-900/30"
            : "border-gray-600 bg-gray-700/30 hover:border-gray-500"
        }`}
      >
        <div className="flex items-center justify-between">
          <div className="flex-1">
            {selectedItem ? (
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-green-400 text-sm">✓</span>
                  {/* Equipment Icon */}
                  {selectedItem.iconPath && (
                    <img
                      src={selectedItem.iconPath}
                      alt={selectedItem.name}
                      className="w-6 h-6 rounded flex-shrink-0 object-cover"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                      }}
                    />
                  )}
                  <span className="font-medium text-amber-300">{selectedItem.name}</span>
                  {selectedItem.nameEn && (
                    <span className="text-xs text-gray-500">({selectedItem.nameEn})</span>
                  )}
                </div>
                <div className="text-xs text-gray-400 mt-1 ml-6">
                  {getItemDisplayInfo(selectedItem)}
                </div>
              </div>
            ) : (
              <div className="text-gray-400">点击选择具体装备...</div>
            )}
          </div>
          <div className="ml-2 text-gray-400 flex-shrink-0">
            {isOpen ? "▲" : "▼"}
          </div>
        </div>
      </button>

      {isOpen && (
        <div className="absolute z-10 w-full mt-2 bg-gray-800 border-2 border-gray-600 rounded-lg shadow-xl max-h-96 overflow-y-auto">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onSelect(item.id);
                setIsOpen(false);
              }}
              className={`w-full px-4 py-3 text-left transition-colors border-b border-gray-700 last:border-b-0 ${
                item.id === selectedItemId
                  ? "bg-amber-900/40 text-amber-300"
                  : "hover:bg-gray-700/50 text-gray-200"
              }`}
            >
              <div className="flex items-start gap-2">
                {/* Equipment Icon */}
                {item.iconPath && (
                  <img
                    src={item.iconPath}
                    alt={item.name}
                    className="w-8 h-8 rounded flex-shrink-0 object-cover mt-0.5"
                    onError={(e) => {
                      e.currentTarget.style.display = 'none';
                    }}
                  />
                )}
                <div className="flex-1">
                  <div className="font-medium">{item.name}</div>
                  <div className="text-xs text-gray-400 mt-1">
                    {item.nameEn}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    {getItemDisplayInfo(item)}
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

