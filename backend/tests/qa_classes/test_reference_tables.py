from tests.qa_classes import reference_tables as ref


def test_proficiency_bonus_by_total_level():
    assert ref.proficiency_bonus(1) == 2
    assert ref.proficiency_bonus(4) == 2
    assert ref.proficiency_bonus(5) == 3
    assert ref.proficiency_bonus(20) == 6


def test_hit_die():
    assert ref.HIT_DIE["barbarian"] == 12
    assert ref.HIT_DIE["wizard"] == 6
    assert ref.HIT_DIE["fighter"] == 10


def test_full_caster_slots():
    assert ref.FULL_CASTER_SLOTS[1][1] == 2
    assert ref.FULL_CASTER_SLOTS[5][3] == 2   # L5 full caster: two 3rd-level slots
    assert ref.FULL_CASTER_SLOTS[20][9] == 1  # L20: one 9th-level slot


def test_single_class_max_hp_average_rule():
    # fighter (d10), con +2, level 3: 10+2  +  (6+2)*2  = 12 + 16 = 28
    assert ref.single_class_max_hp("fighter", level=3, con_mod=2) == 28
    assert ref.single_class_max_hp("wizard", level=1, con_mod=0) == 6


def test_multiclass_max_hp_5e_rule_only_first_level_gets_max_die():
    # Fighter 1 / Wizard 1, con +2 (5e RAW): 10(max) + (6//2+1=4 avg) + 2*2 con = 18
    assert ref.multiclass_max_hp([("fighter", 1), ("wizard", 1)], con_mod=2) == 18
