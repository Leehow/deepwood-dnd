import React, { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { getIconPath, findWeaponMetaById, findArmorMetaById, findAnyMetaByKey, findWeaponMetaByKey, findArmorMetaByKey } from "../../utils/rules";
import { getWeaponGroupAndType } from "../../utils/rules";
import { getArmorACDisplay } from "../../utils/equipment";
import { isProficientWithWeaponId, isProficientWithArmorId } from "../../utils/proficiency";
import { formatWeaponProperty } from "../../utils/formatting";
import { tDamageType, tWeaponPropertyDesc } from "~/utils/i18n";
import { getConsumableData, getConsumableEffectPreview } from "../../utils/consumableUtils";
import { ItemEditModal } from "./ItemEditModal";
import type { EquipmentItem, Character } from "../../types/Character";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  item: EquipmentItem | null;
  onUseConsumable?: (item: EquipmentItem) => Promise<void>;
  onWritePaper?: (item: EquipmentItem) => void;
  isPaperItem?: boolean;
  character?: Character;
  isDM?: boolean;
  onAvatarGenerated?: (item: EquipmentItem, avatarUrl: string, avatarUrlLarge?: string) => void;
  /** Optional extra action buttons rendered at the bottom */
  renderActions?: (item: EquipmentItem) => React.ReactNode;
  /** DM can edit custom items - called with updated item */
  onItemUpdate?: (updatedItem: EquipmentItem) => void;
}

const API_BASE = typeof window !== 'undefined' ? (import.meta.env.VITE_API_URL || '') : '';

/** Pure item info modal - only shows details, no actions */
export function ItemInfoModal({ open, onOpenChange, item, onUseConsumable, onWritePaper, isPaperItem, character, isDM, onAvatarGenerated, renderActions, onItemUpdate }: Props) {
  const it = item;
  const [expandedTip, setExpandedTip] = useState<string | null>(null);
  const [isGeneratingAvatar, setIsGeneratingAvatar] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  if (!it) return null;

  const iconPath = getIconPath(it);

  const handleGenerateAvatar = async () => {
    if (isGeneratingAvatar || !character?.id) return;
    setIsGeneratingAvatar(true);
    try {
      const resp = await fetch(`${API_BASE}/api/characters/${character.id}/equipment-avatar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item_id: it.id,
          item_name: it.name,
          item_description: description || it.description || undefined,
          library_item_id: typeof it.libraryItemId === 'number' ? it.libraryItemId : undefined,
        }),
      });
      if (!resp.ok) throw new Error('生成失败');
      const data = await resp.json();
      if (data.avatar_url && onAvatarGenerated) {
        onAvatarGenerated(it, data.avatar_url, data.avatar_url_large);
      }
    } catch { /* ignore */ }
    finally { setIsGeneratingAvatar(false); }
  };

  const wmeta = findWeaponMetaById(it.id) || findWeaponMetaByKey(it.id) || (it.name ? findWeaponMetaByKey(it.name) : null);
  const ameta = findArmorMetaById(it.id) || findArmorMetaByKey(it.id) || (it.name ? findArmorMetaByKey(it.name) : null);
  const meta = findAnyMetaByKey(it.id) || (it.name ? findAnyMetaByKey(it.name) : null);

  const costCopper: number | undefined = (meta as any)?.costCopper;
  const weight: number | undefined = (meta as any)?.weight ?? it.weight;
  const rawDmg = (meta as any)?.damage ?? it.damage;
  // Normalize damage: extract dice string from object format {"dice":"1d6","type":"slashing"}
  const dmg = rawDmg && typeof rawDmg === 'object' && rawDmg.dice ? rawDmg.dice
    : typeof rawDmg === 'string' && rawDmg !== '[object Object]' ? rawDmg : null;
  const versatileDmg = (meta as any)?.versatileDamage;
  // Extract damageType from damage object or fallback to item field
  const dmgType = (meta as any)?.damageType ?? (rawDmg && typeof rawDmg === 'object' ? rawDmg.type : null) ?? it.damageType;
  const range = (meta as any)?.range ?? it.range ?? (() => {
    // Fallback: if weapon has range/ammunition property, try to extract from description
    const props: string[] = it.properties || [];
    const hasRangeProp = props.some((p: string) => p.toLowerCase() === 'range' || p.toLowerCase() === 'ammunition');
    if (!hasRangeProp) return undefined;
    const desc = it.description || '';
    const m = desc.match(/射程[为是]?\s*(\d+)\s*[/／]\s*(\d+)/);
    if (m) return { normal: parseInt(m[1], 10), long: parseInt(m[2], 10) };
    return undefined;
  })();
  const rawAc = (meta as any)?.ac ?? it.ac;
  // Normalize AC: could be number, string, or object like {base: 14, dex_bonus: true}
  const ac = rawAc && typeof rawAc === 'object'
    ? `${rawAc.base ?? '?'}${rawAc.dex_bonus === true ? ' + DEX' : rawAc.dex_bonus === 'max2' ? ' + DEX(≤+2)' : ''}`
    : rawAc;
  const acFormula = (meta as any)?.acFormula;
  const strReq = (meta as any)?.strengthRequired ?? it.strengthRequired;
  const stealthDis = (meta as any)?.stealthDisadvantage ?? it.stealthDisadvantage;
  const description = (meta as any)?.description ?? it.description;

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
    <Dialog.Root open={open} onOpenChange={(v) => { setExpandedTip(null); onOpenChange(v); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-[10198]" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[90vw] max-w-sm bg-gray-900 border border-gray-700 rounded-lg p-4 space-y-3 z-[10200] max-h-[85vh] overflow-y-auto"
          onClick={(e) => { if ((e.target as HTMLElement).closest('[data-tip]') === null) setExpandedTip(null); }}
        >
          {/* Header */}
          <div className="flex items-start gap-3">
            <div className="relative flex-shrink-0">
              {iconPath ? (
                <img
                  src={iconPath as string}
                  alt={it.name}
                  className="w-14 h-14 rounded-lg object-cover border border-gray-600"
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                />
              ) : (
                <div className="w-14 h-14 rounded-lg bg-gray-800 border border-gray-600 flex items-center justify-center text-gray-500 text-xl">?</div>
              )}
              {isDM && onAvatarGenerated && (
                <button
                  className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-purple-600 hover:bg-purple-500 text-white text-xs flex items-center justify-center transition-colors disabled:opacity-50"
                  title={iconPath ? '重新生成头像' : '生成头像'}
                  disabled={isGeneratingAvatar}
                  onClick={handleGenerateAvatar}
                >
                  {isGeneratingAvatar ? <span className="animate-spin">⏳</span> : '🎨'}
                </button>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <Dialog.Title className="text-base font-semibold text-gray-100 truncate">
                {it.name || it.id}
              </Dialog.Title>
              <div className="text-sm text-gray-400 flex items-center gap-2">
                <span>x{it.quantity || 1}</span>
                {isDM && onItemUpdate && (
                  <button
                    className="px-1.5 py-0.5 text-[11px] bg-gray-700 hover:bg-gray-600 text-gray-300 rounded border border-gray-600 transition-colors"
                    onClick={() => setEditOpen(true)}
                  >
                    编辑
                  </button>
                )}
              </div>
            </div>
            <Dialog.Close className="w-7 h-7 flex items-center justify-center rounded bg-gray-700/50 hover:bg-gray-600/50 text-gray-400 hover:text-white transition-colors">
              ✕
            </Dialog.Close>
          </div>

          {/* Weapon Info */}
          {(() => {
            const wpProps = wmeta?.properties || it.properties;
            const isWeapon = wmeta || it.category === 'weapon' || it.equipmentType === 'weapon' || dmg;
            if (!isWeapon) return null;
            const info = wmeta ? (getWeaponGroupAndType(it.id) || getWeaponGroupAndType((wmeta as any).id)) : null;
            const prof = character && wmeta ? isProficientWithWeaponId(it.id, character) : null;
            return (
              <div className="p-2.5 bg-gray-800/60 border border-gray-700 rounded-lg text-sm">
                <div className="text-gray-200 mb-1.5 flex items-center gap-2">
                  <span>{info ? `${info.group === 'simple' ? '简易' : '军用'} · ${info.type === 'melee' ? '近战' : '远程'}` : '武器'}</span>
                  {prof !== null && <span className={prof ? 'text-green-400' : 'text-red-400'}>{prof ? '熟练' : '未熟练'}</span>}
                  {(it as any).rarity && <span className="text-amber-400 text-xs">{({ common: '普通', uncommon: '非凡', rare: '稀有', 'very rare': '非常稀有', 'very_rare': '非常稀有', legendary: '传说', artifact: '神器' } as Record<string, string>)[(it as any).rarity?.toLowerCase()] || (it as any).rarity}</span>}
                  {(it as any).magic_bonus != null && <span className="text-purple-400">+{(it as any).magic_bonus}</span>}
                </div>
                {wpProps && wpProps.length > 0 && (
                  <div className="text-xs text-gray-400 flex flex-wrap gap-1.5">
                    {wpProps.map((p: string) => {
                      const desc = tWeaponPropertyDesc(p);
                      const hasDesc = desc !== p;
                      const isExpanded = expandedTip === `prop-${p}`;
                      return (
                        <span key={p} className="relative" data-tip>
                          <span
                            data-tip
                            className={`inline-flex items-center gap-1 px-1.5 py-0.5 bg-gray-700/60 rounded ${hasDesc ? 'cursor-pointer hover:bg-gray-600/60' : ''}`}
                            onClick={() => hasDesc && setExpandedTip(isExpanded ? null : `prop-${p}`)}
                          >
                            {formatWeaponProperty(p)}
                            {hasDesc && (
                              <svg className="w-3 h-3 text-gray-500 flex-shrink-0" viewBox="0 0 16 16" fill="currentColor">
                                <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 2.5a1 1 0 110 2 1 1 0 010-2zM6.5 7h2v4.5h-2V7z" />
                              </svg>
                            )}
                          </span>
                          {isExpanded && (
                            <span className="absolute z-10 left-0 top-full mt-1 w-48 p-2 bg-gray-800 border border-gray-600 rounded-lg text-xs text-gray-300 shadow-lg">
                              {desc}
                            </span>
                          )}
                        </span>
                      );
                    })}
                  </div>
                )}
                {(it as any).extra_damage && (
                  <div className="text-xs text-amber-400 mt-1">额外伤害：{(it as any).extra_damage.dice} {tDamageType((it as any).extra_damage.type)}</div>
                )}
              </div>
            );
          })()}

          {/* Armor Info */}
          {(() => {
            const isArmor = ameta || it.category === 'armor' || it.equipmentType === 'armor';
            if (!isArmor) return null;
            const prof = character && ameta ? isProficientWithArmorId(it.id, character) : null;
            return (
              <div className="p-2.5 bg-gray-800/60 border border-gray-700 rounded-lg text-sm">
                <div className="text-gray-200 mb-1 flex items-center gap-2">
                  <span>{ameta ? (ameta.tier === 'light' ? '轻甲' : ameta.tier === 'medium' ? '中甲' : ameta.tier === 'heavy' ? '重甲' : '盾牌') : '护甲'}</span>
                  {prof !== null && <span className={prof ? 'text-green-400' : 'text-red-400'}>{prof ? '熟练' : '未熟练'}</span>}
                  {(it as any).rarity && !dmg && <span className="text-amber-400 text-xs">{({ common: '普通', uncommon: '非凡', rare: '稀有', 'very rare': '非常稀有', 'very_rare': '非常稀有', legendary: '传说', artifact: '神器' } as Record<string, string>)[(it as any).rarity?.toLowerCase()] || (it as any).rarity}</span>}
                </div>
                <div className="text-xs text-gray-400">AC：{ameta ? getArmorACDisplay(it.id) : (ac || '?')}</div>
                {(it as any).magic_bonus != null && <div className="text-xs text-purple-400 mt-0.5">魔法加值：+{(it as any).magic_bonus}</div>}
              </div>
            );
          })()}

          {/* Stats */}
          {(meta || dmg || dmgType || range || weight !== undefined || ac) && (
            <div className="space-y-2">
              {/* Price & Weight */}
              {(costCopper !== undefined || weight !== undefined) && (
                <div className="flex items-center gap-4 text-sm text-gray-400">
                  {costCopper !== undefined && (
                    <div className="flex items-center gap-1">
                      <span className="text-amber-400">$</span>
                      <span>{formatCost(costCopper)}</span>
                    </div>
                  )}
                  {weight !== undefined && (
                    <div className="flex items-center gap-1">
                      <span className="text-gray-500">⚖</span>
                      <span>{weight} lb</span>
                    </div>
                  )}
                </div>
              )}

              {/* Damage & Range */}
              {(dmg || dmgType || range) && (
                <div className="flex flex-wrap gap-3 text-sm text-gray-400">
                  {dmg && <span>伤害：<span className="text-red-400">{typeof dmg === 'string' ? dmg : dmg?.dice}{versatileDmg ? ` / ${versatileDmg}` : ''}</span>{versatileDmg ? <span className="text-gray-500 text-xs ml-1">(单手/双手)</span> : null}</span>}
                  {dmgType && <span>类型：{tDamageType(dmgType)}</span>}
                  {range && (() => {
                    const isExpanded = expandedTip === 'range';
                    return (
                      <span className="relative" data-tip>
                        <span
                          data-tip
                          className="inline-flex items-center gap-1 cursor-pointer hover:text-gray-300"
                          onClick={() => setExpandedTip(isExpanded ? null : 'range')}
                        >
                          {wmeta?.properties?.some((p: string) => p === 'thrown' || p.includes('投掷')) ? '投掷射程' : '射程'}：{formatRange(range)}
                          <svg className="w-3 h-3 text-gray-500 flex-shrink-0" viewBox="0 0 16 16" fill="currentColor">
                            <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 2.5a1 1 0 110 2 1 1 0 010-2zM6.5 7h2v4.5h-2V7z" />
                          </svg>
                        </span>
                        {isExpanded && (
                          <span className="absolute z-10 right-0 top-full mt-1 w-56 max-w-[calc(90vw-3rem)] p-2 bg-gray-800 border border-gray-600 rounded-lg text-xs text-gray-300 shadow-lg">
                            前一个数字为常规射程，后一个为最大射程。常规射程内正常攻击；超出常规但在最大射程内攻击有劣势；超出最大射程无法攻击。
                          </span>
                        )}
                      </span>
                    );
                  })()}
                </div>
              )}

              {/* AC */}
              {(ac || acFormula || strReq || stealthDis !== undefined) && (
                <div className="flex flex-wrap gap-3 text-sm text-gray-400">
                  {ac && <span>AC：<span className="text-blue-400">{ac}</span></span>}
                  {acFormula && <span>{acFormula.base}{acFormula.dexModifier === 'full' ? ' + DEX' : acFormula.dexModifier === 'max2' ? ' + DEX(≤+2)' : ''}</span>}
                  {strReq && <span>力量要求：{strReq}</span>}
                  {stealthDis !== undefined && <span className={stealthDis ? 'text-red-400' : ''}>潜行劣势：{stealthDis ? '是' : '否'}</span>}
                </div>
              )}
            </div>
          )}

          {/* Attunement */}
          {(it as any).requires_attunement && (
            <div className="relative" data-tip>
              <div
                className="flex items-center gap-1.5 text-sm text-purple-300 cursor-pointer hover:text-purple-200"
                onClick={() => setExpandedTip(expandedTip === 'attunement' ? null : 'attunement')}
              >
                <span>需要同调</span>
                {(it as any).attunement_by && <span className="text-gray-400">（{(it as any).attunement_by}）</span>}
                <svg className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 2.5a1 1 0 110 2 1 1 0 010-2zM6.5 7h2v4.5h-2V7z" />
                </svg>
              </div>
              {expandedTip === 'attunement' && (
                <div className="mt-1.5 p-2.5 bg-gray-800 border border-gray-600 rounded-lg text-xs text-gray-300 leading-relaxed space-y-1.5">
                  <div className="text-purple-300 font-medium">同调（Attunement）</div>
                  <div>某些魔法物品需要角色与之建立特殊连接才能使用其魔法属性。这个过程称为同调。</div>
                  <div>同调需要在短休期间花费时间专注于该物品（至少1小时），保持身体接触。</div>
                  <div>一个角色同时最多只能与 <span className="text-amber-400">3件</span> 物品保持同调。</div>
                  <div>若未同调便装备该物品，则只能获得其非魔法效果（如基础AC），无法使用魔法特性。</div>
                </div>
              )}
            </div>
          )}

          {/* Charges */}
          {(() => {
            const charges = (it as any).charges;
            if (!charges || !charges.max) return null;
            return (
              <div className="p-2.5 bg-indigo-900/20 border border-indigo-700/40 rounded-lg text-sm space-y-1">
                <div className="text-indigo-300">充能：{charges.current ?? charges.max} / {charges.max}</div>
                {charges.recharge && <div className="text-xs text-gray-400">恢复：{charges.recharge_time || '黎明'} 恢复 {charges.recharge_amount || charges.recharge}</div>}
                {charges.on_zero && <div className="text-xs text-gray-400">耗尽：{charges.on_zero === 'destroy' ? '物品销毁' : charges.on_zero === 'nothing' ? '无效果' : charges.on_zero}</div>}
              </div>
            );
          })()}

          {/* Abilities */}
          {(() => {
            const abilities: any[] = (it as any).abilities;
            if (!abilities || abilities.length === 0) return null;
            const typeMap: Record<string, string> = { passive: '被动', active: '主动', rechargeable: '充能', triggered: '触发' };
            return (
              <div className="p-2.5 bg-amber-900/15 border border-amber-700/40 rounded-lg text-sm space-y-2">
                <div className="text-amber-300 font-medium text-xs">特殊能力</div>
                {abilities.map((ab: any, i: number) => (
                  <div key={i} className="space-y-0.5">
                    <div className="text-gray-200 flex items-center gap-1.5">
                      <span>{ab.name}</span>
                      {ab.type && <span className="text-xs text-gray-500">({typeMap[ab.type] || ab.type})</span>}
                      {ab.uses_per_day && <span className="text-xs text-gray-500">{ab.uses_per_day}次/天</span>}
                    </div>
                    {ab.description && <div className="text-xs text-gray-400 whitespace-pre-line">{ab.description}</div>}
                  </div>
                ))}
              </div>
            );
          })()}

          {/* Item Spells */}
          {(() => {
            const spells: any[] = (it as any).item_spells;
            if (!spells || spells.length === 0) return null;
            return (
              <div className="p-2.5 bg-blue-900/15 border border-blue-700/40 rounded-lg text-sm space-y-1.5">
                <div className="text-blue-300 font-medium text-xs">内含法术</div>
                {spells.map((sp: any, i: number) => (
                  <div key={i} className="text-gray-300 flex items-center gap-2 text-xs">
                    <span>{sp.name || sp.spell_name}</span>
                    {sp.level != null && <span className="text-gray-500">{sp.level}环</span>}
                    {sp.charges_cost && <span className="text-gray-500">消耗{sp.charges_cost}充能</span>}
                    {sp.save_dc && <span className="text-gray-500">DC {sp.save_dc}</span>}
                  </div>
                ))}
              </div>
            );
          })()}

          {/* Description */}
          {description && (
            <div className="p-2.5 bg-gray-800/40 border border-gray-700/50 rounded-lg">
              <div className="text-sm text-gray-300 leading-relaxed whitespace-pre-line">
                {description}
              </div>
            </div>
          )}

          {/* No description fallback */}
          {!description && !meta && (
            <div className="text-sm text-gray-500 text-center py-2">
              暂无物品详情
            </div>
          )}

          {/* Consumable section */}
          {(() => {
            const consumable = getConsumableData(it);
            if (!consumable) return null;
            const preview = getConsumableEffectPreview(consumable);
            return (
              <div className="p-2.5 bg-green-900/20 border border-green-700/50 rounded-lg space-y-2">
                <div className="text-sm text-green-300">{preview}</div>
                {onUseConsumable && (
                  <button
                    className="w-full px-3 py-1.5 bg-green-600 hover:bg-green-500 text-white text-sm rounded transition-colors"
                    onClick={() => { onUseConsumable(it); onOpenChange(false); }}
                  >
                    使用
                  </button>
                )}
              </div>
            );
          })()}

          {/* Write on paper button */}
          {isPaperItem && !it.writtenContent && onWritePaper && (
            <button
              className="w-full px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white text-sm rounded transition-colors flex items-center justify-center gap-1.5"
              onClick={() => { onWritePaper(it); onOpenChange(false); }}
            >
              <span>✏️</span> 书写
            </button>
          )}

          {/* Extra action buttons */}
          {renderActions && renderActions(it)}

          {/* Edit modal for DM */}
          {isDM && onItemUpdate && (
            <ItemEditModal
              open={editOpen}
              onOpenChange={setEditOpen}
              item={it}
              onSave={(updated) => { onItemUpdate(updated); }}
            />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
