"""
Character Card Import Service
Converts uploaded files (PDF, MD, TXT, DOCX, XLSX) to Markdown,
then uses LLM to parse character data from the content.
"""
import json
import logging
import re
import tempfile
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple

from app.services.ai_service import AIService
from app.services.ai_model_service import AIModelService
from app.services.dm_character_generator import DMCharacterGenerator
from app.utils.rules_cache import (
    get_races_data, get_classes_data, get_spells_data,
    get_equipment_data, get_backgrounds_data, get_skills_data,
    get_feats_data,
)
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

ALLOWED_EXTENSIONS = {".pdf", ".md", ".txt", ".docx", ".xlsx"}
MAX_FILE_SIZE = 20 * 1024 * 1024  # 20MB


class CharacterImportService:

    @staticmethod
    async def convert_to_markdown(file_bytes: bytes, filename: str) -> str:
        """Convert uploaded file bytes to Markdown text based on extension."""
        ext = Path(filename).suffix.lower()

        if ext in (".md", ".txt"):
            return file_bytes.decode("utf-8", errors="replace")

        if ext == ".pdf":
            return await CharacterImportService._pdf_to_markdown(file_bytes, filename)

        if ext in (".docx", ".xlsx"):
            return await CharacterImportService._office_to_markdown(file_bytes, filename)

        raise ValueError(f"不支持的文件格式: {ext}")

    @staticmethod
    async def _pdf_to_markdown(file_bytes: bytes, filename: str) -> str:
        """Use the configured OCR service to convert PDF to markdown."""
        from app.services.mistral_ocr_service import get_ocr_service
        from app.services.module_parse_flow_service import normalize_ocr_conversion_result

        ocr_service = get_ocr_service()
        with tempfile.TemporaryDirectory(prefix="character_import_pdf_") as tmp_dir:
            temp_dir = Path(tmp_dir)
            pdf_path = temp_dir / filename
            output_dir = temp_dir / "converted"
            pdf_path.write_bytes(file_bytes)

            result = normalize_ocr_conversion_result(
                await ocr_service.convert_pdf_to_markdown(
                    pdf_path=pdf_path,
                    output_dir=output_dir,
                )
            )
            markdown_content = result.get("markdown_content")
            if markdown_content:
                return markdown_content
            markdown_path = Path(result["markdown_path"])
            return markdown_path.read_text(encoding="utf-8")

    @staticmethod
    async def _office_to_markdown(file_bytes: bytes, filename: str) -> str:
        """Use markitdown to convert DOCX/XLSX to markdown."""
        import tempfile, asyncio
        from markitdown import MarkItDown

        ext = Path(filename).suffix.lower()
        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
            tmp.write(file_bytes)
            tmp_path = tmp.name

        def _convert():
            md = MarkItDown()
            result = md.convert(tmp_path)
            return result.text_content

        loop = asyncio.get_event_loop()
        try:
            return await loop.run_in_executor(None, _convert)
        finally:
            Path(tmp_path).unlink(missing_ok=True)

    @staticmethod
    async def parse_character(markdown: str, db: AsyncSession) -> Dict[str, Any]:
        """Use LLM to parse markdown content into character data."""
        options = CharacterImportService._load_options()
        system_prompt, user_prompt = CharacterImportService._build_prompt(markdown, options)

        params = await AIModelService.get_usage_params(db, "character_card_import")
        response = await AIService.generate_completion(
            api_url=params.config.api_url,
            api_key=params.config.api_key,
            model=params.config.model_name,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=params.temperature,
            max_tokens=params.max_tokens,
        )

        raw = DMCharacterGenerator.extract_json(response)
        result = CharacterImportService._validate(raw, options)
        return result

    @staticmethod
    def _load_options() -> Dict[str, Any]:
        """Load all valid option lists from rules cache."""
        races_data = get_races_data()
        classes_data = get_classes_data()
        spells_data = get_spells_data()
        equipment_data = get_equipment_data()
        backgrounds_data = get_backgrounds_data()
        skills_data = get_skills_data()
        feats_data = get_feats_data()

        # Build race options: id, name, subraces
        race_options = []
        for r in races_data.get("races", []):
            entry = {"id": r["id"], "name": r.get("name", r["id"])}
            subraces = r.get("subraces", [])
            if subraces:
                entry["subraces"] = [{"id": s["id"], "name": s.get("name", s["id"])} for s in subraces]
            race_options.append(entry)

        # Build class options: id, name, subclasses
        class_options = []
        for c in classes_data.get("classes", []):
            entry = {"id": c["id"], "name": c.get("name", c["id"])}
            subclasses = c.get("subclasses", [])
            if subclasses:
                entry["subclasses"] = [{"id": s["id"], "name": s.get("name", s["id"])} for s in subclasses]
            class_options.append(entry)

        # Background options
        bg_options = [{"id": b["id"], "name": b.get("name", b["id"])} for b in backgrounds_data.get("backgrounds", [])]

        # Skill options
        skill_ids = [s["id"] for s in skills_data.get("skills", [])]

        # Spell options (id + name only, to save tokens)
        spell_options = [{"id": s["id"], "name": s.get("name", s["id"]), "level": s.get("level", 0)}
                         for s in spells_data.get("spells", [])]

        # Equipment options (id + name)
        equip_options = [{"id": e["id"], "name": e.get("name", e["id"])}
                         for e in equipment_data.get("equipment", [])]

        # Feat options
        feat_options = [{"id": f["id"], "name": f.get("name", f["id"])} for f in feats_data.get("feats", [])]

        return {
            "races": race_options,
            "classes": class_options,
            "backgrounds": bg_options,
            "skills": skill_ids,
            "spells": spell_options,
            "equipment": equip_options,
            "feats": feat_options,
        }

    @staticmethod
    def _build_prompt(markdown: str, options: Dict[str, Any]) -> Tuple[str, str]:
        """Build system + user prompts for LLM character parsing."""
        # Truncate markdown if too long (keep first 8000 chars)
        if len(markdown) > 8000:
            markdown = markdown[:8000] + "\n\n...(内容过长已截断)"

        # Build compact option lists
        race_list = json.dumps(options["races"], ensure_ascii=False)
        class_list = json.dumps(options["classes"], ensure_ascii=False)
        bg_list = json.dumps(options["backgrounds"], ensure_ascii=False)
        skill_list = json.dumps(options["skills"], ensure_ascii=False)
        feat_list = json.dumps(options["feats"], ensure_ascii=False)

        system_prompt = """你是一个 D&D 5E 角色卡解析专家。你的任务是从用户上传的角色卡文本中提取角色数据，并匹配到系统的有效选项中。

输出严格的 JSON，不要添加任何解释文字。所有 ID 字段必须从提供的选项列表中选择。

输出格式：
```json
{
    "name": "角色名",
    "raceId": "种族ID（从种族列表选择）",
    "subraceId": "亚种ID或null",
    "classId": "职业ID（从职业列表选择）",
    "subclassId": "子职业ID或null",
    "backgroundId": "背景ID或null",
    "level": 1,
    "alignment": "阵营（如 lawful_good, neutral, chaotic_evil 等）",
    "abilityScores": {
        "strength": 10,
        "dexterity": 10,
        "constitution": 10,
        "intelligence": 10,
        "wisdom": 10,
        "charisma": 10
    },
    "hp": 0,
    "selectedSkills": ["技能ID列表"],
    "selectedCantrips": ["戏法spell_id列表"],
    "selectedSpells": ["法术spell_id列表"],
    "equipment": [{"id": "物品ID", "name": "物品名", "quantity": 1}],
    "currency": {"cp": 0, "sp": 0, "ep": 0, "gp": 0, "pp": 0},
    "appearance": {
        "age": "",
        "height": "",
        "weight": "",
        "eyes": "",
        "skin": "",
        "hair": ""
    },
    "personality": {
        "traits": "",
        "ideals": "",
        "bonds": "",
        "flaws": ""
    },
    "backstory": "背景故事",
    "feats": ["专长feat_id列表"],
    "parseWarnings": ["无法匹配的内容说明"]
}
```

注意事项：
- 如果角色卡中某个字段未提及，使用合理默认值或 null
- 属性值（abilityScores）必须是 1-30 的整数
- 法术和戏法必须从法术列表中匹配，根据名称（中文或英文）查找最接近的 ID
- 装备必须从装备列表中匹配
- 无法确定的内容记入 parseWarnings"""

        user_prompt = f"""请从以下角色卡内容中提取角色数据。

## 可用选项

### 种族列表
{race_list}

### 职业列表
{class_list}

### 背景列表
{bg_list}

### 技能列表
{skill_list}

### 专长列表
{feat_list}

注意：法术和装备数量太多不在此列出，请根据名称返回最可能的 ID（使用英文小写下划线格式，如 "fire_bolt", "longsword"）。

## 角色卡内容

{markdown}"""

        return system_prompt, user_prompt

    @staticmethod
    def _validate(raw: Dict[str, Any], options: Dict[str, Any]) -> Dict[str, Any]:
        """Validate LLM output against valid option lists, record warnings."""
        warnings = raw.get("parseWarnings", [])
        if not isinstance(warnings, list):
            warnings = []

        # Validate race
        valid_race_ids = {r["id"] for r in options["races"]}
        if raw.get("raceId") and raw["raceId"] not in valid_race_ids:
            warnings.append(f"种族 '{raw['raceId']}' 不在有效列表中")
            raw["raceId"] = None

        # Validate class
        valid_class_ids = {c["id"] for c in options["classes"]}
        if raw.get("classId") and raw["classId"] not in valid_class_ids:
            warnings.append(f"职业 '{raw['classId']}' 不在有效列表中")
            raw["classId"] = None

        # Validate background
        valid_bg_ids = {b["id"] for b in options["backgrounds"]}
        if raw.get("backgroundId") and raw["backgroundId"] not in valid_bg_ids:
            warnings.append(f"背景 '{raw['backgroundId']}' 不在有效列表中")
            raw["backgroundId"] = None

        # Validate skills
        valid_skill_ids = set(options["skills"])
        if raw.get("selectedSkills"):
            invalid = [s for s in raw["selectedSkills"] if s not in valid_skill_ids]
            if invalid:
                warnings.append(f"技能不在有效列表: {', '.join(invalid)}")
                raw["selectedSkills"] = [s for s in raw["selectedSkills"] if s in valid_skill_ids]

        # Validate feats
        valid_feat_ids = {f["id"] for f in options["feats"]}
        if raw.get("feats"):
            invalid = [f for f in raw["feats"] if f not in valid_feat_ids]
            if invalid:
                warnings.append(f"专长不在有效列表: {', '.join(invalid)}")
                raw["feats"] = [f for f in raw["feats"] if f in valid_feat_ids]

        # Ensure ability scores are within range
        if raw.get("abilityScores"):
            for key, val in raw["abilityScores"].items():
                if isinstance(val, (int, float)):
                    raw["abilityScores"][key] = max(1, min(30, int(val)))

        # Ensure level is valid
        if raw.get("level"):
            raw["level"] = max(1, min(20, int(raw["level"])))

        raw["parseWarnings"] = warnings
        return raw
