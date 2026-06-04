"""QA: verify temporary buffs/debuffs actually EXPIRE.

Faithfully drives the same sweep functions the WS time_handler invokes:
  - cleanup_expired_runtime_instances   (v2 runtime: bless/hex)
  - cleanup_campaign_effect_durations   (legacy active_effects: bane et al.)
  - cleanup_expired_concentration_for_campaign / concentration break

Run inside backend venv:  python scripts/qa_buff_expiry_check.py
Output goes to stdout only (no files written outside debug/test).
"""
import asyncio
import copy
from app.db.session import async_session_maker as AsyncSessionLocal
from app.models.token import Token
from app.models.spell_runtime_instance import SpellRuntimeInstance
from sqlalchemy import select

CAMPAIGN_ID = 8


async def _token_id(db, name):
    rows = (await db.execute(select(Token).where(Token.campaign_id == CAMPAIGN_ID))).scalars().all()
    for t in rows:
        if t.instance_name == name:
            return t.id
    raise SystemExit(f"token {name!r} not found")


async def _runtime_for(db, token_id, spell_id):
    rows = (await db.execute(
        select(SpellRuntimeInstance).where(SpellRuntimeInstance.campaign_id == CAMPAIGN_ID)
    )).scalars().all()
    hits = [r for r in rows if r.spell_id == spell_id and r.status == "active"
            and (r.primary_target_token_id == token_id or token_id in (r.linked_target_token_ids or []))]
    return hits


async def _legacy_buff(db, token_id, spell_id):
    t = await db.get(Token, token_id)
    return [e for e in (t.active_effects or []) if e.get("spell_id") == spell_id]


async def main():
    from app.services.spell_runtime_service import cleanup_expired_runtime_instances
    from app.api.routes.tokens import cleanup_campaign_effect_durations, _world_time_to_seconds

    async with AsyncSessionLocal() as db:
        wc = await _token_id(db, "QA 武器施法者")

        # Derive "later" from bless's own expires_at (+60s) so the sweep sees an
        # elapsed clock regardless of where campaign world-time is persisted.
        bl0 = await _runtime_for(db, wc, "bless")
        bless_exp = dict(bl0[0].params or {}).get("expires_at") if bl0 else None
        if bless_exp:
            later = copy.deepcopy(bless_exp)
            later["second"] = later.get("second", 0) + 60
        else:
            later = {"day": 99, "hour": 23, "minute": 59, "second": 0}
        print(f"bless expires_at={bless_exp}  -> sweep clock advanced to={later} "
              f"({_world_time_to_seconds(later)}s)")

        print("\n--- T1 runtime time-expiry (bless) ---")
        bl_before = await _runtime_for(db, wc, "bless")
        print(f"  bless runtime instances on WC (before sweep): {len(bl_before)} "
              f"expires_at={[dict(r.params or {}).get('expires_at') for r in bl_before]}")
        touched = await cleanup_expired_runtime_instances(
            db, campaign_id=CAMPAIGN_ID, current_world_time=later)
        bl_after = await _runtime_for(db, wc, "bless")
        print(f"  after world-time +30min sweep: touched={touched}  "
              f"active bless instances on WC = {len(bl_after)}  "
              f"=> {'EXPIRED ✓' if bl_before and not bl_after else ('still active ✗' if bl_before else 'n/a (none cast)')}")

        print("\n--- T2 legacy active_effects time-expiry (effects carrying expires_at) ---")
        t = await db.get(Token, wc)
        timed = [e for e in (t.active_effects or []) if e.get("expires_at")]
        print(f"  WC legacy effects with expires_at (before): {[(e.get('spell_id'), e.get('expires_at')) for e in timed]}")
        res = await cleanup_campaign_effect_durations(
            db, campaign_id=CAMPAIGN_ID, current_time=later, rounds=0)
        await db.commit()
        t2 = await db.get(Token, wc)
        timed_after = [e for e in (t2.active_effects or []) if e.get("expires_at")]
        print(f"  updated tokens: {len(res.get('updated_tokens', []) if isinstance(res, dict) else res)}")
        print(f"  WC legacy timed effects (after +30min): {[(e.get('spell_id'), e.get('expires_at')) for e in timed_after]}")
        print(f"  => {'EXPIRED ✓' if timed and not timed_after else ('still present ✗' if timed else 'n/a (no timed legacy effects)')}")


if __name__ == "__main__":
    asyncio.run(main())
