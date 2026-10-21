"""Async Redis client (used for rate limiting and AI cache)."""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Protocol, cast

from redis.asyncio import Redis

from glosano.core.config import get_settings


class _RedisFactory(Protocol):
    def from_url(self, url: str, *, decode_responses: bool) -> Redis: ...


# redis 7.4 leaves from_url's **kwargs unannotated. Preserve its URL parsing
# and describe only the supported option used by this application.
_redis_factory = cast(_RedisFactory, Redis)
_client: Redis | None = None


def get_redis_client() -> Redis:
    """Module-level singleton (lazy)."""
    global _client  # noqa: PLW0603,RUF100
    if _client is None:
        _client = _redis_factory.from_url(get_settings().redis_url, decode_responses=True)
    return _client


async def get_redis() -> AsyncIterator[Redis]:
    """FastAPI dependency."""
    yield get_redis_client()


async def dispose_redis() -> None:
    global _client  # noqa: PLW0603,RUF100
    if _client is not None:
        await _client.aclose()
        _client = None
