/**
 * Unified Class Resource System Types
 * 统一职业资源系统类型定义
 */

/** 资源最大值计算公式 */
export type MaxFormula =
  | 'level'              // 等于职业等级
  | 'half_level_rounded_up'  // 等级的一半（向上取整）
  | 'cha_mod'            // 魅力调整值
  | 'cha_mod_plus_1'     // 1 + 魅力调整值 (神圣感知)
  | 'wis_mod'            // 感知调整值
  | 'int_mod'            // 智力调整值
  | 'level_times_5'      // 等级 × 5 (圣疗池)
  | 'wizard_level_times_2_plus_int'  // 法师等级×2 + 智力调整值
  | 'fixed'              // 固定值（查 maxScaling）
  | 'passive'            // 被动能力，无消耗
  | 'uses_ki'            // 共享气点
  | 'uses_wild_shape'    // 共享野性形态
  | 'spell_slots';       // 使用法术位

/** 恢复时机 */
export type RechargeType = 'short_rest' | 'long_rest';

/** 动作类型 */
export type ResourceActionType = 'action' | 'bonus_action' | 'reaction' | 'free';

/** 职业资源定义 */
export interface ClassResource {
  id: string;
  name: string;
  nameEn: string;
  classId: string;
  subclassId?: string;
  description: string;
  descriptionEn: string;

  /** 获得此资源的最低等级 */
  minLevel: number;

  /** 最大值计算公式 */
  maxFormula: MaxFormula;

  /** 最小最大值（如激励骰最少1） */
  minMax?: number;

  /** 等级-最大值映射（用于 fixed 公式）-1 表示无限 */
  maxScaling?: Record<number, number>;

  /** 恢复时机 */
  recharge?: RechargeType;

  /** 恢复时机升级（如吟游诗人5级后短休恢复） */
  rechargeUpgrade?: {
    level: number;
    recharge: RechargeType;
  };

  /** 骰子类型（如战技骰 d8） */
  diceType?: string;

  /** 骰子类型等级缩放 */
  diceScaling?: Record<number, string>;

  /** 是否是预投骰子（如预言骰） */
  isPrerolled?: boolean;

  /** 是否用于恢复法术位 */
  isSpellSlotRecovery?: boolean;

  /** 共享的资源 ID（如暗影技艺共享气） */
  shareResource?: string;

  /** 特殊恢复机制 */
  specialRecharge?: string;

  /** 重击范围（冠军战士） */
  critRange?: Record<number, number>;

  /** 关联的能力 ID 列表 */
  abilities: string[];
}

/** 资源能力定义（消耗资源的具体能力） */
export interface ResourceAbility {
  id: string;
  name: string;
  nameEn: string;
  subclassId?: string;

  /** 关联的资源 ID */
  resourceId: string;

  /** 消耗数量，或 "spell_level" 表示等于法术环位 */
  cost: number | 'spell_level';

  /** 最小消耗（用于 spell_level） */
  minCost?: number;

  /** 最低等级要求 */
  minLevel?: number;

  /** 动作类型 */
  actionType: ResourceActionType;

  /** 执行语义，由前后端统一按 JSON 解释 */
  execution?: Record<string, any>;

  description: string;
  descriptionEn: string;
}

/** 角色当前资源状态 */
export interface CharacterResourceState {
  resourceId: string;
  current: number;
  max: number;
  /** 预投的骰子值（如预言骰） */
  prerolledValues?: number[];
}

/** class_resources.json 文件结构 */
export interface ClassResourcesData {
  classResources: ClassResource[];
  resourceAbilities: ResourceAbility[];
}

// ============ 工具函数类型 ============

/** 计算资源最大值的参数 */
export interface ResourceMaxParams {
  level: number;
  classId: string;
  subclassId?: string;
  charisma?: number;
  wisdom?: number;
  intelligence?: number;
}

/** 获取角色可用资源的返回类型 */
export interface CharacterResources {
  resources: ClassResource[];
  abilities: ResourceAbility[];
}
