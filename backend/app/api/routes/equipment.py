"""
Equipment API routes
Handles equipment-related operations including pack organization
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
from pathlib import Path
import json
import re

from app.db.session import get_db
from app.services.ai_model_service import ai_model_service
from app.services.ai_service import AIService
from app.utils.rules_cache import get_equipment_data as _get_equipment_data_cached

router = APIRouter(prefix="/api/equipment", tags=["equipment"])


def load_equipment_data() -> Dict[str, Any]:
    """Load equipment data (via rules_cache)"""
    return _get_equipment_data_cached()


def get_item_metadata(item_id: str) -> Optional[Dict[str, Any]]:
    """Get metadata for an item by ID"""
    data = load_equipment_data()
    normalized_id = item_id.lower().strip()

    # Check adventuringGear (dict of categories)
    for category, items in data.get("adventuringGear", {}).items():
        if isinstance(items, list):
            for item in items:
                if isinstance(item, dict) and item.get("id") == normalized_id:
                    return item

    # Check armor
    armor_data = data.get("armor", {})
    for tier in ["light", "medium", "heavy", "shield"]:
        for item in armor_data.get(tier, []):
            if isinstance(item, dict) and item.get("id") == normalized_id:
                return item

    # Check weapons
    weapons_data = data.get("weapons", {})
    for category in ["simple", "martial"]:
        cat_data = weapons_data.get(category, {})
        for weapon_type in ["melee", "ranged"]:
            for weapon in cat_data.get(weapon_type, []):
                if isinstance(weapon, dict) and weapon.get("id") == normalized_id:
                    return weapon

    # Check tools (dict with subcategories: artisansTools, specializedTools, gamingSets, musicalInstruments)
    tools_data = data.get("tools", {})
    if isinstance(tools_data, dict):
        for category in ["artisansTools", "specializedTools", "gamingSets", "musicalInstruments"]:
            for item in tools_data.get(category, []):
                if isinstance(item, dict) and item.get("id") == normalized_id:
                    return item
    elif isinstance(tools_data, list):
        # Fallback for old format
        for item in tools_data:
            if isinstance(item, dict) and item.get("id") == normalized_id:
                return item

    # Check packs
    for pack in data.get("packs", []):
        if pack.get("id") == normalized_id:
            return pack

    # Check backgroundItems (incense, vestments, etc.)
    bg_items = data.get("backgroundItems", [])
    if isinstance(bg_items, list):
        for item in bg_items:
            if isinstance(item, dict) and item.get("id") == normalized_id:
                return item

    return None


def get_item_category(item_id: str) -> Optional[str]:
    """Get the category of an item by ID (e.g., 'tools.specializedTools', 'weapons.simple.melee')"""
    data = load_equipment_data()
    normalized_id = item_id.lower().strip()

    # Check adventuringGear
    for category, items in data.get("adventuringGear", {}).items():
        if isinstance(items, list):
            for item in items:
                if isinstance(item, dict) and item.get("id") == normalized_id:
                    return f"adventuringGear.{category}"

    # Check armor
    armor_data = data.get("armor", {})
    for tier in ["light", "medium", "heavy", "shield"]:
        for item in armor_data.get(tier, []):
            if isinstance(item, dict) and item.get("id") == normalized_id:
                return f"armor.{tier}"

    # Check weapons
    weapons_data = data.get("weapons", {})
    for category in ["simple", "martial"]:
        cat_data = weapons_data.get(category, {})
        for weapon_type in ["melee", "ranged"]:
            for weapon in cat_data.get(weapon_type, []):
                if isinstance(weapon, dict) and weapon.get("id") == normalized_id:
                    return f"weapons.{category}.{weapon_type}"

    # Check tools
    tools_data = data.get("tools", {})
    if isinstance(tools_data, dict):
        for category in ["artisansTools", "specializedTools", "gamingSets", "musicalInstruments"]:
            for item in tools_data.get(category, []):
                if isinstance(item, dict) and item.get("id") == normalized_id:
                    return f"tools.{category}"

    # Check packs
    for pack in data.get("packs", []):
        if pack.get("id") == normalized_id:
            return "packs"

    # Check backgroundItems
    bg_items = data.get("backgroundItems", [])
    if isinstance(bg_items, list):
        for item in bg_items:
            if isinstance(item, dict) and item.get("id") == normalized_id:
                return "backgroundItems"

    return None


def get_all_valid_item_ids() -> set:
    """Get all valid item IDs from equipment data"""
    data = load_equipment_data()
    valid_ids = set()

    # From adventuringGear (dict of categories, each with list of items)
    gear_data = data.get("adventuringGear", {})
    for category, items in gear_data.items():
        if isinstance(items, list):
            for item in items:
                if isinstance(item, dict) and "id" in item:
                    valid_ids.add(item["id"])

    # From packs
    for pack in data.get("packs", []):
        if "id" in pack:
            valid_ids.add(pack["id"])
        # Contents of packs
        for content in pack.get("contents", []):
            if "item" in content:
                valid_ids.add(content["item"])

    # From armor
    armor_data = data.get("armor", {})
    for tier in ["light", "medium", "heavy", "shield"]:
        for item in armor_data.get(tier, []):
            if isinstance(item, dict) and "id" in item:
                valid_ids.add(item["id"])

    # From weapons
    weapons_data = data.get("weapons", {})
    for category in ["simple", "martial"]:
        cat_data = weapons_data.get(category, {})
        for weapon_type in ["melee", "ranged"]:
            for weapon in cat_data.get(weapon_type, []):
                if isinstance(weapon, dict) and "id" in weapon:
                    valid_ids.add(weapon["id"])

    # From tools (dict with subcategories)
    tools_data = data.get("tools", {})
    if isinstance(tools_data, dict):
        for category in ["artisansTools", "specializedTools", "gamingSets", "musicalInstruments"]:
            for item in tools_data.get(category, []):
                if isinstance(item, dict) and "id" in item:
                    valid_ids.add(item["id"])
    elif isinstance(tools_data, list):
        # Fallback for old format
        for item in tools_data:
            if isinstance(item, dict) and "id" in item:
                valid_ids.add(item["id"])

    # From backgroundItems
    bg_items = data.get("backgroundItems", [])
    if isinstance(bg_items, list):
        for item in bg_items:
            if isinstance(item, dict) and "id" in item:
                valid_ids.add(item["id"])

    return valid_ids


def get_pack_contents(pack_id: str) -> List[Dict[str, Any]]:
    """Get contents of an equipment pack"""
    data = load_equipment_data()

    for pack in data.get("packs", []):
        if pack.get("id") == pack_id:
            return pack.get("contents", [])
    return []


def parse_currency_from_id(item_id: str) -> Optional[Dict[str, int]]:
    """Parse currency from item ID like pouch_with_15gp"""
    match = re.search(r'_with_(\d+)(cp|sp|ep|gp|pp)$', item_id.lower())
    if match:
        amount = int(match.group(1))
        currency_type = match.group(2)
        return {currency_type: amount}
    return None


def normalize_item_id(item_id: str) -> str:
    """Normalize common item ID variations to standard IDs"""
    # Common mappings
    mappings = {
        "leather_armor": "leather",
        "studded_leather_armor": "studded_leather",
        "chain_shirt_armor": "chain_shirt",
        "chain_mail_armor": "chain_mail",
        "scale_mail_armor": "scale_mail",
        "plate_armor": "plate",
        "half_plate_armor": "half_plate",
        "hide_armor": "hide",
        "ring_mail_armor": "ring_mail",
        "splint_armor": "splint",
        "breastplate_armor": "breastplate",
        "padded_armor": "padded",
    }

    normalized = item_id.lower().strip()
    return mappings.get(normalized, normalized)


class OrganizePackRequest(BaseModel):
    """Request schema for organizing a pack"""
    pack_id: str
    pack_name: str
    pack_description: str


class OrganizePackResponse(BaseModel):
    """Response schema for organized pack"""
    success: bool
    organized_items: List[Dict[str, Any]]
    message: str


class NormalizeEquipmentRequest(BaseModel):
    """Request schema for batch normalizing equipment"""
    items: List[Dict[str, Any]]


class NormalizeEquipmentResponse(BaseModel):
    """Response schema for batch normalized equipment"""
    success: bool
    items: List[Dict[str, Any]]
    currency_extracted: Dict[str, int]
    message: str


@router.post("/organize-pack", response_model=OrganizePackResponse)
async def organize_pack(
    request: OrganizePackRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Use AI to parse pack description and extract individual items with quantities
    """
    try:
        usage_params = await ai_model_service.get_usage_params(db, "equipment_pack_parse")
        config = usage_params.config
        temperature = usage_params.temperature
        max_tokens = usage_params.max_tokens

        prompt = f"""You are analyzing a D&D 5E equipment pack. Parse the description and extract all individual items with their quantities.

Pack Name: {request.pack_name}
Description: {request.pack_description}

Extract each item mentioned in the description. For each item, provide:
1. A standardized item ID (lowercase, underscores for spaces, e.g., "hemp_rope", "torch", "rations")
2. The item name in Chinese
3. The quantity

Return ONLY a valid JSON array with this exact format:
[
  {{"id": "item_id", "name": "物品名称", "quantity": 数量}},
  ...
]

Important rules:
- Use standard D&D item IDs (e.g., "rope_hempen" for hemp rope, "torch" for torches)
- For items measured in feet (尺), convert to standard units (e.g., "50尺麻绳" = 1 rope_hempen)
- For consumables like rations (口粮), use the number of days as quantity
- Return ONLY the JSON array, no other text"""

        response = await AIService.generate_completion(
            api_url=config.api_url,
            api_key=config.api_key,
            model=config.model_name,
            messages=[
                {"role": "system", "content": "You are a D&D 5E equipment expert. Return only valid JSON."},
                {"role": "user", "content": prompt}
            ],
            temperature=temperature,
            max_tokens=max_tokens
        )

        content = response.strip()
        json_match = re.search(r'\[[\s\S]*\]', content)
        if not json_match:
            raise ValueError("No JSON array found in AI response")

        organized_items = json.loads(json_match.group(0))

        if not isinstance(organized_items, list):
            raise ValueError("Response is not a list")

        for item in organized_items:
            if not isinstance(item, dict) or "id" not in item or "name" not in item or "quantity" not in item:
                raise ValueError("Invalid item structure in response")

        return OrganizePackResponse(
            success=True,
            organized_items=organized_items,
            message=f"成功整理 {len(organized_items)} 个物品"
        )

    except json.JSONDecodeError as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to parse AI response as JSON: {str(e)}"
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Invalid AI response format: {str(e)}"
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to organize pack: {str(e)}"
        )


@router.post("/normalize", response_model=NormalizeEquipmentResponse)
async def normalize_equipment(
    request: NormalizeEquipmentRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Normalize equipment data:
    - Standardize IDs to match equipment JSON data
    - Extract currency from items like pouch_with_15gp
    - Expand packs into individual items
    - Map generic items (simple_weapon, leather_armor) to specific items
    - Split combined weapon+ammo items (e.g., "轻弩（含20箭）" -> 轻弩 + 箭矢)
    """
    try:
        # Load valid item IDs
        valid_ids = get_all_valid_item_ids()

        # Helper to split combined weapon+ammo items
        def split_weapon_ammo_items(items_list):
            """Split items like '轻弩（含20箭）' into weapon + ammo"""
            result = []
            ammo_patterns = [
                (r'(.+?)（含(\d+)箭）', 'arrows', '箭矢'),
                (r'(.+?)（含(\d+)矢）', 'crossbow_bolts', '弩矢'),
                (r'(.+?)\s*\(含(\d+)箭\)', 'arrows', '箭矢'),
                (r'(.+?)\s*\(含(\d+)矢\)', 'crossbow_bolts', '弩矢'),
            ]
            for item in items_list:
                name = item.get("name", "")
                matched = False
                for pattern, ammo_id, ammo_name in ammo_patterns:
                    match = re.match(pattern, name)
                    if match:
                        weapon_name = match.group(1).strip()
                        ammo_qty = int(match.group(2))
                        # Add weapon with corrected name
                        weapon_item = {**item, "name": weapon_name}
                        result.append(weapon_item)
                        # Add ammo as separate item
                        ammo_item = {
                            "id": ammo_id,
                            "name": ammo_name,
                            "quantity": ammo_qty,
                            "equipped": False,
                        }
                        result.append(ammo_item)
                        matched = True
                        break
                if not matched:
                    result.append(item)
            return result

        # Split combined weapon+ammo items first
        items_to_process = split_weapon_ammo_items(request.items)

        # Pre-process items locally for common cases
        normalized_items = []
        currency_extracted = {"cp": 0, "sp": 0, "ep": 0, "gp": 0, "pp": 0}
        items_needing_ai = []

        for item in items_to_process:
            item_id = item.get("id", "")

            # 1. Check for currency items (pouch_with_15gp)
            currency = parse_currency_from_id(item_id)
            if currency:
                # Get the container (e.g., "pouch")
                container_id = re.sub(r'_with_\d+(cp|sp|ep|gp|pp)$', '', item_id.lower())
                if container_id in valid_ids:
                    # Create the container item
                    container_meta = get_item_metadata(container_id)
                    container_item = {
                        **item,
                        "id": container_id,
                        "name": container_meta.get("name", container_id.replace("_", " ").title()) if container_meta else container_id.replace("_", " ").title(),
                    }
                    normalized_items.append(container_item)

                    # Create coin items inside the container
                    for currency_type, amount in currency.items():
                        coin_quantity = amount * (item.get("quantity", 1))
                        if coin_quantity > 0:
                            # Map currency type to coin name
                            coin_names = {
                                "cp": ("copper_coins", "铜币"),
                                "sp": ("silver_coins", "银币"),
                                "ep": ("electrum_coins", "琥珀金币"),
                                "gp": ("gold_coins", "金币"),
                                "pp": ("platinum_coins", "铂金币"),
                            }
                            coin_id, coin_name = coin_names.get(currency_type, (f"{currency_type}_coins", currency_type.upper()))
                            coin_item = {
                                "id": coin_id,
                                "name": coin_name,
                                "quantity": coin_quantity,
                                "containerId": container_id,  # Inside the container
                                "equipmentType": "currency",
                            }
                            normalized_items.append(coin_item)
                continue

            # 2. Normalize item ID
            normalized_id = normalize_item_id(item_id)

            # 3. Check if it's a pack that needs expansion
            pack_contents = get_pack_contents(normalized_id)
            if pack_contents:
                # Expand pack into individual items
                source = item.get("source", "pack")

                # Check if pack contains a backpack - other items should go inside it
                container_in_pack = None
                container_item = None
                for content in pack_contents:
                    content_id = content.get("item")
                    if content_id in ["backpack", "pouch", "sack"]:
                        container_in_pack = content_id
                        break

                # First, create the container if exists
                if container_in_pack:
                    content_meta = get_item_metadata(container_in_pack)
                    container_item = {
                        "id": container_in_pack,
                        "name": content_meta.get("name", container_in_pack.replace("_", " ").title()) if content_meta else container_in_pack.replace("_", " ").title(),
                        "quantity": 1,
                        "equipped": False,
                        "source": source,
                        "from_pack": normalized_id
                    }
                    normalized_items.append(container_item)

                # Then create other items, putting them inside the container
                for content in pack_contents:
                    content_id = content.get("item")
                    if content_id == container_in_pack:
                        continue  # Skip the container itself, already added

                    content_meta = get_item_metadata(content_id)
                    expanded_item = {
                        "id": content_id,
                        "name": content_meta.get("name", content_id.replace("_", " ").title()) if content_meta else content_id.replace("_", " ").title(),
                        "quantity": content.get("quantity", 1) * item.get("quantity", 1),
                        "equipped": False,
                        "source": source,
                        "from_pack": normalized_id
                    }
                    # Enrich with full metadata
                    if content_meta:
                        if content_meta.get("nameEn"):
                            expanded_item["nameEn"] = content_meta.get("nameEn")
                        if content_meta.get("description"):
                            expanded_item["description"] = content_meta.get("description")
                        if content_meta.get("iconPath"):
                            expanded_item["iconPath"] = content_meta.get("iconPath")
                        if content_meta.get("weight") is not None:
                            expanded_item["weight"] = content_meta.get("weight")
                        if content_meta.get("cost"):
                            expanded_item["cost"] = content_meta.get("cost")
                        # Mark tools
                        item_category = get_item_category(content_id)
                        if item_category and "tools" in item_category:
                            expanded_item["equipmentType"] = "tool"
                    # Put inside container if one exists
                    if container_in_pack:
                        expanded_item["containerId"] = container_in_pack
                    normalized_items.append(expanded_item)
                continue

            # 4. Check if normalized ID is valid
            if normalized_id in valid_ids:
                new_item = {**item, "id": normalized_id}
                # Enrich with full metadata from equipment data
                meta = get_item_metadata(normalized_id)
                if meta:
                    # Update name if current name is missing, looks like an ID, or is English
                    current_name = new_item.get("name", "")
                    is_english_name = all(ord(c) < 128 for c in current_name if c.isalpha())
                    if not current_name or "_" in current_name or current_name == item_id or is_english_name:
                        if meta.get("name"):
                            new_item["name"] = meta.get("name")
                    # Add English name
                    if meta.get("nameEn"):
                        new_item["nameEn"] = meta.get("nameEn")
                    # Add description (important for tools with special effects)
                    if meta.get("description") and not new_item.get("description"):
                        new_item["description"] = meta.get("description")
                    # Add icon path for display
                    if meta.get("iconPath") and not new_item.get("iconPath"):
                        new_item["iconPath"] = meta.get("iconPath")
                    # Add weight
                    if meta.get("weight") is not None and new_item.get("weight") is None:
                        new_item["weight"] = meta.get("weight")
                    # Add cost
                    if meta.get("cost") and not new_item.get("cost"):
                        new_item["cost"] = meta.get("cost")
                    # Add equipment type for tools
                    if "tools" in str(get_item_category(normalized_id)):
                        new_item["equipmentType"] = "tool"
                normalized_items.append(new_item)
                continue

            # 5. Check for generic items that need AI help
            if item_id in ["simple_weapon", "martial_weapon", "simple_melee", "simple_ranged"]:
                items_needing_ai.append(item)
                continue

            # 6. Keep as-is if we can't normalize
            normalized_items.append(item)

        # Use AI for items that need intelligent mapping
        if items_needing_ai:
            usage_params2 = await ai_model_service.get_usage_params(db, "equipment_pack_parse")
            config = usage_params2.config
            temp2 = usage_params2.temperature
            max_tok2 = usage_params2.max_tokens

            # Get list of valid simple weapons for context
            data = load_equipment_data()
            simple_melee = []
            simple_ranged = []
            if "weapons" in data:
                simple_melee = [w["id"] for w in data["weapons"].get("simple", {}).get("melee", [])]
                simple_ranged = [w["id"] for w in data["weapons"].get("simple", {}).get("ranged", [])]

            items_json = json.dumps(items_needing_ai, ensure_ascii=False, indent=2)
            prompt = f"""Convert these generic D&D 5E items to specific items.

Items to convert:
{items_json}

Available simple melee weapons: {simple_melee}
Available simple ranged weapons: {simple_ranged}

Rules:
- "simple_weapon" should become a specific simple weapon like "dagger", "handaxe", "javelin", etc.
- "simple_melee" should become a specific simple melee weapon
- "simple_ranged" should become a specific simple ranged weapon like "light_crossbow", "shortbow"
- Choose reasonable weapons for an adventurer

Return a JSON array with the converted items (keep all original fields, just update "id"):
[{{"id": "specific_weapon_id", ...other fields...}}]"""

            response = await AIService.generate_completion(
                api_url=config.api_url,
                api_key=config.api_key,
                model=config.model_name,
                messages=[
                    {"role": "system", "content": "You are a D&D 5E equipment expert. Return only valid JSON."},
                    {"role": "user", "content": prompt}
                ],
                temperature=temp2,
                max_tokens=max_tok2
            )

            content = response.strip()
            json_match = re.search(r'\[[\s\S]*\]', content)
            if json_match:
                ai_items = json.loads(json_match.group(0))
                normalized_items.extend(ai_items)
            else:
                # Fallback: add original items
                normalized_items.extend(items_needing_ai)

        return NormalizeEquipmentResponse(
            success=True,
            items=normalized_items,
            currency_extracted=currency_extracted,
            message=f"成功格式化 {len(normalized_items)} 个物品"
        )

    except json.JSONDecodeError as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to parse AI response: {str(e)}"
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to normalize equipment: {str(e)}"
        )
