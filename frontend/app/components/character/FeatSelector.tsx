import { useState, useEffect, useMemo } from 'react';
import featsData from '~/data/rules/feats.json';
import spellsData from '~/data/rules/spells.json';
import { FeatChoiceSections } from './FeatChoiceSections';
import { useModalContextStore } from '~/stores/modalContextStore';

interface Feat {
  id: string;
  name: string;
  nameEn: string;
  description: string;
  benefits: string[];
  prerequisites?: {
    description: string;
  } | null;
  abilityIncrease?: {
    choices: string[];
    amount: number;
    mustChoose?: boolean;
  };
  choice?: {
    type: string;
    options?: string[];
    count?: number;
  };
}

interface CharacterInfo {
  ability_scores: {
    strength: number;
    dexterity: number;
    constitution: number;
    intelligence: number;
    wisdom: number;
    charisma: number;
  };
  class_id: string;
}

interface FeatSelectorProps {
  onSelect: (featId: string, additionalChoices?: any) => void;
  onCancel: () => void;
  characterLevel?: number;
  characterInfo?: CharacterInfo;
  excludeFeats?: string[];
}

// Classes that can cast spells
const SPELLCASTING_CLASSES = new Set([
  'bard', 'cleric', 'druid', 'paladin', 'ranger', 'sorcerer', 'warlock', 'wizard',
  'eldritch_knight', 'arcane_trickster'
]);

// Armor proficiency by class
const ARMOR_PROFICIENCIES: Record<string, Set<string>> = {
  barbarian: new Set(['light', 'medium']),
  bard: new Set(['light']),
  cleric: new Set(['light', 'medium', 'heavy']),
  druid: new Set(['light', 'medium']),
  fighter: new Set(['light', 'medium', 'heavy']),
  paladin: new Set(['light', 'medium', 'heavy']),
  ranger: new Set(['light', 'medium']),
  rogue: new Set(['light']),
  warlock: new Set(['light']),
};

function checkPrerequisiteMet(feat: Feat, info?: CharacterInfo): boolean | null {
  if (!feat.prerequisites || !info) return null;
  const desc = feat.prerequisites.description;

  // Ability score checks
  const abilityCheck = /(.+?)(\d+)或更高/.exec(desc);
  if (abilityCheck) {
    const abilityText = abilityCheck[1];
    const threshold = parseInt(abilityCheck[2]);
    const abilityMap: Record<string, keyof CharacterInfo['ability_scores']> = {
      '力量': 'strength', '敏捷': 'dexterity', '体质': 'constitution',
      '智力': 'intelligence', '感知': 'wisdom', '魅力': 'charisma',
    };
    // Handle "智力或感知13或更高"
    if (desc.includes('或')) {
      const parts = abilityText.split('或');
      return parts.some(p => {
        const key = abilityMap[p.trim()];
        return key && info.ability_scores[key] >= threshold;
      });
    }
    const key = abilityMap[abilityText.trim()];
    if (key) return info.ability_scores[key] >= threshold;
  }

  // Spellcasting check
  if (desc.includes('施展') && desc.includes('法术')) {
    return SPELLCASTING_CLASSES.has(info.class_id);
  }

  // Armor proficiency checks
  const armorProf = ARMOR_PROFICIENCIES[info.class_id] || new Set();
  if (desc.includes('熟练重甲')) return armorProf.has('heavy');
  if (desc.includes('熟练中甲')) return armorProf.has('medium');
  if (desc.includes('熟练轻甲')) return armorProf.has('light');

  return null; // Unknown prerequisite
}

export function FeatSelector({ onSelect, onCancel, characterLevel = 1, characterInfo, excludeFeats = [] }: FeatSelectorProps) {
  const [selectedFeat, setSelectedFeat] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [additionalChoices, setAdditionalChoices] = useState<any>({});

  // Register modal context for AI chat awareness
  const setModalContext = useModalContextStore(s => s.setModalContext);
  const clearModalContext = useModalContextStore(s => s.clearModalContext);
  useEffect(() => {
    setModalContext('feat-selection', `正在选择专长，角色等级：${characterLevel}，职业：${characterInfo?.class_id || '未知'}`);
    return () => clearModalContext('feat-selection');
  }, [characterLevel, characterInfo?.class_id, setModalContext, clearModalContext]);

  const feats = Object.values(featsData.feats) as Feat[];

  const filteredFeats = feats.filter(feat => {
    // Exclude already-selected feats
    if (excludeFeats.length > 0 && excludeFeats.includes(feat.id)) return false;
    const searchLower = searchTerm.toLowerCase();
    return (
      feat.name.toLowerCase().includes(searchLower) ||
      feat.nameEn.toLowerCase().includes(searchLower) ||
      feat.description.toLowerCase().includes(searchLower)
    );
  });

  const selectedFeatData = selectedFeat
    ? feats.find(f => f.id === selectedFeat)
    : null;

  const canConfirm = (): boolean => {
    if (!selectedFeat) return false;

    // Block if prerequisites not met
    if (selectedFeatData) {
      const prereqMet = checkPrerequisiteMet(selectedFeatData, characterInfo);
      if (prereqMet === false) return false;
    }

    // Check if ability increase choice is needed (when more than 1 option)
    if (selectedFeatData?.abilityIncrease && selectedFeatData.abilityIncrease.choices.length > 1) {
      if (!additionalChoices.abilityChoice) return false;
    }

    // Get full feat data for proficiency_grant checks
    const featFullData = (featsData as any).feats[selectedFeat];
    const pg = featFullData?.effects?.proficiency_grant;

    // Element choice (elemental_adept)
    if (selectedFeatData?.choice?.type === 'element') {
      if (!additionalChoices.choiceValue) return false;
    }

    // proficiency_grant-based choices
    if (pg) {
      if (pg.skills_or_tools && (!additionalChoices.skills || additionalChoices.skills.length < pg.skills_or_tools)) return false;
      if (typeof pg.weapons === 'number' && (!additionalChoices.weapons || additionalChoices.weapons.length < pg.weapons)) return false;
      if (typeof pg.languages === 'number' && (!additionalChoices.languages || additionalChoices.languages.length < pg.languages)) return false;
      if (typeof pg.maneuvers === 'number' && (!additionalChoices.maneuvers || additionalChoices.maneuvers.length < pg.maneuvers)) return false;
      if (typeof pg.cantrips === 'number' && pg.cantrips > 0) {
        if (!additionalChoices.choiceValue) return false;
        if (pg.spells_1st && !additionalChoices.spell) return false;
        const neededCantrips = pg.cantrips;
        if (neededCantrips === 1 && !additionalChoices.cantrip) return false;
        if (neededCantrips > 1 && (!additionalChoices.cantrips || additionalChoices.cantrips.length < neededCantrips)) return false;
      }
      if (pg.ritual_spells_1st && (!additionalChoices.ritualSpells || additionalChoices.ritualSpells.length < pg.ritual_spells_1st)) return false;
    }

    return true;
  };

  const handleConfirm = () => {
    if (!selectedFeat || !canConfirm()) return;
    const finalChoices = { ...additionalChoices };
    // Auto-fill single ability choice
    if (selectedFeatData?.abilityIncrease && selectedFeatData.abilityIncrease.choices.length === 1) {
      finalChoices.abilityChoice = selectedFeatData.abilityIncrease.choices[0];
    }
    onSelect(selectedFeat, finalChoices);
  };

  return (
    <div className="space-y-4">
      {!selectedFeat ? (
        <>
          {/* Search */}
          <div>
            <input
              type="text"
              placeholder="搜索专长..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full px-4 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-green-500"
            />
          </div>

          {/* Feats Grid */}
          <div className="grid grid-cols-2 gap-3 max-h-96 overflow-y-auto pr-2">
            {filteredFeats.map(feat => {
              const prereqMet = checkPrerequisiteMet(feat, characterInfo);
              const isDisabled = prereqMet === false;
              return (
              <button
                key={feat.id}
                onClick={() => !isDisabled && setSelectedFeat(feat.id)}
                disabled={isDisabled}
                className={`p-4 rounded-lg border-2 transition-all text-left group ${
                  isDisabled
                    ? 'border-gray-700 bg-gray-800/50 opacity-50 cursor-not-allowed'
                    : 'border-gray-600 hover:border-green-500 bg-gray-800 hover:bg-gray-750'
                }`}
              >
                <div className="mb-2">
                  <div className="font-bold text-white group-hover:text-green-400 transition-colors">
                    {feat.name}
                  </div>
                  <div className="text-xs text-gray-400">{feat.nameEn}</div>
                </div>
                {feat.prerequisites && (() => {
                  const met = checkPrerequisiteMet(feat, characterInfo);
                  return (
                    <div className={`text-xs mb-2 px-2 py-1 rounded ${
                      met === true ? 'bg-green-900/30 text-green-400' :
                      met === false ? 'bg-red-900/30 text-red-400' :
                      'bg-yellow-900/30 text-yellow-400'
                    }`}>
                      {met === true ? '✓' : met === false ? '✗' : '?'} 前置：{feat.prerequisites.description}
                    </div>
                  );
                })()}
                <div className="text-xs text-gray-400 space-y-0.5">
                  {feat.benefits.map((b, i) => (
                    <div key={i} className="flex items-start gap-1">
                      <span className="text-green-600 shrink-0">•</span>
                      <span className="line-clamp-1">{b}</span>
                    </div>
                  ))}
                </div>
              </button>
              );
            })}
          </div>

          {filteredFeats.length === 0 && (
            <div className="text-center text-gray-500 py-8">
              未找到匹配的专长
            </div>
          )}
        </>
      ) : selectedFeatData && (
        <>
          {/* Feat Details */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xl font-bold text-white">{selectedFeatData.name}</h3>
                <div className="text-sm text-gray-400">{selectedFeatData.nameEn}</div>
              </div>
              <button
                onClick={() => {
                  setSelectedFeat(null);
                  setAdditionalChoices({});
                }}
                className="text-sm text-gray-400 hover:text-white"
              >
                返回列表
              </button>
            </div>

            <div className="p-4 bg-gray-800 rounded-lg border border-gray-700">
              <div className="text-gray-300 mb-3">{selectedFeatData.description}</div>

              {selectedFeatData.prerequisites && (
                <div className="mb-3 p-2 bg-yellow-900/30 border border-yellow-700 rounded text-sm text-yellow-300">
                  <span className="font-bold">前置条件：</span>{selectedFeatData.prerequisites.description}
                </div>
              )}

              <div className="space-y-1">
                <div className="text-sm font-bold text-green-400 mb-2">效果：</div>
                {selectedFeatData.benefits.map((benefit, index) => (
                  <div key={index} className="text-sm text-gray-300 flex items-start">
                    <span className="text-green-500 mr-2">•</span>
                    <span>{benefit}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Spell Sniper: show affected attack-roll spells from character's class */}
            {selectedFeat === 'spell_sniper' && characterInfo?.class_id && (
              <SpellSniperAffectedSpells classId={characterInfo.class_id} />
            )}

            {/* Ability Increase Choice */}
            {selectedFeatData.abilityIncrease && selectedFeatData.abilityIncrease.choices.length > 1 && (
              <div className="p-4 bg-blue-900/30 border border-blue-700 rounded-lg">
                <div className="text-sm font-bold text-blue-300 mb-2">选择属性提升 (+{selectedFeatData.abilityIncrease.amount})：</div>
                <div className="grid grid-cols-3 gap-2">
                  {selectedFeatData.abilityIncrease.choices.map(ability => {
                    const abilityNames: Record<string, string> = {
                      strength: '力量', dexterity: '敏捷', constitution: '体质',
                      intelligence: '智力', wisdom: '感知', charisma: '魅力',
                    };
                    return (
                    <button
                      key={ability}
                      onClick={() => setAdditionalChoices({ ...additionalChoices, abilityChoice: ability })}
                      className={`p-2 rounded border transition-all ${
                        additionalChoices.abilityChoice === ability
                          ? 'border-blue-500 bg-blue-900/50'
                          : 'border-gray-600 hover:border-gray-500'
                      }`}
                    >
                      <div className="text-sm text-white">{abilityNames[ability] || ability}</div>
                      <div className="text-xs text-gray-400">+{selectedFeatData.abilityIncrease?.amount ?? 1}</div>
                    </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Single ability increase - auto display */}
            {selectedFeatData.abilityIncrease && selectedFeatData.abilityIncrease.choices.length === 1 && (() => {
              const ability = selectedFeatData.abilityIncrease!.choices[0];
              const abilityNames: Record<string, string> = {
                strength: '力量', dexterity: '敏捷', constitution: '体质',
                intelligence: '智力', wisdom: '感知', charisma: '魅力',
              };
              return (
                <div className="p-3 bg-blue-900/20 border border-blue-800 rounded-lg">
                  <span className="text-sm text-blue-300">属性提升：{abilityNames[ability] || ability} +{selectedFeatData.abilityIncrease?.amount ?? 1}</span>
                </div>
              );
            })()}

            {/* Element Choice for Elemental Adept */}
            {selectedFeatData.choice?.type === 'element' && (
              <div className="p-4 bg-blue-900/30 border border-blue-700 rounded-lg">
                <div className="text-sm font-bold text-blue-300 mb-2">选择元素类型：</div>
                <div className="grid grid-cols-3 gap-2">
                  {selectedFeatData.choice.options?.map(element => {
                    const elementNames: Record<string, string> = {
                      acid: '强酸',
                      cold: '寒冷',
                      fire: '火焰',
                      lightning: '闪电',
                      thunder: '雷鸣'
                    };
                    return (
                      <button
                        key={element}
                        onClick={() => setAdditionalChoices({ ...additionalChoices, choiceValue: element })}
                        className={`p-2 rounded border transition-all ${
                          additionalChoices.choiceValue === element
                            ? 'border-blue-500 bg-blue-900/50'
                            : 'border-gray-600 hover:border-gray-500'
                        }`}
                      >
                        <div className="text-sm text-white">{elementNames[element]}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Proficiency Grant Choices (skilled, weapon_master, linguist, etc.) */}
            <FeatChoiceSections
              featId={selectedFeat}
              featData={(featsData as any).feats[selectedFeat]}
              additionalChoices={additionalChoices}
              setAdditionalChoices={setAdditionalChoices}
            />
          </div>
        </>
      )}

      {/* Action Buttons */}
      <div className="flex justify-between items-center pt-4 border-t border-gray-700">
        <button
          onClick={onCancel}
          className="px-6 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
        >
          取消
        </button>

        {selectedFeat && (
          <button
            onClick={handleConfirm}
            disabled={!canConfirm()}
            className="px-6 py-2 bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors font-medium"
          >
            选择此专长
          </button>
        )}
      </div>
    </div>
  );
}

// --- Spell Sniper: show which spells from the character's class benefit ---
const ATTACK_TYPES = new Set(['ranged_spell', 'melee_spell']);
const ATTACK_TYPE_CN: Record<string, string> = { ranged_spell: '远程', melee_spell: '近战' };
const CLASS_NAMES_CN: Record<string, string> = {
  bard: '吟游诗人', cleric: '牧师', druid: '德鲁伊', paladin: '圣武士',
  ranger: '游侠', sorcerer: '术士', warlock: '术士(邪术师)', wizard: '法师',
  eldritch_knight: '奥法骑士', arcane_trickster: '诡术师',
};

function SpellSniperAffectedSpells({ classId }: { classId: string }) {
  const spells = (spellsData as any).spells || [];
  const attackSpells = useMemo(() => {
    return spells
      .filter((s: any) =>
        s.classes?.includes(classId) &&
        ATTACK_TYPES.has(s.attackType)
      )
      .sort((a: any, b: any) => (a.level ?? 0) - (b.level ?? 0));
  }, [classId, spells]);

  if (attackSpells.length === 0) {
    return (
      <div className="p-3 bg-yellow-900/20 border border-yellow-800 rounded-lg">
        <div className="text-sm text-yellow-400">
          你的职业（{CLASS_NAMES_CN[classId] || classId}）没有需要攻击检定的法术，此专长的射程翻倍效果对你无用。
        </div>
      </div>
    );
  }

  // Group by level
  const grouped: Record<number, any[]> = {};
  for (const s of attackSpells) {
    const lv = s.level ?? 0;
    (grouped[lv] ??= []).push(s);
  }

  return (
    <div className="p-3 bg-amber-900/20 border border-amber-800/60 rounded-lg space-y-2">
      <div className="text-sm font-bold text-amber-300">
        射程翻倍影响的法术（{CLASS_NAMES_CN[classId] || classId}，共{attackSpells.length}个）
      </div>
      <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
        {Object.entries(grouped).map(([lv, list]) => (
          <div key={lv}>
            <div className="text-xs text-gray-500 mb-0.5">
              {lv === '0' ? '戏法' : `${lv}环`}
            </div>
            <div className="flex flex-wrap gap-1">
              {(list as any[]).map((s: any) => {
                const rangeMatch = s.range?.match(/(\d+)/);
                const range = rangeMatch ? parseInt(rangeMatch[1]) : null;
                return (
                  <span key={s.id} className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-gray-800 border border-gray-700 rounded text-xs">
                    <span className="text-gray-200">{s.name}</span>
                    {range && (
                      <span className="text-amber-400/80">
                        {range}→{range * 2}尺
                      </span>
                    )}
                    <span className="text-gray-600">{ATTACK_TYPE_CN[s.attackType] || ''}</span>
                  </span>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
