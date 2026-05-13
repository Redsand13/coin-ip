from collections.abc import AsyncGenerator

import redis.asyncio as aioredis

from app.config import settings

_pool: aioredis.ConnectionPool | None = None


def get_pool() -> aioredis.ConnectionPool:
    global _pool
    if _pool is None:
        _pool = aioredis.ConnectionPool.from_url(
            str(settings.REDIS_URL),
            max_connections=50,
            decode_responses=True,
        )
    return _pool


async def get_redis() -> AsyncGenerator[aioredis.Redis, None]:
    client = aioredis.Redis(connection_pool=get_pool())
    try:
        yield client
    finally:
        await client.aclose()


async def check_redis_health() -> bool:
    try:
        client = aioredis.Redis(connection_pool=get_pool())
        await client.ping()
        await client.aclose()
        return True
    except Exception:
        return False
