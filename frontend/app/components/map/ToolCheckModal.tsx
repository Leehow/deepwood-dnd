import { useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { tAbility, tProficiency } from "~/utils/i18n";
import { buildToolOptions, hasToolProficiency } from "~/utils/toolProficiency";

const ABILITY_OPTIONS = [
  "strength",
  "dexterity",
  "constitution",
  "intelligence",
  "wisdom",
  "charisma",
] as const;

type AbilityId = typeof ABILITY_OPTIONS[number];

export interface PendingToolCheckRequest {
  characterId: number;
  characterName?: string;
  title?: string;
  toolId?: string;
  toolLocked?: boolean;
  ability?: AbilityId;
  abilityLocked?: boolean;
  dc?: number | null;
  dcLocked?: boolean;
  description?: string;
  confirmLabel?: string;
  context?: Record<string, any>;
}

export interface ToolCheckSubmitPayload {
  characterId: number;
  toolId: string;
  ability: AbilityId;
  dc?: number;
  description?: string;
  context?: Record<string, any>;
}

interface ToolCheckCharacterData {
  id: number;
  name?: string;
  level?: number;
  equipment?: any[];
  ability_scores?: Record<string, number>;
  proficient_tools?: string[];
}

interface ToolCheckModalProps {
  open: boolean;
  request: PendingToolCheckRequest | null;
  characterData?: ToolCheckCharacterData | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: ToolCheckSubmitPayload) => void;
}

function abilityModifier(score: number | undefined): number {
  if (typeof score !== "number") return 0;
  return Math.floor((score - 10) / 2);
}

function proficiencyBonus(level: number | undefined): number {
  const currentLevel = level || 1;
  if (currentLevel < 5) return 2;
  if (currentLevel < 9) return 3;
  if (currentLevel < 13) return 4;
  if (currentLevel < 17) return 5;
  return 6;
}

export function ToolCheckModal({
  open,
  request,
  characterData,
  onOpenChange,
  onSubmit,
}: ToolCheckModalProps) {
  const toolOptions = useMemo(
    () => buildToolOptions({
      equipment: characterData?.equipment || [],
      proficientToolIds: characterData?.proficient_tools || [],
    }),
    [characterData?.equipment, characterData?.proficient_tools]
  );

  const [toolId, setToolId] = useState("");
  const [ability, setAbility] = useState<AbilityId>("dexterity");
  const [dcInput, setDcInput] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (!request) {
      setToolId("");
      setAbility("dexterity");
      setDcInput("");
      setDescription("");
      return;
    }
    const defaultToolId = request.toolId || toolOptions[0]?.id || "";
    setToolId(defaultToolId);
    setAbility(request.ability || "dexterity");
    setDcInput(request.dc != null ? String(request.dc) : "");
    setDescription(request.description || "");
  }, [request, toolOptions]);

  const selectedToolLabel = toolId ? tProficiency(toolId) : "未选择";
  const isProficient = hasToolProficiency(toolId, characterData?.proficient_tools || []);
  const abilityScore = abilityModifier(characterData?.ability_scores?.[ability]);
  const profBonus = proficiencyBonus(characterData?.level);
  const totalModifier = abilityScore + (isProficient ? profBonus : 0);
  const signedModifier = totalModifier >= 0 ? `+${totalModifier}` : `${totalModifier}`;

  const handleSubmit = () => {
    if (!request || !toolId) return;
    const finalDescription = description.trim() || `${selectedToolLabel}检定（${tAbility(ability)}）`;
    const dcValue = dcInput.trim() ? Number(dcInput) : undefined;
    onSubmit({
      characterId: request.characterId,
      toolId,
      ability,
      dc: Number.isFinite(dcValue as number) ? dcValue : undefined,
      description: finalDescription,
      context: request.context,
    });
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/70 z-[1200]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 w-[min(92vw,32rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-amber-700/50 bg-gray-900 shadow-2xl z-[1201] p-4 text-gray-100">
          <Dialog.Title className="text-lg font-semibold text-amber-300">
            {request?.title || "工具检定"}
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-gray-400">
            {request?.characterName || characterData?.name || "角色"} 发起一次工具检定。
          </Dialog.Description>

          <div className="mt-4 space-y-3">
            <label className="block">
              <div className="mb-1 text-xs uppercase tracking-wide text-gray-500">工具</div>
              <select
                value={toolId}
                disabled={request?.toolLocked}
                onChange={(event) => setToolId(event.target.value)}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 disabled:opacity-70"
              >
                {toolOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                    {option.proficient ? " · 熟练" : ""}
                    {option.owned ? " · 已携带" : ""}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <div className="mb-1 text-xs uppercase tracking-wide text-gray-500">属性</div>
              <select
                value={ability}
                disabled={request?.abilityLocked}
                onChange={(event) => setAbility(event.target.value as AbilityId)}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 disabled:opacity-70"
              >
                {ABILITY_OPTIONS.map((item) => (
                  <option key={item} value={item}>
                    {tAbility(item)}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <div className="mb-1 text-xs uppercase tracking-wide text-gray-500">DC</div>
              <input
                type="number"
                min={1}
                max={40}
                disabled={request?.dcLocked}
                value={dcInput}
                onChange={(event) => setDcInput(event.target.value)}
                placeholder="可留空"
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder:text-gray-500 disabled:opacity-70"
              />
            </label>

            <label className="block">
              <div className="mb-1 text-xs uppercase tracking-wide text-gray-500">描述</div>
              <input
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder={`${selectedToolLabel}检定（${tAbility(ability)}）`}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 placeholder:text-gray-500"
              />
            </label>

            <div className="rounded-lg border border-amber-700/30 bg-amber-950/30 px-3 py-2 text-sm">
              <div className="flex items-center justify-between text-amber-200">
                <span>{selectedToolLabel}</span>
                <span>{isProficient ? "熟练" : "未熟练"}</span>
              </div>
              <div className="mt-1 text-xs text-gray-400">
                当前修正 {signedModifier} = {tAbility(ability)} {abilityScore >= 0 ? `+${abilityScore}` : abilityScore}
                {isProficient ? ` + 熟练 ${profBonus >= 0 ? `+${profBonus}` : profBonus}` : ""}
              </div>
            </div>
          </div>

          <div className="mt-5 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-300 hover:bg-gray-800"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!request || !toolId}
              className="rounded-lg bg-amber-600 px-3 py-2 text-sm font-medium text-black disabled:cursor-not-allowed disabled:opacity-50"
            >
              {request?.confirmLabel || "开始检定"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
