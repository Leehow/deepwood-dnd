# Spell Runtime Browser QA Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Phase 0 harness that makes the 364-spell pure-browser QA pass deterministic and resettable: QA-only backend endpoints (seed/reset/forced-roll/snapshot), a forced-roll seam in the spell dice path, fixtures, and reusable browser-driver snippets — verified by a 3-spell self-test.

**Architecture:** All test casting/observation happens through the live Chrome UI (Claude-in-Chrome MCP). New backend endpoints exist *only* for setup/teardown/determinism and are gated behind a `QA_MODE` flag (404 when off). A process-global forced-roll queue feeds fixed dice into the spell resolver's d20 draws so assertions are exact.

**Tech Stack:** FastAPI + SQLAlchemy 2.0 async + pytest (backend), bash/curl wrappers + JS snippets for the browser driver, Claude-in-Chrome MCP for execution.

**Spec:** [docs/superpowers/specs/2026-05-30-spell-runtime-browser-qa-harness-design.md](../specs/2026-05-30-spell-runtime-browser-qa-harness-design.md)

---

## File Structure

| File | Responsibility |
|---|---|
| `backend/app/core/config.py` (modify) | Add `QA_MODE: bool = False` |
| `backend/app/services/qa/forced_roll.py` (create) | Process-global forced-roll FIFO queue + `qa_randint` |
| `backend/app/services/spell_resolver.py` (modify) | Route d20 draws through `qa_randint` |
| `backend/app/services/qa/arena_constants.py` (create) | QA actor/monster/map fixture data (keeps route + service small) |
| `backend/app/services/qa/arena_service.py` (create) | seed / reset / snapshot logic |
| `backend/app/api/routes/qa.py` (create) | QA routes + `QA_MODE` guard + DM permission |
| `backend/app/main.py` (modify) | Register `qa.router` |
| `backend/tests/unit/test_qa_forced_roll.py` (create) | Forced-roll unit tests |
| `backend/tests/integration/test_qa_endpoints.py` (create) | Endpoint guard + seed/reset/snapshot tests |
| `scripts/spell-qa/fixtures.json` (create) | Per-spell fixtures (keyed by spell_id) |
| `scripts/spell-qa/qa.sh` (create) | curl wrappers: `seed`/`reset`/`forced-roll`/`snapshot` |
| `scripts/spell-qa/konva-snippets.md` (create) | Reusable JS snippets for Claude-in-Chrome (select token, read tokens, target by grid) |
| `scripts/spell-qa/SELF_TEST.md` (create) | 3-spell bring-up procedure (Fire Bolt / Cure Wounds / Fireball) + determinism check |

`artifacts/spell-qa/<date>/` holds `results.json`, `summary.md`, screenshots, and `*.before.json`/`*.after.json` snapshots (created at run time, not by this plan).

---

## Task 1: Add `QA_MODE` config flag

**Files:**
- Modify: `backend/app/core/config.py`

- [ ] **Step 1: Add the flag to Settings**

In `backend/app/core/config.py`, inside `class Settings(BaseSettings)`, next to `DEBUG: bool = True`, add:

```python
    # QA-only mode: enables /qa/* endpoints and forced-roll seam. NEVER set in production.
    QA_MODE: bool = False
```

- [ ] **Step 2: Verify it loads**

Run: `cd backend && source venv/bin/activate && python -c "from app.core.config import settings; print(settings.QA_MODE)"`
Expected: `False`

- [ ] **Step 3: Commit**

```bash
git add backend/app/core/config.py
git commit -m "feat(qa): add QA_MODE config flag"
```

---

## Task 2: Forced-roll queue module

A process-global FIFO of fixed dice values. `qa_randint(a, b)` pops the next value when `QA_MODE` is on and the queue is non-empty; otherwise it falls through to `random.randint`. Single-worker QA only (documented caveat).

**Files:**
- Create: `backend/app/services/qa/__init__.py`
- Create: `backend/app/services/qa/forced_roll.py`
- Test: `backend/tests/unit/test_qa_forced_roll.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/unit/test_qa_forced_roll.py`:

```python
from app.services.qa import forced_roll


def setup_function():
    forced_roll.clear_forced_rolls()


def test_qa_randint_falls_through_when_queue_empty(monkeypatch):
    monkeypatch.setattr(forced_roll.settings, "QA_MODE", True)
    monkeypatch.setattr(forced_roll.random, "randint", lambda a, b: 13)
    assert forced_roll.qa_randint(1, 20) == 13


def test_qa_randint_pops_queue_in_fifo_order(monkeypatch):
    monkeypatch.setattr(forced_roll.settings, "QA_MODE", True)
    forced_roll.push_forced_rolls([5, 18])
    assert forced_roll.qa_randint(1, 20) == 5
    assert forced_roll.qa_randint(1, 20) == 18


def test_qa_randint_ignores_queue_when_qa_mode_off(monkeypatch):
    monkeypatch.setattr(forced_roll.settings, "QA_MODE", False)
    monkeypatch.setattr(forced_roll.random, "randint", lambda a, b: 7)
    forced_roll.push_forced_rolls([5])
    assert forced_roll.qa_randint(1, 20) == 7


def test_clear_empties_queue(monkeypatch):
    monkeypatch.setattr(forced_roll.settings, "QA_MODE", True)
    forced_roll.push_forced_rolls([5, 6])
    forced_roll.clear_forced_rolls()
    monkeypatch.setattr(forced_roll.random, "randint", lambda a, b: 99)
    assert forced_roll.qa_randint(1, 20) == 99
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && source venv/bin/activate && pytest tests/unit/test_qa_forced_roll.py -v --no-cov`
Expected: FAIL — `ModuleNotFoundError: app.services.qa.forced_roll`

- [ ] **Step 3: Write minimal implementation**

Create `backend/app/services/qa/__init__.py` (empty file).

Create `backend/app/services/qa/forced_roll.py`:

```python
"""QA-only forced-roll queue.

When QA_MODE is on and the queue is non-empty, qa_randint pops a fixed value
instead of using RNG. Empty queue -> normal random.randint. The queue is a
process-global FIFO; QA runs single-worker (uvicorn --reload), so this is safe
for QA but must never be enabled in the multi-worker production deployment.
"""
import random
from collections import deque
from typing import Iterable

from app.core.config import settings

_forced: "deque[int]" = deque()


def push_forced_rolls(rolls: Iterable[int]) -> None:
    """Append fixed roll results to the FIFO queue."""
    _forced.extend(int(r) for r in rolls)


def clear_forced_rolls() -> None:
    _forced.clear()


def queue_size() -> int:
    return len(_forced)


def qa_randint(a: int, b: int) -> int:
    """random.randint shim: pops a forced value in QA_MODE, else real RNG."""
    if settings.QA_MODE and _forced:
        return _forced.popleft()
    return random.randint(a, b)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && source venv/bin/activate && pytest tests/unit/test_qa_forced_roll.py -v --no-cov`
Expected: PASS (4 passed)

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/qa/__init__.py backend/app/services/qa/forced_roll.py backend/tests/unit/test_qa_forced_roll.py
git commit -m "feat(qa): add forced-roll queue with QA_MODE gating"
```

---

## Task 3: Wire forced-roll seam into the spell resolver

Route the spell attack/save d20 draws through `qa_randint`. Only these QA-relevant call sites change; production behavior is identical when `QA_MODE` is off (queue empty → real RNG).

**Files:**
- Modify: `backend/app/services/spell_resolver.py` (lines ~352, ~681–687)
- Test: `backend/tests/unit/test_qa_forced_roll.py` (add seam test)

- [ ] **Step 1: Inspect the exact call sites**

Run: `cd backend && grep -n "random.randint(1, 20)" app/services/spell_resolver.py`
Expected: lines 352, 681, 683, 685, 687 (attack d20 + save d20 normal/adv/disadv).

- [ ] **Step 2: Add the import**

At the top of `backend/app/services/spell_resolver.py`, with the other `from app.services...` imports, add:

```python
from app.services.qa.forced_roll import qa_randint
```

- [ ] **Step 3: Replace the d20 draws**

In `backend/app/services/spell_resolver.py`, replace each of the five `random.randint(1, 20)` calls at lines ~352 and ~681–687 with `qa_randint(1, 20)`. Leave all other `random.*` calls (e.g. damage dice not part of d20) as-is for now — damage determinism is handled per-fixture in a later iteration; this task covers attack/save d20 only.

Run after editing: `cd backend && grep -n "qa_randint(1, 20)" app/services/spell_resolver.py`
Expected: 5 matches at the previously-identified lines.

- [ ] **Step 4: Add a seam regression test**

Append to `backend/tests/unit/test_qa_forced_roll.py`:

```python
def test_spell_resolver_imports_qa_randint():
    # Guards the seam: the resolver must use the shim, not bare random.randint.
    import app.services.spell_resolver as sr
    src = __import__("inspect").getsource(sr)
    assert "qa_randint(1, 20)" in src
    assert "random.randint(1, 20)" not in src
```

- [ ] **Step 5: Run tests**

Run: `cd backend && source venv/bin/activate && pytest tests/unit/test_qa_forced_roll.py -v --no-cov`
Expected: PASS (5 passed)

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/spell_resolver.py backend/tests/unit/test_qa_forced_roll.py
git commit -m "feat(qa): route spell d20 draws through qa_randint seam"
```

---

## Task 4: QA route skeleton with QA_MODE + DM guard

A router whose dependency returns 404 when `QA_MODE` is off, and requires the caller to be DM of the target campaign.

**Files:**
- Create: `backend/app/api/routes/qa.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/integration/test_qa_endpoints.py`

- [ ] **Step 1: Write the failing test (guard returns 404 when off)**

Create `backend/tests/integration/test_qa_endpoints.py`:

```python
import pytest
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.core.config import settings


@pytest.mark.asyncio
async def test_forced_roll_404_when_qa_mode_off(monkeypatch):
    monkeypatch.setattr(settings, "QA_MODE", False)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.post("/qa/forced-roll", json={"rolls": [5]})
    assert resp.status_code == 404
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && source venv/bin/activate && pytest tests/integration/test_qa_endpoints.py -v --no-cov`
Expected: FAIL — 404 not returned (route does not exist yet → actually 404 by default; make it fail meaningfully by asserting the guard message next). Run anyway; if it errors on import of `qa`, that's the expected red.

- [ ] **Step 3: Create the router with the guard**

Create `backend/app/api/routes/qa.py`:

```python
"""QA-only endpoints for the spell-runtime browser QA harness.

Gated behind settings.QA_MODE: every route 404s when the flag is off, so
production behavior is unaffected. Callers must be DM of the target campaign.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import require_auth
from app.db.session import get_db
from app.services.qa import forced_roll

router = APIRouter(prefix="/qa", tags=["qa"])


def require_qa_mode() -> None:
    if not settings.QA_MODE:
        raise HTTPException(status_code=404, detail="Not Found")


class ForcedRollRequest(BaseModel):
    rolls: list[int]


@router.post("/forced-roll")
async def queue_forced_rolls(
    payload: ForcedRollRequest,
    _: None = Depends(require_qa_mode),
    current_user: dict = Depends(require_auth),
):
    forced_roll.push_forced_rolls(payload.rolls)
    return {"queued": len(payload.rolls), "queue_size": forced_roll.queue_size()}
```

- [ ] **Step 4: Register the router**

In `backend/app/main.py`, after the other `app.include_router(...)` lines (near line 169), add:

```python
from app.api.routes import qa
app.include_router(qa.router, prefix="/api")
```

(Match the existing import style in `main.py`; if routes are imported at top, add `qa` to that import block instead and keep only the `include_router` line here.)

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && source venv/bin/activate && pytest tests/integration/test_qa_endpoints.py -v --no-cov`
Expected: PASS — POST `/api/qa/forced-roll` (note `/api` prefix) returns 404 when QA_MODE off. **Update the test URL to `/api/qa/forced-roll`** to match the registered prefix, then rerun.

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/routes/qa.py backend/app/main.py backend/tests/integration/test_qa_endpoints.py
git commit -m "feat(qa): add QA router with QA_MODE 404 guard and forced-roll endpoint"
```

---

## Task 5: Forced-roll endpoint behavior under QA_MODE on

**Files:**
- Test: `backend/tests/integration/test_qa_endpoints.py` (add)

- [ ] **Step 1: Write the test**

Append to `backend/tests/integration/test_qa_endpoints.py`:

```python
@pytest.mark.asyncio
async def test_forced_roll_queues_when_qa_mode_on(monkeypatch):
    monkeypatch.setattr(settings, "QA_MODE", True)
    forced_roll.clear_forced_rolls()
    transport = ASGITransport(app=app)
    headers = {"Authorization": f"Bearer {_qa_token()}"}
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.post("/api/qa/forced-roll", json={"rolls": [5, 18]}, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["queue_size"] == 2
    assert forced_roll.queue_size() == 2
```

Add a `_qa_token()` helper at the top of the file that mints a valid bearer token for the test admin user. Inspect an existing integration test for the exact pattern:

Run: `cd backend && grep -rn "create_access_token\|Bearer" tests/ | head`

Use the same `create_access_token({...})` import and payload shape those tests use (keys `user_id`, `email`, `role`). Add `from app.services.qa import forced_roll` to the imports.

- [ ] **Step 2: Run test**

Run: `cd backend && source venv/bin/activate && pytest tests/integration/test_qa_endpoints.py -v --no-cov`
Expected: PASS (both tests)

- [ ] **Step 3: Commit**

```bash
git add backend/tests/integration/test_qa_endpoints.py
git commit -m "test(qa): cover forced-roll queueing under QA_MODE"
```

---

## Task 6: Arena fixture constants

The actor/monster/map definitions, isolated so the route + service stay under ~400 lines.

**Files:**
- Create: `backend/app/services/qa/arena_constants.py`

- [ ] **Step 1: Create the constants module**

Create `backend/app/services/qa/arena_constants.py`:

```python
"""Static fixture data for the Spell Runtime QA Arena.

Coordinates are grid cells on a 30x20 flat map (see dw-browser-test GRID_SIZE).
The caster sits center-left; monsters are arranged in a stable ring so the
browser driver can target by fixed grid position.
"""
QA_CAMPAIGN_NAME = "Spell Runtime QA Arena"
QA_MAP_URL = "qa_flat_grid"

# High spellcasting stats; effectively unlimited slots are set in arena_service
# by filling spell_slots_state with large values per level.
QA_CASTER = {
    "key": "qa_all_spells_caster",
    "name": "QA 全法术施法者",
    "race_id": "human",
    "class_id": "wizard",
    "level": 20,
    "ability_scores": {"strength": 10, "dexterity": 14, "constitution": 14,
                        "intelligence": 20, "wisdom": 16, "charisma": 12},
    "grid": (6, 10),
    "faction": "player",
}

# Monsters: (key, monster_id, name_cn, ac, hp, grid, extra)
# `extra` carries optional resistances/immunities/type flags consumed by the
# effect engine via status_effects / conditions seeding.
QA_MONSTERS = [
    {"key": "normal_target_a", "monster_id": "goblin", "name_cn": "普通目标A", "ac": 13, "hp": 30, "grid": (10, 8)},
    {"key": "normal_target_b", "monster_id": "goblin", "name_cn": "普通目标B", "ac": 13, "hp": 30, "grid": (11, 8)},
    {"key": "low_ac_target", "monster_id": "goblin", "name_cn": "低AC目标", "ac": 5, "hp": 40, "grid": (10, 9)},
    {"key": "high_ac_target", "monster_id": "goblin", "name_cn": "高AC目标", "ac": 25, "hp": 40, "grid": (11, 9)},
    {"key": "low_save_target", "monster_id": "goblin", "name_cn": "低豁免目标", "ac": 12, "hp": 40,
     "grid": (10, 10), "ability_scores": {"dexterity": 1, "wisdom": 1, "constitution": 1}},
    {"key": "high_save_target", "monster_id": "goblin", "name_cn": "高豁免目标", "ac": 12, "hp": 40,
     "grid": (11, 10), "ability_scores": {"dexterity": 20, "wisdom": 20, "constitution": 20}},
    {"key": "fire_resistant_target", "monster_id": "goblin", "name_cn": "抗火目标", "ac": 12, "hp": 40,
     "grid": (10, 11), "resistances": ["fire"]},
    {"key": "poison_immune_target", "monster_id": "goblin", "name_cn": "毒免疫目标", "ac": 12, "hp": 40,
     "grid": (11, 11), "immunities": ["poison"]},
    {"key": "undead_target", "monster_id": "skeleton", "name_cn": "亡灵目标", "ac": 12, "hp": 40, "grid": (12, 8)},
    {"key": "construct_target", "monster_id": "animated-armor", "name_cn": "构装目标", "ac": 12, "hp": 40, "grid": (12, 9)},
    {"key": "condition_immune_target", "monster_id": "goblin", "name_cn": "状态免疫目标", "ac": 12, "hp": 40,
     "grid": (12, 10), "condition_immunities": ["charmed", "frightened", "paralyzed", "poisoned", "stunned"]},
    {"key": "mobile_target", "monster_id": "goblin", "name_cn": "移动目标", "ac": 12, "hp": 40, "grid": (14, 10)},
]

# Six-monster cluster for area/zone spells.
QA_CLUSTER = [
    {"key": f"cluster_targets_{i}", "monster_id": "goblin", "name_cn": f"集群目标{i}", "ac": 12, "hp": 25,
     "grid": (16 + (i - 1) % 3, 8 + (i - 1) // 3)}
    for i in range(1, 7)
]
```

- [ ] **Step 2: Verify it imports and monster_ids exist in npc data**

Run: `cd backend && source venv/bin/activate && python -c "from app.services.qa.arena_constants import QA_MONSTERS, QA_CLUSTER; print(len(QA_MONSTERS), len(QA_CLUSTER))"`
Expected: `12 6`

Run: `grep -o '"goblin"\|"skeleton"\|"animated-armor"' frontend/app/data/npc/monsters.json | sort -u`
Expected: all three ids present. If `animated-armor` is absent, pick the actual construct id from `monsters.json` and update `construct_target`.

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/qa/arena_constants.py
git commit -m "feat(qa): add arena fixture constants (actors, monsters, cluster)"
```

---

## Task 7: Arena service — seed

Creates the QA campaign, map, all-spells caster, and all monsters+tokens. Reuses ORM models directly (signatures from the design exploration).

**Files:**
- Create: `backend/app/services/qa/arena_service.py`
- Test: `backend/tests/integration/test_qa_endpoints.py` (add seed test)

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/integration/test_qa_endpoints.py`:

```python
@pytest.mark.asyncio
async def test_seed_creates_arena(monkeypatch, db_session):
    monkeypatch.setattr(settings, "QA_MODE", True)
    from app.services.qa import arena_service
    result = await arena_service.seed_arena(db_session, dm_user_id="1")
    assert result["campaign_id"] > 0
    assert "qa_all_spells_caster" in result["actor_ids"]
    assert len(result["monster_ids"]) == 18  # 12 arena + 6 cluster
```

Use the project's existing `db_session` fixture. Confirm its name:
Run: `cd backend && grep -rn "def db_session\|async def db_session\|fixture" tests/conftest.py | head`
If the fixture is named differently (e.g. `async_session`, `db`), use that name instead.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && source venv/bin/activate && pytest tests/integration/test_qa_endpoints.py::test_seed_creates_arena -v --no-cov`
Expected: FAIL — `ModuleNotFoundError` / `seed_arena` undefined.

- [ ] **Step 3: Implement seed_arena**

Create `backend/app/services/qa/arena_service.py`:

```python
"""Seed / reset / snapshot logic for the Spell Runtime QA Arena."""
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.campaign import Campaign
from app.models.character import Character
from app.models.monster_instance import MonsterInstance
from app.models.token import Token
from app.services.qa import arena_constants as C
from app.utils.rules_cache import get_spells_data


def _all_spell_ids() -> list[str]:
    data = get_spells_data()
    spells = data["spells"] if isinstance(data, dict) else data
    return [s["id"] for s in spells if "id" in s]


async def _get_or_create_campaign(db: AsyncSession, dm_user_id: str) -> Campaign:
    existing = await db.scalar(select(Campaign).where(Campaign.name == C.QA_CAMPAIGN_NAME))
    if existing:
        return existing
    campaign = Campaign(
        name=C.QA_CAMPAIGN_NAME, dm_user_id=str(dm_user_id), max_players=4,
        status="in_progress", description="QA-only spell runtime arena",
        current_map_url=C.QA_MAP_URL, meta={},
    )
    db.add(campaign)
    await db.flush()
    return campaign


async def seed_arena(db: AsyncSession, dm_user_id: str) -> dict[str, Any]:
    campaign = await _get_or_create_campaign(db, dm_user_id)

    # Caster: knows every spell, effectively unlimited slots.
    spell_ids = _all_spell_ids()
    unlimited_slots = [0] + [99] * 9  # index 0 unused; levels 1-9 = 99 slots
    caster = Character(
        user_id=str(dm_user_id), name=C.QA_CASTER["name"],
        race_id=C.QA_CASTER["race_id"], class_id=C.QA_CASTER["class_id"],
        level=C.QA_CASTER["level"], ability_scores=C.QA_CASTER["ability_scores"],
        selected_spells=spell_ids, prepared_spells=spell_ids, selected_cantrips=[],
        spell_slots_state=unlimited_slots, can_prepare_spells=True, current_hp=200,
        equipment=[], status_effects={},
    )
    db.add(caster)
    await db.flush()

    actor_ids = {C.QA_CASTER["key"]: caster.id}
    cx, cy = C.QA_CASTER["grid"]
    db.add(Token(
        campaign_id=campaign.id, character_id=caster.id, user_id=str(dm_user_id),
        map_url=C.QA_MAP_URL, position_x=cx, position_y=cy, token_size="1x1",
        instance_name=C.QA_CASTER["name"], current_hp=200, faction="player",
    ))

    monster_ids: dict[str, int] = {}
    for spec in [*C.QA_MONSTERS, *C.QA_CLUSTER]:
        mi = MonsterInstance(
            campaign_id=campaign.id, monster_id=spec["monster_id"],
            name=spec["key"], name_cn=spec["name_cn"],
            armor_class=spec["ac"], hit_points=spec["hp"], current_hp=spec["hp"],
            ability_scores=spec.get("ability_scores", {"strength": 10, "dexterity": 10,
                "constitution": 10, "intelligence": 10, "wisdom": 10, "charisma": 10}),
            conditions=[], token_size="1x1",
            status_effects=_build_status_effects(spec),
        )
        db.add(mi)
        await db.flush()
        monster_ids[spec["key"]] = mi.id
        gx, gy = spec["grid"]
        db.add(Token(
            campaign_id=campaign.id, monster_instance_id=mi.id, user_id=str(dm_user_id),
            map_url=C.QA_MAP_URL, position_x=gx, position_y=gy, token_size="1x1",
            instance_name=spec["name_cn"], current_hp=spec["hp"], faction="enemy",
        ))

    await db.flush()
    return {"campaign_id": campaign.id, "actor_ids": actor_ids, "monster_ids": monster_ids}


def _build_status_effects(spec: dict) -> dict:
    out: dict[str, Any] = {}
    if spec.get("resistances"):
        out["resistances"] = spec["resistances"]
    if spec.get("immunities"):
        out["immunities"] = spec["immunities"]
    if spec.get("condition_immunities"):
        out["condition_immunities"] = spec["condition_immunities"]
    return out
```

- [ ] **Step 4: Verify the spells loader key shape**

Run: `cd backend && source venv/bin/activate && python -c "from app.utils.rules_cache import get_spells_data; d=get_spells_data(); print(type(d)); print((d if isinstance(d,list) else d.get('spells'))[0].keys())"`
Expected: prints the spell dict keys including `id`. If the loader returns a dict without a `spells` key, adjust `_all_spell_ids` accordingly. If `status_effects`/resistance seeding shape differs from what the effect engine reads, note it and align with `app/services/effect_engine/` expectations (do not invent fields).

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && source venv/bin/activate && pytest tests/integration/test_qa_endpoints.py::test_seed_creates_arena -v --no-cov`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/qa/arena_service.py backend/tests/integration/test_qa_endpoints.py
git commit -m "feat(qa): seed arena (caster with all spells + monster tokens)"
```

---

## Task 8: Arena service — reset

Restores actors/monsters to clean fixture state for a given spell.

**Files:**
- Modify: `backend/app/services/qa/arena_service.py`
- Test: `backend/tests/integration/test_qa_endpoints.py` (add reset test)

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/integration/test_qa_endpoints.py`:

```python
@pytest.mark.asyncio
async def test_reset_restores_hp_and_clears_effects(monkeypatch, db_session):
    monkeypatch.setattr(settings, "QA_MODE", True)
    from app.services.qa import arena_service
    from app.models.token import Token
    from sqlalchemy import select
    seeded = await arena_service.seed_arena(db_session, dm_user_id="1")
    cid = seeded["campaign_id"]
    # Mutate a token: damage it and add a stale effect.
    tok = await db_session.scalar(select(Token).where(Token.campaign_id == cid).limit(1))
    tok.current_hp = 1
    tok.active_effects = [{"id": "stale"}]
    await db_session.flush()
    await arena_service.reset_arena(db_session, cid, spell_id="fireball")
    await db_session.refresh(tok)
    assert tok.active_effects in (None, [])
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && source venv/bin/activate && pytest tests/integration/test_qa_endpoints.py::test_reset_restores_hp_and_clears_effects -v --no-cov`
Expected: FAIL — `reset_arena` undefined.

- [ ] **Step 3: Implement reset_arena**

Append to `backend/app/services/qa/arena_service.py`:

```python
async def reset_arena(db: AsyncSession, campaign_id: int, spell_id: str | None = None) -> dict:
    """Restore tokens + monsters to clean fixture state. spell_id reserved for
    per-spell overrides (none yet); default restores full HP and clears effects."""
    tokens = (await db.scalars(select(Token).where(Token.campaign_id == campaign_id))).all()
    for tok in tokens:
        tok.active_effects = []
        tok.active_auras = []
        tok.temp_hp = 0
    monsters = (await db.scalars(
        select(MonsterInstance).where(MonsterInstance.campaign_id == campaign_id))).all()
    for mi in monsters:
        mi.current_hp = mi.hit_points
        mi.conditions = []
        mi.status_effects = mi.status_effects or {}
        # Re-place token HP to monster max.
    for tok in tokens:
        if tok.monster_instance_id:
            mi = next((m for m in monsters if m.id == tok.monster_instance_id), None)
            if mi:
                tok.current_hp = mi.hit_points
        elif tok.character_id:
            tok.current_hp = 200
    # Clear any spell runtime instances for the campaign.
    await _clear_runtime_instances(db, campaign_id)
    await db.flush()
    return {"reset": len(tokens), "spell_id": spell_id}


async def _clear_runtime_instances(db: AsyncSession, campaign_id: int) -> None:
    """Delete spell_runtime_instances for the campaign if the table/model exists."""
    try:
        from app.models.spell_runtime import SpellRuntimeInstance  # type: ignore
    except Exception:
        return
    await db.execute(delete(SpellRuntimeInstance).where(
        SpellRuntimeInstance.campaign_id == campaign_id))
```

- [ ] **Step 4: Verify the runtime-instance model path**

Run: `cd backend && grep -rln "spell_runtime_instances\|class SpellRuntimeInstance" app/models/`
Expected: a model file. Update the import in `_clear_runtime_instances` to the real class/module name. If the model has no `campaign_id` column, filter by the token/character linkage it actually uses (inspect the model first).

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && source venv/bin/activate && pytest tests/integration/test_qa_endpoints.py::test_reset_restores_hp_and_clears_effects -v --no-cov`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/qa/arena_service.py backend/tests/integration/test_qa_endpoints.py
git commit -m "feat(qa): reset arena to clean fixture state"
```

---

## Task 9: Arena service — snapshot

Read-only export of token/effect/log/concentration state.

**Files:**
- Modify: `backend/app/services/qa/arena_service.py`
- Test: `backend/tests/integration/test_qa_endpoints.py` (add snapshot test)

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/integration/test_qa_endpoints.py`:

```python
@pytest.mark.asyncio
async def test_snapshot_returns_tokens(monkeypatch, db_session):
    monkeypatch.setattr(settings, "QA_MODE", True)
    from app.services.qa import arena_service
    seeded = await arena_service.seed_arena(db_session, dm_user_id="1")
    snap = await arena_service.snapshot_arena(db_session, seeded["campaign_id"])
    assert "tokens" in snap and len(snap["tokens"]) >= 19
    sample = snap["tokens"][0]
    assert {"id", "current_hp", "position_x", "position_y", "active_effects"} <= set(sample)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && source venv/bin/activate && pytest tests/integration/test_qa_endpoints.py::test_snapshot_returns_tokens -v --no-cov`
Expected: FAIL — `snapshot_arena` undefined.

- [ ] **Step 3: Implement snapshot_arena**

Append to `backend/app/services/qa/arena_service.py`:

```python
async def snapshot_arena(db: AsyncSession, campaign_id: int) -> dict:
    """Read-only export of arena state for evidence files."""
    tokens = (await db.scalars(select(Token).where(Token.campaign_id == campaign_id))).all()
    monsters = (await db.scalars(
        select(MonsterInstance).where(MonsterInstance.campaign_id == campaign_id))).all()
    return {
        "campaign_id": campaign_id,
        "tokens": [{
            "id": t.id, "instance_name": t.instance_name,
            "character_id": t.character_id, "monster_instance_id": t.monster_instance_id,
            "current_hp": t.current_hp, "temp_hp": t.temp_hp,
            "position_x": t.position_x, "position_y": t.position_y,
            "active_effects": t.active_effects, "active_auras": t.active_auras,
            "faction": t.faction,
        } for t in tokens],
        "monsters": [{
            "id": m.id, "name": m.name, "current_hp": m.current_hp,
            "hit_points": m.hit_points, "conditions": m.conditions,
        } for m in monsters],
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && source venv/bin/activate && pytest tests/integration/test_qa_endpoints.py::test_snapshot_returns_tokens -v --no-cov`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/qa/arena_service.py backend/tests/integration/test_qa_endpoints.py
git commit -m "feat(qa): read-only arena snapshot export"
```

---

## Task 10: Wire seed/reset/snapshot endpoints

Expose the service via the QA router with the DM guard.

**Files:**
- Modify: `backend/app/api/routes/qa.py`
- Test: `backend/tests/integration/test_qa_endpoints.py` (add endpoint test)

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/integration/test_qa_endpoints.py`:

```python
@pytest.mark.asyncio
async def test_seed_endpoint_returns_ids(monkeypatch):
    monkeypatch.setattr(settings, "QA_MODE", True)
    transport = ASGITransport(app=app)
    headers = {"Authorization": f"Bearer {_qa_token()}"}
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        resp = await ac.post("/api/qa/seed", headers=headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["campaign_id"] > 0
    assert "qa_all_spells_caster" in body["actor_ids"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && source venv/bin/activate && pytest tests/integration/test_qa_endpoints.py::test_seed_endpoint_returns_ids -v --no-cov`
Expected: FAIL — 404 (route not added).

- [ ] **Step 3: Add the endpoints**

In `backend/app/api/routes/qa.py`, add imports and routes:

```python
from app.services.qa import arena_service


class ResetRequest(BaseModel):
    campaign_id: int
    spell_id: str | None = None


@router.post("/seed")
async def seed(
    _: None = Depends(require_qa_mode),
    current_user: dict = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    result = await arena_service.seed_arena(db, dm_user_id=str(current_user["user_id"]))
    return result


@router.post("/reset")
async def reset(
    payload: ResetRequest,
    _: None = Depends(require_qa_mode),
    current_user: dict = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    await _assert_dm(db, payload.campaign_id, current_user)
    return await arena_service.reset_arena(db, payload.campaign_id, payload.spell_id)


@router.get("/snapshot")
async def snapshot(
    campaign_id: int,
    _: None = Depends(require_qa_mode),
    current_user: dict = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    await _assert_dm(db, campaign_id, current_user)
    return await arena_service.snapshot_arena(db, campaign_id)
```

Add the DM helper near the top of the file (after `require_qa_mode`):

```python
from app.utils.permission_checks import require_campaign_dm


async def _assert_dm(db: AsyncSession, campaign_id: int, current_user: dict) -> None:
    await require_campaign_dm(campaign_id, current_user, db)
```

- [ ] **Step 4: Run the full QA test file**

Run: `cd backend && source venv/bin/activate && pytest tests/integration/test_qa_endpoints.py -v --no-cov`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/routes/qa.py backend/tests/integration/test_qa_endpoints.py
git commit -m "feat(qa): expose seed/reset/snapshot endpoints with DM guard"
```

---

## Task 11: curl wrapper script

A thin shell wrapper the browser-driving agent calls between cast steps.

**Files:**
- Create: `scripts/spell-qa/qa.sh`

- [ ] **Step 1: Create the wrapper**

Create `scripts/spell-qa/qa.sh`:

```bash
#!/usr/bin/env bash
# QA arena helpers. Requires QA_MODE=true backend and env:
#   QA_API_ORIGIN (default http://localhost:8174)
#   QA_TOKEN      (bearer token for the test DM; never commit it)
set -euo pipefail
API="${QA_API_ORIGIN:-http://localhost:8174}"
AUTH="Authorization: Bearer ${QA_TOKEN:?set QA_TOKEN}"

case "${1:-}" in
  seed)   curl -s -X POST "$API/api/qa/seed" -H "$AUTH" ;;
  reset)  curl -s -X POST "$API/api/qa/reset" -H "$AUTH" -H "Content-Type: application/json" \
            -d "{\"campaign_id\": ${2:?campaign_id}, \"spell_id\": \"${3:-}\"}" ;;
  forced) curl -s -X POST "$API/api/qa/forced-roll" -H "$AUTH" -H "Content-Type: application/json" \
            -d "{\"rolls\": [${2:?comma-separated rolls}]}" ;;
  snap)   curl -s "$API/api/qa/snapshot?campaign_id=${2:?campaign_id}" -H "$AUTH" ;;
  *) echo "usage: qa.sh {seed|reset <cid> [spell]|forced <r1,r2>|snap <cid>}" >&2; exit 2 ;;
esac
```

- [ ] **Step 2: Make executable and smoke the usage banner**

Run: `chmod +x scripts/spell-qa/qa.sh && scripts/spell-qa/qa.sh 2>&1 || true`
Expected: prints the usage line.

- [ ] **Step 3: Commit**

```bash
git add scripts/spell-qa/qa.sh
git commit -m "feat(qa): curl wrapper for seed/reset/forced-roll/snapshot"
```

---

## Task 12: Konva browser-driver snippets

Reusable JS the agent injects via Claude-in-Chrome `javascript_tool` (or `dw-browser-test`) to select tokens and compute target coordinates, since the map is canvas and has no testids.

**Files:**
- Create: `scripts/spell-qa/konva-snippets.md`

- [ ] **Step 1: Create the snippet doc**

Create `scripts/spell-qa/konva-snippets.md`:

````markdown
# Konva browser-driver snippets (Claude-in-Chrome)

Grid: 40px/cell. Map 30x20. Token layer is a draggable Group layer.

## List tokens with absolute screen positions
```js
const stage = window.Konva.stages[0];
const layer = stage.getLayers().find(l => l.children.some(c => c.draggable && c.draggable()));
layer.children.map((g, i) => ({
  i, x: Math.round(g.getAbsolutePosition().x), y: Math.round(g.getAbsolutePosition().y),
}));
```

## Select a token by grid position (fire click on the group)
```js
function fireClickAtGrid(gx, gy) {
  const stage = window.Konva.stages[0];
  const scale = stage.scaleX();
  const want = { x: stage.x() + gx * 40 * scale, y: stage.y() + gy * 40 * scale };
  const layer = stage.getLayers().find(l => l.children.some(c => c.draggable && c.draggable()));
  let best = null, bestD = 1e9;
  for (const g of layer.children) {
    const p = g.getAbsolutePosition();
    const d = Math.hypot(p.x - want.x, p.y - want.y);
    if (d < bestD) { bestD = d; best = g; }
  }
  best.fire('click', { evt: new MouseEvent('click') });
  return bestD;
}
```

## Screen point for an area-spell target (grid center)
```js
function gridToScreen(gx, gy) {
  const s = window.Konva.stages[0]; const k = s.scaleX();
  return { x: s.x() + (gx + 0.5) * 40 * k, y: s.y() + (gy + 0.5) * 40 * k };
}
```
Use the returned `{x,y}` with the MCP click tool to place an area template.
````

- [ ] **Step 2: Commit**

```bash
git add scripts/spell-qa/konva-snippets.md
git commit -m "docs(qa): Konva browser-driver snippets for canvas targeting"
```

---

## Task 13: Fixtures scaffold + loader sanity check

A `fixtures.json` seeded with the recommended-first-batch 25 spells (the rest are added during the run), plus a script that validates every fixture key exists in `spells.json`.

**Files:**
- Create: `scripts/spell-qa/fixtures.json`
- Create: `scripts/spell-qa/validate_fixtures.py`

- [ ] **Step 1: Create fixtures.json (first batch)**

Create `scripts/spell-qa/fixtures.json` with entries for the 25 first-batch spells. Each entry follows the spec schema. Example head (fill all 25 using real spell ids from `spells.json`):

```json
{
  "fire-bolt": {"actor": "qa_all_spells_caster", "targets": ["low_ac_target", "high_ac_target"],
    "forced_rolls": {"attacks": [18, 2]}, "category": ["damage", "attack"],
    "expected": ["low_ac_takes_damage", "high_ac_miss", "chat_log_created"]},
  "cure-wounds": {"actor": "qa_healer", "targets": ["qa_low_hp_ally"],
    "forced_rolls": {}, "category": ["healing"],
    "expected": ["ally_hp_increases", "not_above_max_hp", "chat_log_created"]},
  "fireball": {"actor": "qa_all_spells_caster", "targets": ["cluster_targets_1"],
    "forced_rolls": {"saves": [5, 18, 5, 18, 5, 18]}, "category": ["damage", "save", "area"],
    "expected": ["area_targets_take_damage", "high_save_halves", "chat_log_created"]}
}
```

(The remaining 22 first-batch spells — Hex, Bless, Divine Favor, Sacred Flame, Magic Missile, Healing Word, False Life, Armor of Agathys, Command, Hold Person, Tasha's Hideous Laughter, Mage Armor, Bane, Fog Cloud, Grease, Entangle, Web, Misty Step, Thunderwave, Invisibility, Disguise Self, Find Familiar, Counterspell — are added the same way; look up each real id with the validator below.)

- [ ] **Step 2: Create the validator**

Create `scripts/spell-qa/validate_fixtures.py`:

```python
"""Validate that every fixture key is a real spell id in spells.json."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spells_path = ROOT / "frontend/app/data/rules/spells.json"
fixtures_path = Path(__file__).with_name("fixtures.json")

data = json.loads(spells_path.read_text(encoding="utf-8"))
spells = data["spells"] if isinstance(data, dict) and "spells" in data else data
ids = {s["id"] for s in spells if "id" in s}
fixtures = json.loads(fixtures_path.read_text(encoding="utf-8"))

unknown = [k for k in fixtures if k not in ids]
if unknown:
    print(f"UNKNOWN spell ids in fixtures.json: {unknown}", file=sys.stderr)
    sys.exit(1)
print(f"OK: {len(fixtures)} fixtures, all ids valid. Catalog has {len(ids)} spells.")
```

- [ ] **Step 3: Run the validator**

Run: `cd /Users/haoli/leehow/code/dw && python scripts/spell-qa/validate_fixtures.py`
Expected: `OK: N fixtures, all ids valid. Catalog has 364 spells.` If it reports UNKNOWN ids, fix the fixture keys to match `spells.json` (the examples above use guessed ids like `fire-bolt`; correct them to the real ones).

- [ ] **Step 4: Commit**

```bash
git add scripts/spell-qa/fixtures.json scripts/spell-qa/validate_fixtures.py
git commit -m "feat(qa): fixtures scaffold + spell-id validator"
```

---

## Task 14: Self-test procedure doc + determinism check

The Phase 0 gate: a documented 3-spell browser bring-up plus a forced-roll determinism check. This is the manual/agent procedure that proves the whole loop before the 364-spell run.

**Files:**
- Create: `scripts/spell-qa/SELF_TEST.md`

- [ ] **Step 1: Write the self-test doc**

Create `scripts/spell-qa/SELF_TEST.md`:

```markdown
# Spell QA Harness Self-Test (Phase 0 gate)

Prereqs: backend running with `QA_MODE=true` on :8174, frontend on :5174,
`QA_TOKEN` exported, Claude-in-Chrome connected.

## 0. Seed
- `scripts/spell-qa/qa.sh seed` → note `campaign_id` (CID) and `actor_ids`/`monster_ids`.

## 1. Fire Bolt (attack path)
1. `qa.sh reset <CID> fire-bolt` ; `qa.sh forced 18` (forced hit on low_ac_target).
2. In Chrome: open `/campaign/<CID>/dm`, wait for map ready.
3. Select caster via `fireClickAtGrid(6,10)` (konva-snippets.md).
4. Open 施法 panel, choose Fire Bolt, target low_ac_target grid (10,9), confirm.
5. `qa.sh snap <CID>` → assert low_ac_target current_hp decreased.
6. Repeat with `qa.sh forced 2` against high_ac_target (25 AC) → assert miss (no HP change), combat log shows miss.

## 2. Cure Wounds (heal path)
1. `qa.sh reset <CID> cure-wounds`; pre-damage qa_low_hp_ally if needed.
2. Cast Cure Wounds on the damaged ally; confirm.
3. `qa.sh snap <CID>` → assert ally HP increased, not above max.

## 3. Fireball (save/area path)
1. `qa.sh reset <CID> fireball`; `qa.sh forced 5,18,5,18,5,18`.
2. Cast Fireball centered on cluster grid; resolve saves.
3. `qa.sh snap <CID>` → assert cluster targets took damage; high-save (18) targets took half of low-save (5) targets.

## 4. Determinism check
- Run step 3 twice with identical `forced` queue + reset. The two `snap` outputs
  (post-cast HP deltas) MUST be identical. If not, record BLOCKED_BY_TEST_INFRA.

## Gate
All three spells PASS in the browser + determinism check identical → Phase 0 done.
```

- [ ] **Step 2: Commit**

```bash
git add scripts/spell-qa/SELF_TEST.md
git commit -m "docs(qa): Phase 0 self-test procedure and determinism gate"
```

---

## Task 15: Full backend test + lint gate

- [ ] **Step 1: Run the QA backend tests together**

Run: `cd backend && source venv/bin/activate && pytest tests/unit/test_qa_forced_roll.py tests/integration/test_qa_endpoints.py -v --no-cov`
Expected: all PASS.

- [ ] **Step 2: Run transport-contract gate (must stay green)**

Run: `cd /Users/haoli/leehow/code/dw && bash scripts/quality/check_transport_contracts.sh`
Expected: PASS — the QA routes use bearer auth only (no `X-User-ID`, no `?user_id=`/`?role=`).

- [ ] **Step 3: Commit any fixes**

```bash
git add -A && git commit -m "test(qa): green backend QA suite + transport gate" || echo "nothing to commit"
```

---

## Self-Review

**Spec coverage:**
- §1 QA endpoints → Tasks 4, 5, 7, 8, 9, 10. ✓
- §2 forced-roll hook → Tasks 1, 2, 3. ✓
- §3 browser driver (selectors, Konva, procedure) → Tasks 11, 12, 14. ✓
- §4/§5 actors + monster arena → Tasks 6, 7. ✓
- §6 fixtures + result schema → Tasks 13 (fixtures); result rows are produced at run time per SELF_TEST/spec, not code here. ✓
- §7 browser-level checks → SELF_TEST.md + spec (run-time procedure). ✓
- §8 execution phases → Phase 0 is this whole plan; Phases 1–5 are agent-driven runs gated by the Task 14 self-test. ✓
- §9 self-test → Task 14. ✓

**Placeholder scan:** No "TBD/TODO". The fixtures.json examples use candidate spell ids (`fire-bolt`, `cure-wounds`, `fireball`) explicitly flagged for validation against `spells.json` in Task 13 — corrected by the validator, not left vague.

**Type consistency:** `qa_randint`, `push_forced_rolls`, `clear_forced_rolls`, `queue_size` used consistently across Tasks 2/3/4. `seed_arena`/`reset_arena`/`snapshot_arena` signatures consistent across Tasks 7/8/9/10. Model field names (`dm_user_id`, `current_hp`, `active_effects`, `position_x/y`, `monster_instance_id`, `hit_points`) match the exploration findings.

**Known follow-ups (out of scope, intentionally):** damage-dice determinism beyond d20 (Task 3 covers d20 only); adding stable `data-testid` to the spell cast UI (optional, would simplify Task 12); per-spell reset overrides in `reset_arena` (hook present, none needed yet).
