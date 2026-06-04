import React, { useEffect, useState, useCallback } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { spellDataLoader } from "~/services/spellDataLoader";
import { SpellDetailModal } from "~/components/spell/SpellSelectableCard";
import type { Spell } from "~/types/spell";
import { formatFightingStyle, formatEldritchInvocation, formatFavoredEnemy, formatFavoredTerrain, formatMetamagic } from "../../utils/formatting";
import { getSubclassStructuredFeatures } from "~/utils/classDataLoader";
import { useFloatingZIndex } from "~/stores/floatingZIndexStore";
import featsJson from "~/data/rules/feats.json";
import classesProgression from "~/data/rules/classes-progression.json";

interface Props {
  character: any;
  charClass: any;
  subclass: any;
  allSubclasses?: any[];
  race?: any;
  subrace?: any;
}

type ItemCategory = 'spell' | 'feat' | 'asi' | 'feature' | 'subclass';

interface ProgressionItem {
  category: ItemCategory;
  label: string;
  spellId?: string;
  spellLevel?: number; // 0=cantrip, 1-9=spell level
  featId?: string;
}

interface LevelEntry {
  level: number;
  items: ProgressionItem[];
}

const SPELL_LEVEL_LABELS: Record<number, string> = {
  0: '戏法', 1: '1环', 2: '2环', 3: '3环', 4: '4环',
  5: '5环', 6: '6环', 7: '7环', 8: '8环', 9: '9环',
};

const CATEGORY_CONFIG: Record<ItemCategory, { icon: string; label: string; order: number }> = {
  spell: { icon: '✦', label: '法术', order: 0 },
  feat: { icon: '◆', label: '专长', order: 1 },
  asi: { icon: '▲', label: '属性提升', order: 2 },
  feature: { icon: '▸', label: '特性', order: 3 },
  subclass: { icon: '★', label: '子职业', order: 4 },
};

const ABILITY_LABEL: Record<string, string> = {
  strength: '力量', dexterity: '敏捷', constitution: '体质',
  intelligence: '智力', wisdom: '感知', charisma: '魅力',
};

const extractValue = (field: any): string | undefined => {
  if (!field) return undefined;
  if (typeof field === 'string') return field;
  if (typeof field === 'object' && field.value) return field.value;
  return undefined;
};

const extractLevelAcquired = (field: any): number | undefined => {
  if (!field || typeof field !== 'object') return undefined;
  return field.level_acquired;
};

interface SubclassFeature {
  level: number;
  name: string;
  description: string;
}

function SubclassDetailDialog({
  subclassName,
  features,
  highlightLevel,
  children,
}: {
  subclassName: string;
  features: SubclassFeature[];
  highlightLevel: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [zIndex, setZIndex] = useState(10300);
  const bringToFront = useFloatingZIndex(s => s.bringToFront);
  const handleFocus = useCallback(() => setZIndex(bringToFront()), [bringToFront]);
  if (features.length === 0) return <>{children}</>;

  return (
    <Dialog.Root open={open} onOpenChange={(v) => { setOpen(v); if (v) handleFocus(); }}>
      <Dialog.Trigger asChild>{children}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60" style={{ zIndex: zIndex - 1 }} />
        <Dialog.Content
          onPointerDown={handleFocus}
          style={{ zIndex }}
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[90vw] max-w-lg max-h-[80vh] overflow-y-auto rounded-lg bg-gray-900 border border-purple-800/40 shadow-2xl p-5"
        >
          <Dialog.Title className="text-sm font-bold text-purple-300 mb-3 flex items-center gap-2">
            <span>★</span> {subclassName}
          </Dialog.Title>
          <div className="space-y-2.5">
            {features.map((feat, i) => {
              const isHighlight = feat.level === highlightLevel;
              return (
                <div
                  key={i}
                  className={`rounded-md px-3 py-2 border transition-colors ${
                    isHighlight
                      ? 'bg-purple-900/40 border-purple-500/50'
                      : 'bg-gray-800/40 border-gray-700/30'
                  }`}
                >
                  <div className="flex items-baseline gap-2 mb-1">
                    <span className={`text-[11px] font-mono ${isHighlight ? 'text-purple-300' : 'text-gray-500'}`}>
                      {feat.level}级
                    </span>
                    <span className={`text-xs font-medium ${isHighlight ? 'text-purple-200' : 'text-gray-300'}`}>
                      {feat.name}
                    </span>
                  </div>
                  <p className={`text-[11px] leading-relaxed ${isHighlight ? 'text-gray-200' : 'text-gray-500'}`}>
                    {feat.description}
                  </p>
                </div>
              );
            })}
          </div>
          <Dialog.Close className="absolute top-2 right-2 text-gray-400 hover:text-white text-lg leading-none p-1">✕</Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function SpellDetailDialog({ spellId, children }: { spellId: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const spell = spellDataLoader.getSpellById(spellId);
  if (!spell) return <>{children}</>;

  const trigger = React.isValidElement(children)
    ? React.cloneElement(children as React.ReactElement<any>, {
        onClick: (e: any) => {
          (children.props as any).onClick?.(e);
          setOpen(true);
        },
      })
    : (
      <button
        type="button"
        className="text-amber-300/90 hover:text-amber-200 hover:underline cursor-pointer"
        onClick={() => setOpen(true)}
      >
        {children}
      </button>
    );

  return (
    <>
      {trigger}
      <SpellDetailModal spell={open ? (spell as any) : null} onClose={() => setOpen(false)} />
    </>
  );
}

function FeatDetailDialog({ featId, children }: { featId: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [zIndex, setZIndex] = useState(10300);
  const bringToFront = useFloatingZIndex(s => s.bringToFront);
  const handleFocus = useCallback(() => setZIndex(bringToFront()), [bringToFront]);
  const feat = (featsJson as any).feats?.[featId];
  if (!feat) return <>{children}</>;

  return (
    <Dialog.Root open={open} onOpenChange={(v) => { setOpen(v); if (v) handleFocus(); }}>
      <Dialog.Trigger asChild>{children}</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60" style={{ zIndex: zIndex - 1 }} />
        <Dialog.Content
          onPointerDown={handleFocus}
          style={{ zIndex }}
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[90vw] max-w-md max-h-[80vh] overflow-y-auto rounded-lg bg-gray-900 border border-amber-800/40 shadow-2xl p-5"
        >
          <Dialog.Title className="text-sm font-bold text-amber-300 mb-1">{feat.name}</Dialog.Title>
          {feat.nameEn && <div className="text-[11px] text-gray-500 mb-3 italic">{feat.nameEn}</div>}
          {feat.prerequisites?.description && (
            <div className="text-[11px] text-gray-400 mb-2">前提: {feat.prerequisites.description}</div>
          )}
          {feat.benefits && (
            <ul className="space-y-1.5 text-[12px] text-gray-200">
              {feat.benefits.map((b: string, i: number) => (
                <li key={i} className="flex gap-1.5">
                  <span className="text-amber-500 shrink-0">•</span>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          )}
          <Dialog.Close className="absolute top-2 right-2 text-gray-400 hover:text-white text-lg leading-none p-1">✕</Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function LevelProgressionSection({ character, charClass, subclass, allSubclasses, race, subrace }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [subclassLevel, setSubclassLevel] = useState<number | null>(null);
  const [subclassFeatures, setSubclassFeatures] = useState<SubclassFeature[]>([]);
  const [bonusCantrips, setBonusCantrips] = useState<string[]>([]);

  const subs = allSubclasses && allSubclasses.length > 0 ? allSubclasses : (subclass ? [subclass] : []);

  useEffect(() => {
    if (!charClass?.id) return;
    (async () => {
      if (subs.length > 0 && subs[0]?.id) {
        const features = await getSubclassStructuredFeatures(charClass.id, subs[0].id);
        setSubclassFeatures(features);
        if (features.length > 0) {
          setSubclassLevel(Math.min(...features.map(f => f.level)));
        }
        // Load bonus cantrips from structured subclass data
        try {
          const data = await import('~/data/rules/classes_with_structured_subclass_features.json');
          const arr: any[] = Array.isArray(data.default) ? data.default : Array.isArray(data) ? data as any : [];
          const cls = arr.find((c: any) => c.id === charClass.id);
          const sc = cls?.subclasses?.find((s: any) => s.id === subs[0].id);
          const bonus: string[] = [];
          for (const feat of sc?.level1Features || []) {
            if (feat.structuredData?.bonusCantrips?.length) {
              bonus.push(...feat.structuredData.bonusCantrips);
            }
          }
          setBonusCantrips(bonus);
        } catch { /* ignore */ }
      }
    })();
  }, [charClass?.id, subs.map(s => s?.id).join(',')]);

  const levelMap = new Map<number, ProgressionItem[]>();
  const addItem = (level: number, item: ProgressionItem) => {
    if (!levelMap.has(level)) levelMap.set(level, []);
    levelMap.get(level)!.push(item);
  };

  // Spells
  const selectedSpells = character.selected_spells || character.selectedSpells || [];
  const selectedCantrips = character.selected_cantrips || character.selectedCantrips || [];
  const trackedSpellIds = new Set<string>();

  for (const list of [selectedCantrips, selectedSpells]) {
    for (const entry of list) {
      const isCantrip = list === selectedCantrips;
      if (typeof entry === 'object' && entry.level_learned) {
        // Object with level tracking
        const spell = spellDataLoader.getSpellById(entry.id);
        const name = spell?.name || entry.id;
        const spellLevel = isCantrip ? 0 : (spell?.level ?? 1);
        trackedSpellIds.add(entry.id);
        addItem(entry.level_learned, {
          category: 'spell',
          label: name,
          spellId: entry.id,
          spellLevel,
        });
      } else {
        // Plain string ID (no level tracking) — assume level 1
        const id = typeof entry === 'string' ? entry : entry.id;
        if (!id) continue;
        const spell = spellDataLoader.getSpellById(id);
        const name = spell?.name || id;
        const spellLevel = isCantrip ? 0 : (spell?.level ?? 1);
        trackedSpellIds.add(id);
        addItem(1, {
          category: 'spell',
          label: name,
          spellId: id,
          spellLevel,
        });
      }
    }
  }

  // Subclass bonus cantrips (e.g. Illusion wizard gets Minor Illusion)
  if (bonusCantrips.length > 0 && subclassLevel) {
    for (const cantripId of bonusCantrips) {
      if (trackedSpellIds.has(cantripId)) continue; // already in selected_cantrips
      const spell = spellDataLoader.getSpellById(cantripId);
      const name = spell?.name || cantripId;
      addItem(subclassLevel, {
        category: 'spell',
        label: name,
        spellId: cantripId,
        spellLevel: 0,
      });
    }
  }

  // Racial spells (e.g. Forest Gnome: Minor Illusion, Drow: Dancing Lights/Faerie Fire/Darkness, Tiefling: Thaumaturgy)
  const allTraits = [...(race?.traits || []), ...(subrace?.traits || [])];
  for (const trait of allTraits) {
    const traitSpells = trait.spells || (trait.cantrip ? [{ name: trait.cantrip, level: 0 }] : []);
    for (const rs of traitSpells) {
      const spellId = rs.name || rs.id;
      if (!spellId || trackedSpellIds.has(spellId)) continue;
      const spell = spellDataLoader.getSpellById(spellId);
      const name = spell?.name || spellId;
      const targetLevel = rs.minCharacterLevel || 1;
      trackedSpellIds.add(spellId);
      addItem(targetLevel, {
        category: 'spell',
        label: `${name}（种族）`,
        spellId: spellId,
        spellLevel: rs.level ?? (spell?.level ?? 0),
      });
    }
  }

  // Feats
  const feats = character.feats || [];
  const featChoices = character.feat_choices || character.featChoices || {};
  // Find ASI levels from class progression to assign feats without explicit level
  const asiLevels: number[] = [];
  const classId = character.class_id || charClass?.id;
  const progClass = classId ? (classesProgression as any).classes?.[classId] : null;
  if (progClass?.levelProgression) {
    for (const [lv, info] of Object.entries(progClass.levelProgression) as [string, any][]) {
      if (info?.features?.some((f: any) => f.type === 'asi_or_feat' || f.type === 'asi')) {
        asiLevels.push(Number(lv));
      }
    }
    asiLevels.sort((a, b) => a - b);
  }
  let asiIdx = 0;
  for (const rawFeat of feats) {
    const featId = typeof rawFeat === 'string' ? rawFeat : (rawFeat.value || rawFeat.id || '');
    if (!featId) continue;
    const fc = featChoices[featId];
    let level = fc?.level || (typeof rawFeat === 'object' ? rawFeat.level_acquired : null);
    if (!level && asiIdx < asiLevels.length) {
      level = asiLevels[asiIdx];
    }
    asiIdx++;
    const featData = (featsJson as any).feats?.[featId];
    if (level) {
      addItem(level, { category: 'feat', label: fc?.name || featData?.name || featId, featId });
      // Show feat-granted cantrips/spells in progression
      if (fc) {
        const featCantrips: string[] = [];
        if (fc.cantrip) featCantrips.push(fc.cantrip);
        if (Array.isArray(fc.cantrips)) featCantrips.push(...fc.cantrips);
        for (const cid of featCantrips) {
          if (trackedSpellIds.has(cid)) continue;
          trackedSpellIds.add(cid);
          const spell = spellDataLoader.getSpellById(cid);
          addItem(level, { category: 'spell', label: `${spell?.name || cid}（专长）`, spellId: cid, spellLevel: 0 });
        }
        const featSpells: string[] = [];
        if (fc.spell) featSpells.push(fc.spell);
        if (Array.isArray(fc.ritualSpells)) featSpells.push(...fc.ritualSpells);
        for (const sid of featSpells) {
          if (trackedSpellIds.has(sid)) continue;
          trackedSpellIds.add(sid);
          const spell = spellDataLoader.getSpellById(sid);
          addItem(level, { category: 'spell', label: `${spell?.name || sid}（专长）`, spellId: sid, spellLevel: spell?.level ?? 1 });
        }
      }
    }
  }

  // ASI from level_history
  const lh = character.level_history || [];
  for (const snapshot of lh) {
    const fc = snapshot.feature_choices;
    if (fc?.asiOrFeat === 'asi' && fc.asiChoices) {
      const targetLevel = (snapshot.level || 0) + 1;
      const parts = Object.entries(fc.asiChoices as Record<string, number>)
        .filter(([, v]) => v > 0)
        .map(([ab, v]) => `${ABILITY_LABEL[ab] || ab}+${v}`);
      if (parts.length > 0) {
        addItem(targetLevel, { category: 'asi', label: parts.join('、') });
      }
    }
  }

  // Fighting style
  const fs = character.fighting_style || character.fightingStyle;
  const fsLevel = extractLevelAcquired(fs);
  if (fsLevel) addItem(fsLevel, { category: 'feature', label: `战斗风格: ${formatFightingStyle(extractValue(fs) || '')}` });

  // Favored Enemy
  const fe = character.favored_enemy || character.favoredEnemy;
  const feLevel = extractLevelAcquired(fe);
  if (feLevel) addItem(feLevel, { category: 'feature', label: `宿敌: ${formatFavoredEnemy(extractValue(fe) || '')}` });

  // Favored Terrain
  const ft = character.favored_terrain || character.favoredTerrain;
  const ftLevel = extractLevelAcquired(ft);
  if (ftLevel) addItem(ftLevel, { category: 'feature', label: `偏好地形: ${formatFavoredTerrain(extractValue(ft) || '')}` });

  // Eldritch Invocations
  const invocations = character.eldritch_invocations || character.eldritchInvocations || [];
  if (Array.isArray(invocations)) {
    for (const inv of invocations) {
      if (typeof inv === 'object' && inv.level_acquired) {
        addItem(inv.level_acquired, { category: 'feature', label: `祈唤: ${formatEldritchInvocation(inv.value || inv.id || '')}` });
      }
    }
  }

  // Metamagic
  const metamagics = character.metamagic_options || character.metamagicOptions || [];
  if (Array.isArray(metamagics)) {
    for (const mm of metamagics) {
      if (typeof mm === 'object' && mm.level_acquired) {
        addItem(mm.level_acquired, { category: 'feature', label: `超魔: ${formatMetamagic(mm.value || mm.id || '')}` });
      }
    }
  }

  // Subclass — show initial selection + features at each level
  if (subclassLevel && subs.length > 0) {
    addItem(subclassLevel, { category: 'subclass', label: subs.map((s: any) => s.name).join('、') });
  }
  // Subclass features at higher levels (e.g. 预言学派 6级/10级/14级 features)
  const addedSubclassLevels = new Set<number>(subclassLevel ? [subclassLevel] : []);
  for (const sf of subclassFeatures) {
    if (sf.level && !addedSubclassLevels.has(sf.level) && sf.level <= (character.level || 1)) {
      addedSubclassLevels.add(sf.level);
      const featuresAtLevel = subclassFeatures.filter(f => f.level === sf.level);
      const names = featuresAtLevel.map(f => f.name).join('、');
      addItem(sf.level, { category: 'subclass', label: names });
    }
  }

  // Build per-level class info (for multiclass display)
  const levelClassInfo = new Map<number, { className: string; classLevel: number }>();
  const levelHistory = character.multiclass_data?.level_history || [];
  if (levelHistory.length > 0) {
    const classLevelCounters: Record<string, number> = {};
    for (const entry of [...levelHistory].sort((a: any, b: any) => a.level - b.level)) {
      const cid = entry.class || character.class_id;
      classLevelCounters[cid] = (classLevelCounters[cid] || 0) + 1;
      levelClassInfo.set(entry.level, { className: cid, classLevel: classLevelCounters[cid] });
    }
  } else {
    // Single-class: class level = character level
    const totalLevel = character.level || 1;
    for (let i = 1; i <= totalLevel; i++) {
      levelClassInfo.set(i, { className: charClass?.name || character.class_id, classLevel: i });
    }
  }

  // Resolve class name from id
  const resolveClassName = (classId: string) => {
    if (charClass?.id === classId) return charClass.name;
    // For multiclass, try to find name from multiclass_data
    const mc = character.multiclass_data?.classes?.find((c: any) => c.class_id === classId);
    return mc?.name || classId;
  };

  // Sort
  const entries: LevelEntry[] = Array.from(levelMap.entries())
    .map(([level, items]) => ({ level, items }))
    .sort((a, b) => a.level - b.level);

  if (entries.length === 0) return null;

  // Group items by category within a level
  const groupByCategory = (items: ProgressionItem[]) => {
    const groups = new Map<ItemCategory, ProgressionItem[]>();
    for (const item of items) {
      if (!groups.has(item.category)) groups.set(item.category, []);
      groups.get(item.category)!.push(item);
    }
    // Sort spells by spell level within their group
    const spellGroup = groups.get('spell');
    if (spellGroup) {
      spellGroup.sort((a, b) => (a.spellLevel ?? 0) - (b.spellLevel ?? 0));
    }
    // Return in display order
    return Array.from(groups.entries())
      .sort(([a], [b]) => CATEGORY_CONFIG[a].order - CATEGORY_CONFIG[b].order);
  };

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full text-left group"
      >
        <svg className={`w-3 h-3 text-gray-500 transition-transform ${expanded ? 'rotate-90' : ''}`} fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
        </svg>
        <span className="text-xs text-cyan-300 group-hover:text-cyan-200">升级历程</span>
        <span className="text-[10px] text-gray-500">({entries.length} 个等级有记录)</span>
      </button>

      {expanded && (
        <div className="mt-2 ml-1.5 border-l border-cyan-800/40 pl-4 space-y-3">
          {entries.map(entry => {
            const grouped = groupByCategory(entry.items);
            return (
              <div key={entry.level} className="relative">
                <div className="absolute -left-[21px] top-0.5 w-2.5 h-2.5 rounded-full bg-cyan-600/60 border border-cyan-400/40" />
                <div className="flex items-baseline gap-2">
                  <span className="text-xs font-mono font-bold text-cyan-400 w-6 shrink-0">{entry.level}级</span>
                  {(() => {
                    const info = levelClassInfo.get(entry.level);
                    const name = info ? resolveClassName(info.className) : (charClass?.name || character.class_id);
                    const clsLvl = info?.classLevel;
                    return (
                      <span className="text-xs text-gray-200">
                        {name}{clsLvl != null && <span className="text-gray-500 ml-1">{clsLvl}级</span>}
                      </span>
                    );
                  })()}
                </div>
                <div className="mt-1 space-y-0.5">
                  {grouped.map(([category, items]) => (
                    <div key={category} className="flex flex-wrap items-baseline gap-x-1 text-[11px]">
                      <span className="text-gray-500 shrink-0">
                        {CATEGORY_CONFIG[category].icon} {CATEGORY_CONFIG[category].label}:
                      </span>
                      {category === 'spell' ? (
                        items.map((item, idx) => (
                          <React.Fragment key={idx}>
                            <SpellDetailDialog spellId={item.spellId!}>
                              <button type="button" className="text-amber-300/90 hover:text-amber-200 hover:underline cursor-pointer">
                                {item.label}
                                <span className="text-gray-500 text-[10px] ml-0.5">({SPELL_LEVEL_LABELS[item.spellLevel ?? 0]})</span>
                              </button>
                            </SpellDetailDialog>
                            {idx < items.length - 1 && <span className="text-gray-600">·</span>}
                          </React.Fragment>
                        ))
                      ) : category === 'subclass' ? (
                        items.map((item, idx) => (
                          <React.Fragment key={idx}>
                            <SubclassDetailDialog
                              subclassName={subs[0]?.name || item.label}
                              features={subclassFeatures}
                              highlightLevel={entry.level}
                            >
                              <button type="button" className="text-purple-300/90 hover:text-purple-200 hover:underline cursor-pointer">
                                {item.label}
                              </button>
                            </SubclassDetailDialog>
                            {idx < items.length - 1 && <span className="text-gray-600">·</span>}
                          </React.Fragment>
                        ))
                      ) : category === 'feat' ? (
                        items.map((item, idx) => (
                          <React.Fragment key={idx}>
                            <FeatDetailDialog featId={item.featId!}>
                              <button type="button" className="text-amber-300/90 hover:text-amber-200 hover:underline cursor-pointer">
                                {item.label}
                              </button>
                            </FeatDetailDialog>
                            {idx < items.length - 1 && <span className="text-gray-600">·</span>}
                          </React.Fragment>
                        ))
                      ) : category === 'asi' ? (
                        items.map((item, idx) => (
                          <React.Fragment key={idx}>
                            <span className="text-green-300/90">{item.label}</span>
                            {idx < items.length - 1 && <span className="text-gray-600">·</span>}
                          </React.Fragment>
                        ))
                      ) : (
                        items.map((item, idx) => (
                          <React.Fragment key={idx}>
                            <span className="text-gray-300">{item.label}</span>
                            {idx < items.length - 1 && <span className="text-gray-600">·</span>}
                          </React.Fragment>
                        ))
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
