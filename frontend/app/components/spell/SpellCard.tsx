/**
 * SpellCard Component
 * 法术卡片组件 - 用于显示单个法术的详细信息
 *
 * variant: "compact" (默认) | "full"
 * theme:   "default" | "scroll" | "spellbook"
 */

import { useState } from 'react'
import type { Spell } from '~/types/spell'
import { cn } from '~/utils/cn'
import { SpellCardFull } from './SpellCardFull'
import {
  schoolColors, schoolIcons,
  damageTypeStyles, getLevelDisplay,
  getSchoolName, getSaveTypeName, getAreaTypeName, getDamageTypeName,
} from './spell-constants'
import { getAssetUrl } from '~/utils/asset-url'
import { useTranslation } from 'react-i18next'
import { useCurrentLocale } from '~/i18n/LocaleProvider'
import { getLocalizedName } from '~/utils/i18n'

export interface SpellCardProps {
  spell: Spell
  className?: string
  onClick?: (spell: Spell) => void
  variant?: 'compact' | 'full'
  theme?: 'default' | 'scroll' | 'spellbook'
  showTargeting?: boolean
}

export function SpellCard({ spell, className, onClick, variant = 'compact', theme = 'default', showTargeting = false }: SpellCardProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const locale = useCurrentLocale()
  const { t } = useTranslation('common')
  const displayName = getLocalizedName(spell, locale, spell.name)
  // en-US: don't keep Chinese `name` as a secondary line beneath the English
  // primary. zh-CN: preserve the existing English subtitle.
  const secondaryName = locale === 'en-US' ? '' : (spell.nameEn ?? '')

  const handleClick = () => {
    if (onClick) {
      onClick(spell)
    } else if (variant === 'compact') {
      setIsExpanded(!isExpanded)
    }
  }

  // ── full 变体 → 委托给 SpellCardFull ──
  if (variant === 'full') {
    return <SpellCardFull spell={spell} theme={theme} showTargeting={showTargeting} className={className} />
  }

  // ── compact 变体（展开后也委托给 SpellCardFull） ──
  if (isExpanded) {
    return (
      <div
        className={cn(
          'border rounded-lg',
          theme === 'scroll' ? 'p-0 bg-transparent border-transparent' : 'p-6 bg-gray-900/80 border-gray-700/50 backdrop-blur-md',
          'cursor-pointer hover:shadow-lg transition-shadow',
          className,
        )}
        onClick={handleClick}
      >
        <SpellCardFull spell={spell} theme={theme} showTargeting={showTargeting} />

        {/* 收起按钮 */}
        <div className={cn('mt-4 pt-4 border-t', theme === 'scroll' ? 'border-amber-700/20' : 'border-white/10')}>
          <button
            className={cn('text-sm transition-colors', theme === 'scroll' ? 'text-amber-400/60 hover:text-amber-300' : 'text-gray-400 hover:text-white')}
            onClick={(e) => { e.stopPropagation(); setIsExpanded(false) }}
          >
            收起
          </button>
        </div>
      </div>
    )
  }

  // ── compact 折叠态 ──
  return (
    <div
      className={cn(
        'p-4 border rounded-lg hover:shadow-lg hover:shadow-purple-900/20 transition-all cursor-pointer backdrop-blur-sm',
        'bg-gray-900/60 border-gray-700/50',
        className,
      )}
      onClick={handleClick}
    >
      {/* 头部信息 */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-start gap-2.5 flex-1">
          <div className={cn(
            'w-9 h-9 rounded border flex-shrink-0 flex items-center justify-center overflow-hidden',
            schoolColors[spell.school] || 'bg-gray-800 border-gray-700',
          )}>
            {spell.iconPath ? (
              <img
                src={getAssetUrl(spell.iconPath)}
                alt={displayName}
                className="w-full h-full object-cover"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; e.currentTarget.parentElement!.querySelector('.spell-icon-fallback')?.classList.remove('hidden') }}
              />
            ) : null}
            <span className={cn('text-lg spell-icon-fallback', spell.iconPath && 'hidden')}>
              {schoolIcons[spell.school] || '✨'}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-semibold text-gray-100">{displayName}</h3>
            {secondaryName && (
              <p className="text-sm text-gray-400 font-serif italic">{secondaryName}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {spell.concentration && <span className="text-amber-500 text-sm">👁️{t('spellCard.badges.concentration')}</span>}
          {spell.ritual && <span className="text-purple-400 text-sm" title={t('spellCard.badges.ritual')}>📖</span>}
        </div>
      </div>

      {/* 基础信息标签 */}
      <div className="flex flex-wrap gap-2 mb-3">
        <span className="px-2 py-1 text-xs font-medium rounded-full bg-gray-800 text-gray-300 border border-gray-700">
          {getLevelDisplay(spell.level, locale)}
        </span>
        <span className={cn(
          'px-2 py-1 text-xs font-medium rounded-full border',
          schoolColors[spell.school] || 'bg-gray-800 text-gray-300 border-gray-700',
        )}>
          {getSchoolName(spell.school, locale)}
        </span>
        <span className="px-2 py-1 text-xs font-medium rounded-full bg-gray-800 text-gray-400 border border-gray-700">
          {spell.components.join(', ')}
        </span>
      </div>

      {/* 快速信息 */}
      <div className="flex items-center gap-4 text-xs text-gray-400">
        <div className="flex items-center gap-1"><span>⏱️</span><span>{spell.castingTime}</span></div>
        <div className="flex items-center gap-1"><span>📍</span><span>{spell.range}</span></div>
        <div className="flex items-center gap-1"><span>⏳</span><span>{spell.duration}</span></div>
      </div>

      {/* 战斗信息 */}
      {(spell.damage || spell.healing || spell.saveType || spell.areaOfEffect) && (
        <div className="flex flex-wrap items-center gap-2 mt-2 pt-2 border-t border-gray-700/30">
          {spell.damage && (
            <span className={cn(
              'px-2 py-0.5 text-xs font-medium rounded-full bg-red-900/30 border border-red-800/50',
              spell.damageType ? damageTypeStyles[spell.damageType]?.color : 'text-red-300',
            )}>
              {spell.damageType && damageTypeStyles[spell.damageType]?.icon}{' '}
              {spell.damage} {locale === 'en-US'
                ? getDamageTypeName(spell.damageType, locale)
                : (spell.damageTypeCn || '')}
            </span>
          )}
          {spell.healing && (
            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-emerald-900/30 text-emerald-300 border border-emerald-800/50">
              💚 {spell.healing}
            </span>
          )}
          {spell.saveType && (
            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-blue-900/30 text-blue-300 border border-blue-800/50">
              🛡️ {locale === 'en-US'
                ? getSaveTypeName(spell.saveType, locale)
                : (spell.saveTypeCn || getSaveTypeName(spell.saveType, locale))}
              {spell.saveEffect === 'half' && t('spellCard.saveEffect.halfSuffix')}
            </span>
          )}
          {spell.areaOfEffect && (
            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-amber-900/30 text-amber-300 border border-amber-800/50">
              📐 {spell.areaOfEffect.size}尺{getAreaTypeName(spell.areaOfEffect.type, locale)}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
