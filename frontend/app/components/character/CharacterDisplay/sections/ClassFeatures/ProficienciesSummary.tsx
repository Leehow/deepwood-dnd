import React from "react";
import { abilityLabelMap, formatProficiency } from "../../utils/formatting";

interface Props {
  race: any;
  subrace: any;
  charClass: any;
  subclass: any;
  allSubclasses?: any[];
  background: any;
  character: any;
  selectedSkills: string[];
  raceChoiceSkills: string[];
  subclassChoiceSkillsRaw: string[];
  skillsById: Map<string, string>;
}

export function ProficienciesSummary({
  race, subrace, charClass, subclass, allSubclasses, background, character,
  selectedSkills, raceChoiceSkills, subclassChoiceSkillsRaw, skillsById,
}: Props) {
  const raceTraits = [...(race?.traits || []), ...((subrace?.traits) || [])];
  const armorSet = new Set<string>();
  const weaponSet = new Set<string>();
  const toolSet = new Set<string>();
  const raceSkillSet = new Set<string>();
  const addArr = (set: Set<string>, arr?: string[]) => (arr || []).forEach(x => set.add(x));

  raceTraits.forEach((t: any) => {
    addArr(weaponSet, t.weaponProficiencies); addArr(armorSet, t.armorProficiencies);
    addArr(toolSet, t.toolProficiencies); addArr(raceSkillSet, t.skillProficiencies);
    if (t.structuredData) {
      addArr(weaponSet, t.structuredData.weaponProficiencies); addArr(armorSet, t.structuredData.armorProficiencies);
      addArr(toolSet, t.structuredData.toolProficiencies); addArr(raceSkillSet, t.structuredData.skillProficiencies);
    }
  });

  addArr(armorSet, charClass?.proficiencies?.armor); addArr(weaponSet, charClass?.proficiencies?.weapons);
  addArr(toolSet, charClass?.proficiencies?.tools);

  const allSubs = allSubclasses && allSubclasses.length > 0 ? allSubclasses : (subclass ? [subclass] : []);
  allSubs.forEach((sc: any) => {
    ((sc?.level1Features || []) as any[]).forEach((f: any) => {
      if (f.structuredData) {
        addArr(armorSet, f.structuredData.armorProficiencies); addArr(weaponSet, f.structuredData.weaponProficiencies);
        addArr(toolSet, f.structuredData.toolProficiencies);
      }
    });
  });

  if (background) addArr(toolSet, background.toolProficiencies);

  const savingThrows = (charClass?.savingThrows as string[]) || [];
  const backgroundSkills = background?.skillProficiencies || [];
  const skillIds = Array.from(new Set([...(selectedSkills || []), ...raceChoiceSkills, ...subclassChoiceSkillsRaw, ...backgroundSkills, ...raceSkillSet]));

  // Collect languages
  const langSet = new Set<string>();
  (race?.languages || []).forEach((l: string) => langSet.add(l));
  const rc = character.race_choices || character.raceChoices || {};
  if (rc.language) langSet.add(rc.language);
  const sc = character.subclass_choices || character.subclassChoices || {};
  (sc.language || sc.languages || []).forEach((l: string) => langSet.add(l));
  allSubs.forEach((sub: any) => {
    ((sub?.level1Features || []) as any[]).forEach((f: any) => {
      if (f.structuredData?.languages) (f.structuredData.languages as string[]).forEach((l: string) => langSet.add(l));
    });
  });
  raceTraits.forEach((t: any) => {
    if (t.structuredData?.languages) (t.structuredData.languages as string[]).forEach((l: string) => langSet.add(l));
  });

  const pill = (label: string, items: string[], color: string) => {
    if (items.length === 0) return null;
    return (
      <div className="flex items-start gap-1.5">
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${color} font-medium shrink-0 mt-px`}>{label}</span>
        <div className="flex flex-wrap gap-1">
          {[...new Set(items.map(formatProficiency))].map(name => (
            <span key={name} className="text-[11px] px-2 py-0.5 rounded-full bg-gray-700/50 border border-gray-600/50 text-gray-300">{name}</span>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-2">
      {pill('护甲', Array.from(armorSet), 'bg-sky-900/50 text-sky-300 border border-sky-700/50')}
      {pill('武器', Array.from(weaponSet), 'bg-red-900/50 text-red-300 border border-red-700/50')}
      {pill('工具', Array.from(toolSet), 'bg-amber-900/50 text-amber-300 border border-amber-700/50')}
      {pill('豁免', savingThrows.map(s => abilityLabelMap[s] || s), 'bg-emerald-900/50 text-emerald-300 border border-emerald-700/50')}
      {pill('技能', skillIds.map(id => skillsById.get(id) || id), 'bg-violet-900/50 text-violet-300 border border-violet-700/50')}
      {pill('语言', Array.from(langSet).map(formatProficiency), 'bg-indigo-900/50 text-indigo-300 border border-indigo-700/50')}
    </div>
  );
}
