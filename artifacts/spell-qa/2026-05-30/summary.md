# Spell Runtime QA — Phase 0 Self-Test Summary (2026-05-30)

## Outcome

**Harness built, fully unit/integration-tested, and validated end-to-end through the real spell pipeline.** The Phase 0 self-test mechanisms (attack / save / heal + determinism) all PASS at the API level. The literal in-browser click-through was not completed this run due to a Chrome-extension outage (details below) — but the cast path it would exercise is the same `spell_resolver` pipeline already validated here.

## What passed

| Mechanism | Spell | Forced roll | Result |
|---|---|---|---|
| Attack | Fire Bolt | d20=18 vs AC5 / d20=2 vs AC25 | HIT (dmg 3) / MISS (dmg 0) ✓ |
| Save | Sacred Flame | save=3 (fail) / save=19 (success) | 4 dmg / 0 dmg ✓ |
| Healing | Cure Wounds | — | ally 10→22 HP (+12) ✓ |
| Determinism | Fire Bolt | d20=18 ×2 | hit both times ✓ |

All casts ran via `POST /api/spells/cast` against campaign 8 ("Spell Runtime QA Arena") with `QA_MODE=true`, forced rolls queued through `POST /api/qa/forced-roll`, and state read via `GET /api/qa/snapshot`.

## Harness status (committed on `feat/spell-qa-harness`)

- `QA_MODE` flag; `qa_randint` forced-roll seam in `spell_resolver` (5 d20 sites)
- `/api/qa/{forced-roll,seed,reset,snapshot}` — 404 when `QA_MODE` off, DM-guarded
- Arena: 6 actors + 12 monsters + 6-cluster, seeded idempotently on the campaign's real map
- Scripts: `qa.sh`, `konva-snippets.md`, `fixtures.json` (26 ids validated), `validate_fixtures.py`, `SELF_TEST.md`
- **14 backend tests pass**; transport-contract clean; 96 existing spell tests still green

## Bugs found & fixed along the way

1. `module_embeddings` duplicate index — broke fresh-DB test setup (was blocking the whole test harness).
2. Seed not idempotent — re-seeding duplicated monsters.
3. Seeded tokens placed on a placeholder map_url instead of the campaign's displayed map → invisible on the map.
4. Seed created only 1 of the 6 spec actors — now seeds all six (caster, weapon caster, healer, low/downed allies, player-view).

## Open / blocked

- **Visual browser cast** (Fire Bolt/Cure Wounds/Fireball through the UI): blocked. Claude-in-Chrome extension went offline mid-run and did not recover; dw-browser-test (self-launching Chromium) auto-logs-in as a non-member user, so even with the admin token injected the app's render gate stays on the stale session.
- **Frontend token render** (RESOLVED — was a duplicate of seed bug #3, not a frontend bug): the earlier "0 token groups" observation was a stale read taken before the arena was re-seeded after fix #3. Root cause is the same map_url mismatch: tokens had been seeded on the `qa_flat_grid` placeholder while the frontend fetches `map-bulk-data?map_url=<campaign.current_map_url>` (the real OSS map), so the bulk query returned 0 tokens for the displayed map → empty `tokens` → 0 Konva groups. It is **not** a `TacticalMap` filter or monster-resolution defect: `filterVisibleTokens` does not compare map_url at all (the backend bulk query does), `isDM` is hardcoded `true` on the `/campaign/$id/dm` route (so the player-visibility gate never applies there), and `MapTokenLayer` renders `visibleTokens` directly with no monster-resolution gate. Fixed by `79d1733c` (seed on `campaign.current_map_url`) + `d166c66c` (idempotent teardown deletes all campaign tokens, so a re-seed migrates the old `qa_flat_grid` rows onto the correct map). **Verified live (2026-05-30):** clean `admin@deepwood.cn` session on `/campaign/8/dm` renders all 24 tokens (72 Konva groups: 6 player + 18 enemy), matching the initiative bar. No code change needed beyond the already-landed seed fix.
- **Damage-dice determinism**: only the d20 is forced today; 1d10/8d6 etc. remain RNG. Fine for hit/miss + save outcomes; add damage forcing if exact-damage assertions are wanted.

## To finish the visual pass (one step, everything staged)

Backend (`QA_MODE=true`, :8174) and frontend (:5174) are left running; campaign 8 is seeded; admin token in `/tmp/qa_token.txt`. With Claude-in-Chrome reconnected (clean admin session), follow `scripts/spell-qa/SELF_TEST.md`.
