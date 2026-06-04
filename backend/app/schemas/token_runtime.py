from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class RuntimeSchemaBase(BaseModel):
    model_config = ConfigDict(extra="allow")


class CampaignTimePoint(RuntimeSchemaBase):
    day: int | None = None
    hour: int | None = None
    minute: int | None = None
    second: int | None = None


class OngoingSave(RuntimeSchemaBase):
    timing: str | None = None
    save_type: str | None = None
    dc: int | None = None


class EscapeAction(RuntimeSchemaBase):
    type: str | None = None
    ability: str | None = None
    dc: int | None = None


class ActiveEffectRuntime(RuntimeSchemaBase):
    id: str | None = None
    name: str | None = None
    icon: str | None = None
    color: str | None = None
    source: str | None = None
    spell_id: str | None = None
    spell_buff: bool | None = None
    is_concentration: bool | None = None
    duration: int | float | None = None
    expires_at: CampaignTimePoint | None = None
    condition: str | None = None
    source_token_id: int | None = None
    uses_remaining: int | None = None
    armed: bool | None = None
    ongoing_save: OngoingSave | None = None
    escape_action: EscapeAction | None = None
    break_conditions: list[str] | None = None
    spell_save_dc: int | None = None
    buff_effects: dict[str, Any] | None = None
    token_filter: dict[str, Any] | None = Field(default=None, alias="tokenFilter")
    description: str | None = None
    aura: dict[str, Any] | None = None
    aura_emitter: bool | None = None
    aura_status: bool | None = None
    aura_applied: bool | None = None


class ActiveAuraRuntime(RuntimeSchemaBase):
    id: str | None = None
    name: str | None = None
    description: str | None = None
    radius: int | float | None = None
    icon: str | None = None
    color: str | None = None
    fill_color: str | None = None
    source_cha_mod: int | None = None
    source_effect_id: str | None = None
    affects_self: bool | None = None
    affects_allies: bool | None = None
    affects_enemies: bool | None = None
    requires_conscious: bool | None = None
    applies_conditions: list[str] | None = None
    enabled: bool | None = None


class TransformationSource(RuntimeSchemaBase):
    config_id: str | None = None
    source_type: str | None = None
    spell_id: str | None = None
    spell_name: str | None = None


class TransformationForm(RuntimeSchemaBase):
    creature_id: str | int | None = None
    creature_name: str | None = None
    current_hp: int | None = None
    max_hp: int | None = None
    ac: int | None = None
    size: str | None = None
    speed: Any = None
    ability_scores: dict[str, Any] | None = None
    actions: list[dict[str, Any]] | None = None


class TransformationDataRuntime(RuntimeSchemaBase):
    source: TransformationSource | None = None
    type: str | None = None
    form: TransformationForm | None = None
    modifiers: list[dict[str, Any]] | None = None
    form_overrides: dict[str, Any] | None = Field(default=None, alias="formOverrides")
    retained_stats: dict[str, Any] | None = Field(default=None, alias="retainedStats")
    started_at: str | None = None
    current_hp: int | None = None
    beast_name: str | None = None
    beast_name_en: str | None = None
    active_mode: str | None = Field(default=None, alias="activeMode")
    original_size: str | None = None
    spell_save_dc: int | None = None


class AreaEffectRuntime(RuntimeSchemaBase):
    shape: str | None = None
    center_x: int | float | None = None
    center_y: int | float | None = None
    origin_x: int | float | None = None
    origin_y: int | float | None = None
    direction: int | float | None = None
    radius: int | float | None = None
    color: str | None = None
    map_url: str | None = None
    illusion_token_id: int | None = None
    player_movable: bool | None = Field(default=None, alias="playerMovable")
    follow_caster: bool | None = Field(default=None, alias="followCaster")


class ConcentrationSpellRuntime(RuntimeSchemaBase):
    spell_id: str | None = None
    spell_name: str | None = None
    slot_level: int | None = None
    duration_rounds: int | None = None
    current_round: int | None = None
    affected_token_ids: list[int] | None = None
    linked_token_ids: list[int] | None = None
    con_save_bonus: int | None = None
    has_advantage: bool | None = None
    extra_bonus_source: str | None = None
    area_effect: AreaEffectRuntime | None = None
    target_name: str | None = None
    selected_option: str | None = None
    illumination: dict[str, Any] | None = None
    malleable: bool | None = None


class CastingTimeRuntime(RuntimeSchemaBase):
    value: int | float | None = None
    unit: str | None = None


class CastingInProgressRuntime(RuntimeSchemaBase):
    spell_id: str | None = None
    spell_name: str | None = None
    slot_level: int | None = None
    cast_mode: Literal["normal", "ritual"] | str | None = None
    base_casting_time: CastingTimeRuntime | None = None
    total_cast_seconds: int | None = None
    started_at_campaign: CampaignTimePoint | None = None
    finish_at_campaign: CampaignTimePoint | None = None
    target_token_ids: list[int] | None = None
    selected_option: str | None = None
    material_id: str | None = None
    requires_concentration_during_cast: bool | None = None
    breaks_existing_concentration: bool | None = None
    started_by_user_id: str | None = None
    freecast: bool | None = None
    status: str | None = None
    area_effect: AreaEffectRuntime | None = None


class DisguiseDataRuntime(RuntimeSchemaBase):
    spell_id: str | None = None
    spell_name: str | None = None
    disguise_avatar: str | None = None
    description: str | None = None
    caster_character_id: int | None = None
    caster_name: str | None = None
    started_at: str | None = None


class DeathSavesRuntime(RuntimeSchemaBase):
    successes: int = 0
    failures: int = 0
    stabilized: bool = False
