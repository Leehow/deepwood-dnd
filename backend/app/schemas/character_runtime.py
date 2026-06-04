from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field, RootModel

from app.schemas.token_runtime import ActiveEffectRuntime


class RuntimeSchemaBase(BaseModel):
    model_config = ConfigDict(extra="allow")


class CharacterFeatureUseState(RuntimeSchemaBase):
    current: int | None = None
    max: int | None = None


class CharacterStatusCondition(RuntimeSchemaBase):
    condition: str | None = None
    name: str | None = None
    source: Any = None
    duration: Any = None


class CharacterStatusEffects(RuntimeSchemaBase):
    custom_effects: list[ActiveEffectRuntime] = Field(default_factory=list)
    active_conditions: list[CharacterStatusCondition] = Field(default_factory=list)
    exhaustion_level: int = 0


class CharacterCurrency(RuntimeSchemaBase):
    cp: int = 0
    sp: int = 0
    ep: int = 0
    gp: int = 0
    pp: int = 0


class CharacterEquipmentEntry(RuntimeSchemaBase):
    id: str | None = None
    item_id: str | None = None
    name: str | None = None
    quantity: int | None = None
    equipped: bool | None = None
    slot: str | None = None
    container_id: str | None = None


class CharacterSpellSlotsState(RootModel[list[int | None]]):
    pass


class CharacterHotbarState(RootModel[list[Any]]):
    pass


class CharacterEquipmentState(RootModel[list[CharacterEquipmentEntry]]):
    pass
