#!/usr/bin/env python3
"""
Simple standalone test script for control effect escape/save/wake-up APIs.
Uses raw SQL to create test data, tests the APIs, then cleans up.

NOTE: The ongoing-save and escape-attempt APIs use internal random dice rolls,
so we test structure and field presence rather than specific outcomes.

Usage:
    cd backend && source venv/bin/activate && python tests/test_control_effect_simple.py
"""

if __name__ != "__main__":
    import pytest

    pytest.skip(
        "Manual integration script; automated coverage lives in test_control_effect_escape.py",
        allow_module_level=True,
    )

import asyncio
import httpx
import asyncpg
import os
from datetime import datetime

# Configuration
API_BASE = "http://localhost:8174"
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://haoli@localhost:5432/dnd_platform")

# Convert to asyncpg format
if DATABASE_URL.startswith("postgresql+asyncpg://"):
    DATABASE_URL = DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://")


# Test effect data
HOLD_PERSON_EFFECT = {
    "id": "hold_person_paralyzed",
    "name": "人类定身术",
    "condition": "paralyzed",
    "source": "法师",
    "spell_save_dc": 15,
    "ongoing_save": {
        "dc": 15,
        "save_type": "wisdom",
        "timing": "end_of_turn"
    },
    "duration": 10,
    "duration_remaining": 10
}

WEB_EFFECT = {
    "id": "web_restrained",
    "name": "蛛网术",
    "condition": "restrained",
    "source": "法师",
    "spell_save_dc": 14,
    "escape_action": {
        "dc": 14,
        "ability": "strength",
        "type": "check"
    },
    "duration": 10,
    "duration_remaining": 10
}

SLEEP_EFFECT = {
    "id": "sleep_unconscious",
    "name": "睡眠术",
    "condition": "unconscious",
    "source": "法师",
    "break_conditions": ["damage", "shaken"],
    "duration": 10,
    "duration_remaining": 10
}


async def get_test_campaign(conn) -> int:
    """Get an existing campaign ID or create one."""
    result = await conn.fetchval("SELECT id FROM campaigns LIMIT 1")
    if result:
        return result
    result = await conn.fetchval("""
        INSERT INTO campaigns (name, dm_id, created_at, updated_at)
        VALUES ('Test Campaign', 1, NOW(), NOW())
        RETURNING id
    """)
    return result


async def create_test_token(conn, campaign_id: int, name: str, effects: list) -> int:
    """Create a test token with specific effects."""
    import json
    token_id = await conn.fetchval("""
        INSERT INTO tokens (campaign_id, instance_name, user_id, map_url, position_x, position_y, token_size, current_hp, active_effects, created_at, updated_at)
        VALUES ($1, $2, 'test_user', 'test_map.png', 100, 100, '1x1', 30, $3, NOW(), NOW())
        RETURNING id
    """, campaign_id, name, json.dumps(effects))
    return token_id


async def delete_token(conn, token_id: int):
    """Delete a test token."""
    await conn.execute("DELETE FROM tokens WHERE id = $1", token_id)


async def test_ongoing_save(conn, campaign_id: int):
    """Test ongoing save for Hold Person effect."""
    print("\n" + "="*60)
    print("Test 1: Ongoing Save (定身术)")
    print("="*60)

    token_id = await create_test_token(conn, campaign_id, "定身测试", [HOLD_PERSON_EFFECT])
    print(f"\n→ Created test token ID: {token_id}")

    try:
        async with httpx.AsyncClient() as client:
            print("\n→ Testing ongoing save API...")
            response = await client.post(
                f"{API_BASE}/api/combat/ongoing-save",
                json={
                    "token_id": token_id,
                    "effect_id": "hold_person_paralyzed",
                    "campaign_id": campaign_id
                }
            )

            if response.status_code != 200:
                print(f"  ❌ FAIL: Status {response.status_code}")
                return False

            data = response.json()

            # Verify response structure
            required_fields = ["success", "effect_id", "effect_name", "save_type", "save_dc", "save_roll", "save_total", "effect_removed", "narrative"]
            for field in required_fields:
                if field not in data:
                    print(f"  ❌ FAIL: Missing field '{field}'")
                    return False

            print(f"  ✓ Response structure valid")
            print(f"    - Effect ID: {data['effect_id']}")
            print(f"    - Save Type: {data['save_type']}")
            print(f"    - Save DC: {data['save_dc']}")
            print(f"    - Roll Total: {data['save_total']}")
            print(f"    - Effect Removed: {data['effect_removed']}")
            print(f"    - Narrative: {data['narrative']}")

            # Verify logical consistency
            if data['save_total'] >= data['save_dc'] and not data['effect_removed']:
                print(f"  ❌ FAIL: Roll {data['save_total']} >= DC {data['save_dc']} but effect not removed")
                return False
            if data['save_total'] < data['save_dc'] and data['effect_removed']:
                print(f"  ❌ FAIL: Roll {data['save_total']} < DC {data['save_dc']} but effect was removed")
                return False

            print(f"  ✓ PASS: Logic consistent (roll vs DC matches effect_removed)")
            return True

    finally:
        await delete_token(conn, token_id)
        print(f"→ Cleaned up token {token_id}")


async def test_escape_attempt(conn, campaign_id: int):
    """Test escape attempt for Web effect."""
    print("\n" + "="*60)
    print("Test 2: Escape Attempt (蛛网术)")
    print("="*60)

    token_id = await create_test_token(conn, campaign_id, "蛛网测试", [WEB_EFFECT])
    print(f"\n→ Created test token ID: {token_id}")

    try:
        async with httpx.AsyncClient() as client:
            print("\n→ Testing escape attempt API...")
            response = await client.post(
                f"{API_BASE}/api/combat/escape-attempt",
                json={
                    "token_id": token_id,
                    "effect_id": "web_restrained",
                    "campaign_id": campaign_id
                }
            )

            if response.status_code != 200:
                print(f"  ❌ FAIL: Status {response.status_code}")
                return False

            data = response.json()

            # Verify response structure
            required_fields = ["success", "effect_id", "effect_name", "check_type", "ability", "dc", "roll", "total", "effect_removed", "narrative"]
            for field in required_fields:
                if field not in data:
                    print(f"  ❌ FAIL: Missing field '{field}'")
                    return False

            print(f"  ✓ Response structure valid")
            print(f"    - Effect ID: {data['effect_id']}")
            print(f"    - Check Type: {data['check_type']}")
            print(f"    - Ability: {data['ability']}")
            print(f"    - DC: {data['dc']}")
            print(f"    - Roll Total: {data['total']}")
            print(f"    - Effect Removed: {data['effect_removed']}")
            print(f"    - Narrative: {data['narrative']}")

            # Verify logical consistency
            if data['total'] >= data['dc'] and not data['effect_removed']:
                print(f"  ❌ FAIL: Roll {data['total']} >= DC {data['dc']} but effect not removed")
                return False
            if data['total'] < data['dc'] and data['effect_removed']:
                print(f"  ❌ FAIL: Roll {data['total']} < DC {data['dc']} but effect was removed")
                return False

            print(f"  ✓ PASS: Logic consistent (roll vs DC matches effect_removed)")
            return True

    finally:
        await delete_token(conn, token_id)
        print(f"→ Cleaned up token {token_id}")


async def test_wake_up(conn, campaign_id: int):
    """Test wake up for Sleep effect."""
    print("\n" + "="*60)
    print("Test 3: Wake Up (睡眠术)")
    print("="*60)

    token_id = await create_test_token(conn, campaign_id, "睡眠测试", [SLEEP_EFFECT])
    print(f"\n→ Created test token ID: {token_id}")

    try:
        async with httpx.AsyncClient() as client:
            print("\n→ Testing wake up (shaken)...")
            response = await client.post(
                f"{API_BASE}/api/combat/remove-effect",
                params={
                    "campaign_id": campaign_id,
                    "token_id": token_id,
                    "effect_id": "sleep_unconscious",
                    "reason": "shaken"
                }
            )

            if response.status_code != 200:
                print(f"  ❌ FAIL: Status {response.status_code} - {response.text}")
                return False

            data = response.json()

            # Verify response
            if data.get("success") != True:
                print(f"  ❌ FAIL: success should be True")
                return False
            if data.get("reason") != "shaken":
                print(f"  ❌ FAIL: reason should be 'shaken'")
                return False
            if "被摇醒" not in data.get("narrative", ""):
                print(f"  ❌ FAIL: narrative should contain '被摇醒'")
                return False

            print(f"  ✓ Response valid")
            print(f"    - Success: {data['success']}")
            print(f"    - Reason: {data['reason']}")
            print(f"    - Narrative: {data['narrative']}")
            print(f"  ✓ PASS: Wake up works correctly")
            return True

    finally:
        await delete_token(conn, token_id)
        print(f"→ Cleaned up token {token_id}")


async def test_error_cases(conn, campaign_id: int):
    """Test error handling."""
    print("\n" + "="*60)
    print("Test 4: Error Handling")
    print("="*60)

    async with httpx.AsyncClient() as client:
        # Test 4a: Token not found
        print("\n→ Testing token not found...")
        response = await client.post(
            f"{API_BASE}/api/combat/ongoing-save",
            json={
                "token_id": 999999,
                "effect_id": "some_effect",
                "campaign_id": campaign_id
            }
        )
        if response.status_code == 404:
            print(f"  ✓ PASS: 404 for non-existent token")
        else:
            print(f"  ❌ FAIL: Expected 404, got {response.status_code}")
            return False

    # Test effect without escape_action
    effect_no_escape = {
        "id": "hold_person_paralyzed",
        "name": "人类定身术",
        "condition": "paralyzed",
        "ongoing_save": {"dc": 15, "save_type": "wisdom"}
    }

    token_id = await create_test_token(conn, campaign_id, "错误测试", [effect_no_escape])
    print(f"\n→ Created token {token_id} without escape_action")

    try:
        async with httpx.AsyncClient() as client:
            print("→ Testing escape attempt on effect without escape_action...")
            response = await client.post(
                f"{API_BASE}/api/combat/escape-attempt",
                json={
                    "token_id": token_id,
                    "effect_id": "hold_person_paralyzed",
                    "campaign_id": campaign_id
                }
            )
            if response.status_code == 400:
                print(f"  ✓ PASS: 400 for effect without escape_action")
            else:
                print(f"  ❌ FAIL: Expected 400, got {response.status_code}")
                return False

    finally:
        await delete_token(conn, token_id)
        print(f"→ Cleaned up token {token_id}")

    return True


async def main():
    """Run all tests."""
    print("="*60)
    print("Control Effect Escape API Tests")
    print("="*60)
    print(f"API Base: {API_BASE}")

    try:
        conn = await asyncpg.connect(DATABASE_URL)
    except Exception as e:
        print(f"\n❌ Failed to connect to database: {e}")
        return False

    try:
        campaign_id = await get_test_campaign(conn)
        print(f"Using Campaign ID: {campaign_id}")

        results = []
        results.append(("Ongoing Save", await test_ongoing_save(conn, campaign_id)))
        results.append(("Escape Attempt", await test_escape_attempt(conn, campaign_id)))
        results.append(("Wake Up", await test_wake_up(conn, campaign_id)))
        results.append(("Error Handling", await test_error_cases(conn, campaign_id)))

        print("\n" + "="*60)
        print("Test Summary")
        print("="*60)

        passed = sum(1 for _, r in results if r)
        failed = len(results) - passed

        for name, result in results:
            status = "✓ PASS" if result else "❌ FAIL"
            print(f"  {status}: {name}")

        print(f"\nTotal: {passed} passed, {failed} failed")
        print("="*60)

        return failed == 0

    finally:
        await conn.close()


if __name__ == "__main__":
    success = asyncio.run(main())
    exit(0 if success else 1)
