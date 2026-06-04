/**
 * Class Data Loader
 * Loads and provides access to D&D 5E class progression data
 */

export interface ClassFeature {
  id: string;
  name: string;
  nameEn: string;
  type: 'choice' | 'subclass' | 'asi_or_feat' | 'expertise' | 'feature' | string;
  required?: boolean;
  description?: string;
  choices?: any[];
  count?: number;
  uses?: {
    type: string;
    count: number | string;
  };
  damage?: string;
  pool?: number;
  [key: string]: any;
}

interface LevelProgression {
  proficiencyBonus: number;
  features: ClassFeature[];
  spellSlots?: Record<string, number>;
  sneakAttack?: string;
  rageUses?: number;
  rageDamage?: number;
  kiPoints?: number;
  martialArtsDie?: string;
  unarmoredMovement?: number;
  inspirationDie?: string;
  wildShapeMaxCR?: number;
  wildShapeUses?: number;
  sorceryPoints?: number;
  invocationsKnown?: number;
  [key: string]: any;
}

export interface ClassData {
  id: string;
  name: string;
  nameEn: string;
  hitDie: number;
  primaryAbility: string[];
  savingThrows: string[];
  spellcasting: boolean;
  spellcastingAbility?: string;
  cantripsKnown?: Record<number, number>;
  spellsKnown?: Record<number, number>;
  levelProgression: Record<string, LevelProgression>;
}

interface ClassProgressionData {
  version: string;
  classes: Record<string, ClassData>;
}

let cachedData: ClassProgressionData | null = null;

/**
 * Load class progression data from JSON file
 */
export async function loadClassData(): Promise<ClassProgressionData> {
  if (cachedData) {
    return cachedData;
  }

  try {
    const module = await import('~/data/rules/classes-progression.json');
    const data = module.default as unknown as ClassProgressionData;
    cachedData = data;
    return data;
  } catch (error) {
    console.error('Error loading class progression data:', error);
    throw error;
  }
}

/**
 * Get data for a specific class
 */
export async function getClassData(classId: string): Promise<ClassData | null> {
  const data = await loadClassData();
  return data.classes[classId] || null;
}

/**
 * Get features for a specific class level
 */
export async function getClassLevelFeatures(
  classId: string,
  level: number
): Promise<ClassFeature[]> {
  const classData = await getClassData(classId);
  if (!classData) {
    return [];
  }

  const levelData = classData.levelProgression[level.toString()];
  return levelData?.features || [];
}

/**
 * Get spell slots for a specific class level
 */
export async function getClassSpellSlots(
  classId: string,
  level: number
): Promise<Record<string, number> | null> {
  const classData = await getClassData(classId);
  if (!classData?.spellcasting) {
    return null;
  }

  const levelData = classData.levelProgression[level.toString()];
  return levelData?.spellSlots || null;
}

/**
 * Get all data for a specific level
 */
export async function getClassLevelData(
  classId: string,
  level: number
): Promise<LevelProgression | null> {
  const classData = await getClassData(classId);
  if (!classData) {
    return null;
  }

  return classData.levelProgression[level.toString()] || null;
}

/**
 * Check if a class has spellcasting
 */
export async function isSpellcaster(classId: string): Promise<boolean> {
  const classData = await getClassData(classId);
  return classData?.spellcasting || false;
}

/**
 * Get list of all available classes
 */
export async function getAllClasses(): Promise<Array<{ id: string; name: string; nameEn: string }>> {
  const data = await loadClassData();
  return Object.values(data.classes).map(cls => ({
    id: cls.id,
    name: cls.name,
    nameEn: cls.nameEn
  }));
}

/**
 * Get structured subclass features from classes-progression.json
 * Returns features array with { id, level, name, description } for a given subclass
 */
export async function getSubclassStructuredFeatures(
  classId: string,
  subclassId: string
): Promise<Array<{ id?: string; level: number; name: string; description: string }>> {
  const classData = await getClassData(classId);
  if (!classData) return [];

  // Subclass choices are defined in level progression features with type "subclass"
  for (const levelData of Object.values(classData.levelProgression)) {
    for (const feature of levelData.features) {
      if (feature.type === 'subclass' && feature.choices) {
        const sc = (feature.choices as any[]).find((c: any) => c.id === subclassId);
        if (sc?.features) {
          return (sc.features as any[]).map((f: any) => ({
            id: f.id,
            level: f.level ?? 0,
            name: f.name ?? '',
            description: f.description ?? '',
          }));
        }
      }
    }
  }
  return [];
}

/**
 * Get all subclass choices for a given class
 * Returns the subclass category name and all available subclass options with their features
 */
export interface SubclassChoice {
  id: string;
  name: string;
  nameEn: string;
  description: string;
  features: Array<{ id?: string; level: number; name: string; description: string }>;
}

export async function getAllSubclassChoices(classId: string): Promise<{
  categoryName: string;
  categoryNameEn: string;
  choices: SubclassChoice[];
} | null> {
  const classData = await getClassData(classId);
  if (!classData) return null;

  for (const levelData of Object.values(classData.levelProgression)) {
    for (const feature of levelData.features) {
      if (feature.type === 'subclass' && feature.choices) {
        return {
          categoryName: feature.name,
          categoryNameEn: feature.nameEn,
          choices: (feature.choices as any[]).map((c: any) => ({
            id: c.id ?? '',
            name: c.name ?? '',
            nameEn: c.nameEn ?? '',
            description: c.description ?? '',
            features: (c.features as any[] || []).map((f: any) => ({
              id: f.id,
              level: f.level ?? 0,
              name: f.name ?? '',
              description: f.description ?? '',
            })),
          })),
        };
      }
    }
  }
  return null;
}

/**
 * Clear the cache (useful for testing or reloading data)
 */
export function clearCache(): void {
  cachedData = null;
}
