import React, { useEffect, useState } from "react";
import { formatFightingStyle, getFightingStyleDescription, formatMetamagic, formatEldritchInvocation, formatFavoredEnemy, formatHumanoid, formatFavoredTerrain } from "../../utils/formatting";
import classResourcesData from "~/data/rules/class_resources.json";
import subclassSpellsData from "~/data/rules/subclass-spells.json";
import invocationsData from "~/data/rules/eldritch_invocations.json";
import type { ClassResource } from "~/types/classResources";
import { getAssetUrl } from "~/utils/asset-url";
import { spellDataLoader } from "~/services/spellDataLoader";
import { getSubclassStructuredFeatures, getAllSubclassChoices, type SubclassChoice } from "~/utils/classDataLoader";
import { createPortal } from "react-dom";

const allClassResources = (classResourcesData as any).classResources as ClassResource[];
function findActiveResource(classId: string, featureId?: string, featureName?: string): ClassResource | undefined {
  if (featureId) {
    return allClassResources.find(r => r.classId === classId && r.id === featureId);
  }
  return featureName ? allClassResources.find(r => r.classId === classId && (r.name === featureName || r.nameEn === featureName)) : undefined;
}

function getSubclassSpellsByLevel(classId: string, subclassId: string, charLevel: number): { level: number; spells: { id: string; name: string }[] }[] {
  const data = subclassSpellsData as any;
  let spellMap: Record<string, string[]> | undefined;
  if (classId === 'paladin') spellMap = data.paladin?.[subclassId]?.oathSpells;
  else if (classId === 'cleric') spellMap = data.cleric?.[subclassId]?.domainSpells;
  if (!spellMap) return [];
  const result: { level: number; spells: { id: string; name: string }[] }[] = [];
  for (const [lvlStr, ids] of Object.entries(spellMap)) {
    const lvl = Number(lvlStr);
    if (isNaN(lvl) || lvl > charLevel) continue;
    const spells = (ids as string[]).map(id => {
      const spell = spellDataLoader.getSpellById(id);
      return { id, name: spell?.name || id };
    });
    result.push({ level: lvl, spells });
  }
  return result.sort((a, b) => a.level - b.level);
}

const PACT_BOON_OPTIONS = [
  { id: 'chain', name: '锁链契约', nameEn: 'Pact of the Chain', description: '你学会了「寻找魔宠」法术，可作为仪式施放。可选特殊魔宠形态：小恶魔、伪龙、魔蝠或魔灵。',
    relatedInvocations: [{ name: '缚主之音', nameEn: 'Voice of the Chain Master', level: 5, brief: '与魔宠心灵感应交流' }, { name: '卡瑟利之链', nameEn: 'Chains of Carceri', level: 15, brief: '随意施展「人类定身术」' }] },
  { id: 'blade', name: '剑刃契约', nameEn: 'Pact of the Blade', description: '用动作创造契约武器，选择任何近战武器形态，视为熟练且魔法武器。',
    relatedInvocations: [{ name: '饥渴魔刃', nameEn: 'Thirsting Blade', level: 5, brief: '契约武器攻击两次' }, { name: '饮命者', nameEn: 'Lifedrinker', level: 12, brief: '+CHA黯蚀伤害' }] },
  { id: 'tome', name: '魔典契约', nameEn: 'Pact of the Tome', description: '恩主赐予「影之书」，可从任意职业列表选三个戏法施放。',
    relatedInvocations: [{ name: '远古奥秘之书', nameEn: 'Book of Ancient Secrets', level: 5, brief: '可将仪式法术抄录进影之书' }] },
];

const rechargeLabels: Record<string, string> = {
  short_rest: '短休恢复', long_rest: '长休恢复',
};
const formulaLabels: Record<string, string> = {
  spell_slots: '消耗法术位', fixed: '有限次数', level: '次数=等级',
  cha_mod: '次数=魅力调整值', wis_mod: '次数=感知调整值',
};

const extractValue = (field: any): string | undefined => {
  if (!field) return undefined;
  return typeof field === 'string' ? field : field?.value;
};
const extractArray = (field: any): string[] => {
  if (!field) return [];
  if (Array.isArray(field)) return field.map(item => typeof item === 'string' ? item : item?.value).filter(Boolean);
  return [];
};

interface Props { character: any; charClass: any; subclass: any; allSubclasses?: any[]; onOpenInvEncyc: () => void; openSpellDetail: (id: string) => void; }
type Feature = { id?: string; name: string; description: string; level?: number; options?: any[]; choices?: string[]; terrainChoices?: string[]; _source?: string; };

export function ClassFeaturesSection({ character, charClass, subclass, allSubclasses, onOpenInvEncyc, openSpellDetail }: Props) {
  const [subclassFeatureMap, setSubclassFeatureMap] = useState<Map<string, { id?: string; description: string }>>(new Map());
  const [showSubclassModal, setShowSubclassModal] = useState(false);
  const [subclassModalData, setSubclassModalData] = useState<{ categoryName: string; categoryNameEn: string; choices: SubclassChoice[] } | null>(null);
  const subs = allSubclasses && allSubclasses.length > 0 ? allSubclasses : (subclass ? [subclass] : []);
  const selectedSubclassIds = new Set(subs.map((sc: any) => sc?.id).filter(Boolean));

  useEffect(() => {
    if (!charClass?.id || subs.length === 0) return;
    let cancelled = false;
    (async () => {
      const map = new Map<string, { id?: string; description: string }>();
      for (const sc of subs) {
        if (!sc?.id) continue;
        const features = await getSubclassStructuredFeatures(charClass.id, sc.id);
        for (const f of features) {
          map.set(`${sc.id}:${f.name}`, { id: f.id, description: f.description });
        }
      }
      if (!cancelled) setSubclassFeatureMap(map);
    })();
    return () => { cancelled = true; };
  }, [charClass?.id, subs.map(s => s?.id).join(',')]);
  const list = (charClass?.features || []).filter((f: any) => (f.level ?? 0) <= (character.level || 1));
  const allSubLv1 = subs.flatMap((sc: any) => ((sc?.level1Features || []) as any[]).map((f: any) => ({ ...f, _source: sc.name })));
  const normalize = (x: any): Feature => ({ id: x.id, name: x.name || x.nameEn || "", description: x.description || x.features || "", level: x.level, options: x.options, choices: x.choices, terrainChoices: x.terrainChoices, _source: x._source });
  const all: Feature[] = [...list.map(normalize), ...allSubLv1.map(normalize)];
  const enemy = extractValue(character.favored_enemy || character.favoredEnemy);
  const humanoids = (character.favored_humanoid_races || character.favoredHumanoidRaces as string[]) || [];
  const terrain = extractValue(character.favored_terrain || character.favoredTerrain);
  const fightingStyle = extractValue(character.fighting_style || character.fightingStyle);
  const metamagics = extractArray(character.metamagic_options || character.metamagicOptions);
  const invocations = extractArray(character.eldritch_invocations || character.eldritchInvocations);
  const pactBoon = (character.subclass_choices || character.subclassChoices)?.pactBoon as string | undefined;
  // Parse subclass features string — use structured data for descriptions
  const subclassFeatures: Feature[] = [];
  for (const sc of subs) {
    const subclassFeaturesStr = sc?.features;
    if (typeof subclassFeaturesStr === 'string' && subclassFeaturesStr.trim()) {
      const featureMatches = subclassFeaturesStr.match(/([^、]+?（\d+级）)/g);
      if (featureMatches) {
        featureMatches.forEach(match => {
          const levelMatch = match.match(/(.+?)（(\d+)级）/);
          if (levelMatch) {
            const featureName = levelMatch[1].trim();
            const featureLevel = parseInt(levelMatch[2], 10);
            if (featureLevel <= (character.level || 1)) {
              // Use structured data (id + description) from classes-progression.json
              const structured = subclassFeatureMap.get(`${sc?.id}:${featureName}`);
              subclassFeatures.push({
                id: structured?.id,
                name: featureName,
                description: structured?.description || `${sc?.name || '子职业'}${featureLevel}级特性`,
                level: featureLevel,
                _source: sc?.name,
              });
            }
          }
        });
      }
    }
  }
  const allFeatures = [...all, ...subclassFeatures].sort((a, b) => (a.level || 0) - (b.level || 0));

  return (
    <div className="space-y-2 max-h-[45dvh] overflow-auto pr-1">
      {allFeatures.length === 0 && <div className="text-xs text-gray-500">无</div>}
      {allFeatures.map((f, i) => {
        const featureName = f.name || "";
        const activeResource = charClass?.id ? findActiveResource(charClass.id, f.id, featureName) : undefined;
        const isActive = !!activeResource && activeResource.maxFormula !== 'passive';
        return (
          <div key={i} className={`rounded-lg border-l-2 ${isActive ? 'border-l-amber-500/70 bg-amber-950/10 border border-amber-700/30' : f._source ? 'border-l-purple-500/50 bg-gray-800/30 border border-gray-700/40' : 'border-l-amber-700/40 bg-gray-800/30 border border-gray-700/40'} pl-3 pr-2 py-2`}>
            <div className="text-sm text-gray-200 font-medium flex items-center gap-2 flex-wrap">
              {isActive && activeResource && (
                <img src={getAssetUrl(`assets/class-feature-icons/${activeResource.id}.png`)} alt="" className="w-7 h-7 rounded flex-shrink-0 object-cover" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
              )}
              <span>{featureName}{f.level ? `（${f.level}级）` : ""}</span>
              {f._source && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-900/40 text-purple-300 border border-purple-700/40">{f._source}</span>}
              {isActive && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-900/40 border border-amber-700/50 text-amber-300">主动</span>}
            </div>
            <div className="text-xs text-gray-400 whitespace-pre-wrap mt-0.5">{f.description}</div>

            {/* Oath/Domain spells */}
            {/誓约法术|领域法术|Oath Spells|Domain Spells/.test(featureName) && character.subclass_id && charClass?.id && (() => {
              const groups = getSubclassSpellsByLevel(charClass.id, character.subclass_id, character.level || 1);
              if (groups.length === 0) return null;
              return (
                <div className="mt-1.5 space-y-1">
                  <div className="text-[10px] text-purple-400 font-medium">自动准备法术：</div>
                  {groups.map(g => (
                    <div key={g.level} className="flex items-start gap-1 text-[11px]">
                      <span className="text-gray-500 w-8 shrink-0">{g.level}级</span>
                      <span className="text-purple-300">{g.spells.map(s => s.name).join('、')}</span>
                    </div>
                  ))}
                </div>
              );
            })()}

            {isActive && activeResource && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {activeResource.maxFormula && formulaLabels[activeResource.maxFormula] && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-900/30 border border-blue-800/40 text-blue-300">{formulaLabels[activeResource.maxFormula]}</span>
                )}
                {activeResource.recharge && rechargeLabels[activeResource.recharge] && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-900/30 border border-green-800/40 text-green-300">{rechargeLabels[activeResource.recharge]}</span>
                )}
              </div>
            )}

            {/* Ranger: Favored Enemy */}
            {/宿敌|Favored Enemy/.test(featureName) && f.choices && f.choices.length > 0 && (
              <ExpandableChoice
                label={enemy ? `已选择：${enemy === "humanoids" ? `类人生物（${humanoids.map(formatHumanoid).join("、")}）` : formatFavoredEnemy(enemy)}` : "未选择"}
                btnText="查看全部类型"
              >
                <div className="flex flex-wrap gap-1.5">
                  {f.choices.map((id: string) => {
                    const sel = id === enemy;
                    return <span key={id} className={`text-xs rounded px-2 py-1 ${sel ? "bg-green-900/40 border border-green-700 text-green-300 font-medium" : "bg-gray-800/60 text-gray-400"}`}>{sel && "✦ "}{formatFavoredEnemy(id)}</span>;
                  })}
                </div>
              </ExpandableChoice>
            )}

            {/* Ranger: Favored Terrain */}
            {/偏好地形|天生探险家|自然探险家|自然探索者|Natural Explorer/.test(featureName) && f.terrainChoices && f.terrainChoices.length > 0 && (
              <ExpandableChoice label={terrain ? `已选择：${formatFavoredTerrain(terrain)}` : "未选择"} btnText="查看全部地形">
                <div className="flex flex-wrap gap-1.5">
                  {f.terrainChoices.map((id: string) => {
                    const sel = id === terrain;
                    return <span key={id} className={`text-xs rounded px-2 py-1 ${sel ? "bg-green-900/40 border border-green-700 text-green-300 font-medium" : "bg-gray-800/60 text-gray-400"}`}>{sel && "✦ "}{formatFavoredTerrain(id)}</span>;
                  })}
                </div>
              </ExpandableChoice>
            )}

            {/* Fighting Style */}
            {/战斗风格|Fighting Style/.test(featureName) && f.options && f.options.length > 0 && (
              <ExpandableChoice label={fightingStyle ? `已选择：${formatFightingStyle(fightingStyle)}` : "未选择"} btnText="查看全部风格">
                <div className="space-y-1.5">
                  {f.options.map((opt: any) => {
                    const sel = opt.id === fightingStyle;
                    return (
                      <div key={opt.id} className={`text-xs rounded px-2 py-1.5 ${sel ? "bg-green-900/40 border border-green-700" : "bg-gray-800/60"}`}>
                        <span className={sel ? "text-green-300 font-medium" : "text-gray-300"}>{sel && "✦ "}{opt.name}</span>
                        <span className="text-gray-500 ml-1">({opt.nameEn})</span>
                        <div className="text-gray-400 mt-0.5">{opt.description}</div>
                      </div>
                    );
                  })}
                </div>
              </ExpandableChoice>
            )}
            {/战斗风格|Fighting Style/.test(featureName) && !(f.options && f.options.length > 0) && fightingStyle && (
              <div className="mt-1">
                <div className="text-xs text-green-300">已选择：{formatFightingStyle(fightingStyle)}</div>
                {getFightingStyleDescription(fightingStyle) && <div className="text-xs text-gray-400 mt-0.5 pl-2 border-l-2 border-green-800">{getFightingStyleDescription(fightingStyle)}</div>}
              </div>
            )}

            {/* Subclass selection — expandable + modal trigger */}
            {/武技范型|范型|Martial Archetype|子职业|Subclass|学院|领域|结社|誓约|道途|血统|学派/.test(featureName) && !/契约恩赐|Pact Boon/.test(featureName) && subs.length > 0 && (
              <>
                <ExpandableChoice label={`已选择：${subs.map((sc: any) => sc.name).join('、')}`} btnText="点击查看">
                  <div className="space-y-3">
                    {subs.map((sc: any, idx: number) => (
                      <div key={idx}>
                        {subs.length > 1 && <div className="text-xs text-purple-300 font-medium mb-1">{sc.name}</div>}
                        {sc.description && <div className="text-xs text-gray-300">{sc.description}</div>}
                        {typeof sc.features === 'string' && sc.features && (
                          <div className="text-xs mt-1"><span className="text-amber-400">全部特性：</span><span className="text-gray-400">{sc.features}</span></div>
                        )}
                      </div>
                    ))}
                  </div>
                </ExpandableChoice>
                <button
                  type="button"
                  className="mt-1 text-[10px] text-purple-400 hover:text-purple-300 underline underline-offset-2 cursor-pointer"
                  onClick={() => {
                    if (!charClass?.id) return;
                    getAllSubclassChoices(charClass.id).then(result => {
                      if (result) {
                        setSubclassModalData(result);
                        setShowSubclassModal(true);
                      }
                    });
                  }}
                >
                  查看所有{featureName}选项
                </button>
              </>
            )}

            {/* Warlock: Pact Boon */}
            {/契约恩赐|Pact Boon/.test(featureName) && (() => {
              const selectedOpt = PACT_BOON_OPTIONS.find(o => o.id === pactBoon);
              return (
                <ExpandableChoice label={selectedOpt ? `已选择：${selectedOpt.name}` : '未选择'} btnText="查看全部契约">
                  <div className="space-y-1.5">
                    {PACT_BOON_OPTIONS.map(opt => {
                      const sel = opt.id === pactBoon;
                      return (
                        <div key={opt.id} className={`text-xs rounded px-2 py-1.5 ${sel ? 'bg-green-900/40 border border-green-700' : 'bg-gray-800/60'}`}>
                          <span className={sel ? 'text-green-300 font-medium' : 'text-gray-300'}>{sel && '✦ '}{opt.name}</span>
                          <span className="text-gray-500 ml-1">({opt.nameEn})</span>
                          <div className="text-gray-400 mt-0.5">{opt.description}</div>
                          {opt.relatedInvocations.length > 0 && (
                            <div className="mt-1 pt-1 border-t border-gray-700/50">
                              <span className="text-purple-400">相关祈唤：</span>
                              {opt.relatedInvocations.map(inv => (
                                <div key={inv.nameEn} className="text-gray-400 ml-2 mt-0.5">
                                  <span className="text-purple-300">{inv.name}</span>
                                  <span className="text-gray-600 ml-1">Lv{inv.level}</span>
                                  <span className="text-gray-500 ml-1">- {inv.brief}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </ExpandableChoice>
              );
            })()}

            {/* Sorcerer: Metamagic */}
            {/超魔|Metamagic/.test(featureName) && f.options && f.options.length > 0 && (
              <ExpandableChoice label={metamagics.length > 0 ? `已选择：${metamagics.map(formatMetamagic).join("、")}` : "未选择"} btnText="查看全部超魔">
                <div className="space-y-1.5">
                  {f.options.map((opt: any) => {
                    const sel = metamagics.includes(opt.id);
                    return (
                      <div key={opt.id} className={`text-xs rounded px-2 py-1.5 ${sel ? "bg-green-900/40 border border-green-700" : "bg-gray-800/60"}`}>
                        <span className={sel ? "text-green-300 font-medium" : "text-gray-300"}>{sel && "✦ "}{opt.name}</span>
                        <span className="text-gray-500 ml-1">({opt.nameEn})</span>
                        {opt.cost && <span className="text-amber-400/70 ml-1">- {opt.cost}点</span>}
                        <div className="text-gray-400 mt-0.5">{opt.description}</div>
                      </div>
                    );
                  })}
                </div>
              </ExpandableChoice>
            )}
            {/超魔|Metamagic/.test(featureName) && !(f.options && f.options.length > 0) && metamagics.length > 0 && (
              <div className="text-xs text-green-300 mt-1">已选择：{metamagics.map(formatMetamagic).join("、")}</div>
            )}

            {/* Warlock: Eldritch Invocations */}
            {/魔能祈唤|Eldritch Invocations/.test(featureName) && invocations && invocations.length > 0 && (
              <details className="mt-1" open>
                <summary className="text-xs text-green-300 cursor-pointer hover:text-green-200">
                  已选择 {invocations.length} 个祈唤 <span className="text-green-500 text-[10px]">▶ 查看详情</span>
                  <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); onOpenInvEncyc(); }} className="ml-2 inline-flex items-center justify-center w-4 h-4 rounded-full bg-purple-800/60 border border-purple-600/50 text-purple-300 hover:bg-purple-700/60 hover:text-purple-200 text-[9px] font-bold transition-colors" title="查看全部魔能祈唤">?</button>
                </summary>
                <div className="mt-2 pl-2 border-l-2 border-green-800 space-y-1.5">
                  {invocations.map((invId: string) => {
                    const invData = (invocationsData as any).invocations?.find((inv: any) => inv.id === invId);
                    if (!invData) return <div key={invId} className="text-xs text-gray-400">{formatEldritchInvocation(invId)}</div>;
                    const mechanicalHint = MECHANICAL_HINTS[invId] || null;
                    return (
                      <div key={invId} className="bg-gray-800/60 border border-gray-700 rounded px-2 py-1.5">
                        <div className="flex items-center gap-1.5">
                          {invData.grantedSpell && <img src={getAssetUrl(`assets/spell-icons/${invData.grantedSpell.id}.png`)} alt="" className="w-5 h-5 rounded flex-shrink-0 object-cover" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />}
                          <span className="text-xs text-green-300 font-medium">{invData.name}</span>
                          <span className="text-[10px] text-gray-500">{invData.nameEn}</span>
                        </div>
                        {mechanicalHint && <div className="text-[10px] text-amber-400 mt-0.5">{mechanicalHint}</div>}
                        <div className="text-[11px] text-gray-400 mt-0.5">{invData.description}</div>
                        {renderSpellLinks(invData, openSpellDetail)}
                      </div>
                    );
                  })}
                </div>
              </details>
            )}

            {/* Monk: Elemental Disciplines */}
            {/元素门徒|元素戒律|Elemental Disciplin/.test(featureName) && (() => {
              const sc = character.subclass_choices || character.subclassChoices || {};
              const disciplines: string[] = sc.elementalDisciplines || [];
              if (disciplines.length === 0) return null;
              const allAbilities = (classResourcesData as any).resourceAbilities || [];
              return (
                <details className="mt-1" open>
                  <summary className="text-xs text-teal-300 cursor-pointer hover:text-teal-200">
                    已掌握 {disciplines.length} 个法门 <span className="text-teal-500 text-[10px]">▶ 查看详情</span>
                  </summary>
                  <div className="mt-2 pl-2 border-l-2 border-teal-800 space-y-1.5">
                    {disciplines.map((dId: string) => {
                      const dData = allAbilities.find((a: any) => a.id === dId && a.resourceId === 'elemental_disciplines');
                      if (!dData) return <div key={dId} className="text-xs text-gray-400">{dId}</div>;
                      return (
                        <div key={dId} className="bg-gray-800/60 border border-gray-700 rounded px-2 py-1.5">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs text-teal-300 font-medium">{dData.name}</span>
                            <span className="text-[10px] text-gray-500">{dData.nameEn}</span>
                            <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-teal-900/40 text-teal-300">{dData.cost === 0 ? '免费' : `${dData.cost}气`}</span>
                          </div>
                          <div className="text-[11px] text-gray-400 mt-0.5">{dData.description}</div>
                          {dData.linkedSpell && <SpellLinkButton spellId={dData.linkedSpell} onClick={openSpellDetail} />}
                        </div>
                      );
                    })}
                  </div>
                </details>
              );
            })()}
          </div>
        );
      })}

      {/* Subclass modal */}
      {showSubclassModal && subclassModalData && createPortal(
        <div className="fixed inset-0 z-[10200] flex items-center justify-center" onClick={() => setShowSubclassModal(false)}>
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
          <div
            className="relative bg-gray-900 border border-purple-700/50 rounded-xl shadow-2xl w-[90vw] max-w-3xl max-h-[85vh] flex flex-col"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-700/60">
              <div>
                <h2 className="text-base font-bold text-purple-200">{subclassModalData.categoryName}</h2>
                <span className="text-xs text-gray-500">{subclassModalData.categoryNameEn}</span>
              </div>
              <button type="button" onClick={() => setShowSubclassModal(false)} className="text-gray-400 hover:text-white text-lg px-2">✕</button>
            </div>
            {/* Content */}
            <div className="overflow-auto p-4 space-y-3">
              {subclassModalData.choices.map(sc => {
                const isSelected = selectedSubclassIds.has(sc.id);
                return (
                  <div key={sc.id} className={`rounded-lg border ${isSelected ? 'border-green-600/60 bg-green-950/20' : 'border-gray-700/50 bg-gray-800/40'} p-3`}>
                    <div className="flex items-center gap-2 mb-1">
                      {isSelected && <span className="text-green-400 text-sm">✦</span>}
                      <span className={`text-sm font-semibold ${isSelected ? 'text-green-300' : 'text-gray-200'}`}>{sc.name}</span>
                      <span className="text-xs text-gray-500">{sc.nameEn}</span>
                      {isSelected && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-900/50 border border-green-700/50 text-green-300">当前选择</span>}
                    </div>
                    {sc.description && <div className="text-xs text-gray-400 mb-2">{sc.description}</div>}
                    {sc.features.length > 0 && (
                      <div className="space-y-1 pl-2 border-l-2 border-purple-800/50">
                        {sc.features.map((feat, fi) => (
                          <div key={fi} className="text-xs">
                            <span className="text-purple-400">{feat.level}级</span>
                            <span className="text-gray-300 ml-1.5 font-medium">{feat.name}</span>
                            <div className="text-gray-500 mt-0.5 pl-3">{feat.description}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

function ExpandableChoice({ label, btnText, children }: { label: string; btnText: string; children: React.ReactNode }) {
  return (
    <details className="mt-1">
      <summary className="text-xs text-green-300 cursor-pointer hover:text-green-200">
        {label} <span className="text-green-500 text-[10px]">▶ {btnText}</span>
      </summary>
      <div className="mt-2 pl-2 border-l-2 border-green-800">{children}</div>
    </details>
  );
}

const MECHANICAL_HINTS: Record<string, string> = {
  armor_of_shadows: '无甲AC = 13 + 敏捷', beguiling_influence: '获得欺瞒、游说熟练',
  devils_sight: '暗视120尺（含魔法黑暗）', agonizing_blast: 'EB伤害 + 魅力调整值',
  repelling_blast: 'EB命中推远10尺', eldritch_spear: 'EB射程300尺',
  thirsting_blade: '契约武器攻击次数: 2', lifedrinker: '契约武器 + CHA黯蚀伤害',
};

function SpellLinkButton({ spellId, onClick }: { spellId: string; onClick: (id: string) => void }) {
  const sp = spellDataLoader.getSpellById(spellId);
  if (!sp) return null;
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); onClick(spellId); }} className="flex items-center gap-1.5 w-full px-2 py-1 rounded bg-indigo-900/20 border border-indigo-700/30 hover:bg-indigo-900/40 transition-colors text-left">
      <img src={getAssetUrl(`assets/spell-icons/${spellId}.png`)} alt="" className="w-4 h-4 rounded flex-shrink-0" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
      <span className="text-[11px] text-indigo-300 font-medium truncate">{sp.name}</span>
      <span className="text-[10px] text-gray-500 truncate">{sp.nameEn}</span>
      <span className="ml-auto text-[10px] text-indigo-400 flex-shrink-0">查看 ▸</span>
    </button>
  );
}

function renderSpellLinks(invData: any, openSpellDetail: (id: string) => void) {
  const spellIds = new Set<string>();
  if (invData.grantedSpell?.id) spellIds.add(invData.grantedSpell.id);
  if (invData.prerequisite?.cantrip) spellIds.add(invData.prerequisite.cantrip);
  if (spellIds.size === 0) return null;
  return (
    <div className="mt-1.5 space-y-1">
      {Array.from(spellIds).map(sid => <SpellLinkButton key={sid} spellId={sid} onClick={openSpellDetail} />)}
    </div>
  );
}
