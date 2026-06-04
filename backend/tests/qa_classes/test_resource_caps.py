"""Resource-cap invariant tests: compare /resources max values against SRD.

Each case is independent — a fresh L{level} character is built (no walk needed)
and only the named resource's `max` is asserted.
"""
import pytest
from tests.qa_classes import drivers, oracles

pytestmark = [pytest.mark.asyncio]

# (class_id, resource_id, level, expected_max) — SRD caps
# NOTE: barbarian L20 has UNLIMITED rages (PHB p.49 "Unlimited" at L20; L19 = 6).
# Backend represents unlimited as 999; harness mirrors that sentinel.
CASES = [
    ("barbarian", "rage", 20, 999),   # PHB L20: Unlimited → backend sentinel 999
    ("fighter", "action_surge", 20, 2),
    ("fighter", "second_wind", 20, 1),
    ("monk", "ki", 20, 20),
    ("sorcerer", "sorcery_points", 20, 20),
]


@pytest.mark.parametrize("class_id,resource_id,level,expected", CASES,
                         ids=[f"{c}.{r}@L{l}" for c, r, l, _ in CASES])
async def test_resource_cap_at_level(qa_client, qa_headers, qa_user_id,
                                     class_id, resource_id, level, expected):
    built = await drivers.build_at_level(qa_client, qa_headers, qa_user_id, class_id, level=level)
    oracles.assert_status_ok(built, f"build {class_id} L{level}")
    res = await drivers.get_resources(qa_client, qa_headers, built.json()["id"])
    oracles.assert_status_ok(res, f"resources {class_id} L{level}")
    oracles.assert_resource_cap(res.json(), resource_id=resource_id, expected_max=expected,
                                context=f"{class_id} {resource_id} L{level}")
