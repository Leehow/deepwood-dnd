"""Regression: temporary buff/debuff modifiers must be CONSUMED by rolls.

Covers the bug where the combat attack path summed spell attack-roll bonuses
only from the v2 runtime envelope and silently dropped legacy
``active_effects.modifiers`` (e.g. Bane's ``-1d4``). The saving-throw path
already merged both lists; the attack path now mirrors it. These tests pin the
underlying contract: ``get_modifiers_for_target`` evaluates legacy *and* runtime
modifier entries — including negative (debuff) dice formulas — and a merged list
applies both at once.
"""
from app.services.effect_service import get_modifiers_for_target
from app.utils.ability_checks import check_advantage_on_ability_check

# Bane writes a legacy active_effects entry (ModifierHandler), penalising both
# attack rolls and saving throws by -1d4.
BANE_LEGACY = {
    "id": "bane_buff",
    "name": "Bane",
    "spell_id": "bane",
    "modifiers": [
        {"target": "attack_roll", "type": "bonus", "value": "-1d4"},
        {"target": "saving_throw", "type": "bonus", "value": "-1d4"},
    ],
}

# Bless contributes a +1d4 attack-roll bonus through the runtime envelope, which
# get_modifiers_for_target consumes via the same inline-modifier fallback.
BLESS_RUNTIME = {
    "id": "bless_runtime",
    "name": "Bless",
    "spell_id": "bless",
    "modifiers": [
        {"target": "attack_roll", "type": "bonus", "value": "1d4"},
    ],
}


def test_bane_debuff_reduces_attack_roll():
    """A legacy -1d4 debuff yields a negative attack bonus in [-4, -1]."""
    for _ in range(50):
        res = get_modifiers_for_target([BANE_LEGACY], "attack_roll")
        assert res["bonuses"], "bane attack debuff was dropped (the original bug)"
        total = sum(res["bonuses"])
        assert -4 <= total <= -1, f"-1d4 out of range: {total}"


def test_bane_debuff_reduces_saving_throw():
    """Bane also penalises saving throws (the save path already merged this)."""
    for _ in range(50):
        res = get_modifiers_for_target([BANE_LEGACY], "saving_throw", {"ability": "con"})
        assert res["bonuses"], "bane save debuff was dropped"
        assert -4 <= sum(res["bonuses"]) <= -1


def test_bless_buff_increases_attack_roll():
    """A +1d4 buff yields a positive attack bonus in [1, 4]."""
    for _ in range(50):
        res = get_modifiers_for_target([BLESS_RUNTIME], "attack_roll")
        assert res["bonuses"]
        assert 1 <= sum(res["bonuses"]) <= 4


def test_merged_legacy_plus_runtime_applies_both():
    """The attack path merges legacy + runtime — both modifiers must apply.

    This is the exact list shape combat.py now feeds get_modifiers_for_target:
    base_attacker_effects (legacy Bane) + attacker_runtime_modifier_effects
    (runtime Bless). Net must equal bane(-) + bless(+), never just one.
    """
    for _ in range(50):
        merged = get_modifiers_for_target([BANE_LEGACY, BLESS_RUNTIME], "attack_roll")
        bonuses = merged["bonuses"]
        assert len(bonuses) == 2, f"expected both modifiers, got {bonuses}"
        bane_part = min(bonuses)   # negative
        bless_part = max(bonuses)  # positive
        assert -4 <= bane_part <= -1
        assert 1 <= bless_part <= 4
        assert sum(bonuses) == bane_part + bless_part


# Guidance writes a legacy +1d4 ability-check modifier; the check path surfaced
# its reason but never added the number to the total (BUG-W7-02).
GUIDANCE_LEGACY = {
    "id": "guidance_buff",
    "name": "Guidance",
    "spell_id": "guidance",
    "modifiers": [
        {"target": "ability_check", "type": "bonus", "value": "1d4"},
    ],
}


def test_guidance_bonus_is_returned_for_ability_check():
    """check_advantage_on_ability_check must expose the numeric +1d4 so the
    check total includes it (the value matches the reason, single roll)."""
    for _ in range(50):
        res = check_advantage_on_ability_check(
            ability="strength", active_effects=[GUIDANCE_LEGACY])
        assert "bonus" in res, "ability-check helper must expose numeric bonus"
        assert 1 <= res["bonus"] <= 4
        # The reason string's rolled value must equal the applied bonus.
        guidance_reasons = [r for r in res["reasons"] if "神导术" in r or "Guidance" in r]
        assert guidance_reasons, "guidance reason should be present"
        assert f"({res['bonus']})" in guidance_reasons[0]


def test_no_ability_check_buff_yields_zero_bonus():
    res = check_advantage_on_ability_check(ability="strength", active_effects=[])
    assert res.get("bonus", 0) == 0


def test_runtime_only_omits_legacy_debuff_was_the_bug():
    """Document the regression: evaluating ONLY the runtime list (the old attack
    code) loses Bane entirely — proving why both lists must be merged."""
    runtime_only = get_modifiers_for_target([BLESS_RUNTIME], "attack_roll")
    assert all(b > 0 for b in runtime_only["bonuses"]), (
        "runtime-only list must not contain the legacy bane penalty"
    )
