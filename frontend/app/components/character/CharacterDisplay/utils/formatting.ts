// CN label maps and formatters
import { tAbility, tProficiency, tWeaponProperty } from "~/utils/i18n";

export const abilityLabelMap: Record<string, string> = {
  strength: "力量",
  dexterity: "敏捷",
  constitution: "体质",
  intelligence: "智力",
  wisdom: "感知",
  charisma: "魅力",
};

// Proficiency formatting now uses unified dictionary
export const formatProficiency = (id: string): string => tProficiency(id);

// Weapon property formatting now uses unified dictionary
export const formatWeaponProperty = (prop: string): string => {
  // Try weapon property first, then fall back to proficiency
  const result = tWeaponProperty(prop);
  return result !== prop ? result : tProficiency(prop);
};

export const alignmentMap: Record<string, string> = {
  // underscore format (DB)
  lawful_good: "守序善良", neutral_good: "中立善良", chaotic_good: "混乱善良",
  lawful_neutral: "守序中立", true_neutral: "绝对中立", chaotic_neutral: "混乱中立",
  lawful_evil: "守序邪恶", neutral_evil: "中立邪恶", chaotic_evil: "混乱邪恶",
  // hyphen format (legacy)
  "lawful-good": "守序善良", "neutral-good": "中立善良", "chaotic-good": "混乱善良",
  "lawful-neutral": "守序中立", "true-neutral": "绝对中立", "chaotic-neutral": "混乱中立",
  "lawful-evil": "守序邪恶", "neutral-evil": "中立邪恶", "chaotic-evil": "混乱邪恶",
  // abbreviation format
  LG: "守序善良", NG: "中立善良", CG: "混乱善良",
  LN: "守序中立", N: "绝对中立", CN: "混乱中立",
  LE: "守序邪恶", NE: "中立邪恶", CE: "混乱邪恶",
};
export const formatAlignment = (id: string): string => alignmentMap[id] || id;

export const fightingStyleMap: Record<string, string> = {
  archery: "箭术",
  defense: "防御",
  dueling: "决斗",
  great_weapon_fighting: "强武器战斗",
  great_weapon: "强武器战斗",
  two_weapon_fighting: "双武器战斗",
  two_weapon: "双武器战斗",
  protection: "防护",
};
export const formatFightingStyle = (id: string): string => fightingStyleMap[id] || id;

export const fightingStyleDescriptionMap: Record<string, string> = {
  archery: "你用远程武器进行的攻击检定获得+2加值。",
  defense: "当你穿着护甲时，你的AC获得+1加值。",
  dueling: "当你在一只手持有一把近战武器而另一只手没有持武器时，你用该武器的伤害掷骰获得+2加值。",
  great_weapon_fighting: "当你用双手持有的近战武器掷伤害骰时，你可以将任何掷出1或2的骰子重掷一次，但必须使用新结果。",
  great_weapon: "当你用双手持有的近战武器掷伤害骰时，你可以将任何掷出1或2的骰子重掷一次，但必须使用新结果。",
  two_weapon_fighting: "当你使用双武器战斗时，你可以将你的属性调整值加到第二次攻击的伤害中。",
  two_weapon: "当你使用双武器战斗时，你可以将你的属性调整值加到第二次攻击的伤害中。",
  protection: "当你持盾时，若你能看见的一个生物攻击你5尺内的其他目标，你可以用反应使该攻击检定具有劣势。",
};
export const getFightingStyleDescription = (id: string): string => fightingStyleDescriptionMap[id] || "";

export const metamagicMap: Record<string, string> = {
  careful_spell: "谨慎法术",
  distant_spell: "遥远法术",
  empowered_spell: "强效法术",
  extended_spell: "延时法术",
  heightened_spell: "升阶法术",
  quickened_spell: "瞬发法术",
  subtle_spell: "微妙法术",
  twinned_spell: "孪生法术",
};
export const formatMetamagic = (id: string): string => metamagicMap[id] || id;

export const eldritchInvocationMap: Record<string, string> = {
  agonizing_blast: "痛苦爆破",
  armor_of_shadows: "暗影护甲",
  ascendant_step: "升天之步",
  beast_speech: "兽语",
  beguiling_influence: "魅惑影响",
  bewitching_whispers: "蛊惑低语",
  book_of_ancient_secrets: "古老秘密之书",
  chains_of_carceri: "卡瑟里之链",
  devils_sight: "魔鬼视觉",
  dreadful_word: "恐怖之语",
  eldritch_sight: "魔能视觉",
  eldritch_spear: "魔能长矛",
  eyes_of_the_rune_keeper: "符文守护者之眼",
  fiendish_vigor: "邪魔活力",
  gaze_of_two_minds: "双心凝视",
  lifedrinker: "生命吸取",
  mask_of_many_faces: "千面之相",
  master_of_myriad_forms: "万千形态大师",
  minions_of_chaos: "混沌仆从",
  mire_the_mind: "困惑心智",
  misty_visions: "迷雾幻象",
  one_with_shadows: "与影为一",
  otherworldly_leap: "异界跳跃",
  repelling_blast: "击退爆破",
  sculptor_of_flesh: "血肉雕塑师",
  sign_of_ill_omen: "凶兆之征",
  thief_of_five_fates: "五命窃贼",
  thirsting_blade: "渴血之刃",
  visions_of_distant_realms: "遥远国度幻象",
  voice_of_the_chain_master: "锁链主人之声",
  whispers_of_the_grave: "坟墓低语",
  witch_sight: "巫师视觉",
};
export const formatEldritchInvocation = (id: string): string => eldritchInvocationMap[id] || id;

export const favoredEnemyMap: Record<string, string> = {
  aberrations: "异怪",
  beasts: "野兽",
  celestials: "天界生物",
  constructs: "构装体",
  dragons: "龙类",
  elementals: "元素生物",
  fey: "精类",
  fiends: "邪魔",
  giants: "巨人",
  monstrosities: "怪物",
  oozes: "软泥怪",
  plants: "植物",
  undead: "不死生物",
  humanoids: "类人生物",
};
export const favoredHumanoidMap: Record<string, string> = {
  human: "人类", humans: "人类",
  elf: "精灵", elves: "精灵",
  dwarf: "矮人", dwarves: "矮人",
  halfling: "半身人", halflings: "半身人",
  gnome: "侏儒", gnomes: "侏儒",
  half_elf: "半精灵", half_elves: "半精灵",
  half_orc: "半兽人", half_orcs: "半兽人",
  tiefling: "提夫林", tieflings: "提夫林",
  dragonborn: "龙裔",
  orc: "兽人", orcs: "兽人",
  goblin: "地精", goblins: "地精",
  hobgoblin: "大地精", hobgoblins: "大地精",
  bugbear: "熊地精", bugbears: "熊地精",
  kobold: "狗头人", kobolds: "狗头人",
  lizardfolk: "蜥蜴人",
  gnoll: "豺狼人", gnolls: "豺狼人",
  drow: "卓尔精灵",
  duergar: "灰矮人",
  sahuagin: "沙华鱼人",
  troglodytes: "穴居人",
};
export const favoredTerrainMap: Record<string, string> = {
  arctic: "极地",
  coast: "海岸",
  desert: "沙漠",
  forest: "森林",
  grassland: "草原",
  hill: "丘陵",
  mountain: "山脉",
  swamp: "沼泽",
  underdark: "幽暗地域",
};

export const formatFavoredEnemy = (enemy: string): string => favoredEnemyMap[enemy] || enemy;
export const formatHumanoid = (id: string): string => favoredHumanoidMap[id] || id;
export const formatFavoredTerrain = (terrain: string): string => favoredTerrainMap[terrain] || terrain;

/** Match character terrain (ranger/druid) against global map terrain */
const TERRAIN_ALIASES: Record<string, string[]> = {
  underground: ['underdark', 'dungeon'],
  underdark: ['underdark', 'dungeon'],
  hill: ['hill', 'hills'],
};
export function doesTerrainMatch(characterTerrain: string | undefined | null, globalTerrain: string | undefined | null): boolean {
  if (!characterTerrain || !globalTerrain) return false;
  const ct = characterTerrain.toLowerCase();
  const gt = globalTerrain.toLowerCase();
  if (ct === gt) return true;
  const aliases = TERRAIN_ALIASES[ct];
  return aliases ? aliases.includes(gt) : false;
}

// Background equipment display mapping
const equipmentNameMap: Record<string, string> = {
  holy_symbol: "圣徽",
  prayer_book: "祈祷书",
  incense: "熏香",
  vestments: "祭服",
  censer: "香炉",
  common_clothes: "平民服装",
  clothes_common: "平民服装",
  dark_common_clothes_with_hood: "带兜帽的深色平民服装",
  fine_clothes: "精致服装",
  travelers_clothes: "旅行者服装",
  costume: "戏服",
  pouch: "小包",
  pouch_with_5gp: "小包(5金币)",
  pouch_with_10gp: "小包(10金币)",
  pouch_with_15gp: "小包(15金币)",
  pouch_with_25gp: "小包(25金币)",
  crowbar: "撬棍",
  shovel: "铲子",
  iron_pot: "铁锅",
  artisan_tools: "工匠工具",
  bottle_of_ink: "墨水瓶",
  quill: "羽毛笔",
  small_knife: "小刀",
  signet_ring: "印章戒指",
  scroll_of_pedigree: "家谱卷轴",
  letter_from_dead_colleague: "已故同事的信",
  scroll_case_with_notes: "装有笔记的卷轴盒",
  insignia_of_rank: "军衔徽章",
  trophy_from_fallen_enemy: "敌人战利品",
  gaming_set_or_playing_cards: "游戏套装或扑克牌",
  admirer_favor: "仰慕者的信物",
  letter_of_introduction_from_guild: "公会介绍信",
  winter_blanket: "冬用毯子",
  herbalism_kit: "草药工具",
  staff: "木棍",
  hunting_trap: "狩猎陷阱",
  trophy_from_animal: "动物战利品",
  belaying_pin: "系索栓",
  "50_feet_silk_rope": "50尺丝绳",
  lucky_charm: "幸运符",
  map_of_city: "城市地图",
  pet_mouse: "宠物老鼠",
  token_of_parents: "父母的信物",
  tools_of_con: "行骗工具",
};
export const formatEquipmentName = (id: string): string => {
  const [itemId, qty] = id.split(":");
  const name = (equipmentNameMap as any)[itemId] || itemId;
  return qty ? `${name} x${qty}` : name;
};
