# Wave-5 Combat-Trigger QA — Results & Fixes (2026-05-31)

Four agents tested the in-combat TIME/TRIGGER mechanics (the spell-runtime
engine's core) that the prior waves' out-of-combat single casts never exercised.
Unlocked by two new QA helpers: `/api/qa/start-combat` (creates the canonical
combat row → `in_combat` true) and `/api/qa/next-turn` (advances the active
combatant, firing the same turn-trigger hook as the storage PUT route).

## Coverage by trigger type

| Agent | Trigger | Result |
|---|---|---|
| On-hit riders | `/combat/attack` | 2 PASS (hex, divine_favor), 10 DEFERRED (by-design) |
| Turn (start/end) | `next-turn` | 1 PASS (heroism), 8 DEFERRED |
| Zones / escape | `/combat/zone-spell-settle`, escape/condition-save | 6 PASS, **3 real bugs** |
| Concentration / reactions | `/tokens/{id}/hp`, `/combat/reaction` | 4 PASS, **3 real bugs (2 fixable)** |

## Fixed + verified (committed)

1. **shield_spell + ALL defense reactions broken** — `NameError: 'ChatMessage' is
   not defined` (`combat.py:1846`, latent at 2187). ChatMessage was never imported.
   Added the import.
2. **Concentration CON-save bonus dropped on `/spells/cast`** — the check rolled
   `d20+0` instead of `d20+CON(+War Caster)` because `/spells/cast` set
   `concentration_spell` without `con_save_bonus`/`has_advantage`. Now computes them
   like `/combat/spell`. Verified: caster bonus 0→3.
3. **Zone-settle corrupted monster MAX HP** (`combat.py:4662`) — wrote
   `monster.hit_points` (max-HP column) to current HP; a monster zeroed by a zone
   spell had max HP permanently set to 0 (could never heal/reset). Now writes
   `current_hp`. Verified: hit_points stays 25, current_hp drops.
4. **condition-save always used DC 10** (`combat.py:5591`) — read `saveDc`/`save_dc`
   (never populated); the DC is stored as `spell_save_dc`. Added to the fallback.
5. **escape-attempt ignored `str_or_dex`** (`combat.py:5824`) — Evard's Black
   Tentacles escaped at +0; now picks the better of STR/DEX.

## Verified WORKING (no fix)
- hex/divine_favor on-hit riders fire (+1d6 necrotic / +1d4 radiant).
- heroism start-of-turn temp HP fires once per turn, re-fires each round, no stacking.
- Concentration BREAK on damage (big dmg → always breaks; small → mix); hex rider
  stops after break.
- Reactions: hellish_rebuke (2d10 fire), counterspell (interrupts long-cast),
  absorb_elements, feather_fall — all resolve.
- Zone settle gates saves correctly (fail→effect, success→none/half) for grease, web,
  entangle, sleet_storm, stinking_cloud, evards, cloud_of_daggers, spike_growth,
  moonbeam (half-on-success is correct RAW). condition-save removes conditions.

## Flagged (architectural / spawned)
- **on_take_damage retaliation never fires** (Armor of Agathys cold, fire_shield):
  the trigger is in SUPPORTED_RUNTIME_TRIGGERS but **no code dispatches it**; temp HP
  works, retaliation doesn't. Spawned as a task.
- **Smite/hunters_mark on-hit riders deferred** (10 spells): only hex/bless/divine_favor
  are v2 runtime; smites' on_hit uses legacy verbs the bonus-damage path doesn't
  consume — Stage 12 migration intentionally deferred per `docs/active-plans/spell-runtime-engine.md`.
- **moonbeam/spirit_guardians/cloud_of_daggers/aura repeats** are zone/aura/granted-action
  driven, not `next-turn` triggers — v1 gaps (granted actions not materialized on v1).

## QA-harness limitation noted (not a product bug, but skews these tests)
- The zone-settle / condition-save / escape save paths read monster save modifiers
  only from `monster_data.saving_throws` (empty for the QA goblins) — they ignore the
  seeded `ability_scores`. So `低豁免目标`/`高豁免目标` don't differentiate at the
  settle layer (both roll d20+0 vs DC). And forced-roll (`qa_randint`) only affects
  the resolver's cast-time d20s, not these combat-path saves. Consider seeding
  `monster_data.saving_throws` for the low/high-save fixtures, or a fallback to
  `ability_scores`, to make these paths deterministic.

## Net
Combat-trigger mechanics are now covered. The engine's wired paths (v2 riders,
legacy turn ongoing, concentration break, zone save-gating, reactions) work
correctly; this wave fixed 5 real bugs (a hard crash on all defense reactions, a
RAW-incorrect concentration check, a monster-HP-corrupting zone bug, a wrong save
DC, and a wrong escape modifier). Remaining gaps are documented v1 deferrals
(smite/granted-action migration, on_take_damage dispatch).
