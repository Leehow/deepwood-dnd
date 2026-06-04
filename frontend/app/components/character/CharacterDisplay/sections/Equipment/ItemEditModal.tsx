import React, { useState, useEffect } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { RARITY_OPTIONS, DAMAGE_TYPE_OPTIONS, WEAPON_PROPERTY_OPTIONS } from "~/components/campaign/ItemPreviewEditor";
import type { EquipmentItem } from "../../types/Character";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  item: EquipmentItem;
  onSave: (updated: EquipmentItem) => void;
}

const inputCls = "w-full h-8 px-2 bg-gray-800 border border-gray-600 rounded text-sm text-gray-100 focus:border-blue-500 outline-none";
const selectCls = "w-full h-8 px-1.5 bg-gray-800 border border-gray-600 rounded text-sm text-gray-100 cursor-pointer outline-none";
const labelCls = "text-xs text-gray-400 mb-0.5";

/** 提取伤害骰字符串 */
const getDmgDice = (item: EquipmentItem): string => {
  const d = (item as any).damage;
  if (!d) return "";
  return typeof d === "string" ? d : d?.dice || "";
};

/** 提取伤害类型 */
const getDmgType = (item: EquipmentItem): string => {
  const d = (item as any).damage;
  const fromObj = d && typeof d === "object" ? d.type : null;
  return fromObj || (item as any).damageType || "";
};

/** 提取 AC 基础值 */
const getACBase = (item: EquipmentItem): string => {
  const ac = (item as any).armor_class;
  if (ac && typeof ac === "object" && ac.base != null) return String(ac.base);
  const raw = item.ac;
  if (raw != null) {
    if (typeof raw === "object" && (raw as any).base != null) return String((raw as any).base);
    if (typeof raw === "number" || typeof raw === "string") return String(raw);
  }
  return "";
};

/** 提取 DEX 加成 */
const getACDex = (item: EquipmentItem): boolean => {
  const ac = (item as any).armor_class;
  if (ac && typeof ac === "object") return !!ac.dex_bonus;
  return false;
};

const isWeaponItem = (item: EquipmentItem) =>
  (item as any).category === "weapon" || item.equipmentType === "weapon" || !!(item as any).damage;

const isArmorItem = (item: EquipmentItem) =>
  (item as any).category === "armor" || item.equipmentType === "armor" || item.ac != null || !!(item as any).armor_class;

export function ItemEditModal({ open, onOpenChange, item, onSave }: Props) {
  const [draft, setDraft] = useState<EquipmentItem>({ ...item });
  // Editable field states
  const [name, setName] = useState(item.name || "");
  const [quantity, setQuantity] = useState(item.quantity || 1);
  const [weight, setWeight] = useState<string>(item.weight != null ? String(item.weight) : "");
  const [rarity, setRarity] = useState<string>((item as any).rarity || "common");
  const [magicBonus, setMagicBonus] = useState<string>((item as any).magic_bonus != null ? String((item as any).magic_bonus) : "");
  const [description, setDescription] = useState<string>(item.description || "");
  // Weapon
  const [dmgDice, setDmgDice] = useState(getDmgDice(item));
  const [dmgType, setDmgType] = useState(getDmgType(item));
  const [rangeNormal, setRangeNormal] = useState<string>("");
  const [rangeLong, setRangeLong] = useState<string>("");
  const [properties, setProperties] = useState<string[]>(item.properties || []);
  // Armor
  const [acBase, setAcBase] = useState(getACBase(item));
  const [acDex, setAcDex] = useState(getACDex(item));
  // Charges
  const [chargesCurrent, setChargesCurrent] = useState<string>("");

  useEffect(() => {
    if (!open) return;
    setDraft({ ...item });
    setName(item.name || "");
    setQuantity(item.quantity || 1);
    setWeight(item.weight != null ? String(item.weight) : "");
    setRarity((item as any).rarity || "common");
    setMagicBonus((item as any).magic_bonus != null ? String((item as any).magic_bonus) : "");
    setDescription(item.description || "");
    setDmgDice(getDmgDice(item));
    setDmgType(getDmgType(item));
    const r = (item as any).range;
    setRangeNormal(r && typeof r === "object" ? String(r.normal || "") : "");
    setRangeLong(r && typeof r === "object" ? String(r.long || "") : "");
    setProperties(item.properties || []);
    setAcBase(getACBase(item));
    setAcDex(getACDex(item));
    const ch = (item as any).charges;
    setChargesCurrent(ch?.current != null ? String(ch.current) : ch?.max != null ? String(ch.max) : "");
  }, [open, item]);

  const handleSave = () => {
    const updated: EquipmentItem = {
      ...draft,
      name,
      quantity,
      weight: weight ? parseFloat(weight) : undefined,
      description: description || undefined,
      properties,
    };
    (updated as any).rarity = rarity;
    (updated as any).magic_bonus = magicBonus ? parseInt(magicBonus) : undefined;
    // Weapon fields
    if (isWeaponItem(item)) {
      if (dmgDice) {
        (updated as any).damage = dmgType ? { dice: dmgDice, type: dmgType } : dmgDice;
        updated.damageType = dmgType || undefined;
      }
      if (rangeNormal) {
        (updated as any).range = { normal: parseInt(rangeNormal), long: rangeLong ? parseInt(rangeLong) : parseInt(rangeNormal) };
      }
    }
    // Armor fields
    if (isArmorItem(item)) {
      const base = parseInt(acBase);
      if (!isNaN(base)) {
        (updated as any).armor_class = { base, dex_bonus: acDex };
        updated.ac = { base, dex_bonus: acDex } as any;
      }
    }
    // Charges
    const ch = (draft as any).charges;
    if (ch?.max) {
      (updated as any).charges = { ...ch, current: chargesCurrent ? parseInt(chargesCurrent) : ch.max };
    }
    onSave(updated);
    onOpenChange(false);
  };

  const toggleProperty = (prop: string) => {
    setProperties(prev => prev.includes(prop) ? prev.filter(p => p !== prop) : [...prev, prop]);
  };

  const charges = (item as any).charges;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-[10298]" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[90vw] max-w-sm bg-gray-900 border border-gray-700 rounded-lg p-4 space-y-3 z-[10300] max-h-[85vh] overflow-y-auto"
        >
          <Dialog.Title className="text-base font-semibold text-gray-100">编辑物品</Dialog.Title>

          {/* 名称 + 数量 */}
          <div className="grid grid-cols-[1fr_80px] gap-2">
            <div><div className={labelCls}>名称</div><input className={inputCls} value={name} onChange={e => setName(e.target.value)} /></div>
            <div><div className={labelCls}>数量</div><input className={inputCls} type="number" min={1} value={quantity} onChange={e => setQuantity(Math.max(1, parseInt(e.target.value) || 1))} /></div>
          </div>

          {/* 重量 + 稀有度 + 魔法加值 */}
          <div className="grid grid-cols-3 gap-2">
            <div><div className={labelCls}>重量(lb)</div><input className={inputCls} type="number" step="0.1" min={0} value={weight} onChange={e => setWeight(e.target.value)} /></div>
            <div>
              <div className={labelCls}>稀有度</div>
              <select className={selectCls} value={rarity} onChange={e => setRarity(e.target.value)}>
                {RARITY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div><div className={labelCls}>魔法加值</div><input className={inputCls} type="number" min={0} max={3} value={magicBonus} onChange={e => setMagicBonus(e.target.value)} placeholder="无" /></div>
          </div>

          {/* 武器参数 */}
          {isWeaponItem(item) && (
            <div className="p-2.5 bg-gray-800/40 border border-gray-700/50 rounded-lg space-y-2">
              <div className="text-xs text-amber-400 font-medium">武器参数</div>
              <div className="grid grid-cols-2 gap-2">
                <div><div className={labelCls}>伤害骰</div><input className={inputCls} value={dmgDice} onChange={e => setDmgDice(e.target.value)} placeholder="如 2d6" /></div>
                <div>
                  <div className={labelCls}>伤害类型</div>
                  <select className={selectCls} value={dmgType} onChange={e => setDmgType(e.target.value)}>
                    <option value="">无</option>
                    {DAMAGE_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div><div className={labelCls}>射程(常规)</div><input className={inputCls} type="number" value={rangeNormal} onChange={e => setRangeNormal(e.target.value)} placeholder="如 80" /></div>
                <div><div className={labelCls}>射程(最大)</div><input className={inputCls} type="number" value={rangeLong} onChange={e => setRangeLong(e.target.value)} placeholder="如 320" /></div>
              </div>
              <div>
                <div className={labelCls}>武器属性</div>
                <div className="flex flex-wrap gap-1 mt-0.5">
                  {WEAPON_PROPERTY_OPTIONS.map(p => (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => toggleProperty(p.value)}
                      className={`px-1.5 py-0.5 text-[11px] rounded border transition-colors ${
                        properties.includes(p.value)
                          ? "bg-blue-600/40 border-blue-500/60 text-blue-200"
                          : "bg-gray-800 border-gray-600 text-gray-400 hover:border-gray-500"
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* 护甲参数 */}
          {isArmorItem(item) && (
            <div className="p-2.5 bg-gray-800/40 border border-gray-700/50 rounded-lg space-y-2">
              <div className="text-xs text-blue-400 font-medium">护甲参数</div>
              <div className="grid grid-cols-2 gap-2 items-end">
                <div><div className={labelCls}>AC 基础值</div><input className={inputCls} type="number" value={acBase} onChange={e => setAcBase(e.target.value)} /></div>
                <label className="flex items-center gap-1.5 h-8 text-sm text-gray-300 cursor-pointer">
                  <input type="checkbox" checked={acDex} onChange={e => setAcDex(e.target.checked)} className="accent-blue-500" />
                  <span>+DEX 修正</span>
                </label>
              </div>
            </div>
          )}

          {/* 充能 */}
          {charges?.max && (
            <div className="p-2.5 bg-gray-800/40 border border-gray-700/50 rounded-lg space-y-1">
              <div className="text-xs text-indigo-400 font-medium">充能</div>
              <div className="flex items-center gap-2">
                <input className={`${inputCls} w-20`} type="number" min={0} max={charges.max} value={chargesCurrent} onChange={e => setChargesCurrent(e.target.value)} />
                <span className="text-sm text-gray-400">/ {charges.max}</span>
              </div>
            </div>
          )}

          {/* 描述 */}
          <div>
            <div className={labelCls}>描述</div>
            <textarea
              className="w-full min-h-[80px] px-2 py-1.5 bg-gray-800 border border-gray-600 rounded text-sm text-gray-100 focus:border-blue-500 outline-none resize-y"
              value={description}
              onChange={e => setDescription(e.target.value)}
            />
          </div>

          {/* 操作按钮 */}
          <div className="flex gap-2 justify-end pt-1">
            <button
              className="px-4 py-1.5 text-sm bg-gray-700 hover:bg-gray-600 text-gray-200 rounded transition-colors"
              onClick={() => onOpenChange(false)}
            >
              取消
            </button>
            <button
              className="px-4 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors"
              onClick={handleSave}
            >
              保存
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
