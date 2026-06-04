/**
 * Type definitions and constants for TacticalMap component
 */

import type { HotbarSlot } from '~/components/character/CharacterDisplay/types/Character';

// ============================================================================
// CONSTANTS
// ============================================================================

export const GRID_SIZE = 40; // 40px = 5尺
export const MAP_WIDTH = 30;
export const MAP_HEIGHT = 20;

// ============================================================================
// INTERFACES
// ============================================================================

export interface PlayerAvatar {
  id: number | string;  // character_id 或 monster_instance_id（带前缀 "m_"）
  name: string;
  avatar_url?: string;
  isOnline?: boolean;
  type?: 'player' | 'monster';  // 区分玩家角色和怪物
  userId?: number;  // 用户 ID，用于匹配语音参与者
}

export interface MapTransform {
  rotation: number;      // 0, 90, 180, 270
  flipH: boolean;        // 水平翻转
  flipV: boolean;        // 垂直翻转
}

export interface TacticalMapProps {
  campaignId: string;
  isDM: boolean;
  selectedTool: string;
  showGrid: boolean;
  showFogOfWar: boolean;
  currentMapUrl?: string | null;
  mapImageScale?: number;
  mapTransform?: MapTransform;
  userId?: string;
  selectedCharacterId?: number | null;
  onFocusMyToken?: () => void;
  fogMode?: "brush" | "eraser"; // 迷雾绘制模式
  fogBrushSize?: number; // 迷雾笔刷大小（网格数）
  // 地形工具
  terrainType?: string;
  terrainMode?: "brush" | "eraser";
  terrainBrushSize?: number;
  showTerrainToPlayers?: boolean; // DM控制是否让玩家看到地形
  globalTerrain?: string | null;
  rulerMode?: "measure" | "circle" | "erase" | null; // 测距模式: measure=直线, circle=圆形, erase=擦除
  drawTool?: "circle" | "sketch" | "arrow" | "eraser" | null; // 绘图工具
  drawColor?: string; // 绘图颜色
  drawStrokeWidth?: number; // 绘图笔宽
  onDrawStrokeWidthChange?: (width: number) => void; // 绘图笔宽变更回调
  // 地图标记相关
  markerIcon?: string;
  markerColor?: string;
  // Token工具相关
  tokenMode?: "place" | "delete"; // Token模式
  // AI标记显示
  showAIMarkers?: boolean; // 是否显示AI生成的标记
  // 网格单位长度设置
  onGridUnitLengthClick?: () => void; // DM点击设置网格单位长度
  // 玩家角色头像
  playerAvatars?: PlayerAvatar[];
  // Character switching transition state - when true, skip rendering Konva Stage completely
  isTransitioning?: boolean;
  drawingsRefreshVersion?: number;
  // 右侧面板状态（用于小地图 & 缩放栏定位）
  rightSidebarWidth?: number;
  showRightSidebar?: boolean;
  isResizing?: boolean;
  // 快捷栏瞄准模式
  hotbarTargeting?: {
    slot: HotbarSlot;
    sourceCharacterId: number;
    targetingType?: 'attack' | 'ability' | 'spell';
    abilityData?: { abilityId: string; poolCurrent: number; poolMax: number };
    spellData?: {
      spell: any;
      slotLevel: number;
      sourceTokenId: number;
      illusionImageUrl?: string;
      illusionDesc?: string;
      illusionDisplayName?: string;
      selectedOption?: string;
      materialId?: string;
      ritualCast?: boolean;
      runtimeAction?: Record<string, any>;
      longCast?: boolean;
      confirmBreakConcentration?: boolean;
    };
  } | null;
  onHotbarTargetSelect?: (targetTokenId: number, targetName: string, distanceFeet: number, targetExtra?: {
    currentHp?: number; maxHp?: number; monsterType?: string;
  }) => void;
  onHotbarTargetCancel?: () => void;
  onTrade?: (sourceCharacterId: number, targetToken: Token) => void;
  onLayOnHands?: (sourceCharacterId: number, targetToken: Token, distanceFeet: number, poolCurrent: number, poolMax: number) => void;
  onStartSpellTargeting?: (data: {
    spell: any;
    slotLevel: number;
    sourceTokenId: number;
    characterId: number;
    freecast?: boolean;
    ritualCast?: boolean;
    illusionImageUrl?: string;
    illusionDesc?: string;
    illusionDisplayName?: string;
    selectedOption?: string;
    materialId?: string;
    runtimeAction?: Record<string, any>;
    longCast?: boolean;
    confirmBreakConcentration?: boolean;
  }) => void;
  timeOfDay?: { cycle: string; hour: number; environment?: string };
}

// Status effect on a token (e.g., Rage, Bardic Inspiration)
export interface StatusEffect {
  id: string;           // Unique identifier (e.g., "rage", "bardic_inspiration")
  name: string;         // Display name (e.g., "狂暴", "激励")
  icon: string;         // Emoji icon (e.g., "🔥")
  color: string;        // Effect color (e.g., "#ef4444")
  description?: string;
  duration?: number;    // Remaining rounds (undefined = permanent until manually removed)
  maxDuration?: number; // Maximum duration in rounds (e.g., 10 for Rage)
  armed?: boolean;      // Whether a reaction is armed/ready to trigger
  uses_remaining?: number; // Remaining uses per round (for reactions)
  illumination?: IlluminationData | null;  // Light/darkness effect from spell buff
  tokenFilter?: TokenFilterVisual | null;
  area_effect?: SpellAreaEffect | null;  // Persistent area effect for non-concentration zone spells (e.g., Grease)
  spell_buff?: boolean;
  spell_id?: string;
  from_caster?: string;
  is_concentration?: boolean;
  malleable?: boolean;  // Malleable Illusions: can reshape this spell's illusion
  // Control effect fields (from spell casting)
  ongoing_save?: { timing: string; save_type: string; dc: number } | null;
  escape_action?: { type: string; ability: string; dc: number } | null;
  break_conditions?: string[] | null;
  spell_save_dc?: number | null;
  source_token_id?: number | null;
  condition?: string | null;
  aura_emitter?: boolean;
  aura_status?: boolean;
  aura_applied?: boolean;
  runtime_display_only?: boolean;
  runtime_instance_id?: number | null;
  expires_at?: {
    day?: number | null;
    hour?: number | null;
    minute?: number | null;
    second?: number | null;
  } | null;
}

export interface TokenFilterVisual {
  blur?: number;
  opacity?: number;
  glow?: string;
  glowRadius?: number;
  glowAnimation?: 'pulse';
  overlay?: string;
  saturate?: number;
  brightness?: number;
}

// Aura effect emitted by a token (e.g., Paladin's Aura of Protection)
export interface AuraEffect {
  id: string;              // Unique identifier (e.g., "aura_of_protection")
  radius: number;          // Radius in feet (e.g., 10, 30)
  name?: string;
  description?: string;
  icon?: string;
  color?: string;
  fill_color?: string;
  source_cha_mod?: number; // Source's Charisma modifier (for auras that grant CHA bonus)
  source_effect_id?: string;
  affects_self?: boolean;
  affects_allies?: boolean;
  affects_enemies?: boolean;
  requires_conscious?: boolean;
  applies_conditions?: string[];
  enabled?: boolean;       // Whether the aura is currently active
}

// Aura visual data for rendering (from aura_update WebSocket message)
export interface AuraVisual {
  source_token_id: number;
  aura_id: string;
  aura_name: string;
  radius: number;           // Radius in feet
  color: string;            // Border color (e.g., "#fbbf24")
  fill_color: string;       // Fill color with opacity (e.g., "rgba(251, 191, 36, 0.15)")
  icon: string;             // Emoji icon
  description?: string;
  affected_token_ids: number[];
  source_cha_mod?: number;
  source_effect_id?: string;
  applies_conditions?: string[];
}

// Illumination data from spell JSON (light/darkness effects)
export interface IlluminationData {
  type: "light" | "darkness";
  bright_radius?: number;       // Bright light radius in feet
  dim_radius?: number;          // Dim light additional radius in feet
  darkness_radius?: number;     // Darkness radius in feet (for type=darkness)
  attach_to?: "caster" | "target" | "object" | "point";
  color?: string;               // Color hint (e.g., "blue|green|violet", "custom")
  is_sunlight?: boolean;
  blocks_darkvision?: boolean;
  count?: number;               // Number of light sources (e.g., dancing lights = 4)
  movable?: boolean;
  trigger?: string;             // e.g., "on_hit" — don't render until triggered
}

// Spell area effect for persistent concentration spells (e.g., Fog Cloud, Darkness)
export interface SpellAreaEffect {
  shape: "sphere" | "cone" | "line" | "cube" | "cylinder";
  center_x: number;           // Grid coordinates
  center_y: number;
  origin_x?: number;          // For cone/line spells
  origin_y?: number;
  direction?: number;         // Direction angle for cone/line
  radius: number;             // Radius in feet
  color?: string;             // Color theme (fire, ice, necrotic, etc.)
  map_url: string;            // Map where the effect is active
  illusion_token_id?: number | null;  // Bound illusion token that moves with the area
  playerMovable?: boolean;    // Whether the caster (player) can drag-move this area
  followCaster?: boolean;     // True for self-centered areas that should stay on the caster
}

// Concentration spell data for maintaining spell effects
export interface ConcentrationSpell {
  spell_id: string;
  spell_name: string;
  slot_level: number;
  duration_rounds?: number;
  current_round?: number;
  affected_token_ids?: number[];
  linked_token_ids?: number[];
  selected_option?: string | null;
  con_save_bonus: number;          // Pre-computed CON save bonus
  has_advantage: boolean;          // True if has War Caster feat
  extra_bonus_source?: string;     // e.g., "战斗施法者"
  area_effect?: SpellAreaEffect | null;  // Persistent area effect data
  target_name?: string;            // Target name for single-target concentration spells
  illumination?: IlluminationData | null;  // Light/darkness effect data
  malleable?: boolean;              // Malleable Illusions: can reshape this illusion spell
  expires_at?: {
    day?: number | null;
    hour?: number | null;
    minute?: number | null;
    second?: number | null;
  } | null;
}

export interface SpellRuntimeOverlay {
  runtime_instance_id: number;
  spell_id: string;
  spell_name: string;
  role: 'source' | 'target';
  label: string;
  icon?: string | null;
  color?: string | null;
  target_token_id?: number | null;
  target_name?: string | null;
  selected_option?: string | null;
  selected_option_label?: string | null;
  duration_rounds?: number | null;
  remaining_rounds?: number | null;
  expires_at?: {
    day?: number | null;
    hour?: number | null;
    minute?: number | null;
    second?: number | null;
  } | null;
  status?: string;
}

export interface SpellRuntimeBadge {
  runtime_instance_id: number;
  spell_id: string;
  label: string;
  icon?: string | null;
  color?: string | null;
  duration_rounds?: number | null;
  remaining_rounds?: number | null;
  expires_at?: {
    day?: number | null;
    hour?: number | null;
    minute?: number | null;
    second?: number | null;
  } | null;
}

export interface SpellVisualProjection {
  source?: 'runtime' | 'legacy';
  visual_id: string;
  spell_id?: string | null;
  spell_name: string;
  icon?: string | null;
  color?: string | null;
  source_token_id?: number | null;
  runtime_instance_id?: number | null;
  token_filter?: TokenFilterVisual | null;
  expires_at?: {
    day?: number | null;
    hour?: number | null;
    minute?: number | null;
    second?: number | null;
  } | null;
  duration_rounds?: number | null;
  remaining_rounds?: number | null;
}

export interface GrantedRuntimeAction {
  source: 'runtime' | 'legacy';
  runtime_instance_id: number;
  action_id: string;
  spell_id: string;
  spell_name: string;
  slot_level?: number | null;
  action_type?: string | null;
  action_name: string;
  action_name_en?: string | null;
  icon?: string | null;
  action_kind?: string | null;
  trigger_condition?: string | null;
  requires_target?: boolean;
  description?: string | null;
  source_token_id?: number | null;
  available?: boolean;
}

export interface AttachedRuntimeRef {
  runtime_instance_id: number;
  spell_id: string;
  role: 'source' | 'target';
}

export interface CastingInProgress {
  spell_id: string;
  spell_name: string;
  slot_level: number;
  cast_mode: 'normal' | 'ritual';
  base_casting_time: { value: number; unit: string };
  total_cast_seconds: number;
  started_at_campaign: { day: number; hour: number; minute: number; second: number };
  finish_at_campaign: { day: number; hour: number; minute: number; second: number };
  target_token_ids?: number[];
  selected_option?: string | null;
  material_id?: string | null;
  requires_concentration_during_cast?: boolean;
  breaks_existing_concentration?: boolean;
  started_by_user_id?: string | null;
  freecast?: boolean;
  status?: string;
}

export interface Token {
  id: number;
  campaign_id: number;
  character_id?: number | null;
  monster_instance_id?: number | null;
  item_data?: any | null;  // Item details for item tokens
  item_quantity?: number | null;  // Quantity for item tokens
  shop_id?: number | null; // Shop token support
  chest_id?: number | null; // Chest token support
  loot_bag_data?: LootBagData | null; // Loot bag data for loot bag tokens
  user_id?: string | null;
  map_url: string;
  position_x: number;
  position_y: number;
  token_size?: string;
  character_name?: string | null;
  character_race?: string | null;  // race_id for character tokens
  character_class?: string | null;  // class_id for character tokens
  character_level?: number | null;  // level for character tokens
  monster_name?: string | null;
  monster_name_cn?: string | null;  // Chinese name for monster tokens
  monster_type?: string | null;  // creature type for monster tokens (beast, humanoid, etc.)
  monster_size?: string | null;  // size for monster tokens (Small, Medium, Large, etc.)
  shop_name?: string | null;  // Shop name for shop tokens
  chest_name?: string | null;  // Chest name for chest tokens
  chest_state?: string | null;  // Chest state (locked, unlocked, open, looted)
  avatar?: string | null;  // Small avatar (128x128) for 1x1 display
  avatar_large?: string | null;  // Large avatar (512x512) for 2x2+ display
  instance_name?: string | null;  // Display name (e.g., "地精1", "地精2", "长弓 x5")
  current_hp?: number | null;  // Current HP for this token instance (NULL for items)
  max_hp?: number | null;      // Max HP reference for display and bar color
  temp_hp?: number | null;     // Temporary HP buffer (D&D 5E)
  death_saves?: { successes: number; failures: number; stabilized: boolean } | null;  // Death saving throws
  params?: Record<string, any> | null; // Arbitrary parameter table editable by DM
  active_effects?: StatusEffect[] | null;  // Active status effects (e.g., Rage)
  active_auras?: AuraEffect[] | null;      // Active auras emitted by this token
  faction?: string | null;                 // Faction for combat aura filtering (player, enemy, neutral)
  transformation_data?: TransformationData | null;  // Druid wild shape transformation data
  disguise_data?: DisguiseData | null;     // Disguise/illusion appearance override
  concentration_spell?: ConcentrationSpell | null;  // Active concentration spell with save data
  casting_in_progress?: CastingInProgress | null;   // Active long casting / ritual casting
  spell_overlays?: SpellRuntimeOverlay[] | null;
  spell_badges?: SpellRuntimeBadge[] | null;
  spell_visuals?: SpellVisualProjection[] | null;
  granted_actions_ui?: GrantedRuntimeAction[] | null;
  attached_runtime_refs?: AttachedRuntimeRef[] | null;
  controller_character_id?: number | null;  // Character that controls this companion/summon
  control_type?: string | null;  // companion/familiar/summon/mount
  entity_type?: string | null;  // "monster" or "npc" (from monster_instance)
}

// Transformation data for Wild Shape / Polymorph / Enlarge-Reduce / etc.
export interface TransformationData {
  // Source tracking (universal)
  source?: {
    config_id: string;          // e.g., "wild_shape", "polymorph", "enlarge-reduce"
    source_type: string;        // "class_feature" | "spell"
    spell_id?: string;          // canonical spell id when source_type === "spell"
    spell_name?: string;        // e.g., "变形术"
    caster_id?: number;         // character_id of the caster
    caster_name?: string;       // display name of the caster
  };
  type?: string;                // "full_replace" | "modifier" | "special_form"

  // --- full_replace fields (optional when type is modifier/special_form) ---
  beast_id?: string;            // creature ID, e.g., "brown_bear"
  beast_name?: string;          // e.g., "棕熊"
  beast_name_en?: string;       // e.g., "Brown Bear"
  current_hp?: number;          // Current creature HP
  max_hp?: number;              // Max creature HP
  ac?: number;                  // Creature AC
  speed?: {
    walk?: number;
    swim?: number;
    fly?: number;
    climb?: number;
    burrow?: number;
  };
  ability_scores?: {
    str: number;
    dex: number;
    con: number;
    strMod: number;
    dexMod: number;
    conMod: number;
  };
  actions?: Array<{
    name: string;
    description: string;
    attack_bonus?: number;
    damage?: {
      dice: string;
      bonus?: number;
      type?: string;
    };
  }>;
  special_abilities?: Array<{
    name: string;
    description: string;
  }>;
  retainedStats?: {
    mental?: boolean;
    proficiencies?: boolean;
    classFeatures?: boolean;
  };

  // --- Universal fields ---
  size?: string;                // Effective size (D&D size name, e.g., "大型")
  avatar?: string;              // Avatar URL override
  started_at: string;           // ISO timestamp

  // --- modifier fields (Enlarge/Reduce, Alter Self) ---
  activeMode?: string;          // e.g., "enlarge" or "reduce"
  modifiers?: Array<{
    stat: string;               // e.g., "size", "weapon_damage", "strength_check"
    operation: string;          // e.g., "increase", "add_dice", "advantage"
    value?: string | number;    // e.g., 1, "1d4"
  }>;
  original_size?: string;       // Original D&D size before modifier (e.g., "中型")
}

/** @deprecated Use TransformationData instead. Kept for backward compatibility. */
export type WildShapeData = TransformationData;

// Disguise/illusion appearance override data
export interface DisguiseData {
  spell_id: string;             // e.g., "disguise_self", "seeming"
  spell_name: string;           // e.g., "易容术"
  disguise_avatar: string;      // URL of the disguise appearance image
  description?: string;         // Disguise description text
  caster_character_id?: number; // Character who cast the disguise
  started_at: string;           // ISO timestamp
}

// Loot bag data structure
export interface LootBagData {
  source_monster_id: number;
  source_name: string;
  items: Array<{
    id?: number | string;
    name: string;
    name_cn?: string;
    icon?: string;
    quantity: number;
    category?: string;
  }>;
  currency: {
    cp: number;
    sp: number;
    ep: number;
    gp: number;
    pp: number;
  };
  looted_by?: string[];
}

export interface Ruler {
  id: number;
  campaign_id: string;
  map_url: string;
  start_x: number;
  start_y: number;
  end_x: number;
  end_y: number;
  distance: number;
  color: string;
  ruler_type: "line" | "circle";
}

export interface Drawing {
  id: number;
  type: "ruler" | "circle" | "sketch" | "arrow";
  created_by_user_id: string;
  start_x?: number;
  start_y?: number;
  end_x?: number;
  end_y?: number;
  distance?: number;
  center_x?: number;
  center_y?: number;
  radius?: number;
  points?: Array<{ x: number; y: number }>;
  color: string;
  stroke_color: string;
  fill_color?: string;
  stroke_width: number;
}

export interface TokenSize {
  width: number;
  height: number;
}

export interface Position {
  x: number;
  y: number;
}

export interface FogData {
  mapUrl: string;
  cells: Array<[number, number]>; // [x, y] 网格坐标
}

export interface MapMarker {
  id: number;
  campaign_id: number;
  map_url: string;
  position_x: number;
  position_y: number;
  icon: string;
  label: string;
  color: string;
  description?: string | null;
  visible_to_players: number;
  created_at: string;
  updated_at?: string | null;
}
