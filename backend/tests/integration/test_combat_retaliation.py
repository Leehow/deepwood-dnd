"""Regression tests for on_take_damage retaliation spells in combat.

Covers the bug where armor_of_agathys grants temp HP but never deals its
retaliation cold damage back to a melee attacker (the on_take_damage trigger
was declared-but-dead). Driven through the QA arena harness end-to-end:
/api/qa/seed -> /api/spells/cast -> /api/combat/attack -> /api/qa/snapshot.
"""
import pytest
from httpx import AsyncClient

from app.core.config import settings
from app.services.qa import forced_roll


def _tokens_by(snapshot: dict) -> tuple[dict, dict]:
    """Build (character_id -> token, monster_instance_id -> token) maps.

    seed_arena returns Character / MonsterInstance ids, NOT token ids, so the
    combat/cast APIs (which need token ids) must resolve them via the snapshot.
    """
    by_char: dict[int, dict] = {}
    by_monster: dict[int, dict] = {}
    for tok in snapshot["tokens"]:
        if tok.get("character_id") is not None:
            by_char[tok["character_id"]] = tok
        if tok.get("monster_instance_id") is not None:
            by_monster[tok["monster_instance_id"]] = tok
    return by_char, by_monster


@pytest.mark.asyncio
async def test_armor_of_agathys_retaliates_on_melee_hit(
    client: AsyncClient, dm_auth_headers, monkeypatch
):
    monkeypatch.setattr(settings, "QA_MODE", True)
    forced_roll.clear_forced_rolls()

    # --- seed arena + resolve token ids -------------------------------------
    seed = (await client.post("/api/qa/seed", headers=dm_auth_headers)).json()
    cid = seed["campaign_id"]
    caster_char_id = seed["actor_ids"]["qa_all_spells_caster"]
    attacker_mi_id = seed["monster_ids"]["normal_target_a"]

    snap = (await client.get(
        f"/api/qa/snapshot?campaign_id={cid}", headers=dm_auth_headers)).json()
    by_char, by_monster = _tokens_by(snap)
    caster_tid = by_char[caster_char_id]["id"]
    attacker_tid = by_monster[attacker_mi_id]["id"]
    attacker_hp_before = by_monster[attacker_mi_id]["current_hp"]  # 30

    # --- cast armor_of_agathys on the caster (self) -------------------------
    cast = await client.post(
        "/api/spells/cast",
        json={
            "spell_id": "armor_of_agathys",
            "slot_level": 1,
            "caster_token_id": caster_tid,
            "target_token_ids": [caster_tid],
            "campaign_id": cid,
            "freecast": True,
        },
        headers=dm_auth_headers,
    )
    assert cast.status_code == 200, cast.text
    assert cast.json()["success"] is True, cast.json()

    # Sanity: the on_cast phase granted 5 temp HP to the caster.
    snap = (await client.get(
        f"/api/qa/snapshot?campaign_id={cid}", headers=dm_auth_headers)).json()
    by_char, _ = _tokens_by(snap)
    assert by_char[caster_char_id]["temp_hp"] == 5

    # --- enemy makes a deterministic melee hit on the caster ----------------
    # forced_d20=15 vs target.ac=5 guarantees a hit (no fumble/crit); a 1d4
    # dagger guarantees incoming <= 4, fully absorbed by the 5 temp HP.
    attack = await client.post(
        "/api/combat/attack",
        json={
            "campaign_id": cid,
            "attacker_token_id": attacker_tid,
            "attacker_monster_instance_id": attacker_mi_id,
            "target_token_id": caster_tid,
            "attack": {
                "key": "dagger",
                "name": "匕首",
                "weapon_name": "匕首",
                "damage": "1d4",
                "damage_type": "piercing",
            },
            "distance_feet": 5,
            "attacker": {
                "name": "普通目标A",
                "level": 1,
                "ability_scores": {
                    "strength": 10, "dexterity": 10, "constitution": 10,
                    "intelligence": 10, "wisdom": 10, "charisma": 10,
                },
                "proficiency_bonus": 2,
            },
            "target": {
                "name": "QA 全法术施法者",
                "ac": 5,
                "current_hp": 200,
                "max_hp": 200,
            },
            "auto_apply": True,
            "forced_d20": 15,
        },
        headers=dm_auth_headers,
    )
    assert attack.status_code == 200, attack.text
    assert attack.json()["result"]["hit"] is True, attack.json()

    # --- assert retaliation fired ------------------------------------------
    snap = (await client.get(
        f"/api/qa/snapshot?campaign_id={cid}", headers=dm_auth_headers)).json()
    by_char, by_monster = _tokens_by(snap)
    caster_after = by_char[caster_char_id]
    attacker_after = by_monster[attacker_mi_id]

    # The attacker takes 5 cold retaliation damage (armor_of_agathys @ 1st level).
    assert attacker_after["current_hp"] == attacker_hp_before - 5
    # The caster's temp HP absorbs the incoming hit; real HP is untouched.
    assert caster_after["current_hp"] == 200
    assert caster_after["temp_hp"] < 5

    forced_roll.clear_forced_rolls()
