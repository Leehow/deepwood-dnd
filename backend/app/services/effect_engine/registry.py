"""
Default handler registration.

Called once on engine initialization to wire all built-in handlers.
"""
from __future__ import annotations

from app.services.effect_engine.engine import EffectEngine
from app.services.effect_engine.handlers.condition import ConditionHandler
from app.services.effect_engine.handlers.damage import DamageHandler
from app.services.effect_engine.handlers.disguise import DisguiseHandler
from app.services.effect_engine.handlers.dispel import DispelHandler
from app.services.effect_engine.handlers.generate_item import GenerateItemHandler
from app.services.effect_engine.handlers.heal import HealHandler
from app.services.effect_engine.handlers.illumination import IlluminationHandler
from app.services.effect_engine.handlers.illusion import IllusionHandler
from app.services.effect_engine.handlers.modifier import ModifierHandler
from app.services.effect_engine.handlers.movement import MovementModHandler, RestrictMovementHandler
from app.services.effect_engine.handlers.narrative import NarrativeHandler
from app.services.effect_engine.handlers.raw_effect import RawEffectHandler
from app.services.effect_engine.handlers.remove_condition import RemoveConditionHandler
from app.services.effect_engine.handlers.resize import ResizeTokenHandler
from app.services.effect_engine.handlers.summon import SpawnSummonHandler
from app.services.effect_engine.handlers.teleport import TeleportHandler
from app.services.effect_engine.handlers.temp_hp import TempHpHandler
from app.services.effect_engine.handlers.token_visual import TokenVisualHandler
from app.services.effect_engine.handlers.transformation import TransformationHandler
from app.services.effect_engine.handlers.zone_visual import ZoneVisualHandler
from app.services.effect_engine.handlers.forced_movement import ForcedMovementHandler
from app.services.effect_engine.handlers.wall import CreateWallHandler
from app.services.effect_engine.handlers.barrier import CreateBarrierHandler
from app.services.effect_engine.handlers.moving_aura import CreateMovingAuraHandler
from app.services.effect_engine.handlers.counter_spell import CounterSpellHandler
from app.services.effect_engine.handlers.sense import GrantSenseHandler
from app.services.effect_engine.handlers.utility import (
    PreventHealingHandler, StabilizeHandler, InstantKillHandler, ResurrectHandler,
    GrantActionHandler,
)
from app.services.effect_engine.handlers.stored_trigger import StoredTriggerHandler
from app.services.effect_engine.handlers.suppress_magic import SuppressMagicHandler


def register_all_handlers(engine: EffectEngine) -> None:
    """Register every built-in effect handler."""
    engine.register("deal_damage", DamageHandler())
    engine.register("heal", HealHandler())
    engine.register("apply_condition", ConditionHandler())
    engine.register("grant_temp_hp", TempHpHandler())
    engine.register("apply_effect", RawEffectHandler())
    engine.register("generate_item", GenerateItemHandler())
    engine.register("dispel_magic", DispelHandler())
    engine.register("narrative", NarrativeHandler())
    engine.register("remove_condition", RemoveConditionHandler())

    # Modifier verbs — one handler class per verb (each carries its own schema)
    for verb in (
        "modify_stat", "modify_roll",
        "grant_resistance", "grant_immunity",
        "grant_advantage", "grant_disadvantage",
    ):
        engine.register(verb, ModifierHandler(verb=verb))

    # UI / Visual effect verbs
    engine.register("resize_token", ResizeTokenHandler())
    engine.register("apply_token_filter", TokenVisualHandler(verb="apply_token_filter"))
    engine.register("set_visibility", TokenVisualHandler(verb="set_visibility"))
    engine.register("set_disguise", DisguiseHandler())
    engine.register("spawn_illusion", IllusionHandler())
    engine.register("create_zone_visual", ZoneVisualHandler())
    engine.register("apply_transformation", TransformationHandler())

    # Movement / Teleportation verbs
    engine.register("teleport", TeleportHandler())
    engine.register("modify_movement", MovementModHandler())
    engine.register("restrict_movement", RestrictMovementHandler())

    # Illumination / Summoning verbs
    engine.register("apply_illumination", IlluminationHandler())
    engine.register("spawn_summon", SpawnSummonHandler())

    # Forced movement / Walls / Barriers
    engine.register("forced_movement", ForcedMovementHandler())
    engine.register("create_wall", CreateWallHandler())
    engine.register("create_barrier", CreateBarrierHandler())
    engine.register("create_moving_aura", CreateMovingAuraHandler())

    # Counter / Sense
    engine.register("counter_spell", CounterSpellHandler())
    engine.register("grant_sense", GrantSenseHandler())

    # Utility verbs
    engine.register("prevent_healing", PreventHealingHandler())
    engine.register("stabilize", StabilizeHandler())
    engine.register("instant_kill", InstantKillHandler())
    engine.register("resurrect", ResurrectHandler())
    engine.register("grant_action", GrantActionHandler())

    # Trigger / Suppress
    engine.register("stored_trigger", StoredTriggerHandler())
    engine.register("suppress_magic", SuppressMagicHandler())
