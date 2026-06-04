export type KnowledgeOfTheAgesKind = "skill" | "tool";

export interface DurationLike {
  type: "permanent" | "rounds" | "minutes" | "hours";
  value: number;
  remaining: number;
  v?: number;
}

export interface KnowledgeOfTheAgesSelection {
  kind: KnowledgeOfTheAgesKind;
  id: string;
  label: string;
  duration: DurationLike;
}

type SpecialBuffRecord = Record<string, any>;

export const KNOWLEDGE_OF_THE_AGES_DURATION_ROUNDS = 100;

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map(entry => String(entry || "").trim()).filter(Boolean)));
}

function removeStringEntry(entries: unknown, entryToRemove: string | null | undefined): string[] {
  if (!entryToRemove) return normalizeStringArray(entries);
  return normalizeStringArray(entries).filter(entry => entry !== entryToRemove);
}

function withStringEntry(entries: unknown, entryToAdd: string): string[] {
  return Array.from(new Set([...normalizeStringArray(entries), entryToAdd]));
}

export function getKnowledgeOfTheAgesSelection(
  specialBuffs: SpecialBuffRecord | null | undefined,
): KnowledgeOfTheAgesSelection | null {
  const kind = specialBuffs?.knowledge_of_the_ages_kind;
  const id = typeof specialBuffs?.knowledge_of_the_ages_id === "string"
    ? specialBuffs.knowledge_of_the_ages_id.trim()
    : "";
  const label = typeof specialBuffs?.knowledge_of_the_ages_label === "string"
    ? specialBuffs.knowledge_of_the_ages_label.trim()
    : "";
  const duration = specialBuffs?.knowledge_of_the_ages_duration;
  if ((kind !== "skill" && kind !== "tool") || !id || !label || !duration) {
    return null;
  }
  return {
    kind,
    id,
    label,
    duration,
  };
}

export function clearKnowledgeOfTheAgesBuff(
  specialBuffs: SpecialBuffRecord | null | undefined,
): SpecialBuffRecord {
  const next = { ...(specialBuffs || {}) };
  const previousKind = next.knowledge_of_the_ages_kind;
  const previousId = typeof next.knowledge_of_the_ages_id === "string"
    ? next.knowledge_of_the_ages_id.trim()
    : "";

  if (previousKind === "skill" && previousId) {
    const skillGrants = removeStringEntry(next.granted_skill_proficiencies, previousId);
    if (skillGrants.length > 0) next.granted_skill_proficiencies = skillGrants;
    else delete next.granted_skill_proficiencies;
  }

  if (previousKind === "tool" && previousId) {
    const toolGrants = removeStringEntry(next.granted_tool_proficiencies, previousId);
    if (toolGrants.length > 0) next.granted_tool_proficiencies = toolGrants;
    else delete next.granted_tool_proficiencies;
  }

  delete next.knowledge_of_the_ages_kind;
  delete next.knowledge_of_the_ages_id;
  delete next.knowledge_of_the_ages_label;
  delete next.knowledge_of_the_ages_duration;

  return next;
}

export function applyKnowledgeOfTheAgesBuff(
  specialBuffs: SpecialBuffRecord | null | undefined,
  selection: { kind: KnowledgeOfTheAgesKind; id: string; label: string },
): SpecialBuffRecord {
  const next = clearKnowledgeOfTheAgesBuff(specialBuffs);

  if (selection.kind === "skill") {
    next.granted_skill_proficiencies = withStringEntry(next.granted_skill_proficiencies, selection.id);
  } else {
    next.granted_tool_proficiencies = withStringEntry(next.granted_tool_proficiencies, selection.id);
  }

  next.knowledge_of_the_ages_kind = selection.kind;
  next.knowledge_of_the_ages_id = selection.id;
  next.knowledge_of_the_ages_label = selection.label;
  next.knowledge_of_the_ages_duration = {
    type: "minutes",
    value: 10,
    remaining: KNOWLEDGE_OF_THE_AGES_DURATION_ROUNDS,
    v: 2,
  };

  return next;
}

export function advanceSpecialBuffDurations(
  specialBuffs: SpecialBuffRecord | null | undefined,
  rounds: number,
): SpecialBuffRecord {
  if (!specialBuffs) return {};

  let next = { ...specialBuffs };
  const knowledge = getKnowledgeOfTheAgesSelection(next);
  if (knowledge && knowledge.duration.type !== "permanent") {
    const remaining = Number(knowledge.duration.remaining || 0) - rounds;
    if (remaining > 0) {
      next.knowledge_of_the_ages_duration = {
        ...knowledge.duration,
        remaining,
        v: knowledge.duration.v ?? 2,
      };
    } else {
      next = clearKnowledgeOfTheAgesBuff(next);
    }
  }

  return next;
}

