/**
 * Spell Effect Pipeline types.
 *
 * Defines the structured effect format matching backend schemas.
 * Spells with an `effects` field use these types for executable effects.
 */

// ── Trigger types ─────────────────────────────────────────────
export type TriggerType =
  | 'on_cast'               // 施法瞬间
  | 'on_hit'                // 攻击命中时（smite类）
  | 'on_weapon_hit'         // 武器攻击命中时
  | 'on_reaction'           // 反应触发
  | 'on_target_downed'      // 被标记目标倒地时
  | 'start_of_turn'         // 回合开始
  | 'end_of_turn'           // 回合结束
  | 'start_of_target_turn'  // 目标回合开始
  | 'end_of_target_turn'    // 目标回合结束
  | 'on_enter_zone'         // 进入区域
  | 'on_leave_zone'         // 离开区域
  | 'on_take_damage'        // 受伤时
  | 'on_concentration_end'  // 专注结束
  | 'on_action_invoked'     // 运行时动作被调用
  | 'narrative'             // 纯RP/叙事型，无机械效果

// ── Target config ─────────────────────────────────────────────
export interface TargetConfig {
  type: 'self' | 'single' | 'multiple' | 'zone' | 'all_in_area'
  count?: number | string   // number or "spell_mod"
  filter?: Record<string, unknown>
}

// ── Save config ───────────────────────────────────────────────
export interface SaveConfig {
  ability: string           // "dex", "wis", "con", etc.
  onSuccess: 'no_effect' | 'half_damage' | 'partial'
  onFailure?: string
}

// ── Attack config ─────────────────────────────────────────────
export interface AttackConfig {
  type: 'melee_spell' | 'ranged_spell'
  onMiss: 'no_effect' | 'half_damage'
}

// ── Escape config ─────────────────────────────────────────────
export interface EscapeConfig {
  trigger: string           // "end_of_turn", "on_take_damage", "action"
  method: 'save' | 'check' | 'auto_end'
  ability?: string
}

// ── Scaling config ────────────────────────────────────────────
export interface ScalingConfig {
  perSlotAbove: number      // 基础环位
  extraDice?: string        // 每升一环加的骰子, e.g. "1d6"
  extraTargets?: number
  extraDuration?: string
  extraValue?: number       // 每升一环固定值, e.g. tempHp +5
}

// ── Effect primitives ─────────────────────────────────────────
export interface DealDamageEffect {
  type: 'deal_damage'
  formula: string           // "8d6", "2d6+MOD"
  damageType: string        // "fire", "radiant"
  scaling?: ScalingConfig
}

export interface HealEffect {
  type: 'heal'
  formula: string
  scaling?: ScalingConfig
}

export interface ApplyConditionEffect {
  type: 'apply_condition'
  condition: string         // "paralyzed", "frightened"
  conditionCn?: string
  escape?: EscapeConfig
}

export interface ModifyStatEffect {
  type: 'modify_stat'
  stat: string              // "ac", "speed", "hp_max"
  formula: string           // "5", "13+DEX_MOD"
  operation: 'add' | 'set'
}

export interface ModifyRollEffect {
  type: 'modify_roll'
  rollTypes: string[]       // ["attack", "save"]
  formula: string           // "1d4"
  operation: 'add' | 'subtract'
  consumeOnUse?: boolean    // 一次性修正
}

export interface GrantTempHpEffect {
  type: 'grant_temp_hp'
  formula: string
  scaling?: ScalingConfig
}

export interface GrantResistanceEffect {
  type: 'grant_resistance'
  damageTypes: string[]
}

export interface GrantAdvantageEffect {
  type: 'grant_advantage'
  on: string                // "attack", "save", "incoming_attack"
  condition?: Record<string, unknown>
  consumeOnUse?: boolean    // 一次性效果
}

export interface GrantDisadvantageEffect {
  type: 'grant_disadvantage'
  on: string
  condition?: Record<string, unknown>
  consumeOnUse?: boolean
}

export interface GrantImmunityEffect {
  type: 'grant_immunity'
  damageTypes?: string[]
  conditions?: string[]           // 免疫的状态，如 ["frightened","paralyzed"]
}

export interface ApplyMarkEffect {
  type: 'apply_mark'
  params?: Record<string, unknown>
}

export interface RetargetMarkEffect {
  type: 'retarget_mark'
}

export interface ConditionalExtraDamageEffect {
  type: 'conditional_extra_damage'
  formula: string
  damageType: string
}

export interface SetRuntimeParamEffect {
  type: 'set_runtime_param'
  key: string
  value: unknown
}

export interface ClearRuntimeParamEffect {
  type: 'clear_runtime_param'
  key: string
}

export interface EndSpellInstanceEffect {
  type: 'end_spell_instance'
}

export interface ApplyEffectEffect {
  type: 'apply_effect'
  effectData: Record<string, unknown>
}

export interface NarrativeEffect {
  type: 'narrative'
  description?: string
}

// ── UI / Visual Effect Primitives (功能中间件 — UI 效果) ─────────
export interface ResizeTokenEffect {
  type: 'resize_token'
  sizeDelta: number              // +1 变大, -1 缩小
}

export interface ApplyTokenFilterEffect {
  type: 'apply_token_filter'
  filter: {
    blur?: number
    opacity?: number
    glow?: string
    glowRadius?: number
    glowAnimation?: 'pulse'
    overlay?: string
    saturate?: number
    brightness?: number
  }
}

export interface SetVisibilityEffect {
  type: 'set_visibility'
  mode: 'invisible' | 'ethereal'
  filter?: ApplyTokenFilterEffect['filter']
}

export interface SetDisguiseEffect {
  type: 'set_disguise'
  disguiseType: 'appearance' | 'form_change'
  requiresImage: boolean
}

export interface SpawnIllusionEffect {
  type: 'spawn_illusion'
  illusionType: string           // 'visual' | 'auditory' | 'visual_auditory'
  controllable?: boolean
  physicalPass?: boolean
}

export interface CreateZoneVisualEffect {
  type: 'create_zone_visual'
  zoneType: string               // 'fog' | 'darkness' | 'light' | 'terrain' | 'other'
  obscurement?: 'heavy' | 'light'
  difficultTerrain?: boolean
  spreadsAroundCorners?: boolean
  windDispel?: Record<string, number>  // {"moderate": 1, "strong": 3}
  cloudMovement?: { distance: number; direction: string; timing: string }
}

export interface ApplyTransformationEffect {
  type: 'apply_transformation'
  transformType: string          // 'polymorph' | 'wild_shape' | 'alter_self' | 'animal_shapes'
}

// ── Illumination Primitive (光照/黑暗效果) ──────────────────────
export interface ApplyIlluminationEffect {
  type: 'apply_illumination'
  lightType: 'light' | 'darkness'
  brightRadius: number             // 明亮光照半径（尺）
  dimRadius: number                // 微光半径（尺）
  darknessRadius?: number          // 黑暗半径（仅 darkness 类型）
  attachTo: 'object' | 'caster' | 'point' | 'target'
  color?: string                   // 光照颜色
  blocksDarkvision?: boolean       // 是否阻挡暗视觉
  dispelsLevel?: number            // 能驱散的对立法术最高环位
  isSunlight?: boolean             // 是否算作日光
  movable?: boolean
  moveAction?: string              // 'action' | 'bonus_action' | 'free'
}

// ── Summoning Primitive (召唤效果) ──────────────────────────────
export interface SpawnSummonEffect {
  type: 'spawn_summon'
  monsterId?: string               // 预设怪物 ID（如 riding_horse）
  instanceName: string             // 显示名称
  tokenSize?: string               // "1x1" | "2x2" 等
  avatarPath?: string              // 头像路径
  hpFormula?: string               // 生命值公式（如 "5d8"）
  count?: number                   // 召唤数量
  faction?: 'player' | 'neutral'   // 阵营
  description?: string
}

// ── Condition Removal Primitive (解除状态效果) ──────────────────
export interface RemoveConditionEffect {
  type: 'remove_condition'
  conditions: string[]             // 可解除的状态列表，如 ["blinded","deafened","poisoned"]
  mode: 'choose_one' | 'all'      // 选一个移除 | 全部移除
}

// ── Movement / Teleportation Primitives (位移/移动效果) ──────────
export interface TeleportEffect {
  type: 'teleport'
  range: number                  // 传送距离（尺）
  mode: 'self' | 'target' | 'swap'  // 自身传送 | 目标传送 | 互换位置
  mustSee?: boolean              // 是否需要视线
  carriesOthers?: boolean        // 是否可携带他人
}

export interface ModifyMovementEffect {
  type: 'modify_movement'
  movementType: string           // 'walk' | 'fly' | 'swim' | 'climb' | 'burrow'
  formula?: string               // 速度值或公式，如 "60" 或 "walk_speed"
  operation: 'set' | 'add' | 'grant'  // 设置 | 增减 | 授予新移动方式
  hover?: boolean                // 飞行是否悬浮
}

export interface RestrictMovementEffect {
  type: 'restrict_movement'
  restriction: string            // 'immobilized' | 'halved' | 'zero' | 'no_teleport'
  escape?: EscapeConfig
}

// ── Grant Action (法术授予的可执行动作) ─────────────────────────
export interface GrantActionEffect {
  type: 'grant_action'
  actionType: string              // "action", "bonus_action", "reaction"
  actionName: string              // 中文名，如 "灵体武器攻击"
  actionNameEn?: string           // 英文名
  icon?: string                   // emoji icon
  actionKind: string              // "melee_spell_attack", "dash", "command" 等
  attack?: AttackConfig
  save?: SaveConfig
  damage?: { formula: string; damageType: string }
  healing?: { formula: string }
  movement?: { range: number }
  areaOfEffect?: { type?: string; size?: number }
  attackCount?: number
  commandRange?: number
  allowedActions?: string[]
  triggerCondition?: string
  scaling?: ScalingConfig
  description?: string
}

// ── Forced Movement Primitive (强制位移) ────────────────────────
export interface ForcedMovementEffect {
  type: 'forced_movement'
  direction: 'push' | 'pull' | 'toward_point'  // 推开 | 拉近 | 朝向指定点
  distance: number                               // 距离（尺）
  relativeTo?: 'caster' | 'spell_origin'        // 相对于谁
}

// ── Wall Creation Primitive (墙体) ─────────────────────────────
export interface CreateWallEffect {
  type: 'create_wall'
  shape: 'line' | 'ring'
  lengthFt?: number                              // 线形总长
  heightFt?: number
  thicknessFt?: number
  hpPerSegment?: number                          // 每段 HP (null=不可摧毁)
  blocksMovement?: boolean
  blocksLineOfSight?: boolean
  blocksProjectiles?: boolean
  passThroughDamage?: { formula: string; damageType: string }
}

// ── Barrier Primitive (力场屏障) ───────────────────────────────
export interface CreateBarrierEffect {
  type: 'create_barrier'
  shape: 'sphere' | 'cube' | 'dome' | 'cage'
  radiusFt?: number
  sideFt?: number                                // cube 边长
  blocksMagic?: boolean
  blocksPhysical?: boolean
  indestructible?: boolean
  teleportBlocked?: boolean
}

// ── Moving Aura Primitive (跟随光环) ──────────────────────────
export interface CreateMovingAuraEffect {
  type: 'create_moving_aura'
  radiusFt: number
  anchor: 'caster' | 'target'
  auraType?: string                              // 'damage' | 'buff' | 'debuff' | 'protection'
}

// ── Counter Spell Primitive (法术反制) ────────────────────────
export interface CounterSpellEffect {
  type: 'counter_spell'
  autoCounterLevel: number                       // 自动反制的最高环位
  checkAbility?: string                          // 反制高环法术时的属性
  checkDcFormula?: string                        // DC 公式 "10 + spell_level"
}

// ── Grant Sense Primitive (感知能力) ─────────────────────────
export interface GrantSenseEffect {
  type: 'grant_sense'
  senseType: string                              // 'truesight' | 'blindsight' | 'tremorsense' | 'detect_invisible' | 'detect_magic' | 'remote_sensor'
  range?: number                                 // 感知范围（尺）
}

// ── Small utility primitives ─────────────────────────────────
export interface PreventHealingEffect {
  type: 'prevent_healing'
  duration?: string                              // 'until_caster_next_turn' | 'rounds'
}

export interface StabilizeEffect {
  type: 'stabilize'
}

export interface InstantKillEffect {
  type: 'instant_kill'
  hpThreshold: number                            // HP <= 此值即死
}

export interface ResurrectEffect {
  type: 'resurrect'
  hpRestored?: string                            // 公式，如 "1" 或 "full"
  debuffDuration?: string                        // 减值持续时间
  requiresBody?: boolean
}

// ── Stored Trigger Primitive (延迟触发) ──────────────────────
export interface StoredTriggerEffect {
  type: 'stored_trigger'
  triggerCondition: string                       // 'enter_area' | 'take_damage' | 'custom'
  storedSpellId?: string
}

// ── Suppress Magic Primitive (压制魔法) ─────────────────────
export interface SuppressMagicEffect {
  type: 'suppress_magic'
  maxSpellLevel?: number                         // null = 全部
  scope: 'zone' | 'target'
}

export type EffectPrimitive =
  | DealDamageEffect
  | HealEffect
  | ApplyConditionEffect
  | ModifyStatEffect
  | ModifyRollEffect
  | GrantTempHpEffect
  | GrantResistanceEffect
  | GrantImmunityEffect
  | GrantAdvantageEffect
  | GrantDisadvantageEffect
  | ApplyMarkEffect
  | RetargetMarkEffect
  | ConditionalExtraDamageEffect
  | SetRuntimeParamEffect
  | ClearRuntimeParamEffect
  | EndSpellInstanceEffect
  | ApplyEffectEffect
  | NarrativeEffect
  | GrantActionEffect
  // UI / Visual effects
  | ResizeTokenEffect
  | ApplyTokenFilterEffect
  | SetVisibilityEffect
  | SetDisguiseEffect
  | SpawnIllusionEffect
  | CreateZoneVisualEffect
  | ApplyTransformationEffect
  // Condition removal
  | RemoveConditionEffect
  // Illumination / Summoning effects
  | ApplyIlluminationEffect
  | SpawnSummonEffect
  // Movement / Teleportation effects
  | TeleportEffect
  | ModifyMovementEffect
  | RestrictMovementEffect
  // Forced movement / Walls / Barriers
  | ForcedMovementEffect
  | CreateWallEffect
  | CreateBarrierEffect
  | CreateMovingAuraEffect
  // Counter / Sense / Utility
  | CounterSpellEffect
  | GrantSenseEffect
  | PreventHealingEffect
  | StabilizeEffect
  | InstantKillEffect
  | ResurrectEffect
  // Trigger / Suppress
  | StoredTriggerEffect
  | SuppressMagicEffect

// ── Effect Phase ──────────────────────────────────────────────
export interface EffectPhase {
  trigger: TriggerType
  target?: TargetConfig
  attack?: AttackConfig     // 法术攻击骰（近战/远程法术攻击）
  save?: SaveConfig
  effects: EffectPrimitive[]
  escape?: EscapeConfig
  duration?: { rounds?: number; minutes?: number; concentration?: boolean }
  scaling?: ScalingConfig
  condition?: Record<string, unknown>   // 触发前置条件
  // ── 生物类型过滤 ──
  targetCreatureTypes?: string[]        // 仅对这些类型生效 (如 ["humanoid"])
  excludeCreatureTypes?: string[]       // 对这些类型无效 (如 ["undead","construct"])
}
