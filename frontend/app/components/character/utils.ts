// Utility functions for Character Creation Wizard

// Utility function to get ability name in Chinese
export const getAbilityName = (abilityId: string): string => {
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

// Utility function to get language name in Chinese (unified mapping)
export const getLanguageName = (languageId: string): string => {
  return tProficiency(languageId);
};

// Utility function to check if a class has level 1 subclass
export const hasLevel1Subclass = (classId: string): boolean => {
  // Cleric, Sorcerer, Warlock choose subclass at level 1
  return ["cleric", "sorcerer", "warlock"].includes(classId);
};

// Utility function to check if a class is a spellcaster
export const isSpellcaster = (classId: string): boolean => {
  return ["bard", "cleric", "druid", "sorcerer", "warlock", "wizard", "paladin", "ranger"].includes(classId);
};

// Utility function to check if a class uses prepared spells
export const usesPreparedSpells = (classId: string): boolean => {
  return ["cleric", "druid", "paladin", "wizard"].includes(classId);
};

// Utility function to get fighting styles
export const getFightingStyles = () => {
  return [
    { id: "archery", name: "箭术", nameEn: "Archery", description: "使用远程武器攻击时，攻击检定+2加值" },
    { id: "defense", name: "防御", nameEn: "Defense", description: "穿着护甲时，AC+1加值" },
    { id: "dueling", name: "决斗", nameEn: "Dueling", description: "单手持一把近战武器且另一只手未持武器时，伤害检定+2加值" },
    { id: "great_weapon_fighting", name: "巨武器战斗", nameEn: "Great Weapon Fighting", description: "使用双手近战武器时，伤害骰为1或2可重骰" },
    { id: "protection", name: "保护", nameEn: "Protection", description: "持盾时，可用反应令5尺内盟友对抗攻击时具有劣势" },
    { id: "two_weapon_fighting", name: "双武器战斗", nameEn: "Two-Weapon Fighting", description: "双武器战斗时，副手攻击伤害可加属性调整值" },
  ];
};

// Utility function to get ranger favored enemies
export const getFavoredEnemies = () => {
  return [
    { id: "aberrations", name: "异怪", nameEn: "Aberrations" },
    { id: "beasts", name: "野兽", nameEn: "Beasts" },
    { id: "celestials", name: "天界生物", nameEn: "Celestials" },
    { id: "constructs", name: "构装生物", nameEn: "Constructs" },
    { id: "dragons", name: "龙", nameEn: "Dragons" },
    { id: "elementals", name: "元素生物", nameEn: "Elementals" },
    { id: "fey", name: "精类生物", nameEn: "Fey" },
    { id: "fiends", name: "邪魔", nameEn: "Fiends" },
    { id: "giants", name: "巨人", nameEn: "Giants" },
    { id: "monstrosities", name: "怪兽", nameEn: "Monstrosities" },
    { id: "oozes", name: "泥怪", nameEn: "Oozes" },
    { id: "plants", name: "植物", nameEn: "Plants" },
    { id: "undead", name: "不死生物", nameEn: "Undead" },
    { id: "humanoids", name: "类人生物（选择两个种族）", nameEn: "Humanoids (choose two races)" },
  ];
};

// Utility function to get ranger favored terrains
export const getFavoredTerrains = () => {
  return [
    { id: "arctic", name: "极地", nameEn: "Arctic" },
    { id: "coast", name: "海岸", nameEn: "Coast" },
    { id: "desert", name: "沙漠", nameEn: "Desert" },
    { id: "forest", name: "森林", nameEn: "Forest" },
    { id: "grassland", name: "草原", nameEn: "Grassland" },
    { id: "mountain", name: "山地", nameEn: "Mountain" },
    { id: "swamp", name: "沼泽", nameEn: "Swamp" },
    { id: "underground", name: "地下世界", nameEn: "Underground" },
  ];
};

// Utility function to get humanoid races for ranger favored enemy
export const getHumanoidRaces = () => {
  return [
    { id: "humans", name: "人类", nameEn: "Humans" },
    { id: "elves", name: "精灵", nameEn: "Elves" },
    { id: "dwarves", name: "矮人", nameEn: "Dwarves" },
    { id: "halflings", name: "半身人", nameEn: "Halflings" },
    { id: "gnomes", name: "侏儒", nameEn: "Gnomes" },
    { id: "half_elves", name: "半精灵", nameEn: "Half-Elves" },
    { id: "half_orcs", name: "半兽人", nameEn: "Half-Orcs" },
    { id: "tieflings", name: "提夫林", nameEn: "Tieflings" },
    { id: "dragonborn", name: "龙裔", nameEn: "Dragonborn" },
    { id: "orcs", name: "兽人", nameEn: "Orcs" },
    { id: "goblins", name: "地精", nameEn: "Goblins" },
    { id: "hobgoblins", name: "大地精", nameEn: "Hobgoblins" },
    { id: "kobolds", name: "狗头人", nameEn: "Kobolds" },
    { id: "lizardfolk", name: "蜥蜴人", nameEn: "Lizardfolk" },
    { id: "drow", name: "卓尔精灵", nameEn: "Drow" },
    { id: "duergar", name: "灰矮人", nameEn: "Duergar" },
    { id: "sahuagin", name: "沙华鱼人", nameEn: "Sahuagin" },
    { id: "troglodytes", name: "穴居人", nameEn: "Troglodytes" },
    { id: "bugbears", name: "熊地精", nameEn: "Bugbears" },
  ];
};

// All skills list
export const ALL_SKILLS = [
  "acrobatics", "animal_handling", "arcana", "athletics", "deception",
  "history", "insight", "intimidation", "investigation", "medicine",
  "nature", "perception", "performance", "persuasion", "religion",
  "sleight_of_hand", "stealth", "survival"
];

// Skill name translation
export const getSkillName = (skillId: string): string => {
  const skillMap: Record<string, string> = {
    acrobatics: "杂技",
    animal_handling: "驯兽",
    arcana: "奥秘",
    athletics: "运动",
    deception: "欺瞒",
    history: "历史",
    insight: "洞悉",
    intimidation: "威吓",
    investigation: "调查",
    medicine: "医药",
    nature: "自然",
    perception: "察觉",
    performance: "表演",
    persuasion: "游说",
    religion: "宗教",
    sleight_of_hand: "巧手",
    stealth: "隐匿",
    survival: "生存",
  };
  return skillMap[skillId] || skillId;
};

// Armor proficiency translation (now uses unified dictionary)
import { tProficiency } from "~/utils/i18n";

export const getArmorName = (armorId: string): string => {
  return tProficiency(armorId);
};

// Weapon proficiency translation (now uses unified dictionary)
export const getWeaponName = (weaponId: string): string => {
  return tProficiency(weaponId);
};

// Alignment options
export const ALIGNMENTS = [
  { id: "lawful_good", name: "守序善良", nameEn: "Lawful Good" },
  { id: "neutral_good", name: "中立善良", nameEn: "Neutral Good" },
  { id: "chaotic_good", name: "混乱善良", nameEn: "Chaotic Good" },
  { id: "lawful_neutral", name: "守序中立", nameEn: "Lawful Neutral" },
  { id: "true_neutral", name: "绝对中立", nameEn: "True Neutral" },
  { id: "chaotic_neutral", name: "混乱中立", nameEn: "Chaotic Neutral" },
  { id: "lawful_evil", name: "守序邪恶", nameEn: "Lawful Evil" },
  { id: "neutral_evil", name: "中立邪恶", nameEn: "Neutral Evil" },
  { id: "chaotic_evil", name: "混乱邪恶", nameEn: "Chaotic Evil" },
];

// Gender options
export const GENDERS = ["男性", "女性", "其他"] as const;

// Standard array for ability scores
export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];

// Point buy constants
export const POINT_BUY_TOTAL = 27;
export const POINT_BUY_MIN = 8;
export const POINT_BUY_MAX = 15;

// Point buy cost table
export const POINT_BUY_COSTS: Record<number, number> = {
  8: 0,
  9: 1,
  10: 2,
  11: 3,
  12: 4,
  13: 5,
  14: 7,
  15: 9,
};

// Calculate ability modifier
export const getAbilityModifier = (score: number): number => {
  return Math.floor((score - 10) / 2);
};

// Format ability modifier for display
export const formatModifier = (modifier: number): string => {
  return modifier >= 0 ? `+${modifier}` : `${modifier}`;
};


// Ability list for character creation steps
export const ABILITIES = [
  { id: 'strength', name: '力量', abbr: 'STR' },
  { id: 'dexterity', name: '敏捷', abbr: 'DEX' },
  { id: 'constitution', name: '体质', abbr: 'CON' },
  { id: 'intelligence', name: '智力', abbr: 'INT' },
  { id: 'wisdom', name: '感知', abbr: 'WIS' },
  { id: 'charisma', name: '魅力', abbr: 'CHA' },
];

