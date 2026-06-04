# English-Canonical i18n Migration

Work ID: `i18n-english-canonical`
Status: `In Progress`
Last updated: `2026-05-27`

## Goal

Make Deepwood English-canonical while keeping Chinese as a first-class locale.
New users should default to `en-US`; existing Chinese users should stay on
`zh-CN` through an explicit preference/backfill path. The migration must avoid
a flag-day rewrite by introducing locale infrastructure and compatibility
helpers before flipping rule-data field semantics.

## Decisions

- Product baseline is `en-US`; `zh-CN` is the first localized overlay.
- Built-in rules/data should eventually use English canonical fields with
  Chinese stored under a locale overlay.
- Existing user-generated content, chat, campaign notes, and imported modules
  are not automatically rewritten.
- Locale preference should use existing `users.preferences` JSONB; no new
  database column is planned for the initial implementation.
- Implementation goes through Team Lead worker dispatch; Codex lead owns this
  ledger and final review.

## Items

| Item | Status | Note |
|---|---|---|
| UI architecture investigation | Done | `.tmp/team-lead/worker-i18n-ui-20260527.md` |
| Data canonicalization investigation | Done | `.tmp/team-lead/worker-i18n-data-20260527.md` |
| Backend / AI locale investigation | Done | `.tmp/team-lead/worker-i18n-backend-20260527.md` |
| Frontend i18n foundation | Done | `frontend/app/i18n/` foundation, i18next/react-i18next/language detector, `en-US` default, `zh-CN` support, login/home/root migration, visible switchers. `i18next-http-backend` deferred because resources are static-imported for this small first slice. |
| Backend locale context foundation | Done | Resolver primitives, q-value-aware `Accept-Language`, `DEFAULT_LOCALE`, `users.preferences.locale` sanitization, typed `LocaleContext`, FastAPI helper, and WebSocket handshake propagation landed. |
| Rule-data localized helper layer | Done | Added `getLocalizedName`, `getLocalizedDescription`, and `getLocalizedField` compatibility helpers for legacy bilingual fields and future `locales` overlays. |
| Rule-data consumer slice: spell cards | Done | `SpellSelectableCard`, `SpellCard`, `SpellCardFull`, and the spell detail modal now route spell names/descriptions, icon alt text, and description TTS through locale-aware helpers for `en-US` / `zh-CN`. Covered by `frontend/tests/components/SpellCardLocalized.test.tsx`. |
| Spell-card static chrome | Done | `.tmp/team-lead/worker-i18n-spell-card-static-chrome-20260527.md`; localized card badges, top metadata labels, description headings/TTS title, save-effect half suffix, class header, and spellbook chrome through `common.spellCard.*`. |
| Spell-card rule/effect term dictionaries | Done | `.tmp/team-lead/worker-i18n-spell-term-dictionaries-20260527.md`; localized spell level/school/damage/save/area/class/creature/trigger/effect primitive/phase-condition helpers, detail tooltip, and representative tests. Post-review revision restored backward-compatible exports in `spell-constants.ts`. |
| Spell-card remaining combat chrome / status-effect terms | Done | `.tmp/team-lead/worker-i18n-spell-residual-chrome-status-20260527.md`; localized residual `SpellCardFull.tsx` combat/effect chrome, area unit suffixes, zone/cast-option/scaling/duration labels, and made status/buff helpers locale-aware while preserving zh-CN defaults. |
| StatusEffectsDialog locale wiring | Done | `.tmp/team-lead/worker-i18n-status-effects-dialog-locale-20260527.md` + `.tmp/team-lead/worker-i18n-status-effects-dialog-locale-q1-20260527.md`; dialog chrome, durations, condition/removal text, custom effects, incoming spell buffs, and applied-condition/break-condition details now use locale-aware `common.statusEffectsDialog.*` keys while preserving raw user-provided names/descriptions. |
| Error envelope and backend prompt templates | Partial | `.tmp/team-lead/worker-i18n-backend-errors-prompts-20260527.md` + `.tmp/team-lead/worker-i18n-backend-errors-prompts-q1-20260527.md`; `AppError` envelope scaffold is registered, `ai_prompts` base/rules/chat builders exist, and `rules_chat` / websocket AI chat are prompt-locale pilots. No route raises `AppError` yet, frontend error-code rendering is not wired, and larger prompt surfaces (`module_chat`, `resource_chat`, character generation) remain for later slices. |
| Rule-data English backfill | Deferred | Requires copyright/product decisions and SRD/homebrew split. |

## Validation evidence

- Investigation handoffs:
  - `.tmp/team-lead/worker-i18n-ui-20260527.md`
  - `.tmp/team-lead/worker-i18n-data-20260527.md`
  - `.tmp/team-lead/worker-i18n-backend-20260527.md`
- Frontend foundation:
  - `.tmp/team-lead/worker-i18n-frontend-foundation-finish-20260527.md`
  - Lead rerun: `cd frontend && npm run typecheck` reports 7 pre-existing unrelated errors, with 0 i18n/root/login/_index scoped errors.
  - Lead rerun: `rg -n '[\p{Han}]' frontend/app/i18n/locales/en-US` returns 0 hits.
- Backend resolver / preferences:
  - `.tmp/team-lead/worker-i18n-backend-locale-context-20260527.md`
  - `.tmp/team-lead/worker-i18n-backend-locale-q0-revision-20260527.md`
  - Lead rerun: `cd backend && python -m py_compile app/core/locale.py app/core/config.py app/api/routes/users.py && PYTHONPATH=. pytest --noconftest tests/unit/test_locale_context.py -v` passes with 54 tests.
- Backend request / WebSocket context:
  - `.tmp/team-lead/worker-i18n-backend-locale-context-propagation-20260527.md`
  - Lead rerun: `cd backend && python -m py_compile app/core/locale.py app/core/dependencies.py app/api/routes/websocket_simplified.py app/services/websocket_manager.py && PYTHONPATH=. pytest --noconftest tests/unit/test_locale_context.py tests/unit/test_locale_dependencies.py tests/unit/test_websocket_manager_locale.py -v` passes with 80 tests.
- Rule-data localized helper layer:
  - `.tmp/team-lead/worker-i18n-rule-data-localized-helper-20260527.md`
  - Lead rerun: `cd frontend && npx vitest run app/utils/i18n/__tests__/localizedData.test.ts` passes with 20 tests.
  - Lead rerun: `cd frontend && npm run typecheck` still reports 7 pre-existing unrelated errors, with 0 `app/utils/i18n/localizedData.ts` or `app/utils/i18n/__tests__/localizedData.test.ts` scoped errors.
- Rule-data consumer slice: spell cards:
  - `.tmp/team-lead/worker-i18n-rule-data-consumer-spell-card-20260527.md`
  - `.tmp/team-lead/worker-i18n-rule-data-consumer-spell-card-q1-finish-20260527.md`
  - Lead rerun: `cd frontend && npx vitest run tests/components/SpellCardLocalized.test.tsx` passes with 12 tests.
  - Lead rerun: `cd frontend && npm run typecheck` still reports 7 pre-existing unrelated errors, with 0 spell-card consumer scoped errors.
- Spell-card static chrome:
  - `.tmp/team-lead/worker-i18n-spell-card-static-chrome-20260527.md`
  - Lead rerun: `cd frontend && npx vitest run tests/components/SpellCardLocalized.test.tsx` passes with 12 tests.
  - Lead rerun: `cd frontend && npm run typecheck` still reports the 7 pre-existing unrelated errors in `CuttingWordsPrompt.tsx`, `useMapBonusActionRoutingController.test.ts`, and `persistentFeatureMiddleware.test.ts`, with 0 scoped errors in the spell-card/i18n files.
  - Lead rerun: `rg -n '[\p{Han}]' frontend/app/i18n/locales/en-US/common.json` returns 0 hits.
- Spell-card rule/effect term dictionaries:
  - `.tmp/team-lead/worker-i18n-spell-term-dictionaries-20260527.md`
  - Lead review caught a backward-compatibility export regression in `spell-constants.ts`; worker revision restored `getSpellDataById`, `spellHasIllusionSubtype`, `getSpellCastOptionByKey`, and `getSpellModifierEffects`.
  - Lead rerun: `cd frontend && npx vitest run tests/components/SpellCardLocalized.test.tsx` passes with 17 tests.
  - Lead rerun: `rg -n "^(export )?function (getSpellDataById|spellHasIllusionSubtype|getSpellCastOptionByKey|getSpellModifierEffects)\b" frontend/app/components/spell/spell-constants.ts` confirms all four compatibility exports.
  - Lead rerun: `rg -n '[\p{Han}]' frontend/app/i18n/locales/en-US/common.json` returns 0 hits.
  - Lead rerun: `cd frontend && npm run typecheck` still reports the same 7 pre-existing unrelated errors, with 0 scoped errors in the spell-card/i18n files.
- Spell-card remaining combat chrome / status-effect terms:
  - `.tmp/team-lead/worker-i18n-spell-residual-chrome-status-20260527.md`
  - Lead rerun: `cd frontend && npx vitest run tests/components/SpellCardLocalized.test.tsx tests/components/SpellCardTermI18n.test.tsx` passes with 35 tests.
  - Lead rerun: `rg -n "^(export )?function (getSpellDataById|spellHasIllusionSubtype|getSpellCastOptionByKey|getSpellModifierEffects)\b" frontend/app/components/spell/spell-constants.ts` confirms all four compatibility exports.
  - Lead rerun: `rg -n '[\p{Han}]' frontend/app/i18n/locales/en-US/common.json` returns 0 hits.
  - Lead rerun: `cd frontend && npm run typecheck` still reports the same 7 pre-existing unrelated errors, with 0 scoped errors in `SpellCardFull.tsx`, `spell-constants.ts`, locale JSON, or focused tests.
- StatusEffectsDialog locale wiring:
  - `.tmp/team-lead/worker-i18n-status-effects-dialog-locale-20260527.md`
  - `.tmp/team-lead/worker-i18n-status-effects-dialog-locale-q1-20260527.md`
  - Lead rerun: `cd frontend && npx vitest run tests/hooks/statusEffectsDialog.test.tsx tests/hooks/mapStatusDialogs.test.tsx tests/components/StatusEffectsDialogI18n.test.tsx` passes with 10 tests.
  - Lead review caught and worker revision fixed an English applied-condition separator issue and moved break-condition copy into locale keys.
  - Lead rerun: `rg -n '[\p{Han}]' frontend/app/i18n/locales/en-US/common.json` returns 0 hits.
  - Lead rerun: `node -e "for (const f of ['frontend/app/i18n/locales/en-US/common.json','frontend/app/i18n/locales/zh-CN/common.json']) JSON.parse(require('fs').readFileSync(f,'utf8')); console.log('json ok')"` prints `json ok`.
  - Lead rerun: `cd frontend && npm run typecheck` still reports the same 7 pre-existing unrelated errors, with 0 scoped errors in `StatusEffectsDialog.tsx`, locale JSON, or focused status-dialog tests.
- Backend error envelope / prompt-template scaffold:
  - `.tmp/team-lead/worker-i18n-backend-errors-prompts-20260527.md`
  - `.tmp/team-lead/worker-i18n-backend-errors-prompts-q1-20260527.md`
  - Lead review caught an accidental `rules_chat.py` auth/API contract change; worker revision restored the existing `user_id: str = Query(...)` contract while preserving locale prompt wiring.
  - Lead rerun: `cd backend && python -m py_compile app/core/errors.py app/main.py app/services/ai_prompts/__init__.py app/services/ai_prompts/base.py app/services/ai_prompts/rules.py app/services/ai_prompts/chat.py app/api/routes/rules_chat.py app/services/websocket_handlers/chat_handler.py` passes.
  - Lead rerun: `cd backend && PYTHONPATH=. pytest --noconftest tests/unit/test_app_error.py tests/unit/test_ai_prompt_templates.py -v` passes with 31 tests.
  - Lead rerun: `cd backend && PYTHONPATH=. pytest --noconftest tests/unit/test_locale_context.py tests/unit/test_locale_dependencies.py -v` passes with 74 tests.
  - Lead rerun: `rg -n '请用简洁中文回答|使用中文回答' backend/app/api/routes/rules_chat.py backend/app/services/websocket_handlers/chat_handler.py` returns 0 hits.
  - Lead rerun: `rg -n 'require_auth|resolve_campaign_member_context' backend/app/api/routes/rules_chat.py` returns 0 hits.

## Blockers

- none for Phase 0/1 foundation.

## Next action

Dispatch the first `AppError` producer / frontend error-code rendering pilot.
Keep it to one narrow user-visible route family, preserve existing API
contracts, and add locale-keyed frontend fallback strings before broader route
migration.
