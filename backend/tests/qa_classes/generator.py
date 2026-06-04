"""Enumerate class/level-up test paths and option probes from progression data.

Reads progression via rules_cache (never a hardcoded path, per repo rule). Emits:
- WalkPath: one per (class, subclass option) for the 1->20 progression walk.
- OptionProbe: one per inline `choice`-node option (fighting_style, favored_enemy, ...).

Option sources that are NOT inline lists (warlock invocations, feats, Battle Master
maneuvers, expertise) and ASI/feat levels are handled by Plan B as CHOICE_FIELD_MAP
is extended; this cycle covers inline `choice` nodes + the full subclass walk set.
"""
from __future__ import annotations
from dataclasses import dataclass

from app.utils.rules_cache import get_classes_progression_data

# Progression choice-NODE id -> (feature_choices key, CharacterResponse field).
# These three can differ: e.g. the ranger node `natural_explorer` feeds the
# `favored_terrain` field. Only inline choice nodes that map to a TOP-LEVEL character
# field belong here. Verified node ids: `fighting_style` (fighter L1 / paladin L2 /
# ranger L2), `favored_enemy` (ranger L1, 13 opts), `natural_explorer` (ranger L1, 7 opts).
# Covered by dedicated tests (NOT via this inline-probe map): `metamagic` +
# `pact_boon` (subclass_choices.*, test_nested_and_unsupported.py), `eldritch_invocations`
# + Battle Master `maneuvers` (test_external_options.py), ASI/feat (test_asi_feat.py).
# Genuinely uncovered (recurring picks that carry 0 inline options in the data):
#   `favored_enemy_2/3`, `natural_explorer_2*`.
CHOICE_FIELD_MAP: dict[str, tuple[str, str]] = {
    "fighting_style": ("fighting_style", "fighting_style"),
    "favored_enemy": ("favored_enemy", "favored_enemy"),
    "natural_explorer": ("favored_terrain", "favored_terrain"),
}


@dataclass(frozen=True)
class WalkPath:
    class_id: str
    subclass_id: str
    subclass_level: int


@dataclass(frozen=True)
class OptionProbe:
    class_id: str
    choice_id: str
    option_id: str
    level: int
    fc_key: str
    char_field: str

    @property
    def label(self) -> str:
        return f"{self.class_id}.{self.choice_id}.{self.option_id}@L{self.level}"


def _iter_level_features(class_block: dict):
    """Yield (level:int, feature_node:dict) for a class's levelProgression."""
    progression = class_block.get("levelProgression") or {}
    for level_key, level_block in progression.items():
        try:
            level = int(level_key)
        except (TypeError, ValueError):
            continue
        for node in (level_block.get("features") or []):
            yield level, node


def _classes() -> dict:
    return get_classes_progression_data().get("classes") or {}


def _find_subclass_node(class_block: dict) -> tuple[int, dict] | None:
    """Return the (level, node) of the class's subclass selection point.

    5e classes have exactly one such node; this returns the first one found and
    ignores any later subclass node (none exist in current data).
    """
    for level, node in _iter_level_features(class_block):
        if node.get("type") == "subclass":
            return level, node
    return None


def iter_class_subclass_pairs() -> list[WalkPath]:
    pairs: list[WalkPath] = []
    for class_id, class_block in _classes().items():
        found = _find_subclass_node(class_block)
        if not found:
            continue
        level, node = found
        for option in (node.get("choices") or []):
            oid = option.get("id")
            if oid:
                pairs.append(WalkPath(class_id, oid, level))
    return pairs


def iter_inline_option_probes() -> list[OptionProbe]:
    probes: list[OptionProbe] = []
    for class_id, class_block in _classes().items():
        for level, node in _iter_level_features(class_block):
            if node.get("type") != "choice":
                continue
            mapping = CHOICE_FIELD_MAP.get(node.get("id"))
            if not mapping:
                continue  # non-inline / unmapped choice — deferred to Plan B
            fc_key, char_field = mapping
            for option in (node.get("choices") or []):
                oid = option.get("id")
                if oid:
                    probes.append(OptionProbe(
                        class_id, node["id"], oid, level, fc_key, char_field,
                    ))
    return probes


def build_choice_script(class_id: str, subclass_id: str) -> dict[int, dict]:
    """level -> feature_choices: pick the first inline option at each choice node,
    and select `subclass_id` at the subclass node's level."""
    class_block = _classes().get(class_id) or {}
    script: dict[int, dict] = {}
    for level, node in _iter_level_features(class_block):
        ntype = node.get("type")
        if ntype == "subclass":
            script.setdefault(level, {})["subclass"] = subclass_id
        elif ntype == "choice":
            mapping = CHOICE_FIELD_MAP.get(node.get("id"))
            choices = node.get("choices") or []
            first_id = choices[0].get("id") if choices else None
            if mapping and first_id:
                fc_key, _ = mapping
                script.setdefault(level, {})[fc_key] = first_id
    return script
