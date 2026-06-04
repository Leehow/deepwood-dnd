// Type definitions and mappings for Rules Panel

// Import equipment data
import equipmentData from "../../data/equipment.json";

// Base path for static assets
const BASE_PATH = typeof import.meta.env?.BASE_URL === 'string' ? import.meta.env.BASE_URL.replace(/\/$/, '') : '';

// Build equipment ID to name mapping from equipment.json
export const buildEquipmentMap = (): Record<string, string> => {
  const map: Record<string, string> = {};

  const addItems = (items: any[]) => {
    items.forEach((item: any) => {
      if (item.id && item.name) {
        map[item.id] = item.name;
      }
    });
  };

  // Armor
  if (equipmentData.armor) {
    Object.values(equipmentData.armor).forEach((category: any) => {
      if (Array.isArray(category)) {
        addItems(category);
      }
    });
  }

  // Weapons
  if (equipmentData.weapons) {
    const { simple, martial } = equipmentData.weapons as any;
    if (simple) {
      if (simple.melee) addItems(simple.melee);
      if (simple.ranged) addItems(simple.ranged);
    }
    if (martial) {
      if (martial.melee) addItems(martial.melee);
      if (martial.ranged) addItems(martial.ranged);
    }
  }

  // Adventuring Gear
  if (equipmentData.adventuringGear) {
    Object.values(equipmentData.adventuringGear).forEach((category: any) => {
      if (Array.isArray(category)) {
        addItems(category);
      }
    });
  }

  // Tools
  if (equipmentData.tools) {
    Object.values(equipmentData.tools).forEach((category: any) => {
      if (Array.isArray(category)) {
        addItems(category);
      }
    });
  }

  return map;
};

// Equipment map (lazy - built on first access)
let _equipmentMapCache: Record<string, string> | null = null;
export function getEquipmentMap(): Record<string, string> {
  if (!_equipmentMapCache) {
    _equipmentMapCache = buildEquipmentMap();
  }
  return _equipmentMapCache;
}

// ID to Chinese text mapping (non-equipment only)
export const ID_MAPPINGS: Record<string, string> = {
  // Abilities
  strength: "力量",
  dexterity: "敏捷",
  constitution: "体质",
  intelligence: "智力",
  wisdom: "感知",
  charisma: "魅力",

  // Skills
  athletics: "运动",
  acrobatics: "杂技",
  sleight_of_hand: "巧手",
  stealth: "隐匿",
  arcana: "奥秘",
  history: "历史",
  investigation: "调查",
  nature: "自然",
  religion: "宗教",
  animal_handling: "驯兽",
  insight: "洞悉",
  medicine: "医药",
  perception: "察觉",
  survival: "生存",
  deception: "欺瞒",
  intimidation: "威吓",
  performance: "表演",
  persuasion: "游说",

  // Classes
  barbarian: "野蛮人",
  bard: "吟游诗人",
  cleric: "牧师",
  druid: "德鲁伊",
  fighter: "战士",
  monk: "武僧",
  paladin: "圣武士",
  ranger: "游侠",
  rogue: "游荡者",
  sorcerer: "术士",
  warlock: "邪术师",
  wizard: "法师",

  // Common terms
  light_armor: "轻甲",
  medium_armor: "中甲",
  heavy_armor: "重甲",
  shields: "盾牌",
  simple_weapons: "简易武器",
  martial_weapons: "军用武器",

  // Special background-specific items (not in equipment.json)
  holy_symbol: "圣徽",
  prayer_book: "祷告书",
  incense: "熏香",
  vestments: "法衣",
  common_clothes: "平民服装",
  pouch_with_15gp: "装有15gp的钱袋",
  pouch_with_10gp: "装有10gp的钱袋",
  pouch_with_25gp: "装有25gp的钱袋",
  pouch_with_5gp: "装有5gp的钱袋",
  artisan_tools: "工匠工具",
  gaming_set: "游戏套装",
  vehicles_land: "陆上载具",
  vehicles_water: "水上载具",
  small_knife: "小刀",
  belaying_pin: "系缆栓",
  dark_common_clothes_with_hood: "带兜帽的深色平民服装",
  scroll_of_pedigree: "家谱卷轴",
  scroll_case_with_notes: "装有笔记的卷轴盒",
  letter_from_dead_colleague: "已故同事的信件",
  letter_of_introduction_from_guild: "公会介绍信",
  map_of_city: "城市地图",
  bottle_of_ink: "墨水瓶",
  winter_blanket: "冬季毯子",
  insignia_of_rank: "军衔徽章",
  lucky_charm: "幸运符",
  token_of_parents: "父母的遗物",
  trophy_from_fallen_enemy: "敌人遗物",
  trophy_from_animal: "动物战利品",
  admirer_favor: "仰慕者的恩赐",
  tools_of_con: "骗术工具",
  gaming_set_or_playing_cards: "游戏套装或纸牌",
  pet_mouse: "宠物老鼠",

  // Mounts and vehicles (if not in equipment.json)
  horse: "马",
  pony: "小马",
  mule: "骡子",
  donkey: "驴",
};

// Helper function to translate IDs to Chinese
export function translateId(id: string): string {
  // Handle items with quantity (e.g., "incense:5")
  const [itemId, quantity] = id.split(':');

  // Check equipment map first (from equipment.json), then ID_MAPPINGS (abilities, skills, classes, etc.)
  const translated = getEquipmentMap()[itemId] || ID_MAPPINGS[itemId] || itemId;

  // If there's a quantity, append it
  if (quantity) {
    return `${translated} ×${quantity}`;
  }

  return translated;
}

// Interface definitions
export interface RuleFile {
  name: string;
  displayName: string;
  data: any;
}

export interface SearchResult {
  fileName: string;
  path: string;
  content: any;
  matchText: string;
}

// Rule file configurations
export const RULE_FILES = [
  { name: "abilities", displayName: "属性" },
  { name: "backgrounds", displayName: "背景" },
  { name: "classes", displayName: "职业" },
  { name: "combat-rules", displayName: "战斗规则" },
  { name: "conditions", displayName: "状态" },
  { name: "core-rules", displayName: "核心规则" },
  { name: "creatures", displayName: "生物" },
  { name: "diseases", displayName: "疾病" },
  { name: "encounter-tables", displayName: "遭遇表" },
  { name: "equipment", displayName: "装备" },
  { name: "magic-items", displayName: "魔法物品" },
  { name: "gods", displayName: "神祇" },
  { name: "monsters", displayName: "怪物" },
  { name: "npc-templates", displayName: "NPC模板" },
  { name: "planes", displayName: "位面" },
  { name: "poisons", displayName: "毒素" },
  { name: "races", displayName: "种族" },
  { name: "skills", displayName: "技能" },
  { name: "spells", displayName: "法术" },
];
