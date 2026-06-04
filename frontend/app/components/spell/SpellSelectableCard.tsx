import React, { useState, useCallback } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { SpellCard } from '~/components/spell/SpellCard';
import { normalizeSpellData } from '~/components/spell/normalizeSpell';
import { getAssetUrl } from '~/utils/asset-url';
import { ScrollFrame } from '~/components/character/CharacterDisplay/sections/Spells/SpellbookSvg';
import { useFloatingZIndex } from '~/stores/floatingZIndexStore';
import { useTranslation } from 'react-i18next';
import { useCurrentLocale } from '~/i18n/LocaleProvider';
import { getLocalizedName } from '~/utils/i18n';

/** Minimal spell shape accepted by the card */
export interface SpellCardData {
  id: string;
  name: string;
  nameEn?: string;
  school?: string;
  description?: string;
  concentration?: boolean;
  ritual?: boolean;
  castingTime?: string;
  iconPath?: string;
  [key: string]: any;
}

type ColorKey = 'amber' | 'green' | 'orange' | 'purple' | 'cyan';

const COLOR_MAP: Record<ColorKey, { border: string; bg: string; dot: string }> = {
  amber:  { border: 'border-amber-400',  bg: 'bg-amber-400/20',  dot: 'text-amber-400' },
  green:  { border: 'border-green-600/60', bg: 'bg-green-900/20', dot: 'text-green-400' },
  orange: { border: 'border-orange-400', bg: 'bg-orange-400/20', dot: 'text-orange-400' },
  purple: { border: 'border-purple-500', bg: 'bg-purple-900/50', dot: 'text-purple-400' },
  cyan:   { border: 'border-cyan-500/60', bg: 'bg-cyan-900/20', dot: 'text-cyan-400' },
};

export interface SpellSelectableCardProps {
  spell: SpellCardData;
  isSelected: boolean;
  canSelect: boolean;
  onClick: () => void;
  onDetailClick?: (spell: SpellCardData) => void;
  color?: ColorKey;
  /** Override selection indicator (e.g. ★ for bonus cantrips) */
  indicator?: string;
  badgeLabel?: string;
  badgeColor?: string;
  /**
   * Custom subtitle. Default depends on locale: empty under `en-US` (the
   * English name is already the primary heading), `spell.nameEn` under
   * `zh-CN` (Chinese primary + English subtitle, matching legacy behavior).
   */
  subtitle?: string;
  showConcentration?: boolean;
  showRitual?: boolean;
}

/** Reusable spell card for selection UIs (creation & level-up). */
export function SpellSelectableCard({
  spell,
  isSelected,
  canSelect,
  onClick,
  onDetailClick,
  color = 'amber',
  indicator,
  badgeLabel,
  badgeColor,
  subtitle,
  showConcentration = true,
  showRitual = false,
}: SpellSelectableCardProps) {
  const c = COLOR_MAP[color] || COLOR_MAP.amber;
  const iconSrc = spell.iconPath
    ? getAssetUrl(spell.iconPath.replace(/^\//, ''))
    : getAssetUrl(`assets/spell-icons/${spell.id}.png`);

  const locale = useCurrentLocale();
  const { t } = useTranslation('common');
  const displayName = getLocalizedName(spell, locale, spell.name);
  // en-US: don't default the subtitle to the Chinese `name`; show no subtitle
  // unless caller provides one. zh-CN: keep the existing English subtitle.
  const dotIcon = indicator ?? (isSelected ? '●' : '○');
  const defaultSubtitle = locale === 'en-US' ? '' : (spell.nameEn ?? '');
  const subtitleText = subtitle ?? defaultSubtitle;

  return (
    <button
      onClick={onClick}
      disabled={!isSelected && !canSelect}
      className={`w-full p-2.5 rounded-lg border text-left transition-all ${
        isSelected
          ? `${c.border} ${c.bg}`
          : canSelect
            ? 'border-gray-600 hover:border-gray-500 bg-gray-800/50'
            : 'border-gray-700 bg-gray-800/30 opacity-50 cursor-not-allowed'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className={`${c.dot} text-sm`}>{dotIcon}</span>
        <img
          src={iconSrc}
          alt=""
          className="w-9 h-9 rounded flex-shrink-0 object-cover"
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
        <div className="flex-1 min-w-0">
          <div className="font-medium text-white text-sm truncate">
            {displayName}
            {badgeLabel && (
              <span className={`ml-1.5 px-1.5 py-0.5 text-[9px] rounded ${badgeColor || 'bg-green-800/60 text-green-300 border border-green-700/40'}`}>
                {badgeLabel}
              </span>
            )}
          </div>
          {subtitleText && (
            <div className="text-[11px] text-gray-500 truncate">{subtitleText}</div>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {showConcentration && spell.concentration && (
            <span className="text-purple-400 text-xs">👁️{t('spellCard.badges.concentration')}</span>
          )}
          {showRitual && spell.ritual && (
            <span className="text-teal-400 text-xs" title={t('spellCard.badges.ritual')}>🔮</span>
          )}
          {onDetailClick && (
            <span
              role="button"
              onClick={(e) => { e.stopPropagation(); onDetailClick(spell); }}
              className="w-6 h-6 flex items-center justify-center rounded-full
                bg-blue-600/30 hover:bg-blue-600/50 text-blue-300 hover:text-blue-200
                text-xs font-bold cursor-pointer transition-colors border border-blue-500/40"
              title={t('spellCard.tooltips.viewDetails')}
            >?</span>
          )}
        </div>
      </div>
    </button>
  );
}

// ─── Spell Detail Modal ────────────────────────────────────

export interface SpellDetailModalProps {
  spell: SpellCardData | null;
  onClose: () => void;
  /** @deprecated z-index is now managed by floatingZIndexStore */
  zOverlay?: string;
  /** @deprecated z-index is now managed by floatingZIndexStore */
  zContent?: string;
  actions?: React.ReactNode;
  /** Transform the normalized spell before rendering (e.g. apply character modifiers) */
  spellTransform?: (normalized: any) => any;
}

export function SpellDetailModal({ spell, onClose, zOverlay, zContent, actions, spellTransform }: SpellDetailModalProps) {
  const bringToFront = useFloatingZIndex(s => s.bringToFront);
  const [zIndex, setZIndex] = useState(() => bringToFront());
  const handleFocus = useCallback(() => setZIndex(bringToFront()), [bringToFront]);
  const locale = useCurrentLocale();
  const titleText = spell ? getLocalizedName(spell, locale, spell.name) : '';

  return (
    <Dialog.Root open={!!spell} onOpenChange={(open) => { if (!open) onClose(); else handleFocus(); }}>
      <Dialog.Portal container={typeof document !== 'undefined' ? document.body : undefined}>
        <Dialog.Overlay className="fixed inset-0 bg-black/70" style={{ zIndex: zIndex - 1 }} />
        <Dialog.Content
          aria-describedby={undefined}
          onPointerDown={handleFocus}
          style={{ zIndex }}
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2
            w-[92vw] max-w-[580px] max-h-[80dvh] outline-none"
        >
          <ScrollFrame className="max-h-[80dvh]">
            {spell && (() => {
              const normalized = normalizeSpellData(spell);
              const finalSpell = spellTransform ? spellTransform(normalized) : normalized;
              return (
                <>
                  <div className="flex items-center justify-between px-5 pt-3 pb-2 border-b border-amber-800/25 flex-shrink-0
                    bg-gradient-to-r from-transparent via-amber-900/8 to-transparent">
                    <Dialog.Title className="text-base font-medium text-amber-200/80 tracking-wide flex items-center gap-2.5">
                      {(spell as any).iconPath ? (
                        <img src={getAssetUrl((spell as any).iconPath)} alt=""
                          className="w-8 h-8 rounded object-cover flex-shrink-0" />
                      ) : (
                        <span className="text-lg">✦</span>
                      )}
                      {titleText}
                    </Dialog.Title>
                    <Dialog.Close className="relative z-40 w-9 h-9 flex items-center justify-center rounded-lg
                      text-amber-500/50 hover:text-amber-200 hover:bg-amber-900/40 transition-colors flex-shrink-0 cursor-pointer">
                      <svg viewBox="0 0 16 16" className="w-4.5 h-4.5" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4L12 12M12 4L4 12" /></svg>
                    </Dialog.Close>
                  </div>
                  <div className="flex-1 overflow-y-auto min-h-0 p-5 spellbook-page-texture spellbook-scroll relative"
                    style={{
                      background: 'radial-gradient(ellipse at 80% 15%, rgba(55,45,32,0.4) 0%, transparent 50%), radial-gradient(ellipse at 20% 85%, rgba(45,38,26,0.3) 0%, transparent 40%), linear-gradient(135deg, #2e2519, #342a20, #2b2319)',
                    }}>
                    <SpellCard spell={finalSpell} variant="full" theme="scroll" showTargeting />
                  </div>
                  {actions}
                </>
              );
            })()}
          </ScrollFrame>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
