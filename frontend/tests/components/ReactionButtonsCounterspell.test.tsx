/**
 * ReactionButtons — Counterspell (on_spell_cast) trigger.
 *
 * V1 contract:
 * - Spell-cast chat cards expose `caster_token_id` via synthesized meta.
 * - Counterspell shows when ANOTHER token's spell-cast meta appears.
 * - It hides for the caster themselves.
 * - POST body sets `target_token_id` = source caster token id.
 * - Existing attack reactions still gate on `target_token_id === myTokenId`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ReactionButtons } from '~/components/combat/ReactionButtons';
import type { ReactionDefinition } from '~/utils/reactionRegistry';

vi.mock('~/utils/api-client', () => ({
  apiFetch: vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })),
}));
import { apiFetch } from '~/utils/api-client';

const counterspell: ReactionDefinition = {
  id: 'counterspell',
  name: '反制法术',
  icon: '🚫',
  category: 'spell',
  triggerType: 'on_spell_cast',
  triggerDesc: 'test',
  requiresSpellSlot: true,
  spellLevel: 3,
  source: 'wizard',
};

const shield: ReactionDefinition = {
  id: 'shield_spell',
  name: '护盾术',
  icon: '🛡️',
  category: 'spell',
  triggerType: 'on_hit',
  triggerDesc: 'test',
  requiresSpellSlot: true,
  spellLevel: 1,
  source: 'wizard',
};

describe('ReactionButtons — on_spell_cast (Counterspell)', () => {
  beforeEach(() => {
    (apiFetch as any).mockClear();
  });

  it('shows Counterspell for a spell cast by another token', () => {
    render(
      <ReactionButtons
        myTokenId={42}
        availableReactions={[counterspell]}
        isReactionUsed={false}
        campaignId="7"
        onReactionUsed={() => {}}
        messageMeta={{
          combat_type: 'spell',
          caster_token_id: 99,
          spell_id: 'fireball',
          spell_name: '火球术',
        }}
      />
    );
    expect(screen.getByText(/反制法术/)).toBeInTheDocument();
  });

  it('hides Counterspell when I am the caster', () => {
    const { container } = render(
      <ReactionButtons
        myTokenId={99}
        availableReactions={[counterspell]}
        isReactionUsed={false}
        campaignId="7"
        onReactionUsed={() => {}}
        messageMeta={{
          combat_type: 'spell',
          caster_token_id: 99,
          spell_id: 'fireball',
          spell_name: '火球术',
        }}
      />
    );
    expect(container.textContent || '').not.toContain('反制法术');
  });

  it('POSTs target_token_id = source caster on Counterspell click', async () => {
    render(
      <ReactionButtons
        myTokenId={42}
        availableReactions={[counterspell]}
        isReactionUsed={false}
        campaignId="7"
        onReactionUsed={() => {}}
        messageMeta={{
          combat_type: 'spell',
          caster_token_id: 99,
          spell_id: 'fireball',
          spell_name: '火球术',
        }}
      />
    );
    fireEvent.click(screen.getByText(/反制法术/));
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    const call = (apiFetch as any).mock.calls[0];
    expect(call[0]).toBe('/api/combat/reaction');
    const body = JSON.parse(call[1].body);
    expect(body.reaction_id).toBe('counterspell');
    expect(body.category).toBe('spell');
    expect(body.spell_slot_level).toBe(3);
    expect(body.target_token_id).toBe(99);
    expect(body.reactor_token_id).toBe(42);
  });

  it('Shield (on_hit attack reaction) still requires target_token_id === myTokenId', () => {
    // Attacker hits a different token → Shield must NOT appear for me
    const { container, rerender } = render(
      <ReactionButtons
        myTokenId={42}
        availableReactions={[shield]}
        isReactionUsed={false}
        campaignId="7"
        onReactionUsed={() => {}}
        messageMeta={{
          combat_type: 'attack',
          target_token_id: 7,
          attacker_token_id: 99,
          hit: true,
          is_melee: true,
        }}
      />
    );
    expect(container.textContent || '').not.toContain('护盾术');

    rerender(
      <ReactionButtons
        myTokenId={42}
        availableReactions={[shield]}
        isReactionUsed={false}
        campaignId="7"
        onReactionUsed={() => {}}
        messageMeta={{
          combat_type: 'attack',
          target_token_id: 42,
          attacker_token_id: 99,
          hit: true,
          is_melee: true,
        }}
      />
    );
    expect(screen.getByText(/护盾术/)).toBeInTheDocument();
  });
});
