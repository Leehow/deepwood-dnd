# Class / Level-Up QA Harness — Plan A (Foundation + Smoke) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the deterministic, data-driven smoke layer of the class/level-up QA harness — it drives `POST /api/characters`, `POST /api/characters/{id}/level-up`, and `GET /api/characters/{id}/sheet` over every class/subclass progression and every inline choice option, asserting "no 500 + the chosen option lands in the correct character field."

**Architecture:** A pytest package `backend/tests/qa_classes/` with its own session-scoped DB fixtures (create schema once; per-test cleanup of the QA user's characters). A `generator.py` reads `classes-progression.json` (via a new `rules_cache` loader) and emits walk paths + option probes as pytest params. `drivers.py` wraps the three endpoints; `oracles.py` holds the smoke assertions; two parametrized test modules consume them.

**Tech Stack:** pytest + pytest-asyncio, httpx `AsyncClient` + `ASGITransport`, SQLAlchemy 2.0 async, the existing `app.main:app` and `conftest.py` test-DB resolver.

**Scope note:** This is cycle A of two. The layered oracle's deeper layers — `reference_tables.py` (independent SRD invariants), the computed-invariant + differential oracles, the multiclass set, the `classifier.py`/report layer, browser smoke, and CI wiring — are **Plan B**, written after this smoke layer is green (their exact assertions depend on the computed character-sheet field names, which are confirmed while building this cycle). See the design spec: [docs/superpowers/specs/2026-05-31-class-levelup-qa-harness-design.md](../specs/2026-05-31-class-levelup-qa-harness-design.md).

**Verified facts this plan relies on (2026-05-31):**
- `POST /api/characters` binds `CharacterCreate` ([character_sheet.py:59](../../../backend/app/schemas/character_sheet.py)). Nested `appearance`/`personality`/`abilityScores` all default their fields, so a minimal body is `{user_id, name, raceId, classId, level, abilityScores:{}, appearance:{}, personality:{}}` + optional choice fields. `populate_by_name=True` → snake_case keys also accepted. Returns 201 + `CharacterResponse`. The endpoint takes only `(character_data, db)` — no `current_user` dependency.
- `POST /api/characters/{id}/level-up` binds `LevelUpRequest{class_choice, feature_choices, campaign_id}` ([characters.py:2920](../../../backend/app/api/routes/characters.py)). It increments level, applies `feature_choices`, recomputes `spell_slots_state`, and **does not bump `current_hp`**. No choice validation (spec §6 seed bug #2).
- `GET /api/characters/{id}/sheet` ([characters.py:1743](../../../backend/app/api/routes/characters.py)) → `{character, features, actions}` with computed AC/HP.
- Progression shape: `get_classes_progression_data()["classes"][class_id]["levelProgression"]["<level>"]["features"]`; each feature has `type ∈ {choice, subclass, feature}` and inline `choices:[{id, ...}]`. **Level is the dict key**, not a field on the node.
- `conftest.py` provides `create_access_token(user_id, email, role, display_name)` and a `TEST_DATABASE_URL` resolver (a `*_test` DB). HP is deterministic (average rolls).

**Dev test command (used in every task):**
```bash
cd backend && TEST_DATABASE_URL=postgresql+asyncpg://haoli@localhost:5432/dnd_platform_test pytest <path> -v --no-cov -p no:cacheprovider
```

---

### Task 1: Harness DB fixtures (isolation + shared client/user)

**Files:**
- Create: `backend/tests/qa_classes/__init__.py` (empty)
- Create: `backend/tests/qa_classes/conftest.py`
- Test: `backend/tests/qa_classes/test_fixtures_isolation.py`

- [ ] **Step 1: Write the failing isolation tests**

```python
# backend/tests/qa_classes/test_fixtures_isolation.py
"""Proves the harness fixtures isolate per-test state (run alphabetically: a before b)."""
import pytest
from sqlalchemy import select, func
from app.models.character import Character

pytestmark = [pytest.mark.asyncio]


async def test_a_creates_a_character(qa_session, qa_user):
    char = Character(
        user_id=qa_user.id, name="Isolation Probe", race_id="human",
        class_id="fighter", level=1, ability_scores={"strength": 10},
        appearance={}, personality={}, selected_skills=[], expertise_skills=[],
        selected_cantrips=[], selected_spells=[], prepared_spells=[], equipment=[],
    )
    qa_session.add(char)
    await qa_session.commit()
    count = await qa_session.scalar(
        select(func.count()).select_from(Character).where(Character.user_id == qa_user.id)
    )
    assert count == 1


async def test_b_sees_clean_db(qa_session, qa_user):
    count = await qa_session.scalar(
        select(func.count()).select_from(Character).where(Character.user_id == qa_user.id)
    )
    assert count == 0  # test_a's row was cleaned up by the autouse fixture
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && TEST_DATABASE_URL=postgresql+asyncpg://haoli@localhost:5432/dnd_platform_test pytest tests/qa_classes/test_fixtures_isolation.py -v --no-cov -p no:cacheprovider`
Expected: FAIL/ERROR — `fixture 'qa_session' not found`.

- [ ] **Step 3: Write the fixtures**

```python
# backend/tests/qa_classes/__init__.py
```
(empty file)

```python
# backend/tests/qa_classes/conftest.py
"""Session-scoped DB + client fixtures for the class/level-up QA harness.

Distinct from the global conftest fixtures (`client`, `auth_headers`), which use a
per-test engine (create_all/drop_all every test). With hundreds of option probes that
would be far too slow, so this harness creates the schema ONCE per session and cleans
up the QA user's characters after each test (characters are user-owned and do not
cascade — explicit cleanup is required regardless; see spec §3).
"""
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.pool import NullPool

from app.main import app
from app.db.session import Base, get_db
from app.core.security import create_access_token
from app.models.user import User
from app.models.character import Character
from tests.conftest import TEST_DATABASE_URL


@pytest_asyncio.fixture(scope="session")
async def qa_engine():
    if not TEST_DATABASE_URL:
        pytest.skip("No *_test database configured; set TEST_DATABASE_URL")
    engine = create_async_engine(TEST_DATABASE_URL, poolclass=NullPool, echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


@pytest_asyncio.fixture
async def qa_session(qa_engine) -> AsyncSession:
    maker = async_sessionmaker(qa_engine, class_=AsyncSession, expire_on_commit=False)
    async with maker() as session:
        yield session


@pytest_asyncio.fixture(scope="session")
async def qa_user_id(qa_engine) -> str:
    maker = async_sessionmaker(qa_engine, class_=AsyncSession, expire_on_commit=False)
    async with maker() as session:
        existing = await session.get(User, "qa-classes-user")
        if existing is None:
            session.add(User(
                id="qa-classes-user", username="qaclasses",
                email="qaclasses@example.com", role="admin", is_active=True,
            ))
            await session.commit()
    return "qa-classes-user"


@pytest_asyncio.fixture
async def qa_user(qa_session, qa_user_id) -> User:
    return await qa_session.get(User, qa_user_id)


@pytest.fixture
def qa_headers(qa_user_id) -> dict:
    token = create_access_token(
        user_id=qa_user_id, email="qaclasses@example.com",
        role="admin", display_name="qaclasses",
    )
    return {"Authorization": f"Bearer {token}"}


@pytest_asyncio.fixture
async def qa_client(qa_session) -> AsyncClient:
    async def override_get_db():
        yield qa_session
    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


@pytest_asyncio.fixture(autouse=True)
async def _qa_cleanup(qa_session, qa_user_id):
    """Delete the QA user's characters after each test for per-test isolation."""
    yield
    await qa_session.execute(delete(Character).where(Character.user_id == qa_user_id))
    await qa_session.commit()
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && TEST_DATABASE_URL=postgresql+asyncpg://haoli@localhost:5432/dnd_platform_test pytest tests/qa_classes/test_fixtures_isolation.py -v --no-cov -p no:cacheprovider`
Expected: PASS (2 passed). If `test_b` fails with count==1, the autouse cleanup isn't wired — check `autouse=True`.

- [ ] **Step 5: Commit**

```bash
git add backend/tests/qa_classes/__init__.py backend/tests/qa_classes/conftest.py backend/tests/qa_classes/test_fixtures_isolation.py
git commit -m "test(class-qa): harness DB fixtures with per-test isolation"
```

---

### Task 2: Progression loader + path/option generator

**Files:**
- Modify: `backend/app/utils/rules_cache.py` (add one loader near the other `get_*_data` functions, ~line 96)
- Create: `backend/tests/qa_classes/generator.py`
- Test: `backend/tests/qa_classes/test_generator.py`

- [ ] **Step 1: Write the failing generator tests**

```python
# backend/tests/qa_classes/test_generator.py
from tests.qa_classes import generator as gen


def test_fighter_subclass_pairs_include_champion_at_level_3():
    pairs = list(gen.iter_class_subclass_pairs())
    fighter = [p for p in pairs if p.class_id == "fighter"]
    assert any(p.subclass_id == "champion" and p.subclass_level == 3 for p in fighter)
    # every class appears at least once
    assert {p.class_id for p in pairs} >= {
        "fighter", "wizard", "rogue", "cleric", "barbarian", "bard",
        "druid", "monk", "paladin", "ranger", "sorcerer", "warlock",
    }


def test_fighter_fighting_style_probe_has_six_inline_options_at_level_1():
    probes = [p for p in gen.iter_inline_option_probes()
              if p.class_id == "fighter" and p.choice_id == "fighting_style"]
    assert len(probes) == 6
    assert {p.option_id for p in probes} == {
        "archery", "defense", "dueling", "great_weapon_fighting",
        "protection", "two_weapon_fighting",
    }
    p = probes[0]
    assert p.level == 1 and p.fc_key == "fighting_style" and p.char_field == "fighting_style"


def test_choice_script_picks_first_option_and_subclass():
    script = gen.build_choice_script("fighter", "champion")
    assert script[1]["fighting_style"] == "archery"   # first inline option at L1
    assert script[3]["subclass"] == "champion"        # subclass node level for fighter
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && TEST_DATABASE_URL=postgresql+asyncpg://haoli@localhost:5432/dnd_platform_test pytest tests/qa_classes/test_generator.py -v --no-cov -p no:cacheprovider`
Expected: FAIL — `ModuleNotFoundError: tests.qa_classes.generator`.

- [ ] **Step 3a: Add the rules_cache loader**

In `backend/app/utils/rules_cache.py`, after `get_spellcasting_data()` (~line 96), add:

```python
def get_classes_progression_data() -> Dict[str, Any]:
    """Get cached class level-progression data (choice/subclass/feature nodes by level)."""
    return _load_json_file(str(get_rules_path("classes-progression.json")))
```

- [ ] **Step 3b: Write the generator**

```python
# backend/tests/qa_classes/generator.py
"""Enumerate class/level-up test paths and option probes from progression data.

Reads progression via rules_cache (never a hardcoded path, per repo rule). Emits:
- WalkPath: one per (class, subclass option) for the 1->20 progression walk.
- OptionProbe: one per inline `choice`-node option (fighting_style, favored_enemy, ...).

Option sources that are NOT inline lists (warlock invocations, feats, Battle Master
maneuvers, expertise) and ASI/feat levels are handled by Plan B as CHOICE_FIELD_MAP
is extended; this cycle covers inline `choice` nodes + the full subclass walk set.
"""
from __future__ import annotations
from dataclasses import dataclass

from app.utils.rules_cache import get_classes_progression_data

# choice-node id -> (feature_choices key, CharacterResponse field) for inline choices.
# Verified against the level-up endpoint's feature_choices handling and CharacterResponse.
CHOICE_FIELD_MAP: dict[str, tuple[str, str]] = {
    "fighting_style": ("fighting_style", "fighting_style"),
    "favored_enemy": ("favored_enemy", "favored_enemy"),
    "favored_terrain": ("favored_terrain", "favored_terrain"),
}


@dataclass(frozen=True)
class WalkPath:
    class_id: str
    subclass_id: str
    subclass_level: int


@dataclass(frozen=True)
class OptionProbe:
    class_id: str
    choice_id: str
    option_id: str
    level: int
    fc_key: str
    char_field: str

    @property
    def label(self) -> str:
        return f"{self.class_id}.{self.choice_id}.{self.option_id}@L{self.level}"


def _iter_level_features(class_block: dict):
    """Yield (level:int, feature_node:dict) for a class's levelProgression."""
    progression = class_block.get("levelProgression") or {}
    for level_key, level_block in progression.items():
        try:
            level = int(level_key)
        except (TypeError, ValueError):
            continue
        for node in (level_block.get("features") or []):
            yield level, node


def _classes() -> dict:
    return get_classes_progression_data().get("classes") or {}


def _find_subclass_node(class_block: dict) -> tuple[int, dict] | None:
    for level, node in _iter_level_features(class_block):
        if node.get("type") == "subclass":
            return level, node
    return None


def iter_class_subclass_pairs() -> list[WalkPath]:
    pairs: list[WalkPath] = []
    for class_id, class_block in _classes().items():
        found = _find_subclass_node(class_block)
        if not found:
            continue
        level, node = found
        for option in (node.get("choices") or []):
            oid = option.get("id")
            if oid:
                pairs.append(WalkPath(class_id, oid, level))
    return pairs


def iter_inline_option_probes() -> list[OptionProbe]:
    probes: list[OptionProbe] = []
    for class_id, class_block in _classes().items():
        for level, node in _iter_level_features(class_block):
            if node.get("type") != "choice":
                continue
            mapping = CHOICE_FIELD_MAP.get(node.get("id"))
            if not mapping:
                continue  # non-inline / unmapped choice — deferred to Plan B
            fc_key, char_field = mapping
            for option in (node.get("choices") or []):
                oid = option.get("id")
                if oid:
                    probes.append(OptionProbe(
                        class_id, node["id"], oid, level, fc_key, char_field,
                    ))
    return probes


def build_choice_script(class_id: str, subclass_id: str) -> dict[int, dict]:
    """level -> feature_choices: pick the first inline option at each choice node,
    and select `subclass_id` at the subclass node's level."""
    class_block = _classes().get(class_id) or {}
    script: dict[int, dict] = {}
    for level, node in _iter_level_features(class_block):
        ntype = node.get("type")
        if ntype == "subclass":
            script.setdefault(level, {})["subclass"] = subclass_id
        elif ntype == "choice":
            mapping = CHOICE_FIELD_MAP.get(node.get("id"))
            choices = node.get("choices") or []
            if mapping and choices:
                fc_key, _ = mapping
                script.setdefault(level, {})[fc_key] = choices[0]["id"]
    return script
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && TEST_DATABASE_URL=postgresql+asyncpg://haoli@localhost:5432/dnd_platform_test pytest tests/qa_classes/test_generator.py -v --no-cov -p no:cacheprovider`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/app/utils/rules_cache.py backend/tests/qa_classes/generator.py backend/tests/qa_classes/test_generator.py
git commit -m "test(class-qa): progression loader + path/option generator"
```

---

### Task 3: Endpoint drivers

**Files:**
- Create: `backend/tests/qa_classes/drivers.py`
- Test: `backend/tests/qa_classes/test_drivers.py`

- [ ] **Step 1: Write the failing driver test**

```python
# backend/tests/qa_classes/test_drivers.py
import pytest
from tests.qa_classes import drivers

pytestmark = [pytest.mark.asyncio]


async def test_build_at_level_creates_fighter(qa_client, qa_headers, qa_user_id):
    resp = await drivers.build_at_level(
        qa_client, qa_headers, qa_user_id, "fighter", level=1,
        choices={"fighting_style": "archery"},
    )
    assert resp.status_code == 201, resp.text
    char = resp.json()
    assert char["class_id"] == "fighter"
    assert char["level"] == 1
    assert char["id"]


async def test_level_up_and_sheet(qa_client, qa_headers, qa_user_id):
    created = (await drivers.build_at_level(
        qa_client, qa_headers, qa_user_id, "fighter", level=1)).json()
    lvl = await drivers.level_up_once(qa_client, qa_headers, created["id"], "fighter", {})
    assert lvl.status_code < 500, lvl.text
    assert lvl.json()["level"] == 2
    sheet = await drivers.get_sheet(qa_client, qa_headers, created["id"])
    assert sheet.status_code < 500, sheet.text
    assert "character" in sheet.json()
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && TEST_DATABASE_URL=postgresql+asyncpg://haoli@localhost:5432/dnd_platform_test pytest tests/qa_classes/test_drivers.py -v --no-cov -p no:cacheprovider`
Expected: FAIL — `ModuleNotFoundError: tests.qa_classes.drivers`.

- [ ] **Step 3: Write the drivers**

```python
# backend/tests/qa_classes/drivers.py
"""Thin wrappers over the three character endpoints. Each returns the raw httpx
Response so smoke oracles can inspect status codes (a 500 is a finding, not an
exception). `choices` keys use snake_case CharacterCreate fields (populate_by_name)."""
from __future__ import annotations
from httpx import AsyncClient, Response

API = "/api/characters"


def _minimal_create_body(user_id: str, class_id: str, level: int,
                         subclass_id: str | None, choices: dict | None) -> dict:
    body = {
        "user_id": user_id,
        "name": f"QA {class_id} L{level}",
        "race_id": "human",
        "class_id": class_id,
        "level": level,
        "ability_scores": {},   # all default to 10
        "appearance": {},       # all default to ""
        "personality": {},      # all default
    }
    if subclass_id:
        body["subclass_id"] = subclass_id
    if choices:
        body.update(choices)
    return body


async def build_at_level(client: AsyncClient, headers: dict, user_id: str,
                         class_id: str, level: int = 1, *,
                         subclass_id: str | None = None,
                         choices: dict | None = None) -> Response:
    body = _minimal_create_body(user_id, class_id, level, subclass_id, choices)
    return await client.post(API, json=body, headers=headers)


async def level_up_once(client: AsyncClient, headers: dict, character_id: int,
                        class_choice: str, feature_choices: dict) -> Response:
    return await client.post(
        f"{API}/{character_id}/level-up",
        json={"class_choice": class_choice, "feature_choices": feature_choices},
        headers=headers,
    )


async def get_sheet(client: AsyncClient, headers: dict, character_id: int) -> Response:
    return await client.get(f"{API}/{character_id}/sheet", headers=headers)
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && TEST_DATABASE_URL=postgresql+asyncpg://haoli@localhost:5432/dnd_platform_test pytest tests/qa_classes/test_drivers.py -v --no-cov -p no:cacheprovider`
Expected: PASS (2 passed). If create returns 422, print `resp.text` (already asserted) and reconcile the body against `CharacterCreate`.

- [ ] **Step 5: Commit**

```bash
git add backend/tests/qa_classes/drivers.py backend/tests/qa_classes/test_drivers.py
git commit -m "test(class-qa): endpoint drivers (build/level-up/sheet)"
```

---

### Task 4: Smoke oracle

**Files:**
- Create: `backend/tests/qa_classes/oracles.py`
- Test: `backend/tests/qa_classes/test_oracles_smoke.py`

- [ ] **Step 1: Write the failing oracle tests**

```python
# backend/tests/qa_classes/test_oracles_smoke.py
import pytest
from tests.qa_classes import oracles


class _Resp:
    def __init__(self, status_code, text="", payload=None):
        self.status_code = status_code
        self.text = text
        self._payload = payload or {}
    def json(self):
        return self._payload


def test_assert_status_ok_passes_for_2xx():
    oracles.assert_status_ok(_Resp(201), "create fighter")  # no raise


def test_assert_status_ok_raises_on_500():
    with pytest.raises(AssertionError, match="500"):
        oracles.assert_status_ok(_Resp(500, text="boom"), "level up bard L7")


def test_option_landed_handles_str_dict_and_list():
    assert oracles.option_landed({"fighting_style": "archery"}, "fighting_style", "archery")
    assert oracles.option_landed(
        {"fighting_style": {"value": "archery"}}, "fighting_style", "archery")
    assert oracles.option_landed(
        {"eldritch_invocations": [{"value": "agonizing_blast"}]},
        "eldritch_invocations", "agonizing_blast")
    assert oracles.option_landed({"subclass_id": "champion"}, "subclass_id", "champion")
    assert not oracles.option_landed({"fighting_style": None}, "fighting_style", "archery")
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && TEST_DATABASE_URL=postgresql+asyncpg://haoli@localhost:5432/dnd_platform_test pytest tests/qa_classes/test_oracles_smoke.py -v --no-cov -p no:cacheprovider`
Expected: FAIL — `ModuleNotFoundError: tests.qa_classes.oracles`.

- [ ] **Step 3: Write the smoke oracle**

```python
# backend/tests/qa_classes/oracles.py
"""Smoke-layer assertions for the class/level-up QA harness.

`assert_status_ok` treats any 5xx as a hard failure (a real app bug) and a 4xx as a
softer failure surfaced with the response body. `option_landed` normalizes the three
shapes a chosen option can take in a CharacterResponse: a bare string, a dict with a
`value`/`id` key, or a list of those.
"""
from __future__ import annotations
from typing import Any


def assert_status_ok(resp, context: str) -> None:
    assert resp.status_code < 500, (
        f"[BLOCKED_BY_APP_BUG] {context}: HTTP {resp.status_code}\n{resp.text}"
    )
    assert resp.status_code < 400, (
        f"[FAIL] {context}: HTTP {resp.status_code}\n{resp.text}"
    )


def _ids_in(value: Any) -> set[str]:
    if value is None:
        return set()
    if isinstance(value, str):
        return {value}
    if isinstance(value, dict):
        return {str(value[k]) for k in ("value", "id") if value.get(k) is not None}
    if isinstance(value, list):
        out: set[str] = set()
        for item in value:
            out |= _ids_in(item)
        return out
    return set()


def option_landed(character_json: dict, field: str, option_id: str) -> bool:
    return option_id in _ids_in(character_json.get(field))


def assert_option_landed(character_json: dict, field: str, option_id: str,
                         context: str) -> None:
    assert option_landed(character_json, field, option_id), (
        f"[FAIL] {context}: option '{option_id}' did not land in "
        f"character['{field}'] = {character_json.get(field)!r}"
    )
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && TEST_DATABASE_URL=postgresql+asyncpg://haoli@localhost:5432/dnd_platform_test pytest tests/qa_classes/test_oracles_smoke.py -v --no-cov -p no:cacheprovider`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add backend/tests/qa_classes/oracles.py backend/tests/qa_classes/test_oracles_smoke.py
git commit -m "test(class-qa): smoke oracle (status + option-landed)"
```

---

### Task 5: Option-probe sweep (Phase 1 breadth + seed bug #2)

**Files:**
- Create: `backend/tests/qa_classes/test_option_probes.py`

- [ ] **Step 1: Write the parametrized probe test + the validation-gap probe**

```python
# backend/tests/qa_classes/test_option_probes.py
"""Phase 1 smoke breadth: every inline choice option lands without a 500.

A probe at level 1 is exercised through CREATE (you can't level *into* level 1); a
probe at level >= 1's later levels is exercised by creating at level-1 then leveling
up once choosing only that option.
"""
import pytest
from tests.qa_classes import drivers, oracles
from tests.qa_classes.generator import iter_inline_option_probes

pytestmark = [pytest.mark.asyncio]

PROBES = iter_inline_option_probes()


@pytest.mark.parametrize("probe", PROBES, ids=[p.label for p in PROBES])
async def test_inline_option_lands(qa_client, qa_headers, qa_user_id, probe):
    if probe.level <= 1:
        resp = await drivers.build_at_level(
            qa_client, qa_headers, qa_user_id, probe.class_id, level=1,
            choices={probe.fc_key: probe.option_id},
        )
        oracles.assert_status_ok(resp, f"create {probe.label}")
        char = resp.json()
    else:
        created = await drivers.build_at_level(
            qa_client, qa_headers, qa_user_id, probe.class_id, level=probe.level - 1)
        oracles.assert_status_ok(created, f"prereq build {probe.label}")
        resp = await drivers.level_up_once(
            qa_client, qa_headers, created.json()["id"], probe.class_id,
            {probe.fc_key: probe.option_id})
        oracles.assert_status_ok(resp, f"level-up {probe.label}")
        char = resp.json()
    oracles.assert_option_landed(char, probe.char_field, probe.option_id, probe.label)


@pytest.mark.xfail(reason="spec §6 seed bug #2: level-up performs no choice validation",
                   strict=False)
async def test_duplicate_fighting_style_is_rejected(qa_client, qa_headers, qa_user_id):
    """A fighter who already took Archery should not be allowed to take it again.
    Today the backend does not validate; this xfail documents the gap and will flip
    to a real assertion if/when validation lands."""
    created = await drivers.build_at_level(
        qa_client, qa_headers, qa_user_id, "fighter", level=1,
        choices={"fighting_style": "archery"})
    # Re-submit the same style via a create at a higher level (simulating a 2nd pick).
    dup = await drivers.build_at_level(
        qa_client, qa_headers, qa_user_id, "fighter", level=2,
        choices={"fighting_style": "archery"})
    assert dup.status_code == 422, "expected backend to reject a duplicate fighting style"
```

- [ ] **Step 2: Run to verify the suite collects and runs**

Run: `cd backend && TEST_DATABASE_URL=postgresql+asyncpg://haoli@localhost:5432/dnd_platform_test pytest tests/qa_classes/test_option_probes.py -v --no-cov -p no:cacheprovider`
Expected: the 6 fighter fighting_style probes (plus any ranger favored_enemy/terrain inline probes) run; `test_duplicate_fighting_style_is_rejected` shows `xfail` (or `xpass` if validation already exists). Any real `[BLOCKED_BY_APP_BUG]`/`[FAIL]` is a genuine finding — record it, do not paper over it.

- [ ] **Step 3: Triage findings (no code change unless a harness bug)**

For each failing probe, classify: a 500 → app bug (note the class/level); an option that didn't land → either an app bug or a CHOICE_FIELD_MAP mismatch (a harness bug — fix the map in `generator.py`). Re-run until every failure is either green or a recorded app-bug finding.

- [ ] **Step 4: Commit**

```bash
git add backend/tests/qa_classes/test_option_probes.py
git commit -m "test(class-qa): inline option-probe smoke sweep + validation-gap probe"
```

---

### Task 6: Progression-walk sweep (Phase 0 self-test + determinism)

**Files:**
- Create: `backend/tests/qa_classes/test_progression_walk.py`

- [ ] **Step 1: Write the walk helper + parametrized walk + self-test + determinism**

```python
# backend/tests/qa_classes/test_progression_walk.py
"""1->20 progression walk per (class, subclass): smoke-assert no 500 at each level.

The Phase 0 self-test (fighter/wizard/warlock) is the bring-up subset; the full
parametrization is the breadth sweep. A determinism test reruns one walk and asserts
the final character subset is identical."""
import pytest
from tests.qa_classes import drivers, oracles
from tests.qa_classes.generator import iter_class_subclass_pairs, build_choice_script

pytestmark = [pytest.mark.asyncio]

PAIRS = iter_class_subclass_pairs()
SELF_TEST = {"fighter", "wizard", "warlock"}


async def _walk(qa_client, qa_headers, qa_user_id, class_id, subclass_id) -> dict:
    script = build_choice_script(class_id, subclass_id)
    created = await drivers.build_at_level(
        qa_client, qa_headers, qa_user_id, class_id, level=1,
        choices=script.get(1) or None)
    oracles.assert_status_ok(created, f"create {class_id}/{subclass_id} L1")
    char = created.json()
    for level in range(2, 21):
        resp = await drivers.level_up_once(
            qa_client, qa_headers, char["id"], class_id, script.get(level, {}))
        oracles.assert_status_ok(resp, f"{class_id}/{subclass_id} -> L{level}")
        char = resp.json()
        assert char["level"] == level, f"{class_id}/{subclass_id}: expected L{level}, got {char['level']}"
    return char


@pytest.mark.parametrize(
    "pair", [p for p in PAIRS if p.class_id in SELF_TEST],
    ids=lambda p: f"{p.class_id}.{p.subclass_id}")
async def test_self_test_walks(qa_client, qa_headers, qa_user_id, pair):
    """Phase 0 bring-up: fighter/wizard/warlock subclasses walk 1->20 cleanly."""
    await _walk(qa_client, qa_headers, qa_user_id, pair.class_id, pair.subclass_id)


@pytest.mark.parametrize("pair", PAIRS, ids=lambda p: f"{p.class_id}.{p.subclass_id}")
async def test_full_breadth_walks(qa_client, qa_headers, qa_user_id, pair):
    """Phase 1 breadth: every (class, subclass) walks 1->20 with no 500."""
    char = await _walk(qa_client, qa_headers, qa_user_id, pair.class_id, pair.subclass_id)
    assert char["subclass_id"] == pair.subclass_id


async def test_walk_is_deterministic(qa_client, qa_headers, qa_user_id):
    keys = ("level", "class_id", "subclass_id", "fighting_style", "spell_slots_state")
    a = await _walk(qa_client, qa_headers, qa_user_id, "fighter", "champion")
    b = await _walk(qa_client, qa_headers, qa_user_id, "fighter", "champion")
    assert {k: a.get(k) for k in keys} == {k: b.get(k) for k in keys}
```

- [ ] **Step 2: Run the Phase 0 self-test first**

Run: `cd backend && TEST_DATABASE_URL=postgresql+asyncpg://haoli@localhost:5432/dnd_platform_test pytest tests/qa_classes/test_progression_walk.py -v --no-cov -p no:cacheprovider -k "self_test or deterministic"`
Expected: the fighter/wizard/warlock walks + determinism pass. A 500 at a specific level is a real finding — record the class/subclass/level.

- [ ] **Step 3: Run the full breadth sweep**

Run: `cd backend && TEST_DATABASE_URL=postgresql+asyncpg://haoli@localhost:5432/dnd_platform_test pytest tests/qa_classes/test_progression_walk.py -v --no-cov -p no:cacheprovider -k "full_breadth"`
Expected: every (class, subclass) walks to L20. Record any `[BLOCKED_BY_APP_BUG]` (500) findings by class/subclass/level. Do not weaken assertions to make them pass.

- [ ] **Step 4: Commit**

```bash
git add backend/tests/qa_classes/test_progression_walk.py
git commit -m "test(class-qa): 1->20 progression-walk sweep + Phase 0 self-test"
```

---

## Self-Review

**Spec coverage (against the design spec):**
- §1 smoke layer → Tasks 4–6. ✅ (computed-invariant + differential are Plan B, as scoped.)
- §2 path generation (canonical-choice walk + option probes, inline choices) → Task 2 + Tasks 5–6. ✅ (nested/external/ASI options explicitly deferred to Plan B via CHOICE_FIELD_MAP extension — recorded, not silently dropped.)
- §3 drivers + isolation (reuse `*_test` DB, explicit teardown, no campaign) → Tasks 1 + 3. ✅
- §6 seed bug #2 (no choice validation) → Task 5 `test_duplicate_fighting_style_is_rejected` (xfail). ✅ Seed bug #1 (multiclass HP) is Plan B (multiclass). 
- §8 phases 0–1 → Tasks 6 (self-test) + 5–6 (breadth). ✅ Phases 2–5 are Plan B.

**Placeholder scan:** No "TBD"/"add validation"/"similar to Task N". The deferred option types are a named, bounded scope decision (Plan B), not an in-task placeholder. ✅

**Type consistency:** `WalkPath(class_id, subclass_id, subclass_level)`, `OptionProbe(class_id, choice_id, option_id, level, fc_key, char_field)`, `build_choice_script(class_id, subclass_id) -> {level: {fc_key: option_id}}`, `assert_status_ok(resp, context)`, `option_landed(json, field, id)`/`assert_option_landed(json, field, id, context)`, drivers returning `Response` — all names match across Tasks 2–6. ✅

---

## Next cycle — Plan B (Deep oracles + multiclass + report)

To be written as its own plan once Plan A is green (its assertions depend on the
computed character-sheet field names confirmed during Plan A):

1. `reference_tables.py` — independent SRD constants (proficiency bonus, full/half/third caster slot tables, warlock pact, hit dice, per-class resource caps, passive numbers). Unit-tested against known values; reads no app data (spec §1 independence rule).
2. Computed-invariant oracle — read `GET /{id}/sheet`'s computed `max_hp`/AC/attacks + the model's `class_feature_uses`; assert per level against `reference_tables`. Wire into the walk.
3. Differential oracle — incremental 1→20 vs `CharacterCreate(level=20, all choices)`; compare derived state. Wire at walk end. Open question §10.2 (build-at-level fidelity) resolved here.
4. Extend `CHOICE_FIELD_MAP` + generator to cover invocations (`eldritch_invocations.json`), feats (`feats.json`), maneuvers, expertise, and ASI levels (both ability-increase and feat branches).
5. `test_multiclass.py` — the ~8 representative combos (spec §4) + seed bug #1 (multiclass first-level hit die, [character_progression_service.py:124](../../../backend/app/services/character_progression_service.py)).
6. `classifier.py` + `scripts/class-qa/run_report.py` — failure→owner classification + `artifacts/class-qa/<date>/summary.md`.
7. `scripts/class-qa/browser_smoke.md` — thin level-up-wizard checklist for ~3–4 representative classes (spec §7).
8. CI wiring — add the pytest gate to `.github/workflows/quality-gate.yml`.
