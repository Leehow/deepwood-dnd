# Rules JSON - Single Source of Truth

This directory (`app/data/rules/`) is the **only** authoritative source for rules data (spells, equipment, abilities, skills, etc.).

## Usage

All frontend code must import from here via Vite dynamic import:

```typescript
// Correct - dynamic import from data source
const module = await import('~/data/rules/spells.json');
const data = module.default;

// Wrong - do NOT fetch from public/
fetch('/rules/spells.json')  // removed
fetch('/dnd-platform/configs/rules/spells.json')  // removed
```

## Why not fetch?

Previously, copies existed in `public/rules/` and `public/dnd-platform/configs/rules/`. Editing one copy without updating the others caused data-sync bugs (e.g. missing `buffEffects`). Dynamic imports reference this single source, eliminating drift.

## Files that still use fetch

Some JSON files that only exist in `public/` (no duplicate in this directory) still use fetch:
- `core-rules.json`, `conditions.json`, `magic-items.json`, `shop-templates.json`, etc.
- `RulesPanel.tsx` uses dynamic path fetch for its browsing UI.

These are fine since they have no duplicate to fall out of sync.
