/**
 * SpellCardFull - 法术完整详情渲染子组件
 * 合并 renderSpellDetail + SpellDetailContent + SpellCard full 三套渲染逻辑
 *
 * theme:
 *   - "default"   : 深灰暗色系（规则面板、快捷法术详情等）
 *   - "scroll"    : 琥珀卷轴色（角色卡法术弹框等）
 *   - "spellbook" : 法术书右页风格（SpellsDialog 右页、快捷栏详情）
 */

import type { Spell } from '~/types/spell'
import { useState, useCallback, useRef } from 'react'
import { cn } from '~/utils/cn'
import { LatexText } from '~/components/ui/LatexText'
import { SpellAttributeTooltip, analyzeSpellTargeting } from '~/components/ui/Rules_SpellDetail'
import { getAssetUrl } from '~/utils/asset-url'
import { SpellDivider } from '~/components/character/CharacterDisplay/sections/Spells/SpellbookSvg'
import { getApiEndpoint } from '~/config/api'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { useCurrentLocale } from '~/i18n/LocaleProvider'
import { getLocalizedName, getLocalizedDescription } from '~/utils/i18n'
import {
  schoolColors, scrollSchoolColors, schoolIcons,
  damageTypeStyles, getLevelDisplay,
  translateBuffTerm, translateDamageBonus,
  formatEffectPrimitive, formatPhaseConditionText,
  getSchoolName, getSaveTypeName, getAreaTypeName, getClassName,
  getCreatureTypeName, getDamageTypeName, getTriggerLabel,
} from './spell-constants'
import type { SupportedLocale } from '~/i18n/config'

const isEn = (locale?: SupportedLocale) => locale === 'en-US'

/** Locale-aware cantrip-scaling per-level part: "Level N: dmg" / "N级: dmg". */
function formatCantripLevelPart(lvl: string | number, dmg: string, locale?: SupportedLocale) {
  return isEn(locale) ? `Level ${lvl}: ${dmg}` : `${lvl}级: ${dmg}`
}

/** Format rounds duration. D&D 5E: 1 round = 6 seconds. */
function formatRoundsDuration(rounds: number, locale?: SupportedLocale): string {
  const en = isEn(locale)
  const totalSeconds = rounds * 6
  if (totalSeconds >= 3600 && totalSeconds % 3600 === 0) {
    const hours = totalSeconds / 3600
    return en ? `${hours} hr / ${rounds} rounds` : `${hours}小时 / ${rounds}轮`
  }
  if (totalSeconds >= 60 && totalSeconds % 60 === 0) {
    const minutes = totalSeconds / 60
    return en ? `${minutes} min / ${rounds} rounds` : `${minutes}分钟 / ${rounds}轮`
  }
  if (totalSeconds >= 60) {
    const minutes = Math.floor(totalSeconds / 60)
    const secs = totalSeconds % 60
    return en ? `${minutes}m${secs}s / ${rounds} rounds` : `${minutes}分${secs}秒 / ${rounds}轮`
  }
  return en ? `${rounds} rounds` : `${rounds}轮`
}

/** Locale-aware cast-option key → display label. Falls back to provided opt.label for unknown keys. */
function getCastOptionLabel(opt: { key?: string; label?: string }, t: TFunction): { label: string; icon: string } {
  const key = (opt.key || '').toLowerCase()
  if (key === 'enlarge') return { label: t('spellCard.castOption.enlarge'), icon: '⬆ ' }
  if (key === 'reduce') return { label: t('spellCard.castOption.reduce'), icon: '⬇ ' }
  return { label: opt.label || opt.key || '', icon: '◆ ' }
}

/** Localized buff-effect labels for the mechanical-effects block. Style is locale-independent. */
function getBuffLabel(key: string, locale?: SupportedLocale): { icon: string; label: string; color: string } | null {
  const en = isEn(locale)
  const m: Record<string, { icon: string; cn: string; en: string; color: string }> = {
    acBonus: { icon: '🛡️', cn: 'AC', en: 'AC', color: 'text-blue-300' },
    attackBonus: { icon: '⚔️', cn: '攻击', en: 'Attack', color: 'text-red-300' },
    damageBonus: { icon: '💥', cn: '额外伤害', en: 'Bonus Damage', color: 'text-orange-300' },
    tempHp: { icon: '💛', cn: '临时HP', en: 'Temp HP', color: 'text-yellow-300' },
    speedBonus: { icon: '👟', cn: '速度', en: 'Speed', color: 'text-cyan-300' },
    resistances: { icon: '🔰', cn: '伤害抗性', en: 'Resistance', color: 'text-sky-300' },
    immunities: { icon: '✨', cn: '免疫', en: 'Immunity', color: 'text-amber-300' },
    vulnerabilities: { icon: '⚠️', cn: '易伤', en: 'Vulnerability', color: 'text-red-400' },
    advantageOn: { icon: '⬆️', cn: '优势', en: 'Advantage', color: 'text-green-300' },
    disadvantageOn: { icon: '⬇️', cn: '劣势', en: 'Disadvantage', color: 'text-rose-300' },
    grantDisadvantage: { icon: '🎯', cn: '敌方劣势', en: 'Foe Disadvantage', color: 'text-violet-300' },
  }
  const entry = m[key]
  if (!entry) return null
  return { icon: entry.icon, label: en ? entry.en : entry.cn, color: entry.color }
}

interface SpellCardFullProps {
  spell: Spell
  theme?: 'default' | 'scroll' | 'spellbook'
  showTargeting?: boolean
  className?: string
}

// ── Inline TTS button for spell description ──
function SpellTtsButton({ text, isScroll }: { text: string; isScroll: boolean }) {
  const { t } = useTranslation('common');
  const [state, setState] = useState<'idle' | 'loading' | 'playing'>('idle');
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const handleClick = useCallback(async () => {
    if (state === 'playing') {
      audioRef.current?.pause();
      audioRef.current = null;
      setState('idle');
      return;
    }
    if (state === 'loading') return;

    const cleanText = text
      .replace(/^[\s]*[-*+]\s+/gm, '')
      .replace(/^\s*\d+\.\s+/gm, '')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/\*{1,3}(.*?)\*{1,3}/g, '$1')
      .replace(/`([^`]*)`/g, '$1')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/^>\s*/gm, '')
      .replace(/[#`~>|[\]()!]/g, '')
      .replace(/\n+/g, '。')
      .trim();
    if (!cleanText) return;

    setState('loading');
    try {
      const res = await fetch(getApiEndpoint('/api/voice/synthesize'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: cleanText }),
      });
      if (!res.ok) throw new Error('TTS failed');
      const data = await res.json();
      const src = data.audio_url || (data.audio_base64 ? `data:audio/${data.format || 'mp3'};base64,${data.audio_base64}` : null);
      if (!src) throw new Error('No audio');
      const audio = new Audio(src);
      audio.onended = () => { setState('idle'); audioRef.current = null; };
      audio.onerror = () => { setState('idle'); audioRef.current = null; };
      audioRef.current = audio;
      setState('playing');
      audio.play().catch(() => { setState('idle'); audioRef.current = null; });
    } catch {
      setState('idle');
    }
  }, [text, state]);

  const base = isScroll ? 'text-amber-500/40 hover:text-amber-300' : 'text-gray-500 hover:text-amber-300';
  const cls = state === 'playing' ? 'text-amber-400' : state === 'loading' ? 'text-gray-500 cursor-wait' : base;

  return (
    <button onClick={handleClick} disabled={state === 'loading'} className={`ml-1.5 transition-colors cursor-pointer ${cls}`} title={state === 'playing' ? t('spellCard.tts.stopReading') : t('spellCard.tts.readDescription')}>
      {state === 'loading' ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" strokeDasharray="31.4" strokeDashoffset="10"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="1s" repeatCount="indefinite"/></circle></svg>
      ) : state === 'playing' ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>
      )}
    </button>
  );
}

export function SpellCardFull({ spell, theme = 'default', showTargeting = false, className }: SpellCardFullProps) {
  const isScroll = theme === 'scroll'
  const isSpellbook = theme === 'spellbook'
  const isWarm = isScroll || isSpellbook // 琥珀色调
  const locale = useCurrentLocale()
  const { t } = useTranslation('common')
  const displayName = getLocalizedName(spell, locale, spell.name)
  // en-US: don't deliberately keep Chinese `name` as the secondary label.
  const secondaryName = locale === 'en-US' ? '' : (spell.nameEn ?? '')
  const displayDescription = getLocalizedDescription(spell, locale, spell.description || '')

  // ── Spellbook 主题：紧凑法术书右页风格 ──
  if (isSpellbook) {
    return <SpellbookView spell={spell} showTargeting={showTargeting} className={className} locale={locale} />
  }

  // ── Default / Scroll 主题：完整详情卡 ──
  const sc = isScroll ? scrollSchoolColors : schoolColors
  const t1 = isScroll ? 'text-amber-100/95' : 'text-gray-100'
  const t2 = isScroll ? 'text-amber-600/50' : 'text-gray-400'
  const t3 = isScroll ? 'text-amber-100/85' : 'text-gray-200'
  const t4 = isScroll ? 'text-amber-600/60' : 'text-gray-500'
  const t5 = isScroll ? 'text-amber-100/80' : 'text-gray-300'
  const borderSub = isScroll ? 'border-amber-800/12' : 'border-gray-700/30'
  const bgCard = isScroll ? 'bg-amber-900/8 border-amber-800/10' : 'bg-black/20 border-white/5'
  const bgCombat = isScroll ? 'bg-amber-900/8 border-amber-800/10' : 'bg-gray-800/50 border-gray-700/50'
  const targeting = showTargeting ? analyzeSpellTargeting(spell) : null

  return (
    <div className={cn(
      'border rounded-lg',
      isScroll ? 'p-0 bg-transparent border-transparent' : 'p-6 bg-gray-900/80 border-gray-700/50 backdrop-blur-md',
      className,
    )}>
      {/* 头部 */}
      <div className={cn('flex items-start justify-between', isScroll ? 'mb-2' : 'mb-3')}>
        <div className="flex items-start gap-2">
          <SpellIcon spell={spell} sc={sc} isScroll={isScroll} size={isScroll ? 'md' : 'lg'} altText={displayName} />
          <div>
            <div className="flex items-center gap-2">
              <h3 className={cn(isScroll ? 'text-base' : 'text-xl', 'font-bold font-fantasy tracking-wide', t1)}>{displayName}</h3>
              <SpellAttributeTooltip attributeKey="level">
                <span className={cn(
                  'px-1.5 py-0.5 text-[10px] font-medium rounded-full border cursor-help shrink-0',
                  isScroll ? 'bg-amber-800/15 text-amber-300/65 border-amber-700/15' : 'bg-gray-800 text-gray-300 border-gray-700',
                )}>
                  {getLevelDisplay(spell.level, locale)}
                </span>
              </SpellAttributeTooltip>
              <SpellAttributeTooltip attributeKey="school">
                <span className={cn(
                  'px-1.5 py-0.5 text-[10px] font-medium rounded-full border cursor-help shrink-0',
                  sc[spell.school] || (isScroll ? 'bg-amber-800/15 text-amber-300/65 border-amber-700/15' : 'bg-gray-800 text-gray-300 border-gray-700'),
                )}>
                  {getSchoolName(spell.school, locale)}
                </span>
              </SpellAttributeTooltip>
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              {secondaryName && (
                <p className={cn('text-xs italic font-serif', t2)}>{secondaryName}</p>
              )}
              {spell.concentration && (
                <SpellAttributeTooltip attributeKey="concentration">
                  <span className={cn(
                    'px-1.5 py-0 text-[10px] rounded border cursor-help',
                    isScroll ? 'bg-amber-900/20 text-amber-400/55 border-amber-700/15' : 'bg-amber-900/30 text-amber-400 border-amber-900/50',
                  )}>
                    {t('spellCard.badges.concentration')}
                  </span>
                </SpellAttributeTooltip>
              )}
              {spell.ritual && (
                <SpellAttributeTooltip attributeKey="ritual">
                  <span className={cn(
                    'px-1.5 py-0 text-[10px] rounded border cursor-help',
                    isScroll ? 'bg-purple-900/15 text-purple-300/55 border-purple-700/15' : 'bg-purple-900/30 text-purple-400 border-purple-900/50',
                  )}>
                    {t('spellCard.badges.ritual')}
                  </span>
                </SpellAttributeTooltip>
              )}
            </div>
          </div>
        </div>
      </div>

      {isScroll && <SpellDivider />}

      {/* 施法信息网格 */}
      <div className={cn('grid grid-cols-2 gap-2 mb-2 p-2 rounded-lg border', bgCard)}>
        <AttrCell label={t('spellCard.labels.castingTime')} attrKey="castingTime" t4={t4} t3={t3}>
          {spell.castingTime}
        </AttrCell>
        <AttrCell label={t('spellCard.labels.range')} attrKey="range" t4={t4} t3={t3}>
          {targeting ? targeting.rangeLabel : spell.range}
        </AttrCell>
        <AttrCell label={t('spellCard.labels.duration')} attrKey="duration" t4={t4} t3={t3} extra={
          <SpellAttributeTooltip attributeKey="timeConversion">
            <span className={cn('text-[9px] cursor-help', t4)}>⏱</span>
          </SpellAttributeTooltip>
        }>
          {spell.duration}
        </AttrCell>
        {showTargeting && targeting ? (
          <AttrCell label={t('spellCard.labels.target')} attrKey="areaOfEffect" t4={t4} t3={t3}>
            {targeting.targetIcon} {targeting.targetLabel}
            {targeting.areaDetail && (
              <span className={isScroll ? 'text-amber-300/50' : 'text-amber-400/70'}>{' '}({targeting.areaDetail})</span>
            )}
          </AttrCell>
        ) : (
          <AttrCell label={t('spellCard.labels.components')} attrKey="components" t4={t4} t3={t3}>
            {spell.components.join(', ')}{spell.materials && ' *'}
          </AttrCell>
        )}
        {/* showTargeting 时成分合并到网格里 */}
        {showTargeting && (
          <AttrCell label={t('spellCard.labels.components')} attrKey="components" t4={t4} t3={t3}>
            {spell.components.join(', ')}{spell.materials && ' *'}
          </AttrCell>
        )}
        {/* 材料说明合并到网格内 */}
        {spell.materials && (
          <div className="col-span-2">
            <SpellAttributeTooltip attributeKey="materials">
              <p className={cn('text-[10px] flex items-center gap-1 cursor-help', isScroll ? 'text-amber-500/55' : 'text-amber-500')}>
                ※ <span className={cn('text-[10px]', isScroll ? 'text-amber-300/60' : 'text-amber-200/70')}>{spell.materials}</span>
              </p>
            </SpellAttributeTooltip>
          </div>
        )}
      </div>

      {/* 战斗信息 — effects 优先 */}
      {spell.effects?.length ? (
        <EffectsSection spell={spell} variant={isScroll ? 'scroll' : 'default'} locale={locale} />
      ) : (
        <CombatSection spell={spell} isScroll={isScroll} isWarm={isWarm} t4={t4} t5={t5} borderSub={borderSub} bgCombat={bgCombat} locale={locale} />
      )}

      {/* 描述 */}
      {isScroll && <SpellDivider label={t('spellCard.labels.description')} />}
      <div className="mb-2">
        {!isScroll && (
          <h4 className="text-sm font-medium text-gray-400 mb-2 flex items-center">
            {t('spellCard.labels.description')}
            {displayDescription && <SpellTtsButton text={displayDescription} isScroll={false} />}
          </h4>
        )}
        {isScroll && displayDescription && (
          <div className="flex justify-end -mt-1 mb-0.5">
            <SpellTtsButton text={displayDescription} isScroll={true} />
          </div>
        )}
        <div className={cn('text-xs leading-relaxed spell-description', t5)}>
          <LatexText>{displayDescription}</LatexText>
        </div>
      </div>

      {/* 魔能祈唤加成说明 */}
      <InvocationNotes spell={spell} isScroll={isScroll} />

      {/* 可用职业 */}
      {spell.classes && spell.classes.length > 0 && (
        <>
          {isScroll && <SpellDivider />}
          <div className={cn(isScroll ? 'pt-2' : 'pt-3', 'border-t', isScroll ? 'border-amber-700/20' : 'border-white/10')}>
            <h4 className={cn('text-xs font-medium mb-1.5', t4)}>{t('spellCard.labels.availableClasses')}</h4>
            <div className="flex flex-wrap gap-1">
              {spell.classes.map(cls => (
                <span key={cls} className={cn(
                  'px-1.5 py-0.5 text-[10px] rounded border',
                  isScroll ? 'bg-amber-900/8 text-amber-300/65 border-amber-700/10' : 'bg-blue-900/20 text-blue-300 border-blue-900/30',
                )}>
                  {getClassName(cls, locale)}
                </span>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ── Spellbook 主题：复刻 SpellDetailContent 的法术书右页风格 ──

function SpellbookView({ spell, showTargeting, className, locale: localeProp }: { spell: Spell; showTargeting: boolean; className?: string; locale?: SupportedLocale }) {
  const targeting = analyzeSpellTargeting(spell)
  const hookLocale = useCurrentLocale()
  const locale = localeProp ?? hookLocale
  const { t } = useTranslation('common')
  const displayName = getLocalizedName(spell, locale, spell.name)
  const secondaryName = locale === 'en-US' ? '' : (spell.nameEn ?? '')
  const displayDescription = getLocalizedDescription(spell, locale, spell.description || '')

  return (
    <div className={className}>
      <h3 className="text-xl font-bold text-amber-100/85 tracking-wide">{displayName}</h3>
      {secondaryName && (
        <p className="text-xs text-amber-600/35 italic font-serif mt-0.5">{secondaryName}</p>
      )}

      {/* Tags */}
      <div className="flex flex-wrap gap-1.5 mt-3">
        <SpellAttributeTooltip attributeKey="level">
          <span className="px-2 py-0.5 text-[10px] rounded bg-amber-800/15 border border-amber-700/15 text-amber-300/65 cursor-help">
            {getLevelDisplay(spell.level, locale)} <span className="text-amber-500/30 text-[8px]">ⓘ</span>
          </span>
        </SpellAttributeTooltip>
        <SpellAttributeTooltip attributeKey="school">
          <span className="px-2 py-0.5 text-[10px] rounded bg-amber-800/15 border border-amber-700/15 text-amber-300/65 cursor-help">
            {getSchoolName(spell.school, locale)} <span className="text-amber-500/30 text-[8px]">ⓘ</span>
          </span>
        </SpellAttributeTooltip>
        {spell.concentration && (
          <SpellAttributeTooltip attributeKey="concentration">
            <span className="px-2 py-0.5 text-[10px] rounded bg-amber-900/20 border border-amber-700/15 text-amber-400/55 cursor-help">
              {t('spellCard.badges.concentration')} <span className="text-amber-500/30 text-[8px]">ⓘ</span>
            </span>
          </SpellAttributeTooltip>
        )}
        {spell.ritual && (
          <SpellAttributeTooltip attributeKey="ritual">
            <span className="px-2 py-0.5 text-[10px] rounded bg-purple-900/15 border border-purple-700/15 text-purple-300/55 cursor-help">
              {t('spellCard.badges.ritual')} <span className="text-purple-400/30 text-[8px]">ⓘ</span>
            </span>
          </SpellAttributeTooltip>
        )}
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 mt-4 text-xs">
        <SpellAttributeTooltip attributeKey="castingTime">
          <div className="cursor-help">
            <span className="text-amber-600/40 flex items-center gap-1">{t('spellCard.labels.castingTime')} <span className="text-amber-500/25 text-[8px]">ⓘ</span></span>
            <span className="text-amber-100/65 block mt-0.5">{spell.castingTime}</span>
          </div>
        </SpellAttributeTooltip>
        <SpellAttributeTooltip attributeKey="range">
          <div className="cursor-help">
            <span className="text-amber-600/40 flex items-center gap-1">{t('spellCard.labels.range')} <span className="text-amber-500/25 text-[8px]">ⓘ</span></span>
            <span className="text-amber-100/65 block mt-0.5">{targeting.rangeLabel}</span>
          </div>
        </SpellAttributeTooltip>
        <SpellAttributeTooltip attributeKey="duration">
          <div className="cursor-help">
            <span className="text-amber-600/40 flex items-center gap-1">{t('spellCard.labels.duration')} <span className="text-amber-500/25 text-[8px]">ⓘ</span></span>
            <span className="text-amber-100/65 block mt-0.5">{spell.duration}</span>
          </div>
        </SpellAttributeTooltip>
        <SpellAttributeTooltip attributeKey="areaOfEffect">
          <div className="cursor-help">
            <span className="text-amber-600/40 flex items-center gap-1">{t('spellCard.labels.target')} <span className="text-amber-500/25 text-[8px]">ⓘ</span></span>
            <span className="text-amber-100/65 block mt-0.5">
              {targeting.targetIcon} {targeting.targetLabel}{targeting.areaDetail ? ` (${targeting.areaDetail})` : ''}
            </span>
          </div>
        </SpellAttributeTooltip>
        <SpellAttributeTooltip attributeKey="components">
          <div className="cursor-help">
            <span className="text-amber-600/40 flex items-center gap-1">{t('spellCard.labels.components')} <span className="text-amber-500/25 text-[8px]">ⓘ</span></span>
            <span className="text-amber-100/65 block mt-0.5">
              {spell.components.join(', ')}
            </span>
            {spell.materials && (
              <span className="text-amber-300/40 block mt-1 text-[10px] leading-snug">
                ※ {spell.materials}
              </span>
            )}
          </div>
        </SpellAttributeTooltip>
      </div>

      {/* Divider */}
      <div className="flex items-center gap-3 my-4">
        <div className="flex-1 h-px bg-gradient-to-r from-transparent via-amber-700/18 to-transparent" />
        <svg viewBox="0 0 10 10" className="w-1.5 h-1.5 text-amber-600/20"><path d="M5 0L10 5L5 10L0 5Z" fill="currentColor" /></svg>
        <div className="flex-1 h-px bg-gradient-to-r from-transparent via-amber-700/18 to-transparent" />
      </div>

      {/* Description */}
      <div className="text-[13px] text-amber-100/60 leading-relaxed">
        <LatexText>{displayDescription}</LatexText>
      </div>

      {/* 魔能祈唤加成说明 */}
      <InvocationNotes spell={spell} isSpellbook />

      {/* Combat tags — effects 优先 */}
      {spell.effects?.length ? (
        <EffectsSection spell={spell} variant="spellbook" locale={locale} />
      ) : (spell.damage || spell.healing || spell.saveType || spell.conditions || spell.affectedCreatureTypes || spell.buffEffects) && (
        <div className="mt-4 pt-3 border-t border-amber-800/12 flex flex-wrap gap-1.5">
          {spell.damage && (
            <SpellAttributeTooltip attributeKey="damage">
              <span className={cn(
                'px-2 py-0.5 text-[10px] rounded bg-red-900/12 border border-red-800/15 cursor-help',
                spell.damageType ? damageTypeStyles[spell.damageType]?.color?.replace('text-', 'text-') || 'text-red-300/55' : 'text-red-300/55',
              )}>
                {spell.damageType && damageTypeStyles[spell.damageType]?.icon}{' '}
                {spell.damage} {locale === 'en-US'
                  ? getDamageTypeName(spell.damageType, locale)
                  : (spell.damageTypeCn || getDamageTypeName(spell.damageType))}
                {' '}<span className="text-red-400/25 text-[8px]">ⓘ</span>
              </span>
            </SpellAttributeTooltip>
          )}
          {spell.healing && (
            <span className="px-2 py-0.5 text-[10px] rounded bg-emerald-900/12 border border-emerald-800/15 text-emerald-300/55">
              {t('spellCard.labels.healing')} {spell.healing}
            </span>
          )}
          {spell.saveType && (
            <SpellAttributeTooltip attributeKey="saveType">
              <span className="px-2 py-0.5 text-[10px] rounded bg-blue-900/12 border border-blue-800/15 text-blue-300/55 cursor-help">
                {locale === 'en-US'
                  ? `${getSaveTypeName(spell.saveType, locale)} Save`
                  : `${spell.saveTypeCn || getSaveTypeName(spell.saveType)}豁免`}
                {spell.saveEffect && (locale === 'en-US'
                  ? ` (${spell.saveEffect === 'half' ? 'half' : spell.saveEffect === 'none' ? 'negated' : 'partial'})`
                  : ` (${spell.saveEffect === 'half' ? '半伤' : spell.saveEffect === 'none' ? '无效' : '部分'})`)}
                {' '}<span className="text-blue-400/25 text-[8px]">ⓘ</span>
              </span>
            </SpellAttributeTooltip>
          )}
          {spell.conditions && spell.conditions.length > 0 && spell.conditions.map(cond => (
            <span key={cond} className="px-2 py-0.5 text-[10px] rounded bg-purple-900/12 border border-purple-800/15 text-purple-300/55">
              {translateBuffTerm(cond, locale)}
            </span>
          ))}
          {spell.affectedCreatureTypes && spell.affectedCreatureTypes.length > 0 && spell.affectedCreatureTypes.map(type => (
            <span key={type} className="px-2 py-0.5 text-[10px] rounded bg-teal-900/12 border border-teal-800/15 text-teal-300/55">
              {getCreatureTypeName(type, locale)}
            </span>
          ))}
          {spell.buffEffects && Object.entries(spell.buffEffects).filter(([, v]) => v != null && (Array.isArray(v) ? v.length > 0 : true)).map(([key, val]) => {
            const meta = getBuffLabel(key, locale)
            if (!meta) return null
            const text = typeof val === 'number' ? `${val > 0 ? '+' : ''}${val}` : Array.isArray(val) ? val.length.toString() : (key === 'damageBonus' ? translateDamageBonus(String(val), locale) : String(val))
            return (
              <span key={key} className="px-2 py-0.5 text-[10px] rounded bg-indigo-900/12 border border-indigo-800/15 text-indigo-300/55">
                {meta.icon} {meta.label}{typeof val === 'number' ? text : ` ×${text}`}
              </span>
            )
          })}
        </div>
      )}
      {/* Higher levels / cantrip scaling (仅无 effects 时显示，有 effects 时由 EffectsSection 渲染) */}
      {!spell.effects?.length && spell.atHigherLevels && (
        <div className="mt-3 text-[11px]">
          <span className="text-amber-500/30">{t('spellCard.sections.atHigherLevels')}: </span>
          <span className="text-amber-100/45">{spell.atHigherLevels}</span>
        </div>
      )}

      {/* Cantrip scaling */}
      {!spell.effects?.length && (spell.cantripScaling || spell.damageAtCharacterLevel) && (
        <div className="mt-2 text-[11px]">
          <span className="text-amber-500/30">{t('spellCard.sections.cantripScaling')}: </span>
          <span className="text-amber-100/45">
            {spell.cantripScaling || Object.entries(spell.damageAtCharacterLevel || {}).map(([lvl, dmg]) => formatCantripLevelPart(lvl, String(dmg), locale)).join(', ')}
          </span>
        </div>
      )}
    </div>
  )
}

// ── 共用子组件 ──

function SpellIcon({ spell, sc, isScroll, size = 'lg', altText }: {
  spell: Spell; sc: Record<string, string>; isScroll: boolean; size?: 'md' | 'lg'; altText?: string
}) {
  const sizeClass = size === 'lg' ? 'w-12 h-12 rounded-lg' : 'w-9 h-9 rounded'
  const iconSize = size === 'lg' ? 'text-2xl' : 'text-lg'

  return (
    <div className={cn(
      sizeClass, 'border flex-shrink-0 flex items-center justify-center overflow-hidden',
      sc[spell.school] || (isScroll ? 'bg-amber-900/20 border-amber-700/30' : 'bg-gray-800 border-gray-700'),
    )}>
      {spell.iconPath ? (
        <img
          src={getAssetUrl(spell.iconPath)}
          alt={altText ?? spell.name}
          className="w-full h-full object-cover"
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; e.currentTarget.parentElement!.querySelector('.spell-icon-fallback')?.classList.remove('hidden') }}
        />
      ) : null}
      <span className={cn(iconSize, 'spell-icon-fallback', spell.iconPath && 'hidden')}>
        {schoolIcons[spell.school] || '✨'}
      </span>
    </div>
  )
}

function AttrCell({ label, attrKey, t4, t3, extra, children }: {
  label: string; attrKey: string; t4: string; t3: string; extra?: React.ReactNode; children: React.ReactNode
}) {
  return (
    <div>
      <SpellAttributeTooltip attributeKey={attrKey as any}>
        <p className={cn('text-[10px] mb-0.5 flex items-center gap-1', t4)}>
          {label} <span className="text-amber-500/60 text-[9px]">ⓘ</span>
        </p>
      </SpellAttributeTooltip>
      <div className="flex items-center gap-1">
        <p className={cn('text-sm font-medium', t3)}>{children}</p>
        {extra}
      </div>
    </div>
  )
}

function CombatSection({ spell, isScroll, isWarm: _isWarm, t4, t5, borderSub, bgCombat, locale }: {
  spell: Spell; isScroll: boolean; isWarm: boolean; t4: string; t5: string; borderSub: string; bgCombat: string; locale?: SupportedLocale
}) {
  const { t } = useTranslation('common')
  const en = isEn(locale)
  const b = spell.buffEffects
  if (!spell.damage && !spell.healing && !spell.saveType && !spell.areaOfEffect && !spell.conditions && !spell.affectedCreatureTypes && !b) return null

  const saveSuccessShort = (eff?: string) => {
    if (!eff) return ''
    if (en) return eff === 'half' ? ' (half)' : eff === 'none' ? ' (negated)' : ' (partial)'
    return eff === 'half' ? ' (半伤)' : eff === 'none' ? ' (无效)' : ' (部分)'
  }
  const areaSizeText = (aoe: { size?: number; sizeIsMax?: boolean; type?: string }) => {
    const upTo = aoe.sizeIsMax ? t('spellCard.area.upTo') : ''
    return `${upTo}${aoe.size}${t('spellCard.area.feet')}`
  }
  const damageTypeBlurb = en
    ? (spell.damageType ? `${getDamageTypeName(spell.damageType, locale)} damage` : '')
    : `${spell.damageTypeCn || getDamageTypeName(spell.damageType)}伤害`

  // Scroll 主题：紧凑标签流式布局
  if (isScroll) {
    return (
      <>
        <SpellDivider label={t('spellCard.sections.combatEffects')} />
        <div className="mb-2 flex flex-wrap gap-1">
          {spell.damage && (
            <SpellAttributeTooltip attributeKey="damage">
              <span className={cn(
                'px-1.5 py-0.5 text-[10px] rounded bg-red-900/15 border border-red-800/15 cursor-help',
                spell.damageType ? damageTypeStyles[spell.damageType]?.color || 'text-red-300/65' : 'text-red-300/65',
              )}>
                {spell.damageType && damageTypeStyles[spell.damageType]?.icon}{' '}
                {spell.damage} {en
                  ? getDamageTypeName(spell.damageType, locale)
                  : (spell.damageTypeCn || getDamageTypeName(spell.damageType))}
              </span>
            </SpellAttributeTooltip>
          )}
          {spell.healing && (
            <span className="px-1.5 py-0.5 text-[10px] rounded bg-emerald-900/15 border border-emerald-800/15 text-emerald-300/65">
              💚 {t('spellCard.labels.healing')} {spell.healing}
            </span>
          )}
          {spell.saveType && (
            <SpellAttributeTooltip attributeKey="saveType">
              <span className="px-1.5 py-0.5 text-[10px] rounded bg-blue-900/15 border border-blue-800/15 text-blue-300/65 cursor-help">
                🛡️ {en
                  ? `${getSaveTypeName(spell.saveType, locale)} Save`
                  : `${spell.saveTypeCn || getSaveTypeName(spell.saveType)}豁免`}
                {saveSuccessShort(spell.saveEffect)}
              </span>
            </SpellAttributeTooltip>
          )}
          {spell.areaOfEffect && (
            <SpellAttributeTooltip attributeKey="areaOfEffect">
              <span className="px-1.5 py-0.5 text-[10px] rounded bg-amber-900/15 border border-amber-800/15 text-amber-300/65 cursor-help">
                📐 {areaSizeText(spell.areaOfEffect)} {getAreaTypeName(spell.areaOfEffect.type, locale)}
              </span>
            </SpellAttributeTooltip>
          )}
          {spell.conditions?.map(cond => (
            <span key={cond} className="px-1.5 py-0.5 text-[10px] rounded bg-purple-900/15 border border-purple-800/15 text-purple-300/65">{translateBuffTerm(cond, locale)}</span>
          ))}
          {spell.affectedCreatureTypes?.map(type => (
            <span key={type} className="px-1.5 py-0.5 text-[10px] rounded bg-teal-900/15 border border-teal-800/15 text-teal-300/65">
              {getCreatureTypeName(type, locale)}
            </span>
          ))}
          {b && Object.entries(b).filter(([, v]) => v != null && (Array.isArray(v) ? v.length > 0 : true)).map(([key, val]) => {
            const meta = getBuffLabel(key, locale)
            if (!meta) return null
            const sep = en ? ', ' : '、'
            const display = typeof val === 'number'
              ? `${meta.label} ${val > 0 ? '+' : ''}${val}`
              : Array.isArray(val) ? (val as string[]).map(v => translateBuffTerm(v, locale)).join(sep) : (key === 'damageBonus' ? translateDamageBonus(String(val), locale) : String(val))
            return (
              <span key={key} className={cn('px-1.5 py-0.5 text-[10px] rounded bg-indigo-900/15 border border-indigo-800/15', meta.color + '/65')}>
                {meta.icon} {typeof val === 'number' ? display : `${meta.label}: ${display}`}
              </span>
            )
          })}
        </div>
        {(spell.atHigherLevels || spell.atHigherLevelsEn) && (
          <div className="mb-2 text-[11px]">
            <span className={t4}>{t('spellCard.sections.atHigherLevelsShort')}: </span>
            <span className={t5}>{spell.atHigherLevels || spell.atHigherLevelsEn}</span>
          </div>
        )}
        {(spell.cantripScaling || spell.damageAtCharacterLevel) && (
          <div className="mb-2 text-[11px]">
            <span className={t4}>{t('spellCard.sections.cantripScaling')}: </span>
            <span className={t5}>
              {spell.cantripScaling || Object.entries(spell.damageAtCharacterLevel || {}).map(([lvl, dmg]) => formatCantripLevelPart(lvl, String(dmg), locale)).join(', ')}
            </span>
          </div>
        )}
      </>
    )
  }

  // Default 主题：保持 grid 卡片布局
  return (
    <>
      <div className={cn('mb-3 p-3 rounded-lg border', bgCombat)}>
        <h4 className="text-sm font-medium text-gray-400 mb-3">{t('spellCard.sections.combatEffects')}</h4>
        <div className="grid grid-cols-2 gap-2">
          {spell.damage && (
            <div className="p-2 rounded border bg-red-900/20 border-red-800/30">
              <SpellAttributeTooltip attributeKey="damage">
                <p className={cn('text-[10px] mb-0.5 flex items-center gap-1 cursor-help', t4)}>
                  {t('spellCard.labels.damage')} <span className="text-amber-500/60 text-[9px]">ⓘ</span>
                </p>
              </SpellAttributeTooltip>
              <p className={cn('text-sm font-bold', spell.damageType ? damageTypeStyles[spell.damageType]?.color : 'text-red-300')}>
                {spell.damageType && damageTypeStyles[spell.damageType]?.icon}{' '}{spell.damage}
              </p>
              {(spell.damageTypeCn || spell.damageType) && damageTypeBlurb && (
                <p className={cn('text-[10px] mt-0.5', t4)}>{damageTypeBlurb}</p>
              )}
            </div>
          )}
          {spell.healing && (
            <div className="p-2 rounded border bg-emerald-900/20 border-emerald-800/30">
              <p className={cn('text-[10px] mb-0.5', t4)}>{t('spellCard.labels.healing')}</p>
              <p className="text-sm font-bold text-emerald-300">💚 {spell.healing}</p>
            </div>
          )}
          {spell.saveType && (
            <div className="p-2 rounded border bg-blue-900/20 border-blue-800/30">
              <SpellAttributeTooltip attributeKey="saveType">
                <p className={cn('text-[10px] mb-0.5 flex items-center gap-1 cursor-help', t4)}>
                  {t('spellCard.labels.saveCheck')} <span className="text-amber-500/60 text-[9px]">ⓘ</span>
                </p>
              </SpellAttributeTooltip>
              <p className="text-sm font-bold text-blue-300">
                🛡️ {en
                  ? getSaveTypeName(spell.saveType, locale)
                  : (spell.saveTypeCn || getSaveTypeName(spell.saveType))}
              </p>
              {spell.saveEffect && (
                <p className={cn('text-[10px] mt-0.5', t4)}>
                  {t(`spellCard.saveSuccess.${spell.saveEffect === 'half' ? 'half' : spell.saveEffect === 'none' ? 'none' : 'partial'}`)}
                </p>
              )}
            </div>
          )}
          {spell.areaOfEffect && (
            <div className="p-2 rounded border bg-amber-900/20 border-amber-800/30">
              <SpellAttributeTooltip attributeKey="areaOfEffect">
                <p className={cn('text-[10px] mb-0.5 flex items-center gap-1 cursor-help', t4)}>
                  {t('spellCard.labels.areaOfEffect')} <span className="text-amber-500/60 text-[9px]">ⓘ</span>
                </p>
              </SpellAttributeTooltip>
              <p className="text-sm font-bold text-amber-300">📐 {areaSizeText(spell.areaOfEffect)}</p>
              <p className={cn('text-[10px] mt-0.5', t4)}>{getAreaTypeName(spell.areaOfEffect.type, locale)}</p>
            </div>
          )}
          {spell.conditions && spell.conditions.length > 0 && (
            <div className="p-2 rounded border col-span-2 bg-purple-900/20 border-purple-800/30">
              <p className={cn('text-[10px] mb-0.5', t4)}>{t('spellCard.sections.statusEffects')}</p>
              <div className="flex flex-wrap gap-1">
                {spell.conditions.map(cond => (
                  <span key={cond} className="px-1.5 py-0.5 text-[10px] rounded bg-purple-800/50 text-purple-300">{translateBuffTerm(cond, locale)}</span>
                ))}
              </div>
            </div>
          )}
          {spell.affectedCreatureTypes && spell.affectedCreatureTypes.length > 0 && (
            <div className="p-2 rounded border col-span-2 bg-teal-900/20 border-teal-800/30">
              <p className={cn('text-[10px] mb-0.5', t4)}>{t('spellCard.sections.creatureTypes')}</p>
              <div className="flex flex-wrap gap-1">
                {spell.affectedCreatureTypes.map(type => (
                  <span key={type} className="px-1.5 py-0.5 text-[10px] rounded bg-teal-800/50 text-teal-300">
                    {getCreatureTypeName(type, locale)}
                  </span>
                ))}
              </div>
            </div>
          )}
          {b && <BuffEffectsBlock b={b} isScroll={false} t4={t4} locale={locale} t={t} />}
        </div>
        {(spell.atHigherLevels || spell.atHigherLevelsEn) && (
          <div className={cn('mt-2 pt-2 border-t', borderSub)}>
            <p className={cn('text-[10px] mb-0.5', t4)}>{t('spellCard.sections.atHigherLevels')}</p>
            <p className={cn('text-xs', t5)}>{spell.atHigherLevels || spell.atHigherLevelsEn}</p>
          </div>
        )}
        {(spell.cantripScaling || spell.damageAtCharacterLevel) && (
          <div className={cn('mt-2 pt-2 border-t', borderSub)}>
            <p className={cn('text-[10px] mb-0.5', t4)}>{t('spellCard.sections.cantripScaling')}</p>
            <p className={cn('text-xs', t5)}>
              {spell.cantripScaling || Object.entries(spell.damageAtCharacterLevel || {}).map(([lvl, dmg]) => formatCantripLevelPart(lvl, String(dmg), locale)).join(', ')}
            </p>
          </div>
        )}
      </div>
    </>
  )
}

// ── Buff/Debuff 机械效果展示 ──

function BuffEffectsBlock({ b, isScroll, t4, locale, t }: {
  b: NonNullable<Spell['buffEffects']>; isScroll: boolean; t4: string; locale?: SupportedLocale; t: TFunction
}) {
  const entries = Object.entries(b).filter(([, v]) => v != null && (Array.isArray(v) ? v.length > 0 : true))
  if (entries.length === 0) return null
  const en = isEn(locale)
  const listSep = en ? ', ' : '、'

  return (
    <div className={cn('p-2 rounded border col-span-2', isScroll ? 'bg-indigo-900/8 border-indigo-800/10' : 'bg-indigo-900/20 border-indigo-800/30')}>
      <p className={cn('text-[10px] mb-1', t4)}>{t('spellCard.sections.mechanicalEffects')}</p>
      <div className="flex flex-wrap gap-1">
        {entries.map(([key, val]) => {
          const meta = getBuffLabel(key, locale)
          if (!meta) return null
          const display = typeof val === 'number'
            ? `${meta.label} ${val > 0 ? '+' : ''}${val}`
            : Array.isArray(val)
              ? (val as string[]).map(v => translateBuffTerm(v, locale)).join(listSep)
              : key === 'damageBonus' ? translateDamageBonus(`${val}`, locale) : `${val}`
          return (
            <span key={key} className={cn('px-1.5 py-0.5 text-[10px] rounded bg-indigo-800/40', meta.color)}>
              {meta.icon} {typeof val === 'number' ? display : `${meta.label}: ${display}`}
            </span>
          )
        })}
      </div>
    </div>
  )
}

// ── 结构化 Effects 管线展示 ──

function EffectsSection({ spell, variant, locale }: {
  spell: Spell; variant: 'spellbook' | 'scroll' | 'default'; locale?: SupportedLocale
}) {
  const { t } = useTranslation('common')
  const phases = spell.effects
  const hasCastOptions = spell.castOptions && spell.castOptions.length > 0
  if (!phases?.length && !hasCastOptions) return null
  const isBook = variant === 'spellbook'
  const isScroll = variant === 'scroll'
  const spellEffectsLabel = t('spellCard.sections.spellEffects')

  return (
    <div className={cn(
      isBook ? 'mt-4 pt-3 border-t border-amber-800/12'
        : isScroll ? 'mb-2' : 'mb-3 p-3 rounded-lg border bg-gray-800/50 border-gray-700/50',
    )}>
      {isScroll && <SpellDivider label={spellEffectsLabel} />}
      {!isScroll && !isBook && <h4 className="text-sm font-medium text-gray-400 mb-2">{spellEffectsLabel}</h4>}
      {isBook && (
        <div className="flex items-center gap-2 mb-2.5">
          <span className="text-[10px] text-amber-600/40 tracking-wider">{spellEffectsLabel}</span>
          <div className="flex-1 h-px bg-gradient-to-r from-amber-700/18 to-transparent" />
        </div>
      )}

      <div className="space-y-1.5">
        {phases?.map((phase, i) => (
          <PhaseRow key={i} phase={phase} variant={variant} locale={locale} />
        ))}
      </div>

      {/* Zone effects: obscurement, difficult terrain, etc. */}
      {(() => {
        const ze = spell.zoneEffects;
        if (!ze) return null;
        const tags: { icon: string; text: string }[] = [];
        if (ze.obscurement === 'heavy') tags.push({ icon: '🌫️', text: t('spellCard.zone.heavyObscurement') });
        else if (ze.obscurement === 'light') tags.push({ icon: '🌁', text: t('spellCard.zone.lightObscurement') });
        if (ze.difficultTerrain) tags.push({ icon: '🪨', text: t('spellCard.zone.difficultTerrain') });
        if (tags.length === 0) return null;
        return (
          <div className="flex flex-wrap items-center gap-1 mt-1.5">
            {tags.map(tag => (
              <span key={tag.text} className={cn(
                'px-1.5 py-0.5 text-[10px] rounded border',
                isBook || isScroll
                  ? 'bg-slate-800/20 border-slate-600/15 text-slate-300/60'
                  : 'bg-slate-700/30 border-slate-600/30 text-slate-300',
              )}>
                {tag.icon} {tag.text}
              </span>
            ))}
          </div>
        );
      })()}

      {/* Cast options (e.g., Enlarge vs Reduce) */}
      {hasCastOptions && spell.castOptions!.map(opt => {
        const { label, icon } = getCastOptionLabel(opt, t)
        return (
          <div key={opt.key} className="mt-2">
            <div className="text-[10px] text-amber-400/60 font-medium mb-1">
              {icon}{label}
            </div>
            <div className="space-y-1 ml-2">
              {opt.effects.map((phase, i) => (
                <PhaseRow key={`${opt.key}-${i}`} phase={phase} variant={variant} locale={locale} />
              ))}
            </div>
          </div>
        )
      })}

      {/* 升环/戏法成长（仅 spellbook 在此输出，default/scroll 在外层已有） */}
      {isBook && spell.atHigherLevels && (
        <div className="mt-2.5 text-[11px]">
          <span className="text-amber-500/30">{t('spellCard.sections.atHigherLevels')}: </span>
          <span className="text-amber-100/45">{spell.atHigherLevels}</span>
        </div>
      )}
      {isBook && (spell.cantripScaling || spell.damageAtCharacterLevel) && (
        <div className="mt-1.5 text-[11px]">
          <span className="text-amber-500/30">{t('spellCard.sections.cantripScaling')}: </span>
          <span className="text-amber-100/45">
            {spell.cantripScaling || Object.entries(spell.damageAtCharacterLevel || {}).map(([lvl, dmg]) => formatCantripLevelPart(lvl, String(dmg), locale)).join(', ')}
          </span>
        </div>
      )}
    </div>
  )
}

/** 单个 phase 行：左侧 trigger 标签 + 右侧效果标签流 */
function PhaseRow({ phase, variant, locale }: { phase: any; variant: string; locale?: SupportedLocale }) {
  const isBook = variant === 'spellbook'
  const trigger = getTriggerLabel(phase.trigger, locale)
  const save = phase.save
  const attack = phase.attack
  const scaling = phase.scaling
  const conditionText = formatPhaseConditionText(phase.condition, locale)

  // badge base style per variant
  const badge = isBook || variant === 'scroll'
    ? 'px-1.5 py-0.5 text-[10px] rounded border'
    : 'px-1.5 py-0.5 text-[10px] rounded border'

  return (
    <div className="flex items-start gap-2">
      {/* Trigger label */}
      <span className={cn(
        'shrink-0 mt-0.5 px-1.5 py-0.5 text-[10px] rounded font-medium',
        isBook || variant === 'scroll'
          ? 'bg-amber-900/15 border border-amber-700/15 text-amber-400/60'
          : 'bg-amber-900/30 border border-amber-800/40 text-amber-300',
      )}>
        {trigger.icon} {trigger.label}
      </span>

      {/* Effects flow */}
      <div className="flex flex-wrap items-center gap-1 min-w-0">
        {/* attack badge */}
        {attack && (
          <span className={cn(badge, 'bg-red-900/12 border-red-800/15 text-red-300/60')}>
            {locale === 'en-US'
              ? (attack.type === 'melee_spell' ? 'Melee Attack' : 'Ranged Attack')
              : (attack.type === 'melee_spell' ? '近战攻击' : '远程攻击')}
          </span>
        )}
        {/* save badge */}
        {save && (
          <span className={cn(badge, 'bg-blue-900/12 border-blue-800/15 text-blue-300/60')}>
            {locale === 'en-US'
              ? `${getSaveTypeName(save.ability, locale)} Save`
              : `${getSaveTypeName(save.ability)}豁免`}
            {save.on_success && (locale === 'en-US'
              ? (save.on_success === 'half_damage' ? ' (half)' : save.on_success === 'no_effect' ? ' (negated)' : save.on_success === 'partial' ? ' (partial)' : '')
              : (save.on_success === 'half_damage' ? '(半伤)' : save.on_success === 'no_effect' ? '(无效)' : save.on_success === 'partial' ? '(部分)' : ''))}
          </span>
        )}
        {conditionText && (
          <span className={cn(badge, 'bg-cyan-900/12 border-cyan-800/15 text-cyan-300/60')}>
            {conditionText}
          </span>
        )}
        {/* effect primitives */}
        {phase.effects.map((eff: any, j: number) => {
          const { text, color } = formatEffectPrimitive(eff, locale)
          if (eff.type === 'narrative') {
            return (
              <span key={j} className={cn('text-[10px] italic leading-snug', color)}>
                {text.length > 60 ? text.slice(0, 60) + '…' : text}
              </span>
            )
          }
          return (
            <span key={j} className={cn(badge, 'bg-amber-900/8 border-amber-700/10', color)}>
              {text}
            </span>
          )
        })}
        {/* duration badge */}
        {phase.duration?.rounds && (
          <span className={cn(badge, 'bg-green-900/12 border-green-800/15 text-green-300/60')}>
            ⏳ {formatRoundsDuration(phase.duration.rounds, locale)}
          </span>
        )}
        {/* escape/removal badge */}
        {phase.escape && (() => {
          const esc = phase.escape
          const method = esc.method || esc.type
          if (method === 'save') {
            const ability = esc.ability || esc.save_type || ''
            const abilityName = getSaveTypeName(ability, locale)
            const timing = esc.trigger || esc.timing
            return (
              <span className={cn(badge, 'bg-yellow-900/12 border-yellow-700/15 text-yellow-300/60')}>
                🛡️ {locale === 'en-US'
                  ? `${timing === 'end_of_turn' ? 'End of turn: ' : timing === 'start_of_turn' ? 'Start of turn: ' : ''}${abilityName} Save`
                  : `${timing === 'end_of_turn' ? '回合末' : timing === 'start_of_turn' ? '回合初' : ''}${abilityName}豁免`}
              </span>
            )
          }
          if (method === 'check') {
            const ability = esc.ability || esc.save_type || ''
            const abilityName = getSaveTypeName(ability, locale)
            return (
              <span className={cn(badge, 'bg-orange-900/12 border-orange-700/15 text-orange-300/60')}>
                💪 {locale === 'en-US' ? `${abilityName} Escape Check` : `${abilityName}检定脱困`}
              </span>
            )
          }
          if (method === 'special') {
            return (
              <span className={cn(badge, 'bg-gray-700/20 border-gray-600/15 text-gray-300/60')}>
                ✦ {esc.description || (locale === 'en-US' ? 'Special' : '特殊')}
              </span>
            )
          }
          return null
        })()}
        {/* scaling inline */}
        {scaling && (() => {
          const n = scaling.per_slot_above || 1
          const en = isEn(locale)
          const head = en ? `↑ Per slot above ${n}` : `↑ 每升${n}环`
          const dice = scaling.extra_dice ? ` +${scaling.extra_dice}${en ? ' dice' : ''}` : ''
          const targets = scaling.extra_targets ? (en ? ` +${scaling.extra_targets} targets` : ` +${scaling.extra_targets}目标`) : ''
          const value = scaling.extra_value ? ` +${scaling.extra_value}` : ''
          const tempHp = scaling.extra_temp_hp ? (en ? ` +${scaling.extra_temp_hp} temp HP` : ` +${scaling.extra_temp_hp}临时HP`) : ''
          return (
            <span className={cn(
              'text-[9px]',
              isBook || variant === 'scroll' ? 'text-amber-500/35' : 'text-amber-400/60',
            )}>
              {head}{dice}{targets}{value}{tempHp}
            </span>
          )
        })()}
      </div>
    </div>
  )
}

// ── 职业特性加成说明块 ──

function InvocationNotes({ spell, isScroll, isSpellbook }: { spell: Spell; isScroll?: boolean; isSpellbook?: boolean }) {
  const { t } = useTranslation('common')
  const notes = (spell as any)._invocationNotes as { name: string; desc: string; source?: string }[] | undefined;
  if (!notes?.length) return null;

  const fallbackTitle = t('spellCard.sections.invocationBoost')
  // Group notes by source
  const groups = new Map<string, { name: string; desc: string }[]>();
  for (const n of notes) {
    const src = n.source || fallbackTitle;
    if (!groups.has(src)) groups.set(src, []);
    groups.get(src)!.push(n);
  }

  const renderGroup = (title: string, items: { name: string; desc: string }[]) => {
    if (isSpellbook) {
      return (
        <div key={title} className="mt-4 pt-3 border-t border-purple-700/15">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] text-purple-400/60 tracking-wider">{title}</span>
            <div className="flex-1 h-px bg-gradient-to-r from-purple-700/20 to-transparent" />
          </div>
          <div className="space-y-1.5">
            {items.map(n => (
              <div key={n.name} className="flex items-start gap-2 text-[11px] px-2 py-1.5
                            rounded bg-purple-900/12 border border-purple-700/12">
                <span className="text-purple-400/70 font-medium shrink-0">{n.name}</span>
                <span className="text-amber-100/50">{n.desc}</span>
              </div>
            ))}
          </div>
        </div>
      );
    }
    return (
      <div key={title} className={cn('mb-3 p-3 rounded-lg border',
        isScroll ? 'bg-purple-900/8 border-purple-700/12' : 'bg-purple-900/15 border-purple-700/25')}>
        <div className="flex items-center gap-2 mb-2">
          <span className={cn('text-[10px] font-medium tracking-wider',
            isScroll ? 'text-purple-300/50' : 'text-purple-400')}>
            {title}
          </span>
          <div className={cn('flex-1 h-px',
            isScroll ? 'bg-purple-700/15' : 'bg-purple-700/30')} />
        </div>
        <div className="space-y-1.5">
          {items.map(n => (
            <div key={n.name} className="flex items-start gap-2 text-xs">
              <span className={cn('font-medium shrink-0',
                isScroll ? 'text-purple-300/60' : 'text-purple-300')}>{n.name}</span>
              <span className={isScroll ? 'text-amber-100/45' : 'text-gray-300'}>{n.desc}</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return <>{Array.from(groups.entries()).map(([title, items]) => renderGroup(title, items))}</>;
}
