import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Dialog, Flex, Box, Text, Button, ScrollArea } from '@radix-ui/themes';
import * as Select from '@radix-ui/react-select';
import { apiFetch } from '~/utils/api-client';
import { createLogger } from '~/utils/logger';
import { getAssetUrl } from '~/utils/asset-url';

const logger = createLogger('AddNPCModal');

interface NPCTemplate {
  id: string;
  name: string;
  nameEn: string;
  size: string;
  type: string;
  alignment: string;
  ac: number;
  acNote?: string;
  hp: number;
  hpFormula: string;
  speed: { walk?: number; fly?: number; swim?: number; burrow?: number; climb?: number };
  abilityScores: { str: number; dex: number; con: number; int: number; wis: number; cha: number };
  cr: string;
  xp: number;
  languages?: string[];
  skills?: string[];
  savingThrows?: string[];
  specialAbilities?: Array<{ name: string; nameEn?: string; description: string }>;
  actions?: Array<{ name: string; nameEn?: string; description: string }>;
  reactions?: Array<{ name: string; nameEn?: string; description: string }>;
  spellcasting?: any;
  description?: string;
  defaultAvatarSmall?: string;
  defaultAvatarLarge?: string;
}

// Lazy loading avatar component using Intersection Observer
function LazyAvatar({ src, alt }: { src: string; alt: string }) {
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
      { rootMargin: '100px' }
    );

    if (imgRef.current) {
      observer.observe(imgRef.current);
    }

    return () => observer.disconnect();
  }, []);

  // Resolve asset URL for local paths
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
        <div className="w-full h-full flex items-center justify-center text-xl">
          👤
        </div>
      )}
    </div>
  );
}

interface AddNPCModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaignId: string;
  onNPCAdded?: () => void;
}

// Styles
const styles = {
  modalContent: {
    background: 'linear-gradient(180deg, #1a1d24 0%, #13151a 100%)',
    border: '1px solid rgba(139, 92, 246, 0.15)',
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.8), inset 0 1px 0 rgba(255, 255, 255, 0.05)',
    width: 'min(900px, calc(100vw - 16px))',
    maxWidth: '900px',
    maxHeight: '90dvh',
    padding: 0,
    overflow: 'hidden',
  },
  header: {
    background: 'linear-gradient(180deg, rgba(139, 92, 246, 0.08) 0%, transparent 100%)',
    borderBottom: '1px solid rgba(139, 92, 246, 0.1)',
    padding: '12px 16px',
  },
  searchArea: {
    padding: '10px 12px',
    background: 'rgba(0, 0, 0, 0.2)',
    borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
  },
  npcCard: {
    background: 'linear-gradient(135deg, rgba(30, 34, 42, 0.9) 0%, rgba(22, 25, 31, 0.95) 100%)',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    borderRadius: '8px',
    overflow: 'hidden',
    transition: 'all 0.2s ease',
  },
  npcCardExpanded: {
    border: '1px solid rgba(139, 92, 246, 0.3)',
    boxShadow: '0 4px 20px rgba(139, 92, 246, 0.1)',
  },
  statBlock: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'column' as const,
    padding: '8px 12px',
    background: 'rgba(0, 0, 0, 0.3)',
    borderRadius: '6px',
    minWidth: '54px',
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

function getMod(score: number): number {
  return Math.floor((score - 10) / 2);
}

function formatMod(mod: number): string {
  return mod >= 0 ? `+${mod}` : `${mod}`;
}

function getCRColor(cr: string): string {
  const crNum = cr.includes('/') ? eval(cr) : parseFloat(cr);
  if (crNum <= 1) return '#22c55e';
  if (crNum <= 4) return '#eab308';
  if (crNum <= 10) return '#f97316';
  if (crNum <= 17) return '#ef4444';
  return '#dc2626';
}

export function AddNPCModal({ open, onOpenChange, campaignId, onNPCAdded }: AddNPCModalProps) {
  const [npcs, setNpcs] = useState<NPCTemplate[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'cr' | 'name'>('name');
  const [expandedNPC, setExpandedNPC] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      loadNPCs();
    }
  }, [open]);

  const loadNPCs = async () => {
    setIsLoading(true);
    try {
      const module = await import('~/data/rules/npc-templates.json');
      const data = module.default;
      setNpcs(data.npcs || []);
    } catch (error) {
      logger.error('[AddNPCModal] Failed to load NPCs:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const filteredNPCs = useMemo(() => {
    return npcs
      .filter(npc =>
        npc.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        npc.nameEn.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (npc.description && npc.description.toLowerCase().includes(searchQuery.toLowerCase()))
      )
      .sort((a, b) => {
        if (sortBy === 'cr') {
          const crA = a.cr.includes('/') ? eval(a.cr) : parseFloat(a.cr);
          const crB = b.cr.includes('/') ? eval(b.cr) : parseFloat(b.cr);
          return crA - crB;
        }
        return a.name.localeCompare(b.name, 'zh-CN');
      });
  }, [npcs, searchQuery, sortBy]);

  const handleAddNPC = async (npc: NPCTemplate) => {
    setAddingId(npc.id);
    try {
      const response = await apiFetch('/api/monster-instances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaign_id: parseInt(campaignId),
          monster_id: npc.id,
          name: npc.name,
          name_cn: npc.name,
          size: npc.size,
          type: npc.type,
          alignment: npc.alignment,
          challenge_rating: npc.cr,
          armor_class: npc.ac,
          hit_points: npc.hp,
          hit_dice: npc.hpFormula,
          ability_scores: npc.abilityScores,
          speeds: npc.speed,
          monster_data: {
            id: npc.id,
            name: npc.name,
            name_en: npc.nameEn,
            size: npc.size,
            type: npc.type,
            alignment: npc.alignment,
            cr: npc.cr,
            hp: npc.hp,
            hp_formula: npc.hpFormula,
            ac: npc.ac,
            ability_scores: npc.abilityScores,
            speeds: npc.speed,
            actions: npc.actions,
            reactions: npc.reactions,
            special_abilities: npc.specialAbilities,
            spellcasting: npc.spellcasting,
            description: npc.description,
            defaultAvatarSmall: npc.defaultAvatarSmall,
            defaultAvatarLarge: npc.defaultAvatarLarge,
          },
          entity_type: "npc",
          current_hp: npc.hp,
        }),
      });
      if (response.ok) {
        onNPCAdded?.();
      }
    } catch (error) {
      logger.error('[AddNPCModal] Error adding NPC:', error);
    } finally {
      setAddingId(null);
    }
  };

  const renderAbilityScores = (npc: NPCTemplate) => {
    const abilities = [
      { key: 'str', label: '力量', score: npc.abilityScores.str },
      { key: 'dex', label: '敏捷', score: npc.abilityScores.dex },
      { key: 'con', label: '体质', score: npc.abilityScores.con },
      { key: 'int', label: '智力', score: npc.abilityScores.int },
      { key: 'wis', label: '感知', score: npc.abilityScores.wis },
      { key: 'cha', label: '魅力', score: npc.abilityScores.cha },
    ];

    return (
      <div className="grid grid-cols-6 gap-2">
        {abilities.map(({ key, label, score }) => {
          const mod = getMod(score);
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

  const renderSpeed = (speed: NPCTemplate['speed']) => {
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

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange} {...{modal: false}}>
      <Dialog.Content aria-describedby={undefined} style={styles.modalContent}>
        {/* Header */}
        <div style={styles.header}>
          <div className="flex items-center justify-between">
            <Dialog.Title className="m-0">
              <div className="flex items-center gap-3">
                <span className="text-2xl">👤</span>
                <div>
                  <h2 className="text-xl font-bold text-white m-0" style={{ fontFamily: 'Georgia, serif' }}>
                    NPC 模板
                  </h2>
                  <p className="text-xs text-gray-400 mt-0.5">从预设模板中选择NPC添加到战役</p>
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
          <Flex gap="3" align="center">
            <Box style={{ flex: 1, position: 'relative' }}>
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">🔍</span>
              <input
                type="text"
                placeholder="搜索NPC名称、描述..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-gray-900/60 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-violet-500/50 transition-colors"
              />
            </Box>
            <Select.Root value={sortBy} onValueChange={(v: 'cr' | 'name') => setSortBy(v)}>
              <Select.Trigger className="px-4 py-2.5 bg-gray-900/60 border border-gray-700 rounded-lg text-sm text-gray-300 hover:border-gray-600 transition-colors cursor-pointer flex items-center gap-2">
                <span>📊</span>
                <Select.Value />
              </Select.Trigger>
              <Select.Content className="bg-gray-900 border border-gray-700 rounded-lg shadow-xl overflow-hidden z-50">
                <Select.Viewport>
                  <Select.Item value="name" className="px-4 py-2.5 text-sm text-gray-300 hover:bg-gray-800 cursor-pointer outline-none">
                    <Select.ItemText>按名称排序</Select.ItemText>
                  </Select.Item>
                  <Select.Item value="cr" className="px-4 py-2.5 text-sm text-gray-300 hover:bg-gray-800 cursor-pointer outline-none">
                    <Select.ItemText>按CR排序</Select.ItemText>
                  </Select.Item>
                </Select.Viewport>
              </Select.Content>
            </Select.Root>
            <div className="px-3 py-2 bg-gray-800/50 rounded-lg">
              <span className="text-xs text-gray-400">共 </span>
              <span className="text-sm text-violet-400 font-bold">{filteredNPCs.length}</span>
              <span className="text-xs text-gray-400"> 个</span>
            </div>
          </Flex>
        </div>

        {/* NPC List */}
        <ScrollArea style={{ height: 'calc(90dvh - 160px)' }}>
          <div className="p-3 space-y-3">
            {isLoading ? (
              <div className="flex items-center justify-center py-20">
                <div className="text-center">
                  <div className="animate-spin text-4xl mb-3">👤</div>
                  <Text size="2" color="gray"><span>正在加载NPC模板...</span></Text>
                </div>
              </div>
            ) : filteredNPCs.length > 0 ? (
              filteredNPCs.map(npc => {
                const isExpanded = expandedNPC === npc.id;
                const isAdding = addingId === npc.id;

                return (
                  <div
                    key={npc.id}
                    style={{
                      ...styles.npcCard,
                      ...(isExpanded ? styles.npcCardExpanded : {}),
                    }}
                  >
                    {/* Card Header */}
                    <div
                      className="p-4 cursor-pointer hover:bg-white/[0.02] transition-colors"
                      onClick={() => setExpandedNPC(isExpanded ? null : npc.id)}
                    >
                      <div className="flex justify-between items-start gap-4">
                        {/* Avatar */}
                        {npc.defaultAvatarSmall ? (
                          <LazyAvatar src={npc.defaultAvatarSmall} alt={npc.name} />
                        ) : (
                          <div className="w-12 h-12 rounded-lg overflow-hidden bg-gray-800/50 border border-gray-700/50 flex-shrink-0 flex items-center justify-center">
                            <span className="text-xl">👤</span>
                          </div>
                        )}

                        <div className="flex-1 min-w-0">
                          {/* Name Row */}
                          <div className="flex items-center gap-2 mb-2">
                            <h3 className="text-lg font-bold text-white truncate">{npc.name}</h3>
                            <span className="text-sm text-gray-500 truncate">({npc.nameEn})</span>
                            <span className={`ml-auto text-gray-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                              ▼
                            </span>
                          </div>

                          {/* Tags Row */}
                          <div className="flex flex-wrap gap-2 mb-3">
                            <span
                              className="px-2 py-0.5 rounded text-xs font-bold"
                              style={{
                                backgroundColor: `${getCRColor(npc.cr)}20`,
                                color: getCRColor(npc.cr),
                                border: `1px solid ${getCRColor(npc.cr)}40`
                              }}
                            >
                              CR {npc.cr}
                            </span>
                            <span className="px-2 py-0.5 bg-gray-800 rounded text-xs text-gray-300">
                              {npc.size}
                            </span>
                            <span className="px-2 py-0.5 bg-violet-900/30 rounded text-xs text-violet-300 border border-violet-700/30">
                              {npc.type}
                            </span>
                            {npc.alignment && (
                              <span className="px-2 py-0.5 bg-gray-800/50 rounded text-xs text-gray-400">
                                {npc.alignment}
                              </span>
                            )}
                          </div>

                          {/* Quick Stats */}
                          <div className="flex items-center gap-4">
                            <div className="flex items-center gap-1.5">
                              <span className="text-blue-400 text-sm">🛡️</span>
                              <span className="text-xs text-gray-400">AC</span>
                              <span className="text-sm font-bold text-blue-400">{typeof npc.ac === 'object' ? ((npc.ac as any)?.value || (npc.ac as any)?.base || '') : npc.ac}</span>
                              {npc.acNote && <span className="text-xs text-gray-500">({npc.acNote})</span>}
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-red-400 text-sm">❤️</span>
                              <span className="text-xs text-gray-400">HP</span>
                              <span className="text-sm font-bold text-red-400">{typeof npc.hp === 'object' ? ((npc.hp as any)?.average || (npc.hp as any)?.dice || '') : npc.hp}</span>
                              <span className="text-xs text-gray-500">({npc.hpFormula})</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className="text-yellow-400 text-sm">⭐</span>
                              <span className="text-xs text-gray-400">XP</span>
                              <span className="text-sm font-bold text-yellow-400">{npc.xp}</span>
                            </div>
                          </div>
                        </div>

                        {/* Add Button */}
                        <div className="shrink-0">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleAddNPC(npc);
                            }}
                            disabled={isAdding}
                            className={`
                              px-4 py-2 rounded-lg text-sm font-medium transition-all
                              ${isAdding
                                ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                                : 'bg-gradient-to-r from-violet-600 to-violet-700 text-white hover:from-violet-500 hover:to-violet-600 shadow-lg shadow-violet-900/30'
                              }
                            `}
                          >
                            {isAdding ? '添加中...' : '添加'}
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Expanded Content */}
                    {isExpanded && (
                      <div className="border-t border-gray-700/50 bg-black/20">
                        <div className="p-4 space-y-4">
                          {/* Description */}
                          {npc.description && (
                            <div className="p-3 bg-gray-900/40 rounded-lg border border-gray-800">
                              <p className="text-sm text-gray-300 leading-relaxed">
                                {npc.description}
                              </p>
                            </div>
                          )}

                          {/* Ability Scores */}
                          <div>
                            <h4 className="text-xs text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                              <span>📊</span> 属性值
                            </h4>
                            {renderAbilityScores(npc)}
                          </div>

                          {/* Speed */}
                          <div>
                            <h4 className="text-xs text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                              <span>👟</span> 速度
                            </h4>
                            {renderSpeed(npc.speed)}
                          </div>

                          {/* Skills */}
                          {npc.skills && npc.skills.length > 0 && (
                            <div>
                              <h4 className="text-xs text-gray-400 uppercase tracking-wider mb-2">技能</h4>
                              <div className="flex flex-wrap gap-2">
                                {npc.skills.map((skill, idx) => (
                                  <span key={idx} className="px-2 py-1 bg-cyan-900/30 rounded text-xs text-cyan-300">
                                    {skill}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Spellcasting */}
                          {npc.spellcasting && (
                            <div className="p-3 bg-indigo-900/20 rounded-lg border border-indigo-700/30">
                              <h4 className="text-xs text-indigo-300 uppercase tracking-wider mb-2 flex items-center gap-2">
                                <span>✨</span> 施法能力
                              </h4>
                              <div className="text-xs text-gray-300">
                                <p>施法属性: {npc.spellcasting.ability} | DC {npc.spellcasting.dc} | 攻击 +{npc.spellcasting.attackBonus}</p>
                              </div>
                            </div>
                          )}

                          {/* Special Abilities */}
                          {npc.specialAbilities && npc.specialAbilities.length > 0 && (
                            <div style={styles.abilitySection}>
                              <h4 className="text-xs text-purple-300 uppercase tracking-wider mb-3 flex items-center gap-2">
                                <span>✨</span> 特殊能力
                              </h4>
                              <div className="space-y-3">
                                {npc.specialAbilities.map((ability, idx) => (
                                  <div key={idx}>
                                    <span className="text-purple-300 font-semibold text-sm">{ability.name}</span>
                                    <p className="text-xs text-gray-400 mt-1 leading-relaxed">{ability.description}</p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Actions */}
                          {npc.actions && npc.actions.length > 0 && (
                            <div style={styles.actionSection}>
                              <h4 className="text-xs text-amber-300 uppercase tracking-wider mb-3 flex items-center gap-2">
                                <span>⚔️</span> 动作
                              </h4>
                              <div className="space-y-3">
                                {npc.actions.map((action, idx) => (
                                  <div key={idx}>
                                    <span className="text-amber-300 font-semibold text-sm">{action.name}</span>
                                    <p className="text-xs text-gray-400 mt-1 leading-relaxed">{action.description}</p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Reactions */}
                          {npc.reactions && npc.reactions.length > 0 && (
                            <div className="p-3 bg-cyan-900/20 rounded-lg border-l-3 border-cyan-500/50">
                              <h4 className="text-xs text-cyan-300 uppercase tracking-wider mb-3 flex items-center gap-2">
                                <span>⚡</span> 反应
                              </h4>
                              <div className="space-y-3">
                                {npc.reactions.map((reaction, idx) => (
                                  <div key={idx}>
                                    <span className="text-cyan-300 font-semibold text-sm">{reaction.name}</span>
                                    <p className="text-xs text-gray-400 mt-1 leading-relaxed">{reaction.description}</p>
                                  </div>
                                ))}
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
                    <span>{searchQuery ? '未找到匹配的NPC' : '暂无NPC模板数据'}</span>
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
