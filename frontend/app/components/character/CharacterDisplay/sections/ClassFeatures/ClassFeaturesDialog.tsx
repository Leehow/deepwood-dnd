import React, { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { formatFightingStyle } from "../../utils/formatting";
import { spellDataLoader } from "~/services/spellDataLoader";
import { SpellDetailModal } from "~/components/spell/SpellSelectableCard";
import { ProficienciesSummary } from "./ProficienciesSummary";
import { RaceFeaturesSection } from "./RaceFeaturesSection";
import { ClassFeaturesSection } from "./ClassFeaturesSection";
import { BackgroundFeatureSection } from "./BackgroundFeatureSection";
import { LevelProgressionSection } from "./LevelProgressionSection";
import { InvocationEncyclopedia } from "./InvocationEncyclopedia";

const extractValue = (field: any): string | undefined => {
  if (!field) return undefined;
  if (typeof field === 'string') return field;
  if (typeof field === 'object' && field.value) return field.value;
  return undefined;
};

const extractArray = (field: any): string[] => {
  if (!field) return [];
  if (Array.isArray(field)) return field.map(item => typeof item === 'string' ? item : item?.value).filter(Boolean);
  return [];
};

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  character: any;
  race: any;
  subrace: any;
  charClass: any;
  subclass: any;
  allSubclasses?: any[];
  background: any;
  selectedSkills: string[];
  raceChoiceSkills: string[];
  subclassChoiceSkillsRaw: string[];
  skillsById: Map<string, string>;
  embedded?: boolean;
}

function SectionHeader({ icon, label, color }: { icon: React.ReactNode; label: string; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`${color}`}>{icon}</span>
      <span className={`text-xs font-semibold ${color}`}>{label}</span>
      <div className="flex-1 h-px bg-gray-700/60" />
    </div>
  );
}

export function ClassFeaturesDialog({ open, onOpenChange, character, race, subrace, charClass, subclass, allSubclasses, background, selectedSkills, raceChoiceSkills, subclassChoiceSkillsRaw, skillsById, embedded }: Props) {
  useEffect(() => { if (open) spellDataLoader.loadSpellData(); }, [open]);

  const [invEncycOpen, setInvEncycOpen] = useState(false);
  const [spellDetailData, setSpellDetailData] = useState<any>(null);
  const openSpellDetail = (spellId: string) => {
    const spell = spellDataLoader.getSpellById(spellId);
    if (spell) setSpellDetailData(spell);
  };

  const fightingStyleValue = extractValue(character.fighting_style || character.fightingStyle);

  const childModals = (
    <>
      <InvocationEncyclopedia
        open={invEncycOpen}
        onOpenChange={setInvEncycOpen}
        selectedIds={extractArray(character.eldritch_invocations || character.eldritchInvocations)}
        onOpenSpell={openSpellDetail}
      />
      <SpellDetailModal spell={spellDetailData} onClose={() => setSpellDetailData(null)} zOverlay="z-[230]" zContent="z-[231]" />
    </>
  );

  const featuresContent = (
    <div className={embedded ? "p-3 flex flex-col h-full" : undefined}>
      {!embedded && (
        <div className="flex items-center justify-between flex-shrink-0">
          <h3 className="text-sm font-semibold text-gray-300">特性</h3>
          <Dialog.Close className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg bg-gray-700/50 hover:bg-gray-600/50 text-gray-400 hover:text-white transition-colors">
            ✕
          </Dialog.Close>
        </div>
      )}

      <div className={embedded ? "flex-1 overflow-y-auto space-y-5" : "flex-1 overflow-y-auto mt-4 space-y-5"}>
        {/* Profile summary */}
        <div className="text-xs text-gray-400 space-x-4">
          <span>职业：{charClass?.name || character.class_id}</span>
          {allSubclasses && allSubclasses.length > 1
            ? <span>子职业：{allSubclasses.map((sc: any) => sc.name).join('、')}</span>
            : subclass && <span>子职业：{subclass.name}</span>
          }
          {fightingStyleValue && <span>战斗风格：{formatFightingStyle(fightingStyleValue)}</span>}
        </div>

        {/* Proficiencies */}
        <div>
          <SectionHeader
            icon={<svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 01-1.043 3.296 3.745 3.745 0 01-3.296 1.043A3.745 3.745 0 0112 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 01-3.296-1.043 3.745 3.745 0 01-1.043-3.296A3.745 3.745 0 013 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 011.043-3.296 3.746 3.746 0 013.296-1.043A3.746 3.746 0 0112 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 013.296 1.043 3.745 3.745 0 011.043 3.296A3.745 3.745 0 0121 12z" /></svg>}
            label="熟练项"
            color="text-violet-400"
          />
          <div className="mt-2">
            <ProficienciesSummary
              race={race} subrace={subrace} charClass={charClass} subclass={subclass}
              allSubclasses={allSubclasses} background={background} character={character}
              selectedSkills={selectedSkills} raceChoiceSkills={raceChoiceSkills}
              subclassChoiceSkillsRaw={subclassChoiceSkillsRaw} skillsById={skillsById}
            />
          </div>
        </div>

        {/* Race Features */}
        <div>
          <SectionHeader
            icon={<svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" /></svg>}
            label="种族特性"
            color="text-blue-400"
          />
          <div className="mt-2">
            <RaceFeaturesSection race={race} subrace={subrace} raceChoices={character?.race_choices || (character as any)?.raceChoices} />
          </div>
        </div>

        {/* Class Features */}
        <div>
          <SectionHeader
            icon={<svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" /></svg>}
            label="职业特性"
            color="text-amber-400"
          />
          <div className="mt-2">
            <ClassFeaturesSection
              character={character} charClass={charClass} subclass={subclass}
              allSubclasses={allSubclasses}
              onOpenInvEncyc={() => setInvEncycOpen(true)}
              openSpellDetail={openSpellDetail}
            />
          </div>
        </div>

        {/* Background Feature */}
        {background && (
          <div>
            <SectionHeader
              icon={<svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" /></svg>}
              label="背景特性"
              color="text-emerald-400"
            />
            <div className="mt-2">
              <BackgroundFeatureSection background={background} />
            </div>
          </div>
        )}

        {/* Level Progression */}
        <div>
          <SectionHeader
            icon={<svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" /></svg>}
            label="升级历程"
            color="text-cyan-400"
          />
          <div className="mt-2">
            <LevelProgressionSection
              character={character} charClass={charClass}
              subclass={subclass} allSubclasses={allSubclasses}
              race={race} subrace={subrace}
            />
          </div>
        </div>
      </div>

      {!embedded && (
        <div className="text-right flex-shrink-0 mt-4">
          <button className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm" onClick={() => onOpenChange(false)}>
            关闭
          </button>
        </div>
      )}
    </div>
  );

  if (embedded) {
    return <>{featuresContent}{childModals}</>;
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-[10198]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[92vw] max-w-3xl max-h-[90dvh] bg-gray-900 border border-gray-700 rounded p-4 flex flex-col z-[10200]">
          <Dialog.Title className="sr-only">特性</Dialog.Title>
          {featuresContent}
        </Dialog.Content>
      </Dialog.Portal>
      {childModals}
    </Dialog.Root>
  );
}
