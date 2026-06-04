import type { HotbarSlot } from "~/components/character/CharacterDisplay/types/Character";

export interface CampaignHotbarAbilityData {
  abilityId: string;
  poolCurrent: number;
  poolMax: number;
  spellSlotLevel?: number;
}

export interface CampaignHotbarSpellData {
  spell: any;
  slotLevel: number;
  sourceTokenId: number;
  illusionImageUrl?: string;
  illusionDesc?: string;
  illusionDisplayName?: string;
  selectedOption?: string;
  materialId?: string;
  ritualCast?: boolean;
  /** Preserved across targeting so granted-actions / invocations don't lose
   *  their free-cast flag on the round trip through the targeting banner. */
  freecast?: boolean;
  runtimeAction?: Record<string, any>;
  /** Long-cast / ritual cast pending placement: the controllers must call
   *  `/api/spells/start-cast` (not `/api/spells/cast`) once a target/area is
   *  selected so the placement is preserved on `casting_in_progress`. */
  longCast?: boolean;
  /** Pre-confirmed concentration replacement, forwarded from
   *  SpellCastActions so the long cast doesn't double-prompt. */
  confirmBreakConcentration?: boolean;
  /** Maximum number of targets the cast may pick (computed from spell metadata). */
  maxTargets?: number;
  /** True when the spell expects multiple targets and the targeting UX should batch selections. */
  isMultiTarget?: boolean;
}

export interface CampaignHotbarTargeting {
  slot: HotbarSlot;
  slotIndex: number;
  sourceCharacterId: number;
  targetingType?: "attack" | "ability" | "spell";
  abilityData?: CampaignHotbarAbilityData;
  spellData?: CampaignHotbarSpellData;
  /** Currently selected target ids for a multi-target spell cast. */
  selectedTargetIds?: number[];
}

export interface CampaignHotbarConfirm {
  slot: HotbarSlot;
  sourceCharacterId: number;
  targetTokenId: number;
  targetName: string;
  distanceFeet: number;
}

export interface CampaignAbilityConfirm {
  abilityId: string;
  sourceCharacterId: number;
  targetTokenId: number;
  targetName: string;
  distanceFeet: number;
  targetMonsterType?: string;
  poolCurrent: number;
  poolMax: number;
  spellSlotLevel?: number;
}

export interface CampaignSourceModalState {
  sourceCharacterId: number;
}
