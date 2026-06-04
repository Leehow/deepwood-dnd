# 多发射物攻击法术 + aid 生命上限缩放 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 eldritch_blast/scorching_ray 发射 N 个独立攻击骰的发射物（按角色等级/法术位缩放），并让 aid 的 `modify_stat max_hp` 随升环缩放且真正抬高有效最大 HP。

**Architecture:** 在效果引擎的 phase 上引入数据驱动的「projectiles 计数」（`attack.projectiles` / `attack.projectilesAtCharacterLevel` / `scaling.extra_projectiles`）；`SpellResolver._execute_phase` 重构为「先算合格目标 → 攻击 phase 按发射物数轮流掷 N 次独立攻击骰，单发射物/豁免/增益 phase 保持逐目标」；aid 修复在 `ModifierHandler` 缩放并预求值，新增 `get_max_hp_bonus` 并接入 `resolve_effective_target_hp`。

**Tech Stack:** FastAPI / SQLAlchemy async / Pydantic v2 后端，pytest + AsyncMock 单测，法术数据在 `frontend/app/data/rules/spells.json`。

**关键约束（已核实）：**
- `is_formula("5+10")=False` → aid 缩放值必须预求值成 int，不能存裸 "5+10"。
- damage handler 用 `eval_formula`（随机骰）非 `qa_randint`；forced 队列只喂攻击/豁免 d20。
- `_apply_hp_change` 读 `token.temp_hp`/`current_hp`/`campaign_id`/`transformation_data` → mock token 必须带这些字段。
- 单发射物 phase（`projectile_count==1`）必须保持现有逐目标行为，零回归。

---

## File Structure

| 文件 | 责任 | 改动 |
|------|------|------|
| `backend/app/schemas/spell_effect.py` | 效果 schema（文档用，非严格校验） | 加 3 个字段 |
| `backend/app/services/spell_resolver.py` | 法术解析 / phase 执行 | 加 `_projectile_count`/`_select_projectile_count`/`_roll_attack`/`_creature_type_exclusion_result`/`_dispatch_phase_effects`，重写 `_execute_phase` |
| `frontend/app/data/rules/spells.json` | 法术数据 | 改 eldritch_blast、scorching_ray |
| `backend/app/services/effect_engine/handlers/modifier.py` | modify_stat 等 | 缩放 + 预求值 + naming |
| `backend/app/services/effect_service.py` | 修正聚合 | 加 `get_max_hp_bonus` |
| `backend/app/services/combat_resolution_service.py` | 有效 HP 解析 | `resolve_effective_target_hp` 累加 max-hp 加成 |
| `backend/tests/unit/test_spell_scaling_multiprojectile.py` | 新回归测试 | 新建 |

---

## Task 1: Schema 字段（非破坏性）

**Files:** Modify `backend/app/schemas/spell_effect.py:54-65`

- [ ] **Step 1: 加字段**

`AttackConfig`（:54）改为：
```python
class AttackConfig(BaseModel):
    type: Literal["melee_spell", "ranged_spell"] = "ranged_spell"
    on_miss: Literal["no_effect", "half_damage"] = "no_effect"
    # 多发射物（魔能爆束 / 灼热射线道）：每个发射物独立攻击骰
    projectiles: int = 1
    projectilesAtCharacterLevel: Optional[Dict[str, int]] = None
```

`ScalingConfig`（:60）末尾加一行：
```python
    extra_projectiles: Optional[int] = None  # 每高于 per_slot_above 一环额外发射物数
```

确认文件顶部已 `from typing import ... Dict, Optional`（spell_effect.py 已 import）。

- [ ] **Step 2: 验证 import 无误**

Run: `cd backend && ./venv/bin/python -c "from app.schemas.spell_effect import AttackConfig, ScalingConfig; print(AttackConfig().projectiles, ScalingConfig().extra_projectiles)"`
Expected: `1 None`

- [ ] **Step 3: Commit**

```bash
git add backend/app/schemas/spell_effect.py
git commit -m "feat(spells): add projectiles fields to AttackConfig/ScalingConfig schema"
```

---

## Task 2: `_projectile_count` / `_select_projectile_count` 纯函数（TDD）

**Files:**
- Modify `backend/app/services/spell_resolver.py`（在 `_select_cantrip_formula` 附近 :758 后加两个 staticmethod）
- Test: `backend/tests/unit/test_spell_scaling_multiprojectile.py`（新建）

- [ ] **Step 1: 写失败测试**

新建 `backend/tests/unit/test_spell_scaling_multiprojectile.py`：
```python
"""回归测试：多发射物攻击法术（eldritch_blast 束 / scorching_ray 道）+ aid 生命上限缩放。

驱动真实 SpellResolver 跑真实 spells.json —— 离线复现 QA_MODE 下 POST /api/spells/cast +
forced-roll 队列的效果。攻击骰用 forced-roll 队列固定（[18,..]=命中, [2,..]=未命中）。
"""
import contextlib
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app.core.config import settings
from app.utils.rules_cache import get_spell_by_id
from app.services.spell_resolver import SpellContext, SpellResolver, TargetInfo
from app.services.qa.forced_roll import push_forced_rolls, clear_forced_rolls


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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && ./venv/bin/python -m pytest tests/unit/test_spell_scaling_multiprojectile.py -k projectile_count -q --no-cov`
Expected: FAIL — `AttributeError: ... has no attribute '_select_projectile_count'`

- [ ] **Step 3: 实现两个 staticmethod**

在 `spell_resolver.py` 的 `_select_cantrip_formula`（:758-770）之后插入：
```python
    @staticmethod
    def _select_projectile_count(pacl: Dict[str, int], caster_level: int) -> int:
        """从 projectilesAtCharacterLevel 取 ≤ caster_level 的最高档发射物数。"""
        best, best_thr = 1, -1
        for k, v in (pacl or {}).items():
            try:
                thr = int(k)
            except (TypeError, ValueError):
                continue
            if thr <= caster_level and thr > best_thr:
                best_thr, best = thr, int(v)
        return best

    @staticmethod
    def _projectile_count(attack_cfg, scaling, ctx) -> int:
        """攻击 phase 的发射物数（束/道）。默认 1。
        底数 = projectilesAtCharacterLevel(按角色等级) 否则 attack.projectiles；
        再 + extra_projectiles × (slot_level − per_slot_above)（升环）。"""
        if not attack_cfg:
            return 1
        pacl = attack_cfg.get("projectilesAtCharacterLevel")
        if pacl:
            base = SpellResolver._select_projectile_count(pacl, ctx.caster_level or 1)
        else:
            base = int(attack_cfg.get("projectiles", 1) or 1)
        count = base
        sc = scaling or {}
        extra = sc.get("extra_projectiles")
        per = sc.get("per_slot_above", 0)
        if extra and per and ctx.slot_level > per:
            count += int(extra) * (ctx.slot_level - per)
        return max(1, count)
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend && ./venv/bin/python -m pytest tests/unit/test_spell_scaling_multiprojectile.py -k projectile_count -q --no-cov`
Expected: PASS（4 个测试）

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/spell_resolver.py backend/tests/unit/test_spell_scaling_multiprojectile.py
git commit -m "feat(spells): projectile-count resolver helpers (char-level + slot scaling)"
```

---

## Task 3: 重构 `_execute_phase`（提取 helper + 接入发射物循环，行为保持）

**Files:** Modify `backend/app/services/spell_resolver.py:317-568`

这是承重重构：把「逐(目标,攻击/豁免结果)的效果派发块」抽成方法，`_execute_phase` 改为「先算合格目标 → 攻击 phase 走发射物循环（count==1 时退化为逐目标，行为不变）/ 非攻击 phase 走逐目标」。**无数据改动时所有法术 count==1 → 现有测试必须全绿。**

- [ ] **Step 1: 加 `_roll_attack` 与 `_creature_type_exclusion_result`**

在 `_execute_phase` 之前（:317 前）加：
```python
    @staticmethod
    def _roll_attack(target, ctx):
        """掷一次法术攻击骰，返回 (d20, total, is_crit, hit)。"""
        d20 = qa_randint(1, 20)
        total = d20 + ctx.spell_attack_bonus
        is_crit = d20 == 20
        hit = is_crit or (d20 != 1 and total >= target.ac)
        return d20, total, is_crit, hit

    def _creature_type_exclusion_result(self, target, exclude_types, target_types):
        """生物类型门禁：被排除/不在白名单 → 返回 'excluded' EffectResult，否则 None。"""
        if exclude_types and creature_type_matches(target.creature_type, exclude_types):
            return EffectResult(
                type="excluded", target_token_id=target.token_id,
                target_name=target.name,
                description=f"{target.name} 的生物类型不受该法术影响",
            )
        if target_types and not creature_type_matches(target.creature_type, target_types):
            return EffectResult(
                type="excluded", target_token_id=target.token_id,
                target_name=target.name,
                description=f"{target.name} 的生物类型不是该法术的有效目标",
            )
        return None
```

- [ ] **Step 2: 抽出 `_dispatch_phase_effects`**

新建方法，**方法体 = 现有 `_execute_phase` 的第 417-566 行原样照搬**（即 `phase_damage_dealt = 0` 到 `results.extend(extra_results)` 那段 `for effect in remaining_effects` 循环），仅做：方法开头加 `results: List[EffectResult] = []`，结尾 `return results`；原先闭包捕获的局部变量改为入参。签名：
```python
    async def _dispatch_phase_effects(
        self, target, remaining_effects, phase, ctx, db, *,
        attack_cfg, attack_hit, attack_d20, attack_total, is_crit,
        save_cfg, save_succeeded, save_total, scaling,
    ) -> List[EffectResult]:
        results: List[EffectResult] = []
        phase_damage_dealt = 0
        for effect in remaining_effects:
            # …… 原 417-566 行循环体逐字照搬（保持 on_miss/on_success/引擎派发/
            #     HP 应用/extra_results/pending_damage 等全部逻辑不变）……
            results.append(er)
            if extra_results:
                results.extend(extra_results)
        return results
```
注意：循环体里原本读 `save_total`（用于 `er.save_total = save_total`）现在来自入参；其余 `attack_hit/attack_d20/attack_total/is_crit/save_cfg/save_succeeded/scaling` 均为入参。

- [ ] **Step 3: 重写 `_execute_phase` 的目标/攻击/豁免编排**

保留 :325-372（`_phase_with_context`、`save_cfg/attack_cfg/scaling`、exclude/target_types、generate_item 预处理产出 `remaining_effects`）。把第 374-568 行（`for target in targets:` 整块）替换为：
```python
        # 生物类型门禁 → 合格目标列表
        eligible = []
        for target in targets:
            excl = self._creature_type_exclusion_result(target, exclude_types, target_types)
            if excl is not None:
                results.append(excl)
            else:
                eligible.append(target)

        if attack_cfg:
            # 攻击 phase：发射物数 N。N>1（魔能爆/灼热射线）→ N 个独立攻击骰，
            # 在合格目标间轮流（总数 N）；N==1 → 每个合格目标一次攻击（行为不变）。
            projectile_count = self._projectile_count(attack_cfg, scaling, ctx)
            if projectile_count > 1 and eligible:
                shots = [eligible[i % len(eligible)] for i in range(projectile_count)]
            else:
                shots = eligible
            for target in shots:
                d20, total, is_crit, hit = self._roll_attack(target, ctx)
                results.extend(await self._dispatch_phase_effects(
                    target, remaining_effects, phase, ctx, db,
                    attack_cfg=attack_cfg, attack_hit=hit, attack_d20=d20,
                    attack_total=total, is_crit=is_crit,
                    save_cfg=None, save_succeeded=None, save_total=None,
                    scaling=scaling,
                ))
        else:
            for target in eligible:
                save_succeeded, save_total = (None, None)
                if save_cfg:
                    save_succeeded, save_total = self._roll_save(target, save_cfg, ctx)
                results.extend(await self._dispatch_phase_effects(
                    target, remaining_effects, phase, ctx, db,
                    attack_cfg=None, attack_hit=None, attack_d20=None,
                    attack_total=None, is_crit=False,
                    save_cfg=save_cfg, save_succeeded=save_succeeded,
                    save_total=save_total, scaling=scaling,
                ))

        return results
```

- [ ] **Step 4: 跑全部既有法术单测，确认零回归**

Run: `cd backend && ./venv/bin/python -m pytest tests/unit/test_spell_qa_correctness_fixes.py -q --no-cov`
Expected: PASS（全绿——证明重构行为保持）

- [ ] **Step 5: typecheck 关键文件无语法/缩进错误**

Run: `cd backend && ./venv/bin/python -c "import app.services.spell_resolver"`
Expected: 无输出（import 成功）

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/spell_resolver.py
git commit -m "refactor(spells): extract phase-effect dispatch; projectile-capable _execute_phase (behaviour-preserving)"
```

---

## Task 4: scorching_ray 多射线（数据 + TDD）

**Files:**
- Modify `frontend/app/data/rules/spells.json:8163-8181`（scorching_ray effects）
- Test: `backend/tests/unit/test_spell_scaling_multiprojectile.py`

- [ ] **Step 1: 写失败测试**

追加到测试文件（含共用脚手架；放在 import 之后、纯函数测试附近）：
```python
@pytest.fixture(autouse=True)
def _qa_mode(monkeypatch):
    monkeypatch.setattr(settings, "QA_MODE", True)
    clear_forced_rolls()
    yield
    clear_forced_rolls()


_FLAG_SITES = (
    "app.services.spell_resolver.flag_modified",
    "app.services.effect_engine.handlers.modifier.flag_modified",
)


@pytest.fixture(autouse=True)
def _noop_flag_modified():
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
    """同一 id 返回同一 token，便于断言被追加的 active_effects 修正。"""
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
    assert spell is not None, f"{spell_id} missing"
    ctx = _ctx(spell_id=spell_id, spell_name=spell.get("name", spell_id), **(ctx_kw or {}))
    target = _target(**(target_kw or {}))
    db, tokens = _stateful_db()
    result = await SpellResolver().resolve(spell, ctx, [target], db)
    assert result is not None
    return result, tokens


def _attack_results(result):
    return [er for phase in result.phase_results for er in phase
            if er.type == "deal_damage" and er.attack_rolled]


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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && ./venv/bin/python -m pytest tests/unit/test_spell_scaling_multiprojectile.py -k scorching -q --no-cov`
Expected: FAIL — `slot2 应 3 道, 实得 1`（数据还没改）

- [ ] **Step 3: 改 scorching_ray 数据**

`spells.json` scorching_ray 的 `effects[0]`（:8164-8181）：`attack` 加 `projectiles: 3`；`scaling` 去掉 `extra_dice`、改 `extra_projectiles: 1`。改为：
```json
        {
          "trigger": "on_cast",
          "attack": {
            "type": "ranged_spell",
            "on_miss": "no_effect",
            "projectiles": 3
          },
          "effects": [
            {
              "type": "deal_damage",
              "formula": "2d6",
              "damage_type": "fire"
            }
          ],
          "scaling": {
            "per_slot_above": 2,
            "extra_projectiles": 1
          }
        }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend && ./venv/bin/python -m pytest tests/unit/test_spell_scaling_multiprojectile.py -k scorching -q --no-cov`
Expected: PASS（2 个测试）

- [ ] **Step 5: Commit**

```bash
git add frontend/app/data/rules/spells.json backend/tests/unit/test_spell_scaling_multiprojectile.py
git commit -m "fix(spells): scorching_ray fires N rays (3 + slot) as independent attacks, not extra dice"
```

---

## Task 5: eldritch_blast 多束（数据 + TDD）

**Files:**
- Modify `frontend/app/data/rules/spells.json:1580-1592`（eldritch_blast 攻击 phase）
- Test: `backend/tests/unit/test_spell_scaling_multiprojectile.py`

- [ ] **Step 1: 写失败测试**

追加：
```python
@pytest.mark.parametrize("level,expected", [(1, 1), (5, 2), (11, 3), (17, 4), (20, 4)])
@pytest.mark.asyncio
async def test_eldritch_blast_beams_by_character_level(level, expected):
    push_forced_rolls([18] * 4)  # 够 4 束用
    result, _ = await _cast("eldritch_blast", ctx_kw={"slot_level": 0, "caster_level": level})
    beams = _attack_results(result)
    assert len(beams) == expected, f"L{level} 应 {expected} 束, 实得 {len(beams)}"
    assert all(b.attack_roll == 18 and b.attack_hit for b in beams)
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && ./venv/bin/python -m pytest tests/unit/test_spell_scaling_multiprojectile.py -k eldritch -q --no-cov`
Expected: FAIL — `L5 应 2 束, 实得 1`

- [ ] **Step 3: 改 eldritch_blast 数据**

`spells.json` eldritch_blast 的 `effects[0].attack`（:1581-1584）加 `projectilesAtCharacterLevel`：
```json
          "attack": {
            "type": "ranged_spell",
            "on_miss": "no_effect",
            "projectilesAtCharacterLevel": {
              "1": 1,
              "5": 2,
              "11": 3,
              "17": 4
            }
          },
```
（伤害 phase 的 deal_damage `1d10` 不动；击退 phase 不动。）

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend && ./venv/bin/python -m pytest tests/unit/test_spell_scaling_multiprojectile.py -k eldritch -q --no-cov`
Expected: PASS（5 个参数化用例）

- [ ] **Step 5: Commit**

```bash
git add frontend/app/data/rules/spells.json backend/tests/unit/test_spell_scaling_multiprojectile.py
git commit -m "fix(spells): eldritch_blast fires 2/3/4 beams at char levels 5/11/17 as independent attacks"
```

---

## Task 6: aid `modify_stat` 缩放 + 预求值 + naming（TDD）

**Files:** Modify `backend/app/services/effect_engine/handlers/modifier.py:104,162-172,224-225`

- [ ] **Step 1: 写失败测试**

追加（用 `_cast` + 有状态 db，读回 token 上被追加的 hp_max 修正，经消费方求值）：
```python
from app.services.effect_service import get_modifiers_for_target


def _hp_max_bonus(tokens, token_id=10):
    eff = tokens[token_id].active_effects
    return sum(get_modifiers_for_target(eff, "hp_max").get("bonuses", []))


@pytest.mark.asyncio
async def test_aid_max_hp_bonus_base_at_slot_2():
    result, tokens = await _cast("aid", ctx_kw={"slot_level": 2})
    assert _hp_max_bonus(tokens) == 5, "2 环 aid 生命上限 +5"


@pytest.mark.asyncio
async def test_aid_max_hp_bonus_scales_at_slot_4():
    result, tokens = await _cast("aid", ctx_kw={"slot_level": 4})
    assert _hp_max_bonus(tokens) == 15, "4 环 aid 生命上限应 +15（不是恒 5）"
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && ./venv/bin/python -m pytest tests/unit/test_spell_scaling_multiprojectile.py -k aid -q --no-cov`
Expected: FAIL — slot4 得 5（modify_stat 不缩放，且 target 还是 "max_hp" 不是 "hp_max" → bonus=0 或 5）

- [ ] **Step 3: 修 modifier.py**

(a) 文件顶部加 import：
```python
from app.services.effect_engine.handlers._scaling import scale_formula
from app.utils.dice_formula import is_formula, evaluate as eval_formula
```

(b) `execute()` 中（:104）把
```python
        modifier_entries = _build_modifier_entries(etype, params)
```
改为
```python
        modifier_entries = _build_modifier_entries(etype, params, hctx.scaling, ctx.slot_level)
```

(c) `_build_modifier_entries` 签名与 modify_stat 分支（:162-172）改为：
```python
def _build_modifier_entries(etype: str, params: BaseModel, scaling=None, slot_level: int = 0) -> List[Dict[str, Any]]:
    if etype == "modify_stat":
        p = params  # type: ModifyStatParams
        type_map = {"set": "set_base", "set_floor": "set_floor"}
        return [{
            "target": _stat_to_modifier_target(p.stat),
            "type": type_map.get(p.operation, "bonus"),
            "value": _scale_stat_value(p.formula, scaling, slot_level),
            "stat": p.stat,
            "operation": p.operation,
        }]
```

(d) 新增 helper（放在 `_build_modifier_entries` 后）：
```python
def _scale_stat_value(formula: str, scaling, slot_level: int):
    """升环缩放 modify_stat 值。纯算术预求值成 int（消费方只认数字 bonus，
    int("5+10") 会抛错被静默丢弃）；含骰子/变量则保留 formula 串由消费方求值。"""
    scaled = scale_formula(formula, scaling, slot_level)
    if scaled == formula:
        return formula
    if is_formula(scaled):
        return scaled
    try:
        return eval_formula(scaled).total
    except Exception:
        return scaled
```

(e) `_stat_to_modifier_target`（:224-225）加 `max_hp` → `hp_max`：
```python
def _stat_to_modifier_target(stat: str) -> str:
    return {"ac": "incoming_attack", "speed": "speed",
            "hp_max": "hp_max", "max_hp": "hp_max"}.get(stat, stat)
```

- [ ] **Step 4: 跑测试确认通过 + 既有引擎测试零回归**

Run: `cd backend && ./venv/bin/python -m pytest tests/unit/test_spell_scaling_multiprojectile.py -k aid -q --no-cov`
Expected: PASS
Run: `cd backend && ./venv/bin/python -m pytest tests/unit -k "modifier or buff or bless or bane" -q --no-cov`
Expected: PASS（modify_roll 等其它 modifier 行为不受影响）

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/effect_engine/handlers/modifier.py backend/tests/unit/test_spell_scaling_multiprojectile.py
git commit -m "fix(spells): aid modify_stat max_hp scales with upcast; map max_hp->hp_max target"
```

---

## Task 7: `get_max_hp_bonus` 聚合函数（TDD）

**Files:** Modify `backend/app/services/effect_service.py`（在 `get_modifiers_for_target` 函数定义之后新增）

- [ ] **Step 1: 写失败测试**

追加：
```python
from app.services.effect_service import get_max_hp_bonus


def test_get_max_hp_bonus_sums_hp_max_modifiers():
    effects = [{
        "id": "aid_buff", "name": "援助术",
        "modifiers": [{"target": "hp_max", "type": "bonus", "value": 15, "stat": "max_hp"}],
    }]
    assert get_max_hp_bonus(effects) == 15
    assert get_max_hp_bonus([]) == 0
    assert get_max_hp_bonus(None) == 0
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && ./venv/bin/python -m pytest tests/unit/test_spell_scaling_multiprojectile.py -k get_max_hp_bonus -q --no-cov`
Expected: FAIL — `ImportError: cannot import name 'get_max_hp_bonus'`

- [ ] **Step 3: 实现**

在 `effect_service.py` 的 `get_modifiers_for_target` 函数 `return result` 之后、下一个函数之前插入：
```python
def get_max_hp_bonus(active_effects: Optional[List[Dict[str, Any]]]) -> int:
    """汇总 active_effects 中 hp_max 的 bonus 修正（如 aid 抬高生命上限）。无则 0。"""
    result = get_modifiers_for_target(active_effects, "hp_max")
    return sum(result.get("bonuses", []))
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend && ./venv/bin/python -m pytest tests/unit/test_spell_scaling_multiprojectile.py -k get_max_hp_bonus -q --no-cov`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/effect_service.py backend/tests/unit/test_spell_scaling_multiprojectile.py
git commit -m "feat(effects): get_max_hp_bonus() to read hp_max buffs from active_effects"
```

---

## Task 8: 接入 `resolve_effective_target_hp`（TDD）

**Files:** Modify `backend/app/services/combat_resolution_service.py:296-338`

- [ ] **Step 1: 写失败测试**

追加：
```python
from app.services.combat_resolution_service import resolve_effective_target_hp


@pytest.mark.asyncio
async def test_effective_max_hp_includes_aid_buff():
    db, tokens = _stateful_db()
    # 预置一个带 aid hp_max +15 修正的 token
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd backend && ./venv/bin/python -m pytest tests/unit/test_spell_scaling_multiprojectile.py -k effective_max_hp -q --no-cov`
Expected: FAIL — `test_effective_max_hp_includes_aid_buff` 得 80（加成没接入）

- [ ] **Step 3: 接入加成**

`resolve_effective_target_hp`（:296）：把 `target_token` 提到 if 外初始化为 None，并在 `return` 前累加 max-hp 加成。改动：
- 在 `effective_max_hp = request_max_hp` 之后加 `target_token = None`
- 把 `target_token = await db.get(Token, target_token_id)` 保持在原 if 内（已有）
- 在最后 `return EffectiveHpResolution(...)` 之前插入：
```python
    # Active-effects 生命上限加成（如 aid）。无 buff → +0，未受 buff 生物不变。
    if effective_max_hp is not None and target_token_id:
        if target_token is None:
            target_token = await db.get(Token, target_token_id)
        if target_token is not None:
            from app.services.effect_service import get_max_hp_bonus
            effective_max_hp += get_max_hp_bonus(getattr(target_token, "active_effects", None))
```
（注意：原 if 块内的 `target_token = await db.get(...)` 那行不要重复声明；若它在 `if (... is None ...)` 内，确保把外层 `target_token = None` 加在该 if 之前。）

- [ ] **Step 4: 跑测试确认通过**

Run: `cd backend && ./venv/bin/python -m pytest tests/unit/test_spell_scaling_multiprojectile.py -k effective_max_hp -q --no-cov`
Expected: PASS（2 个）

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/combat_resolution_service.py backend/tests/unit/test_spell_scaling_multiprojectile.py
git commit -m "feat(combat): effective max HP includes active-effects hp_max buffs (aid)"
```

---

## Task 9: aid 端到端（施放 → 有效最大 HP +15）

**Files:** Test only — `backend/tests/unit/test_spell_scaling_multiprojectile.py`

- [ ] **Step 1: 写测试**

追加（施放 aid 后用同一 db 解析有效最大 HP）：
```python
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
```

- [ ] **Step 2: 跑测试确认通过**

Run: `cd backend && ./venv/bin/python -m pytest tests/unit/test_spell_scaling_multiprojectile.py -k end_to_end -q --no-cov`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add backend/tests/unit/test_spell_scaling_multiprojectile.py
git commit -m "test(spells): aid end-to-end raises effective max HP by scaled amount"
```

---

## Task 10: 全量验收

- [ ] **Step 1: 跑整个新测试文件**

Run: `cd backend && ./venv/bin/python -m pytest tests/unit/test_spell_scaling_multiprojectile.py -v --no-cov`
Expected: 全部 PASS

- [ ] **Step 2: 跑相关既有套件确认零回归**

Run: `cd backend && ./venv/bin/python -m pytest tests/unit/test_spell_qa_correctness_fixes.py tests/unit -k "spell or effect or combat or modifier" -q --no-cov`
Expected: 全部 PASS

- [ ] **Step 3: 确认无遗漏 forced-roll 残留**

新测试的 `_qa_mode` fixture 已在每个用例前后 `clear_forced_rolls()`，无需额外操作。若运行其它套件出现攻击骰异常，检查 `QA_MODE` 是否被错误置真。

---

## Self-Review 结论

- **Spec 覆盖**：projectiles 机制(Task1-3)、scorching_ray(4)、eldritch_blast(5)、aid 缩放(6)、get_max_hp_bonus(7)、有效最大HP接入(8)、端到端(9) — 全部对应到任务。
- **类型一致**：`_projectile_count(attack_cfg, scaling, ctx)`、`_dispatch_phase_effects(... *, attack_cfg, attack_hit, attack_d20, attack_total, is_crit, save_cfg, save_succeeded, save_total, scaling)`、`get_max_hp_bonus(active_effects)`、`_scale_stat_value(formula, scaling, slot_level)` 在各任务签名一致。
- **无占位符**：每个改码步骤均含完整代码或对现有具体行号的照搬指令。
- **范围**：EB 击退 phase 不动；magic_missile 不动；UI max-HP 消费方为后续。
