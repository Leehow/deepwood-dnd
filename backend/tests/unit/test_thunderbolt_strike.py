from app.api.routes import combat
from app.models.token import Token


def _make_token(x: int, y: int, token_size: str = "1x1") -> Token:
    return Token(
        campaign_id=1,
        user_id="tester",
        map_url="test-map",
        position_x=x,
        position_y=y,
        token_size=token_size,
    )


def test_normalize_damage_type_supports_chinese_lightning() -> None:
    assert combat._normalize_combat_damage_type("闪电") == "lightning"
    assert combat._normalize_combat_damage_type("lightning") == "lightning"
    assert combat._normalize_combat_damage_type("thunder") == "thunder"


def test_creature_size_fallback_from_token_size() -> None:
    assert combat._creature_size_from_token_size("1x1") == "medium"
    assert combat._creature_size_from_token_size("2x2") == "large"
    assert combat._creature_size_rank("Huge") > combat._creature_size_rank("Large")


def test_calculate_push_destination_moves_two_grids_straight() -> None:
    caster = _make_token(0, 0)
    target = _make_token(1, 0)

    assert combat._calculate_push_destination(caster, target, 10) == (3, 0)


def test_calculate_push_destination_moves_two_grids_diagonally() -> None:
    caster = _make_token(0, 0)
    target = _make_token(1, 1)

    assert combat._calculate_push_destination(caster, target, 10) == (3, 3)
