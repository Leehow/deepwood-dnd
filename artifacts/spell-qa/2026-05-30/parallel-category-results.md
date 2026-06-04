# Parallel Category QA — Results & Consolidated Fixes (2026-05-30)

Five isolated agents (own worktree + own backend port + own QA campaign + own
forced-roll queue) tested one spell category each via the `/api/spells/cast`
pipeline, self-fixing bugs in their worktree. Results consolidated onto
`feat/spell-qa-harness`.

## Category results

| Category | Agent port | Spells | Result |
|---|---|---|---|
| Direct/save damage | 8191 | firebolt, magic_missile, sacred_flame, fireball, inflict_wounds, ray_of_frost + fire-resist + poison-immune | all PASS (1 fix) |
| Healing / temp-HP | 8192 | cure_wounds, healing_word, mass_cure_wounds, false_life, armor_of_agathys, heroism + undead/construct exclusion | all PASS (1 fix) |
| Conditions / restoration | 8193 | command, hold_person, tashas_hideous_laughter, bane, lesser_restoration + immunity | all PASS (3 fixes) |
| Buffs / concentration / runtime-v2 | 8194 | bless, hex, divine_favor, mage_armor, guidance, resistance + concentration-replace | 7/7 PASS (1 fix) |
| Control / zone / visual / movement / summon | 8195 | misty_step, grease, web, entangle, fog_cloud, invisibility, find_familiar, counterspell | 7/8 PASS, find_familiar DEFERRED |

## Real bugs found & fixed (verified end-to-end in the main checkout)

| # | Bug | Fix | Verified |
|---|---|---|---|
| 1 | Resistance/immunity seeded into `status_effects` but the cast pipeline reads `monster_data` → fire resistance / poison immunity / condition immunity never applied | `arena_service._build_monster_data` mirrors flags onto `monster_data` | firebolt vs 抗火目标 halved; cure on undead 0 heal; hold_person on immune → no paralyze |
| 2 | `reset` left `concentration_spell` + `status_effects.conditions` populated → tests contaminated across resets | `reset_arena` clears concentration/casting/transform/disguise + spell-state condition keys | concentration-replacement test passes; conditions isolated |
| 3 | **Bane wrote `+1d4`** (a bonus, *helping* the target) instead of `-1d4` — `modify_roll` ignored the `operation` field | `modifier.py`: negate the formula when `operation=="subtract"` (+`_negate_formula`) | bane save modifier value = `-1d4` ✓ |
| 4 | **cure/healing healed undead & constructs** — `excludeCreatureTypes` never read by the engine | new `creature_types.py` matcher + `spell_resolver` reads `excludeCreatureTypes` and skips matching targets + `spell_cast._build_target_info` resolves creature_type from `monster_id` | cure_wounds on 亡灵/构装 → 0 healing ✓ |

`find_familiar` DEFERRED: `spawn_summon` records a summon-intent marker but token
materialization is a separate dedicated flow (`/api/monster-instances/summon-companion`
requiring a chosen familiar form). Not a localized bug — recorded as
`DEFERRED_NOT_IMPLEMENTED`.

## Where the fixes landed

**Committed to `feat/spell-qa-harness`** (clean standalone files):
- `backend/app/services/qa/arena_service.py` — fixes #1 (seed monster_data) + #2 (reset conditions/concentration)
- `backend/app/services/effect_engine/creature_types.py` (new) + `backend/tests/unit/test_creature_type_exclusion.py` (new) — fix #4 helper + tests

**Applied & verified in the working tree, NOT committed** (these files carry the
user's uncommitted tacticalmap-phase3 refactor — 62 files total — so committing
them in isolation would create a partial/broken refactor on the branch). Recover
by re-applying these exact hunks if the working tree is ever reset:

1. `backend/app/services/effect_engine/handlers/modifier.py` — in `modify_roll` branch:
   `value = _negate_formula(p.formula) if p.operation == "subtract" else p.formula` (use `value` instead of `p.formula`), plus a `_negate_formula(formula)` helper (numeric → negate; else wrap leading `-`).
2. `backend/app/services/spell_resolver.py` — import `creature_type_matches`; in `_execute_phase` read `exclude_types = phase.get("excludeCreatureTypes") or phase.get("exclude_creature_types") or []`; at top of `for target in targets:` `if exclude_types and creature_type_matches(target.creature_type, exclude_types): append EffectResult(type="excluded", ...); continue`.
3. `backend/app/api/routes/spell_cast.py` — import `resolve_creature_type_from_monster_id`; in `_build_target_info` set `creature_type = md.get("type","") or mi.type or ""` then `if not creature_type and mi.monster_id: creature_type = resolve_creature_type_from_monster_id(mi.monster_id)`.

## Notes / leftovers
- Agent worktrees persist under `.claude/worktrees/agent-*` with their own commits (full per-agent diffs) if deeper inspection is wanted.
- Agents created dev-DB campaigns `QA-damage/healing/conditions/buffs/control` (+ a `QA Proof Arena`) — harmless QA data, can be deleted.
- misty_step works in the working tree (teleport plumbing is part of the tacticalmap changes); the control agent independently re-fixed it on the clean base.
- 58 unit tests pass (incl. 12 new creature-type + 5 forced-roll + tier handlers); no regressions.
