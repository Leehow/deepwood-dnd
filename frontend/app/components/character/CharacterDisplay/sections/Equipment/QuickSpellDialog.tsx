import React, { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { getSpellSchoolConfig } from "~/components/ui/Rules_SpellDetail";
import { SpellDetailModal } from "~/components/spell/SpellSelectableCard";
import { getAssetUrl } from "~/utils/asset-url";

interface Spell {
  id: string;
  name: string;
  level?: number;
  iconPath?: string;
  school?: string;
  casting_time?: string;
  castingTime?: string;
  range?: string;
  duration?: string;
  components?: string[] | string;
  concentration?: boolean;
  description?: string;
  higher_levels?: string;
  higherLevels?: string;
  classes?: string[];
  [key: string]: any;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  slotIndex: number | null;
  spellsAll: Spell[];
  cantripsLocal: string[];
  preparedLocal: string[];
  quickSpells: (string | null)[];
  onSelectSpell: (slotIndex: number, spellId: string | null) => void;
}

// 获取法术简要参数
function getSpellSummary(spell: Spell): string {
  const parts: string[] = [];
  const castTime = spell.casting_time || spell.castingTime;
  if (castTime) parts.push(castTime);
  if (spell.range) parts.push(spell.range);
  if (spell.concentration) parts.push("专注");
  return parts.join(" · ") || "";
}

export function QuickSpellDialog({
  open,
  onOpenChange,
  slotIndex,
  spellsAll,
  cantripsLocal,
  preparedLocal,
  quickSpells,
  onSelectSpell,
}: Props) {
  const [detailSpell, setDetailSpell] = useState<Spell | null>(null);

  useEffect(() => {
    if (!open) setDetailSpell(null);
  }, [open]);

  if (slotIndex === null) return null;

  const currentSpellId = quickSpells[slotIndex];

  // 获取可用法术（戏法 + 准备的法术）
  const availableSpellIds = [...new Set([...cantripsLocal, ...preparedLocal])];
  const availableSpells = availableSpellIds
    .map(id => spellsAll.find(s => s.id === id))
    .filter((s): s is Spell => !!s);

  // 分组：戏法和已准备法术
  const cantrips = availableSpells.filter(s => cantripsLocal.includes(s.id));
  const prepared = availableSpells.filter(s => !cantripsLocal.includes(s.id));

  const handleSelect = (spellId: string) => {
    onSelectSpell(slotIndex, spellId);
    onOpenChange(false);
  };

  const handleClear = () => {
    onSelectSpell(slotIndex, null);
    onOpenChange(false);
  };

  const handleShowDetail = (e: React.MouseEvent, spell: Spell) => {
    e.stopPropagation();
    setDetailSpell(spell);
  };

  const handleDialogOpenChange = (v: boolean) => {
    if (!v) setDetailSpell(null);
    onOpenChange(v);
  };

  // 渲染法术项
  const renderSpellItem = (spell: Spell, isCantrip: boolean) => {
    const schoolConfig = getSpellSchoolConfig(spell.school || "");
    const summary = getSpellSummary(spell);
    const isSelected = currentSpellId === spell.id;
    const borderColor = isCantrip
      ? isSelected ? 'border-violet-500 bg-violet-900/30' : 'border-gray-700 hover:border-violet-500/50'
      : isSelected ? 'border-blue-500 bg-blue-900/30' : 'border-gray-700 hover:border-blue-500/50';

    return (
      <div
        key={spell.id}
        className={`flex items-start gap-2 bg-gray-800/50 border rounded px-3 py-2 text-sm transition-colors ${borderColor}`}
      >
        {spell.iconPath && (
          <img
            src={getAssetUrl(spell.iconPath.replace(/^\//, ''))}
            alt={spell.name}
            className="w-10 h-10 rounded object-cover flex-shrink-0"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-gray-200 font-medium">{spell.name}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${schoolConfig.bgColor} ${schoolConfig.color}`}>
              {isCantrip ? '戏法' : `${spell.level}环`} · {schoolConfig.name}
            </span>
          </div>
          {summary && (
            <div className="text-[10px] text-gray-400 mt-0.5 truncate">{summary}</div>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            type="button"
            className="px-2 py-1 text-[10px] text-gray-400 hover:text-gray-200 border border-gray-600 hover:border-gray-500 rounded"
            onClick={(e) => handleShowDetail(e, spell)}
          >
            详情
          </button>
          <button
            type="button"
            className={`px-2 py-1 text-[10px] rounded ${
              isSelected
                ? 'bg-green-600 text-white'
                : 'bg-gray-700 hover:bg-gray-600 text-gray-200'
            }`}
            onClick={() => handleSelect(spell.id)}
          >
            {isSelected ? '已选' : '选择'}
          </button>
        </div>
      </div>
    );
  };

  return (
    <>
      <Dialog.Root open={open} onOpenChange={handleDialogOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/50 z-[10198]" />
          <Dialog.Content
            aria-describedby={undefined}
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[92vw] max-w-lg bg-gray-900 border border-gray-700 rounded p-4 space-y-3 z-[10200]"
          >
            <div className="flex items-center justify-between">
              <Dialog.Title className="text-sm font-semibold text-gray-300">
                选择快捷法术 {slotIndex + 1}
              </Dialog.Title>
              <div className="flex items-center gap-2">
                {currentSpellId && (
                  <button
                    className="px-2 py-1 text-xs bg-red-900/30 hover:bg-red-900/50 text-red-300 border border-red-700 rounded"
                    onClick={handleClear}
                  >
                    清除
                  </button>
                )}
                <Dialog.Close className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg bg-gray-700/50 hover:bg-gray-600/50 text-gray-400 hover:text-white transition-colors">
                  ✕
                </Dialog.Close>
              </div>
            </div>

            <div className="space-y-3 max-h-[50dvh] overflow-auto pr-1">
              {/* 戏法 */}
              {cantrips.length > 0 && (
                <div>
                  <div className="text-xs text-violet-400 mb-1.5 font-medium">戏法（无限次）</div>
                  <div className="space-y-1.5">
                    {cantrips.map((spell) => renderSpellItem(spell, true))}
                  </div>
                </div>
              )}

              {/* 已准备法术 */}
              {prepared.length > 0 && (
                <div>
                  <div className="text-xs text-blue-400 mb-1.5 font-medium">已准备法术</div>
                  <div className="space-y-1.5">
                    {prepared.map((spell) => renderSpellItem(spell, false))}
                  </div>
                </div>
              )}

              {availableSpells.length === 0 && (
                <div className="text-center text-gray-500 py-4">
                  没有可用的法术
                </div>
              )}
            </div>

            <div className="text-right">
              <button
                className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm"
                onClick={() => onOpenChange(false)}
              >
                关闭
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <SpellDetailModal spell={detailSpell as any} onClose={() => setDetailSpell(null)} />
    </>
  );
}
