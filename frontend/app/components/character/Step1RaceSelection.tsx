import { useState } from "react";
import { CharacterState, Race } from "./types";
import { getAbilityName, getLanguageName, ALL_SKILLS, getSkillName } from "./utils";
import { getAssetUrl } from "~/utils/asset-url";
import spellsData from "~/data/rules/spells.json";
import { SpellDetailModal } from "~/components/spell/SpellSelectableCard";

interface Step1Props {
  character: CharacterState;
  setCharacter: React.Dispatch<React.SetStateAction<CharacterState>>;
  races: Race[];
  currentRace: Race | undefined;
}

export function Step1RaceSelection({ character, setCharacter, races, currentRace }: Step1Props) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-amber-400 mb-2">选择种族</h2>
        <p className="text-gray-400 text-sm">
          选择你的角色种族。每个种族都有独特的属性加值和特性。
        </p>
      </div>

      {/* Race Cards Grid - Collapsible */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {races.map((race) => (
          <details
            key={race.id}
            className={`rounded-lg border-2 transition-all ${
              character.raceId === race.id
                ? "border-amber-400 bg-amber-400/10"
                : "border-gray-700 hover:border-gray-600 bg-gray-800/50"
            }`}
            open={character.raceId === race.id}
          >
            <summary
              className="p-4 cursor-pointer list-none [&::-webkit-details-marker]:hidden relative"
              onClick={(e) => {
                e.preventDefault();
                const isDeselecting = character.raceId === race.id;
                const isChangingRace = character.raceId !== race.id && character.raceId !== "";

                setCharacter((prev) => ({
                  ...prev,
                  raceId: isDeselecting ? "" : race.id,
                  subraceId: (isDeselecting || isChangingRace) ? "" : prev.subraceId,
                  // Clear race choices when changing race or deselecting
                  raceChoices: (isDeselecting || isChangingRace) ? {} : prev.raceChoices,
                }));
              }}
            >
              {/* Background Image */}
              <div
                className="absolute inset-0 bg-cover bg-center opacity-30"
                style={{ backgroundImage: `url(${getAssetUrl(`images/races/${race.id}.png`)})` }}
              />
              {/* Content overlay */}
              <div className="relative z-10">
                <div className="text-lg font-bold text-amber-400 flex items-center gap-2">
                  <span className="text-sm">
                    {character.raceId === race.id ? "▼" : "▶"}
                  </span>
                  {race.name}
                </div>
                <div className="text-xs text-gray-500 mb-2">{race.nameEn}</div>
                <div className="text-sm text-gray-300 mb-3 line-clamp-2">{race.description}</div>
                <div className="flex flex-wrap gap-1 text-xs">
                  {Object.entries(race.abilityScoreIncrease).map(([ability, bonus]) => (
                    <span key={ability} className="px-1.5 py-0.5 bg-green-900/30 text-green-400 rounded">
                      {getAbilityName(ability)}+{bonus}
                    </span>
                  ))}
                </div>
              </div>
            </summary>

            {/* Expanded Race Details */}
            <div className="px-4 pb-4 pt-2 border-t border-gray-700 mt-2 space-y-3">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-gray-400 text-xs">速度</div>
                  <div className="text-white font-medium">{race.speed} 尺</div>
                </div>
                <div>
                  <div className="text-gray-400 text-xs">体型</div>
                  <div className="text-white font-medium">{race.size}</div>
                </div>
                <div className="col-span-2">
                  <div className="text-gray-400 text-xs">语言</div>
                  <div className="text-white font-medium">{race.languages.map(lang => getLanguageName(lang)).join("、")}</div>
                </div>
              </div>

              {/* Traits */}
              <div>
                <div className="text-xs font-medium text-gray-400 mb-2">种族特性</div>
                <div className="space-y-2">
                  {race.traits.map((trait, index) => (
                    <div key={index} className="bg-gray-900/50 rounded p-2">
                      <div className="font-medium text-amber-400 text-xs">{trait.name}</div>
                      <div className="text-xs text-gray-300 mt-1">{trait.description}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Subraces */}
              {race.subraces && race.subraces.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-amber-400 mb-2">选择亚种 *</div>
                  <div className="space-y-2">
                    {race.subraces.map((subrace) => (
                      <button
                        key={subrace.id}
                        className={`w-full p-3 rounded-lg border text-left transition-all relative overflow-hidden ${
                          character.subraceId === subrace.id
                            ? "border-amber-400 bg-amber-400/10"
                            : "border-gray-700 hover:border-gray-600"
                        }`}
                        onClick={() => setCharacter((prev) => ({ ...prev, subraceId: subrace.id }))}
                      >
                        {/* Subrace background image */}
                        <div
                          className="absolute inset-0 bg-cover bg-center opacity-20"
                          style={{ backgroundImage: `url(${getAssetUrl(`images/races/${subrace.id}.png`)})` }}
                        />
                        <div className="relative z-10">
                        <div className="font-bold text-amber-400 text-sm">{subrace.name}</div>
                        <div className="text-xs text-gray-500 mb-1">{subrace.nameEn}</div>
                        <div className="text-xs text-gray-300 mb-2">{subrace.description}</div>

                        {/* Dragonborn specific info */}
                        {(subrace as any).damageType && (
                          <div className="flex flex-wrap gap-1 text-xs mb-2">
                            <span className="px-2 py-1 bg-red-900/30 text-red-400 rounded">
                              伤害抗性: {(subrace as any).damageTypeCn || (subrace as any).damageType}
                            </span>
                            <span className="px-2 py-1 bg-purple-900/30 text-purple-400 rounded">
                              吐息: {(subrace as any).breathWeapon?.shapeCn || (subrace as any).breathWeapon?.shape} {(subrace as any).breathWeapon?.size}
                            </span>
                            <span className="px-2 py-1 bg-blue-900/30 text-blue-400 rounded">
                              豁免: {(subrace as any).breathWeapon?.saveCn || (subrace as any).breathWeapon?.save}
                            </span>
                          </div>
                        )}

                        {subrace.abilityScoreIncrease && (
                          <div className="flex flex-wrap gap-1 text-xs">
                            {Object.entries(subrace.abilityScoreIncrease).map(([ability, bonus]) => (
                              <span key={ability} className="px-2 py-1 bg-green-900/30 text-green-400 rounded">
                                {getAbilityName(ability)} +{bonus}
                              </span>
                            ))}
                          </div>
                        )}
                        {/* Subrace Traits */}
                        {character.subraceId === subrace.id && subrace.traits && subrace.traits.length > 0 && (
                          <div className="mt-2 pt-2 border-t border-gray-700">
                            <div className="text-xs font-medium text-amber-400 mb-1">亚种特性</div>
                            <div className="space-y-1">
                              {subrace.traits.map((trait, index) => (
                                <div key={index}>
                                  <div className="text-xs font-medium text-gray-300">{trait.name}</div>
                                  <div className="text-xs text-gray-400">{trait.description}</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </details>
        ))}
      </div>

      {/* Race Feature Choices */}
      {character.raceId && currentRace && (
        <RaceFeatureChoices
          character={character}
          setCharacter={setCharacter}
          race={currentRace}
        />
      )}

      {/* Validation Message */}
      {currentRace?.subraces && !character.subraceId && (
        <div className="text-yellow-400 text-sm text-center">
          ⚠️ 请选择一个亚种以继续
        </div>
      )}
    </div>
  );
}

// Race Feature Choices Component
interface RaceFeatureChoicesProps {
  character: CharacterState;
  setCharacter: React.Dispatch<React.SetStateAction<CharacterState>>;
  race: Race;
}

function RaceFeatureChoices({ character, setCharacter, race }: RaceFeatureChoicesProps) {
  const [detailSpell, setDetailSpell] = useState<any>(null);

  // Check if race has any choices
  const hasDwarfToolChoice = race.id === "dwarf";
  const hasHalfElfChoices = race.id === "half_elf";
  const hasHighElfChoices = character.subraceId === "high_elf";

  if (!hasDwarfToolChoice && !hasHalfElfChoices && !hasHighElfChoices) {
    return null;
  }

  // Wizard cantrips for high elf
  const wizardCantrips = (spellsData as any).spells
    ?.filter((s: any) => s.level === 0 && s.classes?.some((c: string) => c.toLowerCase() === "wizard"))
    ?.sort((a: any, b: any) => a.name.localeCompare(b.name, "zh")) || [];

  // Tool name mapping
  const getToolName = (toolId: string): string => {
    const toolMap: Record<string, string> = {
      smiths_tools: "铁匠工具",
      brewers_supplies: "酿酒工具",
      masons_tools: "石匠工具",
    };
    return toolMap[toolId] || toolId;
  };

  return (
    <div className="bg-amber-900/10 border border-amber-700/30 rounded-lg p-4 space-y-4">
      <div className="text-sm font-semibold text-amber-400">
        ⚙️ 种族特性选择（必选）
      </div>

      {/* Dwarf Tool Proficiency */}
      {hasDwarfToolChoice && (
        <div className="space-y-2">
          <div className="text-xs text-gray-300">
            选择一个工匠工具熟练项
            <span className="text-amber-400 ml-1">
              ({character.raceChoices.tool ? "1/1" : "0/1"})
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {["smiths_tools", "brewers_supplies", "masons_tools"].map((toolId) => {
              const isChosen = character.raceChoices.tool === toolId;
              return (
                <button
                  key={toolId}
                  onClick={() => {
                    setCharacter(prev => ({
                      ...prev,
                      raceChoices: {
                        ...prev.raceChoices,
                        tool: isChosen ? undefined : toolId
                      }
                    }));
                  }}
                  className={`p-2 rounded text-xs transition-all ${
                    isChosen
                      ? "bg-amber-500/20 border border-amber-400"
                      : "bg-gray-800/50 border border-gray-600 hover:border-gray-500"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-amber-400">{isChosen ? "●" : "○"}</span>
                    <div className="text-white font-medium">{getToolName(toolId)}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Half-Elf Skill Versatility */}
      {hasHalfElfChoices && (
        <>
          <div className="space-y-2">
            <div className="text-xs text-gray-300">
              技能多才：选择两项技能熟练项
              <span className="text-amber-400 ml-1">
                ({character.raceChoices.skills?.length || 0}/2)
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {ALL_SKILLS.map((skillId) => {
                const currentChoices = character.raceChoices.skills || [];
                const isChosen = currentChoices.includes(skillId);
                const canSelect = isChosen || currentChoices.length < 2;

                return (
                  <button
                    key={skillId}
                    onClick={() => {
                      if (!canSelect && !isChosen) return;

                      setCharacter(prev => {
                        const current = prev.raceChoices.skills || [];
                        const newChoices = isChosen
                          ? current.filter(id => id !== skillId)
                          : [...current, skillId];

                        return {
                          ...prev,
                          raceChoices: {
                            ...prev.raceChoices,
                            skills: newChoices
                          }
                        };
                      });
                    }}
                    disabled={!canSelect && !isChosen}
                    className={`p-2 rounded text-xs transition-all ${
                      isChosen
                        ? "bg-amber-500/20 border border-amber-400"
                        : canSelect
                        ? "bg-gray-800/50 border border-gray-600 hover:border-gray-500"
                        : "bg-gray-900/50 border border-gray-700 opacity-50 cursor-not-allowed"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-amber-400">{isChosen ? "✓" : "○"}</span>
                      <div className="text-white font-medium">{getSkillName(skillId)}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Half-Elf Ability Score Increase */}
          <div className="space-y-2">
            <div className="text-xs text-gray-300">
              额外属性加值：选择两项不同的属性各+1（魅力除外）
              <span className="text-amber-400 ml-1">
                ({character.raceChoices.abilityScores?.length || 0}/2)
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {["strength", "dexterity", "constitution", "intelligence", "wisdom"].map((abilityId) => {
                const currentChoices = character.raceChoices.abilityScores || [];
                const isChosen = currentChoices.includes(abilityId);
                const canSelect = isChosen || currentChoices.length < 2;

                return (
                  <button
                    key={abilityId}
                    onClick={() => {
                      if (!canSelect && !isChosen) return;

                      setCharacter(prev => {
                        const current = prev.raceChoices.abilityScores || [];
                        const newChoices = isChosen
                          ? current.filter(id => id !== abilityId)
                          : [...current, abilityId];

                        return {
                          ...prev,
                          raceChoices: {
                            ...prev.raceChoices,
                            abilityScores: newChoices
                          }
                        };
                      });
                    }}
                    disabled={!canSelect && !isChosen}
                    className={`p-2 rounded text-xs transition-all ${
                      isChosen
                        ? "bg-amber-500/20 border border-amber-400"
                        : canSelect
                        ? "bg-gray-800/50 border border-gray-600 hover:border-gray-500"
                        : "bg-gray-900/50 border border-gray-700 opacity-50 cursor-not-allowed"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-amber-400">{isChosen ? "✓" : "○"}</span>
                      <div className="text-white font-medium">{getAbilityName(abilityId)}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Half-Elf Extra Language */}
          <div className="space-y-2">
            <div className="text-xs text-gray-300">
              额外语言：选择一门额外语言（通用语和精灵语除外）
              <span className="text-amber-400 ml-1">
                ({character.raceChoices.language ? "1/1" : "0/1"})
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {/* Standard languages (except common, elvish) + Exotic languages */}
              {[
                // Standard
                "dwarvish", "giant", "gnomish", "goblin", "halfling", "orc",
                // Exotic
                "abyssal", "celestial", "deep_speech", "draconic", "infernal", "primordial", "sylvan", "undercommon"
              ].map((langId) => {
                const isChosen = character.raceChoices.language === langId;

                return (
                  <button
                    key={langId}
                    onClick={() => {
                      setCharacter(prev => ({
                        ...prev,
                        raceChoices: {
                          ...prev.raceChoices,
                          language: isChosen ? undefined : langId
                        }
                      }));
                    }}
                    className={`p-2 rounded text-xs transition-all ${
                      isChosen
                        ? "bg-amber-500/20 border border-amber-400"
                        : "bg-gray-800/50 border border-gray-600 hover:border-gray-500"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-amber-400">{isChosen ? "●" : "○"}</span>
                      <div className="text-white font-medium">{getLanguageName(langId)}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* High Elf Cantrip + Extra Language */}
      {hasHighElfChoices && (
        <>
          <div className="space-y-2">
            <div className="text-xs text-gray-300">
              戏法：从法师法术列表中选择一个戏法
              <span className="text-amber-400 ml-1">
                ({character.raceChoices.cantrip ? "1/1" : "0/1"})
              </span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {wizardCantrips.map((spell: any) => {
                const isChosen = character.raceChoices.cantrip === spell.id;
                const SCHOOL_COLORS: Record<string, string> = {
                  abjuration: "text-blue-400", conjuration: "text-purple-400",
                  divination: "text-gray-300", enchantment: "text-pink-400",
                  evocation: "text-red-400", illusion: "text-indigo-400",
                  necromancy: "text-green-400", transmutation: "text-yellow-400",
                };
                const SCHOOL_NAMES: Record<string, string> = {
                  abjuration: "防护", conjuration: "咒法", divination: "预言",
                  enchantment: "惑控", evocation: "塑能", illusion: "幻术",
                  necromancy: "死灵", transmutation: "变化",
                };
                return (
                  <div
                    key={spell.id}
                    className={`relative p-2 rounded-lg text-xs transition-all cursor-pointer ${
                      isChosen
                        ? "bg-purple-500/20 border-2 border-purple-400 shadow-lg shadow-purple-500/20"
                        : "bg-gray-800/50 border border-gray-600 hover:border-purple-400/50"
                    }`}
                    onClick={() => {
                      setCharacter(prev => ({
                        ...prev,
                        raceChoices: {
                          ...prev.raceChoices,
                          cantrip: isChosen ? undefined : spell.id
                        }
                      }));
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <img
                        src={getAssetUrl(`assets/spell-icons/${spell.id}.png`)}
                        alt={spell.name}
                        className="w-8 h-8 rounded object-cover flex-shrink-0"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                      <div className="min-w-0">
                        <div className={`font-medium truncate ${isChosen ? "text-purple-300" : "text-white"}`}>{spell.name}</div>
                        <div className={`text-[10px] ${SCHOOL_COLORS[spell.school] || "text-gray-400"}`}>{SCHOOL_NAMES[spell.school] || spell.school}</div>
                      </div>
                      {isChosen && <span className="absolute top-1 right-1 text-purple-400 text-sm">✓</span>}
                    </div>
                    <button
                      type="button"
                      className="absolute bottom-1 right-1 text-[10px] text-gray-500 hover:text-blue-400 transition-colors"
                      onClick={(e) => { e.stopPropagation(); setDetailSpell(spell); }}
                    >
                      详情
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Spell Detail Modal (Unified) */}
          <SpellDetailModal spell={detailSpell} onClose={() => setDetailSpell(null)} />

          <div className="space-y-2">
            <div className="text-xs text-gray-300">
              额外语言：选择一门额外语言
              <span className="text-amber-400 ml-1">
                ({character.raceChoices.language ? "1/1" : "0/1"})
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[
                "dwarvish", "giant", "gnomish", "goblin", "halfling", "orc",
                "abyssal", "celestial", "deep_speech", "draconic", "infernal", "primordial", "sylvan", "undercommon"
              ].map((langId) => {
                const isChosen = character.raceChoices.language === langId;
                return (
                  <button
                    key={langId}
                    onClick={() => {
                      setCharacter(prev => ({
                        ...prev,
                        raceChoices: {
                          ...prev.raceChoices,
                          language: isChosen ? undefined : langId
                        }
                      }));
                    }}
                    className={`p-2 rounded text-xs transition-all ${
                      isChosen
                        ? "bg-amber-500/20 border border-amber-400"
                        : "bg-gray-800/50 border border-gray-600 hover:border-gray-500"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-amber-400">{isChosen ? "●" : "○"}</span>
                      <div className="text-white font-medium">{getLanguageName(langId)}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
