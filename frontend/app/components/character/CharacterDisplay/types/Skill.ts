import type { AbilityScores } from "./Character";

export interface SkillMeta {
  id: string;
  name: string;
  ability: keyof AbilityScores;
}

