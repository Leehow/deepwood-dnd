/**
 * D&D 5E 反应系统注册表
 * 根据角色的职业/等级/专长/已准备法术，计算可用反应列表
 */

export type ReactionCategory = 'attack' | 'defense' | 'spell';
export type ReactionTrigger =
  | 'on_enemy_move'    // 敌人离开你触及范围
  | 'on_hit'           // 你被命中(任意攻击)
  | 'on_ranged_hit'    // 你被远程攻击命中
  | 'on_melee_hit'     // 你被近战攻击命中
  | 'on_melee_miss'    // 近战攻击未命中你
  | 'on_spell_cast'    // 敌人施法
  | 'on_damage'        // 你受到伤害
  | 'on_falling'       // 坠落时
  | 'on_elemental_damage'; // 受到元素伤害

export interface ReactionDefinition {
  id: string;
  name: string;
  icon: string;
  category: ReactionCategory;
  triggerDesc: string;
  triggerType: ReactionTrigger;
  requiresTarget?: boolean;
  requiresSpellSlot?: boolean;
  spellLevel?: number;
  source: string;
}

interface CharReactionInput {
  class_id: string;
  subclass_id?: string | null;
  level: number;
  feats?: Array<string | { value: string }>;
  prepared_spells?: string[];
  selected_spells?: { id: string }[] | string[];
  selected_cantrips?: { id: string }[] | string[];
}

// 反应法术ID列表（castingTime 含"反应"的常见法术）
const REACTION_SPELL_MAP: Record<string, Omit<ReactionDefinition, 'source'>> = {
  shield: {
    id: 'shield_spell', name: '护盾术', icon: '🛡️',
    category: 'spell', triggerType: 'on_hit',
    triggerDesc: '被攻击命中时，AC+5（可能使攻击未命中）',
    requiresSpellSlot: true, spellLevel: 1,
  },
  counterspell: {
    id: 'counterspell', name: '反制法术', icon: '🚫',
    category: 'spell', triggerType: 'on_spell_cast',
    triggerDesc: '敌人施法时，尝试反制该法术',
    requiresSpellSlot: true, spellLevel: 3,
  },
  hellish_rebuke: {
    id: 'hellish_rebuke', name: '炼狱叱喝', icon: '🔥',
    category: 'spell', triggerType: 'on_damage',
    triggerDesc: '受到伤害时，对攻击者造成2d10火焰伤害',
    requiresSpellSlot: true, spellLevel: 1,
  },
  feather_fall: {
    id: 'feather_fall', name: '羽落术', icon: '🪶',
    category: 'spell', triggerType: 'on_falling',
    triggerDesc: '坠落时，减缓下落速度',
    requiresSpellSlot: true, spellLevel: 1,
  },
  absorb_elements: {
    id: 'absorb_elements', name: '吸收元素', icon: '✨',
    category: 'spell', triggerType: 'on_elemental_damage',
    triggerDesc: '受到酸/冷/火/雷/电伤害时，获得抗性并蓄力反击',
    requiresSpellSlot: true, spellLevel: 1,
  },
};

function getFeatIds(feats?: Array<string | { value: string }>): string[] {
  if (!feats) return [];
  return feats.map(f => typeof f === 'string' ? f : f.value);
}

function getSpellIds(
  prepared?: string[],
  selected?: { id: string }[] | string[],
  cantrips?: { id: string }[] | string[],
): Set<string> {
  const ids = new Set<string>();
  prepared?.forEach(id => ids.add(id));
  if (selected) {
    for (const s of selected) ids.add(typeof s === 'string' ? s : s.id);
  }
  if (cantrips) {
    for (const c of cantrips) ids.add(typeof c === 'string' ? c : c.id);
  }
  return ids;
}

export function getAvailableReactions(char: CharReactionInput): ReactionDefinition[] {
  const reactions: ReactionDefinition[] = [];
  const { class_id, subclass_id, level } = char;
  const featIds = getFeatIds(char.feats);
  const spellIds = getSpellIds(char.prepared_spells, char.selected_spells, char.selected_cantrips);

  // === 通用反应 ===
  reactions.push({
    id: 'opportunity_attack', name: '借机攻击', icon: '⚔️',
    category: 'attack', triggerType: 'on_enemy_move',
    triggerDesc: '敌人离开你的触及范围时，进行一次近战攻击',
    requiresTarget: true,
    source: 'universal',
  });

  // === 职业反应 ===

  // 游荡者5+ - 灵活闪避
  if (class_id === 'rogue' && level >= 5) {
    reactions.push({
      id: 'uncanny_dodge', name: '灵活闪避', icon: '💨',
      category: 'defense', triggerType: 'on_hit',
      triggerDesc: '被攻击命中时，所受伤害减半',
      source: 'class:rogue:5',
    });
  }

  // 武僧3+ - 偏转飞射物
  if (class_id === 'monk' && level >= 3) {
    reactions.push({
      id: 'deflect_missiles', name: '偏转飞射物', icon: '🤲',
      category: 'defense', triggerType: 'on_ranged_hit',
      triggerDesc: '被远程武器攻击命中时，减少1d10+DEX+等级的伤害',
      source: 'class:monk:3',
    });
  }

  // 战斗大师 - 招架
  if (class_id === 'fighter' && subclass_id === 'battle_master') {
    reactions.push({
      id: 'parry', name: '招架', icon: '🗡️',
      category: 'defense', triggerType: 'on_melee_hit',
      triggerDesc: '被近战攻击命中时，减少1d(战技骰)+DEX修正的伤害',
      source: 'class:fighter:battle_master',
    });
    // 反击
    reactions.push({
      id: 'riposte', name: '反击', icon: '↩️',
      category: 'attack', triggerType: 'on_melee_miss',
      triggerDesc: '近战攻击未命中你时，进行一次近战攻击+战技骰伤害',
      requiresTarget: true,
      source: 'class:fighter:battle_master',
    });
  }

  // === 专长反应 ===

  // 哨兵
  if (featIds.includes('sentinel')) {
    reactions.push({
      id: 'sentinel', name: '哨兵攻击', icon: '🛑',
      category: 'attack', triggerType: 'on_enemy_move',
      triggerDesc: '借机攻击命中时，目标速度降为0',
      requiresTarget: true,
      source: 'feat:sentinel',
    });
  }

  // 法师杀手
  if (featIds.includes('mage_slayer')) {
    reactions.push({
      id: 'mage_slayer', name: '法师杀手', icon: '🔪',
      category: 'attack', triggerType: 'on_spell_cast',
      triggerDesc: '5尺内敌人施法时，进行一次近战攻击',
      requiresTarget: true,
      source: 'feat:mage_slayer',
    });
  }

  // 防御决斗者
  if (featIds.includes('defensive_duelist')) {
    reactions.push({
      id: 'defensive_duelist', name: '防御决斗者', icon: '🤺',
      category: 'defense', triggerType: 'on_melee_hit',
      triggerDesc: '被近战攻击命中时，AC+熟练加值（可能使攻击未命中）',
      source: 'feat:defensive_duelist',
    });
  }

  // 盾牌大师 - 盾牌防御（对DEX豁免使用反应将伤害降为0）
  if (featIds.includes('shield_master')) {
    reactions.push({
      id: 'shield_master_evasion', name: '盾牌闪避', icon: '🛡️',
      category: 'defense', triggerType: 'on_damage',
      triggerDesc: 'DEX豁免成功时，用反应将伤害降为0',
      source: 'feat:shield_master',
    });
  }

  // 战争施法者 - 借机攻击时可以施法
  if (featIds.includes('war_caster')) {
    reactions.push({
      id: 'war_caster_oa', name: '战争施法(借机)', icon: '⚡',
      category: 'spell', triggerType: 'on_enemy_move',
      triggerDesc: '借机攻击时施放法术代替近战攻击',
      source: 'feat:war_caster',
    });
  }

  // 长柄武器大师 - 进入触及范围的借机攻击
  if (featIds.includes('polearm_master')) {
    reactions.push({
      id: 'polearm_master_oa', name: '长柄借机攻击', icon: '🔱',
      category: 'attack', triggerType: 'on_enemy_move',
      triggerDesc: '敌人进入你触及范围时，用长柄武器进行借机攻击',
      requiresTarget: true,
      source: 'feat:polearm_master',
    });
  }

  // === 反应法术（从已准备/已知法术中筛选） ===
  for (const [spellId, def] of Object.entries(REACTION_SPELL_MAP)) {
    if (spellIds.has(spellId)) {
      reactions.push({ ...def, source: `spell:${spellId}` });
    }
  }

  return reactions;
}

/**
 * 根据触发场景筛选匹配的反应
 */
export function filterReactionsByTrigger(
  reactions: ReactionDefinition[],
  trigger: ReactionTrigger,
): ReactionDefinition[] {
  // on_hit 匹配所有命中类触发
  if (trigger === 'on_hit') {
    return reactions.filter(r =>
      r.triggerType === 'on_hit' ||
      r.triggerType === 'on_melee_hit' ||
      r.triggerType === 'on_ranged_hit'
    );
  }
  if (trigger === 'on_melee_hit') {
    return reactions.filter(r =>
      r.triggerType === 'on_hit' || r.triggerType === 'on_melee_hit'
    );
  }
  if (trigger === 'on_ranged_hit') {
    return reactions.filter(r =>
      r.triggerType === 'on_hit' || r.triggerType === 'on_ranged_hit'
    );
  }
  return reactions.filter(r => r.triggerType === trigger);
}

/**
 * 判定聊天消息的触发类型
 */
export function getCombatMessageTrigger(
  meta: Record<string, any> | undefined,
): ReactionTrigger | null {
  if (!meta) return null;
  const combatType = meta.combat_type;
  if (combatType === 'spell' || combatType === 'area_spell') return 'on_spell_cast';
  if (combatType !== 'attack') return null;

  const isHit = meta.is_hit ?? meta.hit;
  const isMelee = meta.is_melee ?? meta.attack_type === 'melee';
  const isRanged = meta.is_ranged ?? meta.attack_type === 'ranged';

  if (!isHit) return 'on_melee_miss'; // 未命中 → riposte 等
  if (isMelee) return 'on_melee_hit';
  if (isRanged) return 'on_ranged_hit';
  return 'on_hit';
}
