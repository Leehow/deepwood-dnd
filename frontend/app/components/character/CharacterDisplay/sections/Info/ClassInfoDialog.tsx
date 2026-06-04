import * as Dialog from "@radix-ui/react-dialog";
import { formatProficiency, abilityLabelMap, formatFightingStyle, formatMetamagic, formatEldritchInvocation, formatFavoredEnemy, formatHumanoid, formatFavoredTerrain } from "../../utils/formatting";

// Helper to extract value from object or string
const extractValue = (field: any): string | undefined => {
  if (!field) return undefined;
  if (typeof field === 'string') return field;
  if (typeof field === 'object' && field.value) return field.value;
  return undefined;
};

const extractArray = (field: any): string[] => {
  if (!field) return [];
  if (Array.isArray(field)) {
    return field.map(item => typeof item === 'string' ? item : item?.value).filter(Boolean);
  }
  return [];
};

interface ClassInfoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  character: any;
  charClass: any | null;
  subclass?: any | null;
}

export function ClassInfoDialog({
  open,
  onOpenChange,
  character,
  charClass,
  subclass,
}: ClassInfoDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/70 z-[10198]" />
        <Dialog.Content aria-describedby={undefined} className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[90vw] max-w-2xl max-h-[85dvh] overflow-auto bg-gray-900 border border-gray-700 rounded p-6 space-y-4 z-[10200]">
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-lg font-semibold text-amber-300">
              职业信息：{charClass?.name}
              {subclass ? ` (${subclass.name})` : ""}
            </Dialog.Title>
            <Dialog.Close className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg bg-gray-700/50 hover:bg-gray-600/50 text-gray-400 hover:text-white transition-colors">
              ✕
            </Dialog.Close>
          </div>

          {charClass && (
            <div className="space-y-4">
              {/* 基本信息 */}
              <div className="bg-gray-800/40 border border-gray-700 rounded p-3 space-y-2">
                <div className="text-sm font-medium text-gray-300">基本信息</div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-gray-500">生命骰：</span>
                    <span className="text-white">{charClass.hitDie}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">主属性：</span>
                    <span className="text-white">
                      {charClass.primaryAbility?.map((a: string) => abilityLabelMap[a] || a).join("/")}
                    </span>
                  </div>
                </div>
              </div>

              {/* 豁免熟练 */}
              {Array.isArray(charClass.savingThrows) && charClass.savingThrows.length > 0 && (
                <div className="bg-gray-800/40 border border-gray-700 rounded p-3">
                  <div className="text-sm font-medium text-gray-300 mb-2">豁免熟练</div>
                  <div className="flex flex-wrap gap-2 text-xs">
                    {charClass.savingThrows.map((save: string) => (
                      <span key={save} className="px-2 py-1 bg-purple-900/30 text-purple-300 rounded">
                        {abilityLabelMap[save] || save}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* 熟练项 */}
              {charClass.proficiencies && (
                <div className="bg-gray-800/40 border border-gray-700 rounded p-3 space-y-2">
                  <div className="text-sm font-medium text-gray-300">熟练项</div>
                  {charClass.proficiencies.armor && charClass.proficiencies.armor.length > 0 && (
                    <div className="text-xs">
                      <span className="text-gray-500">护甲：</span>
                      <span className="text-white">{[...new Set(charClass.proficiencies.armor.map(formatProficiency))].join("、")}</span>
                    </div>
                  )}
                  {charClass.proficiencies.weapons && charClass.proficiencies.weapons.length > 0 && (
                    <div className="text-xs">
                      <span className="text-gray-500">武器：</span>
                      <span className="text-white">{[...new Set(charClass.proficiencies.weapons.map(formatProficiency))].join("、")}</span>
                    </div>
                  )}
                  {charClass.proficiencies.tools && charClass.proficiencies.tools.length > 0 && (
                    <div className="text-xs">
                      <span className="text-gray-500">工具：</span>
                      <span className="text-white">{[...new Set(charClass.proficiencies.tools.map(formatProficiency))].join("、")}</span>
                    </div>
                  )}
                </div>
              )}

              {/* 职业特性（当前等级） */}
              {Array.isArray(charClass.features) && (() => {
                const fightingStyle = extractValue(character.fighting_style || character.fightingStyle);
                const enemy = extractValue(character.favored_enemy || character.favoredEnemy);
                const humanoids = (character.favored_humanoid_races || character.favoredHumanoidRaces as string[]) || [];
                const terrain = extractValue(character.favored_terrain || character.favoredTerrain);
                const metamagics = extractArray(character.metamagic_options || character.metamagicOptions);
                const invocations = extractArray(character.eldritch_invocations || character.eldritchInvocations);

                return (
                <div className="bg-gray-800/40 border border-gray-700 rounded p-3">
                  <div className="text-sm font-medium text-gray-300 mb-2">职业特性（{character.level}级）</div>
                  <div className="space-y-2 max-h-60 overflow-auto">
                    {charClass.features
                      .filter((f: any) => (f.level ?? 0) <= (character.level || 1))
                      .map((feat: any, idx: number) => {
                        const featureName = feat.name || "";
                        return (
                        <div key={idx} className="text-xs">
                          <div className="text-amber-300 font-medium">
                            {featureName}{feat.level ? ` (${feat.level}级)` : ""}
                          </div>
                          <div className="text-gray-400 whitespace-pre-wrap">{feat.description}</div>

                          {/* Fighting Style */}
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

                          {/* Favored Enemy */}
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

                          {/* Favored Terrain */}
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

                          {/* Metamagic */}
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

                          {/* Eldritch Invocations */}
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

              {/* 子职业特性 */}
              {subclass && (subclass as any).level1Features && (
                <div className="bg-gray-800/40 border border-gray-700 rounded p-3">
                  <div className="text-sm font-medium text-gray-300 mb-2">子职业特性（{subclass.name}）</div>
                  <div className="space-y-2">
                    {((subclass as any).level1Features as any[]).map((feat: any, idx: number) => (
                      <div key={idx} className="text-xs">
                        <div className="text-amber-300 font-medium">{feat.name}</div>
                        <div className="text-gray-400 whitespace-pre-wrap">{feat.description || feat.features}</div>
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

