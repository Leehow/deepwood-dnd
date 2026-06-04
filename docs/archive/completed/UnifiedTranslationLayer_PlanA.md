# Unified Translation Layer (Plan A) — Implementation Guide

Author: Augment Agent

## 1. Goals & Principles
- One source of truth: All UI uses a unified term dictionary API (no scattered hard-coded maps).
- Reuse existing Chinese: Load only existing rule JSONs; no AI translation, no new terms.
- Context-aware fix: Spell school "Enchantment" displays as "惑控"; do not alter non-school usages like "附魔学派" or natural language phrases like "破除附魔".
- Silent fallback: If a term is missing, return the original value. No warnings, no highlighting.

## 2. Coverage & Data Sources (Frontend JSON)
- core-rules.json — damageTypes (flattened into id→name)
- equipment.json — weaponProperties; currency labels
- conditions.json — conditions (blinded, charmed, frightened, etc.)
- spells.json — schools (only the small schools section is needed for the dictionary)
- abilities.json, skills.json — ability and skill names
- creatures.json — sizes and creature types
- classes.json — only for subclass names (e.g., "附魔学派"); do not use for school label

Note: Large JSON blocks (like full spells list) are not required for translation; only the small metadata sections are needed.

## 3. Special Context Rule: 附魔 vs 惑控
- Show "惑控" only when category is spell school and id is `enchantment`.
- Keep other contexts unchanged: e.g., subclass name "附魔学派", and natural-language strings like "破除附魔".

## 4. Module Layout & Load Strategy
- Suggested location: `frontend/app/utils/i18n/dictionary.ts` (or `frontend/app/lib/i18n`).
- Load timing: Initialize once at app start (e.g., Remix root loader) and cache in memory.
- Performance:
  - Avoid loading full `spells.json` just for schools. Prefer a new lightweight file: `frontend/public/rules-meta/spell_schools.json` containing only the schools array.
  - Browser/HTTP caching handles client-side performance; no backend/Redis changes required.

## 5. Dictionary Build
- Flatten `core-rules.json.damageTypes` to `{ id → name }` (e.g., `piercing→穿刺`, `thunder→雷鸣`).
- Read `equipment.json.weaponProperties` → `{ id → name }` (e.g., `finesse→灵巧`).
- Read `conditions.json` → `{ id → name }` (e.g., `blinded→目盲`).
- Read `rules-meta/spell_schools.json` (or `spells.json` schools) → `{ id → name }` and rewrite `enchantment→惑控`.
- Read abilities/skills/sizes/creature types/currency/etc. similarly.
- Maintain a tiny complement table only for IDs not present in rule JSON (e.g., `light_armor`) in a single place.

## 6. Public API (Example)
- `translate(category: string, id: string): string`
- Semantic wrappers:
  - `tDamageType(id)`, `tWeaponProperty(id)`, `tCondition(id)`, `tSchool(id)`, `tAlignment(id)`, `tSize(id)`, `tCreatureType(id)`, `tCurrency(code)`, `tProficiency(id)`, `tAbility(id)`, `tSkill(id)`
- Fallback: Return `id` when missing (no warnings/highlights).

## 7. Integration Plan (Minimal, high impact first)
1) Implement dictionary module + unit tests.
2) Replace high-visibility displays:
   - Inventory/Item detail modal: damage type, properties, categories → unified functions.
   - Character creation/equipment pages: replace hard-coded 3-type ternary with `tDamageType`.
   - Shop/Library item cards and modals: badges/tags via dictionary.
   - Spell components that show school: use `tSchool` (enchantment → 惑控).
3) Consolidate scattered maps (utils.ts, Step6ReviewFinalize, formatting.ts) into the dictionary and remove duplicates.

## 8. Meta File & Data Correction
- Add `frontend/public/rules-meta/spell_schools.json` with only the eight schools (smaller payload). Ensure `enchantment` is `name: 惑控`.
- Correct source data (school section only) to keep repo consistent:
  - `frontend/public/rules/spells.json`
  - `frontend/app/data/rules/spells.json`
  - `dnd-platform/configs/rules/spells.json`
  - Change only within `schools` array: `name: 附魔 → 惑控`, and description to `惑控法术影响他人心智`.
  - Do NOT change `classes.json` where `name: 附魔学派`.

## 9. Testing
- Unit tests (`frontend/app/utils/i18n/__tests__`):
  - `tDamageType('piercing') === '穿刺'`, `tWeaponProperty('finesse') === '灵巧'`.
  - `tSchool('enchantment') === '惑控'`.
  - Subclass names and natural-language strings unchanged.
  - Fallback returns original value.
- E2E (Playwright):
  - Inventory item detail shows `类型：穿刺` instead of `piercing`.
  - Spell UI shows school `惑控`.
  - Character creation equipment page shows Chinese labels consistently.

## 10. Risk & Rollback
- Low risk. Pure-frontend change with in-memory cache. No backend coupling.
- On failure to initialize dictionary, wrappers return original values, pages continue to render.

## 11. Delivery Checklist
- [ ] `dictionary.ts` module with loaders and APIs
- [ ] `rules-meta/spell_schools.json` created
- [ ] Three `spells.json` school entries corrected (附魔 → 惑控)
- [ ] High-impact components switched to dictionary
- [ ] Unit + E2E tests updated/added

## 12. Notes
- Future: If moving translations server-side, expose a rules-dictionary API and keep the same wrapper interface on the client.

