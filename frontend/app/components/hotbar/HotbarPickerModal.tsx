import { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import type { Character, HotbarSlot, EquipmentItem } from '~/components/character/CharacterDisplay/types/Character';
import { spellDataLoader } from '~/services/spellDataLoader';
import type { Spell } from '~/types/spell';
import { SpellDetailModal } from '~/components/spell/SpellSelectableCard';
import classesData from '~/data/rules/classes_with_structured_subclass_features.json';
import classesProgressionData from '~/data/rules/classes-progression.json';
import racesData from '~/data/rules/races.json';
import classResourcesData from '~/data/rules/class_resources.json';
import classesRawData from '~/data/rules/classes.json';
import { isPreparedCaster } from '~/components/character/CharacterDisplay/utils/spellcasting';
import equipmentRulesData from '~/data/rules/equipment.json';
import { getAssetUrl } from '~/utils/asset-url';
import { getIconPath } from '~/components/character/CharacterDisplay/utils/rules';
import { tDamageType } from '~/utils/i18n/dictionary';
import { getAtWillSpellIds } from '~/utils/spellModifiers';

interface HotbarPickerModalProps {
  open: boolean;
  onClose: () => void;
  character: Character;
  onSelect: (item: HotbarSlot) => void;
}

type TabId = 'actions' | 'spells' | 'features' | 'items';

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'actions', label: '动作', icon: '⚔' },
  { id: 'spells', label: '法术', icon: '✦' },
  { id: 'features', label: '特性', icon: '★' },
  { id: 'items', label: '物品', icon: '◆' },
];

// Standard D&D 5E combat actions
const BASIC_ACTIONS: HotbarSlot[] = [
  { type: 'weapon', id: 'dash',       name: '疾走',  icon: '💨', meta: { cost: '动作', description: '移动距离翻倍' } },
  { type: 'weapon', id: 'disengage',  name: '撤离',  icon: '🏃', meta: { cost: '动作', description: '移动不触发借机攻击' } },
  { type: 'weapon', id: 'dodge',      name: '闪避',  icon: '🛡️', meta: { cost: '动作', description: '攻击你有劣势，敏捷豁免有优势' } },
  { type: 'weapon', id: 'help',       name: '援助',  icon: '🤝', meta: { cost: '动作', description: '盟友下次检定获得优势' } },
  { type: 'weapon', id: 'hide',       name: '躲藏',  icon: '👤', meta: { cost: '动作', description: '敏捷(隐匿)检定' } },
  { type: 'weapon', id: 'ready',      name: '预备',  icon: '⏳', meta: { cost: '动作+反应', description: '设定触发条件执行动作' } },
  { type: 'weapon', id: 'search',     name: '搜索',  icon: '🔍', meta: { cost: '动作', description: '感知(察觉)或智力(调查)检定' } },
  { type: 'weapon', id: 'use_object', name: '使用物品', icon: '📦', meta: { cost: '动作', description: '使用药水、魔法物品等' } },
  { type: 'weapon', id: 'improvise',  name: '即兴动作', icon: '🎭', meta: { cost: '动作', description: 'DM裁定的创意行动' } },
];

// Feature name → action cost mapping (mirrors backend FEATURE_ACTION_TYPES)
const FEATURE_ACTION_COST: Record<string, string> = {
  '报复': '反应', 'Retaliation': '反应',
  '激励': '附赠', 'Bardic Inspiration': '附赠', '激励骰': '附赠',
  '引导神力': '动作', 'Channel Divinity': '动作',
  '疾风连击': '附赠', 'Flurry of Blows': '附赠',
  '患难之交': '附赠', 'Patient Defense': '附赠',
  '御风步': '附赠', 'Step of the Wind': '附赠',
  '偏斜飞弹': '反应', 'Deflect Missiles': '反应',
  '缓落': '反应', 'Slow Fall': '反应',
  '神圣感知': '动作', 'Divine Sense': '动作',
  '圣疗': '动作', '圣疗术': '动作', 'Lay on Hands': '动作',
  '神圣打击': '免费', 'Divine Smite': '免费',
  '净化之触': '动作', 'Cleansing Touch': '动作',
  '消失无踪': '附赠', 'Vanish': '附赠', '隐匿行踪': '附赠',
  '狡诈动作': '附赠', '灵巧动作': '附赠', 'Cunning Action': '附赠',
  '反制': '反应', 'Uncanny Dodge': '反应',
  '魔力涌动': '附赠', 'Sorcery Points': '附赠',
  '奥术恢复': '动作', 'Arcane Recovery': '动作',
  // Monk - Open Hand
  '开手技巧：推开': '免费', 'Open Hand: Push': '免费',
  '开手技巧：击倒': '免费', 'Open Hand: Prone': '免费',
  '开手技巧：封反应': '免费', 'Open Hand: No Reaction': '免费',
  '完整自我': '动作', 'Wholeness of Body': '动作',
  '宁静': '免费', 'Tranquility': '免费',
  '颤栗掌': '免费', 'Quivering Palm': '免费',
  // Monk - Shadow
  '暗影术：黑暗术': '动作', 'Shadow Arts: Darkness': '动作',
  '暗影术：黑暗视觉': '动作', 'Shadow Arts: Darkvision': '动作',
  '暗影术：通行无阻': '动作', 'Shadow Arts: Pass Without Trace': '动作',
  '暗影术：沉默术': '动作', 'Shadow Arts: Silence': '动作',
  '暗影步': '附赠', 'Shadow Step': '附赠',
  '暗影斗篷': '动作', 'Cloak of Shadows': '动作',
  '机会主义者': '反应', 'Opportunist': '反应',
  // Racial traits
  '吐息武器': '动作', 'Breath Weapon': '动作',
  '不屈': '免费', 'Relentless Endurance': '免费',
};

const COST_COLORS: Record<string, string> = {
  '动作': 'bg-red-900/40 text-red-300',
  '附赠': 'bg-yellow-900/40 text-yellow-300',
  '反应': 'bg-blue-900/40 text-blue-300',
  '免费': 'bg-green-900/40 text-green-300',
  '动作+反应': 'bg-purple-900/40 text-purple-300',
};

const ACTION_COST_MAP: Record<string, string> = {
  action: '动作',
  bonus_action: '附赠',
  reaction: '反应',
  free: '免费',
};

const SCHOOL_CN: Record<string, string> = {
  abjuration: '防护', conjuration: '咒法', divination: '预言', enchantment: '惑控',
  evocation: '塑能', illusion: '幻术', necromancy: '死灵', transmutation: '变化',
};

function getSpellLevelLabel(level: number) {
  return level === 0 ? '戏法' : `${level}环`;
}

// Build maneuver id → name map from Battle Master data
const MANEUVER_NAMES: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  const fighter = (classesRawData as any).classes?.find((c: any) => c.id === 'fighter');
  const bm = fighter?.subclasses?.find((s: any) => s.id === 'battle_master');
  if (bm?.maneuvers) {
    for (const m of bm.maneuvers) map[m.id] = m.name;
  }
  return map;
})();

function equipIconUrl(eq: EquipmentItem): string {
  if (eq.avatar_url) return eq.avatar_url;
  return getIconPath(eq) || getAssetUrl(`assets/equipment-icons/${eq.id}.png`);
}

function formatDamage(d: string | { dice: string } | undefined): string {
  if (!d) return '';
  return typeof d === 'string' ? d : d.dice;
}

export function HotbarPickerModal({ open, onClose, character, onSelect }: HotbarPickerModalProps) {
  const [tab, setTab] = useState<TabId>('actions');
  const [search, setSearch] = useState('');
  const [spellMap, setSpellMap] = useState<Map<string, Spell>>(new Map());
  const [spellDetail, setSpellDetail] = useState<Spell | null>(null);

  useEffect(() => {
    if (!open) return;
    spellDataLoader.loadSpellData().then(() => {
      const map = new Map<string, Spell>();
      spellDataLoader.getAllSpells().forEach(s => map.set(s.id, s));
      setSpellMap(map);
    });
  }, [open]);

  useEffect(() => { setSearch(''); setSpellDetail(null); }, [tab]);
  useEffect(() => { if (!open) setSpellDetail(null); }, [open]);

  // --- Actions tab: weapon attacks + special attacks + standard actions ---
  const actionItems = useMemo(() => {
    const items: HotbarSlot[] = [];
    const equipment = character.equipment || [];
    const mainHand = equipment.find(eq => eq.equippedSlot === 'main_hand');
    const offHand = equipment.find(eq => eq.equippedSlot === 'off_hand');

    // Build weapon lookup from rules data for properties fallback
    const weaponRulesLookup: Record<string, any> = {};
    const rules = equipmentRulesData as any;
    for (const prof of ['simple', 'martial']) {
      for (const type of ['melee', 'ranged']) {
        ((rules.weapons?.[prof]?.[type]) || []).forEach((w: any) => {
          if (w.id) weaponRulesLookup[w.id.toLowerCase()] = { ...w, _isMelee: type === 'melee' };
        });
      }
    }
    // Helper: get weapon properties with rules data fallback
    const getWeaponProps = (item: any): string[] => {
      if (item.properties && item.properties.length > 0) return item.properties;
      const rulesWeapon = item.id ? weaponRulesLookup[String(item.id).toLowerCase()] : null;
      return rulesWeapon?.properties || [];
    };

    // Main hand attack
    if (mainHand && (mainHand.equipmentType === 'weapon' || mainHand.damage)) {
      const grip = mainHand.gripMode === 'two-hand' ? '(双手)' : '';
      const mhIconUrl = equipIconUrl(mainHand);
      const mhProps = getWeaponProps(mainHand);
      const mhHasReach = mhProps.some((p: string) => p === 'reach' || p.includes('长柄'));
      const mhIsThrown = mhProps.some((p: string) => p === 'thrown' || p.includes('投掷'));
      // Determine weapon range for targeting indicator
      // Thrown melee weapons (javelin, handaxe): melee range = 5尺, thrown range handled separately
      let mhNormalRange = mhHasReach ? 10 : 5;
      let mhMaxRange = mhNormalRange;
      if (!mhIsThrown) {
        if (typeof mainHand.range === 'object' && mainHand.range) {
          mhNormalRange = mainHand.range.normal || mhNormalRange;
          mhMaxRange = mainHand.range.long || mhNormalRange;
        } else if (typeof mainHand.range === 'string') {
          const rm = mainHand.range.match(/(\d+)(?:\/(\d+))?/);
          if (rm) { mhNormalRange = parseInt(rm[1], 10); mhMaxRange = rm[2] ? parseInt(rm[2], 10) : mhNormalRange; }
        }
      }
      items.push({
        type: 'weapon', id: `attack_main_${mainHand.id}`,
        name: `主手攻击${grip}：${mainHand.name}`, icon: '⚔',
        meta: { cost: '动作', damage: formatDamage(mainHand.damage), damageType: mainHand.damageType, avatar_url: mhIconUrl, normalRange: mhNormalRange, maxRange: mhMaxRange, range: mainHand.range, properties: mhProps },
      });
      // Thrown (proper thrown or improvised throw for melee weapons)
      const props = getWeaponProps(mainHand);
      const isThrown = props.some(p => p === 'thrown' || p.includes('投掷'));
      const isTwoHanded = props.some(p => p === 'two-handed' || p === '双手');
      const rulesW = mainHand.id ? weaponRulesLookup[String(mainHand.id).toLowerCase()] : null;
      const isMelee = rulesW ? rulesW._isMelee : !props.some(p => p === 'ammunition' || p.includes('弹药'));
      if (isMelee && !isTwoHanded) {
        let throwRange = isThrown ? '' : '20/60尺';
        let throwNormal = 20;
        let throwMax = 60;
        if (isThrown) {
          if (typeof mainHand.range === 'object' && mainHand.range) {
            throwRange = `${mainHand.range.normal}/${mainHand.range.long}尺`;
            throwNormal = mainHand.range.normal || 20;
            throwMax = mainHand.range.long || 60;
          } else if (typeof mainHand.range === 'string') {
            throwRange = mainHand.range;
            const rm = mainHand.range.match(/(\d+)(?:\/(\d+))?/);
            if (rm) { throwNormal = parseInt(rm[1], 10); throwMax = rm[2] ? parseInt(rm[2], 10) : 60; }
          }
        }
        items.push({
          type: 'weapon', id: isThrown ? `throw_main_${mainHand.id}` : `improvthrow_main_${mainHand.id}`,
          name: isThrown ? `投掷：${mainHand.name}` : `投掷：${mainHand.name} (即兴)`, icon: '🎯',
          meta: {
            cost: '动作',
            damage: isThrown ? formatDamage(mainHand.damage) : '1d4',
            damageType: mainHand.damageType || '钝击',
            range: throwRange, avatar_url: mhIconUrl,
            normalRange: throwNormal, maxRange: throwMax, properties: props,
            ...(isThrown ? {} : { isImprovised: true }),
          },
        });
      }
    }

    // Off-hand attack
    if (offHand && (offHand.equipmentType === 'weapon' || offHand.damage)) {
      const fs = (character as any).fighting_style || (character as any).fightingStyle;
      const fsValue = fs && typeof fs === 'object' ? fs.value : fs;
      const hasTWF = fsValue === 'two_weapon_fighting' || fsValue === 'two_weapon';

      // Calculate ability mod for off-hand weapon
      const scores = character.ability_scores || (character as any).abilityScores || {};
      const strMod = Math.floor(((scores.strength || 10) - 10) / 2);
      const dexMod = Math.floor(((scores.dexterity || 10) - 10) / 2);
      const props = getWeaponProps(offHand);
      const isFinesse = props.some((p: string) => p === 'finesse' || p.includes('灵巧'));
      const offAbilityMod = isFinesse ? Math.max(strMod, dexMod) : strMod;
      const offAbilityName = isFinesse && dexMod > strMod ? '敏捷' : '力量';
      const sign = offAbilityMod >= 0 ? '+' : '';

      // Determine off-hand weapon range (same logic as main hand)
      const ohHasReach = props.some((p: string) => p === 'reach' || p.includes('长柄'));
      const ohIsThrowProp = props.some((p: string) => p === 'thrown' || p.includes('投掷'));
      let ohNormalRange = ohHasReach ? 10 : 5;
      let ohMaxRange = ohNormalRange;
      if (!ohIsThrowProp) {
        if (typeof offHand.range === 'object' && offHand.range) {
          ohNormalRange = offHand.range.normal || ohNormalRange;
          ohMaxRange = offHand.range.long || ohNormalRange;
        } else if (typeof offHand.range === 'string') {
          const rm = offHand.range.match(/(\d+)(?:\/(\d+))?/);
          if (rm) { ohNormalRange = parseInt(rm[1], 10); ohMaxRange = rm[2] ? parseInt(rm[2], 10) : ohNormalRange; }
        }
      }

      items.push({
        type: 'weapon', id: `attack_off_${offHand.id}`,
        name: `副手攻击：${offHand.name}`, icon: '⚔',
        meta: {
          cost: '附赠', damage: formatDamage(offHand.damage), damageType: offHand.damageType,
          avatar_url: equipIconUrl(offHand), is_off_hand: true,
          damageNote: hasTWF ? `${sign}${offAbilityMod}${offAbilityName}` : '不含属性调整值',
          normalRange: ohNormalRange, maxRange: ohMaxRange, range: offHand.range, properties: props,
        },
      });
      // Off-hand thrown (proper thrown or improvised throw for melee weapons)
      const ohIsThrown = props.some((p: string) => p === 'thrown' || p.includes('投掷'));
      const ohIsTwoHanded = props.some((p: string) => p === 'two-handed' || p === '双手');
      const ohRulesW = offHand.id ? weaponRulesLookup[String(offHand.id).toLowerCase()] : null;
      const ohIsMelee = ohRulesW ? ohRulesW._isMelee : !props.some((p: string) => p === 'ammunition' || p.includes('弹药'));
      if (ohIsMelee && !ohIsTwoHanded) {
        let throwRange = ohIsThrown ? '' : '20/60尺';
        let throwNormal = 20;
        let throwMax = 60;
        if (ohIsThrown) {
          if (typeof offHand.range === 'object' && offHand.range) {
            throwRange = `${offHand.range.normal}/${offHand.range.long}尺`;
            throwNormal = offHand.range.normal || 20;
            throwMax = offHand.range.long || 60;
          } else if (typeof offHand.range === 'string') {
            throwRange = offHand.range;
            const rm = offHand.range.match(/(\d+)(?:\/(\d+))?/);
            if (rm) { throwNormal = parseInt(rm[1], 10); throwMax = rm[2] ? parseInt(rm[2], 10) : 60; }
          }
        }
        items.push({
          type: 'weapon', id: ohIsThrown ? `throw_off_${offHand.id}` : `improvthrow_off_${offHand.id}`,
          name: ohIsThrown ? `副手投掷：${offHand.name}` : `副手投掷：${offHand.name} (即兴)`, icon: '🎯',
          meta: {
            cost: '附赠',
            damage: ohIsThrown ? formatDamage(offHand.damage) : '1d4',
            damageType: offHand.damageType || '钝击',
            range: throwRange, avatar_url: equipIconUrl(offHand), is_off_hand: true,
            damageNote: hasTWF ? `${sign}${offAbilityMod}${offAbilityName}` : '不含属性调整值',
            normalRange: throwNormal, maxRange: throwMax, properties: props,
            ...(ohIsThrown ? {} : { isImprovised: true }),
          },
        });
      }
    }

    // Special melee actions
    items.push(
      { type: 'weapon', id: 'unarmed_strike', name: '徒手打击', icon: '👊',
        meta: { cost: '动作', damage: '1+力量', damageType: '钝击', normalRange: 5, maxRange: 5 } },
      { type: 'weapon', id: 'grapple', name: '擒抱', icon: '🤼',
        meta: { cost: '动作', description: '力量(运动) 对抗检定', normalRange: 5, maxRange: 5 } },
      { type: 'weapon', id: 'shove', name: '推撞', icon: '🫸',
        meta: { cost: '动作', description: '力量(运动) 对抗检定', normalRange: 5, maxRange: 5 } },
    );

    // Standard D&D 5E actions
    items.push(...BASIC_ACTIONS);

    return items;
  }, [character.equipment]);

  // --- Spells tab ---
  const spellItems = useMemo(() => {
    const ids = new Set<string>();
    const addId = (v: any) => {
      const id = typeof v === 'string' ? v : v?.id;
      if (id) ids.add(id);
    };
    // Cantrips are always shown
    (character.selected_cantrips || character.selectedCantrips || []).forEach(addId);
    if (isPreparedCaster(character.class_id)) {
      // Prepared casters: only show prepared spells (not the full spellbook / class list)
      (character.prepared_spells || character.preparedSpells || []).forEach(addId);
    } else {
      // Known casters (bard, sorcerer, ranger, warlock, etc.): show all selected spells
      (character.prepared_spells || character.preparedSpells || []).forEach(addId);
      (character.selected_spells || character.selectedSpells || []).forEach(addId);
    }

    // Feat-granted spells (Magic Initiate, Ritual Caster, Spell Sniper)
    const fc = character.feat_choices || (character as any).featChoices;
    if (fc) {
      if (fc.magic_initiate) {
        (fc.magic_initiate.cantrips || []).forEach((id: string) => ids.add(id));
        if (fc.magic_initiate.spell) ids.add(fc.magic_initiate.spell);
      }
      if (fc.spell_sniper?.cantrip) ids.add(fc.spell_sniper.cantrip);
      if (fc.ritual_caster?.ritualSpells) {
        fc.ritual_caster.ritualSpells.forEach((id: string) => ids.add(id));
      }
    }

    // Build set of at-will invocation spell IDs
    const charInvs = ((character as any).eldritch_invocations || (character as any).eldritchInvocations || [])
      .map((i: any) => typeof i === 'string' ? i : i.value || i.id || '');
    const atWillSpellIds = getAtWillSpellIds(charInvs);

    const items: (HotbarSlot & { _level: number })[] = [];
    ids.forEach(id => {
      const spell = spellMap.get(id);
      const name = spell?.name || id.replace(/_/g, ' ');
      const level = spell?.level ?? -1;
      const school = spell ? (SCHOOL_CN[spell.school] || spell.school) : '';
      const avatarUrl = spell?.iconPath ? getAssetUrl(spell.iconPath) : undefined;
      const isFree = atWillSpellIds.has(id);
      items.push({
        type: 'spell', id, name, icon: '✦',
        meta: { level, school, ...(level === 0 ? { cantrip: true } : {}), ...(avatarUrl ? { avatar_url: avatarUrl } : {}), ...(isFree ? { invocationFree: true } : {}) },
        _level: level,
      });
    });
    items.sort((a, b) => a._level - b._level || a.name.localeCompare(b.name, 'zh'));
    return items;
  }, [character, spellMap]);

  // --- Features tab: class/subclass features + racial traits with action cost ---
  const featureItems = useMemo(() => {
    const classId = character.class_id;
    const level = character.level || 1;
    const cls = (classesData as any).classes?.find((c: any) => c.id === classId);

    const items: HotbarSlot[] = [];
    const seen = new Set<string>();

    const allClassResources = (classResourcesData as any).classResources || [];
    const allAbilities = (classResourcesData as any).resourceAbilities || [];

    const findExecutionByResourceId = (resourceId?: string) => {
      if (!resourceId) return undefined;
      return allAbilities.find((ability: any) => ability.resourceId === resourceId)?.execution;
    };

    const findSubclassFeatureData = (subclassData: any, featureName: string, featureLevel: number) => {
      if (!subclassData || typeof subclassData !== 'object') return undefined;
      for (const value of Object.values(subclassData)) {
        if (!Array.isArray(value)) continue;
        const matched = value.find((feature: any) =>
          feature?.name === featureName && Number(feature?.level || featureLevel) === featureLevel
        );
        if (matched) return matched;
      }
      return undefined;
    };

    const addFeature = (
      name: string,
      nameEn: string,
      lv: number,
      desc?: string,
      icon = '★',
      featureId?: string,
      featureData?: any,
    ) => {
      if (!name || seen.has(name)) return;
      seen.add(name);
      const cr = featureId
        ? allClassResources.find((r: any) => r.classId === classId && r.id === featureId)
        : allClassResources.find((r: any) => r.classId === classId && (r.name === name || r.nameEn === nameEn));
      const resourceAbility = featureId
        ? allAbilities.find((ability: any) => ability.id === featureId || ability.resourceId === featureId)
        : allAbilities.find((ability: any) => ability.name === name || ability.nameEn === nameEn);
      const resolvedActionType = featureData?.actionType || resourceAbility?.actionType;
      const cost = ACTION_COST_MAP[resolvedActionType] || FEATURE_ACTION_COST[name] || FEATURE_ACTION_COST[nameEn] || undefined;
      const avatarUrl = cr ? getAssetUrl(`assets/class-feature-icons/${cr.id}.png`) : undefined;
      const execution = featureData?.execution || resourceAbility?.execution || findExecutionByResourceId(cr?.id);
      const resourceId = featureData?.resourceId || cr?.id;
      items.push({
        type: 'feature', id: nameEn || name, name, icon,
        meta: {
          level: lv,
          ...(resourceId ? { resourceId } : {}),
          ...(execution ? { execution } : {}),
          ...(cost ? { cost } : {}),
          ...(desc ? { description: desc } : {}),
          ...(avatarUrl ? { avatar_url: avatarUrl } : {})
        },
      });
    };

    if (cls) {
      // Look up progression data for feature IDs
      const progClass = (classesProgressionData as any).classes?.[classId];
      (cls.features || []).forEach((f: any) => {
        if ((f.level ?? 0) <= level) {
          const progLevel = progClass?.levelProgression?.[String(f.level)];
          const progFeat = progLevel?.features?.find((pf: any) => pf.nameEn === f.nameEn || pf.name === f.name);
          addFeature(f.name, f.nameEn || '', f.level, f.description, '★', progFeat?.id, f);
        }
      });

      const subclassId = character.subclass_id;
      if (subclassId && cls.subclasses) {
        const sub = cls.subclasses.find((s: any) => s.id === subclassId);
        if (sub) {
          // Find subclass progression data for IDs
          let progSubclass: any = null;
          if (progClass?.levelProgression) {
            for (const lvlData of Object.values(progClass.levelProgression) as any[]) {
              for (const feat of lvlData.features || []) {
                if (feat.type === 'subclass' && feat.choices) {
                  const found = feat.choices.find((c: any) => c.id === subclassId);
                  if (found) { progSubclass = found; break; }
                }
              }
              if (progSubclass) break;
            }
          }
          (sub.level1Features || []).forEach((f: any) =>
            addFeature(f.name, f.nameEn || '', 3, f.description, '★', f.id, f));
          if (typeof sub.features === 'string') {
            sub.features.match(/([^、]+?（\d+级）)/g)?.forEach((m: string) => {
              const lm = m.match(/(.+?)（(\d+)级）/);
              if (lm && parseInt(lm[2], 10) <= level) {
                const fName = lm[1].trim();
                const fLevel = parseInt(lm[2], 10);
                const progFeat = progSubclass?.features?.find((f: any) => f.name === fName && f.level === fLevel);
                const structuredFeature = findSubclassFeatureData(sub, fName, fLevel) || progFeat;
                addFeature(
                  fName,
                  structuredFeature?.nameEn || progFeat?.nameEn || '',
                  fLevel,
                  structuredFeature?.description || progFeat?.description || `${sub.name || '子职业'}${lm[2]}级特性`,
                  '★',
                  structuredFeature?.id || progFeat?.id,
                  structuredFeature,
                );
              }
            });
          }
        }
      }
    }

    // Racial traits (only active abilities: innate spellcasting, damage, cantrips)
    const race = (racesData as any).races?.find((r: any) => r.id === character.race_id);
    const subrace = race?.subraces?.find((s: any) => s.id === character.subrace_id);
    const isActiveAbility = (t: any): boolean => {
      if (t.spells?.length > 0) return true;
      if (t.damage?.length > 0) return true;
      if (t.cantrip) return true;
      if (t.cantripChoice) return true;
      return false;
    };
    const addRacialTraits = (traits: any[]) => {
      for (const t of traits) {
        if (!isActiveAbility(t)) continue;
        // Enrich Breath Weapon description with subrace-specific details
        let desc = t.description;
        if (t.nameEn === 'Breath Weapon' && subrace?.breathWeapon) {
          const bw = subrace.breathWeapon;
          const dtCn = subrace.damageTypeCn || subrace.damageType || '';
          desc = (desc || '') + `\n\n【${subrace.name}】${bw.shapeCn || bw.shape}（${bw.size}），${dtCn}伤害，${bw.saveCn || bw.save}豁免。`;
          // Use dragon breath icon with damage type
          const dmgType = subrace.damageType || 'fire';
          const avatarUrl = getAssetUrl(`assets/spell-icons/breath_weapon_${dmgType}.png`);
          if (!t.name || seen.has(t.name)) continue;
          seen.add(t.name);
          const cost = FEATURE_ACTION_COST[t.name] || FEATURE_ACTION_COST[t.nameEn] || undefined;
          items.push({
            type: 'feature', id: t.nameEn || t.name, name: t.name, icon: '◆',
            meta: { level: 0, ...(cost ? { cost } : {}), ...(desc ? { description: desc } : {}), avatar_url: avatarUrl },
          });
          continue;
        }
        addFeature(t.name, t.nameEn || '', 0, desc, '◆');
      }
    };
    if (race?.traits) addRacialTraits(race.traits);
    if (subrace?.traits) addRacialTraits(subrace.traits);

    // Martial Adept maneuvers (from feat_choices)
    const fc = character.feat_choices || (character as any).featChoices;
    const ma = fc?.martial_adept;
    if (ma?.maneuvers && Array.isArray(ma.maneuvers)) {
      for (const mId of ma.maneuvers) {
        const mName = MANEUVER_NAMES[mId] || mId.replace(/_/g, ' ');
        addFeature(mName, mId, 0, `战技：${mName}（武艺专家）`, '⚔');
      }
    }

    // Four Elements elemental disciplines (from subclass_choices)
    const sc = character.subclass_choices || (character as any).subclassChoices;
    const knownDisciplines: string[] = sc?.elementalDisciplines || [];
    if (knownDisciplines.length > 0) {
      for (const dId of knownDisciplines) {
        const dData = allAbilities.find((a: any) => a.id === dId && a.resourceId === 'elemental_disciplines');
        if (!dData || seen.has(dData.name)) continue;
        seen.add(dData.name);
        const cost = ACTION_COST_MAP[dData.actionType] || '动作';
        items.push({
          type: 'feature', id: dData.nameEn || dData.id, name: dData.name, icon: '🌀',
          meta: {
            level: dData.minLevel || 3,
            cost,
            description: `[${dData.cost === 0 ? '免费' : dData.cost + '气'}] ${dData.description}`,
            avatar_url: getAssetUrl(`assets/class-feature-icons/elemental_disciplines.png`),
            ...(dData.execution ? { execution: dData.execution } : {}),
          },
        });
      }
    }

    // Open Hand / Shadow monk abilities (automatic based on subclass + level)
    const subId = character.subclass_id;
    if (character.class_id === 'monk' && (subId === 'open_hand' || subId === 'shadow')) {
      for (const ab of allAbilities) {
        if (ab.subclassId !== subId) continue;
        if ((ab.minLevel || 0) > level) continue;
        if (seen.has(ab.name)) continue;
        seen.add(ab.name);
        const cost = ACTION_COST_MAP[ab.actionType] || '动作';
        const kiLabel = ab.cost === 0 ? '免费' : ab.cost + '气';
        items.push({
          type: 'feature', id: ab.nameEn || ab.id, name: ab.name, icon: subId === 'shadow' ? '🌑' : '✋',
          meta: {
            level: ab.minLevel || 3,
            cost,
            description: `[${kiLabel}] ${ab.description}`,
            ...(ab.execution ? { execution: ab.execution } : {}),
          },
        });
      }
    }

    return items;
  }, [character.class_id, character.subclass_id, character.race_id, character.subrace_id, character.level, character.feat_choices, character.subclass_choices]);

  // --- Items tab: usable items ---
  const itemItems = useMemo(() => {
    return (character.equipment || [])
      .filter((eq: EquipmentItem) => {
        const t = eq.equipmentType || '';
        return t !== 'weapon' && t !== 'armor';
      })
      .map((eq: EquipmentItem): HotbarSlot => ({
        type: 'item', id: eq.id, name: eq.name, icon: '◆',
        meta: { quantity: eq.quantity, avatar_url: equipIconUrl(eq), description: eq.description },
      }));
  }, [character.equipment]);

  // Current tab filtered by search
  const currentItems = useMemo(() => {
    const map: Record<TabId, HotbarSlot[]> = {
      actions: actionItems, spells: spellItems, features: featureItems, items: itemItems,
    };
    const list = map[tab] || [];
    if (!search.trim()) return list;
    const q = search.trim().toLowerCase();
    return list.filter(it => it.name.toLowerCase().includes(q));
  }, [tab, actionItems, spellItems, featureItems, itemItems, search]);

  // Group spells by level
  const groupedSpells = useMemo(() => {
    if (tab !== 'spells') return null;
    const groups = new Map<number, HotbarSlot[]>();
    currentItems.forEach(item => {
      const lv = item.meta?.level ?? -1;
      if (!groups.has(lv)) groups.set(lv, []);
      groups.get(lv)!.push(item);
    });
    return Array.from(groups.entries()).sort((a, b) => a[0] - b[0]);
  }, [tab, currentItems]);

  const handleSelect = (item: HotbarSlot) => {
    const { _level, ...clean } = item as any;
    onSelect(clean);
    onClose();
  };

  const handleOpenInfo = (item: HotbarSlot) => {
    if (item.type !== 'spell') return;
    const spell = spellMap.get(item.id);
    if (spell) setSpellDetail(spell);
  };

  // Check if an item has detail info to show
  const hasInfo = (item: HotbarSlot): boolean => {
    return item.type === 'spell' && spellMap.has(item.id);
  };

  if (!open || typeof document === 'undefined') return null;

  return (
    <>
      {createPortal(
        <div className="fixed inset-0 z-[200] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Modal box */}
      <div
        className="relative w-[92vw] max-w-lg h-[80dvh] bg-gray-900 border border-gray-700 rounded-lg
          flex flex-col shadow-2xl overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-label="快捷栏 - 选择动作"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-gray-700/60 flex-shrink-0">
          <h2 className="text-sm font-semibold text-gray-200">
            快捷栏 - 选择动作
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded
              bg-gray-700/50 hover:bg-gray-600/50 text-gray-400 hover:text-white transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Normal picker content - always visible */}
        <>
          {/* Search */}
          <div className="px-4 py-2 flex-shrink-0">
            <input
              type="text" value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="搜索..."
              className="w-full px-3 py-1.5 text-sm bg-gray-800 border border-gray-600 rounded
                text-gray-200 placeholder-gray-500 focus:outline-none focus:border-amber-600/60"
            />
          </div>

          {/* Tabs */}
          <div className="flex gap-1 px-4 pb-2 flex-shrink-0">
            {TABS.map(t => (
              <button
                key={t.id} onClick={() => setTab(t.id)}
                className={`flex items-center gap-1 px-3 py-1.5 rounded text-xs font-medium transition-colors
                  ${tab === t.id
                    ? 'bg-amber-700/40 text-amber-300 border border-amber-600/50'
                    : 'bg-gray-800/60 text-gray-400 border border-transparent hover:text-gray-300 hover:bg-gray-800'
                  }`}
              >
                <span>{t.icon}</span>
                <span>{t.label}</span>
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto px-4 pb-4 min-h-0">
            {currentItems.length === 0 ? (
              <div className="text-center text-gray-500 text-sm py-8">
                {search ? '无匹配结果' : '暂无可用动作'}
              </div>
            ) : tab === 'spells' && groupedSpells ? (
              <div className="space-y-3">
                {groupedSpells.map(([level, items]) => (
                  <div key={level}>
                    <div className="text-xs text-purple-400 font-medium mb-1">
                      {getSpellLevelLabel(level)}
                    </div>
                    <div className="space-y-0.5">
                      {items.map(item => (
                        <PickerRow key={item.id} item={item} onSelect={handleSelect}
                          detail={item.meta?.school}
                          onInfo={hasInfo(item) ? () => handleOpenInfo(item) : undefined} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-0.5">
                {currentItems.map((item, i) => (
                  <PickerRow key={`${item.id}-${i}`} item={item} onSelect={handleSelect}
                    detail={
                      item.meta?.damage ? `${item.meta.damage} ${item.meta.damageType ? tDamageType(String(item.meta.damageType)) : ''}`.trim() :
                      item.type === 'feature' && item.meta?.level ? `${item.meta.level}级` :
                      item.type === 'feature' && item.icon === '◆' ? '种族' :
                      item.type !== 'feature' && item.meta?.description ? item.meta.description :
                      item.meta?.quantity && item.meta.quantity > 1 ? `x${item.meta.quantity}` :
                      undefined
                    }
                    onInfo={hasInfo(item) ? () => handleOpenInfo(item) : undefined} />
                ))}
              </div>
            )}
          </div>
        </>

      </div>
        </div>,
        document.body
      )}
      <SpellDetailModal spell={spellDetail as any} onClose={() => setSpellDetail(null)} />
    </>
  );
}

function PickerRow({ item, onSelect, detail, onInfo }: {
  item: HotbarSlot;
  onSelect: (item: HotbarSlot) => void;
  detail?: string;
  onInfo?: () => void;
}) {
  const [imgErr, setImgErr] = useState(false);
  const colorMap: Record<string, string> = {
    spell: 'text-purple-400', weapon: 'text-amber-400',
    feature: 'text-emerald-400', item: 'text-gray-400',
  };
  const cost = item.meta?.cost as string | undefined;
  const costClass = cost ? COST_COLORS[cost] || 'bg-gray-700 text-gray-300' : '';

  const avatarUrl = item.meta?.avatar_url as string | undefined;

  return (
    <div
      className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded
        hover:bg-gray-800 text-gray-300 transition-colors cursor-pointer"
      onClick={() => onSelect(item)}
    >
      {avatarUrl && !imgErr ? (
        <img src={avatarUrl} alt="" className="w-5 h-5 object-contain flex-shrink-0"
          onError={() => setImgErr(true)} />
      ) : (
        <span className={`text-sm flex-shrink-0 ${colorMap[item.type] || 'text-gray-400'}`}>{item.icon}</span>
      )}
      <span className="text-sm truncate flex-1">{item.name}</span>
      {cost && (
        <span className={`text-[10px] px-1.5 py-0.5 rounded flex-shrink-0 ${costClass}`}>{cost}</span>
      )}
      {detail && !onInfo && (
        <span className="text-[11px] text-gray-500 flex-shrink-0">{detail}</span>
      )}
      {onInfo && (
        <button
          onClick={(e) => { e.stopPropagation(); onInfo(); }}
          className="w-6 h-6 flex items-center justify-center rounded bg-gray-700/80 hover:bg-amber-700/50
            text-gray-400 hover:text-amber-300 text-xs font-bold flex-shrink-0 transition-colors border border-gray-600/50 hover:border-amber-600/40"
          title="查看详情"
        >
          i
        </button>
      )}
    </div>
  );
}
