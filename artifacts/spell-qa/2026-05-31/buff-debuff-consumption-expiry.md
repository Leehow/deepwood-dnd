# Buff/Debuff QA — temporary 增减益 (2026-05-31)

Question under test: *do buff/debuff spells actually produce **temporary** modifiers that
(a) get **consumed** by the rolls they target, and (b) **expire**?*

Driven against the campaign-8 QA arena with the forced-roll seam (d20 pinned so only
the spell modifier varies) + a faithful expiry-sweep script
(`scripts/qa_buff_expiry_check.py`, which calls the exact functions the WS
`time_handler` invokes).

## Result: works — after fixing one real bug

### Consumption (does the modifier reach the roll?)

Attack roll, d20 pinned, attacker baseline modifier = **+9** (STR +3, prof +6):

| Cast | Modifier observed | Implied spell die | Verdict |
|---|---|---|---|
| baseline | 9, 9 | — | constant |
| **Bless** (+1d4 buff) | 11, 10, 12 | +2, +1, +3 | applied ✓ |
| **Bane** (−1d4 debuff) | 7, 6, 5 | −2, −3, −4 | applied ✓ *(after BUG-W7-01 fix)* |

Both move the roll within the ±1d4 range. Saving throws were already correct.

Ability check (STR, mod +3), **Guidance** (+1d4):

| Cast | applied to total | reason shown | Verdict |
|---|---|---|---|
| no guidance | +0 | — | constant |
| Guidance | +2, +1, +3 | `神导术: +1d4(2/1/3)` | applied ✓ *(after BUG-W7-02 fix)*; value now matches reason |

| Modifier target | path | before | after |
|---|---|---|---|
| attack_roll | `combat.py perform_attack` | legacy dropped | **fixed** |
| saving_throw | `combat.py` save path | already merged | ok |
| ability_check | `combat_check_usecase_service` | numeric bonus dropped (reason shown, not added) | **fixed** |
| AC (`incoming_attack`) | caller-provided `request.target.ac` | frontend-computed (not backend) | unchanged — see note |

### Expiration (is it temporary?)

| Storage path | Mechanism | Test | Verdict |
|---|---|---|---|
| v2 runtime (bless/hex) | world-time ≥ `expires_at` → instance `status='ended'` | advance clock +30 min | EXPIRED ✓ |
| legacy `active_effects` | world-time ≥ `expires_at`, or round `duration`→0 | advance clock +30 min | EXPIRED ✓ |

Both sweeps are wired into `time_handler` (`cleanup_expired_runtime_instances`,
`cleanup_campaign_effect_durations`, `cleanup_expired_concentration_for_campaign`).
Note: a **concentration** spell cast *out of combat* gets no `duration_rounds`/`expires_at`
— it is concentration-gated (ends when the caster loses concentration), which is correct 5E.

## Bug found + fixed (BUG-W7-01)

**Legacy `active_effects.modifiers` attack-roll bonuses were silently dropped.**

`combat.py perform_attack` summed spell attack-roll bonuses **only** from the v2 runtime
envelope (`attacker_runtime_modifier_effects`). The attacker's legacy
`active_effects.modifiers` was read but fed **only** into the advantage/disadvantage
check — never summed as a numeric bonus. So a v2-runtime buff (Bless) applied, but any
legacy `modify_roll` buff/debuff (**Bane** and every other non-runtime modifier spell)
was written to the token yet never reached the attack roll.

The **saving-throw** path already merged `base_active_effects + runtime_save_effects`.
Fix makes the attack path symmetric:

```python
base_attacker_effects = list(attacker_token.active_effects or []) if attacker_token else []
if base_attacker_effects or attacker_runtime_modifier_effects:
    runtime_atk_mods = get_modifiers_for_target(
        base_attacker_effects + attacker_runtime_modifier_effects, "attack_roll")
```

No double-count: v2 spells store no attack-roll bonus in `active_effects.modifiers`
(Bless's legacy entry is `modifiers: None`), so the two lists are disjoint for
attack-roll bonuses.

- Fix: `backend/app/api/routes/combat.py`
- Regression test: `backend/tests/unit/test_buff_debuff_modifier_consumption.py`
- Verified: 91 existing combat/spell tests still pass.

## Bug found + fixed (BUG-W7-02)

**Guidance's +1d4 ability-check bonus was surfaced but never added.** The
ability-check path (`combat_check_usecase_service._build_check_roll`) merged
legacy+runtime effects for adv/disadv, and the `+1d4` even appeared in the
result's `reasons` (`神导术: +1d4(2)`) — but `total = d20 + check_mod +
inspiration_value` had no term for it, so the player was *told* "+2" and it was
silently dropped (roll 19 + mod 3 = 22, not 24).

Fix evaluates the bonus **once** inside `check_advantage_on_ability_check`
(so the rolled value matches its reason string) and exposes it as `bonus`;
`_build_check_roll` adds it to the total. After fix: applied +2/+1/+3 exactly
matched `+1d4(2/1/3)`.

- Fix: `backend/app/utils/ability_checks.py`, `backend/app/services/combat_check_usecase_service.py`
- Also fixed a **pre-existing** test breakage (unrelated to buffs): the contest
  test's `DummySession` lacked `execute`, which the tacticalmap runtime-merge
  (already in HEAD) now calls — stubbed the runtime loader in that test.

## AC buffs — different mechanism (not a bug, noted)

Defensive AC buffs (shield_of_faith +2, mage_armor, barkskin) are **not** applied
backend-side: `perform_attack` trusts `request.target.ac`, and
`check_advantage_against_target` reads `incoming_attack` only for adv/disadv, not
numeric AC. So whether an AC buff makes a token harder to hit depends on the
**frontend** folding `active_effects` AC modifiers into the AC it sends. Verifying
that end-to-end needs a frontend test (out of scope for this backend wave).

## Minor follow-up (cosmetic, not fixed)

`evaluate("-1d4")` returns the correct total (uniform −1..−4 over 2000 rolls) but its
`.breakdown` **string** renders as e.g. `'1d4(3)-6'` (computes `-(die)` as `die − 2·die`).
Misleading if ever surfaced in a "reason" line; magnitude is correct.
Lives in `app/utils/dice_formula`.
