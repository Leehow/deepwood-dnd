from typing import Any, Dict, Optional


CHARM_ANIMALS_AND_PLANTS_FEATURE_ID = "charm_animals_and_plants"
MASTER_OF_NATURE_CONTROL_TYPE = "nature_charm"


def get_effect_metadata(effect: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not isinstance(effect, dict):
        return {}
    metadata = effect.get("metadata")
    return metadata if isinstance(metadata, dict) else {}


def get_effect_source_feature_id(effect: Optional[Dict[str, Any]]) -> str:
    if not isinstance(effect, dict):
        return ""
    metadata = get_effect_metadata(effect)
    return str(
        effect.get("sourceFeatureId")
        or metadata.get("sourceFeatureId")
        or ""
    ).strip().lower()


def get_effect_source_token_id(effect: Optional[Dict[str, Any]]) -> Optional[str]:
    if not isinstance(effect, dict):
        return None
    metadata = get_effect_metadata(effect)
    source_token_id = (
        effect.get("sourceTokenId")
        or effect.get("source_token_id")
        or metadata.get("sourceTokenId")
        or metadata.get("source_token_id")
    )
    if source_token_id is None:
        return None
    return str(source_token_id).strip()


def is_charm_animals_and_plants_effect(
    effect: Optional[Dict[str, Any]],
    source_token_id: Optional[int] = None,
) -> bool:
    if not isinstance(effect, dict):
        return False
    if str(effect.get("condition") or "").strip().lower() != "charmed":
        return False
    if get_effect_source_feature_id(effect) != CHARM_ANIMALS_AND_PLANTS_FEATURE_ID:
        return False
    if source_token_id is None:
        return True
    return get_effect_source_token_id(effect) == str(source_token_id)


def get_master_of_nature_restore_data(
    effect: Optional[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    metadata = get_effect_metadata(effect)
    if not metadata.get("masterOfNatureControlled"):
        return None
    return {
        "original_user_id": metadata.get("originalUserId"),
        "original_faction": metadata.get("originalFaction"),
        "original_controller_character_id": metadata.get("originalControllerCharacterId"),
        "original_control_type": metadata.get("originalControlType"),
    }
