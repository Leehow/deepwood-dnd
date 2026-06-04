import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Dialog, Flex, Box, Text, TextField, Button, ScrollArea } from '@radix-ui/themes';
import * as Select from '@radix-ui/react-select';
import { apiFetch } from '~/utils/api-client';
import { createLogger } from '~/utils/logger';
import { getAssetUrl } from '~/utils/asset-url';

const logger = createLogger('AddMonsterModal');

// Generate monster avatar path from English name
function getMonsterAvatarPath(nameEn: string, size: 128 | 512 = 128): string {
  const slug = nameEn.toLowerCase().replace(/\s+/g, '_');
  return `/assets/monster-avatars/${slug}_${size}.webp`;
}

// Lazy loaded avatar component using Intersection Observer
const LazyAvatar = React.memo(({ src, alt }: { src: string; alt: string }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const imgRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '100px' } // 提前 100px 开始加载
    );

    if (imgRef.current) {
      observer.observe(imgRef.current);
    }

    return () => observer.disconnect();
  }, []);

  // 解析本地资源路径
  const resolvedSrc = src.startsWith('/assets/') ? getAssetUrl(src.slice(1)) : src;

  return (
    <div
      ref={imgRef}
      className="w-12 h-12 rounded-lg overflow-hidden bg-gray-800/50 border border-gray-700/50 flex-shrink-0"
    >
      {isVisible && (
        <img
          src={resolvedSrc}
          alt={alt}
          className={`w-full h-full object-cover transition-opacity duration-300 ${isLoaded ? 'opacity-100' : 'opacity-0'}`}
          onLoad={() => setIsLoaded(true)}
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
      )}
      {(!isVisible || !isLoaded) && (
        <div className="w-full h-full flex items-center justify-center text-xl opacity-30">
          👹
        </div>
      )}
    </div>
  );
});

interface DamageEntry {
  dice: string;
  avg?: number;
  type: string;
}

interface MonsterAction {
  name: string;
  description: string;
  actionType?: 'melee' | 'ranged' | 'multiattack' | 'ability';
  attackBonus?: number;
  reach?: number;
  range?: { normal: number; long?: number };
  damage?: DamageEntry[];
  dc?: { value: number; ability: string };
}

interface Monster {
  id: string;
  name: string;
  nameEn: string;
  size: string;
  type: string;
  alignment: string;
  ac: number;
  hp: number;
  hpFormula: string;
  cr: string;
  xp: number;
  defaultAvatarSmall?: string;  // 预设头像 128x128
  defaultAvatarLarge?: string;  // 预设头像 512x512
  speed: {
    walk?: number;
    fly?: number;
    swim?: number;
    burrow?: number;
    climb?: number;
  };
  abilityScores: {
    str: number;
    strMod?: number;
    dex: number;
    dexMod?: number;
    con: number;
    conMod?: number;
    int: number;
    intMod?: number;
    wis: number;
    wisMod?: number;
    cha: number;
    chaMod?: number;
  };
  // Also check top-level mods
  strMod?: number;
  dexMod?: number;
  conMod?: number;
  intMod?: number;
  wisMod?: number;
  chaMod?: number;
  description?: string;
  appearance?: string;
  specialAbilities?: Array<{ name: string; description: string }>;
  actions?: MonsterAction[];
  reactions?: MonsterAction[];
  legendaryActions?: {
    description: string;
    actions: MonsterAction[];
  };
  senses?: Record<string, number | string>;
  languages?: string[];
}

interface AddMonsterModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaignId: string;
  onMonsterAdded?: () => void;
}

// Styles as CSS-in-JS object
const styles = {
  modalContent: {
    background: 'linear-gradient(180deg, #1a1d24 0%, #13151a 100%)',
    border: '1px solid rgba(212, 175, 55, 0.15)',
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.8), inset 0 1px 0 rgba(255, 255, 255, 0.05)',
    width: 'min(900px, calc(100vw - 16px))',
    maxWidth: '900px',
    maxHeight: '90dvh',
    padding: 0,
    overflow: 'hidden',
  },
  header: {
    background: 'linear-gradient(180deg, rgba(212, 175, 55, 0.08) 0%, transparent 100%)',
    borderBottom: '1px solid rgba(212, 175, 55, 0.1)',
    padding: '12px 16px',
  },
  searchArea: {
    padding: '10px 12px',
    background: 'rgba(0, 0, 0, 0.2)',
    borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
  },
  monsterCard: {
    background: 'linear-gradient(135deg, rgba(30, 34, 42, 0.9) 0%, rgba(22, 25, 31, 0.95) 100%)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: '8px',
    overflow: 'hidden',
    transition: 'all 0.2s ease',
  },
  monsterCardExpanded: {
    border: '1px solid rgba(212, 175, 55, 0.3)',
    boxShadow: '0 4px 20px rgba(212, 175, 55, 0.1)',
  },
  statBlock: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'column' as const,
    padding: '6px 8px',
    background: 'rgba(0, 0, 0, 0.3)',
    borderRadius: '6px',
    minWidth: '42px',
  },
  abilitySection: {
    background: 'rgba(139, 92, 246, 0.08)',
    borderLeft: '3px solid rgba(139, 92, 246, 0.5)',
    padding: '12px 16px',
    borderRadius: '0 6px 6px 0',
    marginBottom: '12px',
  },
  actionSection: {
    background: 'rgba(245, 158, 11, 0.08)',
    borderLeft: '3px solid rgba(245, 158, 11, 0.5)',
    padding: '12px 16px',
    borderRadius: '0 6px 6px 0',
  },
} as const;

// Helper to calculate modifier
function getMod(score: number): number {
  return Math.floor((score - 10) / 2);
}

// Format modifier with sign
function formatMod(mod: number): string {
  return mod >= 0 ? `+${mod}` : `${mod}`;
}

// CR color based on difficulty
function getCRColor(cr: string | number): string {
  const crStr = String(cr ?? '0');
  const crNum = crStr.includes('/') ? eval(crStr) : parseFloat(crStr);
  if (crNum <= 1) return '#22c55e';
  if (crNum <= 4) return '#eab308';
  if (crNum <= 10) return '#f97316';
  if (crNum <= 17) return '#ef4444';
  return '#dc2626';
}

// Size icon
function getSizeIcon(size: string): string {
  const sizeMap: Record<string, string> = {
    '微型': '●',
    '超小型': '◉',
    '小型': '◎',
    '中型': '○',
    '大型': '◯',
    '巨型': '⬡',
    '超巨型': '⬢',
  };
  return sizeMap[size] || '○';
}

export function AddMonsterModal({ open, onOpenChange, campaignId, onMonsterAdded }: AddMonsterModalProps) {
  const [monsters, setMonsters] = useState<Monster[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'cr' | 'name'>('cr');
  const [expandedMonster, setExpandedMonster] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      loadMonsters();
    }
  }, [open]);

  const loadMonsters = async () => {
    setIsLoading(true);
    try {
      const module = await import('~/data/npc/monsters.json');
      const data = module.default;
      setMonsters((data.monsters || []) as unknown as Monster[]);
    } catch (error) {
      logger.error('[AddMonsterModal] Failed to load monsters:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const filteredMonsters = useMemo(() => {
    return monsters
      .filter(monster =>
        monster.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        monster.nameEn.toLowerCase().includes(searchQuery.toLowerCase()) ||
        monster.type.toLowerCase().includes(searchQuery.toLowerCase())
      )
      .sort((a, b) => {
        if (sortBy === 'cr') {
          const crStrA = String(a.cr ?? '0');
          const crStrB = String(b.cr ?? '0');
          const crA = crStrA.includes('/') ? eval(crStrA) : parseFloat(crStrA);
          const crB = crStrB.includes('/') ? eval(crStrB) : parseFloat(crStrB);
          return crA - crB;
        }
        return a.name.localeCompare(b.name, 'zh-CN');
      });
  }, [monsters, searchQuery, sortBy]);

  const handleAddMonster = async (monster: Monster) => {
    setAddingId(monster.id);
    try {
      const response = await apiFetch('/api/monster-instances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaign_id: parseInt(campaignId),
          monster_id: monster.id,
          name: monster.name,
          name_cn: monster.name,
          size: monster.size,
          type: monster.type,
          alignment: monster.alignment,
          challenge_rating: String(monster.cr),
          armor_class: monster.ac,
          hit_points: monster.hp,
          hit_dice: monster.hpFormula,
          ability_scores: monster.abilityScores,
          speeds: monster.speed,
          monster_data: {
            id: monster.id,
            name: monster.name,
            name_en: monster.nameEn,
            size: monster.size,
            type: monster.type,
            alignment: monster.alignment,
            cr: monster.cr,
            hp: monster.hp,
            hp_formula: monster.hpFormula,
            ac: monster.ac,
            ability_scores: monster.abilityScores,
            speeds: monster.speed,
            actions: monster.actions,
            reactions: monster.reactions,
            special_abilities: monster.specialAbilities,
            legendary_actions: monster.legendaryActions,
            description: monster.description,
            defaultAvatarSmall: getMonsterAvatarPath(monster.nameEn, 128),
            defaultAvatarLarge: getMonsterAvatarPath(monster.nameEn, 512),
          },
          current_hp: monster.hp,
        }),
      });
      if (response.ok) {
        onMonsterAdded?.();
      }
    } catch (error) {
      logger.error('[AddMonsterModal] Error adding monster:', error);
    } finally {
      setAddingId(null);
    }
  };

  const renderAbilityScores = (monster: Monster) => {
    const abilities = [
      { key: 'str', label: '力量', score: monster.abilityScores.str },
      { key: 'dex', label: '敏捷', score: monster.abilityScores.dex },
      { key: 'con', label: '体质', score: monster.abilityScores.con },
      { key: 'int', label: '智力', score: monster.abilityScores.int },
      { key: 'wis', label: '感知', score: monster.abilityScores.wis },
      { key: 'cha', label: '魅力', score: monster.abilityScores.cha },
    ];

    return (
      <div className="grid grid-cols-6 gap-1 sm:gap-2">
        {abilities.map(({ key, label, score }) => {
          const modKey = `${key}Mod` as keyof typeof monster.abilityScores;
          const mod = monster.abilityScores[modKey] as number | undefined
            ?? (monster as unknown as Record<string, number | undefined>)[modKey]
            ?? getMod(score);
          return (
            <div key={key} style={styles.statBlock}>
              <span className="text-[10px] text-gray-400 uppercase tracking-wider">{label}</span>
              <span className="text-lg font-bold text-white">{score}</span>
              <span className={`text-xs font-medium ${mod >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {formatMod(mod)}
              </span>
            </div>
          );
        })}
      </div>
    );
  };

  const renderSpeed = (speed: Monster['speed']) => {
    const speedTypes = [
      { key: 'walk', label: '步行', icon: '🚶' },
      { key: 'fly', label: '飞行', icon: '🦅' },
      { key: 'swim', label: '游泳', icon: '🏊' },
      { key: 'burrow', label: '掘地', icon: '⛏️' },
      { key: 'climb', label: '攀爬', icon: '🧗' },
    ];

    const activeSpeedsArr = speedTypes.filter(s => speed[s.key as keyof typeof speed]);
    if (activeSpeedsArr.length === 0) return null;

    return (
      <div className="flex flex-wrap gap-2">
        {activeSpeedsArr.map(({ key, label, icon }) => (
          <span key={key} className="px-2 py-1 bg-gray-800/50 rounded text-xs text-gray-300">
            {icon} {label} {speed[key as keyof typeof speed]}尺
          </span>
        ))}
      </div>
    );
  };

  // Translate damage type to Chinese
  const translateDamageType = (type: string): string => {
    const typeMap: Record<string, string> = {
      'slashing': '挥砍', 'piercing': '穿刺', 'bludgeoning': '钝击',
      'fire': '火焰', 'cold': '寒冷', 'lightning': '闪电',
      'thunder': '雷鸣', 'acid': '强酸', 'poison': '毒素',
      'necrotic': '黯蚀', 'radiant': '光辉', 'force': '力场', 'psychic': '心灵',
    };
    return typeMap[type.toLowerCase()] || type;
  };

  const actionTypeLabel = (t: string) => {
    switch (t) {
      case 'melee': return '近战';
      case 'ranged': return '远程';
      case 'multiattack': return '多重攻击';
      case 'ability': return '特殊';
      default: return t;
    }
  };

  const actionTypeColor = (t: string) => {
    switch (t) {
      case 'melee': return 'bg-red-900/30 text-red-400 border-red-800/50';
      case 'ranged': return 'bg-blue-900/30 text-blue-400 border-blue-800/50';
      case 'multiattack': return 'bg-purple-900/30 text-purple-400 border-purple-800/50';
      case 'ability': return 'bg-cyan-900/30 text-cyan-400 border-cyan-800/50';
      default: return 'bg-gray-800/30 text-gray-400 border-gray-700/50';
    }
  };

  const abilityLabel: Record<string, string> = {
    str: '力量', dex: '敏捷', con: '体质', int: '智力', wis: '感知', cha: '魅力',
  };

  const renderAction = (action: MonsterAction, idx: number) => {
    const hasStructured = action.actionType || action.attackBonus !== undefined || action.damage || action.dc;

    return (
      <div key={idx} className="mb-3 last:mb-0">
        {/* Action name + type tag */}
        <div className="flex items-center gap-2 mb-1">
          <span className="text-amber-300 font-semibold text-sm">{action.name}</span>
          {action.actionType && (
            <span className={`px-1.5 py-0.5 rounded text-[10px] border ${actionTypeColor(action.actionType)}`}>
              {actionTypeLabel(action.actionType)}
            </span>
          )}
        </div>

        {/* Structured stats row */}
        {hasStructured && action.actionType !== 'multiattack' && (
          <div className="flex flex-wrap gap-x-3 gap-y-1 mb-1.5 text-xs">
            {action.attackBonus !== undefined && (
              <span className="text-emerald-400 font-medium">
                +{action.attackBonus} 命中
              </span>
            )}
            {action.reach && (
              <span className="text-gray-400">触及 {action.reach}尺</span>
            )}
            {action.range && (
              <span className="text-gray-400">
                射程 {action.range.normal}{action.range.long ? `/${action.range.long}` : ''}尺
              </span>
            )}
            {action.damage && action.damage.length > 0 && (
              <span className="text-red-400 font-medium">
                {action.damage.map((d, i) => (
                  <span key={i}>
                    {i > 0 && ' + '}
                    {d.avg ? `${d.avg}` : ''}{d.avg ? `(${d.dice})` : d.dice} {translateDamageType(d.type)}
                  </span>
                ))}
              </span>
            )}
            {action.dc && (
              <span className="text-yellow-400">
                DC {action.dc.value} {abilityLabel[action.dc.ability] || action.dc.ability}
              </span>
            )}
          </div>
        )}

        {/* Description text */}
        <p className="text-xs text-gray-400 leading-relaxed">{action.description}</p>
      </div>
    );
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange} {...{modal: false}}>
      <Dialog.Content aria-describedby={undefined} style={styles.modalContent}>
        {/* Header */}
        <div style={styles.header}>
          <div className="flex items-center justify-between">
            <Dialog.Title className="m-0">
              <div className="flex items-center gap-2">
                <span className="text-xl sm:text-2xl">📖</span>
                <div>
                  <h2 className="text-base sm:text-xl font-bold text-white m-0" style={{ fontFamily: 'Georgia, serif' }}>
                    怪物图鉴
                  </h2>
                  <p className="text-[10px] sm:text-xs text-gray-400 mt-0.5 hidden sm:block">从图鉴中选择怪物添加到战役资源库</p>
                </div>
              </div>
            </Dialog.Title>
            <Dialog.Close className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg bg-gray-700/50 hover:bg-gray-600/50 text-gray-400 hover:text-white transition-colors">
              <span>✕</span>
            </Dialog.Close>
          </div>
        </div>

        {/* Search Area */}
        <div style={styles.searchArea}>
          <Flex gap="2" align="center" wrap="wrap">
            <Box style={{ flex: '1 1 180px', position: 'relative', minWidth: 0 }}>
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">🔍</span>
              <input
                type="text"
                placeholder="搜索怪物名称、类型..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-gray-900/60 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-amber-500/50 transition-colors"
              />
            </Box>
            <Flex gap="2" align="center" className="flex-shrink-0">
              <Select.Root value={sortBy} onValueChange={(v: 'cr' | 'name') => setSortBy(v)}>
                <Select.Trigger className="px-3 py-2 bg-gray-900/60 border border-gray-700 rounded-lg text-sm text-gray-300 hover:border-gray-600 transition-colors cursor-pointer flex items-center gap-1.5">
                  <span>📊</span>
                  <Select.Value />
                </Select.Trigger>
              <Select.Content className="bg-gray-900 border border-gray-700 rounded-lg shadow-xl overflow-hidden z-50">
                <Select.Viewport>
                  <Select.Item value="cr" className="px-4 py-2.5 text-sm text-gray-300 hover:bg-gray-800 cursor-pointer outline-none">
                    <Select.ItemText>按CR排序</Select.ItemText>
                  </Select.Item>
                  <Select.Item value="name" className="px-4 py-2.5 text-sm text-gray-300 hover:bg-gray-800 cursor-pointer outline-none">
                    <Select.ItemText>按名称排序</Select.ItemText>
                  </Select.Item>
                </Select.Viewport>
              </Select.Content>
            </Select.Root>
              <div className="px-2 py-1.5 bg-gray-800/50 rounded-lg">
                <span className="text-xs text-gray-400">共 </span>
                <span className="text-sm text-amber-400 font-bold">{filteredMonsters.length}</span>
                <span className="text-xs text-gray-400"> 只</span>
              </div>
            </Flex>
          </Flex>
        </div>

        {/* Monster List */}
        <ScrollArea style={{ height: 'calc(90dvh - 160px)' }}>
          <div className="p-3 space-y-2">
            {isLoading ? (
              <div className="flex items-center justify-center py-20">
                <div className="text-center">
                  <div className="animate-spin text-4xl mb-3">⚔️</div>
                  <Text size="2" color="gray"><span>正在加载怪物图鉴...</span></Text>
                </div>
              </div>
            ) : filteredMonsters.length > 0 ? (
              filteredMonsters.map(monster => {
                const isExpanded = expandedMonster === monster.id;
                const isAdding = addingId === monster.id;

                return (
                  <div
                    key={monster.id}
                    style={{
                      ...styles.monsterCard,
                      ...(isExpanded ? styles.monsterCardExpanded : {}),
                    }}
                  >
                    {/* Card Header - Clickable to expand */}
                    <div
                      className="p-3 cursor-pointer hover:bg-white/[0.02] transition-colors"
                      onClick={() => setExpandedMonster(isExpanded ? null : monster.id)}
                    >
                      <div className="flex justify-between items-start gap-2 sm:gap-4">
                        {/* Left: Monster Info */}
                        <div className="flex-1 min-w-0 flex gap-2 sm:gap-3">
                          {/* Avatar */}
                          {monster.nameEn ? (
                            <LazyAvatar src={monster.defaultAvatarSmall || getMonsterAvatarPath(monster.nameEn)} alt={monster.name} />
                          ) : (
                            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-lg overflow-hidden bg-gray-800/50 border border-gray-700/50 flex-shrink-0 flex items-center justify-center">
                              <span className="text-lg sm:text-xl" title={monster.size}>{getSizeIcon(monster.size)}</span>
                            </div>
                          )}

                          <div className="flex-1 min-w-0">
                            {/* Name Row */}
                            <div className="flex items-center gap-1 sm:gap-2 mb-1 sm:mb-2">
                              <h3 className="text-sm sm:text-lg font-bold text-white truncate">{monster.name}</h3>
                              <span className="text-xs sm:text-sm text-gray-500 truncate hidden sm:inline">({monster.nameEn})</span>
                              <span className={`ml-auto text-gray-500 transition-transform text-xs ${isExpanded ? 'rotate-180' : ''}`}>
                                ▼
                              </span>
                            </div>

                            {/* Tags Row */}
                            <div className="flex flex-wrap gap-1 sm:gap-2 mb-1.5 sm:mb-3">
                              <span
                                className="px-1.5 sm:px-2 py-0.5 rounded text-[10px] sm:text-xs font-bold"
                                style={{
                                  backgroundColor: `${getCRColor(monster.cr)}20`,
                                  color: getCRColor(monster.cr),
                                  border: `1px solid ${getCRColor(monster.cr)}40`
                                }}
                              >
                                CR {monster.cr}
                              </span>
                              <span className="px-1.5 sm:px-2 py-0.5 bg-gray-800 rounded text-[10px] sm:text-xs text-gray-300">
                                {monster.size}
                              </span>
                              <span className="px-1.5 sm:px-2 py-0.5 bg-gray-800 rounded text-[10px] sm:text-xs text-gray-300">
                                {monster.type}
                              </span>
                            </div>

                            {/* Quick Stats */}
                            <div className="flex items-center gap-2 sm:gap-4 flex-wrap">
                              <div className="flex items-center gap-1">
                                <span className="text-xs text-gray-400">AC</span>
                                <span className="text-xs sm:text-sm font-bold text-blue-400">{typeof monster.ac === 'object' ? ((monster.ac as any)?.value || (monster.ac as any)?.base || '') : monster.ac}</span>
                              </div>
                              <div className="flex items-center gap-1">
                                <span className="text-xs text-gray-400">HP</span>
                                <span className="text-xs sm:text-sm font-bold text-red-400">{typeof monster.hp === 'object' ? ((monster.hp as any)?.average || (monster.hp as any)?.dice || '') : monster.hp}</span>
                              </div>
                              <div className="flex items-center gap-1">
                                <span className="text-xs text-gray-400">XP</span>
                                <span className="text-xs sm:text-sm font-bold text-yellow-400">{monster.xp}</span>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Right: Add Button */}
                        <div className="shrink-0">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleAddMonster(monster);
                            }}
                            disabled={isAdding}
                            className={`
                              px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg text-xs sm:text-sm font-medium transition-all
                              ${isAdding
                                ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                                : 'bg-gradient-to-r from-amber-600 to-amber-700 text-white hover:from-amber-500 hover:to-amber-600 shadow-lg shadow-amber-900/30'
                              }
                            `}
                          >
                            {isAdding ? '...' : '添加'}
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Expanded Content */}
                    {isExpanded && (
                      <div className="border-t border-gray-700/50 bg-black/20">
                        <div className="p-3 space-y-3">
                          {/* Description */}
                          {monster.description && (
                            <div className="p-3 bg-gray-900/40 rounded-lg border border-gray-800">
                              <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-line">
                                {monster.description}
                              </p>
                            </div>
                          )}

                          {/* Ability Scores */}
                          <div>
                            <h4 className="text-xs text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                              <span>📊</span> 属性值
                            </h4>
                            {renderAbilityScores(monster)}
                          </div>

                          {/* Speed */}
                          <div>
                            <h4 className="text-xs text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                              <span>👟</span> 速度
                            </h4>
                            {renderSpeed(monster.speed)}
                          </div>

                          {/* Special Abilities */}
                          {monster.specialAbilities && monster.specialAbilities.length > 0 && (
                            <div style={styles.abilitySection}>
                              <h4 className="text-xs text-purple-300 uppercase tracking-wider mb-3 flex items-center gap-2">
                                <span>✨</span> 特殊能力
                              </h4>
                              <div className="space-y-3">
                                {monster.specialAbilities.map((ability, idx) => (
                                  <div key={idx}>
                                    <span className="text-purple-300 font-semibold text-sm">{ability.name}</span>
                                    <p className="text-xs text-gray-400 mt-1 leading-relaxed">{ability.description}</p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Actions */}
                          {monster.actions && monster.actions.length > 0 && (
                            <div style={styles.actionSection}>
                              <h4 className="text-xs text-amber-300 uppercase tracking-wider mb-3 flex items-center gap-2">
                                <span>⚔️</span> 动作
                              </h4>
                              <div>
                                {monster.actions.map((action, idx) => renderAction(action, idx))}
                              </div>
                            </div>
                          )}

                          {/* Legendary Actions */}
                          {monster.legendaryActions && monster.legendaryActions.actions?.length > 0 && (
                            <div style={{
                              background: 'rgba(234, 179, 8, 0.08)',
                              borderLeft: '3px solid rgba(234, 179, 8, 0.5)',
                              padding: '12px 16px',
                              borderRadius: '0 6px 6px 0',
                            }}>
                              <h4 className="text-xs text-yellow-300 uppercase tracking-wider mb-2 flex items-center gap-2">
                                <span>👑</span> 传奇动作
                              </h4>
                              {monster.legendaryActions.description && (
                                <p className="text-xs text-gray-400 mb-3">{monster.legendaryActions.description}</p>
                              )}
                              <div>
                                {monster.legendaryActions.actions.map((action, idx) => renderAction(action, idx))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              <div className="flex items-center justify-center py-20">
                <div className="text-center">
                  <span className="text-4xl mb-3 block opacity-50">🔍</span>
                  <Text size="2" color="gray">
                    <span>{searchQuery ? '未找到匹配的怪物' : '暂无怪物数据'}</span>
                  </Text>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Footer */}
        <div className="p-3 border-t border-gray-800 bg-gray-900/50">
          <Flex justify="end">
            <Dialog.Close>
              <Button variant="soft" color="gray" className="px-6">
                <span>关闭</span>
              </Button>
            </Dialog.Close>
          </Flex>
        </div>
      </Dialog.Content>
    </Dialog.Root>
  );
}
