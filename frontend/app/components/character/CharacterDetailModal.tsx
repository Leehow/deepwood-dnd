import * as Dialog from "@radix-ui/react-dialog";
import racesData from "~/data/rules/races.json";
import classesData from "~/data/rules/classes_with_structured_subclass_features.json";
import { formatAlignment, formatFightingStyle, formatMetamagic, formatEldritchInvocation, formatFavoredEnemy, formatHumanoid, formatFavoredTerrain } from "./CharacterDisplay/utils/formatting";
import { HelpTooltip } from "../shared/HelpTooltip";
import { DND_HELP_TEXTS } from "~/data/dnd-help-texts";
import { extractSingleValue, extractValues } from "~/utils/levelTrackingHelpers";

interface CharacterDetailModalProps {
  character: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isDM?: boolean;
  currentUserId?: string;
}

function calculateProficiencyBonus(level: number): number {
  return Math.ceil(level / 4) + 1;
}

function getAbilityHelpText(abilityKey: string) {
  const map: Record<string, keyof typeof DND_HELP_TEXTS> = {
    strength: "strength",
    dexterity: "dexterity",
    constitution: "constitution",
    intelligence: "intelligence",
    wisdom: "wisdom",
    charisma: "charisma",
  };
  return DND_HELP_TEXTS[map[abilityKey]];
}

function calculateMaxHP(character: any): number {
  if (!character) return 0;
  const conMod = Math.floor(((character.ability_scores?.constitution || 10) - 10) / 2);
  const classData = classesData.classes.find((c: any) => c.id === character.class_id);
  const hitDie = classData?.hitDie ? (typeof classData.hitDie === 'number' ? classData.hitDie : parseInt(classData.hitDie.replace('d', ''))) : 8;
  const level1HP = hitDie + conMod;
  const additionalHP = (character.level - 1) * (Math.floor(hitDie / 2) + 1 + conMod);
  return Math.max(1, level1HP + additionalHP);
}

function calculateAC(character: any): number {
  if (!character) return 10;
  const dexMod = Math.floor(((character.ability_scores?.dexterity || 10) - 10) / 2);
  return 10 + dexMod;
}

function calculateSpeed(character: any): number {
  if (!character) return 30;
  const race = racesData.races.find((r: any) => r.id === character.race_id);
  return race?.speed || 30;
}

export function CharacterDetailModal({ character, open, onOpenChange, isDM, currentUserId }: CharacterDetailModalProps) {
  if (!character) return null;

  // 判断是否可以查看完整信息：DM 或者是自己的角色
  const canViewFull = isDM || (currentUserId && character.user_id === currentUserId);
  const selectedSkills = extractValues<string>(character.selected_skills);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[10198]" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-gradient-to-b from-gray-800 to-gray-900 border border-amber-500/20 rounded-xl shadow-2xl shadow-black/50 z-[10200] w-[95vw] max-w-4xl max-h-[85dvh] overflow-y-auto p-6">
          <div className="flex items-center justify-between mb-4">
            <Dialog.Title className="text-amber-400 font-fantasy font-semibold text-xl flex items-center gap-2">
              <span>📜</span> {canViewFull ? '角色详情' : '角色外貌'}
            </Dialog.Title>
            <Dialog.Close className="text-gray-400 hover:text-white text-xl leading-none min-w-[44px] min-h-[44px] flex items-center justify-center rounded hover:bg-gray-700/50">
              ✕
            </Dialog.Close>
          </div>

          <div className="space-y-6">
            {/* 基本信息 - 非完整视图只显示名字和种族 */}
            <div className="fantasy-card !p-4">
              <h3 className="text-amber-300 font-semibold mb-3 flex items-center gap-2">
                <span>👤</span> 基本信息
              </h3>
              <div className={`grid ${canViewFull ? 'grid-cols-2 md:grid-cols-4' : 'grid-cols-2'} gap-3 text-sm`}>
                <div>
                  <div className="text-gray-500 text-xs">姓名</div>
                  <div className="text-white font-medium">{character.name || "未命名"}</div>
                </div>
                <div>
                  <div className="text-gray-500 text-xs">种族</div>
                  <div className="text-white">{racesData.races.find((r: any) => r.id === character.race_id)?.name || character.race_id}</div>
                </div>
                {canViewFull && (
                  <>
                    <div>
                      <div className="text-gray-500 text-xs">职业</div>
                      <div className="text-white">{classesData.classes.find((c: any) => c.id === character.class_id)?.name || character.class_id}</div>
                    </div>
                    <div>
                      <div className="text-gray-500 text-xs">等级</div>
                      <div className="text-amber-400 font-medium">{character.level}</div>
                    </div>
                    <div>
                      <div className="text-gray-500 text-xs">阵营</div>
                      <div className="text-white">{formatAlignment(character.alignment) || "未设置"}</div>
                    </div>
                    <div>
                      <div className="text-gray-500 text-xs">背景</div>
                      <div className="text-white">{character.background_id || "未设置"}</div>
                    </div>
                    <div>
                      <div className="text-gray-500 text-xs">性别</div>
                      <div className="text-white">{character.gender || "未设置"}</div>
                    </div>
                    <div>
                      <div className="text-gray-500 text-xs">年龄</div>
                      <div className="text-white">{character.age || "未设置"}</div>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* 外貌 - 所有人都可以看到 */}
            {character.appearance && Object.keys(character.appearance).length > 0 && (
              <div className="fantasy-card !p-4">
                <h3 className="text-amber-300 font-semibold mb-3 flex items-center gap-2">
                  <span>👁️</span> 外貌
                </h3>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  {character.appearance.height && (
                    <div className="bg-gray-800/30 rounded p-2">
                      <div className="text-gray-500 text-xs mb-1">身高</div>
                      <div className="text-white">{character.appearance.height}</div>
                    </div>
                  )}
                  {character.appearance.weight && (
                    <div className="bg-gray-800/30 rounded p-2">
                      <div className="text-gray-500 text-xs mb-1">体重</div>
                      <div className="text-white">{character.appearance.weight}</div>
                    </div>
                  )}
                  {character.appearance.eyes && (
                    <div className="bg-gray-800/30 rounded p-2">
                      <div className="text-gray-500 text-xs mb-1">眼睛</div>
                      <div className="text-white">{character.appearance.eyes}</div>
                    </div>
                  )}
                  {character.appearance.hair && (
                    <div className="bg-gray-800/30 rounded p-2">
                      <div className="text-gray-500 text-xs mb-1">头发</div>
                      <div className="text-white">{character.appearance.hair}</div>
                    </div>
                  )}
                  {character.appearance.skin && (
                    <div className="bg-gray-800/30 rounded p-2 col-span-2">
                      <div className="text-gray-500 text-xs mb-1">肤色</div>
                      <div className="text-white">{character.appearance.skin}</div>
                    </div>
                  )}
                  {character.appearance.description && (
                    <div className="bg-gray-800/30 rounded p-2 col-span-2">
                      <div className="text-gray-500 text-xs mb-1">描述</div>
                      <div className="text-gray-300 text-xs">{character.appearance.description}</div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* 没有外貌信息时的提示 */}
            {!canViewFull && (!character.appearance || Object.keys(character.appearance).length === 0) && (
              <div className="fantasy-card !p-4 text-center">
                <div className="text-gray-500 text-sm italic">
                  <span className="opacity-50">👁️</span> 暂无外貌描述
                </div>
              </div>
            )}

            {/* 以下内容只对 DM 或角色所有者可见 */}
            {canViewFull && (
              <>
                {/* 战斗属性 */}
                <div className="fantasy-card !p-4">
                  <h3 className="text-amber-300 font-semibold mb-3 flex items-center gap-2">
                    <span>⚔️</span> 战斗属性
                  </h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                    <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700/50">
                      <div className="text-gray-500 text-xs flex items-center gap-1">
                        <span className="text-red-400">❤️</span> 生命值 (HP)
                        <HelpTooltip title={DND_HELP_TEXTS.hp.title} content={DND_HELP_TEXTS.hp.content} size="1" />
                      </div>
                      <div className="text-white font-medium text-lg">
                        {typeof character.current_hp === "number" ? character.current_hp : calculateMaxHP(character)} / {calculateMaxHP(character)}
                      </div>
                    </div>
                    <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700/50">
                      <div className="text-gray-500 text-xs flex items-center gap-1">
                        <span className="text-blue-400">🛡️</span> 护甲等级 (AC)
                        <HelpTooltip title={DND_HELP_TEXTS.ac.title} content={DND_HELP_TEXTS.ac.content} size="1" />
                      </div>
                      <div className="text-white font-medium text-lg">{calculateAC(character)}</div>
                    </div>
                    <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700/50">
                      <div className="text-gray-500 text-xs flex items-center gap-1">
                        <span className="text-green-400">👟</span> 速度
                        <HelpTooltip title={DND_HELP_TEXTS.speed.title} content={DND_HELP_TEXTS.speed.content} size="1" />
                      </div>
                      <div className="text-white font-medium text-lg">{calculateSpeed(character)} 尺</div>
                    </div>
                    <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700/50">
                      <div className="text-gray-500 text-xs flex items-center gap-1">
                        <span className="text-amber-400">⭐</span> 熟练加值
                        <HelpTooltip title={DND_HELP_TEXTS.proficiency.title} content={DND_HELP_TEXTS.proficiency.content} size="1" />
                      </div>
                      <div className="text-amber-400 font-medium text-lg">+{calculateProficiencyBonus(character.level)}</div>
                    </div>
                  </div>
                </div>

                {/* 能力值 */}
                <div className="fantasy-card !p-4">
                  <h3 className="text-amber-300 font-semibold mb-3 flex items-center gap-2">
                    <span>💪</span> 能力值
                  </h3>
                  <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
                    {[
                      { key: "strength", label: "力量" },
                      { key: "dexterity", label: "敏捷" },
                      { key: "constitution", label: "体质" },
                      { key: "intelligence", label: "智力" },
                      { key: "wisdom", label: "感知" },
                      { key: "charisma", label: "魅力" }
                    ].map(({ key, label }) => {
                      const score = character.ability_scores?.[key] || 10;
                      const modifier = Math.floor((score - 10) / 2);
                      const helpText = getAbilityHelpText(key);
                      return (
                        <div key={key} className="text-center bg-gradient-to-b from-gray-800/80 to-gray-900/80 rounded-lg p-3 border border-gray-700/50">
                          <div className="text-gray-500 text-xs mb-1 flex items-center justify-center gap-1">
                            {label}
                            <HelpTooltip title={helpText.title} content={helpText.content} size="1" />
                          </div>
                          <div className="text-white font-bold text-xl">{score}</div>
                          <div className={`text-sm font-medium ${modifier >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {modifier >= 0 ? "+" : ""}{modifier}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 技能 */}
                {selectedSkills.length > 0 && (
                  <div className="fantasy-card !p-4">
                    <h3 className="text-amber-300 font-semibold mb-3 flex items-center gap-2">
                      <span>🎯</span> 技能
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {selectedSkills.map((skill, index) => (
                        <span key={`${skill}-${index}`} className="px-3 py-1.5 bg-gradient-to-r from-gray-700/80 to-gray-800/80 rounded-full text-sm text-white border border-gray-600/50">
                          {skill}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* 职业特性 */}
                {(() => {
                  const vc = classesData.classes.find((c: any) => c.id === character.class_id);
                  if (!vc?.features) return null;
                  const features = (vc as any).features.filter((f: any) => (f.level ?? 0) <= (character.level || 1));
                  if (features.length === 0) return null;

                  const fightingStyle = extractSingleValue<string>(character.fighting_style || character.fightingStyle) || undefined;
                  const enemy = extractSingleValue<string>(character.favored_enemy || character.favoredEnemy) || undefined;
                  const humanoids = (character.favored_humanoid_races || character.favoredHumanoidRaces as string[]) || [];
                  const terrain = extractSingleValue<string>(character.favored_terrain || character.favoredTerrain) || undefined;
                  const metamagics = extractValues<string>(character.metamagic_options || character.metamagicOptions);
                  const invocations = extractValues<string>(character.eldritch_invocations || character.eldritchInvocations);

                  return (
                    <div className="fantasy-card !p-4">
                      <h3 className="text-amber-300 font-semibold mb-3 flex items-center gap-2">
                        <span>✨</span> 职业特性（{character.level}级）
                      </h3>
                      <div className="space-y-2 max-h-60 overflow-auto">
                        {features.map((feat: any, idx: number) => {
                          const featureName = feat.name || "";
                          return (
                            <div key={idx} className="text-xs">
                              <div className="text-amber-300 font-medium">
                                {featureName}{feat.level ? ` (${feat.level}级)` : ""}
                              </div>
                              <div className="text-gray-400 whitespace-pre-wrap">{feat.description}</div>

                              {/战斗风格|Fighting Style/.test(featureName) && feat.options?.length > 0 && (
                                <details className="mt-1">
                                  <summary className="text-xs text-green-300 cursor-pointer hover:text-green-200">
                                    {fightingStyle ? `已选择：${formatFightingStyle(fightingStyle)}` : "未选择"} <span className="text-green-500 text-[10px]">▶ 查看全部</span>
                                  </summary>
                                  <div className="mt-2 pl-2 border-l-2 border-green-800 space-y-1.5">
                                    {feat.options.map((opt: any) => {
                                      const isSel = opt.id === fightingStyle;
                                      return (
                                        <div key={opt.id} className={`rounded px-2 py-1.5 ${isSel ? "bg-green-900/40 border border-green-700" : "bg-gray-800/60"}`}>
                                          <span className={isSel ? "text-green-300 font-medium" : "text-gray-300"}>{isSel && "✦ "}{opt.name}</span>
                                          <span className="text-gray-500 ml-1">({opt.nameEn})</span>
                                          <div className="text-gray-400 mt-0.5">{opt.description}</div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </details>
                              )}

                              {/宿敌|Favored Enemy/.test(featureName) && feat.choices?.length > 0 && (
                                <details className="mt-1">
                                  <summary className="text-xs text-green-300 cursor-pointer hover:text-green-200">
                                    {enemy
                                      ? `已选择：${enemy === "humanoids" ? `类人生物（${humanoids.map(formatHumanoid).join("、")}）` : formatFavoredEnemy(enemy)}`
                                      : "未选择"
                                    } <span className="text-green-500 text-[10px]">▶ 查看全部</span>
                                  </summary>
                                  <div className="mt-2 pl-2 border-l-2 border-green-800 flex flex-wrap gap-1.5">
                                    {feat.choices.map((id: string) => {
                                      const isSel = id === enemy;
                                      return (
                                        <span key={id} className={`rounded px-2 py-1 ${isSel ? "bg-green-900/40 border border-green-700 text-green-300 font-medium" : "bg-gray-800/60 text-gray-400"}`}>
                                          {isSel && "✦ "}{formatFavoredEnemy(id)}
                                        </span>
                                      );
                                    })}
                                  </div>
                                </details>
                              )}

                              {/偏好地形|天生探险家|自然探险家|自然探索者|Natural Explorer/.test(featureName) && feat.terrainChoices?.length > 0 && (
                                <details className="mt-1">
                                  <summary className="text-xs text-green-300 cursor-pointer hover:text-green-200">
                                    {terrain ? `已选择：${formatFavoredTerrain(terrain)}` : "未选择"} <span className="text-green-500 text-[10px]">▶ 查看全部</span>
                                  </summary>
                                  <div className="mt-2 pl-2 border-l-2 border-green-800 flex flex-wrap gap-1.5">
                                    {feat.terrainChoices.map((id: string) => {
                                      const isSel = id === terrain;
                                      return (
                                        <span key={id} className={`rounded px-2 py-1 ${isSel ? "bg-green-900/40 border border-green-700 text-green-300 font-medium" : "bg-gray-800/60 text-gray-400"}`}>
                                          {isSel && "✦ "}{formatFavoredTerrain(id)}
                                        </span>
                                      );
                                    })}
                                  </div>
                                </details>
                              )}

                              {/超魔|Metamagic/.test(featureName) && feat.options?.length > 0 && (
                                <details className="mt-1">
                                  <summary className="text-xs text-green-300 cursor-pointer hover:text-green-200">
                                    {metamagics.length > 0 ? `已选择：${metamagics.map(formatMetamagic).join("、")}` : "未选择"} <span className="text-green-500 text-[10px]">▶ 查看全部</span>
                                  </summary>
                                  <div className="mt-2 pl-2 border-l-2 border-green-800 space-y-1.5">
                                    {feat.options.map((opt: any) => {
                                      const isSel = metamagics.includes(opt.id);
                                      return (
                                        <div key={opt.id} className={`rounded px-2 py-1.5 ${isSel ? "bg-green-900/40 border border-green-700" : "bg-gray-800/60"}`}>
                                          <span className={isSel ? "text-green-300 font-medium" : "text-gray-300"}>{isSel && "✦ "}{opt.name}</span>
                                          <span className="text-gray-500 ml-1">({opt.nameEn})</span>
                                          {opt.cost && <span className="text-amber-400/70 ml-1">- {opt.cost}点</span>}
                                          <div className="text-gray-400 mt-0.5">{opt.description}</div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </details>
                              )}

                              {/魔能祈唤|Eldritch Invocations/.test(featureName) && invocations.length > 0 && (
                                <div className="text-xs text-green-300 mt-1">已选择：{invocations.map(formatEldritchInvocation).join("、")}</div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

                {/* 装备 */}
                {character.equipment && character.equipment.length > 0 && (
                  <div className="fantasy-card !p-4">
                    <h3 className="text-amber-300 font-semibold mb-3 flex items-center gap-2">
                      <span>🎒</span> 装备
                    </h3>
                    <div className="space-y-2">
                      {character.equipment.map((item: any, idx: number) => {
                        const itemName = typeof item === 'string' ? item : (item.name || item.id || '未知物品');
                        const quantity = typeof item === 'object' ? item.quantity : null;
                        return (
                          <div key={idx} className="flex justify-between items-center text-sm border-b border-gray-700/30 pb-2 last:border-0 last:pb-0">
                            <span className="text-white">{itemName}</span>
                            {quantity && <span className="text-gray-400 bg-gray-800 px-2 py-0.5 rounded">x{quantity}</span>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* 法术 */}
                {(character.selected_cantrips?.length > 0 || character.selected_spells?.length > 0) && (
                  <div className="fantasy-card !p-4">
                    <h3 className="text-amber-300 font-semibold mb-3 flex items-center gap-2">
                      <span>✨</span> 法术
                    </h3>
                    {character.selected_cantrips?.length > 0 && (
                      <div className="mb-3">
                        <div className="text-gray-400 text-xs mb-2 flex items-center gap-1">
                          <span>🔮</span> 戏法
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {character.selected_cantrips.map((spell: any, idx: number) => {
                            const spellName = typeof spell === 'string' ? spell : (spell.id || spell.name || '未知');
                            return (
                              <span key={idx} className="px-2.5 py-1 bg-purple-900/40 border border-purple-700/50 rounded-lg text-xs text-purple-300">
                                {spellName}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {character.selected_spells?.length > 0 && (
                      <div>
                        <div className="text-gray-400 text-xs mb-2 flex items-center gap-1">
                          <span>📖</span> 已知法术
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {character.selected_spells.map((spell: any, idx: number) => {
                            const spellName = typeof spell === 'string' ? spell : (spell.id || spell.name || '未知');
                            return (
                              <span key={idx} className="px-2.5 py-1 bg-blue-900/40 border border-blue-700/50 rounded-lg text-xs text-blue-300">
                                {spellName}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* 个性 */}
                {character.personality && (
                  <div className="fantasy-card !p-4">
                    <h3 className="text-amber-300 font-semibold mb-3 flex items-center gap-2">
                      <span>💭</span> 个性
                    </h3>
                    <div className="space-y-3 text-sm">
                      {character.personality.traits && (
                        <div className="bg-gray-800/30 rounded p-2">
                          <div className="text-gray-500 text-xs mb-1">特质</div>
                          <div className="text-white">{Array.isArray(character.personality.traits) ? character.personality.traits.join(", ") : character.personality.traits}</div>
                        </div>
                      )}
                      {character.personality.ideals && (
                        <div className="bg-gray-800/30 rounded p-2">
                          <div className="text-gray-500 text-xs mb-1">理想</div>
                          <div className="text-white">{character.personality.ideals}</div>
                        </div>
                      )}
                      {character.personality.bonds && (
                        <div className="bg-gray-800/30 rounded p-2">
                          <div className="text-gray-500 text-xs mb-1">羁绊</div>
                          <div className="text-white">{character.personality.bonds}</div>
                        </div>
                      )}
                      {character.personality.flaws && (
                        <div className="bg-gray-800/30 rounded p-2">
                          <div className="text-gray-500 text-xs mb-1">缺陷</div>
                          <div className="text-white">{character.personality.flaws}</div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* 背景故事 */}
                {character.backstory && (
                  <div className="fantasy-card !p-4">
                    <h3 className="text-amber-300 font-semibold mb-3 flex items-center gap-2">
                      <span>📚</span> 背景故事
                    </h3>
                    <div className="text-sm text-gray-300 whitespace-pre-wrap bg-gray-800/30 rounded-lg p-3 leading-relaxed">{character.backstory}</div>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-gray-700/30">
            <Dialog.Close className="fantasy-btn">
              <span>✖️</span> 关闭
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
