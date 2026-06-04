import pytest
from sqlalchemy import select

from app.models.token import Token
from app.services.qa import arena_service
from app.services.qa import arena_constants as C


@pytest.mark.asyncio
async def test_seed_creates_arena(db_session):
    result = await arena_service.seed_arena(db_session, dm_user_id="1")
    assert result["campaign_id"] > 0
    # All six spec actors are seeded.
    expected_actors = {a["key"] for a in C.QA_ACTORS}
    assert expected_actors == set(result["actor_ids"])
    assert len(C.QA_ACTORS) == 6
    # 12 arena monsters + 6 cluster = 18
    assert len(result["monster_ids"]) == 18
    assert len(C.QA_MONSTERS) == 12 and len(C.QA_CLUSTER) == 6


@pytest.mark.asyncio
async def test_low_and_downed_allies_seed_damaged(db_session):
    from app.models.character import Character
    await arena_service.seed_arena(db_session, dm_user_id="1")
    low = await db_session.scalar(select(Character).where(Character.name == "QA 残血盟友"))
    downed = await db_session.scalar(select(Character).where(Character.name == "QA 倒地盟友"))
    assert low.current_hp == 10
    assert downed.current_hp == 0


@pytest.mark.asyncio
async def test_seed_caster_knows_every_spell(db_session):
    from app.models.character import Character
    await arena_service.seed_arena(db_session, dm_user_id="1")
    caster = await db_session.scalar(
        select(Character).where(Character.name == C.QA_CASTER["name"]))
    assert caster is not None
    assert len(caster.selected_spells) == 364


@pytest.mark.asyncio
async def test_reseed_is_idempotent(db_session):
    from app.models.monster_instance import MonsterInstance
    first = await arena_service.seed_arena(db_session, dm_user_id="1")
    cid = first["campaign_id"]
    await arena_service.seed_arena(db_session, dm_user_id="1")
    monsters = (await db_session.scalars(
        select(MonsterInstance).where(MonsterInstance.campaign_id == cid))).all()
    tokens = (await db_session.scalars(
        select(Token).where(Token.campaign_id == cid))).all()
    assert len(monsters) == 18  # not 36
    assert len(tokens) == 24    # 6 actors + 18 monsters, not doubled


@pytest.mark.asyncio
async def test_reseed_keeps_single_resolving_caster_token(db_session):
    """Re-seeding — even as a different user than the campaign's original dm, the
    way the browser harness does across restarts/logins — must leave exactly one
    caster token whose character_id resolves to exactly one Character. Never a
    dangling FK (spell_cast falls back to DC 8 / +0) nor an accumulating orphan."""
    from app.models.character import Character
    caster_name = C.QA_CASTER["name"]
    first = await arena_service.seed_arena(db_session, dm_user_id="1")
    cid = first["campaign_id"]
    await arena_service.seed_arena(db_session, dm_user_id="2")
    await arena_service.seed_arena(db_session, dm_user_id="2")

    caster_tokens = (await db_session.scalars(
        select(Token).where(Token.campaign_id == cid,
                             Token.instance_name == caster_name))).all()
    assert len(caster_tokens) == 1

    caster_chars = (await db_session.scalars(
        select(Character).where(Character.name == caster_name))).all()
    assert len(caster_chars) == 1  # no orphan caster leaked across user_id mismatch

    resolved = await db_session.get(Character, caster_tokens[0].character_id)
    assert resolved is not None  # token's character_id resolves to a live Character
    assert resolved.id == caster_chars[0].id


@pytest.mark.asyncio
async def test_reseed_clears_stale_duplicate_arena_campaign(db_session):
    """A second campaign sharing the arena name (left by an earlier run/race) that
    carries a DANGLING caster token — its Character row already gone, the exact
    observed prod symptom — must not survive a re-seed. Re-seeding heals every
    same-named campaign, leaving no dangling caster token anywhere."""
    from app.models.campaign import Campaign
    from app.models.character import Character
    caster_name = C.QA_CASTER["name"]
    await arena_service.seed_arena(db_session, dm_user_id="1")
    dup = Campaign(name=arena_service._campaign_name(), dm_user_id="9", max_players=4,
                   status="in_progress", description="stale dup",
                   current_map_url=C.QA_MAP_URL, meta={})
    db_session.add(dup)
    await db_session.flush()
    db_session.add(Token(campaign_id=dup.id, character_id=999999, user_id="9",
                         map_url=C.QA_MAP_URL, position_x=6, position_y=10,
                         token_size="1x1", instance_name=caster_name,
                         current_hp=200, faction="player"))
    await db_session.flush()

    await arena_service.seed_arena(db_session, dm_user_id="1")

    all_caster_tokens = (await db_session.scalars(
        select(Token).where(Token.instance_name == caster_name))).all()
    assert len(all_caster_tokens) == 1  # the stale duplicate's token is gone
    resolved = await db_session.get(Character, all_caster_tokens[0].character_id)
    assert resolved is not None  # surviving caster token resolves, no dangling FK


@pytest.mark.asyncio
async def test_reset_restores_hp_and_clears_effects(db_session):
    seeded = await arena_service.seed_arena(db_session, dm_user_id="1")
    cid = seeded["campaign_id"]
    tok = await db_session.scalar(
        select(Token).where(Token.campaign_id == cid).where(Token.monster_instance_id.isnot(None)).limit(1))
    tok.current_hp = 1
    tok.active_effects = [{"id": "stale"}]
    tok.temp_hp = 5
    await db_session.flush()
    await arena_service.reset_arena(db_session, cid, spell_id="fireball")
    await db_session.refresh(tok)
    assert tok.active_effects in (None, [])
    assert tok.temp_hp == 0
    assert tok.current_hp > 1  # restored to monster max


@pytest.mark.asyncio
async def test_snapshot_returns_tokens(db_session):
    seeded = await arena_service.seed_arena(db_session, dm_user_id="1")
    snap = await arena_service.snapshot_arena(db_session, seeded["campaign_id"])
    assert "tokens" in snap and len(snap["tokens"]) >= 19  # caster + 18 monsters
    sample = snap["tokens"][0]
    assert {"id", "current_hp", "position_x", "position_y", "active_effects"} <= set(sample)
