"""冒险创作指南生成器 - 为空白模组提供引导章节

读取 frontend/app/data/creator/ 下的参考文件，生成结构化的创作指南。
"""

import json
from pathlib import Path

from app.utils.rules_cache import CREATOR_KB_PATH

CREATOR_DIR = CREATOR_KB_PATH


def _load(filename: str) -> dict:
    path = CREATOR_DIR / filename
    if not path.exists():
        return {}
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _bullets(items: list, key: str, limit: int = 10) -> str:
    lines = [f"- {item[key]}" for item in items[:limit]]
    if len(items) > limit:
        lines.append(f"- *...共{len(items)}项*")
    return "\n".join(lines)


# ── 各文件格式化器 ──────────────────────────────────────────


def _fmt_templates() -> str:
    data = _load("templates.json")
    templates = data.get("templates", [])
    if not templates:
        return "*模板数据未找到*"
    parts = ["以下预设模板可作为创作参考，帮助你了解不同冒险类型的结构：\n"]
    for t in templates:
        lvl = t.get("recommended_level", {})
        chapters = t.get("structure", {}).get("chapters", [])
        ch_str = " → ".join(c["title"] for c in chapters)
        goals = t.get("default_goals", [])
        parts.append(f"### {t.get('icon', '')} {t['name']} ({t.get('name_en', '')})")
        parts.append(f"- **类型**: {t.get('type', '')} | **等级**: {lvl.get('min', 1)}-{lvl.get('max', 5)} | **聚会**: {t.get('estimated_sessions', '')}")
        parts.append(f"- {t['description']}")
        if ch_str:
            parts.append(f"- **结构**: {ch_str}")
        if goals:
            parts.append(f"- **典型目标**: {'、'.join(goals[:3])}")
        parts.append("")
    return "\n".join(parts)


def _fmt_structure() -> str:
    data = _load("adventure-structure.json")
    parts = []
    # 大冒险要素
    elements = data.get("great_adventure_elements", {}).get("elements", [])
    if elements:
        parts.append("### 大冒险的7个要素\n")
        for e in elements:
            parts.append(f"- **{e['name']}**: {e['description']}")
        parts.append("")
    # 三幕结构
    phases = data.get("adventure_structure", {}).get("phases", [])
    if phases:
        parts.append("### 三幕结构\n")
        for p in phases:
            tips = p.get("tips", [])
            parts.append(f"**{p['name']}（{p.get('name_en', '')}）**: {p['description']}")
            for tip in tips[:2]:
                parts.append(f"- {tip}")
            parts.append("")
    # 冒险类型
    types = data.get("adventure_types", {}).get("types", [])
    if types:
        parts.append("### 冒险类型\n")
        for t in types:
            steps = t.get("creation_steps", [])
            parts.append(f"**{t['name']}**: {t['description']}")
            if steps:
                step_names = [s.split(". ", 1)[-1] if ". " in s else s for s in steps]
                parts.append(f"- 创建步骤: {' → '.join(step_names)}")
            parts.append("")
    return "\n".join(parts)


def _fmt_goals() -> str:
    data = _load("adventure-goals.json")
    parts = []
    sections = [
        ("dungeon_goals", "地下城目标"),
        ("wilderness_goals", "野外目标"),
        ("other_goals", "其他目标"),
        ("event_based_goals", "事件目标"),
    ]
    for key, title in sections:
        section = data.get(key, {})
        items = section.get("items", [])
        if items:
            parts.append(f"### {title}（{section.get('dice', '')}）\n")
            parts.append(_bullets(items, "goal"))
            parts.append("")
    return "\n".join(parts)


def _fmt_villains() -> str:
    data = _load("villains-npcs.json")
    parts = []
    # 反派类型
    vtypes = data.get("villain_types", {}).get("items", [])
    if vtypes:
        parts.append("### 反派类型（d20）\n")
        parts.append(_bullets(vtypes, "type"))
        parts.append("")
    # 反派行为模式
    actions = data.get("villain_actions", {}).get("items", [])
    if actions:
        parts.append("### 反派行为模式\n")
        for a in actions:
            parts.append(f"- **{a['type']}**（{a.get('type_en', '')}）: {a['description'][:80]}...")
        parts.append("")
    # 动机
    motivations = data.get("villain_motivations", {}).get("categories", [])
    if motivations:
        parts.append("### 反派动机\n")
        for cat in motivations:
            parts.append(f"- **{cat['category']}**: {'、'.join(cat['items'])}")
        parts.append("")
    # 盟友与主顾
    allies = data.get("allies", {}).get("items", [])
    if allies:
        parts.append("### 冒险盟友\n")
        parts.append(_bullets(allies, "type"))
        parts.append("")
    return "\n".join(parts)


def _fmt_npc_traits() -> str:
    data = _load("npc-traits.json")
    parts = []
    # 十大要素
    guide = data.get("npc_creation_guide", {})
    elements = guide.get("elements", [])
    if elements:
        parts.append("### NPC创建十大要素\n")
        parts.append("、".join(elements))
        parts.append(f"\n> {guide.get('ai_prompt', '')}\n")
    # 角色定位
    roles = data.get("npc_roles", {}).get("roles", [])
    if roles:
        parts.append("### NPC角色定位\n")
        for r in roles:
            parts.append(f"- **{r['role']}**（重要性: {r['importance']}）: {r['detail_level']}")
        parts.append("")
    # 关键随机表摘要
    tables = [
        ("appearance", "外貌特征", "trait"),
        ("talents", "天赋", "talent"),
        ("mannerisms", "癖好", "mannerism"),
        ("interaction_traits", "互动特质", "trait"),
    ]
    for key, title, item_key in tables:
        section = data.get(key, {})
        items = section.get("items", [])
        if items:
            parts.append(f"### {title}（{section.get('dice', '')}）\n")
            parts.append(_bullets(items, item_key, limit=6))
            parts.append("")
    return "\n".join(parts)


def _fmt_dungeons() -> str:
    data = _load("dungeons.json")
    parts = []
    # 用途
    purposes = data.get("dungeon_purpose", {}).get("items", [])
    if purposes:
        parts.append("### 地下城用途\n")
        for p in purposes:
            features = "、".join(p.get("features", []))
            parts.append(f"- **{p['purpose']}**（{p.get('purpose_en', '')}）: {p['description'][:60]}...")
            if features:
                parts.append(f"  - 特征: {features}")
        parts.append("")
    # 建造者
    creators = data.get("dungeon_creator", {}).get("items", [])
    if creators:
        parts.append("### 地下城建造者\n")
        for c in creators[:8]:
            features = "、".join(c.get("features", []))
            parts.append(f"- **{c['creator']}**: {features}")
        parts.append("")
    # 设计建议
    tips = data.get("dungeon_design_tips", {}).get("tips", [])
    if tips:
        parts.append("### 设计建议\n")
        for t in tips:
            parts.append(f"- **{t['tip']}**: {t['reason']}")
        parts.append("")
    return "\n".join(parts)


def _fmt_encounters() -> str:
    data = _load("encounters.json")
    parts = []
    # 遭遇目标
    objectives = data.get("encounter_objectives", {}).get("items", [])
    if objectives:
        parts.append("### 遭遇目标\n")
        for o in objectives:
            parts.append(f"- **{o['name']}**（{o.get('type', '')}）: {o['description'][:60]}...")
        parts.append("")
    # 难度等级
    levels = data.get("difficulty_levels", {}).get("levels", [])
    if levels:
        parts.append("### 难度等级\n")
        for lv in levels:
            parts.append(f"- **{lv['level']}**（{lv['level_en']}）: {lv['description']}")
        parts.append("")
    # XP阈值表（精选）
    xp_table = data.get("xp_thresholds", {}).get("table", [])
    if xp_table:
        parts.append("### 经验阈值（部分）\n")
        parts.append("| 等级 | 简单 | 中等 | 困难 | 致命 |")
        parts.append("|------|------|------|------|------|")
        for row in xp_table:
            if row["level"] in (1, 3, 5, 8, 10, 15, 20):
                parts.append(f"| {row['level']} | {row['easy']} | {row['medium']} | {row['hard']} | {row['deadly']} |")
        parts.append("")
    # 遭遇倍数
    multipliers = data.get("encounter_multipliers", {}).get("table", [])
    if multipliers:
        parts.append("### 多怪物XP倍数\n")
        for m in multipliers:
            parts.append(f"- {m['monster_count']}只怪物: ×{m['multiplier']}")
        parts.append("")
    return "\n".join(parts)


def _fmt_planes() -> str:
    data = _load("planes.json")
    parts = []
    # 位面分类
    categories = data.get("plane_categories", {}).get("categories", [])
    if categories:
        parts.append("### 位面分类\n")
        for c in categories:
            planes = "、".join(c.get("planes", []))
            parts.append(f"**{c['name']}**: {planes}")
            parts.append(f"- {c['description']}\n")
    # 外层位面（精选）
    outer = data.get("outer_planes", {}).get("planes", [])
    if outer:
        parts.append("### 外层位面\n")
        parts.append("| 位面 | 阵营 | 简介 |")
        parts.append("|------|------|------|")
        for p in outer:
            parts.append(f"| {p['name']} | {p['alignment']} | {p['description']} |")
        parts.append("")
    # 回响位面
    echoes = data.get("echo_planes", {}).get("planes", [])
    if echoes:
        parts.append("### 物质位面的回响\n")
        for e in echoes:
            parts.append(f"**{e['name']}**（{e.get('name_en', '')}）: {e['description']}")
            dangers = e.get("dangers", [])
            if dangers:
                parts.append(f"- 危险: {'、'.join(dangers)}")
            parts.append("")
    # 位面旅行
    methods = data.get("planar_travel", {}).get("methods", [])
    if methods:
        parts.append("### 位面旅行方式\n")
        for m in methods:
            desc = m.get("description", m.get("method_en", ""))
            parts.append(f"- **{m['method']}**: {desc[:60]}{'...' if len(desc) > 60 else ''}")
        parts.append("")
    return "\n".join(parts)


def _fmt_treasure() -> str:
    data = _load("treasure-rewards.json")
    parts = []
    # 宝藏类型
    types = data.get("treasure_types", {}).get("types", [])
    if types:
        parts.append("### 宝藏类型\n")
        for t in types:
            parts.append(f"- **{t['type']}**（{t.get('type_en', '')}）: {t.get('description', t.get('note', ''))}")
        parts.append("")
    # 魔法物品稀有度
    rarity = data.get("magic_item_rarity", {}).get("table", [])
    if rarity:
        parts.append("### 魔法物品稀有度\n")
        parts.append("| 稀有度 | 最低等级 | 价值范围 |")
        parts.append("|--------|----------|----------|")
        for r in rarity:
            parts.append(f"| {r['rarity']} | {r['min_level']} | {r['value_range']} |")
        parts.append("")
    # 宝石表（精选）
    gems = data.get("gemstones", {}).get("tables", [])
    if gems:
        parts.append("### 宝石价值等级\n")
        for g in gems:
            names = "、".join(item["name"] for item in g.get("gems", [])[:4])
            parts.append(f"- **{g['value']}**: {names}...")
        parts.append("")
    # 库藏宝藏
    hoards = data.get("hoard_treasure", {}).get("tables", [])
    if hoards:
        parts.append("### 库藏宝藏基础硬币\n")
        for h in hoards:
            coins = h.get("base_coins", {})
            coin_str = ", ".join(f"{k}: {v}" for k, v in coins.items())
            parts.append(f"- **CR {h['cr_range']}**: {coin_str}")
        parts.append("")
    return "\n".join(parts)


def _fmt_complications() -> str:
    data = _load("complications.json")
    parts = []
    # 道义困境
    quandaries = data.get("moral_quandaries", {}).get("items", [])
    if quandaries:
        parts.append("### 道义困境\n")
        for q in quandaries:
            parts.append(f"- **{q['type']}**: {q['description'][:80]}...")
        parts.append("")
    # 转折
    twists = data.get("twists", {}).get("items", [])
    if twists:
        parts.append("### 故事转折（d10）\n")
        parts.append(_bullets(twists, "twist"))
        parts.append("")
    # 支线任务
    side = data.get("side_quests", {}).get("items", [])
    if side:
        parts.append("### 支线任务（d8）\n")
        parts.append(_bullets(side, "quest"))
        parts.append("")
    # 反派计谋
    schemes = data.get("villain_schemes", {}).get("categories", [])
    if schemes:
        parts.append("### 反派计谋类型\n")
        for s in schemes:
            items = s.get("schemes", [])
            parts.append(f"- **{s['category']}**: {'、'.join(items[:3])}...")
        parts.append("")
    return "\n".join(parts)


def _fmt_wilderness() -> str:
    data = _load("wilderness.json")
    parts = []
    # 旅行方式
    approaches = data.get("travel_approaches", {}).get("approaches", [])
    if approaches:
        parts.append("### 旅行推进方式\n")
        for a in approaches:
            parts.append(f"**{a['name']}**（{a.get('nameEn', '')}）: {a['description']}")
            tips = a.get("tips", [])
            for tip in tips[:2]:
                parts.append(f"- {tip}")
            parts.append("")
    # 导航DC
    nav = data.get("navigation", {}).get("terrain_dc", [])
    if nav:
        parts.append("### 导航难度\n")
        for n in nav:
            parts.append(f"- **DC {n['dc']}**: {n['terrain']}")
        parts.append("")
    # 野外危害物
    hazards = data.get("hazards", {}).get("items", [])
    if hazards:
        parts.append("### 野外危害物\n")
        for h in hazards:
            parts.append(f"- **{h['name']}**（{h.get('nameEn', '')}）: {h.get('effect', '')[:60]}...")
        parts.append("")
    # 诡异地点
    weird = data.get("weird_locales", {}).get("items", [])
    if weird:
        parts.append("### 诡异地点（d20）\n")
        parts.append(_bullets(weird, "locale", limit=6))
        parts.append("")
    return "\n".join(parts)


def _fmt_settlements() -> str:
    data = _load("settlements.json")
    parts = []
    # 聚居地类型
    types = data.get("settlement_basics", {}).get("types", [])
    if types:
        parts.append("### 聚居地类型\n")
        for t in types:
            features = "、".join(t.get("features", []))
            parts.append(f"- **{t['type']}**（{t.get('typeEn', '')}）: {features}")
        parts.append("")
    # 统治者形象
    rulers = data.get("ruler_status", {}).get("items", [])
    if rulers:
        parts.append("### 统治者形象（d20）\n")
        parts.append(_bullets(rulers, "result", limit=8))
        parts.append("")
    # 重要特色
    traits = data.get("notable_traits", {}).get("items", [])
    if traits:
        parts.append("### 重要特色（d20）\n")
        parts.append(_bullets(traits, "trait", limit=8))
        parts.append("")
    # 当前灾祸
    calamities = data.get("current_calamity", {}).get("items", [])
    if calamities:
        parts.append("### 当前灾祸（d20）\n")
        parts.append(_bullets(calamities, "calamity", limit=8))
        parts.append("")
    # 酒馆名生成器
    first = data.get("tavern_name_generator", {}).get("first_half", [])
    second = data.get("tavern_name_generator", {}).get("second_half", [])
    if first and second:
        parts.append("### 酒馆名生成器\n")
        f_names = "、".join(item["name"] for item in first[:6])
        s_names = "、".join(item["name"] for item in second[:6])
        parts.append(f"- **前缀**: {f_names}...")
        parts.append(f"- **后缀**: {s_names}...")
        parts.append('- 例如: "醉熏鹰"、"银狼"、"大笑牡鹿"')
        parts.append("")
    return "\n".join(parts)


# ── 主函数 ──────────────────────────────────────────


_CHAPTER_DEFS = [
    ("templates.json", "冒险模板参考", _fmt_templates),
    ("adventure-structure.json", "叙事结构", _fmt_structure),
    ("adventure-goals.json", "冒险目标", _fmt_goals),
    ("villains-npcs.json", "反派与NPC", _fmt_villains),
    ("npc-traits.json", "NPC特征系统", _fmt_npc_traits),
    ("dungeons.json", "地下城设计", _fmt_dungeons),
    ("encounters.json", "遭遇设计", _fmt_encounters),
    ("planes.json", "位面参考", _fmt_planes),
    ("treasure-rewards.json", "宝藏与奖励", _fmt_treasure),
    ("complications.json", "故事复杂度", _fmt_complications),
    ("wilderness.json", "荒野旅行", _fmt_wilderness),
    ("settlements.json", "城镇创建", _fmt_settlements),
]


def build_guide_chapters() -> list[dict]:
    """构建创作指南章节列表。

    返回一个章节列表，包含一个"冒险创作指南"引导章节，
    其 children 为12个子章节，每个对应一个参考文件。
    """
    children = []
    for _filename, title, fmt_fn in _CHAPTER_DEFS:
        content = fmt_fn()
        children.append({"title": title, "content": content, "children": []})

    guide_content = (
        "这是一份基于《城主指南》的冒险模组创作参考指南。"
        "展开下方各子章节可查看对应的创作参考资料。\n\n"
        "**包含内容**: 冒险模板、叙事结构、目标设定、反派与NPC创建、"
        "地下城设计、遭遇平衡、位面参考、宝藏奖励、"
        "故事复杂度、荒野旅行、城镇创建。\n\n"
        "> 创作完成后可删除此引导章节。"
    )

    return [
        {
            "title": "冒险创作指南",
            "content": guide_content,
            "children": children,
        }
    ]
