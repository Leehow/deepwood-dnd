"""
DM High-Level Character Generator Service

Multi-stage character generation that produces D&D 5E rule-compliant characters.
Stages:
1. Basic Selection (race, class, background, alignment)
2. Skill Selection (validated against class + background)
3. Subclass Selection (level 1 for cleric/sorcerer/warlock, level 3+ for others)
4. Class Features (fighting style, favored enemy, etc.)
5. Spell Selection (cantrips + spells for spellcasters)
6. Equipment Selection (starting equipment from class + background)
"""

import json
import random
import re
from pathlib import Path
from typing import Dict, Any, List, Optional, Tuple

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.ai_service import AIService
from app.services.character_generator import CharacterGenerator
from app.utils.rules_cache import get_equipment_data


# Recommended weapons by class for intelligent selection
CLASS_WEAPON_PREFERENCES = {
    "fighter": {
        "simple_melee": ["handaxe", "javelin", "spear"],
        "simple_ranged": ["light_crossbow", "shortbow"],
        "melee": ["longsword", "greatsword", "battleaxe", "warhammer"],
        "ranged": ["longbow", "heavy_crossbow"],
    },
    "paladin": {
        "simple_melee": ["javelin", "mace"],
        "simple_ranged": ["light_crossbow"],
        "melee": ["longsword", "greatsword", "warhammer", "maul"],
        "ranged": ["javelin"],
    },
    "ranger": {
        "simple_melee": ["dagger", "handaxe", "spear"],
        "simple_ranged": ["shortbow", "light_crossbow"],
        "melee": ["shortsword", "scimitar", "rapier"],
        "ranged": ["longbow", "shortbow"],
    },
    "rogue": {
        "simple_melee": ["dagger"],
        "simple_ranged": ["shortbow", "light_crossbow"],
        "melee": ["rapier", "shortsword", "dagger"],
        "ranged": ["shortbow", "hand_crossbow"],
    },
    "barbarian": {
        "simple_melee": ["handaxe", "javelin"],
        "simple_ranged": ["shortbow"],
        "melee": ["greataxe", "greatsword", "maul"],
        "ranged": ["javelin", "handaxe"],
    },
    "monk": {
        "simple_melee": ["quarterstaff", "dagger", "spear"],
        "simple_ranged": ["dart", "shortbow"],
        "melee": ["quarterstaff", "shortsword"],
        "ranged": ["dart", "shortbow"],
    },
    "cleric": {
        "simple_melee": ["mace", "quarterstaff"],
        "simple_ranged": ["light_crossbow"],
        "melee": ["mace", "warhammer", "morningstar"],
        "ranged": ["light_crossbow"],
    },
    "druid": {
        "simple_melee": ["quarterstaff", "sickle", "dagger"],
        "simple_ranged": ["dart", "sling"],
        "melee": ["quarterstaff", "scimitar", "club"],
        "ranged": ["dart", "sling"],
    },
    "bard": {
        "simple_melee": ["dagger"],
        "simple_ranged": ["light_crossbow", "shortbow"],
        "melee": ["rapier", "longsword", "shortsword"],
        "ranged": ["shortbow", "hand_crossbow"],
    },
    "warlock": {
        "simple_melee": ["dagger", "quarterstaff"],
        "simple_ranged": ["light_crossbow"],
        "melee": ["quarterstaff", "dagger"],
        "ranged": ["light_crossbow"],
    },
    "wizard": {
        "simple_melee": ["dagger", "quarterstaff"],
        "simple_ranged": ["light_crossbow"],
        "melee": ["quarterstaff", "dagger"],
        "ranged": ["light_crossbow"],
    },
    "sorcerer": {
        "simple_melee": ["dagger", "quarterstaff"],
        "simple_ranged": ["light_crossbow"],
        "melee": ["quarterstaff", "dagger"],
        "ranged": ["light_crossbow"],
    },
}


class DMCharacterGenerator:
    """Generates rule-compliant high-level characters for DM debugging."""

    # Classes that get subclass at level 1
    LEVEL1_SUBCLASS_CLASSES = ["cleric", "sorcerer", "warlock"]

    # Classes with spellcasting
    SPELLCASTER_CLASSES = ["bard", "cleric", "druid", "paladin", "ranger", "sorcerer", "warlock", "wizard"]

    # Classes with fighting style
    FIGHTING_STYLE_CLASSES = ["fighter", "paladin", "ranger"]

    # Fighting style options by class
    FIGHTING_STYLES = {
        "fighter": ["archery", "defense", "dueling", "great_weapon_fighting", "protection", "two_weapon_fighting"],
        "paladin": ["defense", "dueling", "great_weapon_fighting", "protection"],
        "ranger": ["archery", "defense", "dueling", "two_weapon_fighting"]
    }

    @staticmethod
    def extract_json(content: str) -> Dict[str, Any]:
        """Extract JSON from AI response, handling markdown code blocks."""
        m = re.search(r"```json\s*([\s\S]*?)\s*```", content) or re.search(r"```\s*([\s\S]*?)\s*```", content)
        js = m.group(1) if m else content
        js = js.strip()
        try:
            return json.loads(js)
        except Exception:
            start = js.find("{")
            end = js.rfind("}")
            if start != -1 and end != -1:
                return json.loads(js[start: end + 1])
            raise

    @staticmethod
    def get_class_skill_choices(class_obj: Dict) -> Tuple[List[str], int]:
        """Get available skills and number of choices for a class."""
        prof = class_obj.get("proficiencies", {})
        available = prof.get("skillsAvailable", [])
        num_choices = int(prof.get("skillChoices", 0))
        return available, num_choices

    @staticmethod
    def get_background_skills(bg_obj: Dict) -> List[str]:
        """Get skill proficiencies granted by a background."""
        return bg_obj.get("skillProficiencies", [])

    @staticmethod
    def get_spellcasting_info(class_obj: Dict, level: int) -> Dict[str, Any]:
        """Get spellcasting info for a class at given level."""
        spellcasting = class_obj.get("spellcasting")
        if not spellcasting:
            return {"cantrips": 0, "spells_known": 0, "is_prepared": False, "ability": None}

        # Get cantrips known at level
        cantrips_known = spellcasting.get("cantripsKnown", {})
        cantrips = 0
        for lvl_str, count in sorted(cantrips_known.items(), key=lambda x: int(x[0])):
            if int(lvl_str) <= level:
                cantrips = count

        # Get spells known (for non-prepared casters)
        spells_known = spellcasting.get("spellsKnown", {})
        spells = 0
        for lvl_str, count in sorted(spells_known.items(), key=lambda x: int(x[0])):
            if int(lvl_str) <= level:
                spells = count

        return {
            "cantrips": cantrips,
            "spells_known": spells,
            "is_prepared": spellcasting.get("preparedSpells", False),
            "ability": spellcasting.get("ability"),
            "pact_magic": spellcasting.get("pactMagic", False)
        }

    @staticmethod
    def get_max_spell_level(class_id: str, level: int) -> int:
        """Get maximum spell level available at character level."""
        # Full casters: bard, cleric, druid, sorcerer, wizard
        full_casters = ["bard", "cleric", "druid", "sorcerer", "wizard"]
        # Half casters: paladin, ranger (start at level 2)
        half_casters = ["paladin", "ranger"]
        # Pact magic: warlock (special progression)

        if class_id in full_casters:
            # Full casters get spell level = (level + 1) // 2, max 9
            return min(9, (level + 1) // 2)
        elif class_id in half_casters:
            if level < 2:
                return 0
            # Half casters: slower progression
            return min(5, (level + 1) // 4 + 1)
        elif class_id == "warlock":
            # Warlock pact magic: max 5th level spells
            if level < 1:
                return 0
            elif level < 3:
                return 1
            elif level < 5:
                return 2
            elif level < 7:
                return 3
            elif level < 9:
                return 4
            else:
                return 5
        return 0

    @staticmethod
    async def generate_stage1_basics(
        description: str,
        target_level: int,
        races_data: Dict,
        classes_data: Dict,
        backgrounds_data: Dict,
        config: Any,
        temperature: float,
        max_tokens: int
    ) -> Dict[str, Any]:
        """Stage 1: Select race, class, background, alignment based on description."""
        races_opts = [
            {"id": r.get("id"), "name": r.get("name"), "subraces": [sr.get("id") for sr in r.get("subraces", [])]}
            for r in races_data.get("races", [])
        ]
        classes_opts = [
            {"id": c.get("id"), "name": c.get("name")}
            for c in classes_data.get("classes", [])
        ]
        bgs_opts = [
            {"id": b.get("id"), "name": b.get("name")}
            for b in backgrounds_data.get("backgrounds", [])
        ]

        # Continue in next section...
        prompt = f"""你是D&D 5E角色构建专家。根据描述选择最合适的种族、职业、背景和阵营。

用户描述：{description}
目标等级：{target_level}

可选项:
races: {json.dumps(races_opts, ensure_ascii=False)}
classes: {json.dumps(classes_opts, ensure_ascii=False)}  
backgrounds: {json.dumps(bgs_opts, ensure_ascii=False)}

返回JSON（无markdown）：
{{"raceId": "id", "subraceId": "可选", "classId": "id", "backgroundId": "id", "alignment": "守序善良/中立善良/混乱善良/守序中立/绝对中立/混乱中立/守序邪恶/中立邪恶/混乱邪恶"}}"""

        response = await AIService.generate_completion(
            api_url=config.api_url, api_key=config.api_key, model=config.model_name,
            messages=[{"role": "user", "content": prompt}],
            temperature=temperature, max_tokens=max_tokens
        )
        return DMCharacterGenerator.extract_json(response)

    @staticmethod
    async def generate_stage2_skills(
        description: str,
        class_id: str,
        background_id: str,
        class_obj: Dict,
        bg_obj: Dict,
        skills_data: Dict,
        config: Any,
        temperature: float,
        max_tokens: int
    ) -> List[str]:
        """Stage 2: Select skills with strict validation."""
        # Get class available skills and number of choices
        class_available, class_choices = DMCharacterGenerator.get_class_skill_choices(class_obj)
        # Get background fixed skills
        bg_skills = DMCharacterGenerator.get_background_skills(bg_obj) if bg_obj else []

        all_skills = [{"id": s.get("id"), "name": s.get("name")} for s in skills_data.get("skills", [])]

        prompt = f"""你是D&D 5E角色构建专家。为角色选择技能熟练项。

角色描述：{description}
职业：{class_id}
背景：{background_id}

规则：
1. 背景提供固定技能：{json.dumps(bg_skills, ensure_ascii=False)}（必须包含）
2. 职业可选技能（选{class_choices}个）：{json.dumps(class_available, ensure_ascii=False)}
3. 如果背景技能与职业选择重复，可以从任意技能中替换

所有技能列表：{json.dumps(all_skills, ensure_ascii=False)}

返回JSON：{{"selectedSkills": ["skill_id_1", "skill_id_2", ...]}}
共应该有 {len(bg_skills) + class_choices} 个技能"""

        response = await AIService.generate_completion(
            api_url=config.api_url, api_key=config.api_key, model=config.model_name,
            messages=[{"role": "user", "content": prompt}],
            temperature=temperature, max_tokens=max_tokens
        )
        result = DMCharacterGenerator.extract_json(response)

        # Validate and fix skills
        selected = result.get("selectedSkills", [])
        valid_skill_ids = {s.get("id") for s in skills_data.get("skills", [])}
        selected = [s for s in selected if s in valid_skill_ids]

        # Ensure background skills are included
        for bg_skill in bg_skills:
            if bg_skill not in selected and bg_skill in valid_skill_ids:
                selected.append(bg_skill)

        # Limit to expected count
        expected_count = len(bg_skills) + class_choices
        return selected[:expected_count]

    @staticmethod
    async def generate_stage3_subclass(
        description: str,
        class_id: str,
        target_level: int,
        class_obj: Dict,
        config: Any,
        temperature: float,
        max_tokens: int
    ) -> Optional[str]:
        """Stage 3: Select subclass if applicable."""
        # Check if subclass is needed
        needs_subclass_at_1 = class_id in DMCharacterGenerator.LEVEL1_SUBCLASS_CLASSES
        needs_subclass_at_3 = target_level >= 3 and class_id not in DMCharacterGenerator.LEVEL1_SUBCLASS_CLASSES

        if not (needs_subclass_at_1 or needs_subclass_at_3):
            return None

        subclasses = class_obj.get("subclasses", [])
        if not subclasses:
            return None

        subclass_opts = [{"id": s.get("id"), "name": s.get("name"), "desc": s.get("description", "")[:100]}
                         for s in subclasses]

        prompt = f"""你是D&D 5E角色构建专家。为角色选择子职业。

角色描述：{description}
职业：{class_obj.get("name")}
等级：{target_level}

可选子职业：{json.dumps(subclass_opts, ensure_ascii=False)}

根据角色概念选择最合适的子职业。返回JSON：{{"subclassId": "id"}}"""

        response = await AIService.generate_completion(
            api_url=config.api_url, api_key=config.api_key, model=config.model_name,
            messages=[{"role": "user", "content": prompt}],
            temperature=temperature, max_tokens=max_tokens
        )
        result = DMCharacterGenerator.extract_json(response)

        # Validate
        subclass_id = result.get("subclassId")
        valid_ids = {s.get("id") for s in subclasses}
        if subclass_id in valid_ids:
            return subclass_id
        return subclasses[0].get("id") if subclasses else None

    # Invocation count by warlock level
    WARLOCK_INVOCATION_COUNT = {2: 2, 5: 3, 7: 4, 9: 5, 12: 6, 15: 7, 18: 8}

    # Invocations available by minimum warlock level (0 means no level req)
    ELDRITCH_INVOCATIONS = {
        0: ["agonizing_blast", "armor_of_shadows", "beast_speech", "beguiling_influence",
            "book_of_ancient_secrets", "devils_sight", "eldritch_sight", "eldritch_spear",
            "eyes_of_the_rune_keeper", "fiendish_vigor", "gaze_of_two_minds",
            "mask_of_many_faces", "misty_visions", "repelling_blast",
            "thief_of_five_fates", "voice_of_the_chain_master"],
        5: ["mire_the_mind", "one_with_shadows", "sign_of_ill_omen", "thirsting_blade"],
        7: ["bewitching_whispers", "dreadful_word", "sculptor_of_flesh"],
        9: ["ascendant_step", "minions_of_chaos", "otherworldly_leap", "whispers_of_the_grave"],
        12: ["lifedrinker"],
        15: ["chains_of_carceri", "master_of_myriad_forms", "visions_of_distant_realms", "witch_sight"],
    }

    # Battle Master maneuver options
    BATTLE_MASTER_MANEUVERS = [
        "commanders_strike", "disarming_attack", "distracting_strike",
        "evasive_footwork", "feinting_attack", "goading_attack",
        "lunging_attack", "maneuvering_attack", "menacing_attack",
        "parry", "precision_attack", "pushing_attack",
        "rally", "riposte", "sweeping_attack", "trip_attack",
    ]

    # Battle Master maneuver count by level
    BATTLE_MASTER_MANEUVER_COUNT = {3: 3, 7: 5, 10: 7, 15: 9}

    # Four Elements elemental discipline options by level requirement
    ELEMENTAL_DISCIPLINES_BY_LEVEL = {
        3: ["fangs_of_fire_snake", "fist_of_four_thunders", "fist_of_unbroken_air",
            "rush_of_gale_spirits", "shape_the_flowing_river", "sweeping_cinder_strike", "water_whip"],
        6: ["clench_of_the_north_wind", "gong_of_the_summit"],
        11: ["flames_of_the_phoenix", "mist_stance", "ride_the_wind"],
        17: ["eternal_mountain_defense", "river_of_hungry_flame", "breath_of_winter", "wave_of_rolling_earth"],
    }
    # Total disciplines known: 2 at 3, 3 at 6, 4 at 11, 5 at 17
    ELEMENTAL_DISCIPLINE_COUNT = {3: 2, 6: 3, 11: 4, 17: 5}

    @staticmethod
    async def generate_stage4_features(
        description: str,
        class_id: str,
        subclass_id: Optional[str],
        target_level: int,
        selected_skills: List[str],
        config: Any,
        temperature: float,
        max_tokens: int
    ) -> Dict[str, Any]:
        """Stage 4: Select class features (fighting style, favored enemy, expertise, invocations, maneuvers)."""
        features = {}

        # Fighting Style (Fighter 1, Paladin 2, Ranger 2)
        if class_id in DMCharacterGenerator.FIGHTING_STYLE_CLASSES:
            min_level = 1 if class_id == "fighter" else 2
            if target_level >= min_level:
                styles = DMCharacterGenerator.FIGHTING_STYLES.get(class_id, [])
                prompt = f"""角色描述：{description}
职业：{class_id}

从以下格斗风格中选择一个最合适的：{json.dumps(styles)}
返回JSON：{{"fightingStyle": "style_id"}}"""
                response = await AIService.generate_completion(
                    api_url=config.api_url, api_key=config.api_key, model=config.model_name,
                    messages=[{"role": "user", "content": prompt}],
                    temperature=temperature, max_tokens=max_tokens
                )
                result = DMCharacterGenerator.extract_json(response)
                style = result.get("fightingStyle")
                if style in styles:
                    features["fighting_style"] = style

        # Ranger: Favored Enemy and Terrain (level 1)
        if class_id == "ranger" and target_level >= 1:
            enemies = ["aberrations", "beasts", "celestials", "constructs", "dragons",
                      "elementals", "fey", "fiends", "giants", "monstrosities",
                      "oozes", "plants", "undead", "humanoids"]
            terrains = ["arctic", "coast", "desert", "forest", "grassland",
                       "mountain", "swamp", "underground"]

            prompt = f"""角色描述：{description}
职业：游侠

选择宿敌类型：{json.dumps(enemies)}
选择擅长地形：{json.dumps(terrains)}
返回JSON：{{"favoredEnemy": "type", "favoredTerrain": "terrain"}}"""
            response = await AIService.generate_completion(
                api_url=config.api_url, api_key=config.api_key, model=config.model_name,
                messages=[{"role": "user", "content": prompt}],
                temperature=temperature, max_tokens=max_tokens
            )
            result = DMCharacterGenerator.extract_json(response)
            if result.get("favoredEnemy") in enemies:
                features["favored_enemy"] = result["favoredEnemy"]
            if result.get("favoredTerrain") in terrains:
                features["favored_terrain"] = result["favoredTerrain"]

        # Expertise (Rogue: level 1 pick 2, level 6 pick 2 more; Bard: level 3 pick 2, level 10 pick 2 more)
        if class_id in ("rogue", "bard") and selected_skills:
            expertise_start = 1 if class_id == "rogue" else 3
            if target_level >= expertise_start:
                num_expertise = 2
                if (class_id == "rogue" and target_level >= 6) or (class_id == "bard" and target_level >= 10):
                    num_expertise = 4
                num_expertise = min(num_expertise, len(selected_skills))

                prompt = f"""角色描述：{description}
职业：{class_id}，等级：{target_level}

从以下已熟练的技能中选择 {num_expertise} 个获得专精（双倍熟练加值）：
{json.dumps(selected_skills, ensure_ascii=False)}

选择最符合角色概念的技能。游荡者通常专精隐匿、巧手；吟游诗人通常专精社交技能。
返回JSON：{{"expertise": ["skill_id_1", "skill_id_2"]}}"""
                response = await AIService.generate_completion(
                    api_url=config.api_url, api_key=config.api_key, model=config.model_name,
                    messages=[{"role": "user", "content": prompt}],
                    temperature=temperature, max_tokens=max_tokens
                )
                result = DMCharacterGenerator.extract_json(response)
                expertise = [s for s in result.get("expertise", []) if s in selected_skills]
                if expertise:
                    # Store as rich format matching level-up system
                    features["expertise_skills"] = [
                        {"value": s, "level_acquired": expertise_start, "source": class_id, "source_detail": "expertise"}
                        for s in expertise[:num_expertise]
                    ]

        # Eldritch Invocations (Warlock, level 2+)
        if class_id == "warlock" and target_level >= 2:
            # Calculate how many invocations at this level
            num_invocations = 0
            for lvl, count in sorted(DMCharacterGenerator.WARLOCK_INVOCATION_COUNT.items()):
                if target_level >= lvl:
                    num_invocations = count
            # Collect available invocations by level
            available = []
            for min_lvl, invocations in DMCharacterGenerator.ELDRITCH_INVOCATIONS.items():
                if target_level >= min_lvl:
                    available.extend(invocations)

            if available and num_invocations > 0:
                prompt = f"""角色描述：{description}
职业：术士（Warlock），等级：{target_level}

从以下魔能祈唤中选择 {num_invocations} 个最合适的：
{json.dumps(available, ensure_ascii=False)}

选择符合角色战斗风格和概念的祈唤。agonizing_blast是最常用的伤害选择。
返回JSON：{{"invocations": ["id1", "id2"]}}"""
                response = await AIService.generate_completion(
                    api_url=config.api_url, api_key=config.api_key, model=config.model_name,
                    messages=[{"role": "user", "content": prompt}],
                    temperature=temperature, max_tokens=max_tokens
                )
                result = DMCharacterGenerator.extract_json(response)
                invocations = [i for i in result.get("invocations", []) if i in available]
                if invocations:
                    features["eldritch_invocations"] = [
                        {"value": inv, "level_acquired": 2, "source": "warlock"}
                        for inv in invocations[:num_invocations]
                    ]

        # Battle Master Maneuvers (Fighter with battle_master subclass, level 3+)
        if class_id == "fighter" and subclass_id == "battle_master" and target_level >= 3:
            num_maneuvers = 0
            for lvl, count in sorted(DMCharacterGenerator.BATTLE_MASTER_MANEUVER_COUNT.items()):
                if target_level >= lvl:
                    num_maneuvers = count
            maneuvers = DMCharacterGenerator.BATTLE_MASTER_MANEUVERS

            if num_maneuvers > 0:
                prompt = f"""角色描述：{description}
职业：战士-战技大师（Battle Master），等级：{target_level}

从以下战技中选择 {num_maneuvers} 个最合适的：
{json.dumps(maneuvers, ensure_ascii=False)}

选择符合角色战斗风格的战技。trip_attack、riposte、precision_attack是常用选择。
返回JSON：{{"maneuvers": ["id1", "id2", "id3"]}}"""
                response = await AIService.generate_completion(
                    api_url=config.api_url, api_key=config.api_key, model=config.model_name,
                    messages=[{"role": "user", "content": prompt}],
                    temperature=temperature, max_tokens=max_tokens
                )
                result = DMCharacterGenerator.extract_json(response)
                selected = [m for m in result.get("maneuvers", []) if m in maneuvers]
                if selected:
                    features["maneuvers_known"] = selected[:num_maneuvers]

        # Four Elements Elemental Disciplines (Monk with four_elements subclass, level 3+)
        if class_id == "monk" and subclass_id == "four_elements" and target_level >= 3:
            num_disciplines = 0
            for lvl, count in sorted(DMCharacterGenerator.ELEMENTAL_DISCIPLINE_COUNT.items()):
                if target_level >= lvl:
                    num_disciplines = count

            # Build available pool based on character level
            available = []
            for lvl, ids in DMCharacterGenerator.ELEMENTAL_DISCIPLINES_BY_LEVEL.items():
                if target_level >= lvl:
                    available.extend(ids)

            if num_disciplines > 0 and available:
                # Pick randomly (no AI needed - disciplines are straightforward)
                # Always include elemental_attunement + random picks from pool
                picks = random.sample(available, min(num_disciplines - 1, len(available)))
                features["elemental_disciplines"] = ["elemental_attunement"] + picks

        return features

    @staticmethod
    def get_spellbook_size(class_id: str, level: int) -> int:
        """Calculate wizard spellbook size at given level."""
        if class_id != "wizard":
            return 0
        # Wizard: 6 spells at level 1, +2 per level after
        return 6 + (level - 1) * 2

    @staticmethod
    def get_spells_per_level(class_id: str, character_level: int, max_spell_level: int) -> Dict[int, int]:
        """Calculate how many spells of each level a character should know."""
        result = {}
        if class_id == "wizard":
            # Wizard spellbook: distribute across levels they can cast
            total = DMCharacterGenerator.get_spellbook_size(class_id, character_level)
            # More low-level spells, fewer high-level (they learn higher spells later)
            weights = {1: 3, 2: 2.5, 3: 2, 4: 1.5, 5: 1, 6: 0.8, 7: 0.6, 8: 0.4, 9: 0.2}
            available_levels = [l for l in range(1, max_spell_level + 1)]
            total_weight = sum(weights.get(l, 1) for l in available_levels)
            for lvl in available_levels:
                result[lvl] = max(1, int(total * weights.get(lvl, 1) / total_weight))
            # Adjust to match total
            while sum(result.values()) < total:
                result[1] += 1
            while sum(result.values()) > total:
                for lvl in reversed(available_levels):
                    if result[lvl] > 1:
                        result[lvl] -= 1
                        break
        return result

    @staticmethod
    async def generate_stage5_spells(
        description: str,
        class_id: str,
        subclass_id: Optional[str],
        target_level: int,
        class_obj: Dict,
        spells_data: Dict,
        config: Any,
        temperature: float,
        max_tokens: int
    ) -> Dict[str, List[str]]:
        """Stage 5: Select cantrips and spells for spellcasters."""
        if class_id not in DMCharacterGenerator.SPELLCASTER_CLASSES:
            return {"cantrips": [], "spells": []}

        spell_info = DMCharacterGenerator.get_spellcasting_info(class_obj, target_level)
        max_spell_level = DMCharacterGenerator.get_max_spell_level(class_id, target_level)

        # Get class spell list
        all_spells = spells_data.get("spells", [])
        class_cantrips = [s for s in all_spells
                         if s.get("level") == 0 and class_id in s.get("classes", [])]
        class_spells = [s for s in all_spells
                       if 0 < s.get("level", 0) <= max_spell_level and class_id in s.get("classes", [])]

        num_cantrips = spell_info["cantrips"]
        num_spells = spell_info["spells_known"]

        # Calculate correct spell count for prepared casters
        if spell_info["is_prepared"] and num_spells == 0:
            if class_id == "wizard":
                # Wizard spellbook: 6 + (level-1)*2
                num_spells = DMCharacterGenerator.get_spellbook_size(class_id, target_level)
            else:
                # Cleric/Druid: they have access to full spell list, give reasonable prepared count
                ability_mod = 4  # Assume +4 modifier at higher levels
                num_spells = max(1, ability_mod + target_level)

        if num_cantrips == 0 and num_spells == 0:
            return {"cantrips": [], "spells": []}

        # Group spells by level for better selection
        spells_by_level: Dict[int, List[Dict]] = {}
        for s in class_spells:
            lvl = s.get("level", 1)
            if lvl not in spells_by_level:
                spells_by_level[lvl] = []
            spells_by_level[lvl].append({"id": s.get("id"), "name": s.get("name"), "level": lvl})

        # Calculate distribution per level
        spells_per_level = DMCharacterGenerator.get_spells_per_level(class_id, target_level, max_spell_level)

        # Build spell options with level distribution hints
        spell_opts_by_level = {}
        for lvl in range(1, max_spell_level + 1):
            available = spells_by_level.get(lvl, [])
            # Take up to 15 options per level
            spell_opts_by_level[lvl] = available[:15]

        cantrip_opts = [{"id": s.get("id"), "name": s.get("name")} for s in class_cantrips[:30]]

        # Build distribution requirement string
        if spells_per_level:
            dist_str = "、".join([f"{lvl}环{cnt}个" for lvl, cnt in sorted(spells_per_level.items())])
        else:
            dist_str = f"共{num_spells}个，均匀分布在各环级"

        # Build spell list string by level
        spell_list_str = ""
        for lvl in range(1, max_spell_level + 1):
            opts = spell_opts_by_level.get(lvl, [])
            if opts:
                spell_list_str += f"\n{lvl}环法术：{json.dumps(opts, ensure_ascii=False)}"

        # Detect combat focus from description
        combat_keywords = ["战斗", "毁灭", "伤害", "攻击", "火球", "闪电", "爆炸", "杀戮", "毁灭者"]
        support_keywords = ["辅助", "治疗", "保护", "支援", "buff", "增益"]
        is_combat_focused = any(kw in description for kw in combat_keywords)
        is_support_focused = any(kw in description for kw in support_keywords)

        # Build role-specific requirements
        role_requirement = "2. 选择实用的法术组合（攻击、防御、探索、辅助）"
        if is_combat_focused:
            role_requirement = "2. 【战斗型角色】优先选择伤害性法术（火球术、闪电箭、寒冰锥、焚云术等），最大化输出能力，减少非战斗法术"
        elif is_support_focused:
            role_requirement = "2. 【辅助型角色】优先选择增益、控制、治疗法术，减少纯伤害法术"

        prompt = f"""你是D&D 5E角色构建专家。为{class_obj.get("name")}选择法术。

角色描述：{description}
等级：{target_level}
最高法术环数：{max_spell_level}

选择 {num_cantrips} 个戏法：{json.dumps(cantrip_opts, ensure_ascii=False)}

选择法术（{dist_str}）：{spell_list_str}

要求：
1. 法术必须均匀分布在各环级，不能只选低环法术
{role_requirement}
3. 高等级角色必须有高环法术
4. 根据角色描述的风格选择契合的法术

返回JSON：
{{"cantrips": ["id1", "id2"], "spells": ["id1", "id2", ...]}}"""

        response = await AIService.generate_completion(
            api_url=config.api_url, api_key=config.api_key, model=config.model_name,
            messages=[{"role": "user", "content": prompt}],
            temperature=temperature, max_tokens=max_tokens
        )
        result = DMCharacterGenerator.extract_json(response)

        # Validate
        valid_cantrip_ids = {s.get("id") for s in class_cantrips}
        valid_spell_ids = {s.get("id") for s in class_spells}

        cantrips = [c for c in result.get("cantrips", []) if c in valid_cantrip_ids][:num_cantrips]
        spells = [s for s in result.get("spells", []) if s in valid_spell_ids]

        # Ensure we have spells from each level if AI didn't follow instructions
        if spells_per_level and len(spells) < num_spells:
            spell_levels_in_result = {}
            for spell_id in spells:
                for s in class_spells:
                    if s.get("id") == spell_id:
                        lvl = s.get("level", 1)
                        spell_levels_in_result[lvl] = spell_levels_in_result.get(lvl, 0) + 1
                        break
            # Fill missing levels
            for lvl, needed in sorted(spells_per_level.items()):
                current = spell_levels_in_result.get(lvl, 0)
                if current < needed:
                    available = [s["id"] for s in spells_by_level.get(lvl, []) if s["id"] not in spells]
                    spells.extend(available[:needed - current])

        return {"cantrips": cantrips[:num_cantrips], "spells": spells[:num_spells]}

    @staticmethod
    def select_item_from_category(category_id: str, class_id: str, equipment_data: Dict) -> Optional[Dict]:
        """Select a specific item from a category based on class preferences."""

        # Map category IDs to equipment data paths
        category_map = {
            "simple_weapon": ("weapons", "simple", None),
            "martial_weapon": ("weapons", "martial", None),
            "simple_melee_weapon": ("weapons", "simple", "melee"),
            "simple_ranged_weapon": ("weapons", "simple", "ranged"),
            "martial_melee_weapon": ("weapons", "martial", "melee"),
            "martial_ranged_weapon": ("weapons", "martial", "ranged"),
            "light_armor": ("armor", "light", None),
            "medium_armor": ("armor", "medium", None),
            "heavy_armor": ("armor", "heavy", None),
            "shield": ("armor", "shield", None),
            "shields": ("armor", "shield", None),
            "holy_symbol": ("adventuringGear", "holySymbol", None),
            "druidic_focus": ("adventuringGear", "druidicFocus", None),
            "arcane_focus": ("adventuringGear", "arcaneFocus", None),
            "musical_instrument": ("tools", "musicalInstruments", None),
            "artisan_tools": ("tools", "artisansTools", None),
        }

        if category_id not in category_map:
            return None

        main_cat, sub_cat, weapon_type = category_map[category_id]

        # Get available items
        items = []
        if main_cat == "weapons":
            weapon_data = equipment_data.get("weapons", {}).get(sub_cat, {})
            if weapon_type:
                items = weapon_data.get(weapon_type, [])
            else:
                items = weapon_data.get("melee", []) + weapon_data.get("ranged", [])
        elif main_cat == "armor":
            items = equipment_data.get("armor", {}).get(sub_cat, [])
        elif main_cat == "adventuringGear":
            items = equipment_data.get("adventuringGear", {}).get(sub_cat, [])
        elif main_cat == "tools":
            items = equipment_data.get("tools", {}).get(sub_cat, [])

        if not items:
            return None

        # For weapons, try to use class preferences
        if main_cat == "weapons" and class_id in CLASS_WEAPON_PREFERENCES:
            prefs = CLASS_WEAPON_PREFERENCES[class_id]
            is_simple = sub_cat == "simple"

            # When weapon_type is None, try both melee and ranged preferences
            if weapon_type is None:
                if is_simple:
                    preferred_ids = prefs.get("simple_melee", []) + prefs.get("simple_ranged", [])
                else:
                    preferred_ids = prefs.get("melee", []) + prefs.get("ranged", [])
            else:
                is_ranged = weapon_type == "ranged"
                if is_simple:
                    pref_type = "simple_ranged" if is_ranged else "simple_melee"
                else:
                    pref_type = "ranged" if is_ranged else "melee"
                preferred_ids = prefs.get(pref_type, [])

            # Find a preferred weapon that's available
            for pref_id in preferred_ids:
                for item in items:
                    if item.get("id") == pref_id:
                        return item

        # Default: return first item or random
        return random.choice(items) if items else None

    @staticmethod
    def get_starting_equipment(class_id: str, class_obj: Dict, bg_obj: Optional[Dict]) -> List[Dict]:
        """Stage 6: Get starting equipment for class and background with intelligent selection."""
        equipment = []
        equipment_data = get_equipment_data()

        def find_item_metadata(item_id: str) -> Optional[Dict]:
            """Find item metadata from equipment data."""
            normalized_id = item_id.lower().strip()
            # Check weapons
            for cat in ["simple", "martial"]:
                for wtype in ["melee", "ranged"]:
                    for item in equipment_data.get("weapons", {}).get(cat, {}).get(wtype, []):
                        if item.get("id") == normalized_id:
                            return item
            # Check armor
            for tier in ["light", "medium", "heavy", "shield"]:
                for item in equipment_data.get("armor", {}).get(tier, []):
                    if item.get("id") == normalized_id:
                        return item
            # Check adventuringGear
            for cat, items in equipment_data.get("adventuringGear", {}).items():
                if isinstance(items, list):
                    for item in items:
                        if isinstance(item, dict) and item.get("id") == normalized_id:
                            return item
            # Check tools
            tools = equipment_data.get("tools", {})
            if isinstance(tools, dict):
                for cat in ["artisansTools", "specializedTools", "gamingSets", "musicalInstruments"]:
                    for item in tools.get(cat, []):
                        if isinstance(item, dict) and item.get("id") == normalized_id:
                            return item
            # Check packs
            for pack in equipment_data.get("packs", []):
                if pack.get("id") == normalized_id:
                    return pack
            # Check backgroundItems
            for item in equipment_data.get("backgroundItems", []):
                if isinstance(item, dict) and item.get("id") == normalized_id:
                    return item
            return None

        def build_item_data(item_id: str, quantity: int, source: str, meta: Optional[Dict] = None) -> Dict:
            """Build item data dict with metadata."""
            if not meta:
                meta = find_item_metadata(item_id)
            item = {
                "id": item_id,
                "name": meta.get("name", item_id.replace("_", " ").title()) if meta else item_id.replace("_", " ").title(),
                "quantity": quantity,
                "equipped": False,
                "source": source
            }
            if meta:
                if meta.get("nameEn"):
                    item["nameEn"] = meta["nameEn"]
                if meta.get("iconPath"):
                    item["iconPath"] = meta["iconPath"]
                if meta.get("weight") is not None:
                    item["weight"] = meta["weight"]
                if meta.get("cost"):
                    item["cost"] = meta["cost"]
                if meta.get("damage"):
                    item["damage"] = meta["damage"]
                if meta.get("damageType"):
                    item["damageType"] = meta["damageType"]
                if meta.get("ac"):
                    item["ac"] = meta["ac"]
                if meta.get("acFormula"):
                    item["acFormula"] = meta["acFormula"]
            return item

        def add_item(item_id: str, quantity: int, source: str):
            """Helper to add an item, handling category selection."""
            # Check if it's a category that needs specific selection
            category_keywords = [
                "_weapon", "_armor", "holy_symbol", "druidic_focus",
                "arcane_focus", "musical_instrument", "artisan_tools"
            ]
            is_category = any(kw in item_id for kw in category_keywords)

            if is_category:
                # Select specific item from category
                selected = DMCharacterGenerator.select_item_from_category(item_id, class_id, equipment_data)
                if selected:
                    equipment.append(build_item_data(selected.get("id"), quantity, source, selected))
            else:
                equipment.append(build_item_data(item_id, quantity, source))

        # Add fixed equipment from class
        starting_eq = class_obj.get("startingEquipment", {})
        for item_ref in starting_eq.get("fixed", []):
            if ":" in item_ref:
                item_id, qty = item_ref.rsplit(":", 1)
                quantity = int(qty) if qty.isdigit() else 1
            else:
                item_id, quantity = item_ref, 1
            add_item(item_id, quantity, "class")

        # Add first option from each choice (with intelligent selection)
        for choice in starting_eq.get("choices", []):
            options = choice.get("from", [])
            if options:
                first_option = options[0]
                for item_ref in first_option:
                    if ":" in item_ref:
                        item_id, qty = item_ref.rsplit(":", 1)
                        quantity = int(qty) if qty.isdigit() else 1
                    else:
                        item_id, quantity = item_ref, 1
                    add_item(item_id, quantity, "class_choice")

        # Add background equipment
        if bg_obj:
            for item_ref in bg_obj.get("equipment", []):
                if ":" in item_ref:
                    item_id, qty = item_ref.rsplit(":", 1)
                    quantity = int(qty) if qty.isdigit() else 1
                else:
                    item_id, quantity = item_ref, 1
                add_item(item_id, quantity, "background")

        return equipment

