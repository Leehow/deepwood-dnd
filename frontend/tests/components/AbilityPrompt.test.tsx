/**
 * Tests for AbilityPrompt component
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AbilityPrompt, AbilityPicker } from '~/components/combat/AbilityPrompt'
import type { TriggeredFeatureDefinition, ResolvedFeatureEffects } from '~/types/triggeredFeature'

// ── Helpers ──────────────────────────────────────────

function makeFeature(overrides: Partial<TriggeredFeatureDefinition> = {}): TriggeredFeatureDefinition {
  return {
    id: 'test',
    name: '测试特性',
    nameEn: 'Test Feature',
    class: ['fighter'],
    level: 1,
    trigger: 'on_activate',
    actionType: 'bonus_action',
    cost: { resourceId: 'second_wind', amount: 1 },
    phases: [{ trigger: 'on_cast', effects: [{ type: 'heal', formula: '1d10' }] }],
    ui: { promptType: 'quick_use', icon: '💨', color: '#dc2626' },
    chat: { activate: '使用了特性' },
    ...overrides,
  }
}

function makeResolved(overrides: Partial<ResolvedFeatureEffects> = {}): ResolvedFeatureEffects {
  return {
    feature: makeFeature(),
    phases: [],
    hasMechanicalEffects: true,
    mechanicalTypes: new Set(['heal']),
    resourceCheck: { resourceId: 'second_wind', amount: 1, sufficient: true },
    chatMessages: { activate: '使用了特性' },
    resolvedDie: null,
    ...overrides,
  }
}

// ── AbilityPrompt 渲染测试 ──────────────────────────

describe('AbilityPrompt', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <AbilityPrompt
        isOpen={false}
        onClose={vi.fn()}
        feature={makeFeature()}
        resolved={makeResolved()}
        onConfirm={vi.fn()}
      />,
    )
    expect(container.innerHTML).toBe('')
  })

  it('renders feature name and icon when open', () => {
    render(
      <AbilityPrompt
        isOpen={true}
        onClose={vi.fn()}
        feature={makeFeature({ name: '回气', ui: { promptType: 'quick_use', icon: '💨', color: '#dc2626' } })}
        resolved={makeResolved()}
        onConfirm={vi.fn()}
      />,
    )
    expect(screen.getByText('回气')).toBeTruthy()
    expect(screen.getByText('💨')).toBeTruthy()
  })

  it('shows action type label', () => {
    render(
      <AbilityPrompt
        isOpen={true}
        onClose={vi.fn()}
        feature={makeFeature({ actionType: 'reaction' })}
        resolved={makeResolved()}
        onConfirm={vi.fn()}
      />,
    )
    expect(screen.getByText('反应')).toBeTruthy()
  })

  it('shows chat message preview', () => {
    render(
      <AbilityPrompt
        isOpen={true}
        onClose={vi.fn()}
        feature={makeFeature()}
        resolved={makeResolved({ chatMessages: { activate: '小明回气了！' } })}
        onConfirm={vi.fn()}
      />,
    )
    expect(screen.getByText('小明回气了！')).toBeTruthy()
  })

  it('calls onConfirm when confirm button clicked', () => {
    const onConfirm = vi.fn()
    render(
      <AbilityPrompt
        isOpen={true}
        onClose={vi.fn()}
        feature={makeFeature({ name: '回气' })}
        resolved={makeResolved()}
        onConfirm={onConfirm}
      />,
    )
    fireEvent.click(screen.getByText(/使用回气/))
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('calls onClose when cancel button clicked', () => {
    const onClose = vi.fn()
    render(
      <AbilityPrompt
        isOpen={true}
        onClose={onClose}
        feature={makeFeature()}
        resolved={makeResolved()}
        onConfirm={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByText('取消'))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('shows "跳过" for reaction prompts', () => {
    render(
      <AbilityPrompt
        isOpen={true}
        onClose={vi.fn()}
        feature={makeFeature({ ui: { promptType: 'reaction_prompt', icon: '⚔️', color: '#dc2626' } })}
        resolved={makeResolved()}
        onConfirm={vi.fn()}
      />,
    )
    expect(screen.getByText('跳过')).toBeTruthy()
  })

  it('disables confirm when loading', () => {
    render(
      <AbilityPrompt
        isOpen={true}
        onClose={vi.fn()}
        feature={makeFeature()}
        resolved={makeResolved()}
        onConfirm={vi.fn()}
        loading={true}
      />,
    )
    expect(screen.getByText('执行中...')).toBeTruthy()
  })

  it('disables confirm when resources insufficient', () => {
    const onConfirm = vi.fn()
    render(
      <AbilityPrompt
        isOpen={true}
        onClose={vi.fn()}
        feature={makeFeature()}
        resolved={makeResolved({
          resourceCheck: { resourceId: 'second_wind', amount: 1, sufficient: false },
        })}
        onConfirm={onConfirm}
      />,
    )
    const btn = screen.getByText(/使用测试特性/)
    expect((btn as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(btn)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('shows result text when provided', () => {
    render(
      <AbilityPrompt
        isOpen={true}
        onClose={vi.fn()}
        feature={makeFeature()}
        resolved={makeResolved()}
        onConfirm={vi.fn()}
        resultText="恢复了 15 HP"
      />,
    )
    expect(screen.getByText('恢复了 15 HP')).toBeTruthy()
    expect(screen.getByText('关闭')).toBeTruthy()
  })

  it('shows resolved die size', () => {
    render(
      <AbilityPrompt
        isOpen={true}
        onClose={vi.fn()}
        feature={makeFeature({ name: '绊摔' })}
        resolved={makeResolved({ resolvedDie: 'd10' })}
        onConfirm={vi.fn()}
      />,
    )
    expect(screen.getByText('d10')).toBeTruthy()
    expect(screen.getByText(/使用绊摔 \(d10\)/)).toBeTruthy()
  })
})

// ── AbilityPicker 测试 ──────────────────────────────

describe('AbilityPicker', () => {
  const features = [
    makeFeature({ id: 'a', name: '震慑打击', nameEn: 'Stunning Strike', ui: { promptType: 'on_hit_confirm', icon: '👊', color: '#eab308' } }),
    makeFeature({ id: 'b', name: '神圣惩击', nameEn: 'Divine Smite', ui: { promptType: 'on_hit_confirm', icon: '✨', color: '#fbbf24' } }),
  ]

  it('renders nothing when closed', () => {
    const { container } = render(
      <AbilityPicker isOpen={false} onClose={vi.fn()} features={features} onSelect={vi.fn()} />,
    )
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing when no features', () => {
    const { container } = render(
      <AbilityPicker isOpen={true} onClose={vi.fn()} features={[]} onSelect={vi.fn()} />,
    )
    expect(container.innerHTML).toBe('')
  })

  it('renders feature list', () => {
    render(
      <AbilityPicker isOpen={true} onClose={vi.fn()} features={features} onSelect={vi.fn()} />,
    )
    expect(screen.getByText('震慑打击')).toBeTruthy()
    expect(screen.getByText('神圣惩击')).toBeTruthy()
  })

  it('calls onSelect when feature clicked', () => {
    const onSelect = vi.fn()
    render(
      <AbilityPicker isOpen={true} onClose={vi.fn()} features={features} onSelect={onSelect} />,
    )
    fireEvent.click(screen.getByText('震慑打击'))
    expect(onSelect).toHaveBeenCalledWith(features[0])
  })

  it('shows custom title', () => {
    render(
      <AbilityPicker isOpen={true} onClose={vi.fn()} features={features} onSelect={vi.fn()} title="命中后可用" />,
    )
    expect(screen.getByText('命中后可用')).toBeTruthy()
  })
})
