# Class / Level-Up QA — Browser Smoke Checklist

The pytest harness (`backend/tests/qa_classes/`) covers the **backend** level-up/create
contract thoroughly (131+ tests). This thin browser layer covers what the API layer
cannot see: the **level-up wizard UI** — does it present the right choices at each level,
validate them, and submit correctly?

Run manually (or drive via the `dw-browser-test` skill) against a dev server
(`./dev-start.sh`, frontend :5174). Pick a character of each class below, open the
**level-up** flow, and check the items. Record PASS / FAIL / NEEDS_RULES_DECISION per row.

## Representative classes (one per choice-shape)

### 1. Cleric — prepared caster (subclass at L1, spell prep)
- [ ] At creation, the wizard offers a **divine domain** choice; picking one persists.
- [ ] Level-up to a slot-gaining level re-opens **prepared-spells** selection; the prepared
      count matches WIS mod + cleric level.
- [ ] Channel Divinity uses shown on the sheet scale correctly (1 → 2 at L6).

### 2. Fighter / Battle Master — option-heavy (fighting style L1, subclass L3, maneuvers)
- [ ] L1 wizard offers the **6 fighting styles**; the chosen one shows on the sheet.
- [ ] L3 offers the **Martial Archetype** subclass; picking Battle Master then offers
      **maneuvers** (Superiority Dice). Selected maneuvers persist to `maneuvers_known`.
- [ ] The backend now ignores a fighting_style submitted at a level that doesn't grant one
      (bug #2 fix). The UI should still NOT let you pick the **same fighting style twice** at
      an offered choice (e.g. Champion's L10 second style) — the backend does not yet de-dupe
      that single-field case, so the *frontend* remains the guard for duplicates.
- [ ] L4 ASI step: choosing **+2 to one ability** caps at **20** (bug #4 fixed backend-side;
      confirm the UI agrees and doesn't show 21).

### 3. Warlock — invocations + pact boon (subclass L1, nested pact)
- [ ] L2 offers **eldritch invocations**; only those whose prerequisites are met are
      selectable; chosen ones persist to `eldritch_invocations`.
- [ ] L3 offers the **Pact Boon** (chain / blade / tome); the choice persists (it lands
      nested under `subclass_choices.pactBoon`).

### 4. Sorcerer — metamagic
- [ ] L3 offers **Metamagic** options.
- [ ] Selecting metamagic persists (bug #3 **fixed** — now stored in
      `subclass_choices.metamagic`). Confirm the chosen metamagic survives a reload.

## What to watch for (all classes)
- No console error / no backend 500 during the level-up submit.
- The sheet (HP, slots, resources, AC) updates after level-up. Note: **current HP does
  not auto-bump to the new max on level-up** (by design — not a bug).
- Multiclassing in the UI: HP gain for a secondary class's first level uses the **average**
  (bug #1 fixed backend-side) — confirm the displayed HP matches.

## Known backend findings the harness already pins (don't re-file as new)
| # | Finding | Status |
|---|---|---|
| 1 | Multiclass first-level HP gave max die to every class | **Fixed** (5e RAW: only the 1st char level) |
| 2 | Level-up applied a fighting_style at levels that don't grant one | **Fixed** (gated by `_fighting_style_offered_at`; not-offered → ignored) |
| 3 | Metamagic had no backend storage (silently dropped) | **Fixed** (→ `subclass_choices.metamagic`) |
| 4 | ASI path had no +20 cap | **Fixed** (caps at 20) |
