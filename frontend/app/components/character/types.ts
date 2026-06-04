// Type definitions for Character Creation Wizard

export interface Race {
  id: string;
  name: string;
  nameEn: string;
  description: string;
  abilityScoreIncrease: Record<string, number | undefined>;
  speed: number;
  size: string;
  traits: Array<{
    name: string;
    nameEn: string;
    description: string;
  }>;
  languages: string[];
  subraces?: Array<{
    id: string;
    name: string;
    nameEn: string;
    description: string;
    abilityScoreIncrease?: Record<string, number | undefined>;
    traits: Array<{
      name: string;
      nameEn: string;
      description: string;
    }>;
  }>;
}

export interface CharacterWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCharacterCreated?: (character: any) => Promise<boolean> | boolean | void;
  campaignId?: string; // Used to fetch campaign-scoped rule options
  enableDeitySystem?: boolean; // Whether to show deity selection (controlled by campaign settings)
  initialDraft?: { current_step: number; wizard_state: CharacterState } | null;
  onDraftChange?: (step: number, state: CharacterState) => void;
  onDraftStepChange?: (step: number, state: CharacterState) => void;
}

// Character creation state
export interface CharacterState {
  // Step 1
  raceId: string;
  subraceId: string;
  // Step 2
  classId: string;
  subclassId: string; // For level 1 subclasses (Cleric, Sorcerer, Warlock)
  selectedSkills: string[];
  // Step 3 - Class Features (varies by class)
  fightingStyle: string; // For Fighter, Paladin (level 2), Ranger (level 2)
  selectedCantrips: string[]; // For spellcasters
  selectedSpells: string[]; // For spellcasters
  preparedSpells: string[]; // For prepared casters (Cleric, Druid, Paladin, Wizard)
  expertiseSkills: string[]; // For Rogue, Bard
  expertiseThievesTools: boolean; // For Rogue - whether to use thieves' tools as one expertise choice
  favoredEnemy: string; // For Ranger - creature type or humanoid races
  favoredHumanoidRaces: string[]; // For Ranger - when favoredEnemy is "humanoids", store 2 specific races
  favoredTerrain: string; // For Ranger - terrain type
  eldritchInvocations: string[]; // For Warlock - eldritch invocations
  // Subclass feature choices
  subclassChoices: {
    language?: string[]; // For Knowledge Domain, etc. (singular form from data)
    languages?: string[]; // For Knowledge Domain, etc. (plural form, deprecated)
    skill?: string[]; // For Knowledge Domain, Nature Domain, etc. (singular form from data)
    skills?: string[]; // For Knowledge Domain, Nature Domain, etc. (plural form, deprecated)
    cantrips?: string[]; // For Nature Domain, etc.
    dragonType?: string; // For Draconic Bloodline
    landType?: string; // For Druid Circle of the Land - terrain type
  };
  // Race feature choices
  raceChoices: {
    tool?: string; // For Dwarf - one artisan tool
    skills?: string[]; // For Half-Elf - 2 skills
    abilityScores?: string[]; // For Half-Elf - 2 different abilities +1 each
    language?: string; // For Half-Elf or High Elf - 1 extra language
    cantrip?: string; // For High Elf - 1 wizard cantrip
  };
  // Step 4
  abilityScores: {
    strength: number;
    dexterity: number;
    constitution: number;
    intelligence: number;
    wisdom: number;
    charisma: number;
  };
  // Step 5
  name: string;
  age: number;
  gender: string;
  alignment: string;
  deityId: string; // Selected deity (auto-assigned for Cleric/Paladin based on subclass)
  appearance: {
    height: string;
    weight: string;
    eyes: string;
    skin: string;
    hair: string;
    distinguishingMarks: string;
  };
  personality: {
    traits: string[];
    ideals: string;
    bonds: string;
    flaws: string;
  };
  otherTraits: string;
  backstory: string;
  backgroundId: string;
  backgroundFeature: string;
  // Step 6
  equipment: any[];
  backgroundEquipment?: any[];
  currency?: { cp: number; sp: number; ep: number; gp: number; pp: number };
  // Step 7
  level: number;
  // Avatar (optional, set in review step)
  avatar?: string | null;
}

export type AbilityScoreMethod = "standard" | "roll" | "pointbuy" | "custompointbuy";

