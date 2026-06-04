import * as Dialog from "@radix-ui/react-dialog";
import { abilityLabelMap, formatProficiency } from "../../utils/formatting";

interface RaceInfoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  race: any;
  subrace?: any;
}

export function RaceInfoDialog({ open, onOpenChange, race, subrace }: RaceInfoDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/70 z-[10198]" />
        <Dialog.Content aria-describedby={undefined} className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[90vw] max-w-2xl max-h-[85dvh] overflow-auto bg-gray-900 border border-gray-700 rounded p-6 space-y-4 z-[10200]">
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-lg font-semibold text-blue-300">
              种族信息：{race?.name}{subrace ? ` (${subrace.name})` : ""}
            </Dialog.Title>
            <Dialog.Close className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg bg-gray-700/50 hover:bg-gray-600/50 text-gray-400 hover:text-white transition-colors">
              ✕
            </Dialog.Close>
          </div>

          {race && (
            <div className="space-y-4">
              <div className="bg-gray-800/40 border border-gray-700 rounded p-3 space-y-2">
                <div className="text-sm font-medium text-gray-300">基本属性</div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-gray-500">速度：</span>
                    <span className="text-white">{race.speed || 30} 尺</span>
                  </div>
                  <div>
                    <span className="text-gray-500">体型：</span>
                    <span className="text-white">{race.size === "Medium" ? "中型" : race.size === "Small" ? "小型" : race.size}</span>
                  </div>
                </div>
                {race.languages && race.languages.length > 0 && (
                  <div className="text-xs">
                    <span className="text-gray-500">语言：</span>
                    <span className="text-white">{race.languages.map(formatProficiency).join("、")}</span>
                  </div>
                )}
              </div>

              {race.abilityScoreIncrease && (
                <div className="bg-gray-800/40 border border-gray-700 rounded p-3">
                  <div className="text-sm font-medium text-gray-300 mb-2">属性加值</div>
                  <div className="flex flex-wrap gap-2 text-xs">
                    {Object.entries(race.abilityScoreIncrease).map(([key, value]) => (
                      <span key={key} className="px-2 py-1 bg-green-900/30 text-green-300 rounded">
                        {abilityLabelMap[key as keyof typeof abilityLabelMap] || key} +{value as number}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {race.traits && race.traits.length > 0 && (
                <div className="bg-gray-800/40 border border-gray-700 rounded p-3">
                  <div className="text-sm font-medium text-gray-300 mb-2">种族特性</div>
                  <div className="space-y-2">
                    {race.traits.map((trait: any, idx: number) => (
                      <div key={idx} className="text-xs">
                        <div className="text-blue-300 font-medium">{trait.name}</div>
                        <div className="text-gray-400 whitespace-pre-wrap">{trait.description}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {subrace && (subrace as any).traits && (subrace as any).traits.length > 0 && (
                <div className="bg-gray-800/40 border border-gray-700 rounded p-3">
                  <div className="text-sm font-medium text-gray-300 mb-2">亚种特性（{subrace.name}）</div>
                  <div className="space-y-2">
                    {((subrace as any).traits as any[]).map((trait: any, idx: number) => (
                      <div key={idx} className="text-xs">
                        <div className="text-blue-300 font-medium">{trait.name}</div>
                        <div className="text-gray-400 whitespace-pre-wrap">{trait.description}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="text-right">
            <button className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm" onClick={() => onOpenChange(false)}>
              关闭
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

