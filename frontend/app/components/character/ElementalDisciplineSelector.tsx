import { useState, useEffect, useMemo } from 'react';
import classResourcesData from '~/data/rules/class_resources.json';

interface Discipline {
  id: string;
  name: string;
  nameEn: string;
  cost: number;
  minLevel: number;
  actionType: string;
  linkedSpell?: string;
  description: string;
  descriptionEn: string;
}

interface ElementalDisciplineSelectorProps {
  /** How many NEW disciplines to pick this level-up */
  count: number;
  /** Character's new level after this level-up */
  characterLevel: number;
  /** Already-known discipline IDs from previous level-ups */
  knownDisciplines: string[];
  /** Whether replacement is allowed (level 6+) */
  canReplace?: boolean;
  onSelect: (selected: string[], replaced: string[]) => void;
}

const ACTION_LABELS: Record<string, string> = {
  action: '动作',
  bonus_action: '附赠动作',
  reaction: '反应',
  free: '无需动作',
};

const ELEMENT_ICONS: Record<string, string> = {
  elemental_attunement: '🌀',
  fangs_of_fire_snake: '🔥',
  fist_of_four_thunders: '⚡',
  fist_of_unbroken_air: '🌪️',
  rush_of_gale_spirits: '💨',
  shape_the_flowing_river: '🌊',
  sweeping_cinder_strike: '🔥',
  water_whip: '🌊',
  clench_of_the_north_wind: '❄️',
  gong_of_the_summit: '⚡',
  flames_of_the_phoenix: '🔥',
  mist_stance: '🌫️',
  ride_the_wind: '💨',
  eternal_mountain_defense: '🪨',
  river_of_hungry_flame: '🔥',
  breath_of_winter: '❄️',
  wave_of_rolling_earth: '🪨',
};

export function ElementalDisciplineSelector({
  count,
  characterLevel,
  knownDisciplines,
  canReplace = false,
  onSelect,
}: ElementalDisciplineSelectorProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const [replacedId, setReplacedId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Load all discipline abilities from class_resources.json
  const disciplines = useMemo<Discipline[]>(() => {
    return (classResourcesData.resourceAbilities as any[])
      .filter((a: any) => a.resourceId === 'elemental_disciplines')
      .map((a: any) => ({
        id: a.id,
        name: a.name,
        nameEn: a.nameEn,
        cost: a.cost,
        minLevel: a.minLevel || 3,
        actionType: a.actionType || 'action',
        linkedSpell: a.linkedSpell,
        description: a.description,
        descriptionEn: a.descriptionEn,
      }));
  }, []);

  // Filter available: must meet level requirement, not already known (unless being replaced)
  const availableDisciplines = useMemo(() => {
    return disciplines.filter(d => {
      if (d.minLevel > characterLevel) return false;
      // elemental_attunement is auto-included for known, can't be re-selected
      if (d.id === 'elemental_attunement' && knownDisciplines.includes(d.id)) return false;
      // Already known and not being replaced
      if (knownDisciplines.includes(d.id) && replacedId !== d.id) return false;
      return true;
    });
  }, [disciplines, characterLevel, knownDisciplines, replacedId]);

  // Replaceable = known disciplines excluding elemental_attunement
  const replaceableDisciplines = useMemo(() => {
    return disciplines.filter(d =>
      knownDisciplines.includes(d.id) && d.id !== 'elemental_attunement'
    );
  }, [disciplines, knownDisciplines]);

  useEffect(() => {
    onSelect(selected, replacedId ? [replacedId] : []);
  }, [selected, replacedId]);

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      if (prev.includes(id)) {
        return prev.filter(x => x !== id);
      }
      // For first level-up (level 3), elemental_attunement is required and auto-counted
      // but user picks from the rest
      if (prev.length >= count) {
        // Replace last selection
        return [...prev.slice(1), id];
      }
      return [...prev, id];
    });
  };

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Group by level tier
  const groupedDisciplines = useMemo(() => {
    const groups: { label: string; minLevel: number; items: Discipline[] }[] = [
      { label: '基础法门（3级）', minLevel: 3, items: [] },
      { label: '进阶法门（6级）', minLevel: 6, items: [] },
      { label: '高级法门（11级）', minLevel: 11, items: [] },
      { label: '大师法门（17级）', minLevel: 17, items: [] },
    ];
    for (const d of availableDisciplines) {
      const group = groups.find(g => g.minLevel === d.minLevel) || groups[0];
      group.items.push(d);
    }
    return groups.filter(g => g.items.length > 0);
  }, [availableDisciplines]);

  return (
    <div className="space-y-4">
      {/* Header with count */}
      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-400">
          已选择 {selected.length} / {count} 个新法门
        </span>
        {knownDisciplines.length > 0 && (
          <span className="text-xs text-gray-500">
            已掌握 {knownDisciplines.length} 个法门
          </span>
        )}
      </div>

      {/* Replacement option for level 6+ */}
      {canReplace && replaceableDisciplines.length > 0 && (
        <div className="p-3 bg-blue-900/20 border border-blue-700 rounded-lg">
          <div className="text-sm text-blue-300 mb-2">
            可选替换：你可以替换已学习的1个法门（可选）
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setReplacedId(null)}
              className={`px-2 py-1 rounded text-xs transition-all ${
                replacedId === null
                  ? 'bg-blue-500/30 border border-blue-400 text-blue-300'
                  : 'bg-gray-800 border border-gray-600 text-gray-400 hover:border-gray-500'
              }`}
            >
              不替换
            </button>
            {replaceableDisciplines.map(d => (
              <button
                key={d.id}
                onClick={() => {
                  setReplacedId(replacedId === d.id ? null : d.id);
                  // Remove from selected if it was selected
                  setSelected(prev => prev.filter(x => x !== d.id));
                }}
                className={`px-2 py-1 rounded text-xs transition-all ${
                  replacedId === d.id
                    ? 'bg-red-500/30 border border-red-400 text-red-300'
                    : 'bg-gray-800 border border-gray-600 text-gray-400 hover:border-gray-500'
                }`}
              >
                {ELEMENT_ICONS[d.id] || '✨'} {d.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Discipline groups */}
      {groupedDisciplines.map(group => (
        <div key={group.minLevel}>
          <h6 className="text-xs font-semibold text-teal-400 mb-2 uppercase tracking-wide">
            {group.label}
          </h6>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {group.items.map(d => {
              const isSelected = selected.includes(d.id);
              const canSelect = !isSelected && selected.length < count;
              const isExpanded = expandedIds.has(d.id);
              const isLong = d.description.length > 80;

              return (
                <div key={d.id} className="relative">
                  <button
                    onClick={() => toggleSelect(d.id)}
                    disabled={!isSelected && !canSelect}
                    className={`w-full p-3 rounded-lg border text-left transition-all ${
                      isSelected
                        ? 'border-teal-400 bg-teal-400/20 shadow-lg'
                        : canSelect
                          ? 'border-gray-600 hover:border-gray-500 bg-gray-800/50'
                          : 'border-gray-700 bg-gray-800/30 opacity-50 cursor-not-allowed'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <span className="text-lg mt-0.5">{ELEMENT_ICONS[d.id] || '✨'}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2 mb-0.5">
                          <span className="font-medium text-white text-sm">{d.name}</span>
                          {isSelected && <span className="text-teal-400">✓</span>}
                        </div>
                        <div className="text-xs text-gray-500 mb-1">{d.nameEn}</div>

                        <div className="flex flex-wrap gap-1 mb-1">
                          <span className="text-xs bg-gray-700/50 text-teal-300 px-1.5 py-0.5 rounded">
                            {d.cost === 0 ? '免费' : `${d.cost}气`}
                          </span>
                          <span className="text-xs bg-gray-700/50 text-gray-300 px-1.5 py-0.5 rounded">
                            {ACTION_LABELS[d.actionType] || d.actionType}
                          </span>
                          {d.linkedSpell && (
                            <span className="text-xs bg-purple-900/30 text-purple-300 px-1.5 py-0.5 rounded">
                              法术
                            </span>
                          )}
                        </div>

                        <div className={`text-xs text-gray-400 ${!isExpanded && isLong ? 'line-clamp-2' : ''}`}>
                          {d.description}
                        </div>
                      </div>
                    </div>
                  </button>
                  {isLong && (
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleExpand(d.id); }}
                      className="absolute bottom-2 right-2 text-xs text-teal-400 hover:text-teal-300 bg-gray-900/80 px-2 py-0.5 rounded"
                    >
                      {isExpanded ? '收起' : '展开'}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {selected.length === count && (
        <div className="text-center text-sm text-green-400">
          ✓ 已选择 {count} 个新法门
          {replacedId && ` (替换: ${disciplines.find(d => d.id === replacedId)?.name})`}
        </div>
      )}
    </div>
  );
}
