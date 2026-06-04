import { useState, useEffect } from 'react';
import { SpellSelectableCard, SpellDetailModal } from '~/components/spell/SpellSelectableCard';
import type { SpellCardData } from '~/components/spell/SpellSelectableCard';
import { getAssetUrl } from '~/utils/asset-url';

interface Spell extends SpellCardData {
  level: number;
  school: string;
  castingTime: string;
  range: string;
  components: string[];
  duration: string;
  classes: string[];
}

interface SpellSelectorProps {
  characterClass: string;
  characterLevel: number;
  knownSpells?: string[];
  cantripsKnown?: number;
  spellsKnown?: number;
  maxSpellLevel?: number;
  canReplaceSpells?: boolean;
  expandedSpellIds?: string[];
  schoolRestriction?: string[];
  onSelect: (selectedSpells: { learned: string[]; replaced?: { old: string; new: string }[] }) => void;
  onCancel?: () => void;
}

const SCHOOL_NAMES: Record<string, string> = {
  abjuration: '防护', conjuration: '咒法', divination: '预言', enchantment: '惑控',
  evocation: '塑能', illusion: '幻术', necromancy: '死灵', transmutation: '变化'
};

export function SpellSelector({
  characterClass,
  characterLevel,
  knownSpells = [],
  cantripsKnown = 0,
  spellsKnown = 0,
  maxSpellLevel = 1,
  canReplaceSpells = false,
  expandedSpellIds = [],
  schoolRestriction,
  onSelect,
  onCancel
}: SpellSelectorProps) {
  const [allSpells, setAllSpells] = useState<Spell[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLevel, setSelectedLevel] = useState<number>(cantripsKnown > 0 ? 0 : 1);
  const [selectedSpells, setSelectedSpells] = useState<string[]>([]);
  const [replacements, setReplacements] = useState<{ old: string; new: string }[]>([]);
  const [viewMode, setViewMode] = useState<'learn' | 'replace'>(
    spellsKnown > 0 || cantripsKnown > 0 ? 'learn' : 'replace'
  );
  const [replacingSpellId, setReplacingSpellId] = useState<string | null>(null);
  const [detailSpell, setDetailSpell] = useState<SpellCardData | null>(null);

  useEffect(() => { loadSpells(); }, []);

  useEffect(() => {
    const replacementNewSpells = replacements.map(r => r.new);
    const replacedOldIds = replacements.map(r => r.old);
    onSelect({
      learned: [...selectedSpells, ...replacementNewSpells],
      replaced: replacedOldIds.length > 0 ? replacedOldIds as any : undefined
    });
  }, [selectedSpells, replacements]);

  const loadSpells = async () => {
    try {
      const module = await import('~/data/rules/spells.json');
      const data = module.default as any;
      setAllSpells(data.spells || []);
    } catch (error) {
      console.error('Failed to load spells:', error);
    } finally {
      setLoading(false);
    }
  };

  const getAvailableSpells = (level: number) =>
    allSpells.filter(spell =>
      spell.level === level &&
      (spell.classes.includes(characterClass) || expandedSpellIds.includes(spell.id)) &&
      (!schoolRestriction || level === 0 || schoolRestriction.includes(spell.school)) &&
      !knownSpells.includes(spell.id) &&
      !selectedSpells.includes(spell.id)
    );

  const getKnownSpellsOfLevel = (level: number) =>
    allSpells.filter(spell => spell.level === level && knownSpells.includes(spell.id));

  const handleSpellClick = (spellId: string) => {
    if (viewMode !== 'learn') return;
    setSelectedSpells(current => {
      if (current.includes(spellId)) return current.filter(id => id !== spellId);
      const spell = getSpellById(spellId);
      if (!spell) return current;
      if (spell.level === 0) {
        if (current.filter(id => getSpellById(id)?.level === 0).length < cantripsKnown)
          return [...current, spellId];
      } else {
        if (current.filter(id => (getSpellById(id)?.level ?? 0) > 0).length < spellsKnown)
          return [...current, spellId];
      }
      return current;
    });
  };

  const handleReplacement = (oldSpellId: string, newSpellId: string) => {
    setReplacements(current => {
      const existing = current.find(r => r.old === oldSpellId);
      if (existing) return current.map(r => r.old === oldSpellId ? { old: oldSpellId, new: newSpellId } : r);
      return [...current, { old: oldSpellId, new: newSpellId }];
    });
    setReplacingSpellId(null);
  };

  const cancelReplacement = (oldSpellId: string) => {
    setReplacements(current => current.filter(r => r.old !== oldSpellId));
  };

  const getReplacementCandidates = () => {
    const replacedNewIds = replacements.map(r => r.new);
    return allSpells.filter(spell =>
      spell.level > 0 && spell.level <= maxSpellLevel &&
      (spell.classes.includes(characterClass) || expandedSpellIds.includes(spell.id)) &&
      (!schoolRestriction || schoolRestriction.includes(spell.school)) &&
      !knownSpells.includes(spell.id) && !selectedSpells.includes(spell.id) &&
      !replacedNewIds.includes(spell.id) && spell.id !== replacingSpellId
    );
  };

  const hasReplacement = replacements.length > 0;
  const getSpellById = (spellId: string): Spell | undefined => allSpells.find(s => s.id === spellId);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-white">加载法术数据...</div>
      </div>
    );
  }

  const cantripsSelected = selectedSpells.filter(id => getSpellById(id)?.level === 0).length;
  const spellsSelected = selectedSpells.length - cantripsSelected;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="space-y-2">
        <h3 className="text-lg font-bold text-white mb-2">选择法术</h3>
        {cantripsKnown > 0 && <p className="text-sm text-blue-400">戏法: {cantripsSelected} / {cantripsKnown}</p>}
        {spellsKnown > 0 && <p className="text-sm text-purple-400">法术: {spellsSelected} / {spellsKnown}</p>}

        {selectedSpells.length > 0 && (
          <div className="p-3 bg-green-900/30 border border-green-700 rounded-lg">
            <div className="text-sm font-medium text-green-400 mb-2">已选择:</div>
            <div className="flex flex-wrap gap-2">
              {selectedSpells.map(spellId => {
                const spell = getSpellById(spellId);
                if (!spell) return null;
                return (
                  <div
                    key={spellId}
                    onClick={() => handleSpellClick(spellId)}
                    className="px-3 py-1 bg-green-800/50 border border-green-600 rounded-full text-sm text-green-300 cursor-pointer hover:bg-green-800 transition-colors flex items-center gap-2"
                  >
                    <span>{spell.name}</span>
                    <span className="text-green-500 hover:text-green-300">×</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* View Mode Toggle */}
      {canReplaceSpells && knownSpells.length > 0 && (
        <div className="flex gap-2 p-1 bg-gray-800 rounded-lg">
          <button
            onClick={() => setViewMode('learn')}
            className={`flex-1 py-2 px-4 rounded-lg font-medium transition-all ${viewMode === 'learn' ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'}`}
          >学习新法术</button>
          <button
            onClick={() => setViewMode('replace')}
            className={`flex-1 py-2 px-4 rounded-lg font-medium transition-all ${viewMode === 'replace' ? 'bg-orange-600 text-white' : 'text-gray-400 hover:text-white'}`}
          >替换已知法术</button>
        </div>
      )}

      {/* Spell Level Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-2">
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
          .filter(level => level <= maxSpellLevel)
          .filter(level => level === 0 ? cantripsKnown > 0 : (spellsKnown > 0 || canReplaceSpells))
          .map(level => {
            const available = getAvailableSpells(level).length;
            return (
              <button
                key={level}
                onClick={() => setSelectedLevel(level)}
                className={`px-4 py-2 rounded-lg font-medium whitespace-nowrap transition-all ${
                  selectedLevel === level ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                {level === 0 ? '戏法' : `${level}环`}
                {viewMode === 'learn' && available > 0 && <span className="ml-1 text-xs opacity-75">({available})</span>}
              </button>
            );
          })}
      </div>

      {/* Spell List */}
      {viewMode === 'learn' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-96 overflow-y-auto pr-2">
          {getAvailableSpells(selectedLevel).map(spell => {
            const isSelected = selectedSpells.includes(spell.id);
            const isCantrip = spell.level === 0;
            const canSelect = isSelected || (isCantrip ? cantripsSelected < cantripsKnown : spellsSelected < spellsKnown);
            return (
              <SpellSelectableCard
                key={spell.id}
                spell={spell}
                isSelected={isSelected}
                canSelect={canSelect}
                onClick={() => canSelect && handleSpellClick(spell.id)}
                onDetailClick={setDetailSpell}
                showRitual
                subtitle={`${spell.nameEn || ''} · ${SCHOOL_NAMES[spell.school] || spell.school}`}
              />
            );
          })}
          {getAvailableSpells(selectedLevel).length === 0 && (
            <div className="col-span-2 p-8 bg-gray-800 rounded-lg border border-gray-700 text-center">
              <div className="text-gray-300">
                {selectedLevel === 0 ? '没有可学习的戏法' : `没有可学习的${selectedLevel}环法术`}
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Replace Mode */
        <div className="space-y-3 max-h-96 overflow-y-auto pr-2">
          {replacements.length > 0 && (
            <div className="p-3 bg-orange-900/30 border border-orange-700 rounded-lg">
              <div className="text-sm font-medium text-orange-400 mb-2">待替换:</div>
              {replacements.map(r => {
                const oldSpell = getSpellById(r.old);
                const newSpell = getSpellById(r.new);
                return (
                  <div key={r.old} className="flex items-center gap-2 text-sm">
                    <span className="text-red-400 line-through">{oldSpell?.name}</span>
                    <span className="text-gray-500">→</span>
                    <span className="text-green-400">{newSpell?.name}</span>
                    <button onClick={() => cancelReplacement(r.old)} className="ml-auto text-gray-500 hover:text-red-400 text-xs">撤销</button>
                  </div>
                );
              })}
            </div>
          )}

          {replacingSpellId && (
            <div className="p-3 bg-blue-900/30 border border-blue-600 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm text-blue-400">
                  选择法术替换 <span className="font-bold text-white">{getSpellById(replacingSpellId)?.name}</span>：
                </div>
                <button onClick={() => setReplacingSpellId(null)} className="text-xs text-gray-400 hover:text-white">取消</button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-60 overflow-y-auto">
                {getReplacementCandidates().map(spell => (
                  <SpellSelectableCard
                    key={spell.id}
                    spell={spell}
                    isSelected={false}
                    canSelect
                    onClick={() => handleReplacement(replacingSpellId, spell.id)}
                    onDetailClick={setDetailSpell}
                    color="orange"
                    showRitual
                    subtitle={`${spell.nameEn || ''} · ${SCHOOL_NAMES[spell.school] || spell.school}`}
                  />
                ))}
                {getReplacementCandidates().length === 0 && (
                  <div className="col-span-2 text-center text-gray-400 text-sm py-4">没有可用的替换法术</div>
                )}
              </div>
            </div>
          )}

          {!replacingSpellId && (
            <>
              <div className="text-sm text-gray-400 mb-1">
                每次升级可替换1个已知法术（{hasReplacement ? '已使用' : '未使用'}）
              </div>
              {getKnownSpellsOfLevel(selectedLevel).map(spell => {
                const isReplaced = replacements.some(r => r.old === spell.id);
                return (
                  <div key={spell.id} className={`p-3 rounded-lg border ${isReplaced ? 'bg-red-900/20 border-red-700' : 'bg-gray-800 border-gray-600'}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <img
                          src={getAssetUrl(`assets/spell-icons/${spell.id}.png`)}
                          alt=""
                          className="w-8 h-8 rounded flex-shrink-0 object-cover"
                          onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                        <div>
                          <div className={`font-bold ${isReplaced ? 'text-red-400 line-through' : 'text-white'}`}>{spell.name}</div>
                          <div className="text-xs text-gray-400">{spell.nameEn}</div>
                        </div>
                        <span
                          role="button"
                          onClick={() => setDetailSpell(spell)}
                          className="w-5 h-5 flex items-center justify-center rounded-full bg-gray-700/60 hover:bg-blue-700/60 text-gray-400 hover:text-blue-300 text-[10px] font-bold cursor-pointer transition-colors flex-shrink-0"
                          title="查看法术详情"
                        >?</span>
                      </div>
                      {isReplaced ? (
                        <button onClick={() => cancelReplacement(spell.id)} className="px-3 py-1 bg-gray-600 hover:bg-gray-500 text-white text-sm rounded transition-colors">撤销</button>
                      ) : (
                        <button
                          onClick={() => { if (!hasReplacement) setReplacingSpellId(spell.id); }}
                          disabled={hasReplacement}
                          className={`px-3 py-1 text-white text-sm rounded transition-colors ${hasReplacement ? 'bg-gray-700 cursor-not-allowed opacity-50' : 'bg-orange-600 hover:bg-orange-500'}`}
                        >替换</button>
                      )}
                    </div>
                  </div>
                );
              })}
              {getKnownSpellsOfLevel(selectedLevel).length === 0 && (
                <div className="p-8 bg-gray-800 rounded-lg border border-gray-700 text-center">
                  <div className="text-gray-300">
                    {selectedLevel === 0 ? '没有已知的戏法' : `没有已知的${selectedLevel}环法术`}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      <SpellDetailModal spell={detailSpell} onClose={() => setDetailSpell(null)} zOverlay="z-[10198]" zContent="z-[10200]" />
    </div>
  );
}
