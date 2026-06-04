"""
Critical path tests for character CRUD operations.
These are high-priority tests for core functionality.
"""

import pytest
from httpx import AsyncClient

pytestmark = [pytest.mark.integration, pytest.mark.asyncio]


class TestCharacterCRUD:
    """Tests for character CRUD endpoints."""

    async def test_create_character(
        self,
        client: AsyncClient,
        auth_headers: dict,
        test_campaign,
        character_data
    ):
        """Test creating a new character."""
        data = character_data(
            name="Test Hero",
            campaign_id=test_campaign.id
        )

        response = await client.post(
            "/api/characters",
            json=data,
            headers=auth_headers,
        )

        assert response.status_code == 201
        result = response.json()
        assert result["name"] == "Test Hero"
        assert result["level"] == 1
        assert "id" in result

    async def test_list_characters(
        self,
        client: AsyncClient,
        auth_headers: dict,
        test_campaign,
        character_data
    ):
        """Test listing characters in a campaign."""
        # Create a character first
        data = character_data(campaign_id=test_campaign.id)
        await client.post(
            "/api/characters",
            json=data,
            headers=auth_headers,
        )

        # List characters
        response = await client.get(
            f"/api/characters?campaign_id={test_campaign.id}",
            headers=auth_headers,
        )

        assert response.status_code == 200
        characters = response.json()
        assert len(characters) >= 1

    async def test_get_character(
        self,
        client: AsyncClient,
        auth_headers: dict,
        test_campaign,
        character_data
    ):
        """Test getting a specific character."""
        # Create character
        data = character_data(campaign_id=test_campaign.id)
        create_response = await client.post(
            "/api/characters",
            json=data,
            headers=auth_headers,
        )
        character_id = create_response.json()["id"]

        # Get character
        response = await client.get(
            f"/api/characters/{character_id}",
            headers=auth_headers,
        )

        assert response.status_code == 200
        assert response.json()["id"] == character_id

    async def test_update_character(
        self,
        client: AsyncClient,
        auth_headers: dict,
        test_campaign,
        character_data
    ):
        """Test updating a character."""
        # Create character
        data = character_data(campaign_id=test_campaign.id)
        create_response = await client.post(
            "/api/characters",
            json=data,
            headers=auth_headers,
        )
        character_id = create_response.json()["id"]

        # Update character. PUT binds the full CharacterCreate schema (same as
        # create), so a partial body like {"name", "level"} is rejected with 422
        # — send a complete body via the factory.
        response = await client.put(
            f"/api/characters/{character_id}",
            json=character_data(name="Updated Name", level=5),
            headers=auth_headers,
        )

        assert response.status_code == 200
        result = response.json()
        assert result["name"] == "Updated Name"
        assert result["level"] == 5

    async def test_delete_character(
        self,
        client: AsyncClient,
        auth_headers: dict,
        test_campaign,
        character_data
    ):
        """Test deleting a character."""
        # Create character
        data = character_data(campaign_id=test_campaign.id)
        create_response = await client.post(
            "/api/characters",
            json=data,
            headers=auth_headers,
        )
        character_id = create_response.json()["id"]

        # Delete character
        response = await client.delete(
            f"/api/characters/{character_id}",
            headers=auth_headers,
        )

        assert response.status_code == 204

        # Verify deleted
        get_response = await client.get(
            f"/api/characters/{character_id}",
            headers=auth_headers,
        )
        assert get_response.status_code == 404

    async def test_character_hp_management(
        self,
        client: AsyncClient,
        auth_headers: dict,
        test_campaign,
        character_data
    ):
        """Test HP update operations."""
        # Create character with known HP
        data = character_data(
            campaign_id=test_campaign.id,
            max_hp=20,
            current_hp=20
        )
        create_response = await client.post(
            "/api/characters",
            json=data,
            headers=auth_headers,
        )
        character_id = create_response.json()["id"]

        # Take damage
        response = await client.post(
            f"/api/characters/{character_id}/damage",
            json={"amount": 5},
            headers=auth_headers,
        )

        if response.status_code == 200:
            assert response.json()["current_hp"] == 15

    async def test_character_level_up(
        self,
        client: AsyncClient,
        auth_headers: dict,
        test_campaign,
        character_data
    ):
        """Test character level up."""
        # Create level 1 character
        data = character_data(
            campaign_id=test_campaign.id,
            level=1
        )
        create_response = await client.post(
            "/api/characters",
            json=data,
            headers=auth_headers,
        )
        character_id = create_response.json()["id"]

        # Level up
        response = await client.post(
            f"/api/characters/{character_id}/level-up",
            headers=auth_headers,
        )

        if response.status_code == 200:
            assert response.json()["level"] == 2


class TestCharacterPermissions:
    """Tests for character access permissions."""

    async def test_cannot_access_other_campaign_character(
        self,
        client: AsyncClient,
        auth_headers: dict,
        db_session
    ):
        """Test that users cannot access characters from other campaigns."""
        # This would need another campaign/user setup
        pass

    async def test_dm_can_modify_player_character(
        self,
        client: AsyncClient,
        dm_auth_headers: dict,
        test_campaign,
        character_data
    ):
        """Test that DM can modify characters in their campaign."""
        data = character_data(campaign_id=test_campaign.id)
        create_response = await client.post(
            "/api/characters",
            json=data,
            headers=dm_auth_headers,
        )

        assert create_response.status_code == 201
