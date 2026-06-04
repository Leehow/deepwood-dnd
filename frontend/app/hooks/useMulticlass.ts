import { useMemo } from 'react';
import multiclassConfig from '~/data/rules/multiclass-requirements.json';

interface ClassLevel {
  class_id: string;
  level: number;
  subclass_id?: string | null;
}

interface LevelHistoryEntry {
  level: number;
  class: string;
  timestamp: string;
}

interface MulticlassData {
  classes: ClassLevel[];
  level_history: LevelHistoryEntry[];
}

interface Character {
  id: number;
  class_id: string;
  level: number;
  subclass_id?: string | null;
  multiclass_data?: MulticlassData | null;
  ability_scores: {
    strength: number;
    dexterity: number;
    constitution: number;
    intelligence: number;
    wisdom: number;
    charisma: number;
  };
}

interface MulticlassHookResult {
  multiclassData: MulticlassData;
  totalLevel: number;
  canMulticlass: (className: string) => boolean;
  getAvailableClasses: () => string[];
  getClassDisplay: () => string;
  isMulticlassed: boolean;
  getClassName: (classId: string) => string;
}

// 创建默认的 multiclass_data
function createDefaultMulticlassData(character: Character): MulticlassData {
  return {
    classes: [{
      class_id: character.class_id,
      level: character.level,
      subclass_id: character.subclass_id || null
    }],
    level_history: []
  };
}

// 检查属性要求
function checkAttributeRequirements(
  abilityScores: Character['ability_scores'],
  requirements: any
): boolean {
  // 处理 "or" 逻辑
  if (requirements.or) {
    return requirements.or.some((req: any) =>
      Object.entries(req).every(([attr, value]) =>
        abilityScores[attr as keyof typeof abilityScores] >= (value as number)
      )
    );
  }

  // 处理 "and" 逻辑（默认）
  return Object.entries(requirements).every(([attr, value]) => {
    if (attr === 'or') return true; // 已经处理过
    return abilityScores[attr as keyof typeof abilityScores] >= (value as number);
  });
}

export function useMulticlass(character: Character): MulticlassHookResult {
  const multiclassData = useMemo(() => {
    if (character.multiclass_data) {
      // Validate: total level in multiclass_data should match character.level
      const totalFromMulticlass = character.multiclass_data.classes.reduce(
        (sum, c) => sum + c.level, 0
      );
      if (totalFromMulticlass !== character.level) {
        // Data is inconsistent (e.g., level was reset but multiclass_data wasn't)
        // Regenerate default data based on current character.level
        return createDefaultMulticlassData(character);
      }
      return character.multiclass_data;
    }
    return createDefaultMulticlassData(character);
  }, [character]);

  // 计算总等级
  const totalLevel = useMemo(() => {
    return multiclassData.classes.reduce((sum, c) => sum + c.level, 0);
  }, [multiclassData]);

  // 检查是否可以兼职特定职业
  const canMulticlass = (className: string): boolean => {
    const requirements = multiclassConfig.prerequisites[className as keyof typeof multiclassConfig.prerequisites];
    if (!requirements) return false;

    return checkAttributeRequirements(character.ability_scores, requirements);
  };

  // 获取可用的兼职选项
  const getAvailableClasses = (): string[] => {
    return Object.keys(multiclassConfig.prerequisites).filter(className =>
      canMulticlass(className)
    );
  };

  // 获取职业中文名
  const getClassName = (classId: string): string => {
    return multiclassConfig.classNames[classId as keyof typeof multiclassConfig.classNames] || classId;
  };

  // 格式化显示（如 "战士4/游荡者2"）
  const getClassDisplay = (): string => {
    return multiclassData.classes
      .map(c => `${getClassName(c.class_id)}${c.level}`)
      .join('/');
  };

  const isMulticlassed = multiclassData.classes.length > 1;

  return {
    multiclassData,
    totalLevel,
    canMulticlass,
    getAvailableClasses,
    getClassDisplay,
    isMulticlassed,
    getClassName
  };
}
