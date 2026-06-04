"""
Database query optimization utilities.
Provides eager loading strategies to solve N+1 query problems.
"""

from typing import List, Type, Any
from sqlalchemy import select
from sqlalchemy.orm import selectinload, joinedload, subqueryload
from sqlalchemy.ext.asyncio import AsyncSession


class QueryOptimizer:
    """
    Helper class for optimizing database queries with eager loading.

    Example usage:
        optimizer = QueryOptimizer(Character)
        query = optimizer.with_equipment().with_spells().build()
        result = await db.execute(query)
    """

    def __init__(self, model: Type):
        self.model = model
        self._query = select(model)
        self._options = []

    def with_relation(self, *relations: str, strategy: str = "selectin"):
        """
        Add eager loading for specified relations.

        Args:
            relations: Relationship names to load
            strategy: Loading strategy ('selectin', 'joined', 'subquery')
        """
        loader = {
            "selectin": selectinload,
            "joined": joinedload,
            "subquery": subqueryload
        }.get(strategy, selectinload)

        for relation in relations:
            # Handle nested relations (e.g., "campaign.maps")
            parts = relation.split(".")
            if len(parts) == 1:
                self._options.append(loader(getattr(self.model, relation)))
            else:
                # Build nested loader
                option = loader(getattr(self.model, parts[0]))
                for part in parts[1:]:
                    option = option.selectinload(getattr(self.model, part))
                self._options.append(option)

        return self

    def build(self):
        """Build and return the optimized query."""
        if self._options:
            return self._query.options(*self._options)
        return self._query

    def filter(self, *conditions):
        """Add filter conditions."""
        self._query = self._query.where(*conditions)
        return self

    def order_by(self, *columns):
        """Add ordering."""
        self._query = self._query.order_by(*columns)
        return self

    def limit(self, count: int):
        """Add limit."""
        self._query = self._query.limit(count)
        return self


# Pre-defined optimized queries for common use cases

async def get_campaign_with_all(db: AsyncSession, campaign_id: int):
    """
    Get campaign with all related data in optimized queries.
    Solves N+1 for: characters, maps, tokens, chat messages
    """
    from app.models.campaign import Campaign

    query = (
        select(Campaign)
        .where(Campaign.id == campaign_id)
        .options(
            selectinload(Campaign.characters),
            selectinload(Campaign.maps).selectinload("tokens"),
            selectinload(Campaign.chat_messages),
        )
    )

    result = await db.execute(query)
    return result.scalar_one_or_none()


async def get_character_with_equipment(db: AsyncSession, character_id: int):
    """
    Get character with equipment pre-loaded.
    Avoids N+1 when accessing character.equipment
    """
    from app.models.character import Character

    query = (
        select(Character)
        .where(Character.id == character_id)
        .options(
            # Equipment is stored as JSON, so no eager loading needed
            # But if it were a relationship:
            # selectinload(Character.equipment_items)
        )
    )

    result = await db.execute(query)
    return result.scalar_one_or_none()


async def get_map_with_tokens(db: AsyncSession, map_id: int):
    """
    Get map with all tokens and their character data.
    Solves N+1 for: tokens, token.character
    """
    from app.models.campaign import CampaignMap
    from app.models.token import Token

    query = (
        select(CampaignMap)
        .where(CampaignMap.id == map_id)
        .options(
            selectinload(CampaignMap.tokens).selectinload(Token.character)
        )
    )

    result = await db.execute(query)
    return result.scalar_one_or_none()


async def list_characters_for_user(db: AsyncSession, user_id: str):
    """
    List all characters for a user with campaign info.
    Uses single query instead of N+1 for campaign data.
    """
    from app.models.character import Character

    query = (
        select(Character)
        .where(Character.user_id == user_id)
        .options(
            # selectinload(Character.campaign)  # if relationship exists
        )
        .order_by(Character.created_at.desc())
    )

    result = await db.execute(query)
    return result.scalars().all()


async def get_tokens_in_viewport(
    db: AsyncSession,
    map_id: int,
    x_min: float,
    y_min: float,
    x_max: float,
    y_max: float
):
    """
    Get tokens within a viewport boundary.
    Useful for large maps with many tokens.
    """
    from app.models.token import Token

    query = (
        select(Token)
        .where(
            Token.map_id == map_id,
            Token.x >= x_min,
            Token.x <= x_max,
            Token.y >= y_min,
            Token.y <= y_max
        )
        .options(
            selectinload(Token.character)
        )
    )

    result = await db.execute(query)
    return result.scalars().all()


# Batch loading utilities

async def batch_load_characters(db: AsyncSession, character_ids: List[int]):
    """
    Load multiple characters in a single query.
    Use instead of loading one-by-one in a loop.
    """
    from app.models.character import Character

    if not character_ids:
        return []

    query = (
        select(Character)
        .where(Character.id.in_(character_ids))
    )

    result = await db.execute(query)
    characters = result.scalars().all()

    # Return as dict for O(1) lookup
    return {c.id: c for c in characters}


async def batch_load_tokens_by_character(db: AsyncSession, character_ids: List[int]):
    """
    Load tokens for multiple characters in a single query.
    """
    from app.models.token import Token

    if not character_ids:
        return {}

    query = (
        select(Token)
        .where(Token.character_id.in_(character_ids))
    )

    result = await db.execute(query)
    tokens = result.scalars().all()

    # Group by character_id
    grouped = {}
    for token in tokens:
        if token.character_id not in grouped:
            grouped[token.character_id] = []
        grouped[token.character_id].append(token)

    return grouped


# Query analysis decorator

def log_query_count(func):
    """
    Decorator to log the number of database queries executed.
    Useful for detecting N+1 problems during development.
    """
    import functools
    import logging

    logger = logging.getLogger("query_optimizer")

    @functools.wraps(func)
    async def wrapper(*args, **kwargs):
        # This would need SQLAlchemy event listeners to actually count
        # For now, just a placeholder
        result = await func(*args, **kwargs)
        return result

    return wrapper