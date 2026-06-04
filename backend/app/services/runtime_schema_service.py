from __future__ import annotations

import logging
from typing import Any

from pydantic import TypeAdapter, ValidationError

from app.schemas.character_runtime import (
    CharacterCurrency,
    CharacterEquipmentState,
    CharacterFeatureUseState,
    CharacterHotbarState,
    CharacterSpellSlotsState,
    CharacterStatusEffects,
)
from app.schemas.combat_runtime import CombatStorageRuntime
from app.schemas.token_runtime import (
    ActiveAuraRuntime,
    ActiveEffectRuntime,
    CastingInProgressRuntime,
    ConcentrationSpellRuntime,
    DeathSavesRuntime,
    DisguiseDataRuntime,
    TransformationDataRuntime,
)

logger = logging.getLogger(__name__)


class RuntimeSchemaValidationError(ValueError):
    pass


_ACTIVE_EFFECTS_ADAPTER = TypeAdapter(list[ActiveEffectRuntime])
_ACTIVE_AURAS_ADAPTER = TypeAdapter(list[ActiveAuraRuntime])
_TRANSFORMATION_ADAPTER = TypeAdapter(TransformationDataRuntime)
_CONCENTRATION_ADAPTER = TypeAdapter(ConcentrationSpellRuntime)
_CASTING_ADAPTER = TypeAdapter(CastingInProgressRuntime)
_DISGUISE_ADAPTER = TypeAdapter(DisguiseDataRuntime)
_DEATH_SAVES_ADAPTER = TypeAdapter(DeathSavesRuntime)
_FEATURE_USES_ADAPTER = TypeAdapter(dict[str, CharacterFeatureUseState])
_STATUS_EFFECTS_ADAPTER = TypeAdapter(CharacterStatusEffects)
_SPELL_SLOTS_ADAPTER = TypeAdapter(CharacterSpellSlotsState)
_HOTBAR_ADAPTER = TypeAdapter(CharacterHotbarState)
_CURRENCY_ADAPTER = TypeAdapter(CharacterCurrency)
_EQUIPMENT_ADAPTER = TypeAdapter(CharacterEquipmentState)
_COMBAT_STORAGE_ADAPTER = TypeAdapter(CombatStorageRuntime)


def _dump_model(value: Any) -> Any:
    if isinstance(value, list):
        return [_dump_model(item) for item in value]
    if isinstance(value, dict):
        return {key: _dump_model(item) for key, item in value.items()}
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json", by_alias=True, exclude_none=True)
    return value


def _normalize_with_adapter(
    value: Any,
    *,
    adapter: TypeAdapter,
    field_name: str,
    strict: bool,
    allow_none: bool = True,
) -> Any:
    if value is None:
        return None if allow_none else adapter.validate_python([])

    try:
        normalized = adapter.validate_python(value)
    except ValidationError as exc:
        message = f"Invalid {field_name}: {exc.errors()}"
        if strict:
            raise RuntimeSchemaValidationError(message) from exc
        logger.warning("[runtime_schema_service] %s", message)
        return value

    return _dump_model(normalized)


def normalize_token_active_effects(value: Any, *, strict: bool = False) -> list[dict[str, Any]] | None:
    return _normalize_with_adapter(
        value,
        adapter=_ACTIVE_EFFECTS_ADAPTER,
        field_name="token.active_effects",
        strict=strict,
    )


def normalize_token_active_auras(value: Any, *, strict: bool = False) -> list[dict[str, Any]] | None:
    return _normalize_with_adapter(
        value,
        adapter=_ACTIVE_AURAS_ADAPTER,
        field_name="token.active_auras",
        strict=strict,
    )


def normalize_token_transformation_data(value: Any, *, strict: bool = False) -> dict[str, Any] | None:
    return _normalize_with_adapter(
        value,
        adapter=_TRANSFORMATION_ADAPTER,
        field_name="token.transformation_data",
        strict=strict,
    )


def normalize_token_concentration_spell(value: Any, *, strict: bool = False) -> dict[str, Any] | None:
    return _normalize_with_adapter(
        value,
        adapter=_CONCENTRATION_ADAPTER,
        field_name="token.concentration_spell",
        strict=strict,
    )


def normalize_token_casting_in_progress(value: Any, *, strict: bool = False) -> dict[str, Any] | None:
    return _normalize_with_adapter(
        value,
        adapter=_CASTING_ADAPTER,
        field_name="token.casting_in_progress",
        strict=strict,
    )


def normalize_token_disguise_data(value: Any, *, strict: bool = False) -> dict[str, Any] | None:
    return _normalize_with_adapter(
        value,
        adapter=_DISGUISE_ADAPTER,
        field_name="token.disguise_data",
        strict=strict,
    )


def normalize_token_death_saves(value: Any, *, strict: bool = False) -> dict[str, Any] | None:
    return _normalize_with_adapter(
        value,
        adapter=_DEATH_SAVES_ADAPTER,
        field_name="token.death_saves",
        strict=strict,
    )


def normalize_character_class_feature_uses(value: Any, *, strict: bool = False) -> dict[str, dict[str, Any]] | None:
    return _normalize_with_adapter(
        value,
        adapter=_FEATURE_USES_ADAPTER,
        field_name="character.class_feature_uses",
        strict=strict,
    )


def normalize_character_status_effects(value: Any, *, strict: bool = False) -> dict[str, Any] | None:
    return _normalize_with_adapter(
        value,
        adapter=_STATUS_EFFECTS_ADAPTER,
        field_name="character.status_effects",
        strict=strict,
    )


def normalize_character_spell_slots_state(value: Any, *, strict: bool = False) -> list[int | None] | None:
    return _normalize_with_adapter(
        value,
        adapter=_SPELL_SLOTS_ADAPTER,
        field_name="character.spell_slots_state",
        strict=strict,
    )


def normalize_character_hotbar(value: Any, *, strict: bool = False) -> list[Any] | None:
    return _normalize_with_adapter(
        value,
        adapter=_HOTBAR_ADAPTER,
        field_name="character.hotbar",
        strict=strict,
    )


def normalize_character_currency(value: Any, *, strict: bool = False) -> dict[str, Any] | None:
    return _normalize_with_adapter(
        value,
        adapter=_CURRENCY_ADAPTER,
        field_name="character.currency",
        strict=strict,
    )


def normalize_character_equipment(value: Any, *, strict: bool = False) -> list[dict[str, Any]] | None:
    return _normalize_with_adapter(
        value,
        adapter=_EQUIPMENT_ADAPTER,
        field_name="character.equipment",
        strict=strict,
    )


def normalize_combat_storage_data(value: Any, *, strict: bool = False) -> dict[str, Any] | None:
    return _normalize_with_adapter(
        value,
        adapter=_COMBAT_STORAGE_ADAPTER,
        field_name="combat.storage",
        strict=strict,
    )


def normalize_campaign_storage_data(
    *,
    object_type: str,
    data: Any,
    strict: bool = False,
) -> Any:
    if object_type == "combat":
        return normalize_combat_storage_data(data, strict=strict)
    return data
