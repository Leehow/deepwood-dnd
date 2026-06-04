/**
 * TransformationModal - Universal creature selection for all full_replace transformations
 * Supports: Wild Shape, Polymorph, True Polymorph, Shapechange, Animal Shapes, Giant Insect
 * Config-driven via transformation_configs.json
 */
import { useState, useMemo, useEffect } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import type { TransformationData } from './types/TacticalMapTypes';
import { getAssetUrl } from '~/utils/asset-url';
import { useModalContextStore } from '~/stores/modalContextStore';
import { isClickInsideFloatingChat } from '~/utils/floatingChatGuard';

// --- Types ---

interface TransformationConfig {
  type: string;
  sourceType: string;
  name: string;
  nameEn: string;
  creaturePool?: {
    types: string[];
    crLimit?: { formula: string; value?: number };
    movementGates?: Record<string, { minLevel: number }>;
    fixedOptions?: string[];
    sizeLimit?: string;
  };
  statRules?: {
    replacePhysical?: boolean;
    replaceMental?: boolean;
    retainProficiencies?: boolean;
    retainClassFeatures?: boolean;
  };
  hpRules?: { overflowDamage?: boolean; revertOnZeroHP?: boolean };
  restrictions?: Record<string, any>;
  subclassOverrides?: Record<string, any>;
  targets?: string;
}

interface Creature {
  id: string;
  name: string;
  nameEn: string;
  size: string;
  type: string;
  ac: number;
  hp: number;
  hpFormula?: string;
  speed: { walk?: number; swim?: number; fly?: number; climb?: number; burrow?: number };
  abilityScores: {
    str: number; strMod: number; dex: number; dexMod: number;
    con: number; conMod: number; int: number; intMod: number;
    wis: number; wisMod: number; cha: number; chaMod: number;
  };
  cr: string;
  actions?: Array<{ name: string; description: string; attack_bonus?: number; damage?: { dice: string; bonus?: number; type?: string } }>;
  specialAbilities?: Array<{ name: string; description: string }>;
}

// --- Config theme per transformation type ---

const CONFIG_THEMES: Record<string, { color: string; btnClass: string; icon: string; label: string }> = {
  wild_shape:     { color: 'green',  btnClass: 'bg-green-600 hover:bg-green-500',  icon: '🐺', label: '野性形态' },
  polymorph:      { color: 'purple', btnClass: 'bg-purple-600 hover:bg-purple-500', icon: '✨', label: '变形术' },
  true_polymorph: { color: 'amber',  btnClass: 'bg-amber-600 hover:bg-amber-500',   icon: '🌟', label: '完全变形术' },
  shapechange:    { color: 'blue',   btnClass: 'bg-blue-600 hover:bg-blue-500',     icon: '🔮', label: '形体变化' },
  animal_shapes:  { color: 'green',  btnClass: 'bg-emerald-600 hover:bg-emerald-500', icon: '🐾', label: '动物形态' },
  giant_insect:   { color: 'yellow', btnClass: 'bg-yellow-600 hover:bg-yellow-500', icon: '🦟', label: '巨虫术' },
};

// Creature type filter: config key → Chinese type names
const CREATURE_TYPE_CN: Record<string, string> = {
  beast: '野兽',
};
const EXCLUDED_TYPES_FOR_NO_CONSTRUCT_UNDEAD = ['构装体', '不死生物'];

// Size order for sizeLimit filtering
const SIZE_ORDER = ['微型', '小型', '中型', '大型', '巨型', '超巨型'];

// --- Utility functions ---

function crToNumber(cr: string | number): number {
  if (typeof cr === 'number') return cr;
  if (cr === '1/8') return 0.125;
  if (cr === '1/4') return 0.25;
  if (cr === '1/2') return 0.5;
  return parseFloat(cr) || 0;
}

function computeMaxCR(
  config: TransformationConfig,
  characterLevel: number,
  subclassId?: string,
  targetLevel?: number,
  targetCR?: number,
): number {
  const crLimit = config.creaturePool?.crLimit;
  if (!crLimit) return 999;

  // Check subclass overrides (e.g., moon druid)
  const override = subclassId ? config.subclassOverrides?.[subclassId] : null;
  if (override?.crLimit) {
    const formula = override.crLimit.formula;
    if (formula === 'moon_druid_cr_table') {
      return characterLevel >= 6 ? Math.floor(characterLevel / 3) : 1;
    }
  }

  switch (crLimit.formula) {
    case 'wild_shape_cr_table':
      if (characterLevel >= 8) return 1;
      if (characterLevel >= 4) return 0.5;
      return 0.25;
    case 'moon_druid_cr_table':
      return characterLevel >= 6 ? Math.floor(characterLevel / 3) : 1;
    case 'target_level_or_cr':
      return targetLevel ?? targetCR ?? 1;
    case 'caster_level':
      return characterLevel;
    case 'fixed':
      return crLimit.value ?? 1;
    default:
      return 999;
  }
}

function getSpeedIcons(speed: Creature['speed']): string {
  const icons: string[] = [];
  if (speed?.walk) icons.push(`🚶${speed.walk}`);
  if (speed?.swim) icons.push(`🏊${speed.swim}`);
  if (speed?.fly) icons.push(`🦅${speed.fly}`);
  if (speed?.climb) icons.push(`🧗${speed.climb}`);
  if (speed?.burrow) icons.push(`🕳️${speed.burrow}`);
  return icons.join(' ');
}

function getSizeIcon(size: string): string {
  const map: Record<string, string> = { '微型': '🐜', '小型': '🐕', '中型': '🐺', '大型': '🐻', '巨型': '🐘', '超巨型': '🐋' };
  return map[size] || '❓';
}

function getCreatureAvatarUrl(creatureId: string): string {
  return getAssetUrl(`assets/monster-avatars/${creatureId}_512.webp`);
}

// --- Props ---

export interface TransformationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectCreature: (data: TransformationData) => void;
  configId: string;
  characterLevel?: number;
  subclassId?: string;
  targetLevel?: number;
  targetCR?: number;
  casterCharacterId?: number;
  casterName?: string;
}

// --- Component ---

export function TransformationModal({
  isOpen, onClose, onSelectCreature,
  configId, characterLevel = 2, subclassId,
  targetLevel, targetCR,
  casterCharacterId, casterName,
}: TransformationModalProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [monstersData, setMonstersData] = useState<{ monsters: Creature[] }>({ monsters: [] });
  const [configsData, setConfigsData] = useState<{ configs: Record<string, TransformationConfig> } | null>(null);
  const [loading, setLoading] = useState(true);

  const setModalContext = useModalContextStore(s => s.setModalContext);
  const clearModalContext = useModalContextStore(s => s.clearModalContext);

  const theme = CONFIG_THEMES[configId] || CONFIG_THEMES.wild_shape;
  const config = configsData?.configs?.[configId];

  // Register modal context for AI chat awareness
  useEffect(() => {
    if (isOpen && config) {
      setModalContext('transformation', `正在选择${config.name}形态，配置：${configId}`);
    } else {
      clearModalContext('transformation');
    }
  }, [isOpen, configId, config, setModalContext, clearModalContext]);

  // Load data
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    Promise.all([
      monstersData.monsters.length === 0
        ? import('~/data/npc/monsters.json').then(m => m.default as { monsters: Creature[] })
        : Promise.resolve(null),
      !configsData
        ? import('~/data/rules/transformation_configs.json').then(m => m.default as any)
        : Promise.resolve(null),
    ]).then(([monsters, configs]) => {
      if (cancelled) return;
      if (monsters) setMonstersData(monsters);
      if (configs) setConfigsData(configs);
      setLoading(false);
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isOpen]);

  // Reset selection when configId changes
  useEffect(() => { setSelectedId(null); setSearchTerm(''); }, [configId]);

  // Compute max CR
  const maxCR = useMemo(() => {
    if (!config) return 0;
    return computeMaxCR(config, characterLevel, subclassId, targetLevel, targetCR);
  }, [config, characterLevel, subclassId, targetLevel, targetCR]);

  // Filter creatures
  const availableCreatures = useMemo(() => {
    if (!monstersData.monsters.length || !config) return [];
    const pool = config.creaturePool;
    if (!pool) return [];

    // Fixed options filter (e.g., giant_insect)
    if (pool.fixedOptions) {
      return monstersData.monsters.filter(m => pool.fixedOptions!.includes(m.id));
    }

    const allowedTypes = pool.types || [];
    const movementGates = pool.movementGates || {};
    const sizeLimit = pool.sizeLimit ? SIZE_ORDER.indexOf(pool.sizeLimit) : -1;

    return monstersData.monsters
      .filter(m => {
        // Type filter
        if (allowedTypes.includes('any')) {
          // no type restriction
        } else if (allowedTypes.includes('any_non_construct_undead')) {
          if (EXCLUDED_TYPES_FOR_NO_CONSTRUCT_UNDEAD.includes(m.type)) return false;
        } else {
          const allowedCN = allowedTypes.map(t => CREATURE_TYPE_CN[t]).filter(Boolean);
          if (allowedCN.length > 0 && !allowedCN.includes(m.type)) return false;
        }

        // CR limit
        if (crToNumber(m.cr) > maxCR) return false;

        // Size limit
        if (sizeLimit >= 0 && SIZE_ORDER.indexOf(m.size) > sizeLimit) return false;

        // Movement gates (e.g., wild shape fly/swim level requirements)
        for (const [moveType, gate] of Object.entries(movementGates)) {
          const speed = (m.speed as any)?.[moveType] ?? 0;
          if (speed > 0 && characterLevel < gate.minLevel) return false;
        }

        // Search filter
        if (searchTerm) {
          const term = searchTerm.toLowerCase();
          if (!m.name.toLowerCase().includes(term) && !m.nameEn.toLowerCase().includes(term)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const crDiff = crToNumber(b.cr) - crToNumber(a.cr);
        return crDiff !== 0 ? crDiff : a.name.localeCompare(b.name);
      });
  }, [config, monstersData.monsters, maxCR, characterLevel, searchTerm]);

  // Group by CR
  const creaturesByCR = useMemo(() => {
    const groups: Record<string, Creature[]> = {};
    for (const c of availableCreatures) {
      (groups[c.cr] ||= []).push(c);
    }
    return groups;
  }, [availableCreatures]);

  const selectedCreature = availableCreatures.find(c => c.id === selectedId);

  const handleConfirm = () => {
    if (!selectedCreature || !config) return;

    const data: TransformationData = {
      source: {
        config_id: configId,
        source_type: config.sourceType,
        spell_name: config.name,
        caster_id: casterCharacterId,
        caster_name: casterName,
      },
      type: config.type,
      beast_id: selectedCreature.id,
      beast_name: selectedCreature.name,
      beast_name_en: selectedCreature.nameEn,
      current_hp: typeof selectedCreature.hp === 'object' ? (selectedCreature.hp as any)?.average ?? 0 : selectedCreature.hp,
      max_hp: typeof selectedCreature.hp === 'object' ? (selectedCreature.hp as any)?.average ?? 0 : selectedCreature.hp,
      ac: typeof selectedCreature.ac === 'object' ? (selectedCreature.ac as any)?.value ?? 10 : selectedCreature.ac,
      size: selectedCreature.size,
      avatar: getCreatureAvatarUrl(selectedCreature.id),
      speed: selectedCreature.speed,
      ability_scores: {
        str: selectedCreature.abilityScores.str,
        dex: selectedCreature.abilityScores.dex,
        con: selectedCreature.abilityScores.con,
        strMod: selectedCreature.abilityScores.strMod,
        dexMod: selectedCreature.abilityScores.dexMod,
        conMod: selectedCreature.abilityScores.conMod,
      },
      actions: selectedCreature.actions || [],
      special_abilities: selectedCreature.specialAbilities,
      retainedStats: config.statRules ? {
        mental: !config.statRules.replaceMental,
        proficiencies: config.statRules.retainProficiencies,
        classFeatures: config.statRules.retainClassFeatures,
      } : undefined,
      started_at: new Date().toISOString(),
    };

    onSelectCreature(data);
    onClose();
  };

  // Format CR display
  const crDisplay = maxCR <= 0.125 ? '1/8' : maxCR <= 0.25 ? '1/4' : maxCR <= 0.5 ? '1/2' : String(maxCR);

  // Stat retention summary
  const retainSummary = config?.statRules ? [
    !config.statRules.replaceMental && '保留心智属性',
    config.statRules.retainProficiencies && '保留熟练项',
    config.statRules.retainClassFeatures && '保留职业特性',
  ].filter(Boolean).join('、') : '';

  const themeAccent = `text-${theme.color}-400`;
  const themeBorder = `border-${theme.color}-500`;
  const themeBg = `bg-${theme.color}-900/30`;

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && onClose()} modal={false}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-50" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-gray-900 border border-gray-700 rounded-lg shadow-xl z-50 w-[95vw] max-w-[600px] max-h-[80dvh] flex flex-col"
          onPointerDownOutside={(e) => { if (isClickInsideFloatingChat(e)) e.preventDefault(); }}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-gray-700">
            <Dialog.Title className={`text-lg font-bold ${themeAccent}`}>
              {theme.icon} {theme.label} - 选择生物
            </Dialog.Title>
            <Dialog.Close className="text-gray-400 hover:text-white">✕</Dialog.Close>
          </div>

          {/* Info bar */}
          <div className="px-4 py-2 bg-gray-800 border-b border-gray-700 text-sm flex flex-wrap items-center gap-x-1">
            <span className="text-gray-400">最高CR: </span>
            <span className="text-yellow-400">{crDisplay}</span>
            <span className="mx-1 text-gray-600">|</span>
            <span className="text-gray-400">可选: </span>
            <span className="text-white">{availableCreatures.length}</span>
            {retainSummary && (
              <>
                <span className="mx-1 text-gray-600">|</span>
                <span className="text-cyan-400 text-xs">{retainSummary}</span>
              </>
            )}
          </div>

          {/* Search */}
          <div className="p-3 border-b border-gray-700">
            <input
              type="text"
              placeholder="搜索生物..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className={`w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded text-white placeholder-gray-500 focus:outline-none focus:${themeBorder}`}
            />
          </div>

          {/* Creature list */}
          <div className="flex-1 overflow-y-auto p-3 space-y-4">
            {Object.entries(creaturesByCR)
              .sort(([a], [b]) => crToNumber(b) - crToNumber(a))
              .map(([cr, creatures]) => (
                <div key={cr}>
                  <div className="text-xs text-gray-500 mb-2 sticky top-0 bg-gray-900 py-1">
                    CR {cr} ({creatures.length})
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {creatures.map(c => (
                      <button
                        key={c.id}
                        onClick={() => setSelectedId(c.id)}
                        className={`p-2 rounded border text-left transition-colors ${
                          selectedId === c.id
                            ? `${themeBorder} ${themeBg}`
                            : 'border-gray-700 bg-gray-800 hover:border-gray-500'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-lg">{getSizeIcon(c.size)}</span>
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-white truncate">{c.name}</div>
                            <div className="text-xs text-gray-400 truncate">{c.nameEn}</div>
                          </div>
                        </div>
                        <div className="mt-1 flex items-center gap-3 text-xs text-gray-400">
                          <span>❤️{typeof c.hp === 'object' ? ((c.hp as any)?.average || '') : c.hp}</span>
                          <span>🛡️{typeof c.ac === 'object' ? ((c.ac as any)?.value || '') : c.ac}</span>
                          <span className="truncate">{getSpeedIcons(c.speed)}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            {availableCreatures.length === 0 && !loading && (
              <div className="text-center text-gray-500 py-8">没有符合条件的生物</div>
            )}
            {loading && (
              <div className="text-center text-gray-400 py-8">加载数据中...</div>
            )}
          </div>

          {/* Selected creature details */}
          {selectedCreature && (
            <div className="p-3 border-t border-gray-700 bg-gray-800">
              <div className="flex items-start gap-3">
                <div className="text-3xl">{getSizeIcon(selectedCreature.size)}</div>
                <div className="flex-1">
                  <div className={`font-bold ${themeAccent}`}>
                    {selectedCreature.name}
                    <span className="text-gray-500 font-normal ml-2">{selectedCreature.nameEn}</span>
                  </div>
                  <div className="text-sm text-gray-300 mt-1">{selectedCreature.size} · CR {selectedCreature.cr}</div>
                  <div className="flex gap-4 mt-2 text-sm">
                    <span>❤️ HP: {typeof selectedCreature.hp === 'object' ? ((selectedCreature.hp as any)?.average || '') : selectedCreature.hp}</span>
                    <span>🛡️ AC: {typeof selectedCreature.ac === 'object' ? ((selectedCreature.ac as any)?.value || '') : selectedCreature.ac}</span>
                  </div>
                  <div className="text-xs text-gray-400 mt-1">{getSpeedIcons(selectedCreature.speed)}</div>
                  <div className="text-xs text-gray-400 mt-1">
                    力量 {selectedCreature.abilityScores.str} ({selectedCreature.abilityScores.strMod >= 0 ? '+' : ''}{selectedCreature.abilityScores.strMod}) ·
                    敏捷 {selectedCreature.abilityScores.dex} ({selectedCreature.abilityScores.dexMod >= 0 ? '+' : ''}{selectedCreature.abilityScores.dexMod}) ·
                    体质 {selectedCreature.abilityScores.con} ({selectedCreature.abilityScores.conMod >= 0 ? '+' : ''}{selectedCreature.abilityScores.conMod})
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Footer */}
          <div className="flex justify-end gap-2 p-4 border-t border-gray-700">
            <button onClick={onClose} className="px-4 py-2 text-gray-400 hover:text-white">取消</button>
            <button
              onClick={handleConfirm}
              disabled={!selectedCreature}
              className={`px-4 py-2 rounded font-medium ${
                selectedCreature ? `${theme.btnClass} text-white` : 'bg-gray-700 text-gray-500 cursor-not-allowed'
              }`}
            >
              {theme.icon} 变形
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
