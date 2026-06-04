# Konva browser-driver snippets (Claude-in-Chrome)

Grid: 40px/cell. Token layer is a draggable Group layer. Inject these via the
Claude-in-Chrome `javascript_tool` (or the `dw-browser-test` skill's `run.js`)
on a `/campaign/<id>/dm` page where `window.Konva.stages[0]` exists.

## List tokens with absolute screen positions
```js
const stage = window.Konva.stages[0];
const layer = stage.getLayers().find(l => l.children.some(c => c.draggable && c.draggable()));
layer.children.map((g, i) => ({
  i, x: Math.round(g.getAbsolutePosition().x), y: Math.round(g.getAbsolutePosition().y),
}));
```

## Select a token by grid position (fire click on the nearest group)
```js
function fireClickAtGrid(gx, gy) {
  const stage = window.Konva.stages[0];
  const scale = stage.scaleX();
  const want = { x: stage.x() + gx * 40 * scale, y: stage.y() + gy * 40 * scale };
  const layer = stage.getLayers().find(l => l.children.some(c => c.draggable && c.draggable()));
  let best = null, bestD = 1e9;
  for (const g of layer.children) {
    const p = g.getAbsolutePosition();
    const d = Math.hypot(p.x - want.x, p.y - want.y);
    if (d < bestD) { bestD = d; best = g; }
  }
  best.fire('click', { evt: new MouseEvent('click') });
  return bestD; // distance in px; large value => no token near that grid cell
}
```

## Screen point for an area-spell target (grid center)
```js
function gridToScreen(gx, gy) {
  const s = window.Konva.stages[0]; const k = s.scaleX();
  return { x: s.x() + (gx + 0.5) * 40 * k, y: s.y() + (gy + 0.5) * 40 * k };
}
```
Use the returned `{x,y}` with the MCP click tool to place an area template.

## Seeded grid coordinates (from arena_constants.py)
| Actor / monster | grid |
|---|---|
| qa_all_spells_caster | (6,10) |
| normal_target_a / _b | (10,8) / (11,8) |
| low_ac_target / high_ac_target | (10,9) / (11,9) |
| low_save_target / high_save_target | (10,10) / (11,10) |
| fire_resistant_target / poison_immune_target | (10,11) / (11,11) |
| undead_target / construct_target | (12,8) / (12,9) |
| condition_immune_target / mobile_target | (12,10) / (14,10) |
| cluster_targets_1..6 | (16,8)…(18,9) |
