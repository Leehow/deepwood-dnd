"""Regression guard: a spell's visual buff must display ONLY the conditions it
actually APPLIES (via ``apply_condition`` effect entries) — never the loose
top-level ``conditions`` field, which also lists conditions the spell REMOVES,
PREVENTS, DETECTS/COUNTERS, or that belong to an invisible object/sensor rather
than the buffed creature.

Background (BUG B): the top-level ``conditions`` field was copied verbatim onto
the target's spell_buff (backend ``spell_cast.py``, frontend ``sidebarCasting.ts``).
The TacticalMap invisibility detector dims any token whose buff carries
``invisible`` to 0.55 opacity, and ``StatusEffectsDialog`` renders ``buff.conditions``
as projected condition badges. So ``lesser_restoration`` (which *cures*
blinded/paralyzed/poisoned) badged its healed target with those very conditions,
and ``clairvoyance`` / a force wall dimmed their target as if invisible.

Fix: buff conditions derive from ``apply_condition`` entries via
``derive_buff_conditions``. This file guards (a) that derivation keeps genuine
badges and drops the bogus ones, and (b) the data hygiene of the ``invisible``
condition — the highest-severity case, because it controls token dimming.
"""
import pytest

from app.utils.rules_cache import get_spells_data
from app.utils.spell_buff_conditions import derive_buff_conditions


def _spells_by_id():
    data = get_spells_data()
    spells = data["spells"] if isinstance(data, dict) and "spells" in data else data
    return {s.get("id"): s for s in spells}


SPELLS = _spells_by_id()


def _spell(spell_id: str) -> dict:
    s = SPELLS.get(spell_id)
    if s is None:
        raise AssertionError(f"spell {spell_id!r} not found in spells.json")
    return s


# ── Data hygiene: object/sensor/counter spells must not declare `invisible` ──
# Their "invisible" thing is a sensor, servant, glyph, wall, or summon — NOT the
# buffed creature — or they COUNTER/DETECT invisibility. Keeping it at top level
# risks re-introducing the dimming bug, so guard against re-adding it.
NOT_INVISIBLE = [
    # first pass — creature-targeted counters / detectors / servant
    "faerie_fire", "branding_smite", "see_invisibility", "true_seeing",
    "scrying", "unseen_servant",
    # this pass — object / zone / sensor / summon, invisible thing != creature
    "clairvoyance", "arcane_eye", "rope_trick", "glyph_of_warding",
    "wall_of_force", "forcecage", "symbol", "antimagic_field",
    "mordenkainens_faithful_hound", "mordenkainens_magnificent_mansion",
    "drawmijs_instant_summons",
]


@pytest.mark.parametrize("spell_id", NOT_INVISIBLE)
def test_object_or_counter_spell_does_not_declare_invisible(spell_id):
    s = _spell(spell_id)
    assert "invisible" not in (s.get("conditions") or []), (
        f"{spell_id} must not declare the top-level 'invisible' condition — it does "
        "not grant creature invisibility (its invisible thing is a sensor/object/"
        "summon, or it counters/detects invisibility). See BUG B."
    )


# ── Derivation EXCLUDES conditions a spell removes / prevents / detects ──
# None of these have an ``apply_condition`` for the listed condition; the spell
# CURES, grants immunity to, suppresses, or merely interacts with it.
# (spell_id, condition that must NOT appear on the buff)
WRONGLY_PROJECTED = [
    ("lesser_restoration", "paralyzed"),            # cures
    ("lesser_restoration", "blinded"),
    ("greater_restoration", "petrified"),           # cures
    ("greater_restoration", "charmed"),
    ("freedom_of_movement", "restrained"),          # immunity
    ("freedom_of_movement", "paralyzed"),
    ("protection_from_evil_and_good", "charmed"),   # prevents
    ("protection_from_evil_and_good", "frightened"),
    ("protection_from_poison", "poisoned"),         # cures / prevents
    ("mind_blank", "charmed"),                      # immunity
    ("calm_emotions", "frightened"),                # suppresses
    ("calm_emotions", "charmed"),
    ("heroes_feast", "poisoned"),                   # immunity
    ("aura_of_purity", "poisoned"),                 # prevents
    ("heroism", "frightened"),                      # immunity
    ("clairvoyance", "invisible"),                  # invisible sensor, not creature
    ("wall_of_force", "invisible"),                 # the wall is invisible
    ("faerie_fire", "invisible"),                   # counters invisibility
]


@pytest.mark.parametrize("spell_id,condition", WRONGLY_PROJECTED)
def test_derivation_excludes_non_applied_condition(spell_id, condition):
    derived = derive_buff_conditions(_spell(spell_id))
    assert condition not in derived, (
        f"{spell_id}: '{condition}' is removed/prevented/detected by the spell, not "
        f"applied — it must NOT land on the target's buff. derived={derived}"
    )


# ── Derivation KEEPS conditions a spell genuinely applies ──
# Each has an ``apply_condition`` (sequester gains one in this fix, since it grants
# invisibility via ``set_visibility`` that the map detector cannot read).
# (spell_id, condition that MUST appear on the buff)
GENUINELY_APPLIED = [
    ("hold_person", "paralyzed"),
    ("hold_monster", "paralyzed"),
    ("invisibility", "invisible"),
    ("greater_invisibility", "invisible"),
    ("mislead", "invisible"),
    ("sequester", "invisible"),
    ("fear", "frightened"),
    ("banishment", "incapacitated"),
    ("charm_person", "charmed"),
    ("entangle", "restrained"),
    ("command", "prone"),
]


@pytest.mark.parametrize("spell_id,condition", GENUINELY_APPLIED)
def test_derivation_keeps_applied_condition(spell_id, condition):
    derived = derive_buff_conditions(_spell(spell_id))
    assert condition in derived, (
        f"{spell_id}: genuinely applies '{condition}' (apply_condition) — its buff "
        f"must carry it so the badge / dimming renders. derived={derived}"
    )


def test_derive_buff_conditions_is_ordered_and_deduped():
    """Pure-function contract: ordered by first appearance, no duplicates, and the
    top-level ``conditions`` field is ignored entirely."""
    spell = {
        "conditions": ["charmed", "invisible"],  # loose tag — must be ignored
        "effects": [
            {"effects": [
                {"type": "apply_condition", "condition": "paralyzed"},
                {"type": "apply_condition", "condition": "blinded"},
                {"type": "apply_condition", "condition": "paralyzed"},  # dup
                {"type": "deal_damage", "formula": "2d6"},
            ]},
            {"effects": [{"type": "apply_condition", "condition": "blinded"}]},
        ],
    }
    assert derive_buff_conditions(spell) == ["paralyzed", "blinded"]


def test_derive_buff_conditions_empty_when_no_effects():
    assert derive_buff_conditions({"conditions": ["poisoned"]}) == []
    assert derive_buff_conditions({}) == []
