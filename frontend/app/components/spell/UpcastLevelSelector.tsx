import React, { useMemo } from 'react'

/** 从法术描述中提取升环效果文本 */
function extractUpcastFromDesc(desc?: string): string | null {
  if (!desc) return null
  // 匹配 "升环施法效应。..." 或 "升环施法。..." 直到段落结尾
  const m = desc.match(/升环施法[效应]*[。．\.]\s*([\s\S]+?)(?:\n\n|$)/)
  return m?.[1]?.trim() || null
}

interface Props {
  spellLevel: number
  spellSlots: number[]       // 各环最大法术位 [0, max1, max2, ...]
  remainingSlots: number[]   // 各环剩余法术位
  selectedLevel: number
  onSelectLevel: (lv: number) => void
  damageAtSlotLevel?: Record<string, string>
  healingAtSlotLevel?: Record<string, string>
  damageTypeCn?: string
  atHigherLevels?: string
  description?: string       // 法术描述（兜底提取升环效果）
  theme?: 'spellbook' | 'scroll'
}

export function UpcastLevelSelector({
  spellLevel, spellSlots, remainingSlots,
  selectedLevel, onSelectLevel,
  damageAtSlotLevel, healingAtSlotLevel, damageTypeCn,
  atHigherLevels, description,
  theme = 'spellbook',
}: Props) {
  if (spellLevel <= 0) return null

  // 收集所有可选等级：spellLevel ~ 9 中有法术位的
  const levels: number[] = []
  for (let i = spellLevel; i <= 9; i++) {
    if ((spellSlots[i] ?? 0) > 0) levels.push(i)
  }
  // 只有本环可用时不显示选择器
  if (levels.length <= 1) return null

  const isScroll = theme === 'scroll'
  const baseDmg = damageAtSlotLevel?.[String(spellLevel)]
  const baseHeal = healingAtSlotLevel?.[String(spellLevel)]
  const upDmg = selectedLevel > spellLevel ? damageAtSlotLevel?.[String(selectedLevel)] : null
  const upHeal = selectedLevel > spellLevel ? healingAtSlotLevel?.[String(selectedLevel)] : null
  const upcastText = useMemo(
    () => atHigherLevels || extractUpcastFromDesc(description),
    [atHigherLevels, description]
  )

  return (
    <div className={`flex-shrink-0 ${isScroll ? 'px-5 pt-2' : 'pt-1.5'}`}>
      {/* 等级药丸行 */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className={`text-[10px] flex-shrink-0 ${isScroll ? 'text-amber-400/50' : 'text-amber-500/40'}`}>
          施放等级:
        </span>
        {levels.map(lv => {
          const remaining = remainingSlots[lv] ?? 0
          const isSelected = lv === selectedLevel
          const isDisabled = remaining <= 0
          return (
            <button key={lv} disabled={isDisabled}
              onClick={() => onSelectLevel(lv)}
              className={`px-2 py-0.5 rounded-full text-[10px] font-medium transition-all border
                ${isSelected
                  ? 'bg-amber-700/35 border-amber-500/40 text-amber-200 shadow-[0_0_8px_rgba(180,140,50,0.15)]'
                  : isDisabled
                    ? 'bg-gray-800/20 border-gray-700/15 text-gray-600/40 cursor-not-allowed'
                    : 'bg-amber-900/12 border-amber-700/15 text-amber-400/60 hover:bg-amber-800/20 hover:border-amber-600/25 hover:text-amber-300/80'
                }`}
            >
              {lv}环
              {lv > spellLevel && <span className="text-[8px] ml-0.5 opacity-60" title={`比原始环位高${lv - spellLevel}环`}>↑{lv - spellLevel}</span>}
            </button>
          )
        })}
      </div>

      {/* 升环效果预览 */}
      {selectedLevel > spellLevel && (
        <div className={`mt-1 text-[10px] ${isScroll ? 'text-amber-300/55' : 'text-amber-400/50'}`}>
          {upDmg ? (
            <span>
              升环伤害: <span className="text-amber-200/70 font-medium">{upDmg}</span>
              {damageTypeCn && <span className="ml-0.5">{damageTypeCn}</span>}
              {baseDmg && <span className="text-amber-600/35 ml-1">(基础 {baseDmg})</span>}
            </span>
          ) : upHeal ? (
            <span>
              升环治疗: <span className="text-emerald-300/70 font-medium">{upHeal}</span>
              {baseHeal && <span className="text-amber-600/35 ml-1">(基础 {baseHeal})</span>}
            </span>
          ) : upcastText ? (
            <span>
              升环效果: <span className="text-amber-200/60">{upcastText}</span>
            </span>
          ) : (
            <span className="text-gray-500/50 italic">此法术升环无额外效果</span>
          )}
        </div>
      )}
    </div>
  )
}
