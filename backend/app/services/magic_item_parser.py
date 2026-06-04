"""
Magic Item Parser Service
Extracts structured magic item data from module content using LLM
"""
import asyncio
import json
import httpx
import logging
import re
from typing import List, Dict, Any, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.parsed_module import ParsedModule
from app.services.ai_model_service import ai_model_service

logger = logging.getLogger(__name__)


MAGIC_ITEM_EXTRACT_PROMPT = """你是D&D 5E魔法物品数据提取专家。请从以下魔法物品内容中提取结构化数据。

## 输入内容
{content}

## 输出要求
提取每个魔法物品，返回JSON数组。每个物品必须包含以下字段：

```json
{{
  "name": "中文名称",
  "name_en": "英文名称（如果有）",
  "category": "物品类别",
  "subcategory": "子类别（如适用）",
  "rarity": "稀有度",
  "requires_attunement": true/false,
  "attunement_by": "同调限制（如有）",
  "description": "物品描述（不包含能力）",
  "magic_bonus": null或数字,
  "damage": null或{{"dice": "骰子", "type": "伤害类型"}},
  "extra_damage": null或{{"dice": "骰子", "type": "伤害类型"}},
  "abilities": [
    {{
      "name": "能力名称",
      "name_en": "英文名称",
      "type": "passive/active/rechargeable/triggered",
      "description": "能力描述",
      "uses": null或{{"per": "day/long_rest/short_rest", "max": 数量}}
    }}
  ],
  "charges": null或{{
    "max": 最大充能,
    "recharge": {{"time": "dawn/midnight/long_rest", "amount": "恢复量如1d6+1"}}
  }},
  "item_spells": null或[
    {{
      "name": "法术名称",
      "name_en": "英文名称",
      "charges": 消耗充能数,
      "level": 法术环阶或"cantrip",
      "save_dc": DC值或null,
      "attack_bonus": 攻击加值或null
    }}
  ],
  "sentient": null或{{
    "is_sentient": true,
    "alignment": "阵营",
    "languages": ["语言列表"]
  }},
  "properties": ["武器特性列表"]
}}
```

## 字段说明
- **category**: weapon(武器)/armor(护甲)/wondrous_item(奇物)/wand(魔杖)/rod(法杖)/ring(戒指)/potion(药水)/scroll(卷轴)/staff(权杖)
- **subcategory**: 武器子类(如greatsword/longsword)，护甲子类(如plate/chain_mail)
- **rarity**: common/uncommon/rare/very_rare/legendary/artifact
- **ability.type**:
  - passive: 被动效果（持续生效）
  - active: 主动使用（需要动作）
  - rechargeable: 有使用次数限制
  - triggered: 触发型（满足条件时生效）

## 示例输出
[
  {{
    "name": "黑龙面具",
    "name_en": "Black Dragon Mask",
    "category": "wondrous_item",
    "subcategory": "mask",
    "rarity": "legendary",
    "requires_attunement": true,
    "attunement_by": null,
    "description": "这具以抛光黑檀木制成的带角面具其造型如同一个长角的颅骨。面具会调整自身尺寸以便其同调者着装。",
    "magic_bonus": null,
    "damage": null,
    "extra_damage": null,
    "abilities": [
      {{
        "name": "伤害吸收",
        "name_en": "Damage Absorption",
        "type": "passive",
        "description": "你对强酸伤害拥有抗性，如果你已经从另一来源拥有了强酸伤害的抗性，则你改为对强酸伤害免疫。若你此前已从另一来源获得了强酸伤害免疫，则你在受到强酸伤害时，可恢复其伤害量一半的生命值。"
      }},
      {{
        "name": "龙形威严",
        "name_en": "Draconic Majesty",
        "type": "passive",
        "description": "你未着装护甲时，可以将自己的魅力加值加入你的护甲等级中。"
      }},
      {{
        "name": "传奇抗性",
        "name_en": "Legendary Resistance",
        "type": "rechargeable",
        "description": "你进行一次豁免检定失败时，可以选择将其改为豁免成功。",
        "uses": {{"per": "day", "max": 1}}
      }},
      {{
        "name": "水下呼吸",
        "name_en": "Water Breathing",
        "type": "passive",
        "description": "你可以在水下呼吸。"
      }}
    ],
    "charges": null,
    "item_spells": null,
    "sentient": null,
    "properties": null
  }},
  {{
    "name": "哈兹瑞恩",
    "name_en": "Hazirawn",
    "category": "weapon",
    "subcategory": "greatsword",
    "rarity": "legendary",
    "requires_attunement": true,
    "attunement_by": null,
    "description": "作为一把智能巨剑（中立邪恶），哈兹瑞恩会说通用语和耐色瑞尔语。",
    "magic_bonus": 2,
    "damage": {{"dice": "2d6", "type": "slashing"}},
    "extra_damage": {{"dice": "2d6", "type": "necrotic"}},
    "abilities": [
      {{
        "name": "提升效能",
        "name_en": "Increased Potency",
        "type": "passive",
        "description": "你与该武器同调后，其攻击检定和伤害掷骰的加值提升为+2，且其命中时造成的额外伤害改为2d6的黯蚀伤害。"
      }},
      {{
        "name": "致伤",
        "name_en": "Wounding",
        "type": "triggered",
        "description": "你与该武器同调后，任何被你以哈兹瑞恩命中的生物在1分钟内无法恢复生命值。该目标在其每个自己回合结束时，可以进行一次DC 15的体质豁免，豁免成功则该效应提前终止。"
      }}
    ],
    "charges": {{"max": 4, "recharge": {{"time": "midnight", "amount": "1d4"}}}},
    "item_spells": [
      {{"name": "侦测魔法", "name_en": "Detect Magic", "charges": 1, "level": 1}},
      {{"name": "侦测善恶", "name_en": "Detect Evil and Good", "charges": 1, "level": 1}},
      {{"name": "侦测思想", "name_en": "Detect Thoughts", "charges": 2, "level": 2}}
    ],
    "sentient": {{
      "is_sentient": true,
      "alignment": "neutral_evil",
      "languages": ["Common", "Netherese"]
    }},
    "properties": ["heavy", "two-handed"]
  }}
]

只返回JSON数组，不要其他内容。"""


class MagicItemParser:
    """Service for parsing magic items with structured data extraction"""

    MAX_ENTRY_SIZE = 8000
    MAX_BATCH_SIZE = 40000

    async def parse_items_from_module(
        self,
        db: AsyncSession,
        module_id: str,
        progress_callback: Optional[callable] = None
    ) -> Dict[str, Any]:
        """Parse magic items from module with full structured data"""
        result = await db.execute(
            select(ParsedModule).where(ParsedModule.module_id == module_id)
        )
        module = result.scalar_one_or_none()

        if not module:
            return {"items": [], "count": 0, "status": "error", "message": "Module not found"}

        toc = module.toc or []

        # Find item appendix entries
        item_entries = self._find_item_entries(toc)

        if not item_entries:
            return {"items": [], "count": 0, "status": "error", "message": "Item appendix not found"}

        if progress_callback:
            await progress_callback(f"找到 {len(item_entries)} 个物品条目，开始结构化解析...", 10)

        # Process in batches
        all_items = []
        batches = self._create_batches(item_entries)

        for i, batch_content in enumerate(batches):
            if progress_callback:
                progress = 10 + int((i / len(batches)) * 70)
                await progress_callback(f"解析批次 {i+1}/{len(batches)}...", progress)

            batch_items = await self._extract_structured_items(db, batch_content)
            all_items.extend(batch_items)

        if progress_callback:
            await progress_callback(f"解析完成，共 {len(all_items)} 个魔法物品", 90)

        # Save to module
        module.items = all_items
        module.items_count = len(all_items)
        await db.commit()

        if progress_callback:
            await progress_callback("魔法物品解析完成", 100)

        return {"items": all_items, "count": len(all_items), "status": "success"}

    def _find_item_entries(self, toc: List[Dict]) -> List[str]:
        """Find and format item entries from TOC"""
        item_entries = []

        for item in toc:
            title = item.get("title", "")
            # Match item appendix
            if "附录" in title and ("物品" in title or "Item" in title or "Magic" in title):
                children = item.get("children", [])
                if children:
                    for child in children:
                        entry = self._format_entry(child)
                        if entry:
                            item_entries.append(entry)
                    break

        return item_entries

    def _format_entry(self, toc_item: Dict) -> str:
        """Format a single TOC entry"""
        title = toc_item.get("title", "")
        content = toc_item.get("content", "") or ""

        if len(content) > self.MAX_ENTRY_SIZE:
            content = content[:self.MAX_ENTRY_SIZE] + "\n...[内容截断]"

        if title or content:
            return f"### {title}\n{content}"
        return ""

    def _create_batches(self, entries: List[str]) -> List[str]:
        """Group entries into batches"""
        batches = []
        current_batch = []
        current_size = 0

        for entry in entries:
            entry_size = len(entry)
            if current_size + entry_size > self.MAX_BATCH_SIZE and current_batch:
                batches.append("\n\n---\n\n".join(current_batch))
                current_batch = [entry]
                current_size = entry_size
            else:
                current_batch.append(entry)
                current_size += entry_size

        if current_batch:
            batches.append("\n\n---\n\n".join(current_batch))

        return batches

    async def _extract_structured_items(
        self,
        db: AsyncSession,
        content: str,
        max_retries: int = 2
    ) -> List[Dict]:
        """Extract structured magic item data using LLM"""
        try:
            config = await ai_model_service.get_config_for_usage(db, "module_extract_items")
        except Exception as e:
            logger.error(f"Failed to get AI config: {e}")
            return []

        if len(content) > 50000:
            content = content[:50000]

        prompt = MAGIC_ITEM_EXTRACT_PROMPT.format(content=content)

        endpoint = config.api_url.rstrip('/')
        if not endpoint.endswith('/chat/completions'):
            endpoint = endpoint + '/chat/completions'

        request_body = {
            "model": config.model_name,
            "messages": [
                {"role": "system", "content": "你是D&D 5E魔法物品数据提取专家。严格按照要求的JSON格式输出结构化数据。"},
                {"role": "user", "content": prompt}
            ],
            "max_tokens": 16000,
            "temperature": 0.1
        }

        for attempt in range(max_retries + 1):
            try:
                logger.info(f"Magic item extraction attempt {attempt + 1}")
                timeout = httpx.Timeout(90.0, connect=10.0)

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
                    logger.error(f"LLM API error: {resp.status_code}")
                    if attempt < max_retries:
                        await asyncio.sleep(2)
                        continue
                    return []

                data = resp.json()
                response_content = data.get("choices", [{}])[0].get("message", {}).get("content", "")

                if not response_content:
                    if attempt < max_retries:
                        await asyncio.sleep(2)
                        continue
                    return []

                result = self._parse_json_response(response_content)
                # Validate and normalize items
                validated = [self._validate_item(item) for item in result]
                logger.info(f"Extracted {len(validated)} structured magic items")
                return validated

            except httpx.TimeoutException:
                logger.warning(f"LLM timeout (attempt {attempt + 1})")
                if attempt < max_retries:
                    await asyncio.sleep(3)
                    continue
            except Exception as e:
                logger.error(f"Extraction failed: {e}")
                if attempt < max_retries:
                    await asyncio.sleep(2)
                    continue

        return []

    def _parse_json_response(self, text: str) -> List[Dict]:
        """Parse JSON array from LLM response"""
        # Direct parse
        try:
            return json.loads(text)
        except:
            pass

        # Extract from code block
        code_match = re.search(r'```(?:json)?\s*([\s\S]*?)```', text)
        if code_match:
            try:
                return json.loads(code_match.group(1))
            except:
                pass

        # Find array brackets
        bracket_match = re.search(r'\[[\s\S]*\]', text)
        if bracket_match:
            try:
                return json.loads(bracket_match.group(0))
            except:
                pass

        return []

    def _validate_item(self, item: Dict) -> Dict:
        """Validate and normalize magic item data"""
        # Ensure required fields
        validated = {
            "name": item.get("name", "Unknown Item"),
            "name_en": item.get("name_en"),
            "category": item.get("category", "wondrous_item"),
            "subcategory": item.get("subcategory"),
            "rarity": self._normalize_rarity(item.get("rarity", "common")),
            "requires_attunement": bool(item.get("requires_attunement", False)),
            "attunement_by": item.get("attunement_by"),
            "description": item.get("description", ""),
            "magic_bonus": item.get("magic_bonus"),
            "damage": item.get("damage"),
            "extra_damage": item.get("extra_damage"),
            "abilities": item.get("abilities") or [],
            "charges": item.get("charges"),
            "item_spells": item.get("item_spells"),
            "sentient": item.get("sentient"),
            "properties": item.get("properties"),
        }
        return validated

    def _normalize_rarity(self, rarity: str) -> str:
        """Normalize rarity string to standard format"""
        if not rarity:
            return "common"

        rarity_lower = rarity.lower()
        mapping = {
            "普通": "common",
            "不常见": "uncommon",
            "罕见": "rare",
            "非常罕见": "very_rare",
            "极罕见": "very_rare",
            "传奇": "legendary",
            "神器": "artifact",
        }

        for cn, en in mapping.items():
            if cn in rarity_lower:
                return en

        if "very" in rarity_lower or "very_rare" in rarity_lower:
            return "very_rare"

        valid = ["common", "uncommon", "rare", "very_rare", "legendary", "artifact"]
        for v in valid:
            if v in rarity_lower:
                return v

        return "common"

    async def convert_simple_items_to_structured(
        self,
        db: AsyncSession,
        simple_items: List[Dict],
        progress_callback: Optional[callable] = None
    ) -> List[Dict]:
        """
        Convert simple format items (name, name_en, description, actions)
        to structured format using LLM.
        """
        if not simple_items:
            return []

        if progress_callback:
            await progress_callback(f"开始转换 {len(simple_items)} 个物品为结构化格式...", 10)

        # Format items as text for LLM
        formatted_content = []
        for item in simple_items:
            item_text = f"### {item.get('name', 'Unknown')}"
            if item.get('name_en'):
                item_text += f"\n{item.get('name_en')}"
            if item.get('description'):
                item_text += f"\n\n描述\n{item.get('description')}"
            if item.get('actions'):
                item_text += f"\n\n特殊能力\n{item.get('actions')}"
            formatted_content.append(item_text)

        # Process in batches
        all_items = []
        batches = self._create_batches(formatted_content)

        for i, batch_content in enumerate(batches):
            if progress_callback:
                progress = 10 + int((i / len(batches)) * 80)
                await progress_callback(f"LLM 解析批次 {i+1}/{len(batches)}...", progress)

            batch_items = await self._extract_structured_items(db, batch_content)
            all_items.extend(batch_items)

        if progress_callback:
            await progress_callback(f"转换完成，共 {len(all_items)} 个结构化物品", 100)

        return all_items

    async def reparse_module_items(
        self,
        db: AsyncSession,
        module_id: str,
        progress_callback: Optional[callable] = None
    ) -> Dict[str, Any]:
        """
        Re-parse module items from simple format to structured format.
        Updates the module's items field with structured data.
        """
        result = await db.execute(
            select(ParsedModule).where(ParsedModule.module_id == module_id)
        )
        module = result.scalar_one_or_none()

        if not module:
            return {"status": "error", "message": "Module not found"}

        simple_items = module.items or []
        if not simple_items:
            return {"status": "error", "message": "No items to convert"}

        if progress_callback:
            await progress_callback(f"模组 {module.name} 有 {len(simple_items)} 个物品", 5)

        # Convert to structured format
        structured_items = await self.convert_simple_items_to_structured(
            db, simple_items, progress_callback
        )

        # Update module
        module.items = structured_items
        module.items_count = len(structured_items)
        await db.commit()

        return {
            "status": "success",
            "items": structured_items,
            "count": len(structured_items)
        }


# Singleton instance
magic_item_parser = MagicItemParser()
