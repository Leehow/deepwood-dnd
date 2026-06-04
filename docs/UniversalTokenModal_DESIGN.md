# Universal Token Modal (Player & DM) — Design Document

Author: Augment Agent
Date: 2025-11-12
Status: Draft (to implement)

## Goals

Create a single, extensible modal shown when double‑clicking a character/monster token on the tactical map. It unifies player and DM experiences, replaces the legacy TokenHPEditor, integrates chat broadcasts for actions and spellcasting, and supports dice overlay prompts.

## Scope

- Trigger: Double‑click on a non‑item, non‑shop token
- Players
  - Double‑click self token: quick self status (basic params, features, weapons/actions, spells)
  - Double‑click others: collapsible panels of actions
    - Normal: greet, talk, give item, steal, encourage
    - Combat: attack, dash, disengage, dodge, hide, ready, search, use item, improvise (with input)
    - Bonus actions: pulled from CharacterSheet.actions (action_type === 'bonus_action') if available
    - Spellcasting: Enhanced spell system with full D&D 5E mechanics
- DMs
  - Double‑click any token: same as "player double‑click self" + edit HP, manage conditions, delete token, spell slot management
- Replacement
  - Replaces TokenHPEditor UI entirely (keeps the API handlers under the hood)

### Spell System Features (Phase 1 - Core)
- **Spell Slot Management**: Track and consume spell slots (1-9 level)
- **Cantrips**: Unlimited casting, damage scaling with character level
- **Prepared vs Known Spells**: Different mechanics per class
- **Spell Attack & Save DC**: Calculate based on spellcasting ability
- **Concentration Tracking**: One spell at a time, concentration checks on damage
- **Ritual Casting**: Cast without spending slots (for eligible spells/classes)

### Spell System Features (Phase 2 - Enhanced)
- **Upcasting**: Use higher level slots for stronger effects
- **Spell Components**: Track V/S/M requirements
- **Rest Recovery**: Short/Long rest spell slot recovery
- **Class-Specific Mechanics**: Warlock pact slots, wizard spellbook, etc.

### Out of scope (for now)
- Complex spell effect automation (conditions, buffs/debuffs)
- Spell targeting validation on map
- Automatic damage application to targets

## High‑Level Architecture

Frontend (Remix/React):
- New component: `frontend/app/components/map/TokenModal.tsx`
  - Uses Radix Dialog for modal shell (consistent with ItemTokenModal)
  - Internals:
    - Self/DM view: character summary sections
    - Other view: action accordions
    - Spell detail sub‑dialog
    - DM controls: HP edit + Delete
- Integration points
  - TacticalMap.client.tsx
    - Add `activeTokenId` state
    - On token double‑click: keep existing item/shop routing; otherwise open TokenModal
    - Pass props: token, isDM, userId, campaignId, selectedCharacterId
    - Pass HP/delete handlers from useMapEvents via existing setters (reusing PATCH/DELETE flows)
  - Chat broadcast — `chatService.sendMessage`
  - Dice overlay — `useDiceOverlayStore.add`
  - Character data — `characterService.getCharacterSheet`

Backend (FastAPI):
- **Existing endpoints**:
  - PATCH `/api/tokens/{id}/hp` (current_hp only)
  - DELETE `/api/tokens/{id}` (broadcasts token_removed)
  - GET `/api/characters/{id}/sheet` (features, actions, spells)

- **New endpoints for spell system**:
  - GET `/api/characters/{id}/spell-info` - Complete spellcasting information
  - POST `/api/characters/{id}/spell-slots/use` - Consume a spell slot
  - POST `/api/characters/{id}/spell-slots/rest` - Recover slots (short/long rest)
  - POST `/api/characters/{id}/prepare-spells` - Update prepared spell list
  - POST `/api/characters/{id}/concentration/check` - Concentration save
  - POST `/api/characters/{id}/concentration/end` - End concentration
  - POST `/api/campaigns/{id}/cast-spell` - Log spell cast with full details

## Data Contracts

- Token (from TacticalMapTypes)
  - `id`, `character_id?`, `monster_instance_id?`, `user_id?`, `current_hp?`, `max_hp?`, `instance_name?`, `character_name?`, `monster_name?`, `avatar?`
- CharacterSheet (from ~/types)
  - `character: Character` (includes AC, HP, class, level, spells, equipment)
  - `features: Feature[]`
  - `actions: Action[]` (includes `action_type`, `attack_bonus?`, `damage_dice?`)
- ChatMessageCreate
  - `{ content: string; recipients?: string[]; sender_role?: 'dm'|'player' }`
- DiceOverlayStore
  - `add({ request_id, issuer_user_id, issuer_role, recipients?, is_private?, check, original_message, timestamp })`

## UX Flows

1) Player double‑click self
- Modal shows summary cards: HP/AC/Level/Class, features, actions (weapons), prepared spells (if present). Clicking spell opens sub‑dialog and offers "Cast" (sends chat only).

2) Player double‑click others
- Modal shows collapsible sections: Normal, Combat, Bonus, Spellcasting (if any). Buttons send chat messages (e.g., "Alice 对 Bob 发起 攻击"). For some actions (attack, hide, steal), also create a dice overlay request for the current user.

3) DM double‑click any
- Same as (1) with additional controls: input HP and Update; Delete token. Reuse existing `handleUpdateHP`, `handleRemoveToken` by setting editingTokenId/HP before invoking.

## Permissions

- `isDM` prop determines whether edit controls are visible
- `isSelf` computed as `token.user_id === currentUserId || token.character_id === selectedCharacterId`
- Self and DM see character detail view; others see actions view

## Component Props

TokenModal Props:
- `token: Token | null`
- `isOpen: boolean`
- `onClose: () => void`
- `isDM: boolean`
- `campaignId: string`
- `currentUserId?: string`
- `selectedCharacterId?: number | null`
- `setEditingTokenId: (id: number | null) => void`
- `setEditingTokenHP: (hp: number) => void`
- `onUpdateHP: () => Promise<void>`
- `onDeleteToken: () => Promise<void>`

## Rendering Structure

- Radix Dialog root; content styled like ItemTokenModal
- Header: avatar + name (instance_name > character_name > monster_name)
- Body:
  - If self or DM → Summary tabs/sections
    - Summary (HP/AC/Level/Class)
    - Features (list)
    - Actions/Weapons (listable buttons or static list)
    - Spells (prepared first; clickable → spell sub‑dialog with details + Cast)
  - Else (other) → Action Accordions
    - Normal (buttons)
    - Combat (buttons incl. improvise with input)
    - Bonus Actions (from CharacterSheet.actions filter)
    - Spellcasting (if any spells available)
  - DM Controls (sticky bottom or separate section): HP number input + Update; Delete token

## Interactions

- Send Chat
  - Build readable CN message including actor/target/action
  - `chatService.sendMessage(campaignId, { content, sender_role: isDM ? 'dm' : 'player' })`

- Dice Overlay (opt‑in)
  - For certain actions (e.g., Attack / Hide / Steal):
    - `useDiceOverlayStore.getState().add({ request_id: 'req_'+Date.now(), issuer_user_id: currentUserId, issuer_role: isDM ? 'dm':'player', check: { kind: 'attack', target_token_id: token.id }, original_message: content, timestamp: Date.now() })`

- Spellcasting
  - Clicking a spell shows details sub‑dialog; clicking "释放" sends chat only (no slot deduction)

- HP Update (DM only)
  - `setEditingTokenId(token.id); setEditingTokenHP(newHP); await onUpdateHP();`

- Delete Token (DM only)
  - `setEditingTokenId(token.id); await onDeleteToken(); onClose();`

## Edge Cases

- Missing CharacterSheet: fallback to token fields only (name/HP)
- Token has no user_id/character_id: always actions view for players
- HP input guards: numeric >= 0; do not exceed max_hp if available (soft guard)
- Network errors: toast error; keep modal open

## Logging

- Use `createLogger('TokenModal')`
- Log fetch states, chat sends, dice overlay adds, HP updates, delete attempts

## Telemetry & Accessibility (future)

- Add aria labels to buttons
- Keyboard navigation: Escape close, Enter confirm for improvise

## Implementation Plan (Minimal‑Viable)

1. Add TokenModal.tsx with Radix Dialog; fetch CharacterSheet if token.character_id
2. In TacticalMap.client.tsx
   - Remove TokenHPEditor import & JSX usage
   - Add `activeTokenId` local state; change TokenComponent onClick to also set `activeTokenId` for non‑item/shop tokens
   - Render <TokenModal> with required props and handlers
3. Actions → chatService; optionally add dice overlay requests for selected actions
4. Spellcasting → chat broadcast only
5. Verify via TypeScript typecheck; manual UI test

## Future Enhancements

- Conditions editor (DM)
- Spell slots & resource tracking
- Attack resolution with AC comparison and auto‑damage roll
- Monster data sheet integration via `/api/monster-instances/{id}`

