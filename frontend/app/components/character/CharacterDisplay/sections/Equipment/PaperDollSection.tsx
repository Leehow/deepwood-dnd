import React, { useState } from "react";
import { getIconPath, findWeaponMetaById, findArmorMetaById, getWeaponGroupAndType } from "../../utils/rules";
import { isTwoHandedWeapon, isVersatileWeapon, getVersatileDamage } from "../../utils/equipment";
import { checkArmorProficiencyPenalty, checkWeaponProficiency } from "../../utils/proficiency";
import { useCharacterContext } from "../../context/CharacterContext";
import type { EquipmentItem, EquipSlot } from "../../types/Character";

interface Props {
  openEquip: (slot: EquipSlot) => void;
  getEquipped: (slot: EquipSlot) => EquipmentItem | null;
  onDropToSlot?: (item: EquipmentItem, slot: EquipSlot) => void;
  draggedItem?: EquipmentItem | null;
  onToggleGrip?: () => void;
  avatarZoom?: boolean;
  onAvatarZoomChange?: (zoomed: boolean) => void;
  /** Hover slot set externally by mouse-based drag (bypasses HTML5 drag events) */
  externalHoverSlot?: EquipSlot | null;
  /** Called when clicking on a slot that already has an equipped item (shows item detail) */
  onEquippedItemClick?: (slot: EquipSlot, item: EquipmentItem) => void;
}

const SLOT_LABELS: Record<EquipSlot, string> = {
  main_hand: "主手", off_hand: "副手", armor: "护甲", ammo: "弹药", quick_item: "快捷",
  clothing: "衣物", accessory: "首饰",
};

/** 从 item 自身字段提取伤害骰 */
const getItemDamage = (item: EquipmentItem): string => {
  const d = item.weapon?.damage ?? item.damage;
  if (!d) return "";
  return typeof d === "string" ? d : d?.dice || "";
};

/** 从 item 自身字段提取 AC */
const getItemAC = (item: EquipmentItem): string => {
  // 自定义物品可能存储为 armor_class: { base, dex_bonus }
  const armorClass = (item as any).armor_class;
  if (armorClass && typeof armorClass === "object" && armorClass.base != null) {
    return `AC ${armorClass.base}`;
  }
  const ac = item.armor?.ac ?? item.ac;
  if (ac != null) {
    if (typeof ac === "object" && (ac as any).base != null) return `AC ${(ac as any).base}`;
    if (typeof ac === "number" || typeof ac === "string") return `AC ${ac}`;
  }
  if (item.acBonus) return `+${item.acBonus} AC`;
  return "";
};

/** 获取槽位装备的紧凑关键数值 */
const getSlotStat = (item: EquipmentItem, slot: EquipSlot): string => {
  // 武器：伤害骰（versatile 按 gripMode 显示）
  if (slot === "main_hand" || slot === "off_hand") {
    const meta = findWeaponMetaById(item.id);
    if (meta) {
      const d: any = meta?.damage ?? item?.damage;
      const baseDmg = typeof d === "string" ? d : d?.dice;
      if (!baseDmg) return "";
      if (item.gripMode === "two-hand" && (meta as any)?.versatileDamage) {
        return (meta as any).versatileDamage;
      }
      return baseDmg;
    }
    if (item.id === "shield") return "+2 AC";
    // 自定义物品：从 item 自身字段读取伤害
    return getItemDamage(item);
  }
  // 护甲：AC
  if (slot === "armor") {
    const meta = findArmorMetaById(item.id);
    if (meta) {
      const base: any = (meta as any).acBase ?? (meta as any).ac;
      if (base != null) return `AC ${base}`;
      const map: Record<string, string> = {
        padded: "11", leather: "11", studded_leather: "12",
        hide: "12", chain_shirt: "13", scale_mail: "14",
        breastplate: "14", half_plate: "15", ring_mail: "14",
        chain_mail: "16", splint: "17", plate: "18",
      };
      if (map[item.id]) return `AC ${map[item.id]}`;
    }
    // 自定义物品：从 item 自身字段读取 AC
    return getItemAC(item);
  }
  // 弹药：数量
  if (slot === "ammo" && item.quantity && item.quantity > 1) {
    return `×${item.quantity}`;
  }
  return "";
};

export function PaperDollSection({ openEquip, getEquipped, onDropToSlot, draggedItem, onToggleGrip, avatarZoom: avatarZoomProp, onAvatarZoomChange, externalHoverSlot, onEquippedItemClick }: Props) {
  const { character } = useCharacterContext();
  const armorPenalty = checkArmorProficiencyPenalty(character);
  const weaponProficiency = checkWeaponProficiency(character);
  const [hoverSlot, setHoverSlot] = useState<EquipSlot | null>(null);
  const [avatarZoomLocal, setAvatarZoomLocal] = useState(false);
  const avatarZoom = avatarZoomProp ?? avatarZoomLocal;
  const setAvatarZoom = onAvatarZoomChange ?? setAvatarZoomLocal;

  const isSlotNonProficient = (slot: EquipSlot) => {
    const isArmorNP = armorPenalty.nonProficientItems.some(i => i.slot === slot);
    if (slot === "main_hand" && weaponProficiency.mainHand && !weaponProficiency.mainHand.proficient) return true;
    if (slot === "off_hand" && weaponProficiency.offHand && !weaponProficiency.offHand.proficient) return true;
    return isArmorNP;
  };

  const handleSlotDragOver = (e: React.DragEvent, slot: EquipSlot) => {
    if (!draggedItem || !onDropToSlot) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setHoverSlot(slot);
  };

  const handleSlotDrop = (e: React.DragEvent, slot: EquipSlot) => {
    e.preventDefault();
    setHoverSlot(null);
    if (!draggedItem || !onDropToSlot) return;
    onDropToSlot(draggedItem, slot);
  };

  const handleSlotDragLeave = () => setHoverSlot(null);

  const renderSlot = (slot: EquipSlot, label: string, icon: string) => {
    const equipped = getEquipped(slot);
    const nonProf = equipped ? isSlotNonProficient(slot) : false;
    const isDropTarget = draggedItem && (hoverSlot === slot || externalHoverSlot === slot);

    // 双手武器或 versatile 双手握持占用副手槽位检测
    const mainHandItem = getEquipped("main_hand");
    const isTwoHandedOccupied = slot === "off_hand" && !equipped && (
      isTwoHandedWeapon(mainHandItem) ||
      (isVersatileWeapon(mainHandItem) && mainHandItem?.gripMode === "two-hand")
    );

    const stat = equipped ? getSlotStat(equipped, slot) : "";

    return (
      <button
        type="button"
        data-equip-slot={slot}
        onClick={() => {
          if (isTwoHandedOccupied) return;
          if (equipped && onEquippedItemClick) {
            onEquippedItemClick(slot, equipped);
          } else {
            openEquip(slot);
          }
        }}
        className={`relative w-14 h-14 bg-gray-800/60 border rounded-lg overflow-hidden transition-all hover:scale-105 ${
          isDropTarget ? "border-cyan-400 border-2 bg-cyan-900/30 scale-105" :
          isTwoHandedOccupied ? "border-gray-600/50 cursor-default" :
          nonProf ? "border-amber-500/70" :
          equipped ? "border-gray-600" : "border-gray-700/50 border-dashed"
        }`}
        title={isTwoHandedOccupied ? "双手武器占用" : nonProf ? "不熟练!" : label}
        onDragOver={e => handleSlotDragOver(e, slot)}
        onDragLeave={handleSlotDragLeave}
        onDrop={e => handleSlotDrop(e, slot)}
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
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent px-1 py-0.5">
              <div className="text-[9px] text-center text-gray-400 font-medium">双手</div>
            </div>
          </>
        ) : equipped ? (
          <>
            {getIconPath(equipped) ? (
              <img
                src={getIconPath(equipped) as string}
                alt={label}
                className="absolute inset-0 w-full h-full object-cover"
                onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-lg opacity-60">{icon}</div>
            )}
            {nonProf && (
              <div className="absolute top-0.5 right-0.5 w-4 h-4 bg-amber-500 rounded-full flex items-center justify-center text-black text-[10px] font-bold z-10">!</div>
            )}
            {stat && (
              <div className="absolute top-0 left-0 bg-black/70 px-1 py-0 rounded-br text-[9px] font-mono text-amber-300 leading-tight z-10">
                {stat}
              </div>
            )}
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent px-1 py-0.5">
              <div className={`text-[9px] truncate font-medium ${nonProf ? "text-amber-300" : "text-gray-200"}`}>
                {equipped.name || equipped.id}
              </div>
            </div>
          </>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
            <span className="text-sm opacity-30">{icon}</span>
            <span className="text-[9px] text-gray-500">{label}</span>
          </div>
        )}
      </button>
    );
  };

  const mainHandEquipped = getEquipped("main_hand");
  const showGripToggle = isVersatileWeapon(mainHandEquipped) && !isTwoHandedWeapon(mainHandEquipped);
  const versatileDmg = showGripToggle ? getVersatileDamage(mainHandEquipped) : null;

  return (
    <div className="flex flex-col items-center gap-1 py-2">
      <div className="flex items-center justify-center gap-3">
        <div className="flex flex-col items-center gap-2">
          {renderSlot("ammo", "弹药", "🏹")}
          {renderSlot("main_hand", "主手", "⚔️")}
          {showGripToggle && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onToggleGrip?.(); }}
              className="px-1.5 py-0.5 text-[10px] rounded border border-gray-600 bg-gray-700/60 hover:bg-gray-600/80 transition-colors text-gray-300 whitespace-nowrap"
              title={mainHandEquipped?.gripMode === "two-hand" ? "切换为单手握持" : "切换为双手握持"}
            >
              {mainHandEquipped?.gripMode === "two-hand"
                ? <><span className="text-amber-300">{versatileDmg?.twoHand}</span> ⇌ {versatileDmg?.oneHand}</>
                : <><span className="text-amber-300">{versatileDmg?.oneHand}</span> ⇌ {versatileDmg?.twoHand}</>
              }
            </button>
          )}
        </div>

        <div
          className={`w-20 h-20 rounded-lg border border-gray-700/50 overflow-hidden bg-gray-800/40 flex-shrink-0 ${character.avatar ? "cursor-pointer hover:border-gray-500 transition-colors" : ""}`}
          onClick={() => character.avatar && setAvatarZoom(true)}
        >
          {character.avatar ? (
            <img src={character.avatar} alt={character.name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-2xl text-gray-600">
              {character.name?.[0] || "?"}
            </div>
          )}
        </div>

        <div className="flex flex-col items-center gap-2">
          {renderSlot("quick_item", "快捷", "⚡")}
          {renderSlot("off_hand", "副手", "🗡️")}
        </div>
      </div>

      {renderSlot("armor", "护甲", "🛡️")}

      {/* 不熟练装备警告 */}
      {(armorPenalty.nonProficientItems.length > 0 || weaponProficiency.hasNonProficientWeapon) && (
        <div className="w-full px-2 py-1 bg-amber-900/20 border border-amber-700/40 rounded text-[10px] text-amber-300/90 leading-snug">
          {armorPenalty.nonProficientItems.map(i => {
            const meta = findArmorMetaById(i.id);
            const tierLabel = meta?.tier === 'light' ? '轻甲' : meta?.tier === 'medium' ? '中甲' : meta?.tier === 'heavy' ? '重甲' : meta?.tier === 'shield' ? '盾牌' : '护甲';
            return <div key={i.slot}>⚠ {i.name}：{tierLabel}不熟练 — 力量/敏捷检定和豁免劣势、攻击劣势、无法施法</div>;
          })}
          {weaponProficiency.mainHand && !weaponProficiency.mainHand.proficient && (() => {
            const info = getWeaponGroupAndType(weaponProficiency.mainHand.id);
            const groupLabel = info?.group === 'simple' ? '简易武器' : info?.group === 'martial' ? '军用武器' : '武器';
            return <div>⚠ {weaponProficiency.mainHand.name}：{groupLabel}不熟练 — 攻击检定不加熟练加值</div>;
          })()}
          {weaponProficiency.offHand && !weaponProficiency.offHand.proficient && (() => {
            const info = getWeaponGroupAndType(weaponProficiency.offHand.id);
            const groupLabel = info?.group === 'simple' ? '简易武器' : info?.group === 'martial' ? '军用武器' : '武器';
            return <div>⚠ {weaponProficiency.offHand.name}：{groupLabel}不熟练 — 攻击检定不加熟练加值</div>;
          })()}
        </div>
      )}

      <div className="flex items-center justify-center gap-3">
        {renderSlot("clothing", "衣物", "👘")}
        {renderSlot("accessory", "首饰", "💍")}
      </div>

    </div>
  );
}
