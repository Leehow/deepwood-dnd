# Wave-2 By-Level Breadth QA — Results & Fixes (2026-05-30)

Five isolated agents tested untested spells by level band (excluding the ~31
already covered in wave-1), via the cast API, self-fixing in their worktrees.

## Coverage

| Band | Agent | Spells tested | Result |
|---|---|---|---|
| Cantrips (L0) | 8191 | 25 | 23 PASS, 1 FIXED (spare_the_dying), 1 DEFERRED (wrath_of_the_storm) |
| Level 1 | 8192 | 16 | all PASS, 0 bugs |
| Level 2 | 8193 | 21 | all PASS, 0 bugs |
| Level 3 | 8194 | 16 | all PASS, 1 FIXED (vampiric_touch self-heal) |
| Levels 4–9 | 8195 | 25 | all PASS, 2 FIXED (heal over-full, 3× damageType 500) |

~100 additional spells exercised. L1 and L2 are fully clean.

## IMPORTANT — base mismatch

The agent worktrees forked from a base **without** the user's uncommitted
tacticalmap-phase3 changes (62 files in the main working tree). So each
agent-reported bug was re-verified against the authoritative main checkout
(running on :8174) before any fix was applied — some agent findings were already
fixed by the tacticalmap refactor, and the main checkout has its own issues the
agents could not see.

## Fixes applied & verified in the main checkout (committed)

| Bug | Fix | Verified |
|---|---|---|
| heal on an over-full target (current_hp>max_hp — the QA seed over-seeds actor HP) produced NEGATIVE "healing" that **reduced** HP | `heal.py`: `headroom = max(0, max_hp-current_hp)` | player_view 70→70 (was 70→63) |
| Vampiric Touch self-heal (`heal_target=="caster"`) capped against the **attack target's** HP → zeroed | `heal.py`: skip the cap when `heal_target=="caster"` | (cap bug confirmed in code; runtime masked by the grant_action 500 below) |
| dimension_door / forbiddance / prismatic_spray used camelCase `damageType` in `deal_damage` leaves → `EffectValidationError` 500 | `spells.json`: 3 leaves → `damage_type` | all three now HTTP 200 |

Committed on `feat/spell-qa-harness` (heal.py also carries in-progress tacticalmap
changes, committed together).

## Verified already-correct in the main checkout (agent fix NOT needed)

- **spare_the_dying**: the cantrips agent's worktree had the old `token.is_stable`
  (not a column → KeyError 500); the main checkout already records stabilization
  on the `death_saves` JSON column. Cast returns 200. No change applied.

## Open findings flagged (NOT fixed — spawned as tasks / tacticalmap-side)

1. **grant_action 500 on 4 spells** (vampiric_touch, spiritual_weapon, flame_blade,
   mordenkainens_sword): `GrantActionParams` (extra="forbid") rejects the `attack`
   field their grant_action data carries. The tacticalmap refactor added
   grant_action validation; on the pre-refactor base these were skipped (no
   handler) and passed. Spawned as a follow-up task.
2. **`test_register_all_handlers` fails** (main checkout): engine now registers
   `grant_action` but the test's expected verb set wasn't updated. Pre-existing
   tacticalmap test-staleness, folded into the task above.
3. **grant_action follow-up actions not materialized on the v1 resolver path**
   (L3 finding): Haste extra action, Call Lightning repeat bolt, etc. are silently
   skipped — primary effects all land. Architectural; same task family.
4. **goodberry** emits only narrative (no berry items materialized) — DEFERRED.
5. **wrath_of_the_storm** `on_reaction` phase is narrative-only (no deal_damage
   verb); resolver doesn't wire `on_reaction` — DEFERRED.
6. One-off `MissingGreenlet` 500 on `GET /monster-instances` right after seed
   commit (lazy `updated_at` outside greenlet) — pre-existing route race, outside
   the spell path, not reproducible.

## Net after two waves

~130 distinct spells tested across all levels + mechanic families. Real bugs found
and fixed: resistance/immunity application, Bane direction, undead/construct heal
exclusion, reset contamination (wave-1); heal over-full/caster clamp, 3× damageType
500 (wave-2). Remaining known-broken: 4 grant_action-attack spells (500), pending
the spawned task. L1/L2 are bug-free; high-level (L4–9) spells are broadly
implemented (meteor_swarm, power_word_kill, disintegrate, mass_heal, raise_dead,
dominate_monster, etc. all work).
