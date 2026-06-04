# DW Health Snapshot (2026-03-23 Baseline)

Generated at: `2026-03-23 15:34:12`

## Scope
- Repo: `/Users/haoli/leehow/code/dw`
- Dimensions: complexity, quality/testing, performance budget readiness, realtime boundary, repo hygiene

## Complexity
- Tracked files: `4070`
- `backend/app` Python files: `259`
- `frontend/app` TS/TSX files: `525`
- Backend route files: `50`
- Backend service files: `93`
- Route decorators: `431`
- Any-like hints in routes/services: `814`

### Hotspots (top lines)
- Backend routes:
  - `backend/app/api/routes/combat.py`: `6769` lines
  - `backend/app/api/routes/characters.py`: `6513` lines
  - `backend/app/api/routes/module_chat.py`: `3060` lines
  - `backend/app/api/routes/ai_settings.py`: `2996` lines
  - `backend/app/api/routes/tokens.py`: `2829` lines
  - `backend/app/api/routes/campaigns.py`: `2611` lines
  - `backend/app/api/routes/resource_chat.py`: `2328` lines
  - `backend/app/api/routes/modules.py`: `2203` lines
  - `backend/app/api/routes/monster_instances.py`: `2082` lines
  - `backend/app/api/routes/spell_cast.py`: `1524` lines
- Frontend components:
  - `frontend/app/components/ui/ChatPanel.tsx`: `5519` lines
  - `frontend/app/components/campaign/ModuleScriptPanel.tsx`: `4871` lines
  - `frontend/app/components/map/SelectionContextMenu.tsx`: `4862` lines
  - `frontend/app/components/map/TacticalMap.client.tsx`: `4259` lines
  - `frontend/app/components/character/CharacterPanel.tsx`: `3852` lines
  - `frontend/app/components/combat/CombatPanel.tsx`: `3325` lines
  - `frontend/app/components/character/ClassicCharacterCard.tsx`: `3319` lines
  - `frontend/app/components/ui/Rules_OtherDetails.tsx`: `2721` lines
  - `frontend/app/components/ui/Module_AIQueryTab.tsx`: `2554` lines
  - `frontend/app/components/map/TokenComponent.tsx`: `2319` lines
- Frontend routes:
  - `frontend/app/routes/campaign.$id.player.tsx`: `3357` lines
  - `frontend/app/routes/campaign.$id.dm.tsx`: `2811` lines
  - `frontend/app/routes/modules.tsx`: `2726` lines
  - `frontend/app/routes/character.tsx`: `1005` lines
  - `frontend/app/routes/_index.tsx`: `994` lines
  - `frontend/app/routes/api-settings.tsx`: `862` lines
  - `frontend/app/routes/api-usage.tsx`: `464` lines
  - `frontend/app/routes/campaign.$id.storage.tsx`: `254` lines
  - `frontend/app/routes/test-module-compare.tsx`: `233` lines
  - `frontend/app/routes/map-library.tsx`: `233` lines

## Quality And Testing
- Backend test files: `60`
- Frontend test files: `113`
- Backend test cases (`def test_`): `133`
- Frontend test cases (`it/test`): `354`
- Typed bus usage (`publish/subscribe`): `401`
- Raw event bridge usage (`dispatch/addEventListener/CustomEvent`): `132`

## Performance Budget Readiness
- Phase 3 budget smoke exists: `True`
- `apiFetch` calls: `310`
- `useQuery/useMutation` calls: `17`
- Raw `fetch` calls: `129`

## Realtime Boundary
- `realtime_publisher` usage signals: `340`
- Direct broadcast calls outside `realtime_publisher.py`: `69`

## Repo Hygiene
- Backend `print()` calls: `405`
- Frontend `console.log()` calls: `39`
- Tracked files under `backend/venv/**`: `0`
- Tracked files >= 1MB: `303`
- Tracked files >= 5MB: `2`
- Tracked files >= 10MB: `1`

## Reproduce
```bash
cd /Users/haoli/leehow/code/dw
python scripts/quality/generate_health_snapshot.py
```
