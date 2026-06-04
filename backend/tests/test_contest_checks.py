import pytest

from app.utils.dice import roll_expression, add_modifier_to_expr, skill_modifier, ability_check_modifier, normalize_check


def test_normalize_check_preserves_roll_modifier_metadata():
    check = normalize_check({
        "type": "check",
        "ability": "strength",
        "dice": "1d20",
        "description": "力量检定",
        "roll_modifier": "disadvantage",
        "roll_modifier_reasons": ["脆弱诅咒: 劣势"],
        "original_message": "发起检定：力量",
    })

    assert check["roll_modifier"] == "disadvantage"
    assert check["roll_modifier_reasons"] == ["脆弱诅咒: 劣势"]
    assert check["original_message"] == "发起检定：力量"


@pytest.mark.asyncio
async def test_contest_deception_vs_insight_demo(monkeypatch):
    """
    Demo: 玩家A 进行欺瞒(Deception) vs NPC 洞悉(Insight) 的对抗检定
    - 使用 ensure_strict_json 解析出 type=contest
    - 双方分别掷 1d20 + 各自修正
    - 使用 ensure_strict_json 让 AI 判胜负，并在本地做布尔兜底（本地胜负为准）
    打印完整日志到终端
    """

    # Ensure env required by settings before importing modules
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://user:pass@localhost:5432/db")
    monkeypatch.setenv("REDIS_URL", "redis://localhost:6379/0")

    # Lazy import after env
    from app.services.ai_service import AIService
    from app.services.json_format_agent import ensure_strict_json

    # 1) 解析阶段（AI -> 严格JSON）
    async def fake_completion_parse(api_url: str, api_key: str, model: str, messages, temperature: float = 0.2, max_tokens: int = 800):
        # 首次调用：返回 contest 结构
        return '{"type":"contest","contest":{"attacker":{"skill":"deception"},"defender":{"skill":"insight"}}}'

    monkeypatch.setattr(AIService, "generate_completion", staticmethod(fake_completion_parse))

    parsed = await ensure_strict_json(
        api_url="http://fake", api_key="x", model="gpt-5",
        messages=[{"role": "system", "content": "extract"}, {"role": "user", "content": "我尝试欺瞒守卫，他能否看穿？"}],
        schema_hint='{"type":"string","contest":{"attacker":{"skill":"string"},"defender":{"skill":"string"}}}',
        max_attempts=3,
    )
    check = normalize_check(parsed)

    # 2) 双方数据（简化：只看技能修正）
    attacker = {
        "name": "玩家A",
        "ability_scores": {"charisma": 16},
        "selected_skills": ["deception"],
        "expertise_skills": [],
        "level": 3,
    }
    defender = {
        "name": "守卫",
        "ability_scores": {"wisdom": 12},
        "selected_skills": ["insight"],
        "expertise_skills": [],
        "level": 3,
    }

    att_mod = skill_modifier(attacker, "deception")
    def_mod = skill_modifier(defender, "insight")

    att_expr = add_modifier_to_expr("1d20", att_mod)
    def_expr = add_modifier_to_expr("1d20", def_mod)

    att_res = roll_expression(att_expr)
    def_res = roll_expression(def_expr)

    att_total = att_res.get("total", 0)
    def_total = def_res.get("total", 0)

    local_winner = "tie"
    if att_total > def_total:
        local_winner = "attacker"
    elif def_total > att_total:
        local_winner = "defender"

    print("==== 欺瞒 vs 洞悉 对抗 Demo ====")
    print(f"解析结果: {parsed}")
    print(f"攻击者 {attacker['name']} | Expr={att_expr} | 总和={att_total}")
    print(f"防御者 {defender['name']} | Expr={def_expr} | 总和={def_total}")

    # 3) AI 判定阶段（可能给出不同意见；我们做兜底一致）
    ai_calls = {"count": 0}

    async def fake_completion_judge(api_url: str, api_key: str, model: str, messages, temperature: float = 0.2, max_tokens: int = 800):
        # 第二次调用：返回一个可能不一致的 winner，触发兜底
        ai_calls["count"] += 1
        if ai_calls["count"] == 1:
            return '{"winner":"attacker","public_summary":"你快速编造谎言，守卫犹豫了片刻。"}'
        return '{"winner":"defender"}'

    monkeypatch.setattr(AIService, "generate_completion", staticmethod(fake_completion_judge))

    facts = (
        f"type=contest; attacker={attacker['name']}; attacker_total={att_total}; "
        f"defender={defender['name']}; defender_total={def_total}; tie_rule=no_change"
    )
    ai_j = await ensure_strict_json(
        api_url="http://fake", api_key="x", model="gpt-5",
        messages=[{"role": "system", "content": "judge"}, {"role": "user", "content": f"Facts: {facts}"}],
        schema_hint='{"winner":"string","public_summary":"string?"}',
        max_attempts=3,
    )
    winner = (ai_j.get("winner") if isinstance(ai_j, dict) else None) or local_winner
    if winner not in ("attacker", "defender", "tie"):
        winner = local_winner
    if winner != local_winner:
        print(f"[Server Override] AI winner={ai_j.get('winner')} -> local={local_winner}")
        winner = local_winner

    print(f"最终胜负：{winner} | 摘要：{ai_j.get('public_summary') if isinstance(ai_j, dict) else ''}")


@pytest.mark.asyncio
async def test_save_adjudication_demo(monkeypatch):
    """
    Demo: 火球术 DEX 豁免 DC15 -> 单目标
    - AI 解析 -> ability=dexterity, dc=15
    - 掷骰 -> 1d20 + DEX 修正
    - AI 裁决 -> 若与本地不同，则本地覆盖
    打印完整日志
    """
    # Ensure env required by settings before importing modules
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://user:pass@localhost:5432/db")
    monkeypatch.setenv("REDIS_URL", "redis://localhost:6379/0")

    # Lazy import after env
    from app.services.ai_service import AIService
    from app.services.json_format_agent import ensure_strict_json



    # 解析
    async def fake_parse(api_url: str, api_key: str, model: str, messages, temperature: float = 0.2, max_tokens: int = 800):
        return '{"type":"save","ability":"dexterity","dc":15,"dice":"1d20","description":"火球术 敏捷豁免"}'

    monkeypatch.setattr(AIService, "generate_completion", staticmethod(fake_parse))

    parsed = await ensure_strict_json(
        api_url="http://fake", api_key="x", model="gpt-5",
        messages=[{"role": "system", "content": "extract"}, {"role": "user", "content": "火球术 DEX 豁免 DC15"}],
        schema_hint='{"type":"string","ability":"string","dc":"number"}',
        max_attempts=3,
    )
    check = normalize_check(parsed)

    char = {"ability_scores": {"dexterity": 14}, "selected_skills": [], "expertise_skills": [], "level": 1}
    mod = ability_check_modifier(char, "dexterity")
    expr = add_modifier_to_expr("1d20", mod)
    res = roll_expression(expr)

    total = res.get("total", 0)
    dc = check.get("dc")
    local_success = total >= dc

    print("==== 豁免裁决 Demo ====")
    print(f"解析结果: {parsed}")
    print(f"Expr={expr} | 总和={total} | DC={dc}")

    # AI 裁决（假设第一次给出错误，触发覆盖）
    ai_counter = {"c": 0}

    async def fake_judge(api_url: str, api_key: str, model: str, messages, temperature: float = 0.2, max_tokens: int = 800):
        ai_counter["c"] += 1
        return '{"success": false, "public_summary": "火焰呼啸而过，你没能完全躲开。"}'

    monkeypatch.setattr(AIService, "generate_completion", staticmethod(fake_judge))

    facts = f"type=save; ability=dexterity; dc={dc}; total={total}; modifier={res.get('modifier')}; rolls={res.get('rolls')}"
    ai_j = await ensure_strict_json(
        api_url="http://fake", api_key="x", model="gpt-5",
        messages=[{"role": "system", "content": "judge"}, {"role": "user", "content": f"Facts: {facts}"}],
        schema_hint='{"success":"boolean","public_summary":"string?"}',
        max_attempts=3,
    )
    ai_success = bool(ai_j.get("success")) if isinstance(ai_j, dict) else None
    if ai_success != local_success:
        print(f"[Server Override] AI success={ai_success} -> local={local_success}")
        ai_success = local_success
    summary = ai_j.get("public_summary") if isinstance(ai_j, dict) else ""
    print(f"最终裁决：{'成功' if ai_success else '失败'} | 摘要：{summary}")
