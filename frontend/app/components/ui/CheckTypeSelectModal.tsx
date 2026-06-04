/**
 * CheckTypeSelectModal - 检定类型选择模态框
 * 用于DM选择属性检定、技能检定或豁免检定
 */

import { useState, useMemo } from "react";
import { createPortal } from "react-dom";
import { PortentSelector } from "./PortentDicePanel";

// 属性数据 (exported for reuse)
export const ABILITIES = [
  { id: "strength", name: "力量", abbr: "STR" },
  { id: "dexterity", name: "敏捷", abbr: "DEX" },
  { id: "constitution", name: "体质", abbr: "CON" },
  { id: "intelligence", name: "智力", abbr: "INT" },
  { id: "wisdom", name: "感知", abbr: "WIS" },
  { id: "charisma", name: "魅力", abbr: "CHA" },
];

// 技能数据（按属性分组）(exported for reuse)
export const SKILLS_BY_ABILITY: Record<string, Array<{ id: string; name: string }>> = {
  strength: [{ id: "athletics", name: "运动" }],
  dexterity: [
    { id: "acrobatics", name: "杂技" },
    { id: "sleight_of_hand", name: "巧手" },
    { id: "stealth", name: "隐匿" },
  ],
  constitution: [],
  intelligence: [
    { id: "arcana", name: "奥秘" },
    { id: "history", name: "历史" },
    { id: "investigation", name: "调查" },
    { id: "nature", name: "自然" },
    { id: "religion", name: "宗教" },
  ],
  wisdom: [
    { id: "animal_handling", name: "驯兽" },
    { id: "insight", name: "洞悉" },
    { id: "medicine", name: "医药" },
    { id: "perception", name: "察觉" },
    { id: "survival", name: "求生" },
  ],
  charisma: [
    { id: "deception", name: "欺瞒" },
    { id: "intimidation", name: "威吓" },
    { id: "performance", name: "表演" },
    { id: "persuasion", name: "说服" },
  ],
};

// 辅助函数：获取技能中文名称
export function getSkillName(skillId: string): string {
  for (const skills of Object.values(SKILLS_BY_ABILITY)) {
    const skill = skills.find(s => s.id === skillId);
    if (skill) return skill.name;
  }
  return skillId;
}

// 辅助函数：获取属性中文名称
export function getAbilityName(abilityId: string): string {
  return ABILITIES.find(a => a.id === abilityId)?.name || abilityId;
}

/** 骰子修正选项 */
export interface CheckModifiers {
  inspirationDie?: string;   // e.g. 'd8' — 激励骰
  useLucky?: boolean;        // 幸运专长
  portentValue?: number;     // 预言骰替换值
}

interface CheckTypeSelectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (
    check: { type: string; ability: string; skill: string | null },
    modifiers?: CheckModifiers,
  ) => void;
  // 玩家熟练技能（用于高亮显示）
  proficientSkills?: string[];
  expertiseSkills?: string[];
  // 骰子修正可用状态
  inspirationDie?: string;    // 可用的激励骰大小，如 'd8'
  hasLucky?: boolean;         // 是否有幸运专长可用
  luckyCharges?: number;      // 幸运专长剩余次数
  portentValues?: number[];   // 可用的预言骰值
}

type TabType = "ability" | "skill" | "save";

export function CheckTypeSelectModal({
  isOpen,
  onClose,
  onSelect,
  proficientSkills = [],
  expertiseSkills = [],
  inspirationDie,
  hasLucky,
  luckyCharges,
  portentValues,
}: CheckTypeSelectModalProps) {
  const [activeTab, setActiveTab] = useState<TabType>("ability");
  const [useInspiration, setUseInspiration] = useState(false);
  const [useLucky, setUseLucky] = useState(false);
  const [selectedPortent, setSelectedPortent] = useState<number | null>(null);

  // 合并熟练和专精技能
  const allProficientSkills = useMemo(() => {
    return new Set([...proficientSkills, ...expertiseSkills]);
  }, [proficientSkills, expertiseSkills]);

  const expertiseSet = useMemo(() => new Set(expertiseSkills), [expertiseSkills]);

  const hasPortent = (portentValues?.length ?? 0) > 0;
  const hasAnyModifier = !!inspirationDie || (hasLucky && (luckyCharges ?? 0) > 0) || hasPortent;

  if (!isOpen) return null;

  const buildModifiers = (): CheckModifiers | undefined => {
    const mods: CheckModifiers = {};
    if (useInspiration && inspirationDie) mods.inspirationDie = inspirationDie;
    if (useLucky) mods.useLucky = true;
    if (selectedPortent !== null) mods.portentValue = selectedPortent;
    return (mods.inspirationDie || mods.useLucky || mods.portentValue != null) ? mods : undefined;
  };

  const handleAbilitySelect = (abilityId: string) => {
    onSelect({ type: "ability_check", ability: abilityId, skill: null }, buildModifiers());
    setUseInspiration(false);
    setUseLucky(false);
    setSelectedPortent(null);
  };

  const handleSkillSelect = (abilityId: string, skillId: string) => {
    onSelect({ type: "skill_check", ability: abilityId, skill: skillId }, buildModifiers());
    setUseInspiration(false);
    setUseLucky(false);
    setSelectedPortent(null);
  };

  const handleSaveSelect = (abilityId: string) => {
    onSelect({ type: "saving_throw", ability: abilityId, skill: null }, buildModifiers());
    setUseInspiration(false);
    setUseLucky(false);
    setSelectedPortent(null);
  };

  return createPortal(
    <div
      className="fixed inset-0 bg-black/70 z-[10350] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-gray-800 rounded-lg w-full max-w-lg max-h-[calc(100dvh-2rem)] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-gray-700 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-amber-400">选择检定类型</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-200 text-xl"
          >
            ✕
          </button>
        </div>

        {/* Dice Modifier Options */}
        {hasAnyModifier && (
          <div className="px-4 py-2 border-b border-gray-700 flex items-center gap-4 bg-gray-750">
            {inspirationDie && (
              <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={useInspiration}
                  onChange={(e) => setUseInspiration(e.target.checked)}
                  className="accent-purple-500 w-4 h-4"
                />
                <span className="text-purple-300">
                  激励骰 ({inspirationDie})
                </span>
              </label>
            )}
            {hasLucky && (luckyCharges ?? 0) > 0 && (
              <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={useLucky}
                  onChange={(e) => setUseLucky(e.target.checked)}
                  className="accent-green-500 w-4 h-4"
                />
                <span className="text-green-300">
                  幸运 ({luckyCharges}次)
                </span>
              </label>
            )}
            {hasPortent && (
              <PortentSelector
                values={portentValues!}
                selectedValue={selectedPortent}
                onSelect={setSelectedPortent}
              />
            )}
          </div>
        )}

        {/* Tabs */}
        <div className="flex border-b border-gray-700">
          <button
            onClick={() => setActiveTab("ability")}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === "ability"
                ? "text-amber-400 border-b-2 border-amber-400 bg-gray-700/30"
                : "text-gray-400 hover:text-gray-200 hover:bg-gray-700/20"
            }`}
          >
            属性检定
          </button>
          <button
            onClick={() => setActiveTab("skill")}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === "skill"
                ? "text-amber-400 border-b-2 border-amber-400 bg-gray-700/30"
                : "text-gray-400 hover:text-gray-200 hover:bg-gray-700/20"
            }`}
          >
            技能检定
          </button>
          <button
            onClick={() => setActiveTab("save")}
            className={`flex-1 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === "save"
                ? "text-amber-400 border-b-2 border-amber-400 bg-gray-700/30"
                : "text-gray-400 hover:text-gray-200 hover:bg-gray-700/20"
            }`}
          >
            豁免检定
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 p-4 overflow-y-auto">
          {/* 属性检定 Tab */}
          {activeTab === "ability" && (
            <div className="grid grid-cols-3 gap-3">
              {ABILITIES.map((ability) => (
                <button
                  key={ability.id}
                  onClick={() => handleAbilitySelect(ability.id)}
                  className="p-4 rounded-lg border border-gray-600 hover:border-amber-500/50 hover:bg-gray-700/50 transition-colors text-center"
                >
                  <div className="text-lg font-semibold text-gray-200">
                    {ability.name}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">{ability.abbr}</div>
                </button>
              ))}
            </div>
          )}

          {/* 技能检定 Tab */}
          {activeTab === "skill" && (
            <div className="space-y-4">
              {ABILITIES.filter((a) => SKILLS_BY_ABILITY[a.id].length > 0).map(
                (ability) => (
                  <div key={ability.id}>
                    <div className="text-xs text-gray-500 mb-2 flex items-center gap-2">
                      <span className="font-medium text-gray-400">
                        {ability.name}
                      </span>
                      <span className="text-gray-600">{ability.abbr}</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {SKILLS_BY_ABILITY[ability.id].map((skill) => {
                        const isProficient = allProficientSkills.has(skill.id);
                        const isExpertise = expertiseSet.has(skill.id);
                        return (
                          <button
                            key={skill.id}
                            onClick={() => handleSkillSelect(ability.id, skill.id)}
                            className={`px-3 py-2 rounded-lg border transition-colors text-sm ${
                              isExpertise
                                ? "border-yellow-500/70 bg-yellow-500/10 text-yellow-300 hover:bg-yellow-500/20"
                                : isProficient
                                ? "border-blue-500/70 bg-blue-500/10 text-blue-300 hover:bg-blue-500/20"
                                : "border-gray-600 text-gray-300 hover:border-amber-500/50 hover:bg-gray-700/50"
                            }`}
                          >
                            {isExpertise && <span className="mr-1">★</span>}
                            {skill.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )
              )}
              {/* 提示说明 */}
              <div className="mt-4 pt-4 border-t border-gray-700 flex items-center gap-4 text-xs text-gray-500">
                <span className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded border border-blue-500/70 bg-blue-500/10"></span>
                  熟练
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-3 h-3 rounded border border-yellow-500/70 bg-yellow-500/10"></span>
                  ★ 专精
                </span>
              </div>
            </div>
          )}

          {/* 豁免检定 Tab */}
          {activeTab === "save" && (
            <div className="grid grid-cols-3 gap-3">
              {ABILITIES.map((ability) => (
                <button
                  key={ability.id}
                  onClick={() => handleSaveSelect(ability.id)}
                  className="p-4 rounded-lg border border-gray-600 hover:border-amber-500/50 hover:bg-gray-700/50 transition-colors text-center"
                >
                  <div className="text-lg font-semibold text-gray-200">
                    {ability.name}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">豁免</div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

// 导出获取检定类型显示文本的辅助函数
export function getCheckTypeLabel(check: {
  type: string;
  ability: string;
  skill: string | null;
}): string {
  const abilityName = ABILITIES.find((a) => a.id === check.ability)?.name || check.ability;

  if (check.type === "saving_throw") {
    return `${abilityName}豁免`;
  }

  if (check.type === "skill_check" && check.skill) {
    const skillName =
      Object.values(SKILLS_BY_ABILITY)
        .flat()
        .find((s) => s.id === check.skill)?.name || check.skill;
    return `${skillName}（${abilityName}）`;
  }

  return `${abilityName}检定`;
}
