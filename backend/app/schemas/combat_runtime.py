from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict


class RuntimeSchemaBase(BaseModel):
    model_config = ConfigDict(extra="allow")


class CombatEventSummary(RuntimeSchemaBase):
    type: str | None = None
    token_id: int | None = None
    target_token_id: int | None = None
    character_id: int | None = None
    result: str | None = None
    message: str | None = None
    round_number: int | None = None


class CombatTurnRuntime(RuntimeSchemaBase):
    token_id: int | None = None
    character_id: int | None = None
    monster_instance_id: int | None = None
    movement_used: int | float | None = None
    action_used: bool | None = None
    bonus_action_used: bool | None = None
    reaction_used: bool | None = None


class CombatantRuntime(RuntimeSchemaBase):
    token_id: int | None = None
    character_id: int | None = None
    monster_instance_id: int | None = None
    initiative: int | None = None
    name: str | None = None
    is_active: bool | None = None


class CombatStorageRuntime(RuntimeSchemaBase):
    in_combat: bool | None = None
    round_number: int | None = None
    current_turn_index: int | None = None
    current_turn_token_id: int | None = None
    initiative_order: list[CombatantRuntime] | None = None
    combatants: list[CombatantRuntime] | None = None
    active_turn: CombatTurnRuntime | None = None
    movement_state: dict[str, Any] | None = None
    last_attack_result: CombatEventSummary | None = None
    last_move_result: CombatEventSummary | None = None
    chat_meta: dict[str, Any] | None = None
