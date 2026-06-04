import { useState, useEffect } from 'react';
import classesData from '~/data/rules/classes.json';

interface Maneuver {
  id: string;
  name: string;
  nameEn: string;
  description: string;
  cost: number;
  timing: string;
  effect: string;
  save?: string;
}

interface ManeuverSelectorProps {
  count: number;
  knownManeuvers: string[];
  onSelect: (selectedManeuvers: string[]) => void;
}

export function ManeuverSelector({ count, knownManeuvers, onSelect }: ManeuverSelectorProps) {
  const [selectedManeuvers, setSelectedManeuvers] = useState<string[]>([]);
  const [maneuvers, setManeuvers] = useState<Maneuver[]>([]);

  useEffect(() => {
    // Get maneuvers from battle_master subclass in classes.json
    const fighterClass = classesData.classes.find(c => c.id === 'fighter');
    const battleMaster = fighterClass?.subclasses?.find(s => s.id === 'battle_master');
    if (battleMaster && 'maneuvers' in battleMaster) {
      setManeuvers((battleMaster as any).maneuvers || []);
    }
  }, []);

  const handleToggleManeuver = (maneuverId: string) => {
    // Can't select already known maneuvers
    if (knownManeuvers.includes(maneuverId)) return;

    const isSelected = selectedManeuvers.includes(maneuverId);
    let newSelection: string[];

    if (isSelected) {
      newSelection = selectedManeuvers.filter(id => id !== maneuverId);
    } else {
      if (selectedManeuvers.length >= count) {
        // Replace the first selected if at max
        newSelection = [...selectedManeuvers.slice(1), maneuverId];
      } else {
        newSelection = [...selectedManeuvers, maneuverId];
      }
    }

    setSelectedManeuvers(newSelection);
    onSelect(newSelection);
  };

  const getTimingLabel = (timing: string) => {
    const labels: Record<string, string> = {
      'attack_action': '攻击动作',
      'on_hit': '命中时',
      'on_attack': '攻击时',
      'on_attack_roll': '攻击检定时',
      'on_move': '移动时',
      'bonus_action': '附赠动作',
      'reaction_on_hit': '反应（被命中时）',
      'reaction_on_miss': '反应（被未命中时）',
    };
    return labels[timing] || timing;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-400">
          已选择 {selectedManeuvers.length} / {count} 个战技
        </span>
        {knownManeuvers.length > 0 && (
          <span className="text-xs text-gray-500">
            已学习 {knownManeuvers.length} 个战技
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-96 overflow-y-auto pr-2">
        {maneuvers.map((maneuver) => {
          const isKnown = knownManeuvers.includes(maneuver.id);
          const isSelected = selectedManeuvers.includes(maneuver.id);
          const canSelect = !isKnown && (isSelected || selectedManeuvers.length < count);

          return (
            <button
              key={maneuver.id}
              onClick={() => handleToggleManeuver(maneuver.id)}
              disabled={isKnown}
              className={`p-3 rounded-lg border-2 text-left transition-all ${
                isKnown
                  ? 'border-gray-700 bg-gray-800/50 opacity-50 cursor-not-allowed'
                  : isSelected
                    ? 'border-yellow-500 bg-yellow-900/30 shadow-lg'
                    : canSelect
                      ? 'border-gray-600 hover:border-gray-500 bg-gray-800'
                      : 'border-gray-700 bg-gray-800/50 opacity-70'
              }`}
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <div>
                  <div className="font-medium text-white text-sm">{maneuver.name}</div>
                  <div className="text-xs text-gray-500">{maneuver.nameEn}</div>
                </div>
                <div className="flex items-center gap-1">
                  {isKnown && (
                    <span className="text-xs bg-green-900/50 text-green-400 px-1.5 py-0.5 rounded">
                      已学
                    </span>
                  )}
                  {isSelected && (
                    <span className="text-yellow-500 text-lg">✓</span>
                  )}
                </div>
              </div>
              <div className="text-xs text-yellow-400 mb-1">
                {getTimingLabel(maneuver.timing)}
                {maneuver.save && ` | ${maneuver.save === 'strength' ? '力量' : maneuver.save === 'wisdom' ? '感知' : maneuver.save}豁免`}
              </div>
              <div className="text-xs text-gray-400 line-clamp-2">
                {maneuver.description}
              </div>
            </button>
          );
        })}
      </div>

      {selectedManeuvers.length === count && (
        <div className="text-center text-sm text-green-400">
          ✓ 已选择 {count} 个战技
        </div>
      )}
    </div>
  );
}
