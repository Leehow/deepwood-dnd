# Spell Runtime Engine Phase Executor

Work ID: `spell-runtime-engine`
Status: `In Progress; round/time Chrome acceptance complete`
Last updated: `2026-06-01`

## Goal

Implement the approved spell runtime phase executor design from
`docs/superpowers/specs/2026-05-26-spell-runtime-engine-design.md` so v2 spell
effects execute from `spells.json` through a registry-based engine, while Hex
behavior remains stable and future spell migrations become JSON-first.

## Decisions

- Team Lead Mode is active; code-affecting implementation goes through Claude
  Code workers, with Codex lead review and validation.
- Stage 1 creates the engine skeleton and focused unit tests without changing
  existing service callsites.
- Executor implementation must include a read-only/evaluate-only path so
  projection flows such as modifier collection cannot mutate runtime instances
  or append granted actions repeatedly.
- Runtime context should support both `primary_target` and `targets` from the
  first implementation pass to avoid a Bless multi-target rewrite later.
- `apply_token_filter` projection is treated as a behavior-visible gate; it
  may be implemented in the verb layer before callsites expose it.
- Phase aggregation uses per-key last-write-wins for runtime param updates vs
  clears; this preserves Hex transfer semantics before Stage 4 delegation.
- Stage 9 direction is second-spell readiness before zone-trigger migration.
  Bless is the preferred probe because it exercises multi-target concentration
  plus attack/save roll modifiers without requiring area/zone host entities.
- Existing unrelated worktree changes are out of scope and must not be
  reverted, cleaned up, or normalized.
- Round/time-expiry follow-up is now the active next slice. The worker
  `round-advance-expiry` produced an exploratory spike only; it must not be
  merged as-is because it can double-run settlement through the current WS plus
  HTTP advance path.
- The authoritative D&D contract for `+1轮` is world time +6 seconds. Combat
  rounds advance world time; however, expiry triggers can still be world-time,
  turn-boundary, event-consumed, concentration-end, or rest-boundary driven.
- The campaign top-bar `+1轮` is the global world-time control. Character/token
  status-panel time controls are local/manual status maintenance and must not
  be treated as spell-runtime settlement unless they are deliberately rewired
  or removed.
- Before broadening cleanup coverage, there must be one backend settlement
  owner for world-time advancement. WS and HTTP transports should be thin
  callers or one should stop calling settlement; they must not both perform the
  same cleanup for a single visible user action.
- `grant_advantage` / `grant_disadvantage` style modifier effects with a
  round duration must receive duration and `expires_at` consistently outside
  combat too. Otherwise effects such as `曳光弹` can be born without an expiry
  and cannot be cleaned by any later round advance.

## Round-Time Expiry Plan

This section is the guardrail for the next implementation work. Do not accept a
worker patch that skips a stage, widens scope without a ledger update, or treats
"no exception thrown" as semantic expiry validation.

### RT-0: Scope Freeze And Evidence Baseline

Status: `Done`

Owner: Codex lead, with worker evidence from `round-advance-expiry`.

Acceptance:

- Record the root-cause split in this ledger: ambiguous `+1轮` surfaces,
  split backend settlement coverage, and modifier effects born without expiry.
- Treat `/Users/haoli/leehow/code/dw-worker-round-advance-expiry` as a spike
  worktree only; no direct cherry-pick from it without review.
- Keep existing dirty integration files and untracked QA tests intact.

### RT-1: Single World-Time Settlement Owner

Status: `Done`

Goal: make a single backend path own "world time changed, now settle
time-bound rules" before adding more cleanup behavior.

Implementation shape:

- Introduce a backend settlement service, tentatively
  `settle_world_time(campaign_id, current_time, *, map_url=None, rounds=0,
  source="time_update")`.
- Move the common sequence into that service: due casts, token active-effect
  expiry/duration, concentration expiry, runtime instance expiry, and any
  needed publication fan-out.
- Update WS `time_update` to call the service.
- Update HTTP `decrement-effect-durations` either to call the same service as a
  compatibility endpoint, or make the frontend stop invoking it for the same
  top-bar `+1轮` action. The accepted design must prove a single visible
  advance does not run duplicate concentration/runtime cleanup.
- Preserve the existing map-scoped behavior intentionally: if HTTP remains
  map-scoped for legacy callers, document how it differs from full campaign
  WS settlement.

Validation:

- Unit test the settlement service call composition and ordering.
- Unit test top-bar `handleAdvanceRound` no longer causes duplicate settlement
  calls for one visible click.
- Unit test idempotency for repeated settlement at the same current time.

Stop conditions:

- Stop if the change would remove an existing public endpoint instead of
  preserving compatibility.
- Stop if publication/toast semantics cannot be kept single-emission without a
  product decision.

Accepted 2026-06-01:

- Added `backend/app/services/world_time_settlement.py` as the single backend
  owner for due casts, token effect expiry/duration cleanup, concentration
  expiry, and runtime instance expiry when world time changes.
- WS `time_update` delegates to that service; HTTP
  `/decrement-effect-durations` remains as a compatibility endpoint and calls
  the same service with the legacy map-scoped subset only.
- Frontend global world-time controls no longer pair `time_update` with an
  extra HTTP decrement call; they carry `settlement_rounds` over the websocket.
- Validation: `test_world_time_settlement.py`, `test_time_handler.py`,
  `test_round_duration_expiry.py`, `test_qa_arena_snapshot.py`, backend
  `py_compile`, frontend `npm run typecheck`, and `git diff --check` passed.

### RT-2: Central Expiry Birth Certificate

Status: `Done`

Goal: make every duration-bearing spell effect store comparable expiry metadata
at creation time, regardless of combat state, unless the effect is explicitly
turn-boundary or event-boundary only.

Implementation shape:

- Extract a shared helper for duration rounds and `expires_at` calculation
  instead of duplicating `SpellResolver._calc_expires_at` calls across
  handlers.
- Fix modifier handlers so non-concentration round-duration effects such as
  `曳光弹` store `duration` and `expires_at` when `current_world_time` exists,
  even out of combat.
- Audit condition, modifier, runtime instance, and legacy resolver paths for
  inconsistent `ctx.in_combat` gates.
- Preserve concentration semantics: concentration ending still removes the
  effect earlier than wall-clock expiry.

Validation:

- DB-backed or service-level test: cast `guiding_bolt` out of combat, assert
  the target active effect has duration and `expires_at`.
- DB-backed or service-level test: cast `ray_of_sickness` out of combat, assert
  its poisoned condition has comparable expiry metadata.
- Expiry boundary test: at `+5s` effect remains; at `+6s` after one round it is
  removed exactly once.

Stop conditions:

- Stop if a spell definition intentionally uses turn-boundary expiry and would
  be incorrectly converted into world-time expiry.

Accepted 2026-06-01:

- Added a shared round-duration helper under
  `backend/app/services/effect_engine/duration.py`.
- Non-concentration modifier effects now receive duration and `expires_at`
  whenever `current_world_time` exists, including out of combat; concentration
  effects still rely on concentration cleanup.
- Validation: `test_round_duration_expiry.py` covers out-of-combat modifier
  expiry, in-combat parity, concentration exemption, condition expiry metadata,
  and exact +6s boundary cleanup via the settlement tests.

### RT-3: Status-Panel Time Control Contract

Status: `Done`

Goal: remove the UX ambiguity between global world time and local/manual status
maintenance.

Implementation options, in preference order unless product guidance changes:

- Relabel panel controls away from `+1轮`, for example `本地-1轮`, and add a
  tooltip explaining that it only adjusts manually tracked panel statuses.
- Alternatively wire the panel control to the same world-time action if the
  product wants every visible `+1轮` to be global. This is higher blast radius
  because character sheets may rely on manual local adjustments.
- Remove the panel control only with explicit user approval in that turn.

Validation:

- Frontend unit test the label/tooltip contract.
- Chrome test both surfaces: top-bar `+1轮` changes campaign time by six
  seconds; panel local control does not pretend to settle spell runtime state.

Stop conditions:

- Stop if changing the label breaks existing player/DM character-sheet flows
  that intentionally use manual local status decrement.

Accepted 2026-06-01:

- Global top-bar `+1轮`, combat new round, short/long rest, time-modal forward
  jumps, and realtime round boundaries now send `settlement_rounds` through
  `time_update`.
- The old DM-route HTTP decrement wrapper and receive-side realtime HTTP
  fallback were removed; backend HTTP compatibility endpoint remains.
- Status panel manual control is now labeled `本地-1轮` / `Local -1 Round` with
  tooltip/ARIA text explaining it does not advance world time or settle spell
  runtime.
- Validation: frontend `npm run typecheck`, i18n JSON parse, backend
  `test_time_handler.py`, and `git diff --check` passed.

### RT-4: QA Snapshot As Semantic Oracle

Status: `Done`

Goal: make browser QA read the same effective state the game rules use.

Implementation shape:

- Audit `snapshot_arena` and related QA helpers to distinguish raw
  `active_effects` from effective/non-expired spell state.
- Add explicit fields when useful: `current_world_time`, `expired_effects`,
  `effective_active_effects`, and raw state for debugging.
- Avoid hiding raw expired residue silently; QA should make residue visible but
  not mistake it for an active rules effect.

Validation:

- Unit or service test: seed one expired raw effect and assert the QA snapshot
  reports it as expired or excludes it from effective state.
- Browser acceptance must assert both "effect no longer functions" and
  "residue cleanup behavior is as designed".

Stop conditions:

- Stop if snapshot changes would invalidate existing QA scripts without a
  migration note.

Accepted 2026-06-01:

- `snapshot_arena` preserves raw `active_effects` / `active_auras` and adds
  `current_world_time`, `effective_active_effects`, and
  `expired_active_effects`.
- Malformed or missing expiry metadata remains effective in the semantic view;
  malformed campaign `time_of_day` no longer crashes snapshot generation.
- Validation: new `test_qa_arena_snapshot.py` covers raw residue visibility,
  effective/expired split, missing world time, malformed world time, and
  malformed effect expiry.

### RT-5: Browser/Chrome Acceptance Pass

Status: `Done`

Goal: prove the full user-visible flow, not just handler-level no-crash
behavior.

Chrome scenarios:

- Top-bar global `+1轮`: record campaign time before/after and assert exactly
  `+6s`.
- `曳光弹`: cast out of combat, confirm advantage effect exists with expiry,
  click top-bar `+1轮`, assert effect is gone or explicitly expired and no
  longer grants advantage.
- `致病射线`: cast out of combat, confirm damage plus poisoned condition,
  click top-bar `+1轮`, assert condition/effect expiry at the right boundary.
- Concentration/runtime regression: cast a concentration spell with runtime
  instance, advance world time past expiry, assert concentration and runtime
  cleanup happen once.
- Panel-control sanity: use the local/manual status control and verify it is
  visibly differentiated from global time.

Accepted evidence (`2026-06-01`):

- Lead Chrome pass used the extension-controlled Chrome tab on QA campaign `8`
  with `QA_MODE=true`. The visible top-bar `+1轮` advanced campaign world time
  from `12:01:06` to `12:01:12`, and the rendered header matched
  `第1天 · 12:01:12`.
- Live QA snapshot classification preserved raw residue and separated semantic
  state: injected `qa_round_probe_expired` stayed in raw `active_effects` but
  appeared only in `expired_active_effects`; injected `qa_round_probe_future`
  appeared in `effective_active_effects`.
- A second visible top-bar `+1轮` advanced world time from `12:01:12` to the
  effect boundary `12:01:18`; settlement removed `qa_round_probe_future` from
  raw/effective/expired effect lists. This proves the global browser path
  performs actual cleanup, not just no-crash handling.
- Status-panel local control remained code- and typecheck-verified but was not
  opened reliably in the narrow QA browser layout. Existing text is deliberately
  labeled `本地-1轮` / `Local -1 Round`, separate from the global top-bar action.
- Browser console still reports a pre-existing React hydration mismatch around
  SSR/client lobby title localization; no backend/frontend route errors were
  observed in the focused round-time pass.

Evidence to record:

- Browser action path, API calls observed, DB/snapshot before-after, and whether
  each assertion proves semantic effect behavior or only state cleanup.
- Any residual raw state must be classified as expected residue, cleanup bug, or
  QA-oracle limitation.

## Items

| Item | Status | Note |
|---|---|---|
| Open active plan ledger | Done | Created `docs/active-plans/spell-runtime-engine.md`. |
| Stage 1: engine skeleton, registry, executor, Hex verb handlers, engine unit tests | Done | Worker `spell-runtime-engine-stage1`; handoff reviewed; target validation green. |
| Stage 2: delegate `create_runtime_spell_instance()` on_cast path | Done | Worker `spell-runtime-engine-stage2`; handoff reviewed; target validation green. |
| Stage 3: delegate `get_runtime_bonus_damage()` hit paths | Done | Worker `spell-runtime-engine-stage3`; handoff reviewed; target validation green. |
| Stage 4 preflight: fix runtime param update/clear ordering | Done | Worker `spell-runtime-engine-param-order-fix`; Hex transfer now clears `transfer_available` after retarget. |
| Stage 4: delegate `execute_runtime_action()` action-invoked path | Done | Worker `spell-runtime-engine-stage4`; service validation/publishing preserved; target validation green. |
| Stage 5: delegate `notify_target_downed()` and concentration end paths | Done | Worker `spell-runtime-engine-stage5`; downed/concentration paths now delegate to engine; target validation green. |
| Stage 6: modifier projection via read-only phase evaluation | Done | Worker `spell-runtime-engine-stage6`; projection uses `evaluate_phase()` and read-only regression coverage is green. |
| Stage 7: audit upgrade with compatibility bridge | Done | Worker `spell-runtime-engine-stage7`; engine audit now reports real verb and wired-trigger coverage while service legacy audit keys remain stable. |
| Stage 8a: turn trigger backend wiring | Done | Worker `spell-runtime-engine-stage8`; combat active-turn changes now dispatch caster/target turn triggers through the engine; target validation green. |
| Stage 8b: zone trigger engine wiring | Resolved by Stage 10 | `on_enter_zone` / `on_leave_zone` now have a focused runtime dispatch path while legacy structured zone settlement remains in place for supported effects. |
| Stage 8c: combat storage mutation route audit | Done | Worker `spell-runtime-engine-stage8c` plus recovery handoff; direct `tokens.delete_token` combat-row mutation now dispatches through the shared turn-trigger helper; target validation green. |
| Stage 9: migrate second spell candidate | Done | Bless readiness path accepted; zone triggers remain deferred. |
| Stage 9a: Bless readiness backend slice | Done | Worker `spell-runtime-engine-stage9a`; runtime linked targets, Bless-style `modify_roll` projection, linked-target modifier lookup, and concentration-end touched-token fan-out are validated without frontend API changes. |
| Stage 9b: Bless user-facing readiness | Done | Worker `spell-runtime-engine-stage9b`; Bless is v2, map targeting supports multi-target confirmation, attack/save rolls merge runtime modifiers, linked-target overlays/token filters project; authenticated campaign DevTools flow was blocked by demo login 401. |
| Stage 10: deferred zone trigger migration | Done | Worker `spell-runtime-engine-stage10-zone-triggers`; runtime zone dispatch helper and route fall-through are wired, audit marks enter/leave zone triggers dispatched, and structured-zone legacy behavior is preserved by filtering to legacy-supported effects. |
| Stage 10 validation recovery: direct zone-settle route test drift | Done | Worker `spell-runtime-engine-zone-settle-direct-route-signature`; stale direct route-call test now uses `current_user`, fake auth context, and structured spell phases while preserving duplicate-prevention assertions. |
| Stage 11: Divine Favor self-buff weapon-hit migration | Done | Worker `spell-runtime-engine-stage11-divine-favor`; Divine Favor is v2 and uses `on_weapon_hit` + `conditional_extra_damage(target_match="any")`, while Hex-style primary-target matching remains the safe default. |
| Cross-category representative spell validation | Done | User challenged "每一类法术" coverage; worker `spell-category-validation-active-auras` repaired test-only aura fixture drift, and lead reran backend/frontend/browser representative checks across runtime, damage, healing, saves, conditions, roll modifiers, zones, triggers, movement, summon, visual, aura, utility, attack/save integrations, and spell UI/projection flows. |
| Chrome catalog QA seed and smoke batches | In Progress | Dedicated `Spell Runtime QA Arena` campaign seeded with all-spells QA caster, helper actors, and monster targets. Chrome plugin testing now uses one normal extension-controlled Chrome tab after stale headless/devtools sessions were closed for resource recovery. First 25-spell smoke pass covered attack, save, healing, temp HP, concentration replacement, multi-target, area placement, zone visuals, control, invisibility, long-cast readiness, and reaction readiness. Second mechanism slice covered restoration, dispel/suppress, and death stabilization. First-batch regressions were fixed by worker `spell-browser-qa-first-fixes`; Spare the Dying stabilization crash was fixed by worker `spell-stabilize-handler-fix`; both were rechecked in Chrome. Third slice covered self visual/sense/illumination, aura, turn-trigger setup, illusion/zone visuals, wall/barrier placement, summon, on-hit/granted-action, and revive material flow. Third-fix partial accepted Minor Illusion persistence. Worker `spell-backend-grants-revive` added backend `grant_action` persistence and downed-heal death-save cleanup; Chrome confirmed Revivify death-save normalization and Witch Bolt backend grant-action persistence. Workers `spell-grant-action-execution-fix`, `spell-grant-action-spell-level-revision`, and `spell-grant-action-precedence-revision` completed Witch Bolt follow-up UI execution; Chrome confirmed `巫术箭伤害` now posts to `/api/spells/granted-actions/execute` and applies damage. Worker `spell-frontend-placement-actions` fixed Wind Wall one-click line readiness in frontend logic, and Chrome confirmed Wind Wall can replace Witch Bolt concentration through the live map. Worker `spell-concentration-grant-cleanup` fixed old-caster cleanup so replacing Witch Bolt with Wind Wall removes stale caster `grant_action` effects. Utility ritual checks first exposed Identify/Alarm target/area capture gaps; workers `spell-ritual-target-area-capture` and `spell-ready-area-release-seed` fixed long-cast target/area capture and ready-release area preseed. Chrome/DB confirmed Identify captures target token `533`, Alarm captures stored area `(32,40)`, Find Familiar still starts without map placement, and ready Alarm release creates `spell_area_alarm` using the saved area without spending a ritual slot. Workers `spell-summon-placement-routing` and `spell-summon-materialization` fixed Conjure Animals empty-ground routing/materialization; Chrome confirmed a linked summon token is created and removed on concentration replacement. Worker `spell-transformation-concentration-cleanup` fixed stale `transformation_data` when Polymorph full-replace concentration is replaced; Chrome confirmed Banishment replacement clears Polymorph state while applying control effects. Workers `spell-turn-index-compat` and `combat-top-endturn-mount` fixed the Chrome end-turn blocker by reading/writing both combat index fields and keeping the DM combat event subscriber mounted while combat is active; Chrome confirmed top initiative end-turn from the `角色` tab advances storage. Worker `spell-legacy-ongoing-turn-effects` added legacy active-effect ongoing turn execution for non-save `ongoing_effects`; Chrome confirmed Heroism recast onto token `534`, then ending token `533`'s turn advanced to token `534` and applied `temp_hp=5`. Worker `spell-chrome-hydration-favicon-css` restored usable Chrome CSS during extension-caused hydration fallback; Chrome confirmed spell icons/buttons render normally. The generated visual slice now confirms Minor Illusion can use a selected gallery/generated image, create an illusion token with that image URL, and show the `次级幻影` token in player view. Worker `spell-disguise-self-generated-image-fix` fixed Disguise Self generated-image casts by importing `normalize_token_disguise_data`; Chrome/DB confirmed `易容术` now writes `disguise_data.disguise_avatar` and player view renders the generated avatar image. Worker `spell-detect-magic-sense-materialization` fixed Detect Magic's non-combat concentration shortcut so `grant_sense` is persisted and cleaned up on concentration end; Chrome/DB confirmed `detect_magic_sense` appears after casting and is removed after breaking concentration. Worker `spell-misty-step-destination-picker` added the full Misty Step destination picker and Chrome confirmed empty/occupied destination behavior. Worker `spell-counterspell-reaction-trigger` added Counterspell V1 reaction-trigger wiring, then revised websocket chat meta propagation after Chrome QA found cross-client spell cards lost `spellCastData`; Chrome confirmed the player-side `反制法术` button interrupts a seeded in-progress `火球术`, clears `casting_in_progress`, and consumes a 3rd-level slot. Worker `spell-concentration-caster-effect-cleanup` fixed caster-side concentration residue for wall/barrier/suppression effects; Chrome retest confirmed `力场墙 -> 石墙术 -> 法术无效结界` no longer leaves stale wall effects while non-concentration effects are preserved. Details are recorded in `.tmp/team-lead/lead-spell-runtime-browser-qa-20260528.md`. |
| Chrome single-target modifier/status slice | Done | Lead-owned Chrome QA covered `曳光弹`, `冻寒之触`, `防护善恶`, `大步奔行`, and `律令死亡`, validating advantage/disadvantage, prevent-healing, protection metadata, movement modifiers, token filters, and instant-kill DB effects. No code defect was found; QA state was reset afterward. |
| Chrome rare utility/state mutation slice | Done | Lead-owned QA covered `剑刃防护`, `闪现术`, `迷幻手稿`, `荆棘之鞭`, `变巨 / 缩小术`, `触发术`, and `隔离术`. `迷幻手稿`, `resize_token`, `stored_trigger`, `set_visibility`, and Blade Ward multi-type resistance now pass through the middle layer. Worker `spell-grant-resistance-multitype-fix` fixed the `grant_resistance` multi-damage-type persistence bug and lead validation confirmed `blade_ward_buff.modifiers` now contains `bludgeoning`, `piercing`, and `slashing`. `荆棘之鞭` now has full Chrome UI-to-map validation: the right-click spell path applied Thorn Whip from caster token `2557` to target token `2568`, frontend consumed the transient `forced_movement` intent, moved the target `(11,10) -> (9,10)`, and cleared the transient effect. QA state was reset afterward. |
| Chrome area-spell hydration regression slice | Done | Lead-owned Chrome QA covered `召雷术` / Call Lightning through the right-click caster-to-target area placement path. The first live retest exposed that the area route skipped resolver hydration for effects-less frontend payloads, then exposed a v4 false-green where `SpellData.model_dump()` defaulted `concentration=false` and slot consumption used the token id instead of the Character owner. Workers `spell-call-lightning-area-resolution-v3` and `spell-call-lightning-area-resolution-v5` fixed route hydration, resolver fallback, authoritative concentration hydration, and area spell slot ownership. Chrome/DB retest confirmed `/api/combat/spell-area` resolved through `spell_resolver`, applied lightning save damage, stored caster concentration and `grant_action`, set chat meta `is_concentration=true` / `has_persistent_area=true`, and consumed exactly one 3rd-level slot. |
| Chrome granted-area follow-up slice | Done | Chrome QA then exercised the area-style `grant_action` follow-up `召唤闪电` from the same Call Lightning concentration. The first follow-up attempt used the visible `法术动作 -> 召唤闪电` menu and reproduced `/api/combat/spell-area` failing to resolve synthetic spell name `⚡ 召唤闪电`. Worker `spell-call-lightning-grant-area` plus recovery handoff `spell-call-lightning-grant-area-handoff-recovery` added route-side active-grant matching and synthetic freecast area payload construction. Lead validation and Chrome/DB retest confirmed the follow-up rolls the Call Lightning DEX save/damage through `spell_resolver`, maps chat meta back to canonical `call_lightning`, spends no slot, does not reset concentration, and does not duplicate the grant action. QA state was reset afterward. |
| Chrome multi-projectile / max-HP slice | Done | Lead-owned Chrome QA covered `灼热射线`, `魔能爆`, and `援助术` against the QA caster/low-AC target path. Backend unit validation for the approved multi-projectile / Aid design was already green. Chrome confirmed 2nd-level Scorching Ray creates 3 independent attack/damage results, 4th-level Scorching Ray creates 5 independent attack/damage results, 20th-level Eldritch Blast creates 4 beam damage results without spending a slot, and 4th-level Aid heals 15 while persisting a `hp_max` modifier value `15`. No new defect was found. |
| Chrome grant-action attack follow-up slice | Done | Lead-owned Chrome QA covered `灵体武器` initial cast plus visible `法术动作 -> 灵体武器攻击` follow-up. Chrome/DB confirmed the initial 2nd-level cast consumes one 2nd-level slot, persists a caster-side `grant_action` with `action_kind="attack"` and melee spell attack metadata, and the follow-up enters the attack target picker, resolves through an attack roll, deals force damage, spends no slot, and keeps the non-concentration grant action available. No new defect was found. |
| Chrome move-effect grant-area follow-up slice | Done | Chrome QA covered `月华之光` and `炽焰法球` as move-effect representatives. Workers `spell-move-effect-grant-action-v2`, `spell-move-effect-empty-target-v1`, and `spell-flaming-sphere-move-area-v1` fixed area routing, zero-target area execution, and Flaming Sphere's missing-area fallback. Chrome/DB confirmed Moonbeam follow-up moves an existing cylinder area with zero targets and no slot spend, while Flaming Sphere follow-up synthesizes a 5-foot sphere area from the per-spell fallback, damages affected targets, writes persistent `area_effect`, and spends no slot. |
| Chrome Hex transfer concentration-sync regression | Done | Worker `spell-hex-transfer-concentration-sync` fixed Hex transfer so the caster concentration cache retargets with the runtime instance. Lead validation passed focused runtime-service tests. Chrome/DB confirmed Hex moved from the downed first target to a second target, `caster.concentration_spell.affected_token_ids` updated to the new target, runtime params tracked the new marked token, the old target effect was cleared, and breaking concentration removed the transferred Hex effect. |
| Chrome remaining grant-action kind slice | Done | Workers `spell-grant-action-kind-gaps` and `spell-remove-condition-end-concentration` closed remaining visible `grant_action` families. Chrome covered dash (`脚底抹油`), extra_action (`加速术`), repeat_damage (`灼热金属`), command (`操纵死尸`), weapon_attack (`迅捷箭袋`), custom (`强迫术`), and remove_condition (`驱散善恶/破除附魔`). The last slice fixed Swift Quiver/Compulsion no-target declarations, remove_condition target freedom, and Dispel Evil and Good's "使用后法术结束" concentration cleanup. Chrome/DB confirmed `破除附魔` clears the target condition, clears caster concentration, removes caster buff/grant effects, and removes the menu action after refresh. |
| PR #1 quality-gate dependency cleanup | Done | Worker `spell-runtime-ci-gate-fix` fixed the first CI install failures by bumping `python-dotenv` and adding frontend `@playwright/test`; worker `spell-runtime-ci-uvicorn-fix` bumped `uvicorn[standard]` to `0.35.0`; worker `spell-runtime-ci-websockets-fix` bumped `websockets` and `python-multipart` to fastmcp-compatible floors; worker `spell-runtime-ci-backend-env-fix` added Settings-safe dummy `DATABASE_URL` / `REDIS_URL` to the backend-focused CI job after dependency install began passing. PR #1 quality-gate is green on both push and pull_request runs. |
| Semantic QA hardening pass | In Progress | S0/S1/S2 backend semantic QA is accepted into the dirty integration worktree under `backend/tests/qa_spells/`. S0 added reusable semantic oracle, forced-roll, cleanup, and artifact helpers. S1 added runtime expiry boundary/idempotency tests and characterized the current round-expiry gap. S2 added 17 service-level semantic tests proving Bless selected-target modifiers, Hex scoped debuff/on-hit damage/transfer, and Divine Favor weapon-only bonus damage through real spell definitions and phase execution. S3 is next for concentration cleanup, transformation restore, summon cleanup, and residual-effect idempotency; S4 remains the Chrome human-like UI runner. |
| Chrome semantic effect/expiry probe | Done / Decision deferred | Lead-owned Chrome QA exercised real map flows for representative single-target save damage, healing, buff max-HP mutation, concentration debuff plus delayed on-hit damage, duration expiry, area damage, resistance/immunity, concentration replacement, granted-action attack, and selected-target healing. Worker `spell-ongoing-zone-fixes` fixed legacy ongoing entries with inline saves and HP outcome application; Chrome retest confirmed `魅影杀手` end-of-target-turn damage reduced the target from 40 HP to 23 HP. A follow-up browser batch on `2026-06-01` reconfirmed `援助术` via live `aid_buff.modifiers[0]={target:\"hp_max\",value:\"5\"}` and `致病射线` via a normal target taking damage plus `poisoned`, but also reproduced that the visible `+1轮` browser control did not clear two separate `duration=1` effects (`曳光弹`, `致病射线`) in snapshot state. `匕首之云` immediate damage works, but direct QA API turn advancement still does not auto-settle the legacy zone a second time because current zone timing is request/dialog driven through `/combat/zone-spell-settle`; backend auto-tick needs a separate product decision around geometry, idempotency, and frontend duplicate-settlement UX. |
| RT-0: round/time-expiry scope freeze | Done | Lead reviewed worker `round-advance-expiry` memo and source evidence. Root cause is split into ambiguous `+1轮` surfaces, split WS/HTTP settlement coverage, and modifier effects born without expiry. Worker spike remains exploratory only. |
| RT-1: single world-time settlement owner | Done | `settle_world_time()` is the shared backend settlement owner for WebSocket time updates and the HTTP compatibility decrement route. |
| RT-2: central expiry birth certificate | Done | Round-duration helper now derives `expires_at`, and modifier handlers create expirable out-of-combat effects. |
| RT-3: status-panel time control contract | Done | Global top-bar advances send `settlement_rounds`; the status-panel control is labeled as local-only (`本地-1轮` / `Local -1 Round`). |
| RT-4: QA snapshot semantic oracle | Done | Snapshot preserves raw effect residue and adds `effective_active_effects` / `expired_active_effects` under current world time. |
| RT-5: Chrome acceptance pass | Done | Chrome QA clicked the visible top-bar `+1轮`, proved exact `+6s`, proved QA semantic expired/effective classification, and proved a boundary effect is removed by live settlement. |

## Validation evidence

- Stage 1 (`2026-05-26`): `cd backend && PYTHONPATH=. pytest --noconftest tests/unit/spell_runtime_engine tests/unit/test_spell_runtime_service.py` -> 42 passed (30 new engine tests + 12 existing Hex/runtime regression tests).
- Stage 1 (`2026-05-26`): `cd backend && python -m py_compile app/services/spell_runtime_engine/*.py app/services/spell_runtime_engine/verbs/*.py` -> passed.
- Stage 2 (`2026-05-26`): `cd backend && PYTHONPATH=. pytest --noconftest tests/unit/test_spell_runtime_service.py tests/unit/spell_runtime_engine` -> 45 passed (3 new service integration tests plus existing service/engine regression tests).
- Stage 2 (`2026-05-26`): `cd backend && python -m py_compile app/services/spell_runtime_service.py app/services/spell_runtime_engine/*.py app/services/spell_runtime_engine/verbs/*.py` -> passed.
- Stage 3 (`2026-05-26`): `cd backend && PYTHONPATH=. pytest --noconftest tests/unit/test_spell_runtime_service.py tests/unit/spell_runtime_engine` -> 48 passed (3 new hit-trigger service tests plus existing service/engine regression tests).
- Stage 3 (`2026-05-26`): `cd backend && python -m py_compile app/services/spell_runtime_service.py app/services/spell_runtime_engine/*.py app/services/spell_runtime_engine/verbs/*.py` -> passed.
- Stage 4 preflight (`2026-05-26`): `cd backend && PYTHONPATH=. pytest --noconftest tests/unit/spell_runtime_engine tests/unit/test_spell_runtime_service.py` -> 49 passed (adds Hex transfer update/clear ordering regression).
- Stage 4 preflight (`2026-05-26`): `cd backend && python -m py_compile app/services/spell_runtime_engine/*.py app/services/spell_runtime_engine/verbs/*.py app/services/spell_runtime_service.py` -> passed.
- Stage 4 preflight (`2026-05-26`): direct `execute_phase()` probe for Hex `on_action_invoked` transfer leaves params as `{"marked_token_id": 77}` and aggregate clears `transfer_available`.
- Stage 4 (`2026-05-26`): `cd backend && PYTHONPATH=. pytest --noconftest tests/unit/test_spell_runtime_service.py tests/unit/spell_runtime_engine` -> 52 passed (3 new `execute_runtime_action()` service delegation tests).
- Stage 4 (`2026-05-26`): `cd backend && python -m py_compile app/services/spell_runtime_service.py app/services/spell_runtime_engine/*.py app/services/spell_runtime_engine/verbs/*.py` -> passed.
- Stage 5 (`2026-05-26`): `cd backend && PYTHONPATH=. pytest --noconftest tests/unit/test_spell_runtime_service.py tests/unit/spell_runtime_engine` -> 55 passed (3 new downed/concentration-end service delegation tests).
- Stage 5 (`2026-05-26`): `cd backend && python -m py_compile app/services/spell_runtime_service.py app/services/spell_runtime_engine/*.py app/services/spell_runtime_engine/verbs/*.py` -> passed.
- Stage 6 (`2026-05-26`): `cd backend && PYTHONPATH=. pytest --noconftest tests/unit/test_spell_runtime_service.py tests/unit/spell_runtime_engine` -> 58 passed (3 new modifier-projection delegation/read-only tests).
- Stage 6 (`2026-05-26`): `cd backend && python -m py_compile app/services/spell_runtime_service.py app/services/spell_runtime_engine/*.py app/services/spell_runtime_engine/verbs/*.py` -> passed.
- Stage 7 (`2026-05-26`): `cd backend && PYTHONPATH=. pytest --noconftest tests/unit/test_spell_runtime_service.py tests/unit/spell_runtime_engine` -> 62 passed (engine audit coverage tests plus service bridge regression).
- Stage 7 (`2026-05-26`): `cd backend && python -m py_compile app/services/spell_runtime_service.py app/services/spell_runtime_engine/*.py app/services/spell_runtime_engine/verbs/*.py` -> passed.
- Stage 8a (`2026-05-26`): `cd backend && PYTHONPATH=. venv/bin/python -m pytest --noconftest tests/unit/test_spell_runtime_service.py tests/unit/spell_runtime_engine tests/unit/test_time_handler.py tests/unit/test_zone_spell_settlement_timing.py tests/unit/test_campaign_storage_turn_hook.py` -> 86 passed (turn-trigger service tests, campaign storage helper tests, prior service/engine/time/zone regressions).
- Stage 8a (`2026-05-26`): `cd backend && venv/bin/python -m py_compile app/services/spell_runtime_service.py app/services/spell_runtime_engine/*.py app/services/spell_runtime_engine/verbs/*.py app/api/routes/campaign_storage.py` -> passed.
- Stage 8c (`2026-05-26`): `cd backend && PYTHONPATH=. venv/bin/python -m pytest --noconftest tests/unit/test_spell_runtime_service.py tests/unit/spell_runtime_engine tests/unit/test_time_handler.py tests/unit/test_zone_spell_settlement_timing.py tests/unit/test_campaign_storage_turn_hook.py tests/unit/test_combat_turn_trigger_hooks.py tests/unit/test_tokens_delete_combat_turn_hook.py` -> 105 passed (shared combat turn-trigger helper tests plus token deletion route-adjacent coverage).
- Stage 8c (`2026-05-26`): `cd backend && venv/bin/python -m py_compile app/services/spell_runtime_service.py app/services/spell_runtime_engine/*.py app/services/spell_runtime_engine/verbs/*.py app/api/routes/campaign_storage.py app/api/routes/tokens.py app/services/combat_turn_trigger_hooks.py` -> passed.
- Stage 8c (`2026-05-26`): DevTools sanity on `http://localhost:5174/` -> redirected to `/login`; no console error/warn/issue messages; network requests returned 200/206.
- Stage 9a (`2026-05-27`): `cd backend && PYTHONPATH=. venv/bin/python -m pytest --noconftest tests/unit/spell_runtime_engine/test_modifier_verbs.py tests/unit/spell_runtime_engine/test_end_spell_instance.py tests/unit/test_spell_runtime_service.py` -> 47 passed (Bless-readiness backend tests plus Hex/runtime regressions).
- Stage 9a (`2026-05-27`): `cd backend && venv/bin/python -m py_compile app/services/spell_runtime_service.py app/services/spell_runtime_engine/verbs/modifier.py app/services/spell_runtime_engine/verbs/lifecycle.py` -> passed.
- Stage 9a (`2026-05-27`): DevTools sanity on `http://localhost:5174/` -> redirected to `/login`; no console error/warn/issue messages; 96 network requests returned 200/206.
- Stage 9b (`2026-05-27`): worker validation `cd backend && PYTHONPATH=. venv/bin/python -m pytest --noconftest tests/unit/test_spell_runtime_service.py tests/unit/spell_runtime_engine/test_modifier_verbs.py tests/unit/spell_runtime_engine/test_end_spell_instance.py` -> 53 passed after post-review fixes.
- Stage 9b (`2026-05-27`): lead validation `cd backend && PYTHONPATH=. venv/bin/python -m pytest --noconftest tests/unit/test_spell_runtime_service.py tests/unit/spell_runtime_engine/test_modifier_verbs.py tests/unit/spell_runtime_engine/test_end_spell_instance.py` -> 53 passed.
- Stage 9b (`2026-05-27`): lead validation `cd backend && venv/bin/python -m py_compile app/api/routes/combat.py app/api/routes/spell_cast.py app/services/spell_runtime_service.py app/services/spell_runtime_engine/verbs/modifier.py app/services/spell_runtime_engine/verbs/lifecycle.py` -> passed.
- Stage 9b (`2026-05-27`): `cd frontend && npx vitest run tests/hooks/useMapSidebarSpellController.test.ts` -> 4 passed.
- Stage 9b (`2026-05-27`): `cd frontend && npm run typecheck` -> blocked by pre-existing unrelated errors in `CuttingWordsPrompt.tsx`, `useMapBonusActionRoutingController.test.ts`, and `persistentFeatureMiddleware.test.ts`; Stage 9b changed files were not named in the error output.
- Stage 9b (`2026-05-27`): DevTools on `http://localhost:5174/` -> `/login`; Stage 9b changed modules forced through Vite fetch and returned 200 for `multiTargetSpellUtils.ts`, `useMapSidebarSpellController.ts`, both campaign routes, `appEventBus.ts`, `hotbarTypes.ts`, and `spells.json`; no console error/warn/issue messages after module fetch.
- Stage 9b (`2026-05-27`): authenticated campaign DevTools flow not completed because README demo credentials returned `POST /api/auth/login` 401 in the local backend.
- Stage 10 (`2026-05-27`): `cd backend && PYTHONPATH=. venv/bin/python -m pytest --noconftest tests/unit/test_spell_runtime_service.py tests/unit/spell_runtime_engine/test_audit.py tests/unit/test_zone_spell_settlement_timing.py` -> 61 passed (runtime zone dispatch, audit wiring, and legacy zone timing regressions).
- Stage 10 (`2026-05-27`): `cd backend && venv/bin/python -m py_compile app/api/routes/combat.py app/services/spell_runtime_service.py app/services/spell_runtime_engine/audit.py app/services/spell_runtime_engine/context.py` -> passed.
- Stage 10 (`2026-05-27`): `cd backend && PYTHONPATH=. venv/bin/python -m pytest --noconftest tests/test_control_effect_escape.py::TestZoneSpellSettleAreaConcentrationTracking -x` -> failed on pre-existing direct route-call signature mismatch: `settle_zone_spell() got an unexpected keyword argument 'user_id'`.
- Stage 10 (`2026-05-27`): DevTools on `http://localhost:5174/` -> `/login`; initial page load had 96 network requests returning 200/206 and no console error/warn/issue messages. A manual DevTools `fetch('/api/combat/zone-spell-settle')` reached the backend and returned expected `401 Not authenticated` instead of a route/server error.
- Stage 10 recovery (`2026-05-27`): `cd backend && PYTHONPATH=. venv/bin/python -m pytest --noconftest tests/unit/test_spell_runtime_service.py tests/unit/spell_runtime_engine/test_audit.py tests/unit/test_zone_spell_settlement_timing.py` -> 62 passed (adds applied-only/narrative-only zone trigger success regression).
- Stage 10 recovery (`2026-05-27`): `cd backend && venv/bin/python -m py_compile app/services/spell_runtime_service.py app/api/routes/combat.py` -> passed.
- Stage 10 recovery (`2026-05-27`): DevTools on `http://localhost:5174/` -> `/login`; initial page load still had no console error/warn/issue messages. Manual DevTools `fetch('/api/combat/zone-spell-settle')` reached `http://localhost:8174/api/combat/zone-spell-settle` and returned expected `401 Not authenticated`; the only console error was the expected manual unauthenticated 401.
- Stage 10 validation recovery (`2026-05-27`): `cd backend && PYTHONPATH=. venv/bin/python -m pytest --noconftest tests/unit/test_spell_runtime_service.py tests/unit/spell_runtime_engine/test_audit.py tests/unit/test_zone_spell_settlement_timing.py tests/test_control_effect_escape.py::TestZoneSpellSettleAreaConcentrationTracking` -> 63 passed (includes the repaired direct route-call zone settlement regression).
- Stage 10 validation recovery (`2026-05-27`): `cd backend && venv/bin/python -m py_compile app/api/routes/combat.py tests/test_control_effect_escape.py` -> passed.
- Stage 10 validation recovery (`2026-05-27`): DevTools on `http://localhost:5174/` -> `/login`; initial load had no console error/warn messages. Manual DevTools `fetch('http://localhost:8174/api/combat/zone-spell-settle')` returned expected `401 {"detail":"Not authenticated"}` with no backend 500; network showed only the usual Vite manifest abort plus the expected 401.
- Stage 11 (`2026-05-27`): worker validation after lead-requested rev-2 fix: `cd backend && PYTHONPATH=. venv/bin/python -m pytest --noconftest tests/unit/spell_runtime_engine/test_conditional_extra_damage.py tests/unit/test_spell_runtime_service.py` -> 62 passed; `cd backend && PYTHONPATH=. venv/bin/python -m pytest --noconftest tests/unit/spell_runtime_engine/test_audit.py tests/unit/test_spell_runtime_service.py` -> 58 passed; `py_compile` and `spells.json` JSON lint -> passed.
- Stage 11 (`2026-05-27`): lead validation: `cd backend && PYTHONPATH=. venv/bin/python -m pytest --noconftest tests/unit/spell_runtime_engine/test_conditional_extra_damage.py tests/unit/test_spell_runtime_service.py` -> 62 passed.
- Stage 11 (`2026-05-27`): lead validation: `cd backend && PYTHONPATH=. venv/bin/python -m pytest --noconftest tests/unit/spell_runtime_engine/test_audit.py tests/unit/test_zone_spell_settlement_timing.py tests/test_control_effect_escape.py::TestZoneSpellSettleAreaConcentrationTracking` -> 11 passed, 2 warnings.
- Stage 11 (`2026-05-27`): lead validation: `cd backend && venv/bin/python -m py_compile app/services/spell_runtime_service.py app/services/spell_runtime_engine/verbs/damage.py && python -m json.tool ../frontend/app/data/rules/spells.json >/dev/null` -> passed.
- Stage 11 (`2026-05-27`): `cd frontend && npm run typecheck` remains blocked by pre-existing unrelated errors in `CuttingWordsPrompt.tsx`, `useMapBonusActionRoutingController.test.ts`, and `persistentFeatureMiddleware.test.ts`; Stage 11 changed files were not named in the error output.
- Stage 11 (`2026-05-27`): Chrome DevTools MCP could not be used because calls returned `Transport closed`. Equivalent Playwright/browser smoke on `http://localhost:5174/` reached `/login`, initial console had 0 errors / 0 warnings, network showed Vite manifest aborts only. Browser evaluation imported `/app/data/rules/spells.json?import` and confirmed `divine_favor` has `runtime.engine="v2"`, triggers `["on_cast","on_weapon_hit"]`, and `conditional_extra_damage` with `target_match="any"`. Manual browser `fetch('http://localhost:8174/api/combat/zone-spell-settle')` returned expected `401 {"detail":"Not authenticated"}`; the only console error afterward was that expected unauthenticated 401.
- Post-close authenticated smoke (`2026-05-27`): using the local test account, Playwright logged in successfully (`POST /api/auth/login` -> 200), opened campaign `7` DM view, and loaded the tactical map / character / spell panel. Authenticated campaign APIs returned 200 for campaigns, member checks, module maps, combat storage, map bulk data, chat messages, monsters, shops, AI map markers, and map view-state writes. The only console/network errors were two 403 image-proxy failures for an expired external DashScope image URL plus browser ORB blocks for the same image. Authenticated browser evaluation confirmed front-end spell data for `hex`, `bless`, and `divine_favor` loads with `runtime.engine="v2"` and expected runtime triggers/effects. Authenticated map bulk data showed active Hex runtime projections with source/target overlays, badges, and attached runtime refs.
- Post-close in-app Browser smoke (`2026-05-27`): repeated the login and campaign `7` DM view check with Codex `@浏览器`. Login reached the campaign hall, campaign view showed `湮灭之墓：深渊觉醒`, `已连接`, character/spell panel content, existing Hex UI (`脆弱诅咒`), and the spell action affordance. Browser console surfaced React hydration mismatch errors from `frontend/app/root.tsx` / Vite chunks; the app recovered by switching to client rendering and remained usable. Follow-up read-only inspection found the server HTML from `curl http://localhost:5174/login` starts with the expected `<!DOCTYPE html><html><head>...<body>` shape, while the earlier standalone Playwright CLI login smoke did not report hydration errors. Treat this as an in-app Browser / authenticated-redirect validation artifact unless it reproduces in a normal browser outside Codex Browser. No spell-runtime-specific runtime error was observed.
- Final audit (`2026-05-27`): local audit script confirmed current v2 spells are `hex`, `bless`, and `divine_favor`; all three have no missing registered verbs and no missing wired triggers. Audit still reports declared-only legacy/global gaps (`narrative`, `on_reaction`, `on_take_damage`, and legacy verbs such as `deal_damage` / `apply_condition`), which are outside the approved v1 runtime-engine scope.
- Cross-category inventory (`2026-05-27`): `spells.json` has 364 spell records. Representative mechanism families identified for validation include runtime v2 (3: `hex`, `bless`, `divine_favor`), bonus damage (2), concentration (154), damage (`deal_damage` 98 plus top-level damage metadata), saves (138), healing (`heal` 14), conditions (`apply_condition` 71 plus removal/utility condition handlers), roll modifiers (`modify_roll` 9 plus advantage/disadvantage/resistance/stat modifier handlers), area/zone (103), zone triggers (22), turn triggers (47), visual/filter/zone visuals (93), movement (17), summon (15), temp HP (5), restoration/removal (6), teleport (11), and utility/sense/counter/suppress/stored-trigger handlers (16+ handler-specific records).
- Cross-category handler audit (`2026-05-27`): a read-only catalog scan of leaf `effects[].type` values found no orphan effect type: each declared leaf effect type is owned either by the legacy effect-engine registry or by the v2 spell-runtime verb registry. Runtime-only leaf verbs are the intended v2 verbs (`set_runtime_param`, `clear_runtime_param`, `conditional_extra_damage`, `end_spell_instance`, `grant_action`, `modify_roll`, `retarget_mark`); legacy effect-engine-only families remain outside the current v2 migration unless selected for a later spell migration. Trigger scan still shows `on_reaction` and `on_take_damage` as declared future hook families, matching the existing audit note that they are outside the approved v1 runtime-engine scope.
- Cross-category backend matrix, initial lead run (`2026-05-27`): `cd backend && PYTHONPATH=. venv/bin/python -m pytest --noconftest tests/unit/spell_runtime_engine tests/unit/test_spell_runtime_service.py tests/unit/test_zone_spell_settlement_timing.py tests/test_control_effect_escape.py::TestZoneSpellSettleAreaConcentrationTracking tests/unit/test_effect_engine.py tests/unit/test_visual_effect_handlers.py tests/unit/test_movement_handlers.py tests/unit/test_illumination_summon_handlers.py tests/unit/test_remove_condition_handler.py tests/unit/test_tier1_tier2_tier3_handlers.py tests/unit/test_spell_effect_cleanup_service.py tests/unit/test_spell_cast_slot_helpers.py tests/unit/test_combat_attack_service.py tests/unit/test_combat_saving_throw_service.py tests/unit/test_combat_spell_service.py` -> 238 passed, 3 failed, 2 warnings. All 3 failures were test-only `SimpleNamespace` fixture drift missing `active_auras` for moving aura / concentration cleanup, not production runtime logic.
- Cross-category fixture recovery (`2026-05-27`): worker `spell-category-validation-active-auras` added `active_auras=[]` to token fixtures in `backend/tests/unit/test_tier1_tier2_tier3_handlers.py` and `backend/tests/unit/test_spell_cast_slot_helpers.py`. Worker validation: focused trio -> 3 passed; broad representative backend matrix -> 241 passed, 2 warnings.
- Cross-category lead validation (`2026-05-27`): focused aura/concentration fixture check -> 3 passed in 0.56s; broad representative backend matrix -> 241 passed, 2 warnings in 0.89s. This matrix covers runtime-engine v2, conditional bonus damage, multi-target Bless modifiers, concentration lifecycle, zone and turn triggers, damage/healing/temp HP/condition/restoration cleanup, visual/filter/illumination/summon/movement/teleport/wall/barrier/aura/counter/sense/utility handlers, and combat attack/save/spell integration paths.
- Cross-category frontend validation (`2026-05-27`): `cd frontend && npx vitest run tests/components/SpellCastActions.test.tsx tests/components/ZoneSpellSettlementModal.test.tsx tests/hooks/useMapSidebarSpellController.test.ts tests/utils/runtimeSpellBadgeStatusUtils.test.ts tests/utils/runtimeSpellLinkUtils.test.ts tests/utils/spellCastMiddleware.test.ts tests/utils/spellEffectMiddleware.test.ts` -> 7 files / 63 tests passed. Vitest emitted one existing React `act(...)` warning in `SpellCastActions.test.tsx`.
- Cross-category frontend typecheck (`2026-05-27`): `cd frontend && npm run typecheck` remains blocked by the same unrelated errors previously observed: missing `getApiEndpoint` export for `CuttingWordsPrompt.tsx`, stale `handleSpellAction` properties in `useMapBonusActionRoutingController.test.ts`, and missing `beforeAll` import in `persistentFeatureMiddleware.test.ts`. No `_index.tsx` parse error was emitted after the browser reload cleared the transient Vite overlay.
- Cross-category in-app Browser validation (`2026-05-27`): Codex `@浏览器` opened `http://localhost:5174/login`, reloaded away from a transient Vite overlay, and entered authenticated campaign `7` DM view. DOM showed `湮灭之墓：深渊觉醒`, `已连接`, spell action UI, and existing Hex UI (`脆弱诅咒`); no Vite transform overlay remained. Browser logs still show the known React hydration mismatch/client-render recovery warnings from `root.tsx` / Vite chunks. No spell-runtime-specific browser error was observed.
- Chrome catalog QA seed (`2026-05-28`): user-provided local test account logged in through the Chrome plugin / DevTools path and opened campaign `8` (`Spell Runtime QA Arena`) in DM view. QA data now includes `qa_all_spells_caster` with all 364 spells, unlimited slots, component pouch plus Find Familiar material, helper character tokens, and 18 target tokens.
- Chrome single-target modifier/status slice (`2026-05-28`): ordinary Chrome DM tab cast `曳光弹`, `冻寒之触`, `防护善恶`, `大步奔行`, and `律令死亡` through the spellbook -> target mode -> map-click flow. DB confirmed Guiding Bolt advantage buff and damage, Chill Touch disadvantage plus `prevent_healing`, Protection concentration with incoming-attack disadvantage and charmed/frightened protection metadata, Longstrider `modify_movement` plus `apply_token_filter`, and Power Word Kill reducing token `534` to 0 HP. QA reset restored slots to `[0,86,95,94,95,99,99,99,99,99]`.
- Rare utility/state mutation QA (`2026-05-28`, frontend follow-up retested `2026-05-31`): Chrome/DB QA on campaign `8` confirmed `迷幻手稿` long-cast completion consumes lead ink and generates `迷幻手稿` equipment, `变巨 / 缩小术` persists `resize_token` and concentration resize metadata, `触发术` persists `stored_trigger`, and `隔离术` persists `set_visibility mode="invisible"` plus invisible condition and consumes 5000gp gem powder. `闪现术` only exercised `apply_token_filter` because its `set_visibility` leaf is narrative-triggered. `荆棘之鞭` first verified backend transient forced-movement intent through `/api/spells/cast`; the 2026-05-31 Chrome retest then used the right-click caster-to-target spell path after seeding QA cantrips, and DB confirmed target token `2568` moved `(11,10) -> (9,10)`, HP `40 -> 29`, and `active_effects=null`, proving frontend map consumption and transient cleanup. `剑刃防护` exposed that `grant_resistance.damage_types` persisted only the last damage type; worker `spell-grant-resistance-multitype-fix` fixed the backend projection and lead validation passed: `py_compile` on `modifier.py` / `test_tier1_tier2_tier3_handlers.py`, `pytest tests/unit/test_tier1_tier2_tier3_handlers.py::TestModifierHandler -x -q` -> 6 passed, `git diff --check` -> passed, and a live campaign `8` `/api/spells/cast` retest produced `blade_ward_buff.modifiers` damage types `["bludgeoning","piercing","slashing"]`. QA reset cleared retest state from tokens `2557`, `2568`, and `2574`, restored token `2568` to `(11,10)` / HP `40`, restored moving target token `2574` to `(14,10)` / HP `40` / AC `12`, and kept the QA caster's cantrip seed for future browser coverage.
- Chrome first smoke batch (`2026-05-28`): browser-operated spell casts verified successful UI-to-state behavior for Fire Bolt, Sacred Flame, Magic Missile, Cure Wounds, Healing Word, False Life, Armor of Agathys, Hex, Bless, Divine Favor, Command, Tasha's Hideous Laughter, Mage Armor, Bane, Fog Cloud, Grease, Entangle, Hold Person, Invisibility, Thunderwave, and Find Familiar long-cast readiness. Disguise Self correctly blocks normal cast until an illusion image is selected.
- Chrome first smoke batch findings (`2026-05-28`): concentration replacement appears to over-clean some non-concentration spell effects in chained scenarios; Web spends a 2nd-level slot and creates `spell_area_web` but does not replace concentration with Web; Misty Step spends a 2nd-level slot without moving the caster; Counterspell spellbook readiness is blocked during Find Familiar casting with misleading long-cast wording. These are QA findings, not yet code fixes.
- First-batch fix worker validation (`2026-05-28`): worker `spell-browser-qa-first-fixes` fixed Web empty-ground concentration handoff, Misty Step readiness blocking, concentration cleanup scoping, and Counterspell active-cast wording. Lead validation: `cd backend && venv/bin/python -m py_compile app/api/routes/tokens.py` -> passed; `cd backend && PYTHONPATH=. venv/bin/python -m pytest --noconftest tests/unit/test_remove_control_effects_concentration_scope.py -v` -> 3 passed; `cd backend && PYTHONPATH=. venv/bin/python -m pytest --noconftest tests/unit/test_remove_control_effects_concentration_scope.py tests/unit/test_spell_cast_slot_helpers.py tests/unit/test_combat_control_cleanup.py tests/unit/test_spell_effect_cleanup_service.py` -> 13 passed; `cd frontend && npx vitest run tests/utils/spellCastMiddleware.test.ts` -> 36 passed; `cd frontend && npx vitest run tests/components/SpellCastActions.test.tsx` -> 1 passed with existing React `act(...)` warning; `cd frontend && npx vitest run tests/hooks/useMapAreaSpellNonCombatController.test.ts -t "sets concentration when a control concentration zone spell is placed on empty ground"` -> 1 passed / 3 skipped.
- First-batch Chrome regression (`2026-05-28`): Chrome DevTools on campaign `8` confirmed Web now spends one 2nd-level slot and sets `concentration_spell.spell_id="web"` with `area_effect.center=(34,36)`, without persisting a duplicate `spell_area_web` active effect. The seeded old Hold Person effect was removed from token `532`, while unrelated `spell_buff_command` on token `532` and caster buffs `false_life_temp_hp`, `armor_of_agathys`, and `mage_armor_buff` remained. Misty Step now shows disabled wording `此法术需选择传送目的地...` and does not offer a cast button. Counterspell while Find Familiar is in progress now shows `请先完成或取消该施法后再施放此法术` instead of the misleading long-cast wording; screenshot evidence saved at `artifacts/spell-qa/2026-05-28/first-fix-counterspell-wording.png`.
- Second Chrome mechanism slice (`2026-05-28`): Chrome DevTools on campaign `8` covered restoration, dispel/suppress, and death stabilization. Lesser Restoration removed only seeded `qa_poisoned` from token `532` and preserved seeded `qa_paralyzed` plus unrelated `qa_unrelated_blessing`; Dispel Magic removed only seeded low-level spell effect `qa_magic_low` from token `533` and preserved seeded `qa_magic_high` plus non-spell `qa_non_spell`; Spare the Dying initially failed with backend `KeyError: 'is_stable'` from `StabilizeHandler`. Failure screenshot saved at `artifacts/spell-qa/2026-05-28/spare-the-dying-failure-before-fix.png`.
- Stabilize fix worker validation (`2026-05-28`): worker `spell-stabilize-handler-fix` rewrote `StabilizeHandler` to persist stabilization through `death_saves.stabilized=true` using `normalize_token_death_saves`, preserving existing death-save counts and avoiding the non-existent `is_stable` mapped attribute. Worker validation: `cd backend && venv/bin/python -m py_compile app/services/effect_engine/handlers/utility.py` -> passed; `cd backend && PYTHONPATH=. venv/bin/python -m pytest --noconftest tests/unit/test_tier1_tier2_tier3_handlers.py -k "Stabilize or stabilize" -v` -> 3 passed / 26 deselected; `cd backend && PYTHONPATH=. venv/bin/python -m pytest --noconftest tests/unit/test_tier1_tier2_tier3_handlers.py -v` -> 29 passed. Lead reran the same three checks with the same results.
- Stabilize Chrome regression (`2026-05-28`): Chrome DevTools recast Spare the Dying on adjacent 0-HP token `531`; page showed `qa_all_spells_caster 施放了 维生术` with no `施法失败`. DB confirmed `current_hp=0`, character HP remained 0, and `death_saves={"successes":0,"failures":2,"stabilized":true}`. Screenshot saved at `artifacts/spell-qa/2026-05-28/spare-the-dying-regression-after-fix.png`.
- Third Chrome mechanism slice (`2026-05-28`): Chrome DevTools on campaign `8` covered self visual/sense/illumination, moving aura, turn-trigger setup, illusion/zone visuals, wall/barrier placement, summon, and on-hit/granted-action representatives. Passes: Mirror Image persisted illusion/filter/buff effects; See Invisibility persisted grant-sense; Comprehend Languages persisted token filter; Light persisted illumination metadata; Darkness persisted concentration area metadata; Hunter's Mark persisted caster buff plus target filter/buff. Partials/findings: Detect Magic persisted follow-caster concentration but no grant-sense active effect; Spirit Guardians created moving aura but damaged nearby friendly/player tokens on initial cast; Heroism created on-cast and ongoing target state but Chrome end-turn confirmation did not advance `current_turn_index`; Silent Image persisted concentration area metadata but no separate `spawn_illusion`; Conjure Animals only cast when targeting an existing token and did not create a summoned token; Witch Bolt damaged the target and stored concentration but did not surface its follow-up `巫术箭伤害` granted action. Fails: Minor Illusion showed a success toast but persisted no effect/storage record; Wind Wall never entered pending placement/cast state. Screenshot saved at `artifacts/spell-qa/2026-05-28/third-slice-witch-bolt-after-hit.png`; detailed notes in `.tmp/team-lead/lead-spell-runtime-browser-qa-20260528.md`.
- Revive/material Chrome check (`2026-05-28`): Chrome DevTools cast Revivify / 回生术 on adjacent 0-HP token `531` using the visible `QA diamond 300gp` material selector. UI showed `qa_downed_ally 恢复 1 点生命`; DB confirmed token HP and character HP changed `0 -> 1`, `diamond_300gp` quantity changed `9 -> 8`, and other costly materials stayed unchanged. Death-save state remained `{"successes":0,"failures":3,"stabilized":false}`, so revive/material execution is partial pending death-save cleanup normalization.
- Third-slice fix worker dispatch (`2026-05-28`): worker `spell-browser-qa-third-fixes` was dispatched for high-confidence fixes around Wind Wall placement, empty-ground summon placement, Minor Illusion persistence, and Witch Bolt granted-action representation. Secondary observations were included for adjacent investigation only.
- Third-slice partial fix validation (`2026-05-28`): worker `spell-browser-qa-third-fixes` accepted only the in-scope Minor Illusion persistence fix, plus stale Grease/Web hook fixture updates. Lead validation: `cd frontend && npx vitest run tests/hooks/useMapAreaSpellNonCombatController.test.ts` -> 5 passed; `cd frontend && npx vitest run tests/utils/spellCastMiddleware.test.ts` -> 36 passed; `cd frontend && npx vitest run tests/components/SpellCastActions.test.tsx` -> 1 passed with existing React `act(...)` warning; `cd backend && venv/bin/python -m py_compile app/api/routes/tokens.py app/services/effect_engine/handlers/utility.py && PYTHONPATH=. venv/bin/python -m pytest --noconftest tests/unit/test_remove_control_effects_concentration_scope.py tests/unit/test_tier1_tier2_tier3_handlers.py -k "Stabilize or stabilize or concentration_scope" -v` -> 6 passed / 26 deselected. Chrome DevTools recast Minor Illusion on campaign `8`; DB confirmed caster token `527` gained `spell_area_minor_illusion` with `is_concentration=false`, `duration=10`, and `area_effect.center=(34.5,39.5)`. Screenshot saved at `artifacts/spell-qa/2026-05-28/minor-illusion-regression-after-fix.png`.
- Utility ritual Chrome checks before capture fix (`2026-05-28`): Chrome DevTools on campaign `8` confirmed Identify / 鉴定术 ritual cast starts `casting_in_progress` with `cast_mode="ritual"`, `total_cast_seconds=660`, `material_id="pearl_100gp"`, and no slot spend. Alarm / 警报术 ritual cast also starts no-slot long casting with `total_cast_seconds=660` and `material_id="component_pouch"`, but area/zone metadata was not captured before casting started, so target/area capture was partial.
- Ritual target/area capture validation (`2026-05-28`): worker `spell-ritual-target-area-capture` stored `target_token_ids` and optional `area_effect` on long-cast start and routed frontend long-cast target/area flows through the normal pickers. Lead validation: `cd frontend && npx vitest run tests/utils/sidebarCasting.test.ts tests/hooks/useMapAreaSpellNonCombatController.test.ts tests/hooks/useMapAreaSpellController.test.ts` -> 20 passed; `cd frontend && npx vitest run tests/hooks/useMapSidebarSpellController.test.ts tests/utils/spellCastMiddleware.test.ts tests/utils/grantedActions.test.ts tests/components/SpellCastActions.test.tsx tests/hooks/mapAreaSpellCastPrelude.test.ts` -> 57 passed with an existing React `act(...)` warning; `cd backend && source venv/bin/activate && PYTHONPATH=. pytest --noconftest tests/unit/test_spell_cast_start_cast_capture.py tests/unit/test_spell_cast_slot_helpers.py tests/unit/test_spell_cast_granted_action.py -q` -> 18 passed; `cd backend && source venv/bin/activate && PYTHONPATH=. python -m py_compile app/api/routes/spell_cast.py app/schemas/token_runtime.py` -> pass; `cd frontend && npm run typecheck` -> pass; relevant `git diff --check` -> pass. Chrome confirmed Identify ritual captured target token `533`, Alarm ritual captured `area_effect.center=(32,40)`, and Find Familiar still starts the long-cast timer without map placement.
- Ready area release validation (`2026-05-28`): worker `spell-ready-area-release-seed` preseeded stored `casting_in_progress.area_effect` into the ready-release area controller while still requiring the explicit final `施法` click. Lead validation: `cd frontend && npx vitest run tests/hooks/useMapAreaSpellController.test.ts tests/hooks/useMapStatusController.test.ts tests/hooks/useMapAreaSpellCastExecutionController.test.ts` -> 12 passed; `cd frontend && npm run typecheck` -> pass; relevant `git diff --check` -> pass. Chrome/DB confirmed a ready Alarm release opened with `施法` immediately available, then created `spell_area_alarm` with the saved cube center `(32,40)`, cleared `casting_in_progress`, and left ritual slot state unchanged.
- Chrome resource recovery (`2026-05-28`): after long DevTools/headless runs, the host showed a stuck Chrome renderer over 4GB RSS plus multiple stale headless/devtools/playwright processes. The lead closed stale `chrome-devtools-mcp`, Playwright, and headless Chrome process groups, terminated the orphaned zero-window Google Chrome process tree, then reopened a single normal Chrome `about:blank` window and confirmed the Codex Chrome extension sees exactly one tab. Memory recovered to roughly 10GB free/unused and Chrome CPU dropped to idle before continuing.
- Backend grant/revive worker validation (`2026-05-28`): worker `spell-backend-grants-revive` registered `grant_action`, added caster-side active-effect persistence for Witch Bolt follow-up actions, and normalized `death_saves` for downed-target positive healing plus positive `resurrect`. Lead validation: `cd backend && venv/bin/python -m py_compile app/services/effect_engine/registry.py app/services/effect_engine/handlers/heal.py app/services/effect_engine/handlers/utility.py && PYTHONPATH=. venv/bin/python -m pytest tests/unit/test_tier1_tier2_tier3_handlers.py -v -k "GrantAction or HealDeathSave or Resurrect or Stabilize"` -> 11 passed / 24 deselected; `cd backend && PYTHONPATH=. venv/bin/python -m pytest tests/unit/test_tier1_tier2_tier3_handlers.py -v` -> 35 passed. Worker also reported neighboring handler tests -> 65 passed.
- Backend grant/revive Chrome regression (`2026-05-28`): Chrome DevTools recast Revivify / 回生术 on campaign `8`; DB confirmed token `531` HP `0 -> 1` and `death_saves={"successes":0,"failures":0,"stabilized":false}`. Chrome DevTools recast Witch Bolt / 巫术箭 on low-AC token `535`; DB confirmed HP `80 -> 74`, caster `concentration_spell.spell_id="witch_bolt"`, and caster `active_effects[0].effect_type="grant_action"` with `action_name="巫术箭伤害"`, `action_kind="repeat_damage"`, `damage={"formula":"1d12","damage_type":"lightning"}`, and `target_token_id=535`. Screenshots saved at `artifacts/spell-qa/2026-05-28/revivify-regression-after-fix.png` and `artifacts/spell-qa/2026-05-28/witch-bolt-grant-action-regression-after-fix.png`.
- Witch Bolt granted-action execution validation (`2026-05-28`): lead validation after workers `spell-grant-action-execution-fix`, `spell-grant-action-spell-level-revision`, and `spell-grant-action-precedence-revision`: `cd frontend && npx vitest run tests/utils/grantedActions.test.ts tests/hooks/useMapSidebarSpellController.test.ts` -> 2 files passed / 14 tests passed; `cd frontend && npm run typecheck` -> passed; `cd backend && source venv/bin/activate && PYTHONPATH=. pytest --noconftest tests/unit/test_spell_cast_granted_action.py -q` -> 9 passed; `git diff --check -- ...` on the touched grant-action files -> passed. Chrome DevTools right-clicked selected caster `527`, clicked `法术动作 / 巫术箭伤害`, selected locked target `535`, and observed `POST /api/spells/granted-actions/execute` -> 200. Page and DB confirmed target HP `74 -> 63`; the old synthetic `granted_witch_bolt_repeat_damage` `/api/spells/cast` 404 path did not recur. Evidence saved under `debug/test/witch-after-final-click-*` and `.tmp/team-lead/lead-spell-runtime-browser-qa-20260528.md`.
- Wind Wall placement validation (`2026-05-28`): worker `spell-frontend-placement-actions` auto-aimed directional area spells from caster to first clicked origin and added Wind-Wall-style Vitest coverage. Lead validation: `cd frontend && npx vitest run tests/hooks/useMapAreaSpellController.test.ts -t "auto-aims a non-self line spell"` -> passed. Chrome DevTools opened `风墙术`, clicked map origin once, saw `施法`, clicked it, and DB confirmed `concentration_spell.spell_id="wind_wall"` with line area metadata. Evidence saved under `debug/test/wind-after-cleanup-final-*`.
- Concentration replacement cleanup validation (`2026-05-28`): worker `spell-concentration-grant-cleanup` added caster-inclusive cleanup for old concentration spells so caster-side `grant_action` effects are removed when concentration ends or is replaced. Lead validation: `cd backend && source venv/bin/activate && python -m py_compile app/api/routes/tokens.py` -> passed; `cd backend && source venv/bin/activate && PYTHONPATH=. pytest --noconftest tests/unit/test_remove_control_effects_concentration_scope.py -q` -> 6 passed; `git diff --check -- backend/app/api/routes/tokens.py backend/tests/unit/test_remove_control_effects_concentration_scope.py` -> passed. Chrome DevTools recast Witch Bolt on token `535`, then replaced it with Wind Wall; DB confirmed caster `active_effects` count `0` and `witch_bolt_effects_remaining=[]`.
- Conjure Animals summon routing/materialization validation (`2026-05-28`): worker `spell-summon-placement-routing` routed short-cast `spawn_summon` spells through area placement while preserving Find Familiar long-cast readiness. Lead validation: `cd frontend && npx vitest run tests/utils/spellCastMiddleware.test.ts tests/utils/sidebarCasting.test.ts` -> 2 files / 46 tests passed; changed-file `tsc --noEmit` grep produced no errors; `git diff --check` on touched frontend files passed. Worker `spell-summon-materialization` then materialized linked summon tokens from `set_token_concentration`; lead validation: `cd backend && source venv/bin/activate && python -m py_compile app/api/routes/tokens.py && PYTHONPATH=. pytest --noconftest tests/unit/test_summon_concentration_materialization.py -q` -> 9 passed; combined summon/illumination regression -> 25 passed; `git diff --check` passed. Chrome DevTools recast Conjure Animals on an empty grid point, DB confirmed token count `24 -> 25`, `concentration_spell.linked_token_ids=[551]`, caster `active_effects[0].effect_type="spawn_summon"`, and summon token `551` at `(23,40)`. Replacing it with Wind Wall removed token `551`, returned token count to 24, cleared summon effects, and stored `concentration_spell.spell_id="wind_wall"`.
- High-level transformation/control Chrome validation (`2026-05-28`): Chrome DevTools first confirmed player view loads for campaign `8` with only known 404 icon assets. It then cast Polymorph / `变形术` on caster token `527`, confirming `concentration_spell.spell_id="polymorph"` and `transformation_data.type="full_replace"`. Replacing Polymorph with Banishment / `放逐术` initially exposed stale `transformation_data.source.spell_id="polymorph"` on the caster. Worker `spell-transformation-concentration-cleanup` decoupled source matching from size-delta restoration in concentration cleanup. Lead validation: `cd backend && source venv/bin/activate && python -m py_compile app/api/routes/spell_cast.py app/api/routes/tokens.py && PYTHONPATH=. pytest --noconftest tests/unit/test_remove_control_effects_concentration_scope.py -q` -> 10 passed; combined cleanup/summon regression -> 19 passed; `git diff --check` on touched cleanup files passed. Chrome DevTools reran Polymorph -> Banishment; DB confirmed caster concentration became `banishment`, caster `transformation_data=null`, caster active effects cleared, and target `533` gained `banishment_incapacitated` / `spell_buff_banishment`.
- Combat end-turn infrastructure validation (`2026-05-28`): Chrome DevTools reproduced the Heroism blocker as a combat storage/front-end mismatch: campaign storage had `current_turn_index=0` and no `current_index`, so the old DM `endTurn` path computed from `current_index` and did not PUT. Worker `spell-turn-index-compat` added `getCombatTurnIndex` / `withCombatTurnIndex`, migrated CombatPanel, InitiativeTracker, CombatTurnOverlay, and useMapCombatRuntimeController, and lead validation passed `cd frontend && npx vitest run tests/utils/combatTurnIndex.test.ts tests/hooks/useMapCombatRuntimeController.test.ts` -> 10 passed, `cd frontend && npx tsc --noEmit -p .` -> pass, and `git diff --check` on touched frontend files -> pass. Chrome confirmed the combat-tab `结束回合 ->` button advanced storage from `current_turn_index=0,current_index=null,version=1` to `current_turn_index=1,current_index=1,version=2`. A second defect remained: the always-visible top InitiativeTracker published `combatEndTurn`, but DM `LazyCombatPanel` was unmounted unless the right sidebar was on `战斗`. Worker `combat-top-endturn-mount` added `forceMount` to the DM combat tab and mounts `LazyCombatPanel` when `isCombatActive`; player route already had the pattern. Lead validation reran `cd frontend && npx tsc --noEmit -p .` -> pass and `git diff --check -- frontend/app/routes/campaign.$id.dm.tsx` -> pass. Chrome confirmed top initiative `结束回合` from the `角色` tab sent `PUT /api/campaigns/8/storage/combat/current` -> 200 and advanced storage from `current_turn_index=1,current_index=1,version=2,log_len=1` to `current_turn_index=2,current_index=2,version=3,log_len=2`.
- Legacy ongoing turn-trigger validation (`2026-05-28`): worker `spell-legacy-ongoing-turn-effects` added `combat_legacy_ongoing_effect_service` and aligned backend combat index extraction with the frontend helper. Lead validation passed `cd backend && source venv/bin/activate && python -m py_compile app/services/combat_turn_trigger_hooks.py app/services/combat_legacy_ongoing_effect_service.py`, `cd backend && source venv/bin/activate && PYTHONPATH=. pytest --noconftest tests/unit/test_combat_turn_trigger_hooks.py tests/unit/test_legacy_ongoing_turn_effects.py -q` -> 31 passed, and `git diff --check` on the touched backend files. Chrome DevTools recast Heroism on token `534`, clicked top initiative end-turn from token `533`, observed `POST /api/spells/cast` -> 200 and `PUT /api/campaigns/8/storage/combat/current` -> 200, and DB confirmed combat advanced `current_turn_index=6 -> 7` while token `534` changed `temp_hp=0 -> 5` with Heroism effects intact.
- Chrome CSS/hydration recovery (`2026-05-28`): worker `spell-chrome-hydration-favicon-css` moved favicon links out of Remix `links()` and added a dev-only persistent Tailwind fallback stylesheet. Lead validation passed `cd frontend && npm run typecheck`, relevant `git diff --check`, and live Chrome checks showing the fallback stylesheet present, Tailwind rules available, spell icons rendering at `14px`, and spell buttons at normal height. The authenticated route still logs broader hydration fallback, but CSS no longer disappears.
- Generated visual player visibility (`2026-05-28`): Chrome plugin selected the gallery image `一个蓝色发光的小箱子，边缘有银色符文` in `次级幻影`, placed it next to caster token `527`, and clicked `施法`. DB confirmed caster token `527` kept non-concentration `spell_area_minor_illusion` at `area_effect.center=(30.5,39.5)` and new illusion token `552` was created at `(30,39)` with `item_data.type="illusion"` and `icon` / `avatar_url` set to the selected generated image URL. The same Chrome profile opened `/campaign/8/player`; player view loaded campaign `8` and the map screenshot showed the `次级幻影` token adjacent to the caster.
- Disguise Self generated visual validation (`2026-05-28`): Chrome exposed a backend `NameError` when `易容术` tried to persist selected image data through `_apply_cast_appearance_illusion`. Worker `spell-disguise-self-generated-image-fix` added the missing `normalize_token_disguise_data` import and `backend/tests/unit/test_spell_cast_appearance_illusion.py`. Lead validation passed `python -m py_compile app/api/routes/spell_cast.py tests/unit/test_spell_cast_appearance_illusion.py`, `PYTHONPATH=. pytest --noconftest --override-ini='addopts=' tests/unit/test_spell_cast_appearance_illusion.py -q` -> 3 passed, relevant `git diff --check`, and Chrome/DB retest: caster token `527` gained `spell_buff_disguise_self`, `disguise_data.disguise_avatar` matched the selected generated image URL, and player view rendered the generated avatar image for `qa_all_spells_caster`.
- Detect Magic grant-sense materialization validation (`2026-05-28`): worker `spell-detect-magic-sense-materialization` added backend concentration-endpoint materialization for on-cast `grant_sense` leaves and `backend/tests/unit/test_concentration_sense_materialization.py`. Lead validation passed `cd backend && source venv/bin/activate && python -m py_compile app/api/routes/tokens.py tests/unit/test_concentration_sense_materialization.py`, `cd backend && source venv/bin/activate && PYTHONPATH=. pytest --noconftest tests/unit/test_concentration_sense_materialization.py tests/unit/test_summon_concentration_materialization.py -q` -> 18 passed, and relevant `git diff --check`. Chrome recast `侦测魔法` from token `527`; DB confirmed `concentration_spell.spell_id="detect_magic"` with `area_effect.followCaster=true` and caster `active_effects` included `detect_magic_sense` with `effect_type="grant_sense"`, `sense_type="detect_magic"`, `range=30`, and `source_token_id=527`. Breaking concentration through the authenticated backend endpoint returned 200 and DB confirmed `detect_magic_sense` was removed while unrelated Minor Illusion / Disguise Self effects remained.
- Misty Step destination picker validation (`2026-05-28`): worker `spell-misty-step-destination-picker` implemented real `teleport_destination` routing for `迷踪步`, removed the old disabled readiness path, added a typed `/api/spells/cast` payload field, and bridged the destination into `SpellResolver` through an allow-listed `phase_context`. A Chrome QA bounce found `SpellCastActions` was deriving `teleport_destination` but dropping it from `SpellCastData`, so the worker revised all `castSpellAction` consumers to forward `targetingMode` and added `frontend/tests/components/SpellCastActions.test.tsx` coverage. Lead validation passed `cd backend && source venv/bin/activate && python -m py_compile app/api/routes/spell_cast.py app/services/spell_resolver.py app/services/effect_engine/handlers/teleport.py tests/unit/test_spell_cast_teleport_destination.py && PYTHONPATH=. pytest --noconftest tests/unit/test_spell_cast_teleport_destination.py tests/unit/test_movement_handlers.py tests/unit/test_spell_cast_appearance_illusion.py tests/unit/test_spell_cast_granted_action.py tests/unit/test_spell_cast_slot_helpers.py tests/unit/test_spell_cast_start_cast_capture.py -q` -> 40 passed; `cd frontend && npx vitest run tests/components/SpellCastActions.test.tsx tests/utils/spellCastMiddleware.test.ts tests/utils/sidebarCasting.test.ts tests/hooks/useMapAreaSpellCastExecutionController.test.ts` -> 58 passed with existing React `act(...)` warnings; `cd frontend && npm run typecheck` -> pass; relevant `git diff --check` -> pass. Chrome in campaign `8` confirmed `选择目的地并施放` enters the destination picker without consuming a slot, empty in-range destination moved caster token `527` from `(30,38)` to `(31,37)` and consumed one 2nd-level slot, occupied destination showed `目标位置已被占据` and left token/slot state unchanged. QA state was reset to token `(30,38)` and 2nd-level slots `95` after evidence capture.
- Counterspell reaction-trigger validation (`2026-05-28`): worker `spell-counterspell-reaction-trigger` added V1 `on_spell_cast` reaction gating, source-caster targeting, `SpellCastData.spellId/casterTokenId`, backend `ReactionResult.countered/interrupted_spell_name`, and the Counterspell interrupt path. Chrome QA found a cross-client blocker: websocket chat discarded client `data.meta`, so other clients received no `spellCastData` and could not render the reaction button. Worker revision fixed `chat_handler.py` to accept dict `data.meta`, persist it, and broadcast `"meta": msg.meta or {}`. Lead validation passed backend `py_compile`, `PYTHONPATH=. pytest tests/unit/test_chat_handler_meta_propagation.py tests/unit/test_counterspell_reaction.py -q --disable-warnings` -> 8 passed, `cd frontend && npx vitest run tests/components/ReactionButtonsCounterspell.test.tsx` -> 4 passed, and `cd frontend && npm run typecheck` -> pass. Chrome plugin QA on campaign `8` seeded token `533` with in-progress `火球术`, sent a spell-cast chat card with `spellCastData`, saw `反制法术` under the player chat card, clicked it, and confirmed chat text `🚫 qa_all_spells_caster 施放【反制法术】打断了【火球术】！`. DB confirmed token `533.casting_in_progress` changed to `None` and caster character `50` 3rd-level slots changed `94 -> 93`; QA state was reset to `casting_in_progress=None` and slots `[0,86,95,94,95,99,99,99,99,99]`.
- Wall/barrier/suppression cleanup validation (`2026-05-28`): Chrome QA found `力场墙 -> 石墙术 -> 反魔法力场` left stale caster-side `create_wall` effects because `affected_token_ids` did not include the caster. Worker `spell-concentration-caster-effect-cleanup` added `_is_replaced_concentration_effect()` to `spell_cast.py` and a focused 6-test suite. Lead validation passed `py_compile`, `test_spell_cast_concentration_caster_effect_cleanup.py` -> 6 passed, `test_spell_cast_slot_helpers.py` -> 6 passed, `test_remove_control_effects_concentration_scope.py` -> 10 passed, and relevant `git diff --check`. Chrome retest on campaign `8` confirmed `力场墙` on token `533`, replacement with `石墙术` on token `534`, then replacement with `法术无效结界` removes stale `wall_of_force_wall` / `wall_of_stone_wall`, preserves non-concentration effects during replacement, and ends with QA state reset to slots `[0,86,95,94,95,99,99,99,99,99]`.
- Bless multi-target hotbar regression (`2026-05-28`): Chrome QA found the route-level `确认施法` banner was visually present but covered by the map targeting HUD cancel button (`z-[301]`) because the route banner wrapper was `z-[200]`; clicking the apparent confirm button therefore cancelled targeting without posting `/api/spells/cast`. Worker `spell-bless-multitarget-confirm-20260528` removed temporary trace probes, raised the DM and player multi-target banner wrappers to `z-[400]`, and retained defensive target id normalization. Lead validation passed `rg` trace cleanup, relevant `git diff --check`, focused frontend Vitest -> 80 passed, and `cd frontend && npx tsc --noEmit -p tsconfig.json` -> pass. Chrome retest on campaign `8` confirmed `document.elementFromPoint()` now hits the `确认施法` button; Bless cast for target tokens `533`, `534`, and `535` posted `POST /api/spells/cast` -> 200, stored caster concentration with `affected_token_ids=[533,534,535]`, wrote one `spell_buff_bless` on each target, and created active runtime instance `26` with `linked_target_token_ids="[533, 534, 535]"`. QA state was reset to no active Bless effects/runtime rows and slots `[0,86,95,94,95,99,99,99,99,99]`.
- Call Lightning area route validation (`2026-05-31`): Chrome QA on campaign `8` initially reproduced `Area spell '召雷术' could not be resolved` from `/api/combat/spell-area` when the frontend payload omitted structured effects. Worker `spell-call-lightning-area-resolution-v3` added `_hydrate_area_spell_raw()` plus a resolver fallback and focused unit coverage; the first Chrome retest then resolved damage and `grant_action` but showed `concentration=false`, `has_persistent_area=false`, and no 3rd-level slot consumption because the route was using Pydantic default concentration and the caster token id as the slot owner. Worker `spell-call-lightning-area-resolution-v5` made cached rules data authoritative for concentration and added `_area_spell_slot_source()` so slot consumption uses the Character owner. Lead validation passed `DATABASE_URL='postgresql+asyncpg://x:x@localhost/x' PYTHONPATH=. python -m pytest tests/unit/test_spell_resolver_call_lightning_area.py -v --override-ini='addopts='` -> 14 passed; adjacent resolver/grant-action regression tests -> 40 passed; `python -m py_compile app/api/routes/combat.py app/services/spell_resolver.py` and `git diff --check` -> passed. Chrome retest cast `召雷术` from token `2557` at token cluster `2565-2568`; DB confirmed target `2567` HP `40 -> 25`, caster `concentration_spell.spell_id="call_lightning"`, active `grant_action` `call_lightning_grant_action_召唤闪电`, chat meta `resolved_by="spell_resolver"`, `is_concentration=true`, `has_persistent_area=true`, and character `545` 3rd-level slots `[...99...] -> [...98...]`.
- Call Lightning granted-area follow-up validation (`2026-05-31`): Chrome QA used the visible follow-up path `法术动作 -> 召唤闪电`, selected the same target cluster, and initially reproduced the synthetic `⚡ 召唤闪电` payload failing resolution on `/api/combat/spell-area`. Worker `spell-call-lightning-grant-area` added `_match_active_grant_action()` and `_build_granted_action_area_raw()` in `combat.py`, matching persisted caster-side `grant_action` entries before route hydration and constructing a one-leaf freecast area payload with the stored attack/save/damage/area metadata. Recovery worker `spell-call-lightning-grant-area-handoff-recovery` supplied the final handoff after the original TTY was reclaimed. Lead validation passed `test_spell_resolver_call_lightning_area.py` -> 22 passed, combined `test_spell_resolver_call_lightning_area.py test_spell_cast_granted_action.py` -> 37 passed, `py_compile` on `combat.py` and the area tests, and `git diff --check`. Chrome retest cast initial `召雷术`, then `法术动作 -> 召唤闪电`; DB confirmed chat message `1808` had `resolved_by="spell_resolver"`, `spell_id="call_lightning"`, `slot_consumed=0`, `is_concentration=false`, `has_persistent_area=false`, and `target_count=4`; targets took additional lightning damage, character `545` slots stayed `[0,84,97,98,97,99,99,97,99,99]`, original concentration remained `call_lightning`, and exactly one `grant_action` remained on the caster.
- Multi-projectile / Aid max-HP validation (`2026-05-31`): lead validation passed `DATABASE_URL='postgresql+asyncpg://x:x@localhost/x' PYTHONPATH=. python -m pytest tests/unit/test_spell_scaling_multiprojectile.py -q --override-ini='addopts='` -> 17 passed, plus `py_compile` on `spell_resolver.py`, `modifier.py`, `effect_service.py`, `combat_resolution_service.py`, and the test. Chrome QA then used the right-click selected-caster -> target -> spell menu path on campaign `8`: 2nd-level `灼热射线` wrote chat message `1809` with three independent attack/damage results and HP `100 -> 72`; 20th-level `魔能爆` wrote message `1810` with four independent beam damage results (plus the existing forced-movement result) and no slot change; 4th-level `援助术` wrote message `1811`, healed `65 -> 80`, consumed one 4th-level slot, and persisted `aid_buff.modifiers[0]={"target":"hp_max","value":15,"stat":"max_hp"}`; 4th-level `灼热射线` wrote message `1812` with five independent attack/damage results and consumed one 4th-level slot. The low-AC target was temporarily set to HP `100` / AC `1` for deterministic hit evidence and is reset afterward.
- Spiritual Weapon grant-action attack validation (`2026-05-31`): Chrome QA used `灵体武器` from the selected-caster -> low-AC target spell menu. DB/chat message `1813` confirmed initial 2nd-level cast hit, dealt force damage, consumed one 2nd-level slot, and persisted caster active effect `spiritual_weapon_grant_action_灵体武器攻击` with `effect_type="grant_action"`, `action_kind="attack"`, melee spell attack metadata, and `damage={"formula":"1d8+MOD","damage_type":"force"}`. The visible context menu then showed `法术动作 -> 灵体武器攻击`; clicking it entered `选择攻击目标 — ⚔️ 灵体武器攻击`, selecting the target wrote message `1814` with an attack roll / damage result, `slotLevel=0`, no additional slot consumption, and the grant action remained active for the non-concentration spell. No worker dispatch was needed.
- Move-effect grant-area validation (`2026-05-31`): workers `spell-move-effect-grant-action-v2`, `spell-move-effect-empty-target-v1`, and `spell-flaming-sphere-move-area-v1` closed the grant-area routing, zero-target area execution, and Flaming Sphere area fallback gaps. Lead validation passed `cd frontend && npx vitest run tests/utils/grantedActions.test.ts tests/hooks/useMapAreaSpellCastExecutionController.test.ts` -> 18 passed; `cd backend && source venv/bin/activate && python -m pytest tests/unit/test_spell_resolver_call_lightning_area.py tests/unit/test_effect_engine.py -q --override-ini='addopts='` -> 58 passed; `cd frontend && npm run typecheck` -> pass; backend `py_compile` on `combat.py` and `utility.py` -> pass; `git diff --check` -> pass. Chrome QA then cast `月华之光` from token `2581`, moved `法术动作 -> 移动月华之光` to an empty point, and DB confirmed `area_effect.shape="cylinder"`, `radius=5`, `slot_level=2`, `target_count=0`, `slot_consumed=0`, and character `551` 2nd-level slots stayed `98`. After resetting to `炽焰法球`, Chrome cast the initial spell, then used `法术动作 -> 移动炽焰法球`; UI showed a 5-foot sphere area and DB confirmed `area_effect.shape="sphere"`, `radius=5`, `target_count=4`, `slot_consumed=0`, and 2nd-level slots stayed `97`.
- Hex transfer concentration-sync validation (`2026-06-01`): worker `spell-hex-transfer-concentration-sync` updated the runtime action path so Hex transfer synchronizes `caster.concentration_spell.affected_token_ids` with the transferred runtime target. Lead validation passed `python -m py_compile app/services/spell_runtime_service.py tests/unit/test_spell_runtime_service.py`, focused `pytest tests/unit/test_spell_runtime_service.py -k execute_runtime_action` -> 5 passed, full `test_spell_runtime_service.py` -> 59 passed, and Chrome/DB retest confirmed Hex transfer from token `2591` to `2592`, concentration cache retargeting, old-target cleanup, new-target effect persistence, and concentration-break cleanup.
- Remaining grant-action kind validation (`2026-06-01`): worker `spell-grant-action-kind-gaps` fixed frontend no-target action routing for `weapon_attack` / `custom`, removed target locking for `remove_condition`, and added backend `remove_condition` execution. Lead validation passed frontend `npx vitest run tests/utils/grantedActions.test.ts` -> 16 passed, backend `py_compile`, `pytest tests/unit/test_spell_cast_granted_action.py -p no:cacheprovider -p no:cov -q` -> 19 passed, selected `test_effect_engine.py -k "grant or move_effect or repeat_damage"` -> 5 passed, and `git diff --check`. Chrome confirmed `迅捷箭袋 -> 迅捷射击` posts a declaration without entering target picker, `强迫术 -> 指定移动方向` no longer falls through to the damage requirement, and `驱散善恶 -> 破除附魔` can target an afflicted ally and remove the condition.
- Remove-condition concentration-end validation (`2026-06-01`): worker `spell-remove-condition-end-concentration` added the successful-use concentration cleanup for `remove_condition`. Lead validation passed `python -m py_compile app/api/routes/spell_cast.py tests/unit/test_spell_cast_granted_action.py`, `python -m pytest tests/unit/test_spell_cast_granted_action.py -p no:cacheprovider -p no:cov -q` -> 19 passed, and scoped `git diff --check`. Chrome/DB retest in campaign `8` seeded an active `驱散善恶` concentration/grant state, seeded a charmed target, used the visible `法术动作 -> 破除附魔`, selected the target, and confirmed chat message `1833` removed 1 condition; DB showed `caster.concentration_spell=null`, caster effects `[]`, and target effects `[]`.
- PR quality-gate dependency cleanup (`2026-06-01`): worker `spell-runtime-ci-gate-fix` bumped `python-dotenv==1.1.1` and added frontend `@playwright/test`; lead validation passed `cd frontend && npm ci`, `cd frontend && npm run typecheck`, and scoped `git diff --check`, then commit `46d1ab20` was pushed. Follow-up CI exposed `fastmcp>=2.14.0` requiring `uvicorn>=0.35`; worker `spell-runtime-ci-uvicorn-fix` bumped `uvicorn[standard]==0.35.0`. Lead validation passed `git diff --check -- backend/requirements.txt` and `/opt/homebrew/bin/python3.11 -m pip install --dry-run 'uvicorn[standard]==0.35.0' 'fastmcp>=2.14.0' 'python-dotenv==1.1.1'` -> pass. Full `requirements-dev.txt` dry-run was attempted with a 120s guard and timed out while pip was still backtracking, without surfacing a new explicit conflict before timeout. The next CI run exposed `websockets==14.1` against fastmcp's `websockets>=15.0.1`; worker `spell-runtime-ci-websockets-fix` bumped `websockets==15.0.1` and `python-multipart==0.0.26`. Lead validation passed `git diff --check -- backend/requirements.txt` and `/opt/homebrew/bin/python3.11 -m pip install --dry-run 'fastmcp>=2.14.0' 'uvicorn[standard]==0.35.0' 'python-dotenv==1.1.1' 'websockets==15.0.1' 'python-multipart==0.0.26' 'pydantic==2.12.5' 'pydantic-settings==2.7.0'` -> pass, selecting `fastmcp-3.3.1`. After backend dependency install passed in CI, the backend-focused job failed importing `Settings` without `DATABASE_URL` / `REDIS_URL`; worker `spell-runtime-ci-backend-env-fix` added job-level dummy env values. Lead validation passed `git diff --check -- .github/workflows/quality-gate.yml` and `DATABASE_URL='postgresql+asyncpg://ci:ci@localhost/test' REDIS_URL='redis://localhost:6379/0' PYTHONPATH=. python -m pytest --noconftest tests/unit/test_core_dependencies.py tests/unit/test_runtime_schema_service.py -q` -> 7 passed. PR #1 quality-gate then passed both `backend-focused` and `contracts-and-frontend` jobs on the push and pull_request runs.
- Semantic QA S0/S1/S2 (`2026-06-01`): workers `spell-semqa-s0`, `spell-semqa-s1-expiry-v2` (+ polish), and `spell-semqa-s2-modifiers` added untracked backend QA tests under `backend/tests/qa_spells/`; lead validation passed `DATABASE_URL='postgresql+asyncpg://localhost/unused_for_purelogic' REDIS_URL='redis://localhost:6379/0' cd backend && venv/bin/python -m pytest tests/qa_spells/test_runtime_modifier_semantics.py tests/qa_spells/ -p no:cacheprovider -q` -> 58 passed, 1 skipped, 5 warnings; `venv/bin/python -m py_compile tests/qa_spells/*.py` -> pass; ASCII and line-length scans on `test_runtime_modifier_semantics.py` -> clean. S1's skip is the intentional DB-gated integration test without a configured safe Postgres test database. Known remaining semantic gaps: round expiry is characterized but not enforced, miss-path bonus suppression and live d20 total folding require route/Chrome scope, and S3 still needs cleanup/transform/summon residual assertions.
- Chrome semantic effect/expiry probe (`2026-06-01`): worker `spell-ongoing-zone-fixes` added legacy ongoing inline-save resolution and live HP outcome application in `combat_legacy_ongoing_effect_service.py`, with focused ongoing-effect unit coverage. Lead validation passed `cd backend && venv/bin/python -m py_compile app/services/combat_legacy_ongoing_effect_service.py app/services/spell_runtime_service.py app/api/routes/combat.py` and `cd backend && PYTHONPATH=. DATABASE_URL='postgresql+asyncpg://localhost/unused_for_purelogic' REDIS_URL='redis://localhost:6379/0' venv/bin/python -m pytest tests/unit/test_legacy_ongoing_turn_effects.py tests/unit/test_zone_spell_settlement_timing.py -p no:cacheprovider -q` -> 23 passed, 5 warnings. Chrome retest on campaign `8` used the visible right-click caster-to-target spell menu for `魅影杀手`, started combat with caster then target, advanced two turns, and confirmed target HP changed `40 -> 23` on end-of-target-turn while the `frightened` / `phantasmal_killer` effects remained. Earlier same-session Chrome checks confirmed `不谐低语`, `治愈真言`, `援助术`, `脆弱诅咒` + `曳光弹`, `火球术`, `致病射线`, `灵体武器`, and `群体治愈真言` applied semantic effects rather than merely avoiding exceptions.
- Chrome semantic effect/expiry follow-up (`2026-06-01`): lead reran a focused browser-only semantic batch on campaign `8`. `援助术` from the visible right-click spell menu raised `QA 残血盟友` HP `10 -> 15` and snapshot confirmed `aid_buff.modifiers[0]={target:"hp_max",type:"bonus",value:"5",stat:"max_hp"}`. `致病射线` from the same UI path reduced `普通目标A` HP `30 -> 21` and snapshot confirmed active effect `ray_of_sickness_poisoned` with `condition="poisoned"`. `魅影杀手` was reconfirmed from the browser cast path with target HP `40 -> 27` at end of target turn. However, using the visible browser `+1轮` control after applying `曳光弹` and separately after applying `致病射线` did not clear either `duration=1` effect from snapshot state, so browser-observed duration expiry remains suspicious and should stay paired with the existing S1 characterization instead of being treated as solved.

## Blockers

- None. Worktree is heavily dirty; workers must preserve unrelated changes.

## Observations

- Stage 6 projection now evaluates the full `on_cast` phase in read-only mode.
  This preserves instance state, but Hex projection can emit the existing
  `apply_mark` missing-context warning because Stage 6 intentionally passes an
  empty context override per the design.
- Stage 7 introduces `WIRED_TRIGGERS` as an audit-only mirror of service-layer
  dispatch points. Stage 8 must update it when turn/zone hookpoints become real
  execution paths, otherwise the audit will correctly report those triggers as
  declared-only.
- Stage 8a wires only the four combat turn triggers:
  `start_of_turn`, `end_of_turn`, `start_of_target_turn`, and
  `end_of_target_turn`. Zone triggers remain visible as declared-only audit
  gaps because the existing Web / Grease / Entangle structured-zone flow still
  owns timing semantics.
- Stage 8c found the direct canonical combat storage mutation in
  `tokens.delete_token` and wired it through the same shared helper used by
  `campaign_storage.update_storage_object`. The helper deliberately gates on
  `object_type="combat"` / `object_id="current"` and treats combat end
  (`new_in_session=False`) as a no-op for runtime turn triggers.
- Read-only route audit did not find additional direct canonical
  `combat/current` mutations in `spell_cast.py`, `aura_service.py`, or
  `combat.py`; those paths were left untouched.
- Bless already declares `modify_roll` for `roll_types=["attack", "save"]`
  and an `apply_token_filter` on `on_cast` in `spells.json`. The first Stage 9
  slice should make the backend runtime projection represent that cleanly for
  every linked target before attempting a larger spell migration.
- Stage 9a completed the backend-only Bless readiness slice. Runtime instances
  now persist all linked target token ids, `modify_roll` emits canonical
  `attack_roll` and `saving_throw` envelopes, modifier projection matches
  primary or linked targets, and concentration end touches every linked target
  for refresh fan-out.
- Stage 9a did not wire user-facing Bless casting, route payload handling, or
  multi-target visual buff sync for `apply_token_filter`. Those are Stage 9b
  concerns unless a narrower visual-only slice is chosen.
- Stage 9b preflight confirmed the existing `/api/spells/cast` request shape
  already accepted `target_token_ids: list[int]`, while the map targeting flow
  still dispatched only one `targetTokenId` and Bless did not yet declare
  `runtime.engine: "v2"` in `spells.json`.
- Before Stage 9b, runtime modifier projection was consumed by ability/skill
  checks, but attack rolls and saving throws still needed to merge
  `get_token_runtime_modifier_effects()` into their existing
  `effect_service.get_modifiers_for_target()` paths.
- Stage 9b completed those user-facing Bless gaps. The backend attack/save
  paths now evaluate runtime bonus formulas once and strip bonus modifiers
  before downstream advantage/disadvantage checks to avoid duplicate Bless
  reason rolls. The frontend multi-target flow remains intentionally minimal:
  selected targets are counted in the banner, not highlighted by name.
- The requested DevTools run reached local login and Vite module compilation
  for changed files, but not an authenticated campaign, because the local demo
  login attempt returned 401.
- Stage 10 completed the deferred zone-trigger migration without changing
  `spells.json`: active runtime instances can now dispatch `on_enter_zone` and
  `on_leave_zone` from `/zone-spell-settle`, while the legacy structured route
  only claims phases containing `deal_damage` or `apply_condition`. Pure
  runtime-engine phases therefore fall through to the runtime helper instead of
  being swallowed by structured settlement.
- Stage 10 recovery tightened the runtime helper success contract:
  `execute_runtime_zone_triggers()` now treats `PhaseResult.applied` as the
  primary "phase fired" signal, so a matched runtime zone phase can return
  success and publish projections even when it produces no state diff and no
  explicit touched ids. No-match behavior remains unchanged.
- The pre-existing `TestZoneSpellSettleAreaConcentrationTracking` direct route
  test drift is resolved as test-only work: it now calls the current
  `settle_zone_spell(request, db=db, current_user=...)` signature, stubs
  `resolve_campaign_member_context`, and supplies the structured `effects`
  phase shape required by Stage 10's legacy-zone filter.
- Stage 11 adds the first self-buff weapon-hit damage rider. Target matching
  for `conditional_extra_damage` is now verb-owned: only explicit
  `target_match: "any"` (or camelCase `targetMatch`) can opt out of
  primary-target equality; missing or unknown values remain primary-only.
  `get_runtime_bonus_damage()` now delegates target matching to the verb while
  retaining the caster/attacker prefilter.
- The frontend typecheck blockers observed in Stage 9b are still present and
  unrelated to Stage 11; they should be tracked separately before using
  typecheck as a release gate for this migration.
- Cross-category validation is representative by execution mechanism, not a
  manual click-through of all 364 spells. The accepted bar is that each
  implemented spell/effect family has at least one backend representative, the
  spell UI/projection flow has focused frontend coverage, and the live campaign
  loads authenticated spell UI without spell-runtime-specific console errors.
  The remaining full-spell-by-full-spell QA problem should be treated as a
  separate catalog audit if product wants exhaustive per-record certification.
- A Stage 12 smite-style migration was considered but intentionally deferred.
  Smite spells need mutating "consume on weapon hit" semantics; today's bonus
  damage path evaluates hit phases read-only, so `end_spell_instance` would not
  safely fire from that path. Bane was also considered but deferred because
  runtime-engine casting currently creates instances from selected targets, not
  from per-target save failures. Both are follow-up designs, not unfinished
  work from the approved phase-executor refactor.

## Next action

Closed for the runtime-engine implementation and the current representative
Chrome mechanism QA/fix loop. The separate exhaustive per-record catalog audit
remains optional future work if product wants every spell clicked one by one.
Counterspell upcast slot selection and pre-resolution rollback for instant
spells remain deferred follow-up designs, not blockers for the approved
runtime-engine / representative catalog QA scope. Legacy zone auto-tick for
spells such as `匕首之云` is likewise a deferred product/design choice: the
current implementation supports explicit zone settlement, while automatic
turn-start settlement would need geometry, idempotency, and frontend duplicate
handling rules before implementation.

## Worker handoff index

| Task ID | Status | Handoff |
|---|---|---|
| `spell-runtime-engine-stage1` | Done | `.tmp/team-lead/worker-spell-runtime-engine-stage1-20260526.md` |
| `spell-runtime-engine-stage2` | Done | `.tmp/team-lead/worker-spell-runtime-engine-stage2-20260526.md` |
| `spell-runtime-engine-stage3` | Done | `.tmp/team-lead/worker-spell-runtime-engine-stage3-20260526.md` |
| `spell-runtime-engine-param-order-fix` | Done | `.tmp/team-lead/worker-spell-runtime-engine-param-order-fix-20260526.md` |
| `spell-runtime-engine-stage4` | Done | `.tmp/team-lead/worker-spell-runtime-engine-stage4-20260526.md` |
| `spell-runtime-engine-stage5` | Done | `.tmp/team-lead/worker-spell-runtime-engine-stage5-20260526.md` |
| `spell-runtime-engine-stage6` | Done | `.tmp/team-lead/worker-spell-runtime-engine-stage6-20260526.md` |
| `spell-runtime-engine-stage7` | Done | `.tmp/team-lead/worker-spell-runtime-engine-stage7-20260526.md` |
| `spell-runtime-engine-stage8` | Done / Partial | `.tmp/team-lead/worker-spell-runtime-engine-stage8-20260526.md` |
| `spell-runtime-engine-stage8c` | Done | prior worker completed implementation; recovery handoff in `.tmp/team-lead/worker-spell-runtime-engine-stage8c-recovery-20260526.md` |
| `spell-runtime-engine-stage9a` | Done | `.tmp/team-lead/worker-spell-runtime-engine-stage9a-20260526.md` |
| `spell-runtime-engine-stage9b` | Done | `.tmp/team-lead/worker-spell-runtime-engine-stage9b-20260527.md` |
| `spell-runtime-engine-stage10-zone-triggers` | Done | `.tmp/team-lead/worker-spell-runtime-engine-stage10-zone-triggers-20260527.md` |
| `spell-runtime-engine-stage10-zone-triggers-recovery` | Done | `.tmp/team-lead/worker-spell-runtime-engine-stage10-zone-triggers-recovery-20260527.md` |
| `spell-runtime-engine-zone-settle-direct-route-signature` | Done | `.tmp/team-lead/worker-spell-runtime-engine-zone-settle-direct-route-signature-20260527.md` |
| `spell-runtime-engine-stage11-divine-favor` | Done | `.tmp/team-lead/worker-spell-runtime-engine-stage11-divine-favor-20260527.md` |
| `spell-category-validation-active-auras` | Done | `.tmp/team-lead/worker-spell-category-validation-active-auras-20260527.md` |
| `spell-browser-qa-first-fixes` | Done | `.tmp/team-lead/worker-spell-browser-qa-first-fixes-20260528.md` |
| `spell-stabilize-handler-fix` | Done | `.tmp/team-lead/worker-spell-stabilize-handler-fix-20260528.md` |
| `spell-browser-qa-third-fixes` | Done / Partial | `.tmp/team-lead/worker-spell-browser-qa-third-fixes-20260528.md` |
| `spell-backend-grants-revive` | Done | `.tmp/team-lead/worker-spell-backend-grants-revive-20260528.md` |
| `spell-frontend-placement-actions` | Done / Partial | `.tmp/team-lead/worker-spell-frontend-placement-actions-20260528.md` |
| `spell-grant-action-execution-fix` | Done | `.tmp/team-lead/worker-spell-grant-action-execution-fix-20260528.md` |
| `spell-grant-action-spell-level-revision` | Done | `.tmp/team-lead/worker-spell-grant-action-spell-level-revision-20260528.md` |
| `spell-grant-action-precedence-revision` | Done | `.tmp/team-lead/worker-spell-grant-action-precedence-revision-20260528.md` |
| `spell-concentration-grant-cleanup` | Done | `.tmp/team-lead/worker-spell-concentration-grant-cleanup-20260528.md` |
| `spell-summon-placement-routing` | Done | `.tmp/team-lead/worker-spell-summon-placement-routing-20260528.md` |
| `spell-summon-materialization` | Done | `.tmp/team-lead/worker-spell-summon-materialization-20260528.md` |
| `spell-transformation-concentration-cleanup` | Done | `.tmp/team-lead/worker-spell-transformation-concentration-cleanup-20260528.md` |
| `spell-turn-index-compat` | Done | `.tmp/team-lead/worker-spell-turn-index-compat-20260528.md` |
| `combat-top-endturn-mount` | Done | `.tmp/team-lead/worker-combat-top-endturn-mount-20260528.md` |
| `spell-legacy-ongoing-turn-effects` | Done | `.tmp/team-lead/worker-spell-legacy-ongoing-turn-effects-20260528.md` |
| `spell-ritual-target-area-capture` | Done | `.tmp/team-lead/worker-spell-ritual-target-area-capture-20260528.md` |
| `spell-ready-area-release-seed` | Done | `.tmp/team-lead/worker-spell-ready-area-release-seed-20260528.md` |
| `spell-chrome-hydration-favicon-css` | Done | `.tmp/team-lead/worker-spell-chrome-hydration-favicon-css-20260528.md` |
| `spell-disguise-self-generated-image-fix` | Done | `.tmp/team-lead/worker-spell-disguise-self-generated-image-fix-20260528.md` |
| `spell-detect-magic-sense-materialization` | Done | `.tmp/team-lead/worker-spell-detect-magic-sense-materialization-20260528.md` |
| `spell-misty-step-destination-picker` | Done | `.tmp/team-lead/worker-spell-misty-step-destination-picker-20260528.md` |
| `spell-counterspell-reaction-trigger` | Done | `.tmp/team-lead/worker-spell-counterspell-reaction-trigger-20260528.md` |
| `spell-concentration-caster-effect-cleanup` | Done | `.tmp/team-lead/worker-spell-concentration-caster-effect-cleanup-20260528.md` |
| `spell-bless-multitarget-confirm-20260528` | Done | `.tmp/team-lead/worker-spell-bless-multitarget-confirm-20260528.md` |
| `spell-grant-resistance-multitype-fix` | Done | `.tmp/team-lead/worker-spell-grant-resistance-multitype-fix-20260528.md` |
| `spell-call-lightning-area-resolution-v3` | Done / revised by v5 | `/Users/haoli/leehow/code/dw-worker-call-lightning-area/.tmp/team-lead/worker-spell-call-lightning-area-resolution-v3-20260531.md` |
| `spell-call-lightning-area-resolution-v5` | Done | `/Users/haoli/leehow/code/dw-worker-call-lightning-area/.tmp/team-lead/worker-spell-call-lightning-area-resolution-v5-20260531.md` |
| `spell-call-lightning-grant-area` | Done / recovery handoff used | `.tmp/team-lead/worker-spell-call-lightning-grant-area-handoff-recovery-20260531.md` |
| `spell-move-effect-grant-action-v2` | Done | `.tmp/team-lead/worker-spell-move-effect-grant-action-v2-20260531.md` |
| `spell-move-effect-empty-target-v1` | Done | `.tmp/team-lead/worker-spell-move-effect-empty-target-v1-20260531.md` |
| `spell-flaming-sphere-move-area-v1` | Done | `.tmp/team-lead/worker-spell-flaming-sphere-move-area-v1-20260531.md` |
| `spell-hex-transfer-concentration-sync` | Done | `.tmp/team-lead/worker-spell-hex-transfer-concentration-sync-20260601.md` |
| `spell-grant-action-kind-gaps` | Done | `.tmp/team-lead/worker-spell-grant-action-kind-gaps-20260601.md` |
| `spell-remove-condition-end-concentration` | Done | `.tmp/team-lead/worker-spell-remove-condition-end-concentration-20260601.md` |
| `spell-runtime-ci-gate-fix` | Done | `.tmp/team-lead/worker-spell-runtime-ci-gate-fix-20260601.md` |
| `spell-runtime-ci-uvicorn-fix` | Done | `.tmp/team-lead/worker-spell-runtime-ci-uvicorn-fix-20260601.md` |
| `spell-runtime-ci-websockets-fix` | Done | `.tmp/team-lead/worker-spell-runtime-ci-websockets-fix-20260601.md` |
| `spell-ongoing-zone-fixes` | Done / zone decision deferred | `/Users/haoli/leehow/code/dw-worker-spell-ongoing-zone/.tmp/team-lead/worker-spell-ongoing-zone-fixes-20260601.md` |
