import React, { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import invocationsData from "~/data/rules/eldritch_invocations.json";
import { getAssetUrl } from "~/utils/asset-url";
import { spellDataLoader } from "~/services/spellDataLoader";

const INVOCATION_CATEGORY_FALLBACK: Record<string, { icon: string; bg: string; text: string }> = {
  combat:  { icon: '⚔', bg: 'bg-red-900/30 border-red-800/40', text: 'text-red-400' },
  utility: { icon: '◈', bg: 'bg-blue-900/30 border-blue-800/40', text: 'text-blue-400' },
  social:  { icon: '♦', bg: 'bg-purple-900/30 border-purple-800/40', text: 'text-purple-400' },
};

export function InvocationIcon({ inv, isOwned }: { inv: any; isOwned: boolean }) {
  const [imgErr, setImgErr] = useState(false);
  const gs = inv.grantedSpell;

  if (gs && !imgErr) {
    return (
      <img
        src={getAssetUrl(`assets/spell-icons/${gs.id}.png`)}
        alt=""
        className="w-7 h-7 rounded flex-shrink-0 object-cover mt-0.5"
        onError={() => setImgErr(true)}
      />
    );
  }

  const style = INVOCATION_CATEGORY_FALLBACK[inv.category] || INVOCATION_CATEGORY_FALLBACK.utility;
  return (
    <div className={`w-7 h-7 rounded flex-shrink-0 flex items-center justify-center mt-0.5
                     border ${style.bg} ${isOwned ? 'border-purple-500/50' : ''}`}>
      <span className={`text-sm ${style.text}`}>{style.icon}</span>
    </div>
  );
}

const categoryColors: Record<string, string> = {
  combat: 'text-red-400', utility: 'text-blue-400', social: 'text-purple-400',
};
const categoryIcons: Record<string, string> = {
  combat: '⚔️', utility: '🔧', social: '💬',
};
const pactBoonLabels: Record<string, string> = {
  blade: '魔刃契约', chain: '魔链契约', tome: '魔典契约',
};

export function InvocationEncyclopedia({ open, onOpenChange, selectedIds, onOpenSpell }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  selectedIds: string[];
  onOpenSpell?: (spellId: string) => void;
}) {
  const [category, setCategory] = useState<string>('all');
  const allInvocations = (invocationsData as any).invocations as any[];

  const filtered = (category === 'all'
    ? allInvocations
    : allInvocations.filter(inv => inv.category === category)
  ).sort((a, b) => (a.level || 2) - (b.level || 2));

  const categoryCount = {
    all: allInvocations.length,
    combat: allInvocations.filter(inv => inv.category === 'combat').length,
    utility: allInvocations.filter(inv => inv.category === 'utility').length,
    social: allInvocations.filter(inv => inv.category === 'social').length,
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal container={typeof document !== 'undefined' ? document.body : undefined}>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-[10198]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[94vw] max-w-2xl max-h-[85dvh] bg-gray-900 border border-purple-700/50 rounded-lg flex flex-col z-[10200] shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-gray-700/60 flex-shrink-0">
            <Dialog.Title className="text-sm font-semibold text-purple-300">
              魔能祈唤百科
            </Dialog.Title>
            <Dialog.Close className="w-8 h-8 flex items-center justify-center rounded bg-gray-700/50 hover:bg-gray-600/50 text-gray-400 hover:text-white transition-colors">
              ✕
            </Dialog.Close>
          </div>

          <div className="flex flex-wrap gap-1.5 px-4 py-2 border-b border-gray-800 flex-shrink-0">
            {[
              { id: 'all', name: '全部' },
              { id: 'combat', name: '战斗' },
              { id: 'utility', name: '实用' },
              { id: 'social', name: '社交' },
            ].map(cat => (
              <button
                key={cat.id}
                onClick={() => setCategory(cat.id)}
                className={`px-2.5 py-1 rounded text-xs transition-all ${
                  category === cat.id
                    ? 'bg-purple-500/30 border border-purple-400 text-purple-300'
                    : 'bg-gray-800 border border-gray-600 text-gray-400 hover:border-gray-500'
                }`}
              >
                {cat.name} ({categoryCount[cat.id as keyof typeof categoryCount]})
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
            {filtered.map((inv: any) => {
              const isOwned = selectedIds.includes(inv.id);
              const catColor = categoryColors[inv.category] || 'text-gray-400';
              const catIcon = categoryIcons[inv.category] || '✨';
              const gs = inv.grantedSpell;
              return (
                <div key={inv.id} className={`rounded-lg border p-3 ${isOwned ? 'border-purple-600/60 bg-purple-900/15' : 'border-gray-700/60 bg-gray-800/30'}`}>
                  <div className="flex items-start gap-2">
                    <InvocationIcon inv={inv} isOwned={isOwned} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-1.5 flex-wrap">
                        <span className={`text-sm font-medium ${isOwned ? 'text-purple-200' : 'text-gray-200'}`}>
                          {isOwned && '✦ '}{inv.name}
                        </span>
                        <span className="text-[10px] text-gray-500">{inv.nameEn}</span>
                        <span className={`text-[10px] ${catColor}`}>{catIcon}</span>
                      </div>
                      <div className="flex flex-wrap gap-1 mt-1">
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-900/30 text-cyan-400 border border-cyan-800/40">
                          {(inv.level || 2)}级+
                        </span>
                        {inv.prerequisite?.cantrip && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-900/20 text-orange-400 border border-orange-800/40">
                            需要：魔能爆
                          </span>
                        )}
                        {inv.prerequisite?.pactBoon && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-900/20 text-orange-400 border border-orange-800/40">
                            需要：{pactBoonLabels[inv.prerequisite.pactBoon] || inv.prerequisite.pactBoon}
                          </span>
                        )}
                        {gs && gs.atWill && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-900/30 text-purple-400 border border-purple-800/40">
                            随意施展
                          </span>
                        )}
                        {gs && !gs.atWill && gs.usesPerLongRest && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/30 text-amber-400 border border-amber-800/40">
                            每长休{gs.usesPerLongRest}次
                          </span>
                        )}
                        {isOwned && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-900/30 text-green-400 border border-green-800/40">
                            已选择
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-400 mt-1.5">{inv.description}</div>
                      {(() => {
                        const spellIds = new Set<string>();
                        if (gs?.id) spellIds.add(gs.id);
                        if (inv.prerequisite?.cantrip) spellIds.add(inv.prerequisite.cantrip);
                        if (spellIds.size === 0) return null;
                        return (
                          <div className="mt-1.5 space-y-1">
                            {Array.from(spellIds).map(sid => {
                              const sp = spellDataLoader.getSpellById(sid);
                              if (!sp) return null;
                              return (
                                <button
                                  key={sid}
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); onOpenSpell?.(sid); }}
                                  className="flex items-center gap-1.5 w-full px-2 py-1 rounded bg-indigo-900/20 border border-indigo-700/30 hover:bg-indigo-900/40 transition-colors text-left"
                                >
                                  <img src={getAssetUrl(`assets/spell-icons/${sid}.png`)} alt="" className="w-4 h-4 rounded flex-shrink-0" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                                  <span className="text-[11px] text-indigo-300 font-medium truncate">{sp.name}</span>
                                  <span className="text-[10px] text-gray-500 truncate">{sp.nameEn}</span>
                                  <span className="ml-auto text-[10px] text-indigo-400 flex-shrink-0">查看 ▸</span>
                                </button>
                              );
                            })}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
