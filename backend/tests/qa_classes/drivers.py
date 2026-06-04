"""Thin wrappers over the three character endpoints. Each returns the raw httpx
Response so smoke oracles can inspect status codes (a 500 is a finding, not an
exception). `choices` keys use snake_case CharacterCreate fields (populate_by_name)."""
from __future__ import annotations
from httpx import AsyncClient, Response

API = "/api/characters"


def _minimal_create_body(user_id: str, class_id: str, level: int,
                         subclass_id: str | None, choices: dict | None) -> dict:
    body = {
        "user_id": user_id,
        "name": f"QA {class_id} L{level}",
        "race_id": "human",
        "class_id": class_id,
        "level": level,
        "ability_scores": {},   # all default to 10
        "appearance": {},       # all default to ""
        "personality": {},      # all default
    }
    if subclass_id:
        body["subclass_id"] = subclass_id
    if choices:
        body.update(choices)
    return body


async def build_at_level(client: AsyncClient, headers: dict, user_id: str,
                         class_id: str, level: int = 1, *,
                         subclass_id: str | None = None,
                         choices: dict | None = None) -> Response:
    body = _minimal_create_body(user_id, class_id, level, subclass_id, choices)
    return await client.post(API, json=body, headers=headers)


async def level_up_once(client: AsyncClient, headers: dict, character_id: int,
                        class_choice: str, feature_choices: dict | None = None) -> Response:
    return await client.post(
        f"{API}/{character_id}/level-up",
        json={"class_choice": class_choice, "feature_choices": feature_choices or {}},
        headers=headers,
    )


async def get_sheet(client: AsyncClient, headers: dict, character_id: int) -> Response:
    return await client.get(f"{API}/{character_id}/sheet", headers=headers)


async def get_resources(client: AsyncClient, headers: dict, character_id: int) -> Response:
    return await client.get(f"{API}/{character_id}/resources", headers=headers)
