# Spell Runtime Browser QA Plan

Last updated: 2026-05-27

## Purpose

This plan defines an exhaustive browser-facing QA pass for spell behavior. It
goes beyond unit and representative backend tests: a tester should operate the
app like a real DM/player in the browser, cast spells from the UI, observe the
map, combat log, token state, spell effects, resources, and follow-up triggers,
then record whether each spell is correct.

The plan is intentionally test-data heavy. The QA environment may grant a test
character every spell, unlimited spell uses, and a controlled monster arena.
Those shortcuts are allowed only in the dedicated QA campaign and must not be
applied to production or shared live campaigns.

## Scope

- Test all 364 spells in `frontend/app/data/rules/spells.json`.
- Use the Codex `@chrome` plugin as the browser execution backend. The in-app
  Browser and standalone Playwright may be used only for diagnosis after the
  Chrome plugin path is blocked and the blocker has been recorded.
- Prefer browser actions for the actual cast flow: select token, open spell UI,
  choose spell, choose target or area, confirm, resolve prompts, and inspect the
  resulting UI state.
- Use backend/database helpers only for setup, reset, deterministic assertions,
  and evidence collection.
- Validate both immediate cast results and delayed effects such as
  concentration cleanup, turn triggers, zone triggers, on-hit riders, and
  expiration.

## Non-goals

- This is not a D&D rules rewrite. If a spell's rules are ambiguous, record the
  current app behavior and mark the case `Needs Rules Decision`.
- This is not a production data migration. QA seed data must be reversible.
- This does not require every spell to be migrated to runtime v2 before testing.
  Legacy effect-engine spells should still be tested through their current UI
  path.

## Test Environment

Use a dedicated campaign:

- Campaign: `Spell Runtime QA Arena`
- Map: flat grid, fixed scale, no fog-of-war, easy token spacing.
- User: local test account only.
- Mode: DM view first; selected player view smoke at the end.

Recommended reset model:

- A seed/reset command recreates the campaign from scratch.
- A snapshot command records pre/post campaign state for each spell.
- Each spell starts from a known clean state unless it explicitly tests
  concentration replacement, stacked effects, or trigger carryover.

## Chrome Plugin Execution Plan

All browser automation for this QA pass should run through the Codex Chrome
plugin, controlling the user's Chrome profile through the Codex Chrome
Extension.

### Chrome preflight

Before running spell cases:

1. Connect to Chrome through the plugin backend `extension`.
2. Run a lightweight health check by listing Chrome tabs.
3. If the connection fails, retry once after a short wait.
4. If it still fails, record `BLOCKED_BY_TEST_INFRA` and follow the Chrome
   plugin repair flow. Do not silently fall back to the in-app Browser.
5. Do not inspect cookies, local storage, passwords, Chrome profiles, or session
   stores. Login state is verified only by visible UI and app responses.

Implementation shape:

```js
if (!globalThis.agent) {
  const { setupBrowserRuntime } = await import(
    "/Users/haoli/.codex/plugins/cache/openai-bundled/chrome/26.519.81530/scripts/browser-client.mjs"
  );
  await setupBrowserRuntime({ globals: globalThis });
}
if (!globalThis.browser) {
  globalThis.browser = await agent.browsers.get("extension");
}
await browser.nameSession("Spell Runtime QA");
await browser.tabs.list();
```

Use `browser.tabs.finalize({ keep: [] })` at the end of each run unless a live
tab is intentionally handed off for debugging.

### Login and session handling

The runner should use the local QA account supplied out-of-band by the lead or
from a local ignored secret source. Do not commit credentials into this plan,
source files, result artifacts, screenshots, or logs.

Login flow:

1. Open `http://localhost:5174/login` in Chrome.
2. If already logged in and the campaign hall is visible, continue.
3. Otherwise fill the email and password fields using visible labels or
   placeholders.
4. Click the login button and wait for the campaign hall.
5. Assert the visible account/campaign hall state, not Chrome cookies or storage.

### Chrome action driver

The runner should be structured as a small Chrome-driven harness with these
layers:

| Layer | Responsibility |
|---|---|
| `chromeSession` | Connects to Chrome, creates/claims a tab, finalizes tabs. |
| `authFlow` | Logs in or confirms existing session using visible UI only. |
| `campaignNavigator` | Opens the QA campaign in DM/player mode and waits for map readiness. |
| `arenaReset` | Calls local reset helpers before each spell and reloads Chrome state. |
| `spellCaster` | Performs human-like UI steps: select caster, open spell panel, search spell, choose targets/area, confirm. |
| `promptResolver` | Resolves concentration, save, reaction, target, and zone-settlement prompts. |
| `stateObserver` | Captures DOM snapshot, screenshot, console logs, and read-only backend state. |
| `resultWriter` | Writes one result row per spell and a summary by mechanism family. |

Chrome interactions should prefer visible, stable selectors in this order:

1. `data-testid`
2. stable `data-*`
3. role plus exact accessible name
4. placeholder/label
5. scoped text in the current panel
6. coordinate/CUA action only when the map canvas has no semantic locator

Before every click/fill/keypress:

1. Capture or reuse a fresh enough DOM snapshot.
2. Build a locator from visible UI.
3. Check the locator count when uniqueness is not obvious.
4. Perform the action.
5. Re-snapshot after UI state changes.

Map targeting may require coordinate-style actions because token/map layers are
partly canvas/SVG driven. For those cases, the harness should compute target
coordinates from the seeded token positions and verify the result through token
state snapshots afterward.

### Per-spell Chrome scenario

Each spell scenario should run like a human tester:

1. Reset the QA arena for `spell_id`.
2. Open the QA campaign in Chrome DM view.
3. Wait until the map header, connection indicator, character panel, and spell
   UI are visible.
4. Select `qa_all_spells_caster` or the scenario-specific actor.
5. Open the spell list.
6. Search for the spell by id, English name, or Chinese name.
7. Click the spell.
8. Select target/token/area/zone using the seeded fixture coordinates.
9. Confirm cast.
10. Resolve any modal or prompt.
11. Capture screenshot and DOM snapshot.
12. Read Chrome console logs through `tab.dev.logs({ levels: ["error", "warn"] })`.
13. Export read-only before/after state.
14. Mark result and continue.

Minimal scenario pseudocode:

```js
await resetArenaForSpell(spellId);
await tab.goto("http://localhost:5174/campaign/<qaCampaignId>/dm");
await waitForCampaignReady(tab);
await selectToken(tab, "qa_all_spells_caster");
await openSpellPanel(tab);
await chooseSpell(tab, spellId);
await chooseScenarioTargets(tab, spellId);
await confirmCast(tab);
await resolvePrompts(tab, spellId);
const evidence = await collectChromeEvidence(tab, spellId);
const afterState = await exportSpellState(spellId);
writeResult({ spell_id: spellId, evidence, afterState });
```

The helper functions above are conceptual names for the QA harness; they should
be implemented in code only when the QA runner is built.

### Chrome evidence requirements

For every spell case:

- DOM snapshot of the final visible state.
- Screenshot when the spell changes the map, tokens, dialog, log, or visible
  status.
- Console errors and warnings from Chrome.
- Current URL and page title.
- Read-only token/effect/combat-log state before and after the cast.

For failures:

- Keep the Chrome tab open as `handoff` if visual debugging is useful.
- Include the final screenshot and DOM snippet in the failure artifact.
- Include the exact action step that failed.
- Distinguish Chrome automation failure from app behavior failure.

## QA Actors

Create these test characters/tokens:

| Actor | Purpose |
|---|---|
| `qa_all_spells_caster` | Knows/prepares every spell in `spells.json`; spell slots set to effectively unlimited for levels 1-9; high spellcasting stats. |
| `qa_weapon_caster` | Has every on-hit rider spell plus simple melee/ranged weapons for Hex, Hunter's Mark, Divine Favor, smites, and similar flows. |
| `qa_healer` | Tests healing, temp HP, restoration, resurrection, and exclusion rules. Can be the same character as the all-spells caster if UI remains usable. |
| `qa_low_hp_ally` | Friendly damaged target for healing and temp HP tests. |
| `qa_downed_ally` | Friendly target at 0 HP for stabilize/revive tests. |
| `qa_player_view_character` | A player-controlled character used to confirm player-facing spell effect visibility. |

The all-spells caster should be test-only. Give it:

- all spell ids from `spells.json`
- high spell save DC and attack bonus
- effectively unlimited spell slots and class resources
- no normal class-list restrictions
- resettable concentration and active effects

## Monster Arena

Place fixed monsters around the caster:

| Monster | Purpose |
|---|---|
| `normal_target_a` | Generic single-target spell target. |
| `normal_target_b` | Secondary target for multi-target and retarget tests. |
| `low_ac_target` | Attack-roll spell hit confirmation. |
| `high_ac_target` | Attack-roll miss confirmation. |
| `low_save_target` | Save-fail path for save spells and conditions. |
| `high_save_target` | Save-success or half-damage path. |
| `fire_resistant_target` | Resistance/immunity/vulnerability damage math. |
| `poison_immune_target` | Damage/condition immunity checks. |
| `undead_target` | Healing exclusion and undead-specific spells. |
| `construct_target` | Healing exclusion and construct-specific rules. |
| `condition_immune_target` | Charm/frighten/paralyze/poison/stun immunity. |
| `cluster_targets_1_6` | Area spell and zone spell target cluster. |
| `mobile_target` | Enter/leave zone and forced movement tests. |

Use stable token names and coordinates so browser automation can reuse the same
selectors and map locations.

## Determinism Strategy

Dice randomness should not make tests flaky:

- Prefer existing forced-roll hooks where available.
- If no forced-roll hook exists, run both low/high target variants and assert
  ranges rather than exact values.
- For save spells, pair `low_save_target` and `high_save_target`.
- For attack spells, pair `low_ac_target` and `high_ac_target`.
- Record the actual d20/damage roll in the result artifact.

If deterministic hooks are missing, log that as a QA infrastructure gap rather
than weakening the spell assertion.

## Browser Test Loop

For each spell:

1. Reset arena to the spell's fixture state.
2. Open `http://localhost:5174/login`.
3. Log in with the test account.
4. Enter `Spell Runtime QA Arena` as DM.
5. Select the casting token.
6. Open the spell panel or spell action UI.
7. Search/select the spell by id or localized name.
8. Choose target, targets, self, point, line, cone, cube, sphere, wall, or zone.
9. Confirm cast.
10. Resolve any prompts: save, reaction, concentration replacement, target
    selection, action invocation, or zone settlement.
11. Inspect browser-visible outcome.
12. Inspect post-state using read-only API/DB snapshot.
13. Capture evidence: result row, screenshot if UI changed visibly, console
    errors, network failures, and relevant chat/combat log lines.
14. Reset or advance turns when the spell requires delayed verification.

Browser-level checks:

- No Vite transform overlay.
- No spell-runtime-specific console error.
- No backend 500.
- Cast UI completes or shows a clear, expected user-facing blocker.
- Chat/combat log describes the spell result.
- Token HP, active effects, overlays, badges, links, resources, and
  concentration state match expectation.

## Per-Spell Result Record

Each spell should produce one row in a machine-readable result file:

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
    "screenshot": "artifacts/spell-qa/2026-05-27/fireball.png",
    "state_before": "artifacts/spell-qa/2026-05-27/fireball.before.json",
    "state_after": "artifacts/spell-qa/2026-05-27/fireball.after.json"
  },
  "notes": ""
}
```

Allowed statuses:

- `PASS`
- `FAIL`
- `BLOCKED_BY_TEST_INFRA`
- `BLOCKED_BY_APP_BUG`
- `NEEDS_RULES_DECISION`
- `DEFERRED_NOT_IMPLEMENTED`

## Mechanism Matrix

The per-spell run should also roll up into this mechanism matrix.

| Family | Representative examples | Required checks |
|---|---|---|
| Runtime v2 | Hex, Bless, Divine Favor | Runtime instance creation, projections, badges/links, cleanup, audit support. |
| Direct damage | Fire Bolt, Magic Missile, Inflict Wounds | Hit/miss or auto-hit, HP delta, resistance/immunity, log. |
| Save damage | Sacred Flame, Burning Hands, Fireball | Save success/failure, half damage, area target selection. |
| Healing | Cure Wounds, Healing Word, Mass Cure Wounds | HP recovery, max HP cap, range, multi-target, undead/construct exclusion. |
| Temp HP | False Life, Armor of Agathys, Heroism | Temp HP max/take-higher behavior, expiration, damage triggers if present. |
| Conditions | Command, Hold Person, Tasha's Hideous Laughter | Apply, immune skip, save/escape, expiration, UI badge. |
| Restoration | Lesser Restoration, Remove Curse, Greater Restoration | Remove correct condition/effect without deleting unrelated effects. |
| Buff modifiers | Bless, Guidance, Resistance, Mage Armor | Attack/save/check/AC modifiers visible and applied once. |
| Debuff modifiers | Bane, Vicious Mockery, Hex ability check debuff | Target-only modifiers, save/attack penalty, cleanup. |
| Concentration | Bless, Hex, Fog Cloud, Haste | Start, replace, break on damage, end cleanup, linked-target refresh. |
| On-hit riders | Hex, Hunter's Mark, Divine Favor, smite spells | Weapon/spell attack gating, target matching, consume-on-hit where applicable. |
| Granted actions | Hex transfer, Witch Bolt, Dancing Lights | Action appears only when legal, invokes correctly, hides after use/end. |
| Turn triggers | Moonbeam, Spirit Guardians, Heroism, Tasha | Start/end target turn timing, repeated damage/heal/save, no duplicate trigger. |
| Zone triggers | Grease, Entangle, Web, Cloud of Daggers | Enter/leave/start timing, zone settlement modal, duplicate prevention. |
| Area visuals | Fog Cloud, Darkness, Light, Faerie Fire | Map overlay, obscurement/light behavior, cleanup. |
| Token visuals | Invisibility, Disguise Self, Enlarge/Reduce | Token filter/size/visibility/disguise and revert. |
| Movement | Misty Step, Thunderwave, Thorn Whip, Longstrider | Teleport, forced movement, speed buff/restriction, map position/state. |
| Summons | Find Familiar, Conjure Animals, Animate Dead | Token creation, ownership/linkage, replacement/cleanup. |
| Illusions | Minor Illusion, Silent Image, Mirror Image | Visual token/zone creation, interaction affordance, cleanup. |
| Walls/barriers | Wall of Force, Wall of Stone, Forcecage | Shape creation, token/effect data, blocking metadata if implemented. |
| Auras | Crusader's Mantle, Spirit Guardians, Aura of Vitality | Moving aura anchor, selected targets, turn/zone interaction, active aura cleanup. |
| Counter/dispel/suppress | Counterspell, Dispel Magic, Antimagic Field | Reaction/utility flow, removes or suppresses eligible effects only. |
| Death/revive | Spare the Dying, Revivify, Raise Dead, Power Word Kill | Stable/dead/alive transitions, HP result, invalid target handling. |
| Utility/information | Detect Magic, Identify, See Invisibility | Expected narrative/effect markers, no crash, log/visibility output. |

## Execution Phases

### Phase 0: QA Infrastructure

- Build seed/reset command for the QA campaign.
- Add all spells and unlimited uses to the QA caster.
- Create the monster arena.
- Add read-only snapshot export for campaign/tokens/effects/logs.
- Add result artifact directory:
  `artifacts/spell-qa/<date>/`.

### Phase 1: Runtime-Critical Smoke

Run first because these paths were recently changed:

- Hex
- Bless
- Divine Favor
- concentration replacement
- zone settlement
- attack and save modifier integration

Exit criteria: no runtime-specific browser or backend error.

### Phase 2: Breadth by Spell Level

Run every spell by level:

- cantrips
- level 1
- level 2
- level 3
- levels 4-5
- levels 6-9

Within each level, group by target shape: self, single target, multiple target,
area, zone, reaction, and utility.

### Phase 3: Trigger and Cleanup Stress

Run spells that require time or follow-up:

- start/end turn
- enter/leave zone
- on-hit
- on-take-damage
- reaction
- concentration end
- action-invoked
- expiration

Exit criteria: every active effect can be cleaned up without stale badge,
overlay, runtime ref, or concentration state.

### Phase 4: Player-View Smoke

Repeat a smaller set from player view:

- player casts a damage spell
- player receives Bless/Hex/condition
- player sees zone/visual effect
- player invokes a granted action if applicable

Exit criteria: DM and player views agree on visible state.

### Phase 5: Regression Rerun

After fixing any failures:

- rerun the failed spell
- rerun the mechanism family representative
- rerun runtime-critical smoke
- rerun frontend spell Vitest and backend representative matrix

## Evidence Artifacts

Each run should produce:

- `artifacts/spell-qa/<date>/results.json`
- `artifacts/spell-qa/<date>/summary.md`
- screenshots for visual/state-changing spells
- before/after token/effect snapshots
- browser console/network summary
- bug list grouped by owning surface:
  - spell data
  - backend effect engine
  - runtime v2 engine
  - frontend cast UI
  - map visualization
  - rules decision
  - test infrastructure

## Pass Criteria

The QA pass is complete when:

- Every spell in `spells.json` has a result row.
- Every mechanism family in the matrix has at least one passing representative.
- All v2 spells pass their full browser flow.
- Every failure has a reproducible artifact and an owner.
- No spell-runtime-specific browser console error remains in the QA campaign.
- No backend 500 appears during spell cast, trigger, cleanup, or reset.
- Known unrelated blockers, such as current frontend typecheck failures, are
  explicitly recorded and not confused with spell behavior failures.

## Recommended First Batch

Start with this 25-spell batch before attempting all 364:

1. Hex
2. Bless
3. Divine Favor
4. Fire Bolt
5. Sacred Flame
6. Magic Missile
7. Cure Wounds
8. Healing Word
9. False Life
10. Armor of Agathys
11. Command
12. Hold Person
13. Tasha's Hideous Laughter
14. Mage Armor
15. Bane
16. Fog Cloud
17. Grease
18. Entangle
19. Web
20. Misty Step
21. Thunderwave
22. Invisibility
23. Disguise Self
24. Find Familiar
25. Counterspell

This batch exercises the highest-risk UI and engine families before the full
catalog run begins.
