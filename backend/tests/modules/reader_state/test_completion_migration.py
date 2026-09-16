"""Completion fields round-trip on real PostgreSQL without marking old positions complete."""

import os
import subprocess
import sys
from pathlib import Path

from sqlalchemy import inspect, text
from sqlalchemy.ext.asyncio import create_async_engine
from testcontainers.postgres import PostgresContainer  # pyright: ignore[reportMissingTypeStubs]


async def test_completion_migration_roundtrip() -> None:
    with PostgresContainer("postgres:16-alpine", driver="asyncpg") as pg:
        url = pg.get_connection_url()
        env = {**os.environ, "GLOSANO_DATABASE_URL": url}

        def migrate(command: str, target: str) -> None:
            result = subprocess.run(  # noqa: S603 — fixed executable and migration targets
                [sys.executable, "-m", "alembic", command, target],
                cwd=Path(__file__).resolve().parents[3],
                env=env,
                capture_output=True,
                text=True,
                check=False,
            )
            assert result.returncode == 0, result.stdout + result.stderr

        migrate("upgrade", "0017_ui_language_translation")
        engine = create_async_engine(url)
        migrate("upgrade", "0018_reader_completion")
        async with engine.connect() as c:
            columns = await c.run_sync(lambda conn: inspect(conn).get_columns("reader_positions"))
            for name in ("completed_at", "completion_action_id"):
                assert next(column for column in columns if column["name"] == name)["nullable"]
            assert (
                await c.scalar(
                    text("SELECT count(*) FROM reader_positions WHERE completed_at IS NOT NULL")
                )
                == 0
            )
        migrate("downgrade", "0017_ui_language_translation")
        async with engine.connect() as c:
            columns = await c.run_sync(lambda conn: inspect(conn).get_columns("reader_positions"))
            assert "completed_at" not in {column["name"] for column in columns}
        migrate("upgrade", "0018_reader_completion")
        await engine.dispose()
