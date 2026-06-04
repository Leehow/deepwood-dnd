import pytest

from app.services import combat_auxiliary_service as service


def test_build_extra_effect_prompt_supports_critical_and_fumble():
    critical_prompt = service.build_extra_effect_prompt(
        effect_type="critical",
        attacker_name="Aria",
        target_name="Ghoul",
        attack_name="长剑",
        damage_dealt=18,
    )
    fumble_prompt = service.build_extra_effect_prompt(
        effect_type="fumble",
        attacker_name="Aria",
        target_name="Ghoul",
        attack_name="长剑",
        damage_dealt=0,
    )

    assert "暴击" in critical_prompt
    assert "大失败" in fumble_prompt
    assert "Aria" in critical_prompt


def test_build_extra_effect_prompt_rejects_unknown_type():
    with pytest.raises(ValueError):
        service.build_extra_effect_prompt(
            effect_type="weird",
            attacker_name="Aria",
            target_name="Ghoul",
            attack_name="长剑",
            damage_dealt=0,
        )


def test_build_extra_effect_chat_outputs_preserve_contract():
    content = service.build_extra_effect_chat_content(
        effect_type="critical",
        effect="目标被击退5尺。",
    )
    meta = service.build_extra_effect_chat_meta(
        effect_type="critical",
        attacker_name="Aria",
        target_name="Ghoul",
    )

    assert "暴击奖励" in content
    assert meta == {
        "combat_type": "extra_effect",
        "effect_type": "critical",
        "attacker_name": "Aria",
        "target_name": "Ghoul",
    }


def test_build_death_save_chat_meta_preserves_contract():
    assert service.build_death_save_chat_meta(token_id=7, roll=19) == {
        "combat_type": "death_save",
        "token_id": 7,
        "roll": 19,
    }
