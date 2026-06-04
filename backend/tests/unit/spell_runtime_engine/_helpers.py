"""Shared helpers for spell_runtime_engine unit tests.

Module-level helpers (not pytest fixtures) so the suite still works when
`pytest --noconftest` is used by the migration validation gate.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any, Dict, List, Optional

from app.models.spell_runtime_instance import SpellRuntimeInstance


def make_instance(
    *,
    instance_id: int = 1,
    spell_id: str = "hex",
    spell_name: str = "脆弱诅咒",
    caster_token_id: int = 10,
    primary_target_token_id: Optional[int] = 20,
    linked_target_token_ids: Optional[List[int]] = None,
    params: Optional[Dict[str, Any]] = None,
    granted_actions: Optional[List[Dict[str, Any]]] = None,
    selected_option: Optional[str] = "strength",
) -> SpellRuntimeInstance:
    return SpellRuntimeInstance(
        id=instance_id,
        campaign_id=1,
        spell_id=spell_id,
        spell_name=spell_name,
        caster_token_id=caster_token_id,
        concentration_owner_token_id=caster_token_id,
        primary_target_token_id=primary_target_token_id,
        linked_target_token_ids=list(linked_target_token_ids)
        if linked_target_token_ids is not None
        else ([primary_target_token_id] if primary_target_token_id else []),
        selected_option=selected_option,
        params=dict(params or {}),
        granted_actions=list(granted_actions or []),
        status="active",
    )


def make_target(token_id: int = 20, name: str = "目标"):
    return SimpleNamespace(token_id=token_id, name=name)
