"""Readiness uses a real PostgreSQL schema and Redis, not mocked databases."""

from collections.abc import AsyncIterator

import pytest
from httpx import AsyncClient
from sqlalchemy import text

from glosano.api.health import expected_heads
from glosano.core.db import get_engine


@pytest.fixture
async def version_table() -> AsyncIterator[None]:
    async with get_engine().begin() as connection:
        await connection.execute(text("CREATE TABLE alembic_version (version_num varchar(64))"))
    try:
        yield
    finally:
        async with get_engine().begin() as connection:
            await connection.execute(text("DROP TABLE alembic_version"))


async def test_missing_revision_is_not_ready(client: AsyncClient) -> None:
    response = await client.get("/health/ready")
    assert response.status_code == 503
    assert response.json() == {"status": "not_ready"}
    assert (await client.get("/health")).status_code == 200


async def test_schema_must_match_the_release(client: AsyncClient, version_table: None) -> None:
    async with get_engine().begin() as connection:
        for head in expected_heads():
            await connection.execute(
                text("INSERT INTO alembic_version VALUES (:head)"), {"head": head}
            )
    response = await client.get("/health/ready")
    assert response.status_code == 200
    assert response.json() == {"status": "ready"}
    async with get_engine().begin() as connection:
        await connection.execute(text("UPDATE alembic_version SET version_num='unknown'"))
    assert (await client.get("/health/ready")).status_code == 503


async def test_health_ignores_invalid_session_cookie(client: AsyncClient) -> None:
    response = await client.get("/health", headers={"Cookie": "glosano_session=invalid"})
    assert response.status_code == 200
