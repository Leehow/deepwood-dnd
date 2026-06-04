This folder contains TypeScript types used by CharacterDisplay and its subcomponents.

- Character.ts: unified Character interface mirroring backend CharacterResponse
- Equipment types: captured minimally in Character.ts via EquipmentItem for now

Phase 5 plan:
1) Use Character type in CharacterDisplay props (non-breaking)
2) Introduce CharacterContext Provider to expose computed values and common actions
3) Gradually migrate sections to use useCharacterContext instead of prop drilling

