import React, { useState, useEffect } from "react";
import { getAssetUrl } from "~/utils/asset-url";
import { SpellDetailModal, type SpellCardData } from "~/components/spell/SpellSelectableCard";

interface Props {
  race: any;
  subrace: any;
  /** raceChoices from character — needed for cantripChoice spells (e.g. High Elf) */
  raceChoices?: any;
}

const ABILITY_CN: Record<string, string> = {
  strength: '力量', dexterity: '敏捷', constitution: '体质',
  intelligence: '智力', wisdom: '感知', charisma: '魅力',
};

/** Collect spell IDs granted by a trait */
function getTraitSpellIds(trait: any, raceChoices?: any): string[] {
  const ids: string[] = [];
  if (trait.cantrip) ids.push(trait.cantrip);
  if (trait.spells?.length) {
    for (const s of trait.spells) {
      if (s.name) ids.push(s.name);
    }
  }
  // cantripChoice — user-selected cantrip stored in raceChoices
  if (trait.cantripChoice && raceChoices?.cantrip) {
    ids.push(raceChoices.cantrip);
  }
  return [...new Set(ids)];
}

export function RaceFeaturesSection({ race, subrace, raceChoices }: Props) {
  const raceTraits = [...(race?.traits || []), ...((subrace?.traits) || [])];
  const dvTrait = raceTraits.find((t: any) => /黑暗视觉|darkvision/i.test(t.name || t.nameEn || ''));
  const otherTraits = raceTraits.filter((t: any) => t !== dvTrait);
  const dvRange = dvTrait?.range || 0;
  const dvMax = 120;
  const dvPct = Math.min(dvRange / dvMax * 100, 100);
  const isSuperior = dvRange > 60;

  // Spell lookup map (lazy loaded)
  const [spellMap, setSpellMap] = useState<Map<string, any>>(new Map());
  const [detailSpell, setDetailSpell] = useState<SpellCardData | null>(null);

  // Collect all spell IDs needed by traits
  const allSpellIds = raceTraits.flatMap((t: any) => getTraitSpellIds(t, raceChoices));

  useEffect(() => {
    if (allSpellIds.length === 0) return;
    import('~/data/rules/spells.json').then(mod => {
      const map = new Map<string, any>();
      for (const s of (mod.default as any).spells || []) {
        map.set(s.id, s);
      }
      setSpellMap(map);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allSpellIds.join(',')]);

  return (
    <div className="space-y-2 max-h-[35dvh] overflow-auto pr-1">
      {/* Darkvision card */}
      <div className={`rounded-lg p-2.5 ${dvRange > 0
        ? (isSuperior ? 'bg-purple-950/30 border border-purple-700/40' : 'bg-indigo-950/30 border border-indigo-700/40')
        : 'bg-gray-800/30 border border-gray-700/40'}`}
      >
        <div className="flex items-center gap-2.5">
          <div className={`relative w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${dvRange > 0 ? (isSuperior ? 'bg-purple-900/50' : 'bg-indigo-900/40') : 'bg-gray-800/60'}`}>
            <svg viewBox="0 0 24 24" className={`w-5 h-5 ${dvRange > 0 ? (isSuperior ? 'text-purple-300' : 'text-indigo-300') : 'text-gray-600'}`} fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline gap-1.5">
              <span className={`text-sm font-semibold ${dvRange > 0 ? (isSuperior ? 'text-purple-200' : 'text-indigo-200') : 'text-gray-500'}`}>
                黑暗视觉
              </span>
              {isSuperior && <span className="text-[10px] text-purple-400">增强</span>}
            </div>
            <div className="flex items-center gap-2 mt-1">
              <div className="flex-1 h-1.5 bg-gray-700/60 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${isSuperior ? 'bg-gradient-to-r from-purple-500 to-violet-400' : dvRange > 0 ? 'bg-gradient-to-r from-indigo-600 to-indigo-400' : ''}`}
                  style={{ width: `${dvPct}%` }}
                />
              </div>
              <span className={`text-xs font-mono font-bold tabular-nums w-10 text-right ${dvRange > 0 ? (isSuperior ? 'text-purple-300' : 'text-indigo-300') : 'text-gray-600'}`}>
                {dvRange}尺
              </span>
            </div>
          </div>
        </div>
        {dvRange === 0 && (
          <div className="text-[10px] text-gray-500 mt-1 ml-[46px]">无黑暗视觉，在黑暗中等同目盲，需要光源</div>
        )}
      </div>

      {otherTraits.length === 0 && raceTraits.length === 0 && <div className="text-xs text-gray-500">无</div>}
      {otherTraits.map((f: any, i: number) => {
        const traitSpellIds = getTraitSpellIds(f, raceChoices);
        const traitSpells = traitSpellIds.map(id => spellMap.get(id)).filter(Boolean);
        const ability = f.spellcastingAbility;

        return (
          <div key={i} className="rounded-lg border-l-2 border-blue-600/50 bg-gray-800/30 border border-l-2 border-gray-700/40 pl-3 pr-2 py-2">
            <div className="text-sm text-gray-200 font-medium">{f.name}</div>
            <div className="text-xs text-gray-400 whitespace-pre-wrap mt-0.5">{f.description}</div>

            {/* Spell cards for traits that grant spells */}
            {traitSpells.length > 0 && (
              <div className="mt-2 space-y-1.5">
                {traitSpells.map((spell: any) => {
                  const spellLevel = spell.level ?? 0;
                  const iconSrc = spell.iconPath
                    ? getAssetUrl(spell.iconPath.replace(/^\//, ''))
                    : getAssetUrl(`assets/spell-icons/${spell.id}.png`);
                  // Find usesPerDay from trait.spells array
                  const traitSpellEntry = f.spells?.find((s: any) => s.name === spell.id);
                  const usesPerDay = traitSpellEntry?.usesPerDay;

                  return (
                    <button
                      key={spell.id}
                      onClick={() => setDetailSpell(spell)}
                      className="w-full flex items-center gap-2 p-1.5 rounded-md
                        bg-cyan-950/30 border border-cyan-700/30 hover:border-cyan-600/50
                        hover:bg-cyan-900/30 transition-colors cursor-pointer text-left"
                    >
                      <img
                        src={iconSrc} alt=""
                        className="w-8 h-8 rounded flex-shrink-0 object-cover"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-sm text-cyan-200 font-medium truncate">{spell.name}</span>
                          <span className="text-[10px] px-1 py-0.5 rounded bg-cyan-800/40 text-cyan-400 border border-cyan-700/30 flex-shrink-0">
                            {spellLevel === 0 ? '戏法' : `${spellLevel}环`}
                          </span>
                          {usesPerDay && (
                            <span className="text-[10px] px-1 py-0.5 rounded bg-amber-800/30 text-amber-400 border border-amber-700/30 flex-shrink-0">
                              {usesPerDay}/天
                            </span>
                          )}
                          {ability && (
                            <span className="text-[10px] text-cyan-500 flex-shrink-0">
                              {ABILITY_CN[ability] || ability}施法
                            </span>
                          )}
                        </div>
                        {spell.nameEn && (
                          <div className="text-[10px] text-gray-500 truncate">{spell.nameEn}</div>
                        )}
                      </div>
                      <span className="text-[10px] text-gray-500 flex-shrink-0">详情 ›</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {/* Spell detail modal */}
      <SpellDetailModal spell={detailSpell} onClose={() => setDetailSpell(null)} />
    </div>
  );
}
