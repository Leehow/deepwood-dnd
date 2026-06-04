from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict

from app.schemas.token_runtime import CampaignTimePoint


class SpellRuntimeActionUI(BaseModel):
    model_config = ConfigDict(extra="allow")

    source: Literal["runtime", "legacy"] = "runtime"
    runtime_instance_id: int
    action_id: str
    spell_id: str
    spell_name: str
    slot_level: int | None = None
    action_type: str | None = None
    action_name: str
    action_name_en: str | None = None
    icon: str | None = None
    action_kind: str | None = None
    trigger_condition: str | None = None
    requires_target: bool = False
    description: str | None = None
    source_token_id: int | None = None
    available: bool = True


class SpellOverlayUI(BaseModel):
    model_config = ConfigDict(extra="allow")

    runtime_instance_id: int
    spell_id: str
    spell_name: str
    role: Literal["source", "target"]
    label: str
    icon: str | None = None
    color: str | None = None
    target_token_id: int | None = None
    target_name: str | None = None
    selected_option: str | None = None
    selected_option_label: str | None = None
    duration_rounds: int | None = None
    remaining_rounds: int | None = None
    expires_at: CampaignTimePoint | None = None
    status: str = "active"


class SpellBadgeUI(BaseModel):
    model_config = ConfigDict(extra="allow")

    runtime_instance_id: int
    spell_id: str
    label: str
    icon: str | None = None
    color: str | None = None
    duration_rounds: int | None = None
    remaining_rounds: int | None = None
    expires_at: CampaignTimePoint | None = None


class SpellVisualUI(BaseModel):
    model_config = ConfigDict(extra="allow")

    source: Literal["runtime", "legacy"] = "legacy"
    visual_id: str
    spell_id: str | None = None
    spell_name: str
    icon: str | None = None
    color: str | None = None
    source_token_id: int | None = None
    runtime_instance_id: int | None = None
    token_filter: dict[str, Any] | None = None
    expires_at: CampaignTimePoint | None = None
    duration_rounds: int | None = None
    remaining_rounds: int | None = None


class AttachedSpellRuntimeRef(BaseModel):
    model_config = ConfigDict(extra="allow")

    runtime_instance_id: int
    spell_id: str
    role: Literal["source", "target"]


class TokenSpellRuntimeProjection(BaseModel):
    model_config = ConfigDict(extra="allow")

    spell_overlays: list[SpellOverlayUI] = []
    spell_badges: list[SpellBadgeUI] = []
    spell_visuals: list[SpellVisualUI] = []
    granted_actions_ui: list[SpellRuntimeActionUI] = []
    attached_runtime_refs: list[AttachedSpellRuntimeRef] = []


class RuntimeBonusDamage(BaseModel):
    model_config = ConfigDict(extra="allow")

    runtime_instance_id: int
    spell_id: str
    spell_name: str
    damage: int
    damage_type: str | None = None
    formula: str | None = None
    breakdown: str | None = None
    roll: dict[str, Any] | None = None
