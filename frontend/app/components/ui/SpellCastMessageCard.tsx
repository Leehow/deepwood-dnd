/**
 * SpellCastMessageCard — 法术施放聊天消息卡片。
 *
 * 从 meta.spellCastData 渲染结构化的施法结果卡片，
 * 替代之前的纯 emoji 文本。
 */

interface EffectResultEntry {
  type?: string
  target_name?: string
  target_token_id?: number
  damage_dealt?: number
  healing_done?: number
  temp_hp_granted?: number
  condition_applied?: string
  condition_immune?: boolean
  attack_rolled?: boolean
  attack_hit?: boolean
  attack_roll?: number
  attack_total?: number
  critical_hit?: boolean
  save_rolled?: boolean
  save_succeeded?: boolean
  save_total?: number
  save_dc?: number
  formula_breakdown?: string
  description?: string
  conditions_removed?: string[]
}

export interface SpellCastData {
  spellName: string
  slotLevel: number
  casterName?: string
  spellId?: string
  casterTokenId?: number
  results: EffectResultEntry[]
  totalDamage: number
  totalHealing: number
  concentrationSet: boolean
  durationHint?: string
}

export function SpellCastMessageCard({ data }: { data: SpellCastData }) {
  const { spellName, slotLevel, results, totalDamage, totalHealing, concentrationSet, durationHint } = data

  // Group results by target for cleaner display
  const targetGroups = new Map<string, EffectResultEntry[]>()
  const generalEffects: EffectResultEntry[] = []

  for (const er of results) {
    if (er.target_name && er.target_token_id) {
      const key = `${er.target_token_id}`
      if (!targetGroups.has(key)) targetGroups.set(key, [])
      targetGroups.get(key)!.push(er)
    } else {
      generalEffects.push(er)
    }
  }

  return (
    <div className="rounded-lg border border-purple-500/30 bg-purple-950/20 overflow-hidden">
      {/* Header */}
      <div className="px-3 py-1.5 bg-purple-900/30 border-b border-purple-500/20 flex items-center gap-2">
        <span className="text-purple-300 text-base">✦</span>
        <span className="font-semibold text-purple-200 text-sm">
          {slotLevel === 0 ? `${spellName}` : `${spellName}`}
        </span>
        {slotLevel > 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
            {slotLevel}环
          </span>
        )}
        {slotLevel === 0 && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-500/20 text-gray-400 border border-gray-500/30">
            戏法
          </span>
        )}
        {concentrationSet && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30">
            专注
          </span>
        )}
      </div>

      {/* Results by target */}
      <div className="px-3 py-2 space-y-1.5 text-sm">
        {[...targetGroups.entries()].map(([key, entries]) => {
          const targetName = entries[0].target_name
          return (
            <TargetResultBlock key={key} targetName={targetName!} entries={entries} />
          )
        })}

        {/* General effects (no specific target) */}
        {generalEffects.map((er, i) => (
          <EffectLine key={`gen-${i}`} er={er} />
        ))}

        {/* Duration */}
        {durationHint && (
          <div className="text-xs text-gray-400 mt-1">
            ⏳ {durationHint}
          </div>
        )}

        {/* Summary totals */}
        {(totalDamage > 0 || totalHealing > 0) && targetGroups.size > 1 && (
          <div className="text-xs text-gray-500 border-t border-gray-700/50 pt-1 mt-1 flex gap-3">
            {totalDamage > 0 && <span>总伤害: {totalDamage}</span>}
            {totalHealing > 0 && <span>总治疗: {totalHealing}</span>}
          </div>
        )}
      </div>
    </div>
  )
}

function TargetResultBlock({ targetName, entries }: { targetName: string; entries: EffectResultEntry[] }) {
  // Deduplicate attack/save display
  let attackShown = false
  let saveShown = false

  return (
    <div className="space-y-0.5">
      {entries.map((er, i) => {
        const lines: JSX.Element[] = []

        // Attack roll (once per target)
        if (er.attack_rolled && !attackShown) {
          attackShown = true
          const roll = er.attack_roll ?? '?'
          const total = er.attack_total ?? '?'
          if (er.critical_hit) {
            lines.push(<span key="atk" className="text-yellow-400">🎯 暴击! ({roll}→{total})</span>)
          } else if (er.attack_hit) {
            lines.push(<span key="atk" className="text-green-400">🎯 命中 ({roll}→{total})</span>)
          } else {
            lines.push(<span key="atk" className="text-gray-500">❌ 未命中 ({roll}→{total})</span>)
          }
        }

        // Save (once per target)
        if (er.save_rolled && !saveShown) {
          saveShown = true
          const dc = er.save_dc ?? '?'
          const total = er.save_total ?? '?'
          lines.push(
            er.save_succeeded
              ? <span key="sav" className="text-green-400">🛡️ 豁免成功 ({total} vs DC{dc})</span>
              : <span key="sav" className="text-red-400">💥 豁免失败 ({total} vs DC{dc})</span>
          )
        }

        // Damage
        if (er.damage_dealt && er.damage_dealt > 0) {
          const fb = er.formula_breakdown ? ` [${er.formula_breakdown}]` : ''
          lines.push(
            <span key="dmg" className="text-red-300">
              ⚔️ {targetName} 受到 <strong>{er.damage_dealt}</strong> 点伤害{fb}
            </span>
          )
        }

        // Healing
        if (er.healing_done && er.healing_done > 0) {
          lines.push(
            <span key="heal" className="text-green-300">
              💚 {targetName} 恢复 <strong>{er.healing_done}</strong> 点生命
            </span>
          )
        }

        // Temp HP
        if (er.temp_hp_granted && er.temp_hp_granted > 0) {
          lines.push(
            <span key="tmp" className="text-blue-300">
              🛡️ {targetName} 获得 {er.temp_hp_granted} 临时HP
            </span>
          )
        }

        // Condition
        if (er.condition_applied) {
          lines.push(<span key="cond" className="text-amber-300">📌 {targetName} → {er.condition_applied}</span>)
        }
        if (er.condition_immune) {
          lines.push(<span key="immune" className="text-gray-400">🚫 {targetName} 免疫该状态</span>)
        }

        // Handler description (for new effect types)
        if (er.description && !er.damage_dealt && !er.healing_done && !er.condition_applied && !er.condition_immune && er.type !== 'narrative') {
          lines.push(<span key="desc" className="text-purple-300">✦ {er.description}</span>)
        }

        // Narrative
        if (er.type === 'narrative' && er.description) {
          const desc = er.description.length > 80 ? er.description.slice(0, 80) + '…' : er.description
          lines.push(<span key="narr" className="text-gray-400 italic">{desc}</span>)
        }

        return lines.map((line, j) => (
          <div key={`${i}-${j}`} className="leading-relaxed">{line}</div>
        ))
      })}
    </div>
  )
}

function EffectLine({ er }: { er: EffectResultEntry }) {
  if (er.description) {
    return <div className="text-purple-300">✦ {er.description}</div>
  }
  return null
}
