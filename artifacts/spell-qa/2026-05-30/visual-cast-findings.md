# Visual Browser Cast — Findings (2026-05-30, run 2)

Driven via dw-browser-test (self-launching Chromium) with a clean `admin@deepwood.cn`
UI login on `/campaign/8/dm`. This run completed an actual spell cast through the
live UI and surfaced one real discrepancy.

## Verified: token rendering works
Clean admin session renders all 24 arena tokens (72 Konva groups) at correct grids,
matching the initiative bar. The earlier "0 tokens" report was a stale pre-reseed read
(see summary.md) — not a frontend bug.

## Verified: full visual cast flow works end-to-end
Right-click caster → context menu **施法** → spell submenu → select **火球术 (Fireball)**
→ map enters area targeting ("火球术 · 点击地图选择位置") → click cluster center to place
the 20-ft sphere → top-bar **施法** to confirm → server resolves with toast
**"QA 全法术施法者 施放 火球术 · 影响 7 个目标"**. The UI→server cast wiring is correct.

## FINDING: area-cast (map-click) applies 0 damage
Despite "影响 7 个目标", the cluster monsters' HP did not change (token + monster_instance
both still 25/25). The same spell cast via the explicit-target endpoint applies damage
correctly:

| Path | Result |
|---|---|
| Visual area cast (click map → place sphere → 施法) | resolves, "影响 7 个目标", **0 HP applied** |
| `POST /api/spells/cast` fireball, slot 3, 6 cluster token ids, forced saves=3 | **171 total damage**, cluster → 0–4 HP ✓ |

So Fireball damage itself works; the **map-targeted area-cast resolution path** reports
affected targets but does not apply damage in the DM flow. Could be a missing per-target
save/apply step, `auto_apply=false` for area casts, or a genuine bug. Spawned as a
follow-up task. Single-target casts (Fire Bolt, Sacred Flame) and healing (Cure Wounds)
all apply correctly via `/api/spells/cast`.

## Net
- Harness + token render + UI cast flow: working.
- Single-target/explicit-target damage + save + heal + determinism: validated.
- Area-cast (map-click) damage application: **open discrepancy**, follow-up task filed.
