# Spell QA Harness Self-Test (Phase 0 gate)

Prereqs: backend running with `QA_MODE=true` on :8174, frontend on :5174,
`QA_TOKEN` exported, Claude-in-Chrome connected.

## 0. Seed
- `scripts/spell-qa/qa.sh seed` → note `campaign_id` (CID) and `actor_ids`/`monster_ids`.

## 1. Fire Bolt (attack path) — fixture `firebolt`
1. `qa.sh reset <CID> firebolt` ; `qa.sh forced 18` (forced hit vs low_ac_target).
2. In Chrome open `/campaign/<CID>/dm`, wait for map ready.
3. Select caster: `fireClickAtGrid(6,10)` (konva-snippets.md).
4. Open 施法 panel, choose Fire Bolt, target low_ac_target grid (10,9), confirm.
5. `qa.sh snap <CID>` → assert low_ac_target current_hp decreased.
6. Repeat with `qa.sh forced 2` vs high_ac_target (AC 25) → assert miss (no HP change), combat log shows miss.

## 2. Cure Wounds (heal path) — fixture `cure_wounds`
1. `qa.sh reset <CID> cure_wounds`; pre-damage qa_low_hp_ally if needed.
2. Cast Cure Wounds on the damaged ally; confirm.
3. `qa.sh snap <CID>` → assert ally HP increased, not above max.

## 3. Fireball (save/area path) — fixture `fireball`
1. `qa.sh reset <CID> fireball`; `qa.sh forced 5,18,5,18,5,18`.
2. Cast Fireball centered on cluster grid (16,8); resolve saves.
3. `qa.sh snap <CID>` → assert cluster targets took damage; high-save (18) targets took half of low-save (5) targets.

## 4. Determinism check
- Run step 3 twice with identical `forced` queue + reset. The two `snap` outputs
  (post-cast HP deltas) MUST be identical. If not, record BLOCKED_BY_TEST_INFRA.

## Gate
All three spells PASS in the browser + determinism check identical → Phase 0 done.
Begin Phase 1 (runtime smoke: hex, bless, divine_favor, concentration replace, zone settlement).
