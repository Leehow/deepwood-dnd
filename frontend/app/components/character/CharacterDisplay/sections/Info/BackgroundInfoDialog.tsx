import * as Dialog from "@radix-ui/react-dialog";
import { formatProficiency, formatEquipmentName } from "../../utils/formatting";
import skillsData from "~/data/rules/skills.json";
import type { SkillMeta } from "../../types/Skill";

interface BackgroundInfoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  background: any;
}

export function BackgroundInfoDialog({ open, onOpenChange, background }: BackgroundInfoDialogProps) {
  const allSkills: SkillMeta[] = ((skillsData as { skills?: SkillMeta[] }).skills || []);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/70 z-[10198]" />
        <Dialog.Content aria-describedby={undefined} className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[90vw] max-w-2xl max-h-[85dvh] overflow-auto bg-gray-900 border border-gray-700 rounded p-6 space-y-4 z-[10200]">
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-lg font-semibold text-gray-300">
              背景信息：{background?.name}
            </Dialog.Title>
            <Dialog.Close className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg bg-gray-700/50 hover:bg-gray-600/50 text-gray-400 hover:text-white transition-colors">
              ✕
            </Dialog.Close>
          </div>

          {background && (
            <div className="space-y-4">
              {/* 描述 */}
              {background.description && (
                <div className="bg-gray-800/40 border border-gray-700 rounded p-3">
                  <div className="text-sm font-medium text-gray-300 mb-2">描述</div>
                  <div className="text-xs text-gray-400 whitespace-pre-wrap">{background.description}</div>
                </div>
              )}

              {/* 技能熟练 */}
              {background.skillProficiencies && background.skillProficiencies.length > 0 && (
                <div className="bg-gray-800/40 border border-gray-700 rounded p-3">
                  <div className="text-sm font-medium text-gray-300 mb-2">技能熟练</div>
                  <div className="flex flex-wrap gap-2 text-xs">
                    {background.skillProficiencies.map((skill: string) => {
                      const skillObj = allSkills.find((s: any) => s.id === skill);
                      return (
                        <span key={skill} className="px-2 py-1 bg-blue-900/30 text-blue-300 rounded">
                          {skillObj?.name || skill}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 工具熟练 */}
              {background.toolProficiencies && background.toolProficiencies.length > 0 && (
                <div className="bg-gray-800/40 border border-gray-700 rounded p-3">
                  <div className="text-sm font-medium text-gray-300 mb-2">工具熟练</div>
                  <div className="text-xs text-white">
                    {background.toolProficiencies.map(formatProficiency).join("、")}
                  </div>
                </div>
              )}

              {/* 语言 */}
              {Array.isArray(background.languages) && background.languages.length > 0 && (
                <div className="bg-gray-800/40 border border-gray-700 rounded p-3">
                  <div className="text-sm font-medium text-gray-300 mb-2">语言</div>
                  <div className="text-xs text-white">{background.languages.map(formatProficiency).join("、")}</div>
                </div>
              )}

              {/* 装备 */}
              {background.equipment && background.equipment.length > 0 && (
                <div className="bg-gray-800/40 border border-gray-700 rounded p-3">
                  <div className="text-sm font-medium text-gray-300 mb-2">起始装备</div>
                  <div className="text-xs text-gray-400">
                    {background.equipment.map(formatEquipmentName).join("、")}
                  </div>
                </div>
              )}

              {/* 背景特性 */}
              {background.feature && (
                <div className="bg-gray-800/40 border border-gray-700 rounded p-3">
                  <div className="text-sm font-medium text-gray-300 mb-2">背景特性</div>
                  <div className="text-xs">
                    <div className="text-amber-300 font-medium">{background.feature.name}</div>
                    <div className="text-gray-400 whitespace-pre-wrap">{background.feature.description}</div>
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

