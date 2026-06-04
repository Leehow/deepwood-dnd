"""回归测试：多发射物攻击法术（eldritch_blast 束 / scorching_ray 道）+ aid 生命上限缩放。

驱动真实 SpellResolver 跑真实 spells.json —— 离线复现 QA_MODE 下 POST /api/spells/cast +
forced-roll 队列的效果。攻击骰用 forced-roll 队列固定（[18,..]=命中, [2,..]=未命中）；
伤害骰仍走随机骰（damage handler 用 eval_formula 而非 qa_randint），故队列只喂攻击/豁免 d20。
"""
import contextlib
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app.core.config import settings
from app.utils.rules_cache import get_spell_by_id
from app.services.spell_resolver import SpellContext, SpellResolver, TargetInfo
from app.services.qa.forced_roll import push_forced_rolls, clear_forced_rolls
from app.services.effect_service import get_modifiers_for_target
from app.services.combat_resolution_service import resolve_effective_target_hp


# ── Task 2: 发射物计数纯函数 ──────────────────────────────────────────────────

def test_projectile_count_character_level():
    pacl = {"1": 1, "5": 2, "11": 3, "17": 4}
    sel = SpellResolver._select_projectile_count
    assert sel(pacl, 1) == 1
    assert sel(pacl, 4) == 1
    assert sel(pacl, 5) == 2
    assert sel(pacl, 10) == 2
    assert sel(pacl, 11) == 3
    assert sel(pacl, 17) == 4
    assert sel(pacl, 20) == 4


def test_projectile_count_eldritch_blast_by_level():
    eb = {"projectilesAtCharacterLevel": {"1": 1, "5": 2, "11": 3, "17": 4}}
    pc = SpellResolver._projectile_count
    assert pc(eb, None, SimpleNamespace(caster_level=1, slot_level=0)) == 1
    assert pc(eb, None, SimpleNamespace(caster_level=5, slot_level=0)) == 2
    assert pc(eb, None, SimpleNamespace(caster_level=11, slot_level=0)) == 3
    assert pc(eb, None, SimpleNamespace(caster_level=20, slot_level=0)) == 4


def test_projectile_count_scorching_ray_by_slot():
    sr = {"projectiles": 3}
    scaling = {"per_slot_above": 2, "extra_projectiles": 1}
    pc = SpellResolver._projectile_count
    assert pc(sr, scaling, SimpleNamespace(caster_level=20, slot_level=2)) == 3
    assert pc(sr, scaling, SimpleNamespace(caster_level=20, slot_level=3)) == 4
    assert pc(sr, scaling, SimpleNamespace(caster_level=20, slot_level=4)) == 5


def test_projectile_count_defaults_to_one():
    pc = SpellResolver._projectile_count
    assert pc(None, None, SimpleNamespace(caster_level=20, slot_level=3)) == 1
    assert pc({}, None, SimpleNamespace(caster_level=20, slot_level=3)) == 1


# ── 施法脚手架（攻击骰走 forced-roll 队列；伤害骰随机） ───────────────────────

@pytest.fixture(autouse=True)
def _qa_mode(monkeypatch):
    monkeypatch.setattr(settings, "QA_MODE", True)
    clear_forced_rolls()
    yield
    clear_forced_rolls()


_FLAG_SITES = (
    "app.services.spell_resolver.flag_modified",
    "app.services.effect_engine.handlers.modifier.flag_modified",
    "app.services.effect_engine.handlers.forced_movement.flag_modified",
)


@pytest.fixture(autouse=True)
def _noop_flag_modified():
    # mock token 是普通对象，flag_modified() 需要真实 SQLAlchemy 装配 → 全部置空。
    with contextlib.ExitStack() as stack:
        for site in _FLAG_SITES:
            stack.enter_context(patch(site))
        yield


def _ctx(**kw):
    defaults = dict(
        caster_token_id=1, caster_name="术士", caster_level=20,
        spellcasting_mod=5, proficiency_bonus=6, spell_save_dc=19,
        spell_attack_bonus=11, spell_id="", spell_name="",
        caster_class_id=None, caster_subclass_id=None,
        concentration=False, campaign_id=1, in_combat=True,
        current_world_time=None,
    )
    defaults.update(kw)
    return SpellContext(**defaults)


def _target(**kw):
    defaults = dict(token_id=10, name="目标", ac=15, current_hp=200, max_hp=200)
    defaults.update(kw)
    return TargetInfo(**defaults)


def _stateful_db():
    """同一 id 返回同一 token，使被追加的 active_effects 修正得以保留供断言/复用。
    token 字段需满足 _apply_hp_change（读 temp_hp/current_hp）等下游。"""
    tokens = {}
    db = AsyncMock()

    async def _get(_model, key):
        if key not in tokens:
            tokens[key] = SimpleNamespace(
                id=key, active_effects=[], status_effects={},
                character_id=None, monster_instance_id=None, campaign_id=1,
                current_hp=200, max_hp=200, temp_hp=0, transformation_data=None,
            )
        return tokens[key]

    db.get = AsyncMock(side_effect=_get)
    db.flush = AsyncMock()
    return db, tokens


async def _cast(spell_id, ctx_kw=None, target_kw=None):
    spell = get_spell_by_id(spell_id)
    assert spell is not None, f"{spell_id} missing from spells.json"
    ctx = _ctx(spell_id=spell_id, spell_name=spell.get("name", spell_id), **(ctx_kw or {}))
    target = _target(**(target_kw or {}))
    db, tokens = _stateful_db()
    result = await SpellResolver().resolve(spell, ctx, [target], db)
    assert result is not None, f"{spell_id} returned None (no effects field?)"
    return result, tokens


def _attack_results(result):
    return [er for phase in result.phase_results for er in phase
            if er.type == "deal_damage" and er.attack_rolled]


# ── Task 4: scorching_ray 多射线 ──────────────────────────────────────────────

@pytest.mark.asyncio
async def test_scorching_ray_three_rays_at_slot_2():
    push_forced_rolls([18, 2, 18])  # 命中, 未命中, 命中
    result, _ = await _cast("scorching_ray", ctx_kw={"slot_level": 2})
    rays = _attack_results(result)
    assert len(rays) == 3, f"slot2 应 3 道, 实得 {len(rays)}"
    assert [r.attack_roll for r in rays] == [18, 2, 18]
    assert [r.attack_hit for r in rays] == [True, False, True]
    assert rays[0].damage_dealt > 0 and rays[2].damage_dealt > 0
    assert rays[1].damage_dealt == 0  # 未命中 0 伤


@pytest.mark.asyncio
async def test_scorching_ray_five_rays_at_slot_4():
    push_forced_rolls([18, 18, 18, 18, 18])
    result, _ = await _cast("scorching_ray", ctx_kw={"slot_level": 4})
    rays = _attack_results(result)
    assert len(rays) == 5, f"slot4 应 5 道, 实得 {len(rays)}"
    assert all(r.attack_hit for r in rays)


# ── Task 5: eldritch_blast 多束（按角色等级） ─────────────────────────────────

@pytest.mark.parametrize("level,expected", [(1, 1), (5, 2), (11, 3), (17, 4), (20, 4)])
@pytest.mark.asyncio
async def test_eldritch_blast_beams_by_character_level(level, expected):
    push_forced_rolls([18] * 4)  # 够 4 束用；多余的由 _qa_mode teardown 清空
    result, _ = await _cast("eldritch_blast", ctx_kw={"slot_level": 0, "caster_level": level})
    beams = _attack_results(result)
    assert len(beams) == expected, f"L{level} 应 {expected} 束, 实得 {len(beams)}"
    assert all(b.attack_roll == 18 and b.attack_hit for b in beams)


# ── Task 6: aid modify_stat max_hp 缩放 + naming ─────────────────────────────

def _hp_max_bonus(tokens, token_id=10):
    """经消费方（get_modifiers_for_target）求值 token 上 hp_max 的 bonus 修正。"""
    eff = tokens[token_id].active_effects
    return sum(get_modifiers_for_target(eff, "hp_max").get("bonuses", []))


@pytest.mark.asyncio
async def test_aid_max_hp_bonus_base_at_slot_2():
    _, tokens = await _cast("aid", ctx_kw={"slot_level": 2})
    assert _hp_max_bonus(tokens) == 5, "2 环 aid 生命上限 +5"


@pytest.mark.asyncio
async def test_aid_max_hp_bonus_scales_at_slot_4():
    _, tokens = await _cast("aid", ctx_kw={"slot_level": 4})
    assert _hp_max_bonus(tokens) == 15, "4 环 aid 生命上限应 +15（不是恒 5）"


# ── Task 7: get_max_hp_bonus 聚合函数 ────────────────────────────────────────

def test_get_max_hp_bonus_sums_hp_max_modifiers():
    from app.services.effect_service import get_max_hp_bonus
    effects = [{
        "id": "aid_buff", "name": "援助术",
        "modifiers": [{"target": "hp_max", "type": "bonus", "value": 15, "stat": "max_hp"}],
    }]
    assert get_max_hp_bonus(effects) == 15
    assert get_max_hp_bonus([]) == 0
    assert get_max_hp_bonus(None) == 0


# ── Task 8: resolve_effective_target_hp 接入 hp_max 加成 ──────────────────────

@pytest.mark.asyncio
async def test_effective_max_hp_includes_aid_buff():
    db, tokens = _stateful_db()
    tokens[10] = SimpleNamespace(
        id=10, active_effects=[{
            "id": "aid_buff", "name": "援助术",
            "modifiers": [{"target": "hp_max", "type": "bonus", "value": 15, "stat": "max_hp"}],
        }],
        status_effects={}, character_id=None, monster_instance_id=None,
        campaign_id=1, current_hp=80, max_hp=80, temp_hp=0, transformation_data=None,
    )
    res = await resolve_effective_target_hp(
        db, request_current_hp=80, request_max_hp=80, target_token_id=10,
    )
    assert res.effective_max_hp == 95, "80 基础 + 15 aid 加成"


@pytest.mark.asyncio
async def test_effective_max_hp_unbuffed_unchanged():
    db, _ = _stateful_db()
    res = await resolve_effective_target_hp(
        db, request_current_hp=80, request_max_hp=80, target_token_id=10,
    )
    assert res.effective_max_hp == 80, "无 buff 时不变"


# ── Task 9: aid 端到端（施放 → 有效最大 HP +15） ──────────────────────────────

@pytest.mark.asyncio
async def test_aid_end_to_end_raises_effective_max_hp_at_slot_4():
    spell = get_spell_by_id("aid")
    ctx = _ctx(spell_id="aid", spell_name="援助术", slot_level=4)
    target = _target(token_id=10, current_hp=80, max_hp=80)
    db, tokens = _stateful_db()
    await SpellResolver().resolve(spell, ctx, [target], db)
    res = await resolve_effective_target_hp(
        db, request_current_hp=80, request_max_hp=80, target_token_id=10,
    )
    assert res.effective_max_hp == 95, "施放 4 环 aid 后有效最大 HP 应 80+15"
