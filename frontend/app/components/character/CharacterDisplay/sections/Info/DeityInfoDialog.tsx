import { useState, useEffect } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import godsData from "~/data/rules/gods.json";
import { getAssetUrl } from "~/utils/asset-url";

const ALIGNMENT_NAMES: Record<string, string> = {
  "LG": "守序善良",
  "NG": "中立善良",
  "CG": "混乱善良",
  "LN": "守序中立",
  "N": "绝对中立",
  "CN": "混乱中立",
  "LE": "守序邪恶",
  "NE": "中立邪恶",
  "CE": "混乱邪恶"
};

interface DeityInfoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deityId?: string;
}

export function DeityInfoDialog({ open, onOpenChange, deityId }: DeityInfoDialogProps) {
  const [currentDeityId, setCurrentDeityId] = useState(deityId);

  // Reset to initial deity when dialog opens
  useEffect(() => {
    if (open) {
      setCurrentDeityId(deityId);
    }
  }, [open, deityId]);

  // Find the deity from gods data
  const pantheons = (godsData as any).pantheons || [];
  let deity: any = null;
  let pantheonName = "";
  let currentPantheon: any = null;

  for (const pantheon of pantheons) {
    const found = (pantheon.deities || []).find((d: any) => d.id === currentDeityId);
    if (found) {
      deity = found;
      pantheonName = pantheon.name;
      currentPantheon = pantheon;
      break;
    }
  }

  // If no deity selected, show overview
  if (!deity) {
    return (
      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/70 z-[10198]" />
          <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-gray-800 border border-gray-700 rounded-lg shadow-2xl z-[10200] w-[95vw] max-w-4xl max-h-[85dvh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <Dialog.Title className="text-xl font-semibold text-amber-400">
                诸神与信仰
              </Dialog.Title>
              <Dialog.Close className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg bg-gray-700/50 hover:bg-gray-600/50 text-gray-400 hover:text-white transition-colors">
                ✕
              </Dialog.Close>
            </div>

            <div className="space-y-6">
              <div>
                <p className="text-sm text-gray-400 leading-relaxed mb-4">
                  {(godsData as any).overview.description}
                </p>
                <p className="text-sm text-gray-400 leading-relaxed">
                  {(godsData as any).overview.worship}
                </p>
              </div>

              {pantheons.map((pantheon: any) => (
                <div key={pantheon.id} className="border-t border-gray-700 pt-4">
                  <h3 className="text-lg font-semibold text-amber-300 mb-3">
                    {pantheon.name}
                  </h3>
                  {pantheon.description && (
                    <p className="text-sm text-gray-400 mb-4">{pantheon.description}</p>
                  )}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {(pantheon.deities || []).map((d: any) => (
                      <button
                        key={d.id}
                        onClick={() => setCurrentDeityId(d.id)}
                        className="p-3 bg-gray-900/50 border border-gray-700 hover:border-amber-500/50 rounded transition-colors text-left"
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div>
                            <h4 className="font-semibold text-white">{d.name}</h4>
                            <div className="text-xs text-gray-500">{d.title}</div>
                          </div>
                          <span className="text-xs px-2 py-0.5 bg-gray-800 rounded text-gray-400">
                            {ALIGNMENT_NAMES[d.alignment] || d.alignment}
                          </span>
                        </div>
                        <p className="text-xs text-gray-400 line-clamp-2">{d.description}</p>
                        {d.domains && d.domains.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {d.domains.map((domain: string, idx: number) => (
                              <span
                                key={idx}
                                className="text-xs px-2 py-0.5 bg-amber-900/30 text-amber-300 rounded"
                              >
                                {domain}
                              </span>
                            ))}
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <Dialog.Close className="btn-secondary text-sm">关闭</Dialog.Close>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    );
  }

  // Get other deities from same pantheon
  const otherDeities = currentPantheon?.deities?.filter((d: any) => d.id !== currentDeityId) || [];

  // Show specific deity details with full portrait background
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/70 z-[10198]" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 border border-gray-700 rounded-lg shadow-2xl z-[10200] w-[95vw] max-w-3xl max-h-[85dvh] overflow-hidden flex flex-col">
          {/* Full Background Image */}
          <div className="absolute inset-0">
            <img
              src={getAssetUrl(`assets/god-icons/${deity.id}.png`)}
              alt={deity.name}
              className="w-full h-full object-cover"
              onError={(e) => {
                (e.target as HTMLImageElement).src = '';
                (e.target as HTMLImageElement).parentElement!.style.background = '#1f2937';
              }}
            />
            <div className="absolute inset-0 bg-black/40" />
          </div>

          {/* Header */}
          <div className="relative flex-shrink-0 p-6 pb-4">
            <Dialog.Title className="text-2xl font-bold text-amber-400 drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]">
              {deity.name}
            </Dialog.Title>
            <p className="text-sm text-gray-100 drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)] mt-1">
              {deity.nameEn} · {deity.title}
            </p>

            <Dialog.Close className="absolute top-4 right-4 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-full bg-black/50 hover:bg-black/70 text-gray-300 hover:text-white transition-colors">
              ✕
            </Dialog.Close>
          </div>

          {/* Scrollable Content with Frosted Glass Effect */}
          <div className="relative flex-1 overflow-y-auto px-4 pb-4">
            <div className="backdrop-blur-md bg-gray-900/70 rounded-lg p-5 space-y-4 border border-white/10">
              {/* Basic Info */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3 bg-black/30 rounded-lg">
                <div>
                  <div className="text-xs text-gray-400 mb-1">神系</div>
                  <div className="text-sm text-white">{pantheonName}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-400 mb-1">阵营</div>
                  <div className="text-sm text-white">{ALIGNMENT_NAMES[deity.alignment] || deity.alignment}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-400 mb-1">圣徽</div>
                  <div className="text-sm text-white">{deity.symbol || "—"}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-400 mb-1">领域</div>
                  <div className="flex flex-wrap gap-1">
                    {deity.domains?.map((domain: string, idx: number) => (
                      <span
                        key={idx}
                        className="text-xs px-2 py-0.5 bg-amber-900/50 text-amber-300 rounded"
                      >
                        {domain}
                      </span>
                    )) || <span className="text-sm text-gray-500">—</span>}
                  </div>
                </div>
              </div>

              {/* Description */}
              <div>
                <h3 className="text-sm font-semibold text-amber-300 mb-2">描述</h3>
                <p className="text-sm text-gray-200 leading-relaxed">{deity.description}</p>
              </div>

              {/* English Description */}
              {deity.descriptionEn && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-400 mb-2">Description (English)</h3>
                  <p className="text-xs text-gray-300 leading-relaxed">{deity.descriptionEn}</p>
                </div>
              )}

              {/* Portfolio */}
              {deity.portfolio && deity.portfolio.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-amber-300 mb-2">职司</h3>
                  <div className="flex flex-wrap gap-2">
                    {deity.portfolio.map((item: string, idx: number) => (
                      <span
                        key={idx}
                        className="text-sm px-3 py-1 bg-black/40 border border-white/10 rounded text-gray-200"
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Worshippers */}
              {deity.worshippers && deity.worshippers.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-amber-300 mb-2">信徒</h3>
                  <div className="flex flex-wrap gap-2">
                    {deity.worshippers.map((item: string, idx: number) => (
                      <span
                        key={idx}
                        className="text-sm px-3 py-1 bg-black/40 border border-white/10 rounded text-gray-200"
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Show other deities from same pantheon - clickable */}
              {otherDeities.length > 0 && (
                <div className="border-t border-white/10 pt-4">
                  <h3 className="text-sm font-semibold text-gray-300 mb-3">
                    {pantheonName}的其他神祇
                  </h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {otherDeities.slice(0, 6).map((d: any) => (
                      <button
                        key={d.id}
                        onClick={() => setCurrentDeityId(d.id)}
                        className="p-2 bg-black/40 border border-white/10 hover:border-amber-500/50 hover:bg-black/60 rounded text-xs text-left transition-colors group"
                      >
                        <div className="font-semibold text-white group-hover:text-amber-300 transition-colors">{d.name}</div>
                        <div className="text-gray-400">{d.title}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="relative flex-shrink-0 p-4 flex justify-end">
            <Dialog.Close className="px-4 py-2 backdrop-blur-sm bg-black/50 hover:bg-black/70 text-gray-200 rounded border border-white/10 transition-colors text-sm">
              关闭
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
