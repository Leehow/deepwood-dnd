# Wave-6 Upcast-Scaling QA — Results & Fixes (2026-05-31)

Three agents verified scaling correctness: extra_dice damage, extra_targets +
multi-projectile, extra_value + healing-dice + cantrip level-scaling. The
deterministic signal is the cast response's `formula_breakdown` (exposes actual
dice rolled), so dice/target/value counts are checked at base vs upcast.
(The extra_dice agent timed out; its domain was covered directly — mechanism
verified via fireball/lightning_bolt + the fix below.)

## Fixed + verified (committed)

1. **Cantrip damage stuck at 1 die at all levels** (MAJOR — every damage cantrip
   did ~1/4 damage at high level). The unified `/api/spells/cast` path used the
   deal_damage leaf's hardcoded level-1 formula and never read the spell's
   top-level `damageAtCharacterLevel` map. `SpellResolver.resolve()` now selects
   the caster-level formula for cantrips and rewrites the deal_damage leaves.
   **Verified at L20:** firebolt 1d10→**4d10**, ray_of_frost/sacred_flame→4d8,
   poison_spray→4d12. (Was previously correct only on the legacy /combat/spell path.)
2. **Magic Missile flat per-dart bonus frozen at +3** — the real cast-path scaler
   `handlers/_scaling.py:scale_formula` returned after `extra_dice`, dropping
   `extra_value`. Now applies both. **Verified:** flat scales 3/5/7 with dart count
   (slot 1/3/5). Mirror fix applied to `spell_resolver._scale_formula`.

## Verified WORKING (no fix)
- **Leveled damage dice scale correctly** (fireball 8d6@L3→10d6@L5, lightning_bolt,
  etc. — formula_breakdown shows base + scaled dice).
- **Healing dice scale**: cure_wounds 1d8→3d8, healing_word, mass_cure_wounds,
  mass_healing_word, prayer_of_healing, heal flat +10/slot — all correct.
- **extra_value**: false_life temp HP +5/slot, aid heal +5/slot, heal +10/slot — correct.
- **magic_missile dart count** 3→5→7 by slot (dice).

## Flagged (modeling gaps / spawned task)
- **eldritch_blast** fires 1 beam at all levels (RAW: 2/3/4 beams by character
  level, each its own attack). No beam-count modeling.
- **scorching_ray** fires 1 ray under one attack roll (RAW: 3 rays at slot 2,
  +1/slot, each its own attack). Upcast adds dice not rays. ~1/3 damage + single
  d20 governs all.
- **aid max-HP bonus doesn't upcast-scale** while its heal does — ModifierHandler
  stores the value raw and never calls scale_formula.
  (All three spawned as one follow-up task.)

## Architecture note (by-design, not a bug)
- **The backend does NOT enforce slot-based target count.** It applies a phase to
  whatever `target_token_ids` the caller passes — `scaling.extra_targets` is a
  declared-but-unconsumed schema field. Target-count scaling (e.g. hold_person +1
  target/slot, magic_missile-style) is **frontend-gated** (the UI limits how many
  targets you can pick by slot). Verified: bless/command/hold_person at base slot
  affected all 6 passed targets (no backend truncation). This is the project's
  design — the resolver is a pure "apply to these tokens" executor.

## Net
Two real correctness fixes — the cantrip one is high-impact (damage cantrips are
the most-cast spells and were doing a quarter of their damage at high level).
Leveled-spell and healing dice scaling, and extra_value, all verified correct.
Remaining gaps are multi-attack projectile modeling (eldritch_blast/scorching_ray)
and aid's max-HP, plus the by-design frontend-gated target count.
