from app.services import combat_spell_service as service


def test_remove_expired_temp_hp_spell_effects_prunes_only_temp_hp_buffs():
    active_effects = [
        {"id": "heroism_buff", "spell_id": "heroism", "spell_buff": True},
        {"id": "bless_buff", "spell_id": "bless", "spell_buff": True},
        {"id": "custom_marker"},
    ]

    next_effects = service.remove_expired_temp_hp_spell_effects(
        active_effects,
        spell_lookup=lambda spell_id: {"id": spell_id},
        spell_has_effect_type=lambda spell, effect_type: spell["id"] == "heroism" and effect_type == "grant_temp_hp",
    )

    assert next_effects == [
        {"id": "bless_buff", "spell_id": "bless", "spell_buff": True},
        {"id": "custom_marker"},
    ]


def test_cleanup_concentration_for_dispelled_updates_targets_and_breaks_finished_spells(monkeypatch):
    monkeypatch.setattr(service, "flag_modified", lambda *_args, **_kwargs: None)

    caster_to_break = type(
        "Token",
        (),
        {
            "id": 1,
            "concentration_spell": {"spell_id": "hold_person", "affected_token_ids": [99]},
            "active_effects": [{"spell_id": "hold_person", "spell_buff": True}, {"spell_id": "bless", "spell_buff": True}],
        },
    )()
    caster_to_keep = type(
        "Token",
        (),
        {
            "id": 2,
            "concentration_spell": {"spell_id": "hex", "affected_token_ids": [99, 100]},
            "active_effects": [{"spell_id": "hex", "spell_buff": True}],
        },
    )()

    broken_ids = service.cleanup_concentration_for_dispelled(
        [caster_to_break, caster_to_keep],
        dispelled_spell_ids=["hold_person", "hex"],
        target_token_id=99,
    )

    assert broken_ids == [1]
    assert caster_to_break.concentration_spell is None
    assert caster_to_break.active_effects == [{"spell_id": "bless", "spell_buff": True}]
    assert caster_to_keep.concentration_spell == {"spell_id": "hex", "affected_token_ids": [100]}
