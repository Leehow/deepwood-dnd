from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.module_chat import ModuleChatMessage


def collect_module_encounters(chapters_data: Sequence[Any] | None) -> list[Any]:
    """Collect encounter definitions from top-level chapter payloads."""
    encounters: list[Any] = []
    for chapter in chapters_data or []:
        if isinstance(chapter, Mapping):
            chapter_encounters = chapter.get("encounters", [])
            if chapter_encounters:
                encounters.extend(chapter_encounters)
    return encounters


def build_player_info_text(player_info: Mapping[str, Any]) -> str:
    """Render player info guidance for encounter planning prompts."""
    players = player_info.get("players", [])
    if players:
        player_list = ", ".join(
            f"{player['name']}({player['class']} Lv{player['level']})" for player in players
        )
        return f"""
## 玩家队伍信息
- 玩家人数: {player_info['count']}
- 队伍成员: {player_list}
- 平均等级: {player_info['average_level']}
- 推荐遭遇CR: {player_info['average_level']} (可根据密度调整±2)
"""

    return """
## 玩家队伍信息
- 未检测到已选角色，假设4名1级玩家
- 推荐遭遇CR: 1/4 到 1
"""


def build_source_instructions(source_mode: str, module_encounters: Sequence[Any]) -> str:
    """Build source-mode guidance for encounter planning prompts."""
    if source_mode == "module_only":
        base = """## 遭遇来源模式：仅使用模组遭遇
**重要**：只能使用模组中已定义的遭遇配置，不要自创任何新遭遇。
如果模组中没有对应区域的遭遇数据，该区域标注为"无遭遇"。
"""
        if module_encounters:
            encounters_text = "\n".join(
                [
                    f"- {encounter}"
                    if isinstance(encounter, str)
                    else f"- {encounter.get('name', '未知遭遇')}"
                    for encounter in module_encounters[:20]
                ]
            )
            return f"{base}\n## 模组中定义的遭遇\n{encounters_text}\n"
        return base

    if source_mode == "ai_free":
        return """## 遭遇来源模式：AI自由创造
你可以自由设计遭遇配置，但怪物必须使用预设列表或模组中的怪物。
可以根据地图特点和玩家等级自由搭配怪物组合。
"""

    base = """## 遭遇来源模式：模组+AI扩展
优先参考模组中已定义的遭遇，在此基础上根据密度设置进行扩展。
可以增加怪物数量或在空白区域添加新遭遇，但要保持与模组风格一致。
"""
    if module_encounters:
        encounters_text = "\n".join(
            [
                f"- {encounter}"
                if isinstance(encounter, str)
                else f"- {encounter.get('name', '未知遭遇')}: {encounter.get('description', '')}"
                for encounter in module_encounters[:15]
            ]
        )
        return f"{base}\n## 模组中定义的遭遇（可作为参考和扩展基础）\n{encounters_text}\n"
    return base


def build_plan_system_prompt(
    *,
    module_title: str,
    current_chapter: str | None,
    context: str,
    player_info: Mapping[str, Any],
    density: str,
    source_mode: str,
    module_encounters: Sequence[Any],
    preset_names: Sequence[str],
    module_monster_names: Sequence[str],
) -> str:
    density_hints = {
        "sparse": "稀疏（每个区域1-2只怪物，总共5-8只）",
        "normal": "正常（每个区域2-4只怪物，总共10-15只）",
        "dense": "密集（每个区域4-6只怪物，总共15-25只）",
    }
    current_chapter_hint = f"\n\n**当前地图章节**: {current_chapter}" if current_chapter else ""
    density_text = density_hints.get(density, density_hints["normal"])

    return f"""你是一位专业的DM助手，正在帮助DM为D&D冒险模组《{module_title}》规划地图遭遇。{current_chapter_hint}

请分析这张地图，结合模组内容和玩家信息，为每个区域规划怪物/NPC配置。

{build_player_info_text(player_info)}

## 怪物密度设置
DM选择的密度: {density_text}

{build_source_instructions(source_mode, module_encounters)}

## 可用的预设怪物（确保名称完全匹配）
{', '.join(preset_names[:30])}

## 模组中的怪物/NPC
{', '.join(module_monster_names) if module_monster_names else '无'}

## 输出格式

请用以下格式输出规划结果（每个区域一个段落）：

### 区域名称
- **位置**: x%, y%（地图上的百分比位置，0%=左上角）
- **怪物**: 怪物名称 ×数量（如：地精 ×3）【必须使用上面列出的怪物名称】
- **NPC**: NPC名称及角色（如有）
- **战利品**: 金币数量、物品列表（根据CR合理分配）
- **环境**: 光照、地形描述
- **战术建议**: DM参考

## 规则
1. **怪物名称必须完全匹配**上面列出的预设怪物或模组怪物，不要自创或使用变体名称
2. 根据玩家等级和密度设置调整怪物数量和CR
3. 战利品参考：CR 1/4=5sp；CR 1=5gp；CR 5=50gp+普通魔法物品
4. 位置百分比要准确对应地图上的视觉位置
5. 规划3-8个有怪物的区域

## 当前模组上下文

{context}"""


def build_modify_system_prompt(
    *,
    current_plan: str,
    modification: str,
    preset_names: Sequence[str],
    module_monster_names: Sequence[str],
) -> str:
    return f"""你是一位专业的DM助手。请根据用户的修改要求，调整以下遭遇规划。

## 可用的预设怪物（必须使用这些名称）
{', '.join(preset_names[:30])}

## 模组中的怪物/NPC
{', '.join(module_monster_names) if module_monster_names else '无'}

## 当前规划
{current_plan}

## 用户的修改要求
{modification}

请输出修改后的完整规划，保持相同的格式。只修改用户要求的部分，其他保持不变。
如果用户要求添加/删除/替换怪物，确保使用上面列出的怪物名称。"""


def build_plan_assistant_content(content: str, player_info: Mapping[str, Any]) -> str:
    player_summary = ""
    if player_info.get("players"):
        player_summary = (
            f"\n\n**队伍信息**: {player_info['count']}名玩家，平均等级 {player_info['average_level']}"
        )
    return f"## 🗺️ 地图遭遇规划{player_summary}\n\n{content}\n\n---\n*使用下方按钮执行或修改规划*"


def build_modify_assistant_content(content: str, modification: str) -> str:
    return (
        f"## 🗺️ 修改后的遭遇规划\n\n**修改内容**: {modification}\n\n{content}\n\n---\n*使用下方按钮执行或继续修改*"
    )


async def persist_encounter_plan_message(
    *,
    db: AsyncSession,
    module_id: str,
    user_id: str,
    content: str,
    plan_text: str,
    map_url: str,
) -> ModuleChatMessage:
    message = ModuleChatMessage(
        module_id=module_id,
        user_id=user_id,
        role="assistant",
        content=content,
        analyzed_entities={
            "type": "encounter_plan",
            "plan_text": plan_text,
            "map_url": map_url,
        },
    )
    db.add(message)
    await db.commit()
    await db.refresh(message)
    return message
