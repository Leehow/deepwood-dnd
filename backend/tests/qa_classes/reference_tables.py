"""Independent PHB/SRD reference values for the invariant oracle.

HARDCODED on purpose — reads NO app data file. This is what lets the harness catch
*data* bugs (wrong value in classes.json / spellcasting.json), not just code bugs.
If you find yourself importing from app.utils.rules_cache here, stop: that defeats
the independence guarantee.
"""
from __future__ import annotations

HIT_DIE = {
    "barbarian": 12,
    "fighter": 10, "paladin": 10, "ranger": 10,
    "bard": 8, "cleric": 8, "druid": 8, "monk": 8, "rogue": 8, "warlock": 8,
    "sorcerer": 6, "wizard": 6,
}

FULL_CASTERS = {"bard", "cleric", "druid", "sorcerer", "wizard"}
HALF_CASTERS = {"paladin", "ranger"}  # spells start at L2


def proficiency_bonus(total_level: int) -> int:
    return 2 + (total_level - 1) // 4


# FULL_CASTER_SLOTS[caster_level] = [_, L1, L2, ..., L9]  (index 0 unused)
# PHB p.201 full-caster table.
FULL_CASTER_SLOTS = {
    1:  [0, 2, 0, 0, 0, 0, 0, 0, 0, 0],
    2:  [0, 3, 0, 0, 0, 0, 0, 0, 0, 0],
    3:  [0, 4, 2, 0, 0, 0, 0, 0, 0, 0],
    4:  [0, 4, 3, 0, 0, 0, 0, 0, 0, 0],
    5:  [0, 4, 3, 2, 0, 0, 0, 0, 0, 0],
    6:  [0, 4, 3, 3, 0, 0, 0, 0, 0, 0],
    7:  [0, 4, 3, 3, 1, 0, 0, 0, 0, 0],
    8:  [0, 4, 3, 3, 2, 0, 0, 0, 0, 0],
    9:  [0, 4, 3, 3, 3, 1, 0, 0, 0, 0],
    10: [0, 4, 3, 3, 3, 2, 0, 0, 0, 0],
    11: [0, 4, 3, 3, 3, 2, 1, 0, 0, 0],
    12: [0, 4, 3, 3, 3, 2, 1, 0, 0, 0],
    13: [0, 4, 3, 3, 3, 2, 1, 1, 0, 0],
    14: [0, 4, 3, 3, 3, 2, 1, 1, 0, 0],
    15: [0, 4, 3, 3, 3, 2, 1, 1, 1, 0],
    16: [0, 4, 3, 3, 3, 2, 1, 1, 1, 0],
    17: [0, 4, 3, 3, 3, 2, 1, 1, 1, 1],
    18: [0, 4, 3, 3, 3, 3, 1, 1, 1, 1],
    19: [0, 4, 3, 3, 3, 3, 2, 1, 1, 1],
    20: [0, 4, 3, 3, 3, 3, 2, 2, 1, 1],
}

# WARLOCK_PACT[warlock_level] = (slot_level, slot_count)  (pact magic, PHB p.107)
WARLOCK_PACT = {
    1: (1, 1), 2: (1, 2), 3: (2, 2), 4: (2, 2), 5: (3, 2), 6: (3, 2),
    7: (4, 2), 8: (4, 2), 9: (5, 2), 10: (5, 2), 11: (5, 3), 12: (5, 3),
    13: (5, 3), 14: (5, 3), 15: (5, 3), 16: (5, 3), 17: (5, 4), 18: (5, 4),
    19: (5, 4), 20: (5, 4),
}


def _avg_die(hit_die: int) -> int:
    return (hit_die // 2) + 1


def single_class_max_hp(class_id: str, level: int, con_mod: int) -> int:
    die = HIT_DIE[class_id]
    hp = die + con_mod                                    # level 1: max die
    if level > 1:
        hp += (_avg_die(die) + con_mod) * (level - 1)    # later levels: average
    return max(hp, level)


def multiclass_max_hp(entries: list[tuple[str, int]], con_mod: int) -> int:
    """5e RAW: ONLY the very first class level (character level 1) gets the max die.
    Every other level — including the first level of a secondary class — uses average.
    `entries` is ordered [(class_id, class_level), ...] with the first entry being the
    class taken at character level 1."""
    hp = 0
    total_level = sum(lvl for _, lvl in entries)
    for idx, (class_id, class_level) in enumerate(entries):
        die = HIT_DIE[class_id]
        levels_at_avg = class_level
        if idx == 0:
            hp += die + con_mod          # the one and only max-die level
            levels_at_avg = class_level - 1
        hp += (_avg_die(die) + con_mod) * levels_at_avg
    return max(hp, total_level)
