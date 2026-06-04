import * as Collapsible from "@radix-ui/react-collapsible";
import type { SkillMeta } from "../../types/Skill";
import { abilityLabelMap } from "../../utils/formatting";
import type { ArmorProficiencyPenalty } from "../../utils/proficiency";

interface SkillsSectionProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  allSkills: SkillMeta[];
  calcSkillMod: (id: string) => number;
  proficientSet: Set<string>;
  expertiseSet: Set<string>;
  armorPenalty?: ArmorProficiencyPenalty;
}

// 力量和敏捷相关的技能会受到不熟练护甲惩罚
const STR_DEX_ABILITIES = new Set(["strength", "dexterity"]);

export function SkillsSection({ open, onOpenChange, allSkills, calcSkillMod, proficientSet, expertiseSet, armorPenalty }: SkillsSectionProps) {
  const hasDisadvantage = armorPenalty?.penalties?.disadvantageOnStrDexChecks ?? false;

  return (
    <Collapsible.Root open={open} onOpenChange={onOpenChange}>
      <Collapsible.Trigger className="w-full flex items-center justify-between p-2 bg-gray-800/30 rounded hover:bg-gray-800/50 transition-colors">
        <span className="text-sm font-semibold text-gray-300">技能</span>
        <span className="text-gray-400">{open ? "▼" : "▶"}</span>
      </Collapsible.Trigger>
      <Collapsible.Content className="mt-2 p-2 bg-gray-800/20 rounded">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {allSkills.map((sk: SkillMeta) => {
            const mod = calcSkillMod(sk.id);
            const proficient = proficientSet.has(sk.id);
            const expertise = expertiseSet.has(sk.id);
            // 检查该技能是否受到不熟练护甲劣势影响
            const skillHasDisadvantage = hasDisadvantage && STR_DEX_ABILITIES.has(sk.ability);
            return (
              <div
                key={sk.id}
                className={`flex items-center justify-between text-sm rounded px-3 py-2 border ${
                  skillHasDisadvantage
                    ? "bg-amber-900/20 border-amber-600/40"
                    : "bg-gray-900/30 border-gray-700"
                }`}
                title={skillHasDisadvantage ? "不熟练护甲/盾牌 - 检定劣势" : undefined}
              >
                <div className="flex items-center gap-1">
                  <span className={expertise || proficient ? "text-amber-300" : "text-gray-300"}>
                    {expertise ? "** " : proficient ? "* " : ""}
                    {sk.name}
                  </span>
                  <span className="text-xs text-gray-500">({abilityLabelMap[sk.ability] || sk.ability})</span>
                  {skillHasDisadvantage && (
                    <span className="text-[10px] text-red-400 ml-1" title="劣势">▼▼</span>
                  )}
                </div>
                <span className="font-mono text-gray-200">{mod >= 0 ? `+${mod}` : `${mod}`}</span>
              </div>
            );
          })}
        </div>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

