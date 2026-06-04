from tests.qa_classes import generator as gen


def test_fighter_subclass_pairs_include_champion_at_level_3():
    pairs = list(gen.iter_class_subclass_pairs())
    fighter = [p for p in pairs if p.class_id == "fighter"]
    assert any(p.subclass_id == "champion" and p.subclass_level == 3 for p in fighter)
    # every class appears at least once
    assert {p.class_id for p in pairs} >= {
        "fighter", "wizard", "rogue", "cleric", "barbarian", "bard",
        "druid", "monk", "paladin", "ranger", "sorcerer", "warlock",
    }
    # no walk path has an empty subclass_id (would mean a class produced zero pairs)
    assert all(p.subclass_id for p in pairs)


def test_fighter_fighting_style_probe_has_six_inline_options_at_level_1():
    probes = [p for p in gen.iter_inline_option_probes()
              if p.class_id == "fighter" and p.choice_id == "fighting_style"]
    assert len(probes) == 6
    assert {p.option_id for p in probes} == {
        "archery", "defense", "dueling", "great_weapon_fighting",
        "protection", "two_weapon_fighting",
    }
    p = probes[0]
    assert p.level == 1 and p.fc_key == "fighting_style" and p.char_field == "fighting_style"


def test_choice_script_picks_first_option_and_subclass():
    script = gen.build_choice_script("fighter", "champion")
    assert script[1]["fighting_style"] == "archery"   # first inline option at L1
    assert script[3]["subclass"] == "champion"        # subclass node level for fighter


def test_ranger_inline_probes_cover_favored_enemy_and_natural_explorer():
    probes = gen.iter_inline_option_probes()
    fe = [p for p in probes if p.class_id == "ranger" and p.choice_id == "favored_enemy"]
    ne = [p for p in probes if p.class_id == "ranger" and p.choice_id == "natural_explorer"]
    assert len(fe) == 13
    assert len(ne) == 7
    # the natural_explorer NODE feeds the favored_terrain feature-choices key / char field
    assert ne[0].fc_key == "favored_terrain" and ne[0].char_field == "favored_terrain"
    assert ne[0].level == 1
    # "favored_terrain" is NOT a real progression node id, so it must produce no probes
    assert not [p for p in probes if p.choice_id == "favored_terrain"]


def test_choice_script_unknown_class_is_empty():
    assert gen.build_choice_script("nonexistent_class", "whatever") == {}
