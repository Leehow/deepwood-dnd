"""Seed / reset / snapshot logic for the Spell Runtime QA Arena."""
import os
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.models.campaign import Campaign
from app.models.character import Character
from app.models.monster_instance import MonsterInstance
from app.models.token import Token
from app.services.qa import arena_constants as C
from app.utils.rules_cache import get_spells_data

_CASTER_MAX_HP = 200
# status_effects sub-keys that hold spell-applied conditions (the v2 truth
# layer the engine writes to). Cleared on reset; static fixture flags
# (immunities/resistances) are preserved.
_SPELL_STATE_KEYS = ("conditions", "active_conditions")


def _campaign_name() -> str:
    """Arena campaign name, overridable per-process via QA_CAMPAIGN_NAME so that
    parallel QA backends each own an isolated arena (no cross-process collision)."""
    return os.environ.get("QA_CAMPAIGN_NAME", C.QA_CAMPAIGN_NAME)


def _all_spell_ids() -> list[str]:
    data = get_spells_data()
    spells = data["spells"] if isinstance(data, dict) and "spells" in data else data
    return [s["id"] for s in spells if "id" in s]


def _default_ability_scores() -> dict:
    return {"strength": 10, "dexterity": 10, "constitution": 10,
            "intelligence": 10, "wisdom": 10, "charisma": 10}


def _build_status_effects(spec: dict) -> dict:
    out: dict[str, Any] = {}
    if spec.get("resistances"):
        out["resistances"] = spec["resistances"]
    if spec.get("immunities"):
        out["immunities"] = spec["immunities"]
    if spec.get("condition_immunities"):
        out["condition_immunities"] = spec["condition_immunities"]
    return out


def _build_monster_data(spec: dict) -> dict | None:
    """Surface fixture resistance/immunity flags on ``monster_data`` — the field
    the rest of the app (spell_cast, combat, immunity_service) actually reads
    monster resistances/immunities from. Without this, immunities/resistances
    seeded only into ``status_effects`` are invisible to the cast pipeline."""
    md: dict[str, Any] = {}
    if spec.get("resistances"):
        md["damage_resistances"] = spec["resistances"]
    if spec.get("immunities"):
        md["damage_immunities"] = spec["immunities"]
    if spec.get("condition_immunities"):
        md["condition_immunities"] = spec["condition_immunities"]
    return md or None


async def _teardown_arena(db: AsyncSession, campaign_id: int) -> None:
    """Delete all arena entities for a campaign so re-seeding is idempotent.

    Actor Characters are removed by joining through the campaign's own tokens —
    NOT by (name + dm_user_id). seed_arena stamps each Character with the
    *seeding* user's id, which need not equal the campaign's original
    dm_user_id (the /qa/seed route does no DM check). A name+user delete would
    then skip the prior actors, leaking duplicates; and because
    token.character_id carries no FK, the survivor's token can end up pointing
    at a deleted Character (spell_cast then silently falls back to DC 8 / +0).
    Tying Character lifetime to the tokens that reference them is what makes
    re-seed truly idempotent regardless of which user re-seeds.
    """
    await _clear_runtime_instances(db, campaign_id)
    actor_char_ids = list((await db.scalars(
        select(Token.character_id).where(
            Token.campaign_id == campaign_id,
            Token.character_id.isnot(None)))).all())
    await db.execute(delete(Token).where(Token.campaign_id == campaign_id))
    await db.execute(delete(MonsterInstance).where(MonsterInstance.campaign_id == campaign_id))
    if actor_char_ids:
        await db.execute(delete(Character).where(Character.id.in_(actor_char_ids)))
    await db.flush()


async def _get_or_create_campaign(db: AsyncSession, dm_user_id: str) -> Campaign:
    # Tear down EVERY campaign sharing the arena name, not just the first match:
    # duplicates can accrue from races or earlier runs, and cleaning only one
    # would leave the siblings' stale tokens/characters to drift (dangling FKs).
    existing = list((await db.scalars(
        select(Campaign).where(Campaign.name == _campaign_name())
        .order_by(Campaign.id))).all())
    if existing:
        for camp in existing:
            await _teardown_arena(db, camp.id)
        return existing[0]
    campaign = Campaign(
        name=_campaign_name(), dm_user_id=str(dm_user_id), max_players=4,
        status="in_progress", description="QA-only spell runtime arena",
        current_map_url=C.QA_MAP_URL, meta={},
    )
    db.add(campaign)
    await db.flush()
    return campaign


async def seed_arena(db: AsyncSession, dm_user_id: str) -> dict[str, Any]:
    campaign = await _get_or_create_campaign(db, dm_user_id)
    # Tokens must live on the campaign's displayed map or they won't render.
    # Reuse the existing current_map_url (real uploaded map); fall back to the
    # QA placeholder only when the campaign has none.
    map_url = campaign.current_map_url or C.QA_MAP_URL

    # Create the six QA actors. Spellcasters know every spell with unlimited slots.
    spell_ids = _all_spell_ids()
    unlimited_slots = [0] + [99] * 9  # index 0 unused; levels 1-9 = 99 slots
    actor_ids: dict[str, int] = {}
    for spec in C.QA_ACTORS:
        knows_all = spec.get("knows_all_spells", False)
        current_hp = spec.get("current_hp", spec["max_hp"])
        actor = Character(
            user_id=str(dm_user_id), name=spec["name"],
            race_id=spec["race_id"], class_id=spec["class_id"],
            level=spec["level"], ability_scores=spec["ability_scores"],
            selected_spells=spell_ids if knows_all else [],
            prepared_spells=spell_ids if knows_all else [],
            selected_cantrips=[],
            spell_slots_state=unlimited_slots if knows_all else None,
            can_prepare_spells=knows_all, current_hp=current_hp,
            equipment=[], status_effects={},
        )
        db.add(actor)
        await db.flush()
        actor_ids[spec["key"]] = actor.id
        gx, gy = spec["grid"]
        db.add(Token(
            campaign_id=campaign.id, character_id=actor.id, user_id=str(dm_user_id),
            map_url=map_url, position_x=gx, position_y=gy, token_size="1x1",
            instance_name=spec["name"], current_hp=current_hp, faction="player",
        ))

    monster_ids: dict[str, int] = {}
    for spec in [*C.QA_MONSTERS, *C.QA_CLUSTER]:
        mi = MonsterInstance(
            campaign_id=campaign.id, monster_id=spec["monster_id"],
            name=spec["key"], name_cn=spec["name_cn"],
            armor_class=spec["ac"], hit_points=spec["hp"], current_hp=spec["hp"],
            ability_scores=spec.get("ability_scores", _default_ability_scores()),
            conditions=[], token_size="1x1", status_effects=_build_status_effects(spec),
            monster_data=_build_monster_data(spec),
        )
        db.add(mi)
        await db.flush()
        monster_ids[spec["key"]] = mi.id
        gx, gy = spec["grid"]
        db.add(Token(
            campaign_id=campaign.id, monster_instance_id=mi.id, user_id=str(dm_user_id),
            map_url=map_url, position_x=gx, position_y=gy, token_size="1x1",
            instance_name=spec["name_cn"], current_hp=spec["hp"], faction="enemy",
        ))

    await db.flush()
    return {"campaign_id": campaign.id, "actor_ids": actor_ids, "monster_ids": monster_ids}


async def _clear_runtime_instances(db: AsyncSession, campaign_id: int) -> None:
    from app.models.spell_runtime_instance import SpellRuntimeInstance
    await db.execute(delete(SpellRuntimeInstance).where(
        SpellRuntimeInstance.campaign_id == campaign_id))


async def _get_combat_row(db: AsyncSession, campaign_id: int):
    from app.models.campaign_storage import CampaignStorage
    return await db.scalar(select(CampaignStorage).where(
        CampaignStorage.campaign_id == campaign_id,
        CampaignStorage.object_type == "combat",
        CampaignStorage.object_id == "current"))


async def start_combat(db: AsyncSession, campaign_id: int, order: list[int], dm_user_id: str) -> dict:
    """Create/activate the canonical combat row so in_combat is true and turn
    triggers can fire. order is the initiative order of token ids."""
    from app.models.campaign_storage import CampaignStorage
    # Build participants (token_id + faction) so the combat object matches what the
    # real combat-start flow produces — CombatPanel reads data.participants.
    order_tokens = (await db.scalars(
        select(Token).where(Token.id.in_(list(order))))).all() if order else []
    faction_by_id = {t.id: (t.faction or "enemy") for t in order_tokens}
    participants = [{"token_id": tid, "faction": faction_by_id.get(tid, "enemy")} for tid in order]
    data = {
        "in_combat": True, "round_number": 1, "order": list(order),
        "current_index": 0, "current_turn_token_id": order[0] if order else None,
        "participants": participants, "surprise": {"enabled": False},
    }
    row = await _get_combat_row(db, campaign_id)
    if row is None:
        row = CampaignStorage(
            campaign_id=campaign_id, object_type="combat", object_id="current",
            object_name="combat", data=data, visibility="dm_only", is_active=True,
            version=1, created_by=str(dm_user_id), updated_by=str(dm_user_id))
        db.add(row)
    else:
        row.data = data
        row.is_active = True
        row.version = (row.version or 1) + 1
        row.updated_by = str(dm_user_id)
    await db.flush()
    return {"in_combat": True, "round_number": 1, "order": list(order),
            "current_turn_token_id": data["current_turn_token_id"]}


async def next_turn(db: AsyncSession, campaign_id: int) -> dict:
    """Advance to the next combatant, firing end/start-of-turn triggers via the
    same hook the storage PUT route uses."""
    from app.services.combat_turn_trigger_hooks import dispatch_combat_turn_triggers_if_changed
    row = await _get_combat_row(db, campaign_id)
    if row is None or not isinstance(row.data, dict):
        return {"error": "no active combat — call start-combat first"}
    prev_data = dict(row.data)
    prev_active = bool(row.is_active)
    data = dict(row.data)
    order = data.get("order") or []
    idx = data.get("current_index", 0) + 1
    rnd = data.get("round_number", 1)
    if order:
        if idx >= len(order):
            idx = 0
            rnd += 1
        data["current_index"] = idx
        data["round_number"] = rnd
        data["current_turn_token_id"] = order[idx]
    row.data = data
    row.version = (row.version or 1) + 1
    await db.commit()
    await db.refresh(row)
    await dispatch_combat_turn_triggers_if_changed(
        db, campaign_id=campaign_id, prev_data=prev_data, prev_is_active=prev_active,
        new_data=row.data if isinstance(row.data, dict) else None,
        new_is_active=bool(row.is_active))
    return {"round_number": rnd, "current_index": idx,
            "current_turn_token_id": data.get("current_turn_token_id")}


async def reset_arena(db: AsyncSession, campaign_id: int, spell_id: str | None = None) -> dict:
    """Restore tokens + monsters to clean fixture state. spell_id is reserved for
    per-spell overrides (none yet); default restores full HP and clears effects."""
    tokens = (await db.scalars(select(Token).where(Token.campaign_id == campaign_id))).all()
    monsters = (await db.scalars(
        select(MonsterInstance).where(MonsterInstance.campaign_id == campaign_id))).all()
    monsters_by_id = {m.id: m for m in monsters}
    # actor display name -> fixture starting HP (low/downed allies stay damaged).
    actor_hp_by_name = {a["name"]: a.get("current_hp", a["max_hp"]) for a in C.QA_ACTORS}

    # Seeded actor characters (DM-owned) — clear spell-applied conditions on them
    # too, so condition/restoration tests targeting a Character start clean.
    campaign = await db.get(Campaign, campaign_id)
    actor_chars: list[Character] = []
    if campaign is not None:
        actor_names = [a["name"] for a in C.QA_ACTORS]
        actor_chars = list((await db.scalars(select(Character).where(
            Character.user_id == str(campaign.dm_user_id),
            Character.name.in_(actor_names)))).all())

    for m in monsters:
        m.current_hp = m.hit_points
        m.conditions = []
        # Clear spell-applied conditions while keeping static fixture flags
        # (immunities / resistances seeded at creation).
        se = dict(m.status_effects or {})
        for key in _SPELL_STATE_KEYS:
            se.pop(key, None)
        m.status_effects = se
        flag_modified(m, "status_effects")

    for char in actor_chars:
        cse = dict(char.status_effects or {})
        for key in _SPELL_STATE_KEYS:
            cse.pop(key, None)
        char.status_effects = cse
        flag_modified(char, "status_effects")

    for tok in tokens:
        tok.active_effects = []
        tok.active_auras = []
        tok.temp_hp = 0
        # Per-cast token state must also return to clean fixture state, otherwise a
        # concentration / long-cast / transform / disguise left over from the prior
        # cast contaminates the next one (e.g. concentration-replacement tests).
        tok.concentration_spell = None
        tok.casting_in_progress = None
        tok.transformation_data = None
        tok.disguise_data = None
        if tok.monster_instance_id and tok.monster_instance_id in monsters_by_id:
            tok.current_hp = monsters_by_id[tok.monster_instance_id].hit_points
        elif tok.character_id and tok.instance_name in actor_hp_by_name:
            tok.current_hp = actor_hp_by_name[tok.instance_name]

    await _clear_runtime_instances(db, campaign_id)
    await db.flush()
    return {"reset": len(tokens), "spell_id": spell_id}


def _world_time_to_seconds(t: dict) -> int:
    """Total seconds for a world-time dict {day, hour, minute, second}."""
    return (
        int(t.get("day", 1)) * 86400
        + int(t.get("hour", 0)) * 3600
        + int(t.get("minute", 0)) * 60
        + int(t.get("second", 0))
    )


def _effect_is_expired(effect: dict, current_seconds: int | None) -> bool:
    """Return whether an active_effects entry is expired at current world time."""
    if current_seconds is None:
        return False
    if not isinstance(effect, dict):
        return False
    if effect.get("duration_unit") == "day":
        return False
    expires_at = effect.get("expires_at")
    if not isinstance(expires_at, dict):
        return False
    try:
        expire_seconds = _world_time_to_seconds(expires_at)
    except (TypeError, ValueError, AttributeError, OverflowError):
        return False
    return current_seconds >= expire_seconds


async def snapshot_arena(db: AsyncSession, campaign_id: int) -> dict:
    """Read-only export of arena state for evidence files.

    Raw active_effects / active_auras are preserved verbatim so QA can see
    stale residue. Semantic fields split active_effects at the current world
    time so QA can assert rule-effective state separately from cleanup residue.
    """
    campaign = await db.get(Campaign, campaign_id)
    current_world_time = None
    if campaign is not None and isinstance(campaign.meta, dict):
        tod = campaign.meta.get("time_of_day")
        if isinstance(tod, dict):
            current_world_time = tod
    current_seconds = None
    if current_world_time is not None:
        try:
            current_seconds = _world_time_to_seconds(current_world_time)
        except (TypeError, ValueError, AttributeError, OverflowError):
            current_seconds = None

    tokens = (await db.scalars(select(Token).where(Token.campaign_id == campaign_id))).all()
    monsters = (await db.scalars(
        select(MonsterInstance).where(MonsterInstance.campaign_id == campaign_id))).all()

    token_rows = []
    for t in tokens:
        raw_effects = list(t.active_effects or [])
        effective = [e for e in raw_effects if not _effect_is_expired(e, current_seconds)]
        expired = [e for e in raw_effects if _effect_is_expired(e, current_seconds)]
        token_rows.append({
            "id": t.id, "instance_name": t.instance_name,
            "character_id": t.character_id, "monster_instance_id": t.monster_instance_id,
            "current_hp": t.current_hp, "temp_hp": t.temp_hp,
            "position_x": t.position_x, "position_y": t.position_y,
            "active_effects": t.active_effects, "active_auras": t.active_auras,
            "effective_active_effects": effective,
            "expired_active_effects": expired,
            "faction": t.faction,
        })

    return {
        "campaign_id": campaign_id,
        "current_world_time": current_world_time,
        "tokens": token_rows,
        "monsters": [{
            "id": m.id, "name": m.name, "current_hp": m.current_hp,
            "hit_points": m.hit_points, "conditions": m.conditions,
        } for m in monsters],
    }
