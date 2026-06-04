from __future__ import annotations

from typing import Any, Iterable

from app.services.websocket_manager import manager

_UNSET = object()


def _payload_with_optional(**values: Any) -> dict[str, Any]:
    return {key: value for key, value in values.items() if value is not _UNSET}


class RealtimePublisher:
    async def publish_token_hp_updated(
        self,
        campaign_id: int | str,
        *,
        token_id: int,
        current_hp: Any,
        max_hp: Any = _UNSET,
        temp_hp: Any = _UNSET,
        active_effects: Any = _UNSET,
        character_id: Any = _UNSET,
        monster_instance_id: Any = _UNSET,
        transformation_data: Any = _UNSET,
        hp_change: Any = _UNSET,
        target_defeated: Any = _UNSET,
        character_status_effects: Any = _UNSET,
        monster_status_effects: Any = _UNSET,
    ) -> None:
        payload = _payload_with_optional(
            token_id=token_id,
            current_hp=current_hp,
            max_hp=max_hp,
            temp_hp=temp_hp,
            active_effects=active_effects,
            character_id=character_id,
            monster_instance_id=monster_instance_id,
            transformation_data=transformation_data,
            hp_change=hp_change,
            target_defeated=target_defeated,
            character_status_effects=character_status_effects,
            monster_status_effects=monster_status_effects,
        )
        await manager.broadcast_to_campaign(
            {
                "type": "token_hp_update",
                "data": payload,
                **payload,
            },
            str(campaign_id),
        )

    async def publish_token_active_effects_updated(
        self,
        campaign_id: int | str,
        *,
        token_id: int,
        active_effects: Any,
        character_id: Any = _UNSET,
        monster_instance_id: Any = _UNSET,
        character_status_effects: Any = _UNSET,
        monster_status_effects: Any = _UNSET,
    ) -> None:
        payload = _payload_with_optional(
            token_id=token_id,
            active_effects=active_effects,
            character_id=character_id,
            monster_instance_id=monster_instance_id,
            character_status_effects=character_status_effects,
            monster_status_effects=monster_status_effects,
        )
        await manager.broadcast_to_campaign(
            {
                "type": "token_active_effects_update",
                "data": payload,
                **payload,
            },
            str(campaign_id),
        )

    async def publish_token_effects_updated(
        self,
        campaign_id: int | str,
        *,
        token_id: int,
        active_effects: Any,
        reason: str,
        character_id: Any = _UNSET,
        monster_instance_id: Any = _UNSET,
        character_status_effects: Any = _UNSET,
        monster_status_effects: Any = _UNSET,
    ) -> None:
        payload = _payload_with_optional(
            token_id=token_id,
            active_effects=active_effects,
            reason=reason,
            character_id=character_id,
            monster_instance_id=monster_instance_id,
            character_status_effects=character_status_effects,
            monster_status_effects=monster_status_effects,
        )
        await manager.broadcast_to_campaign(
            {
                "type": "token_effects_update",
                "data": payload,
                **payload,
            },
            str(campaign_id),
        )

    async def publish_character_updated(
        self,
        campaign_id: int | str,
        *,
        data: dict[str, Any],
        recipients: Iterable[str] | None = None,
    ) -> None:
        message = {
            "type": "character_updated",
            "data": data,
        }
        if recipients:
            await manager.send_to_users(message, str(campaign_id), list(recipients))
            return
        await manager.broadcast_to_campaign(message, str(campaign_id))

    async def publish_character_created(
        self,
        campaign_id: int | str,
        *,
        character_id: int,
        character_name: str,
        user_id: str,
        level: int,
        class_id: str,
    ) -> None:
        await manager.broadcast_to_campaign(
            {
                "type": "character_created",
                "character_id": character_id,
                "character_name": character_name,
                "user_id": user_id,
                "level": level,
                "class_id": class_id,
            },
            str(campaign_id),
        )

    async def publish_character_selected(
        self,
        campaign_id: int | str,
        *,
        user_id: str,
        character_id: int,
        character_name: str,
    ) -> None:
        payload = {
            "user_id": user_id,
            "character_id": character_id,
            "character_name": character_name,
        }
        await manager.broadcast_to_campaign(
            {
                "type": "character_selected",
                "data": payload,
                **payload,
            },
            str(campaign_id),
        )

    async def publish_generation_progress(
        self,
        campaign_id: int | str,
        *,
        event_type: str,
        stage: int,
        total_stages: int,
        stage_name: str,
        detail: str = "",
    ) -> None:
        await manager.broadcast_to_campaign(
            {
                "type": event_type,
                "stage": stage,
                "total_stages": total_stages,
                "stage_name": stage_name,
                "detail": detail,
            },
            str(campaign_id),
        )

    async def publish_virtual_player_event(
        self,
        campaign_id: int | str,
        *,
        event_type: str,
        data: dict[str, Any],
    ) -> None:
        await manager.broadcast_to_campaign(
            {
                "type": event_type,
                "data": data,
                **data,
            },
            str(campaign_id),
        )

    async def publish_avatar_generated(
        self,
        campaign_id: int | str,
        *,
        entity_type: str,
        entity_id: int,
        avatar_url: str,
        has_avatar: bool,
        name: str,
    ) -> None:
        payload = {
            "entity_type": entity_type,
            "entity_id": entity_id,
            "avatar_url": avatar_url,
            "has_avatar": has_avatar,
            "name": name,
        }
        await manager.broadcast_to_campaign(
            {
                "type": "avatar_generated",
                "data": payload,
                **payload,
            },
            str(campaign_id),
        )

    async def publish_npc_created(
        self,
        campaign_id: int | str,
        *,
        monster_instance_id: int,
        name: str,
    ) -> None:
        payload = {"monster_instance_id": monster_instance_id, "name": name}
        await manager.broadcast_to_campaign(
            {
                "type": "npc_created",
                "data": payload,
                **payload,
            },
            str(campaign_id),
        )

    async def publish_user_presence(
        self,
        campaign_id: int | str,
        *,
        event_type: str,
        user_id: str,
        role: str,
    ) -> None:
        payload = {"user_id": user_id, "role": role}
        await manager.broadcast_to_campaign(
            {
                "type": event_type,
                "data": payload,
                **payload,
            },
            str(campaign_id),
        )

    async def publish_tts_broadcast(
        self,
        campaign_id: int | str,
        *,
        message: dict[str, Any],
    ) -> None:
        await manager.broadcast_to_campaign(message, str(campaign_id))

    async def publish_tts_generating(
        self,
        campaign_id: int | str,
        *,
        message_id: int,
    ) -> None:
        await manager.broadcast_to_campaign(
            {
                "type": "tts_generating",
                "data": {"message_id": message_id},
            },
            str(campaign_id),
        )

    async def publish_tts_ready(
        self,
        campaign_id: int | str,
        *,
        message_id: int,
        audio_url: str,
        format: str,
    ) -> None:
        await manager.broadcast_to_campaign(
            {
                "type": "tts_ready",
                "data": {
                    "message_id": message_id,
                    "audio_url": audio_url,
                    "format": format,
                },
            },
            str(campaign_id),
        )

    async def publish_character_status_effects_updated(
        self,
        campaign_id: int | str,
        *,
        character_id: int,
        status_effects: Any,
    ) -> None:
        await manager.broadcast_to_campaign(
            {
                "type": "character_status_effects_update",
                "character_id": character_id,
                "status_effects": status_effects,
            },
            str(campaign_id),
        )

    async def publish_character_experience_updated(
        self,
        campaign_id: int | str,
        *,
        character_id: int,
        experience_points: Any,
    ) -> None:
        await manager.broadcast_to_campaign(
            {
                "type": "character_xp_update",
                "character_id": character_id,
                "experience_points": experience_points,
            },
            str(campaign_id),
        )

    async def publish_character_feature_uses_updated(
        self,
        campaign_id: int | str,
        *,
        character_id: int,
        feature_id: str,
        current_uses: int,
        max_uses: int,
    ) -> None:
        await manager.broadcast_to_campaign(
            {
                "type": "character_feature_uses_updated",
                "character_id": character_id,
                "feature_id": feature_id,
                "current_uses": current_uses,
                "max_uses": max_uses,
            },
            str(campaign_id),
        )

    async def publish_character_avatar_updated(
        self,
        campaign_id: int | str,
        *,
        character_id: int,
        avatar: str,
        avatar_large: str,
    ) -> None:
        await manager.broadcast_to_campaign(
            {
                "type": "character_avatar_updated",
                "character_id": character_id,
                "avatar": avatar,
                "avatar_large": avatar_large,
            },
            str(campaign_id),
        )

    async def publish_character_level_event(
        self,
        campaign_id: int | str,
        *,
        event_type: str,
        data: dict[str, Any],
    ) -> None:
        await manager.broadcast_to_campaign(
            {
                "type": event_type,
                "campaign_id": str(campaign_id),
                "data": data,
            },
            str(campaign_id),
        )

    async def publish_spell_slots_updated(
        self,
        campaign_id: int | str,
        *,
        character_id: int,
        spell_slots_state: Any,
        event_type: str = "spell_slots_update",
    ) -> None:
        await manager.broadcast_to_campaign(
            {
                "type": event_type,
                "character_id": character_id,
                "spell_slots_state": spell_slots_state,
            },
            str(campaign_id),
        )

    async def publish_resource_updated(
        self,
        campaign_id: int | str,
        *,
        character_id: int,
        resource_id: str,
        current: int,
        max: int,
    ) -> None:
        await manager.broadcast_to_campaign(
            {
                "type": "resource_update",
                "character_id": character_id,
                "resource_id": resource_id,
                "current": current,
                "max": max,
            },
            str(campaign_id),
        )

    async def publish_resource_use(
        self,
        campaign_id: int | str,
        *,
        data: dict[str, Any],
    ) -> None:
        await manager.broadcast_to_campaign(
            {
                "type": "resource_use",
                "data": data,
            },
            str(campaign_id),
        )

    async def publish_spell_preparation_updated(
        self,
        campaign_id: int | str,
        *,
        character_id: int,
        prepared_spells: list[str],
        prepared_count: int,
        max_prepared: int,
    ) -> None:
        await manager.broadcast_to_campaign(
            {
                "type": "spell_preparation_update",
                "character_id": character_id,
                "prepared_spells": prepared_spells,
                "prepared_count": prepared_count,
                "max_prepared": max_prepared,
            },
            str(campaign_id),
        )

    async def publish_trade_updated(
        self,
        campaign_id: int | str,
        *,
        data: dict[str, Any],
        recipients: Iterable[str] | None = None,
    ) -> None:
        message = {
            "type": "trade_update",
            "data": data,
        }
        if recipients:
            await manager.send_to_users(message, str(campaign_id), list(recipients))
            return
        await manager.broadcast_to_campaign(message, str(campaign_id))

    async def publish_kicked(
        self,
        campaign_id: int | str,
        *,
        recipients: Iterable[str],
        message: str,
    ) -> None:
        await manager.send_to_users(
            {
                "type": "kicked",
                "data": {
                    "campaign_id": str(campaign_id),
                    "message": message,
                },
            },
            str(campaign_id),
            list(recipients),
        )

    async def publish_combat_storage_updated(
        self,
        campaign_id: int | str,
        *,
        event_type: str,
        storage_object: dict[str, Any] | None = None,
        object_type: str | None = None,
        object_id: str | int | None = None,
    ) -> None:
        await self.publish_storage_event(
            campaign_id,
            event_type=event_type,
            storage_object=storage_object,
            object_type=object_type,
            object_id=object_id,
        )

    async def publish_storage_event(
        self,
        campaign_id: int | str,
        *,
        event_type: str,
        storage_object: dict[str, Any] | None = None,
        object_type: str | None = None,
        object_id: str | int | None = None,
    ) -> None:
        if event_type != "storage_deleted":
            await manager.broadcast_to_campaign(
                {
                    "type": event_type,
                    "data": {"object": storage_object},
                    "object": storage_object,
                },
                str(campaign_id),
            )
            return

        await manager.broadcast_to_campaign(
            {
                "type": event_type,
                "data": _payload_with_optional(object_type=object_type, object_id=object_id),
                **_payload_with_optional(object_type=object_type, object_id=object_id),
            },
            str(campaign_id),
        )

    async def publish_map_token_removed(
        self,
        campaign_id: int | str,
        *,
        token_id: int,
    ) -> None:
        await manager.broadcast_to_campaign(
            {
                "type": "token_removed",
                "data": {"token_id": token_id},
                "token_id": token_id,
            },
            str(campaign_id),
        )

    async def publish_token_placed(
        self,
        campaign_id: int | str,
        *,
        token: dict[str, Any],
    ) -> None:
        await manager.broadcast_to_campaign(
            {
                "type": "token_placed",
                "data": {"token": token},
                "token": token,
            },
            str(campaign_id),
        )

    async def publish_token_moved(
        self,
        campaign_id: int | str,
        *,
        token_id: int,
        position_x: Any,
        position_y: Any,
    ) -> None:
        await manager.broadcast_to_campaign(
            {
                "type": "token_move",
                "token_id": token_id,
                "position": {
                    "x": position_x,
                    "y": position_y,
                },
            },
            str(campaign_id),
        )

    async def publish_token_size_updated(
        self,
        campaign_id: int | str,
        *,
        token_id: int,
        token_size: Any,
    ) -> None:
        await manager.broadcast_to_campaign(
            {
                "type": "token_size_update",
                "token_id": token_id,
                "token_size": token_size,
            },
            str(campaign_id),
        )

    async def publish_transformation_updated(
        self,
        campaign_id: int | str,
        *,
        token_id: int,
        transformation_data: Any,
        token_size: Any = _UNSET,
        active_effects: Any = _UNSET,
        reason: Any = _UNSET,
    ) -> None:
        await manager.broadcast_to_campaign(
            _payload_with_optional(
                type="transformation_update",
                token_id=token_id,
                transformation_data=transformation_data,
                token_size=token_size,
                active_effects=active_effects,
                reason=reason,
            ),
            str(campaign_id),
        )

    async def publish_concentration_check_result(
        self,
        campaign_id: int | str,
        *,
        data: dict[str, Any],
    ) -> None:
        await manager.broadcast_to_campaign(
            {
                "type": "concentration_check_result",
                **data,
            },
            str(campaign_id),
        )

    async def publish_chat_message(
        self,
        campaign_id: int | str,
        *,
        chat_id: int,
        user_id: str,
        role: str,
        message: str,
        message_type: str,
        recipients: list[str],
        is_private: bool,
        meta: dict[str, Any] | None,
        timestamp: int,
    ) -> None:
        await manager.broadcast_to_campaign(
            {
                "type": "chat",
                "id": chat_id,
                "user_id": user_id,
                "role": role,
                "message": message,
                "message_type": message_type,
                "recipients": recipients,
                "is_private": is_private,
                "meta": meta,
                "timestamp": timestamp,
            },
            str(campaign_id),
        )

    async def publish_consumable_use(
        self,
        campaign_id: int | str,
        *,
        data: dict[str, Any],
    ) -> None:
        await manager.broadcast_to_campaign(
            {
                "type": "consumable_use",
                "data": data,
            },
            str(campaign_id),
        )

    async def publish_chat_edit(
        self,
        campaign_id: int | str,
        *,
        message_id: int,
        content: str,
        timestamp: int,
    ) -> None:
        payload = {
            "id": message_id,
            "content": content,
            "timestamp": timestamp,
        }
        await manager.broadcast_to_campaign(
            {
                "type": "chat_edit",
                "data": payload,
                **payload,
            },
            str(campaign_id),
        )

    async def publish_chat_delete(
        self,
        campaign_id: int | str,
        *,
        message_id: int,
        timestamp: int,
    ) -> None:
        payload = {
            "id": message_id,
            "timestamp": timestamp,
        }
        await manager.broadcast_to_campaign(
            {
                "type": "chat_delete",
                "data": payload,
                **payload,
            },
            str(campaign_id),
        )

    async def publish_chat_clear(
        self,
        campaign_id: int | str,
        *,
        preserve_ai: bool,
        timestamp: int,
    ) -> None:
        payload = {
            "preserve_ai": preserve_ai,
            "timestamp": timestamp,
        }
        await manager.broadcast_to_campaign(
            {
                "type": "chat_clear",
                "data": payload,
                **payload,
            },
            str(campaign_id),
        )

    async def publish_character_equipment_updated(
        self,
        campaign_id: int | str,
        *,
        character_id: int,
        equipment: list[Any],
        currency: Any = _UNSET,
        reason: Any = _UNSET,
    ) -> None:
        payload = _payload_with_optional(
            character_id=character_id,
            equipment=equipment,
            currency=currency,
            reason=reason,
        )
        await manager.broadcast_to_campaign(
            {
                "type": "character_equipment_updated",
                "data": payload,
                **payload,
            },
            str(campaign_id),
        )

    async def publish_spell_cast_result(
        self,
        campaign_id: int | str,
        *,
        data: dict[str, Any],
    ) -> None:
        await manager.broadcast_to_campaign(
            {
                "type": "spell_cast_result",
                "data": data,
            },
            str(campaign_id),
        )

    async def publish_token_casting_updated(
        self,
        campaign_id: int | str,
        *,
        token_id: int,
        casting_in_progress: Any,
        reason: Any = _UNSET,
    ) -> None:
        payload = _payload_with_optional(
            token_id=token_id,
            casting_in_progress=casting_in_progress,
            reason=reason,
        )
        await manager.broadcast_to_campaign(
            {
                "type": "token_casting_update",
                "data": payload,
                **payload,
            },
            str(campaign_id),
        )

    async def publish_token_casting_interrupted(
        self,
        campaign_id: int | str,
        *,
        token_id: int,
        casting_in_progress: Any,
        broken_cast: dict[str, Any],
        reason: str,
    ) -> None:
        payload = {
            "token_id": token_id,
            "casting_in_progress": casting_in_progress,
            "broken_cast": broken_cast,
            "reason": reason,
        }
        await manager.broadcast_to_campaign(
            {
                "type": "token_casting_interrupted",
                "data": payload,
                **payload,
            },
            str(campaign_id),
        )

    async def publish_token_casting_completed(
        self,
        campaign_id: int | str,
        *,
        token_id: int,
        spell_id: str,
        spell_name: str,
        result: dict[str, Any],
    ) -> None:
        payload = {
            "token_id": token_id,
            "spell_id": spell_id,
            "spell_name": spell_name,
            "result": result,
        }
        await manager.broadcast_to_campaign(
            {
                "type": "token_casting_completed",
                "data": payload,
                **payload,
            },
            str(campaign_id),
        )

    async def publish_combat_narrative_updated(
        self,
        campaign_id: int | str,
        *,
        chat_message_id: int,
        narrative: str,
        content: str,
    ) -> None:
        await manager.broadcast_to_campaign(
            {
                "type": "combat_narrative_update",
                "chat_message_id": chat_message_id,
                "narrative": narrative,
                "content": content,
            },
            str(campaign_id),
        )

    async def publish_token_concentration_updated(
        self,
        campaign_id: int | str,
        *,
        token_id: int,
        concentration_spell: Any,
        reason: Any = _UNSET,
        broken_spell: Any = _UNSET,
        active_effects: Any = _UNSET,
        temp_hp: Any = _UNSET,
        effects_removed_from: Any = _UNSET,
        replaced_spell: Any = _UNSET,
    ) -> None:
        await manager.broadcast_to_campaign(
            _payload_with_optional(
                type="token_concentration_update",
                token_id=token_id,
                concentration_spell=concentration_spell,
                reason=reason,
                broken_spell=broken_spell,
                active_effects=active_effects,
                temp_hp=temp_hp,
                effects_removed_from=effects_removed_from,
                replaced_spell=replaced_spell,
            ),
            str(campaign_id),
        )

    async def publish_token_disguise_updated(
        self,
        campaign_id: int | str,
        *,
        token_id: int,
        disguise_data: Any,
        active_effects: Any = _UNSET,
    ) -> None:
        await manager.broadcast_to_campaign(
            _payload_with_optional(
                type="token_disguise_update",
                token_id=token_id,
                disguise_data=disguise_data,
                active_effects=active_effects,
            ),
            str(campaign_id),
        )

    async def publish_token_updated(
        self,
        campaign_id: int | str,
        *,
        token: dict[str, Any],
    ) -> None:
        await manager.broadcast_to_campaign(
            {
                "type": "token_update",
                "token": token,
            },
            str(campaign_id),
        )

    async def publish_combat_attack_result(
        self,
        campaign_id: int | str,
        *,
        attacker_token_id: int,
        target_token_id: int,
        target_monster_instance_id: int | None,
        xp_value: int,
        result: dict[str, Any],
        auto_apply: bool,
        message: str,
    ) -> None:
        await manager.broadcast_to_campaign(
            {
                "type": "combat_attack_result",
                "data": {
                    "attacker_token_id": attacker_token_id,
                    "target_token_id": target_token_id,
                    "target_monster_instance_id": target_monster_instance_id,
                    "xp_value": xp_value,
                    "result": result,
                    "auto_apply": auto_apply,
                    "message": message,
                },
            },
            str(campaign_id),
        )

    async def publish_combat_reaction_used(
        self,
        campaign_id: int | str,
        *,
        reactor_token_id: int,
        reaction_id: str,
    ) -> None:
        payload = {
            "reactor_token_id": reactor_token_id,
            "reaction_id": reaction_id,
        }
        await manager.broadcast_to_campaign(
            {
                "type": "combat_reaction_used",
                "data": payload,
                **payload,
            },
            str(campaign_id),
        )

    async def publish_death_save_updated(
        self,
        campaign_id: int | str,
        *,
        token_id: int,
        roll: int,
        death_saves: Any,
        revived: bool,
        dead: bool,
        message: str,
    ) -> None:
        payload = {
            "token_id": token_id,
            "roll": roll,
            "death_saves": death_saves,
            "revived": revived,
            "dead": dead,
            "message": message,
        }
        await manager.broadcast_to_campaign(
            {
                "type": "death_save_update",
                "data": payload,
                **payload,
            },
            str(campaign_id),
        )

    async def publish_combat_spell_result(
        self,
        campaign_id: int | str,
        *,
        caster_token_id: int,
        target_token_id: int,
        spell_id: str,
        result: dict[str, Any],
        auto_apply: bool,
    ) -> None:
        await manager.broadcast_to_campaign(
            {
                "type": "combat_spell_result",
                "data": {
                    "caster_token_id": caster_token_id,
                    "target_token_id": target_token_id,
                    "spell_id": spell_id,
                    "result": result,
                    "auto_apply": auto_apply,
                },
            },
            str(campaign_id),
        )

    async def publish_area_spell_result(
        self,
        campaign_id: int | str,
        *,
        event_type: str,
        data: dict[str, Any],
    ) -> None:
        await manager.broadcast_to_campaign(
            {
                "type": event_type,
                "data": data,
            },
            str(campaign_id),
        )

    async def publish_spell_result(
        self,
        campaign_id: int | str,
        *,
        data: dict[str, Any],
    ) -> None:
        await manager.broadcast_to_campaign(
            {
                "type": "spell_result",
                "data": data,
            },
            str(campaign_id),
        )

    async def publish_token_effect_added(
        self,
        campaign_id: int | str,
        *,
        token_id: int,
        effect: dict[str, Any],
        target_name: str,
        spell_name: str,
    ) -> None:
        payload = {
            "token_id": token_id,
            "effect": effect,
            "target_name": target_name,
            "spell_name": spell_name,
        }
        await manager.broadcast_to_campaign(
            {
                "type": "token_effect_added",
                "data": payload,
                **payload,
            },
            str(campaign_id),
        )

    async def publish_shop_transaction(
        self,
        campaign_id: int | str,
        *,
        subtype: str,
        shop_id: int,
        inventory: dict[str, Any],
        character_id: int,
        character_currency: dict[str, Any],
    ) -> None:
        await manager.broadcast_to_campaign(
            {
                "type": "shop_transaction",
                "data": {
                    "subtype": subtype,
                    "campaign_id": campaign_id,
                    "shop_id": shop_id,
                    "inventory": inventory,
                    "character_id": character_id,
                    "character_currency": character_currency,
                },
            },
            str(campaign_id),
        )

    async def publish_effect_expired(
        self,
        campaign_id: int | str,
        *,
        token_id: int,
        effect_name: str,
    ) -> None:
        await manager.broadcast_to_campaign(
            {
                "type": "effect_expired",
                "data": {
                    "token_id": token_id,
                    "effect_name": effect_name,
                },
            },
            str(campaign_id),
        )

    async def publish_loot_bag_created(
        self,
        campaign_id: int | str,
        *,
        token: dict[str, Any],
        source_name: str,
    ) -> None:
        await manager.broadcast_to_campaign(
            {
                "type": "loot_bag_created",
                "token": token,
                "source_name": source_name,
            },
            str(campaign_id),
        )

    async def publish_loot_bag_looted(
        self,
        campaign_id: int | str,
        *,
        token_id: int,
        character_id: int,
        character_name: str,
        items_taken: list[Any],
        currency_taken: dict[str, Any],
        bag_empty: bool,
    ) -> None:
        await manager.broadcast_to_campaign(
            {
                "type": "loot_bag_looted",
                "token_id": token_id,
                "character_id": character_id,
                "character_name": character_name,
                "items_taken": items_taken,
                "currency_taken": currency_taken,
                "bag_empty": bag_empty,
            },
            str(campaign_id),
        )

    async def publish_loot_bag_removed(
        self,
        campaign_id: int | str,
        *,
        token_id: int,
    ) -> None:
        await manager.broadcast_to_campaign(
            {
                "type": "loot_bag_removed",
                "token_id": token_id,
            },
            str(campaign_id),
        )

    async def publish_token_auras_updated(
        self,
        campaign_id: int | str,
        *,
        token_id: int,
        active_auras: Any,
        aura_id: str,
        enabled: bool,
    ) -> None:
        await manager.broadcast_to_campaign(
            {
                "type": "token_auras_update",
                "token_id": token_id,
                "active_auras": active_auras,
                "aura_id": aura_id,
                "enabled": enabled,
            },
            str(campaign_id),
        )

    async def publish_token_faction_updated(
        self,
        campaign_id: int | str,
        *,
        token_id: int,
        faction: str,
    ) -> None:
        await manager.broadcast_to_campaign(
            {
                "type": "token_faction_update",
                "token_id": token_id,
                "faction": faction,
            },
            str(campaign_id),
        )

    async def publish_spell_slot_consumed(
        self,
        campaign_id: int | str,
        *,
        character_id: int,
        slot_level: int,
        use_pact_slot: bool,
        new_spell_slots_state: Any,
    ) -> None:
        await manager.broadcast_to_campaign(
            {
                "type": "spell_slot_consumed",
                "character_id": character_id,
                "slot_level": slot_level,
                "use_pact_slot": use_pact_slot,
                "new_spell_slots_state": new_spell_slots_state,
            },
            str(campaign_id),
        )

    async def publish_storage_acl_updated(
        self,
        campaign_id: int | str,
        *,
        object_type: str,
        object_id: str | int,
        users: list[str],
    ) -> None:
        await manager.broadcast_to_campaign(
            {
                "type": "storage_acl_updated",
                "object_type": object_type,
                "object_id": object_id,
                "users": users,
            },
            str(campaign_id),
        )

    async def publish_marker_created(
        self,
        campaign_id: int | str,
        *,
        marker: dict[str, Any],
    ) -> None:
        await manager.broadcast_to_campaign(
            {
                "type": "marker_created",
                "marker": marker,
            },
            str(campaign_id),
        )

    async def publish_marker_updated(
        self,
        campaign_id: int | str,
        *,
        marker: dict[str, Any],
    ) -> None:
        await manager.broadcast_to_campaign(
            {
                "type": "marker_updated",
                "marker": marker,
            },
            str(campaign_id),
        )

    async def publish_marker_deleted(
        self,
        campaign_id: int | str,
        *,
        marker_id: int,
        map_url: str,
    ) -> None:
        await manager.broadcast_to_campaign(
            {
                "type": "marker_deleted",
                "marker_id": marker_id,
                "map_url": map_url,
            },
            str(campaign_id),
        )

    async def publish_shop_avatar_updated(
        self,
        campaign_id: int | str,
        *,
        shop_id: int,
        avatar_url: str,
        avatar_url_large: str | None,
    ) -> None:
        payload = {
            "shop_id": shop_id,
            "avatar_url": avatar_url,
            "avatar_url_large": avatar_url_large,
        }
        await manager.broadcast_to_campaign(
            {
                "type": "shop_avatar_updated",
                "data": payload,
                **payload,
            },
            str(campaign_id),
        )

    async def publish_item_avatar_updated(
        self,
        campaign_id: int | str,
        *,
        item_id: int,
        avatar_url: str,
        avatar_url_large: str | None,
    ) -> None:
        payload = {
            "item_id": item_id,
            "avatar_url": avatar_url,
            "avatar_url_large": avatar_url_large,
        }
        await manager.broadcast_to_campaign(
            {
                "type": "item_avatar_updated",
                "data": payload,
                **payload,
            },
            str(campaign_id),
        )

    async def publish_npc_avatar_updated(
        self,
        campaign_id: int | str,
        *,
        monster_instance_id: int,
        avatar_url: str,
        avatar_url_large: str | None,
    ) -> None:
        payload = {
            "monster_instance_id": monster_instance_id,
            "avatar_url": avatar_url,
            "avatar_url_large": avatar_url_large,
        }
        await manager.broadcast_to_campaign(
            {
                "type": "npc_avatar_updated",
                "data": payload,
                **payload,
            },
            str(campaign_id),
        )

    async def publish_shop_created(
        self,
        campaign_id: int | str,
        *,
        shop_id: int,
        name: str,
        item_count: Any = _UNSET,
        token_id: Any = _UNSET,
    ) -> None:
        payload = _payload_with_optional(
            shop_id=shop_id,
            name=name,
            item_count=item_count,
            token_id=token_id,
        )
        await manager.broadcast_to_campaign(
            {
                "type": "shop_created",
                "data": payload,
                **payload,
            },
            str(campaign_id),
        )

    async def publish_monster_added(
        self,
        campaign_id: int | str,
        *,
        monster_instance_id: int,
        name: str,
    ) -> None:
        payload = {"monster_instance_id": monster_instance_id, "name": name}
        await manager.broadcast_to_campaign(
            {
                "type": "monster_added",
                "data": payload,
                **payload,
            },
            str(campaign_id),
        )

    async def publish_item_created(
        self,
        campaign_id: int | str,
        *,
        item_id: int,
        name: str,
    ) -> None:
        payload = {"item_id": item_id, "name": name}
        await manager.broadcast_to_campaign(
            {
                "type": "item_created",
                "data": payload,
                **payload,
            },
            str(campaign_id),
        )

    async def publish_chest_created(
        self,
        campaign_id: int | str,
        *,
        chest_id: int,
        name: str,
    ) -> None:
        payload = {"chest_id": chest_id, "name": name}
        await manager.broadcast_to_campaign(
            {
                "type": "chest_created",
                "data": payload,
                **payload,
            },
            str(campaign_id),
        )

    async def publish_chest_avatar_updated(
        self,
        campaign_id: int | str,
        *,
        chest_id: int,
        avatar_url: str,
    ) -> None:
        payload = {"chest_id": chest_id, "avatar_url": avatar_url}
        await manager.broadcast_to_campaign(
            {
                "type": "chest_avatar_updated",
                "data": payload,
                **payload,
            },
            str(campaign_id),
        )

    async def publish_scene_created(
        self,
        campaign_id: int | str,
        *,
        npc_count: int,
        shop_count: int,
        token_count: int,
        npc_ids: list[int],
        shop_ids: list[int],
        token_ids: list[int],
    ) -> None:
        payload = {
            "npc_count": npc_count,
            "shop_count": shop_count,
            "token_count": token_count,
            "npc_ids": npc_ids,
            "shop_ids": shop_ids,
            "token_ids": token_ids,
        }
        await manager.broadcast_to_campaign(
            {
                "type": "scene_created",
                "data": payload,
                **payload,
            },
            str(campaign_id),
        )

    async def publish_map_generated(
        self,
        campaign_id: int | str,
        *,
        map_id: str | int,
        map_url: str,
        map_name: str,
        module_id: str,
    ) -> None:
        payload = {
            "map_id": map_id,
            "map_url": map_url,
            "map_name": map_name,
            "module_id": module_id,
        }
        await manager.broadcast_to_campaign(
            {
                "type": "map_generated",
                "data": payload,
                **payload,
            },
            str(campaign_id),
        )

    async def publish_monster_converted_to_chest(
        self,
        campaign_id: int | str,
        *,
        token_id: int,
        chest_id: int,
        chest: dict[str, Any],
        position_x: Any,
        position_y: Any,
        map_url: str,
    ) -> None:
        payload = {
            "token_id": token_id,
            "chest_id": chest_id,
            "chest": chest,
            "position_x": position_x,
            "position_y": position_y,
            "map_url": map_url,
        }
        await manager.broadcast_to_campaign(
            {
                "type": "monster_converted_to_chest",
                "data": payload,
                **payload,
            },
            str(campaign_id),
        )

    async def publish_markers_cleared(
        self,
        campaign_id: int | str,
        *,
        map_url: str,
    ) -> None:
        await manager.broadcast_to_campaign(
            {
                "type": "markers_cleared",
                "map_url": map_url,
            },
            str(campaign_id),
        )

    async def publish_chest_event(
        self,
        campaign_id: int | str,
        *,
        event_type: str,
        chest: dict[str, Any],
    ) -> None:
        await manager.broadcast_to_campaign(
            {
                "type": event_type,
                "chest": chest,
                "campaign_id": campaign_id,
            },
            str(campaign_id),
        )

    async def publish_chest_deleted(
        self,
        campaign_id: int | str,
        *,
        chest_id: int,
    ) -> None:
        await manager.broadcast_to_campaign(
            {
                "type": "chest_deleted",
                "chest_id": chest_id,
                "campaign_id": campaign_id,
            },
            str(campaign_id),
        )

    async def publish_transformation_narrative(
        self,
        campaign_id: int | str,
        *,
        token_id: int,
        character_id: int | None,
        character_name: str,
        beast_name: str | None,
        is_transforming: bool,
        config_id: str,
        narrative: str,
    ) -> None:
        await manager.broadcast_to_campaign(
            {
                "type": "transformation_narrative",
                "token_id": token_id,
                "character_id": character_id,
                "character_name": character_name,
                "beast_name": beast_name,
                "is_transforming": is_transforming,
                "config_id": config_id,
                "narrative": narrative,
            },
            str(campaign_id),
        )


realtime_publisher = RealtimePublisher()
