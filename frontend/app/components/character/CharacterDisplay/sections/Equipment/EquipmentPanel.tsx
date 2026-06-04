import React from "react";
import { getIconPath } from "../../utils/rules";
import { getEquipmentSummary, isTwoHandedWeapon, isVersatileWeapon } from "../../utils/equipment";
import { useCharacterContext } from "../../context/CharacterContext";
import { checkArmorProficiencyPenalty, checkWeaponProficiency } from "../../utils/proficiency";
import { getAssetUrl } from "~/utils/asset-url";
import type { EquipmentItem, EquipSlot as Slot } from "../../types/Character";

interface Spell {
  id: string;
  name: string;
  level?: number;
  iconPath?: string;
  school?: string;
}

interface Props {
  setSpellDialogOpen: (v: boolean) => void;
  setClassFeatOpen: (v: boolean) => void;
  setBagOpen: (v: boolean) => void;
  openEquip: (slot: Slot) => void;
  getEquipped: (slot: Slot) => EquipmentItem | null;
  // 快捷法术相关
  isSpellcaster?: boolean;
  isPreparedCaster?: boolean;
  spellsAll?: Spell[];
  cantripsLocal?: string[];
  knownSpells?: string[];
  preparedLocal?: string[];
  quickSpells?: (string | null)[];
  onQuickSpellClick?: (slotIndex: number) => void;
}

export function EquipmentPanel({
  setSpellDialogOpen,
  setClassFeatOpen,
  setBagOpen,
  openEquip,
  getEquipped,
  isSpellcaster = false,
  isPreparedCaster = false,
  spellsAll = [],
  cantripsLocal = [],
  knownSpells = [],
  preparedLocal = [],
  quickSpells = [null, null, null, null],
  onQuickSpellClick,
}: Props) {
  const { character, focusIds, lightSourceIds } = useCharacterContext();

  // 检查护甲熟练惩罚
  const armorPenalty = checkArmorProficiencyPenalty(character);
  // 检查武器熟练
  const weaponProficiency = checkWeaponProficiency(character);

  // 获取可用法术列表（戏法 + 已知/准备的法术）
  // 准备型施法者用 preparedLocal，已知型施法者用 knownSpells
  const availableSpellIds = [...cantripsLocal, ...(isPreparedCaster ? preparedLocal : knownSpells)];

  // 根据ID获取法术详情
  const getSpellById = (id: string): Spell | undefined => {
    return spellsAll.find(s => s.id === id);
  };

  // 大槽位渲染函数
  const renderSlot = (slot: Slot, label: string) => {
    const equipped = getEquipped(slot);

    // 双手武器或 versatile 双手握持占用副手槽位检测
    const mainHandItem = getEquipped("main_hand");
    const isTwoHandedOccupied = slot === "off_hand" && !equipped && (
      isTwoHandedWeapon(mainHandItem) ||
      (isVersatileWeapon(mainHandItem) && mainHandItem?.gripMode === "two-hand")
    );

    // 检查该槽位的装备是否不熟练
    const isArmorNonProficient = equipped && armorPenalty.nonProficientItems.some(
      item => item.slot === slot
    );

    // 检查武器是否不熟练
    let isWeaponNonProficient = false;
    if (slot === "main_hand" && weaponProficiency.mainHand && !weaponProficiency.mainHand.proficient) {
      isWeaponNonProficient = true;
    }
    if (slot === "off_hand" && weaponProficiency.offHand && !weaponProficiency.offHand.proficient) {
      isWeaponNonProficient = true;
    }

    const isNonProficient = isArmorNonProficient || isWeaponNonProficient;
    const warningTitle = isWeaponNonProficient
      ? "武器不熟练！攻击不加熟练加值"
      : "护甲不熟练！力量/敏捷检定、豁免、攻击有劣势，无法施法";

    return (
      <button
        type="button"
        onClick={() => { if (!isTwoHandedOccupied) openEquip(slot); }}
        className={`relative aspect-square bg-gray-800/50 border rounded overflow-hidden ${
          isTwoHandedOccupied
            ? "border-gray-600/50 cursor-default"
            : isNonProficient
              ? "border-amber-500/70 hover:border-amber-400"
              : "border-gray-700 hover:border-gray-500"
        }`}
        title={isTwoHandedOccupied ? "双手武器占用" : undefined}
      >
        {isTwoHandedOccupied ? (
          <>
            {getIconPath(mainHandItem!) ? (
              <img
                src={getIconPath(mainHandItem!) as string}
                alt="双手"
                className="absolute inset-0 w-full h-full object-cover opacity-30"
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-lg opacity-20">⚔️</div>
            )}
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent p-1.5">
              <div className="text-[10px] text-center text-gray-400 font-medium">双手</div>
            </div>
          </>
        ) : equipped ? (
          <>
            {getIconPath(equipped) && (
              <img
                src={getIconPath(equipped) as string}
                alt={label}
                className="absolute inset-0 w-full h-full object-cover"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
              />
            )}
            {/* 不熟练警告标记 */}
            {isNonProficient && (
              <div
                className="absolute top-1 right-1 w-5 h-5 bg-amber-500 rounded-full flex items-center justify-center text-black text-xs font-bold shadow-lg z-10"
                title={warningTitle}
              >
                !
              </div>
            )}
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/70 to-transparent p-1.5">
              <div className={`text-xs truncate font-medium ${isNonProficient ? "text-amber-300" : "text-gray-200"}`}>
                {equipped.name || equipped.id}
              </div>
              <div className="text-[10px] text-gray-400 truncate">
                {getEquipmentSummary(equipped, focusIds, lightSourceIds)}
              </div>
            </div>
          </>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="text-xs text-gray-400">{label}</div>
            <div className="text-xs text-gray-500 mt-1">未装备</div>
          </div>
        )}
      </button>
    );
  };

  // 小槽位渲染函数
  const renderMiniSlot = (slot: Slot, label: string, icon: string) => {
    const equipped = getEquipped(slot);

    // 检查该槽位的装备是否不熟练（主要用于副手盾牌）
    const isNonProficient = equipped && armorPenalty.nonProficientItems.some(
      item => item.slot === slot
    );

    return (
      <button
        type="button"
        onClick={() => openEquip(slot)}
        className={`relative w-full h-full bg-gray-800/50 border rounded overflow-hidden ${
          isNonProficient
            ? "border-amber-500/70 hover:border-amber-400"
            : "border-gray-700 hover:border-gray-500"
        }`}
      >
        {equipped ? (
          <>
            {getIconPath(equipped) && (
              <img
                src={getIconPath(equipped) as string}
                alt={label}
                className="absolute inset-0 w-full h-full object-cover"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
              />
            )}
            {/* 不熟练警告标记 */}
            {isNonProficient && (
              <div
                className="absolute top-0.5 right-0.5 w-4 h-4 bg-amber-500 rounded-full flex items-center justify-center text-black text-[10px] font-bold shadow-lg z-10"
                title="不熟练！"
              >
                !
              </div>
            )}
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent p-1">
              <div className={`text-[10px] truncate font-medium ${isNonProficient ? "text-amber-300" : "text-gray-200"}`}>
                {equipped.name || equipped.id}
              </div>
              {equipped.quantity && equipped.quantity > 1 && (
                <div className="text-[9px] text-amber-400">x{equipped.quantity}</div>
              )}
            </div>
          </>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-base opacity-50">{icon}</span>
            <div className="text-[10px] text-gray-500">{label}</div>
          </div>
        )}
      </button>
    );
  };

  // 快捷法术槽位渲染函数
  const renderQuickSpellSlot = (slotIndex: number) => {
    const spellId = quickSpells[slotIndex];
    const spell = spellId ? getSpellById(spellId) : null;
    const isCantrip = spell && cantripsLocal.includes(spell.id);

    return (
      <button
        type="button"
        onClick={() => onQuickSpellClick?.(slotIndex)}
        className="relative w-full aspect-square bg-gray-800/50 border border-gray-700 hover:border-violet-500/50 rounded overflow-hidden transition-colors"
      >
        {spell ? (
          <>
            {spell.iconPath && (
              <img
                src={getAssetUrl(spell.iconPath.replace(/^\//, ''))}
                alt={spell.name}
                className="absolute inset-0 w-full h-full object-cover"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
              />
            )}
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent p-1">
              <div className="text-[10px] text-gray-200 truncate font-medium">
                {spell.name}
              </div>
              <div className="text-[9px] text-violet-400">
                {isCantrip ? '戏法' : `${spell.level}环`}
              </div>
            </div>
          </>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-lg opacity-30">✨</span>
            <div className="text-[9px] text-gray-500">法术{slotIndex + 1}</div>
          </div>
        )}
      </button>
    );
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-semibold text-gray-300">装备</div>
        <div className="flex items-center gap-2">
          {isSpellcaster && (
            <button className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 rounded" onClick={() => setSpellDialogOpen(true)}>
              法术
            </button>
          )}
          <button className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 rounded" onClick={() => setClassFeatOpen(true)}>
            特性
          </button>
          <button className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-200 rounded" onClick={() => setBagOpen(true)}>
            背包
          </button>
        </div>
      </div>
      <div className="flex gap-2">
        {/* 主要三个槽位 */}
        <div className="grid grid-cols-3 gap-2 flex-1">
          {renderSlot("main_hand", "主手")}
          {renderSlot("off_hand", "副手")}
          {renderSlot("armor", "护甲")}
        </div>
        {/* 右侧四个小槽位 (2x2) */}
        <div className="grid grid-cols-2 gap-1 w-[7.5rem]">
          <div className="aspect-square">
            {renderMiniSlot("clothing", "衣物", "👘")}
          </div>
          <div className="aspect-square">
            {renderMiniSlot("accessory", "首饰", "💍")}
          </div>
          <div className="aspect-square">
            {renderMiniSlot("ammo", "弹药", "🏹")}
          </div>
          <div className="aspect-square">
            {renderMiniSlot("quick_item", "快捷", "⚡")}
          </div>
        </div>
      </div>

      {/* 不熟练装备惩罚警告 */}
      {armorPenalty.nonProficientItems.length > 0 && (
        <div className="mt-2 p-2 bg-amber-900/30 border border-amber-600/50 rounded text-xs">
          <div className="flex items-start gap-2">
            <span className="text-amber-400 font-bold">!</span>
            <div className="flex-1">
              <div className="text-amber-300 font-medium mb-1">装备不熟练惩罚</div>
              <ul className="text-amber-200/80 space-y-0.5">
                <li>• 力量/敏捷检定、豁免、攻击具有<span className="text-red-400 font-medium">劣势</span></li>
                {isSpellcaster && <li>• <span className="text-red-400 font-medium">无法施放法术</span></li>}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* 快捷法术栏 - 只有施法者显示 */}
      {isSpellcaster && availableSpellIds.length > 0 && (
        <div className="mt-2">
          <div className="grid grid-cols-4 gap-1.5">
            {[0, 1, 2, 3].map(i => (
              <div key={i}>
                {renderQuickSpellSlot(i)}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
