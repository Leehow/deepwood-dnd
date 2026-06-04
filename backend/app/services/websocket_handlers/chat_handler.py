"""
Chat Message Handler
Handles chat messages with AI integration support
"""
import asyncio
from datetime import datetime
from typing import Dict, Any, List
from fastapi import WebSocket
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.locale import DEFAULT_LOCALE
from app.models.chat_message import ChatMessage
from app.models.campaign import CampaignMember
from app.services.ai_model_service import ai_model_service
from app.services.ai_prompts import build_chat_system_prompt
from app.services.ai_service import AIService
from .base import MessageHandler


class ChatHandler(MessageHandler):
    """Handler for chat messages with AI integration"""

    def __init__(self):
        # Global lock to prevent concurrent AI calls
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
        """
        Handle chat message

        Supports:
        - Public and private messages
        - AI triggers (@ai mention or direct AI message)
        - Streaming AI responses
        """
        data = message.get("data") or {}
        content = str(data.get("message") or "")
        recipients = data.get("recipients") or []  # list of user_ids; may include 'ai'
        is_private = len(recipients) > 0
        ai_session_id = data.get("ai_session_id")  # AI session isolation

        # Check for @ai mentions
        mentions = []
        if "@ai" in content.lower():
            mentions.append("ai")

        timestamp = data.get("timestamp") or int(datetime.utcnow().timestamp() * 1000)

        # Look up character name for player messages
        character_name = None
        sender_character_id = None
        if role == "player":
            member_stmt = select(CampaignMember).where(
                CampaignMember.campaign_id == int(campaign_id),
                CampaignMember.user_id == user_id,
                CampaignMember.role == "player",
            )
            member_result = await db.execute(member_stmt)
            member = member_result.scalar_one_or_none()
            if member:
                character_name = member.character_name
                sender_character_id = member.selected_character_id

        # Accept structured meta forwarded by the client (e.g. spell-cast cards
        # send `{ spell_cast: true, spellCastData: {...} }`). Shallow-copy so
        # the caller's dict is never mutated, then layer character_name on top
        # to keep the legacy display behavior.
        incoming_meta = data.get("meta")
        if isinstance(incoming_meta, dict):
            meta = dict(incoming_meta)
        else:
            meta = {}
        if character_name:
            meta["character_name"] = character_name

        # Persist user message
        raw_msg_type = data.get("message_type") or "chat"
        msg_type = raw_msg_type if raw_msg_type in ("chat", "combat", "system") else "chat"
        msg = ChatMessage(
            campaign_id=int(campaign_id),
            sender_user_id=user_id,
            sender_role=role,
            sender_character_id=sender_character_id,
            message_type=msg_type,
            content=content,
            recipients=recipients,
            is_private=is_private,
            mentions=mentions,
            meta=meta,
            reply_to_id=None,
            ai_session_id=ai_session_id,
        )
        db.add(msg)
        await db.commit()
        await db.refresh(msg)

        # Broadcast user message. Include the persisted meta so other clients
        # (and the sender's echo) receive structured payloads like
        # `spellCastData` for spell-cast cards — without this, Counterspell
        # reaction buttons cannot find the source caster on the receiving side.
        payload = {
            "type": "chat",
            "data": {
                "id": msg.id,
                "user_id": user_id,
                "role": role,
                "message": content,
                "character_name": character_name,
                "recipients": recipients,
                "timestamp": timestamp,
                "created_at": msg.created_at.isoformat() if hasattr(msg, "created_at") and msg.created_at else None,
                "message_type": msg.message_type,
                "meta": msg.meta or {},
            },
        }

        if is_private:
            print(f"[ChatHandler] Sending private message from {user_id} to {recipients}")
            # Ensure DM always sees private messages
            from app.services.websocket_manager import manager
            dm_user_id = manager.get_dm_user_id(campaign_id)
            private_recipients = list(recipients)
            if dm_user_id and dm_user_id not in private_recipients:
                private_recipients.append(dm_user_id)
            await self.send_to_recipients(payload, private_recipients, campaign_id)
            # Echo back to sender if not already included
            if user_id not in private_recipients:
                await self.send_to_websocket(payload, websocket)
        else:
            await self.broadcast_to_campaign(payload, campaign_id)

        # Check if AI should respond
        should_ai = (any(r.lower() == "ai" for r in recipients)) or ("ai" in mentions)

        if should_ai:
            ui_context = data.get("ui_context")
            from app.services.websocket_manager import manager
            locale = manager.get_locale(websocket) or DEFAULT_LOCALE
            await self._handle_ai_response(
                db, campaign_id, user_id, content, recipients, msg.id,
                ui_context, sender_character_id, ai_session_id, locale
            )

    async def _fetch_chat_context(
        self, db: AsyncSession, campaign_id: str, limit: int = 20,
        ai_session_id: int = None
    ) -> List[Dict[str, str]]:
        """Fetch recent chat messages as AI context.

        Filters out dice messages and deduplicates by content.
        When ai_session_id is provided, only fetches messages from that session.
        Returns oldest-first list of {"role": ..., "content": ...}.
        """
        # Fetch more than needed to account for filtering
        conditions = [
            ChatMessage.campaign_id == int(campaign_id),
            ChatMessage.is_deleted == False,
            ChatMessage.message_type.notin_(["dice", "system"]),
        ]
        if ai_session_id is not None:
            conditions.append(ChatMessage.ai_session_id == ai_session_id)

        stmt = (
            select(ChatMessage)
            .where(*conditions)
            .order_by(ChatMessage.id.desc())
            .limit(limit * 3)
        )
        result = await db.execute(stmt)
        rows = result.scalars().all()

        seen_contents: set = set()
        context_msgs: List[Dict[str, str]] = []
        for row in rows:
            content = (row.content or "").strip()
            if not content:
                continue
            # Deduplicate by exact content
            if content in seen_contents:
                continue
            seen_contents.add(content)

            role = "assistant" if row.sender_role == "ai" else "user"
            context_msgs.append({"role": role, "content": content})
            if len(context_msgs) >= limit:
                break

        # Reverse to chronological order (oldest first)
        context_msgs.reverse()
        return context_msgs

    async def _build_character_context(
        self, db: AsyncSession, character_id: int
    ) -> str:
        """Build a text summary of the player's character for AI context."""
        from app.models.character import Character
        stmt = select(Character).where(Character.id == character_id)
        result = await db.execute(stmt)
        char = result.scalar_one_or_none()
        if not char:
            return ""

        parts = []

        # Look up Chinese names for race/class/subclass
        race_name = char.race_id
        class_name = char.class_id
        subclass_name = char.subclass_id
        try:
            from app.utils.rules_cache import get_classes_data
            classes_data = get_classes_data()
            cls_data = next((c for c in classes_data.get("classes", []) if c.get("id") == char.class_id), None)
            if cls_data:
                class_name = cls_data.get("name", char.class_id)
                if char.subclass_id:
                    sc = next((s for s in cls_data.get("subclasses", []) if s.get("id") == char.subclass_id), None)
                    if sc:
                        subclass_name = sc.get("name", char.subclass_id)
        except Exception:
            pass
        try:
            from app.utils.rules_cache import get_races_data
            races_data = get_races_data()
            race_data = next((r for r in races_data.get("races", []) if r.get("id") == char.race_id), None)
            if race_data:
                race_name = race_data.get("name", char.race_id)
        except Exception:
            pass

        parts.append(f"角色：{char.name}，{race_name}，{class_name} {char.level}级")
        if char.subclass_id:
            parts.append(f"子职业：{subclass_name}")

        # Ability scores
        if char.ability_scores:
            a = char.ability_scores
            parts.append(f"属性：力{a.get('strength', 10)} 敏{a.get('dexterity', 10)} 体{a.get('constitution', 10)} 智{a.get('intelligence', 10)} 感{a.get('wisdom', 10)} 魅{a.get('charisma', 10)}")

        # Skills
        skills = self._extract_values(char.selected_skills)
        if skills:
            parts.append(f"技能熟练：{'、'.join(skills)}")
        expertise = self._extract_values(char.expertise_skills)
        if expertise:
            parts.append(f"专精：{'、'.join(expertise)}")

        # Weapon/armor proficiency from rules data
        try:
            from app.utils.rules_cache import get_classes_data
            classes_data = get_classes_data()
            cls = next((c for c in classes_data.get("classes", []) if c.get("id") == char.class_id), None)
            if cls:
                armor = cls.get("proficiencies", {}).get("armor", [])
                weapons = cls.get("proficiencies", {}).get("weapons", [])
                if armor:
                    parts.append(f"护甲熟练：{'、'.join(armor)}")
                if weapons:
                    parts.append(f"武器熟练：{'、'.join(weapons)}")
        except Exception:
            pass

        # Equipment summary (top 10)
        if char.equipment and isinstance(char.equipment, list):
            names = [e.get("name", "") for e in char.equipment[:10] if isinstance(e, dict)]
            names = [n for n in names if n]
            if names:
                extra = f"…等共{len(char.equipment)}件" if len(char.equipment) > 10 else ""
                parts.append(f"已有装备：{'、'.join(names)}{extra}")

        # Feats
        feats = self._extract_values(char.feats)
        if feats:
            parts.append(f"专长：{'、'.join(feats)}")

        # Fighting style
        fs = self._extract_single(char.fighting_style)
        if fs:
            parts.append(f"战斗风格：{fs}")

        # Build spell ID → Chinese name lookup
        spell_name_map = self._build_spell_name_map()

        # Spells (cantrips, known spells, prepared spells) — translate to Chinese
        cantrips = self._extract_values(char.selected_cantrips)
        if cantrips:
            parts.append(f"已知戏法：{'、'.join(spell_name_map.get(c, c) for c in cantrips)}")
        known_spells = self._extract_values(char.selected_spells)
        if known_spells:
            parts.append(f"已知法术：{'、'.join(spell_name_map.get(s, s) for s in known_spells)}")
        prepared = char.prepared_spells
        if prepared and isinstance(prepared, list):
            parts.append(f"已准备法术：{'、'.join(spell_name_map.get(s, s) for s in prepared)}")

        # Spell material components (for known/prepared spells)
        all_spell_ids = set(known_spells + (prepared or []))
        if all_spell_ids:
            mat_info = self._get_spell_materials(all_spell_ids)
            if mat_info:
                parts.append(f"法术材料需求：{mat_info}")

        return "。".join(parts)

    @staticmethod
    def _get_spell_materials(spell_ids: set) -> str:
        """Look up material components for a set of spell IDs."""
        try:
            from app.utils.rules_cache import get_spells_data
            spells_data = get_spells_data()
            spells_list = spells_data.get("spells", [])
            if isinstance(spells_list, dict):
                spells_list = list(spells_list.values())

            items = []
            for sp in spells_list:
                sid = sp.get("id", "")
                if sid not in spell_ids:
                    continue
                comps = sp.get("components", [])
                if "M" not in comps:
                    continue
                mat = sp.get("materials", "")
                cost = sp.get("materialCost")
                consumed = sp.get("materialConsumed", False)
                if not mat:
                    continue
                desc = f"{sp.get('name', sid)}→{mat}"
                if cost:
                    desc += f"(价值{cost}gp"
                    desc += "，消耗" if consumed else "，不消耗"
                    desc += ")"
                items.append(desc)
                if len(items) >= 15:
                    break
            return "；".join(items)
        except Exception:
            return ""

    @staticmethod
    def _build_spell_name_map() -> dict:
        """Build a spell ID → Chinese name mapping from spells.json."""
        try:
            from app.utils.rules_cache import get_spells_data
            spells_data = get_spells_data()
            spells_list = spells_data.get("spells", [])
            if isinstance(spells_list, dict):
                spells_list = list(spells_list.values())
            return {sp.get("id", ""): sp.get("name", sp.get("id", "")) for sp in spells_list if sp.get("id")}
        except Exception:
            return {}

    @staticmethod
    def _extract_values(data) -> List[str]:
        """Extract string values from a field that may be string[] or LevelTrackedSelection[]."""
        if not data or not isinstance(data, list):
            return []
        result = []
        for item in data:
            if isinstance(item, str):
                result.append(item)
            elif isinstance(item, dict):
                v = item.get("value") or item.get("id") or ""
                if v:
                    result.append(v)
        return result

    @staticmethod
    def _extract_single(data) -> str:
        """Extract string from a field that may be string or LevelTrackedSelection."""
        if isinstance(data, str):
            return data
        if isinstance(data, dict):
            return data.get("value") or data.get("id") or ""
        return ""

    async def _handle_ai_response(
        self,
        db: AsyncSession,
        campaign_id: str,
        user_id: str,
        prompt_content: str,
        recipients: list,
        reply_to_id: int,
        ui_context: str = None,
        sender_character_id: int = None,
        ai_session_id: int = None,
        locale: str = DEFAULT_LOCALE,
    ) -> None:
        """Generate and send AI response with streaming"""
        try:
            # Get model config and params via usage config
            usage_params = await ai_model_service.get_usage_params(db, "websocket_chat")
            config = usage_params.config
            temperature = usage_params.temperature
            max_tokens = usage_params.max_tokens

            # Prepare prompt (strip @ai mention)
            prompt = prompt_content.replace("@ai", "").replace("@AI", "").strip()
            if not prompt:
                prompt = prompt_content

            # Build character context if we have a character id
            char_context = ""
            if sender_character_id:
                char_context = await self._build_character_context(db, sender_character_id)

            # Build messages with conversation context
            context = await self._fetch_chat_context(
                db, campaign_id, limit=20, ai_session_id=ai_session_id
            )
            system_content = build_chat_system_prompt(
                locale,
                character_context=char_context or None,
                ui_context=ui_context or None,
            )
            messages = [
                {"role": "system", "content": system_content},
            ]
            messages.extend(context)
            # Ensure the current user message is always the last one
            if not context or context[-1].get("content") != prompt:
                messages.append({"role": "user", "content": prompt})

            # Use global lock to prevent concurrent AI calls
            async with self._ai_lock:
                # Stream AI response
                ai_text = ""
                async for chunk in AIService.generate_completion_stream(
                    api_url=config.api_url,
                    api_key=config.api_key,
                    model=config.model_name,
                    messages=messages,
                    temperature=temperature,
                    max_tokens=max_tokens,
                ):
                    ai_text += chunk

                    # Send streaming chunk to client
                    stream_payload = {
                        "type": "ai_stream",
                        "chunk": chunk,
                        "done": False,
                        "recipients": [user_id] if any(r.lower() == "ai" for r in recipients) else [],
                    }

                    if any(r.lower() == "ai" for r in recipients):
                        await self.send_to_recipients(stream_payload, [user_id], campaign_id)
                    else:
                        await self.broadcast_to_campaign(stream_payload, campaign_id)

                # Send final "done" message
                done_payload = {
                    "type": "ai_stream",
                    "chunk": "",
                    "done": True,
                    "recipients": [user_id] if any(r.lower() == "ai" for r in recipients) else [],
                }
                if any(r.lower() == "ai" for r in recipients):
                    await self.send_to_recipients(done_payload, [user_id], campaign_id)
                else:
                    await self.broadcast_to_campaign(done_payload, campaign_id)

            # Persist AI message
            ai_msg = ChatMessage(
                campaign_id=int(campaign_id),
                sender_user_id="ai",
                sender_role="ai",
                sender_character_id=None,
                message_type="ai",
                content=ai_text,
                recipients=[user_id] if any(r.lower() == "ai" for r in recipients) else [],
                is_private=any(r.lower() == "ai" for r in recipients),
                mentions=[],
                meta={"from": "chat"},
                reply_to_id=reply_to_id,
                ai_session_id=ai_session_id,
            )
            db.add(ai_msg)
            await db.commit()
            await db.refresh(ai_msg)

            # Broadcast AI message
            ai_payload = {
                "type": "chat",
                "id": ai_msg.id,
                "user_id": "ai",
                "role": "ai",
                "message": ai_text,
                "recipients": ai_msg.recipients,
                "timestamp": int(datetime.utcnow().timestamp() * 1000),
                "created_at": ai_msg.created_at.isoformat() if hasattr(ai_msg, "created_at") and ai_msg.created_at else None,
            }

            if ai_msg.is_private:
                await self.send_to_recipients(ai_payload, ai_msg.recipients, campaign_id)
            else:
                await self.broadcast_to_campaign(ai_payload, campaign_id)

            # Auto-generate session title for first 3 exchanges
            if ai_session_id:
                await self._maybe_auto_title_session(
                    db, ai_session_id, campaign_id, user_id,
                    prompt_content, ai_text
                )

        except Exception as e:
            print(f"[ChatHandler] Error generating AI reply: {e}")
            import traceback
            traceback.print_exc()

    async def send_to_recipients(
        self,
        message: Dict[str, Any],
        recipients: list,
        campaign_id: str
    ) -> None:
        """Send message to specific recipients"""
        from app.services.websocket_manager import manager
        await manager.send_to_recipients(message, campaign_id, recipients)

    async def _maybe_auto_title_session(
        self,
        db: AsyncSession,
        session_id: int,
        campaign_id: str,
        user_id: str,
        user_question: str,
        ai_answer: str,
    ) -> None:
        """Auto-generate session title if still default and within first 3 exchanges."""
        from app.models.ai_chat_session import AiChatSession
        from sqlalchemy import func

        try:
            session = await db.get(AiChatSession, session_id)
            if not session or session.title != "新会话":
                return  # User already renamed it

            # Count user messages in this session
            msg_count_result = await db.execute(
                select(func.count(ChatMessage.id)).where(
                    ChatMessage.ai_session_id == session_id,
                    ChatMessage.sender_role != "ai",
                )
            )
            msg_count = msg_count_result.scalar() or 0
            if msg_count > 3:
                return

            # Generate a short title from the Q&A
            title = self._generate_session_title(user_question, ai_answer)
            session.title = title
            await db.commit()

            # Notify frontend about the title update
            await self.send_to_recipients(
                {
                    "type": "ai_session_title",
                    "session_id": session_id,
                    "title": title,
                },
                [user_id],
                campaign_id,
            )
        except Exception as e:
            print(f"[ChatHandler] Auto-title error: {e}")

    @staticmethod
    def _generate_session_title(question: str, answer: str) -> str:
        """Generate a concise session title from Q&A content."""
        # Use the question as primary source, truncate smartly
        q = question.replace("@ai", "").replace("@AI", "").strip()
        if len(q) <= 20:
            return q

        # Try to find a natural break point
        for sep in ["？", "?", "，", ",", "。", ".", " "]:
            idx = q.find(sep)
            if 4 <= idx <= 25:
                return q[:idx]

        return q[:18] + "..."
