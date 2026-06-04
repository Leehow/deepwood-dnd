import { useEffect, useState } from 'react';
import { EnhancedLevelUpModal } from './EnhancedLevelUpModal';
import xpThresholds from '~/data/rules/xp-thresholds.json';

interface Character {
  id: number;
  name: string;
  class_id: string;
  level: number;
  experience_points: number;
  multiclass_data?: any;
  ability_scores: {
    strength: number;
    dexterity: number;
    constitution: number;
    intelligence: number;
    wisdom: number;
    charisma: number;
  };
  subclass_id?: string | null;
  fighting_style?: string;
  eldritch_invocations?: string[];
  selected_skills?: string[];
  expertise_skills?: string[];
  known_spells?: string[];
  cantrips?: string[];
}

interface ProgressionManagerProps {
  character: Character;
  onLevelUp: (characterId: number, newLevel: number, classChoice: string, featureChoices?: any) => void;
}

// 计算等级
function calculateLevel(xp: number): number {
  const thresholds = Object.entries(xpThresholds.levels)
    .map(([level, xpRequired]) => ({
      level: parseInt(level),
      xpRequired: xpRequired as number
    }))
    .sort((a, b) => b.xpRequired - a.xpRequired);

  for (const { level, xpRequired } of thresholds) {
    if (xp >= xpRequired) return level;
  }
  return 1;
}

export function ProgressionManager({ character, onLevelUp }: ProgressionManagerProps) {
  const [showLevelUpModal, setShowLevelUpModal] = useState(false);
  const [pendingLevel, setPendingLevel] = useState<number | null>(null);
  const [lastXP, setLastXP] = useState(character.experience_points || 0);

  useEffect(() => {
    const currentXP = character.experience_points || 0;
    const oldLevel = calculateLevel(lastXP);
    const newLevel = calculateLevel(currentXP);

    // 检测升级
    if (newLevel > oldLevel && newLevel > (character.level || 1)) {
      setPendingLevel(newLevel);
      setShowLevelUpModal(true);
    }

    setLastXP(currentXP);
  }, [character.experience_points]);

  const handleLevelUpConfirm = (classChoice: string, featureChoices?: any) => {
    if (pendingLevel) {
      onLevelUp(character.id, pendingLevel, classChoice, featureChoices);
      setShowLevelUpModal(false);
      setPendingLevel(null);
    }
  };

  const handleLevelUpCancel = () => {
    setShowLevelUpModal(false);
    setPendingLevel(null);
  };

  return (
    <>
      {showLevelUpModal && pendingLevel && (
        <EnhancedLevelUpModal
          isOpen={showLevelUpModal}
          character={character}
          newLevel={pendingLevel}
          onConfirm={handleLevelUpConfirm}
          onCancel={handleLevelUpCancel}
        />
      )}
    </>
  );
}
