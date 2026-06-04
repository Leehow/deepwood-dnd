"""
统一的实体创建服务
所有怪物/NPC/物品的创建都通过此服务，确保数据格式一致
"""
from typing import Optional, Dict, Any, List, Literal
from uuid import uuid4
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.monster_instance import MonsterInstance
from app.utils.item_payload_normalizer import normalize_character_equipment_payloads


def normalize_creature_size(size: Optional[str]) -> str:
    """Normalize English/Chinese size labels to a canonical English value."""
    if not size:
        return "medium"

    normalized = str(size).strip().lower()
    size_map = {
        "tiny": "tiny",
        "微型": "tiny",
        "超小型": "tiny",
        "small": "small",
        "小型": "small",
        "medium": "medium",
        "中型": "medium",
        "large": "large",
        "大型": "large",
        "huge": "huge",
        "巨型": "huge",
        "gargantuan": "gargantuan",
        "超巨型": "gargantuan",
    }
    return size_map.get(normalized, normalized)


def creature_size_to_token_size(size: Optional[str]) -> str:
    """Map canonical creature sizes to token sizes used by the map."""
    normalized = normalize_creature_size(size)
    size_map = {
        "tiny": "0.4x0.4",
        "small": "0.65x0.65",
        "medium": "1x1",
        "large": "2x2",
        "huge": "3x3",
        "gargantuan": "4x4",
    }
    return size_map.get(normalized, "1x1")


def size_cn_to_token_size(size_cn: str) -> str:
    """Backward-compatible alias."""
    return creature_size_to_token_size(size_cn)


class MonsterDataNormalizer:
    """
    怪物数据规范化工具
    将不同来源的数据统一为标准格式（下划线命名）
    """

    # 驼峰到下划线的字段映射
    FIELD_MAPPINGS = {
        "abilityScores": "ability_scores",
        "specialAbilities": "special_abilities",
        "legendaryActions": "legendary_actions",
        "hpFormula": "hp_formula",
        "nameEn": "name_en",
        "hitPoints": "hit_points",
        "armorClass": "armor_class",
        "challengeRating": "challenge_rating",
    }

    @classmethod
    def normalize(cls, raw_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        统一任何来源的原始数据为标准格式

        Args:
            raw_data: 原始怪物数据（可能有驼峰或下划线字段名）

        Returns:
            规范化后的数据（统一下划线格式）
        """
        if not raw_data:
            return {}

        normalized = {}

        # 基础字符串字段
        normalized["name"] = raw_data.get("name")
        normalized["name_en"] = raw_data.get("name_en") or raw_data.get("nameEn")
        normalized["size"] = normalize_creature_size(raw_data.get("size", "medium"))
        normalized["type"] = raw_data.get("type", "类人生物")
        normalized["alignment"] = raw_data.get("alignment")

        # 数值字段（优先使用下划线格式）
        normalized["cr"] = str(
            raw_data.get("cr") or
            raw_data.get("challenge_rating") or
            raw_data.get("challengeRating") or
            "1"
        )
        normalized["ac"] = (
            raw_data.get("ac") or
            raw_data.get("armor_class") or
            raw_data.get("armorClass") or
            10
        )
        normalized["hp"] = (
            raw_data.get("hp") or
            raw_data.get("hit_points") or
            raw_data.get("hitPoints") or
            10
        )
        normalized["hp_formula"] = (
            raw_data.get("hp_formula") or
            raw_data.get("hpFormula")
        )

        # 能力值（优先下划线格式，然后驼峰格式，最后检查单独字段）
        ability_scores = (
            raw_data.get("ability_scores") or
            raw_data.get("abilityScores")
        )
        # 如果没有嵌套的 ability_scores 对象，检查单独的能力值字段
        if not ability_scores:
            has_individual_stats = any(
                raw_data.get(stat) is not None
                for stat in ["str", "dex", "con", "int", "wis", "cha"]
            )
            if has_individual_stats:
                ability_scores = {}
                for stat in ["str", "dex", "con", "int", "wis", "cha"]:
                    score = raw_data.get(stat)
                    if score is not None:
                        ability_scores[stat] = score
                        # 计算调整值（如果没有提供）
                        mod_key = f"{stat}Mod"
                        if raw_data.get(mod_key) is not None:
                            ability_scores[mod_key] = raw_data.get(mod_key)
                        elif isinstance(score, (int, float)):
                            ability_scores[mod_key] = (int(score) - 10) // 2
        normalized["ability_scores"] = ability_scores

        # 速度（优先下划线格式，兼容 speed/speeds）
        normalized["speeds"] = (
            raw_data.get("speeds") or
            raw_data.get("speed")
        )
        if normalized["speeds"] is None:
            normalized["speeds"] = {"walk": 30}

        # 特殊能力（优先下划线格式）
        normalized["special_abilities"] = (
            raw_data.get("special_abilities") or
            raw_data.get("specialAbilities") or
            []
        )

        # 动作
        normalized["actions"] = raw_data.get("actions", [])

        # 反应和传奇动作
        normalized["reactions"] = raw_data.get("reactions")
        normalized["legendary_actions"] = (
            raw_data.get("legendary_actions") or
            raw_data.get("legendaryActions")
        )

        # 施法能力
        normalized["spellcasting"] = raw_data.get("spellcasting")

        # 保留其他未知字段（排除已映射的驼峰字段）
        excluded = set(cls.FIELD_MAPPINGS.keys()) | set(normalized.keys())
        for key, value in raw_data.items():
            if key not in excluded:
                normalized[key] = value

        return normalized

    @classmethod
    def build_monster_data(
        cls,
        source: Literal["preset", "ai", "module"],
        normalized_data: Dict[str, Any],
        **extra_fields
    ) -> Dict[str, Any]:
        """
        为 MonsterInstance.monster_data 构建标准化的 JSON

        Args:
            source: 数据来源标识
            normalized_data: normalize() 输出的数据
            extra_fields: 额外字段（source_module, appearance 等）

        Returns:
            标准化的 monster_data dict
        """
        monster_data = {
            "source": source,
            # 基础信息
            "id": normalized_data.get("id"),  # 怪物原始ID
            "name": normalized_data.get("name"),
            "name_en": normalized_data.get("name_en"),
            "description": normalized_data.get("description"),  # 描述
            "appearance": normalized_data.get("appearance"),  # 外观描述
            "appearance_en": normalized_data.get("appearanceEn"),  # 英文外观
            # 预设头像（从 monsters.json 继承）
            "defaultAvatarSmall": normalized_data.get("defaultAvatarSmall"),
            "defaultAvatarLarge": normalized_data.get("defaultAvatarLarge"),
            # 战斗数据
            "cr": normalized_data.get("cr"),
            "xp": normalized_data.get("xp"),  # 经验值
            "hp": normalized_data.get("hp"),
            "hp_formula": normalized_data.get("hp_formula"),
            "ac": normalized_data.get("ac"),
            "size": normalized_data.get("size"),
            "type": normalized_data.get("type"),
            "alignment": normalized_data.get("alignment"),
            # 属性和能力
            "ability_scores": normalized_data.get("ability_scores"),
            "speeds": normalized_data.get("speeds"),
            "senses": normalized_data.get("senses"),  # 感官
            "languages": normalized_data.get("languages"),  # 语言
            # 动作和特性
            "special_abilities": normalized_data.get("special_abilities"),
            "actions": normalized_data.get("actions"),
            "reactions": normalized_data.get("reactions"),
            "legendary_actions": normalized_data.get("legendary_actions"),
            "spellcasting": normalized_data.get("spellcasting"),
        }

        # 添加额外字段
        for key, value in extra_fields.items():
            if value is not None:
                monster_data[key] = value

        # 移除 None 值
        return {k: v for k, v in monster_data.items() if v is not None}


class EntityCreationService:
    """
    统一的实体创建服务
    Resource Chat / Module Chat / 自定义按钮 都应使用此服务
    """

    @staticmethod
    def _merge_currency(
        base_currency: Optional[Dict[str, int]],
        extra_currency: Optional[Dict[str, int]],
    ) -> Dict[str, int]:
        currency = dict(base_currency or {"cp": 0, "sp": 0, "ep": 0, "gp": 0, "pp": 0})
        for coin_type in ("cp", "sp", "ep", "gp", "pp"):
            amount = int((extra_currency or {}).get(coin_type) or 0)
            if amount:
                currency[coin_type] = int(currency.get(coin_type) or 0) + amount
        return currency

    @staticmethod
    async def create_monster_instance(
        db: AsyncSession,
        campaign_id: int,
        name: str,
        *,
        monster_id: Optional[str] = None,
        name_cn: Optional[str] = None,
        size: str = "中型",
        m_type: str = "类人生物",
        alignment: Optional[str] = None,
        challenge_rating: str = "1",
        armor_class: int = 10,
        hit_points: int = 10,
        ability_scores: Optional[Dict] = None,
        speeds: Optional[Dict] = None,
        monster_data: Optional[Dict] = None,
        token_size: Optional[str] = None,
        inventory: Optional[List[Dict]] = None,
        currency: Optional[Dict[str, int]] = None,
        **extra_fields
    ) -> MonsterInstance:
        """
        统一的怪物实例创建入口

        Args:
            db: 数据库 session
            campaign_id: 战役 ID
            name: 怪物名称
            monster_id: 怪物 ID（可选，若不提供则自动生成）
            name_cn: 中文名称
            size: 体型
            m_type: 生物类型
            alignment: 阵营
            challenge_rating: 挑战等级
            armor_class: 护甲等级
            hit_points: 生命值
            ability_scores: 能力值 dict
            speeds: 速度 dict
            monster_data: 完整怪物数据 JSON
            token_size: token 大小（可选，根据体型自动计算）
            inventory: 携带物品列表 [{name, quantity, ...}]
            currency: 携带金钱 {cp, sp, ep, gp, pp}
            extra_fields: 其他 MonsterInstance 字段

        Returns:
            创建的 MonsterInstance 对象
        """
        if not monster_id:
            monster_id = f"monster_{uuid4().hex[:8]}"

        if not token_size:
            token_size = size_cn_to_token_size(size)

        # 检查 monster_data 中是否有预设头像
        avatar_url = extra_fields.pop("avatar_url", None)
        avatar_url_large = extra_fields.pop("avatar_url_large", None)
        has_avatar = extra_fields.pop("has_avatar", False)

        if monster_data:
            default_small = monster_data.get("defaultAvatarSmall")
            default_large = monster_data.get("defaultAvatarLarge")
            if default_small and default_large:
                avatar_url = avatar_url or default_small
                avatar_url_large = avatar_url_large or default_large
                has_avatar = True

        normalized_inventory, inventory_currency, _ = normalize_character_equipment_payloads(inventory or [])
        normalized_equipment, equipment_currency, _ = normalize_character_equipment_payloads(
            extra_fields.pop("equipment", None) or []
        )
        normalized_currency = EntityCreationService._merge_currency(currency, inventory_currency)
        normalized_currency = EntityCreationService._merge_currency(normalized_currency, equipment_currency)

        monster_instance = MonsterInstance(
            campaign_id=campaign_id,
            monster_id=monster_id,
            name=name,
            name_cn=name_cn or name,
            size=size,
            type=m_type,
            alignment=alignment,
            challenge_rating=challenge_rating,
            armor_class=armor_class,
            hit_points=hit_points,
            current_hp=hit_points,
            ability_scores=ability_scores,
            speeds=speeds,
            monster_data=monster_data,
            token_size=token_size,
            inventory=normalized_inventory,
            currency=normalized_currency,
            equipment=normalized_equipment or None,
            avatar_url=avatar_url,
            avatar_url_large=avatar_url_large,
            has_avatar=has_avatar,
            **extra_fields
        )

        db.add(monster_instance)
        await db.flush()
        return monster_instance

    @classmethod
    async def create_from_raw_data(
        cls,
        db: AsyncSession,
        campaign_id: int,
        raw_data: Dict[str, Any],
        source: Literal["preset", "ai", "module"],
        *,
        instance_name: Optional[str] = None,
        monster_id: Optional[str] = None,
        inventory: Optional[List[Dict]] = None,
        currency: Optional[Dict[str, int]] = None,
        **extra_monster_data_fields
    ) -> MonsterInstance:
        """
        从原始数据创建怪物实例（自动规范化）

        Args:
            db: 数据库 session
            campaign_id: 战役 ID
            raw_data: 原始怪物数据（任意格式）
            source: 数据来源
            instance_name: 实例名称（可选，默认使用 raw_data 中的 name）
            monster_id: 怪物 ID
            inventory: 携带物品列表
            currency: 携带金钱
            extra_monster_data_fields: 额外的 monster_data 字段

        Returns:
            创建的 MonsterInstance 对象
        """
        # 规范化数据
        normalized = MonsterDataNormalizer.normalize(raw_data)

        # 构建 monster_data
        monster_data = MonsterDataNormalizer.build_monster_data(
            source=source,
            normalized_data=normalized,
            **extra_monster_data_fields
        )

        # 创建实例
        return await cls.create_monster_instance(
            db=db,
            campaign_id=campaign_id,
            name=instance_name or normalized.get("name", "未知怪物"),
            monster_id=monster_id,
            name_cn=normalized.get("name"),
            size=normalized.get("size", "中型"),
            m_type=normalized.get("type", "类人生物"),
            alignment=normalized.get("alignment"),
            challenge_rating=normalized.get("cr", "1"),
            armor_class=normalized.get("ac", 10),
            hit_points=normalized.get("hp", 10),
            ability_scores=normalized.get("ability_scores"),
            speeds=normalized.get("speeds"),
            monster_data=monster_data,
            inventory=inventory,
            currency=currency,
        )


# 导出便捷别名
normalize_monster_data = MonsterDataNormalizer.normalize
build_monster_data = MonsterDataNormalizer.build_monster_data
create_monster_instance = EntityCreationService.create_monster_instance
create_from_raw_data = EntityCreationService.create_from_raw_data
