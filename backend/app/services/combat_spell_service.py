from __future__ import annotations

from typing import Any, Callable, Iterable

from sqlalchemy.orm.attributes import flag_modified


def _safe_flag_modified(instance: Any, attribute_name: str) -> None:
    try:
        flag_modified(instance, attribute_name)
    except AttributeError:
        return


def remove_expired_temp_hp_spell_effects(
    active_effects: list[dict[str, Any]] | None,
    *,
    spell_lookup: Callable[[str | None], Any],
    spell_has_effect_type: Callable[[Any, str], bool],
) -> list[dict[str, Any]] | None:
    if not active_effects:
        return active_effects

    next_effects = [
        effect for effect in active_effects
        if not (
            effect.get("spell_buff")
            and spell_has_effect_type(spell_lookup(effect.get("spell_id")), "grant_temp_hp")
        )
    ]
    return next_effects


def cleanup_concentration_for_dispelled(
    tokens: Iterable[Any],
    *,
    dispelled_spell_ids: list[str],
    target_token_id: int,
) -> list[int]:
    concentration_broken_ids: list[int] = []

    for caster in tokens:
        conc = caster.concentration_spell
        if not conc:
            continue

        conc_spell_id = conc.get("spell_id", "")
        if conc_spell_id not in dispelled_spell_ids:
            continue

        affected = [token_id for token_id in list(conc.get("affected_token_ids") or []) if token_id != target_token_id]
        if not affected and not conc.get("area_effect"):
            caster.concentration_spell = None
            if caster.active_effects:
                next_effects = [
                    effect for effect in caster.active_effects
                    if not (
                        effect.get("spell_buff")
                        and effect.get("spell_id") == conc_spell_id
                    )
                ]
                if len(next_effects) < len(caster.active_effects):
                    caster.active_effects = next_effects
                    _safe_flag_modified(caster, "active_effects")
            concentration_broken_ids.append(caster.id)
        else:
            conc["affected_token_ids"] = affected
            caster.concentration_spell = conc

        _safe_flag_modified(caster, "concentration_spell")

    return concentration_broken_ids
