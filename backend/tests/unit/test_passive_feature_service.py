from app.services.passive_feature_service import get_passive_save_advantage_sources


def test_danger_sense_grants_advantage_on_dex_saves() -> None:
    sources = get_passive_save_advantage_sources(
        class_id="barbarian",
        level=2,
        save_type="dexterity",
    )

    assert "Danger Sense" in sources


def test_danger_sense_is_blocked_when_blinded() -> None:
    sources = get_passive_save_advantage_sources(
        class_id="barbarian",
        level=2,
        save_type="dexterity",
        condition_ids=["blinded"],
    )

    assert sources == []


def test_danger_sense_does_not_apply_to_other_save_types() -> None:
    sources = get_passive_save_advantage_sources(
        class_id="barbarian",
        level=2,
        save_type="strength",
    )

    assert sources == []
