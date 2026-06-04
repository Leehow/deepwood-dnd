# Browser Visualization + Player-View QA (2026-05-31)

The original plan's main goal — browser-facing QA. Driven via dw-browser-test
(Playwright CDP) logged in as the campaign-8 DM (admin), inspecting the actual
Konva canvas + screenshots. This area is inherently serial (one Chromium + one
frontend) and frontend-dependent (rendering + player-view filtering).

## CRITICAL fixed + verified — app-wide crash

**CombatPanel crashed the entire app** (`CombatPanel.tsx:452/457/464`) whenever the
active combat-storage object had a minimal `data` lacking `participants`/`surprise`:
`data.participants.find(...)` and `cs.surprise.enabled` were guarded only by
`!combatObj`, so `undefined.find` threw → React error boundary replaced the whole
app → both `/dm` and `/player` dead (0 Konva stages). Added defensive guards
(`data?.participants`, `surprise?.enabled`). Also made the QA `start-combat` helper
seed `participants` (token_id+faction) + `surprise` so its combat object matches the
real combat-start shape. **Verified:** DM route loads with combat active — 73 token
groups render, no crash. (Note: my own wave-5 `start-combat` helper was creating the
minimal combat data that exposed this.)

## Visuals that RENDER correctly (Konva-verified + screenshots)

| Spell | Visual | Evidence |
|---|---|---|
| invisibility | token opacity 0.55 (vs 1.0 control) + condition icon | qa_invis_zoom.png |
| darkness (area conc) | dashed blue sphere overlay at center + label + attribution | qa_darkness.png |
| hex / bless (v2 runtime) | token badge (💀/✦) + label + dashed caster→target link line; caster "专注" badge | qa_hex_badge.png |
| enlarge_reduce (enlarge) | token_size 1x1→3x3, rendered ~2× larger | qa_enlarge.png |

So the core visual pipeline works: legacy active_effects-driven (invisibility,
darkness, enlarge) and v2 runtime projection (hex/bless badges + glow + link lines).

## Visual bugs found (spawned task — lower severity, cosmetic)

- **A. faerie_fire / light glow + illumination not drawn.** TokenComponent builds
  the glow filter only from `token.spell_visuals` (v2 path). faerie_fire/light use
  the legacy `active_effects[].filter` (apply_token_filter `{glow:#a78bfa,...}`) +
  `apply_illumination`, which are never merged → the purple outline / light radius
  don't render. (bless/hex glow correctly because they use spell_visuals.)
- **B. faerie_fire renders its target translucent** (opacity 0.55, looks invisible —
  the opposite of "brightly outlined"). Its buff payload carries
  `conditions:["invisible"]` (a data bug; faerie_fire should negate invisibility,
  not apply it), which TokenComponent's invisibility detector matches. Source not in
  spells.json or the effects.json toggle entry — needs live active_effects inspection.

## Player-view consistency — SETUP GAP (as anticipated)

`campaign.$id.player.tsx:1535` derives `isDM = (campaign.dm_user_id === userId)`.
The only usable identity is the campaign-8 DM (admin), so `/campaign/8/player`
renders with `isDM=true` → shows the identical full token set (no
`filterVisibleTokens`/fog hiding, because a DM sees everything), and still shows
"城主/DM" badges. Identity is correctly server-derived from `dm_user_id` (no
`?role=`/path override — transport-contract-compliant). **Truly testing player-side
token filtering / DM-only hiding requires a separate non-DM member account assigned
to a player character, which is not set up** (the auto-login user is a non-member).
Per the no-account-creation rule, this was not exercised. Recommended next step: seed
a player member + selected character into the QA campaign so `/player` renders with
`isDM=false` and the visibility filter can be verified.

## Net
The visual pipeline largely works (invisibility, zone overlays, v2 badges/glow/links,
size changes all render). Fixed a critical app-wide crash exposed by malformed combat
data. Two cosmetic visual bugs (legacy glow path, faerie_fire translucency) spawned.
Player-view filtering needs a player-account fixture to test properly.
