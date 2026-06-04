# D&D 5E SRD Reference Data

Source: [5e-bits/5e-database](https://github.com/5e-bits/5e-database) (v4.3.3)

License: see `LICENSE.md` (OGL 1.0a + MIT)

## Purpose

This is the **official SRD (System Reference Document)** data from the D&D 5E API project.
It serves as a **reference source** for our project — we do NOT load these files at runtime.

Use cases:
- Cross-reference our `dnd-platform/configs/rules/` data against SRD originals
- Look up exact English descriptions, saving throw types, damage values
- Verify class/subclass features when adding new content
- Copy data structures when implementing new classes or features

## File List

| File | Content | Records |
|------|---------|---------|
| `5e-SRD-Classes.json` | 12 classes with features, proficiencies, spellcasting | 12 |
| `5e-SRD-Subclasses.json` | All SRD subclasses with spells and features | ~12 |
| `5e-SRD-Features.json` | All class/subclass features with full desc | ~400 |
| `5e-SRD-Levels.json` | Level progression tables per class | 240 |
| `5e-SRD-Spells.json` | Spells with full mechanics | ~320 |
| `5e-SRD-Monsters.json` | Monster stat blocks | ~330 |
| `5e-SRD-Equipment.json` | Weapons, armor, gear, tools | ~230 |
| `5e-SRD-Magic-Items.json` | Magic items with descriptions | ~360 |
| `5e-SRD-Races.json` | Races with traits and ability bonuses | 9 |
| `5e-SRD-Subraces.json` | Subraces | ~4 |
| `5e-SRD-Traits.json` | Racial traits | ~40 |
| `5e-SRD-Conditions.json` | Status conditions | 15 |
| `5e-SRD-Skills.json` | Skills | 18 |
| `5e-SRD-Backgrounds.json` | Character backgrounds | ~1 |
| `5e-SRD-Feats.json` | Feats (SRD only has Grappler) | 1 |
| `5e-SRD-Others` | Ability Scores, Alignments, Damage Types, Languages, Magic Schools, Proficiencies, Rules, Weapon Properties | misc |

## Notes

- SRD only includes **one subclass per class** (e.g. Open Hand for Monk, but not Shadow or Four Elements)
- SRD only includes the **Grappler** feat — all PHB feats are Product Identity
- Our project uses full PHB content under the Fan Content Policy (see `/LEGAL.md`)
- Do NOT replace our data files with these — our files have Chinese translations and custom structures
