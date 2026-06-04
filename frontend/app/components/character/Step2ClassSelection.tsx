import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { CharacterState } from "./types";
import { getAbilityName, getSkillName, getArmorName, getWeaponName } from "./utils";
import { getAssetUrl } from "~/utils/asset-url";

interface Step2Props {
  character: CharacterState;
  setCharacter: React.Dispatch<React.SetStateAction<CharacterState>>;
  classes: any[];
}

function Step2ClassSelection({ character, setCharacter, classes }: Step2Props) {
  const [expandedFeatures, setExpandedFeatures] = useState<Record<string, boolean>>({});
  const [showAllLevelsDialog, setShowAllLevelsDialog] = useState<string | null>(null);

  const currentClass = classes.find(c => c.id === character.classId);
  const maxSkills = currentClass?.proficiencies?.skillChoices || 0;
  const canSelectMore = character.selectedSkills.length < maxSkills;

  const toggleSkill = (skillId: string) => {
    setCharacter(prev => {
      const isSelected = prev.selectedSkills.includes(skillId);
      if (isSelected) {
        // Remove skill
        return {
          ...prev,
          selectedSkills: prev.selectedSkills.filter(s => s !== skillId)
        };
      } else if (prev.selectedSkills.length < maxSkills) {
        // Add skill if not at max
        return {
          ...prev,
          selectedSkills: [...prev.selectedSkills, skillId]
        };
      }
      return prev;
    });
  };

  const toggleFeatureExpansion = (classId: string, featureIndex: number) => {
    const key = `${classId}-${featureIndex}`;
    setExpandedFeatures(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-amber-400 mb-2">选择职业</h2>
        <p className="text-gray-400 text-sm">
          选择你的角色职业。每个职业都有独特的能力和技能。
        </p>
      </div>

      {/* Class Cards Grid - Collapsible */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {classes.map((cls) => (
          <details
            key={cls.id}
            className={`rounded-lg border-2 transition-all ${
              character.classId === cls.id
                ? "border-amber-400 bg-amber-400/10"
                : "border-gray-700 hover:border-gray-600 bg-gray-800/50"
            }`}
            open={character.classId === cls.id}
          >
            <summary
              className="p-4 cursor-pointer list-none [&::-webkit-details-marker]:hidden relative overflow-hidden"
              onClick={(e) => {
                e.preventDefault();
                const isCurrentlySelected = character.classId === cls.id;
                setCharacter((prev) => ({
                  ...prev,
                  classId: isCurrentlySelected ? "" : cls.id,
                  selectedSkills: [], // Always reset skills when toggling
                  subclassId: "", // Reset subclass when changing class
                  // Reset all class features
                  fightingStyle: "",
                  selectedCantrips: [],
                  selectedSpells: [],
                  preparedSpells: [],
                  expertiseSkills: [],
                  expertiseThievesTools: false,
                  favoredEnemy: "",
                  favoredHumanoidRaces: [],
                  favoredTerrain: "",
                }));
              }}
            >
              {/* Background Image */}
              <div
                className="absolute inset-0 bg-cover bg-center opacity-30 pointer-events-none"
                style={{ backgroundImage: `url(${getAssetUrl(`images/classes/${cls.id}.png`)})` }}
              />

              {/* Content */}
              <div className="relative z-10">
                <div className="text-lg font-bold text-amber-400 flex items-center gap-2">
                  <span className="text-sm">
                    {character.classId === cls.id ? "▼" : "▶"}
                  </span>
                  {cls.name}
                </div>
                <div className="text-xs text-gray-500 mb-2">{cls.nameEn}</div>
                <div className="flex flex-wrap gap-2 text-xs mt-2">
                  <span className="px-2 py-1 bg-purple-900/30 text-purple-400 rounded">
                    生命骰: {cls.hitDie}
                  </span>
                  <span className="px-2 py-1 bg-blue-900/30 text-blue-400 rounded">
                    主属性: {cls.primaryAbility.map((a: string) => getAbilityName(a)).join("/")}
                  </span>
                </div>
              </div>
            </summary>

            {/* Expanded Class Details */}
            <div className="px-4 pb-4 pt-2 border-t border-gray-700 mt-2 space-y-3 relative z-10">
              {/* Proficiencies */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-gray-400 text-xs">豁免熟练</div>
                  <div className="text-white font-medium">
                    {cls.savingThrows.map((s: string) => getAbilityName(s)).join("、")}
                  </div>
                </div>
                <div>
                  <div className="text-gray-400 text-xs">护甲熟练</div>
                  <div className="text-white font-medium text-xs">
                    {cls.proficiencies.armor.length > 0 ? cls.proficiencies.armor.map((a: string) => getArmorName(a)).join("、") : "无"}
                  </div>
                </div>
              </div>

              {/* Skill Selection */}
              {cls.proficiencies.skillsAvailable.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-amber-400 mb-2">
                    选择技能 ({character.classId === cls.id ? character.selectedSkills.length : 0}/{cls.proficiencies.skillChoices})
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {cls.proficiencies.skillsAvailable.map((skill: string) => {
                      const isSelected = character.selectedSkills.includes(skill);
                      const canSelect = character.classId === cls.id && (isSelected || canSelectMore);

                      return (
                        <button
                          key={skill}
                          disabled={character.classId !== cls.id || (!isSelected && !canSelectMore)}
                          className={`p-2 rounded border text-xs text-left transition-all ${
                            isSelected
                              ? "border-amber-400 bg-amber-400/20 text-amber-300"
                              : canSelect
                                ? "border-gray-600 hover:border-gray-500 text-gray-300"
                                : "border-gray-700 text-gray-600 cursor-not-allowed"
                          }`}
                          onClick={() => character.classId === cls.id && toggleSkill(skill)}
                        >
                          <span className="mr-1">{isSelected ? "✓" : "○"}</span>
                          {getSkillName(skill)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Level 1 Features Preview */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-medium text-gray-400">1级特性</div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowAllLevelsDialog(cls.id);
                    }}
                    className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                  >
                    查看所有等级 →
                  </button>
                </div>
                <div className="space-y-2">
                  {cls.features.filter((f: any) => f.level === 1).map((feature: any, featureIndex: number) => {
                    const key = `${cls.id}-${featureIndex}`;
                    const isExpanded = expandedFeatures[key];
                    const shouldTruncate = feature.description && feature.description.length > 100;

                    return (
                      <div key={featureIndex} className="bg-gray-900/50 rounded p-2">
                        <div className="font-medium text-amber-400 text-xs">{feature.name}</div>
                        <div className={`text-xs text-gray-300 mt-1 ${!isExpanded && shouldTruncate ? 'line-clamp-2' : ''}`}>
                          {feature.description}
                        </div>
                        {shouldTruncate && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleFeatureExpansion(cls.id, featureIndex);
                            }}
                            className="text-xs text-blue-400 hover:text-blue-300 mt-1 transition-colors"
                          >
                            {isExpanded ? '收起' : '更多...'}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </details>
        ))}
      </div>

      {/* Validation Message */}
      {character.classId && character.selectedSkills.length < maxSkills && (
        <div className="text-yellow-400 text-sm text-center">
          ⚠️ 请选择 {maxSkills} 个技能（已选 {character.selectedSkills.length} 个）
        </div>
      )}

      {/* All Levels Features Dialog */}
      {showAllLevelsDialog && (
        <Dialog.Root open={!!showAllLevelsDialog} onOpenChange={() => setShowAllLevelsDialog(null)}>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 bg-black/80 z-50" />
            <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-gray-900 border-2 border-amber-400 rounded-lg shadow-2xl w-[90vw] max-w-4xl max-h-[85dvh] overflow-hidden z-50 flex flex-col">
              <div className="p-6 border-b border-gray-700 flex items-center justify-between">
                <Dialog.Title className="text-2xl font-bold text-amber-400">
                  {classes.find(c => c.id === showAllLevelsDialog)?.name} - 所有等级特性
                </Dialog.Title>
                <Dialog.Close className="text-gray-400 hover:text-gray-200 transition-colors">
                  <span className="text-2xl">×</span>
                </Dialog.Close>
              </div>

              <div className="flex-1 overflow-y-auto p-6">
                <div className="space-y-6">
                  {Array.from({ length: 20 }, (_, i) => i + 1).map(level => {
                    const levelFeatures = classes
                      .find(c => c.id === showAllLevelsDialog)
                      ?.features.filter((f: any) => f.level === level) || [];

                    if (levelFeatures.length === 0) return null;

                    return (
                      <div key={level} className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
                        <h3 className="text-lg font-bold text-amber-400 mb-3 flex items-center gap-2">
                          <span className="bg-amber-400 text-gray-900 px-2 py-1 rounded text-sm">
                            {level}级
                          </span>
                        </h3>
                        <div className="space-y-3">
                          {levelFeatures.map((feature: any, idx: number) => (
                            <div key={idx} className="bg-gray-900/50 rounded p-3">
                              <div className="font-semibold text-amber-300 mb-1">
                                {feature.name}
                                {feature.nameEn && (
                                  <span className="text-xs text-gray-500 ml-2">({feature.nameEn})</span>
                                )}
                              </div>
                              <div className="text-sm text-gray-300 whitespace-pre-wrap">
                                {feature.description}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="p-4 border-t border-gray-700 flex justify-end">
                <Dialog.Close asChild>
                  <button className="px-6 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors">
                    关闭
                  </button>
                </Dialog.Close>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      )}
    </div>
  );
}

// Step 3: Class Features (Spells, Fighting Style, Expertise) Component
interface Step3ClassFeaturesProps {
  character: CharacterState;
  setCharacter: React.Dispatch<React.SetStateAction<CharacterState>>;
  currentClass: any;
}

export { Step2ClassSelection };
