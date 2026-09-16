"""Execute real migrations on an isolated PostgreSQL database."""

import os
import subprocess
import sys
from pathlib import Path

import pytest
from sqlalchemy import inspect, text
from sqlalchemy.ext.asyncio import create_async_engine
from testcontainers.postgres import PostgresContainer  # pyright: ignore[reportMissingTypeStubs]

BACKEND_ROOT = Path(__file__).resolve().parents[3]


@pytest.mark.asyncio
async def test_migration_roundtrip_and_model_registration() -> None:
    with PostgresContainer("postgres:16-alpine", driver="asyncpg") as pg:
        url = pg.get_connection_url()
        env = {**os.environ, "GLOSANO_DATABASE_URL": url}

        def migrate(*args: str) -> None:
            result = subprocess.run(  # noqa: S603 — fixed executable and migration arguments
                [sys.executable, "-m", "alembic", *args],
                cwd=BACKEND_ROOT,
                env=env,
                capture_output=True,
                text=True,
                check=False,
            )
            assert result.returncode == 0, result.stdout + result.stderr

        migrate("upgrade", "head")
        engine = create_async_engine(url)
        async with engine.connect() as conn:
            started = await conn.scalar(
                text("SELECT started_at FROM statistics_tracking WHERE id = 1")
            )
            assert started is not None
            names = await conn.run_sync(lambda c: inspect(c).get_table_names())
            assert {
                "daily_user_stats",
                "daily_user_language_stats",
                "daily_read_occurrences",
            } <= set(names)
        migrate("upgrade", "head")
        async with engine.connect() as conn:
            assert (
                await conn.scalar(text("SELECT started_at FROM statistics_tracking WHERE id = 1"))
                == started
            )
        migrate("downgrade", "0015_daily_goal_reviews_500")
        async with engine.connect() as conn:
            names = await conn.run_sync(lambda c: inspect(c).get_table_names())
            assert "daily_user_stats" not in names
            assert "review_items" in names
        migrate("upgrade", "head")
        await engine.dispose()
