# Spell Runtime Engine — Phase Executor Refactor

**Date**: 2026-05-26
**Status**: Approved design, awaiting implementation plan
**Owner**: leeehow@gmail.com
**Related**: [docs/architecture/SPELL_RUNTIME_ENGINE.md](../../architecture/SPELL_RUNTIME_ENGINE.md)
**Tracking branch**: `codex/tacticalmap-phase3-refactor-20260321` (parent)

## 1. Problem

The `spell_runtime_service` middleware (1493 LOC) is documented as a *declarative orchestrator* — JSON in `spells.json` declares triggers and verbs, and the service is supposed to execute them. In practice the execution layer is **hand-rolled for a single spell (Hex)** and the JSON declarations are partly cosmetic.

Concrete gaps (verified against current code on 2026-05-26):

- **16 triggers declared as supported, 8 have no execution entry** at all: `start_of_turn`, `end_of_turn`, `start_of_target_turn`, `end_of_target_turn`, `on_enter_zone`, `on_leave_zone`, `on_take_damage`, `on_reaction`.
- **50 verbs declared as supported, ~40 are zombie verbs** — they appear in `SUPPORTED_RUNTIME_VERBS` and pass `audit_spell_pipeline_support()` checks, but no execution site dispatches them. If a v2 spell uses them, the call is silently dropped.
- **6 hardcoded execution sites** ([spell_runtime_service.py:553-593, 1126-1174, 1247-1288, 1297-1333, 1382-1414](../../../backend/app/services/spell_runtime_service.py), plus `end_concentration_runtime_instances`) each implement a small subset of verbs via local `if/elif` chains.
- **`audit_spell_pipeline_support()` gives false positives**: it only checks set membership, not whether a verb actually has an executor.
- **The "single pilot" Hex itself has 5 of 11 declared effects as dead code** — they live in `spells.json` but never run; the runtime works only because dead effects are replaced by hardcoded behavior elsewhere (e.g., `notify_target_downed` hardcodes `transfer_available=true` instead of executing the `on_target_downed` phase).
- **1 of 364 spells migrated** since the spec was written (2026-03-23, ~2 months ago). The migration has stalled because the cost of adding spell #2 = the cost of completing the engine.

## 2. Goal

Replace the 6 hand-rolled execution sites with a single phase executor and a verb dispatcher registry, so:

- `spells.json` is the *real* source of truth for what verbs run at what trigger
- Adding a new spell to v2 = writing JSON + (only when needed) registering one new verb handler
- Adding a new trigger callsite = one `await execute_phase(db, instance, trigger, ctx)` call
- `audit_spell_pipeline_support()` reflects real executability

Hex behavior must remain byte-for-byte identical end-to-end during and after the migration — its 12 existing tests are the golden regression gate.

## 3. Non-goals

- Do NOT migrate area / zone / summon / illusion host spells (they need `host_entities` work; deferred to spell_runtime_engine v2).
- Do NOT delete the `spell_resolver` legacy path. 363 of 364 spells still use it.
- Do NOT wire `on_reaction` in v1 — the reaction flow itself is mid-redesign elsewhere.
- Do NOT change any frontend API surface. `/api/spells/cast`, `/api/spells/runtime-actions/execute`, `token_update` projection fields keep identical shapes.
- Do NOT add a new database migration. The existing `spell_runtime_instances` table is sufficient.
- Do NOT touch tests outside `backend/tests/unit/test_spell_runtime_service.py` and the new bless-migration test, beyond what's required to keep them passing.

## 4. Architecture

New subpackage `backend/app/services/spell_runtime_engine/`:

```
spell_runtime_engine/
  __init__.py          # public: execute_phase, register_verb, audit_pipeline, VerbResult, PhaseExecutionContext
  context.py           # PhaseExecutionContext / VerbResult / PhaseResult dataclasses
  verb_registry.py     # VERB_HANDLERS dict + @register_verb decorator
  phase_executor.py    # async execute_phase(db, instance, trigger, ctx) -> PhaseResult
  audit.py             # audit_pipeline() — replaces audit_spell_pipeline_support
  verbs/
    __init__.py        # imports all verb modules to trigger registration
    mark.py            # apply_mark, retarget_mark
    runtime_param.py   # set_runtime_param, clear_runtime_param
    granted_action.py  # grant_action
    narrative.py       # narrative
    visual.py          # apply_token_filter (wires into spell_visual projection)
    damage.py          # conditional_extra_damage
    modifier.py        # grant_advantage, grant_disadvantage, grant_resistance, grant_immunity, modify_roll
    lifecycle.py       # end_spell_instance
```

`backend/app/services/spell_runtime_service.py` keeps its public surface (`create_runtime_spell_instance`, `get_runtime_bonus_damage`, `execute_runtime_action`, `notify_target_downed`, `end_concentration_runtime_instances`, `get_token_runtime_modifier_effects`, projection / loading / publish functions) but their bodies delegate verb dispatch to the engine. Routes (`spell_cast.py`, `combat.py`, `tokens.py`, `time_handler.py`) are untouched.

### Why a subpackage, not just more functions in `spell_runtime_service.py`

The service file is already 1493 lines. Per repo convention (`~/.claude/CLAUDE.md` line guideline + AGENTS.md "keep route files thin"), we extract rather than grow. Each verb file ends up ~30-80 lines, which is the right scale for "one verb's behavior" to be reviewable in isolation.

## 5. Core data contracts

```python
@dataclass
class PhaseExecutionContext:
    db: AsyncSession
    instance: SpellRuntimeInstance
    spell_data: dict
    trigger: str
    # Optional fields filled by the caller depending on trigger.
    # Verb handlers declare which fields they require.
    primary_target: Optional[TargetInfo] = None
    attacker_token_id: Optional[int] = None
    attack_kind: Optional[str] = None        # "weapon" / "spell" / ...
    critical: bool = False
    invoked_action_id: Optional[str] = None
    invoked_target_token_id: Optional[int] = None
    current_world_time: Optional[dict] = None

@dataclass
class VerbResult:
    """Everything a single verb wants to change. The executor aggregates and applies."""
    narrative_parts: list[str] = field(default_factory=list)
    bonus_damages: list[RuntimeBonusDamage] = field(default_factory=list)
    modifier_effects: list[dict] = field(default_factory=list)
    touched_token_ids: set[int] = field(default_factory=set)
    param_updates: dict[str, Any] = field(default_factory=dict)
    primary_target_change: Optional[int] = None
    linked_targets_change: Optional[list[int]] = None
    granted_actions_append: list[dict] = field(default_factory=list)
    status_change: Optional[str] = None              # "ended" / None
    sync_visual_tokens: list[Token] = field(default_factory=list)
    token_filter: Optional[dict] = None              # for apply_token_filter

@dataclass
class PhaseResult:
    """Aggregate of N VerbResults across all matching phases for one (instance, trigger) call."""
    # same field set as VerbResult, plus:
    failed_verbs: list[tuple[str, str]] = field(default_factory=list)  # (verb_type, reason)
```

### Verb handler protocol

```python
VerbHandler = Callable[[PhaseExecutionContext, dict], Awaitable[VerbResult]]

@register_verb("apply_mark", required_ctx={"primary_target"})
async def _apply_mark(ctx: PhaseExecutionContext, effect: dict) -> VerbResult:
    target = ctx.primary_target
    return VerbResult(
        param_updates={
            "marked_token_id": target.token_id,
            "marked_target_name": target.name,
            **(effect.get("params") or {}),
        },
        touched_token_ids={target.token_id},
        narrative_parts=[f"{ctx.instance.spell_name} 标记了 {target.name}"],
    )
```

### Hard rules for verb handlers

1. **No direct `instance` mutation.** All changes go through `VerbResult`. The executor applies them atomically after iterating all effects.
2. **No `db.commit()`.** The caller of `execute_phase` decides when to commit (typically once per route call).
3. **No `realtime_publisher` calls.** Returning `touched_token_ids` is enough; the caller publishes after commit.
4. **Declare required ctx fields** via the `@register_verb(required_ctx={...})` decorator. The executor checks them up front and skips the verb (logged warning) if missing.
5. **Idempotent under retry** where possible. A verb invoked twice with the same effect dict should not double-apply (this matters for the realtime layer's at-least-once delivery).

## 6. Phase executor

```python
async def execute_phase(
    db: AsyncSession,
    instance: SpellRuntimeInstance,
    trigger: str,
    ctx_overrides: dict,            # caller-supplied trigger-specific fields
    *,
    spell_data: Optional[dict] = None,
) -> PhaseResult:
    spell_data = spell_data or get_spell_by_id(instance.spell_id)
    if not spell_data:
        return PhaseResult()  # not loud — instance with deleted spell is a tolerable edge

    phases = get_spell_effect_phases(spell_data, instance.selected_option)
    matching = [p for p in phases if _phase_matches(p, trigger, ctx_overrides)]
    if not matching:
        return PhaseResult()

    ctx = PhaseExecutionContext(db=db, instance=instance, spell_data=spell_data, trigger=trigger, **ctx_overrides)
    result = PhaseResult()

    for phase in matching:
        for effect in phase.get("effects") or []:
            verb_type = str(effect.get("type") or "")
            handler = VERB_HANDLERS.get(verb_type)
            if handler is None:
                result.failed_verbs.append((verb_type, "no handler"))
                logger.warning("spell_runtime: unhandled verb %s in spell %s", verb_type, instance.spell_id)
                continue
            try:
                verb_result = await handler(ctx, effect)
            except Exception as exc:
                result.failed_verbs.append((verb_type, repr(exc)))
                logger.exception("spell_runtime: verb %s raised in instance %s", verb_type, instance.id)
                continue
            _merge_verb_result(result, verb_result)

    _apply_to_instance(instance, result)  # in-memory only, caller commits
    return result
```

`_phase_matches` handles the existing `condition` filtering (e.g., `on_action_invoked` checking `action_id`).

`_merge_verb_result` aggregates lists, unions sets, last-write-wins for scalar state changes.

`_apply_to_instance` is the *only* code that mutates `instance` columns. Its writes:

- `result.param_updates` → merged into `instance.params` (existing keys overwritten)
- `result.token_filter` → written to `instance.params["token_filter"]` if non-None
- `result.primary_target_change` → `instance.primary_target_token_id`
- `result.linked_targets_change` → `instance.linked_target_token_ids`
- `result.granted_actions_append` → appended to `instance.granted_actions`
- `result.status_change` → `instance.status` (e.g., `"ended"`)

It does NOT call `flag_modified`, `db.commit`, or `realtime_publisher`. The caller (the service-layer function that invoked `execute_phase`) is responsible for SQLAlchemy `flag_modified` on JSON columns, transaction commit, and publishing realtime updates using `result.touched_token_ids`.

## 7. v1 verb set (Hex coverage)

These 11 verbs are exactly what Hex's JSON declares plus the modifier-bypass verbs that today live in `get_token_runtime_modifier_effects`:

| Verb | Trigger(s) it runs at in Hex | Source of current logic | New file |
|---|---|---|---|
| `apply_mark` | on_cast | `create_runtime_spell_instance:564-576` | `verbs/mark.py` |
| `retarget_mark` | on_action_invoked | `execute_runtime_action:1384-1400` | `verbs/mark.py` |
| `set_runtime_param` | on_cast, on_target_downed, on_action_invoked | scattered (2 sites) | `verbs/runtime_param.py` |
| `clear_runtime_param` | on_action_invoked | `execute_runtime_action:1401-1406` | `verbs/runtime_param.py` |
| `grant_action` | on_cast | `create_runtime_spell_instance:581-582` | `verbs/granted_action.py` |
| `narrative` | any trigger | partial: only on_cast site | `verbs/narrative.py` (works at all triggers) |
| `apply_token_filter` | on_cast | currently dead | `verbs/visual.py` (writes into spell_visual projection input) |
| `conditional_extra_damage` | on_hit, on_weapon_hit | `get_runtime_bonus_damage:1247-1287` | `verbs/damage.py` |
| `end_spell_instance` | on_concentration_end (+ on_action_invoked transfer cleanup) | hardcoded in `end_concentration_runtime_instances` | `verbs/lifecycle.py` |
| `grant_advantage`, `grant_disadvantage`, `grant_resistance`, `grant_immunity`, `modify_roll` | on_cast (modifier projection) | `get_token_runtime_modifier_effects:1142-1172` | `verbs/modifier.py` |

Modifier verbs are special: they don't mutate the instance; they emit `modifier_effects` entries that `get_token_runtime_modifier_effects` returns to the check / saving-throw services. Same data shape as today.

`apply_token_filter` requires deciding where the filter dict surfaces:
- Today it's nominally consumed by frontend `active_effects.tokenFilter`, but the runtime engine doesn't write it anywhere.
- Decision: `apply_token_filter` returns the filter in `VerbResult.token_filter`. The executor's `_apply_to_instance` writes it into `instance.params["token_filter"]` (just like any other param mutation). The token-projection builder (`build_token_spell_projection_map`) reads `params["token_filter"]` and surfaces it in `spell_overlays` / `spell_visuals` projection. No frontend change required because the projection field is already consumed by the map renderer.

## 8. Migration stages

Each stage is one logical PR (or one commit on the working branch). After each stage, **all 12 Hex tests + new verb tests added so far must be green**.

| # | Scope | Changed files | Verification |
|---|---|---|---|
| 1 | Build engine skeleton: `spell_runtime_engine/` subpackage, `PhaseExecutionContext` / `VerbResult` / `PhaseResult` dataclasses, `VERB_HANDLERS` registry, `execute_phase`, all 11 verbs in `verbs/*.py`. No callsite changes. | New files in `services/spell_runtime_engine/`; new tests under `tests/unit/spell_runtime_engine/` (one file per verb + executor test) | Engine unit tests green; Hex 12 tests still green (untouched code path). |
| 2 | Refactor on_cast: `create_runtime_spell_instance` builds the instance, then calls `execute_phase(db, instance, "on_cast", {"primary_target": primary_target})` and applies `PhaseResult` to its `SpellResolveResult` return value. Old inline if/elif removed. | `spell_runtime_service.py:516-620` | Hex 12 tests green. |
| 3 | Refactor on_hit / on_weapon_hit: `get_runtime_bonus_damage` loads instances and calls `execute_phase(..., "on_hit"|"on_weapon_hit", {"attacker_token_id":…, "attack_kind":…, "critical":…})`, maps `result.bonus_damages` to existing `RuntimeBonusDamage` return shape. | `spell_runtime_service.py:1238-1289` | Hex 12 tests green, especially `test_runtime_bonus_damage_*`. |
| 4 | Refactor on_action_invoked: `execute_runtime_action` validates the action then calls `execute_phase(db, instance, "on_action_invoked", {"invoked_action_id": action_id, "invoked_target_token_id": target})`. The side-effect `_sync_runtime_visual_spell_buff_targets` stays in `spell_runtime_service.py` and is called by `execute_runtime_action` *after* `execute_phase` returns, gated on `result.linked_targets_change is not None`. (Rationale: visual-sync queries / mutates Token rows; keeping it out of verb handlers preserves the "verbs don't touch realtime / DB beyond instance" rule.) | `spell_runtime_service.py:1336-1430` | Hex 12 tests green, especially `test_hex_transfer_action_visibility_*` and `test_retarget_runtime_spell_buff_moves_visual_effect_to_new_target`. |
| 5 | Refactor modifier projection: `get_token_runtime_modifier_effects(token_id)` iterates instances where `instance.primary_target_token_id == token_id` (unchanged), and for each matching instance calls `execute_phase(db, instance, "on_cast", {})` then collects `result.modifier_effects`. Modifier verbs are pure transformations (effect dict → modifier dict) and don't need any ctx fields beyond the instance, so the ctx_overrides dict is empty. | `spell_runtime_service.py:1120-1174` | Hex 12 tests green, including disadvantage tests. |
| 6 | Wire previously-dead Hex JSON: (a) `notify_target_downed` now calls `execute_phase(..., "on_target_downed", {})` instead of hardcoding `transfer_available`; (b) `end_concentration_runtime_instances` calls `execute_phase(..., "on_concentration_end", {})` before marking ended; (c) confirm `apply_token_filter` writes into `params["token_filter"]` and the projection picks it up. Add 3 new regression tests asserting these phases now actually fire. | `spell_runtime_service.py:1062-1118, 1291-1333`; `tests/unit/spell_runtime_engine/test_dead_code_revived.py` | Hex 12 tests green; 3 new tests assert the JSON-declared effects now run. |
| 7 | Wire turn-phase triggers: in `time_handler` (or the equivalent round-advance site — to be confirmed during implementation), after `cleanup_expired_runtime_instances`, iterate active instances and call `execute_phase(..., "start_of_turn"\|"end_of_turn", {})` based on whose turn it is. Also wire `start_of_target_turn` / `end_of_target_turn` keyed by `primary_target_token_id`. Move `on_enter_zone` / `on_leave_zone` from `combat.py:/zone-spell-settle` over to executor for consistency (keep the route as transport). Add 4 new tests with synthetic v2 spells using these triggers. | `services/websocket_handlers/time_handler.py`, `api/routes/combat.py` (zone-spell-settle bridge), `spell_runtime_service.py` (new entry function `advance_turn_for_campaign(...)`) | New turn-phase tests green; Hex tests still green. |
| 8 | Upgrade audit: `audit_pipeline()` reports separately `declared_only` (in `SUPPORTED_RUNTIME_TRIGGERS / SUPPORTED_RUNTIME_VERBS` but no handler / no callsite) vs `dispatched`. Delete `audit_spell_pipeline_support` and migrate its callers (grep shows it's only invoked from tests + one debug script — internal API, safe to break). Add test that a synthetic spell using an unhandled verb appears in `declared_only`. | `spell_runtime_service.py:223-256` -> `spell_runtime_engine/audit.py` | New audit test green; old audit function fully removed. |
| 9 | Migrate second spell as end-to-end validation. Candidate: `bless` (1st-level, 1 minute, concentration, gives +1d4 to attack rolls and saving throws of up to 3 targets). JSON requires: `on_cast` with `apply_mark` (3 targets via linked_target_token_ids), `modify_roll` modifier on attack and saves; `on_concentration_end` with `end_spell_instance`. May need a new verb `set_visual_effect` if we want a sparkle overlay — keep optional. Add full bless test (cast → modifier flows → end clears). | `frontend/app/data/rules/spells.json` (add `runtime.engine: "v2"` to bless), `tests/unit/spell_runtime_engine/test_bless_migration.py`, possibly `verbs/visual.py` for `set_visual_effect` | Bless test green; manual browser smoke (cast bless → 3 targets get badges → attack rolls show +1d4 → end concentration clears). |

Stages 1-8 are pure refactor — no observable behavior change. Stage 9 is the first observable win (a second v2 spell working end-to-end).

## 9. Error handling

| Failure | Behavior | Where logged |
|---|---|---|
| `spells.json` references unknown verb | Log warning(`spell_id`, `verb_type`), record in `PhaseResult.failed_verbs`, continue with remaining effects. Audit will surface it offline. | `phase_executor._dispatch` |
| Verb handler raises | Catch, log exception with `instance.id` + `verb_type` + sanitized effect (no PII / no large blobs), record in `failed_verbs`, continue. | `phase_executor._dispatch` |
| Required ctx field missing | Log warning; skip verb; record in `failed_verbs`. | `verb_registry._check_ctx` |
| `get_spell_by_id` returns None (orphaned instance) | Return empty `PhaseResult`. Caller's behavior matches today (no-op). | `execute_phase` |
| `_apply_to_instance` write fails (DB issue) | Propagate. Caller's existing transaction handling rolls back. | caller |

**Never** swallow exceptions silently above the dispatch layer — the service layer's caller (route) decides whether to surface to the user.

## 10. Test strategy

### Unit (one file per verb + one for executor)

`tests/unit/spell_runtime_engine/`
- `test_apply_mark.py`, `test_retarget_mark.py`
- `test_runtime_param.py` (set + clear)
- `test_grant_action.py`
- `test_narrative.py`
- `test_apply_token_filter.py`
- `test_conditional_extra_damage.py`
- `test_modifier_verbs.py`
- `test_end_spell_instance.py`
- `test_executor.py` — synthetic phases with multiple verbs, error isolation, ctx field gating
- `test_audit.py` — declared-vs-dispatched distinction
- `test_dead_code_revived.py` — Hex's on_target_downed / on_concentration_end / apply_token_filter now actually run
- `test_turn_phase_triggers.py` — synthetic v2 spell using start_of_turn / end_of_turn
- `test_bless_migration.py` — second-spell end-to-end

### Existing tests (must not regress)

`backend/tests/unit/test_spell_runtime_service.py` — all 12 tests run unchanged at every stage. This is the hard regression gate. If any stage fails one of these, the stage is rejected and reverted before moving on.

### Manual verification (stage 9 only)

Browser smoke test in dev (`./dev-start.sh`):
1. Cast Hex on a monster → confirm disadvantage applies, badge shows, +1d6 necrotic on hit. (Hex regression)
2. Cast Bless on 3 PCs → confirm +1d4 on attack rolls and saves, badges show. End concentration → modifiers and badges clear. (New v2 spell)
3. Drop the Hex target's HP to 0 → confirm "Transfer Hex" action surfaces. (Confirms on_target_downed phase runs.)

### Out of scope for tests

Stage 7's `on_enter_zone` callsite move is verified via the existing `test_zone_spell_settlement_timing.py` (must stay green) plus the new executor test. No new zone test in this spec.

## 11. Performance

Each `execute_phase` call:
- Loads spell_data via the already-cached `get_spell_by_id` (LRU cache in `rules_cache`).
- Iterates phases (~1-5 per spell) × effects (~1-5 per phase) = ~10 dict lookups + ~10 async handler calls in the worst case.
- For trigger sites called per-attack (`on_hit`), this runs once per active concentration spell of the attacker — typically 0-1, max 5.

No new DB queries beyond what the old sites already did. The instance is already loaded by the caller in every site we touch.

**Watch-out**: stage 7 turn-phase wiring runs `execute_phase` over all active instances at each turn advance. With N = number of active concentration spells in a campaign (typically <10), this is negligible. If we ever hit N>50, batch by spell_id.

## 12. Rollback

Each stage is self-contained:
- Stages 1, 9: net-new files. Revert = delete.
- Stages 2-6: each touches one function in `spell_runtime_service.py`. Revert = restore that function from the previous commit. Engine subpackage stays (it's still tested).
- Stage 7: revert the `time_handler` change; old behavior was a no-op (the 4 triggers didn't run), so reverting is safe.
- Stage 8: keep both `audit_pipeline` and `audit_spell_pipeline_support` if you want the safety net. Revert removes the new one.

The 12 Hex tests are the contract. If they break, the most recent stage is the suspect — revert and diagnose.

## 13. Open questions for implementation

These do NOT block writing the plan but need a decision before / during stage 7:

1. **Turn-phase hookpoint location.** `time_handler` handles world-time advancement; combat-round advancement may live in `combat_resolution_service` or `combat.py`. Need to grep for the current "end of turn" code path during stage 7 and confirm whether one or two hookpoints are required.
2. **Bless's exact JSON shape.** v1 Bless attack-roll bonus is `+1d4` on every attack, which is `modify_roll`, but the modifier verbs today only handle binary advantage/disadvantage and damage resistance. `modify_roll` is in the supported set but never tested. Stage 9 will need to either (a) ensure `modify_roll` actually works through the check / attack pipeline, or (b) defer Bless and pick a simpler spell like `hunter's_mark`.
3. **Idempotency for turn-phase triggers.** If `execute_phase("start_of_turn")` is called twice for the same round (e.g., reconnect replay), do we re-apply effects? Tentative: yes, because verbs are written idempotent — but document this in the verb handler contract.

## 14. Acceptance criteria (whole project)

The project is "done" when:

- All 9 stages merged.
- `audit_pipeline()` reports 0 `declared_only` verbs / triggers for the v1 verb set.
- All 12 original Hex tests pass.
- All new engine tests pass.
- At least one additional spell (`bless` or substitute) is migrated to runtime v2 and verified end-to-end in the browser.
- `spell_runtime_service.py` line count drops by at least 200 lines (verb dispatch extracted).
- No frontend file is modified, no API shape changes, no database migration added.

## 15. Out-of-band notes for the implementation plan

- Use `Agent({subagent_type: "Plan", ...})` to draft each stage's task list — these stages have non-trivial sequencing and a plan agent will catch ordering mistakes I'd make ad hoc.
- Each stage's commit message: `refactor(spell-runtime): stage <n> - <one-line scope>`. Conventional commits, lowercase scope, imperative.
- Do not bundle stages into mega-commits. Each stage is its own commit so revert points are clear.
- Do not skip running `pytest backend/tests/unit/test_spell_runtime_service.py` between stages even if it feels redundant. It's the regression gate.
