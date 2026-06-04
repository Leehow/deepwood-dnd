"""
Monster & Item Extractor Service
Extracts monsters and items from appendix content using LLM
"""
import asyncio
import json
import httpx
import logging
import os
import re
from typing import List, Dict, Any, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.parsed_module import ParsedModule
from app.services.ai_model_service import ai_model_service

logger = logging.getLogger(__name__)


MONSTER_EXTRACT_PROMPT = """你是D&D 5E怪物数据提取专家。请从以下内容中识别并提取每个怪物的属性卡。

## 怪物属性卡识别规则
只要内容包含以下**任意一组**特征，就是怪物属性卡：
1. 有 AC（护甲等级）和 HP（生命值）
2. 有六项属性值（力量、敏捷、体质、智力、感知、魅力）
3. 有挑战等级（CR）

常见格式：
- 标准格式："中型类人生物，混乱邪恶 AC: 13 HP: 27..."
- 简化格式："AC：15 HP：18 速度：30尺..."
- 表格格式：属性值以表格形式呈现

## 必须忽略的内容
以下内容**不是**怪物属性卡，请忽略：
- **巢穴描述**：标题含"的巢穴"/"'s Lair"，内容描述环境但**没有AC/HP**
- **疯狂效果**：标题含"的疯狂"/"Madness of"，是d100疯狂表格
- **区域效应**：标题含"区域效应"/"Regional Effect"，描述巢穴周边效果
- **纯背景描述**：只有故事文字，没有任何游戏数值

## 重要：合并相关内容
输入中，某些怪物的"动作 Actions"、"传奇动作 Legendary Actions"、"巢穴动作 Lair Actions"等可能作为**独立的段落/章节**出现在怪物属性卡之后。请将这些内容**合并到前面最近的怪物**的description中。例如：
- 段落1："阿瑟瑞克 Acererak"（有AC/HP） → 这是怪物属性卡
- 段落2："动作 Actions"（没有AC/HP，紧跟其后） → 合并到阿瑟瑞克的description中
- 段落3："传奇动作 Legendary Actions"（没有AC/HP） → 合并到阿瑟瑞克的description中

## 输入内容
{content}

## 输出要求
提取所有有AC/HP的怪物，返回JSON数组：
- name: 中文名称
- name_en: 英文名称（如果有）
- description: 完整内容，**必须包含**：体型类型阵营、AC、HP、速度、属性值、技能、感官、语言、CR、特性、动作、传奇动作（如果有）等。将后续出现的动作/传奇动作段落一并合入

## 宽松原则
- 格式不标准也要提取（只要有AC/HP）
- 内容不完整也要提取（能提取多少就提取多少）
- 宁可多提取，不要漏掉
- 后续的动作/传奇动作段落一定要合并到前面的怪物中

只返回JSON数组，不要其他内容。"""


ITEM_EXTRACT_PROMPT = """你是D&D 5E魔法物品数据提取专家。请从以下魔法物品附录内容中提取每个物品的信息。

## 输入内容
{content}

## 输出要求
提取每个魔法物品，返回JSON数组，每个物品包含：
- name: 中文名称
- name_en: 英文名称（如果有）
- description: 物品描述、稀有度、属性、能力等，保持原文格式

## 示例输出
[
  {{
    "name": "黑龙面具",
    "name_en": "Black Dragon Mask",
    "description": "奇物（传奇物品），需要同调\\n这副面具是龙邪教的象征...\\n**黑暗视觉** 佩戴者在黑暗中能看到60尺范围内..."
  }}
]

只返回JSON数组，不要其他内容。"""


ITEM_STRUCTURE_PROMPT = """从以下D&D 5E魔法物品描述中提取完整的结构化数据。物品名称：{name}

## 物品描述
{description}

请提取以下信息并以JSON格式返回（如果信息不存在则返回null）：
{{
  "rarity": "<稀有度：普通/非普通/稀有/非常稀有/传奇/神器>",
  "type": "<物品类型：武器/护甲/戒指/法杖/权杖/魔杖/药水/卷轴/奇物/其他>",
  "subtype": "<具体类型，如长剑、板甲、治疗药水>",
  "attunement": <是否需要同调: true/false>,
  "attunementRequirement": "<同调要求，如施法者、善良阵营>",
  "charges": {{
    "max": <最大充能数>,
    "recharge": "<恢复方式，如黎明时恢复1d4+1>"
  }},
  "bonus": "<加值，如+1、+2、+3>",
  "damage": "<额外伤害，如1d6火焰伤害>",
  "properties": ["<特殊属性1>", "<特殊属性2>"],
  "effects": [
    {{"name": "<效果名>", "description": "<效果描述>"}}
  ],
  "cursed": <是否为诅咒物品: true/false>,
  "curseEffect": "<诅咒效果描述>"
}}

只返回JSON，不要其他内容。"""


MONSTER_STRUCTURE_PROMPT = """从以下D&D 5E怪物描述中提取完整的结构化数据。怪物名称：{name}

## 怪物描述
{description}

请提取以下信息并以JSON格式返回（如果信息不存在则返回null）：
{{
  "ac": <护甲等级数字>,
  "acDesc": "<护甲类型描述，如天生护甲、皮甲>",
  "hp": <生命值数字>,
  "hp_formula": "<HP骰子公式，如2d8+4>",
  "cr": "<挑战等级，如1/4, 1, 5>",
  "xp": <经验值数字>,
  "size": "<体型：微型/小型/中型/大型/超大型/巨型>",
  "type": "<生物类型，如人形生物、野兽、亡灵>",
  "alignment": "<阵营，如守序邪恶、中立>",
  "speed": {{
    "walk": <步行速度数字>,
    "fly": <飞行速度数字或null>,
    "swim": <游泳速度数字或null>,
    "climb": <攀爬速度数字或null>,
    "burrow": <掘地速度数字或null>
  }},
  "abilityScores": {{
    "str": <力量>, "strMod": <力量调整值>,
    "dex": <敏捷>, "dexMod": <敏捷调整值>,
    "con": <体质>, "conMod": <体质调整值>,
    "int": <智力>, "intMod": <智力调整值>,
    "wis": <感知>, "wisMod": <感知调整值>,
    "cha": <魅力>, "chaMod": <魅力调整值>
  }},
  "savingThrows": {{"str": <数值>, "dex": <数值>, ...}} 或 null,
  "skills": {{"perception": <数值>, ...}} 或 null,
  "senses": "<感官描述>",
  "languages": "<语言>",
  "damageImmunities": "<伤害免疫>",
  "damageResistances": "<伤害抗性>",
  "conditionImmunities": "<状态免疫>",
  "specialAbilities": [
    {{
      "name": "<能力名>",
      "description": "<描述>",
      "recharge": "<充能条件如5-6或null>",
      "uses": "<使用次数如3/day或null>",
      "save": {{
        "ability": "<豁免属性如dex/con/wis或null>",
        "dc": <豁免DC数字或null>
      }} 或 null
    }}
  ],
  "actions": [
    {{
      "name": "<动作名>",
      "description": "<完整描述>",
      "action_category": "<multiattack/weapon_attack/special_attack/spell/other>",
      "attack_type": "<melee/ranged/melee_or_ranged或null>",
      "attack_bonus": <攻击加值数字或null>,
      "reach": "<触及距离如5尺或null>",
      "range": "<远程范围如30/120尺或null>",
      "damage": {{
        "dice": "<纯骰子如2d6>",
        "bonus": <加值数字如3>,
        "average": <平均伤害数字>,
        "type": "<伤害类型中文：穿刺/挥砍/钝击/火焰/冰冷/闪电/雷鸣/强酸/毒素/黯蚀/光耀/心灵/力场>"
      }} 或 null,
      "extra_damage": {{
        "dice": "<额外伤害骰>",
        "type": "<额外伤害类型中文>"
      }} 或 null,
      "save": {{
        "ability": "<豁免属性中文：力量/敏捷/体质/智力/感知/魅力>",
        "dc": <豁免DC数字>,
        "success_effect": "<成功效果如伤害减半>"
      }} 或 null,
      "area": {{
        "shape": "<锥形/球形/线形/立方体>",
        "size": "<如30尺>"
      }} 或 null,
      "usage": {{
        "type": "<recharge或per_day>",
        "value": "<充能值如5-6或每日次数数字>"
      }} 或 null,
      "multiattack_actions": ["<引用动作中文名>"] 或 null
    }}
  ],
  "reactions": [
    {{"name": "<反应名>", "description": "<描述>"}}
  ] 或 null,
  "legendaryActions": [
    {{
      "name": "<传奇动作名>",
      "description": "<描述>",
      "cost": <消耗次数，默认1>,
      "attack_bonus": <攻击加值或null>,
      "damage": {{"dice": "<纯骰子>", "bonus": <加值>, "average": <平均伤害>, "type": "<类型中文>"}} 或 null,
      "save": {{
        "ability": "<豁免属性中文：力量/敏捷/体质/智力/感知/魅力>",
        "dc": <豁免DC数字>,
        "success_effect": "<成功效果>"
      }} 或 null
    }}
  ] 或 null,
  "spellcasting": {{
    "level": <施法者等级数字如20>,
    "ability": "<施法关键属性，如智力/感知/魅力>",
    "dc": <法术豁免DC数字>,
    "attackBonus": <法术攻击加值数字>,
    "spells": {{
      "cantrips": ["<戏法名1>", "<戏法名2>"],
      "1st": {{"slots": <法术位数>, "spells": ["<法术名>"]}},
      "2nd": {{"slots": <法术位数>, "spells": ["<法术名>"]}},
      "3rd": {{"slots": <法术位数>, "spells": ["<法术名>"]}},
      "4th": {{"slots": <法术位数>, "spells": ["<法术名>"]}},
      "5th": {{"slots": <法术位数>, "spells": ["<法术名>"]}},
      "6th": {{"slots": <法术位数>, "spells": ["<法术名>"]}},
      "7th": {{"slots": <法术位数>, "spells": ["<法术名>"]}},
      "8th": {{"slots": <法术位数>, "spells": ["<法术名>"]}},
      "9th": {{"slots": <法术位数>, "spells": ["<法术名>"]}}
    }},
    "innate_spells": {{
      "at_will": ["<随意施放的法术>"],
      "3/day": ["<每日3次法术>"],
      "2/day": ["<每日2次法术>"],
      "1/day": ["<每日1次法术>"]
    }} 或 null
  }} 或 null
}}

重要分类说明：
- specialAbilities: 被动能力，如"魔法抗性"、"传奇抗性"等不需要消耗动作的能力。**施法能力(Spellcasting)不要放在这里**，要放在spellcasting字段。如果有使用次数（如传奇抗性3/日），填写uses字段。如果有充能条件（如喷吐武器充能5-6），填写recharge字段。如果涉及豁免DC，填写save字段。
- actions: 需要消耗动作的攻击或能力，如"多重攻击"、"喷吐武器"、近战/远程攻击等
- legendaryActions: 传奇动作，注意提取cost（消耗次数，如"消耗2动作"则cost=2），以及save字段和damage字段
- spellcasting: 如果怪物有"施法 Spellcasting"能力，必须提取到此字段。注意区分普通施法（有法术位）和天生施法（innate_spells，按每日次数分组）。只包含没有法术位的环级（即跳过该怪物没有的环级）。法术名保留中文原文。
- action_category: weapon_attack(有命中加值的攻击), special_attack(有豁免DC的能力), multiattack(多重攻击), spell(法术), other(其他)
- attack_type: 近战武器攻击=melee，远程武器攻击=ranged，都可以=melee_or_ranged
- damage.dice 和 bonus 分开：`2d6+5` → dice:"2d6", bonus:5
- damage.type 和 save.ability 必须用中文：挥砍/穿刺/钝击/火焰/冰冷/闪电/雷鸣/强酸/毒素/黯蚀/光耀/心灵/力场；力量/敏捷/体质/智力/感知/魅力
- multiattack 类型的 action 必须有 multiattack_actions 列出引用动作的中文名
- usage: 充能→{{"type":"recharge","value":"5-6"}}，每日次数→{{"type":"per_day","value":3}}

只返回JSON，不要其他内容。"""


class MonsterItemExtractor:
    """Service for extracting monsters and items from module appendices"""

    # Max chars per individual entry (truncate large entries)
    MAX_ENTRY_SIZE = 5000
    # Max chars per LLM batch request - reduced to ensure model processes all entries
    MAX_BATCH_SIZE = 15000

    # Cached preset monsters data
    _preset_monsters: Optional[List[Dict]] = None
    _preset_monsters_by_name: Optional[Dict[str, Dict]] = None

    @classmethod
    def _load_preset_monsters(cls) -> List[Dict]:
        """Load preset monsters from JSON file (cached)"""
        if cls._preset_monsters is not None:
            return cls._preset_monsters

        try:
            from app.utils.rules_cache import get_monsters_data
            data = get_monsters_data()
            cls._preset_monsters = data.get("monsters", [])
            cls._preset_monsters_by_name = {}
            for m in cls._preset_monsters:
                name = m.get("name", "").lower()
                name_en = m.get("nameEn", "").lower()
                if name:
                    cls._preset_monsters_by_name[name] = m
                if name_en:
                    cls._preset_monsters_by_name[name_en] = m
            logger.info(f"Loaded {len(cls._preset_monsters)} preset monsters")
            return cls._preset_monsters
        except Exception as e:
            logger.error(f"Failed to load preset monsters: {e}")

        cls._preset_monsters = []
        cls._preset_monsters_by_name = {}
        return cls._preset_monsters

    @classmethod
    def _find_preset_monster(cls, name: str, name_en: str = "") -> Optional[Dict]:
        """Find a monster in preset data by name (Chinese or English).

        Uses strict matching to avoid false positives like
        "Acererak" matching "Acererak and His Disciples".
        """
        cls._load_preset_monsters()

        if not cls._preset_monsters_by_name:
            return None

        # Try exact match first (by index key)
        name_lower = name.lower().strip()
        name_en_lower = name_en.lower().strip() if name_en else ""

        if name_lower in cls._preset_monsters_by_name:
            return cls._preset_monsters_by_name[name_lower]
        if name_en_lower and name_en_lower in cls._preset_monsters_by_name:
            return cls._preset_monsters_by_name[name_en_lower]

        # Partial match: only use English names (Chinese translations vary across modules)
        # Exact Chinese match is already handled above via the index lookup.
        for key, monster in cls._preset_monsters_by_name.items():
            m_name_en = monster.get("nameEn", "").lower()

            if name_en_lower and m_name_en:
                # Require same word count to avoid
                # "Kobold" matching "Kobold Inventor", or
                # "Acererak" matching "Acererak and His Disciples"
                search_words = name_en_lower.split()
                preset_words = m_name_en.split()
                if len(search_words) == len(preset_words):
                    if m_name_en == name_en_lower:
                        return monster
                    # Allow minor variation (e.g. substring for typos)
                    if len(search_words) > 1 and (m_name_en in name_en_lower or name_en_lower in m_name_en):
                        return monster

        return None

    async def extract_monsters_from_toc(
        self,
        db: AsyncSession,
        module_id: str,
        progress_callback: Optional[callable] = None,
        chapter_titles: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """
        Extract monsters from the module's TOC chapters.

        Args:
            chapter_titles: If provided, extract from these specific chapters
                           instead of auto-detecting appendices.

        Returns: {"monsters": [...], "count": N, "status": "success/error"}
        """
        result = await db.execute(
            select(ParsedModule).where(ParsedModule.module_id == module_id)
        )
        module = result.scalar_one_or_none()

        if not module:
            return {"monsters": [], "count": 0, "status": "error", "message": "Module not found"}

        toc = module.toc or []
        logger.info(f"Module {module_id} has {len(toc)} top-level TOC entries")

        # Determine which chapters to extract from
        if chapter_titles:
            # User specified chapters - use them directly
            logger.info(f"Using user-specified chapters: {chapter_titles}")
            target_titles = chapter_titles
        else:
            # Auto-detect: find appendix entries and use LLM to identify monster ones
            appendix_entries = []
            for item in toc:
                title = item.get("title", "")
                if any(kw in title for kw in ["附录", "Appendix", "附錄"]):
                    children = item.get("children", [])
                    appendix_entries.append({
                        "title": title,
                        "children_titles": [c.get("title", "") for c in children[:10]]
                    })
                    logger.info(f"Found appendix: '{title}' with {len(children)} children")

            if not appendix_entries:
                logger.warning(f"No appendix entries found in module {module_id}")
                return {"monsters": [], "count": 0, "status": "error", "message": "未找到附录章节"}

            target_titles = await self._identify_monster_appendices_with_llm(db, appendix_entries)
            logger.info(f"LLM identified monster appendices: {target_titles}")

            if not target_titles:
                logger.warning("LLM did not identify any monster appendices")
                return {"monsters": [], "count": 0, "status": "error", "message": "未能识别到怪物附录"}

        # Find ALL matching chapters and collect entries
        monster_entries = []
        for item in toc:
            title = item.get("title", "")
            # Check if this title matches any target
            if not any(identified.lower() in title.lower() or title.lower() in identified.lower()
                       for identified in target_titles):
                continue

            logger.info(f"Processing chapter for monsters: {title}")

            if chapter_titles:
                # User-specified chapters: dump all content, let LLM sort it out
                monster_entries.extend(self._collect_chapter_entries(item))
            else:
                # Auto-detected appendix: use structured extraction
                monster_entries.extend(self._collect_appendix_monster_entries(item))

        if not monster_entries:
            return {"monsters": [], "count": 0, "status": "error", "message": "Monster appendix not found"}

        if progress_callback:
            await progress_callback(f"找到 {len(monster_entries)} 个怪物条目，正在提取...", 20)

        # Process in batches to handle large appendices
        all_monsters = []
        batches = self._create_batches(monster_entries)
        total_batches = len(batches)

        if progress_callback:
            await progress_callback(f"开始并发提取 {total_batches} 个批次 (每批最多15个)...", 20)

        # Step 1: Concurrent batch extraction with real-time progress
        tasks = {
            asyncio.create_task(
                self._extract_with_llm(db, batch_content, MONSTER_EXTRACT_PROMPT, "monsters")
            ): i for i, batch_content in enumerate(batches)
        }

        failed_batches = []
        success_count = 0
        batch_monsters = {}  # Store results by batch index

        for coro in asyncio.as_completed(tasks.keys()):
            task = None
            for t in tasks:
                if t == coro or (hasattr(coro, '_coro') and t._coro == coro._coro):
                    task = t
                    break
            if task is None:
                # Fallback: just await the result
                try:
                    result = await coro
                    if result:
                        all_monsters.extend(result)
                        success_count += 1
                except Exception as e:
                    logger.warning(f"Batch failed: {e}")
                continue

            batch_idx = tasks[task]
            try:
                result = await coro
                if result:
                    batch_monsters[batch_idx] = result
                    all_monsters.extend(result)
                    success_count += 1
                if progress_callback:
                    percent = 20 + int((success_count / total_batches) * 30)
                    await progress_callback(
                        f"批次提取中: {success_count}/{total_batches} 完成, 已提取 {len(all_monsters)} 个怪物",
                        percent
                    )
            except Exception as e:
                logger.warning(f"Batch {batch_idx+1} failed: {e}")
                failed_batches.append((batch_idx, batches[batch_idx]))
                if progress_callback:
                    await progress_callback(
                        f"批次 {batch_idx+1} 失败, 待重试 ({len(failed_batches)} 个失败)",
                        20 + int((success_count / total_batches) * 30)
                    )

        # Report batch extraction results
        if progress_callback:
            if failed_batches:
                await progress_callback(f"批次提取: {success_count}/{total_batches} 成功, {len(failed_batches)} 待重试, 共 {len(all_monsters)} 怪物", 50)
            else:
                await progress_callback(f"批次提取完成: {total_batches}/{total_batches} 全部成功, 共 {len(all_monsters)} 怪物", 50)

        # Step 2: Serial retry for failed batches (only one retry)
        if failed_batches:
            if progress_callback:
                await progress_callback(f"串行重试 {len(failed_batches)} 个失败批次...", 50)
            retry_success = 0
            for idx, (i, batch_content) in enumerate(failed_batches):
                logger.info(f"Retrying batch {i+1}...")
                try:
                    result = await self._extract_with_llm(
                        db, batch_content, MONSTER_EXTRACT_PROMPT, "monsters"
                    )
                    if result:
                        all_monsters.extend(result)
                        retry_success += 1
                    if progress_callback:
                        await progress_callback(
                            f"重试进度: {idx+1}/{len(failed_batches)}, 成功 {retry_success} 个",
                            50 + int(((idx+1) / len(failed_batches)) * 10)
                        )
                except Exception as e:
                    logger.error(f"Batch {i+1} retry failed: {e}")

        if progress_callback:
            await progress_callback(f"提取到 {len(all_monsters)} 个怪物，正在数值化...", 60)

        # Structure monsters with LLM to get AC, HP, CR, etc.
        structured_monsters = await self._structure_monsters(
            db, all_monsters, progress_callback, toc=toc
        )

        # Update database
        module.monsters = structured_monsters
        module.monsters_count = len(structured_monsters)
        await db.commit()

        if progress_callback:
            await progress_callback("怪物提取和数值化完成", 100)

        return {"monsters": structured_monsters, "count": len(structured_monsters), "status": "success"}

    async def extract_items_from_toc(
        self,
        db: AsyncSession,
        module_id: str,
        progress_callback: Optional[callable] = None,
        chapter_titles: Optional[List[str]] = None
    ) -> Dict[str, Any]:
        """
        Extract magic items from the module's TOC chapters.

        Args:
            chapter_titles: If provided, extract from these specific chapters
                           instead of auto-detecting appendices.

        Returns: {"items": [...], "count": N, "status": "success/error"}
        """
        result = await db.execute(
            select(ParsedModule).where(ParsedModule.module_id == module_id)
        )
        module = result.scalar_one_or_none()

        if not module:
            return {"items": [], "count": 0, "status": "error", "message": "Module not found"}

        toc = module.toc or []

        # Find item entries from specified chapters or auto-detect
        item_entries = []
        if chapter_titles:
            # User specified chapters - collect children from matching chapters
            logger.info(f"Using user-specified chapters for items: {chapter_titles}")
            for item in toc:
                title = item.get("title", "")
                if any(ct.lower() in title.lower() or title.lower() in ct.lower()
                       for ct in chapter_titles):
                    children = item.get("children", [])
                    for child in children:
                        entry_content = self._format_entry(child)
                        if entry_content:
                            item_entries.append(entry_content)
        else:
            # Auto-detect: find item appendix
            for item in toc:
                title = item.get("title", "")
                if "附录" in title and ("物品" in title or "Item" in title or "Magic" in title):
                    children = item.get("children", [])
                    if children:
                        for child in children:
                            entry_content = self._format_entry(child)
                            if entry_content:
                                item_entries.append(entry_content)
                        break

        if not item_entries:
            return {"items": [], "count": 0, "status": "error", "message": "Item appendix not found"}

        if progress_callback:
            await progress_callback(f"找到 {len(item_entries)} 个物品条目，正在提取...", 20)

        # Process in batches
        all_items = []
        batches = self._create_batches(item_entries)
        total_batches = len(batches)

        if progress_callback:
            await progress_callback(f"开始并发提取 {total_batches} 个批次 (每批最多15个)...", 20)

        # Step 1: Concurrent batch extraction with real-time progress
        tasks = {
            asyncio.create_task(
                self._extract_with_llm(db, batch_content, ITEM_EXTRACT_PROMPT, "items")
            ): i for i, batch_content in enumerate(batches)
        }

        failed_batches = []
        success_count = 0

        for coro in asyncio.as_completed(tasks.keys()):
            task = None
            batch_idx = None
            for t, idx in tasks.items():
                if t == coro or (hasattr(coro, '_coro') and hasattr(t, '_coro') and t._coro == coro._coro):
                    task = t
                    batch_idx = idx
                    break

            try:
                result = await coro
                if result:
                    all_items.extend(result)
                    success_count += 1
                if progress_callback:
                    percent = 20 + int((success_count / total_batches) * 30)
                    await progress_callback(
                        f"批次提取中: {success_count}/{total_batches} 完成, 已提取 {len(all_items)} 个物品",
                        percent
                    )
            except Exception as e:
                if batch_idx is not None:
                    logger.warning(f"Item batch {batch_idx+1} failed: {e}")
                    failed_batches.append((batch_idx, batches[batch_idx]))
                if progress_callback:
                    await progress_callback(
                        f"批次 {batch_idx+1 if batch_idx else '?'} 失败, 待重试 ({len(failed_batches)} 个失败)",
                        20 + int((success_count / total_batches) * 30)
                    )

        # Report batch extraction results
        if progress_callback:
            if failed_batches:
                await progress_callback(f"批次提取: {success_count}/{total_batches} 成功, {len(failed_batches)} 待重试, 共 {len(all_items)} 物品", 50)
            else:
                await progress_callback(f"批次提取完成: {total_batches}/{total_batches} 全部成功, 共 {len(all_items)} 物品", 50)

        # Step 2: Serial retry for failed batches (only one retry)
        if failed_batches:
            if progress_callback:
                await progress_callback(f"串行重试 {len(failed_batches)} 个失败批次...", 50)
            retry_success = 0
            for idx, (i, batch_content) in enumerate(failed_batches):
                logger.info(f"Retrying item batch {i+1}...")
                try:
                    result = await self._extract_with_llm(
                        db, batch_content, ITEM_EXTRACT_PROMPT, "items"
                    )
                    if result:
                        all_items.extend(result)
                        retry_success += 1
                    if progress_callback:
                        await progress_callback(
                            f"重试进度: {idx+1}/{len(failed_batches)}, 成功 {retry_success} 个",
                            50 + int(((idx+1) / len(failed_batches)) * 10)
                        )
                except Exception as e:
                    logger.error(f"Item batch {i+1} retry failed: {e}")

        if progress_callback:
            await progress_callback(f"提取到 {len(all_items)} 个物品，正在数值化...", 60)

        # Structure items with LLM
        structured_items = await self._structure_items(db, all_items, progress_callback)

        module.items = structured_items
        module.items_count = len(structured_items)
        await db.commit()

        if progress_callback:
            await progress_callback("物品提取完成", 100)

        return {"items": structured_items, "count": len(structured_items), "status": "success"}

    async def _identify_monster_appendices_with_llm(
        self,
        db: AsyncSession,
        appendix_entries: List[Dict]
    ) -> List[str]:
        """
        Use LLM to identify which appendices contain monster/creature data.
        Returns list of appendix titles that contain monsters.
        """
        if not appendix_entries:
            logger.warning("No appendix entries provided to LLM identification")
            return []

        # Build a simple list for LLM to analyze
        entries_text = ""
        for i, entry in enumerate(appendix_entries, 1):
            title = entry.get("title", "")
            children = entry.get("children_titles", [])
            children_str = ", ".join(children[:5]) if children else "无子项"
            entries_text += f"{i}. {title}\n   子项: {children_str}\n"

        logger.info(f"Sending {len(appendix_entries)} appendix entries to LLM for identification")
        logger.debug(f"Appendix entries text:\n{entries_text}")

        prompt = f"""你是D&D模组分析专家。请分析以下目录结构，找出哪些章节/附录包含**怪物、生物、NPC或敌人**的数据。

目录结构：
{entries_text}

规则：
1. 怪物/生物附录通常包含：生物数据、怪物属性、NPC属性、恶魔领主、野兽等
2. 不要选择：魔法物品、法术、规则说明、地图、背景故事等
3. 如果子项看起来是具体的生物名称（如"巴弗灭 Baphomet"、"狼人"等），说明这是怪物附录

请只返回包含怪物/生物的章节标题，用JSON数组格式：
["标题1", "标题2"]

如果没有找到任何怪物相关的附录，返回空数组 []"""

        try:
            config = await ai_model_service.get_config_for_usage(db, "module_extract_monsters")
            if not config:
                logger.warning("No LLM config for module_extract_monsters, falling back to keyword matching")
                return self._fallback_monster_appendix_detection(appendix_entries)

            logger.info(f"Using model: {config.model_name} at {config.api_url}")
            endpoint = config.api_url.rstrip('/')
            if not endpoint.endswith('/chat/completions'):
                endpoint = endpoint + '/chat/completions'

            async with httpx.AsyncClient(timeout=60.0) as client:
                resp = await client.post(
                    endpoint,
                    json={
                        "model": config.model_name,
                        "messages": [
                            {"role": "system", "content": "你是D&D模组分析专家，只返回JSON数组。"},
                            {"role": "user", "content": prompt}
                        ],
                        "max_tokens": 500,
                        "temperature": 0.1
                    },
                    headers={
                        "Authorization": f"Bearer {config.api_key}",
                        "Content-Type": "application/json"
                    }
                )

            if resp.status_code != 200:
                logger.error(f"LLM API error: {resp.status_code}, response: {resp.text[:500]}")
                return self._fallback_monster_appendix_detection(appendix_entries)

            data = resp.json()
            content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
            logger.info(f"LLM response content: {content[:300]}")

            # Parse JSON response
            try:
                # Try direct parse
                result = json.loads(content)
                if isinstance(result, list):
                    logger.info(f"LLM identified {len(result)} monster appendices: {result}")
                    return result
            except Exception as parse_err:
                logger.debug(f"Direct JSON parse failed: {parse_err}")
                # Try to extract JSON from response
                match = re.search(r'\[.*?\]', content, re.DOTALL)
                if match:
                    try:
                        result = json.loads(match.group(0))
                        if isinstance(result, list):
                            logger.info(f"Extracted {len(result)} monster appendices from response: {result}")
                            return result
                    except:
                        pass

            logger.warning(f"Failed to parse LLM response: {content[:200]}")
            return self._fallback_monster_appendix_detection(appendix_entries)

        except Exception as e:
            logger.error(f"LLM identification failed: {type(e).__name__}: {e}")
            return self._fallback_monster_appendix_detection(appendix_entries)

    def _fallback_monster_appendix_detection(self, appendix_entries: List[Dict]) -> List[str]:
        """Fallback to keyword matching if LLM fails"""
        logger.info("Using fallback keyword matching for monster appendix detection")
        keywords = [
            "怪物", "monster", "生物", "creature", "恶魔", "demon",
            "npc", "敌人", "enemy", "野兽", "beast", "领主", "lord"
        ]
        result = []
        for entry in appendix_entries:
            title = entry.get("title", "").lower()
            if any(kw in title for kw in keywords):
                result.append(entry.get("title", ""))
        logger.info(f"Fallback detected {len(result)} monster appendices: {result}")
        return result

    # Action-related keywords that should be included with the monster stat block
    ACTION_KEYWORDS = [
        "动作", "action", "反应", "reaction",
        "传奇动作", "legendary action", "巢穴动作", "lair action",
        "区域效应", "regional effect", "特性", "trait",
        "多重攻击", "multiattack"
    ]

    # Keywords that indicate non-stat content to skip
    SKIP_KEYWORDS = [
        "巢穴", "lair", "疯狂", "madness", "崇拜", "cult",
        "恶魔领主", "demon lord"
    ]

    def _is_action_related(self, title: str) -> bool:
        """Check if a title is related to monster actions/abilities"""
        title_lower = title.lower()
        return any(kw in title_lower for kw in self.ACTION_KEYWORDS)

    def _should_skip_sibling(self, title: str, parent_title: str) -> bool:
        """Check if a sibling entry should be skipped (not part of stat block)"""
        title_lower = title.lower()
        # Skip entries that are clearly separate content (lair, madness, etc.)
        # But only if they don't match the parent name
        if self._titles_match(title, parent_title):
            return False
        # Skip lair/madness/cult entries
        for kw in self.SKIP_KEYWORDS:
            if kw in title_lower and not self._is_action_related(title):
                return True
        return False

    def _collect_chapter_entries(self, chapter: Dict) -> List[str]:
        """Collect all content from a chapter as flat entries for LLM extraction.

        Used when the user manually selects chapters — no structural assumptions.
        Each child becomes one entry; if no children, the chapter itself is one entry.
        """
        children = chapter.get("children", [])
        entries = []

        if not children:
            # Leaf chapter: use its own content
            content = self._format_child_recursive(chapter)
            if content and len(content) > 50:
                entries.append(f"### {chapter.get('title', '')}\n{content}")
            return entries

        for child in children:
            entry_content = self._format_entry(child)
            if entry_content and len(entry_content) > 50:
                entries.append(entry_content)

        logger.info(
            f"Collected {len(entries)} entries from chapter '{chapter.get('title', '')}'"
        )
        return entries

    def _collect_appendix_monster_entries(self, chapter: Dict) -> List[str]:
        """Collect entries from an appendix chapter for LLM monster extraction.

        Sends all children as entries without pre-filtering. The LLM will
        identify which entries are monster stat blocks and merge related
        sections (actions, legendary actions) into each monster's description.
        """
        title = chapter.get("title", "")
        children = chapter.get("children", [])
        if not children:
            return []

        # Check for a dedicated "Monster Descriptions" sub-section
        target_children = children
        for child in children:
            child_title = child.get("title", "")
            if "怪物详述" in child_title or "Monster Descriptions" in child_title:
                target_children = child.get("children", [])
                logger.info(f"Found 'Monster Descriptions' section with {len(target_children)} entries")
                break

        entries = []
        for child in target_children:
            entry_content = self._format_entry(child)
            if entry_content and len(entry_content) > 50:
                entries.append(entry_content)

        logger.info(f"Collected {len(entries)} entries from appendix '{title}'")
        return entries

    def _format_entry(self, toc_item: Dict) -> str:
        """Format a single TOC entry for monster extraction.

        Smart extraction: If children contain a stat block (AC/HP), extract only that child
        plus any action-related siblings (传奇动作, 巢穴动作, etc.),
        rather than mixing all content together (lair descriptions, madness effects, etc.)
        """
        title = toc_item.get("title", "")
        content = toc_item.get("content", "") or ""
        children = toc_item.get("children", [])

        # Check if main content already has stats
        if self._has_monster_stats(content):
            # Main content has stats, include it and relevant children (actions, reactions)
            for child in children:
                child_content = self._format_child_recursive(child)
                if child_content:
                    content += "\n\n" + child_content
        elif children:
            # Main content doesn't have stats, look for a child that does
            stat_child = None
            stat_child_idx = -1

            for idx, child in enumerate(children):
                child_content = child.get("content", "") or ""
                child_title = child.get("title", "")

                # Check if this child has monster stats
                if self._has_monster_stats(child_content):
                    stat_child = child
                    stat_child_idx = idx
                    break
                # Also check if child name matches parent (common pattern for stat blocks)
                elif title and child_title and self._titles_match(title, child_title):
                    # Check nested children for stats
                    for nested in child.get("children", []):
                        if self._has_monster_stats(nested.get("content", "")):
                            stat_child = child
                            stat_child_idx = idx
                            break
                    if stat_child:
                        break

            if stat_child:
                # Found a child with stats, use it as the main content
                content = self._format_child_recursive(stat_child)
                stat_title = stat_child.get("title", "") or title

                # Now look for action-related siblings AFTER the stat block
                # (and sometimes before, like 传奇动作)
                for idx, sibling in enumerate(children):
                    if idx == stat_child_idx:
                        continue  # Skip the stat child itself
                    sibling_title = sibling.get("title", "")

                    # Skip non-action-related content (lair, madness, etc.)
                    if self._should_skip_sibling(sibling_title, title):
                        logger.debug(f"Skipping sibling: {sibling_title}")
                        continue

                    # Include action-related siblings
                    if self._is_action_related(sibling_title):
                        sibling_content = self._format_child_recursive(sibling)
                        if sibling_content:
                            content += "\n\n" + sibling_content
                            logger.debug(f"Including action sibling: {sibling_title}")

                title = stat_title
            else:
                # No stat block found, use all children (fallback)
                for child in children:
                    child_content = self._format_child_recursive(child)
                    if child_content:
                        content += "\n\n" + child_content

        # Truncate large entries
        if len(content) > self.MAX_ENTRY_SIZE:
            content = content[:self.MAX_ENTRY_SIZE] + "\n...[内容截断]"

        if title or content:
            return f"### {title}\n{content}"
        return ""

    def _has_monster_stats(self, content: str) -> bool:
        """Check if content contains monster stat block indicators"""
        if not content:
            return False
        # Must have AC and HP to be considered a stat block
        has_ac = "AC:" in content or "AC：" in content or "护甲等级" in content
        has_hp = "HP:" in content or "HP：" in content or "生命值" in content
        return has_ac and has_hp

    def _titles_match(self, title1: str, title2: str) -> bool:
        """Check if two titles refer to the same monster (ignoring language variations)

        This checks for exact matches or bilingual variations like:
        - "狄摩高根" and "狄摩高根 Demogorgon" - same monster
        - "狄摩高根的巢穴" and "狄摩高根" - NOT same (one is the lair)
        """
        t1 = title1.lower().strip()
        t2 = title2.lower().strip()

        # Direct match
        if t1 == t2:
            return True

        # Check if one is a bilingual version of the other
        # e.g., "狄摩高根" vs "狄摩高根 Demogorgon"
        # The key is that there should be no Chinese possessive/descriptive modifiers like "的"

        # If one contains possessive markers, they're different things
        possessive_markers = ["的", "'s", "'s"]
        for marker in possessive_markers:
            if marker in t1 or marker in t2:
                # If both have the same base name before the marker, they might be related
                # But generally, "X的巢穴" is different from "X"
                return False

        # Check if one is a prefix of the other followed by a space (bilingual pattern)
        # e.g., "狄摩高根" and "狄摩高根 Demogorgon"
        if t1.startswith(t2 + " ") or t2.startswith(t1 + " "):
            return True
        if t1.startswith(t2) and len(t1) > len(t2) and t1[len(t2)] == ' ':
            return True
        if t2.startswith(t1) and len(t2) > len(t1) and t2[len(t1)] == ' ':
            return True

        # Exact match after removing English suffix
        # e.g., "巴弗灭" and "巴弗灭 Baphomet"
        t1_parts = t1.split()
        t2_parts = t2.split()
        if t1_parts and t2_parts and t1_parts[0] == t2_parts[0]:
            return True

        return False

    def _format_child_recursive(self, child: Dict, depth: int = 0) -> str:
        """Recursively format a child entry and all its nested children"""
        if depth > 5:  # Prevent infinite recursion
            return ""

        child_title = child.get("title", "")
        child_content = child.get("content", "") or ""

        # Build the formatted content
        result = ""
        if child_title:
            result = f"{child_title}\n"
        if child_content:
            result += child_content

        # Recursively process nested children
        nested_children = child.get("children", [])
        for nested in nested_children:
            nested_content = self._format_child_recursive(nested, depth + 1)
            if nested_content:
                result += "\n\n" + nested_content

        return result.strip()

    def _create_batches(self, entries: List[str]) -> List[str]:
        """Group entries into batches that fit within size limit"""
        batches = []
        current_batch = []
        current_size = 0

        for entry in entries:
            entry_size = len(entry)
            if current_size + entry_size > self.MAX_BATCH_SIZE and current_batch:
                # Start new batch
                batches.append("\n\n---\n\n".join(current_batch))
                current_batch = [entry]
                current_size = entry_size
            else:
                current_batch.append(entry)
                current_size += entry_size

        # Add remaining
        if current_batch:
            batches.append("\n\n---\n\n".join(current_batch))

        return batches

    async def _extract_with_llm(
        self,
        db: AsyncSession,
        content: str,
        prompt_template: str,
        extract_type: str,
        max_retries: int = 4
    ) -> List[Dict]:
        """Call LLM to extract structured data from content"""
        # Get model config and params via usage config based on extract type
        usage_key = "module_extract_monsters" if extract_type == "monsters" else "module_extract_items"
        try:
            usage_params = await ai_model_service.get_usage_params(db, usage_key)
            config = usage_params.config
            temperature = usage_params.temperature
            max_tokens = usage_params.max_tokens
        except Exception as e:
            logger.error(f"Failed to get AI config: {e}")
            return []

        # Limit content to avoid token limits
        if len(content) > 50000:
            logger.warning(f"Content too long ({len(content)}), truncating to 50000")
            content = content[:50000]

        prompt = prompt_template.format(content=content)

        # Build request
        endpoint = config.api_url.rstrip('/')
        if not endpoint.endswith('/chat/completions'):
            endpoint = endpoint + '/chat/completions'

        request_body = {
            "model": config.model_name,
            "messages": [
                {"role": "system", "content": f"你是D&D 5E {extract_type}数据提取专家，只返回JSON数组。"},
                {"role": "user", "content": prompt}
            ],
            "max_tokens": max_tokens,
            "temperature": temperature
        }

        logger.info(f"LLM {extract_type} extraction with temperature={temperature}, max_tokens={max_tokens}")

        for attempt in range(max_retries + 1):
            try:
                logger.info(f"LLM {extract_type} extraction attempt {attempt + 1}/{max_retries + 1}")

                # Use longer timeout for large modules
                timeout = httpx.Timeout(180.0, connect=30.0)
                async with httpx.AsyncClient(timeout=timeout) as client:
                    resp = await client.post(
                        endpoint,
                        json=request_body,
                        headers={
                            "Authorization": f"Bearer {config.api_key}",
                            "Content-Type": "application/json",
                        },
                    )

                if resp.status_code != 200:
                    logger.error(f"LLM API error: {resp.status_code} - {resp.text[:200]}")
                    if attempt < max_retries:
                        delay = 2 * (2 ** attempt)  # Exponential backoff: 2, 4, 8, 16 seconds
                        logger.info(f"Retrying in {delay}s...")
                        await asyncio.sleep(delay)
                        continue
                    return []

                data = resp.json()
                response_content = data.get("choices", [{}])[0].get("message", {}).get("content", "")

                if not response_content:
                    logger.warning("Empty response from LLM")
                    if attempt < max_retries:
                        await asyncio.sleep(2)
                        continue
                    return []

                # Parse JSON from response
                result = self._parse_json_response(response_content)
                logger.info(f"LLM {extract_type} extraction success: {len(result)} items")
                return result

            except httpx.TimeoutException:
                logger.warning(f"LLM request timeout (attempt {attempt + 1})")
                if attempt < max_retries:
                    delay = 2 * (2 ** attempt)
                    await asyncio.sleep(delay)
                    continue
            except Exception as e:
                logger.error(f"LLM extraction failed: {type(e).__name__}: {e}")
                if attempt < max_retries:
                    delay = 2 * (2 ** attempt)
                    await asyncio.sleep(delay)
                    continue

        logger.error(f"LLM {extract_type} extraction failed after {max_retries + 1} attempts")
        return []

    def _parse_json_response(self, text: str) -> List[Dict]:
        """Parse JSON array from LLM response"""
        import re

        # Try direct parse
        try:
            return json.loads(text)
        except:
            pass

        # Try extracting from code block
        code_match = re.search(r'```(?:json)?\s*([\s\S]*?)```', text)
        if code_match:
            try:
                return json.loads(code_match.group(1))
            except:
                pass

        # Try finding array brackets
        bracket_match = re.search(r'\[[\s\S]*\]', text)
        if bracket_match:
            try:
                return json.loads(bracket_match.group(0))
            except:
                pass

        return []

    async def _structure_monsters(
        self,
        db: AsyncSession,
        monsters: List[Dict],
        progress_callback: Optional[callable] = None,
        toc: Optional[List[Dict]] = None
    ) -> List[Dict]:
        """
        Structure monsters by parsing their descriptions into structured data.
        First checks preset data, then uses LLM for unmatched monsters.
        If toc is provided, looks up complete text from TOC before structuring.
        """
        if not monsters:
            return []

        # Step 0: Try preset lookup first — skip LLM for known monsters
        structured = []
        need_llm = []
        self._load_preset_monsters()

        for monster in monsters:
            name = monster.get('name', '')
            name_en = monster.get('name_en', '')
            preset = self._find_preset_monster(name, name_en)
            if preset and preset.get('ac') is not None:
                merged = {**monster}
                for key in ['ac', 'hp', 'cr', 'xp', 'size', 'type', 'alignment',
                            'speed', 'abilityScores', 'savingThrows', 'skills',
                            'senses', 'languages', 'damageImmunities',
                            'damageResistances', 'conditionImmunities',
                            'specialAbilities', 'actions', 'reactions',
                            'legendaryActions',
                            'defaultAvatarSmall', 'defaultAvatarLarge']:
                    val = preset.get(key)
                    if val is not None:
                        merged[key] = val
                if preset.get('hpFormula'):
                    merged['hp_formula'] = preset['hpFormula']
                # Enrich description from TOC (Step 1 extraction may be incomplete)
                if toc:
                    toc_text = self._find_monster_text_in_toc(toc, name, name_en)
                    if toc_text and len(toc_text) > len(merged.get('description', '') or ''):
                        merged['description'] = toc_text
                logger.info(f"Preset hit: {name} (AC={preset.get('ac')}, CR={preset.get('cr')})")
                structured.append(merged)
            else:
                need_llm.append(monster)

        if progress_callback:
            msg = f"预设命中 {len(structured)} 个"
            if need_llm:
                msg += f"，{len(need_llm)} 个需要 LLM 数值化"
            await progress_callback(msg, 60)

        if not need_llm:
            # All matched preset, skip LLM entirely
            validated = self._validate_all_monster_actions(structured)
            if progress_callback:
                await progress_callback(f"数值化完成: {len(validated)}/{len(monsters)} (全部预设命中)", 98)
            return validated

        # Get model config for structuring the rest
        try:
            usage_params = await ai_model_service.get_usage_params(db, "module_extract_monsters")
            config = usage_params.config
        except Exception as e:
            logger.error(f"Failed to get AI config for structuring: {e}")
            return structured + need_llm

        endpoint = config.api_url.rstrip('/')
        if not endpoint.endswith('/chat/completions'):
            endpoint = endpoint + '/chat/completions'
        headers = {
            "Authorization": f"Bearer {config.api_key}",
            "Content-Type": "application/json"
        }

        total = len(monsters)
        llm_total = len(need_llm)
        if progress_callback:
            await progress_callback(f"开始并发数值化 {llm_total} 个怪物 (预设已命中 {len(structured)} 个)...", 60)

        # Concurrent processing with concurrency limit to avoid API truncation
        semaphore = asyncio.Semaphore(10)  # Max 10 concurrent LLM requests

        async def _limited_structure(client, m):
            async with semaphore:
                return await self._structure_single_monster(client, endpoint, headers, config.model_name, m, monsters, toc=toc)

        async with httpx.AsyncClient(timeout=120.0) as client:
            # Create tasks paired with their monsters
            task_monster_pairs = []
            for m in need_llm:
                task = asyncio.create_task(_limited_structure(client, m))
                task_monster_pairs.append((task, m))

            llm_structured = []
            failed = []
            completed = 0

            for task, monster in task_monster_pairs:
                try:
                    result = await task
                    completed += 1
                    if result is not None:
                        llm_structured.append(result)
                    else:
                        failed.append(monster)
                    if progress_callback:
                        percent = 60 + int((completed / llm_total) * 25)
                        await progress_callback(
                            f"数值化中: {completed}/{llm_total} 完成, 成功 {len(llm_structured)} 个",
                            percent
                        )
                except Exception as e:
                    completed += 1
                    failed.append(monster)
                    logger.warning(f"Structure failed for {monster.get('name', '?')}: {e}")

        logger.info(f"Concurrent structuring: {len(llm_structured)}/{llm_total} success, {len(failed)} failed")

        # Report concurrent results
        if progress_callback:
            if failed:
                await progress_callback(f"并发完成: {len(llm_structured)}/{llm_total} 成功, {len(failed)} 待重试", 85)
            else:
                await progress_callback(f"并发完成: {len(llm_structured)}/{llm_total} 全部成功", 90)

        # Serial retry for failures
        if failed:
            if progress_callback:
                await progress_callback(f"串行重试 {len(failed)} 个失败怪物...", 88)

            retry_success = 0
            for idx, monster in enumerate(failed):
                name = monster.get('name', 'Unknown')
                logger.info(f"Serial retry for {name}")
                async with httpx.AsyncClient(timeout=120.0) as client:
                    result = await self._structure_single_monster(
                        client, endpoint, headers, config.model_name, monster, monsters, toc=toc
                    )
                if result is not None:
                    llm_structured.append(result)
                    retry_success += 1
                    logger.info(f"Retry success for {name}")
                else:
                    # Keep original on final failure
                    llm_structured.append(monster)
                    logger.warning(f"Final failure for {name}, keeping original")

                if progress_callback:
                    await progress_callback(
                        f"重试中: {idx+1}/{len(failed)} 完成, 成功 {retry_success} 个",
                        88 + int(((idx+1) / len(failed)) * 8)
                    )

        # Merge preset + LLM results
        all_structured = structured + llm_structured

        # Validate and fix action formats for combat system compatibility
        if progress_callback:
            await progress_callback(f"验证动作格式...", 96)
        validated = self._validate_all_monster_actions(all_structured)

        if progress_callback:
            await progress_callback(f"数值化完成: {len(validated)}/{total} (预设 {len(structured)}, LLM {len(llm_structured)})", 98)

        return validated

    async def _structure_single_monster(
        self,
        client: httpx.AsyncClient,
        endpoint: str,
        headers: Dict,
        model_name: str,
        monster: Dict,
        all_monsters: List[Dict],
        toc: Optional[List[Dict]] = None
    ) -> Optional[Dict]:
        """Structure a single monster. Returns structured monster or None on failure."""
        name = monster.get('name', 'Unknown')
        name_en = monster.get('name_en', '')
        description = monster.get('description', '')

        if not description:
            return monster

        # Try to find complete text from TOC (includes spellcasting, legendary actions, etc.)
        prompt_desc = description
        if toc:
            toc_text = self._find_monster_text_in_toc(toc, name, name_en)
            if toc_text and len(toc_text) > len(description):
                logger.info(f"[Structure] Using TOC text for {name}: {len(toc_text)} chars (vs description {len(description)} chars)")
                prompt_desc = toc_text
                # Also update the monster's description for storage
                monster['description'] = toc_text

        # Check for variant monsters
        variant_pattern = r'以[「""\']?(.+?)[」""\']?(?:的)?(?:资料卡|数据|属性)?为基础'
        match = re.search(variant_pattern, description)
        if match:
            base_name = match.group(1).strip()
            for m in all_monsters:
                m_name = m.get('name', '')
                if base_name in m_name or m_name in base_name:
                    base_desc = m.get('description', '')
                    prompt_desc = f"""## 变体怪物说明
这是一个变体怪物。请根据以下基础怪物数据和修改规则，计算并输出完整的属性数据。

## 基础怪物: {m.get('name', base_name)}
{base_desc}

## 变体修改规则
{description}

请应用上述修改规则到基础怪物，计算出完整的属性。"""
                    break

        prompt = MONSTER_STRUCTURE_PROMPT.format(name=name, description=prompt_desc)
        request_body = {
            "model": model_name,
            "messages": [
                {"role": "system", "content": "你是D&D 5E怪物数据解析专家，只返回JSON。"},
                {"role": "user", "content": prompt}
            ],
            "temperature": 0,
            "max_tokens": 8000
        }

        try:
            resp = await client.post(endpoint, json=request_body, headers=headers)
            if resp.status_code == 200:
                data = resp.json()
                choice = data.get("choices", [{}])[0]
                content = choice.get("message", {}).get("content", "")
                finish_reason = choice.get("finish_reason", "unknown")

                if finish_reason == "length":
                    logger.warning(f"Response truncated for {name} (finish_reason=length, {len(content)} chars), attempting JSON repair")

                parsed = self._parse_json_object(content)

                # If normal parsing fails, try to repair truncated JSON
                if parsed is None and len(content) > 100:
                    parsed = self._repair_truncated_json(content)
                    if parsed:
                        logger.info(f"JSON repair succeeded for {name}")

                if parsed and parsed.get('ac') is not None:
                    # Log what fields were successfully parsed
                    actions_count = len(parsed.get('actions', [])) if isinstance(parsed.get('actions'), list) else 0
                    special_count = len(parsed.get('specialAbilities', [])) if isinstance(parsed.get('specialAbilities'), list) else 0
                    legendary_count = len(parsed.get('legendaryActions', [])) if isinstance(parsed.get('legendaryActions'), list) else 0
                    has_spellcasting = 'yes' if parsed.get('spellcasting') else 'no'
                    logger.info(f"Structured {name}: AC={parsed.get('ac')}, HP={parsed.get('hp')}, CR={parsed.get('cr')}, actions={actions_count}, specialAbilities={special_count}, legendaryActions={legendary_count}, spellcasting={has_spellcasting}")

                    monster_with_stats = {**monster, **parsed}
                    return monster_with_stats
                else:
                    # Log why parsing failed with actual content
                    if parsed:
                        logger.warning(f"Failed to structure {name}: parsed OK but AC is None. Keys: {list(parsed.keys())[:10]}")
                    else:
                        content_preview = content[:200].replace('\n', ' ')
                        logger.warning(f"Failed to structure {name}: JSON parse failed, content length={len(content)}, finish_reason={finish_reason}, preview: {content_preview}")
            else:
                logger.warning(f"Failed to structure {name}: status={resp.status_code}, body={resp.text[:200]}")
        except Exception as e:
            logger.error(f"Exception structuring {name}: {e}")

        return None

    # Valid damage types for D&D 5E
    VALID_DAMAGE_TYPES = {
        '穿刺', '挥砍', '钝击', '火焰', '冰冷', '闪电',
        '毒素', '强酸', '心灵', '黯蚀', '光耀', '力场', '雷鸣'
    }

    # Valid attack types
    VALID_ATTACK_TYPES = {'melee', 'ranged', 'melee_or_ranged'}

    # Valid save abilities (Chinese)
    VALID_SAVE_ABILITIES = {'力量', '敏捷', '体质', '智力', '感知', '魅力'}

    # Valid action categories
    VALID_ACTION_CATEGORIES = {'multiattack', 'weapon_attack', 'special_attack', 'spell', 'other'}

    def _validate_all_monster_actions(self, monsters: List[Dict]) -> List[Dict]:
        """Validate and fix action formats for all monsters to ensure combat system compatibility."""
        validated_monsters = []
        total_fixed = 0

        for monster in monsters:
            name = monster.get('name', 'Unknown')
            fixed_count = 0

            # Validate actions - preserve string format in actions_text
            if monster.get('actions'):
                if isinstance(monster['actions'], str):
                    # Keep original text in actions_text, set actions to empty list
                    monster['actions_text'] = monster['actions']
                    monster['actions'] = []
                    logger.debug(f"{name}: actions is string, preserved in actions_text")
                elif isinstance(monster['actions'], list):
                    monster['actions'], count = self._validate_action_list(monster['actions'], name, 'actions')
                    fixed_count += count

            # Validate legendary actions
            if monster.get('legendaryActions'):
                if isinstance(monster['legendaryActions'], str):
                    monster['legendaryActions_text'] = monster['legendaryActions']
                    monster['legendaryActions'] = []
                elif isinstance(monster['legendaryActions'], list):
                    monster['legendaryActions'], count = self._validate_action_list(
                        monster['legendaryActions'], name, 'legendaryActions'
                    )
                    fixed_count += count

            # Validate reactions
            if monster.get('reactions'):
                if isinstance(monster['reactions'], str):
                    monster['reactions_text'] = monster['reactions']
                    monster['reactions'] = []
                elif isinstance(monster['reactions'], list):
                    monster['reactions'], count = self._validate_action_list(monster['reactions'], name, 'reactions')
                    fixed_count += count

            if fixed_count > 0:
                logger.info(f"Fixed {fixed_count} action format issues for {name}")
                total_fixed += fixed_count

            validated_monsters.append(monster)

        if total_fixed > 0:
            logger.info(f"Total action format fixes: {total_fixed}")

        return validated_monsters

    def _validate_action_list(self, actions: List, monster_name: str, action_type: str) -> tuple:
        """Validate and fix a list of actions. Returns (fixed_actions, fix_count)."""
        if not isinstance(actions, list):
            return [], 0

        validated = []
        fix_count = 0

        for action in actions:
            if not isinstance(action, dict):
                continue

            fixed_action, fixed = self._validate_single_action(action, monster_name, action_type)
            validated.append(fixed_action)
            if fixed:
                fix_count += 1

        return validated, fix_count

    def _validate_single_action(self, action: Dict, monster_name: str, action_type: str) -> tuple:
        """Validate and fix a single action to match ActionSchema format. Returns (fixed_action, was_fixed)."""
        was_fixed = False
        action_name = action.get('name', 'Unknown')

        # Ensure name is string
        if not isinstance(action.get('name'), str):
            action['name'] = str(action.get('name', ''))
            was_fixed = True

        # Ensure description is string
        if not isinstance(action.get('description'), str):
            action['description'] = str(action.get('description', ''))
            was_fixed = True

        # Validate action_category
        if action_type == 'actions':
            cat = action.get('action_category')
            if cat and cat not in self.VALID_ACTION_CATEGORIES:
                action['action_category'] = 'other'
                was_fixed = True
            elif not cat:
                # Infer from other fields
                desc = action.get('description', '')
                if action.get('attack_bonus') is not None:
                    action['action_category'] = 'weapon_attack'
                elif action.get('multiattack_actions') or '多重攻击' in action_name or 'multiattack' in action_name.lower():
                    action['action_category'] = 'multiattack'
                elif action.get('save'):
                    action['action_category'] = 'special_attack'
                else:
                    action['action_category'] = 'other'
                was_fixed = True

        # Validate attack_bonus (must be int or None)
        if action.get('attack_bonus') is not None:
            if not isinstance(action['attack_bonus'], (int, float)):
                try:
                    action['attack_bonus'] = int(action['attack_bonus'])
                    was_fixed = True
                except (ValueError, TypeError):
                    action['attack_bonus'] = None
                    was_fixed = True
            elif isinstance(action['attack_bonus'], float):
                action['attack_bonus'] = int(action['attack_bonus'])
                was_fixed = True

        # Validate attack_type
        if action.get('attack_type'):
            attack_type_val = str(action['attack_type']).lower().replace(' ', '_')
            if attack_type_val not in self.VALID_ATTACK_TYPES:
                # Try to infer from description
                desc = action.get('description', '').lower()
                if '近战' in desc or 'melee' in desc:
                    action['attack_type'] = 'melee'
                elif '远程' in desc or 'ranged' in desc:
                    action['attack_type'] = 'ranged'
                else:
                    action['attack_type'] = None
                was_fixed = True
            else:
                action['attack_type'] = attack_type_val

        # Validate damage (must be dict with ActionSchema structure)
        damage = action.get('damage')
        if damage is not None:
            if isinstance(damage, str):
                action['damage'] = self._parse_damage_string(damage)
                was_fixed = True
            elif isinstance(damage, list):
                # Convert old array format to ActionSchema
                if len(damage) > 0 and isinstance(damage[0], dict):
                    action['damage'] = self._normalize_damage_dict(damage[0])
                    if len(damage) > 1:
                        action['extra_damage'] = self._normalize_damage_dict(damage[1])
                    was_fixed = True
                else:
                    action['damage'] = None
                    was_fixed = True
            elif isinstance(damage, dict):
                action['damage'] = self._normalize_damage_dict(damage)
                if action['damage'] != damage:
                    was_fixed = True
            else:
                action['damage'] = None
                was_fixed = True

        # Validate extra_damage
        extra_damage = action.get('extra_damage')
        if extra_damage is not None:
            if isinstance(extra_damage, str):
                action['extra_damage'] = self._parse_damage_string(extra_damage)
                was_fixed = True
            elif isinstance(extra_damage, dict):
                action['extra_damage'] = self._normalize_damage_dict(extra_damage)
                if action['extra_damage'] != extra_damage:
                    was_fixed = True
            else:
                action['extra_damage'] = None
                was_fixed = True

        # Validate save (ability must be Chinese)
        save = action.get('save')
        if save is not None:
            if isinstance(save, dict):
                fixed_save = {}
                if save.get('ability'):
                    ability = str(save['ability']).strip()
                    # Convert English abbreviation to Chinese if needed
                    ability_cn = self._translate_ability_to_cn(ability)
                    if ability_cn in self.VALID_SAVE_ABILITIES:
                        fixed_save['ability'] = ability_cn
                if save.get('dc') is not None:
                    try:
                        fixed_save['dc'] = int(save['dc'])
                    except (ValueError, TypeError):
                        pass
                if save.get('success_effect'):
                    fixed_save['success_effect'] = str(save['success_effect'])
                if save.get('fail_effect'):
                    fixed_save['fail_effect'] = str(save['fail_effect'])
                action['save'] = fixed_save if fixed_save.get('dc') else None
                if action['save'] != save:
                    was_fixed = True
            else:
                action['save'] = None
                was_fixed = True

        # Validate usage
        usage = action.get('usage')
        if usage is not None:
            if isinstance(usage, dict):
                u_type = usage.get('type', '')
                if u_type not in ('recharge', 'per_day'):
                    # Try to normalize old formats
                    if 'recharge' in str(u_type).lower():
                        min_val = usage.get('min_value', 6)
                        action['usage'] = {'type': 'recharge', 'value': f'{min_val}-6'}
                        was_fixed = True
                    elif 'per' in str(u_type).lower() or 'day' in str(u_type).lower():
                        action['usage'] = {'type': 'per_day', 'value': usage.get('times', usage.get('value', 1))}
                        was_fixed = True
            elif not isinstance(usage, dict):
                action['usage'] = None
                was_fixed = True

        # Validate area
        area = action.get('area')
        if area is not None and not isinstance(area, dict):
            action['area'] = None
            was_fixed = True

        # Validate multiattack_actions
        ma = action.get('multiattack_actions')
        if ma is not None and not isinstance(ma, list):
            action['multiattack_actions'] = None
            was_fixed = True

        # Validate cost for legendary actions
        if action_type == 'legendaryActions':
            if action.get('cost') is None:
                action['cost'] = 1
                was_fixed = True
            elif not isinstance(action['cost'], int):
                try:
                    action['cost'] = int(action['cost'])
                    was_fixed = True
                except (ValueError, TypeError):
                    action['cost'] = 1
                    was_fixed = True

        return action, was_fixed

    def _normalize_damage_dict(self, damage: Dict) -> Optional[Dict]:
        """Normalize a damage dict to ActionSchema format (Chinese types, split dice/bonus)."""
        if not isinstance(damage, dict):
            return None
        fixed = {}

        # Handle dice - split bonus if combined
        dice_str = damage.get('dice', '')
        if dice_str:
            dice_str = str(dice_str).replace(' ', '').replace('＋', '+').replace('－', '-')
            import re
            m = re.match(r'(\d+d\d+)([+-]\d+)?', dice_str)
            if m:
                fixed['dice'] = m.group(1)
                if m.group(2) and damage.get('bonus') is None:
                    fixed['bonus'] = int(m.group(2))
            else:
                fixed['dice'] = dice_str

        # Bonus (may already exist or extracted from dice)
        if damage.get('bonus') is not None:
            try:
                fixed['bonus'] = int(damage['bonus'])
            except (ValueError, TypeError):
                pass

        # Average (rename avg → average)
        avg_val = damage.get('average') or damage.get('avg')
        if avg_val is not None:
            try:
                fixed['average'] = int(avg_val)
            except (ValueError, TypeError):
                pass

        # Type - ensure Chinese
        if damage.get('type'):
            dtype = str(damage['type']).strip()
            dtype_cn = self._translate_damage_type_to_cn(dtype)
            fixed['type'] = dtype_cn

        return fixed if fixed else None

    def _parse_damage_string(self, damage_str: str) -> Optional[Dict]:
        """Parse a damage string like '2d6+3 slashing' into ActionSchema format."""
        if not damage_str:
            return None

        import re
        dice_pattern = r'(\d+d\d+)(?:[+-](\d+))?'
        avg_pattern = r'^(\d+)\s*\('
        type_pattern = r'(slashing|piercing|bludgeoning|fire|cold|lightning|poison|acid|psychic|necrotic|radiant|force|thunder|挥砍|穿刺|钝击|火焰|冰冷|闪电|毒素|强酸|心灵|黯蚀|光耀|力场|雷鸣)'

        result = {}

        # Extract dice (split dice and bonus)
        dice_match = re.search(dice_pattern, damage_str)
        if dice_match:
            result['dice'] = dice_match.group(1)
            if dice_match.group(2):
                result['bonus'] = int(dice_match.group(2))

        # Extract average damage
        avg_match = re.search(avg_pattern, damage_str)
        if avg_match:
            result['average'] = int(avg_match.group(1))

        # Extract damage type (convert to Chinese)
        type_match = re.search(type_pattern, damage_str, re.IGNORECASE)
        if type_match:
            result['type'] = self._translate_damage_type_to_cn(type_match.group(1))

        return result if result else None

    def _translate_damage_type_to_cn(self, damage_type: str) -> str:
        """Translate damage type to Chinese (ActionSchema standard)."""
        # English → Chinese mapping
        en_to_cn = {
            'slashing': '挥砍', 'piercing': '穿刺', 'bludgeoning': '钝击',
            'fire': '火焰', 'cold': '冰冷', 'lightning': '闪电',
            'poison': '毒素', 'acid': '强酸', 'psychic': '心灵',
            'necrotic': '黯蚀', 'radiant': '光耀', 'force': '力场',
            'thunder': '雷鸣',
        }
        # Chinese synonym normalization
        cn_synonyms = {
            '斩击': '挥砍', '砍击': '挥砍', '刺击': '穿刺',
            '钝伤': '钝击', '寒冷': '冰冷', '冰': '冰冷', '冰霜': '冰冷',
            '电击': '闪电', '毒': '毒素', '中毒': '毒素',
            '酸': '强酸', '酸液': '强酸', '精神': '心灵',
            '死灵': '黯蚀', '光辉': '光耀', '火': '火焰',
            '雷': '雷鸣', '雷暴': '雷鸣',
        }
        dt = damage_type.strip().lower()
        # Already valid Chinese
        if dt in self.VALID_DAMAGE_TYPES:
            return dt
        # English to Chinese
        if dt in en_to_cn:
            return en_to_cn[dt]
        # Chinese synonym
        if dt in cn_synonyms:
            return cn_synonyms[dt]
        return damage_type if damage_type in self.VALID_DAMAGE_TYPES else '钝击'

    def _translate_ability_to_cn(self, ability: str) -> str:
        """Translate ability name to Chinese (ActionSchema standard)."""
        abbr_to_cn = {
            'str': '力量', 'dex': '敏捷', 'con': '体质',
            'int': '智力', 'wis': '感知', 'cha': '魅力',
            'strength': '力量', 'dexterity': '敏捷', 'constitution': '体质',
            'intelligence': '智力', 'wisdom': '感知', 'charisma': '魅力',
        }
        a = ability.strip().lower()
        # Already valid Chinese
        if a in self.VALID_SAVE_ABILITIES:
            return a
        # Abbreviation or English to Chinese
        if a[:3] in abbr_to_cn:
            return abbr_to_cn[a[:3]]
        return ability

    async def _structure_items(
        self,
        db: AsyncSession,
        items: List[Dict],
        progress_callback: Optional[callable] = None
    ) -> List[Dict]:
        """
        Structure items by parsing descriptions into structured data.
        Uses concurrent processing for speed, with serial retry for failures.
        """
        if not items:
            return items

        try:
            config = await ai_model_service.get_config_for_usage(db, "module_extract_items")
        except Exception as e:
            logger.warning(f"No LLM config for module_extract_items: {e}, skipping structuring")
            return items

        if not config:
            logger.warning("No LLM config for module_extract_items, skipping structuring")
            return items

        endpoint = config.api_url.rstrip('/')
        if not endpoint.endswith('/chat/completions'):
            endpoint = endpoint + '/chat/completions'
        headers = {
            "Authorization": f"Bearer {config.api_key}",
            "Content-Type": "application/json"
        }

        total = len(items)
        if progress_callback:
            await progress_callback(f"开始并发数值化 {total} 个物品...", 60)

        # Concurrent processing with real-time progress
        async with httpx.AsyncClient(timeout=60.0) as client:
            tasks = {
                asyncio.create_task(
                    self._structure_single_item(client, endpoint, headers, config.model_name, item)
                ): item for item in items
            }

            structured = []
            failed = []
            completed = 0

            for coro in asyncio.as_completed(tasks.keys()):
                item = None
                for t, i in tasks.items():
                    if t == coro or (hasattr(coro, '_coro') and hasattr(t, '_coro') and t._coro == coro._coro):
                        item = i
                        break

                try:
                    result = await coro
                    completed += 1
                    if result is not None:
                        structured.append(result)
                        if progress_callback:
                            percent = 60 + int((completed / total) * 25)
                            await progress_callback(
                                f"数值化中: {completed}/{total} 完成, 成功 {len(structured)} 个",
                                percent
                            )
                    else:
                        if item:
                            failed.append(item)
                        if progress_callback:
                            percent = 60 + int((completed / total) * 25)
                            await progress_callback(
                                f"数值化中: {completed}/{total} 完成, 失败 {len(failed)} 个待重试",
                                percent
                            )
                except Exception as e:
                    completed += 1
                    if item:
                        failed.append(item)
                    logger.warning(f"Item structure failed: {e}")

        logger.info(f"Concurrent item structuring: {len(structured)}/{total} success, {len(failed)} failed")

        # Report concurrent results
        if progress_callback:
            if failed:
                await progress_callback(f"并发完成: {len(structured)}/{total} 成功, {len(failed)} 待重试", 85)
            else:
                await progress_callback(f"并发完成: {len(structured)}/{total} 全部成功", 90)

        # Serial retry for failures (only one retry)
        if failed:
            if progress_callback:
                await progress_callback(f"串行重试 {len(failed)} 个失败物品...", 88)

            retry_success = 0
            for idx, item in enumerate(failed):
                name = item.get('name', 'Unknown')
                logger.info(f"Serial retry for item {name}")
                async with httpx.AsyncClient(timeout=60.0) as client:
                    result = await self._structure_single_item(
                        client, endpoint, headers, config.model_name, item
                    )
                if result is not None:
                    structured.append(result)
                    retry_success += 1
                    logger.info(f"Retry success for item {name}")
                else:
                    # Keep original on failure
                    structured.append(item)
                    logger.warning(f"Final failure for item {name}, keeping original")

                if progress_callback:
                    await progress_callback(
                        f"重试中: {idx+1}/{len(failed)} 完成, 成功 {retry_success} 个",
                        88 + int(((idx+1) / len(failed)) * 8)
                    )

        if progress_callback:
            await progress_callback(f"物品数值化完成: {len(structured)}/{total}", 95)

        return structured

    async def _structure_single_item(
        self,
        client: httpx.AsyncClient,
        endpoint: str,
        headers: Dict,
        model_name: str,
        item: Dict
    ) -> Optional[Dict]:
        """Structure a single item. Returns structured item or None on failure."""
        name = item.get('name', 'Unknown')
        description = item.get('description', '')

        if not description:
            return item

        prompt = ITEM_STRUCTURE_PROMPT.format(name=name, description=description)

        request_body = {
            "model": model_name,
            "messages": [
                {"role": "system", "content": "你是D&D 5E魔法物品数据解析专家，只返回JSON。"},
                {"role": "user", "content": prompt}
            ],
            "temperature": 0,
            "max_tokens": 2000
        }

        try:
            resp = await client.post(endpoint, json=request_body, headers=headers)
            if resp.status_code == 200:
                data = resp.json()
                content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
                parsed = self._parse_json_object(content)
                if parsed:
                    item_with_stats = {**item, **parsed}
                    logger.info(f"Structured item {name}: rarity={parsed.get('rarity')}, type={parsed.get('type')}")
                    return item_with_stats
                else:
                    logger.warning(f"Failed to parse structure for item {name}")
                    return None
            else:
                logger.warning(f"LLM error for item {name}: {resp.status_code}")
                return None
        except Exception as e:
            logger.error(f"Failed to structure item {name}: {e}")
            return None

    def _parse_json_object(self, text: str) -> Optional[Dict]:
        """Parse JSON object from LLM response"""
        text = text.strip()
        if text.startswith("```json"):
            text = text[7:]
        if text.startswith("```"):
            text = text[3:]
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()

        # Try direct parse
        try:
            result = json.loads(text)
            if isinstance(result, dict):
                return result
        except:
            pass

        # Try finding object braces
        brace_match = re.search(r'\{[\s\S]*\}', text)
        if brace_match:
            try:
                result = json.loads(brace_match.group(0))
                if isinstance(result, dict):
                    return result
            except:
                pass

        return None

    def _repair_truncated_json(self, text: str) -> Optional[Dict]:
        """Attempt to repair truncated JSON from LLM responses.

        When the API truncates the response (finish_reason=length), the JSON
        is valid up to a point but missing closing braces/brackets.
        We try to close the JSON and parse what we have.
        """
        text = text.strip()
        if text.startswith("```json"):
            text = text[7:]
        if text.startswith("```"):
            text = text[3:]
        if text.endswith("```"):
            text = text[:-3]
        text = text.strip()

        # Find the first { to start from
        start = text.find('{')
        if start < 0:
            return None
        text = text[start:]

        # Remove any trailing incomplete string value (cut mid-string)
        # Find last complete key-value pair by looking for last comma or colon
        # that's followed by valid JSON structure
        for attempt in range(10):
            # Count open/close braces and brackets
            open_braces = text.count('{') - text.count('}')
            open_brackets = text.count('[') - text.count(']')

            # Check if we're inside a string (odd number of unescaped quotes)
            in_string = False
            last_good = len(text)
            for i in range(len(text) - 1, -1, -1):
                if text[i] == '"' and (i == 0 or text[i-1] != '\\'):
                    in_string = not in_string
                    if not in_string:
                        last_good = i + 1
                        break

            if in_string:
                # Truncated inside a string - close the string and trim
                text = text[:last_good] + '"'

            # Remove trailing partial entries (after last comma if incomplete)
            # Try to find the last complete value
            stripped = text.rstrip()
            if stripped.endswith(','):
                text = stripped[:-1]

            # Add closing brackets and braces
            open_braces = text.count('{') - text.count('}')
            open_brackets = text.count('[') - text.count(']')
            text = text + ']' * max(0, open_brackets) + '}' * max(0, open_braces)

            try:
                result = json.loads(text)
                if isinstance(result, dict):
                    return result
            except json.JSONDecodeError:
                # Try removing the last key-value pair (might be incomplete)
                # Find last comma before the closing we added
                core = text.rstrip('}').rstrip(']')
                last_comma = core.rfind(',')
                if last_comma > 0:
                    text = core[:last_comma]
                else:
                    return None

        return None

    def _reconstruct_text_from_structured(self, monster: Dict) -> str:
        """Reconstruct text from existing structured data to supplement description.

        When the monster's description field doesn't contain traits/actions/legendary
        text (because they were stored separately), we reconstruct it so the LLM
        can re-parse everything properly.
        """
        parts = []
        description = monster.get('description', '')

        # Check if description already contains action/trait keywords
        has_actions_text = any(kw in description for kw in ['命中+', '近战武器攻击', '远程武器攻击', '近战法术攻击'])
        has_legendary_text = '传奇动作' in description or 'Legendary Action' in description
        has_traits_text = any(kw in description for kw in ['传奇抗性', '魔法抗性', '施法', 'Spellcasting'])

        # Reconstruct specialAbilities text if missing from description
        if not has_traits_text:
            abilities = monster.get('specialAbilities', [])
            if isinstance(abilities, list) and abilities:
                parts.append("## 特殊能力")
                for a in abilities:
                    if isinstance(a, dict):
                        parts.append(f"**{a.get('name', '')}** {a.get('description', '')}")

        # Reconstruct actions text if missing from description
        if not has_actions_text:
            actions = monster.get('actions', [])
            if isinstance(actions, list) and actions:
                parts.append("## 动作 Actions")
                for a in actions:
                    if isinstance(a, dict):
                        parts.append(f"**{a.get('name', '')}** {a.get('description', '')}")

        # Reconstruct legendary actions text if missing from description
        if not has_legendary_text:
            legendary = monster.get('legendaryActions')
            if legendary:
                parts.append("## 传奇动作 Legendary Actions")
                if isinstance(legendary, dict):
                    if legendary.get('description'):
                        parts.append(legendary['description'])
                    for a in legendary.get('actions', []):
                        if isinstance(a, dict):
                            cost_str = f" (消耗{a['cost']}动作)" if a.get('cost', 1) > 1 else ""
                            parts.append(f"**{a.get('name', '')}{cost_str}** {a.get('description', '')}")
                elif isinstance(legendary, list):
                    for a in legendary:
                        if isinstance(a, dict):
                            cost_str = f" (消耗{a['cost']}动作)" if a.get('cost', 1) > 1 else ""
                            parts.append(f"**{a.get('name', '')}{cost_str}** {a.get('description', '')}")

        return "\n\n".join(parts)

    def _find_monster_text_in_toc(self, toc: List[Dict], name: str, name_en: str = "") -> Optional[str]:
        """Search the TOC tree for a monster's full text, including adjacent sections.

        Two-step re-numerification requires going back to the original chapter text.
        This method finds the TOC node matching the monster name, then collects
        its content plus any adjacent action/legendary/spell sections.
        """
        search_names = [n.lower().strip() for n in [name, name_en] if n]
        if not search_names:
            logger.warning(f"[TOC Search] No search names for monster, skipping")
            return None

        logger.info(f"[TOC Search] Searching for monster: name='{name}', name_en='{name_en}', search_names={search_names}")

        def _match_title(title: str) -> bool:
            t = title.lower().strip()
            for sn in search_names:
                if sn in t or t in sn:
                    return True
                # Handle bilingual: "阿瑟瑞克 Acererak"
                t_parts = t.split()
                for part in t_parts:
                    if part and (part in sn or sn in part):
                        return True
            return False

        def _collect_with_siblings(node: Dict, siblings: List[Dict], idx: int) -> str:
            """Collect node text + adjacent action/legendary sibling sections."""
            parts = [self._format_child_recursive(node)]
            if siblings and idx >= 0:
                for si in range(idx + 1, len(siblings)):
                    sib = siblings[si]
                    sib_title = sib.get("title", "")
                    sib_content = sib.get("content", "") or ""
                    if self._has_monster_stats(sib_content):
                        logger.info(f"[TOC Search] Stopping at next monster: '{sib_title}'")
                        break
                    if self._is_action_related(sib_title):
                        sib_text = self._format_child_recursive(sib)
                        if sib_text:
                            parts.append(sib_text)
                            logger.info(f"[TOC Search] MERGED sibling '{sib_title}' ({len(sib_text)} chars)")
                    else:
                        logger.info(f"[TOC Search] Stopping: sibling '{sib_title}' is not action-related")
                        break
            return "\n\n".join(p for p in parts if p)

        def _search_all_matches(nodes: List[Dict], parent_siblings=None, parent_idx=-1) -> List[dict]:
            """Find ALL matching nodes in the TOC tree, recording context."""
            matches = []
            for ci, node in enumerate(nodes):
                title = node.get("title", "")
                children = node.get("children", [])
                if _match_title(title):
                    content = node.get("content", "") or ""
                    has_stats = self._has_monster_stats(content)
                    # Also check children for stats
                    children_have_stats = any(
                        self._has_monster_stats(c.get("content", "") or "")
                        for c in children
                    )
                    matches.append({
                        "title": title,
                        "node": node,
                        "siblings": nodes,
                        "idx": ci,
                        "has_stats": has_stats or children_have_stats,
                        "content_len": len(content),
                    })
                    logger.info(
                        f"[TOC Search] Found match: '{title}' "
                        f"has_stats={has_stats} children_stats={children_have_stats} "
                        f"content={len(content)} chars"
                    )
                # Always recurse into children
                matches.extend(_search_all_matches(children, nodes, ci))
            return matches

        # Find all matches in the TOC
        all_matches = _search_all_matches(toc)
        logger.info(f"[TOC Search] Total matches: {len(all_matches)}")

        if not all_matches:
            logger.warning(f"[TOC Search] No matches found for '{name}'")
            return None

        # Priority: prefer matches that have monster stats (AC/HP)
        stat_matches = [m for m in all_matches if m["has_stats"]]
        if stat_matches:
            best = stat_matches[0]
            logger.info(f"[TOC Search] Using stat-block match: '{best['title']}'")
        else:
            # Fallback: use the match with the most content
            best = max(all_matches, key=lambda m: m["content_len"])
            logger.info(f"[TOC Search] No stat-block match, using largest: '{best['title']}'")

        result = _collect_with_siblings(best["node"], best["siblings"], best["idx"])
        logger.info(f"[TOC Search] Final text: {len(result)} chars")
        if result and len(result) > 50:
            logger.info(f"[TOC Search] SUCCESS for '{name}': {len(result)} chars")
            return result
        else:
            logger.warning(f"[TOC Search] Text too short ({len(result)} chars) for '{name}'")
            return None

    async def reparse_single_monster(
        self, db: AsyncSession, monster: Dict, toc: List[Dict] = None
    ) -> Optional[Dict]:
        """Re-parse a single monster using two-step process:
        Step 1: Find the monster's full text from TOC (including actions, legendary, spells)
        Step 2: Numerify the text into structured data
        """
        name = monster.get('name', 'Unknown')
        name_en = monster.get('name_en', '')
        description = monster.get('description', '')
        actions_text = monster.get('actions_text', '') or (
            monster.get('actions') if isinstance(monster.get('actions'), str) else ''
        )

        # Step 1: Try to find full text from TOC (the authoritative source)
        toc_text = None
        if toc:
            toc_text = self._find_monster_text_in_toc(toc, name, name_en)
            if toc_text:
                logger.info(f"[Reparse] Using TOC source text for '{name}' ({len(toc_text)} chars)")
                # Dump full text to file for debugging
                with open('/tmp/reparse_toc_text.txt', 'w', encoding='utf-8') as f:
                    f.write(toc_text)

        # Build the best possible description for step 2
        if toc_text:
            # TOC text is the most complete source
            prompt_desc = toc_text
        else:
            # Fallback: use existing description + supplements
            logger.warning(f"[Reparse] No TOC text found for '{name}', using existing description")
            prompt_desc = description
            if actions_text and isinstance(actions_text, str):
                prompt_desc = f"{description}\n\n{actions_text}"
            extra_text = self._reconstruct_text_from_structured(monster)
            if extra_text:
                prompt_desc = f"{prompt_desc}\n\n{extra_text}"

        if not prompt_desc:
            logger.warning(f"Cannot reparse {name}: no text source available")
            return None

        # Step 2: Numerify with LLM
        try:
            config = await ai_model_service.get_config_for_usage(db, "module_extract_monsters")
        except Exception as e:
            logger.error(f"No LLM config for module_extract_monsters: {e}")
            return None

        if not config:
            logger.error("No LLM config for module_extract_monsters")
            return None

        prompt = MONSTER_STRUCTURE_PROMPT.format(name=name, description=prompt_desc)

        logger.info(f"[Reparse] Prompt length: {len(prompt)} chars")
        logger.info(f"[Reparse] Prompt desc preview (first 500 chars):\n{prompt_desc[:500]}")
        logger.info(f"[Reparse] Prompt desc preview (last 500 chars):\n{prompt_desc[-500:]}")

        try:
            endpoint = config.api_url.rstrip('/')
            if not endpoint.endswith('/chat/completions'):
                endpoint = endpoint + '/chat/completions'

            async with httpx.AsyncClient(timeout=120.0) as client:
                resp = await client.post(
                    endpoint,
                    json={
                        "model": config.model_name,
                        "messages": [
                            {"role": "system", "content": "你是D&D 5E怪物数据解析专家，只返回JSON。"},
                            {"role": "user", "content": prompt}
                        ],
                        "temperature": 0,
                        "max_tokens": 8000
                    },
                    headers={
                        "Authorization": f"Bearer {config.api_key}",
                        "Content-Type": "application/json"
                    }
                )

            logger.info(f"[Reparse] LLM response status: {resp.status_code}")
            if resp.status_code == 200:
                data = resp.json()
                content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
                logger.info(f"[Reparse] LLM response length: {len(content)} chars")
                logger.info(f"[Reparse] LLM response preview: {content[:500]}...")
                parsed = self._parse_json_object(content)
                if parsed:
                    # Log key fields from parsed response
                    sa_count = len(parsed.get('specialAbilities', []) or [])
                    act_count = len(parsed.get('actions', []) or [])
                    la = parsed.get('legendaryActions')
                    la_desc = "None"
                    if isinstance(la, list):
                        la_desc = f"list[{len(la)}]"
                    elif isinstance(la, dict):
                        la_actions = la.get('actions', [])
                        la_desc = f"dict(actions={len(la_actions)})"
                    logger.info(f"[Reparse] Parsed: specialAbilities={sa_count}, actions={act_count}, legendaryActions={la_desc}")
                    # Log spellcasting
                    sc = parsed.get('spellcasting')
                    if sc:
                        logger.info(f"[Reparse] Spellcasting found: {json.dumps(sc, ensure_ascii=False)[:500]}")
                    else:
                        logger.warning(f"[Reparse] NO spellcasting in parsed result. Keys: {list(parsed.keys())}")

                    # Smart merge: don't let null/empty parsed values overwrite existing data
                    result = {**monster}
                    for key, val in parsed.items():
                        if val is None:
                            continue
                        if isinstance(val, (list, dict)) and not val:
                            continue
                        result[key] = val
                    # Update description if we found better text from TOC
                    if toc_text:
                        result['description'] = toc_text
                    else:
                        result['description'] = description
                        if isinstance(actions_text, str):
                            result['actions_text'] = actions_text
                    logger.info(f"Reparsed {name}: AC={parsed.get('ac')}, HP={parsed.get('hp')}, CR={parsed.get('cr')}")
                    return result
                else:
                    logger.warning(f"Failed to parse reparse response for {name}")
            else:
                logger.warning(f"LLM error for {name}: {resp.status_code}")

        except Exception as e:
            logger.error(f"Failed to reparse {name}: {e}")

        return None

    async def reparse_single_item(self, db: AsyncSession, item: Dict) -> Optional[Dict]:
        """Re-parse a single item to get updated structured data"""
        name = item.get('name', 'Unknown')
        description = item.get('description', '')

        if not description:
            logger.warning(f"Cannot reparse item {name}: no description")
            return None

        try:
            config = await ai_model_service.get_config_for_usage(db, "module_extract_items")
        except Exception as e:
            logger.error(f"No LLM config for module_extract_items: {e}")
            return None

        if not config:
            logger.error("No LLM config for module_extract_items")
            return None

        prompt = ITEM_STRUCTURE_PROMPT.format(name=name, description=description)

        try:
            endpoint = config.api_url.rstrip('/')
            if not endpoint.endswith('/chat/completions'):
                endpoint = endpoint + '/chat/completions'

            async with httpx.AsyncClient(timeout=60.0) as client:
                resp = await client.post(
                    endpoint,
                    json={
                        "model": config.model_name,
                        "messages": [
                            {"role": "system", "content": "你是D&D 5E魔法物品数据解析专家，只返回JSON。"},
                            {"role": "user", "content": prompt}
                        ],
                        "temperature": 0,
                        "max_tokens": 2000
                    },
                    headers={
                        "Authorization": f"Bearer {config.api_key}",
                        "Content-Type": "application/json"
                    }
                )

            if resp.status_code == 200:
                data = resp.json()
                content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
                parsed = self._parse_json_object(content)
                if parsed:
                    result = {**item, **parsed}
                    result['description'] = description  # Preserve original
                    logger.info(f"Reparsed item {name}: rarity={parsed.get('rarity')}, type={parsed.get('type')}")
                    return result
                else:
                    logger.warning(f"Failed to parse reparse response for item {name}")
            else:
                logger.warning(f"LLM error for item {name}: {resp.status_code}")

        except Exception as e:
            logger.error(f"Failed to reparse item {name}: {e}")

        return None


# Singleton instance
monster_item_extractor = MonsterItemExtractor()
