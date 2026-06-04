import { useState } from 'react';
import skillsData from '~/data/rules/skills.json';

interface ExpertiseSelectorProps {
  count: number; // 需要选择的专精技能数量
  proficientSkills: string[]; // 角色已熟练的技能ID列表
  existingExpertise?: string[]; // 已有的专精技能
  onSelect: (selectedSkills: string[]) => void;
  onCancel?: () => void;
}

export function ExpertiseSelector({
  count,
  proficientSkills,
  existingExpertise = [],
  onSelect,
  onCancel
}: ExpertiseSelectorProps) {
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);

  // 获取所有可用于专精的技能（已熟练但未专精的）
  const availableSkills = skillsData.skills.filter(skill =>
    proficientSkills.includes(skill.id) &&
    !existingExpertise.includes(skill.id)
  );

  const handleSkillClick = (skillId: string) => {
    setSelectedSkills(current => {
      if (current.includes(skillId)) {
        // 取消选择
        return current.filter(id => id !== skillId);
      } else if (current.length < count) {
        // 添加选择
        return [...current, skillId];
      }
      return current;
    });
  };

  const canConfirm = selectedSkills.length === count;

  const getAbilityName = (ability: string): string => {
    const abilityNames: Record<string, string> = {
      strength: '力量',
      dexterity: '敏捷',
      constitution: '体质',
      intelligence: '智力',
      wisdom: '感知',
      charisma: '魅力'
    };
    return abilityNames[ability] || ability;
  };

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-bold text-white mb-2">选择专精技能</h3>
        <p className="text-sm text-gray-400">
          从已熟练的技能中选择 {count} 项获得专精（熟练加值翻倍）
        </p>
        <div className="mt-2 text-sm text-purple-400">
          已选择：{selectedSkills.length} / {count}
        </div>
      </div>

      {availableSkills.length === 0 && (
        <div className="p-8 bg-gray-800 rounded-lg border border-gray-700 text-center">
          <div className="text-lg text-gray-300 mb-2">没有可用的技能</div>
          <div className="text-sm text-gray-500">
            你需要先获得一些技能熟练项才能选择专精
          </div>
        </div>
      )}

      {availableSkills.length > 0 && (
        <div className="grid grid-cols-2 gap-3 max-h-96 overflow-y-auto pr-2">
          {availableSkills.map(skill => {
            const isSelected = selectedSkills.includes(skill.id);
            const canSelect = isSelected || selectedSkills.length < count;

            return (
              <button
                key={skill.id}
                onClick={() => canSelect && handleSkillClick(skill.id)}
                disabled={!canSelect}
                className={`p-4 rounded-lg border-2 transition-all text-left ${
                  isSelected
                    ? 'border-purple-500 bg-purple-900/50 shadow-lg shadow-purple-500/30'
                    : canSelect
                    ? 'border-gray-600 hover:border-purple-400 bg-gray-800 hover:bg-gray-750'
                    : 'border-gray-700 bg-gray-800/50 opacity-50 cursor-not-allowed'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <div className={`font-bold ${isSelected ? 'text-purple-400' : 'text-white'}`}>
                      {skill.name}
                    </div>
                    <div className="text-xs text-gray-400">{skill.nameEn}</div>
                  </div>
                  {isSelected && (
                    <div className="text-purple-400">✓</div>
                  )}
                </div>

                <div className="text-xs text-gray-500">
                  基于：{getAbilityName(skill.ability)}
                </div>

                {isSelected && (
                  <div className="mt-2 pt-2 border-t border-purple-500/30">
                    <div className="text-xs text-purple-300">
                      熟练加值将翻倍
                    </div>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex justify-between items-center pt-4 border-t border-gray-700">
        <button
          onClick={onCancel}
          className="px-6 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
        >
          {onCancel ? '取消' : '返回'}
        </button>

        <button
          onClick={() => canConfirm && onSelect(selectedSkills)}
          disabled={!canConfirm}
          className="px-6 py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors font-medium"
        >
          确认选择
        </button>
      </div>
    </div>
  );
}
