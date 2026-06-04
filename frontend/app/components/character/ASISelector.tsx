import { useState } from 'react';
import { FeatSelector } from './FeatSelector';
import featsData from '~/data/rules/feats.json';

interface AbilityScores {
  strength: number;
  dexterity: number;
  constitution: number;
  intelligence: number;
  wisdom: number;
  charisma: number;
}

interface ASISelectorProps {
  currentAbilities: AbilityScores;
  onSelect: (choices: { type: 'asi' | 'feat'; asiChoices?: { [key: string]: number }; featId?: string; featAdditionalChoices?: any }) => void;
  onCancel?: () => void;
  characterClassId?: string;
  excludeFeats?: string[];
}

const ABILITY_NAMES = {
  strength: { name: '力量', nameEn: 'Strength', abbr: 'STR' },
  dexterity: { name: '敏捷', nameEn: 'Dexterity', abbr: 'DEX' },
  constitution: { name: '体质', nameEn: 'Constitution', abbr: 'CON' },
  intelligence: { name: '智力', nameEn: 'Intelligence', abbr: 'INT' },
  wisdom: { name: '感知', nameEn: 'Wisdom', abbr: 'WIS' },
  charisma: { name: '魅力', nameEn: 'Charisma', abbr: 'CHA' }
} as const;

type AbilityKey = keyof AbilityScores;

export function ASISelector({ currentAbilities, onSelect, onCancel, characterClassId, excludeFeats }: ASISelectorProps) {
  const [selectionType, setSelectionType] = useState<'asi' | 'feat' | null>(null);
  const [asiMode, setAsiMode] = useState<'single' | 'double'>('single'); // single: +2 to one, double: +1 to two
  const [selectedAbilities, setSelectedAbilities] = useState<{ [key in AbilityKey]?: number }>({});
  const [confirmedFeat, setConfirmedFeat] = useState<{ id: string; name: string } | null>(null);

  // Auto-update parent when ASI selection is complete
  const updateParentWithASI = (abilities: { [key in AbilityKey]?: number }, mode: 'single' | 'double') => {
    const count = Object.keys(abilities).length;
    const isComplete = mode === 'single' ? count === 1 : count === 2;

    if (isComplete) {
      onSelect({ type: 'asi', asiChoices: abilities });
    }
  };

  // Clear previous selections when switching between ASI and Feat
  const handleSelectionTypeChange = (type: 'asi' | 'feat' | null) => {
    setSelectionType(type);
    setSelectedAbilities({});
    setAsiMode('single');
    setConfirmedFeat(null);
  };

  const handleAbilityClick = (ability: AbilityKey) => {
    let newAbilities: { [key in AbilityKey]?: number };

    if (asiMode === 'single') {
      // +2 to one ability
      newAbilities = { [ability]: 2 };
    } else {
      // +1 to two abilities
      newAbilities = { ...selectedAbilities };

      if (newAbilities[ability]) {
        // Deselect
        delete newAbilities[ability];
      } else {
        // Select (max 2 abilities)
        const count = Object.keys(newAbilities).length;
        if (count < 2) {
          newAbilities[ability] = 1;
        }
      }
    }

    setSelectedAbilities(newAbilities);
    // Auto-update parent when selection is complete
    updateParentWithASI(newAbilities, asiMode);
  };

  const getNewAbilityValue = (ability: AbilityKey): number => {
    return currentAbilities[ability] + (selectedAbilities[ability] || 0);
  };

  const isAbilityMaxed = (ability: AbilityKey): boolean => {
    return getNewAbilityValue(ability) >= 20;
  };

  const getAbilityModifier = (score: number): number => {
    return Math.floor((score - 10) / 2);
  };

  return (
    <div className="space-y-6">
      {/* Selection Type */}
      {!selectionType && (
        <div className="space-y-4">
          <h3 className="text-lg font-bold text-white">选择提升方式</h3>

          <div className="grid grid-cols-2 gap-4">
            <button
              onClick={() => handleSelectionTypeChange('asi')}
              className="p-6 rounded-lg border-2 border-blue-600 hover:border-blue-500 bg-blue-900/30 hover:bg-blue-900/50 transition-all group"
            >
              <div className="text-2xl mb-2">📈</div>
              <div className="text-xl font-bold text-white mb-2">属性值提升</div>
              <div className="text-sm text-gray-300">
                +2 到一项属性<br/>
                或 +1 到两项属性
              </div>
            </button>

            <button
              onClick={() => handleSelectionTypeChange('feat')}
              className="p-6 rounded-lg border-2 border-green-600 hover:border-green-500 bg-green-900/30 hover:bg-green-900/50 transition-all group"
            >
              <div className="text-2xl mb-2">⭐</div>
              <div className="text-xl font-bold text-white mb-2">专长</div>
              <div className="text-sm text-gray-300">
                选择一个专长获得特殊能力
              </div>
            </button>
          </div>
        </div>
      )}

      {/* ASI Mode Selection */}
      {selectionType === 'asi' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold text-white">属性值提升</h3>
            <button
              onClick={() => handleSelectionTypeChange(null)}
              className="text-sm text-gray-400 hover:text-white"
            >
              返回
            </button>
          </div>

          {/* Mode Toggle */}
          <div className="flex gap-2 p-1 bg-gray-800 rounded-lg">
            <button
              onClick={() => {
                setAsiMode('single');
                setSelectedAbilities({});
              }}
              className={`flex-1 py-2 px-4 rounded-lg font-medium transition-all ${
                asiMode === 'single'
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              +2 到一项属性
            </button>
            <button
              onClick={() => {
                setAsiMode('double');
                setSelectedAbilities({});
              }}
              className={`flex-1 py-2 px-4 rounded-lg font-medium transition-all ${
                asiMode === 'double'
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              +1 到两项属性
            </button>
          </div>

          {/* Ability Grid */}
          <div className="grid grid-cols-2 gap-3">
            {(Object.keys(ABILITY_NAMES) as AbilityKey[]).map(ability => {
              const info = ABILITY_NAMES[ability];
              const currentValue = currentAbilities[ability];
              const newValue = getNewAbilityValue(ability);
              const modifier = getAbilityModifier(newValue);
              const isSelected = !!selectedAbilities[ability];
              const isMaxed = isAbilityMaxed(ability);
              const canSelect = asiMode === 'single' || Object.keys(selectedAbilities).length < 2 || isSelected;

              return (
                <button
                  key={ability}
                  onClick={() => !isMaxed && canSelect && handleAbilityClick(ability)}
                  disabled={isMaxed || !canSelect}
                  className={`p-4 rounded-lg border-2 transition-all text-left ${
                    isSelected
                      ? 'border-blue-500 bg-blue-900/50 shadow-lg shadow-blue-500/30'
                      : isMaxed
                      ? 'border-gray-700 bg-gray-800/50 opacity-50 cursor-not-allowed'
                      : canSelect
                      ? 'border-gray-600 hover:border-gray-500 bg-gray-800'
                      : 'border-gray-700 bg-gray-800/50 opacity-50 cursor-not-allowed'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <div className="text-sm font-bold text-white">{info.name}</div>
                      <div className="text-xs text-gray-400">{info.abbr}</div>
                    </div>
                    <div className="text-right">
                      <div className={`text-2xl font-bold ${
                        isSelected ? 'text-blue-400' : 'text-white'
                      }`}>
                        {newValue}
                      </div>
                      <div className="text-xs text-gray-400">
                        {modifier >= 0 ? '+' : ''}{modifier}
                      </div>
                    </div>
                  </div>

                  {isSelected && (
                    <div className="mt-2 pt-2 border-t border-blue-500/30">
                      <div className="text-xs text-blue-300 flex items-center justify-between">
                        <span>{currentValue} → {newValue}</span>
                        <span className="font-bold">+{selectedAbilities[ability]}</span>
                      </div>
                    </div>
                  )}

                  {isMaxed && (
                    <div className="mt-2 pt-2 border-t border-gray-700">
                      <div className="text-xs text-gray-500">已达上限 (20)</div>
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {asiMode === 'double' && Object.keys(selectedAbilities).length > 0 && (
            <div className="text-sm text-gray-400 text-center">
              已选择 {Object.keys(selectedAbilities).length} / 2 项属性
            </div>
          )}
        </div>
      )}

      {/* Feat Selection */}
      {selectionType === 'feat' && !confirmedFeat && (
        <div>
          <FeatSelector
            onSelect={(featId, additionalChoices) => {
              const feat = (featsData as any).feats[featId];
              setConfirmedFeat({ id: featId, name: feat?.name || featId });
              onSelect({
                type: 'feat',
                featId,
                featAdditionalChoices: additionalChoices
              });
            }}
            onCancel={() => handleSelectionTypeChange(null)}
            characterInfo={characterClassId ? { ability_scores: currentAbilities, class_id: characterClassId } : undefined}
            excludeFeats={excludeFeats}
          />
        </div>
      )}

      {/* Feat Confirmed */}
      {selectionType === 'feat' && confirmedFeat && (
        <div className="space-y-4">
          <div className="p-4 bg-green-900/30 border border-green-600 rounded-lg">
            <div className="flex items-center justify-between">
              <span className="text-green-400 font-medium">✓ 已选择专长: {confirmedFeat.name}</span>
              <button
                onClick={() => {
                  setConfirmedFeat(null);
                  onSelect({ type: 'feat' }); // Clear parent state
                }}
                className="text-sm text-gray-400 hover:text-white"
              >
                重新选择
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Selection Status */}
      {selectionType === 'asi' && Object.keys(selectedAbilities).length > 0 && (
        <div className="mt-4 p-3 bg-green-900/30 border border-green-600 rounded-lg text-center">
          <span className="text-green-400 font-medium">✓ 已选择属性提升</span>
        </div>
      )}
    </div>
  );
}
