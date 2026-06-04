from types import SimpleNamespace

from app.services.combat_control_effect_service import (
    build_batch_ongoing_save_chat_content,
    build_condition_save_chat_content,
    build_condition_save_narrative,
    build_escape_attempt_chat_content,
    build_escape_attempt_narrative,
    build_ongoing_save_chat_content,
    build_ongoing_save_chat_meta,
    build_zone_spell_settle_chat_meta,
    build_zone_spell_settle_narrative,
)


def test_build_zone_spell_settle_outputs_preserve_contract():
    failed = [
        SimpleNamespace(
            target_name="哥布林",
            damage_dealt=8,
            save_roll=SimpleNamespace(dice="1d20", rolls=[7], modifier=1),
            save_total=8,
        )
    ]
    passed = [
        SimpleNamespace(
            target_name="兽人",
            damage_dealt=4,
            save_roll=SimpleNamespace(dice="2d20", rolls=[15, 3], modifier=2),
            save_total=17,
        )
    ]

    narrative = build_zone_spell_settle_narrative(
        spell_name="臭云术",
        spell_save_dc=15,
        save_type_cn="体质",
        failed_results=failed,
        passed_results=passed,
        condition_cn="中毒",
        should_persist_effect=True,
        damage_formula="3d8",
        save_effect="half",
        damage_type_cn="毒素",
    )
    meta = build_zone_spell_settle_chat_meta(
        spell_id="stinking-cloud",
        spell_name="臭云术",
        caster_token_id=11,
        target_results=failed + passed,
        failed_count=1,
        passed_count=1,
        should_persist_effect=True,
        condition_cn="中毒",
        damage_type_label="毒素",
    )

    assert "臭云术" in narrative
    assert "❌ 豁免失败:" in narrative
    assert "哥布林: 1d20(7)+1 = 8 (8毒素伤害)" in narrative
    assert "✓ 豁免成功:" in narrative
    assert "兽人: 2d20(15,3)+2 = 17 (4毒素伤害)" in narrative
    assert "伤害减半" in narrative
    assert meta == {
        "combat_type": "zone_spell_settle",
        "spell_id": "stinking-cloud",
        "spell_name": "臭云术",
        "caster_token_id": 11,
        "target_count": 2,
        "failed_count": 1,
        "passed_count": 1,
        "effect_persisted": True,
        "condition": "中毒",
        "total_damage": 12,
        "damage_type": "毒素",
    }


def test_build_ongoing_save_chat_outputs_preserve_contract():
    content = build_ongoing_save_chat_content(
        token_name="被定身的战士",
        effect_name="人类定身术",
        save_dc=15,
        save_type_cn="感知",
        nat_roll=18,
        modifier=2,
        save_total=20,
        success=True,
        effect_removed=True,
    )
    meta = build_ongoing_save_chat_meta(token_id=7, timing="end_of_turn")

    assert content == (
        "🎲 **被定身的战士** 豁免:\n"
        "✅ 人类定身术 — DC 15 感知: d20(18)+2 = 20 → 成功，效果解除！"
    )
    assert meta == {"combat_type": "ongoing_save", "token_id": 7, "timing": "end_of_turn"}


def test_build_batch_ongoing_save_chat_content_formats_each_result():
    results = [
        SimpleNamespace(
            success=True,
            effect_name="人类定身术",
            save_type="wisdom",
            save_dc=15,
            save_roll=SimpleNamespace(rolls=[17], modifier=2),
            save_total=19,
            effect_removed=True,
        ),
        SimpleNamespace(
            success=False,
            effect_name="妖火",
            save_type="dex",
            save_dc=13,
            save_roll=SimpleNamespace(rolls=[4], modifier=1),
            save_total=5,
            effect_removed=False,
        ),
    ]

    content = build_batch_ongoing_save_chat_content(
        token_name="目标",
        timing="end_of_turn",
        results=results,
        save_type_cn_lookup={"wisdom": "感知", "dex": "敏捷"},
    )

    assert "🎲 **目标** 回合末豁免:" in content
    assert "✅ 人类定身术 — DC 15 感知: d20(17)+2 = 19 → 成功，效果解除！" in content
    assert "❌ 妖火 — DC 13 敏捷: d20(4)+1 = 5 → 失败，效果持续。" in content


def test_build_condition_save_outputs_preserve_contract():
    narrative = build_condition_save_narrative(
        target_name="战士",
        success=False,
        save_dc=13,
        save_type_cn="敏捷",
        save_total=9,
        effect_name="油腻术",
    )
    content = build_condition_save_chat_content(
        target_name="战士",
        success=False,
        effect_name="油腻术",
        save_dc=13,
        save_type_cn="敏捷",
        nat_roll=7,
        save_modifier=2,
        save_total=9,
        effect_removed=False,
    )

    assert narrative == "战士 未能通过 DC 13 的敏捷豁免（9），油腻术效果持续。"
    assert content == (
        "🎲 **战士** 状态豁免:\n"
        "❌ 油腻术 — DC 13 敏捷: d20(7)+2 = 9 → 失败，效果持续。"
    )


def test_build_escape_attempt_outputs_preserve_contract():
    narrative = build_escape_attempt_narrative(
        target_name="盗贼",
        success=True,
        dc=14,
        skill_label="运动",
        check_text="检定",
        nat_roll=16,
        modifier=3,
        total=19,
        effect_name="蛛网术",
    )
    content = build_escape_attempt_chat_content(
        target_name="盗贼",
        success=True,
        effect_name="蛛网术",
        dc=14,
        skill_label="运动",
        check_text="检定",
        nat_roll=16,
        modifier=3,
        total=19,
    )

    assert narrative == "盗贼成功通过了DC 14的运动检定（🎲16+3=19），挣脱了蛛网术！"
    assert content == (
        "🎲 **盗贼** 挣脱尝试:\n"
        "✅ 蛛网术 — DC 14 运动检定: d20(16)+3 = 19 → 挣脱成功！"
    )
