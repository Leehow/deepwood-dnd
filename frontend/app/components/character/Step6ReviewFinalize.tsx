import { useMemo, useState, useCallback } from "react";
import racesData from "~/data/rules/races.json";
import classesData from "~/data/rules/classes_with_structured_subclass_features.json";
import skillsData from "~/data/rules/skills.json";
import equipmentData from "~/data/rules/equipment.json";
import spellsData from "~/data/rules/spells.json";
import godsData from "~/data/rules/gods.json";
import spellcastingConfig from "~/data/rules/spellcasting.json";
import { SpellCard } from "~/components/spell/SpellCard";
import { normalizeSpellData } from "~/components/spell/normalizeSpell";
import { HelpTooltip } from "./HelpTooltip";
import { COMBAT_HELP_CONTENT } from "~/data/combat-help-content";

import { calculateSpeed as calculateSpeedUtil } from "./CharacterDisplay/utils/speed";
import { computeHP as computeHPUnified, computeProficiencyBonus as computeProficiencyUnified, computeFinalAbilityScores, getACBreakdown, getHPBreakdown, getSpeedBreakdown, getInitiativeBreakdown, getProficiencyBonusBreakdown, getAbilityScoreBreakdown, getSkillBreakdown, getHitDiceBreakdown, getSpellSaveDCBreakdown, getSpellAttackBonusBreakdown } from "./CharacterDisplay/utils/derived";


import { StatBreakdownDialog, type StatBreakdownData } from "./CharacterDisplay/sections/Info/StatBreakdownDialog";
import { AvatarModal } from "./CharacterDisplay/sections/Avatar/AvatarModal";
import { getAuthUser } from "~/utils/auth";
import { apiFetch } from "~/utils/api-client";
import { getAssetUrl } from "~/utils/asset-url";
import type { CharacterState } from "./types";

interface Step6Props {
  character: any;
  setCharacter: React.Dispatch<React.SetStateAction<CharacterState>>;
  setCurrentStep: (step: number) => void;
}

const ALIGNMENTS = [
  { id: "LG", name: "守序善良", nameEn: "Lawful Good" },
  { id: "NG", name: "中立善良", nameEn: "Neutral Good" },
  { id: "CG", name: "混乱善良", nameEn: "Chaotic Good" },
  { id: "LN", name: "守序中立", nameEn: "Lawful Neutral" },
  { id: "N", name: "绝对中立", nameEn: "True Neutral" },
  { id: "CN", name: "混乱中立", nameEn: "Chaotic Neutral" },
  { id: "LE", name: "守序邪恶", nameEn: "Lawful Evil" },
  { id: "NE", name: "中立邪恶", nameEn: "Neutral Evil" },
  { id: "CE", name: "混乱邪恶", nameEn: "Chaotic Evil" },
];

const getAbilityName = (abilityId: string): string => {
  const abilityMap: Record<string, string> = {
    strength: "力量",
    dexterity: "敏捷",
    constitution: "体质",
    intelligence: "智力",
    wisdom: "感知",
    charisma: "魅力",
  };
  return abilityMap[abilityId] || abilityId;
};

const getAbilityModifier = (score: number): number => {
  return Math.floor((score - 10) / 2);
};

const getSkillName = (skillId: string): string => {
  const skill = skillsData.skills.find((s: any) => s.id === skillId);
  return skill?.name || skillId;
};

const getSkillAbility = (skillId: string): string => {
  const skill = skillsData.skills.find((s: any) => s.id === skillId);
  return skill?.ability || "";
};

// Proficiency name mappings now use unified dictionary
import { tProficiency } from "~/utils/i18n";

const getProficiencyName = (profId: string): string => {
  return tProficiency(profId);
};

const InfoSection = ({ title, children, onEdit }: { title: string | React.ReactNode; children: React.ReactNode; onEdit?: () => void }) => (
  <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
    <div className="flex items-center justify-between mb-3">
      <h4 className="font-semibold text-amber-400">
        {typeof title === 'string' ? title : <div className="flex items-center">{title}</div>}
      </h4>
      {onEdit && (
        <button onClick={onEdit} className="text-sm text-blue-400 hover:text-blue-300 transition-colors">
          编辑
        </button>
      )}
    </div>
    {children}
  </div>
);

export function Step6ReviewFinalize({ character, setCharacter, setCurrentStep }: Step6Props) {
  const race = racesData.races.find(r => r.id === character.raceId);
  const subrace = race?.subraces?.find(sr => sr.id === character.subraceId);
  const characterClass = classesData.classes.find((c: any) => c.id === character.classId);
  const alignment = ALIGNMENTS.find(a => a.id === character.alignment);

  // Get deity info
  const getDeity = () => {
    if (!character.deityId) return null;
    for (const pantheon of godsData.pantheons) {
      const deity = pantheon.deities?.find((d: any) => d.id === character.deityId);
      if (deity) return deity;
    }
    return null;
  };
  // Breakdown dialog state
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [breakdownData, setBreakdownData] = useState<StatBreakdownData | null>(null);

  // Avatar modal state
  const [avatarModalOpen, setAvatarModalOpen] = useState(false);
  const [avatarGenLoading, setAvatarGenLoading] = useState(false);
  const authUser = getAuthUser();
  const userId = authUser?.id || "";

  const handleAvatarSelected = useCallback((avatar: string) => {
    setCharacter(prev => ({ ...prev, avatar }));
  }, [setCharacter]);

  const handleWizardGenerateAvatar = useCallback(async () => {
    try {
      setAvatarGenLoading(true);
      const app = character.appearance || {};
      const traits: string[] = (character.personality?.traits || []).slice(0, 3);
      const appearance_description = [
        app.height ? `身高: ${app.height}` : null,
        app.weight ? `体重: ${app.weight}` : null,
        app.eyes ? `眼睛: ${app.eyes}` : null,
        app.skin ? `肤色: ${app.skin}` : null,
        app.hair ? `头发: ${app.hair}` : null,
        app.distinguishingMarks ? `特征: ${app.distinguishingMarks}` : null,
      ].filter(Boolean).join(", ");

      // Use subrace image if available, otherwise race image
      const raceImageId = character.subraceId || character.raceId;
      const raceRefUrl = raceImageId ? getAssetUrl(`images/races/${raceImageId}.png`) : undefined;

      const resp = await apiFetch("/api/ai-settings/generate-avatar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          race: character.raceId,
          subrace: character.subraceId || null,
          character_class: character.classId,
          background: character.backgroundId || null,
          name: character.name,
          age: character.age,
          gender: character.gender,
          appearance_description,
          personality_traits: traits,
          race_reference_image: raceRefUrl,
        }),
      });
      if (!resp.ok) {
        alert("头像生成失败，请检查AI设置");
        return;
      }
      const data = await resp.json();
      if (data.image) {
        setCharacter(prev => ({ ...prev, avatar: data.image }));
      }
    } catch {
      alert("头像生成异常");
    } finally {
      setAvatarGenLoading(false);
      setAvatarModalOpen(false);
    }
  }, [character, userId, setCharacter]);

  const handleWizardUploadAvatar = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async (e: any) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        const base64 = event.target?.result as string;
        setCharacter(prev => ({ ...prev, avatar: base64 }));
        setAvatarModalOpen(false);
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }, [setCharacter]);

  const deity = getDeity();

  // Character level (default to 1)
  const level = character.level || 1;

  // Proficiency bonus
  const proficiencyBonus = computeProficiencyUnified(level);

  // Calculate final ability scores with racial bonuses (shared with popup)
  const computedFinalScores = computeFinalAbilityScores(character);
  const finalAbilityScores: Record<string, number> = { ...computedFinalScores };
  const finalAbilityModifiers: Record<string, number> = {};
  Object.keys(finalAbilityScores).forEach(abilityId => {
    finalAbilityModifiers[abilityId] = getAbilityModifier(finalAbilityScores[abilityId]);
  });

  // Calculate AC using the same function as the popup breakdown
  const acBreakdown = getACBreakdown(character);
  const acResult = { ac: acBreakdown.final, formula: acBreakdown.items.map(i => `${i.label}(${i.value >= 0 ? '+' : ''}${i.value})`).join(' ') };

  // Calculate initiative
  const initiative = finalAbilityModifiers.dexterity || 0;
  const initiativeStr = initiative >= 0 ? `+${initiative}` : `${initiative}`;


  const speed = calculateSpeedUtil(character);

  // HP using unified computation (include subrace flat and per-level bonuses)
  const hitPoints = computeHPUnified(character, { includeFlatSubraceHP: true, includeSubraceLevelBonuses: true });

  const hitDie = characterClass?.hitDie || "d8";
  const hitDice = typeof hitDie === 'number' ? `1d${hitDie}` : `1${hitDie}`;

  // Saving throws
  const savingThrows = characterClass?.savingThrows || [];

  // Spellcasting ability and stats
  const spellcastingData = useMemo(() => {
    const classId = character.classId;

    // Define spellcasting classes and their spellcasting abilities
    const spellcastingClasses: Record<string, { ability: string; abilityName: string; type: 'full' | 'half' | 'pact' }> = {
      wizard: { ability: 'intelligence', abilityName: '智力', type: 'full' },
      sorcerer: { ability: 'charisma', abilityName: '魅力', type: 'full' },
      bard: { ability: 'charisma', abilityName: '魅力', type: 'full' },
      cleric: { ability: 'wisdom', abilityName: '感知', type: 'full' },
      druid: { ability: 'wisdom', abilityName: '感知', type: 'full' },
      warlock: { ability: 'charisma', abilityName: '魅力', type: 'pact' },
      paladin: { ability: 'charisma', abilityName: '魅力', type: 'half' },
      ranger: { ability: 'wisdom', abilityName: '感知', type: 'half' },
    };

    const spellcasting = spellcastingClasses[classId];
    if (!spellcasting) return null;

    const abilityMod = finalAbilityModifiers[spellcasting.ability] || 0;
    const spellSaveDC = 8 + proficiencyBonus + abilityMod;
    const spellAttackBonus = proficiencyBonus + abilityMod;
    const spellAttackStr = spellAttackBonus >= 0 ? `+${spellAttackBonus}` : `${spellAttackBonus}`;

    // Calculate spell slots based on class type and level
    const calculateSpellSlots = () => {
      const config: any = spellcastingConfig as any;

      if (spellcasting.type === 'pact') {
        // Warlock uses Pact Magic (from JSON)
        const pactConfig = config.pactMagic?.warlock || {};
        const availableLevels = Object.keys(pactConfig)
          .map((k: string) => Number(k))
          .filter((n) => !Number.isNaN(n) && n <= level)
          .sort((a, b) => b - a);
        const effectiveLevelKey = availableLevels[0] ?? 1;
        const entry = pactConfig[String(effectiveLevelKey)] || { slots: 1, level: 1 };
        return entry;
      }

      // Full casters and half casters use standard spell slots from JSON
      // Spell slot table: [1st, 2nd, 3rd, 4th, 5th, 6th, 7th, 8th, 9th]
      const slotTables = config.slotTables || {};
      const tableKey = spellcasting.type === 'full' ? 'fullCaster' : 'halfCaster';
      const table = slotTables[tableKey] || {};
      const rawSlots: number[] = table[String(level)] || [];
      const slots = [...rawSlots];

      // Normalize to 9 levels (pad with zeros for UI)
      while (slots.length < 9) {
        slots.push(0);
      }

      return slots;
    };

    const spellSlots = calculateSpellSlots();

    return {
      ability: spellcasting.ability,
      abilityName: spellcasting.abilityName,
      abilityMod,
      spellSaveDC,
      spellAttackBonus,
      spellAttackStr,
      type: spellcasting.type,
      spellSlots,
    };
  }, [character.classId, finalAbilityModifiers, proficiencyBonus, level]);

  // Racial traits (must be defined before extractRacialProficiencies)
  const racialTraits = [
    ...(race?.traits || []),
    ...(subrace?.traits || [])
  ];

  // Extract structured data from racial traits
  const extractRacialProficiencies = () => {
    const weapons: string[] = [];
    const armors: string[] = [];
    const tools: string[] = [];
    const savingThrowAdvantages: string[] = [];
    const damageResistances: string[] = [];
    const cantrips: string[] = [];
    const languages: string[] = [];
    let darkvisionRange = 0;

    racialTraits.forEach((trait: any) => {
      if (trait.structuredData) {
        weapons.push(...(trait.structuredData.weaponProficiencies || []));
        armors.push(...(trait.structuredData.armorProficiencies || []));
        tools.push(...(trait.structuredData.toolProficiencies || []));
        savingThrowAdvantages.push(...(trait.structuredData.savingThrowAdvantages || []));
        damageResistances.push(...(trait.structuredData.damageResistances || []));
      }

      // Extract cantrips from trait fields
      if (trait.cantrip) {
        cantrips.push(trait.cantrip);
      }

      // Extract languages from trait fields
      if (trait.languages) {
        languages.push(...trait.languages);
      }

      // Extract darkvision (use the highest range)
      if (trait.darkvision && trait.darkvision > darkvisionRange) {
        darkvisionRange = trait.darkvision;
      }
    });

    return {
      weapons,
      armors,
      tools,
      savingThrowAdvantages,
      damageResistances,
      cantrips,
      languages,
      darkvision: darkvisionRange
    };
  };

  const racialProficiencies = extractRacialProficiencies();

  // Subclass (must be defined before extractSubclassProficiencies)
  const subclass = characterClass?.subclasses?.find((sc: any) => sc.id === character.subclassId);

  // Extract structured data from subclass features
  const extractSubclassProficiencies = () => {
    const weapons: string[] = [];
    const armors: string[] = [];
    const tools: string[] = [];
    const skills: string[] = [];
    const languages: string[] = [];
    const bonusCantrips: string[] = [];
    const domainSpells: Record<string, string[]> = {};
    const expandedSpells: Record<string, string[]> = {};
    const damageResistances: string[] = [];
    const damageImmunities: string[] = [];
    const conditionImmunities: string[] = [];

    if (subclass?.level1Features) {
      subclass.level1Features.forEach((feature: any) => {
        if (feature.structuredData) {
          weapons.push(...(feature.structuredData.weaponProficiencies || []));
          armors.push(...(feature.structuredData.armorProficiencies || []));
          tools.push(...(feature.structuredData.toolProficiencies || []));
          skills.push(...(feature.structuredData.skillProficiencies || []));
          languages.push(...(feature.structuredData.languageProficiencies || []));
          bonusCantrips.push(...(feature.structuredData.bonusCantrips || []));
          damageResistances.push(...(feature.structuredData.damageResistances || []));
          damageImmunities.push(...(feature.structuredData.damageImmunities || []));
          conditionImmunities.push(...(feature.structuredData.conditionImmunities || []));

          // Merge domain spells
          if (feature.structuredData.domainSpells) {
            Object.entries(feature.structuredData.domainSpells).forEach(([level, spells]: [string, unknown]) => {
              if (!domainSpells[level]) {
                domainSpells[level] = [];
              }
              domainSpells[level].push(...(spells as string[]));
            });
          }

          // Merge expanded spells
          if (feature.structuredData.expandedSpells) {
            Object.entries(feature.structuredData.expandedSpells).forEach(([level, spells]: [string, unknown]) => {
              if (!expandedSpells[level]) {
                expandedSpells[level] = [];
              }
              expandedSpells[level].push(...(spells as string[]));
            });
          }
        }
      });
    }

    return {
      weapons,
      armors,
      tools,
      skills,
      languages,
      bonusCantrips,
      domainSpells,
      expandedSpells,
      damageResistances,
      damageImmunities,
      conditionImmunities
    };
  };

  const subclassProficiencies = extractSubclassProficiencies();

  // Skill proficiencies with modifiers (from class + subclass choices + subclass features)
  const skillProficiencies = [
    ...(character.selectedSkills || []),
    ...(character.subclassChoices?.skill || []),
    ...subclassProficiencies.skills
  ];

  // Other proficiencies - aggregate from all sources (class + race + subclass), dedup after translation
  const armorProficiencies = [...new Set([
    ...(characterClass?.proficiencies?.armor || []),
    ...racialProficiencies.armors,
    ...subclassProficiencies.armors
  ].map(getProficiencyName))];
  const weaponProficiencies = [...new Set([
    ...(characterClass?.proficiencies?.weapons || []),
    ...racialProficiencies.weapons,
    ...subclassProficiencies.weapons
  ].map(getProficiencyName))];
  const toolProficiencies = [...new Set([
    ...(characterClass?.proficiencies?.tools || []),
    ...(character.raceChoices?.toolProficiency ? [character.raceChoices.toolProficiency] : []),
    ...racialProficiencies.tools,
    ...subclassProficiencies.tools
  ].map(getProficiencyName))];

  // Languages - aggregate from all sources (race + race choices + subclass choices + subclass features + racial traits)
  const allLanguages = [
    ...(race?.languages || []),
    ...(character.raceChoices?.language ? [character.raceChoices.language] : []),
    ...(character.subclassChoices?.language || []),
    ...(character.subclassChoices?.languages || []), // backward compatibility
    ...subclassProficiencies.languages,
    ...racialProficiencies.languages
  ];

  // Class features (level 1)
  const classFeatures = characterClass?.features?.filter((f: any) => f.level === 1) || [];

  // Subclass features (subclass already defined above)
  const subclassFeatures = subclass?.level1Features || [];

  // Spells - aggregate from all sources (character + subclass + racial traits), deduplicated
  const selectedCantrips: string[] = [...new Set([
    ...(character.selectedCantrips || []),
    ...subclassProficiencies.bonusCantrips,
    ...racialProficiencies.cantrips
  ])];
  const selectedSpells: string[] = [...new Set<string>(character.selectedSpells || [])];
  const preparedSpells: string[] = [...new Set<string>(character.preparedSpells || [])];

  // Domain spells and expanded spells (automatically known/prepared)
  const domainSpells: string[] = [];
  const expandedSpells: string[] = [];

  // Add level 1 domain spells (for clerics)
  if (subclassProficiencies.domainSpells['1']) {
    domainSpells.push(...subclassProficiencies.domainSpells['1']);
  }

  // Add level 1 expanded spells (for warlocks)
  if (subclassProficiencies.expandedSpells['1']) {
    expandedSpells.push(...subclassProficiencies.expandedSpells['1']);
  }

  // Get spell name by ID
  const getSpellName = (spellId: string): string => {
    const spell = spellsData.spells.find((s: any) => s.id === spellId);
    return spell ? spell.name : spellId;
  };

  // Get spell description by ID
  const getSpellDescription = (spellId: string): string => {
    const spell = spellsData.spells.find((s: any) => s.id === spellId);
    return spell ? spell.description : "";
  };

  // --- Export helpers ---
  const fmt = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

  const propertyMap: Record<string, string> = {
    light: "轻型", finesse: "灵巧", thrown: "投掷", versatile: "双用",
    "two-handed": "双手", ammunition: "弹药", loading: "填弹", heavy: "重型", reach: "触及", special: "特殊",
  };

  const generateMarkdown = (): string => {
    const charName = character.name || "未命名角色";
    const raceName = race?.name || "未选择";
    const className = characterClass?.name || "未选择";
    const alignName = alignment?.name || "未设置";
    let md = `# ${charName}\n\n`;
    md += `> ${raceName}${subrace ? `（${subrace.name}）` : ''} · ${className} ${character.level}级 · ${alignName}`;
    if (character.gender) md += ` · ${character.gender}`;
    if (character.age) md += ` · ${character.age}岁`;
    if (deity) md += ` · 信仰${deity.name}`;
    if (character.backgroundId) {
      const bgName = character.backgroundId;
      md += ` · 背景：${bgName}`;
    }
    md += '\n\n';

    // Appearance
    const app = character.appearance;
    if (app && (app.height || app.weight || app.eyes || app.skin || app.hair || app.distinguishingMarks)) {
      md += `## 外貌\n\n`;
      if (app.height) md += `- **身高**: ${app.height}\n`;
      if (app.weight) md += `- **体重**: ${app.weight}\n`;
      if (app.eyes) md += `- **眼睛**: ${app.eyes}\n`;
      if (app.skin) md += `- **肤色**: ${app.skin}\n`;
      if (app.hair) md += `- **头发**: ${app.hair}\n`;
      if (app.distinguishingMarks) md += `- **特征**: ${app.distinguishingMarks}\n`;
      md += '\n';
    }

    md += `## 战斗数据\n\n`;
    md += `| AC | 先攻 | 速度 | HP | 生命骰 | 熟练加值 |\n|---|---|---|---|---|---|\n`;
    md += `| ${acResult.ac} | ${initiativeStr} | ${speed}尺 | ${hitPoints} | ${hitDice} | +${proficiencyBonus} |\n\n`;

    md += `## 属性值 & 豁免\n\n`;
    md += `| 属性 | 值 | 调整值 | 豁免 |\n|---|---|---|---|\n`;
    Object.entries(finalAbilityScores).forEach(([id, score]: [string, number]) => {
      const mod = finalAbilityModifiers[id];
      const prof = savingThrows.includes(id);
      const save = mod + (prof ? proficiencyBonus : 0);
      md += `| ${getAbilityName(id)} | ${score} | ${fmt(mod)} | ${fmt(save)}${prof ? ' ★' : ''} |\n`;
    });

    md += `\n## 技能\n\n`;
    skillsData.skills.forEach((s: any) => {
      const prof = skillProficiencies.includes(s.id);
      const total = (finalAbilityModifiers[s.ability] || 0) + (prof ? proficiencyBonus : 0);
      if (prof) md += `- **★ ${s.name}** (${getAbilityName(s.ability)}): ${fmt(total)}\n`;
      else md += `- ${s.name} (${getAbilityName(s.ability)}): ${fmt(total)}\n`;
    });

    if (armorProficiencies.length || weaponProficiencies.length || allLanguages.length) {
      md += `\n## 熟练项\n\n`;
      if (armorProficiencies.length) md += `- **护甲**: ${armorProficiencies.join('、')}\n`;
      if (weaponProficiencies.length) md += `- **武器**: ${weaponProficiencies.join('、')}\n`;
      if (toolProficiencies.length) md += `- **工具**: ${toolProficiencies.join('、')}\n`;
      if (allLanguages.length) md += `- **语言**: ${allLanguages.map(getProficiencyName).join('、')}\n`;
    }

    // Equipment
    if (character.equipment?.length) {
      md += `\n## 装备\n\n`;
      character.equipment.forEach((item: any) => {
        let line = `- **${item.name}**`;
        if (item.quantity > 1) line += ` ×${item.quantity}`;
        const details: string[] = [];
        if (item.damage) details.push(`伤害 ${item.damage}`);
        if (item.ac) details.push(`AC ${item.ac}`);
        if (item.properties?.length) {
          details.push(item.properties.map((p: string) => propertyMap[p] || p).join('、'));
        }
        if (details.length) line += ` — ${details.join('，')}`;
        md += `${line}\n`;
      });
    }

    if (selectedCantrips.length || selectedSpells.length || preparedSpells.length) {
      md += `\n## 法术\n\n`;
      if (spellcastingData) {
        md += `> 施法属性: ${spellcastingData.abilityName} · DC ${spellcastingData.spellSaveDC} · 攻击 ${spellcastingData.spellAttackStr}\n\n`;
      }
      if (selectedCantrips.length) md += `**戏法**: ${selectedCantrips.map(getSpellName).join('、')}\n\n`;
      if (selectedSpells.length) md += `**已知法术**: ${selectedSpells.map(getSpellName).join('、')}\n\n`;
      if (preparedSpells.length) md += `**已准备法术**: ${preparedSpells.map(getSpellName).join('、')}\n\n`;
    }

    if (classFeatures.length) {
      md += `## 职业特性\n\n`;
      classFeatures.forEach((f: any) => md += `- **${f.name}**: ${f.description}\n`);
      md += '\n';
    }
    if (racialTraits.length) {
      md += `## 种族特性\n\n`;
      racialTraits.forEach((t: any) => md += `- **${t.name}**: ${t.description}\n`);
      md += '\n';
    }

    if (character.personality) {
      md += `## 个性特征\n\n`;
      if (character.personality.traits?.length) md += `- **特质**: ${character.personality.traits.join('；')}\n`;
      if (character.personality.ideals) md += `- **理想**: ${character.personality.ideals}\n`;
      if (character.personality.bonds) md += `- **羁绊**: ${character.personality.bonds}\n`;
      if (character.personality.flaws) md += `- **缺陷**: ${character.personality.flaws}\n`;
    }
    if (character.backstory) md += `\n## 背景故事\n\n${character.backstory}\n`;

    return md;
  };

  const downloadMarkdown = () => {
    const markdown = generateMarkdown();
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${character.name || '角色卡'}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const downloadPDF = () => {
    const charName = character.name || "未命名角色";
    const raceName = race?.name || "未选择";
    const className = characterClass?.name || "未选择";
    const alignName = alignment?.name || "未设置";
    const app = character.appearance || {};
    const avatarSrc = character.avatar || '';

    // Helpers to build HTML fragments
    const esc = (s: string) => s.replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Ability score boxes (2 rows of 3)
    const abilityBoxes = Object.entries(finalAbilityScores).map(([id, score]: [string, number]) => {
      const mod = finalAbilityModifiers[id];
      const prof = savingThrows.includes(id);
      const save = mod + (prof ? proficiencyBonus : 0);
      return `<div class="ability-box${prof ? ' prof' : ''}">
        <div class="ab-name">${getAbilityName(id)}</div>
        <div class="ab-score">${score}</div>
        <div class="ab-mod">${fmt(mod)}</div>
        <div class="ab-save">豁免 ${fmt(save)}${prof ? ' ★' : ''}</div>
      </div>`;
    }).join('');

    // Skill rows (two-column)
    const half = Math.ceil(skillsData.skills.length / 2);
    const buildSkillCol = (skills: any[]) => skills.map((s: any) => {
      const prof = skillProficiencies.includes(s.id);
      const total = (finalAbilityModifiers[s.ability] || 0) + (prof ? proficiencyBonus : 0);
      return `<div class="skill-row${prof ? ' prof' : ''}">
        <span class="sk-dot">${prof ? '●' : '○'}</span>
        <span class="sk-name">${s.name}</span>
        <span class="sk-val">${fmt(total)}</span>
      </div>`;
    }).join('');
    const skillCol1 = buildSkillCol(skillsData.skills.slice(0, half));
    const skillCol2 = buildSkillCol(skillsData.skills.slice(half));

    // Equipment
    let equipHtml = '';
    if (character.equipment?.length) {
      equipHtml = character.equipment.map((item: any) => {
        const details: string[] = [];
        if (item.damage) details.push(item.damage);
        if (item.ac) details.push(`AC ${item.ac}`);
        if (item.properties?.length) details.push(item.properties.map((p: string) => propertyMap[p] || p).join('·'));
        return `<div class="equip-item">
          <span>${esc(item.name)}${item.quantity > 1 ? ` ×${item.quantity}` : ''}</span>
          ${details.length ? `<span class="eq-detail">${details.join(' | ')}</span>` : ''}
        </div>`;
      }).join('');
    }

    // Proficiency tags
    const profTags = (label: string, items: string[]) => {
      if (!items.length) return '';
      return `<div class="prof-group"><span class="prof-label">${label}</span>${items.map(i => `<span class="tag">${i}</span>`).join('')}</div>`;
    };

    // Spells
    let spellsHtml = '';
    if (selectedCantrips.length || selectedSpells.length || preparedSpells.length) {
      spellsHtml = `<div class="card"><div class="card-title">法术</div>`;
      if (spellcastingData) {
        spellsHtml += `<div class="spell-meta">${spellcastingData.abilityName} · DC ${spellcastingData.spellSaveDC} · 攻击 ${spellcastingData.spellAttackStr}</div>`;
      }
      if (selectedCantrips.length) spellsHtml += `<div class="spell-group"><b>戏法</b> ${selectedCantrips.map(getSpellName).join('、')}</div>`;
      if (selectedSpells.length) spellsHtml += `<div class="spell-group"><b>已知法术</b> ${selectedSpells.map(getSpellName).join('、')}</div>`;
      if (preparedSpells.length) spellsHtml += `<div class="spell-group"><b>已准备</b> ${preparedSpells.map(getSpellName).join('、')}</div>`;
      spellsHtml += `</div>`;
    }

    // Appearance line
    const appParts: string[] = [];
    if (app.height) appParts.push(`身高 ${app.height}`);
    if (app.weight) appParts.push(`体重 ${app.weight}`);
    if (app.eyes) appParts.push(`眼睛 ${app.eyes}`);
    if (app.skin) appParts.push(`肤色 ${app.skin}`);
    if (app.hair) appParts.push(`头发 ${app.hair}`);
    if (app.distinguishingMarks) appParts.push(`特征 ${app.distinguishingMarks}`);

    // Features
    const featuresHtml = [...classFeatures.map((f: any) => `<div class="feat"><b>${esc(f.name)}</b> ${esc(f.description)}</div>`),
      ...racialTraits.map((t: any) => `<div class="feat"><b>${esc(t.name)}</b> ${esc(t.description)}</div>`)].join('');

    // Personality
    const p = character.personality || {};
    const persLines = [
      p.traits?.length ? `<b>特质：</b>${p.traits.join('；')}` : '',
      p.ideals ? `<b>理想：</b>${p.ideals}` : '',
      p.bonds ? `<b>羁绊：</b>${p.bonds}` : '',
      p.flaws ? `<b>缺陷：</b>${p.flaws}` : '',
    ].filter(Boolean).map(l => `<div class="pers-line">${l}</div>`).join('');

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${charName} - 角色卡</title>
<style>
@page{size:A4;margin:0}
*{margin:0;padding:0;box-sizing:border-box}
html,body{font-family:"PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif;background:#0f172a;color:#cbd5e1;font-size:10.5px;line-height:1.45;min-height:100%}
.page{max-width:780px;margin:0 auto;padding:12mm;position:relative}
.page::before{content:"";position:fixed;top:0;left:0;right:0;bottom:0;background:#0f172a;z-index:-1;-webkit-print-color-adjust:exact;print-color-adjust:exact}

/* ---- Header ---- */
.hdr{display:flex;gap:14px;align-items:center;padding:14px 16px;background:linear-gradient(135deg,#1e293b 0%,#0f172a 100%);border:1px solid #334155;border-radius:8px;margin-bottom:10px}
.avatar{width:72px;height:72px;border-radius:8px;object-fit:cover;border:2px solid #d97706;flex-shrink:0}
.avatar-placeholder{width:72px;height:72px;border-radius:8px;border:2px dashed #475569;flex-shrink:0;display:flex;align-items:center;justify-content:center;color:#475569;font-size:28px}
.hdr-info{flex:1;min-width:0}
.hdr-name{font-size:22px;font-weight:800;color:#fbbf24;letter-spacing:0.5px}
.hdr-sub{color:#94a3b8;font-size:11.5px;margin-top:2px}
.hdr-appear{color:#64748b;font-size:10px;margin-top:4px}

/* ---- Combat Stats ---- */
.combat{display:grid;grid-template-columns:repeat(6,1fr);gap:6px;margin-bottom:10px}
.cb{background:#1e293b;border:1px solid #334155;border-radius:6px;padding:6px 4px;text-align:center}
.cb .cl{font-size:8.5px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px}
.cb .cv{font-size:20px;font-weight:800;color:#fbbf24;line-height:1.2}
.cb .cv.red{color:#f87171}

/* ---- Cards ---- */
.row{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px}
.card{background:#1e293b;border:1px solid #334155;border-radius:6px;padding:10px;break-inside:avoid}
.card-title{font-size:11.5px;font-weight:700;color:#f59e0b;margin-bottom:8px;padding-bottom:4px;border-bottom:1px solid #334155;letter-spacing:0.3px}

/* ---- Ability Boxes ---- */
.ab-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
.ability-box{background:#0f172a;border:1px solid #334155;border-radius:6px;padding:6px;text-align:center}
.ability-box.prof{border-color:#92400e;background:#1c1917}
.ab-name{font-size:9px;color:#94a3b8;font-weight:600;text-transform:uppercase;letter-spacing:0.5px}
.ab-score{font-size:22px;font-weight:800;color:#e2e8f0;line-height:1.2}
.ab-mod{font-size:13px;font-weight:700;color:#fbbf24}
.ab-save{font-size:8.5px;color:#64748b;margin-top:2px}
.ability-box.prof .ab-save{color:#d97706}

/* ---- Skills ---- */
.skill-cols{display:grid;grid-template-columns:1fr 1fr;gap:0 12px}
.skill-row{display:flex;align-items:center;padding:2px 0;border-bottom:1px solid #1e293b}
.skill-row.prof{color:#fbbf24}
.sk-dot{width:14px;font-size:8px;flex-shrink:0}
.sk-name{flex:1;font-size:10px}
.sk-val{font-weight:700;font-size:10.5px;min-width:24px;text-align:right}

/* ---- Proficiency Tags ---- */
.prof-group{margin-bottom:6px}
.prof-label{display:block;font-size:9px;color:#94a3b8;font-weight:600;margin-bottom:3px}
.tag{display:inline-block;padding:1px 6px;margin:1px 2px;background:#0f172a;border:1px solid #334155;border-radius:3px;font-size:9.5px;color:#cbd5e1}

/* ---- Equipment ---- */
.equip-item{display:flex;justify-content:space-between;align-items:baseline;padding:3px 0;border-bottom:1px solid #1e293b;font-size:10.5px}
.eq-detail{color:#64748b;font-size:9.5px}

/* ---- Spells ---- */
.spell-meta{font-size:10px;color:#a78bfa;margin-bottom:6px;padding:3px 6px;background:#1e1b4b;border-radius:4px;display:inline-block}
.spell-group{margin-top:4px;font-size:10.5px;line-height:1.6}

/* ---- Features ---- */
.feat{margin-bottom:5px;font-size:10px;line-height:1.5}
.feat b{color:#fbbf24}

/* ---- Personality ---- */
.pers-line{margin-bottom:3px;font-size:10.5px;line-height:1.5}
.pers-line b{color:#94a3b8}

/* ---- Backstory ---- */
.backstory{white-space:pre-wrap;font-size:10.5px;line-height:1.6;color:#94a3b8}

/* ---- Print ---- */
@media print{html,body,.page::before,.hdr,.cb,.card,.ability-box,.skill-row,.tag,.equip-item{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}}
</style></head><body>
<div class="page">

<!-- Header -->
<div class="hdr">
  ${avatarSrc ? `<img class="avatar" src="${avatarSrc}" alt="">` : `<div class="avatar-placeholder">⚔</div>`}
  <div class="hdr-info">
    <div class="hdr-name">${esc(charName)}</div>
    <div class="hdr-sub">${raceName}${subrace ? `（${subrace.name}）` : ''} · ${className} ${character.level}级 · ${alignName}${character.gender ? ` · ${character.gender}` : ''}${character.age ? ` · ${character.age}岁` : ''}${deity ? ` · ${deity.name}` : ''}</div>
    ${appParts.length ? `<div class="hdr-appear">${appParts.join(' · ')}</div>` : ''}
  </div>
</div>

<!-- Combat Stats -->
<div class="combat">
  <div class="cb"><div class="cl">AC</div><div class="cv">${acResult.ac}</div></div>
  <div class="cb"><div class="cl">先攻</div><div class="cv">${initiativeStr}</div></div>
  <div class="cb"><div class="cl">速度</div><div class="cv">${speed}尺</div></div>
  <div class="cb"><div class="cl">HP</div><div class="cv red">${hitPoints}</div></div>
  <div class="cb"><div class="cl">生命骰</div><div class="cv">${hitDice}</div></div>
  <div class="cb"><div class="cl">熟练</div><div class="cv">+${proficiencyBonus}</div></div>
</div>

<!-- Row 1: Abilities + Skills -->
<div class="row">
  <div class="card">
    <div class="card-title">属性值</div>
    <div class="ab-grid">${abilityBoxes}</div>
  </div>
  <div class="card">
    <div class="card-title">技能</div>
    <div class="skill-cols">${skillCol1}${skillCol2}</div>
  </div>
</div>

<!-- Row 2: Proficiencies & Equipment -->
<div class="row">
  <div class="card">
    <div class="card-title">熟练项</div>
    ${profTags('护甲', armorProficiencies)}
    ${profTags('武器', weaponProficiencies)}
    ${profTags('工具', toolProficiencies)}
    ${profTags('语言', allLanguages)}
  </div>
  <div class="card">
    <div class="card-title">装备</div>
    ${equipHtml || '<div style="color:#475569">暂无装备</div>'}
  </div>
</div>

<!-- Row 3: Spells (if any) + Features -->
<div class="row">
  ${spellsHtml || `<div class="card"><div class="card-title">特性</div>${featuresHtml || '<div style="color:#475569">无</div>'}</div>`}
  ${spellsHtml ? `<div class="card"><div class="card-title">特性</div>${featuresHtml || '<div style="color:#475569">无</div>'}</div>` : `<div class="card"><div class="card-title">个性 &amp; 背景</div>${persLines}${character.backstory ? `<div style="margin-top:6px;padding-top:6px;border-top:1px solid #334155"><div style="font-size:9px;color:#94a3b8;font-weight:600;margin-bottom:3px">背景故事</div><div class="backstory">${esc(character.backstory)}</div></div>` : ''}</div>`}
</div>

<!-- Row 4: Personality if spells row used both slots -->
${spellsHtml ? `<div class="row"><div class="card"><div class="card-title">个性特征</div>${persLines}</div><div class="card"><div class="card-title">背景故事</div><div class="backstory">${character.backstory ? esc(character.backstory) : '无'}</div></div></div>` : ''}

</div>
<script>window.onload=function(){window.print()}<\/script>
</body></html>`;

    const w = window.open('', '_blank');
    if (w) { w.document.write(html); w.document.close(); }
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-xl font-bold text-amber-400 mb-2">审核并完成</h3>
        <p className="text-gray-400 text-sm">
          请仔细检查你的角色信息，确认无误后即可创建角色
        </p>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Column */}
        <div className="space-y-6">
          {/* Combat Stats */}
          <InfoSection title="战斗数据">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <button
                className="bg-gray-700/50 rounded p-2 text-center hover:ring-1 ring-amber-400"
                onClick={() => {
                  const b = getACBreakdown(character);
                  setBreakdownData({ title: "护甲等级 (AC)", final: b.final, items: b.items, description: "AC代表你有多难被击中。敌人的攻击骰结果≥你的AC才能命中你。穿护甲、持盾牌、敏捷高都能提升AC。无护甲时AC = 10 + 敏捷调整值。" });
                  setBreakdownOpen(true);
                }}
              >
                <div className="text-xs text-gray-400 flex items-center justify-center">
                  护甲等级
                  <HelpTooltip {...COMBAT_HELP_CONTENT.ac} />
                </div>
                <div className="text-2xl font-bold text-amber-400">{acResult.ac}</div>
                {acResult.formula && (
                  <div className="text-xs text-gray-500 mt-1">{acResult.formula}</div>
                )}
              </button>
              <button
                className="bg-gray-700/50 rounded p-2 text-center hover:ring-1 ring-amber-400"
                onClick={() => {
                  const b = getInitiativeBreakdown(character);
                  setBreakdownData({ title: "先攻", final: b.final, items: b.items, unit: "+", description: "先攻决定战斗中的行动顺序。战斗开始时每人掷1d20+先攻加值，结果高的先行动。先攻加值 = 敏捷调整值。" });
                  setBreakdownOpen(true);
                }}
              >
                <div className="text-xs text-gray-400 flex items-center justify-center">
                  先攻
                  <HelpTooltip {...COMBAT_HELP_CONTENT.initiative} />
                </div>
                <div className="text-2xl font-bold text-amber-400">{initiativeStr}</div>
              </button>
              <button
                className="bg-gray-700/50 rounded p-2 text-center hover:ring-1 ring-amber-400"
                onClick={() => {
                  const b = getSpeedBreakdown(character);
                  setBreakdownData({ title: "速度", final: b.final, items: b.items, unit: "ft" });
                  setBreakdownOpen(true);
                }}
              >
                <div className="text-xs text-gray-400 flex items-center justify-center">
                  速度
                  <HelpTooltip {...COMBAT_HELP_CONTENT.speed} />
                </div>
                <div className="text-2xl font-bold text-amber-400">{speed} 尺</div>
              </button>
              <button
                className="bg-gray-700/50 rounded p-2 text-center hover:ring-1 ring-amber-400"
                onClick={() => {
                  const b = getProficiencyBonusBreakdown(level);
                  setBreakdownData({ title: "熟练加值", final: b.final, items: b.items, unit: "+", description: "熟练加值加到你擅长的技能检定、攻击骰和豁免检定上。1级时为+2，之后每4级增加1（5级+3，9级+4…最高20级+6）。" });
                  setBreakdownOpen(true);
                }}
              >
                <div className="text-xs text-gray-400 flex items-center justify-center">
                  熟练加值
                  <HelpTooltip {...COMBAT_HELP_CONTENT.proficiencyBonus} />
                </div>
                <div className="text-2xl font-bold text-amber-400">+{proficiencyBonus}</div>
              </button>
              <button
                className="bg-gray-700/50 rounded p-2 text-center hover:ring-1 ring-amber-400"
                onClick={() => {
                  const b = getHPBreakdown(character, { includeFlatSubraceHP: true, includeSubraceLevelBonuses: true });
                  setBreakdownData({ title: "生命值 (HP)", final: b.final, items: b.items });
                  setBreakdownOpen(true);
                }}
              >
                <div className="text-xs text-gray-400 flex items-center justify-center">
                  生命值
                  <HelpTooltip {...COMBAT_HELP_CONTENT.hp} />
                </div>
                <div className="text-2xl font-bold text-red-400">{hitPoints}</div>
              </button>
              <button
                className="bg-gray-700/50 rounded p-2 text-center hover:ring-1 ring-amber-400"
                onClick={() => {
                  const b = getHitDiceBreakdown(character);
                  setBreakdownData({ title: "生命骰", final: b.final, items: b.items, unit: "dice", diceSize: (b as any).diceSize, description: "生命骰用于短休息时恢复生命值。短休时你可以掷生命骰（加体质调整值）来回血。骰面由职业决定（如战士d10、法师d6），骰子数量等于你的等级。长休后恢复一半已用的生命骰。" });
                  setBreakdownOpen(true);
                }}
              >
                <div className="text-xs text-gray-400 flex items-center justify-center">
                  生命骰
                  <HelpTooltip {...COMBAT_HELP_CONTENT.hitDice} />
                </div>
                <div className="text-2xl font-bold text-red-400">{hitDice}</div>
              </button>
            </div>

            {/* Spellcasting Stats (for spellcasting classes) */}
            {spellcastingData && (
              <div className="mt-4 pt-4 border-t border-gray-700">
                <div className="text-xs text-gray-400 mb-3 font-medium flex items-center gap-1">
                  施法数据
                  <HelpTooltip {...COMBAT_HELP_CONTENT.spellcasting} />
                </div>
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div className="bg-purple-900/30 border border-purple-700/50 rounded p-2 text-center">
                    <div className="text-xs text-purple-300">施法关键属性</div>
                    <div className="text-lg font-bold text-purple-400">{spellcastingData.abilityName}</div>
                    <div className="text-xs text-gray-500">
                      {spellcastingData.abilityMod >= 0 ? `+${spellcastingData.abilityMod}` : spellcastingData.abilityMod}
                    </div>
                  </div>
                  <button
                    className="bg-purple-900/30 border border-purple-700/50 rounded p-2 text-center hover:ring-1 ring-amber-400"
                    onClick={() => {
                      const b = getSpellSaveDCBreakdown(character);
                      setBreakdownData({ title: "法术豁免DC", final: b.final, items: b.items });
                      setBreakdownOpen(true);
                    }}
                  >
                    <div className="text-xs text-purple-300">法术豁免DC</div>
                    <div className="text-lg font-bold text-purple-400">{spellcastingData.spellSaveDC}</div>
                    <div className="text-xs text-gray-500">
                      8 + 熟练 + {spellcastingData.abilityName}
                    </div>
                  </button>
                  <button
                    className="bg-purple-900/30 border border-purple-700/50 rounded p-2 text-center hover:ring-1 ring-amber-400"
                    onClick={() => {
                      const b = getSpellAttackBonusBreakdown(character);
                      setBreakdownData({ title: "法术攻击加值", final: b.final, items: b.items, unit: "+" });
                      setBreakdownOpen(true);
                    }}
                  >
                    <div className="text-xs text-purple-300">法术攻击加值</div>
                    <div className="text-lg font-bold text-purple-400">{spellcastingData.spellAttackStr}</div>
                    <div className="text-xs text-gray-500">
                      熟练 + {spellcastingData.abilityName}
                    </div>
                  </button>
                </div>

                {/* Spell Slots */}
                <div className="mt-4 pt-4 border-t border-gray-700">
                  <div className="text-xs text-gray-400 mb-3 font-medium flex items-center gap-1">
                    {spellcastingData.type === 'pact' ? '契约魔法法术位' : '法术位'}
                    <HelpTooltip {...COMBAT_HELP_CONTENT.spellSlots} />
                  </div>

                  {spellcastingData.type === 'pact' ? (
                    // Warlock Pact Magic
                    <div className="bg-purple-900/20 border border-purple-700/30 rounded p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm text-purple-300">
                          {(spellcastingData.spellSlots as any).level}环法术位
                        </span>
                        <span className="text-lg font-bold text-purple-400">
                          {(spellcastingData.spellSlots as any).slots}个
                        </span>
                      </div>
                      <div className="text-xs text-gray-500">
                        💡 邪术师使用契约魔法，所有法术位环级相同，短休后恢复
                      </div>
                    </div>
                  ) : (
                    // Standard Spellcasting
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      {(spellcastingData.spellSlots as number[]).map((slots, index) => {
                        if (slots === 0) return null;
                        const slotLevel = index + 1;
                        return (
                          <div
                            key={slotLevel}
                            className="bg-purple-900/20 border border-purple-700/30 rounded p-2 text-center"
                          >
                            <div className="text-purple-300">{slotLevel}环</div>
                            <div className="text-lg font-bold text-purple-400">{slots}</div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {spellcastingData.type === 'half' && (
                    <div className="mt-2 text-xs text-gray-500">
                      💡 半施法者（圣武士/游侠）在2级获得施法能力，法术位较少
                    </div>
                  )}
                </div>
              </div>
            )}
          </InfoSection>

          {/* Ability Scores */}
          <InfoSection title="属性值" onEdit={() => setCurrentStep(4)}>
            <div className="grid grid-cols-3 gap-3">
              {Object.entries(finalAbilityScores).map(([abilityId, score]: [string, number]) => {
                const modifier = finalAbilityModifiers[abilityId];
                const modifierStr = modifier >= 0 ? `+${modifier}` : `${modifier}`;
                const baseScore = character.abilityScores[abilityId];
                const hasBonus = score !== baseScore;
                return (
                  <button
                    key={abilityId}
                    className="bg-gray-700/50 rounded p-2 text-center hover:ring-1 ring-amber-400"
                    onClick={() => {
                      const b = getAbilityScoreBreakdown(character, abilityId as any);
                      const abbr = abilityId.slice(0,3).toUpperCase();
                      setBreakdownData({ title: `${getAbilityName(abilityId)} (${abbr})`, final: b.final, items: b.items });
                      setBreakdownOpen(true);
                    }}
                  >
                    <div className="text-xs text-gray-400">{getAbilityName(abilityId)}</div>
                    <div className="text-lg font-bold text-gray-200">
                      {score}
                      {hasBonus && <span className="text-xs text-green-400 ml-1">(+{score - baseScore})</span>}
                    </div>
                    <div className="text-xs text-amber-400">{modifierStr}</div>
                  </button>
                );
              })}
            </div>
          </InfoSection>

          {/* Saving Throws */}
          <InfoSection
            title={
              <div className="flex items-center gap-1">
                豁免检定
                <HelpTooltip {...COMBAT_HELP_CONTENT.savingThrows} />
              </div>
            }
          >
            <div className="grid grid-cols-2 gap-2 text-sm">
              {Object.keys(finalAbilityScores).map(abilityId => {
                const modifier = finalAbilityModifiers[abilityId];
                const isProficient = savingThrows.includes(abilityId);
                const totalBonus = modifier + (isProficient ? proficiencyBonus : 0);
                const bonusStr = totalBonus >= 0 ? `+${totalBonus}` : `${totalBonus}`;
                return (
                  <button
                    key={abilityId}
                    className={`flex items-center justify-between px-3 py-2 rounded hover:ring-1 ring-amber-400 ${isProficient ? 'bg-amber-900/30 border border-amber-700/50' : 'bg-gray-700/30'}`}
                    onClick={() => {
                      const items: { label: string; value: number }[] = [
                        { label: `${getAbilityName(abilityId)}调整值`, value: modifier },
                      ];
                      if (isProficient) {
                        items.push({ label: "熟练加值（职业豁免）", value: proficiencyBonus });
                      }
                      setBreakdownData({ title: `${getAbilityName(abilityId)}豁免检定`, final: totalBonus, items, unit: "+" });
                      setBreakdownOpen(true);
                    }}
                  >
                    <span className={isProficient ? 'text-amber-400 font-medium' : 'text-gray-400'}>
                      {getAbilityName(abilityId)}
                    </span>
                    <span className={isProficient ? 'text-amber-400 font-bold' : 'text-gray-400'}>
                      {bonusStr}
                    </span>
                  </button>
                );
              })}
            </div>
          </InfoSection>

          {/* Special Saving Throws & Resistances */}
          {(racialProficiencies.darkvision > 0 ||
            racialProficiencies.savingThrowAdvantages.length > 0 ||
            racialProficiencies.damageResistances.length > 0 ||
            subclassProficiencies.damageResistances.length > 0 ||
            subclassProficiencies.damageImmunities.length > 0 ||
            subclassProficiencies.conditionImmunities.length > 0) && (
            <InfoSection
              title={
                <div className="flex items-center gap-1">
                  特殊能力与抗性
                  <HelpTooltip {...COMBAT_HELP_CONTENT.resistances} />
                </div>
              }
            >
              <div className="space-y-2 text-sm">
                {racialProficiencies.darkvision > 0 && (
                  <div className="px-3 py-2 bg-indigo-900/30 border border-indigo-700/50 rounded">
                    <div className="text-indigo-300 font-medium">黑暗视觉</div>
                    <div className="text-gray-400 text-xs mt-1">
                      {racialProficiencies.darkvision}尺范围内的黑暗视为微光，微光视为明亮
                    </div>
                  </div>
                )}
                {racialProficiencies.savingThrowAdvantages.length > 0 && (
                  <div className="px-3 py-2 bg-green-900/30 border border-green-700/50 rounded">
                    <div className="text-green-300 font-medium">豁免优势（种族）</div>
                    <div className="text-gray-400 text-xs mt-1">
                      {racialProficiencies.savingThrowAdvantages.map((type: string) => {
                        const typeNames: Record<string, string> = {
                          poison: "毒素",
                          charm: "魅惑",
                          fear: "恐惧",
                          sleep: "睡眠"
                        };
                        return typeNames[type] || type;
                      }).join('、')} 豁免检定具有优势
                    </div>
                  </div>
                )}
                {(racialProficiencies.damageResistances.length > 0 || subclassProficiencies.damageResistances.length > 0) && (
                  <div className="px-3 py-2 bg-blue-900/30 border border-blue-700/50 rounded">
                    <div className="text-blue-300 font-medium">伤害抗性</div>
                    <div className="text-gray-400 text-xs mt-1">
                      {[...racialProficiencies.damageResistances, ...subclassProficiencies.damageResistances].map((type: string) => {
                        const typeNames: Record<string, string> = {
                          poison: "毒素",
                          fire: "火焰",
                          cold: "寒冷",
                          lightning: "闪电",
                          acid: "强酸",
                          thunder: "雷鸣",
                          necrotic: "死灵",
                          radiant: "光耀",
                          psychic: "心灵"
                        };
                        return typeNames[type] || type;
                      }).join('、')} 伤害抗性
                    </div>
                  </div>
                )}
                {subclassProficiencies.damageImmunities.length > 0 && (
                  <div className="px-3 py-2 bg-purple-900/30 border border-purple-700/50 rounded">
                    <div className="text-purple-300 font-medium">伤害免疫</div>
                    <div className="text-gray-400 text-xs mt-1">
                      {subclassProficiencies.damageImmunities.map((type: string) => {
                        const typeNames: Record<string, string> = {
                          poison: "毒素",
                          fire: "火焰",
                          cold: "寒冷",
                          lightning: "闪电",
                          acid: "强酸",
                          thunder: "雷鸣",
                          necrotic: "死灵",
                          radiant: "光耀",
                          psychic: "心灵"
                        };
                        return typeNames[type] || type;
                      }).join('、')} 伤害免疫
                    </div>
                  </div>
                )}
                {subclassProficiencies.conditionImmunities.length > 0 && (
                  <div className="px-3 py-2 bg-amber-900/30 border border-amber-700/50 rounded">
                    <div className="text-amber-300 font-medium">状态免疫</div>
                    <div className="text-gray-400 text-xs mt-1">
                      {subclassProficiencies.conditionImmunities.map((type: string) => {
                        const typeNames: Record<string, string> = {
                          charmed: "魅惑",
                          frightened: "恐慌",
                          poisoned: "中毒",
                          paralyzed: "麻痹",
                          stunned: "震慑",
                          petrified: "石化"
                        };
                        return typeNames[type] || type;
                      }).join('、')} 状态免疫
                    </div>
                  </div>
                )}
              </div>
            </InfoSection>
          )}

          {/* Skills - Show all 18 skills with proficiency indicators */}
          <InfoSection title="技能" onEdit={() => setCurrentStep(2)}>
            <div className="grid grid-cols-2 gap-2 text-sm">
              {skillsData.skills.map((skill: any) => {
                const isProficient = skillProficiencies.includes(skill.id);
                const abilityMod = finalAbilityModifiers[skill.ability] || 0;
                const totalBonus = abilityMod + (isProficient ? proficiencyBonus : 0);
                const bonusStr = totalBonus >= 0 ? `+${totalBonus}` : `${totalBonus}`;

                return (
                  <button
                    key={skill.id}
                    className={`flex items-center justify-between px-3 py-2 rounded hover:ring-1 ring-amber-400 ${
                      isProficient
                        ? 'bg-amber-900/30 border border-amber-700/50'
                        : 'bg-gray-800/30 border border-gray-700/30'
                    }`}
                    onClick={() => {
                      const b = getSkillBreakdown(character, skill.id);
                      setBreakdownData({ title: `技能：${skill.name}`, final: b.final, items: b.items, unit: '+' });
                      setBreakdownOpen(true);
                    }}
                  >
                    <span className={`font-medium ${isProficient ? 'text-amber-400' : 'text-gray-400'}`}>
                      {isProficient && '✓ '}{skill.name}
                    </span>
                    <span className={`font-bold ${isProficient ? 'text-amber-400' : 'text-gray-500'}`}>
                      {bonusStr}
                    </span>
                  </button>
                );
              })}
            </div>
          </InfoSection>

          {/* Proficiencies */}
          <InfoSection
            title={
              <div className="flex items-center gap-1">
                熟练项
                <HelpTooltip {...COMBAT_HELP_CONTENT.proficiencies} />
              </div>
            }
          >
            <div className="space-y-3 text-sm">
              {armorProficiencies.length > 0 && (
                <div>
                  <span className="text-gray-400 font-medium">护甲：</span>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {armorProficiencies.map((prof: string, idx: number) => (
                      <span key={idx} className="px-2 py-1 bg-gray-700 rounded text-gray-300 text-xs">
                        {prof}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {weaponProficiencies.length > 0 && (
                <div>
                  <span className="text-gray-400 font-medium">武器：</span>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {weaponProficiencies.map((prof: string, idx: number) => (
                      <span key={idx} className="px-2 py-1 bg-gray-700 rounded text-gray-300 text-xs">
                        {prof}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {toolProficiencies.length > 0 && (
                <div>
                  <span className="text-gray-400 font-medium">工具：</span>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {toolProficiencies.map((prof: string, idx: number) => (
                      <span key={idx} className="px-2 py-1 bg-gray-700 rounded text-gray-300 text-xs">
                        {prof}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {allLanguages.length > 0 && (
                <div>
                  <span className="text-gray-400 font-medium">语言：</span>
                  <div className="flex flex-wrap gap-2 mt-1">
                    {allLanguages.map((lang: string, idx: number) => (
                      <span key={idx} className="px-2 py-1 bg-gray-700 rounded text-gray-300 text-xs">
                        {getProficiencyName(lang)}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </InfoSection>
        </div>

        {/* Right Column */}
        <div className="space-y-6">
          {/* Avatar */}
          <InfoSection title="角色头像">
            <div className="flex flex-col items-center gap-3">
              <button
                className="w-32 h-32 rounded-lg border-2 border-dashed border-gray-600 hover:border-amber-400 transition-colors flex items-center justify-center overflow-hidden bg-gray-700/30"
                onClick={() => setAvatarModalOpen(true)}
                title="点击设置头像"
              >
                {character.avatar ? (
                  <img src={character.avatar} alt={character.name} className="w-full h-full object-cover rounded-lg" />
                ) : (
                  <div className="text-center text-gray-500">
                    <svg className="w-10 h-10 mx-auto mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                    <span className="text-xs">点击设置</span>
                  </div>
                )}
              </button>
              <span className="text-xs text-gray-500">可选，支持上传、AI生成或从头像库选择</span>
            </div>
          </InfoSection>

          {/* Basic Information */}
          <InfoSection title="基本信息" onEdit={() => setCurrentStep(5)}>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-gray-400">姓名：</span>
                <span className="text-gray-200">{character.name || "未设置"}</span>
              </div>
              <div>
                <span className="text-gray-400">性别：</span>
                <span className="text-gray-200">{character.gender || "未设置"}</span>
              </div>
              <div>
                <span className="text-gray-400">年龄：</span>
                <span className="text-gray-200">{character.age || "0"} 岁</span>
              </div>
              <div>
                <span className="text-gray-400">阵营：</span>
                <span className="text-gray-200">{alignment?.name || "未设置"}</span>
              </div>
              {deity && (
                <div>
                  <span className="text-gray-400">信仰：</span>
                  <span className="text-gray-200">
                    {deity.name} ({deity.nameEn})
                  </span>
                </div>
              )}
              <div>
                <span className="text-gray-400">身高：</span>
                <span className="text-gray-200">{character.appearance?.height || "未设置"}</span>
              </div>
              <div>
                <span className="text-gray-400">体重：</span>
                <span className="text-gray-200">{character.appearance?.weight || "未设置"}</span>
              </div>
            </div>
          </InfoSection>

          {/* Race and Class */}
          <InfoSection title="种族与职业" onEdit={() => setCurrentStep(1)}>
            <div className="space-y-2 text-sm">
              <div>
                <span className="text-gray-400">种族：</span>
                <span className="text-gray-200">
                  {race?.name || "未选择"}
                  {subrace && ` (${subrace.name})`}
                </span>
              </div>
              <div>
                <span className="text-gray-400">职业：</span>
                <span className="text-gray-200">{characterClass?.name || "未选择"}</span>
              </div>
              <div>
                <span className="text-gray-400">等级：</span>
                <span className="text-gray-200">{character.level}</span>
              </div>
            </div>
          </InfoSection>

          {/* Racial Traits */}
          {racialTraits.length > 0 && (
            <InfoSection title="种族特性" onEdit={() => setCurrentStep(1)}>
              <div className="space-y-2">
                {racialTraits.map((trait: any, idx: number) => (
                  <div key={idx} className="bg-gray-700/30 rounded p-2">
                    <div className="font-medium text-amber-400 text-sm">{trait.name}</div>
                    <div className="text-xs text-gray-400 mt-1">{trait.description}</div>
                  </div>
                ))}
              </div>
            </InfoSection>
          )}

          {/* Class Features */}
          {classFeatures.length > 0 && (
            <InfoSection title="职业特性" onEdit={() => setCurrentStep(2)}>
              <div className="space-y-2">
                {classFeatures.map((feature: any, idx: number) => (
                  <div key={idx} className="bg-gray-700/30 rounded p-2">
                    <div className="font-medium text-amber-400 text-sm">{feature.name}</div>
                    <div className="text-xs text-gray-400 mt-1">{feature.description}</div>
                  </div>
                ))}
              </div>
            </InfoSection>
          )}

          {/* Special Class Mechanics (Bard Inspiration / Monk Ki) */}
          {(() => {
            const classId = character.classId;
            const level = character.level || 1;
            const chaMod = finalAbilityModifiers.charisma || 0;

            // Bard: Bardic Inspiration
            const bardicInspiration = characterClass?.features?.find((f: any) =>
              f.nameEn === "Bardic Inspiration" && f.level === 1
            );

            // Monk: Ki
            const kiFeature = characterClass?.features?.find((f: any) =>
              f.nameEn === "Ki" && f.level === 2
            );

            const showSpecialMechanics = (classId === "bard" && bardicInspiration) ||
                                         (classId === "monk" && level >= 2 && kiFeature);

            if (!showSpecialMechanics) return null;

            return (
              <InfoSection title="职业特殊机制" onEdit={() => setCurrentStep(2)}>
                <div className="space-y-3">
                  {/* Bard: Bardic Inspiration */}
                  {classId === "bard" && bardicInspiration && (
                    <div className="bg-purple-900/30 border border-purple-700/50 rounded p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="font-medium text-purple-300 text-sm">
                          {bardicInspiration.name} ({bardicInspiration.nameEn})
                        </div>
                      </div>
                      <div className="text-xs text-gray-400 mb-3">
                        {bardicInspiration.description}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="bg-gray-700/50 rounded p-2 text-center">
                          <div className="text-xs text-gray-400">激励骰</div>
                          <div className="text-lg font-bold text-purple-400">
                            {(bardicInspiration as any).die?.[String(level)] ||
                             (bardicInspiration as any).die?.["1"] || "d6"}
                          </div>
                        </div>
                        <div className="bg-gray-700/50 rounded p-2 text-center">
                          <div className="text-xs text-gray-400">使用次数</div>
                          <div className="text-lg font-bold text-purple-400">
                            {Math.max(1, chaMod)}
                          </div>
                          <div className="text-xs text-gray-500">
                            ({(bardicInspiration as any).uses})
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Monk: Ki Points */}
                  {classId === "monk" && level >= 2 && kiFeature && (
                    <div className="bg-cyan-900/30 border border-cyan-700/50 rounded p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="font-medium text-cyan-300 text-sm">
                          {kiFeature.name} ({kiFeature.nameEn})
                        </div>
                      </div>
                      <div className="text-xs text-gray-400 mb-3">
                        {kiFeature.description}
                      </div>
                      <div className="bg-gray-700/50 rounded p-2 text-center mb-3">
                        <div className="text-xs text-gray-400">气点数量</div>
                        <div className="text-2xl font-bold text-cyan-400">{level}</div>
                        <div className="text-xs text-gray-500">({(kiFeature as any).points})</div>
                      </div>
                      {(kiFeature as any).abilities && (kiFeature as any).abilities.length > 0 && (
                        <div className="space-y-2">
                          <div className="text-xs text-gray-400 font-medium">气点能力：</div>
                          {(kiFeature as any).abilities.map((ability: any, idx: number) => (
                            <div key={idx} className="bg-gray-700/50 rounded p-2">
                              <div className="flex items-center justify-between">
                                <span className="text-cyan-300 font-medium text-xs">
                                  {ability.name} ({ability.nameEn})
                                </span>
                                <span className="text-cyan-400 text-xs font-bold">
                                  {ability.cost} 气点
                                </span>
                              </div>
                              <div className="text-xs text-gray-400 mt-1">
                                {ability.description}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </InfoSection>
            );
          })()}

          {/* Subclass Features */}
          {subclass && (
            <InfoSection title={`子职业特性 - ${subclass.name}`} onEdit={() => setCurrentStep(3)}>
              <div className="space-y-2">
                {subclass.description && (
                  <div className="bg-gray-700/30 rounded p-2 mb-2">
                    <div className="text-xs text-gray-400">{subclass.description}</div>
                  </div>
                )}
                {subclassFeatures.map((feature: any, idx: number) => (
                  <div key={idx} className="bg-gray-700/30 rounded p-2">
                    <div className="font-medium text-amber-400 text-sm">{feature.name}</div>
                    <div className="text-xs text-gray-400 mt-1">{feature.description}</div>
                  </div>
                ))}
              </div>
            </InfoSection>
          )}

          {/* Spells */}
          {(selectedCantrips.length > 0 || selectedSpells.length > 0 || preparedSpells.length > 0 || domainSpells.length > 0 || expandedSpells.length > 0) && (
            <InfoSection title="法术" onEdit={() => setCurrentStep(3)}>
              <div className="space-y-3 text-sm">
                {selectedCantrips.length > 0 && (
                  <div>
                    <span className="text-gray-400 font-medium">戏法：</span>
                    <div className="space-y-2 mt-1">
                      {selectedCantrips.map((spellId: string, idx: number) => {
                        const spell = spellsData.spells.find((s: any) => s.id === spellId);
                        if (!spell) return null;
                        return <SpellCard key={idx} spell={normalizeSpellData(spell)} variant="compact" />;
                      })}
                    </div>
                  </div>
                )}
                {domainSpells.length > 0 && (
                  <div>
                    <span className="text-gray-400 font-medium">领域法术（自动准备）：</span>
                    <div className="space-y-2 mt-1">
                      {domainSpells.map((spellId: string, idx: number) => {
                        const spell = spellsData.spells.find((s: any) => s.id === spellId);
                        if (!spell) return null;
                        return <SpellCard key={idx} spell={normalizeSpellData(spell)} variant="compact" />;
                      })}
                    </div>
                  </div>
                )}
                {expandedSpells.length > 0 && (
                  <div>
                    <span className="text-gray-400 font-medium">扩展法术列表（可选择）：</span>
                    <div className="space-y-2 mt-1">
                      {expandedSpells.map((spellId: string, idx: number) => {
                        const spell = spellsData.spells.find((s: any) => s.id === spellId);
                        if (!spell) return null;
                        return <SpellCard key={idx} spell={normalizeSpellData(spell)} variant="compact" />;
                      })}
                    </div>
                  </div>
                )}
                {selectedSpells.length > 0 && (
                  <div>
                    <span className="text-gray-400 font-medium">已知法术：</span>
                    <div className="space-y-2 mt-1">
                      {selectedSpells.map((spellId: string, idx: number) => {
                        const spell = spellsData.spells.find((s: any) => s.id === spellId);
                        if (!spell) return null;
                        return <SpellCard key={idx} spell={normalizeSpellData(spell)} variant="compact" />;
                      })}
                    </div>
                  </div>
                )}
                {preparedSpells.length > 0 && (
                  <div>
                    <span className="text-gray-400 font-medium">已准备法术：</span>
                    <div className="space-y-2 mt-1">
                      {preparedSpells.map((spellId: string, idx: number) => {
                        const spell = spellsData.spells.find((s: any) => s.id === spellId);
                        if (!spell) return null;
                        return <SpellCard key={idx} spell={normalizeSpellData(spell)} variant="compact" />;
                      })}
                    </div>
                  </div>
                )}
              </div>
            </InfoSection>
          )}

          {/* Personality */}
          {character.personality && (
            <InfoSection title="个性特征" onEdit={() => setCurrentStep(5)}>
              <div className="space-y-2 text-sm">
                {character.personality.traits && character.personality.traits.length > 0 && (
                  <div>
                    <span className="text-gray-400">性格特质：</span>
                    <ul className="list-disc list-inside text-gray-200 mt-1">
                      {character.personality.traits.map((trait: string, index: number) => (
                        <li key={index}>{trait}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {character.personality.ideals && (
                  <div>
                    <span className="text-gray-400">理想：</span>
                    <span className="text-gray-200">{character.personality.ideals}</span>
                  </div>
                )}
                {character.personality.bonds && (
                  <div>
                    <span className="text-gray-400">羁绊：</span>
                    <span className="text-gray-200">{character.personality.bonds}</span>
                  </div>
                )}
                {character.personality.flaws && (
                  <div>
                    <span className="text-gray-400">缺陷：</span>
                    <span className="text-gray-200">{character.personality.flaws}</span>
                  </div>
                )}
              </div>
            </InfoSection>
          )}

          {/* Backstory */}
          {character.backstory && (
            <InfoSection title="背景故事" onEdit={() => setCurrentStep(5)}>
              <div className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">
                {character.backstory}
              </div>
            </InfoSection>
          )}

          {/* Equipment */}
          {character.equipment && character.equipment.length > 0 && (
            <InfoSection title="装备" onEdit={() => setCurrentStep(6)}>
              <div className="space-y-2">
                {character.equipment.map((item: any, index: number) => {
                  // Property translation map
                  const propertyMap: Record<string, string> = {
                    light: "轻型",
                    finesse: "灵巧",
                    thrown: "投掷",
                    versatile: "双用",
                    "two-handed": "双手",
                    ammunition: "弹药",
                    loading: "填弹",
                    heavy: "重型",
                    reach: "触及",
                    special: "特殊",
                  };

                  // Translate properties
                  const translatedProperties = item.properties
                    ? Array.isArray(item.properties)
                      ? item.properties.map((p: string) => propertyMap[p] || p).join("、")
                      : item.properties
                    : null;

                  return (
                    <div
                      key={index}

                      className="px-3 py-2 bg-gray-700/50 rounded text-sm"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-gray-300 font-medium">{item.name}</span>
                        {item.quantity > 1 && (
                          <span className="text-amber-400 text-xs">×{item.quantity}</span>
                        )}
                      </div>
                      {/* Equipment properties */}
                      {(item.ac || item.damage || translatedProperties) && (
                        <div className="text-xs text-gray-400 mt-1 space-y-0.5">
                          {item.ac && <div>护甲等级: {item.ac}</div>}
                          {item.damage && <div>伤害: {item.damage}</div>}
                          {translatedProperties && <div>属性: {translatedProperties}</div>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </InfoSection>
          )}
        </div>
      </div>

      {/* Warnings */}
      {(!character.name || !character.age || !character.gender || !character.alignment || !character.equipment || character.equipment.length === 0) && (
        <div className="bg-yellow-900/20 border border-yellow-700/50 rounded-lg p-4">
          <h4 className="font-semibold text-yellow-400 mb-2">⚠️ 未完成的信息</h4>
          <ul className="text-sm text-gray-400 space-y-1">
            {!character.name && <li>• 尚未填写角色姓名</li>}
            {!character.age && <li>• 尚未填写年龄</li>}
            {!character.gender && <li>• 尚未选择性别</li>}
            {!character.alignment && <li>• 尚未选择阵营</li>}
            {(!character.equipment || character.equipment.length === 0) && <li>• 尚未选择装备</li>}
          </ul>
        </div>
      )}

      {/* Final Note */}
      <div className="bg-green-900/20 border border-green-700/50 rounded-lg p-4">
        <h4 className="font-semibold text-green-400 mb-2">✓ 准备就绪</h4>
        <p className="text-sm text-gray-400 mb-3">
          确认信息无误后，点击下方的"创建角色"按钮即可完成角色创建。创建后你可以在角色列表中查看和管理你的角色。
        </p>
        <div className="flex gap-3">
          <button
            onClick={downloadMarkdown}
            className="flex-1 px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            导出 Markdown
          </button>
          <button
            onClick={downloadPDF}
            className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
            导出 PDF
          </button>
        </div>
      </div>
      <StatBreakdownDialog open={breakdownOpen} onOpenChange={setBreakdownOpen} data={breakdownData} />

      <AvatarModal
        open={avatarModalOpen}
        onOpenChange={setAvatarModalOpen}
        character={{ name: character.name, avatar: character.avatar }}
        userId={userId}
        genLoading={avatarGenLoading}
        handleGenerateAvatar={handleWizardGenerateAvatar}
        handleUploadAvatar={handleWizardUploadAvatar}
        onAvatarSelected={handleAvatarSelected}
      />

    </div>
  );
}


