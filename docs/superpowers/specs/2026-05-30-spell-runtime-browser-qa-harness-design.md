# Spell Runtime Browser QA Harness — Design Spec

Date: 2026-05-30
Status: Approved design, pending implementation plan
Supersedes nothing; concretizes [docs/plan/spell-runtime-browser-qa-plan.md](../../plan/spell-runtime-browser-qa-plan.md)

## Purpose

Make the 364-spell browser QA pass **executable and deterministic** while keeping
the test surface pure-browser: every spell is cast and observed through the live
Chrome UI. This spec defines the harness (backend QA endpoints + browser driver +
data/result layer) and the per-spell contract.

## Decisions (locked)

| Decision | Choice |
|---|---|
| Scope | All 364 spells in `frontend/app/data/rules/spells.json` |
| Browser backend | Claude-in-Chrome MCP (`mcp__Claude_in_Chrome__*`) |
| Execution model | **B — pure browser**: cast + observe through the UI for every spell |
| Phase 0 infra | New QA-only backend endpoints (seed / reset / snapshot) |
| Determinism | QA-gated forced-roll backend hook |
| Deliverable | Executable backend harness + browser driver + this spec |
| PASS/FAIL source | Browser-visible state; `/qa/snapshot` export is corroborating evidence |

Backend QA endpoints exist **only** to make the browser run deterministic and
resettable. They never cast a spell and never decide PASS/FAIL.

## Non-goals

- Not a D&D rules rewrite. Ambiguous rules → status `NEEDS_RULES_DECISION`.
- Not a production data migration. QA seed data is reversible and flag-gated.
- Not an API-casting shortcut. The cast always goes through the UI (Approach B).

## Architecture

```
┌─ Backend QA layer (scriptable, curl/Bash) ──────────────┐
│  POST /qa/seed        recreate arena from scratch        │
│  POST /qa/reset       reset to per-spell fixture state   │
│  POST /qa/forced-roll queue fixed d20/damage results     │
│  GET  /qa/snapshot    read-only token/effect/log export  │
└──────────────────────────────────────────────────────────┘
┌─ Browser driver layer (agent-invoked, Claude-in-Chrome) ─┐
│  chromeSession · authFlow · campaignNavigator            │
│  spellCaster · promptResolver · stateObserver · resultWriter│
└──────────────────────────────────────────────────────────┘
┌─ Spec/data layer ───────────────────────────────────────┐
│  fixtures.json · results.json · summary.md               │
└──────────────────────────────────────────────────────────┘
```

Claude-in-Chrome MCP is agent-driven, not a headless loop. The agent drives the
per-spell loop turn by turn; the backend layer is the only fully-scripted part.

## §1 Phase 0 — Backend QA endpoints

The only new production-touching code. All gated behind a `QA_MODE` env flag
**and** DM-of-QA-campaign permission. When `QA_MODE` is off, the routes return
**404** so production behavior is unchanged.

Target file budget (per `~/.claude/CLAUDE.md` ~400-line rule):
- `backend/app/api/routes/qa.py` — thin route layer
- `backend/app/services/qa_arena_service.py` — seed/reset/snapshot logic
- `backend/app/services/qa_forced_roll.py` — forced-roll queue (see §2)

### Endpoints

- `POST /qa/seed`
  - (Re)creates campaign `Spell Runtime QA Arena`: flat grid map, fixed scale,
    no fog-of-war.
  - Creates the 6 QA actors (§4) and the 13-monster arena (§5) at fixed coords.
  - Returns `{ campaign_id, actor_ids: {...}, monster_ids: {...} }`.
  - Idempotent: re-seeding tears down and rebuilds.

- `POST /qa/reset` `{ spell_id }`
  - Restores actors + monsters to the fixture clean state for `spell_id`:
    HP, positions, cleared active effects, cleared concentration, cleared
    runtime instances, cleared combat-log scope marker.
  - Idempotent. Default fixture used when `spell_id` has no special override.

- `POST /qa/forced-roll` `{ rolls: [ ... ] }`
  - Pushes a FIFO queue of fixed dice outcomes consumed by subsequent casts.
  - See §2 for the consumption contract.

- `GET /qa/snapshot` `{ spell_id }`
  - Read-only export: tokens (HP / position / active effects), active spell
    runtime instances, combat-log tail, concentration state.
  - Written to `*.before.json` / `*.after.json` evidence files. No mutation.

### Safety

- `QA_MODE` defaults off. CI / production never set it.
- Permission check: caller must be DM of the QA campaign.
- Seed data lives only in the QA campaign; no shared/live campaign is touched.

## §2 Determinism — forced-roll hook

A QA-only seam in the dice/roll path:

- When `QA_MODE` is on **and** the forced-roll queue is non-empty, the next
  d20 / damage draw **pops a fixed value** from the queue instead of RNG.
- Empty queue → normal RNG (production behavior is the default path).
- This is the single touch into production dice code, guarded by the flag.

Fixtures declare the exact rolls a spell needs so assertions are exact, not
range-based. Example — Fireball: `saves:[5,18]` drives a fail on the low-save
target and a success on the high-save target; damage dice fixed for a known HP
delta. The actual consumed rolls are recorded in the result artifact.

If a spell path has no reachable forced-roll seam, the harness falls back to the
paired low/high target + range-assertion model and records the gap as
`BLOCKED_BY_TEST_INFRA` rather than weakening the assertion silently.

## §3 Browser driver layer (Claude-in-Chrome)

### Selector strategy (in order)

1. role + exact accessible name
2. visible Chinese text scoped to the active panel (UI is Chinese; e.g. `施法`,
   `确认`, `取消施法`, `仪式施法`, `停止施法`)
3. Konva canvas coordinate — computed from the seeded token grid position via
   `javascript_tool` reading `window.Konva.stages[0]` (token layer is a
   draggable Group layer; fire `click` on the group for reliable selection)
4. screenshot + CUA click only when the canvas has no semantic locator

There are **no `data-testid`** attributes in the spell UI today. The driver must
not assume them. (Adding stable `data-testid` to the spell cast surface is a
recommended but optional follow-up, tracked separately — not a blocker.)

### Cast entry points observed

- `FloatingTokenPanel` / `TokenModal` / `SelectionContextMenu` → `施法` button
- `MapTargetingHud` → canvas targeting (`取消施法` to abort)
- `MapStatusDialogs` → ritual / stop-cast prompts

### Per-spell procedure

1. `curl POST /qa/reset {spell_id}`; `curl POST /qa/forced-roll {rolls}`.
2. Navigate to `http://localhost:5174/campaign/<qa_campaign_id>/dm`.
3. Wait for map header, connection indicator, character panel, spell UI visible.
4. Select caster token (Konva fire-click), open the 施法 panel, choose spell by
   id / English name / Chinese name.
5. Target via canvas coordinates / target prompt using seeded fixture positions;
   confirm cast.
6. Resolve prompts: save, concentration replacement, reaction, target selection,
   action invocation, zone settlement.
7. `stateObserver`: DOM snapshot + screenshot (when UI visibly changed) +
   `read_console_messages` (levels error/warn) + current URL/title.
8. `curl GET /qa/snapshot {spell_id}` → write `*.before.json` / `*.after.json`.
9. `resultWriter` appends one result row.

### Session handling

- Connect via the extension backend; health-check by listing tabs; retry once.
- Login at `http://localhost:5174/login` with the local QA account via **visible
  UI only** (no cookie/storage inspection). Credentials come from env vars
  (`QA_TEST_EMAIL` / `QA_TEST_PASSWORD`), never committed to spec, source,
  results, screenshots, or logs.
- On connection failure that survives one retry: record
  `BLOCKED_BY_TEST_INFRA`; do not silently fall back to another browser path.

## §4 QA actors

Created by `/qa/seed`. Test-only; not valid in live campaigns.

| Actor | Purpose |
|---|---|
| `qa_all_spells_caster` | Knows every spell; effectively unlimited slots L1–9; high DC + attack bonus; resettable concentration/effects |
| `qa_weapon_caster` | On-hit rider spells + melee/ranged weapons (Hex, Hunter's Mark, smites) |
| `qa_healer` | Healing / temp HP / restoration / resurrection / exclusion rules |
| `qa_low_hp_ally` | Damaged friendly target for heal / temp HP |
| `qa_downed_ally` | 0-HP friendly for stabilize / revive |
| `qa_player_view_character` | Player-controlled, for player-view visibility smoke |

## §5 Monster arena

Fixed monsters at stable names + coords so canvas targeting can reuse locators.

| Monster | Purpose |
|---|---|
| `normal_target_a` / `normal_target_b` | Single-target / multi-target / retarget |
| `low_ac_target` / `high_ac_target` | Attack-roll hit / miss confirmation |
| `low_save_target` / `high_save_target` | Save-fail / save-success paths |
| `fire_resistant_target` | Resistance / immunity / vulnerability math |
| `poison_immune_target` | Damage / condition immunity |
| `undead_target` / `construct_target` | Healing exclusion + type-specific rules |
| `condition_immune_target` | Charm / frighten / paralyze / poison / stun immunity |
| `cluster_targets_1_6` | Area / zone target cluster |
| `mobile_target` | Enter/leave zone + forced movement |

## §6 Data + result schema

### `fixtures.json` (keyed by spell_id)

```json
{
  "fireball": {
    "actor": "qa_all_spells_caster",
    "targets": ["cluster_targets_1_6"],
    "forced_rolls": { "saves": [5, 18] },
    "category": ["damage", "save", "area"],
    "expected": ["area_targets_take_damage", "high_save_halves", "chat_log_created"]
  }
}
```

### Result row (per spell)

```json
{
  "spell_id": "fireball",
  "name": "火球术",
  "category": ["damage", "save", "area"],
  "path": "browser_dm_cast",
  "fixture": "cluster_targets_1_6",
  "steps": ["select_caster", "open_spell", "choose_area", "confirm", "resolve_saves"],
  "expected": ["targets_in_area_take_damage", "save_success_halves_damage", "chat_log_created"],
  "actual": "PASS",
  "evidence": {
    "screenshot": "artifacts/spell-qa/2026-05-30/fireball.png",
    "state_before": "artifacts/spell-qa/2026-05-30/fireball.before.json",
    "state_after": "artifacts/spell-qa/2026-05-30/fireball.after.json"
  },
  "notes": ""
}
```

Statuses: `PASS · FAIL · BLOCKED_BY_TEST_INFRA · BLOCKED_BY_APP_BUG ·
NEEDS_RULES_DECISION · DEFERRED_NOT_IMPLEMENTED`.

Artifacts under `artifacts/spell-qa/<date>/` (matches the existing plan's path;
the `debug/test/` rule covers ad-hoc throwaway script output, not this catalog
of evidence). Each run also produces `results.json` and `summary.md`.

## §7 Browser-level checks (every cast)

- No Vite transform overlay.
- No spell-runtime-specific console error.
- No backend 500 during cast / trigger / cleanup / reset.
- Cast UI completes or shows a clear, expected user-facing blocker.
- Chat / combat log describes the spell result.
- Token HP, active effects, overlays, badges, links, resources, and
  concentration state match the fixture's `expected`.

## §8 Execution phases

| Phase | Content | Exit criteria |
|---|---|---|
| 0 | Build QA endpoints + forced-roll hook + fixtures; harness self-test (§9) | Self-test green |
| 1 | Runtime smoke: Hex, Bless, Divine Favor, concentration replacement, zone settlement, attack/save modifier integration | No runtime-specific browser/backend error |
| 2 | Breadth by level (cantrips → L9), grouped by target shape | Every spell has a result row |
| 3 | Trigger/cleanup stress: start/end turn, enter/leave zone, on-hit, on-take-damage, reaction, concentration end, action-invoked, expiration | Every active effect cleans up with no stale badge/overlay/runtime ref/concentration |
| 4 | Player-view smoke (damage cast, receive Bless/Hex/condition, see zone/visual, invoke granted action) | DM and player views agree on visible state |
| 5 | Regression rerun of failures + family reps + runtime smoke + Vitest/backend matrix | All previously-failed spells pass |

### Mechanism matrix (rollup gate, 23 families)

Runtime v2 · Direct damage · Save damage · Healing · Temp HP · Conditions ·
Restoration · Buff modifiers · Debuff modifiers · Concentration · On-hit riders ·
Granted actions · Turn triggers · Zone triggers · Area visuals · Token visuals ·
Movement · Summons · Illusions · Walls/barriers · Auras · Counter/dispel/suppress ·
Death/revive · Utility/information.

Each family must have at least one passing browser representative.

## §9 Harness self-test (Phase 0 gate)

Before trusting 364 runs, a 3-spell bring-up proves the full loop in the browser:

- **Fire Bolt** — attack-roll path (hit via `low_ac_target` forced d20, miss via
  `high_ac_target`).
- **Cure Wounds** — heal path (`qa_low_hp_ally` HP delta, max-HP cap).
- **Fireball** — save/area path (`cluster_targets_1_6`, forced saves `[5,18]`).

Plus a determinism check: the same fixture run twice yields identical result
rows. Self-test must be green before Phase 1.

## Pass criteria (whole pass)

- Every spell in `spells.json` has a result row.
- Every mechanism family has ≥1 passing browser representative.
- All runtime-v2 spells pass their full browser flow.
- Every failure has a reproducible artifact and an owner surface (spell data /
  backend effect engine / runtime v2 / frontend cast UI / map visualization /
  rules decision / test infra).
- No spell-runtime-specific browser console error in the QA campaign.
- No backend 500 during cast / trigger / cleanup / reset.
- Known unrelated blockers (e.g. current frontend typecheck failures) are
  explicitly recorded, not confused with spell behavior failures.

## Evidence artifacts

`artifacts/spell-qa/<date>/`:
- `results.json` — one row per spell
- `summary.md` — rollup by mechanism family
- screenshots for visual / state-changing spells
- `*.before.json` / `*.after.json` snapshots
- browser console / network summary
- bug list grouped by owning surface
