import redis.asyncio as aioredis
from app.core.config import settings

redis_client = None


async def init_redis():
    """Initialize Redis connection"""
    global redis_client
    redis_client = await aioredis.from_url(
        settings.REDIS_URL,
        encoding="utf-8",
        decode_responses=True
    )
    return redis_client


async def close_redis():
    """Close Redis connection"""
    global redis_client
    if redis_client:
        await redis_client.close()


async def get_redis():
    """Dependency for getting Redis client"""
    return redis_client
