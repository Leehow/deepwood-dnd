/**
 * TokenComponent
 * Renders a draggable token on the map canvas with RPG-style visuals
 */

import { memo, useState, useEffect, useMemo, useRef, useCallback } from "react";
import { Group, Rect, Circle, Text, Image as KonvaImage, Line, RegularPolygon } from "react-konva";
import Konva from "konva";
import type { Token } from "./types/TacticalMapTypes";
import { GRID_SIZE, MAP_WIDTH, MAP_HEIGHT } from "./types/TacticalMapTypes";
import { parseTokenSize, dndSizeToTokenSize } from "./utils/mapCalculations";
import {
  buildTokenDisplayStatusEffects,
  getRemainingRoundsFromExpiry,
  isExpiredByWorldTime,
} from "./utils/runtimeSpellBadgeStatusUtils";
import { mergeProjectedTokenVisuals } from "./utils/runtimeSpellVisualUtils";
import { getAssetUrl, hasOSSUrl } from "~/utils/asset-url";
import { getCanvasImageUrl } from "~/utils/canvas-image-url";
import { subscribeAppEvent } from "~/events/appEventBus";
import spellsData from "~/data/rules/spells.json";
/** Format effect duration based on combat state: rounds in combat, real time outside */
function formatEffectDuration(rounds: number, isInCombat: boolean): string {
  if (isInCombat) return `${rounds}轮`;
  const totalSeconds = rounds * 6;
  if (totalSeconds < 60) return `${totalSeconds}秒`;
  const minutes = Math.floor(totalSeconds / 60);
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}时${mins}分` : `${hours}小时`;
  }
  return `${minutes}分钟`;
}

type TokenWorldTime = {
  day?: number | null;
  hour?: number | null;
  minute?: number | null;
  second?: number | null;
  cycle?: string;
  realTimeActive?: boolean;
  environment?: string;
};

function worldTimeToSeconds(time?: TokenWorldTime | null): number | null {
  if (!time) return null;
  return ((((time.day ?? 123) * 24) + (time.hour ?? 0)) * 60 + (time.minute ?? 0)) * 60 + (time.second ?? 0);
}

function formatCastingDuration(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}秒`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds > 0 ? `${minutes}分${seconds}秒` : `${minutes}分钟`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}时${mins}分` : `${hours}小时`;
}

function truncateBadgeLabel(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}

function getEffectDurationValue(
  effect: { duration?: number; name?: string; expires_at?: TokenWorldTime | null; [key: string]: any },
  currentTime?: TokenWorldTime | null,
): number | undefined {
  const remainingFromExpiry = getRemainingRoundsFromExpiry(effect.expires_at, currentTime);
  if (remainingFromExpiry != null) {
    return remainingFromExpiry;
  }
  return (
    effect.duration ??
    effect.duration_rounds ??
    effect.remaining_rounds ??
    effect.roundsRemaining ??
    (effect.name ? DEFAULT_EFFECT_DURATIONS[effect.name] : undefined)
  );
}

// Helper to resolve avatar URL - handles both OSS URLs and local asset paths
function resolveAvatarUrl(url: string | undefined | null): string | null {
  if (!url) return null;
  // If it's a local asset path (starts with /assets/), resolve via getAssetUrl
  if (url.startsWith('/assets/')) {
    return getAssetUrl(url.slice(1)); // Remove leading slash
  }
  return url;
}

function loadFirstValidImage(
  candidates: Array<string | undefined | null>,
  onLoad: (img: HTMLImageElement | null) => void,
) {
  const resolved = candidates
    .map((candidate) => resolveAvatarUrl(candidate))
    .filter((candidate): candidate is string => !!candidate);

  if (resolved.length === 0) {
    onLoad(null);
    return () => {};
  }

  let active = true;
  let currentImg: HTMLImageElement | null = null;

  const tryLoad = (index: number) => {
    if (!active) return;
    if (index >= resolved.length) {
      onLoad(null);
      return;
    }

    const img = new window.Image();
    currentImg = img;
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (active) onLoad(img);
    };
    img.onerror = () => {
      if (active) tryLoad(index + 1);
    };
    img.src = getCanvasImageUrl(resolved[index]) || resolved[index];
  };

  tryLoad(0);

  return () => {
    active = false;
    if (currentImg) {
      currentImg.onload = null;
      currentImg.onerror = null;
    }
  };
}

function getSpellIconCandidates(spellId: string | undefined | null): string[] {
  if (!spellId) return [];

  const candidatePaths = Array.from(new Set([
    spellId,
    spellId.replace(/-/g, "_"),
  ])).map((id) => `assets/spell-icons/${id}.png`);

  const mappedPaths = candidatePaths.filter((path) => hasOSSUrl(path));
  const fallbackPaths = candidatePaths.filter((path) => !hasOSSUrl(path));

  return [...mappedPaths, ...fallbackPaths].map((path) => getAssetUrl(path));
}

const SPELLS = ((spellsData as any).spells || spellsData) as Array<{ id?: string; name?: string; iconPath?: string }>;

function getCastingIconCandidates(casting?: { spell_id?: string | null; spell_name?: string | null } | null): string[] {
  if (!casting) return [];

  const candidates: string[] = [];
  const spellId = casting.spell_id || undefined;
  if (spellId) {
    candidates.push(...getSpellIconCandidates(spellId));
  }

  const matchedSpell = SPELLS.find((spell) =>
    (spellId && spell.id === spellId)
    || (casting.spell_name && spell.name === casting.spell_name)
  );

  const iconPath = matchedSpell?.iconPath;
  if (iconPath) {
    candidates.unshift(resolveAvatarUrl(iconPath) || getAssetUrl(iconPath.replace(/^\//, "")));
  }

  return Array.from(new Set(candidates.filter(Boolean)));
}

function getStatusEffectIconCandidates(effect: {
  id?: string;
  icon_path?: string;
  iconPath?: string;
  spell_id?: string;
  spellId?: string;
  sourceSpell?: string;
  source_spell?: string;
  condition?: string | null;
}): string[] {
  const candidates: Array<string | null> = [];
  const iconPath = effect.icon_path || effect.iconPath;

  if (iconPath) {
    candidates.push(resolveAvatarUrl(iconPath));
  }

  const spellId = effect.spell_id || effect.spellId || effect.sourceSpell || effect.source_spell;
  candidates.push(...getSpellIconCandidates(spellId));

  if (effect.condition) {
    candidates.push(getAssetUrl(`assets/condition-icons/${effect.condition}.png`));
  }

  if (effect.id) {
    candidates.push(getAssetUrl(`assets/class-feature-icons/${effect.id}.png`));
  }

  return Array.from(new Set(candidates.filter((value): value is string => Boolean(value))));
}

// 种族ID到中文名映射
const RACE_NAMES: Record<string, string> = {
  dwarf: "矮人", elf: "精灵", halfling: "半身人", human: "人类",
  dragonborn: "龙裔", gnome: "侏儒", "half-elf": "半精灵", "half-orc": "半兽人",
  half_elf: "半精灵", half_orc: "半兽人",  // 支持下划线格式
  tiefling: "提夫林", aasimar: "阿斯莫", goliath: "歌利亚", firbolg: "弗伯格",
  tabaxi: "狸猫人", kenku: "鸦人", lizardfolk: "蜥蜴人", triton: "海族",
  bugbear: "熊地精", goblin: "地精", hobgoblin: "大地精", kobold: "狗头人",
  orc: "兽人", yuan_ti: "蛇人", tortle: "陆龟人", changeling: "易形者",
  kalashtar: "卡拉什塔", shifter: "兽化人", warforged: "战铸",
};
// 职业ID到中文名映射
const CLASS_NAMES: Record<string, string> = {
  barbarian: "野蛮人", bard: "吟游诗人", cleric: "牧师", druid: "德鲁伊",
  fighter: "战士", monk: "武僧", paladin: "圣武士", ranger: "游侠",
  rogue: "游荡者", sorcerer: "术士", warlock: "邪术师", wizard: "法师",
  artificer: "奇械师", bloodhunter: "血猎人",
};

// Default durations for status effects (in combat rounds)
const DEFAULT_EFFECT_DURATIONS: Record<string, number> = {
  '狂暴': 10,
  'Rage': 10,
  '激励': 10,
  'Bardic Inspiration': 10,
};

interface TokenComponentProps {
  token: Token;
  isDM: boolean;
  userId?: string;
  onDragEnd: (tokenId: number, e: any) => void;
  onClick?: (tokenId: number) => void;
  onSelect?: (tokenId: number) => void;  // RTS-style selection (DM only)
  isSelected?: boolean;  // Whether this token is selected
  isActiveTurn?: boolean;  // Whether this token is currently acting in combat
  statusEffects?: Array<{ id: string; name: string; icon: string; color: string; duration?: number; maxDuration?: number; ongoing_save?: any; [key: string]: any }>;  // Active status effects (e.g., rage)
  pendingManeuver?: { maneuver: { id: string; name: string; timing?: string }; targetTokenId?: number } | null;  // Battle Master pending maneuver
  onConcentrationSpellClick?: (spellName: string) => void;  // Click to view concentration spell detail
  onCastingSpellClick?: (spellName: string) => void;
  onCastingModeInfoClick?: (tokenId: number) => void;
  onConcentrationInfoClick?: () => void;  // Click "专注" label to show concentration rules
  onConcentrationDurationChange?: (tokenId: number, delta: number) => void;  // DM +/- rounds
  onConcentrationDurationEdit?: (tokenId: number, currentRemaining: number) => void;  // DM click to edit
  onConcentrationBreak?: (tokenId: number) => void;  // DM break concentration
  onCastingCancel?: (tokenId: number) => void;
  onCastingCompleteNow?: (tokenId: number) => void;
  onStatusEffectClick?: (effect: { id: string; name: string; icon: string; color: string; duration?: number; spell_buff?: boolean; spell_id?: string; from_caster?: string; [key: string]: any }) => void;
  onStatusEffectRemove?: (tokenId: number, effect: { id: string; [key: string]: any }) => void;
  onOngoingSave?: (tokenId: number, effectId: string) => void;
  onConditionSave?: (tokenId: number, effectId: string) => void;
  onEscapeAttempt?: (tokenId: number, effectId: string) => void;
  onStandUp?: (tokenId: number, effectId: string) => void;
  isInCombat?: boolean;  // Whether combat is currently active (affects duration display format)
  selectedTool?: string;
  tokenMode?: "place" | "delete";
  disableDrag?: boolean;  // Disable dragging (e.g., when modal is open)
  targetingMode?: boolean;  // When true, single-click always fires onSelect (for hotbar targeting)
  targetedColor?: string | null;  // Glow color when targeted by a spell
  onMouseEnter?: (tokenId: number) => void;
  onMouseLeave?: (tokenId: number) => void;
  currentTime?: TokenWorldTime | null;
}

export const TokenComponent = memo(function TokenComponent({ token, isDM, userId, onDragEnd, onClick, onSelect, isSelected, isActiveTurn, statusEffects = [], pendingManeuver, onConcentrationSpellClick, onCastingSpellClick, onCastingModeInfoClick, onConcentrationInfoClick, onConcentrationDurationChange, onConcentrationDurationEdit, onConcentrationBreak, onCastingCancel, onCastingCompleteNow, onStatusEffectClick, onStatusEffectRemove, onOngoingSave, onConditionSave, onEscapeAttempt, onStandUp, isInCombat = false, selectedTool, tokenMode = "place", disableDrag = false, targetingMode = false, targetedColor = null, onMouseEnter, onMouseLeave, currentTime = null }: TokenComponentProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [avatarImg, setAvatarImg] = useState<HTMLImageElement | null>(null);
  const [originalAvatarImg, setOriginalAvatarImg] = useState<HTMLImageElement | null>(null);
  const [isEffectsExpanded, setIsEffectsExpanded] = useState(false);
  const [isConcentrationExpanded, setIsConcentrationExpanded] = useState(false);
  const [isCastingExpanded, setIsCastingExpanded] = useState(false);
  const [castingIconImg, setCastingIconImg] = useState<HTMLImageElement | null>(null);
  const rootGroupRef = useRef<Konva.Group>(null);
  const effectsGroupRef = useRef<Konva.Group>(null);

  // Refs for Konva blur filter on avatar images
  const avatarMultiRef = useRef<Konva.Image>(null);
  const avatarSingleRef = useRef<Konva.Image>(null);

  // Preload status effect icon images
  // Priority: icon_path > spell icon by spell_id > class feature icon by effect id
  // Helper: check ongoing_save from both snake_case and camelCase (backend may send either)
  const hasOngoingSave = (e: any) => e.ongoing_save || e.ongoingSave;
  const effectIconImagesRef = useRef<Record<string, HTMLImageElement | null>>({});
  const [effectIconVer, setEffectIconVer] = useState(0);
  // Read ref on each render; effectIconVer ensures re-render when images load
  const effectIconImages = effectIconVer >= 0 ? effectIconImagesRef.current : {};
  const displayStatusEffects = useMemo(
    () =>
      buildTokenDisplayStatusEffects({
        activeEffects: statusEffects,
        spellBadges: token.spell_badges,
        spellOverlays: token.spell_overlays,
        currentWorldTime: currentTime,
      }),
    [currentTime, statusEffects, token.spell_badges, token.spell_overlays],
  );
  // Stable dep key: only re-run when the set of effect IDs changes
  const effectIdsKey = useMemo(
    () => displayStatusEffects.map((effect) => effect.id).join(","),
    [displayStatusEffects],
  );
  useEffect(() => {
    if (displayStatusEffects.length === 0) return;
    let changed = false;
    for (const effect of displayStatusEffects) {
      const key = effect.id;
      if (!key || key in effectIconImagesRef.current) continue;
      const iconUrls = getStatusEffectIconCandidates(effect);
      if (iconUrls.length === 0) continue;
      // Mark as loading (null sentinel to avoid duplicate loads)
      effectIconImagesRef.current[key] = null;
      const img = new window.Image();
      img.crossOrigin = 'anonymous';
      let candidateIndex = 0;

      const loadCandidate = () => {
        const iconUrl = iconUrls[candidateIndex];
        img.src = getCanvasImageUrl(iconUrl) || iconUrl;
      };

      img.onload = () => {
        effectIconImagesRef.current[key] = img;
        setEffectIconVer(v => v + 1);
      };
      img.onerror = () => {
        candidateIndex += 1;
        if (candidateIndex < iconUrls.length) {
          loadCandidate();
          return;
        }
        delete effectIconImagesRef.current[key]; // allow retry if effects change
      };
      // Route temporary signed images through the backend proxy so Konva can paint them safely.
      loadCandidate();
      changed = true;
    }
    if (changed) setEffectIconVer(v => v + 1);
  }, [effectIdsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!token.casting_in_progress) {
      setCastingIconImg(null);
      setIsCastingExpanded(false);
      return;
    }

    let cancelled = false;
    const iconUrls = getCastingIconCandidates(token.casting_in_progress);
    if (iconUrls.length === 0) {
      setCastingIconImg(null);
      return;
    }

    const img = new window.Image();
    img.crossOrigin = "anonymous";
    let candidateIndex = 0;

    const loadCandidate = () => {
      const iconUrl = iconUrls[candidateIndex];
      img.src = getCanvasImageUrl(iconUrl) || iconUrl;
    };

    img.onload = () => {
      if (!cancelled) setCastingIconImg(img);
    };
    img.onerror = () => {
      candidateIndex += 1;
      if (candidateIndex < iconUrls.length) {
        loadCandidate();
        return;
      }
      if (!cancelled) setCastingIconImg(null);
    };

    loadCandidate();
    return () => {
      cancelled = true;
    };
  }, [token.casting_in_progress?.spell_id, token.casting_in_progress?.spell_name]);

  // Re-render key that increments when combat turn state changes (for window globals reactivity)
  const [combatTurnKey, setCombatTurnKey] = useState(0);
  useEffect(() => {
    const bump = () => setCombatTurnKey(k => k + 1);
    const unsubscribeTurnChanged = subscribeAppEvent("combatTurnChanged", bump);
    const unsubscribeActionUsed = subscribeAppEvent("combatActionUsed", bump);
    return () => {
      unsubscribeTurnChanged();
      unsubscribeActionUsed();
    };
  }, []);

  // Transformation state check - must be before tokenSize calculation
  const isTransformed = !!token.transformation_data;
  const transformData = token.transformation_data;

  // Disguise/illusion state check
  const isDisguised = !!token.disguise_data;
  const disguiseData = token.disguise_data;
  // Only DM and token owner can see disguise indicators (purple border + original avatar mini-circle)
  // Other players see the disguised appearance as if it were real
  const canSeeDisguise = isDisguised && (isDM || (userId != null && token.user_id === userId));

  // Invisibility: check if token has any effect with "invisible" condition
  const isInvisible = useMemo(() => {
    return statusEffects.some((e: any) =>
      e.condition === 'invisible' || e.id === 'invisible' ||
      (e.conditions && e.conditions.includes('invisible'))
    );
  }, [statusEffects]);
  // Only DM and token owner can see invisible tokens (at reduced opacity)
  const canSeeInvisible = isInvisible && (isDM || (userId != null && token.user_id === userId));

  // 解析token尺寸，决定使用哪个头像
  // When transformed, use the transformation's effective size
  const effectiveTokenSize = isTransformed && transformData?.size
    ? dndSizeToTokenSize(transformData.size)
    : token.token_size;
  const tokenSize = parseTokenSize(effectiveTokenSize);
  const isMultiGrid = tokenSize.width > 1 || tokenSize.height > 1;

  // 加载头像（角色/怪物avatar或物品icon）
  // Priority: disguise > wild shape > normal avatar
  useEffect(() => {
    let avatarCandidates: Array<string | undefined | null>;

    if (isDisguised && disguiseData?.disguise_avatar) {
      // Use disguise avatar when disguised
      avatarCandidates = [disguiseData.disguise_avatar];
    } else if (isTransformed && transformData?.avatar) {
      // Use beast avatar when in wild shape
      avatarCandidates = [transformData.avatar];
    } else {
      avatarCandidates = isMultiGrid
        ? [token.avatar_large, token.avatar]  // 2x2+先尝试大图，失败回退小图
        : [token.avatar];  // 1x1用小图
    }
    return loadFirstValidImage(
      [...avatarCandidates, (token.item_data as any)?.icon],
      setAvatarImg,
    );
  }, [token.avatar, token.avatar_large, (token.item_data as any)?.icon, isMultiGrid, isTransformed, transformData?.avatar, isDisguised, disguiseData?.disguise_avatar]);

  // Load original avatar as mini-circle when disguised
  useEffect(() => {
    if (!canSeeDisguise) { setOriginalAvatarImg(null); return; }
    return loadFirstValidImage(
      isMultiGrid ? [token.avatar_large, token.avatar] : [token.avatar],
      setOriginalAvatarImg,
    );
  }, [canSeeDisguise, token.avatar, token.avatar_large, isMultiGrid]);

  // For sub-grid tokens (tiny/small), visual size shrinks but layout stays 1x1
  const layoutWidth = Math.max(tokenSize.width, 1) * GRID_SIZE;
  const layoutHeight = Math.max(tokenSize.height, 1) * GRID_SIZE;
  const tokenWidth = isMultiGrid ? layoutWidth : GRID_SIZE;
  const tokenHeight = isMultiGrid ? layoutHeight : GRID_SIZE;

  // Token 左上角位置（position_x/y 是左上角格子坐标）
  const x = token.position_x * GRID_SIZE;
  const y = token.position_y * GRID_SIZE;

  // 对于单格token，头像圆形大小跟随实际体型，但UI布局保持1x1
  const avatarScale = Math.min(tokenSize.width, tokenSize.height, 1);
  const avatarRadius = Math.max((GRID_SIZE * avatarScale / 2) - 2, 6);
  const radius = GRID_SIZE / 2 - 4;  // UI layout radius, always 1x1
  const centerX = GRID_SIZE / 2;
  const centerY = GRID_SIZE / 2;

  // 拖动时吸附到网格（左上角对齐）
  const dragBoundFunc = (pos: any) => {
    const gridX = Math.round(pos.x / GRID_SIZE) * GRID_SIZE;
    const gridY = Math.round(pos.y / GRID_SIZE) * GRID_SIZE;
    const maxX = (MAP_WIDTH - tokenSize.width) * GRID_SIZE;
    const maxY = (MAP_HEIGHT - tokenSize.height) * GRID_SIZE;
    return {
      x: Math.max(0, Math.min(gridX, maxX)),
      y: Math.max(0, Math.min(gridY, maxY))
    };
  };

  // Check if this is an item token
  const isItemToken = !!token.item_data;
  // Check if this is an illusion token
  const isIllusionToken = isItemToken && (token.item_data as any)?.type === 'illusion';
  // Check if this is a loot bag token
  const isLootBagToken = !!token.loot_bag_data;
  // Check if this is a chest token
  const isChestToken = !!token.chest_id;
  const itemName = isItemToken ? (token.item_data as any)?.name : null;
  const itemQuantity = isItemToken ? (token.item_quantity || 1) : 1;

  // Combat-aware drag permission
  const canDrag = useMemo(() => {
    // DM can always drag any token
    if (isDM) return true;
    // Must own the token
    if (!userId || token.user_id !== userId) return false;
    // Outside combat: normal drag
    const combatIsActive = (window as any).__combatIsActive;
    if (!combatIsActive) return true;
    // Not a combat participant: normal drag (non-combatants are not restricted)
    const participantTokenIds: number[] = (window as any).__combatParticipantTokenIds ?? [];
    if (!participantTokenIds.includes(token.id)) return true;
    // In combat as participant: must be your turn
    const turnUserId = (window as any).__combatTurnUserId;
    if (turnUserId !== userId) return false;
    // Must be the active token
    const activeTokenId = (window as any).__combatActiveTokenId;
    if (activeTokenId !== token.id) return false;
    // Must have movement remaining
    const movementRemaining = (window as any).__combatMovementRemaining ?? 0;
    if (movementRemaining <= 0) return false;
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDM, userId, token.user_id, token.id, combatTurnKey]);
  // Use instance_name if available, otherwise fall back to character/monster/item/chest name
  // For monsters, prefer Chinese name (monster_name_cn) over English name (monster_name)
  const monsterDisplayName = token.monster_name_cn || token.monster_name;
  const lootBagName = isLootBagToken ? (token.loot_bag_data as any)?.source_name : null;
  const chestName = isChestToken ? token.chest_name : null;
  const baseName = token.instance_name || token.character_name || monsterDisplayName || itemName || lootBagName || chestName || "未命名";
  const displayName = isItemToken && itemQuantity > 1 ? `${baseName} ×${itemQuantity}` : baseName;

  // Token类型判断
  const isCharacterToken = !!token.character_id;
  const isMonsterToken = !!token.monster_instance_id;
  const isNpcToken = token.entity_type === 'npc';
  const isCompanionToken = !!token.control_type;  // companion/familiar/summon/mount

  // 副标题文本：玩家视角显示种族，DM 视角不显示这条副标题
  const subtitleText = useMemo(() => {
    if (!isCharacterToken || isDM) return null;

    const raceName = token.character_race ? (RACE_NAMES[token.character_race] || token.character_race) : null;
    return raceName || null;
  }, [isCharacterToken, token.character_race, token.character_class, token.character_level, isDM]);

  // 计算名称标签的宽度（根据字符数量）
  const nameWidth = Math.max(displayName.length * 8, 60);
  // 副标题宽度
  const subtitleWidth = subtitleText
    ? Math.max(subtitleText.length * 11, 40)
    : 0;
  // 副标题背景色：角色蓝色
  const subtitleBgColor = "rgba(59, 130, 246, 0.85)";
  const nameHeight = 20;

  // HP display (if available, not for items or loot bags)
  // 怪物HP只对DM可见，玩家角色HP对所有人可见
  // When in full_replace transformation, use beast HP; modifier type uses normal HP
  const isFullReplace = isTransformed && transformData?.type !== 'modifier';
  const hasHP = !isItemToken && !isLootBagToken && (
    isFullReplace
      ? (transformData?.current_hp !== null && transformData?.current_hp !== undefined)
      : (token.current_hp !== null && token.current_hp !== undefined)
  );
  const canSeeHP = hasHP && (isDM || !isMonsterToken || isCompanionToken);
  const currentHP = canSeeHP ? Number(isFullReplace ? transformData?.current_hp : token.current_hp) : null;
  const maxHP = canSeeHP ? Number(isFullReplace ? transformData?.max_hp : ((token as any).max_hp ?? (token as any).character_max_hp ?? 0)) : null;
  const tempHP = canSeeHP && token.temp_hp ? Number(token.temp_hp) : null;
  const hpText = canSeeHP && currentHP !== null && maxHP !== null
    ? `HP: ${currentHP}/${maxHP}${tempHP ? `+${tempHP}` : ''}`
    : canSeeHP ? `HP: ${currentHP}${tempHP ? `+${tempHP}` : ''}` : null;
  const hpColor = (() => {
    if (!canSeeHP || currentHP === null || !maxHP || maxHP <= 0) return "rgba(220, 38, 38, 0.9)";
    const percent = (currentHP / maxHP) * 100;
    if (percent > 70) return "rgba(34, 197, 94, 0.9)";     // green-500
    if (percent > 30) return "rgba(234, 179, 8, 0.9)";     // yellow-500
    return "rgba(220, 38, 38, 0.9)";                        // red-600
  })();

  // 判断是否死亡 (HP <= 0)
  // 物品token、loot bag、宝箱不参与死亡判断
  const isDead = !isItemToken && !isLootBagToken && !isChestToken &&
    token.current_hp !== null &&
    token.current_hp !== undefined &&
    Number(token.current_hp) <= 0;

  // 是否处于删除模式
  const isDeleteMode = isDM && selectedTool === "token" && tokenMode === "delete";

  // 获取token边框色（根据类型）
  // Illusion: purple glow, Chest: bright gold, LootBag: gold, Item: orange, Companion: green, NPC: teal, Monster: red, Character: blue
  const borderColor = isIllusionToken ? "#a855f7" : (isChestToken ? "#fbbf24" : (isLootBagToken ? "#d97706" : (isItemToken ? "#b45309" : (isCompanionToken ? "#15803d" : (isNpcToken ? "#0e7490" : (isMonsterToken ? "#991b1b" : "#1d4ed8"))))));
  const fillColor = isIllusionToken ? "#7c3aed" : (isChestToken ? "#f59e0b" : (isLootBagToken ? "#fbbf24" : (isItemToken ? "#f59e0b" : (isCompanionToken ? "#22c55e" : (isNpcToken ? "#06b6d4" : (isMonsterToken ? "#dc2626" : "#3b82f6"))))));
  // 宝箱token边框加粗
  const borderWidth = isChestToken ? 3 : 2;

  const mergedTokenFilter = useMemo(() => {
    return mergeProjectedTokenVisuals(token.spell_visuals, currentTime, token.active_effects as any);
  }, [currentTime, token.spell_visuals, token.active_effects]);
  const runtimeOverlays = token.spell_overlays || [];
  const visibleRuntimeOverlays = useMemo(
    () => runtimeOverlays.filter(
      (overlay) => overlay?.role !== "source" && !isExpiredByWorldTime(overlay?.expires_at, currentTime),
    ),
    [currentTime, runtimeOverlays],
  );
  const canRemoveStatusEffect = useCallback((effect: { runtime_display_only?: boolean; runtime_instance_id?: number | null } | null | undefined) => {
    if (effect?.runtime_instance_id) {
      return true;
    }
    return !effect?.runtime_display_only;
  }, []);

  // Pulse animation for glow effects
  const [glowPulse, setGlowPulse] = useState(0.6);
  useEffect(() => {
    if (!mergedTokenFilter?.glowAnimation) return;
    let frame: number;
    let start: number | null = null;
    const animate = (ts: number) => {
      if (!start) start = ts;
      const elapsed = (ts - start) / 1000;
      setGlowPulse(0.6 + 0.3 * Math.sin(elapsed * Math.PI));
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [mergedTokenFilter?.glowAnimation]);

  // Apply real Konva Blur filter to avatar images
  const blurRadius = mergedTokenFilter?.blur ? mergedTokenFilter.blur * 0.7 : 0;
  const applyBlurToNode = useCallback((node: Konva.Image | null) => {
    if (!node) return;
    if (blurRadius > 0) {
      node.filters([Konva.Filters.Blur]);
      node.blurRadius(blurRadius);
      node.cache();
    } else {
      node.filters([]);
      node.clearCache();
    }
    node.getLayer()?.batchDraw();
  }, [blurRadius]);

  useEffect(() => {
    applyBlurToNode(avatarMultiRef.current);
    applyBlurToNode(avatarSingleRef.current);
  }, [blurRadius, avatarImg, applyBlurToNode]);

  useEffect(() => {
    if (!isEffectsExpanded) return;
    const group = effectsGroupRef.current;
    if (!group) return;
    group.moveToTop();
    group.getLayer()?.batchDraw();
  }, [isEffectsExpanded]);

  useEffect(() => {
    if (!isEffectsExpanded && !isConcentrationExpanded && !isCastingExpanded) return;
    const group = rootGroupRef.current;
    if (!group) return;
    group.moveToTop();
    group.getLayer()?.batchDraw();
  }, [isEffectsExpanded, isConcentrationExpanded, isCastingExpanded]);

  // Defensive check: ensure token is a valid object (after all hooks)
  if (!token || typeof token !== 'object' || !token.id) {
    return null;
  }

  // Invisible tokens are completely hidden from other players
  if (isInvisible && !canSeeInvisible) {
    return null;
  }

  // For DM/owner: invisible tokens show at 0.4 opacity (clearly visible but ghostly)
  const effectiveOpacity = isIllusionToken ? 0.6
    : isInvisible && canSeeInvisible ? 0.55
    : (mergedTokenFilter?.opacity ?? 1);

  return (
    <Group
      ref={rootGroupRef}
      x={x}
      y={y}
      opacity={effectiveOpacity}
      draggable={!!canDrag && !isDeleteMode && !disableDrag}
      dragBoundFunc={dragBoundFunc}
      onDragStart={(e) => {
        if (e.evt.button === 1) {
          e.target.stopDrag();
          return;
        }
        setIsDragging(true);
        e.cancelBubble = true;
      }}
      onDragEnd={(e: any) => { setIsDragging(false); onDragEnd(token.id, e); e.cancelBubble = true; }}
      onDragMove={(e) => { e.cancelBubble = true; }}
      onClick={(e) => {
        e.cancelBubble = true;
        // Only respond to left-click (button 0), ignore right-click
        if (e.evt && e.evt.button !== 0) return;
        if (targetingMode && onSelect) {
          onSelect(token.id);
        } else if (isDeleteMode && onClick) {
          onClick(token.id);
        } else if (isDM && onSelect) {
          // Only DM can select tokens
          onSelect(token.id);
        }
      }}
      onDblClick={() => { if (!isDeleteMode && onClick) onClick(token.id); }}
      onTap={(e) => {
        e.cancelBubble = true;
        if (targetingMode && onSelect) {
          onSelect(token.id);
        } else if (isDeleteMode && onClick) {
          onClick(token.id);
        } else if (isDM && onSelect) {
          onSelect(token.id);
        }
      }}
      onDblTap={() => { if (!isDeleteMode && onClick) onClick(token.id); }}
      onMouseEnter={onMouseEnter ? () => onMouseEnter(token.id) : undefined}
      onMouseLeave={onMouseLeave ? () => onMouseLeave(token.id) : undefined}
    >
      {isMultiGrid ? (
        // 多格子token - 矩形样式
        <>
          {/* Invisible hit region to ensure clicks are detected on the full token area */}
          <Rect
            x={0}
            y={0}
            width={tokenWidth}
            height={tokenHeight}
            fill="transparent"
          />
          {/* HP条 - 顶部细长条，临时HP作为附加延伸 */}
          {canSeeHP && currentHP !== null && maxHP && maxHP > 0 && (() => {
            const barW = tokenWidth - 8;
            const effectiveTempHP = (tempHP != null && tempHP > 0) ? tempHP : 0;
            const totalPool = maxHP + effectiveTempHP;
            const hpW = Math.min(barW, Math.max(0, (currentHP / totalPool) * barW));
            const tempW = Math.max(0, Math.min((effectiveTempHP / totalPool) * barW, barW - hpW));
            return (
              <Group x={4} y={-2} listening={false}>
                {/* 背景 */}
                <Rect x={0} y={0} width={barW} height={4}
                  fill="rgba(0, 0, 0, 0.6)" cornerRadius={2} />
                {/* HP填充 */}
                <Rect x={0} y={0} width={Math.min(hpW, barW)} height={4}
                  fill={hpColor} cornerRadius={2} />
                {/* 临时HP填充（金色，紧接HP之后） */}
                {effectiveTempHP > 0 && (
                  <Rect x={hpW} y={0}
                    width={tempW} height={4}
                    fill="rgba(59, 130, 246, 0.9)" cornerRadius={2} />
                )}
              </Group>
            );
          })()}
          {/* 战斗行动回合指示器 - 四角箭头+光晕 */}
          {isActiveTurn && (
            <Group listening={false}>
              {/* 柔和外层光晕 */}
              <Rect
                x={-8}
                y={-8}
                width={tokenWidth + 16}
                height={tokenHeight + 16}
                cornerRadius={14}
                fill="transparent"
                shadowColor="#4ade80"
                shadowBlur={8}
                shadowOpacity={0.5}
              />
              {/* 四角指示箭头 */}
              {/* 左上 */}
              <RegularPolygon
                x={-2}
                y={-2}
                sides={3}
                radius={8}
                rotation={135}
                fill="#4ade80"
              />
              {/* 右上 */}
              <RegularPolygon
                x={tokenWidth + 2}
                y={-2}
                sides={3}
                radius={8}
                rotation={-135}
                fill="#4ade80"
              />
              {/* 左下 */}
              <RegularPolygon
                x={-2}
                y={tokenHeight + 2}
                sides={3}
                radius={8}
                rotation={45}
                fill="#4ade80"
              />
              {/* 右下 */}
              <RegularPolygon
                x={tokenWidth + 2}
                y={tokenHeight + 2}
                sides={3}
                radius={8}
                rotation={-45}
                fill="#4ade80"
              />
              {/* 角落连接线 */}
              <Line points={[-6, 8, -6, -6, 8, -6]} stroke="#4ade80" strokeWidth={2} lineCap="round" />
              <Line points={[tokenWidth - 8, -6, tokenWidth + 6, -6, tokenWidth + 6, 8]} stroke="#4ade80" strokeWidth={2} lineCap="round" />
              <Line points={[-6, tokenHeight - 8, -6, tokenHeight + 6, 8, tokenHeight + 6]} stroke="#4ade80" strokeWidth={2} lineCap="round" />
              <Line points={[tokenWidth - 8, tokenHeight + 6, tokenWidth + 6, tokenHeight + 6, tokenWidth + 6, tokenHeight - 8]} stroke="#4ade80" strokeWidth={2} lineCap="round" />
            </Group>
          )}
          {/* 选中光环 (RTS selection) */}
          {isSelected && (
            <Rect
              x={0}
              y={0}
              width={tokenWidth}
              height={tokenHeight}
              stroke="#fbbf24"
              strokeWidth={3}
              dash={[10, 5]}
              cornerRadius={10}
              shadowColor="#fbbf24"
              shadowBlur={6}
              shadowOpacity={0.6}
              listening={false}
            />
          )}
          {/* 法术瞄准发光框 */}
          {targetedColor && (
            <Rect
              x={-3}
              y={-3}
              width={tokenWidth + 6}
              height={tokenHeight + 6}
              stroke={targetedColor}
              strokeWidth={2.5}
              cornerRadius={12}
              shadowColor={targetedColor}
              shadowBlur={6}
              shadowOpacity={0.8}
              listening={false}
            />
          )}
          {/* Wild Shape glow - 绿色光晕 */}
          {isTransformed && (
            <Rect
              x={0}
              y={0}
              width={tokenWidth}
              height={tokenHeight}
              stroke="#22c55e"
              strokeWidth={3}
              cornerRadius={10}
              shadowColor="#22c55e"
              shadowBlur={6}
              shadowOpacity={0.7}
              listening={false}
            />
          )}
          {/* Transformation badge - 显示变化形态名称 (only for full_replace like wild shape) */}
          {isTransformed && transformData && transformData.type !== 'modifier' && (
            <Group x={tokenWidth - 4} y={-12} listening={false}>
              <Rect
                x={-60}
                y={0}
                width={64}
                height={20}
                fill="#1f2937"
                stroke="#22c55e"
                strokeWidth={2}
                cornerRadius={4}
              />
              <Text
                x={-58}
                y={3}
                width={60}
                height={14}
                text={`🐺${transformData.beast_name || ''}`}
                fontSize={10}
                fontStyle="bold"
                fill="#22c55e"
                align="left"
                verticalAlign="middle"
              />
            </Group>
          )}
          {/* Pending maneuver badge (bottom-left corner) - Battle Master */}
          {pendingManeuver && (
            <Group x={-4} y={tokenHeight - 8} listening={false}>
              <Rect
                x={0}
                y={0}
                width={80}
                height={20}
                fill="#1f2937"
                stroke="#f59e0b"
                strokeWidth={2}
                cornerRadius={4}
                shadowColor="#f59e0b"
                shadowBlur={4}
                shadowOpacity={0.6}
              />
              <Text
                x={4}
                y={2}
                width={72}
                height={16}
                text={`⚔️${pendingManeuver.maneuver.name}`}
                fontSize={10}
                fontStyle="bold"
                fill="#f59e0b"
                align="left"
                verticalAlign="middle"
              />
            </Group>
          )}
          {/* 主背景 */}
          <Rect
            x={4}
            y={4}
            width={tokenWidth - 8}
            height={tokenHeight - 8}
            fill={fillColor}
            cornerRadius={6}
          />
          {/* 头像 */}
          {avatarImg && (
            <KonvaImage
              ref={avatarMultiRef as any}
              x={4}
              y={4}
              width={tokenWidth - 8}
              height={tokenHeight - 8}
              image={avatarImg}
              cornerRadius={6}
            />
          )}
          {/* 法术滤镜叠层 (multi-grid) */}
          {mergedTokenFilter && (
            <>
              {/* 发光环 */}
              {mergedTokenFilter.glow && (
                <Rect x={1} y={1} width={tokenWidth - 2} height={tokenHeight - 2}
                  stroke={mergedTokenFilter.glow} strokeWidth={2} cornerRadius={8}
                  shadowColor={mergedTokenFilter.glow}
                  shadowBlur={mergedTokenFilter.glowRadius ?? 10}
                  shadowOpacity={mergedTokenFilter.glowAnimation ? glowPulse : 0.7}
                  listening={false} />
              )}
              {/* 模糊叠层 */}
              {(mergedTokenFilter.blur ?? 0) > 0 && (
                <Rect x={4} y={4} width={tokenWidth - 8} height={tokenHeight - 8}
                  fill={`rgba(180,210,255,${Math.min((mergedTokenFilter.blur ?? 0) * 0.06, 0.25)})`}
                  cornerRadius={6} listening={false} />
              )}
              {/* 模糊发光边框 */}
              {(mergedTokenFilter.blur ?? 0) > 0 && !mergedTokenFilter.glow && (
                <Rect x={1} y={1} width={tokenWidth - 2} height={tokenHeight - 2}
                  stroke="rgba(150,180,255,0.5)" strokeWidth={1.5} cornerRadius={8}
                  shadowColor="#93c5fd" shadowBlur={6} shadowOpacity={0.4}
                  listening={false} />
              )}
              {/* 去饱和叠层 */}
              {mergedTokenFilter.saturate != null && mergedTokenFilter.saturate < 1 && (
                <Rect x={4} y={4} width={tokenWidth - 8} height={tokenHeight - 8}
                  fill={`rgba(128,128,128,${(1 - mergedTokenFilter.saturate) * 0.5})`}
                  cornerRadius={6} listening={false} />
              )}
              {/* 颜色叠层 */}
              {mergedTokenFilter.overlays.map((color, i) => (
                <Rect key={`tf-ov-${i}`} x={4} y={4} width={tokenWidth - 8} height={tokenHeight - 8}
                  fill={color} cornerRadius={6} listening={false} />
              ))}
              {/* 亮度叠层 */}
              {mergedTokenFilter.brightness != null && mergedTokenFilter.brightness !== 0 && (
                <Rect x={4} y={4} width={tokenWidth - 8} height={tokenHeight - 8}
                  fill={mergedTokenFilter.brightness > 0
                    ? `rgba(255,255,200,${Math.abs(mergedTokenFilter.brightness) * 0.3})`
                    : `rgba(0,0,30,${Math.abs(mergedTokenFilter.brightness) * 0.4})`}
                  cornerRadius={6} listening={false} />
              )}
            </>
          )}
          {/* 死亡遮罩层 */}
          {isDead && (
            <>
              <Rect
                x={4}
                y={4}
                width={tokenWidth - 8}
                height={tokenHeight - 8}
                fill="rgba(0, 0, 0, 0.5)"
                cornerRadius={6}
                listening={false}
              />
              {/* 死亡X标记 */}
              <Line
                points={[12, 12, tokenWidth - 12, tokenHeight - 12]}
                stroke="#dc2626"
                strokeWidth={4}
                lineCap="round"
                listening={false}
              />
              <Line
                points={[tokenWidth - 12, 12, 12, tokenHeight - 12]}
                stroke="#dc2626"
                strokeWidth={4}
                lineCap="round"
                listening={false}
              />
            </>
          )}
          {/* 战利品宝箱滤镜 */}
          {isChestToken && (
            <Rect
              x={4}
              y={4}
              width={tokenWidth - 8}
              height={tokenHeight - 8}
              fill="rgba(180, 120, 40, 0.3)"
              cornerRadius={6}
              listening={false}
            />
          )}
          {/* 边框 */}
          <Rect
            x={4}
            y={4}
            width={tokenWidth - 8}
            height={tokenHeight - 8}
            stroke={isDeleteMode ? "#ff0000" : (isDragging ? "#fbbf24" : borderColor)}
            strokeWidth={isDeleteMode ? 3 : borderWidth}
            dash={isDeleteMode ? [8, 4] : undefined}
            cornerRadius={6}
            shadowColor={isIllusionToken ? "#a855f7" : undefined}
            shadowBlur={isIllusionToken ? 12 : 0}
            shadowOpacity={isIllusionToken ? 0.6 : 0}
          />
          {/* 伪装原始头像小圆形 (多格) */}
          {canSeeDisguise && originalAvatarImg && (
            <Group x={tokenWidth - 16} y={tokenHeight - 16} listening={false}>
              <Group clipFunc={(ctx: any) => { ctx.beginPath(); ctx.arc(0, 0, 9, 0, Math.PI * 2); ctx.closePath(); }}>
                <KonvaImage image={originalAvatarImg} x={-9} y={-9} width={18} height={18} />
              </Group>
            </Group>
          )}
          {token.casting_in_progress && (() => {
            const canCancelCasting = isDM || (userId != null && token.user_id === userId);
            const finishSeconds = worldTimeToSeconds(token.casting_in_progress.finish_at_campaign as any);
            const nowSeconds = worldTimeToSeconds(currentTime as any);
            const isReadyToRelease = token.casting_in_progress.status === 'ready';
            const remainingSeconds = finishSeconds != null && nowSeconds != null
              ? Math.max(0, finishSeconds - nowSeconds)
              : token.casting_in_progress.total_cast_seconds;
            const durationStr = isReadyToRelease ? '待释放' : `${formatCastingDuration(remainingSeconds)}后可施法`;
            const modeLabel = token.casting_in_progress.cast_mode === 'ritual' ? '仪式' : '施法中';
            const canTriggerRelease = isReadyToRelease ? canCancelCasting : isDM;
            const spellName = token.casting_in_progress.spell_name;
            const nameText = spellName || '长时间施法';
            const nameWidth = nameText.length * 8 + 4;
            const durWidth = durationStr.length * 7 + 6;
            const totalWidth = Math.max(nameWidth + durWidth + (canTriggerRelease ? 56 : 0) + (canCancelCasting ? 30 : 0) + 72, 126);
            return isCastingExpanded ? (
              <Group x={0} y={-24} listening>
                <Rect x={0} y={0} width={totalWidth} height={22} fill="#1f2937" stroke="#f59e0b" strokeWidth={2} cornerRadius={4} shadowColor="#f59e0b" shadowBlur={3} shadowOpacity={0.5} />
                <Group
                  x={2}
                  y={2}
                  onClick={(e) => { e.cancelBubble = true; setIsCastingExpanded(false); }}
                  onTap={(e) => { e.cancelBubble = true; setIsCastingExpanded(false); }}
                >
                  <Rect x={0} y={0} width={22} height={18} fill="#374151" cornerRadius={3} />
                  <Text x={0} y={0} width={22} height={18} text="收" fontSize={8} fontStyle="bold" fill="#fff" align="center" verticalAlign="middle" />
                </Group>
                <Group
                  x={26}
                  y={2}
                  listening={token.casting_in_progress.cast_mode === 'ritual' && !!onCastingModeInfoClick}
                  onClick={token.casting_in_progress.cast_mode === 'ritual' ? (e) => {
                    e.cancelBubble = true;
                    onCastingModeInfoClick?.(token.id);
                  } : undefined}
                  onTap={token.casting_in_progress.cast_mode === 'ritual' ? (e) => {
                    e.cancelBubble = true;
                    onCastingModeInfoClick?.(token.id);
                  } : undefined}
                >
                  <Rect x={0} y={0} width={30} height={18} fill="#b45309" cornerRadius={3} />
                  <Text x={0} y={0} width={30} height={18} text={modeLabel} fontSize={8} fontStyle="bold" fill="#fff" align="center" verticalAlign="middle" />
                </Group>
                <Text
                  x={58}
                  y={4}
                  width={nameWidth}
                  height={14}
                  text={nameText}
                  fontSize={10}
                  fontStyle="bold"
                  fill="#fbbf24"
                  listening={!!onCastingSpellClick}
                  onClick={(e) => {
                    if (!spellName || !onCastingSpellClick) return;
                    e.cancelBubble = true;
                    onCastingSpellClick(spellName);
                  }}
                  onTap={(e) => {
                    if (!spellName || !onCastingSpellClick) return;
                    e.cancelBubble = true;
                    onCastingSpellClick(spellName);
                  }}
                />
                <Text x={58 + nameWidth} y={4} width={durWidth} height={14} text={durationStr} fontSize={10} fontStyle="bold" fill="#fde68a" />
                {canTriggerRelease && (
                  <Group x={totalWidth - (canCancelCasting ? 70 : 40)} y={2} onClick={(e) => { e.cancelBubble = true; onCastingCompleteNow?.(token.id); }} onTap={(e) => { e.cancelBubble = true; onCastingCompleteNow?.(token.id); }}>
                    <Rect x={0} y={0} width={38} height={16} fill="#92400e" cornerRadius={3} />
                    <Text x={0} y={0} width={38} height={16} text={isReadyToRelease ? "释放" : "完成"} fontSize={8} fill="#fff" align="center" verticalAlign="middle" />
                  </Group>
                )}
                {canCancelCasting && (
                  <Group x={totalWidth - 30} y={2} onClick={(e) => { e.cancelBubble = true; onCastingCancel?.(token.id); }} onTap={(e) => { e.cancelBubble = true; onCastingCancel?.(token.id); }}>
                    <Rect x={0} y={0} width={28} height={16} fill="#dc2626" cornerRadius={3} />
                    <Text x={0} y={0} width={28} height={16} text="停" fontSize={8} fill="#fff" align="center" verticalAlign="middle" />
                  </Group>
                )}
              </Group>
            ) : (
              <Group x={0} y={0} onClick={(e) => { e.cancelBubble = true; setIsCastingExpanded(true); }} onTap={(e) => { e.cancelBubble = true; setIsCastingExpanded(true); }}>
                <Circle x={10} y={10} radius={9} fill="#92400e" stroke="#f59e0b" strokeWidth={2} shadowColor="#f59e0b" shadowBlur={3} shadowOpacity={0.5} />
                {castingIconImg ? (
                  <Group clipFunc={(ctx: any) => { ctx.beginPath(); ctx.arc(10, 10, 6, 0, Math.PI * 2); ctx.closePath(); }}>
                    <KonvaImage image={castingIconImg} x={4} y={4} width={12} height={12} listening={false} />
                  </Group>
                ) : (
                  <Text x={4} y={4} width={12} height={12} text={(spellName || '仪').slice(0, 1)} fontSize={8} fontStyle="bold" fill="#fff7ed" align="center" verticalAlign="middle" listening={false} />
                )}
              </Group>
            );
          })()}
          {/* Concentration icon - 右上角小标签，点击展开法术详情 */}
          {token.concentration_spell && !isExpiredByWorldTime(token.concentration_spell.expires_at, currentTime) && (() => {
            const dr = token.concentration_spell.duration_rounds;
            const cr = token.concentration_spell.current_round ?? 0;
            const remainingFromExpiry = getRemainingRoundsFromExpiry(token.concentration_spell.expires_at, currentTime);
            const remaining = remainingFromExpiry ?? (dr ? dr - cr : null);
            const durationStr = remaining != null ? formatEffectDuration(remaining, isInCombat) : '';
            const spellName = token.concentration_spell.spell_name;
            const targetName = token.concentration_spell.target_name;
            const nameText = targetName ? `👁️${spellName}→${targetName}` : `👁️${spellName}`;
            const nameWidth = nameText.length * 8 + 4;
            const durWidth = durationStr ? durationStr.length * 7 + 6 : 0;
            const textWidth = nameWidth + durWidth;
            const collapseBtnW = 28;
            const canBreakConcentration = isDM || (userId != null && token.user_id === userId);
            const breakBtnW = canBreakConcentration ? 28 : 0;
            const labelW = 28;
            const dmBtns = isDM && remaining != null ? 36 : 0;
            const totalWidth = Math.max(textWidth + collapseBtnW + breakBtnW + labelW + dmBtns + 8, 80);
            return isConcentrationExpanded ? (
              <Group x={tokenWidth - totalWidth} y={-24} listening>
                {/* Background */}
                <Rect
                  x={0} y={0}
                  width={totalWidth} height={22}
                  fill="#1f2937"
                  stroke="#a855f7"
                  strokeWidth={2}
                  cornerRadius={4}
                  shadowColor="#a855f7"
                  shadowBlur={3}
                  shadowOpacity={0.6}
                />
                {/* "专注" label - click for concentration rules info */}
                <Group
                  x={2} y={2}
                  onClick={(e) => { e.cancelBubble = true; onConcentrationInfoClick?.(); }}
                  onTap={(e) => { e.cancelBubble = true; onConcentrationInfoClick?.(); }}
                >
                  <Rect x={0} y={0} width={26} height={18} fill="#7c3aed" cornerRadius={3} />
                  <Text x={0} y={0} width={26} height={18} text="专注" fontSize={9} fontStyle="bold" fill="#fff" align="center" verticalAlign="middle" />
                </Group>
                {/* Spell name - click for spell details */}
                <Text
                  x={30} y={4}
                  width={nameWidth} height={14}
                  text={nameText}
                  fontSize={10}
                  fontStyle="bold"
                  fill="#a855f7"
                  align="left"
                  verticalAlign="middle"
                  onClick={(e) => { e.cancelBubble = true; onConcentrationSpellClick?.(spellName); }}
                  onTap={(e) => { e.cancelBubble = true; onConcentrationSpellClick?.(spellName); }}
                />
                {/* Duration text - DM clickable to edit */}
                {durationStr && (
                  <Text
                    x={30 + nameWidth} y={4}
                    width={durWidth} height={14}
                    text={durationStr}
                    fontSize={10}
                    fontStyle="bold"
                    fill={isDM ? "#fbbf24" : "#a855f7"}
                    align="left"
                    verticalAlign="middle"
                    onClick={isDM && remaining != null ? (e) => { e.cancelBubble = true; onConcentrationDurationEdit?.(token.id, remaining); } : undefined}
                    onTap={isDM && remaining != null ? (e) => { e.cancelBubble = true; onConcentrationDurationEdit?.(token.id, remaining); } : undefined}
                  />
                )}
                {/* DM +/- buttons */}
                {isDM && remaining != null && (
                  <Group x={30 + textWidth} y={2}>
                    <Group
                      onClick={(e) => { e.cancelBubble = true; onConcentrationDurationChange?.(token.id, -1); }}
                      onTap={(e) => { e.cancelBubble = true; onConcentrationDurationChange?.(token.id, -1); }}
                    >
                      <Rect x={0} y={0} width={16} height={18} fill="#7c3aed" cornerRadius={3} />
                      <Text x={0} y={0} width={16} height={18} text="-" fontSize={12} fontStyle="bold" fill="#fff" align="center" verticalAlign="middle" />
                    </Group>
                    <Group
                      onClick={(e) => { e.cancelBubble = true; onConcentrationDurationChange?.(token.id, 1); }}
                      onTap={(e) => { e.cancelBubble = true; onConcentrationDurationChange?.(token.id, 1); }}
                    >
                      <Rect x={18} y={0} width={16} height={18} fill="#7c3aed" cornerRadius={3} />
                      <Text x={18} y={0} width={16} height={18} text="+" fontSize={12} fontStyle="bold" fill="#fff" align="center" verticalAlign="middle" />
                    </Group>
                  </Group>
                )}
                {/* "解除" button (red) — DM or token owner can break concentration */}
                {canBreakConcentration && (
                  <Group
                    x={totalWidth - collapseBtnW - breakBtnW - 4} y={2}
                    onClick={(e) => { e.cancelBubble = true; onConcentrationBreak?.(token.id); }}
                    onTap={(e) => { e.cancelBubble = true; onConcentrationBreak?.(token.id); }}
                  >
                    <Rect x={0} y={0} width={breakBtnW} height={18} fill="#dc2626" cornerRadius={3} />
                    <Text x={0} y={0} width={breakBtnW} height={18} text="解除" fontSize={9} fill="#fff" align="center" verticalAlign="middle" />
                  </Group>
                )}
                {/* "收回" button */}
                <Group
                  x={totalWidth - collapseBtnW - 2} y={2}
                  onClick={(e) => { e.cancelBubble = true; setIsConcentrationExpanded(false); }}
                  onTap={(e) => { e.cancelBubble = true; setIsConcentrationExpanded(false); }}
                >
                  <Rect x={0} y={0} width={collapseBtnW} height={18} fill="#4b5563" cornerRadius={3} />
                  <Text x={0} y={0} width={collapseBtnW} height={18} text="收回" fontSize={9} fill="#d1d5db" align="center" verticalAlign="middle" />
                </Group>
              </Group>
            ) : (
              <Group
                x={tokenWidth - 28}
                y={2}
                onClick={(e) => { e.cancelBubble = true; setIsConcentrationExpanded(true); }}
                onTap={(e) => { e.cancelBubble = true; setIsConcentrationExpanded(true); }}
              >
                <Rect
                  x={0} y={0}
                  width={26} height={14}
                  fill="#7c3aed"
                  stroke="#a855f7"
                  strokeWidth={1}
                  cornerRadius={3}
                  shadowColor="#a855f7"
                  shadowBlur={3}
                  shadowOpacity={0.6}
                />
                <Text
                  x={0} y={0}
                  width={26} height={14}
                  text="专注"
                  fontSize={8}
                  fontStyle="bold"
                  fill="#fff"
                  align="center"
                  verticalAlign="middle"
                />
              </Group>
            );
          })()}
          {visibleRuntimeOverlays.length > 0 && (() => {
            const primaryOverlay = visibleRuntimeOverlays[0];
            const overlayLabel = truncateBadgeLabel(
              primaryOverlay.label || primaryOverlay.spell_name || "法术效果",
              18,
            );
            const extraCount = visibleRuntimeOverlays.length - 1;
            const badgeWidth = Math.min(
              Math.max(overlayLabel.length * 8 + (extraCount > 0 ? 40 : 26), 72),
              170,
            );
            const badgeColor = primaryOverlay.color || "#f59e0b";
            return (
              <Group x={2} y={2} listening={false}>
                <Rect
                  x={0}
                  y={0}
                  width={badgeWidth}
                  height={16}
                  fill="rgba(17,24,39,0.92)"
                  stroke={badgeColor}
                  strokeWidth={1}
                  cornerRadius={4}
                  shadowColor={badgeColor}
                  shadowBlur={3}
                  shadowOpacity={0.35}
                />
                <Text
                  x={4}
                  y={1}
                  width={14}
                  height={14}
                  text={primaryOverlay.icon || "✦"}
                  fontSize={10}
                  fontStyle="bold"
                  fill={badgeColor}
                  align="center"
                  verticalAlign="middle"
                />
                <Text
                  x={20}
                  y={1}
                  width={badgeWidth - 24 - (extraCount > 0 ? 18 : 0)}
                  height={14}
                  text={overlayLabel}
                  fontSize={9}
                  fontStyle="bold"
                  fill="#e5e7eb"
                  align="left"
                  verticalAlign="middle"
                />
                {extraCount > 0 && (
                  <Text
                    x={badgeWidth - 18}
                    y={1}
                    width={14}
                    height={14}
                    text={`+${extraCount}`}
                    fontSize={8}
                    fontStyle="bold"
                    fill="#fbbf24"
                    align="center"
                    verticalAlign="middle"
                  />
                )}
              </Group>
            );
          })()}
          {/* Status effects - stacked icons at bottom-left */}
          {displayStatusEffects.length > 0 && (() => {
            const maxVisible = 4;
            const iconS = 16;
            const stackSpacing = 8;
            const rowH = 18;
            const panelPad = 4;
            const panelW = 160;
            const inlineDurationW = 34;
            const inlineRemoveW = isDM ? 18 : 0;
            const inlineNameW = Math.max(54, panelW - 24 - inlineDurationW - inlineRemoveW - 14);
            const twoRowDurationW = 34;
            const twoRowNameW = Math.max(60, panelW - 24 - twoRowDurationW - 12);
            const visibleEffects = isEffectsExpanded ? displayStatusEffects : displayStatusEffects.slice(0, maxVisible);
            const extraCount = displayStatusEffects.length - maxVisible;
            const stackWidth = iconS + Math.max(0, Math.min(displayStatusEffects.length, maxVisible) - 1) * stackSpacing + (extraCount > 0 ? 14 : 0);
            // Variable row heights: effects with save/escape/standup buttons get double height
            const effectRowHeights = displayStatusEffects.map(e => {
              const hasAction = (isDM && (hasOngoingSave(e) || e.escape_action || (e.condition && !e.escape_action && !hasOngoingSave(e)))) || (e.condition === 'prone' && onStandUp);
              return hasAction ? rowH * 2 : rowH;
            });
            const totalEffectH = effectRowHeights.reduce((s, h) => s + h, 0);
            const panelH = totalEffectH + panelPad * 2 + 14;
            const collapsedX = -4;
            const collapsedY = tokenHeight - iconS / 2;
            const expandedX = -4;
            const expandedY = tokenHeight + 18;
            return (
              <Group ref={effectsGroupRef} x={isEffectsExpanded ? expandedX : collapsedX} y={isEffectsExpanded ? expandedY : collapsedY}>
                {!isEffectsExpanded && (
                  <>
                    <Rect x={-2} y={-2} width={stackWidth + 4} height={iconS + 4} fill="transparent"
                      onClick={(e) => { e.cancelBubble = true; setIsEffectsExpanded(true); }}
                      onTap={(e) => { e.cancelBubble = true; setIsEffectsExpanded(true); }}
                    />
                    {visibleEffects.map((effect, idx) => {
                      if (!effect || typeof effect !== 'object') return null;
                      const duration = getEffectDurationValue(effect, currentTime);
                      const isLowDuration = duration != null && duration <= 3;
                      return (
                        <Group key={effect.id || idx} x={idx * stackSpacing} y={0} listening={false}>
                          {(() => {
                            const iconImg = effect.id ? effectIconImages[effect.id] : undefined;
                            if (iconImg instanceof HTMLImageElement) {
                              return <KonvaImage x={0} y={0} width={iconS} height={iconS} image={iconImg} cornerRadius={iconS / 2} listening={false} />;
                            }
                            return <Text x={0} y={0} width={iconS} height={iconS} text={effect.icon} fontSize={11} align="center" verticalAlign="middle" listening={false} />;
                          })()}
                          {isLowDuration && <Circle x={iconS - 1} y={iconS - 1} radius={3} fill="#ef4444" listening={false} />}
                        </Group>
                      );
                    })}
                    {extraCount > 0 && (
                      <Group x={iconS + (maxVisible - 1) * stackSpacing} y={0} listening={false}>
                        <Text x={0} y={0} width={14} height={iconS} text={`+${extraCount}`} fontSize={9} fontStyle="bold" fill="#fbbf24" align="center" verticalAlign="middle" listening={false} />
                      </Group>
                    )}
                  </>
                )}
                {isEffectsExpanded && (
                  <Group>
                    <Rect x={0} y={0} width={panelW} height={panelH} fill="rgba(17,24,39,0.92)" cornerRadius={6} stroke="#374151" strokeWidth={1} listening={false} />
                    {displayStatusEffects.map((effect, idx) => {
                      if (!effect || typeof effect !== 'object') return null;
                      const duration = getEffectDurationValue(effect, currentTime);
                      const isLowDuration = duration != null && duration <= 3;
                      const ry = panelPad + effectRowHeights.slice(0, idx).reduce((s, h) => s + h, 0);
                      const iS = 14;
                      const hasSave = isDM && hasOngoingSave(effect);
                      const hasEscape = isDM && !!effect.escape_action && !!onEscapeAttempt;
                      const hasCondSave = isDM && !hasSave && !hasEscape && !!effect.condition;
                      const hasProne = effect.condition === 'prone' && !!onStandUp;
                      const isTwoRow = hasSave || hasCondSave || hasEscape || hasProne;
                      const thisH = isTwoRow ? rowH * 2 : rowH;
                      return (
                        <Group key={effect.id || idx} y={ry}>
                          <Rect x={2} y={0} width={panelW - 4} height={isTwoRow ? rowH : thisH} fill="transparent" cornerRadius={3}
                            onClick={(e) => { e.cancelBubble = true; if (onStatusEffectClick) onStatusEffectClick(effect); }}
                            onTap={(e) => { e.cancelBubble = true; if (onStatusEffectClick) onStatusEffectClick(effect); }}
                          />
                          <Rect x={3} y={3} width={2} height={thisH - 6} fill={effect.color} cornerRadius={1} listening={false} />
                          {(() => {
                            const iconImg = effect.id ? effectIconImages[effect.id] : undefined;
                            if (iconImg instanceof HTMLImageElement) {
                              return <KonvaImage x={8} y={(rowH - iS) / 2} width={iS} height={iS} image={iconImg} cornerRadius={iS / 2} listening={false} />;
                            }
                            return <Text x={8} y={0} width={iS} height={rowH} text={effect.icon} fontSize={10} align="center" verticalAlign="middle" listening={false} />;
                          })()}
                          {/* Row 1: name + duration (two-row) or name + duration + buttons (single-row) */}
                          <Text x={24} y={0} width={isTwoRow ? twoRowNameW : inlineNameW} height={rowH} text={effect.name} fontSize={9} fill="#e5e7eb" verticalAlign="middle" listening={false} ellipsis={true} wrap="none" />
                          {isTwoRow ? (
                            <>
                              {/* Row 1 right: duration */}
                              {duration != null && (
                                <Text x={panelW - twoRowDurationW - 4} y={0} width={twoRowDurationW} height={rowH} text={formatEffectDuration(duration, isInCombat)} fontSize={8} fill={isLowDuration ? '#fca5a5' : '#9ca3af'} align="right" verticalAlign="middle" listening={false} />
                              )}
                              {/* Row 2: action buttons + remove button */}
                              {hasSave && onOngoingSave && (
                                <Group
                                  x={panelW - 58} y={rowH}
                                  onClick={(e) => { e.cancelBubble = true; onOngoingSave(token.id, effect.id); }}
                                  onTap={(e) => { e.cancelBubble = true; onOngoingSave(token.id, effect.id); }}
                                >
                                  <Rect x={0} y={0} width={36} height={rowH - 2} fill="transparent" />
                                  <Rect x={0} y={1} width={36} height={rowH - 4} fill="#7c3aed" cornerRadius={3} opacity={0.8} listening={false} />
                                  <Text x={0} y={1} width={36} height={rowH - 4} text="豁免" fontSize={9} fill="#fff" align="center" verticalAlign="middle" listening={false} />
                                </Group>
                              )}
                              {hasEscape && (
                                <Group
                                  x={panelW - 58} y={rowH}
                                  onClick={(e) => { e.cancelBubble = true; onEscapeAttempt!(token.id, effect.id); }}
                                  onTap={(e) => { e.cancelBubble = true; onEscapeAttempt!(token.id, effect.id); }}
                                >
                                  <Rect x={0} y={0} width={36} height={rowH - 2} fill="transparent" />
                                  <Rect x={0} y={1} width={36} height={rowH - 4} fill="#2563eb" cornerRadius={3} opacity={0.8} listening={false} />
                                  <Text x={0} y={1} width={36} height={rowH - 4} text="挣脱" fontSize={9} fill="#fff" align="center" verticalAlign="middle" listening={false} />
                                </Group>
                              )}
                              {hasCondSave && onConditionSave && (
                                <Group
                                  x={panelW - 58} y={rowH}
                                  onClick={(e) => { e.cancelBubble = true; onConditionSave(token.id, effect.id); }}
                                  onTap={(e) => { e.cancelBubble = true; onConditionSave(token.id, effect.id); }}
                                >
                                  <Rect x={0} y={0} width={36} height={rowH - 2} fill="transparent" />
                                  <Rect x={0} y={1} width={36} height={rowH - 4} fill="#d97706" cornerRadius={3} opacity={0.8} listening={false} />
                                  <Text x={0} y={1} width={36} height={rowH - 4} text="豁免" fontSize={9} fill="#fff" align="center" verticalAlign="middle" listening={false} />
                                </Group>
                              )}
                              {hasProne && (
                                <Group
                                  x={isDM ? panelW - 58 : 8} y={rowH}
                                  onClick={(e) => { e.cancelBubble = true; onStandUp!(token.id, effect.id); }}
                                  onTap={(e) => { e.cancelBubble = true; onStandUp!(token.id, effect.id); }}
                                >
                                  <Rect x={0} y={0} width={36} height={rowH - 2} fill="transparent" />
                                  <Rect x={0} y={1} width={36} height={rowH - 4} fill="#0d9488" cornerRadius={3} opacity={0.8} listening={false} />
                                  <Text x={0} y={1} width={36} height={rowH - 4} text="起来" fontSize={9} fill="#fff" align="center" verticalAlign="middle" listening={false} />
                                </Group>
                              )}
                              {isDM && onStatusEffectRemove && canRemoveStatusEffect(effect) && (
                                <Group
                                  x={panelW - 18} y={rowH}
                                  onClick={(e) => { e.cancelBubble = true; onStatusEffectRemove(token.id, effect); }}
                                  onTap={(e) => { e.cancelBubble = true; onStatusEffectRemove(token.id, effect); }}
                                >
                                  <Rect x={0} y={0} width={16} height={rowH - 2} fill="transparent" />
                                  <Rect x={2} y={1} width={12} height={rowH - 4} fill="#dc2626" cornerRadius={3} opacity={0.7} listening={false} />
                                  <Text x={2} y={1} width={12} height={rowH - 4} text="✕" fontSize={8} fill="#fff" align="center" verticalAlign="middle" listening={false} />
                                </Group>
                              )}
                            </>
                          ) : (
                            <>
                              {duration != null && (
                                <Text x={panelW - inlineDurationW - inlineRemoveW - 4} y={0} width={inlineDurationW} height={rowH} text={formatEffectDuration(duration, isInCombat)} fontSize={8} fill={isLowDuration ? '#fca5a5' : '#9ca3af'} align="right" verticalAlign="middle" listening={false} />
                              )}
                              {isDM && onStatusEffectRemove && canRemoveStatusEffect(effect) && (
                                <Group
                                  x={panelW - 18} y={0}
                                  onClick={(e) => { e.cancelBubble = true; onStatusEffectRemove(token.id, effect); }}
                                  onTap={(e) => { e.cancelBubble = true; onStatusEffectRemove(token.id, effect); }}
                                >
                                  <Rect x={0} y={0} width={16} height={rowH} fill="transparent" />
                                  <Rect x={2} y={(rowH - 12) / 2} width={12} height={12} fill="#dc2626" cornerRadius={2} opacity={0.7} listening={false} />
                                  <Text x={2} y={(rowH - 12) / 2} width={12} height={12} text="✕" fontSize={8} fill="#fff" align="center" verticalAlign="middle" listening={false} />
                                </Group>
                              )}
                            </>
                          )}
                        </Group>
                      );
                    })}
                    <Group y={panelPad + totalEffectH + 2}>
                      <Rect x={2} y={0} width={panelW - 4} height={12} fill="transparent" cornerRadius={3}
                        onClick={(e) => { e.cancelBubble = true; setIsEffectsExpanded(false); }}
                        onTap={(e) => { e.cancelBubble = true; setIsEffectsExpanded(false); }}
                      />
                      <Text x={0} y={0} width={panelW} height={12} text="▲ 收起" fontSize={8} fill="#6b7280" align="center" verticalAlign="middle" listening={false} />
                    </Group>
                  </Group>
                )}
              </Group>
            );
          })()}
          {/* 名称标签 */}
          <Group x={tokenWidth / 2} y={tokenHeight + 2} listening={false}>
            <Rect
              x={-nameWidth / 2 - 4}
              y={0}
              width={nameWidth + 8}
              height={16}
              fill="rgba(0, 0, 0, 0.85)"
              cornerRadius={8}
            />
            <Text
              x={-nameWidth / 2}
              y={2}
              width={nameWidth}
              text={displayName}
              fontSize={11}
              fontFamily="Arial, sans-serif"
              fontStyle="bold"
              fill="#ffffff"
              align="center"
            />
          </Group>
          {/* 副标题标签 (种族/职业) - 只在选中时显示 */}
          {isSelected && subtitleText && (
            <Group x={tokenWidth / 2} y={tokenHeight + 19} listening={false}>
              <Rect
                x={-subtitleWidth / 2 - 3}
                y={0}
                width={subtitleWidth + 6}
                height={13}
                fill={subtitleBgColor}
                cornerRadius={6}
              />
              <Text
                x={-subtitleWidth / 2}
                y={1}
                width={subtitleWidth}
                text={subtitleText}
                fontSize={9}
                fontFamily="Arial, sans-serif"
                fill="#ffffff"
                align="center"
              />
            </Group>
          )}
          {/* HP数值 - 只在选中时显示，放在名字下方、血条上方 */}
          {isSelected && canSeeHP && currentHP !== null && (
            <Group x={tokenWidth / 2} y={tokenHeight + 19} listening={false}>
              <Rect
                x={tempHP ? -32 : -24}
                y={0}
                width={tempHP ? 64 : 48}
                height={14}
                fill={hpColor}
                cornerRadius={7}
              />
              <Text
                x={tempHP ? -32 : -24}
                y={1}
                width={tempHP ? 64 : 48}
                text={`${currentHP}/${maxHP || '?'}${tempHP ? `+${tempHP}` : ''}`}
                fontSize={10}
                fontFamily="Arial, sans-serif"
                fontStyle="bold"
                fill="#ffffff"
                align="center"
              />
            </Group>
          )}
        </>
      ) : (
        // 单格子token - 简洁圆形
        <>
          {/* HP条 - 顶部细长条，临时HP作为附加延伸 */}
          {canSeeHP && currentHP !== null && maxHP && maxHP > 0 && (() => {
            const barW = radius * 2;
            const effectiveTempHP = (tempHP != null && tempHP > 0) ? tempHP : 0;
            const totalPool = maxHP + effectiveTempHP;
            const hpW = Math.min(barW, Math.max(0, (currentHP / totalPool) * barW));
            const tempW = Math.max(0, Math.min((effectiveTempHP / totalPool) * barW, barW - hpW));
            return (
              <Group x={centerX - radius} y={centerY - radius - 6} listening={false}>
                {/* 背景 */}
                <Rect x={0} y={0} width={barW} height={4}
                  fill="rgba(0, 0, 0, 0.6)" cornerRadius={2} />
                {/* HP填充 */}
                <Rect x={0} y={0} width={Math.min(hpW, barW)} height={4}
                  fill={hpColor} cornerRadius={2} />
                {/* 临时HP填充（金色，紧接HP之后） */}
                {effectiveTempHP > 0 && (
                  <Rect x={hpW} y={0}
                    width={tempW} height={4}
                    fill="rgba(59, 130, 246, 0.9)" cornerRadius={2} />
                )}
              </Group>
            );
          })()}
          {/* 战斗行动回合指示器 - 四向箭头+光晕 */}
          {isActiveTurn && (
            <Group listening={false}>
              {/* 柔和外层光晕 */}
              <Circle
                x={centerX}
                y={centerY}
                radius={avatarRadius + 12}
                fill="transparent"
                shadowColor="#4ade80"
                shadowBlur={8}
                shadowOpacity={0.6}
              />
              {/* 四向指示箭头 - 上 */}
              <RegularPolygon
                x={centerX}
                y={centerY - avatarRadius - 8}
                sides={3}
                radius={6}
                rotation={180}
                fill="#4ade80"
              />
              {/* 下 */}
              <RegularPolygon
                x={centerX}
                y={centerY + avatarRadius + 8}
                sides={3}
                radius={6}
                rotation={0}
                fill="#4ade80"
              />
              {/* 左 */}
              <RegularPolygon
                x={centerX - avatarRadius - 8}
                y={centerY}
                sides={3}
                radius={6}
                rotation={90}
                fill="#4ade80"
              />
              {/* 右 */}
              <RegularPolygon
                x={centerX + avatarRadius + 8}
                y={centerY}
                sides={3}
                radius={6}
                rotation={-90}
                fill="#4ade80"
              />
              {/* 内层细环 */}
              <Circle
                x={centerX}
                y={centerY}
                radius={avatarRadius + 3}
                stroke="#4ade80"
                strokeWidth={1.5}
                opacity={0.8}
              />
            </Group>
          )}
          {/* 选中光环 (RTS selection) */}
          {isSelected && (
            <Circle
              x={centerX}
              y={centerY}
              radius={avatarRadius + 6}
              stroke="#fbbf24"
              strokeWidth={3}
              dash={[8, 4]}
              shadowColor="#fbbf24"
              shadowBlur={6}
              shadowOpacity={0.6}
              listening={false}
            />
          )}
          {/* 法术瞄准发光框 */}
          {targetedColor && (
            <Circle
              x={centerX}
              y={centerY}
              radius={avatarRadius + 5}
              stroke={targetedColor}
              strokeWidth={2.5}
              shadowColor={targetedColor}
              shadowBlur={6}
              shadowOpacity={0.8}
              listening={false}
            />
          )}
          {/* Wild Shape glow - 绿色光晕 */}
          {isTransformed && (
            <Circle
              x={centerX}
              y={centerY}
              radius={avatarRadius + 3}
              stroke="#22c55e"
              strokeWidth={2}
              shadowColor="#22c55e"
              shadowBlur={6}
              shadowOpacity={0.7}
              listening={false}
            />
          )}
          {/* Transformation badge - 显示变化形态名称 (only for full_replace like wild shape) */}
          {isTransformed && transformData && transformData.type !== 'modifier' && (
            <Group x={centerX + radius - 4} y={centerY - radius - 16} listening={false}>
              <Rect
                x={-52}
                y={0}
                width={56}
                height={16}
                fill="#1f2937"
                stroke="#22c55e"
                strokeWidth={2}
                cornerRadius={4}
              />
              <Text
                x={-50}
                y={2}
                width={52}
                height={12}
                text={`🐺${transformData.beast_name || ''}`}
                fontSize={8}
                fontStyle="bold"
                fill="#22c55e"
                align="left"
                verticalAlign="middle"
              />
            </Group>
          )}
          {/* Pending maneuver badge (bottom-left corner) - Battle Master */}
          {pendingManeuver && (
            <Group x={centerX - radius - 8} y={centerY + radius - 6} listening={false}>
              <Rect
                x={0}
                y={0}
                width={72}
                height={18}
                fill="#1f2937"
                stroke="#f59e0b"
                strokeWidth={2}
                cornerRadius={4}
                shadowColor="#f59e0b"
                shadowBlur={4}
                shadowOpacity={0.6}
              />
              <Text
                x={3}
                y={2}
                width={66}
                height={14}
                text={`⚔️${pendingManeuver.maneuver.name}`}
                fontSize={9}
                fontStyle="bold"
                fill="#f59e0b"
                align="left"
                verticalAlign="middle"
              />
            </Group>
          )}
          {/* 头像底色圆 */}
          <Circle
            x={centerX}
            y={centerY}
            radius={avatarRadius}
            fill={fillColor}
          />
          {/* 头像图片 */}
          {avatarImg && (
            <KonvaImage
              ref={avatarSingleRef as any}
              x={centerX - avatarRadius}
              y={centerY - avatarRadius}
              width={avatarRadius * 2}
              height={avatarRadius * 2}
              image={avatarImg}
              cornerRadius={avatarRadius}
            />
          )}
          {/* 法术滤镜叠层 (single-grid) */}
          {mergedTokenFilter && (
            <>
              {mergedTokenFilter.glow && (
                <Circle x={centerX} y={centerY} radius={avatarRadius + 4}
                  stroke={mergedTokenFilter.glow} strokeWidth={2}
                  shadowColor={mergedTokenFilter.glow}
                  shadowBlur={mergedTokenFilter.glowRadius ?? 10}
                  shadowOpacity={mergedTokenFilter.glowAnimation ? glowPulse : 0.7}
                  listening={false} />
              )}
              {(mergedTokenFilter.blur ?? 0) > 0 && (
                <Circle x={centerX} y={centerY} radius={avatarRadius}
                  fill={`rgba(180,210,255,${Math.min((mergedTokenFilter.blur ?? 0) * 0.06, 0.25)})`}
                  listening={false} />
              )}
              {/* 模糊发光边框 */}
              {(mergedTokenFilter.blur ?? 0) > 0 && !mergedTokenFilter.glow && (
                <Circle x={centerX} y={centerY} radius={avatarRadius + 3}
                  stroke="rgba(150,180,255,0.5)" strokeWidth={1.5}
                  shadowColor="#93c5fd" shadowBlur={6} shadowOpacity={0.4}
                  listening={false} />
              )}
              {mergedTokenFilter.saturate != null && mergedTokenFilter.saturate < 1 && (
                <Circle x={centerX} y={centerY} radius={avatarRadius}
                  fill={`rgba(128,128,128,${(1 - mergedTokenFilter.saturate) * 0.5})`}
                  listening={false} />
              )}
              {mergedTokenFilter.overlays.map((color, i) => (
                <Circle key={`tf-ov-${i}`} x={centerX} y={centerY} radius={avatarRadius}
                  fill={color} listening={false} />
              ))}
              {mergedTokenFilter.brightness != null && mergedTokenFilter.brightness !== 0 && (
                <Circle x={centerX} y={centerY} radius={avatarRadius}
                  fill={mergedTokenFilter.brightness > 0
                    ? `rgba(255,255,200,${Math.abs(mergedTokenFilter.brightness) * 0.3})`
                    : `rgba(0,0,30,${Math.abs(mergedTokenFilter.brightness) * 0.4})`}
                  listening={false} />
              )}
            </>
          )}
          {/* Loot bag icon when no avatar */}
          {isLootBagToken && !avatarImg && (
            <Text
              x={centerX - avatarRadius}
              y={centerY - avatarRadius * 0.7}
              width={avatarRadius * 2}
              text="💰"
              fontSize={avatarRadius * 1.3}
              align="center"
              listening={false}
            />
          )}
          {/* Chest icon when no avatar */}
          {isChestToken && !avatarImg && (
            <Text
              x={centerX - avatarRadius}
              y={centerY - avatarRadius * 0.7}
              width={avatarRadius * 2}
              text={token.chest_state === 'looted' ? '📭' : (token.chest_state === 'open' ? '📬' : '📦')}
              fontSize={avatarRadius * 1.3}
              align="center"
              listening={false}
            />
          )}
          {/* 死亡遮罩层 */}
          {isDead && (
            <>
              <Circle
                x={centerX}
                y={centerY}
                radius={avatarRadius}
                fill="rgba(0, 0, 0, 0.5)"
                listening={false}
              />
              {/* 死亡X标记 */}
              <Line
                points={[centerX - avatarRadius * 0.5, centerY - avatarRadius * 0.5, centerX + avatarRadius * 0.5, centerY + avatarRadius * 0.5]}
                stroke="#dc2626"
                strokeWidth={3}
                lineCap="round"
                listening={false}
              />
              <Line
                points={[centerX + avatarRadius * 0.5, centerY - avatarRadius * 0.5, centerX - avatarRadius * 0.5, centerY + avatarRadius * 0.5]}
                stroke="#dc2626"
                strokeWidth={3}
                lineCap="round"
                listening={false}
              />
            </>
          )}
          {/* 战利品宝箱滤镜 */}
          {isChestToken && (
            <Circle
              x={centerX}
              y={centerY}
              radius={avatarRadius}
              fill="rgba(180, 120, 40, 0.3)"
              listening={false}
            />
          )}
          {/* 边框 */}
          <Circle
            x={centerX}
            y={centerY}
            radius={avatarRadius}
            stroke={isDeleteMode ? "#ff0000" : (isDragging ? "#fbbf24" : borderColor)}
            strokeWidth={isDeleteMode ? 2 : (isChestToken ? 2 : 1)}
            dash={isDeleteMode ? [6, 3] : undefined}
            shadowColor={isIllusionToken ? "#a855f7" : undefined}
            shadowBlur={isIllusionToken ? 12 : 0}
            shadowOpacity={isIllusionToken ? 0.6 : 0}
          />
          {/* 伪装原始头像小圆形 (单格) */}
          {canSeeDisguise && originalAvatarImg && (
            <Group x={centerX + avatarRadius - 3} y={centerY + avatarRadius - 3} listening={false}>
              <Group clipFunc={(ctx: any) => { ctx.beginPath(); ctx.arc(0, 0, 7, 0, Math.PI * 2); ctx.closePath(); }}>
                <KonvaImage image={originalAvatarImg} x={-7} y={-7} width={14} height={14} />
              </Group>
            </Group>
          )}
          {token.casting_in_progress && (() => {
            const canCancelCasting = isDM || (userId != null && token.user_id === userId);
            const finishSeconds = worldTimeToSeconds(token.casting_in_progress.finish_at_campaign as any);
            const nowSeconds = worldTimeToSeconds(currentTime as any);
            const isReadyToRelease = token.casting_in_progress.status === 'ready';
            const remainingSeconds = finishSeconds != null && nowSeconds != null
              ? Math.max(0, finishSeconds - nowSeconds)
              : token.casting_in_progress.total_cast_seconds;
            const durationStr = isReadyToRelease ? '待释放' : `${formatCastingDuration(remainingSeconds)}后可施法`;
            const modeLabel = token.casting_in_progress.cast_mode === 'ritual' ? '仪' : '施';
            const canTriggerRelease = isReadyToRelease ? canCancelCasting : isDM;
            const spellName = token.casting_in_progress.spell_name;
            const nameText = spellName || '长时间施法';
            const nameWidth = nameText.length * 7 + 4;
            const durWidth = durationStr.length * 6 + 6;
            const totalWidth = Math.max(nameWidth + durWidth + (canTriggerRelease ? 52 : 0) + (canCancelCasting ? 26 : 0) + 58, 112);
            return isCastingExpanded ? (
              <Group x={centerX - radius} y={centerY - radius - 22} listening>
                <Rect x={0} y={0} width={totalWidth} height={20} fill="#1f2937" stroke="#f59e0b" strokeWidth={2} cornerRadius={4} shadowColor="#f59e0b" shadowBlur={3} shadowOpacity={0.5} />
                <Group
                  x={2}
                  y={2}
                  onClick={(e) => { e.cancelBubble = true; setIsCastingExpanded(false); }}
                  onTap={(e) => { e.cancelBubble = true; setIsCastingExpanded(false); }}
                >
                  <Rect x={0} y={0} width={20} height={16} fill="#374151" cornerRadius={3} />
                  <Text x={0} y={0} width={20} height={16} text="收" fontSize={8} fontStyle="bold" fill="#fff" align="center" verticalAlign="middle" />
                </Group>
                <Group
                  x={24}
                  y={2}
                  listening={token.casting_in_progress.cast_mode === 'ritual' && !!onCastingModeInfoClick}
                  onClick={token.casting_in_progress.cast_mode === 'ritual' ? (e) => {
                    e.cancelBubble = true;
                    onCastingModeInfoClick?.(token.id);
                  } : undefined}
                  onTap={token.casting_in_progress.cast_mode === 'ritual' ? (e) => {
                    e.cancelBubble = true;
                    onCastingModeInfoClick?.(token.id);
                  } : undefined}
                >
                  <Rect x={0} y={0} width={24} height={16} fill="#b45309" cornerRadius={3} />
                  <Text x={0} y={0} width={24} height={16} text={modeLabel} fontSize={8} fontStyle="bold" fill="#fff" align="center" verticalAlign="middle" />
                </Group>
                <Text
                  x={50}
                  y={3}
                  width={nameWidth}
                  height={14}
                  text={nameText}
                  fontSize={9}
                  fontStyle="bold"
                  fill="#fbbf24"
                  listening={!!onCastingSpellClick}
                  onClick={(e) => {
                    if (!spellName || !onCastingSpellClick) return;
                    e.cancelBubble = true;
                    onCastingSpellClick(spellName);
                  }}
                  onTap={(e) => {
                    if (!spellName || !onCastingSpellClick) return;
                    e.cancelBubble = true;
                    onCastingSpellClick(spellName);
                  }}
                />
                <Text x={50 + nameWidth} y={3} width={durWidth} height={14} text={durationStr} fontSize={9} fontStyle="bold" fill="#fde68a" />
                {canTriggerRelease && (
                  <Group x={totalWidth - (canCancelCasting ? 66 : 40)} y={2} onClick={(e) => { e.cancelBubble = true; onCastingCompleteNow?.(token.id); }} onTap={(e) => { e.cancelBubble = true; onCastingCompleteNow?.(token.id); }}>
                    <Rect x={0} y={0} width={38} height={16} fill="#92400e" cornerRadius={3} />
                    <Text x={0} y={0} width={38} height={16} text={isReadyToRelease ? "释放" : "完成"} fontSize={8} fill="#fff" align="center" verticalAlign="middle" />
                  </Group>
                )}
                {canCancelCasting && (
                  <Group x={totalWidth - 26} y={2} onClick={(e) => { e.cancelBubble = true; onCastingCancel?.(token.id); }} onTap={(e) => { e.cancelBubble = true; onCastingCancel?.(token.id); }}>
                    <Rect x={0} y={0} width={24} height={16} fill="#dc2626" cornerRadius={3} />
                    <Text x={0} y={0} width={24} height={16} text="停" fontSize={8} fill="#fff" align="center" verticalAlign="middle" />
                  </Group>
                )}
              </Group>
            ) : (
              <Group x={centerX - radius + 6} y={centerY - radius + 6} onClick={(e) => { e.cancelBubble = true; setIsCastingExpanded(true); }} onTap={(e) => { e.cancelBubble = true; setIsCastingExpanded(true); }}>
                <Circle x={0} y={0} radius={8} fill="#92400e" stroke="#f59e0b" strokeWidth={2} shadowColor="#f59e0b" shadowBlur={3} shadowOpacity={0.5} />
                {castingIconImg ? (
                  <Group clipFunc={(ctx: any) => { ctx.beginPath(); ctx.arc(0, 0, 5.5, 0, Math.PI * 2); ctx.closePath(); }}>
                    <KonvaImage image={castingIconImg} x={-5.5} y={-5.5} width={11} height={11} listening={false} />
                  </Group>
                ) : (
                  <Text x={-4.5} y={-4.5} width={9} height={9} text={(spellName || '仪').slice(0, 1)} fontSize={7} fontStyle="bold" fill="#fff7ed" align="center" verticalAlign="middle" listening={false} />
                )}
              </Group>
            );
          })()}
          {/* Concentration icon - 右上角小标签，点击展开法术详情 */}
          {token.concentration_spell && !isExpiredByWorldTime(token.concentration_spell.expires_at, currentTime) && (() => {
            const dr = token.concentration_spell.duration_rounds;
            const cr = token.concentration_spell.current_round ?? 0;
            const remainingFromExpiry = getRemainingRoundsFromExpiry(token.concentration_spell.expires_at, currentTime);
            const remaining = remainingFromExpiry ?? (dr ? dr - cr : null);
            const durationStr = remaining != null ? formatEffectDuration(remaining, isInCombat) : '';
            const spellName = token.concentration_spell.spell_name;
            const targetName = token.concentration_spell.target_name;
            const nameText = targetName ? `👁️${spellName}→${targetName}` : `👁️${spellName}`;
            const nameWidth = nameText.length * 7 + 4;
            const durWidth = durationStr ? durationStr.length * 6 + 6 : 0;
            const textWidth = nameWidth + durWidth;
            const collapseBtnW = 26;
            const canBreakConcentration = isDM || (userId != null && token.user_id === userId);
            const breakBtnW = canBreakConcentration ? 26 : 0;
            const labelW = 26;
            const dmBtns = isDM && remaining != null ? 34 : 0;
            const totalWidth = Math.max(textWidth + collapseBtnW + breakBtnW + labelW + dmBtns + 6, 70);
            return isConcentrationExpanded ? (
              <Group x={centerX + radius - totalWidth} y={centerY - radius - 22} listening>
                <Rect
                  x={0} y={0}
                  width={totalWidth} height={20}
                  fill="#1f2937"
                  stroke="#a855f7"
                  strokeWidth={2}
                  cornerRadius={4}
                  shadowColor="#a855f7"
                  shadowBlur={3}
                  shadowOpacity={0.6}
                />
                {/* "专注" label - click for concentration rules info */}
                <Group
                  x={2} y={2}
                  onClick={(e) => { e.cancelBubble = true; onConcentrationInfoClick?.(); }}
                  onTap={(e) => { e.cancelBubble = true; onConcentrationInfoClick?.(); }}
                >
                  <Rect x={0} y={0} width={24} height={16} fill="#7c3aed" cornerRadius={3} />
                  <Text x={0} y={0} width={24} height={16} text="专注" fontSize={8} fontStyle="bold" fill="#fff" align="center" verticalAlign="middle" />
                </Group>
                {/* Spell name - click for spell details */}
                <Text
                  x={28} y={3}
                  width={nameWidth} height={14}
                  text={nameText}
                  fontSize={9}
                  fontStyle="bold"
                  fill="#a855f7"
                  align="left"
                  verticalAlign="middle"
                  onClick={(e) => { e.cancelBubble = true; onConcentrationSpellClick?.(spellName); }}
                  onTap={(e) => { e.cancelBubble = true; onConcentrationSpellClick?.(spellName); }}
                />
                {/* Duration text - DM clickable to edit */}
                {durationStr && (
                  <Text
                    x={28 + nameWidth} y={3}
                    width={durWidth} height={14}
                    text={durationStr}
                    fontSize={9}
                    fontStyle="bold"
                    fill={isDM ? "#fbbf24" : "#a855f7"}
                    align="left"
                    verticalAlign="middle"
                    onClick={isDM && remaining != null ? (e) => { e.cancelBubble = true; onConcentrationDurationEdit?.(token.id, remaining); } : undefined}
                    onTap={isDM && remaining != null ? (e) => { e.cancelBubble = true; onConcentrationDurationEdit?.(token.id, remaining); } : undefined}
                  />
                )}
                {/* DM +/- buttons */}
                {isDM && remaining != null && (
                  <Group x={28 + textWidth} y={2}>
                    <Group
                      onClick={(e) => { e.cancelBubble = true; onConcentrationDurationChange?.(token.id, -1); }}
                      onTap={(e) => { e.cancelBubble = true; onConcentrationDurationChange?.(token.id, -1); }}
                    >
                      <Rect x={0} y={0} width={15} height={16} fill="#7c3aed" cornerRadius={3} />
                      <Text x={0} y={0} width={15} height={16} text="-" fontSize={11} fontStyle="bold" fill="#fff" align="center" verticalAlign="middle" />
                    </Group>
                    <Group
                      onClick={(e) => { e.cancelBubble = true; onConcentrationDurationChange?.(token.id, 1); }}
                      onTap={(e) => { e.cancelBubble = true; onConcentrationDurationChange?.(token.id, 1); }}
                    >
                      <Rect x={17} y={0} width={15} height={16} fill="#7c3aed" cornerRadius={3} />
                      <Text x={17} y={0} width={15} height={16} text="+" fontSize={11} fontStyle="bold" fill="#fff" align="center" verticalAlign="middle" />
                    </Group>
                  </Group>
                )}
                {/* "解除" button (red) — DM or token owner can break concentration */}
                {canBreakConcentration && (
                  <Group
                    x={totalWidth - collapseBtnW - breakBtnW - 4} y={2}
                    onClick={(e) => { e.cancelBubble = true; onConcentrationBreak?.(token.id); }}
                    onTap={(e) => { e.cancelBubble = true; onConcentrationBreak?.(token.id); }}
                  >
                    <Rect x={0} y={0} width={breakBtnW} height={16} fill="#dc2626" cornerRadius={3} />
                    <Text x={0} y={0} width={breakBtnW} height={16} text="解除" fontSize={8} fill="#fff" align="center" verticalAlign="middle" />
                  </Group>
                )}
                {/* "收回" button */}
                <Group
                  x={totalWidth - collapseBtnW - 2} y={2}
                  onClick={(e) => { e.cancelBubble = true; setIsConcentrationExpanded(false); }}
                  onTap={(e) => { e.cancelBubble = true; setIsConcentrationExpanded(false); }}
                >
                  <Rect x={0} y={0} width={collapseBtnW} height={16} fill="#4b5563" cornerRadius={3} />
                  <Text x={0} y={0} width={collapseBtnW} height={16} text="收回" fontSize={8} fill="#d1d5db" align="center" verticalAlign="middle" />
                </Group>
              </Group>
            ) : (
              <Group
                x={centerX + radius - 22}
                y={centerY - radius - 2}
                onClick={(e) => { e.cancelBubble = true; setIsConcentrationExpanded(true); }}
                onTap={(e) => { e.cancelBubble = true; setIsConcentrationExpanded(true); }}
              >
                <Rect
                  x={0} y={0}
                  width={24} height={12}
                  fill="#7c3aed"
                  stroke="#a855f7"
                  strokeWidth={1}
                  cornerRadius={3}
                  shadowColor="#a855f7"
                  shadowBlur={3}
                  shadowOpacity={0.6}
                />
                <Text
                  x={0} y={0}
                  width={24} height={12}
                  text="专注"
                  fontSize={7}
                  fontStyle="bold"
                  fill="#fff"
                  align="center"
                  verticalAlign="middle"
                />
              </Group>
            );
          })()}
          {visibleRuntimeOverlays.length > 0 && (() => {
            const primaryOverlay = visibleRuntimeOverlays[0];
            const overlayLabel = truncateBadgeLabel(
              primaryOverlay.label || primaryOverlay.spell_name || "法术效果",
              12,
            );
            const extraCount = visibleRuntimeOverlays.length - 1;
            const badgeWidth = Math.min(
              Math.max(overlayLabel.length * 7 + (extraCount > 0 ? 34 : 22), 58),
              120,
            );
            const badgeColor = primaryOverlay.color || "#f59e0b";
            return (
              <Group x={centerX - radius - 2} y={centerY - radius - 18} listening={false}>
                <Rect
                  x={0}
                  y={0}
                  width={badgeWidth}
                  height={14}
                  fill="rgba(17,24,39,0.92)"
                  stroke={badgeColor}
                  strokeWidth={1}
                  cornerRadius={4}
                  shadowColor={badgeColor}
                  shadowBlur={3}
                  shadowOpacity={0.35}
                />
                <Text
                  x={3}
                  y={0.5}
                  width={12}
                  height={13}
                  text={primaryOverlay.icon || "✦"}
                  fontSize={8}
                  fontStyle="bold"
                  fill={badgeColor}
                  align="center"
                  verticalAlign="middle"
                />
                <Text
                  x={16}
                  y={0.5}
                  width={badgeWidth - 18 - (extraCount > 0 ? 14 : 0)}
                  height={13}
                  text={overlayLabel}
                  fontSize={7}
                  fontStyle="bold"
                  fill="#e5e7eb"
                  align="left"
                  verticalAlign="middle"
                />
                {extraCount > 0 && (
                  <Text
                    x={badgeWidth - 14}
                    y={0.5}
                    width={11}
                    height={13}
                    text={`+${extraCount}`}
                    fontSize={7}
                    fontStyle="bold"
                    fill="#fbbf24"
                    align="center"
                    verticalAlign="middle"
                  />
                )}
              </Group>
            );
          })()}
          {/* Status effects - stacked icons at bottom-left (single-grid) */}
          {displayStatusEffects.length > 0 && (() => {
            const maxVisible = 4;
            const iconS = 14;
            const stackSpacing = 7;
            const rowH = 16;
            const panelPad = 3;
            const panelW = 150;
            const inlineDurationW = 30;
            const inlineRemoveW = isDM ? 16 : 0;
            const inlineNameW = Math.max(48, panelW - 21 - inlineDurationW - inlineRemoveW - 12);
            const twoRowDurationW = 30;
            const twoRowNameW = Math.max(54, panelW - 21 - twoRowDurationW - 12);
            const visibleEffects = isEffectsExpanded ? displayStatusEffects : displayStatusEffects.slice(0, maxVisible);
            const extraCount = displayStatusEffects.length - maxVisible;
            const stackWidth = iconS + Math.max(0, Math.min(displayStatusEffects.length, maxVisible) - 1) * stackSpacing + (extraCount > 0 ? 12 : 0);
            const effectRowHeights2 = displayStatusEffects.map(e => {
              const hasAction = (isDM && (hasOngoingSave(e) || e.escape_action || (e.condition && !e.escape_action && !hasOngoingSave(e)))) || (e.condition === 'prone' && onStandUp);
              return hasAction ? rowH * 2 : rowH;
            });
            const totalEffectH2 = effectRowHeights2.reduce((s, h) => s + h, 0);
            const panelH = totalEffectH2 + panelPad * 2 + 12;
            const collapsedX = centerX - radius - 2;
            const collapsedY = centerY + radius - iconS / 2;
            const expandedX = centerX - radius - 6;
            const expandedY = centerY + radius + 18;
            return (
              <Group ref={effectsGroupRef} x={isEffectsExpanded ? expandedX : collapsedX} y={isEffectsExpanded ? expandedY : collapsedY}>
                {!isEffectsExpanded && (
                  <>
                    <Rect x={-2} y={-2} width={stackWidth + 4} height={iconS + 4} fill="transparent"
                      onClick={(e) => { e.cancelBubble = true; setIsEffectsExpanded(true); }}
                      onTap={(e) => { e.cancelBubble = true; setIsEffectsExpanded(true); }}
                    />
                    {visibleEffects.map((effect, idx) => {
                      if (!effect || typeof effect !== 'object') return null;
                      const duration = getEffectDurationValue(effect, currentTime);
                      const isLowDuration = duration != null && duration <= 3;
                      return (
                        <Group key={effect.id || idx} x={idx * stackSpacing} y={0} listening={false}>
                          {(() => {
                            const iconImg = effect.id ? effectIconImages[effect.id] : undefined;
                            if (iconImg instanceof HTMLImageElement) {
                              return <KonvaImage x={0} y={0} width={iconS} height={iconS} image={iconImg} cornerRadius={iconS / 2} listening={false} />;
                            }
                            return <Text x={0} y={0} width={iconS} height={iconS} text={effect.icon} fontSize={9} align="center" verticalAlign="middle" listening={false} />;
                          })()}
                          {isLowDuration && <Circle x={iconS - 1} y={iconS - 1} radius={2.5} fill="#ef4444" listening={false} />}
                        </Group>
                      );
                    })}
                    {extraCount > 0 && (
                      <Group x={iconS + (maxVisible - 1) * stackSpacing} y={0} listening={false}>
                        <Text x={0} y={0} width={12} height={iconS} text={`+${extraCount}`} fontSize={8} fontStyle="bold" fill="#fbbf24" align="center" verticalAlign="middle" listening={false} />
                      </Group>
                    )}
                  </>
                )}
                {isEffectsExpanded && (
                  <Group>
                    <Rect x={0} y={0} width={panelW} height={panelH} fill="rgba(17,24,39,0.92)" cornerRadius={5} stroke="#374151" strokeWidth={1} listening={false} />
                    {displayStatusEffects.map((effect, idx) => {
                      if (!effect || typeof effect !== 'object') return null;
                      const duration = getEffectDurationValue(effect, currentTime);
                      const isLowDuration = duration != null && duration <= 3;
                      const ry = panelPad + effectRowHeights2.slice(0, idx).reduce((s, h) => s + h, 0);
                      const iS = 12;
                      const hasSave = isDM && hasOngoingSave(effect);
                      const hasEscape = isDM && !!effect.escape_action && !!onEscapeAttempt;
                      const hasCondSave = isDM && !hasSave && !hasEscape && !!effect.condition;
                      const hasProne = effect.condition === 'prone' && !!onStandUp;
                      const isTwoRow = hasSave || hasCondSave || hasEscape || hasProne;
                      const thisH = isTwoRow ? rowH * 2 : rowH;
                      return (
                        <Group key={effect.id || idx} y={ry}>
                          <Rect x={2} y={0} width={panelW - 4} height={isTwoRow ? rowH : thisH} fill="transparent" cornerRadius={3}
                            onClick={(e) => { e.cancelBubble = true; if (onStatusEffectClick) onStatusEffectClick(effect); }}
                            onTap={(e) => { e.cancelBubble = true; if (onStatusEffectClick) onStatusEffectClick(effect); }}
                          />
                          <Rect x={3} y={2} width={2} height={thisH - 4} fill={effect.color} cornerRadius={1} listening={false} />
                          {(() => {
                            const iconImg = effect.id ? effectIconImages[effect.id] : undefined;
                            if (iconImg instanceof HTMLImageElement) {
                              return <KonvaImage x={7} y={(rowH - iS) / 2} width={iS} height={iS} image={iconImg} cornerRadius={iS / 2} listening={false} />;
                            }
                            return <Text x={7} y={0} width={iS} height={rowH} text={effect.icon} fontSize={9} align="center" verticalAlign="middle" listening={false} />;
                          })()}
                          <Text x={21} y={0} width={isTwoRow ? twoRowNameW : inlineNameW} height={rowH} text={effect.name} fontSize={8} fill="#e5e7eb" verticalAlign="middle" listening={false} ellipsis={true} wrap="none" />
                          {isTwoRow ? (
                            <>
                              {duration != null && (
                                <Text x={panelW - twoRowDurationW - 4} y={0} width={twoRowDurationW} height={rowH} text={formatEffectDuration(duration, isInCombat)} fontSize={7} fill={isLowDuration ? '#fca5a5' : '#9ca3af'} align="right" verticalAlign="middle" listening={false} />
                              )}
                              {hasSave && onOngoingSave && (
                                <Group
                                  x={panelW - 52} y={rowH}
                                  onClick={(e) => { e.cancelBubble = true; onOngoingSave(token.id, effect.id); }}
                                  onTap={(e) => { e.cancelBubble = true; onOngoingSave(token.id, effect.id); }}
                                >
                                  <Rect x={0} y={0} width={32} height={rowH - 2} fill="transparent" />
                                  <Rect x={0} y={1} width={32} height={rowH - 3} fill="#7c3aed" cornerRadius={3} opacity={0.8} listening={false} />
                                  <Text x={0} y={1} width={32} height={rowH - 3} text="豁免" fontSize={8} fill="#fff" align="center" verticalAlign="middle" listening={false} />
                                </Group>
                              )}
                              {hasEscape && (
                                <Group
                                  x={panelW - 52} y={rowH}
                                  onClick={(e) => { e.cancelBubble = true; onEscapeAttempt!(token.id, effect.id); }}
                                  onTap={(e) => { e.cancelBubble = true; onEscapeAttempt!(token.id, effect.id); }}
                                >
                                  <Rect x={0} y={0} width={32} height={rowH - 2} fill="transparent" />
                                  <Rect x={0} y={1} width={32} height={rowH - 3} fill="#2563eb" cornerRadius={3} opacity={0.8} listening={false} />
                                  <Text x={0} y={1} width={32} height={rowH - 3} text="挣脱" fontSize={8} fill="#fff" align="center" verticalAlign="middle" listening={false} />
                                </Group>
                              )}
                              {hasCondSave && onConditionSave && (
                                <Group
                                  x={panelW - 52} y={rowH}
                                  onClick={(e) => { e.cancelBubble = true; onConditionSave(token.id, effect.id); }}
                                  onTap={(e) => { e.cancelBubble = true; onConditionSave(token.id, effect.id); }}
                                >
                                  <Rect x={0} y={0} width={32} height={rowH - 2} fill="transparent" />
                                  <Rect x={0} y={1} width={32} height={rowH - 3} fill="#d97706" cornerRadius={3} opacity={0.8} listening={false} />
                                  <Text x={0} y={1} width={32} height={rowH - 3} text="豁免" fontSize={8} fill="#fff" align="center" verticalAlign="middle" listening={false} />
                                </Group>
                              )}
                              {hasProne && (
                                <Group
                                  x={isDM ? panelW - 52 : 7} y={rowH}
                                  onClick={(e) => { e.cancelBubble = true; onStandUp!(token.id, effect.id); }}
                                  onTap={(e) => { e.cancelBubble = true; onStandUp!(token.id, effect.id); }}
                                >
                                  <Rect x={0} y={0} width={32} height={rowH - 2} fill="transparent" />
                                  <Rect x={0} y={1} width={32} height={rowH - 3} fill="#0d9488" cornerRadius={3} opacity={0.8} listening={false} />
                                  <Text x={0} y={1} width={32} height={rowH - 3} text="起来" fontSize={8} fill="#fff" align="center" verticalAlign="middle" listening={false} />
                                </Group>
                              )}
                              {isDM && onStatusEffectRemove && canRemoveStatusEffect(effect) && (
                                <Group
                                  x={panelW - 16} y={rowH}
                                  onClick={(e) => { e.cancelBubble = true; onStatusEffectRemove(token.id, effect); }}
                                  onTap={(e) => { e.cancelBubble = true; onStatusEffectRemove(token.id, effect); }}
                                >
                                  <Rect x={0} y={0} width={14} height={rowH - 2} fill="transparent" />
                                  <Rect x={1} y={1} width={11} height={rowH - 3} fill="#dc2626" cornerRadius={3} opacity={0.7} listening={false} />
                                  <Text x={1} y={1} width={11} height={rowH - 3} text="✕" fontSize={7} fill="#fff" align="center" verticalAlign="middle" listening={false} />
                                </Group>
                              )}
                            </>
                          ) : (
                            <>
                              {duration != null && (
                                <Text x={panelW - inlineDurationW - inlineRemoveW - 4} y={0} width={inlineDurationW} height={rowH} text={formatEffectDuration(duration, isInCombat)} fontSize={7} fill={isLowDuration ? '#fca5a5' : '#9ca3af'} align="right" verticalAlign="middle" listening={false} />
                              )}
                              {isDM && onStatusEffectRemove && canRemoveStatusEffect(effect) && (
                                <Group
                                  x={panelW - 16} y={0}
                                  onClick={(e) => { e.cancelBubble = true; onStatusEffectRemove(token.id, effect); }}
                                  onTap={(e) => { e.cancelBubble = true; onStatusEffectRemove(token.id, effect); }}
                                >
                                  <Rect x={0} y={0} width={14} height={rowH} fill="transparent" />
                                  <Rect x={1} y={(rowH - 11) / 2} width={11} height={11} fill="#dc2626" cornerRadius={2} opacity={0.7} listening={false} />
                                  <Text x={1} y={(rowH - 11) / 2} width={11} height={11} text="✕" fontSize={7} fill="#fff" align="center" verticalAlign="middle" listening={false} />
                                </Group>
                              )}
                            </>
                          )}
                        </Group>
                      );
                    })}
                    <Group y={panelPad + totalEffectH2 + 1}>
                      <Rect x={2} y={0} width={panelW - 4} height={11} fill="transparent" cornerRadius={3}
                        onClick={(e) => { e.cancelBubble = true; setIsEffectsExpanded(false); }}
                        onTap={(e) => { e.cancelBubble = true; setIsEffectsExpanded(false); }}
                      />
                      <Text x={0} y={0} width={panelW} height={11} text="▲ 收起" fontSize={7} fill="#6b7280" align="center" verticalAlign="middle" listening={false} />
                    </Group>
                  </Group>
                )}
              </Group>
            );
          })()}
          {/* 名称标签 */}
          <Group x={centerX} y={centerY + radius + 4} listening={false}>
            <Rect
              x={-nameWidth / 2 - 4}
              y={0}
              width={nameWidth + 8}
              height={16}
              fill="rgba(0, 0, 0, 0.85)"
              cornerRadius={8}
            />
            <Text
              x={-nameWidth / 2}
              y={2}
              width={nameWidth}
              text={displayName}
              fontSize={10}
              fontFamily="Arial, sans-serif"
              fontStyle="bold"
              fill="#ffffff"
              align="center"
            />
          </Group>
          {/* 副标题标签 (种族/职业) - 只在选中时显示 */}
          {isSelected && subtitleText && (
            <Group x={centerX} y={centerY + radius + 21} listening={false}>
              <Rect
                x={-subtitleWidth / 2 - 3}
                y={0}
                width={subtitleWidth + 6}
                height={13}
                fill={subtitleBgColor}
                cornerRadius={6}
              />
              <Text
                x={-subtitleWidth / 2}
                y={1}
                width={subtitleWidth}
                text={subtitleText}
                fontSize={9}
                fontFamily="Arial, sans-serif"
                fill="#ffffff"
                align="center"
              />
            </Group>
          )}
          {/* HP数值 - 只在选中时显示，放在名字下方、血条上方 */}
          {isSelected && canSeeHP && currentHP !== null && (
            <Group x={centerX} y={centerY + radius + 21} listening={false}>
              <Rect
                x={tempHP ? -32 : -24}
                y={0}
                width={tempHP ? 64 : 48}
                height={14}
                fill={hpColor}
                cornerRadius={7}
              />
              <Text
                x={tempHP ? -32 : -24}
                y={1}
                width={tempHP ? 64 : 48}
                text={`${currentHP}/${maxHP || '?'}${tempHP ? `+${tempHP}` : ''}`}
                fontSize={10}
                fontFamily="Arial, sans-serif"
                fontStyle="bold"
                fill="#ffffff"
                align="center"
              />
            </Group>
          )}
        </>
      )}
    </Group>
  );
});

TokenComponent.displayName = "TokenComponent";
