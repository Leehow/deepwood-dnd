# Wave-3 Full-Catalog Smoke Sweep (2026-05-30)

Five read-only agents smoke-cast **all 364 spells** (sorted by id, split into 5
slices) against the user's real working-tree code (each on its own backend +
campaign). Goal: surface every HTTP 500 / crash on the `/api/spells/cast` path.
Agents made zero code changes; fixes applied afterward in the unified working tree.

## Coverage

| Slice | Range | Spells | 200 | 500 |
|---|---|---|---|---|
| 1 | acid_splash … contingency | 73 | 73 | 0 |
| 2 | continual_flame … fog_cloud | 73 | 72 | **1** (dispel_evil_and_good) |
| 3 | forbiddance … mass_heal | 73 | 73 | 0 |
| 4 | mass_healing_word … sending | 73 | 73 | 0 |
| 5 | sequester … zone_of_truth | 72 | 71 | **1** (turn_undead) |
| **Total** | full catalog | **364** | **362** | **2** |

**362 / 364 spells cast cleanly on the first attempt.** Only 2 server errors in
the entire catalog — both fixed and re-verified to 200.

## The 2 bugs (fixed + verified)

1. **turn_undead** → `AttributeError: 'Token' object has no attribute 'max_hp'`
   (`spell_cast.py:1773`). The Destroy Undead broadcast used `token.max_hp`, which
   is not a Token column — crashes whenever a high-level caster destroys a low-CR
   undead. Fix: resolve max HP from the monster instance for the damage-number
   broadcast (fall back to current_hp). Verified 200.
2. **dispel_evil_and_good** → `EffectValidationError: GrantActionParams action_name
   required`. Its `grant_action` effect used camelCase keys
   (actionName/actionType/actionKind/actionNameEn); with the schema's `extra="allow"`
   the camelCase keys land in the extra bucket and the required snake_case
   `action_name` is missing. Fix: convert the 4 keys to snake_case. Verified 200.

A catalog-wide rescan confirmed **no other effect leaf** uses camelCase keys
(`damageType`/`actionName`/etc.) — these were the last of that class.

## Notes (not bugs)
- Agents correctly identified smite/rider spells (armor_of_agathys, banishing/
  blinding/branding/staggering/thunderous/wrathful_smite, spike_growth) as
  0-damage-on-cast = correct (damage fires `on_hit` / on movement).
- The `grant_action`+`attack` 500s flagged in wave-2 (vampiric_touch,
  spiritual_weapon, flame_blade, mordenkainens_sword) are **resolved**: the user
  relaxed `GrantActionParams` to `extra="allow"`, so those now cast 200.
- Smoke depth: HTTP-contract level (no 500). Per-spell rules-correctness of
  outcomes was covered for ~130 spells in waves 1–2; this sweep adds full
  no-crash coverage for the remaining catalog.

## Cumulative result (3 waves)
- ~130 spells deep-tested for correctness (waves 1–2) + **all 364 smoke-tested**
  for crashes (wave 3).
- Real bugs found & fixed: resistance/immunity application, Bane direction,
  undead/construct heal exclusion, reset contamination, heal over-full/caster
  clamp, area-cast damage persistence (user), 4× camelCase data 500s
  (3 damageType + 1 grant_action), turn_undead max_hp crash.
- **The full spell catalog now casts without server errors.**
