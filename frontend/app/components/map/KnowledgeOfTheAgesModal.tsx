import { useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import skillsData from "~/data/rules/skills.json";
import { tAbility, tProficiency, tSkill } from "~/utils/i18n";
import { buildToolOptions, hasToolProficiency } from "~/utils/toolProficiency";

export type KnowledgeOfTheAgesChoiceKind = "skill" | "tool";

export interface KnowledgeOfTheAgesSubmitPayload {
  kind: KnowledgeOfTheAgesChoiceKind;
  proficiencyId: string;
  label: string;
}

interface KnowledgeOfTheAgesCharacterData {
  name?: string;
  equipment?: any[];
  proficient_skills?: string[];
  proficient_tools?: string[];
}

interface KnowledgeOfTheAgesModalProps {
  open: boolean;
  sourceName?: string;
  characterData?: KnowledgeOfTheAgesCharacterData | null;
  onCancel: () => void;
  onConfirm: (payload: KnowledgeOfTheAgesSubmitPayload) => void;
}

type SkillOption = {
  id: string;
  label: string;
  ability?: string;
  proficient: boolean;
};

function firstOptionId<T extends { id: string }>(items: T[]): string {
  return items[0]?.id || "";
}

export function KnowledgeOfTheAgesModal({
  open,
  sourceName,
  characterData,
  onCancel,
  onConfirm,
}: KnowledgeOfTheAgesModalProps) {
  const skillOptions = useMemo<SkillOption[]>(() => {
    const knownSkills = new Set((characterData?.proficient_skills || []).map(entry => String(entry || "")));
    return ((skillsData as any).skills || [])
      .map((skill: any) => ({
        id: skill.id,
        label: skill.name || tSkill(skill.id),
        ability: skill.ability,
        proficient: knownSkills.has(skill.id),
      }))
      .sort((left: SkillOption, right: SkillOption) => left.label.localeCompare(right.label, "zh-Hans-CN"));
  }, [characterData?.proficient_skills]);

  const toolOptions = useMemo(() => {
    return buildToolOptions({
      equipment: characterData?.equipment || [],
      proficientToolIds: characterData?.proficient_tools || [],
    });
  }, [characterData?.equipment, characterData?.proficient_tools]);

  const availableSkillOptions = useMemo(() => {
    const untrained = skillOptions.filter(option => !option.proficient);
    return untrained.length > 0 ? untrained : skillOptions;
  }, [skillOptions]);

  const availableToolOptions = useMemo(() => {
    const untrained = toolOptions.filter(option => !hasToolProficiency(option.id, characterData?.proficient_tools || []));
    return untrained.length > 0 ? untrained : toolOptions;
  }, [toolOptions, characterData?.proficient_tools]);

  const [kind, setKind] = useState<KnowledgeOfTheAgesChoiceKind>("skill");
  const [skillId, setSkillId] = useState("");
  const [toolId, setToolId] = useState("");

  useEffect(() => {
    if (!open) return;
    setKind("skill");
    setSkillId(firstOptionId(availableSkillOptions));
    setToolId(firstOptionId(availableToolOptions));
  }, [open, availableSkillOptions, availableToolOptions]);

  useEffect(() => {
    if (kind === "skill" && !availableSkillOptions.some(option => option.id === skillId)) {
      setSkillId(firstOptionId(availableSkillOptions));
    }
    if (kind === "tool" && !availableToolOptions.some(option => option.id === toolId)) {
      setToolId(firstOptionId(availableToolOptions));
    }
  }, [kind, skillId, toolId, availableSkillOptions, availableToolOptions]);

  const selectedSkill = availableSkillOptions.find(option => option.id === skillId) || null;
  const selectedTool = availableToolOptions.find(option => option.id === toolId) || null;
  const selectedLabel = kind === "skill"
    ? (selectedSkill?.label || "未选择")
    : (selectedTool?.label || "未选择");
  const canConfirm = kind === "skill" ? Boolean(selectedSkill) : Boolean(selectedTool);

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onCancel(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/70 z-[1200]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 w-[min(92vw,34rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-indigo-700/40 bg-gray-900 shadow-2xl z-[1201] p-4 text-gray-100">
          <Dialog.Title className="text-lg font-semibold text-indigo-300">
            知识通道
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-gray-400">
            {sourceName || characterData?.name || "该角色"} 消耗 1 次引导神力，在 10 分钟内获得一项技能或工具熟练。
          </Dialog.Description>

          <div className="mt-4 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setKind("skill")}
                className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                  kind === "skill"
                    ? "border-indigo-500 bg-indigo-500/20 text-indigo-200"
                    : "border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700"
                }`}
              >
                技能熟练
              </button>
              <button
                type="button"
                onClick={() => setKind("tool")}
                className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                  kind === "tool"
                    ? "border-indigo-500 bg-indigo-500/20 text-indigo-200"
                    : "border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700"
                }`}
              >
                工具熟练
              </button>
            </div>

            {kind === "skill" ? (
              <label className="block">
                <div className="mb-1 text-xs uppercase tracking-wide text-gray-500">技能</div>
                <select
                  value={skillId}
                  onChange={(event) => setSkillId(event.target.value)}
                  className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100"
                >
                  {availableSkillOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                      {option.ability ? ` · ${tAbility(option.ability)}` : ""}
                      {option.proficient ? " · 已熟练" : ""}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label className="block">
                <div className="mb-1 text-xs uppercase tracking-wide text-gray-500">工具</div>
                <select
                  value={toolId}
                  onChange={(event) => setToolId(event.target.value)}
                  className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100"
                >
                  {availableToolOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                      {option.owned ? " · 已携带" : ""}
                      {option.proficient ? " · 已熟练" : ""}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <div className="rounded-lg border border-indigo-700/30 bg-indigo-950/30 px-3 py-2 text-sm">
              <div className="flex items-center justify-between text-indigo-200">
                <span>{selectedLabel}</span>
                <span>{kind === "skill" ? "技能" : "工具"}</span>
              </div>
              <div className="mt-1 text-xs text-gray-400">
                {kind === "skill"
                  ? `${selectedSkill?.ability ? `${tAbility(selectedSkill.ability)}相关` : "通用"}检定获得熟练加值`
                  : `获得 ${selectedTool?.label || tProficiency(toolId)} 的工具熟练`}
              </div>
              <div className="mt-1 text-xs text-gray-500">
                再次使用会替换此前的知识通道目标。
              </div>
            </div>
          </div>

          <div className="mt-5 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-300 hover:bg-gray-800"
            >
              取消
            </button>
            <button
              type="button"
              disabled={!canConfirm}
              onClick={() => {
                if (kind === "skill" && selectedSkill) {
                  onConfirm({
                    kind: "skill",
                    proficiencyId: selectedSkill.id,
                    label: selectedSkill.label,
                  });
                  return;
                }
                if (kind === "tool" && selectedTool) {
                  onConfirm({
                    kind: "tool",
                    proficiencyId: selectedTool.id,
                    label: selectedTool.label,
                  });
                }
              }}
              className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              获得熟练
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
