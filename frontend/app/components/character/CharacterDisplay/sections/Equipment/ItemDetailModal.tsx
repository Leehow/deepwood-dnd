import React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { getIconPath, findWeaponMetaById, findArmorMetaById, findAnyMetaByKey, findWeaponMetaByKey, findArmorMetaByKey } from "../../utils/rules";
import { getWeaponGroupAndType } from "../../utils/rules";
import { getArmorACDisplay } from "../../utils/equipment";
import { isProficientWithWeaponId, isProficientWithArmorId } from "../../utils/proficiency";
import { formatWeaponProperty } from "../../utils/formatting";
import { useCharacterContext } from "../../context/CharacterContext";
import { tDamageType } from "~/utils/i18n";
import type { EquipmentItem } from "../../types/Character";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  selectedItem: EquipmentItem | null;
  setProfHelpType: (t: "weapon" | "armor") => void;
  setProfHelpOpen: (v: boolean) => void;
  organizedPacks: EquipmentItem[];
  organizeLoading: boolean;
  handleOrganizePack: () => Promise<void>;
  handleExtractFromPack: (extractedItem: EquipmentItem) => void;
  splitQty: number;
  setSplitQty: (n: number) => void;
  handleSplitStack: () => Promise<void>;
  splitLoading: boolean;
  handleMergeStacks: () => Promise<void>;
  mergeLoading: boolean;
  discardQuantity: number;
  setDiscardQuantity: (n: number) => void;
  hasTokenOnMap: boolean;
  discardLoading: boolean;
  handleDiscardItem: () => Promise<void>;
  currentMapUrl: string | null;
}

export function ItemDetailModal({ open, onOpenChange, selectedItem, setProfHelpType, setProfHelpOpen, organizedPacks, organizeLoading, handleOrganizePack, handleExtractFromPack, splitQty, setSplitQty, handleSplitStack, splitLoading, handleMergeStacks, mergeLoading, discardQuantity, setDiscardQuantity, hasTokenOnMap, discardLoading, handleDiscardItem, currentMapUrl }: Props) {
  const { character } = useCharacterContext();
  const it = selectedItem;
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-[10198]" />
        <Dialog.Content aria-describedby={undefined} className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[92vw] max-w-lg bg-gray-900 border border-gray-700 rounded p-4 space-y-4 z-[10200]">
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-sm font-semibold text-gray-300">
              {it?.name || it?.id || ""}
            </Dialog.Title>
            <Dialog.Close className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg bg-gray-700/50 hover:bg-gray-600/50 text-gray-400 hover:text-white transition-colors">
              ✕
            </Dialog.Close>
          </div>

          {it && (
            <div className="flex items-start gap-3">
              {getIconPath(it) && (
                <img src={getIconPath(it) as string} alt={it.name} className="w-12 h-12 rounded object-cover" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
              )}
              <div className="text-sm text-gray-300">
                <div className="text-gray-200 font-medium">{it.name || it.id}</div>
                <div className="text-xs text-gray-400">x{it.quantity || 1}</div>
              </div>
            </div>
          )}

          {it && (
            <div className="space-y-2">
              {(() => {
                const wmeta = findWeaponMetaById(it.id) || findWeaponMetaByKey(it.id) || (it.name ? findWeaponMetaByKey(it.name) : null);
                if (wmeta) {
                  const info = getWeaponGroupAndType(it.id) || getWeaponGroupAndType((wmeta as any).id);
                  const prof = isProficientWithWeaponId(it.id, character);
                  return (
                    <div className="p-2 bg-gray-800/40 border border-gray-700 rounded text-sm">
                      <div className="text-gray-200 mb-1">
                        {info ? `${info.group === 'simple' ? '简易' : '军用'} · ${info.type === 'melee' ? '近战' : '远程'}` : '武器'}
                        <span className={prof ? 'ml-2 text-green-400' : 'ml-2 text-red-400'}>{prof ? '· 熟练' : '· 未熟练'}</span>
                        {!prof && (
                          <span className="ml-1 text-blue-300 border border-blue-500 rounded px-1 cursor-pointer" title="什么是熟练？" onClick={() => { setProfHelpType('weapon'); setProfHelpOpen(true); }}>?</span>
                        )}
                      </div>
                      {wmeta.properties && wmeta.properties.length > 0 && (
                        <div className="text-xs text-gray-400 flex flex-wrap gap-2">
                          {wmeta.properties.map((p: string) => (
                            <span key={p} className="px-1 py-0.5 bg-gray-700/60 rounded">
                              {formatWeaponProperty(p)}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                }
                const ameta = findArmorMetaById(it.id) || findArmorMetaByKey(it.id) || (it.name ? findArmorMetaByKey(it.name) : null);
                if (ameta) {
                  const prof = isProficientWithArmorId(it.id, character);
                  return (
                    <div className="p-2 bg-gray-800/40 border border-gray-700 rounded text-sm">
                      <div className="text-gray-200 mb-1">
                        {ameta.tier === 'light' ? '轻甲' : ameta.tier === 'medium' ? '中甲' : ameta.tier === 'heavy' ? '重甲' : '盾牌'}
                        <span className={prof ? 'ml-2 text-green-400' : 'ml-2 text-red-400'}>{prof ? '· 熟练' : '· 未熟练'}</span>
                        {!prof && (
                          <span className="ml-1 text-blue-300 border border-blue-500 rounded px-1 cursor-pointer" title="什么是熟练？" onClick={() => { setProfHelpType('armor'); setProfHelpOpen(true); }}>?</span>
                        )}
                      </div>
                      <div className="text-xs text-gray-400">
                        AC：{getArmorACDisplay(it.id)}
                      </div>
                    </div>
                  );
                }
                return null;
              })()}
            </div>
          )}

          {it && (() => {
            const meta = findAnyMetaByKey(it.id) || (it.name ? findAnyMetaByKey(it.name) : null);
            if (!meta) return null;
            const costCopper: number | undefined = (meta as any).costCopper;
            const weight: number | undefined = (meta as any).weight;
            const dmg = (meta as any).damage;
            const versatileDmg = (meta as any).versatileDamage;
            const dmgType = (meta as any).damageType;
            const range = (meta as any).range;
            const ac = (meta as any).ac;
            const acFormula = (meta as any).acFormula;
            const strReq = (meta as any).strengthRequired;
            const stealthDis = (meta as any).stealthDisadvantage;
            const description = (meta as any).description;

            const formatCost = (cp?: number) => {
              if (!cp && cp !== 0) return null;
              const gp = Math.floor(cp / 100);
              const sp = Math.floor((cp % 100) / 10);
              const rcp = cp % 10;
              const parts: string[] = [];
              if (gp) parts.push(`${gp} gp`);
              if (sp) parts.push(`${sp} sp`);
              if (rcp || parts.length === 0) parts.push(`${rcp} cp`);
              return parts.join(' ');
            };

            const formatRange = (r: any) => {
              if (!r) return null;
              if (typeof r === 'string') return r;
              if (typeof r.normal === 'number') return `${r.normal}/${r.long ?? r.normal}`;
              return null;
            };

            return (
              <div className="p-2 bg-gray-800/30 border border-gray-700 rounded space-y-1">
                <div className="text-sm text-gray-300 font-semibold">物品详情</div>
                {description && (
                  <div className="text-xs text-gray-300 whitespace-pre-line">{description}</div>
                )}
                {(costCopper !== undefined || weight !== undefined) && (
                  <div className="text-xs text-gray-400">
                    {costCopper !== undefined && <span className="mr-3">价格：{formatCost(costCopper)}</span>}
                    {weight !== undefined && <span>重量：{weight} lb</span>}
                  </div>
                )}
                {(dmg || dmgType || range) && (
                  <div className="text-xs text-gray-400">
                    {dmg && <span className="mr-3">伤害：{typeof dmg === 'string' ? dmg : dmg?.dice}{versatileDmg ? ` / ${versatileDmg}` : ''}{versatileDmg ? ' (单手/双手)' : ''}</span>}
                    {dmgType && <span className="mr-3">类型：{tDamageType(dmgType)}</span>}
                    {range && <span>{(meta as any).properties?.some((p: string) => p === 'thrown' || p.includes('投掷')) ? '投掷射程' : '射程'}：{formatRange(range)}</span>}
                  </div>
                )}
                {(ac || acFormula || strReq || stealthDis !== undefined) && (
                  <div className="text-xs text-gray-400">
                    {ac && <span className="mr-3">AC：{ac}</span>}
                    {acFormula && <span className="mr-3">公式：{acFormula.base}{acFormula.dexModifier === 'full' ? ' + DEX' : acFormula.dexModifier === 'max2' ? ' + DEX(≤+2)' : ''}</span>}
                    {strReq && <span className="mr-3">力量要求：{strReq}</span>}
                    {stealthDis !== undefined && <span>潜行劣势：{stealthDis ? '是' : '否'}</span>}
                  </div>
                )}
              </div>
            );
          })()}


          <div className="p-2 bg-gray-800/30 border border-gray-700 rounded space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-sm text-gray-300 font-semibold">整理背包套装</div>
              <button className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 border border-gray-600 rounded disabled:opacity-60" disabled={organizeLoading} onClick={handleOrganizePack}>
                {organizeLoading ? '整理中…' : '整理'}
              </button>
            </div>
            {organizedPacks && organizedPacks.length > 0 && (
              <div className="space-y-1">
                {organizedPacks.map((p: EquipmentItem, idx: number) => (
                  <div key={idx} className="flex items-center justify-between text-sm text-gray-200">
                    <div className="truncate mr-2">{p.name || `套装 ${idx+1}`}</div>
                    <button className="px-2 py-0.5 text-xs bg-gray-700 hover:bg-gray-600 rounded" onClick={() => handleExtractFromPack(p)}>
                      取出
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {it && (
            <div className="p-2 bg-gray-800/30 border border-gray-700 rounded space-y-2">
              <div className="text-sm text-gray-300 font-semibold">堆叠管理</div>
              <div className="flex items-center gap-2">
                <input type="number" className="w-20 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-gray-200" value={splitQty} onChange={(e) => setSplitQty(Math.max(1, Number(e.target.value || 1)))} />
                <button className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded disabled:opacity-60" disabled={splitLoading} onClick={handleSplitStack}>
                  {splitLoading ? '拆分中…' : '拆分'}
                </button>
                <button className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded disabled:opacity-60" disabled={mergeLoading} onClick={handleMergeStacks}>
                  {mergeLoading ? '合并中…' : '合并相同'}
                </button>
              </div>
            </div>
          )}

          {it && (
            <div className="p-2 bg-gray-800/30 border border-gray-700 rounded space-y-2">
              <div className="text-sm text-gray-300 font-semibold">丢弃</div>
              <div className="flex items-center gap-2">
                <input type="number" className="w-20 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm text-gray-200" value={discardQuantity} onChange={(e) => setDiscardQuantity(Math.max(1, Number(e.target.value || 1)))} />
                <button className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded disabled:opacity-60" disabled={discardLoading} onClick={handleDiscardItem}>
                  {discardLoading ? (hasTokenOnMap ? '放置中…' : '丢弃中…') : (hasTokenOnMap ? '丢弃到地图' : '丢弃')}
                </button>
              </div>
              {!hasTokenOnMap && (
                <div className="text-xs text-amber-300">
                  无当前地图或角色未在地图上，执行普通丢弃。
                </div>
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

