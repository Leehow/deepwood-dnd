import { useMemo } from 'react';
import xpThresholds from '~/data/rules/xp-thresholds.json';

interface Character {
  id: number;
  experience_points?: number;
  milestone_level?: number | null;
  level: number;
  currency?: {
    cp: number;
    sp: number;
    ep: number;
    gp: number;
    pp: number;
  } | null;
}

interface ProgressionHookResult {
  currentXP: number;
  currentLevel: number;
  nextLevelXP: number;
  xpToNextLevel: number;
  progressPercent: number;
  currency: {
    cp: number;
    sp: number;
    ep: number;
    gp: number;
    pp: number;
  };
  totalGoldValue: number;
  formatXP: (xp: number) => string;
  formatCurrency: () => string;
}

/**
 * Calculate character level from XP using D&D 5E thresholds
 */
function calculateLevelFromXP(xp: number): number {
  const thresholds = xpThresholds.thresholds;

  for (let i = thresholds.length - 1; i >= 0; i--) {
    if (xp >= thresholds[i]) {
      return i + 1; // Level is index + 1
    }
  }

  return 1; // Minimum level
}

/**
 * Get XP threshold for a specific level
 */
function getXPForLevel(level: number): number {
  if (level < 1) return 0;
  if (level > 20) return xpThresholds.thresholds[19]; // Max level 20
  return xpThresholds.thresholds[level - 1];
}

/**
 * Format XP with comma separators
 */
function formatXP(xp: number): string {
  return xp.toLocaleString('en-US');
}

/**
 * Calculate total gold value from all currencies
 * CP = 0.01 GP, SP = 0.1 GP, EP = 0.5 GP, GP = 1 GP, PP = 10 GP
 */
function calculateTotalGoldValue(currency: {
  cp: number;
  sp: number;
  ep: number;
  gp: number;
  pp: number;
}): number {
  return (
    currency.cp * 0.01 +
    currency.sp * 0.1 +
    currency.ep * 0.5 +
    currency.gp +
    currency.pp * 10
  );
}

export function useCharacterProgression(character: Character): ProgressionHookResult {
  const currentXP = character.experience_points || 0;

  // Use milestone_level if set, otherwise calculate from XP
  const currentLevel = useMemo(() => {
    if (character.milestone_level) {
      return character.milestone_level;
    }
    return calculateLevelFromXP(currentXP);
  }, [character.milestone_level, currentXP]);

  // Calculate XP thresholds for next level
  const { nextLevelXP, xpToNextLevel, progressPercent } = useMemo(() => {
    if (currentLevel >= 20) {
      return {
        nextLevelXP: getXPForLevel(20),
        xpToNextLevel: 0,
        progressPercent: 100
      };
    }

    const currentLevelXP = getXPForLevel(currentLevel);
    const nextLevelXP = getXPForLevel(currentLevel + 1);
    const xpToNextLevel = Math.max(0, nextLevelXP - currentXP);
    const xpProgress = currentXP - currentLevelXP;
    const xpNeeded = nextLevelXP - currentLevelXP;
    const progressPercent = Math.min(100, Math.max(0, (xpProgress / xpNeeded) * 100));

    return { nextLevelXP, xpToNextLevel, progressPercent };
  }, [currentLevel, currentXP]);

  // Currency management
  const currency = useMemo(() => {
    return character.currency || { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };
  }, [character.currency]);

  const totalGoldValue = useMemo(() => {
    return calculateTotalGoldValue(currency);
  }, [currency]);

  const formatCurrency = (): string => {
    const parts: string[] = [];
    if (currency.pp > 0) parts.push(`${currency.pp}pp`);
    if (currency.gp > 0) parts.push(`${currency.gp}gp`);
    if (currency.ep > 0) parts.push(`${currency.ep}ep`);
    if (currency.sp > 0) parts.push(`${currency.sp}sp`);
    if (currency.cp > 0) parts.push(`${currency.cp}cp`);

    return parts.length > 0 ? parts.join(', ') : '0gp';
  };

  return {
    currentXP,
    currentLevel,
    nextLevelXP,
    xpToNextLevel,
    progressPercent,
    currency,
    totalGoldValue,
    formatXP,
    formatCurrency
  };
}
