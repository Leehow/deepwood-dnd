import React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { getIconPath, findArmorMetaById } from "../../utils/rules";
import { getWeaponGroupAndType } from "../../utils/rules";
import { getEquipmentSummary, isTwoHandedWeapon } from "../../utils/equipment";
import { isProficientWithWeaponId, isProficientWithArmorId } from "../../utils/proficiency";
import { useCharacterContext } from "../../context/CharacterContext";
import type { EquipmentItem, EquipSlot as Slot } from "../../types/Character";
import { publishAppEvent } from "~/events/appEventBus";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  slot: Slot | null;
  equipmentLocal: EquipmentItem[];
  setEquipmentLocal: (v: EquipmentItem[]) => void;
  getEquipped: (slot: Slot) => EquipmentItem | null;
  backpackWeapons: EquipmentItem[];
  backpackShield: EquipmentItem[];
  backpackOtherHandheld: EquipmentItem[];
  backpackLightArmor: EquipmentItem[];
  backpackMediumArmor: EquipmentItem[];
  backpackHeavyArmor: EquipmentItem[];
  backpackAmmo?: EquipmentItem[];
  backpackConsumables?: EquipmentItem[];
  backpackClothing?: EquipmentItem[];
  backpackAccessory?: EquipmentItem[];
  applyEquip: (it: EquipmentItem) => void;
  setProfHelpOpen: (v: boolean) => void;
  setProfHelpType: (t: "weapon" | "armor") => void;
}

const slotLabels: Record<string, string> = {
  main_hand: "主手",
  off_hand: "副手",
  armor: "护甲",
  ammo: "弹药",
  quick_item: "快捷物品",
  clothing: "衣物",
  accessory: "首饰",
};

export function EquipDialog({ open, onOpenChange, slot, equipmentLocal, setEquipmentLocal, getEquipped, backpackWeapons, backpackShield, backpackOtherHandheld, backpackLightArmor, backpackMediumArmor, backpackHeavyArmor, backpackAmmo = [], backpackConsumables = [], backpackClothing = [], backpackAccessory = [], applyEquip, setProfHelpOpen, setProfHelpType }: Props) {
  const { character, persistCharacterPartial, focusIds, lightSourceIds } = useCharacterContext();

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-[10198]" />
        <Dialog.Content aria-describedby={undefined} className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[92vw] max-w-lg bg-gray-900 border border-gray-700 rounded p-4 space-y-3 z-[10200]">
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-sm font-semibold text-gray-300">
              选择{slot ? slotLabels[slot] || slot : ""}
            </Dialog.Title>
            <div className="flex items-center gap-2">
              {slot && getEquipped(slot) && (
                <button
                  className="px-2 py-1 text-xs bg-red-900/30 hover:bg-red-900/50 text-red-300 border border-red-700 rounded"
                  onClick={async () => {
                    const updated = (equipmentLocal || []).map((it: EquipmentItem) => it.equippedSlot === slot ? { ...it, equippedSlot: null as any } : it);
                    setEquipmentLocal(updated);
                    if (persistCharacterPartial) {
                      await persistCharacterPartial(updated, undefined);
                    }
                    // Dispatch event so TacticalMap can broadcast via WebSocket
                    publishAppEvent('characterEquipmentUpdated', {
                      characterId: character.id,
                      equipment: updated,
                      needsBroadcast: true,
                    });
                    onOpenChange(false);
                  }}
                >
                  卸下装备
                </button>
              )}
              <Dialog.Close className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg bg-gray-700/50 hover:bg-gray-600/50 text-gray-400 hover:text-white transition-colors">
                ✕
              </Dialog.Close>
            </div>
          </div>

          {(["main_hand", "off_hand"].includes(String(slot)) as boolean) && (
            <div className="space-y-3 max-h-80 overflow-auto pr-1">
              {/* 双手武器占用副手提示 */}
              {slot === "off_hand" && isTwoHandedWeapon(getEquipped("main_hand")) && (
                <div className="bg-amber-900/30 border border-amber-700/50 rounded px-3 py-2 text-xs text-amber-300">
                  主手装备了双手武器，装备副手将自动卸下主手武器。
                </div>
              )}
              {backpackWeapons.length > 0 && (
                <div>
                  <div className="text-xs text-gray-400 mb-1">武器</div>
                  <div className="grid grid-cols-1 gap-2">
                    {backpackWeapons.map((it: EquipmentItem) => (
                      <button key={it.id} className="flex items-center justify-between bg-gray-800/50 border border-gray-700 hover:border-gray-500 rounded px-3 py-2 text-sm" onClick={() => applyEquip(it)}>
                        <div className="flex items-center gap-2">
                          {getIconPath(it) && (<img src={getIconPath(it) as string} alt={it.name} className="w-6 h-6 rounded object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />)}
                          <span className="text-gray-200">{it.name}</span>
                        </div>
                        <div className="text-xs text-gray-400 ml-2 truncate max-w-[13rem]">
                          {(() => {
                            const info = getWeaponGroupAndType(it.id);
                            const prof = isProficientWithWeaponId(it.id, character);
                            const groupLabel = info ? (info.group === 'simple' ? '简易' : '军用') : '';
                            const typeLabel = info ? (info.type === 'melee' ? '近战' : '远程') : '';
                            return (
                              <>
                                <span>{getEquipmentSummary(it, focusIds, lightSourceIds)}</span>
                                {info && <span> · {groupLabel}·{typeLabel}</span>}
                                <span className={prof ? 'text-green-400' : 'text-red-400'}> · {prof ? '熟练' : '未熟练'}</span>
                                {!prof && (
                                  <span className="ml-1 text-blue-300 border border-blue-500 rounded px-1 cursor-pointer" title="什么是熟练？" onClick={(e) => { e.stopPropagation?.(); setProfHelpType('weapon'); setProfHelpOpen(true); }}>?</span>
                                )}
                              </>
                            );
                          })()}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {backpackShield.length > 0 && (
                <div>
                  <div className="text-xs text-gray-400 mb-1">盾牌</div>
                  <div className="grid grid-cols-1 gap-2">
                    {backpackShield.map((it: EquipmentItem) => (
                      <button key={it.id} className="flex items-center justify-between bg-gray-800/50 border border-gray-700 hover:border-gray-500 rounded px-3 py-2 text-sm" onClick={() => applyEquip(it)}>
                        <div className="flex items-center gap-2">
                          {getIconPath(it) && (<img src={getIconPath(it) as string} alt={it.name} className="w-6 h-6 rounded object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />)}
                          <span className="text-gray-200">{it.name}</span>
                        </div>
                        <div className="text-xs text-gray-400 ml-2 truncate max-w-[13rem]">
                          {(() => {
                            const meta = findArmorMetaById(it.id);
                            const tierLabel = meta ? (meta.tier === 'light' ? '轻甲' : meta.tier === 'medium' ? '中甲' : meta.tier === 'heavy' ? '重甲' : '盾牌') : '';
                            const prof = isProficientWithArmorId(it.id, character);
                            return (
                              <>
                                <span>{getEquipmentSummary(it, focusIds, lightSourceIds)}</span>
                                {meta && <span> · {tierLabel}</span>}
                                <span className={prof ? 'text-green-400' : 'text-red-400'}> · {prof ? '熟练' : '未熟练'}</span>
                                {!prof && (
                                  <span className="ml-1 text-blue-300 border border-blue-500 rounded px-1 cursor-pointer" title="什么是熟练？" onClick={(e) => { e.stopPropagation?.(); setProfHelpType('armor'); setProfHelpOpen(true); }}>?</span>
                                )}
                              </>
                            );
                          })()}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {backpackOtherHandheld.length > 0 && (
                <div>
                  <div className="text-xs text-gray-400 mb-1">其他物品</div>
                  <div className="grid grid-cols-1 gap-2">
                    {backpackOtherHandheld.map((it: EquipmentItem) => (
                      <button key={it.id} className="flex items-center justify-between bg-gray-800/50 border border-gray-700 hover:border-gray-500 rounded px-3 py-2 text-sm" onClick={() => applyEquip(it)}>
                        <div className="flex items-center gap-2">
                          {getIconPath(it) && (<img src={getIconPath(it) as string} alt={it.name} className="w-6 h-6 rounded object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />)}
                          <span className="text-gray-200">{it.name}</span>
                        </div>
                        <div className="text-xs text-gray-400 ml-2 truncate max-w-[10rem]">{getEquipmentSummary(it, focusIds, lightSourceIds)}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {slot === "armor" && (
            <div className="space-y-3 max-h-80 overflow-auto pr-1">
              {[{list:backpackLightArmor,label:'轻甲'},{list:backpackMediumArmor,label:'中甲'},{list:backpackHeavyArmor,label:'重甲'}].map(({list,label}) => (
                list.length > 0 && (
                  <div key={label}>
                    <div className="text-xs text-gray-400 mb-1">{label}</div>
                    <div className="space-y-2">
                      {list.map((it: EquipmentItem) => (
                        <button key={it.id} className="flex items-center justify-between bg-gray-800/50 border border-gray-700 hover:border-gray-500 rounded px-3 py-2 text-sm" onClick={() => applyEquip(it)}>
                          <div className="flex items-center gap-2">
                            {getIconPath(it) && (<img src={getIconPath(it) as string} alt={it.name} className="w-6 h-6 rounded object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />)}
                            <span className="text-gray-200">{it.name}</span>
                          </div>
                          <div className="text-xs text-gray-400 ml-2 truncate max-w-[13rem]">
                            {(() => {
                              const meta = findArmorMetaById(it.id);
                              const tierLabel = meta ? (meta.tier === 'light' ? '轻甲' : meta.tier === 'medium' ? '中甲' : meta.tier === 'heavy' ? '重甲' : '盾牌') : '';
                              const prof = isProficientWithArmorId(it.id, character);
                              return (
                                <>
                                  <span>{getEquipmentSummary(it, focusIds, lightSourceIds)}</span>
                                  {meta && <span> · {tierLabel}</span>}
                                  <span className={prof ? 'text-green-400' : 'text-red-400'}> · {prof ? '熟练' : '未熟练'}</span>
                                  {!prof && (
                                    <span className="ml-1 text-blue-300 border border-blue-500 rounded px-1 cursor-pointer" title="什么是熟练？" onClick={(e) => { e.stopPropagation?.(); setProfHelpType('armor'); setProfHelpOpen(true); }}>?</span>
                                  )}
                                </>
                              );
                            })()}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )
              ))}
            </div>
          )}

          {/* 弹药槽位 */}
          {slot === "ammo" && (
            <div className="space-y-3 max-h-80 overflow-auto pr-1">
              {backpackAmmo.length > 0 ? (
                <div>
                  <div className="text-xs text-gray-400 mb-1">弹药</div>
                  <div className="grid grid-cols-1 gap-2">
                    {backpackAmmo.map((it: EquipmentItem, idx: number) => (
                      <button key={`${it.id}-${idx}`} className="flex items-center justify-between bg-gray-800/50 border border-gray-700 hover:border-gray-500 rounded px-3 py-2 text-sm" onClick={() => applyEquip(it)}>
                        <div className="flex items-center gap-2">
                          {getIconPath(it) && (<img src={getIconPath(it) as string} alt={it.name} className="w-6 h-6 rounded object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />)}
                          <span className="text-gray-200">{it.name}</span>
                          {(it.quantity || 1) > 1 && <span className="text-amber-400 text-xs">x{it.quantity}</span>}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-center text-gray-500 py-4">背包中没有弹药</div>
              )}
            </div>
          )}

          {/* 快捷物品槽位 */}
          {slot === "quick_item" && (
            <div className="space-y-3 max-h-80 overflow-auto pr-1">
              {backpackConsumables.length > 0 ? (
                <div>
                  <div className="text-xs text-gray-400 mb-1">消耗品</div>
                  <div className="grid grid-cols-1 gap-2">
                    {backpackConsumables.map((it: EquipmentItem, idx: number) => (
                      <button key={`${it.id}-${idx}`} className="flex items-center justify-between bg-gray-800/50 border border-gray-700 hover:border-gray-500 rounded px-3 py-2 text-sm" onClick={() => applyEquip(it)}>
                        <div className="flex items-center gap-2">
                          {getIconPath(it) && (<img src={getIconPath(it) as string} alt={it.name} className="w-6 h-6 rounded object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />)}
                          <span className="text-gray-200">{it.name}</span>
                          {(it.quantity || 1) > 1 && <span className="text-amber-400 text-xs">x{it.quantity}</span>}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-center text-gray-500 py-4">背包中没有消耗品</div>
              )}
            </div>
          )}

          {/* 衣物槽位 */}
          {slot === "clothing" && (
            <div className="space-y-3 max-h-80 overflow-auto pr-1">
              {backpackClothing.length > 0 ? (
                <div>
                  <div className="text-xs text-gray-400 mb-1">衣物</div>
                  <div className="grid grid-cols-1 gap-2">
                    {backpackClothing.map((it: EquipmentItem, idx: number) => (
                      <button key={`${it.id}-${idx}`} className="flex items-center justify-between bg-gray-800/50 border border-gray-700 hover:border-gray-500 rounded px-3 py-2 text-sm" onClick={() => applyEquip(it)}>
                        <div className="flex items-center gap-2">
                          {getIconPath(it) && (<img src={getIconPath(it) as string} alt={it.name} className="w-6 h-6 rounded object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />)}
                          <span className="text-gray-200">{it.name}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-center text-gray-500 py-4">背包中没有衣物</div>
              )}
            </div>
          )}

          {/* 首饰槽位 */}
          {slot === "accessory" && (
            <div className="space-y-3 max-h-80 overflow-auto pr-1">
              {backpackAccessory.length > 0 ? (
                <div>
                  <div className="text-xs text-gray-400 mb-1">首饰 / 配饰</div>
                  <div className="grid grid-cols-1 gap-2">
                    {backpackAccessory.map((it: EquipmentItem, idx: number) => (
                      <button key={`${it.id}-${idx}`} className="flex items-center justify-between bg-gray-800/50 border border-gray-700 hover:border-gray-500 rounded px-3 py-2 text-sm" onClick={() => applyEquip(it)}>
                        <div className="flex items-center gap-2">
                          {getIconPath(it) && (<img src={getIconPath(it) as string} alt={it.name} className="w-6 h-6 rounded object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />)}
                          <span className="text-gray-200">{it.name}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-center text-gray-500 py-4">背包中没有首饰或配饰</div>
              )}
            </div>
          )}

          <div className="text-right">
            <button className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm" onClick={() => onOpenChange(false)}>
              关闭
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
