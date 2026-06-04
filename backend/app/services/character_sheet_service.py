"""
Character Sheet Service
Computes features, actions, and spells for a character based on their class, race, level, and equipment.
"""
from typing import List, Dict, Any, Optional
import json
from pathlib import Path

from app.models.character import Character
from app.utils.classes import load_classes_data, get_class_by_name
from app.utils.races import load_races_data, get_race_by_name
from app.utils.rules_cache import get_equipment_data as _get_equipment_data, get_all_spells
from app.utils.dice import collect_character_skill_proficiencies, collect_character_tool_proficiencies


class CharacterSheetService:
    """Service for computing character sheet data (features, actions, spells)"""
    
    def __init__(self):
        self.classes_data = None
        self.races_data = None
        self.equipment_data = None
        self.spells_data = None
    
    def _load_classes_data(self) -> Dict[str, Any]:
        """Load classes data (cached)"""
        if self.classes_data is None:
            self.classes_data = load_classes_data()
        return self.classes_data
    
    def _load_races_data(self) -> Dict[str, Any]:
        """Load races data (cached)"""
        if self.races_data is None:
            self.races_data = load_races_data()
        return self.races_data
    
    def _load_equipment_data(self) -> Dict[str, Any]:
        """Load equipment data (cached via rules_cache)"""
        if self.equipment_data is None:
            self.equipment_data = _get_equipment_data()
        return self.equipment_data

    def _load_spells_data(self) -> List[Dict[str, Any]]:
        """Load spells data (cached via rules_cache)"""
        if self.spells_data is None:
            self.spells_data = get_all_spells()
        return self.spells_data
    
    def get_character_sheet(self, character: Character) -> Dict[str, Any]:
        """
        Compute full character sheet with features, actions, and spells

        Args:
            character: Character model instance

        Returns:
            Dict with keys: character, features, actions
        """
        features = self._compute_features(character)
        actions = self._compute_actions(character)
        speed = self._compute_speed(character)
        fly_speed = self._compute_flying_speed(character, speed)
        proficient_skills = collect_character_skill_proficiencies({
            "selected_skills": character.selected_skills or [],
            "race_choices": character.race_choices or {},
            "subclass_choices": character.subclass_choices or {},
            "background_id": character.background_id,
            "race_id": character.race_id,
            "subrace_id": character.subrace_id,
            "class_id": character.class_id,
            "subclass_id": character.subclass_id,
            "status_effects": character.status_effects or {},
            "feat_choices": character.feat_choices or {},
            "level": int(character.level or 1),
        })
        proficient_tools = collect_character_tool_proficiencies({
            "race_choices": character.race_choices or {},
            "subclass_choices": character.subclass_choices or {},
            "background_id": character.background_id,
            "race_id": character.race_id,
            "subrace_id": character.subrace_id,
            "class_id": character.class_id,
            "subclass_id": character.subclass_id,
            "status_effects": character.status_effects or {},
            "feat_choices": character.feat_choices or {},
            "level": int(character.level or 1),
        })

        # Get Battle Master maneuvers if applicable
        maneuvers_data = self._get_battle_master_data(character)

        # Convert character to dict for response
        character_dict = {
            "id": character.id,
            "user_id": character.user_id,
            "name": character.name,
            "race": self._get_race_name(character.race_id),
            "race_id": character.race_id,
            "subrace_id": character.subrace_id,
            "class": self._get_class_name(character.class_id),
            "class_id": character.class_id,
            "subclass_id": character.subclass_id,
            "level": character.level,
            "armor_class": self._compute_armor_class(character),
            "hit_points_current": self._compute_current_hp(character),
            "hit_points_max": self._compute_max_hp(character),
            "abilities": character.ability_scores,
            "ability_scores": character.ability_scores,
            "equipment": character.equipment or [],
            "currency": character.currency or {},
            "avatar": character.avatar,
            "avatar_large": character.avatar_large,
            "background_id": character.background_id,
            "gender": character.gender,
            "age": character.age,
            "appearance": character.appearance,
            "proficient_skills": proficient_skills,
            "selected_skills": character.selected_skills or [],
            "proficient_tools": proficient_tools,
            "race_choice_skills": (character.race_choices or {}).get('skills', []) if character.race_choices else [],
            "subclass_choice_skills": (character.subclass_choices or {}).get('skills', []) if character.subclass_choices else [],
            "status_effects": character.status_effects,
            "favored_humanoid_races": character.favored_humanoid_races,
            "current_hp": character.current_hp,
            "spells": self._get_prepared_spells(character),
            "maneuvers_known": character.maneuvers_known or [],
            # Ranger specific
            "favored_enemy": character.favored_enemy,
            "favored_terrain": character.favored_terrain,
            # Spell casting
            "selected_cantrips": character.selected_cantrips or [],
            "prepared_spells": character.prepared_spells or [],
            "spell_slots_state": character.spell_slots_state,
            "spellcasting_ability": self._get_spellcasting_ability(character.class_id),
            # Combat style & feats (for two-weapon fighting etc.)
            "fighting_style": character.fighting_style,
            "feats": character.feats,
            # Class feature uses (for context menu pool display, e.g., lay_on_hands)
            "class_feature_uses": character.class_feature_uses or {},
            # Movement speeds
            "speed": speed,
            "fly_speed": fly_speed,
        }

        result = {
            "character": character_dict,
            "features": features,
            "actions": actions,
            "derived": {
                "speed": speed,
                "fly_speed": fly_speed,
                "proficient_skills": proficient_skills,
                "proficient_tools": proficient_tools,
            },
        }

        # Add Battle Master specific data
        if maneuvers_data:
            result["maneuvers_data"] = maneuvers_data

        return result
    
    def _get_race_name(self, race_id: str) -> str:
        """Get race display name from race_id"""
        race = get_race_by_name(race_id)
        if race:
            return race.get("name", race_id)
        return race_id
    
    def _get_class_name(self, class_id: str) -> str:
        """Get class display name from class_id"""
        class_data = get_class_by_name(class_id)
        if class_data:
            return class_data.get("name", class_id)
        return class_id

    def _get_spellcasting_ability(self, class_id: str) -> str:
        """Get spellcasting ability for a class"""
        spellcasting_classes = {
            "wizard": "intelligence",
            "artificer": "intelligence",
            "cleric": "wisdom",
            "druid": "wisdom",
            "ranger": "wisdom",
            "monk": "wisdom",
            "bard": "charisma",
            "paladin": "charisma",
            "sorcerer": "charisma",
            "warlock": "charisma",
        }
        return spellcasting_classes.get(class_id, "intelligence")
    
    def _compute_armor_class(self, character: Character) -> int:
        """Compute character's armor class"""
        # Base AC = 10 + DEX modifier
        dex_mod = (character.ability_scores.get("dexterity", 10) - 10) // 2
        base_ac = 10 + dex_mod

        # TODO: Add armor bonuses from equipment

        # Fighting Style: Defense — +1 AC when wearing armor
        # (backend AC calc is basic; full equipment-aware calc is on frontend)
        fs = character.fighting_style
        fs_value = fs.get("value") if isinstance(fs, dict) else fs
        if fs_value == "defense":
            # Only applies when wearing armor, but since backend doesn't track
            # equipped armor yet, we apply it here as a best-effort
            base_ac += 1

        return base_ac
    
    def _compute_current_hp(self, character: Character) -> int:
        """Get current HP (stored in character or compute from max)

        If the character has a persisted current_hp value, use that. Otherwise,
        fall back to the computed max HP so old data continues to work.
        """
        current = getattr(character, "current_hp", None)
        if isinstance(current, int):
            return current
        return self._compute_max_hp(character)

    def _compute_max_hp(self, character: Character) -> int:
        """Compute character's max HP: class HP via the shared, multiclass-aware
        calculate_max_hp (single source of truth for class-based HP), plus subrace
        and feat bonuses layered on top."""
        from app.services.character_progression_service import calculate_max_hp
        # Class HP — handles single-class AND multiclass per 5e (only the very first
        # character level gets the max die). Subrace/feat bonuses are added below.
        base_hp = calculate_max_hp(character)

        # Subrace HP bonuses (e.g. Hill Dwarf: +1 HP per level)
        races_data = self._load_races_data()
        race = next((r for r in races_data.get("races", []) if r.get("id") == character.race_id), None)
        if race:
            subrace = next((sr for sr in race.get("subraces", []) if sr.get("id") == getattr(character, "subrace_id", None)), None)
            if subrace:
                for trait in subrace.get("traits", []):
                    for ab in (trait.get("specialAbilities") or []):
                        if ab.get("type") in ("hp_increase", "hp_bonus"):
                            base_hp += character.level

        # Feat HP bonuses (e.g., Tough: +2 HP per level)
        if character.feats:
            feat_ids = [f if isinstance(f, str) else (f.get('value') or f.get('id', '')) for f in character.feats]
            if 'tough' in feat_ids:
                base_hp += 2 * character.level

        return max(1, base_hp)

    def _compute_speed(self, character: Character) -> int:
        """Compute walking speed from race, subclass features, and feats."""
        races_data = self._load_races_data()
        race = next((r for r in races_data.get("races", []) if r.get("id") == character.race_id), None)
        subrace = None
        if race:
            subrace = next(
                (sr for sr in race.get("subraces", []) if sr.get("id") == getattr(character, "subrace_id", None)),
                None,
            )

        base_speed = race.get("speed", 30) if race else 30

        if subrace and isinstance(subrace.get("speed"), int):
            base_speed = subrace["speed"]

        for trait in (subrace or {}).get("traits", []):
            if isinstance(trait.get("speedBonus"), int):
                base_speed += trait["speedBonus"]
            if isinstance(trait.get("speed"), int):
                base_speed = trait["speed"]

        if character.class_id:
            from app.services.passive_feature_service import get_passive_features

            passive_features = get_passive_features(character.class_id, character.level, character.subclass_id)
            speed_bonus = int(passive_features.get("speedBonus") or 0)

            if speed_bonus > 0:
                equipment = character.equipment or []
                armor = next((
                    item for item in equipment
                    if item.get("equippedSlot") == "armor"
                    or item.get("id") in {
                        "padded", "leather", "studded_leather", "hide", "chain_shirt", "scale_mail",
                        "breastplate", "half_plate", "ring_mail", "chain_mail", "splint", "plate",
                    }
                ), None)
                shield = next((
                    item for item in equipment
                    if item.get("equippedSlot") == "off_hand" and item.get("id") == "shield"
                ), None)

                class_id = character.class_id.lower()
                heavy_armor_ids = {"ring_mail", "chain_mail", "splint", "plate"}
                armor_id = armor.get("id") if isinstance(armor, dict) else None
                has_heavy_armor = armor_id in heavy_armor_ids if armor_id else False

                if class_id == "monk" and not armor and not shield:
                    base_speed += speed_bonus
                elif class_id == "barbarian" and not has_heavy_armor:
                    base_speed += speed_bonus

        feat_ids = []
        for feat in character.feats or []:
            if isinstance(feat, str):
                feat_ids.append(feat)
            elif isinstance(feat, dict):
                feat_id = feat.get("value") or feat.get("id")
                if feat_id:
                    feat_ids.append(feat_id)
        if "mobile" in feat_ids:
            base_speed += 10

        return max(0, base_speed)

    def _compute_flying_speed(self, character: Character, walking_speed: Optional[int] = None) -> Optional[int]:
        """Compute passive flying speed granted by class/subclass features."""
        if not character.class_id:
            return None

        from app.services.passive_feature_service import get_passive_features

        walk_speed = walking_speed if isinstance(walking_speed, int) else self._compute_speed(character)
        passive_features = get_passive_features(character.class_id, character.level, character.subclass_id)

        flying_speed: Optional[int] = None
        for feature in passive_features.get("allFeatures", []):
            if feature.get("type") != "flying_speed":
                continue
            if feature.get("id") == "stormborn":
                # Stormborn only works outdoors; backend sheet data has no map terrain context.
                continue
            effect = feature.get("effect", {}) or {}
            if effect.get("flyingSpeedFormula") == "walking_speed":
                flying_speed = max(flying_speed or 0, walk_speed)
            fixed_speed = effect.get("value")
            if isinstance(fixed_speed, int) and fixed_speed > 0:
                flying_speed = max(flying_speed or 0, fixed_speed)

        return flying_speed

    def _compute_features(self, character: Character) -> List[Dict[str, Any]]:
        """Compute character features from race and class"""
        features = []
        
        # Add race features
        race_features = self._get_race_features(character.race_id, character.subrace_id)
        features.extend(race_features)
        
        # Add class features
        class_features = self._get_class_features(
            character.class_id,
            character.subclass_id,
            character.level
        )
        features.extend(class_features)
        
        return features
    
    def _get_race_features(self, race_id: str, subrace_id: Optional[str]) -> List[Dict[str, Any]]:
        """Get features from race and subrace"""
        features = []
        race = get_race_by_name(race_id)
        
        if not race:
            return features
        
        # Add race traits as features
        traits = race.get("traits", [])
        for trait in traits:
            features.append({
                "id": f"race_{race_id}_{trait.get('id', '')}",
                "name": trait.get("name", ""),
                "description": trait.get("description", ""),
                "source": f"种族: {race.get('name', '')}",
                "level_acquired": 1,
            })
        
        # TODO: Add subrace features if subrace_id is provided
        
        return features
    
    def _get_class_features(
        self,
        class_id: str,
        subclass_id: Optional[str],
        level: int
    ) -> List[Dict[str, Any]]:
        """Get features from class and subclass up to character's level"""
        features = []
        class_data = get_class_by_name(class_id)
        
        if not class_data:
            return features
        
        # Get class features by level
        class_features = class_data.get("features", [])
        for feature in class_features:
            feature_level = feature.get("level", 1)
            if feature_level <= level:
                feature_entry = {
                    "id": f"class_{class_id}_{feature.get('id', '')}",
                    "name": feature.get("name", ""),
                    "nameEn": feature.get("nameEn", feature.get("name_en", "")),
                    "description": feature.get("description", ""),
                    "source": f"职业: {class_data.get('name', '')}",
                    "level_acquired": feature_level,
                }
                execution = feature.get("execution")
                if isinstance(execution, dict):
                    feature_entry["execution"] = execution
                features.append(feature_entry)

        if subclass_id and level >= 3:
            subclass_data = None
            for sc in class_data.get("subclasses", []):
                if sc.get("id") == subclass_id:
                    subclass_data = sc
                    break

            if subclass_data:
                subclass_features = self._collect_subclass_features(subclass_data)
                for feature in subclass_features:
                    feature_level = feature.get("level", 3)
                    if feature_level > level:
                        continue

                    feature_id = feature.get("id", "")
                    feature_entry = {
                        "id": f"subclass_{subclass_id}_{feature_id}",
                        "name": feature.get("name", ""),
                        "nameEn": feature.get("nameEn", feature.get("name_en", "")),
                        "description": feature.get("description", ""),
                        "source": f"子职业: {subclass_data.get('name', '')}",
                        "level_acquired": feature_level,
                    }
                    execution = feature.get("execution")
                    if isinstance(execution, dict):
                        feature_entry["execution"] = execution
                    features.append(feature_entry)
        
        return features
    
    def _compute_actions(self, character: Character) -> List[Dict[str, Any]]:
        """Compute character actions from class, race, and equipment"""
        actions = []

        # Add weapon actions from equipment
        weapon_actions = self._get_weapon_actions(character)
        actions.extend(weapon_actions)

        # Add class actions (pass persisted uses and subclass_id)
        class_feature_uses = character.class_feature_uses or {}
        class_actions = self._get_class_actions(
            character.class_id,
            character.subclass_id,
            character.level,
            class_feature_uses,
            character.ability_scores or {}
        )
        actions.extend(class_actions)

        # Add racial actions (activatable racial traits with uses)
        racial_actions = self._get_racial_actions(character)
        actions.extend(racial_actions)

        return actions
    
    def _get_racial_actions(self, character: Character) -> List[Dict[str, Any]]:
        """Get activatable racial trait actions (e.g., Relentless Endurance)"""
        actions = []
        race_data = get_race_by_name(character.race_id) if character.race_id else None
        if not race_data:
            return actions

        class_feature_uses = character.class_feature_uses or {}
        race_name = race_data.get("name", character.race_id or "")

        # Collect traits from race + subrace
        traits = list(race_data.get("traits", []))
        subrace_name = None
        if character.subrace_id:
            for sr in race_data.get("subraces", []):
                if sr.get("id") == character.subrace_id:
                    traits.extend(sr.get("traits", []))
                    subrace_name = sr.get("name")
                    break

        # Map of trigger types to action_type
        TRIGGER_TO_ACTION_TYPE = {
            "on_hp_zero": "reaction",       # Relentless Endurance
        }

        # Skip traits already handled elsewhere (breath weapon has its own UI section)
        SKIP_TRAITS = {"Breath Weapon", "吐息武器"}

        for trait in traits:
            combat = trait.get("combatEffects")
            if not combat or not isinstance(combat, dict):
                continue

            trait_name = trait.get("name", "")
            trait_name_en = trait.get("nameEn", "")

            # Skip traits handled elsewhere
            if trait_name_en in SKIP_TRAITS or trait_name in SKIP_TRAITS:
                continue

            trigger = combat.get("trigger", "passive")
            params = combat.get("params", {})
            uses_per_lr = params.get("uses_per_long_rest")
            uses_per_sr = params.get("uses_per_short_rest")

            # Only include traits with limited uses (active abilities)
            if not uses_per_lr and not uses_per_sr:
                continue

            action_type = TRIGGER_TO_ACTION_TYPE.get(trigger, "free")
            # Use snake_case nameEn as action_id (matches combat.py persisted keys)
            action_id = trait_name_en.lower().replace(' ', '_') if trait_name_en else trait_name
            max_uses = uses_per_lr or uses_per_sr or 1
            recharge = "long_rest" if uses_per_lr else "short_rest"

            persisted = class_feature_uses.get(action_id)
            current = persisted.get("current", max_uses) if persisted else max_uses

            source_label = f"种族: {subrace_name or race_name}"
            actions.append({
                "id": action_id,
                "name": trait_name,
                "action_type": action_type,
                "description": trait.get("description", ""),
                "source": source_label,
                "uses": {"current": current, "max": max_uses, "recharge": recharge},
            })

        return actions

    def _get_weapon_group(self, weapon_id: str) -> Optional[str]:
        """Get weapon group ('simple' or 'martial') from equipment data"""
        eq = self._load_equipment_data()
        weapons = eq.get("weapons", {})
        for group in ("simple", "martial"):
            g = weapons.get(group, {})
            for wtype in ("melee", "ranged"):
                for w in g.get(wtype, []):
                    if w.get("id") == weapon_id:
                        return group
        return None

    def _get_weapon_proficiencies(self, character: Character) -> set:
        """Get character's weapon proficiency set from race/class/subclass"""
        profs = set()
        # Race & subrace traits
        race_data = get_race_by_name(character.race_id) if character.race_id else None
        if race_data:
            traits = list(race_data.get("traits", []))
            if character.subrace_id:
                for sr in race_data.get("subraces", []):
                    if sr.get("id") == character.subrace_id:
                        traits.extend(sr.get("traits", []))
                        break
            for t in traits:
                for wp in t.get("weaponProficiencies", []):
                    profs.add(wp)
                sd = t.get("structuredData") or {}
                for wp in sd.get("weaponProficiencies", []):
                    profs.add(wp)
        # Class proficiencies
        class_data = get_class_by_name(character.class_id) if character.class_id else None
        if class_data:
            for wp in (class_data.get("proficiencies", {}).get("weapons", [])):
                profs.add(wp)
            # Subclass level 1 features
            if character.subclass_id:
                for sc in class_data.get("subclasses", []):
                    if sc.get("id") == character.subclass_id:
                        for feat in sc.get("level1Features", []):
                            sd = feat.get("structuredData") or {}
                            for wp in sd.get("weaponProficiencies", []):
                                profs.add(wp)
                        break
        return profs

    def _is_proficient_with_weapon(self, weapon_id: str, character: Character) -> bool:
        """Check if character is proficient with a specific weapon"""
        profs = self._get_weapon_proficiencies(character)
        group = self._get_weapon_group(weapon_id)
        if group == "martial" and "martial_weapons" in profs:
            return True
        if group == "simple" and "simple_weapons" in profs:
            return True
        return weapon_id in profs or (weapon_id + "s") in profs

    def _get_weapon_actions(self, character: Character) -> List[Dict[str, Any]]:
        """Get weapon attack actions from character's equipment"""
        actions = []
        equipment = character.equipment or []

        # Ability modifiers
        str_mod = (character.ability_scores.get("strength", 10) - 10) // 2
        dex_mod = (character.ability_scores.get("dexterity", 10) - 10) // 2
        proficiency_bonus = 2 + ((character.level - 1) // 4)  # Standard proficiency progression

        for item in equipment:
            if not isinstance(item, dict):
                continue

            # Check if item is a weapon
            if item.get("equipmentType") == "weapon" or item.get("category") == "weapon":
                weapon_name = item.get("name", "Unknown Weapon")

                # Handle damage which can be string or object {dice: "1d8", type: "slashing"}
                raw_damage = item.get("damage", "1d4")
                if isinstance(raw_damage, dict):
                    damage = raw_damage.get("dice") or raw_damage.get("formula") or "1d4"
                    damage_type = raw_damage.get("type") or raw_damage.get("damage_type") or item.get("damageType", "bludgeoning")
                else:
                    damage = raw_damage if isinstance(raw_damage, str) else "1d4"
                    damage_type = item.get("damageType", "bludgeoning")

                weapon_range = item.get("range", "5 ft")

                # Determine if weapon uses STR or DEX (finesse weapons can use either)
                is_finesse = "finesse" in item.get("properties", [])
                is_ranged = "ranged" in item.get("properties", []) or "ammunition" in item.get("properties", [])

                if is_finesse:
                    attack_mod = max(str_mod, dex_mod)
                elif is_ranged:
                    attack_mod = dex_mod
                else:
                    attack_mod = str_mod

                # Check weapon proficiency - only add proficiency bonus if proficient
                weapon_id = item.get("id", "")
                is_proficient = self._is_proficient_with_weapon(weapon_id, character) if weapon_id else True
                attack_bonus = attack_mod + (proficiency_bonus if is_proficient else 0)
                prof_note = "" if is_proficient else " (不熟练，未加熟练加值)"

                actions.append({
                    "id": f"weapon_{item.get('id', weapon_name)}",
                    "name": weapon_name,
                    "action_type": "action",
                    "attack_bonus": attack_bonus,
                    "damage_dice": damage,
                    "damage_type": damage_type,
                    "description": f"近战武器攻击: +{attack_bonus} 命中{prof_note}, 触及 {weapon_range}, 一个目标. 命中: {damage} + {attack_mod} {damage_type}伤害.",
                    "range": weapon_range,
                })
        
        return actions

    def _get_unified_resource_uses(
        self,
        resource_id: str,
        level: int,
        class_feature_uses: Dict[str, Any],
        ability_scores: Dict[str, int],
        fallback_keys: Optional[List[str]] = None,
    ) -> Optional[Dict[str, Any]]:
        """Resolve uses from the unified class resource system with legacy-key fallback."""
        from app.services import class_resource_service

        resource = class_resource_service.get_resource_definition(resource_id)
        if not resource:
            return None
        state_resource_id = class_resource_service.resolve_resource_state_id(resource_id)
        state_resource = class_resource_service.get_resource_definition(state_resource_id) or resource

        max_uses = class_resource_service.calculate_resource_max(
            state_resource,
            level,
            ability_scores.get("charisma", 10),
            ability_scores.get("wisdom", 10),
            ability_scores.get("intelligence", 10),
        )
        recharge = class_resource_service.get_current_recharge_type(state_resource, level)

        persisted = None
        for key in [resource_id, state_resource_id, *(fallback_keys or [])]:
            state = class_feature_uses.get(key)
            if isinstance(state, dict):
                persisted = state
                break

        current = persisted.get("current", max_uses) if persisted else max_uses
        return {"current": current, "max": max_uses, "recharge": recharge}

    def _get_core_resource_binding(
        self,
        feature_id: str,
        feature_name: str,
        feature_name_en: str,
    ) -> Optional[Dict[str, str]]:
        """Map legacy class feature names/ids onto unified resource ids."""
        feature_id_lower = (feature_id or "").strip().lower()
        feature_name_lower = (feature_name or "").strip().lower()
        feature_name_en_lower = (feature_name_en or "").strip().lower()

        if feature_id_lower == "divine_sense" or feature_name_lower == "神圣感知" or feature_name_en_lower == "divine sense":
            return {"action_id": "divine_sense", "resource_id": "divine_sense"}

        return None

    def _get_feature_action_config(
        self,
        feature: Dict[str, Any],
        fallback_action_type: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Read declarative action metadata directly from class/subclass feature JSON."""
        execution = feature.get("execution")
        return {
            "action_type": feature.get("actionType") or feature.get("action_type") or fallback_action_type,
            "execution": execution if isinstance(execution, dict) else None,
            "resource_id": feature.get("resourceId") or feature.get("resource_id"),
        }

    def _collect_subclass_features(self, subclass_data: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Flatten subclass features from both `features` arrays and `levelXFeatures` buckets."""
        collected: List[Dict[str, Any]] = []
        seen = set()
        raw_sources: List[Any] = []

        features = subclass_data.get("features")
        if isinstance(features, list):
            raw_sources.append((None, features))

        for key, entries in subclass_data.items():
            if not key.startswith("level") or not key.endswith("Features") or not isinstance(entries, list):
                continue
            try:
                default_level = int(key[len("level"):-len("Features")])
            except ValueError:
                default_level = None
            raw_sources.append((default_level, entries))

        for default_level, entries in raw_sources:
            for feature in entries:
                if not isinstance(feature, dict):
                    continue
                normalized = dict(feature)
                if normalized.get("level") is None and default_level is not None:
                    normalized["level"] = default_level
                unique_key = (
                    normalized.get("id"),
                    normalized.get("level"),
                    normalized.get("name"),
                    normalized.get("nameEn") or normalized.get("name_en"),
                )
                if unique_key in seen:
                    continue
                seen.add(unique_key)
                collected.append(normalized)

        return collected
    
    def _get_class_actions(self, class_id: str, subclass_id: Optional[str], level: int, class_feature_uses: Dict[str, Any] = None, ability_scores: Dict[str, int] = None) -> List[Dict[str, Any]]:
        """Get special actions from class and subclass features"""
        actions = []
        class_data = get_class_by_name(class_id)
        if class_feature_uses is None:
            class_feature_uses = {}
        if ability_scores is None:
            ability_scores = {}

        if not class_data:
            return actions

        # Complete class feature -> action mappings
        # Maps feature name to action_type
        FEATURE_ACTION_TYPES = {
            # ===== Barbarian 野蛮人 =====
            # Berserker subclass
            "报复": "reaction",
            "Retaliation": "reaction",

            # ===== Bard 吟游诗人 =====
            "激励": "bonus_action",
            "Bardic Inspiration": "bonus_action",
            "激励骰": "bonus_action",

            # ===== Cleric 牧师 =====
            "引导神力": "action",
            "Channel Divinity": "action",
            "异象": "action",
            "Visions of the Past": "action",

            # ===== Monk 武僧 =====
            "气": "bonus_action",
            "Ki": "bonus_action",
            "疾风连击": "bonus_action",
            "Flurry of Blows": "bonus_action",
            "患难之交": "bonus_action",
            "Patient Defense": "bonus_action",
            "御风步": "bonus_action",
            "Step of the Wind": "bonus_action",
            "偏斜飞弹": "reaction",
            "Deflect Missiles": "reaction",
            "缓落": "reaction",
            "Slow Fall": "reaction",

            # ===== Paladin 圣武士 =====
            "神圣感知": "action",
            "Divine Sense": "action",
            "圣疗": "action",
            "圣疗术": "action",
            "Lay on Hands": "action",
            "神圣打击": "free",  # Applied when hitting
            "Divine Smite": "free",
            "净化之触": "action",
            "Cleansing Touch": "action",

            # ===== Ranger 游侠 =====
            "消失无踪": "bonus_action",
            "Vanish": "bonus_action",
            "隐匿行踪": "bonus_action",

            # ===== Rogue 游荡者 =====
            "狡诈动作": "bonus_action",
            "灵巧动作": "bonus_action",
            "Cunning Action": "bonus_action",
            "反制": "reaction",
            "Uncanny Dodge": "reaction",

            # ===== Sorcerer 术士 =====
            "魔力涌动": "bonus_action",
            "Sorcery Points": "bonus_action",
            "超魔": "varies",  # Metamagic varies

            # ===== Warlock 邪术师 =====
            "魔能爆发": "action",
            "Eldritch Blast": "action",

            # ===== Wizard 法师 =====
            "奥术恢复": "action",
            "Arcane Recovery": "action",
        }

        class_features = class_data.get("features", [])
        for feature in class_features:
            feature_level = feature.get("level", 1)
            if feature_level > level:
                continue

            feature_name = feature.get("name", "")
            feature_name_en = feature.get("nameEn", feature.get("name_en", ""))
            feature_id = feature.get("id", feature_name)

            # Check if this feature maps to an action
            feature_config = self._get_feature_action_config(
                feature,
                FEATURE_ACTION_TYPES.get(feature_name) or FEATURE_ACTION_TYPES.get(feature_name_en),
            )
            action_type = feature_config["action_type"]

            if action_type and action_type != "varies":
                # Build uses info if available
                uses = None
                action_id = feature.get("actionId") or f"class_{class_id}_{feature_id}"
                resource_id = feature_config["resource_id"]
                if resource_id:
                    uses = self._get_unified_resource_uses(
                        resource_id,
                        level,
                        class_feature_uses,
                        ability_scores,
                        fallback_keys=[action_id, f"class_{class_id}_{feature_id}"],
                    )
                core_binding = None if resource_id else self._get_core_resource_binding(feature_id, feature_name, feature_name_en)
                if core_binding:
                    action_id = core_binding["action_id"]
                    resource_id = core_binding["resource_id"]
                    uses = self._get_unified_resource_uses(
                        resource_id,
                        level,
                        class_feature_uses,
                        ability_scores,
                        fallback_keys=[f"class_{class_id}_{feature_id}"],
                    )

                if uses is None and ("kiPoints" in feature or feature_name in ["气", "Ki"]):
                    max_uses = level
                    persisted = class_feature_uses.get(action_id)
                    current = persisted.get("current", max_uses) if persisted else max_uses
                    uses = {"current": current, "max": max_uses, "recharge": "short_rest"}
                elif uses is None and feature_name in ["激励", "激励骰", "Bardic Inspiration"]:
                    # Bard: CHA mod times per long rest (min 1), short rest after level 5
                    cha_mod = (ability_scores.get("charisma", 10) - 10) // 2
                    max_uses = max(1, cha_mod)
                    recharge = "short_rest" if level >= 5 else "long_rest"
                    # Use unified resource ID for consistency with resource API
                    resource_id = "bardic_inspiration"
                    persisted = class_feature_uses.get(resource_id) or class_feature_uses.get(action_id)
                    current = persisted.get("current", max_uses) if persisted else max_uses
                    uses = {"current": current, "max": max_uses, "recharge": recharge}
                    # Also set resourceId so frontend can use unified resource API
                    action_id = resource_id  # Override action_id to match resource API
                elif uses is None and feature_name in ["引导神力", "Channel Divinity"]:
                    max_uses = 1 if level < 6 else (2 if level < 18 else 3)
                    resource_id = "channel_divinity_cleric"
                    persisted = class_feature_uses.get(resource_id) or class_feature_uses.get(action_id)
                    current = persisted.get("current", max_uses) if persisted else max_uses
                    uses = {"current": current, "max": max_uses, "recharge": "short_rest"}
                    action_id = resource_id  # Use unified resource ID

                    # Also generate actions for Channel Divinity options (e.g., Turn Undead)
                    cd_options = feature.get("options", [])
                    for opt in cd_options:
                        opt_name = opt.get("name", "")
                        opt_action = {
                            "id": f"channel_divinity_{opt_name}",
                            "name": opt_name,
                            "action_type": "action",
                            "description": opt.get("description", ""),
                            "source": f"职业: {class_data.get('name', '')}",
                            "uses": {"current": current, "max": max_uses, "recharge": "short_rest"},
                            "resourceId": "channel_divinity_cleric",  # Share resource with main Channel Divinity
                        }
                        actions.append(opt_action)

                    # Inject domain-specific CD options from passive-features data
                    if class_id == "cleric" and subclass_id:
                        from app.services.passive_feature_service import get_passive_features as _get_pf_cd
                        _pf_cd = _get_pf_cd("cleric", level, subclass_id)
                        for pf in _pf_cd.get("allFeatures", []):
                            pf_cost = pf.get("cost", "")
                            if "channel_divinity" in pf_cost:
                                pf_type = pf.get("type", "")
                                pf_trigger = pf.get("trigger", "")
                                if "reaction" in pf_cost:
                                    action_type_cd = "reaction"
                                elif pf_type in ("post_roll_bonus", "maximize_damage") or pf_trigger in ("on_attack_miss", "on_hit"):
                                    # Guided Strike / Destructive Wrath are post-roll or on-hit riders,
                                    # not normal action-economy actions on the user's turn.
                                    action_type_cd = "free"
                                else:
                                    action_type_cd = "action"
                                pf_action = {
                                    "id": f"channel_divinity_{pf['id']}",
                                    "name": pf.get("name", ""),
                                    "action_type": action_type_cd,
                                    "description": pf.get("description", ""),
                                    "source": f"领域: {subclass_id}",
                                    "uses": {"current": current, "max": max_uses, "recharge": "short_rest"},
                                    "resourceId": "channel_divinity_cleric",
                                    "passive_feature_id": pf["id"],
                                }
                                actions.append(pf_action)
                elif uses is None and feature_name in ["神圣感知", "Divine Sense"]:
                    max_uses = 4  # 1 + CHA mod placeholder
                    persisted = class_feature_uses.get(action_id)
                    current = persisted.get("current", max_uses) if persisted else max_uses
                    uses = {"current": current, "max": max_uses, "recharge": "long_rest"}

                action = {
                    "id": action_id,
                    "name": feature_name,
                    "nameEn": feature_name_en,
                    "action_type": action_type,
                    "description": feature.get("description", ""),
                    "source": f"职业: {class_data.get('name', '')}",
                }
                if uses:
                    action["uses"] = uses
                if feature_config["execution"]:
                    action["execution"] = feature_config["execution"]
                # Add resourceId for actions that use the unified resource system
                if resource_id:
                    action["resourceId"] = resource_id
                elif feature_name in ["激励", "激励骰", "Bardic Inspiration"]:
                    action["resourceId"] = "bardic_inspiration"
                elif feature_name in ["引导神力", "Channel Divinity"]:
                    action["resourceId"] = "channel_divinity_cleric"

                actions.append(action)

        subclass_data = None

        # Process subclass features if subclass_id is provided and level >= 3
        if subclass_id and level >= 3:
            subclasses = class_data.get("subclasses", [])
            for sc in subclasses:
                if sc.get("id") == subclass_id:
                    subclass_data = sc
                    break

            if subclass_data:
                subclass_features = self._collect_subclass_features(subclass_data)
                for feature in subclass_features:
                    feature_level = feature.get("level", 3)
                    if feature_level > level:
                        continue

                    feature_name = feature.get("name", "")
                    feature_name_en = feature.get("nameEn", feature.get("name_en", ""))

                    # Check if this feature maps to an action
                    feature_config = self._get_feature_action_config(
                        feature,
                        FEATURE_ACTION_TYPES.get(feature_name) or FEATURE_ACTION_TYPES.get(feature_name_en),
                    )
                    action_type = feature_config["action_type"]

                    if action_type and action_type != "varies":
                        feature_id = feature.get("id", feature_name)
                        action_id = feature.get("actionId") or f"subclass_{subclass_id}_{feature_id}"
                        uses = None
                        resource_id = feature_config["resource_id"]

                        if resource_id:
                            uses = self._get_unified_resource_uses(
                                resource_id,
                                level,
                                class_feature_uses,
                                ability_scores,
                                fallback_keys=[action_id, f"subclass_{subclass_id}_{feature_id}"],
                            )

                        if uses is None and feature.get("id") == "visions_of_the_past":
                            max_uses = 1
                            persisted = class_feature_uses.get(action_id)
                            current = persisted.get("current", max_uses) if persisted else max_uses
                            uses = {"current": current, "max": max_uses, "recharge": "short_rest"}

                        action = {
                            "id": action_id,
                            "name": feature_name,
                            "nameEn": feature_name_en,
                            "action_type": action_type,
                            "description": feature.get("description", ""),
                            "source": f"子职业: {subclass_data.get('name', '')}",
                        }
                        if uses:
                            action["uses"] = uses
                        if resource_id:
                            action["resourceId"] = resource_id
                        if feature_config["execution"]:
                            action["execution"] = feature_config["execution"]

                        actions.append(action)

        # Inject subclass-specific actionable passive features from passive-features data
        # (e.g., War Priest / Warding Flare, which aren't always represented in class features text)
        if subclass_id:
            from app.services.passive_feature_service import get_passive_features as _get_pf_ba
            _pf_ba = _get_pf_ba(class_id, level, subclass_id)
            existing_ids = {a.get("id", "") for a in actions}
            has_improved_flare = any(
                pf.get("id") == "improved_flare"
                for pf in _pf_ba.get("allFeatures", [])
            )
            for pf in _pf_ba.get("allFeatures", []):
                pf_id = pf.get("id", "")
                pf_type = pf.get("type")
                pf_cost = pf.get("cost", "")
                # Skip features already injected (CD options) or non-actionable types
                if "channel_divinity" in pf_cost:
                    continue
                inject_war_priest = pf_type == "bonus_action" and pf.get("trigger") in ("after_attack", "on_turn")
                inject_blessing_of_trickster = pf_id == "blessing_of_the_trickster" and "action" in pf_cost
                inject_warding_flare = pf_id == "warding_flare" and "reaction" in pf_cost
                inject_wrath_of_the_storm = pf_id == "wrath_of_the_storm" and "reaction" in pf_cost
                inject_dampen_elements = pf_id == "dampen_elements" and "reaction" in pf_cost
                inject_corona_of_light = pf_id == "corona_of_light" and "action" in pf_cost
                if not inject_war_priest and not inject_blessing_of_trickster and not inject_warding_flare and not inject_wrath_of_the_storm and not inject_dampen_elements and not inject_corona_of_light:
                    continue

                pf_action_id = f"passive_{pf_id}"
                if pf_action_id in existing_ids:
                    continue

                # Resolve uses from class_resources.json
                pf_uses = None
                resource_id = "warding_flare" if pf_id == "warding_flare" else pf_id
                from app.utils.rules_cache import get_class_resources_data
                cr_data = get_class_resources_data()
                cr_entry = next((
                    r for r in (
                        cr_data.get("classResources", [])
                        or cr_data.get("resources", [])
                    ) if r.get("id") == resource_id
                ), None)
                if cr_entry:
                    max_formula = cr_entry.get("maxFormula", "")
                    min_max = cr_entry.get("minMax", 1)
                    recharge = cr_entry.get("recharge", "long_rest")
                    if max_formula == "wis_mod":
                        max_uses = max(min_max, (ability_scores.get("wisdom", 10) - 10) // 2)
                    elif max_formula == "cha_mod":
                        max_uses = max(min_max, (ability_scores.get("charisma", 10) - 10) // 2)
                    else:
                        max_uses = min_max
                    persisted = class_feature_uses.get(resource_id)
                    current = persisted.get("current", max_uses) if persisted else max_uses
                    pf_uses = {"current": current, "max": max_uses, "recharge": recharge}

                action_type_ba = (
                    "action" if inject_corona_of_light or inject_blessing_of_trickster
                    else "reaction" if inject_warding_flare or inject_wrath_of_the_storm or inject_dampen_elements
                    else ("reaction" if "reaction" in pf_cost else "bonus_action")
                )
                pf_description = pf.get("description", "")
                if inject_warding_flare and has_improved_flare:
                    pf_description = (
                        "反应：当30尺内你能看到的生物遭受攻击时，令对其进行的下一次攻击检定具有劣势。"
                        "次数=感知调整值（最少1），长休恢复。"
                    )
                elif inject_corona_of_light:
                    pf_description = (
                        "动作：激活持续10轮的日冕，提供60尺明亮光照和额外30尺微光。"
                        "处于明亮光照中的敌人对你的火焰和光耀法术豁免具有劣势。"
                    )
                elif inject_wrath_of_the_storm:
                    pf_description = (
                        "反应：选择5尺内刚对你发起近战打击的目标，令其进行敏捷豁免。"
                        "失败受到2d8闪电或雷鸣伤害，成功伤害减半。"
                    )
                elif inject_dampen_elements:
                    pf_description = (
                        "反应：为你自己或30尺内友方生物挂上一次性的元素防护。"
                        "其下一次受到酸液、寒冷、火焰、闪电或雷鸣伤害时获得该次伤害的抗性，然后此效果被消耗。"
                    )
                pf_action = {
                    "id": pf_action_id,
                    "name": pf.get("name", ""),
                    "action_type": action_type_ba,
                    "description": pf_description,
                    "source": f"领域: {subclass_id}",
                    "passive_feature_id": pf_id,
                }
                if pf_uses:
                    pf_action["uses"] = pf_uses
                    pf_action["resourceId"] = resource_id
                actions.append(pf_action)

        # ── Divine Intervention (Cleric level 10+) ──
        if class_id == "cleric" and level >= 10:
            di_resource_id = "divine_intervention"
            di_persisted = class_feature_uses.get(di_resource_id)
            di_current = di_persisted.get("current", 1) if di_persisted else 1
            di_action = {
                "id": "divine_intervention",
                "name": "神圣干预",
                "action_type": "action",
                "description": "恳求神祇介入。掷百分骰，结果≤牧师等级即成功。20级自动成功。",
                "source": "牧师",
                "uses": {"current": di_current, "max": 1, "recharge": "long_rest"},
                "resourceId": di_resource_id,
                "feature_type": "divine_intervention",
                "auto_success_level": 20,
                "success_threshold": level,
            }
            actions.append(di_action)

        # Enrich resource-backed actions from class_resources.json execution metadata.
        from app.services import class_resource_service

        char_resources = class_resource_service.get_character_resources(class_id, subclass_id, level)

        def _find_existing_action(ability: Dict[str, Any]) -> Optional[Dict[str, Any]]:
            ability_id = ability.get("id")
            resource_id = ability.get("resourceId")
            ability_name = ability.get("name")
            ability_name_en = ability.get("nameEn")
            for action in actions:
                if action.get("id") == ability_id:
                    return action
                if resource_id and action.get("resourceId") == resource_id:
                    return action
                if action.get("name") in {ability_name, ability_name_en}:
                    return action
            return None

        for ability in char_resources.get("abilities", []):
            execution = ability.get("execution")
            if not execution:
                continue

            resource_id = ability.get("resourceId")
            fallback_keys = [f"class_{class_id}_{ability.get('id', '')}"]
            if subclass_id:
                fallback_keys.append(f"subclass_{subclass_id}_{ability.get('id', '')}")
            fallback_keys = [key for key in fallback_keys if key]

            uses = None
            if resource_id:
                uses = self._get_unified_resource_uses(
                    resource_id,
                    level,
                    class_feature_uses,
                    ability_scores,
                    fallback_keys=fallback_keys,
                )

            source_label = (
                f"子职业: {subclass_data.get('name', '')}"
                if ability.get("subclassId") and subclass_data
                else f"职业: {class_data.get('name', '')}"
            )

            action = _find_existing_action(ability)
            if action:
                action["id"] = ability.get("id", action.get("id"))
                action["name"] = ability.get("name", action.get("name"))
                action["action_type"] = ability.get("actionType", action.get("action_type"))
                action["description"] = ability.get("description", action.get("description", ""))
                action["source"] = action.get("source") or source_label
                if resource_id:
                    action["resourceId"] = resource_id
                if uses:
                    action["uses"] = uses
                action["execution"] = execution
                continue

            action = {
                "id": ability.get("id", resource_id),
                "name": ability.get("name", resource_id),
                "action_type": ability.get("actionType", "action"),
                "description": ability.get("description", ""),
                "source": source_label,
                "execution": execution,
            }
            if resource_id:
                action["resourceId"] = resource_id
            if uses:
                action["uses"] = uses
            actions.append(action)

        return actions
    
    def _get_racial_spells(self, character: Character) -> List[Dict[str, Any]]:
        """Get spells granted by race/subrace traits (e.g., Drow Magic, Infernal Legacy)"""
        racial_spells = []
        race = get_race_by_name(character.race_id) if character.race_id else None
        if not race:
            return racial_spells

        # Collect traits from race + subrace
        traits = list(race.get("traits", []))
        if character.subrace_id:
            for sr in race.get("subraces", []):
                if sr.get("id") == character.subrace_id:
                    traits.extend(sr.get("traits", []))
                    break

        for trait in traits:
            ability = trait.get("spellcastingAbility", "charisma")

            # Fixed spells array (e.g., Drow Magic, Forest Gnome)
            spells_arr = trait.get("spells")
            if spells_arr:
                for sp in spells_arr:
                    min_level = sp.get("minCharacterLevel", 1)
                    if (character.level or 1) >= min_level:
                        racial_spells.append({
                            "spell_id": sp.get("name", ""),
                            "level": sp.get("level", 0),
                            "source": "racial",
                            "uses_per_day": sp.get("usesPerDay"),
                            "spellcasting_ability": ability,
                            "trait_name": trait.get("name", ""),
                        })

            # cantripChoice traits (e.g., High Elf: user-chosen wizard cantrip)
            if trait.get("cantripChoice"):
                race_choices = getattr(character, "race_choices", None) or {}
                chosen = race_choices.get("cantrip") if isinstance(race_choices, dict) else None
                if chosen and not any(rs["spell_id"] == chosen for rs in racial_spells):
                    racial_spells.append({
                        "spell_id": chosen,
                        "level": 0,
                        "source": "racial",
                        "uses_per_day": None,
                        "spellcasting_ability": ability,
                        "trait_name": trait.get("name", ""),
                    })
        return racial_spells

    def _get_prepared_spells(self, character: Character) -> List[Dict[str, Any]]:
        """Get character's spells with details and prepared status"""
        spells = []

        # Get all known spell IDs (use set to avoid duplicates)
        selected_spell_ids = set()
        raw_spells = character.selected_spells or []
        for spell in raw_spells:
            if isinstance(spell, dict):
                selected_spell_ids.add(spell.get("id", spell.get("spell_id", "")))
            elif isinstance(spell, str):
                selected_spell_ids.add(spell)

        # Also include cantrips
        raw_cantrips = character.selected_cantrips or []
        for cantrip in raw_cantrips:
            if isinstance(cantrip, dict):
                selected_spell_ids.add(cantrip.get("id", cantrip.get("spell_id", "")))
            elif isinstance(cantrip, str):
                selected_spell_ids.add(cantrip)

        # Get prepared spell IDs (those marked for daily use)
        prepared_spell_ids = set()
        for spell in (character.prepared_spells or []):
            if isinstance(spell, dict):
                prepared_spell_ids.add(spell.get("id", spell.get("spell_id", "")))
            elif isinstance(spell, str):
                prepared_spell_ids.add(spell)

        # Load spell data
        all_spells = self._load_spells_data()
        spell_lookup = {s["id"]: s for s in all_spells}

        # Build spell list with details
        for spell_id in selected_spell_ids:
            spell_data = spell_lookup.get(spell_id)
            if spell_data:
                # Cantrips (level 0) are always prepared
                is_cantrip = spell_data.get("level", 0) == 0
                is_prepared = is_cantrip or spell_id in prepared_spell_ids

                # Convert components list to string
                components = spell_data.get("components", [])
                if isinstance(components, list):
                    components = ", ".join(components)

                spells.append({
                    "id": spell_id,
                    "level": spell_data.get("level", 0),
                    "name": spell_data.get("name", spell_id),
                    "nameEn": spell_data.get("nameEn", ""),
                    "school": spell_data.get("school", ""),
                    "casting_time": spell_data.get("castingTime", "1 动作"),
                    "range": spell_data.get("range", ""),
                    "components": components,
                    "duration": spell_data.get("duration", ""),
                    "description": spell_data.get("description", ""),
                    "prepared": is_prepared,
                    "ritual": spell_data.get("ritual", False),
                    "concentration": spell_data.get("concentration", False),
                    "damage": spell_data.get("damage", ""),
                    "damageType": spell_data.get("damageType", ""),
                    "areaOfEffect": spell_data.get("areaOfEffect"),
                    "isControlSpell": spell_data.get("isControlSpell", False),
                })

        # Merge racial spells (avoid duplicates)
        existing_ids = {s["id"] for s in spells}
        racial_spells = self._get_racial_spells(character)
        for rs in racial_spells:
            spell_id = rs["spell_id"]
            if spell_id in existing_ids:
                continue
            spell_data = spell_lookup.get(spell_id)
            if not spell_data:
                continue
            components = spell_data.get("components", [])
            if isinstance(components, list):
                components = ", ".join(components)
            spells.append({
                "id": spell_id,
                "level": spell_data.get("level", 0),
                "name": spell_data.get("name", spell_id),
                "nameEn": spell_data.get("nameEn", ""),
                "school": spell_data.get("school", ""),
                "casting_time": spell_data.get("castingTime", "1 动作"),
                "range": spell_data.get("range", ""),
                "components": components,
                "duration": spell_data.get("duration", ""),
                "description": spell_data.get("description", ""),
                "prepared": True,
                "ritual": spell_data.get("ritual", False),
                "concentration": spell_data.get("concentration", False),
                "damage": spell_data.get("damage", ""),
                "damageType": spell_data.get("damageType", ""),
                "areaOfEffect": spell_data.get("areaOfEffect"),
                "isControlSpell": spell_data.get("isControlSpell", False),
                "source": "racial",
                "usesPerDay": rs.get("uses_per_day"),
                "traitName": rs.get("trait_name", ""),
            })
            existing_ids.add(spell_id)

        # Sort: cantrips first, then by level
        spells.sort(key=lambda s: (s["level"], s["name"]))

        return spells

    def _get_battle_master_data(self, character: Character) -> Optional[Dict[str, Any]]:
        """Get Battle Master specific data (superiority dice, maneuvers)"""
        # Only for Fighter + Battle Master
        if character.class_id != "fighter" or character.subclass_id != "battle_master":
            return None

        level = character.level
        if level < 3:  # Battle Master starts at level 3
            return None

        from app.services import class_resource_service

        resource = class_resource_service.get_resource_definition("superiority_dice")
        if not resource:
            return None

        ability_scores = character.ability_scores or {}
        dice_count = class_resource_service.calculate_resource_max(
            resource,
            level,
            ability_scores.get("charisma", 10),
            ability_scores.get("wisdom", 10),
            ability_scores.get("intelligence", 10),
        )
        die_type = class_resource_service.get_current_dice_type(resource, level) or "d8"

        # Get current uses from class_feature_uses
        class_feature_uses = character.class_feature_uses or {}
        superiority_uses = class_feature_uses.get("superiority_dice", {})
        current_dice = superiority_uses.get("current", dice_count)

        return {
            "superiority_dice": {
                "current": current_dice,
                "max": dice_count,
                "die": die_type,
            },
            "maneuvers_known": character.maneuvers_known or [],
        }


# Singleton instance
character_sheet_service = CharacterSheetService()
