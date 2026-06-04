# CharacterDisplay.tsx Functional Decomposition Refactor Plan

Status: APPROVED (by request)
Owner: Frontend
Applies to: `frontend/app/components/character/CharacterDisplay.tsx`

## 1. Goals & Non‑Goals

- Preserve 100% functionality and behavior parity at every step.
- Reduce size and complexity via functional decomposition: utils → hooks → sections.
- Improve testability and maintainability; clearer state ownership; fewer side effects in UI.
- Do NOT change APIs, routes, or domain behavior; no UX redesign.
- File size limit is flexible per request (not strictly <400 lines); split by cohesive functionality.

## 2. Current Responsibilities (high level)

- Data imports from rules JSON (races, classes, backgrounds, skills, equipment, spells)
- Derived character data: racial bonuses, final ability scores, ability modifiers
- Proficiencies and expertise computation (weapon/armor/tool; skills)
- AC/HP calculation including special class rules (monk/barbarian, fighting style, shield)
- Spellcasting (known, cantrips, prepared, prepared limits by class)
- Equipment system (slots, bag, split, merge, discard to map, pack organization)
- Currency editing and persistence
- Avatar (AI generation and manual upload)
- Map token checks/placement + custom events
- UI/UX with Radix Dialog/Collapsible; local toast queue

## 3. Target Architecture (after split)

Directory (new): `frontend/app/components/character/CharacterDisplay/`

- CharacterDisplay.tsx (thin container composer)
- context/
  - CharacterContext.tsx (optional; provides computed values + actions)
- hooks/
  - useToast.ts
  - useCharacterComputed.ts
  - useEquipment.ts
  - useSpells.ts
  - useCurrency.ts
  - useMapToken.ts
  - useAvatar.ts
  - usePacks.ts
- utils/
  - ability.ts (getModifier, abilityModNumber)
  - rules.ts (findArmorMetaById, findWeaponMetaById, findAnyMetaById, getIconPath)
  - equipment.ts (getEquipmentSummary, getArmorSummary, getWeaponSummary, getArmorACDisplay)
  - spellcasting.ts (isSpellcaster, isPreparedCaster, preparedMax calculation)
  - proficiency.ts (getCharacterWeaponArmorProfs, isProficientWithWeaponId, isProficientWithArmorId)
  - formatting.ts (formatProficiency, formatFightingStyle, formatMetamagic, formatEldritchInvocation, ranger/terrain formatters)
  - constants.ts (CN label maps, ID maps, static dictionaries)
- sections/
  - HeaderBar.tsx (avatar actions + basic info + place token)
  - AbilityScores.tsx
  - SkillsPanel.tsx
  - ProficienciesPanel.tsx
  - Equipment/
    - EquipmentPanel.tsx
    - EquipDialog.tsx
    - BagModal.tsx
    - ItemDetailModal.tsx
  - Spells/
    - SpellsPanel.tsx
    - SpellDialog.tsx
  - Currency/CurrencyDialog.tsx
  - Info/
    - RaceInfoDialog.tsx
    - ClassInfoDialog.tsx
    - BackgroundInfoDialog.tsx
    - ProficiencyHelpDialog.tsx
  - Personality.tsx
  - Appearance.tsx
  - ClassFeatures.tsx
- types.ts (Character, EquipmentItem, Currency, SpellLite, Hook return types)

Note: Keep `~/data/rules/*.json` import points unchanged; utils/rules only wraps lookup helpers.

## 4. Mapping (from current monolith → target modules)

- CN mapping and formatters → utils/constants.ts + utils/formatting.ts
- Skill and ability helpers → utils/ability.ts, utils/formatting.ts
- Rules/equipment lookup (find*MetaById, getIconPath) → utils/rules.ts
- Equipment summaries (weapon/armor/gear) + AC display → utils/equipment.ts
- Proficiency resolution (race/class/subclass traits) → utils/proficiency.ts
- Spellcasting predicates & preparedMax calc → utils/spellcasting.ts
- AC/HP calculation → utils/equipment.ts (AC), utils/ability.ts (HP if preferred)
- Derived sets (selected skills/proficiencies/expertise) → useCharacterComputed.ts (expose as computed values)
- Persist PATCH `/api/characters/:id` → centralize in hooks (useEquipment/useSpells/useCurrency)
- Map token placement/checks, custom events → useMapToken.ts
- Avatar generation/upload → useAvatar.ts
- Toast queue → useToast.ts
- UI
  - Collapsible/Dialog sections → sections/* (split by area)
  - Equipment and bag UIs → sections/Equipment/*
  - Spells UIs → sections/Spells/*

## 5. Hook APIs (proposed)

- useToast()
  - state: toasts
  - actions: showToast(message, type)
- useCharacterComputed(character)
  - returns: finalAbilityScores, abilityMods, proficiencyBonus, proficientSet, expertiseSet, calcSkillMod(skillId), isSpellcaster, isPreparedCaster, preparedMax, calculateAC(), calculateHP()
- useEquipment({ character, onPersist, currentMapUrl, campaignId, userId })
  - state: equipmentLocal, dialogs: equipDialogOpen/Slot, bagOpen, itemDetailOpen, selectedItem
  - actions: openEquip(slot), applyEquip(item), splitStack(qty), mergeStacks(), discardItem(quantity)
- useSpells({ character, onPersist })
  - state: preparedLocal, preparedCount, preparedMax
  - actions: togglePreparedSpell(id), togglePreparedWithLimit(id)
- useCurrency({ character, onPersist })
  - state: currencyLocal, currencyDialogOpen
  - actions: setCurrencyLocal, open/close dialog, persist
- useMapToken({ character, campaignId, currentMapUrl, userId })
  - state: hasTokenOnMap, currentTokenId, placeLoading, placeSuccess
  - actions: checkToken(), handlePlaceToken()
- useAvatar({ character, userId, onAvatarUpdated })
  - state: genLoading, avatarModalOpen, avatarLibrary
  - actions: handleGenerateAvatar(), handleUploadAvatar()
- usePacks({ setOrganizedPacks })
  - state: organizeLoading, organizedPacks
  - actions: handleOrganizePack(pack), handleExtractFromPack(item)

All hooks accept `onPersist` to reuse `PATCH /api/characters/:id` logic in a single place if desired.

## 6. Step‑by‑Step Plan (non‑breaking)

Phase 1: Extract pure utils + constants

- Move formatter maps, formatXxx, ability helpers, rules/equipment lookups, summaries, AC/HP calc into utils/*.
- Keep function names/signatures 1:1; import from utils in CharacterDisplay.tsx.
- Verify TS builds and UI parity.

Phase 2: Extract hooks (state + side effects)

- Implement useToast, then useCharacterComputed (no network), then useEquipment/useSpells/useCurrency/useMapToken/useAvatar/usePacks.
- Replace inline logic with hooks; no UI moves yet.

Phase 3: Split UI components — Equipment subtree first

- sections/Equipment/* with props calling hook actions.
- Keep dialogs and modals behavior identical.

Phase 4: Split remaining UI — Spells, Currency, Info dialogs, Proficiencies, Personality, Appearance, ClassFeatures

- Move panels one by one, wire via props or CharacterContext.

Phase 5: Optional context + types hardening

- Introduce CharacterContext to reduce prop drilling.
- Consolidate types to `types.ts` with snake_case/camelCase compatibility.

## 7. Acceptance Criteria (per phase)

- Phase 1: All computations return same values given same `character` & rules data.
- Phase 2: All existing interactions (equip/apply/split/merge/discard, spells prepare/limit, currency persist, avatar ops, token place) work as before.
- Phase 3–4: Visual and behavioral parity; no new warnings/errors; dialogs open/close exactly as before.
- No missing features reported in prior regressions (notably: prepared limit, unarmored defense, shield exception for monk, pack organization, map events).

## 8. Test Plan

Unit tests (utils):

- ability: getModifier, abilityModNumber, HP calc
- equipment: AC calc across armor types; shield/monk/barbarian/fighting style cases; summaries
- spellcasting: preparedMax by class/level/ability; cantrip rules
- proficiency: set resolution across race/subrace/class/subclass traits
- rules: meta lookups and icon path fallback

E2E (Playwright):

- Equip/unequip/swap slots; bag split/merge; discard to map (token created near character)
- Spells: toggle prepared, enforce limit, cantrips unaffected
- Currency: edit and persist round‑trip
- Avatar: AI generate and manual upload (success + failure)
- Map: place token near viewport center fallback; custom events fired/received

Logging requirement: print full logs in terminal during tests; avoid hidden tail/sleep patterns.

## 9. Risks & Mitigations

- Type drift between snake_case/camelCase: provide dual‑field compatibility in selectors; normalize in hooks.
- Side effects order: preserve event listeners and cleanup; keep fetch endpoints/headers identical.
- Hidden coupling in UI state: migrate feature by feature; verify each dialog behavior before moving on.
- No AI fallback/rollback logic without explicit approval (per repo rules).
- Ensure virtualenv when running backend tests (asyncpg errors ⇒ wrong env).

## 10. Rollback Strategy

- Each phase lands in small commits. If regression appears, revert the last commit only.
- Keep old function signatures; wrapper shims available during transition.

## 11. Timeline (estimate)

- Phase 1: 1–2h
- Phase 2: 2–3h
- Phase 3: 3–4h
- Phase 4: 2–3h
- Phase 5: 1–2h

## 12. Ownership & Review

- Changes owned by frontend developer(s).
- Review focus: behavior parity, hook boundaries, test coverage.

## 13. Change Log (fill during execution)

- [x] Phase 1 completed — date: 2025-11-10 — notes: utils extracted, AC/HP calc moved, formatters centralized
- [x] Phase 2 completed — date: 2025-11-10 — notes: hooks created (useToast, useCharacterComputed, useEquipment, useSpells, useCurrency, useMapToken, useAvatar)
- [x] Phase 3 completed — date: 2025-11-10 — notes: Equipment subtree split (Panel/Dialog/Bag/ItemDetail)
- [x] Phase 4 completed — date: 2025-11-10 — notes: Spells, Currency, Info, Skills, Appearance, Personality, Backstory panels modularized
- [x] Phase 5 completed — date: 2025-11-10 — notes: Types hardened across hooks/context; removed any; unified EquipSlot; persistCharacterPartial typed

## 14. Post‑Phase Cleanup: Type hardening & dedup (Completed)

- Centralized abilityLabelMap and all CN formatters into utils/formatting.ts; removed duplicates from CharacterDisplay and sections.
- Migrated abilityLabelMap from props to internal imports in SkillsSection, ClassInfoDialog, RaceInfoDialog, ClassFeaturesDialog.
- Added favoredTerrainMap.hill → "丘陵" for consistency.
- Tightened types across hooks and sections: useEquipment, useCurrency, SpellsDialog, Equipment/*, Info/*, ItemDetailModal.
- Removed unused imports and orphaned comments in CharacterDisplay.tsx; reduced file from ~3300 → ~780 lines.
- Unified spellcasting ability resolution via utils/spellcasting.spellcastingAbilityMap.
- BackgroundInfoDialog now resolves skill names internally (imports skills.json) eliminating allSkills prop drilling.
- Build verification after each step: front-end and SSR succeeded with no TS errors.
