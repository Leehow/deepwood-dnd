"""
Dice Handler - Simplified Version
All dice operations use ChatMessage with meta.dice field
"""
import uuid
import asyncio
from datetime import datetime
from typing import Dict, Any, List, Optional
from fastapi import WebSocket
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.campaign import Campaign, CampaignMember
from app.models.character import Character
from app.models.monster_instance import MonsterInstance
from app.models.chat_message import ChatMessage
from app.services.ai_model_service import ai_model_service
from app.services.json_format_agent import ensure_strict_json
from app.services.ai_service import AIService
from app.utils.dice import (
    normalize_check, roll_expression, add_modifier_to_expr,
    skill_modifier, ability_check_modifier, tool_modifier,
    collect_character_skill_proficiencies, collect_character_tool_proficiencies,
    get_tool_display_name, ABILITY_NAME_CN, SKILL_TO_ABILITY,
)
from .base import MessageHandler


class DiceHandler(MessageHandler):
    """Handler for dice operations using ChatMessage"""

    def __init__(self):
        self._ai_lock = asyncio.Lock()

    async def handle(
        self,
        message: Dict[str, Any],
        websocket: WebSocket,
        campaign_id: str,
        user_id: str,
        role: str,
        db: AsyncSession
    ) -> None:
        """Handle dice-related messages"""
        message_type = message.get("type")
        # Canonical client->server format requires message.data
        data = message.get("data") or {}

        if message_type == "dice_analyze":
            await self._handle_dice_analyze(data, websocket, campaign_id, user_id, role, db)
        elif message_type == "dice_execute":
            await self._handle_dice_execute(data, websocket, campaign_id, user_id, role, db)
        elif message_type == "dice_narrative":
            await self._handle_dice_narrative(data, websocket, campaign_id, user_id, role, db)
        elif message_type == "dice_quick":
            await self._handle_dice_quick(data, websocket, campaign_id, user_id, role, db)
        elif message_type == "dice_dismiss":
            await self._handle_dice_dismiss(data, websocket, campaign_id, user_id, role, db)

    async def _handle_dice_quick(
        self,
        data: Dict[str, Any],
        websocket: WebSocket,
        campaign_id: str,
        user_id: str,
        role: str,
        db: AsyncSession
    ) -> None:
        """
        Lightweight quick dice roll - no AI, minimal DB operations.
        Just roll dice, save result, and broadcast.
        """
        from app.models.token import Token

        # Parse dice expression (e.g., "1d20", "2d6", "1d8+3")
        dice_expr = str(data.get("dice") or data.get("message") or "1d20").strip().lower()
        is_private = bool(data.get("is_private", False))
        actor_id = data.get("actor_id")  # Optional: "user_id" or "monster-{token_id}"
        actor_name = data.get("actor_name")  # Optional: display name
        # Frontend can directly pass character_id to avoid DB lookup issues
        frontend_character_id = data.get("actor_character_id")

        # 3D骰子模式：客户端提供物理结果；否则后端随机
        client_total = data.get("client_total")
        client_rolls = data.get("client_rolls")
        if client_total is not None and client_rolls is not None:
            total = int(client_total)
            rolls = [list(client_rolls)]
        else:
            # Roll the dice immediately - no AI, no complex lookups
            result = roll_expression(dice_expr)
            total = result.get("total", 0)
            rolls = result.get("rolls", [])

        # Determine sender info
        sender_role = role
        display_name = actor_name or user_id

        # Resolve actor info (character_id or monster_instance_id)
        # Prefer frontend-provided character_id
        actor_character_id = frontend_character_id if frontend_character_id else None
        actor_monster_instance_id = None
        actor_avatar_url = None
        actor_type = "player"

        if actor_id:
            if actor_id.startswith("monster-"):
                # Monster actor: actor_id = "monster-{token_id}"
                actor_type = "monster"
                try:
                    token_id = int(actor_id.replace("monster-", ""))
                    token_res = await db.execute(
                        select(Token).where(Token.id == token_id)
                    )
                    token = token_res.scalar_one_or_none()
                    if token and token.monster_instance_id:
                        actor_monster_instance_id = token.monster_instance_id
                        # Get monster avatar
                        monster_res = await db.execute(
                            select(MonsterInstance).where(MonsterInstance.id == token.monster_instance_id)
                        )
                        monster = monster_res.scalar_one_or_none()
                        if monster and monster.avatar_url:
                            actor_avatar_url = monster.avatar_url
                except Exception as e:
                    print(f"[DiceHandler] Failed to get monster_instance_id from token: {e}")
            elif not actor_character_id:
                # Player actor: actor_id = user_id, fallback to DB lookup if frontend didn't provide
                actor_type = "player"
                try:
                    member_res = await db.execute(
                        select(CampaignMember).where(
                            CampaignMember.campaign_id == int(campaign_id),
                            CampaignMember.user_id == actor_id
                        )
                    )
                    member = member_res.scalar_one_or_none()
                    if member:
                        if member.selected_character_id:
                            actor_character_id = member.selected_character_id
                        # Use character_name as display name if available (better than user_id)
                        if member.character_name and (not actor_name or actor_name == actor_id):
                            actor_name = member.character_name
                            display_name = member.character_name
                except Exception as e:
                    print(f"[DiceHandler] Failed to get character_id from member: {e}")

        # Build simple content
        content = f"{display_name}：🎲 {dice_expr} = {total}"
        if rolls:
            flat_rolls = [r for group in rolls for r in (group if isinstance(group, list) else [group])]
            if len(flat_rolls) > 1 or flat_rolls != [total]:
                content = f"{display_name}：🎲 {dice_expr} = {flat_rolls} = {total}"

        # Get DM user_ids for private roll visibility
        visible_to = []
        if is_private:
            res = await db.execute(
                select(CampaignMember.user_id).where(
                    CampaignMember.campaign_id == int(campaign_id),
                    CampaignMember.role == "dm"
                )
            )
            dm_ids = [r[0] for r in res.fetchall()]
            visible_to = list(set(dm_ids + [user_id]))

        # Build actor info for storage and broadcast
        actor_info = {
            "type": actor_type,
            "user_id": actor_id if actor_type == "player" else user_id,
            "name": actor_name,
        }
        if actor_character_id:
            actor_info["character_id"] = actor_character_id
        if actor_monster_instance_id:
            actor_info["monster_instance_id"] = actor_monster_instance_id
        if actor_avatar_url:
            actor_info["avatar_url"] = actor_avatar_url

        # Save to database (minimal fields)
        chat_msg = ChatMessage(
            campaign_id=int(campaign_id),
            sender_user_id=user_id,
            sender_role=sender_role,
            message_type="dice",
            content=content,
            recipients=[],
            is_private=is_private,
            meta={
                "dice": {
                    "stage": "result",
                    "quick": True,  # Mark as quick roll
                    "roll": {
                        "expression": dice_expr,
                        "total": total,
                        "rolls": rolls,
                    },
                    "actor": actor_info if actor_name else None,
                }
            }
        )
        db.add(chat_msg)
        await db.commit()
        await db.refresh(chat_msg)

        # Build broadcast payload with actor info for bubble display
        result_data = {
            "expression": dice_expr,
            "total": total,
            "rolls": rolls,
            "actor_name": actor_name,
            "actor_type": actor_type,
        }
        # Include actor_user_id for player proxy rolls (so frontend can match by user_id)
        if actor_id and actor_type == "player":
            result_data["actor_user_id"] = actor_id
        if actor_character_id:
            result_data["actor_character_id"] = actor_character_id
        if actor_monster_instance_id:
            result_data["actor_monster_instance_id"] = actor_monster_instance_id
        if actor_avatar_url:
            result_data["actor_avatar_url"] = actor_avatar_url

        payload = {
            "type": "dice_result",
            "id": chat_msg.id,
            "user_id": user_id,
            "role": sender_role,
            "content": content,
            "is_private": is_private,
            "visible_to": visible_to,
            "created_at": chat_msg.created_at.isoformat() if chat_msg.created_at else None,
            "result": result_data,
        }

        # Broadcast
        if is_private:
            await self.broadcast_to_users(payload, campaign_id, visible_to)
        else:
            await self.broadcast_to_campaign(payload, campaign_id)

    async def _handle_dice_analyze(
        self,
        data: Dict[str, Any],
        websocket: WebSocket,
        campaign_id: str,
        user_id: str,
        role: str,
        db: AsyncSession
    ) -> None:
        """DM initiates a dice check - saves as ChatMessage and broadcasts"""
        if role != "dm":
            await self.send_to_websocket({"type": "error", "message": "只有DM可以发骰"}, websocket)
            return

        original_message = str(data.get("message") or data.get("original_message") or "").strip()
        recipients = list(set(data.get("recipients") or []))
        is_private = bool(data.get("is_private", False))

        # Get all players if no recipients specified
        if not recipients:
            try:
                res = await db.execute(
                    select(CampaignMember.user_id).where(
                        CampaignMember.campaign_id == int(campaign_id),
                        CampaignMember.role == "player"
                    )
                )
                recipients = [r[0] for r in res.all()]
            except Exception as e:
                print(f"[DiceHandler] Failed to load recipients: {e}")
                recipients = []

        # Check if frontend provided check data (from manual selection or AI analysis on frontend)
        frontend_check = data.get("check")
        if frontend_check and (frontend_check.get("type") or frontend_check.get("ability") or frontend_check.get("skill")):
            # Use frontend-provided check data
            check = normalize_check(frontend_check)
            # Also use frontend-provided DC if available
            if data.get("dc") is not None:
                check["dc"] = data.get("dc")
            print(f"[DiceHandler] Using frontend-provided check: {check}")
        else:
            # Fall back to AI analyze message to extract check parameters
            check = await self._analyze_dice_check(original_message, db)
        # Save original message for narrative context
        check["original_message"] = original_message

        # Get roll modifier (advantage/disadvantage) from DM
        roll_modifier = data.get("roll_modifier")  # 'advantage' | 'disadvantage' | None
        if roll_modifier:
            check["roll_modifier"] = roll_modifier
            print(f"[DiceHandler] Roll modifier set: {roll_modifier}")

        # Build message content
        content = self._build_request_content(check, is_private)
        request_id = str(uuid.uuid4())

        # Save as ChatMessage
        chat_msg = ChatMessage(
            campaign_id=int(campaign_id),
            sender_user_id=user_id,
            sender_role=role,
            message_type="dice",
            content=content,
            recipients=recipients if is_private else [],
            is_private=is_private,
            meta={
                "dice": {
                    "stage": "request",
                    "request_id": request_id,
                    "check": check,
                    "recipients": recipients,
                    "completed_by": [],
                }
            },
        )
        db.add(chat_msg)
        await db.commit()
        await db.refresh(chat_msg)

        # Broadcast as chat message
        payload = {
            "type": "chat",
            "id": chat_msg.id,
            "user_id": user_id,
            "role": role,
            "message": content,
            "message_type": "dice",
            "recipients": recipients if is_private else [],
            "is_private": is_private,
            "meta": chat_msg.meta,
            "created_at": chat_msg.created_at.isoformat() if chat_msg.created_at else datetime.utcnow().isoformat() + "Z",
            "timestamp": int(datetime.utcnow().timestamp() * 1000),
        }

        if is_private:
            target_users = list(set(recipients + [user_id]))
            await self.send_to_recipients(payload, target_users, campaign_id)
        else:
            await self.broadcast_to_campaign(payload, campaign_id)

        print(f"[DiceHandler] Created dice request {request_id}, chat_msg_id={chat_msg.id}")

    async def _handle_dice_execute(
        self,
        data: Dict[str, Any],
        websocket: WebSocket,
        campaign_id: str,
        user_id: str,
        role: str,
        db: AsyncSession
    ) -> None:
        """Player or DM executes a dice roll - saves result as ChatMessage"""
        actor = data.get("actor") or {}
        actor_type = actor.get("type") or ("monster" if actor.get("monster_instance_id") else "player")
        target_user_id = actor.get("user_id") or user_id
        target_character_id = actor.get("character_id")
        request_id = data.get("request_id")

        # Authorization check
        if role != "dm":
            if actor_type == "monster":
                # 允许玩家为自己控制的伙伴/召唤物投骰
                monster_instance_id = actor.get("monster_instance_id")
                allowed = False
                if monster_instance_id:
                    try:
                        mi = await db.get(MonsterInstance, int(monster_instance_id))
                        if mi and mi.control_type in ("companion", "familiar", "summon", "mount"):
                            controller = await db.get(Character, mi.controller_character_id) if mi.controller_character_id else None
                            if controller and str(controller.user_id) == str(user_id):
                                allowed = True
                    except Exception:
                        pass
                if not allowed:
                    await self.send_to_websocket({"type": "error", "message": "玩家只能为自己投骰"}, websocket)
                    return
            elif target_user_id != user_id:
                await self.send_to_websocket({"type": "error", "message": "玩家只能为自己投骰"}, websocket)
                return

        # Load character or monster
        character = None
        monster_instance = None
        member = None  # For character_name fallback

        if actor_type == "monster":
            monster_instance_id = actor.get("monster_instance_id")
            if monster_instance_id:
                try:
                    monster_instance = await db.get(MonsterInstance, int(monster_instance_id))
                except Exception:
                    pass
        else:
            if not target_character_id:
                res = await db.execute(
                    select(CampaignMember)
                    .where(
                        CampaignMember.campaign_id == int(campaign_id),
                        CampaignMember.user_id == target_user_id
                    )
                    .order_by(CampaignMember.id.desc())
                )
                members = res.scalars().all()
                if members:
                    member = next((m for m in members if m.selected_character_id), members[0])
                    if member and member.selected_character_id:
                        target_character_id = member.selected_character_id

            if target_character_id:
                character = await db.get(Character, int(target_character_id))
                if character:
                    print(f"[DiceHandler] Loaded character: id={character.id}, name={character.name}, ability_scores={character.ability_scores}")

        # Get check from data or original request message
        check = data.get("check") or {}
        is_private = bool(data.get("is_private", False))
        original_recipients = []

        print(f"[DiceHandler] dice_execute: request_id={request_id}, initial check={check}")

        # Load original request message to get check info and update completed_by
        original_msg = None
        if request_id:
            try:
                from sqlalchemy import text
                # Use ->> operator to extract text value from JSONB
                # Filter by stage='request' to avoid matching result messages with the same request_id
                res = await db.execute(
                    select(ChatMessage).where(
                        ChatMessage.campaign_id == int(campaign_id),
                        ChatMessage.message_type == "dice",
                        text("(meta -> 'dice' ->> 'request_id') = :request_id").bindparams(request_id=request_id),
                        text("(meta -> 'dice' ->> 'stage') = 'request'")
                    )
                )
                # Use scalars().first() instead of scalar_one_or_none() for robustness
                original_msg = res.scalars().first()
                print(f"[DiceHandler] original_msg found: {original_msg is not None}, id={original_msg.id if original_msg else None}")
                if original_msg and original_msg.meta:
                    dice_meta = original_msg.meta.get("dice", {})
                    print(f"[DiceHandler] dice_meta.check: {dice_meta.get('check', {})}")
                    if not check:
                        check = dice_meta.get("check", {})
                        print(f"[DiceHandler] Loaded check from original: {check}")
                    is_private = original_msg.is_private
                    original_recipients = dice_meta.get("recipients", [])
            except Exception as e:
                print(f"[DiceHandler] Failed to load original request: {e}")
                import traceback
                traceback.print_exc()

        # If still no check, try to parse dice expression or analyze from message
        original_message = str(data.get("message") or data.get("original_message") or "").strip()
        if not check and original_message:
            # First try simple dice expression parsing (no AI needed)
            import re
            dice_pattern = r'^(\d+)?d(\d+)([+-]\d+)?$'
            match = re.match(dice_pattern, original_message.strip().lower())
            if match:
                # Simple dice expression like "1d20", "2d6+3"
                check = {"dice": original_message.strip(), "type": "check"}
                print(f"[DiceHandler] Parsed simple dice expression: {check}")
            else:
                # Complex message - use AI to analyze
                check = await self._analyze_dice_check(original_message, db)

        check = normalize_check(check)

        # Check for required tools based on context action
        context = data.get("context") or {}
        print(f"[DiceHandler] context={context}, actor_type={actor_type}")
        if context.get("action") == "pick_lock" and actor_type == "player":
            # Pick lock requires thieves' tools
            has_thieves_tools = False
            print(f"[DiceHandler] Checking thieves' tools for character: {character}, equipment: {character.equipment if character else None}")
            if character and character.equipment:
                equipment_list = character.equipment if isinstance(character.equipment, list) else []
                for item in equipment_list:
                    item_id = str(item.get("id", "")).lower() if isinstance(item, dict) else ""
                    item_name = str(item.get("name", "")).lower() if isinstance(item, dict) else ""
                    print(f"[DiceHandler] Checking item: id={item_id}, name={item_name}")
                    # Check for thieves' tools by ID or name
                    if "thieves" in item_id or "thieves" in item_name or "盗贼工具" in item_name:
                        has_thieves_tools = True
                        print(f"[DiceHandler] Found thieves' tools!")
                        break

            print(f"[DiceHandler] has_thieves_tools={has_thieves_tools}")
            if not has_thieves_tools:
                # Send error message - no thieves' tools
                error_payload = {
                    "type": "chat",
                    "msg_type": "system_message",
                    "message": "⚠️ 撬锁需要盗贼工具！请先获取盗贼工具再尝试撬锁。",
                    "user_id": target_user_id,
                    "timestamp": int(datetime.utcnow().timestamp() * 1000),
                }
                await self.send_to_websocket(error_payload, websocket)
                return

        # Compute final ability scores with racial bonuses
        from app.utils.dice import compute_final_ability_scores

        if character:
            full_char = {
                "ability_scores": character.ability_scores or {},
                "selected_skills": character.selected_skills or [],
                "expertise_skills": character.expertise_skills or [],
                "race_id": character.race_id,
                "subrace_id": character.subrace_id,
                "race_choices": character.race_choices or {},
                "subclass_choices": character.subclass_choices or {},
                "class_id": character.class_id,
                "subclass_id": character.subclass_id,
                "background_id": character.background_id,
                "status_effects": character.status_effects or {},
                "feat_choices": character.feat_choices or {},
                "level": int(character.level) if character.level else 1,
            }
            final_ability_scores = compute_final_ability_scores(full_char)
        else:
            final_ability_scores = {}

        # Build character dict with final ability scores
        character_dict = {
            "ability_scores": final_ability_scores,
            "selected_skills": collect_character_skill_proficiencies(full_char) if character else [],
            "expertise_skills": (character.expertise_skills if character else []) or [],
            "proficient_tools": collect_character_tool_proficiencies(full_char) if character else [],
            "level": int(character.level) if character and character.level else 1,
        }

        mod = 0
        used = {}

        if actor_type == "monster" and monster_instance:
            if check.get("type") == "save" and check.get("ability"):
                # 怪物/伙伴的豁免检定
                ab = check["ability"]
                used["ability"] = ab
                saving_throws = (monster_instance.monster_data or {}).get("saving_throws", {})
                # Normalize saving throw keys
                normalized_saves = {str(k).strip().lower().replace(" ", "_"): v for k, v in saving_throws.items()} if isinstance(saving_throws, dict) else {}
                if ab in normalized_saves:
                    mod = int(normalized_saves[ab])
                else:
                    mod = ability_check_modifier({"ability_scores": monster_instance.ability_scores or {}}, ab)
            elif check.get("skill"):
                skill_key = check.get("skill")
                used["skill"] = skill_key
                used["ability"] = SKILL_TO_ABILITY.get(skill_key)
                md = (monster_instance.monster_data or {})
                skills_section = md.get("skills") or {}
                normalized = {str(k).strip().lower().replace(" ", "_"): v for k, v in skills_section.items()} if isinstance(skills_section, dict) else {}
                bonus = normalized.get(skill_key)
                if isinstance(bonus, (int, float)):
                    mod = int(bonus)
                else:
                    ab = used.get("ability") or check.get("ability")
                    if ab:
                        mod = ability_check_modifier({"ability_scores": monster_instance.ability_scores or {}}, ab)
            elif check.get("ability"):
                ab = check.get("ability")
                used["ability"] = ab
                mod = ability_check_modifier({"ability_scores": monster_instance.ability_scores or {}}, ab)
        else:
            print(f"[DiceHandler] check dict: {check}")
            print(f"[DiceHandler] final_ability_scores: {final_ability_scores}")
            print(f"[DiceHandler] character_dict: {character_dict}")
            if check.get("skill"):
                skill_key = check.get("skill")
                used["skill"] = skill_key
                used["ability"] = SKILL_TO_ABILITY.get(skill_key)
                mod = skill_modifier(character_dict, skill_key) if character_dict else 0
                print(f"[DiceHandler] skill={skill_key}, ability={used['ability']}, mod={mod}")
            elif check.get("tool"):
                tool_key = check.get("tool")
                tool_label = get_tool_display_name(tool_key)
                ability_key = check.get("ability") or "dexterity"
                used["tool"] = tool_key
                used["tool_label"] = tool_label
                used["ability"] = ability_key
                used["tool_display"] = f"{tool_label}（{ABILITY_NAME_CN.get(ability_key, ability_key)}）"
                mod = tool_modifier(character_dict, tool_key, ability_key) if character_dict else 0
                print(f"[DiceHandler] tool={tool_key}, ability={ability_key}, mod={mod}")
            elif check.get("ability"):
                ab = check.get("ability")
                used["ability"] = ab
                mod = ability_check_modifier(character_dict, ab) if character_dict else 0
                print(f"[DiceHandler] ability={ab}, mod={mod}")
            else:
                print(f"[DiceHandler] No skill or ability found in check!")

        # Roll the dice with possible advantage/disadvantage
        dice_expr = check.get("dice", "1d20")
        roll_modifier = check.get("roll_modifier")  # 'advantage' | 'disadvantage' | None

        # 3D骰子模式：客户端提供物理结果
        client_total = data.get("client_total")
        client_rolls = data.get("client_rolls")

        if client_rolls is not None and "d20" in dice_expr.lower():
            actual_rolls = [int(roll) for roll in list(client_rolls)]
            if roll_modifier and len(actual_rolls) >= 2:
                d20_roll_1 = actual_rolls[0]
                d20_roll_2 = actual_rolls[1]
                d20_result = max(d20_roll_1, d20_roll_2) if roll_modifier == "advantage" else min(d20_roll_1, d20_roll_2)
                total = d20_result + mod
                result = {
                    "total": total,
                    "rolls": [[d20_roll_1, d20_roll_2]],
                    "modifier": mod,
                    "expression": f"2d20{'kh1' if roll_modifier == 'advantage' else 'kl1'}+{mod}" if mod >= 0 else f"2d20{'kh1' if roll_modifier == 'advantage' else 'kl1'}{mod}",
                    "roll_modifier": roll_modifier,
                    "both_dice": [d20_roll_1, d20_roll_2],
                    "used_die": d20_result
                }
            else:
                base_roll = actual_rolls[0] if actual_rolls else int(client_total or 0)
                total = base_roll + mod
                result = {
                    "total": total,
                    "rolls": [actual_rolls or [base_roll]],
                    "modifier": mod,
                    "expression": add_modifier_to_expr(dice_expr, mod),
                }
        elif client_total is not None and client_rolls is not None and not roll_modifier:
            # 使用客户端3D骰子物理结果 + 服务端修正值
            base_roll = int(client_total)
            actual_rolls = list(client_rolls) if client_rolls else [base_roll]
            total = base_roll + mod
            result = {
                "total": total,
                "rolls": [actual_rolls],
                "modifier": mod,
                "expression": add_modifier_to_expr(dice_expr, mod),
            }
        elif roll_modifier and "d20" in dice_expr.lower():
            # Handle advantage/disadvantage for d20 rolls
            import random
            d20_roll_1 = random.randint(1, 20)
            d20_roll_2 = random.randint(1, 20)

            if roll_modifier == "advantage":
                d20_result = max(d20_roll_1, d20_roll_2)
                print(f"[DiceHandler] Advantage roll: {d20_roll_1}, {d20_roll_2} -> using {d20_result}")
            else:  # disadvantage
                d20_result = min(d20_roll_1, d20_roll_2)
                print(f"[DiceHandler] Disadvantage roll: {d20_roll_1}, {d20_roll_2} -> using {d20_result}")

            total = d20_result + mod
            result = {
                "total": total,
                "rolls": [[d20_roll_1, d20_roll_2]],
                "modifier": mod,
                "expression": f"2d20{'kh1' if roll_modifier == 'advantage' else 'kl1'}+{mod}" if mod >= 0 else f"2d20{'kh1' if roll_modifier == 'advantage' else 'kl1'}{mod}",
                "roll_modifier": roll_modifier,
                "both_dice": [d20_roll_1, d20_roll_2],
                "used_die": d20_result
            }
        else:
            # Normal roll
            final_expr = add_modifier_to_expr(dice_expr, mod)
            result = roll_expression(final_expr)

        dc = check.get("dc")
        success = None
        is_critical = False
        is_fumble = False

        # Determine critical/fumble from the actual die used
        rolls_list = result.get("rolls", [])
        if result.get("used_die"):
            # Advantage/disadvantage roll - use the selected die
            first_die = result.get("used_die")
        elif rolls_list and isinstance(rolls_list[0], list) and len(rolls_list[0]) > 0:
            first_die = rolls_list[0][0]
        elif rolls_list and isinstance(rolls_list[0], int):
            first_die = rolls_list[0]
        else:
            first_die = None

        if first_die == 20:
            is_critical = True
        elif first_die == 1:
            is_fumble = True

        if isinstance(dc, int):
            success = result.get("total", 0) >= dc

        # Don't generate narrative automatically - use dice_narrative on demand

        # Determine actor info
        if actor_type == "monster" and monster_instance:
            actor_name = monster_instance.name_cn or monster_instance.name or "怪物"
            actor_info = {
                "type": "monster",
                "monster_instance_id": int(monster_instance.id),
                "name": actor_name,
            }
            if monster_instance.avatar_url:
                actor_info["avatar_url"] = monster_instance.avatar_url
            if monster_instance.control_type:
                actor_info["control_type"] = monster_instance.control_type
        else:
            # Use character name, or member's character_name, or user_id as fallback
            actor_name = (
                (character.name if character else None) or
                (member.character_name if member else None) or
                target_user_id
            )
            actor_info = {
                "type": "player",
                "user_id": target_user_id,
                "character_id": int(character.id) if character else None,
                "name": actor_name,
            }
            if character and character.avatar:
                actor_info["avatar_url"] = character.avatar

        # Build result content (no narrative - generated on demand)
        content = self._build_result_content(actor_name, result, dc, success, is_critical, is_fumble, used, None)

        # Get DM list for visibility
        dm_res = await db.execute(
            select(CampaignMember.user_id).where(
                CampaignMember.campaign_id == int(campaign_id),
                CampaignMember.role == "dm"
            )
        )
        dm_ids = [r[0] for r in dm_res.all()]
        visible_to = list(set(dm_ids + [target_user_id])) if is_private else []

        # Save result as ChatMessage
        roll_data = {
            "expression": result.get("expression"),
            "total": result.get("total"),
            "rolls": result.get("rolls"),
            "modifier": result.get("modifier"),
            "roll_modifier": result.get("roll_modifier"),
            "both_dice": result.get("both_dice"),
            "used_die": result.get("used_die"),
            "roll_modifier_reasons": check.get("roll_modifier_reasons") or [],
            "dc": dc,
            "success": success,
            "is_critical": is_critical,
            "is_fumble": is_fumble,
            "ability": used.get("ability"),
            "skill": used.get("skill"),
            "tool": used.get("tool"),
            "tool_label": used.get("tool_label"),
            "description": check.get("description"),
            "original_message": check.get("original_message"),  # Save for narrative generation
            "narrative": None,  # Generated on demand via dice_narrative
        }

        chat_msg = ChatMessage(
            campaign_id=int(campaign_id),
            sender_user_id=target_user_id,
            sender_role="player" if (actor_type == "player" or (monster_instance and monster_instance.controller_character_id)) else "dm",
            message_type="dice",
            content=content,
            recipients=visible_to if is_private else [],
            is_private=is_private,
            meta={
                "dice": {
                    "stage": "result",
                    "request_id": request_id,
                    "roll": roll_data,
                    "actor": actor_info,
                }
            },
        )
        db.add(chat_msg)

        # Update original request message's completed_by
        completed_by = []
        all_completed = False
        if original_msg and original_msg.meta:
            dice_meta = dict(original_msg.meta.get("dice", {}))
            completed_by = list(set((dice_meta.get("completed_by") or []) + [target_user_id]))
            dice_meta["completed_by"] = completed_by
            original_msg.meta = {**original_msg.meta, "dice": dice_meta}
            # flag_modified is required for SQLAlchemy to detect JSONB column changes
            from sqlalchemy.orm.attributes import flag_modified
            flag_modified(original_msg, "meta")
            all_completed = bool(original_recipients and all(uid in completed_by for uid in original_recipients))
            print(f"[DiceHandler] Updated completed_by on original msg {original_msg.id}: {completed_by}")
        elif request_id:
            # Fallback: original_msg not loaded, try to update completed_by directly
            print(f"[DiceHandler] WARNING: original_msg not found, attempting fallback completed_by update for request_id={request_id}")
            try:
                from sqlalchemy import text as sql_text
                from sqlalchemy.orm.attributes import flag_modified as flag_mod
                fallback_res = await db.execute(
                    select(ChatMessage).where(
                        ChatMessage.campaign_id == int(campaign_id),
                        ChatMessage.message_type == "dice",
                        sql_text("(meta -> 'dice' ->> 'request_id') = :rid").bindparams(rid=request_id),
                        sql_text("(meta -> 'dice' ->> 'stage') = 'request'")
                    )
                )
                fallback_msg = fallback_res.scalars().first()
                if fallback_msg and fallback_msg.meta:
                    fb_dice_meta = dict(fallback_msg.meta.get("dice", {}))
                    completed_by = list(set((fb_dice_meta.get("completed_by") or []) + [target_user_id]))
                    fb_dice_meta["completed_by"] = completed_by
                    fallback_msg.meta = {**fallback_msg.meta, "dice": fb_dice_meta}
                    flag_mod(fallback_msg, "meta")
                    all_completed = bool(original_recipients and all(uid in completed_by for uid in original_recipients))
                    print(f"[DiceHandler] Fallback: updated completed_by on msg {fallback_msg.id}: {completed_by}")
                else:
                    print(f"[DiceHandler] Fallback: still could not find original request message")
            except Exception as fb_err:
                print(f"[DiceHandler] Fallback completed_by update failed: {fb_err}")

        await db.commit()
        await db.refresh(chat_msg)

        # Handle context-specific actions (e.g., chest pick-lock)
        context = data.get("context") or {}
        if context.get("action") == "pick_lock" and context.get("chest_id"):
            chest_id = context.get("chest_id")
            try:
                from app.models.chest import Chest
                chest_result = await db.execute(select(Chest).where(Chest.id == int(chest_id)))
                chest = chest_result.scalar_one_or_none()
                if chest and chest.is_locked:
                    if success:
                        # Unlock the chest
                        chest.is_locked = False
                        chest.state = "unlocked"
                        await db.commit()
                        await db.refresh(chest)
                        # Broadcast chest unlock
                        unlock_payload = {
                            "type": "chest_unlocked",
                            "chest_id": chest.id,
                            "chest": {
                                "id": chest.id,
                                "name": chest.name,
                                "state": chest.state,
                                "is_locked": chest.is_locked,
                            }
                        }
                        await self.broadcast_to_campaign(unlock_payload, campaign_id)
                        print(f"[DiceHandler] Chest {chest_id} unlocked by pick-lock success")
                    else:
                        print(f"[DiceHandler] Pick-lock failed for chest {chest_id}")
            except Exception as e:
                print(f"[DiceHandler] Failed to handle pick-lock context: {e}")

        print(f"[DiceHandler] chat_msg.created_at = {chat_msg.created_at}")

        # Broadcast result as chat message
        payload = {
            "type": "chat",
            "id": chat_msg.id,
            "user_id": target_user_id,
            "role": "player" if actor_type == "player" else "dm",
            "message": content,
            "message_type": "dice",
            "recipients": visible_to if is_private else [],
            "is_private": is_private,
            "meta": chat_msg.meta,
            "created_at": chat_msg.created_at.isoformat() if chat_msg.created_at else datetime.utcnow().isoformat() + "Z",
            "timestamp": int(datetime.utcnow().timestamp() * 1000),
            # Progress info for UI
            "request_id": request_id,
            "request_completed_by": completed_by,
            "request_is_completed": all_completed,
            # Flattened dice result fields for easy frontend access
            "msg_type": "dice_result",
            "results": [{
                "expression": result.get("expression"),
                "total": result.get("total"),
                "rolls": result.get("rolls"),
                "modifier": result.get("modifier"),
                "ability": used.get("ability"),
                "skill": used.get("skill"),
                "description": check.get("description"),
            }],
            "actor": actor_info,
            "dc": dc,
            "success": success,
            "context": context,  # Include context for pick-lock and other actions
        }

        if is_private:
            print(f"[DiceHandler] Private roll - sending to recipients: {visible_to}")
            await self.send_to_recipients(payload, visible_to, campaign_id)
        else:
            print(f"[DiceHandler] Public roll - broadcasting to campaign")
            await self.broadcast_to_campaign(payload, campaign_id)

        print(f"[DiceHandler] Dice result: total={result.get('total')}, dc={dc}, success={success}, is_private={is_private}, visible_to={visible_to}, created_at={payload.get('created_at')}")

    async def _handle_dice_narrative(
        self,
        data: Dict[str, Any],
        websocket: WebSocket,
        campaign_id: str,
        user_id: str,
        role: str,
        db: AsyncSession
    ) -> None:
        """Generate narrative for a dice result on demand"""
        print(f"[DiceHandler] _handle_dice_narrative called with data: {data}")
        message_id = data.get("message_id")
        if not message_id:
            print(f"[DiceHandler] Missing message_id in data")
            await self.send_to_websocket({"type": "error", "message": "缺少 message_id"}, websocket)
            return

        print(f"[DiceHandler] Loading message {message_id} from DB")
        # Load the dice result message
        try:
            chat_msg = await db.get(ChatMessage, int(message_id))
            print(f"[DiceHandler] Loaded message: {chat_msg}")
            if not chat_msg or chat_msg.campaign_id != int(campaign_id):
                print(f"[DiceHandler] Message not found or campaign mismatch")
                await self.send_to_websocket({"type": "error", "message": "消息不存在"}, websocket)
                return
        except Exception as e:
            print(f"[DiceHandler] Failed to load message: {e}")
            await self.send_to_websocket({"type": "error", "message": "加载消息失败"}, websocket)
            return

        dice_meta = chat_msg.meta.get("dice", {}) if chat_msg.meta else {}
        print(f"[DiceHandler] dice_meta: {dice_meta}")
        if dice_meta.get("stage") != "result":
            print(f"[DiceHandler] Stage is not 'result': {dice_meta.get('stage')}")
            await self.send_to_websocket({"type": "error", "message": "只能为骰子结果生成剧情"}, websocket)
            return

        roll = dice_meta.get("roll", {})
        print(f"[DiceHandler] roll data: {roll}")

        # Check if narrative already exists
        if roll.get("narrative"):
            print(f"[DiceHandler] Narrative already exists, returning cached")
            # Just send the existing narrative
            await self.send_to_websocket({
                "type": "dice_narrative_result",
                "message_id": message_id,
                "narrative": roll.get("narrative"),
            }, websocket)
            return

        # Generate narrative
        print(f"[DiceHandler] Generating new narrative...")
        check = {
            "description": roll.get("description"),
            "original_message": roll.get("original_message"),
        }
        used = {
            "ability": roll.get("ability"),
            "skill": roll.get("skill"),
        }
        print(f"[DiceHandler] check={check}, used={used}, dc={roll.get('dc')}, success={roll.get('success')}")
        narrative = await self._generate_narrative(
            check,
            roll.get("dc"),
            roll.get("success"),
            roll.get("is_critical", False),
            roll.get("is_fumble", False),
            used,
            db
        )
        print(f"[DiceHandler] Generated narrative: {narrative[:100] if narrative else None}...")

        if not narrative:
            print(f"[DiceHandler] Narrative generation failed")
            await self.send_to_websocket({"type": "error", "message": "生成剧情失败"}, websocket)
            return

        # Update the message with the narrative
        roll["narrative"] = narrative
        dice_meta["roll"] = roll
        # 创建新的meta字典并使用flag_modified确保SQLAlchemy检测到变化
        new_meta = {**chat_msg.meta, "dice": dice_meta}
        chat_msg.meta = new_meta
        from sqlalchemy.orm.attributes import flag_modified
        flag_modified(chat_msg, "meta")
        await db.commit()
        print(f"[DiceHandler] Saved narrative to database for message {message_id}")

        # Broadcast the narrative update to all clients in campaign
        payload = {
            "type": "dice_narrative_result",
            "message_id": message_id,
            "narrative": narrative,
        }
        await self.broadcast_to_campaign(payload, campaign_id)

        print(f"[DiceHandler] Generated narrative for message {message_id}")

    async def _handle_dice_dismiss(
        self,
        data: Dict[str, Any],
        websocket: WebSocket,
        campaign_id: str,
        user_id: str,
        role: str,
        db: AsyncSession
    ) -> None:
        """Handle player dismissing a dice request (clicking X to close)"""
        request_id = data.get("request_id")
        if not request_id:
            print(f"[DiceHandler] dice_dismiss: missing request_id")
            return

        try:
            # Find the dice request message by request_id
            # Use ->> operator to extract text value from JSONB
            from sqlalchemy import text
            res = await db.execute(
                select(ChatMessage).where(
                    ChatMessage.campaign_id == int(campaign_id),
                    ChatMessage.message_type == "dice",
                    text("(meta -> 'dice' ->> 'request_id') = :request_id").bindparams(request_id=request_id)
                )
            )
            # Use scalars().all() to handle potential duplicates
            messages = res.scalars().all()
            if not messages:
                print(f"[DiceHandler] dice_dismiss: message not found for request_id={request_id}")
                return

            # Update dismissed_by in all matching messages
            from sqlalchemy.orm.attributes import flag_modified
            for msg in messages:
                dice_meta = dict(msg.meta.get("dice", {}))
                dismissed_by = list(set((dice_meta.get("dismissed_by") or []) + [user_id]))
                dice_meta["dismissed_by"] = dismissed_by
                msg.meta = {**msg.meta, "dice": dice_meta}
                flag_modified(msg, "meta")

            await db.commit()

            print(f"[DiceHandler] dice_dismiss: user {user_id} dismissed request {request_id} ({len(messages)} messages)")

        except Exception as e:
            print(f"[DiceHandler] dice_dismiss error: {e}")
            import traceback
            traceback.print_exc()

    def _build_request_content(self, check: Dict[str, Any], is_private: bool) -> str:
        """Build human-readable content for dice request"""
        parts = []
        if check.get("skill"):
            parts.append(f"技能 {check['skill']}")
        if check.get("tool"):
            parts.append(f"工具 {get_tool_display_name(check['tool'])}")
        if check.get("ability") and not check.get("skill"):
            ability_label = ABILITY_NAME_CN.get(check["ability"], check["ability"])
            parts.append(f"能力 {ability_label}")
        dc_val = check.get("dc")
        if isinstance(dc_val, (int, float)):
            parts.append(f"DC {int(dc_val)}")
        if check.get("dice"):
            parts.append(check["dice"])
        # Add roll modifier indicator
        roll_modifier = check.get("roll_modifier")
        if roll_modifier == "advantage":
            parts.append("🟢优势")
        elif roll_modifier == "disadvantage":
            parts.append("🔴劣势")
        desc = f"\n{check['description']}" if check.get("description") else ""
        privacy = "🔒 暗投" if is_private else "🔓 明骰"
        return f"[{privacy}] 发起检定：{' · '.join(parts) if parts else '1d20'}{desc}"

    def _build_result_content(
        self,
        actor_name: str,
        result: Dict[str, Any],
        dc: Optional[int],
        success: Optional[bool],
        is_critical: bool,
        is_fumble: bool,
        used: Dict[str, Any],
        narrative: Optional[str]
    ) -> str:
        """Build human-readable content for dice result"""
        check_type = used.get("tool_display") or used.get("tool_label") or used.get("skill") or used.get("ability") or "检定"

        # Build dice roll display
        roll_modifier = result.get("roll_modifier")
        both_dice = result.get("both_dice")
        used_die = result.get("used_die")
        modifier = result.get("modifier", 0)

        if roll_modifier and both_dice:
            # Advantage/disadvantage roll - show both dice
            if roll_modifier == "advantage":
                dice_display = f"{used_die} (d20: {both_dice[0]}, {both_dice[1]} 🟢优势)"
            else:
                dice_display = f"{used_die} (d20: {both_dice[0]}, {both_dice[1]} 🔴劣势)"
        else:
            # Normal roll
            rolls = result.get("rolls", [])
            if rolls and isinstance(rolls[0], list):
                dice_display = f"{rolls[0][0]} (d20)"
            elif rolls:
                dice_display = f"{rolls[0]} (d20)"
            else:
                dice_display = "?"

        # Build modifier string
        mod_str = f"+{modifier}" if modifier >= 0 else str(modifier)
        total = result.get("total", 0)

        content = f"🎲 **{actor_name}** {check_type}检定\n"
        content += f"投掷: {dice_display} {mod_str} = **{total}**"

        if isinstance(dc, int):
            if is_critical:
                content += f" vs DC {dc} => 🎯 **大成功！**"
            elif is_fumble:
                content += f" vs DC {dc} => 💥 **大失败！**"
            elif success:
                content += f" vs DC {dc} => ✅ **成功**"
            else:
                content += f" vs DC {dc} => ❌ **失败**"

        if narrative:
            content += f"\n_{narrative}_"

        return content

    async def _analyze_dice_check(self, message: str, db: AsyncSession) -> Dict[str, Any]:
        """Use AI to analyze dice check from natural language"""
        try:
            usage_params = await ai_model_service.get_usage_params(db, "dice_analyze")
            config = usage_params.config
            temperature = usage_params.temperature
            max_tokens = usage_params.max_tokens
            sys_prompt = (
                "You are a D&D 5e assistant that extracts check info from Chinese descriptions. "
                "Abilities: strength, dexterity, constitution, intelligence, wisdom, charisma. "
                "Skills: athletics, acrobatics, sleight_of_hand, stealth, arcana, history, investigation, nature, religion, "
                "animal_handling, insight, medicine, perception, survival, deception, intimidation, performance, persuasion. "
                "Return STRICT JSON with keys: type ('check'|'save'|'contest'), ability, skill, dc (number), "
                "dice (default '1d20'), description. "
                "Example: 火球术 DEX 豁免 DC15 -> {\"type\":\"save\",\"ability\":\"dexterity\",\"dc\":15}"
            )
            user_prompt = f"消息：{message}\n请提取检定信息并返回JSON。"

            async with self._ai_lock:
                parsed = await ensure_strict_json(
                    api_url=config.api_url,
                    api_key=config.api_key,
                    model=config.model_name,
                    messages=[
                        {"role": "system", "content": sys_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                    schema_hint='{"type":"string?","ability":"string?","skill":"string?","dc":"number?","dice":"string?","description":"string?"}',
                    temperature=temperature,
                    max_tokens=max_tokens,
                    max_attempts=3,
                )
                return normalize_check(parsed or {})
        except Exception as e:
            print(f"[DiceHandler] Analyze error: {e}")
            return normalize_check({})

    async def _generate_narrative(
        self,
        check: Dict[str, Any],
        dc: Optional[int],
        success: Optional[bool],
        is_critical: bool,
        is_fumble: bool,
        used: Dict[str, Any],
        db: AsyncSession
    ) -> Optional[str]:
        """Generate narrative description for the check result"""
        try:
            usage_params = await ai_model_service.get_usage_params(db, "dice_analyze")
            config = usage_params.config
            temperature = usage_params.temperature
            max_tokens = usage_params.max_tokens
            if is_critical:
                result_type = "大成功（投出20）"
            elif is_fumble:
                result_type = "大失败（投出1）"
            elif success:
                result_type = "成功"
            elif success is False:
                result_type = "失败"
            else:
                result_type = "未知"

            sys_prompt = (
                "你是D&D 5E 的叙事助手。根据检定结果生成剧情后续事件描述。\n"
                "- 大成功（20）：生成非常精彩的成功结果，可能有额外收获\n"
                "- 成功：生成正常的成功结果\n"
                "- 失败：生成失败的后果，但不致命\n"
                "- 大失败（1）：生成严重的失败后果，可能有额外负面影响\n"
                "用2-3句中文描述事件结果，贴合原剧情上下文，生动有趣，不要解释规则，不要输出骰子数值。"
            )
            # Use original_message for context if available, fall back to description
            context = check.get('original_message') or check.get('description') or '检定'
            user_prompt = (
                f"玩家行动：{context}\n"
                f"检定类型：{used.get('skill') or used.get('ability') or '能力检定'}\n"
                f"难度：DC {dc or '?'}\n"
                f"检定结果：{result_type}\n"
                f"请生成剧情后续："
            )

            async with self._ai_lock:
                narrative = await AIService.generate_completion(
                    api_url=config.api_url,
                    api_key=config.api_key,
                    model=config.model_name,
                    messages=[
                        {"role": "system", "content": sys_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                    temperature=temperature,
                    max_tokens=max_tokens,
                )
                return narrative
        except Exception as e:
            print(f"[DiceHandler] Narrative error: {e}")
            return None

    async def send_to_recipients(self, message: Dict[str, Any], recipients: List[str], campaign_id: str) -> None:
        """Send message to specific recipients"""
        from app.services.websocket_manager import manager
        await manager.send_to_recipients(message, campaign_id, recipients)
