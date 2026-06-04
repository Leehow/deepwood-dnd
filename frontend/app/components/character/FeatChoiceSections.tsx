/**
 * FeatChoiceSections — 专长选择UI区块
 * 处理 skilled, weapon_master, linguist, martial_adept,
 * magic_initiate, spell_sniper, ritual_caster 的选择 UI
 */
import { useState, useEffect, useMemo } from 'react';
import skillsData from '~/data/rules/skills.json';
import equipmentData from '~/data/rules/equipment.json';
import classesData from '~/data/rules/classes.json';
import spellsData from '~/data/rules/spells.json';

const ALL_LANGUAGES = [
  { id: 'common', name: '通用语', nameEn: 'Common', category: 'standard' },
  { id: 'dwarvish', name: '矮人语', nameEn: 'Dwarvish', category: 'standard' },
  { id: 'elvish', name: '精灵语', nameEn: 'Elvish', category: 'standard' },
  { id: 'giant', name: '巨人语', nameEn: 'Giant', category: 'standard' },
  { id: 'gnomish', name: '侏儒语', nameEn: 'Gnomish', category: 'standard' },
  { id: 'goblin', name: '地精语', nameEn: 'Goblin', category: 'standard' },
  { id: 'halfling', name: '半身人语', nameEn: 'Halfling', category: 'standard' },
  { id: 'orc', name: '兽人语', nameEn: 'Orc', category: 'standard' },
  { id: 'abyssal', name: '深渊语', nameEn: 'Abyssal', category: 'exotic' },
  { id: 'celestial', name: '天界语', nameEn: 'Celestial', category: 'exotic' },
  { id: 'draconic', name: '龙语', nameEn: 'Draconic', category: 'exotic' },
  { id: 'deep_speech', name: '地底语', nameEn: 'Deep Speech', category: 'exotic' },
  { id: 'infernal', name: '炼狱语', nameEn: 'Infernal', category: 'exotic' },
  { id: 'primordial', name: '原初语', nameEn: 'Primordial', category: 'exotic' },
  { id: 'sylvan', name: '森精语', nameEn: 'Sylvan', category: 'exotic' },
  { id: 'undercommon', name: '地底通用语', nameEn: 'Undercommon', category: 'exotic' },
];

const ABILITY_NAMES: Record<string, string> = {
  strength: '力量', dexterity: '敏捷', constitution: '体质',
  intelligence: '智力', wisdom: '感知', charisma: '魅力',
};

const CLASS_NAMES: Record<string, string> = {
  bard: '吟游诗人', cleric: '牧师', druid: '德鲁伊',
  sorcerer: '术士', warlock: '邪术师', wizard: '法师',
};

interface FeatChoiceSectionsProps {
  featId: string;
  featData: any;
  additionalChoices: any;
  setAdditionalChoices: (c: any) => void;
}

// Toggle an item in an array (add/remove)
function toggleArrayItem(arr: string[] | undefined, item: string, max: number): string[] {
  const current = arr || [];
  if (current.includes(item)) return current.filter(x => x !== item);
  if (current.length >= max) return current;
  return [...current, item];
}

// Get all weapons from equipment.json, flattened with group info
function getAllWeapons() {
  const weapons: { id: string; name: string; nameEn: string; damage: string; damageType: string; group: string }[] = [];
  const eq = equipmentData as any;
  for (const group of ['simple', 'martial'] as const) {
    for (const type of ['melee', 'ranged'] as const) {
      const list = eq.weapons?.[group]?.[type] || [];
      for (const w of list) {
        weapons.push({ id: w.id, name: w.name, nameEn: w.nameEn, damage: w.damage, damageType: w.damageType, group });
      }
    }
  }
  return weapons;
}

// Get battle_master maneuvers from classes.json
function getManeuvers() {
  const fighter = (classesData as any).classes.find((c: any) => c.id === 'fighter');
  const bm = fighter?.subclasses?.find((s: any) => s.id === 'battle_master');
  return (bm as any)?.maneuvers || [];
}

const TIMING_LABELS: Record<string, string> = {
  'attack_action': '攻击动作', 'on_hit': '命中时', 'on_attack': '攻击时',
  'on_attack_roll': '攻击检定时', 'on_move': '移动时', 'bonus_action': '附赠动作',
  'reaction_on_hit': '反应（被命中时）', 'reaction_on_miss': '反应（被未命中时）',
};

const DAMAGE_TYPE_NAMES: Record<string, string> = {
  bludgeoning: '钝击', piercing: '穿刺', slashing: '挥砍',
};

export function FeatChoiceSections({ featId, featData, additionalChoices, setAdditionalChoices }: FeatChoiceSectionsProps) {
  const pg = featData?.effects?.proficiency_grant;
  if (!pg) return null;

  return (
    <>
      {/* Skilled — 3 skills */}
      {pg.skills_or_tools && <SkilledSection count={pg.skills_or_tools} choices={additionalChoices} onChange={setAdditionalChoices} />}

      {/* Weapon Master — 4 weapons */}
      {typeof pg.weapons === 'number' && <WeaponMasterSection count={pg.weapons} choices={additionalChoices} onChange={setAdditionalChoices} />}

      {/* Linguist — 3 languages */}
      {typeof pg.languages === 'number' && <LinguistSection count={pg.languages} choices={additionalChoices} onChange={setAdditionalChoices} />}

      {/* Martial Adept — 2 maneuvers */}
      {typeof pg.maneuvers === 'number' && <MartialAdeptSection count={pg.maneuvers} choices={additionalChoices} onChange={setAdditionalChoices} />}

      {/* Magic Initiate — class + 2 cantrips + 1 spell */}
      {typeof pg.cantrips === 'number' && pg.spells_1st && (
        <MagicInitiateSection
          classOptions={featData.choice?.options || []}
          cantripCount={pg.cantrips}
          choices={additionalChoices}
          onChange={setAdditionalChoices}
        />
      )}

      {/* Spell Sniper — class + 1 attack cantrip */}
      {typeof pg.cantrips === 'number' && !pg.spells_1st && !pg.ritual_spells_1st && (
        <SpellSniperSection
          cantripCount={pg.cantrips}
          choices={additionalChoices}
          onChange={setAdditionalChoices}
        />
      )}

      {/* Ritual Caster — class + 2 ritual spells */}
      {typeof pg.ritual_spells_1st === 'number' && (
        <RitualCasterSection
          classOptions={featData.choice?.options || []}
          count={pg.ritual_spells_1st}
          choices={additionalChoices}
          onChange={setAdditionalChoices}
        />
      )}
    </>
  );
}

// --- Skilled ---
function SkilledSection({ count, choices, onChange }: { count: number; choices: any; onChange: (c: any) => void }) {
  const selected: string[] = choices.skills || [];
  return (
    <div className="p-4 bg-blue-900/30 border border-blue-700 rounded-lg">
      <div className="text-sm font-bold text-blue-300 mb-1">选择{count}项技能熟练</div>
      <div className="text-xs text-gray-400 mb-3">已选 {selected.length}/{count}</div>
      <div className="grid grid-cols-2 gap-1.5">
        {(skillsData as any).skills.map((s: any) => (
          <button
            key={s.id}
            onClick={() => onChange({ ...choices, skills: toggleArrayItem(selected, s.id, count) })}
            className={`px-2 py-1.5 rounded text-left text-xs transition-all ${
              selected.includes(s.id)
                ? 'bg-blue-700/60 border border-blue-500 text-white'
                : selected.length >= count
                  ? 'border border-gray-700 text-gray-500 cursor-not-allowed'
                  : 'border border-gray-600 hover:border-gray-500 text-gray-300'
            }`}
          >
            <span className="font-medium">{s.name}</span>
            <span className="text-gray-500 ml-1">{s.nameEn}</span>
            <span className="text-gray-600 ml-1">({ABILITY_NAMES[s.ability] || s.ability})</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// --- Weapon Master ---
function WeaponMasterSection({ count, choices, onChange }: { count: number; choices: any; onChange: (c: any) => void }) {
  const selected: string[] = choices.weapons || [];
  const allWeapons = useMemo(() => getAllWeapons(), []);
  const simpleWeapons = allWeapons.filter(w => w.group === 'simple');
  const martialWeapons = allWeapons.filter(w => w.group === 'martial');

  const renderWeapon = (w: typeof allWeapons[0]) => (
    <button
      key={w.id}
      onClick={() => onChange({ ...choices, weapons: toggleArrayItem(selected, w.id, count) })}
      className={`px-2 py-1.5 rounded text-left text-xs transition-all ${
        selected.includes(w.id)
          ? 'bg-yellow-700/60 border border-yellow-500 text-white'
          : selected.length >= count
            ? 'border border-gray-700 text-gray-500 cursor-not-allowed'
            : 'border border-gray-600 hover:border-gray-500 text-gray-300'
      }`}
    >
      <span className="font-medium">{w.name}</span>
      <span className="text-gray-500 ml-1 text-[10px]">{w.damage} {DAMAGE_TYPE_NAMES[w.damageType] || w.damageType}</span>
    </button>
  );

  return (
    <div className="p-4 bg-yellow-900/30 border border-yellow-700 rounded-lg">
      <div className="text-sm font-bold text-yellow-300 mb-1">选择{count}种武器熟练</div>
      <div className="text-xs text-gray-400 mb-3">已选 {selected.length}/{count}</div>
      <div className="mb-2 text-xs text-gray-400 font-medium">简易武器</div>
      <div className="grid grid-cols-2 gap-1.5 mb-3">{simpleWeapons.map(renderWeapon)}</div>
      <div className="mb-2 text-xs text-gray-400 font-medium">军用武器</div>
      <div className="grid grid-cols-2 gap-1.5">{martialWeapons.map(renderWeapon)}</div>
    </div>
  );
}

// --- Linguist ---
function LinguistSection({ count, choices, onChange }: { count: number; choices: any; onChange: (c: any) => void }) {
  const selected: string[] = choices.languages || [];
  const standard = ALL_LANGUAGES.filter(l => l.category === 'standard');
  const exotic = ALL_LANGUAGES.filter(l => l.category === 'exotic');

  const renderLang = (l: typeof ALL_LANGUAGES[0]) => (
    <button
      key={l.id}
      onClick={() => onChange({ ...choices, languages: toggleArrayItem(selected, l.id, count) })}
      className={`px-2 py-1.5 rounded text-left text-xs transition-all ${
        selected.includes(l.id)
          ? 'bg-purple-700/60 border border-purple-500 text-white'
          : selected.length >= count
            ? 'border border-gray-700 text-gray-500 cursor-not-allowed'
            : 'border border-gray-600 hover:border-gray-500 text-gray-300'
      }`}
    >
      <span className="font-medium">{l.name}</span>
      <span className="text-gray-500 ml-1">{l.nameEn}</span>
    </button>
  );

  return (
    <div className="p-4 bg-purple-900/30 border border-purple-700 rounded-lg">
      <div className="text-sm font-bold text-purple-300 mb-1">选择{count}种语言</div>
      <div className="text-xs text-gray-400 mb-3">已选 {selected.length}/{count}</div>
      <div className="mb-2 text-xs text-gray-400 font-medium">标准语言</div>
      <div className="grid grid-cols-2 gap-1.5 mb-3">{standard.map(renderLang)}</div>
      <div className="mb-2 text-xs text-gray-400 font-medium">异域语言</div>
      <div className="grid grid-cols-2 gap-1.5">{exotic.map(renderLang)}</div>
    </div>
  );
}

// --- Martial Adept ---
function MartialAdeptSection({ count, choices, onChange }: { count: number; choices: any; onChange: (c: any) => void }) {
  const selected: string[] = choices.maneuvers || [];
  const maneuvers = useMemo(() => getManeuvers(), []);

  return (
    <div className="p-4 bg-red-900/30 border border-red-700 rounded-lg">
      <div className="text-sm font-bold text-red-300 mb-1">选择{count}个战技</div>
      <div className="text-xs text-gray-400 mb-3">已选 {selected.length}/{count}</div>
      <div className="grid grid-cols-1 gap-2 max-h-64 overflow-y-auto pr-1">
        {maneuvers.map((m: any) => (
          <button
            key={m.id}
            onClick={() => onChange({ ...choices, maneuvers: toggleArrayItem(selected, m.id, count) })}
            className={`p-2 rounded text-left text-xs transition-all ${
              selected.includes(m.id)
                ? 'bg-red-700/60 border border-red-500 text-white'
                : selected.length >= count
                  ? 'border border-gray-700 text-gray-500 cursor-not-allowed'
                  : 'border border-gray-600 hover:border-gray-500 text-gray-300'
            }`}
          >
            <div className="font-medium">{m.name} <span className="text-gray-500">{m.nameEn}</span></div>
            <div className="text-yellow-400 text-[10px] mt-0.5">
              {TIMING_LABELS[m.timing] || m.timing}
              {m.save && ` | ${ABILITY_NAMES[m.save] || m.save}豁免`}
            </div>
            <div className="text-gray-400 mt-0.5 line-clamp-2">{m.description}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

// --- Magic Initiate ---
function MagicInitiateSection({ classOptions, cantripCount, choices, onChange }: {
  classOptions: string[]; cantripCount: number; choices: any; onChange: (c: any) => void;
}) {
  const selectedClass: string = choices.choiceValue || '';
  const selectedCantrips: string[] = choices.cantrips || [];
  const selectedSpell: string = choices.spell || '';

  const spells = (spellsData as any).spells || [];
  const cantrips = useMemo(() =>
    selectedClass ? spells.filter((s: any) => s.level === 0 && s.classes?.includes(selectedClass)) : [],
    [selectedClass, spells]
  );
  const level1Spells = useMemo(() =>
    selectedClass ? spells.filter((s: any) => s.level === 1 && s.classes?.includes(selectedClass)) : [],
    [selectedClass, spells]
  );

  const setClass = (cls: string) => onChange({ ...choices, choiceValue: cls, cantrips: [], spell: '' });

  return (
    <div className="p-4 bg-indigo-900/30 border border-indigo-700 rounded-lg space-y-3">
      <div className="text-sm font-bold text-indigo-300">选择施法职业</div>
      <div className="grid grid-cols-3 gap-2">
        {classOptions.map(cls => (
          <button
            key={cls}
            onClick={() => setClass(cls)}
            className={`p-2 rounded border text-sm transition-all ${
              selectedClass === cls ? 'border-indigo-500 bg-indigo-900/50 text-white' : 'border-gray-600 hover:border-gray-500 text-gray-300'
            }`}
          >
            {CLASS_NAMES[cls] || cls}
          </button>
        ))}
      </div>

      {selectedClass && (
        <>
          <div className="text-sm font-bold text-indigo-300">选择{cantripCount}个戏法 <span className="text-xs text-gray-400 font-normal">({selectedCantrips.length}/{cantripCount})</span></div>
          <div className="grid grid-cols-2 gap-1.5 max-h-40 overflow-y-auto pr-1">
            {cantrips.map((s: any) => (
              <button
                key={s.id}
                onClick={() => onChange({ ...choices, cantrips: toggleArrayItem(selectedCantrips, s.id, cantripCount) })}
                className={`px-2 py-1.5 rounded text-left text-xs transition-all ${
                  selectedCantrips.includes(s.id)
                    ? 'bg-indigo-700/60 border border-indigo-500 text-white'
                    : selectedCantrips.length >= cantripCount
                      ? 'border border-gray-700 text-gray-500 cursor-not-allowed'
                      : 'border border-gray-600 hover:border-gray-500 text-gray-300'
                }`}
              >
                <span className="font-medium">{s.name}</span>
                <span className="text-gray-500 ml-1 text-[10px]">{s.nameEn}</span>
              </button>
            ))}
          </div>

          <div className="text-sm font-bold text-indigo-300">选择1个1环法术 <span className="text-xs text-gray-400 font-normal">({selectedSpell ? 1 : 0}/1)</span></div>
          <div className="grid grid-cols-2 gap-1.5 max-h-40 overflow-y-auto pr-1">
            {level1Spells.map((s: any) => (
              <button
                key={s.id}
                onClick={() => onChange({ ...choices, spell: selectedSpell === s.id ? '' : s.id })}
                className={`px-2 py-1.5 rounded text-left text-xs transition-all ${
                  selectedSpell === s.id
                    ? 'bg-indigo-700/60 border border-indigo-500 text-white'
                    : selectedSpell
                      ? 'border border-gray-700 text-gray-500 cursor-not-allowed'
                      : 'border border-gray-600 hover:border-gray-500 text-gray-300'
                }`}
              >
                <span className="font-medium">{s.name}</span>
                <span className="text-gray-500 ml-1 text-[10px]">{s.nameEn}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// --- Spell Sniper ---
function SpellSniperSection({ cantripCount, choices, onChange }: {
  cantripCount: number; choices: any; onChange: (c: any) => void;
}) {
  const ALL_CASTER_CLASSES = ['bard', 'cleric', 'druid', 'sorcerer', 'warlock', 'wizard'];
  const selectedClass: string = choices.choiceValue || '';
  const selectedCantrip: string = choices.cantrip || '';

  const spells = (spellsData as any).spells || [];
  // Spell Sniper: cantrips that require an attack roll (description contains 攻击骰/攻击检定/远程法术攻击/近战法术攻击)
  const attackCantrips = useMemo(() =>
    selectedClass ? spells.filter((s: any) =>
      s.level === 0 && s.classes?.includes(selectedClass) &&
      (s.description?.includes('法术攻击') || s.description?.includes('攻击骰') || s.descriptionEn?.toLowerCase()?.includes('spell attack'))
    ) : [],
    [selectedClass, spells]
  );

  const setClass = (cls: string) => onChange({ ...choices, choiceValue: cls, cantrip: '' });

  return (
    <div className="p-4 bg-cyan-900/30 border border-cyan-700 rounded-lg space-y-3">
      <div className="text-sm font-bold text-cyan-300">选择戏法来源职业</div>
      <div className="grid grid-cols-3 gap-2">
        {ALL_CASTER_CLASSES.map(cls => (
          <button
            key={cls}
            onClick={() => setClass(cls)}
            className={`p-2 rounded border text-sm transition-all ${
              selectedClass === cls ? 'border-cyan-500 bg-cyan-900/50 text-white' : 'border-gray-600 hover:border-gray-500 text-gray-300'
            }`}
          >
            {CLASS_NAMES[cls] || cls}
          </button>
        ))}
      </div>

      {selectedClass && (
        <>
          <div className="text-sm font-bold text-cyan-300">选择1个需要攻击检定的戏法</div>
          {attackCantrips.length === 0 ? (
            <div className="text-xs text-gray-500">该职业没有需要攻击检定的戏法</div>
          ) : (
            <div className="grid grid-cols-2 gap-1.5 max-h-40 overflow-y-auto pr-1">
              {attackCantrips.map((s: any) => (
                <button
                  key={s.id}
                  onClick={() => onChange({ ...choices, cantrip: selectedCantrip === s.id ? '' : s.id })}
                  className={`px-2 py-1.5 rounded text-left text-xs transition-all ${
                    selectedCantrip === s.id
                      ? 'bg-cyan-700/60 border border-cyan-500 text-white'
                      : selectedCantrip
                        ? 'border border-gray-700 text-gray-500 cursor-not-allowed'
                        : 'border border-gray-600 hover:border-gray-500 text-gray-300'
                  }`}
                >
                  <span className="font-medium">{s.name}</span>
                  <span className="text-gray-500 ml-1 text-[10px]">{s.nameEn}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// --- Ritual Caster ---
function RitualCasterSection({ classOptions, count, choices, onChange }: {
  classOptions: string[]; count: number; choices: any; onChange: (c: any) => void;
}) {
  const selectedClass: string = choices.choiceValue || '';
  const selectedRituals: string[] = choices.ritualSpells || [];

  const spells = (spellsData as any).spells || [];
  const ritualSpells = useMemo(() =>
    selectedClass ? spells.filter((s: any) => s.level === 1 && s.ritual === true && s.classes?.includes(selectedClass)) : [],
    [selectedClass, spells]
  );

  const setClass = (cls: string) => onChange({ ...choices, choiceValue: cls, ritualSpells: [] });

  return (
    <div className="p-4 bg-emerald-900/30 border border-emerald-700 rounded-lg space-y-3">
      <div className="text-sm font-bold text-emerald-300">选择施法职业</div>
      <div className="grid grid-cols-3 gap-2">
        {classOptions.map(cls => (
          <button
            key={cls}
            onClick={() => setClass(cls)}
            className={`p-2 rounded border text-sm transition-all ${
              selectedClass === cls ? 'border-emerald-500 bg-emerald-900/50 text-white' : 'border-gray-600 hover:border-gray-500 text-gray-300'
            }`}
          >
            {CLASS_NAMES[cls] || cls}
          </button>
        ))}
      </div>

      {selectedClass && (
        <>
          <div className="text-sm font-bold text-emerald-300">
            选择{count}个1环仪式法术
            <span className="text-xs text-gray-400 font-normal ml-1">({selectedRituals.length}/{count})</span>
          </div>
          {ritualSpells.length === 0 ? (
            <div className="text-xs text-gray-500">该职业没有1环仪式法术</div>
          ) : (
            <div className="grid grid-cols-2 gap-1.5 max-h-40 overflow-y-auto pr-1">
              {ritualSpells.map((s: any) => (
                <button
                  key={s.id}
                  onClick={() => onChange({ ...choices, ritualSpells: toggleArrayItem(selectedRituals, s.id, count) })}
                  className={`px-2 py-1.5 rounded text-left text-xs transition-all ${
                    selectedRituals.includes(s.id)
                      ? 'bg-emerald-700/60 border border-emerald-500 text-white'
                      : selectedRituals.length >= count
                        ? 'border border-gray-700 text-gray-500 cursor-not-allowed'
                        : 'border border-gray-600 hover:border-gray-500 text-gray-300'
                  }`}
                >
                  <span className="font-medium">{s.name}</span>
                  <span className="text-gray-500 ml-1 text-[10px]">{s.nameEn}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
