import { useState } from 'react';
import { useMulticlass } from '~/hooks/useMulticlass';
import multiclassConfig from '~/data/rules/multiclass-requirements.json';

interface Character {
  id: number;
  name: string;
  class_id: string;
  level: number;
  subclass_id?: string | null;
  multiclass_data?: any;
  ability_scores: {
    strength: number;
    dexterity: number;
    constitution: number;
    intelligence: number;
    wisdom: number;
    charisma: number;
  };
}

interface LevelUpModalProps {
  isOpen: boolean;
  character: Character;
  newLevel: number;
  onConfirm: (classChoice: string) => void;
  onCancel: () => void;
}

export function LevelUpModal({
  isOpen,
  character,
  newLevel,
  onConfirm,
  onCancel
}: LevelUpModalProps) {
  const { multiclassData, getAvailableClasses, getClassName, canMulticlass } = useMulticlass(character);
  const [selectedClass, setSelectedClass] = useState<string>('');

  // 获取现有职业
  const existingClasses = multiclassData.classes.map(c => c.class_id);

  // 获取所有可选职业（现有+可兼职）
  const availableNewClasses = getAvailableClasses().filter(c => !existingClasses.includes(c));

  const handleConfirm = () => {
    if (!selectedClass) return;
    onConfirm(selectedClass);
  };

  // 获取属性要求描述
  const getRequirementText = (className: string): string => {
    const req = multiclassConfig.prerequisites[className as keyof typeof multiclassConfig.prerequisites];
    if (!req) return '';

    if ('or' in req && req.or) {
      return (req.or as any[]).map((r: any) =>
        Object.entries(r).map(([attr, val]) => `${getAttrName(attr)} ${val}+`).join(' 或 ')
      ).join(' 或 ');
    }

    return Object.entries(req)
      .map(([attr, val]) => `${getAttrName(attr)} ${val}+`)
      .join('，');
  };

  const getAttrName = (attr: string): string => {
    const names: Record<string, string> = {
      strength: '力量',
      dexterity: '敏捷',
      constitution: '体质',
      intelligence: '智力',
      wisdom: '感知',
      charisma: '魅力'
    };
    return names[attr] || attr;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50">
      <div className="bg-gray-900 rounded-lg p-6 max-w-3xl w-full mx-4 max-h-[90dvh] overflow-y-auto">
        {/* 标题 */}
        <div className="mb-6">
          <h2 className="text-3xl font-bold text-white mb-2">
            🎉 恭喜升级！
          </h2>
          <p className="text-xl text-purple-400">
            {character.name} 达到了 {newLevel} 级
          </p>
          <p className="text-sm text-gray-400 mt-2">
            选择要提升的职业
          </p>
        </div>

        <div className="space-y-6">
          {/* 现有职业 */}
          <div>
            <h3 className="text-sm font-medium mb-3 text-gray-300 uppercase tracking-wide">
              继续提升现有职业
            </h3>
            <div className="grid grid-cols-2 gap-3">
              {multiclassData.classes.map(classLevel => (
                <button
                  key={classLevel.class_id}
                  onClick={() => setSelectedClass(classLevel.class_id)}
                  className={`p-4 rounded-lg border-2 transition-all ${
                    selectedClass === classLevel.class_id
                      ? 'border-purple-500 bg-purple-900/50 shadow-lg shadow-purple-500/50'
                      : 'border-gray-700 hover:border-gray-600 bg-gray-800'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-lg font-bold text-white">
                      {getClassName(classLevel.class_id)}
                    </div>
                    <div className="text-2xl font-bold text-purple-400">
                      {classLevel.level} → {classLevel.level + 1}
                    </div>
                  </div>
                  <div className="text-xs text-gray-400">
                    继续提升 {getClassName(classLevel.class_id)}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* 可兼职职业 */}
          {availableNewClasses.length > 0 && (
            <div>
              <h3 className="text-sm font-medium mb-3 text-gray-300 uppercase tracking-wide">
                开始兼职新职业
              </h3>
              <div className="grid grid-cols-3 gap-3">
                {availableNewClasses.map(className => {
                  const meetsRequirements = canMulticlass(className);
                  return (
                    <button
                      key={className}
                      onClick={() => meetsRequirements && setSelectedClass(className)}
                      disabled={!meetsRequirements}
                      className={`p-4 rounded-lg border-2 transition-all ${
                        selectedClass === className
                          ? 'border-green-500 bg-green-900/50 shadow-lg shadow-green-500/50'
                          : meetsRequirements
                          ? 'border-gray-700 hover:border-gray-600 bg-gray-800'
                          : 'border-gray-800 bg-gray-900/50 opacity-50 cursor-not-allowed'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="text-lg font-bold text-white">
                          {getClassName(className)}
                        </div>
                        <div className="text-xl font-bold text-green-400">
                          1
                        </div>
                      </div>
                      <div className="text-xs text-gray-400">
                        {meetsRequirements ? '开始兼职' : '不满足要求'}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* 属性要求提示 */}
          {selectedClass && !existingClasses.includes(selectedClass) && (
            <div className="p-4 bg-blue-900/30 border border-blue-700 rounded-lg">
              <h4 className="font-medium text-white mb-2 flex items-center">
                <span className="mr-2">ℹ️</span>
                兼职要求
              </h4>
              <div className="text-sm text-blue-200">
                需要: {getRequirementText(selectedClass)}
              </div>
              <div className="mt-2 text-xs text-gray-400">
                你的属性:
                力量 {character.ability_scores.strength},
                敏捷 {character.ability_scores.dexterity},
                体质 {character.ability_scores.constitution},
                智力 {character.ability_scores.intelligence},
                感知 {character.ability_scores.wisdom},
                魅力 {character.ability_scores.charisma}
              </div>
            </div>
          )}

          {/* 升级预览 */}
          {selectedClass && (
            <div className="p-4 bg-gray-800 border border-gray-700 rounded-lg">
              <h4 className="font-medium text-white mb-3">升级后</h4>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">职业组合:</span>
                  <span className="text-white font-medium">
                    {multiclassData.classes
                      .map(c =>
                        c.class_id === selectedClass
                          ? `${getClassName(c.class_id)}${c.level + 1}`
                          : `${getClassName(c.class_id)}${c.level}`
                      )
                      .concat(
                        !existingClasses.includes(selectedClass)
                          ? [`${getClassName(selectedClass)}1`]
                          : []
                      )
                      .join(' / ')}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">总等级:</span>
                  <span className="text-white font-medium">{newLevel}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 操作按钮 */}
        <div className="flex justify-end gap-3 mt-6 pt-6 border-t border-gray-700">
          <button
            onClick={onCancel}
            className="px-6 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleConfirm}
            disabled={!selectedClass}
            className="px-6 py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors font-medium"
          >
            确认升级
          </button>
        </div>
      </div>
    </div>
  );
}
