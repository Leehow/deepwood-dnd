/**
 * Locale-aware display behavior for spell cards.
 *
 * Verifies the narrow consumer slice: `SpellSelectableCard`, `SpellCard`,
 * and `SpellCardFull` route their visible name/description through the
 * rule-data localized helpers (`getLocalizedName` /
 * `getLocalizedDescription`) keyed on the current frontend locale.
 *
 * - en-US: shows English (`nameEn` / `descriptionEn`) as primary, and does
 *   not deliberately keep the Chinese `name` as a secondary label.
 * - zh-CN: keeps the existing visible behavior (Chinese primary, English
 *   secondary label where the component already had one).
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SupportedLocale } from '~/i18n/config';
import { getI18n, setLocale } from '~/i18n';

// Drive real i18next so `useTranslation('common')` resolves to the actual
// translations. `useCurrentLocale` is left as the real implementation, which
// reads from the same i18n instance.
getI18n();

async function applyLocale(locale: SupportedLocale) {
  await setLocale(locale);
}

// Heavy / unrelated children — only the headings + descriptions matter here.
vi.mock('~/components/ui/Rules_SpellDetail', () => ({
  SpellAttributeTooltip: ({ children }: { children: React.ReactNode }) => children,
  analyzeSpellTargeting: () => ({
    rangeLabel: '',
    targetIcon: '',
    targetLabel: '',
    areaDetail: '',
  }),
  isSelfCenteredAreaSpell: () => false,
}));

vi.mock('~/components/character/CharacterDisplay/sections/Spells/SpellbookSvg', () => ({
  SpellDivider: () => null,
  ScrollFrame: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('~/components/ui/LatexText', () => ({
  LatexText: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('~/config/api', () => ({
  getApiEndpoint: () => '',
}));

vi.mock('~/utils/asset-url', () => ({
  getAssetUrl: (p: string) => p,
}));

import { SpellSelectableCard } from '~/components/spell/SpellSelectableCard';
import { SpellCard } from '~/components/spell/SpellCard';
import { SpellCardFull } from '~/components/spell/SpellCardFull';

const baseSpell = {
  id: 'fireball',
  name: '火球术',
  nameEn: 'Fireball',
  level: 3,
  school: 'evocation',
  components: ['V', 'S', 'M'],
  castingTime: '1 动作',
  range: '150 尺',
  duration: '瞬间',
  ritual: false,
  concentration: false,
  description: '火焰从你的指尖喷射而出。',
  descriptionEn: 'A bright streak flashes from your finger.',
  classes: [],
  iconPath: 'assets/spell-icons/fireball.png',
} as any;

beforeEach(async () => {
  await applyLocale('en-US');
});

afterEach(() => {
  // Ensure fetch/Audio stubs from the TTS test don't leak into later tests
  // even when an assertion above unstubAllGlobals() throws.
  vi.unstubAllGlobals();
});

describe('SpellSelectableCard — locale-aware display', () => {
  const props = {
    spell: baseSpell,
    isSelected: false,
    canSelect: true,
    onClick: vi.fn(),
  };

  it('en-US shows English nameEn as the primary, no Chinese subtitle', async () => {
    await applyLocale('en-US');
    render(<SpellSelectableCard {...props} />);
    expect(screen.getByText('Fireball')).toBeInTheDocument();
    expect(screen.queryByText('火球术')).not.toBeInTheDocument();
  });

  it('zh-CN keeps Chinese primary and English secondary subtitle', async () => {
    await applyLocale('zh-CN');
    render(<SpellSelectableCard {...props} />);
    expect(screen.getByText('火球术')).toBeInTheDocument();
    expect(screen.getByText('Fireball')).toBeInTheDocument();
  });

  it('caller-provided subtitle overrides the locale default', async () => {
    await applyLocale('en-US');
    render(<SpellSelectableCard {...props} subtitle="Lv 3 · Evocation" />);
    expect(screen.getByText('Lv 3 · Evocation')).toBeInTheDocument();
  });

  it('en-US detail tooltip is localized', async () => {
    await applyLocale('en-US');
    render(<SpellSelectableCard {...props} onDetailClick={vi.fn()} />);
    expect(screen.getByTitle('View spell details')).toBeInTheDocument();
  });

  it('zh-CN detail tooltip preserves Chinese', async () => {
    await applyLocale('zh-CN');
    render(<SpellSelectableCard {...props} onDetailClick={vi.fn()} />);
    expect(screen.getByTitle('查看法术详情')).toBeInTheDocument();
  });
});

describe('SpellCard (compact) — locale-aware display', () => {
  it('en-US: English primary, no Chinese secondary line', async () => {
    await applyLocale('en-US');
    render(<SpellCard spell={baseSpell} />);
    expect(screen.getByText('Fireball')).toBeInTheDocument();
    expect(screen.queryByText('火球术')).not.toBeInTheDocument();
  });

  it('en-US: localized level and school terms', async () => {
    await applyLocale('en-US');
    render(<SpellCard spell={baseSpell} />);
    expect(screen.getByText('Level 3')).toBeInTheDocument();
    expect(screen.getByText('Evocation')).toBeInTheDocument();
    expect(screen.queryByText('3环')).not.toBeInTheDocument();
    expect(screen.queryByText('塑能')).not.toBeInTheDocument();
  });

  it('zh-CN: Chinese level and school terms preserved', async () => {
    await applyLocale('zh-CN');
    render(<SpellCard spell={baseSpell} />);
    expect(screen.getByText('3环')).toBeInTheDocument();
    expect(screen.getByText('塑能')).toBeInTheDocument();
  });

  it('en-US: cantrip level renders as "Cantrip"', async () => {
    await applyLocale('en-US');
    const cantrip = { ...baseSpell, level: 0 };
    render(<SpellCard spell={cantrip} />);
    expect(screen.getByText('Cantrip')).toBeInTheDocument();
    expect(screen.queryByText('戏法')).not.toBeInTheDocument();
  });

  it('en-US: icon alt text uses the localized primary name', async () => {
    await applyLocale('en-US');
    render(<SpellCard spell={baseSpell} />);
    expect(screen.getByAltText('Fireball')).toBeInTheDocument();
  });

  it('zh-CN: Chinese primary, English secondary line preserved', async () => {
    await applyLocale('zh-CN');
    render(<SpellCard spell={baseSpell} />);
    expect(screen.getByText('火球术')).toBeInTheDocument();
    expect(screen.getByText('Fireball')).toBeInTheDocument();
  });
});

describe('SpellCardFull (full variant) — locale-aware display', () => {
  it('en-US: English name + English description + English chrome labels', async () => {
    await applyLocale('en-US');
    render(<SpellCardFull spell={baseSpell} />);
    expect(screen.getByText('Fireball')).toBeInTheDocument();
    expect(screen.queryByText('火球术')).not.toBeInTheDocument();
    expect(screen.getByText(/bright streak flashes/i)).toBeInTheDocument();
    expect(screen.queryByText(/火焰从你的指尖/)).not.toBeInTheDocument();
    // Static chrome labels are localized.
    expect(screen.getByText('Spell Description')).toBeInTheDocument();
    expect(screen.getByText('Casting Time')).toBeInTheDocument();
    expect(screen.queryByText('法术描述')).not.toBeInTheDocument();
    expect(screen.queryByText('施法时间')).not.toBeInTheDocument();
  });

  it('zh-CN: Chinese name + Chinese description + Chinese chrome labels preserved', async () => {
    await applyLocale('zh-CN');
    render(<SpellCardFull spell={baseSpell} />);
    expect(screen.getByText('火球术')).toBeInTheDocument();
    expect(screen.getByText('Fireball')).toBeInTheDocument();
    expect(screen.getByText('火焰从你的指尖喷射而出。')).toBeInTheDocument();
    expect(screen.queryByText(/bright streak flashes/i)).not.toBeInTheDocument();
    expect(screen.getByText('法术描述')).toBeInTheDocument();
    expect(screen.getByText('施法时间')).toBeInTheDocument();
  });

  it('en-US TTS request body uses the localized English description', async () => {
    await applyLocale('en-US');
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ audio_url: '/audio.mp3' }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    class StubAudio {
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      play = vi.fn().mockResolvedValue(undefined);
      pause = vi.fn();
      constructor(_src?: string) {}
    }
    vi.stubGlobal('Audio', StubAudio as any);

    render(<SpellCardFull spell={baseSpell} />);
    // Under en-US the TTS button surfaces the English title.
    await act(async () => {
      fireEvent.click(screen.getByTitle('Read spell description'));
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(call[1].body as string);
    expect(body.text).toBe('A bright streak flashes from your finger.');
  });

  it('en-US falls back to canonical description when no descriptionEn present', async () => {
    await applyLocale('en-US');
    const partial = { ...baseSpell, descriptionEn: undefined };
    render(<SpellCardFull spell={partial} />);
    // No English description available → helper returns the canonical
    // (currently Chinese) description rather than rendering empty.
    expect(screen.getByText('火焰从你的指尖喷射而出。')).toBeInTheDocument();
  });
});

describe('SpellCardFull — residual combat chrome localization', () => {
  const combatSpell = {
    ...baseSpell,
    damage: '8d6',
    damageType: 'fire',
    damageTypeCn: '火焰',
    saveType: 'dexterity',
    saveTypeCn: '敏捷',
    saveEffect: 'half' as const,
    areaOfEffect: { type: 'sphere', size: 20, sizeIsMax: true },
    conditions: ['poisoned'],
    affectedCreatureTypes: ['undead'],
    atHigherLevels: '+1d6 per slot above 3rd.',
  } as any;

  it('en-US: combat-section heading and structured labels are English', async () => {
    await applyLocale('en-US');
    render(<SpellCardFull spell={combatSpell} />);
    expect(screen.getByText('Combat Effects')).toBeInTheDocument();
    expect(screen.getByText('Damage')).toBeInTheDocument();
    expect(screen.getByText('Saving Throw')).toBeInTheDocument();
    expect(screen.getByText('Area of Effect')).toBeInTheDocument();
    expect(screen.getByText('Status Effects')).toBeInTheDocument();
    expect(screen.getByText('Affected Creatures')).toBeInTheDocument();
    expect(screen.getByText('At Higher Levels')).toBeInTheDocument();
    // Save-success line uses English
    expect(screen.getByText('Success: half damage')).toBeInTheDocument();
    // Area max + feet unit are English
    expect(screen.getByText(/up to 20 ft/)).toBeInTheDocument();
    // No residual Chinese chrome for these paths
    expect(screen.queryByText('战斗效果')).not.toBeInTheDocument();
    expect(screen.queryByText('豁免检定')).not.toBeInTheDocument();
    expect(screen.queryByText('影响区域')).not.toBeInTheDocument();
    expect(screen.queryByText('成功: 伤害减半')).not.toBeInTheDocument();
  });

  it('zh-CN: combat-section heading and structured labels preserved in Chinese', async () => {
    await applyLocale('zh-CN');
    render(<SpellCardFull spell={combatSpell} />);
    expect(screen.getByText('战斗效果')).toBeInTheDocument();
    expect(screen.getByText('豁免检定')).toBeInTheDocument();
    expect(screen.getByText('影响区域')).toBeInTheDocument();
    expect(screen.getByText('成功: 伤害减半')).toBeInTheDocument();
    expect(screen.getByText('状态效果')).toBeInTheDocument();
    expect(screen.getByText('特定生物类型')).toBeInTheDocument();
    expect(screen.getByText('升环施法')).toBeInTheDocument();
    expect(screen.getByText(/至多20尺/)).toBeInTheDocument();
  });
});

describe('SpellCardFull — effects pipeline chrome localization', () => {
  const effectsSpell = {
    ...baseSpell,
    effects: [
      {
        trigger: 'on_cast',
        attack: { type: 'melee_spell' },
        save: { ability: 'wisdom', on_success: 'half_damage' },
        effects: [
          { type: 'deal_damage', formula: '4d8', damage_type: 'thunder' },
        ],
        duration: { rounds: 10 },
        scaling: { per_slot_above: 3, extra_dice: '1d8', extra_targets: 1 },
      },
    ],
    zoneEffects: { obscurement: 'heavy', difficultTerrain: true },
    castOptions: [
      { key: 'enlarge', label: '变巨', effects: [] },
      { key: 'reduce', label: '缩小', effects: [] },
    ],
  } as any;

  it('en-US: spell-effects heading, zone tags, cast-option labels are English', async () => {
    await applyLocale('en-US');
    render(<SpellCardFull spell={effectsSpell} />);
    expect(screen.getByText('Spell Effects')).toBeInTheDocument();
    expect(screen.getByText(/Heavy Obscurement/)).toBeInTheDocument();
    expect(screen.getByText(/Difficult Terrain/)).toBeInTheDocument();
    expect(screen.getByText(/Enlarge/)).toBeInTheDocument();
    expect(screen.getByText(/Reduce/)).toBeInTheDocument();
    expect(screen.getByText(/Melee Attack/)).toBeInTheDocument();
    // Scaling line uses English
    expect(screen.getByText(/Per slot above 3/)).toBeInTheDocument();
    expect(screen.queryByText('法术效果')).not.toBeInTheDocument();
    expect(screen.queryByText('重度遮蔽')).not.toBeInTheDocument();
    expect(screen.queryByText('困难地形')).not.toBeInTheDocument();
    expect(screen.queryByText('近战攻击')).not.toBeInTheDocument();
  });

  it('zh-CN: spell-effects heading, zone tags, cast-option labels preserved in Chinese', async () => {
    await applyLocale('zh-CN');
    render(<SpellCardFull spell={effectsSpell} />);
    expect(screen.getByText('法术效果')).toBeInTheDocument();
    expect(screen.getByText(/重度遮蔽/)).toBeInTheDocument();
    expect(screen.getByText(/困难地形/)).toBeInTheDocument();
    expect(screen.getByText(/变巨/)).toBeInTheDocument();
    expect(screen.getByText(/缩小/)).toBeInTheDocument();
    expect(screen.getByText(/近战攻击/)).toBeInTheDocument();
    expect(screen.getByText(/每升3环/)).toBeInTheDocument();
  });
});

describe('SpellCardFull (spellbook variant) — locale-aware display', () => {
  it('en-US: English name + English description in spellbook view', async () => {
    await applyLocale('en-US');
    render(<SpellCardFull spell={baseSpell} theme="spellbook" />);
    expect(screen.getByText('Fireball')).toBeInTheDocument();
    expect(screen.queryByText('火球术')).not.toBeInTheDocument();
    expect(screen.getByText(/bright streak flashes/i)).toBeInTheDocument();
    expect(screen.getByText('Casting Time')).toBeInTheDocument();
  });

  it('zh-CN: Chinese name + Chinese description in spellbook view', async () => {
    await applyLocale('zh-CN');
    render(<SpellCardFull spell={baseSpell} theme="spellbook" />);
    expect(screen.getByText('火球术')).toBeInTheDocument();
    expect(screen.getByText('Fireball')).toBeInTheDocument();
    expect(screen.getByText('火焰从你的指尖喷射而出。')).toBeInTheDocument();
    expect(screen.getByText('施法时间')).toBeInTheDocument();
  });
});
