import { useState } from "react";
import { LatexText } from "~/components/ui/LatexText";
import { SpellSelectableCard, SpellDetailModal } from "~/components/spell/SpellSelectableCard";
import type { SpellCardData } from "~/components/spell/SpellSelectableCard";
import { CharacterState, Race } from "./types";
import {
  hasLevel1Subclass,
  isSpellcaster,
  usesPreparedSpells,
  getFightingStyles,
  getFavoredEnemies,
  getFavoredTerrains,
  getHumanoidRaces,
  getSkillName,
  getLanguageName,
  ALL_SKILLS,
  ABILITIES
} from "./utils";
import { EldritchInvocationSelector } from "./EldritchInvocationSelector";
import spellsData from "~/data/rules/spells.json";
import subclassSpellsData from "~/data/rules/subclass-spells.json";
import { getRacialSpells } from "./CharacterDisplay/utils/spellcasting";
import { getRecommendedDeityForDomain, getRecommendedDeityForOath } from "~/utils/deity-domain-mapping";
import { getAssetUrl } from "~/utils/asset-url";
import { isCurrentUserAdmin } from "~/utils/permissions";
import { createLogger } from '~/utils/logger';
const logger = createLogger('Step3ClassFeatures');


interface Step3ClassFeaturesProps {
  character: CharacterState;
  setCharacter: React.Dispatch<React.SetStateAction<CharacterState>>;
  currentClass: any;
}

// Check if a feature is a domain/oath/expanded spell feature
const isDomainSpellFeature = (feature: any) => {
  const en = (feature.nameEn || '').toLowerCase();
  return en.includes('domain spells') || en.includes('oath spells') || en.includes('expanded spell');
};

// Get full subclass spell list (all levels) from subclass-spells.json
const getSubclassSpellsByLevel = (classId: string, subclassId: string): Record<string, string[]> | null => {
  const classData = (subclassSpellsData as any)[classId];
  const subclassData = classData?.[subclassId];
  if (!subclassData) return null;
  return subclassData.domainSpells || subclassData.oathSpells || subclassData.expandedSpells || null;
};

// Look up spell info by ID
const getSpellById = (spellId: string) => {
  return spellsData.spells.find((s: any) => s.id === spellId);
};

// Utility function to get spells available for a class at a given level
// Also includes subclass expanded spells when applicable
const getAvailableSpells = (classId: string, spellLevel: number, subclassId?: string) => {
  const baseSpells = spellsData.spells.filter((spell: any) =>
    spell.level === spellLevel && spell.classes.includes(classId)
  );

  // Merge subclass expanded spells (e.g. warlock patron expanded list)
  if (subclassId) {
    const classData = (subclassSpellsData as any)[classId];
    const subclassData = classData?.[subclassId];
    const expandedIds: string[] = subclassData?.expandedSpells?.[String(spellLevel)]
      || subclassData?.domainSpells?.[String(spellLevel)]
      || subclassData?.oathSpells?.[String(spellLevel)]
      || [];
    if (expandedIds.length > 0) {
      const baseIds = new Set(baseSpells.map((s: any) => s.id));
      const extraSpells = spellsData.spells.filter((spell: any) =>
        spell.level === spellLevel && expandedIds.includes(spell.id) && !baseIds.has(spell.id)
      );
      return [...baseSpells, ...extraSpells];
    }
  }

  return baseSpells;
};

// School icon emoji fallback
const SCHOOL_ICONS: Record<string, string> = {
  abjuration: '🛡️', conjuration: '🌀', divination: '👁️', enchantment: '💫',
  evocation: '🔥', illusion: '🌫️', necromancy: '💀', transmutation: '⚗️',
};
const SCHOOL_BG: Record<string, string> = {
  abjuration: 'bg-blue-900/40 border-blue-700/50',
  conjuration: 'bg-purple-900/40 border-purple-700/50',
  divination: 'bg-gray-800/40 border-gray-600/50',
  enchantment: 'bg-pink-900/40 border-pink-700/50',
  evocation: 'bg-red-900/40 border-red-700/50',
  illusion: 'bg-indigo-900/40 border-indigo-700/50',
  necromancy: 'bg-green-900/40 border-green-700/50',
  transmutation: 'bg-yellow-900/40 border-yellow-700/50',
};

/** Domain/Oath/Expanded spell list with icons and click-to-detail */
function DomainSpellList({ spellsByLevel }: { spellsByLevel: Record<string, string[]> }) {
  const [selectedSpell, setSelectedSpell] = useState<any>(null);

  return (
    <div className="mt-1.5 space-y-1.5">
      <div className="text-[10px] text-gray-500 mb-1">自动准备，不占准备数</div>
      {Object.entries(spellsByLevel)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([lvl, spellIds]) => (
          <div key={lvl}>
            <div className="text-[10px] text-gray-500 mb-1">{lvl}级</div>
            <div className="grid grid-cols-2 gap-1.5">
              {(spellIds as string[]).map((sid) => {
                const spell = getSpellById(sid);
                if (!spell) return <span key={sid} className="text-xs text-gray-500">{sid}</span>;
                return (
                  <button
                    key={sid}
                    type="button"
                    onClick={() => setSelectedSpell(spell)}
                    className="flex items-center gap-1.5 px-1.5 py-1 rounded bg-gray-800/50 border border-gray-700/40
                      hover:border-blue-600/50 hover:bg-gray-700/50 transition-colors text-left"
                  >
                    <div className={`w-6 h-6 rounded border flex-shrink-0 flex items-center justify-center overflow-hidden
                      ${SCHOOL_BG[spell.school] || 'bg-gray-800 border-gray-700'}`}>
                      {spell.iconPath ? (
                        <img
                          src={getAssetUrl(spell.iconPath)}
                          alt=""
                          className="w-full h-full object-cover"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                      ) : (
                        <span className="text-xs">{SCHOOL_ICONS[spell.school] || '✨'}</span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs text-gray-200 truncate">{spell.name}</div>
                      <div className="text-[9px] text-gray-500 truncate">{spell.nameEn}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}

      <SpellDetailModal spell={selectedSpell} onClose={() => setSelectedSpell(null)} />
    </div>
  );
}

function Step3ClassFeatures({ character, setCharacter, currentClass }: Step3ClassFeaturesProps) {
  const [expandedSubclasses, setExpandedSubclasses] = useState<Set<string>>(new Set());
  const [detailSpell, setDetailSpell] = useState<SpellCardData | null>(null);
  // Admin: multi-subclass testing mode
  const [multiSubclassMode, setMultiSubclassMode] = useState(false);
  const [selectedSubclassIds, setSelectedSubclassIds] = useState<Set<string>>(new Set());
  const showAdminToggle = isCurrentUserAdmin();

  if (!currentClass) {
    return (
      <div className="text-center text-gray-400 py-12">
        <p>请先选择一个职业</p>
      </div>
    );
  }

  const classId = currentClass.id;
  const spellcaster = isSpellcaster(classId);
  const preparedCaster = usesPreparedSpells(classId);
  const isFighter = classId === "fighter";
  const isRogue = classId === "rogue";
  const isRanger = classId === "ranger";
  const hasSubclass = hasLevel1Subclass(classId);

  // Get spellcasting info from class data
  const spellcastingInfo = currentClass.spellcasting;
  const cantripsKnownBase = spellcastingInfo?.cantripsKnown?.["1"] || 0;
  // For wizard, use spellbook.starting; for other classes, use spellsKnown
  const spellsKnown = spellcastingInfo?.spellbook?.starting || spellcastingInfo?.spellsKnown?.["1"] || 0;

  // Extract bonus cantrips from selected subclass features
  const bonusCantrips: string[] = [];
  let bonusCantripChoiceCount = 0;
  let bonusCantripChoiceList = '';
  const activeSubclassIds = multiSubclassMode
    ? Array.from(selectedSubclassIds)
    : character.subclassId ? [character.subclassId] : [];

  if (currentClass.subclasses) {
    for (const scId of activeSubclassIds) {
      const selSub = currentClass.subclasses.find((sc: any) => sc.id === scId);
      if (selSub?.level1Features) {
        selSub.level1Features.forEach((f: any) => {
          if (f.structuredData?.bonusCantrips?.length) {
            bonusCantrips.push(...f.structuredData.bonusCantrips);
          }
          if (f.structuredData?.bonusCantripChoice) {
            bonusCantripChoiceCount += f.structuredData.bonusCantripChoice.count || 1;
            bonusCantripChoiceList = f.structuredData.bonusCantripChoice.list;
          }
        });
      }
    }
  }
  const bonusCantripSet = new Set(bonusCantrips);

  // Racial cantrips (e.g., Forest Gnome's Minor Illusion, High Elf's chosen cantrip)
  const racialSpellsData = getRacialSpells(character.raceId, character.subraceId || null, 1, character.raceChoices);
  const racialCantripIds = new Set(racialSpellsData.filter(rs => rs.level === 0).map(rs => rs.id));

  // cantripsKnown includes bonus cantrip choice slots (e.g. Nature Domain: +1 druid cantrip)
  // Also add extra slots when subclass bonus cantrip overlaps with racial cantrip
  // (D&D rule: "If you already know this cantrip, you learn a different wizard cantrip of your choice")
  const bonusCantripOverlapCount = bonusCantrips.filter(c => racialCantripIds.has(c)).length;
  const cantripsKnown = cantripsKnownBase + bonusCantripChoiceCount + bonusCantripOverlapCount;

  // Get available spells (including subclass expanded spells), excluding racial cantrips
  let availableCantrips = spellcaster
    ? getAvailableSpells(classId, 0, character.subclassId).filter((s: any) => !racialCantripIds.has(s.id))
    : [];

  // bonusCantripChoice: merge cantrips from the choice list (e.g. druid cantrips for Nature Domain cleric)
  if (bonusCantripChoiceCount > 0 && bonusCantripChoiceList) {
    const existingIds = new Set(availableCantrips.map((s: any) => s.id));
    const extraCantrips = spellsData.spells.filter((s: any) =>
      s.level === 0 && s.classes?.includes(bonusCantripChoiceList) && !existingIds.has(s.id) && !racialCantripIds.has(s.id)
    );
    availableCantrips = [...availableCantrips, ...extraCantrips];
  }

  const availableLevel1Spells = spellcaster ? getAvailableSpells(classId, 1, character.subclassId) : [];

  // User-selected cantrips excluding bonus ones (for count purposes)
  const userSelectedCantrips = (character.selectedCantrips || []).filter(id => !bonusCantripSet.has(id) && !racialCantripIds.has(id));

  // Toggle spell selection
  const toggleCantrip = (spellId: string) => {
    if (bonusCantripSet.has(spellId) || racialCantripIds.has(spellId)) return;
    setCharacter(prev => {
      const current = prev.selectedCantrips || [];
      const isSelected = current.includes(spellId);

      if (isSelected) {
        return { ...prev, selectedCantrips: current.filter(id => id !== spellId) };
      } else if (multiSubclassMode || current.filter(id => !bonusCantripSet.has(id)).length < cantripsKnown) {
        return { ...prev, selectedCantrips: [...current, spellId] };
      }
      return prev;
    });
  };

  const toggleSpell = (spellId: string) => {
    setCharacter(prev => {
      const current = prev.selectedSpells || [];
      const isSelected = current.includes(spellId);

      if (isSelected) {
        return { ...prev, selectedSpells: current.filter(id => id !== spellId) };
      } else if (multiSubclassMode || current.length < spellsKnown) {
        return { ...prev, selectedSpells: [...current, spellId] };
      }
      return prev;
    });
  };

  const toggleFightingStyle = (styleId: string) => {
    setCharacter(prev => ({
      ...prev,
      fightingStyle: prev.fightingStyle === styleId ? "" : styleId
    }));
  };

  const toggleExpertise = (skillId: string) => {
    setCharacter(prev => {
      const current = prev.expertiseSkills || [];
      const isSelected = current.includes(skillId);
      const maxSkills = prev.expertiseThievesTools ? 1 : 2; // If using thieves' tools, only 1 skill allowed

      if (isSelected) {
        return { ...prev, expertiseSkills: current.filter(id => id !== skillId) };
      } else if (current.length < maxSkills) {
        return { ...prev, expertiseSkills: [...current, skillId] };
      }
      return prev;
    });
  };

  const toggleThievesToolsExpertise = () => {
    setCharacter(prev => {
      const newValue = !prev.expertiseThievesTools;
      // If enabling thieves' tools and have 2 skills, remove one
      const currentSkills = prev.expertiseSkills || [];
      const newSkills = newValue && currentSkills.length > 1
        ? [currentSkills[0]]
        : currentSkills;

      return {
        ...prev,
        expertiseThievesTools: newValue,
        expertiseSkills: newSkills
      };
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-amber-400 mb-2">职业特性</h2>
        <p className="text-gray-400 text-sm">
          选择你的{currentClass.name}初始能力
        </p>
      </div>

      {/* Initial Ability Selection Checklist */}
      {(hasSubclass || cantripsKnown > 0 || spellsKnown > 0 || isFighter || isRogue || isRanger) ? (
      <div className="bg-blue-900/20 border border-blue-700/30 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-blue-400 mb-3 flex items-center gap-2">
          <span>📋</span>
          <span>1级需要选择的初始能力</span>
        </h3>
        <ul className="space-y-2 text-sm">
          {/* Subclass selection for level 1 subclass classes */}
          {hasSubclass && (
            <li className="flex items-start gap-2">
              <span className={character.subclassId ? "text-green-400" : "text-amber-400"}>
                {character.subclassId ? "✓" : "○"}
              </span>
              <span className={character.subclassId ? "text-gray-300 line-through" : "text-white"}>
                选择子职业
                {classId === "cleric" && "（神圣领域）"}
                {classId === "sorcerer" && "（术法起源）"}
                {classId === "warlock" && "（异界宗主）"}
              </span>
            </li>
          )}

          {/* Cantrips */}
          {cantripsKnown > 0 && (
            <li className="flex items-start gap-2">
              <span className={userSelectedCantrips.length >= cantripsKnown ? "text-green-400" : "text-amber-400"}>
                {userSelectedCantrips.length >= cantripsKnown ? "✓" : "○"}
              </span>
              <span className={userSelectedCantrips.length >= cantripsKnown ? "text-gray-300 line-through" : "text-white"}>
                选择 {cantripsKnown} 个戏法
                {bonusCantrips.length > 0 && bonusCantripOverlapCount === 0 && (
                  <span className="text-green-400 ml-1 text-xs">（+{bonusCantrips.length} 子职业赠送）</span>
                )}
                {bonusCantripOverlapCount > 0 && (
                  <span className="text-purple-400 ml-1 text-xs">（+{bonusCantripOverlapCount} 额外自选，因种族已有赠送戏法）</span>
                )}
                {bonusCantripChoiceCount > 0 && (
                  <span className="text-blue-400 ml-1 text-xs">（含{bonusCantripChoiceCount}个{bonusCantripChoiceList === 'druid' ? '德鲁伊' : '法师'}戏法自选）</span>
                )}
                {racialCantripIds.size > 0 && (
                  <span className="text-cyan-400 ml-1 text-xs">（+{racialCantripIds.size} 种族天赋）</span>
                )}
                <span className="text-gray-500 ml-2 text-xs">
                  （已选 {userSelectedCantrips.length}/{cantripsKnown}）
                </span>
              </span>
            </li>
          )}

          {/* Spells */}
          {spellsKnown > 0 && (
            <li className="flex items-start gap-2">
              <span className={(character.selectedSpells?.length || 0) >= spellsKnown ? "text-green-400" : "text-amber-400"}>
                {(character.selectedSpells?.length || 0) >= spellsKnown ? "✓" : "○"}
              </span>
              <span className={(character.selectedSpells?.length || 0) >= spellsKnown ? "text-gray-300 line-through" : "text-white"}>
                {classId === "wizard"
                  ? `选择 ${spellsKnown} 个1环法术记入法术书`
                  : preparedCaster
                  ? `准备 ${spellsKnown} 个1环法术`
                  : `选择 ${spellsKnown} 个1环法术`}
                <span className="text-gray-500 ml-2 text-xs">
                  （已选 {character.selectedSpells?.length || 0}/{spellsKnown}）
                </span>
              </span>
            </li>
          )}

          {/* Fighter: Fighting Style */}
          {isFighter && (
            <li className="flex items-start gap-2">
              <span className={character.fightingStyle ? "text-green-400" : "text-amber-400"}>
                {character.fightingStyle ? "✓" : "○"}
              </span>
              <span className={character.fightingStyle ? "text-gray-300 line-through" : "text-white"}>
                选择战斗风格
              </span>
            </li>
          )}

          {/* Rogue: Expertise */}
          {isRogue && (
            <li className="flex items-start gap-2">
              <span className={(character.expertiseSkills?.length || 0) >= 2 || character.expertiseThievesTools ? "text-green-400" : "text-amber-400"}>
                {(character.expertiseSkills?.length || 0) >= 2 || character.expertiseThievesTools ? "✓" : "○"}
              </span>
              <span className={(character.expertiseSkills?.length || 0) >= 2 || character.expertiseThievesTools ? "text-gray-300 line-through" : "text-white"}>
                选择专精（2项技能或盗贼工具+1项技能）
                <span className="text-gray-500 ml-2 text-xs">
                  （已选 {(character.expertiseSkills?.length || 0) + (character.expertiseThievesTools ? 1 : 0)}/2）
                </span>
              </span>
            </li>
          )}

          {/* Ranger: Favored Enemy & Favored Terrain */}
          {isRanger && (
            <>
              <li className="flex items-start gap-2">
                <span className={character.favoredEnemy ? "text-green-400" : "text-amber-400"}>
                  {character.favoredEnemy ? "✓" : "○"}
                </span>
                <span className={character.favoredEnemy ? "text-gray-300 line-through" : "text-white"}>
                  选择宿敌类型
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className={character.favoredTerrain ? "text-green-400" : "text-amber-400"}>
                  {character.favoredTerrain ? "✓" : "○"}
                </span>
                <span className={character.favoredTerrain ? "text-gray-300 line-through" : "text-white"}>
                  选择偏好地形
                </span>
              </li>
            </>
          )}

          {/* Subclass feature choices (e.g., Knowledge Domain) */}
          {character.subclassId && (() => {
            const selectedSubclass = currentClass.subclasses?.find((sc: any) => sc.id === character.subclassId);
            if (selectedSubclass?.featureChoices) {
              return selectedSubclass.featureChoices.map((fc: any, idx: number) =>
                fc.choices.map((choice: any, cIdx: number) => {
                  let isComplete = false;
                  let currentCount = 0;
                  const requiredCount = choice.count;

                  if (choice.type === "dragon_type") {
                    isComplete = !!character.subclassChoices.dragonType;
                    currentCount = isComplete ? 1 : 0;
                  } else if (choice.type === "language") {
                    currentCount = character.subclassChoices.language?.length || 0;
                    isComplete = currentCount >= requiredCount;
                  } else if (choice.type === "skill") {
                    currentCount = character.subclassChoices.skill?.length || 0;
                    isComplete = currentCount >= requiredCount;
                  } else if (choice.type === "cantrip") {
                    currentCount = character.subclassChoices.cantrips?.length || 0;
                    isComplete = currentCount >= requiredCount;
                  }

                  return (
                    <li key={`${idx}-${cIdx}`} className="flex items-start gap-2">
                      <span className={isComplete ? "text-green-400" : "text-amber-400"}>
                        {isComplete ? "✓" : "○"}
                      </span>
                      <span className={isComplete ? "text-gray-300 line-through" : "text-white"}>
                        {choice.description}
                        <span className="text-gray-500 ml-2 text-xs">
                          （已选 {currentCount}/{requiredCount}）
                        </span>
                      </span>
                    </li>
                  );
                })
              );
            }
            return null;
          })()}
        </ul>
      </div>
      ) : (
      <div className="text-center text-gray-400 py-8 bg-gray-800/30 rounded-lg">
        <p>此职业在1级时没有需要选择的特殊特性</p>
        <p className="text-sm mt-2">你将自动获得职业基础能力，点击"下一步"继续</p>
      </div>
      )}

      {/* Level 1 Subclass Selection (Cleric, Sorcerer, Warlock) */}
      {hasSubclass && currentClass.subclasses && currentClass.subclasses.length > 0 && (
        <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-lg font-semibold text-amber-300">
              选择子职业 {character.subclassId ? "✓" : ""}
            </h3>
            {showAdminToggle && (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => {
                    const next = !multiSubclassMode;
                    setMultiSubclassMode(next);
                    if (next) {
                      // Enter multi-mode: seed from current selection
                      setSelectedSubclassIds(character.subclassId ? new Set([character.subclassId]) : new Set());
                    } else {
                      // Exit multi-mode: keep first selected as subclassId
                      setSelectedSubclassIds(new Set());
                    }
                  }}
                  className={`px-2 py-1 text-[10px] rounded border transition-colors ${
                    multiSubclassMode
                      ? "bg-red-900/40 border-red-600/50 text-red-300"
                      : "bg-gray-700/50 border-gray-600/50 text-gray-400 hover:text-gray-200"
                  }`}
                >
                  {multiSubclassMode ? "Debug ON" : "Debug"}
                </button>
                <span
                  onClick={() => alert("Debug模式：可多选子职业并获得所有特性，戏法和法术选择不限数量。仅供测试，法术会自动去重。")}
                  className="w-4 h-4 flex items-center justify-center rounded-full bg-gray-700/60
                    text-gray-400 hover:text-blue-300 text-[9px] font-bold cursor-pointer"
                >?</span>
              </div>
            )}
          </div>
          <p className="text-sm text-gray-400 mb-3">
            {classId === "cleric" && "选择你侍奉的神圣领域"}
            {classId === "sorcerer" && "选择你的术法起源"}
            {classId === "warlock" && "选择你的异界宗主"}
          </p>
          {multiSubclassMode && (
            <div className="flex gap-2 mb-3">
              <button
                onClick={() => {
                  const allIds = new Set<string>(currentClass.subclasses.map((sc: any) => sc.id));
                  setSelectedSubclassIds(allIds);
                  const firstId = currentClass.subclasses[0]?.id || "";
                  setCharacter(p => ({ ...p, subclassId: firstId, selectedCantrips: [], selectedSpells: [], preparedSpells: [] }));
                }}
                className="px-2 py-1 text-xs rounded bg-amber-800/40 border border-amber-600/40 text-amber-300 hover:bg-amber-700/40"
              >
                全选
              </button>
              <button
                onClick={() => {
                  setSelectedSubclassIds(new Set());
                  setCharacter(p => ({ ...p, subclassId: "", selectedCantrips: [], selectedSpells: [], preparedSpells: [] }));
                }}
                className="px-2 py-1 text-xs rounded bg-gray-700/50 border border-gray-600/40 text-gray-400 hover:text-gray-200"
              >
                清空
              </button>
              <span className="text-xs text-gray-500 self-center ml-1">
                已选 {selectedSubclassIds.size}/{currentClass.subclasses.length}
              </span>
            </div>
          )}
          <div className="grid grid-cols-1 gap-3">
            {currentClass.subclasses.map((subclass: any) => {
              const isSelected = multiSubclassMode
                ? selectedSubclassIds.has(subclass.id)
                : character.subclassId === subclass.id;
              const isExpanded = expandedSubclasses.has(subclass.id);
              const hasDetailedFeatures = subclass.level1Features && subclass.level1Features.length > 0;

              return (
                <div key={subclass.id} className="relative">
                  <div
                    role="button"
                    tabIndex={0}
                    className={`w-full p-4 rounded-lg border text-left transition-all cursor-pointer ${
                      isSelected
                        ? "border-amber-400 bg-amber-400/10"
                        : "border-gray-600 hover:border-gray-500 bg-gray-800/30"
                    }`}
                    onClick={(e) => {
                      // Don't toggle subclass if clicking on interactive children
                      if ((e.target as HTMLElement).closest('[data-no-toggle]')) return;
                      if (multiSubclassMode) {
                        // Multi-select: toggle this subclass
                        const next = new Set(selectedSubclassIds);
                        if (next.has(subclass.id)) {
                          next.delete(subclass.id);
                        } else {
                          next.add(subclass.id);
                        }
                        setSelectedSubclassIds(next);
                        const arr = Array.from(next);
                        setCharacter(p => ({
                          ...p,
                          subclassId: arr.join(",") || "",
                          selectedCantrips: [],
                          selectedSpells: [],
                          preparedSpells: [],
                        }));
                        return;
                      }
                      setCharacter(prev => {
                        const newSubclassId = isSelected ? "" : subclass.id;
                        let updates: Partial<CharacterState> = {
                          subclassId: newSubclassId,
                          // Reset spells when changing subclass
                          selectedCantrips: [],
                          selectedSpells: [],
                          preparedSpells: [],
                        };

                        // Auto-assign deity for Cleric domains
                        if (classId === "cleric" && newSubclassId) {
                          const recommendedDeity = getRecommendedDeityForDomain(newSubclassId);
                          if (recommendedDeity) {
                            updates.deityId = recommendedDeity;
                            logger.debug(`✅ Auto-assigned deity for ${subclass.name}: ${recommendedDeity}`);
                          }
                        }

                        // Auto-assign deity for Paladin oaths
                        if (classId === "paladin" && newSubclassId) {
                          const recommendedDeity = getRecommendedDeityForOath(newSubclassId);
                          if (recommendedDeity) {
                            updates.deityId = recommendedDeity;
                            logger.debug(`✅ Auto-assigned deity for ${subclass.name}: ${recommendedDeity}`);
                          }
                        }

                        return { ...prev, ...updates };
                      });
                    }}
                  >
                    <div className="flex items-start gap-3">
                      <span className="text-amber-400 text-lg mt-0.5">
                        {multiSubclassMode
                          ? (isSelected ? "☑" : "☐")
                          : (isSelected ? "●" : "○")}
                      </span>
                      <div className="flex-1">
                        <div className="flex items-baseline gap-2 mb-1">
                          <div className="font-semibold text-amber-300">
                            {subclass.name}
                          </div>
                          <div className="text-xs text-gray-500">
                            {subclass.nameEn}
                          </div>
                        </div>
                        {subclass.description && (
                          <div className="text-sm text-gray-300 mb-2">
                            {subclass.description}
                          </div>
                        )}
                        {subclass.features && (
                          <div className="text-xs text-gray-400 bg-gray-900/50 rounded px-2 py-1 mb-2">
                            <span className="text-amber-400/70">核心特性：</span> {subclass.features}
                          </div>
                        )}

                        {/* Level 1 Features Summary (Always Visible) */}
                        {hasDetailedFeatures && !isExpanded && (
                          <div className="mt-2 bg-amber-900/10 border border-amber-700/20 rounded px-3 py-2">
                            <div className="text-xs font-semibold text-amber-400/90 mb-1.5">
                              📜 1级获得能力：
                            </div>
                            <ul className="text-xs text-gray-300 space-y-0.5">
                              {subclass.level1Features.map((feature: any, idx: number) => (
                                <li key={idx} className="flex items-start gap-1.5">
                                  <span className="text-amber-400/60 mt-0.5">•</span>
                                  <span>
                                    <span className="font-medium text-amber-300">{feature.name}</span>
                                    <span className="text-gray-500 ml-1.5 text-[10px]">{feature.nameEn}</span>
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* Detailed Level 1 Features (Expanded) */}
                        {hasDetailedFeatures && isExpanded && (
                          <div className="mt-3 pt-3 border-t border-gray-700 space-y-2">
                            <div className="text-xs font-semibold text-amber-400 mb-2">📜 1级详细特性说明：</div>
                            {subclass.level1Features.map((feature: any, idx: number) => {
                              const isSpellFeature = isDomainSpellFeature(feature);
                              const spellsByLevel = isSpellFeature
                                ? getSubclassSpellsByLevel(classId, subclass.id)
                                : null;

                              return (
                                <div key={idx} className="bg-gray-900/30 rounded p-2">
                                  <div className="flex items-baseline gap-2 mb-1">
                                    <div className="text-xs font-medium text-amber-300">
                                      {feature.name}
                                    </div>
                                    <div className="text-xs text-gray-500">
                                      {feature.nameEn}
                                    </div>
                                  </div>
                                  {spellsByLevel ? (
                                    <div data-no-toggle>
                                      <DomainSpellList spellsByLevel={spellsByLevel} />
                                    </div>
                                  ) : (
                                    <div className="text-xs text-gray-400 leading-relaxed">
                                      {feature.description}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* Interactive Feature Choices */}
                        {isSelected && subclass.featureChoices && subclass.featureChoices.length > 0 && (
                          <div data-no-toggle className="mt-3 pt-3 border-t border-amber-700/30 space-y-3">
                            <div className="text-xs font-semibold text-amber-400 mb-2">
                              ⚙️ 特性选择（必选）
                            </div>
                            {subclass.featureChoices.map((featureChoice: any, fcIdx: number) => (
                              <div key={fcIdx} className="bg-amber-900/10 border border-amber-700/30 rounded p-3 space-y-3">
                                <div className="text-xs font-medium text-amber-300 mb-2">
                                  {featureChoice.featureName} - {featureChoice.featureNameEn}
                                </div>

                                {featureChoice.choices.map((choice: any, cIdx: number) => {
                                  // Calculate current selection count based on type
                                  let currentCount = 0;
                                  if (choice.type === "dragon_type") {
                                    currentCount = character.subclassChoices.dragonType ? 1 : 0;
                                  } else {
                                    currentCount = (character.subclassChoices as any)[choice.type]?.length || 0;
                                  }

                                  return (
                                    <div key={cIdx} className="space-y-2">
                                      <div className="text-xs text-gray-300">
                                        {choice.description}
                                        <span className="text-amber-400 ml-1">
                                          ({currentCount}/{choice.count})
                                        </span>
                                      </div>

                                    {/* Render options based on type */}
                                    {choice.type === "dragon_type" && (
                                      <div className="grid grid-cols-2 gap-2">
                                        {choice.options.map((option: any) => {
                                          const isChosen = character.subclassChoices.dragonType === option.id;
                                          return (
                                            <button
                                              key={option.id}
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setCharacter(prev => ({
                                                  ...prev,
                                                  subclassChoices: {
                                                    ...prev.subclassChoices,
                                                    dragonType: isChosen ? undefined : option.id
                                                  }
                                                }));
                                              }}
                                              className={`p-2 rounded text-left text-xs transition-all ${
                                                isChosen
                                                  ? "bg-amber-500/20 border border-amber-400"
                                                  : "bg-gray-800/50 border border-gray-600 hover:border-gray-500"
                                              }`}
                                            >
                                              <div className="flex items-center gap-2">
                                                <span className="text-amber-400">{isChosen ? "●" : "○"}</span>
                                                <div className="flex-1">
                                                  <div className="font-medium text-white">{option.name}</div>
                                                  <div className="text-gray-500 text-xs">{option.nameEn}</div>
                                                  <div className="text-amber-400 text-xs mt-0.5">
                                                    伤害类型: {option.damageType}
                                                  </div>
                                                </div>
                                              </div>
                                            </button>
                                          );
                                        })}
                                      </div>
                                    )}

                                    {/* Cantrip selection - load from spells.json */}
                                    {choice.type === "cantrip" && choice.options === "druid_cantrips" && (
                                      <div className="grid grid-cols-1 gap-2">
                                        {spellsData.spells
                                          .filter((s: any) => s.level === 0 && s.classes.includes("druid"))
                                          .map((spell: any) => {
                                            const currentChoices = character.subclassChoices.cantrips || [];
                                            const isChosen = currentChoices.includes(spell.id);
                                            const canSelect = isChosen || multiSubclassMode || currentChoices.length < choice.count;

                                            return (
                                              <button
                                                key={spell.id}
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  if (!canSelect && !isChosen) return;

                                                  setCharacter(prev => {
                                                    const current = prev.subclassChoices.cantrips || [];
                                                    const newChoices = isChosen
                                                      ? current.filter((id: string) => id !== spell.id)
                                                      : [...current, spell.id];

                                                    return {
                                                      ...prev,
                                                      subclassChoices: {
                                                        ...prev.subclassChoices,
                                                        cantrips: newChoices
                                                      }
                                                    };
                                                  });
                                                }}
                                                disabled={!canSelect && !isChosen}
                                                className={`p-2 rounded text-left text-xs transition-all ${
                                                  isChosen
                                                    ? "bg-amber-500/20 border border-amber-400"
                                                    : canSelect
                                                    ? "bg-gray-800/50 border border-gray-600 hover:border-gray-500"
                                                    : "bg-gray-900/30 border border-gray-700 opacity-50 cursor-not-allowed"
                                                }`}
                                              >
                                                <div className="flex items-center gap-2">
                                                  <span className="text-amber-400">{isChosen ? "✓" : "○"}</span>
                                                  <div className="flex-1">
                                                    <div className="font-medium text-white flex items-center gap-1">
                                                      {spell.name}
                                                      {spell.concentration && <span className="text-purple-400 text-xs" title="专注">👁️</span>}
                                                    </div>
                                                    <div className="text-gray-500 text-xs mb-1">{spell.nameEn}</div>
                                                    <div className="text-gray-400 text-xs line-clamp-2">
                                                      <LatexText>{spell.description}</LatexText>
                                                    </div>
                                                  </div>
                                                </div>
                                              </button>
                                            );
                                          })}
                                      </div>
                                    )}

                                    {(choice.type === "language" || choice.type === "skill") && (
                                      <div className="grid grid-cols-2 gap-2">
                                        {choice.options.map((option: any) => {
                                          const currentChoices = (character.subclassChoices as any)[choice.type] || [];
                                          const isChosen = currentChoices.includes(option.id);
                                          const canSelect = isChosen || currentChoices.length < choice.count;

                                          return (
                                            <button
                                              key={option.id}
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                if (!canSelect && !isChosen) return;

                                                setCharacter(prev => {
                                                  const current = (prev.subclassChoices as any)[choice.type] || [];
                                                  const newChoices = isChosen
                                                    ? current.filter((id: string) => id !== option.id)
                                                    : [...current, option.id];

                                                  return {
                                                    ...prev,
                                                    subclassChoices: {
                                                      ...prev.subclassChoices,
                                                      [choice.type]: newChoices
                                                    }
                                                  };
                                                });
                                              }}
                                              disabled={!canSelect && !isChosen}
                                              className={`p-2 rounded text-left text-xs transition-all ${
                                                isChosen
                                                  ? "bg-amber-500/20 border border-amber-400"
                                                  : canSelect
                                                  ? "bg-gray-800/50 border border-gray-600 hover:border-gray-500"
                                                  : "bg-gray-900/30 border border-gray-700 opacity-50 cursor-not-allowed"
                                              }`}
                                            >
                                              <div className="flex items-center gap-2">
                                                <span className="text-amber-400">{isChosen ? "✓" : "○"}</span>
                                                <div className="flex-1">
                                                  <div className="font-medium text-white">{option.name}</div>
                                                  <div className="text-gray-500 text-xs">{option.nameEn}</div>
                                                </div>
                                              </div>
                                            </button>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </div>
                                  );
                                })}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Expand/Collapse Button for Detailed Features */}
                  {hasDetailedFeatures && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedSubclasses(prev => {
                          const next = new Set(prev);
                          if (next.has(subclass.id)) {
                            next.delete(subclass.id);
                          } else {
                            next.add(subclass.id);
                          }
                          return next;
                        });
                      }}
                      className="absolute bottom-3 right-3 text-xs text-amber-400 hover:text-amber-300 bg-gray-900/80 px-2 py-1 rounded"
                    >
                      {isExpanded ? "收起详情" : "查看详情"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Warlock: Eldritch Invocations */}
      {classId === "warlock" && character.subclassId && (
        <EldritchInvocationSelector
          character={character}
          setCharacter={setCharacter}
        />
      )}

      {/* Spellcaster: Cantrips and Spells */}
      {spellcaster && (
        <div className="space-y-6">
          {/* Cantrips */}
          {(cantripsKnown > 0 || bonusCantrips.length > 0 || racialCantripIds.size > 0) && (
            <div>
              <h3 className="text-lg font-semibold text-amber-300 mb-2">
                选择戏法 ({userSelectedCantrips.length}/{multiSubclassMode ? '∞' : cantripsKnown})
                {bonusCantrips.length > 0 && bonusCantripOverlapCount === 0 && (
                  <span className="text-sm text-green-400 font-normal ml-2">+{bonusCantrips.length} 子职业赠送</span>
                )}
                {bonusCantripChoiceCount > 0 && (
                  <span className="text-sm text-blue-400 font-normal ml-2">含{bonusCantripChoiceCount}个{bonusCantripChoiceList === 'druid' ? '德鲁伊' : '法师'}戏法自选</span>
                )}
                {racialCantripIds.size > 0 && (
                  <span className="text-sm text-cyan-400 font-normal ml-2">+{racialCantripIds.size} 种族天赋</span>
                )}
              </h3>
              {bonusCantripOverlapCount > 0 && (
                <p className="text-sm text-purple-300 mb-2 bg-purple-900/20 border border-purple-700/30 rounded px-3 py-1.5">
                  你已通过种族特性习得了子职业赠送的戏法，因此可额外自选 {bonusCantripOverlapCount} 个法师戏法作为替代
                </p>
              )}
              <p className="text-sm text-gray-400 mb-3">
                戏法是可以无限次施放的基础法术
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-96 overflow-y-auto pr-2">
                {/* Racial cantrips first (locked, non-selectable) */}
                {Array.from(racialCantripIds).map(cantripId => {
                  const spell = spellsData.spells.find((s: any) => s.id === cantripId);
                  if (!spell) return null;
                  return (
                    <SpellSelectableCard
                      key={`racial-${spell.id}`}
                      spell={spell as any}
                      isSelected={true}
                      canSelect={false}
                      onClick={() => {}}
                      onDetailClick={setDetailSpell}
                      color="cyan"
                      indicator="★"
                      badgeLabel="种族天赋"
                    />
                  );
                })}
                {/* Bonus + regular cantrips */}
                {[...availableCantrips]
                  .sort((a: any, b: any) => {
                    // Bonus cantrips first
                    const aBonus = bonusCantripSet.has(a.id) ? 0 : 1;
                    const bBonus = bonusCantripSet.has(b.id) ? 0 : 1;
                    return aBonus - bBonus;
                  })
                  .map((spell: any) => {
                  const isBonus = bonusCantripSet.has(spell.id);
                  const isSelected = isBonus || character.selectedCantrips?.includes(spell.id);
                  const canSelect = !isBonus && !isSelected && (multiSubclassMode || userSelectedCantrips.length < cantripsKnown);

                  return (
                    <SpellSelectableCard
                      key={spell.id}
                      spell={spell}
                      isSelected={!!isSelected}
                      canSelect={canSelect}
                      onClick={() => !isBonus && toggleCantrip(spell.id)}
                      onDetailClick={setDetailSpell}
                      color={isBonus ? 'green' : 'amber'}
                      indicator={isBonus ? '★' : undefined}
                      badgeLabel={isBonus ? '领域赠送' : undefined}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {/* Level 1 Spells */}
          {spellsKnown > 0 && (
            <div>
              <h3 className="text-lg font-semibold text-amber-300 mb-2">
                {classId === "wizard" ? "选择法术书起始法术" : "选择1环法术"} ({character.selectedSpells?.length || 0}/{multiSubclassMode ? '∞' : spellsKnown})
              </h3>
              <p className="text-sm text-gray-400 mb-3">
                {classId === "wizard"
                  ? "法师：选择6个1环法术记录在你的法术书中"
                  : preparedCaster
                  ? "准备施法者：你可以从完整法术列表中准备法术"
                  : "已知施法者：你学习特定的法术"}
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-96 overflow-y-auto pr-2">
                {availableLevel1Spells.map((spell: any) => {
                  const isSelected = character.selectedSpells?.includes(spell.id);
                  const canSelect = !isSelected && (multiSubclassMode || (character.selectedSpells?.length || 0) < spellsKnown);

                  return (
                    <SpellSelectableCard
                      key={spell.id}
                      spell={spell}
                      isSelected={!!isSelected}
                      canSelect={canSelect}
                      onClick={() => toggleSpell(spell.id)}
                      onDetailClick={setDetailSpell}
                      subtitle={`${spell.nameEn || ''} • ${spell.school || ''}`}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Fighter: Fighting Style */}
      {isFighter && (
        <div>
          <h3 className="text-lg font-semibold text-amber-300 mb-2">
            选择战斗风格 {character.fightingStyle ? "✓" : ""}
          </h3>
          <p className="text-sm text-gray-400 mb-3">
            选择一种战斗风格来增强你的战斗能力
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {getFightingStyles().map(style => {
              const isSelected = character.fightingStyle === style.id;

              return (
                <button
                  key={style.id}
                  onClick={() => toggleFightingStyle(style.id)}
                  className={`p-3 rounded-lg border text-left transition-all ${
                    isSelected
                      ? "border-amber-400 bg-amber-400/20"
                      : "border-gray-600 hover:border-gray-500 bg-gray-800/50"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <span className="text-amber-400 mt-0.5">{isSelected ? "●" : "○"}</span>
                    <div className="flex-1">
                      <div className="font-medium text-white text-sm">
                        {style.name}
                      </div>
                      <div className="text-xs text-gray-500 mb-1">
                        {style.nameEn}
                      </div>
                      <div className="text-xs text-gray-400">
                        {style.description}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Rogue: Expertise */}
      {isRogue && (
        <div>
          <h3 className="text-lg font-semibold text-amber-300 mb-2">
            选择专精
          </h3>
          <p className="text-sm text-gray-400 mb-3">
            选择两个技能熟练项，或一个技能熟练项和盗贼工具。你的熟练加值将翻倍。
          </p>

          {/* Thieves' Tools Option */}
          <div className="mb-4">
            <button
              onClick={toggleThievesToolsExpertise}
              className={`p-3 rounded border text-left transition-all w-full ${
                character.expertiseThievesTools
                  ? "border-amber-400 bg-amber-400/20"
                  : "border-gray-600 hover:border-gray-500 bg-gray-800/30"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-amber-400">{character.expertiseThievesTools ? "●" : "○"}</span>
                <div className="flex-1">
                  <div className="font-medium text-white text-sm">
                    盗贼工具专精
                  </div>
                  <div className="text-xs text-gray-400 mt-1">
                    选择此项后，你只能再选择1个技能专精
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    工具包含：细锉刀、撬锁工具、附炳小镜、尖嘴剪、镊子
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    用途：解除陷阱、撬锁时熟练加值翻倍
                  </div>
                </div>
              </div>
            </button>
          </div>

          {/* Skills Selection */}
          <div>
            <div className="text-sm text-gray-400 mb-2">
              技能专精 ({character.expertiseSkills?.length || 0}/{character.expertiseThievesTools ? 1 : 2})
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {character.selectedSkills.map(skillId => {
                const isSelected = character.expertiseSkills?.includes(skillId);
                const maxSkills = character.expertiseThievesTools ? 1 : 2;
                const canSelect = !isSelected && (character.expertiseSkills?.length || 0) < maxSkills;

                return (
                  <button
                    key={skillId}
                    onClick={() => toggleExpertise(skillId)}
                    disabled={!isSelected && !canSelect}
                    className={`p-2 rounded border text-sm text-left transition-all ${
                      isSelected
                        ? "border-amber-400 bg-amber-400/20 text-amber-300"
                        : canSelect
                          ? "border-gray-600 hover:border-gray-500 text-gray-300"
                          : "border-gray-700 text-gray-600 cursor-not-allowed"
                    }`}
                  >
                    <span className="mr-1">{isSelected ? "✓" : "○"}</span>
                    {getSkillName(skillId)}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Ranger: Favored Enemy and Favored Terrain */}
      {isRanger && (
        <div className="space-y-6">
          {/* Favored Enemy */}
          <div>
            <h3 className="text-lg font-semibold text-amber-300 mb-2">
              选择宿敌 {character.favoredEnemy ? "✓" : ""}
            </h3>
            <p className="text-sm text-gray-400 mb-3">
              选择一种生物类型作为你的宿敌。追踪宿敌时，你的感知(求生)检定和回想宿敌信息的智力检定具有优势。
            </p>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
              {getFavoredEnemies().map(enemy => {
                const isSelected = character.favoredEnemy === enemy.id;

                return (
                  <button
                    key={enemy.id}
                    onClick={() => {
                      setCharacter(prev => ({
                        ...prev,
                        favoredEnemy: isSelected ? "" : enemy.id,
                        // Clear humanoid races if switching away from humanoids
                        favoredHumanoidRaces: enemy.id === "humanoids" ? prev.favoredHumanoidRaces : []
                      }));
                    }}
                    className={`p-3 rounded border text-left transition-all ${
                      isSelected
                        ? "border-amber-400 bg-amber-400/20"
                        : "border-gray-600 hover:border-gray-500 bg-gray-800/30"
                    }`}
                  >
                    <div className="font-medium text-white text-sm">
                      {enemy.name}
                    </div>
                    <div className="text-xs text-gray-500">
                      {enemy.nameEn}
                    </div>

                  </button>
                );
              })}
            </div>

            {/* Humanoid Races Selection (when humanoids is selected) */}
            {character.favoredEnemy === "humanoids" && (
              <div className="mt-4 p-4 bg-gray-800/50 rounded-lg border border-gray-700">
                <h4 className="text-sm font-semibold text-amber-300 mb-2">
                  选择两个类人生物种族 ({character.favoredHumanoidRaces.length}/2)
                </h4>
                <p className="text-xs text-gray-400 mb-3">
                  从下列种族中选择两个作为你的宿敌
                </p>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                  {getHumanoidRaces().map(race => {
                    const isSelected = character.favoredHumanoidRaces.includes(race.id);
                    const canSelect = !isSelected && character.favoredHumanoidRaces.length < 2;

                    return (
                      <button
                        key={race.id}
                        onClick={() => {
                          setCharacter(prev => ({
                            ...prev,
                            favoredHumanoidRaces: isSelected
                              ? prev.favoredHumanoidRaces.filter(id => id !== race.id)
                              : canSelect
                                ? [...prev.favoredHumanoidRaces, race.id]
                                : prev.favoredHumanoidRaces
                          }));
                        }}
                        disabled={!isSelected && !canSelect}
                        className={`p-2 rounded border text-left transition-all text-sm ${
                          isSelected
                            ? "border-amber-400 bg-amber-400/20 text-amber-300"
                            : canSelect
                              ? "border-gray-600 hover:border-gray-500 text-gray-300"
                              : "border-gray-700 text-gray-600 cursor-not-allowed"
                        }`}
                      >
                        <span className="mr-1">{isSelected ? "✓" : "○"}</span>
                        {race.name}
                        <div className="text-xs text-gray-500 mt-0.5">
                          {race.nameEn}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Favored Terrain */}
          <div>
            <h3 className="text-lg font-semibold text-amber-300 mb-2">
              选择偏好地形 {character.favoredTerrain ? "✓" : ""}
            </h3>
            <p className="text-sm text-gray-400 mb-3">
              选择一种自然环境作为你的偏好地形。在偏好地形上，你的相关检定可使用双倍熟练加值，且你的队伍获得多项旅行增益。
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {getFavoredTerrains().map(terrain => {
                const isSelected = character.favoredTerrain === terrain.id;

                return (
                  <button
                    key={terrain.id}
                    onClick={() => {
                      setCharacter(prev => ({
                        ...prev,
                        favoredTerrain: isSelected ? "" : terrain.id
                      }));
                    }}
                    className={`p-3 rounded border text-left transition-all ${
                      isSelected
                        ? "border-amber-400 bg-amber-400/20"
                        : "border-gray-600 hover:border-gray-500 bg-gray-800/30"
                    }`}
                  >
                    <div className="font-medium text-white text-sm">
                      {terrain.name}
                    </div>
                    <div className="text-xs text-gray-500">
                      {terrain.nameEn}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <SpellDetailModal spell={detailSpell} onClose={() => setDetailSpell(null)} />
    </div>
  );
}

// Step 4: Ability Scores Component
interface Step4Props {
  character: CharacterState;
  setCharacter: React.Dispatch<React.SetStateAction<CharacterState>>;
  currentRace?: Race;
  currentSubrace?: any;
}

type AbilityScoreMethod = "standard" | "roll" | "pointbuy" | "custompointbuy";



const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];

// Point buy costs
const POINT_BUY_COSTS: Record<number, number> = {
  8: 0,
  9: 1,
  10: 2,
  11: 3,
  12: 4,
  13: 5,
  14: 7,
  15: 9,
};

const POINT_BUY_TOTAL = 27;

export { Step3ClassFeatures };
