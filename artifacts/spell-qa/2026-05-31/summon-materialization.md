# Summon Materialization — Investigation (2026-05-31)

Question: do summon spells (find_familiar, conjure_*) actually create tokens, or
only "record intent"?

## Finding: materialization IS implemented and works — no bug

Earlier waves saw only the `spawn_summon` intent marker on the caster because the
API-only cast tests bypassed the materialization flows. Verified both real paths
end-to-end against the running backend (campaign 8):

### Path 1 — concentration / area-placement summons (conjure_animals, conjure_*)
The cast records a `spawn_summon` intent; the token is materialized by
`_materialize_summon_for_concentration` (tokens.py:304), invoked from
`POST /api/tokens/{id}/concentration` (tokens.py:3204) when the concentration is
set with an `area_effect`. **Verified:** setting concentration for `conjure_animals`
with `area_effect{center_x:16,center_y:9}` created a summon token ("野兽") at (16,9);
token count 24→25. The created token is a **summon placeholder** (`item_data.type=
"summon"`, carrying spell_id/name) — the specific beast/CR/count is a player/DM
choice configured via the UI (none of the 15 summon spells carry a `monsterId`).

### Path 2 — familiar / companion (find_familiar, find_steed, beast master)
`POST /api/monster-instances/summon-companion` reads the owner character's
`subclass_choices.familiarForm` (or `beastCompanion`) and builds the creature from
`companions.json` (`categories.find_familiar.creatures`). **Verified:** set the QA
caster's `familiarForm="imp"`, called summon-companion → created MonsterInstance
**Imp (小恶魔)** at (7,10) next to the caster, `control_type="familiar"`,
`controller_character_id=485` (owner-linked), `monster_id="familiar_imp"`; token
count 25→26. This satisfies the fixtures.json acceptance
`["familiar_token_created","ownership_linked"]`.

## Why API cast alone shows "only intent"
- `SpawnSummonHandler` deliberately records intent (monster_id/count/faction/
  hp_formula) on the caster's `active_effects`; it does not create tokens.
- Materialization requires either (a) the concentration/area-placement step (map
  click → `area_effect` → concentration endpoint), or (b) the form-selection step
  (`familiarForm`/`beastCompanion` chosen → summon-companion). Both are normally
  driven by the frontend; the QA cast-API path performs neither.

## Verdict
No code change needed. Summon materialization is implemented and both paths create
correctly-linked tokens/MonsterInstances. The only nuance: conjure-style summons
land as DM-configured placeholders (since the specific creature is a player choice
not present in spell data), whereas familiars/steeds/companions build a fully-statted
MonsterInstance from companions.json. To exercise this in the browser QA, the harness
would drive the map area-placement (conjure_*) or set a familiarForm then summon
(find_familiar) rather than asserting on the bare cast.
