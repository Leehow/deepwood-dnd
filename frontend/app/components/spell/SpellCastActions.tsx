/**
 * SpellCastActions - 共享的法术施放按钮区域
 * 包含：材料信息框 + 材料槽位 + 幻象图片区域 + 升环选择器 + 专注冲突警告/确认 + 施放按钮
 * 同时用于 ClassicCharacterCard (右侧栏) 和 HotbarSlotItem (快捷栏)
 */
import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import type { Spell } from '~/types/spell'
import type { EquipmentItem } from '~/components/character/CharacterDisplay/types/Character'
import { UpcastLevelSelector } from './UpcastLevelSelector'
import { resolveSpellCastUI } from '~/utils/spellCastMiddleware'
import type { SpellCastUIDescriptor } from '~/types/spellCastUI'
import { getIconPath } from '~/components/character/CharacterDisplay/utils/rules'
import {
  needsMaterialCheck, getRequiredComponents,
  hasMaterialComponent, getAvailableMaterials,
  ensureComponentsLoaded,
} from './spellMaterialUtils'
import { apiFetch } from '~/utils/api-client'

/** Unified payload passed from SpellCastActions to all parent cast handlers */
export interface SpellCastData {
  spell: Spell
  level: number
  ritualCast?: boolean
  confirmBreakConcentration?: boolean
  selectedOption?: string
  illusionData?: { imageUrl?: string; description?: string; displayName?: string }
  areaSize?: number
  freecast?: boolean
  /** 选中的施法材料 ID（后端消耗用） */
  materialId?: string
  /** 入口中间件推导的目标模式 — 父级 castSpellAction 据此分发
   *  (Misty Step 等 teleport_destination 模式必须依赖这个字段，
   *   否则会被默认 self-buff 路径吞掉，导致弹窗关闭却没进入选点流程) */
  targetingMode?: import('~/types/spellCastUI').TargetingMode
}

/** Data-driven check: does this spell support illusion image input? */
export function needsIllusionInput(spell: Spell): boolean {
  const ill = spell.illusion
  if (!ill) return false
  if (!ill.types?.includes('visual')) return false
  const excludedSubtypes = ['self_duplicate', 'mental', 'duplicates', 'quasi_real_creature']
  if (ill.subtype && excludedSubtypes.includes(ill.subtype)) return false
  return true
}

/** Check if this spell is a disguise-type illusion (changes existing token appearance) */
export function isDisguiseSpell(spell: Spell): boolean {
  return spell.illusion?.subtype === 'appearance'
}

interface SpellCastActionsProps {
  spell: Spell
  selectedCastLevel: number
  onSelectCastLevel: (lv: number) => void
  spellSlots: number[]
  remainingSlots: number[]
  concentrationSpellName?: string | null
  castingSpellName?: string | null
  isWarlock?: boolean
  isInvocationFree?: boolean
  damageAtSlotLevel?: Record<string, string>
  healingAtSlotLevel?: Record<string, string>
  damageTypeCn?: string
  /** 角色当前装备列表（用于材料验证） */
  equipment?: EquipmentItem[]
  /** 材料消耗回调（消耗型材料施法成功后调用） */
  onConsumeMaterial?: (materialId: string) => void
  /** DM 模式：显示强制施法按钮，绕过所有限制 */
  isDM?: boolean
  /** 角色是否处于沉默状态（阻止需要 V 成分的法术） */
  isSilenced?: boolean
  /** 角色拥有 somatic_with_hands_full 规则覆写（如战斗施法者专长） */
  hasSomaticFreedom?: boolean
  /** 幻象图片 URL（施放时传递给地图创建幻影 token） */
  illusionImageUrl?: string | null
  onIllusionImageChange?: (url: string | null) => void
  /** 幻象描述文本 */
  illusionDesc?: string
  onIllusionDescChange?: (desc: string) => void
  campaignId?: string
  onCast: (data: SpellCastData) => void
}

const BG_STYLE = { background: 'linear-gradient(135deg, #2e2519, #342a20, #2b2319)' }

const BTN_BASE = `flex-1 py-3 rounded-lg text-sm font-medium transition-all
  bg-gradient-to-r from-amber-800/30 via-amber-700/35 to-amber-800/30
  border border-amber-600/30 text-amber-200/80
  hover:from-amber-700/35 hover:via-amber-600/40 hover:to-amber-700/35
  hover:border-amber-500/40 hover:text-amber-100 hover:shadow-[0_0_20px_rgba(180,140,50,0.12)]
  disabled:opacity-30 disabled:cursor-not-allowed`

const BTN_FREECAST = `flex-1 py-3 rounded-lg text-sm font-medium transition-all
  bg-gradient-to-r from-teal-900/25 via-teal-800/30 to-teal-900/25
  border border-teal-600/25 text-teal-200/70
  hover:from-teal-800/30 hover:via-teal-700/35 hover:to-teal-800/30
  hover:border-teal-500/35 hover:text-teal-100/90`

export function SpellCastActions({
  spell, selectedCastLevel, onSelectCastLevel,
  spellSlots, remainingSlots,
  concentrationSpellName, castingSpellName, isWarlock, isInvocationFree,
  damageAtSlotLevel, healingAtSlotLevel, damageTypeCn,
  equipment, onConsumeMaterial, isDM, isSilenced, hasSomaticFreedom,
  illusionImageUrl, onIllusionImageChange,
  illusionDesc, onIllusionDescChange,
  campaignId,
  onCast,
}: SpellCastActionsProps) {
  const [showConcConfirm, setShowConcConfirm] = useState(false)
  const [pendingCastMode, setPendingCastMode] = useState<'normal' | 'ritual'>('normal')
  const [selectedMaterial, setSelectedMaterial] = useState<string | null>(null)
  const [showMaterialPanel, setShowMaterialPanel] = useState(false)
  const [componentsReady, setComponentsReady] = useState(false)
  const slotRef = useRef<HTMLDivElement>(null)

  // Cast option selection (e.g., Enlarge vs Reduce)
  const [selectedOptionKey, setSelectedOptionKey] = useState('')

  // Area size selection for sizeIsMax spells
  const aoe = spell.areaOfEffect
  const [selectedAreaSize, setSelectedAreaSize] = useState<number>(aoe?.size ?? 5)

  // Illusion internal state (used when parent doesn't manage state)
  const [localIllusionDesc, setLocalIllusionDesc] = useState('')
  const [localIllusionUrl, setLocalIllusionUrl] = useState<string | null>(null)
  const [illusionMode, setIllusionMode] = useState<'generate' | 'library'>('generate')
  const [isGenerating, setIsGenerating] = useState(false)
  const [libraryImages, setLibraryImages] = useState<{ id: number; url: string; name: string }[]>([])
  const [libraryLoaded, setLibraryLoaded] = useState(false)
  const [illusionDisplayName, setIllusionDisplayName] = useState('')

  // Use parent-managed or local state
  const curIllusionDesc = illusionDesc ?? localIllusionDesc
  const setCurIllusionDesc = onIllusionDescChange ?? setLocalIllusionDesc
  const curIllusionUrl = illusionImageUrl ?? localIllusionUrl
  const setCurIllusionUrl = onIllusionImageChange ?? setLocalIllusionUrl

  useEffect(() => {
    setSelectedOptionKey('')
  }, [spell.id])

  useEffect(() => { ensureComponentsLoaded().then(() => setComponentsReady(true)) }, [])

  // 点击外部关闭材料面板
  useEffect(() => {
    if (!showMaterialPanel) return
    const handler = (e: MouseEvent) => {
      if (slotRef.current && !slotRef.current.contains(e.target as Node)) {
        setShowMaterialPanel(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showMaterialPanel])

  // Load illusion library on tab switch
  const loadLibrary = useCallback(async () => {
    if (libraryLoaded) return
    try {
      const resp = await apiFetch('/api/spells/illusion-library')
      if (resp.ok) {
        const data = await resp.json()
        setLibraryImages(data.avatars || [])
      }
    } catch (_) { /* ignore */ }
    setLibraryLoaded(true)
  }, [libraryLoaded])

  // M 成分 (仍需用于材料面板渲染)
  const hasM = hasMaterialComponent(spell)
  const materialsText = spell.materials || ''
  const isGp = needsMaterialCheck(spell)

  const availableMaterials = useMemo(
    () => componentsReady && equipment ? getAvailableMaterials(spell, equipment) : [],
    [componentsReady, spell, equipment],
  )
  const requiredComponents = useMemo(
    () => componentsReady && isGp ? getRequiredComponents(spell) : [],
    [componentsReady, isGp, spell],
  )

  const materialMissing = hasM && componentsReady && availableMaterials.length === 0

  const selectedItem = selectedMaterial
    ? availableMaterials.find(e => e.id === selectedMaterial) ?? null
    : null

  // Auto-select first available material (no need for manual click)
  useEffect(() => {
    if (hasM && availableMaterials.length > 0 && !selectedMaterial) {
      setSelectedMaterial(availableMaterials[0].id)
    }
  }, [hasM, availableMaterials, selectedMaterial])

  // ── 入口中间件：一次性推导所有施法 UI 决策 ────────────
  const ui: SpellCastUIDescriptor = useMemo(() => {
    const mainHand = equipment?.find(e => e.equippedSlot === 'main_hand') ?? null
    const offHand = equipment?.find(e => e.equippedSlot === 'off_hand') ?? null
    return resolveSpellCastUI(spell, {
      isSilenced: !!isSilenced,
      hasSomaticFreedom: !!hasSomaticFreedom,
      equipMainHand: !!mainHand,
      equipOffHand: !!offHand,
      hasMaterialAvailable: !materialMissing,
      materialSelected: !!selectedMaterial,
      selectedCastLevel,
      remainingSlots: remainingSlots[selectedCastLevel] ?? 0,
      maxSlotsArray: spellSlots,
      remainingSlotsArray: remainingSlots,
      concentrationSpellName: concentrationSpellName ?? null,
      castingSpellName: castingSpellName ?? null,
      isWarlock: !!isWarlock,
      isInvocationFree: !!isInvocationFree,
      hasIllusionImage: !!curIllusionUrl,
      selectedOptionKey: selectedOptionKey || null,
      isDM: !!isDM,
    })
  }, [
    spell, isSilenced, hasSomaticFreedom, equipment,
    materialMissing, selectedMaterial, selectedCastLevel, remainingSlots,
    concentrationSpellName, castingSpellName, isWarlock, isInvocationFree,
    curIllusionUrl, selectedOptionKey, isDM,
  ])

  useEffect(() => {
    if (ui.needsIllusionInput && illusionMode === 'library') loadLibrary()
  }, [ui.needsIllusionInput, illusionMode, loadLibrary])

  const handleGenerateIllusion = async () => {
    if (!curIllusionDesc.trim() || isGenerating) return
    setIsGenerating(true)
    try {
      const resp = await apiFetch('/api/spells/generate-illusion-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: curIllusionDesc.trim(),
          spell_id: spell.id,
          campaign_id: campaignId ? parseInt(campaignId) : 0,
        }),
      })
      if (resp.ok) {
        const data = await resp.json()
        setCurIllusionUrl(data.image_url)
        if (data.display_name) setIllusionDisplayName(data.display_name)
        setLibraryLoaded(false) // refresh library next time
      }
    } catch (_) { /* ignore */ }
    setIsGenerating(false)
  }

  const spellLevel = spell.level ?? 0
  const cur = remainingSlots[selectedCastLevel] ?? 0
  const max = spellSlots[selectedCastLevel] ?? 0
  const slotLabel = isWarlock ? '契约位' : '法术位'

  const doCastAndConsume = (ritualCast = false, confirmBreakConcentration = false) => {
    const illusionData = (ui.needsIllusionInput && curIllusionUrl)
      ? { imageUrl: curIllusionUrl, description: curIllusionDesc, displayName: illusionDisplayName || undefined }
      : undefined
    const castData: SpellCastData = {
      spell,
      level: ritualCast ? spellLevel : selectedCastLevel,
      ritualCast: ritualCast || undefined,
      confirmBreakConcentration: confirmBreakConcentration || undefined,
      selectedOption: ui.hasCastOptions ? selectedOptionKey : undefined,
      illusionData,
      areaSize: ui.canChooseAreaSize ? selectedAreaSize : undefined,
      freecast: isInvocationFree || undefined,
      materialId: selectedMaterial || undefined,
      targetingMode: ui.targetingMode,
    }
    onCast(castData)
  }

  const shouldWarnBreakConcentration = (mode: 'normal' | 'ritual') => {
    if (!concentrationSpellName) return false
    if (mode === 'ritual') return ui.isRitualLongCast
    return ui.isLongCast || ui.isConcentration
  }

  const handleCast = (mode: 'normal' | 'ritual' = 'normal') => {
    if (ui.isCastDisabled) return
    if (shouldWarnBreakConcentration(mode)) {
      setPendingCastMode(mode)
      setShowConcConfirm(true)
      return
    }
    doCastAndConsume(mode === 'ritual')
  }

  const handleConcConfirm = () => {
    setShowConcConfirm(false)
    doCastAndConsume(pendingCastMode === 'ritual', true)
  }

  return (
    <>
      {castingSpellName && (
        <div className="mx-5 mb-2 px-3 py-2 rounded-lg border border-orange-500/40 bg-orange-900/30">
          <div className="flex items-center gap-1.5 text-xs text-orange-300 font-medium">
            <span>⏳</span>
            <span>
              {ui.isLongCast || ui.isRitualLongCast
                ? `当前正在施放「${castingSpellName}」，不能同时开始另一个长时间施法`
                : `当前正在施放「${castingSpellName}」，请先完成或取消该施法后再施放此法术`}
            </span>
          </div>
        </div>
      )}

      {(ui.isLongCast || ui.isRitualLongCast) && concentrationSpellName && !castingSpellName && !showConcConfirm && (
        <div className="mx-5 mb-2 px-3 py-2 rounded-lg border border-amber-500/40 bg-amber-900/25">
          <div className="flex items-center gap-1.5 text-xs text-amber-300 font-medium">
            <span>⚠️</span>
            <span>
              {ui.isLongCast
                ? `该法术施法期间需要专注，开始施法会打断当前专注「${concentrationSpellName}」`
                : `以仪式方式施放时需要额外施法 10 分钟，开始仪式会打断当前专注「${concentrationSpellName}」`}
            </span>
          </div>
        </div>
      )}

      {/* Concentration warning — RED, placed right before cast button area */}
      {ui.isConcentration && concentrationSpellName && !showConcConfirm && (
        <div className="mx-5 mb-2 px-3 py-2 rounded-lg border border-red-500/40 bg-red-900/30">
          <div className="flex items-center gap-1.5 text-xs text-red-300 font-medium">
            <span>⚠️</span>
            <span>当前正在专注「{concentrationSpellName}」，施放将打断当前专注</span>
          </div>
        </div>
      )}

      {/* Disguise illusion requires image — non-blocking hint in original position */}
      {ui.illusionRequired && !curIllusionUrl && (
        <div className="mx-5 mb-2 px-3 py-2 rounded-lg border border-amber-500/30 bg-amber-900/20">
          <div className="flex items-center gap-1.5 text-xs text-amber-300">
            <span>🎭</span>
            <span>请在下方展开幻象图像面板选择或生成图像</span>
          </div>
        </div>
      )}

      {/* Material text hint — M 成分法术都显示 */}
      {hasM && materialsText && (
        <div className="mx-5 mb-2">
          <div className="px-3 py-2 rounded-lg border border-amber-600/25 bg-amber-900/15">
            <div className="flex items-start gap-1.5 text-[11px] text-amber-300/80">
              <span className="flex-shrink-0 mt-0.5">💎</span>
              <span>
                材料：{materialsText}
                {componentsReady && !materialMissing && availableMaterials.length > 0 && (
                  <span className="ml-1.5 text-emerald-400/90">
                    ✓ {selectedItem?.id === 'component_pouch'
                      ? '材料包可替代'
                      : selectedItem
                        ? `已持有`
                        : availableMaterials.some(e => e.id === 'component_pouch')
                          ? '材料包可替代'
                          : '已持有'
                    }
                  </span>
                )}
              </span>
            </div>
            {/* GP 法术缺少材料时的详细提示 */}
            {isGp && materialMissing && (
              <div className="mt-1.5 pt-1.5 border-t border-amber-700/20">
                <div className="text-xs text-red-300 flex items-center gap-1.5">
                  <span>⚠️</span>
                  <span>背包中缺少所需材料（{spell.materialCost}gp）</span>
                </div>
                {requiredComponents.length > 0 && (
                  <div className="mt-1 ml-5 text-[10px] text-red-400/60">
                    需要：{requiredComponents.map(c => c.name).join('、')}
                  </div>
                )}
              </div>
            )}
            {/* 非 GP 法术缺少材料包时的提示 */}
            {!isGp && materialMissing && (
              <div className="mt-1.5 pt-1.5 border-t border-amber-700/20">
                <div className="text-xs text-red-300 flex items-center gap-1.5">
                  <span>⚠️</span>
                  <span>背包中缺少材料包或对应材料</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Illusion image section — 幻影法术图像 */}
      {ui.needsIllusionInput && (
        <IllusionImageSection
          mode={illusionMode}
          onModeChange={setIllusionMode}
          description={curIllusionDesc}
          onDescriptionChange={setCurIllusionDesc}
          imageUrl={curIllusionUrl}
          onImageChange={setCurIllusionUrl}
          isGenerating={isGenerating}
          onGenerate={handleGenerateIllusion}
          libraryImages={libraryImages}
          required={ui.isDisguiseSpell}
        />
      )}

      {/* Upcast selector */}
      {ui.showUpcastSelector && (
        <UpcastLevelSelector
          spellLevel={spellLevel}
          spellSlots={spellSlots}
          remainingSlots={remainingSlots}
          selectedLevel={selectedCastLevel}
          onSelectLevel={onSelectCastLevel}
          damageAtSlotLevel={damageAtSlotLevel}
          healingAtSlotLevel={healingAtSlotLevel}
          damageTypeCn={damageTypeCn}
          atHigherLevels={spell.atHigherLevels}
          description={spell.description}
          theme="scroll"
        />
      )}

      {/* Cast button row: [Material Slot] + [Cast Button] */}
      <div className="flex-shrink-0 px-5 pb-4 pt-2" style={BG_STYLE}>
        {/* Cast option selector (e.g., Enlarge vs Reduce) */}
        {ui.hasCastOptions && (
          <div className="mb-2 flex gap-1.5">
            {spell.castOptions!.map(opt => (
              <button
                key={opt.key}
                onClick={() => setSelectedOptionKey(opt.key)}
                className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-all border
                  ${selectedOptionKey === opt.key
                    ? 'bg-amber-700/30 border-amber-500/40 text-amber-200 shadow-[0_0_8px_rgba(180,140,50,0.15)]'
                    : 'bg-transparent border-amber-800/20 text-amber-400/50 hover:border-amber-600/30 hover:text-amber-300/70'
                  }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
        {/* Area size selector for sizeIsMax spells */}
        {ui.canChooseAreaSize && (
          <AreaSizeSelector
            maxSize={aoe!.size}
            areaType={aoe!.type}
            selectedSize={selectedAreaSize}
            onChange={setSelectedAreaSize}
          />
        )}
        {showConcConfirm ? (
          <div>
            <p className="text-xs text-red-300 font-medium text-center mb-2">
              ⚠️ {pendingCastMode === 'ritual' ? `开始仪式施放「${spell.name}」` : `施放「${spell.name}」`}将替换当前专注「{concentrationSpellName ?? ''}」
            </p>
            <div className="flex gap-2">
              <button onClick={() => setShowConcConfirm(false)}
                className="flex-1 py-2.5 rounded-lg text-xs font-medium bg-gray-700/40 border border-gray-600/25 text-gray-300 hover:bg-gray-600/40 transition-colors">
                取消
              </button>
              <button onClick={handleConcConfirm}
                className={`flex-1 py-2.5 rounded-lg text-xs font-medium transition-all
                  bg-gradient-to-r from-red-900/40 via-red-800/45 to-red-900/40
                  border border-red-500/40 text-red-200
                  hover:from-red-800/45 hover:via-red-700/50 hover:to-red-800/45
                  hover:border-red-400/50 hover:text-red-100`}>
                确认施放
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-stretch gap-2">
            {/* Material Slot — 仅 M 成分法术显示 */}
            {hasM && (
              <div ref={slotRef} className="relative flex-shrink-0">
                <MaterialSlot
                  selectedItem={selectedItem}
                  materialMissing={materialMissing}
                  isConsumed={!!spell.materialConsumed}
                  isOpen={showMaterialPanel}
                  onClick={() => !materialMissing && setShowMaterialPanel(v => !v)}
                />
                {/* Material selection dropdown */}
                {showMaterialPanel && availableMaterials.length > 0 && (
                  <div className="absolute bottom-full left-0 mb-1.5 w-56 max-h-48 overflow-y-auto
                    rounded-lg border border-amber-600/30 bg-[#1a1510] shadow-xl z-50">
                    <div className="p-1.5 space-y-0.5">
                      {availableMaterials.map(item => {
                        const isSelected = selectedMaterial === item.id
                        const isPouch = item.id === 'component_pouch'
                        const icon = getIconPath(item)
                        return (
                          <button
                            key={item.id}
                            onClick={() => {
                              setSelectedMaterial(isSelected ? null : item.id)
                              setShowMaterialPanel(false)
                            }}
                            className={`w-full text-left px-2.5 py-2 rounded-md text-xs transition-all
                              flex items-center justify-between gap-2
                              ${isSelected
                                ? 'bg-amber-700/30 border border-amber-500/40 text-amber-200'
                                : 'border border-transparent text-gray-300 hover:bg-amber-900/25 hover:text-amber-200'
                              }`}
                          >
                            <span className="flex items-center gap-1.5 min-w-0">
                              <ItemIcon icon={icon} size={18} />
                              <span className="truncate">{item.name}</span>
                            </span>
                            <span className="flex items-center gap-1.5 flex-shrink-0">
                              <span className="text-[10px] text-gray-500">x{item.quantity ?? 1}</span>
                              {!isPouch && spell.materialConsumed && (
                                <span className="text-[9px] px-1 py-0.5 rounded bg-red-900/30 text-red-400/70 border border-red-700/20">
                                  消耗
                                </span>
                              )}
                              {!isPouch && !spell.materialConsumed && (
                                <span className="text-[9px] px-1 py-0.5 rounded bg-emerald-900/30 text-emerald-400/70 border border-emerald-700/20">
                                  保留
                                </span>
                              )}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Red warning directly above cast button when disabled */}
            {ui.isCastDisabled && ui.castDisabledReasons.length > 0 && !ui.castDisabledReasons.every(r => r.type === 'casting_in_progress') && (
              <div className="mb-2 px-3 py-2 rounded-lg border border-red-500/40 bg-red-900/30">
                <div className="flex items-start gap-1.5 text-xs text-red-300 font-medium">
                  <span className="flex-shrink-0">🚫</span>
                  <span>
                    {ui.blockedByNoFreeHand && '此法术需要姿势组件（S），但双手均被占用'}
                    {ui.blockedBySilence && '此法术需要言语成分（V），但角色处于沉默状态'}
                    {ui.castDisabledReasons.some(r => r.type === 'disguise_no_image') && '需要先选择幻象图像才能施放'}
                    {ui.castDisabledReasons.some(r => r.type === 'material_missing') && !ui.blockedByNoFreeHand && !ui.blockedBySilence && '背包中缺少所需施法材料'}
                    {ui.castDisabledReasons.some(r => r.type === 'material_not_selected') && !ui.castDisabledReasons.some(r => r.type === 'material_missing') && !ui.blockedByNoFreeHand && !ui.blockedBySilence && '请先选择施法材料'}
                    {ui.castDisabledReasons.some(r => r.type === 'option_not_selected') && !ui.castDisabledReasons.some(r => r.type === 'material_missing') && !ui.blockedByNoFreeHand && !ui.blockedBySilence && '请先选择此法术的施放选项'}
                  </span>
                </div>
              </div>
            )}

            {/* Cast button */}
            <div className="flex-1 flex flex-col gap-2">
              {isInvocationFree && spellLevel > 0 ? (
                <button onClick={() => handleCast('normal')} disabled={ui.isCastDisabled} className={BTN_FREECAST}>
                  {ui.castButtonText} · 随意施放（无限次）
                </button>
              ) : spellLevel > 0 ? (
                <button onClick={() => handleCast('normal')} disabled={ui.isCastDisabled || cur <= 0} className={BTN_BASE}>
                  {ui.castButtonText} · 消耗{selectedCastLevel !== spellLevel ? `${selectedCastLevel}环` : ''}{slotLabel} ({cur}/{max})
                </button>
              ) : (
                <button onClick={() => handleCast('normal')} disabled={ui.isCastDisabled} className={BTN_BASE}>
                  施放戏法（无限次）
                </button>
              )}
              {ui.canRitualCast && (
                <button
                  onClick={() => handleCast('ritual')}
                  disabled={ui.isCastDisabled}
                  className="w-full py-2.5 rounded-lg text-xs font-medium transition-all
                    bg-gradient-to-r from-sky-900/25 via-sky-800/30 to-sky-900/25
                    border border-sky-600/25 text-sky-200/80
                    hover:from-sky-800/30 hover:via-sky-700/35 hover:to-sky-800/30
                    hover:border-sky-500/35 hover:text-sky-100 hover:shadow-[0_0_20px_rgba(56,189,248,0.12)]
                    disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  仪式施法 · +10分钟 · 不耗法术位
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* DM 强制施法 */}
      {ui.showDmForceCast && (
        <div className="px-5 pb-3 -mt-1">
          <button
            onClick={() => onCast({
              spell,
              level: selectedCastLevel,
              areaSize: ui.canChooseAreaSize ? selectedAreaSize : undefined,
              freecast: true,
              targetingMode: ui.targetingMode,
            })}
            className="w-full py-2 rounded-lg text-xs font-medium transition-all
              bg-gradient-to-r from-violet-900/20 via-violet-800/25 to-violet-900/20
              border border-violet-600/20 text-violet-300/60
              hover:from-violet-800/25 hover:via-violet-700/30 hover:to-violet-800/25
              hover:border-violet-500/30 hover:text-violet-200/80"
          >
            ⚡ DM 强制施法（绕过限制）
          </button>
        </div>
      )}
    </>
  )
}

/** Illusion image section — AI generate or pick from library */
function IllusionImageSection({
  mode, onModeChange,
  description, onDescriptionChange,
  imageUrl, onImageChange,
  isGenerating, onGenerate,
  libraryImages,
  required,
}: {
  mode: 'generate' | 'library'
  onModeChange: (m: 'generate' | 'library') => void
  description: string
  onDescriptionChange: (d: string) => void
  imageUrl: string | null
  onImageChange: (url: string | null) => void
  isGenerating: boolean
  onGenerate: () => void
  libraryImages: { id: number; url: string; name: string }[]
  required?: boolean
}) {
  const [expanded, setExpanded] = useState(!!imageUrl || !!required)

  // Auto-expand when image is selected
  useEffect(() => { if (imageUrl) setExpanded(true) }, [imageUrl])

  return (
    <div className="mx-5 mb-2">
      <div className="rounded-lg border border-purple-600/25 bg-purple-900/10 overflow-hidden">
        {/* Header — clickable to expand/collapse */}
        <div className="flex items-center justify-between px-3 py-1.5 cursor-pointer hover:bg-purple-900/15 transition-colors"
          onClick={() => !imageUrl && setExpanded(v => !v)}>
          <span className="text-[11px] text-purple-300/80 font-medium flex items-center gap-1">
            🌀 幻象图像{required ? '（必选）' : '（可选）'}
            {!expanded && !imageUrl && <span className="text-[9px] text-purple-500/40">点击展开</span>}
          </span>
          {expanded && (
            <div className="flex gap-1">
              {(['generate', 'library'] as const).map(m => (
                <button key={m}
                  onClick={e => { e.stopPropagation(); onModeChange(m); }}
                  className={`px-2 py-0.5 rounded text-[10px] transition-all ${
                    mode === m
                      ? 'bg-purple-700/30 text-purple-200 border border-purple-500/30'
                      : 'text-purple-400/50 hover:text-purple-300/70'
                  }`}>
                  {m === 'generate' ? 'AI生成' : '图库'}
                </button>
              ))}
            </div>
          )}
        </div>

        {expanded && (
        <div className="p-2.5 border-t border-purple-700/20">
          {/* Generate mode */}
          {mode === 'generate' && !imageUrl && (
            <div className="space-y-1.5">
              <textarea
                value={description}
                onChange={e => onDescriptionChange(e.target.value)}
                placeholder="描述你想创造的幻象..."
                rows={1}
                className="w-full px-2.5 py-1.5 rounded-md text-xs bg-black/20 border border-purple-700/20
                  text-purple-100/90 placeholder-purple-400/30 resize-none
                  focus:border-purple-500/40 focus:outline-none focus:ring-1 focus:ring-purple-500/20"
              />
              <button
                onClick={onGenerate}
                disabled={!description.trim() || isGenerating}
                className="w-full py-1 rounded-md text-[11px] font-medium transition-all
                  bg-gradient-to-r from-purple-800/25 via-purple-700/30 to-purple-800/25
                  border border-purple-600/25 text-purple-200/70
                  hover:from-purple-700/30 hover:via-purple-600/35 hover:to-purple-700/30
                  hover:border-purple-500/35 hover:text-purple-100
                  disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {isGenerating ? '生成中...' : '✨ 生成幻象'}
              </button>
            </div>
          )}

          {/* Library mode */}
          {mode === 'library' && !imageUrl && (
            <div>
              {libraryImages.length === 0 ? (
                <p className="text-[10px] text-purple-400/40 text-center py-3">
                  暂无历史幻象图片
                </p>
              ) : (
                <div className="grid grid-cols-4 gap-1.5 max-h-28 overflow-y-auto">
                  {libraryImages.map(img => (
                    <button
                      key={img.id}
                      onClick={() => onImageChange(img.url)}
                      className="aspect-square rounded-md overflow-hidden border border-purple-700/20
                        hover:border-purple-500/40 transition-all hover:shadow-[0_0_8px_rgba(168,85,247,0.2)]"
                      title={img.name}
                    >
                      <img src={img.url} alt={img.name} className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Preview — shown when image is selected/generated */}
          {imageUrl && (
            <div className="flex items-start gap-2.5">
              <div className="w-20 h-20 flex-shrink-0 rounded-lg overflow-hidden border border-purple-500/30
                shadow-[0_0_12px_rgba(168,85,247,0.15)]">
                <img src={imageUrl} alt="幻象预览" className="w-full h-full object-cover" />
              </div>
              <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                <p className="text-[10px] text-purple-300/60 truncate">
                  {description || '已选择幻象图片'}
                </p>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => {
                      onImageChange(null)
                      onModeChange('generate')
                    }}
                    className="px-2 py-1 rounded text-[10px] text-purple-300/60 border border-purple-700/20
                      hover:border-purple-500/30 hover:text-purple-200/80 transition-all"
                  >
                    🔄 重新选择
                  </button>
                  <button
                    onClick={() => onImageChange(null)}
                    className="px-2 py-1 rounded text-[10px] text-red-400/50 border border-red-700/20
                      hover:border-red-500/30 hover:text-red-300/70 transition-all"
                  >
                    清除
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
        )}
      </div>
    </div>
  )
}

const AREA_SHAPE_NAMES: Record<string, string> = {
  sphere: '球形', cone: '锥形', cube: '立方', line: '线形', cylinder: '柱形',
}

/** Area size slider for spells with sizeIsMax */
export function AreaSizeSelector({ maxSize, areaType, selectedSize, onChange }: {
  maxSize: number; areaType: string; selectedSize: number; onChange: (v: number) => void
}) {
  const shapeName = AREA_SHAPE_NAMES[areaType] || areaType
  const minSize = 5
  const steps = Math.max(1, (maxSize - minSize) / 5)
  return (
    <div className="mb-2 px-2 py-1.5 rounded-lg border border-amber-800/20 bg-amber-900/10">
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-amber-400/60 whitespace-nowrap">📐 区域大小</span>
        <input
          type="range"
          min={minSize}
          max={maxSize}
          step={5}
          value={selectedSize}
          onChange={e => onChange(Number(e.target.value))}
          className="flex-1 h-1.5 rounded-full appearance-none cursor-pointer
            bg-amber-900/30 accent-amber-500
            [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5
            [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-amber-400
            [&::-webkit-slider-thumb]:shadow-[0_0_6px_rgba(180,140,50,0.4)]"
        />
        <span className="text-xs font-bold text-amber-300 whitespace-nowrap">{selectedSize}尺{shapeName}</span>
      </div>
    </div>
  )
}

/** 物品图标（有 iconPath 显示图片，否则 fallback 文字） */
function ItemIcon({ icon, size = 18, fallback }: { icon: string | null; size?: number; fallback?: string }) {
  if (icon) {
    return (
      <img src={icon} alt="" className="flex-shrink-0 rounded object-cover"
        style={{ width: size, height: size }}
        onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
      />
    )
  }
  return <span className="flex-shrink-0 opacity-50" style={{ fontSize: size * 0.7 }}>{fallback || '?'}</span>
}

/** 材料槽位组件 */
function MaterialSlot({
  selectedItem, materialMissing, isConsumed, isOpen, onClick,
}: {
  selectedItem: EquipmentItem | null
  materialMissing: boolean
  isConsumed: boolean
  isOpen: boolean
  onClick: () => void
}) {
  const isEmpty = !selectedItem
  const isPouch = selectedItem?.id === 'component_pouch'
  const icon = selectedItem ? getIconPath(selectedItem) : null

  if (materialMissing) {
    return (
      <div className="w-12 h-12 rounded-lg border border-dashed border-red-500/40
        bg-red-900/15 flex flex-col items-center justify-center cursor-not-allowed"
        title="背包中缺少所需材料"
      >
        <span className="text-[10px] text-red-400/50">M</span>
        <span className="text-[8px] text-red-400/60 leading-none mt-0.5">缺少</span>
      </div>
    )
  }

  if (isEmpty) {
    return (
      <button
        onClick={onClick}
        className={`w-12 h-12 rounded-lg border border-dashed transition-all
          flex flex-col items-center justify-center
          ${isOpen
            ? 'border-amber-400/50 bg-amber-900/25'
            : 'border-amber-600/30 bg-amber-900/10 hover:border-amber-500/40 hover:bg-amber-900/20'
          }`}
        title="点击选择材料"
      >
        <span className="text-[11px] text-amber-400/40 font-medium">M</span>
        <span className="text-[8px] text-amber-400/50 leading-none mt-0.5">放入</span>
      </button>
    )
  }

  return (
    <button
      onClick={onClick}
      className={`w-12 h-12 rounded-lg border transition-all relative
        flex flex-col items-center justify-center overflow-hidden
        ${isOpen
          ? 'border-amber-400/50 bg-amber-800/30'
          : 'border-amber-600/40 bg-amber-900/20 hover:border-amber-500/40'
        }`}
      title={selectedItem.name}
    >
      {icon ? (
        <img src={icon} alt="" className="w-7 h-7 rounded object-cover"
          onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
        />
      ) : (
        <span className="text-[10px] text-amber-300/60 font-medium leading-tight text-center px-0.5 truncate max-w-full">
          {isPouch ? '材料包' : (selectedItem.name?.replace(/\(\d+gp\)$/, '') || '').slice(0, 4)}
        </span>
      )}
      <span className="text-[7px] text-amber-300/50 leading-none mt-0.5 px-0.5 truncate max-w-full">
        {isPouch ? '材料包' : (selectedItem.name?.replace(/\(\d+gp\)$/, '') || '').slice(0, 3)}
      </span>
      {/* 消耗型红点 */}
      {isConsumed && !isPouch && (
        <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-red-500/80" />
      )}
    </button>
  )
}
