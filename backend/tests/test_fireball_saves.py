import os
import pytest
from typing import List, Dict


@pytest.mark.asyncio
async def test_fireball_dex_save_multi_target_demo(monkeypatch):
    """
    End-to-end style demo for: "火球术 DEX 豁免 DC 15，多目标"
    - Step 1: Analyze (via ensure_strict_json) -> ability=dexterity, dc=15, dice=1d20, description
    - Step 2: For each target, use the unified dice tool (roll_expression) with computed modifier
    - Step 3: Decide success >= DC, print clear log lines
    """
    # Ensure required env vars exist before importing app modules
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://user:pass@localhost:5432/db")
    monkeypatch.setenv("REDIS_URL", "redis://localhost:6379/0")

    from app.services.json_format_agent import ensure_strict_json
    from app.services.ai_service import AIService
    from app.utils.dice import add_modifier_to_expr, roll_expression, ability_check_modifier

    # Simulate DM message and recipients (multi-target)
    original = "火球术 DEX 豁免 DC 15，目标为全体玩家"

    # Monkeypatch AI to require one fixer round: first non-JSON, then strict JSON
    responses = [
        "请进行敏捷豁免，DC十五。",  # initial non-JSON
        '{"ability":"dexterity","dc":15,"dice":"1d20","description":"火球术 敏捷豁免"}',
    ]
    idx = {"i": 0}

    async def fake_generate_completion(api_url: str, api_key: str, model: str,
                                       messages: List[Dict[str, str]],
                                       temperature: float = 0.2, max_tokens: int = 800) -> str:
        i = idx["i"]
        idx["i"] = min(i + 1, len(responses) - 1)
        return responses[i]

    monkeypatch.setattr(AIService, "generate_completion", staticmethod(fake_generate_completion))

    # Construct prompts like websocket dice_analyze
    sys_prompt = (
        "You are a D&D 5e assistant that extracts ability/skill check info from Chinese descriptions. "
        "Abilities: strength, dexterity, constitution, intelligence, wisdom, charisma. "
        "Skills: athletics, acrobatics, sleight_of_hand, stealth, arcana, history, investigation, nature, religion, "
        "animal_handling, insight, medicine, perception, survival, deception, intimidation, performance, persuasion. "
        "Return STRICT JSON with keys: ability (optional), skill (optional), dc (number, optional), dice (optional, default '1d20'), description (optional). "
        "Only output the JSON object."
    )
    user_prompt = f"消息：{original}\n请提取检定信息并返回JSON。不要输出解释。"

    # Analyze with JSON fixer agent
    parsed = await ensure_strict_json(
        api_url="http://dummy",
        api_key="dummy",
        model="gpt-5",
        messages=[{"role": "system", "content": sys_prompt}, {"role": "user", "content": user_prompt}],
        schema_hint='{"ability":"string?","skill":"string?","dc":"number?","dice":"string?","description":"string?"}',
        temperature=0.2,
        max_tokens=300,
        max_attempts=3,
    )

    assert parsed.get("ability") == "dexterity"
    assert parsed.get("dc") == 15
    dice_expr = parsed.get("dice", "1d20")

    # Multi-target demo: two players with different DEX ability scores
    # Player A: DEX 14 -> +2; Player B: DEX 8 -> -1
    players = [
        {"name": "玩家A", "ability_scores": {"dexterity": 14}},
        {"name": "玩家B", "ability_scores": {"dexterity": 8}},
    ]

    print("==== 火球术 多目标 DEX 豁免 Demo ====")
    print(f"解析结果: ability={parsed['ability']}, dc={parsed['dc']}, dice={dice_expr}, desc={parsed.get('description')}")

    for p in players:
        char_dict = {"ability_scores": p["ability_scores"], "selected_skills": [], "expertise_skills": [], "level": 1}
        mod = ability_check_modifier(char_dict, "dexterity")
        final_expr = add_modifier_to_expr(dice_expr, mod)
        result = roll_expression(final_expr)
        total = result.get("total", 0)
        success = total >= parsed["dc"]
        print(f"{p['name']} | DEX mod={mod:+d} | 表达式={final_expr} | 掷骰总和={total} | 结果={'成功' if success else '失败'}")

