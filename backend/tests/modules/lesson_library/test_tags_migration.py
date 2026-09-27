"""0026: lesson_tags round-trips through upgrade and downgrade (FLQ-39)."""

import os
import subprocess
import sys
from pathlib import Path

from sqlalchemy import inspect
from sqlalchemy.ext.asyncio import create_async_engine
from testcontainers.postgres import PostgresContainer  # pyright: ignore[reportMissingTypeStubs]


async def test_lesson_tags_migration_roundtrip() -> None:
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

        migrate("upgrade", "0026_lesson_tags")
        engine = create_async_engine(url)
        try:
            async with engine.connect() as c:
                columns = await c.run_sync(
                    lambda conn: {col["name"] for col in inspect(conn).get_columns("lesson_tags")}
                )
                pk = await c.run_sync(
                    lambda conn: inspect(conn).get_pk_constraint("lesson_tags")[
                        "constrained_columns"
                    ]
                )
                indexes = await c.run_sync(
                    lambda conn: {ix["name"] for ix in inspect(conn).get_indexes("lesson_tags")}
                )
            assert columns == {"user_id", "lesson_id", "tag", "created_at"}
            assert pk == ["user_id", "lesson_id", "tag"]
            assert {"ix_lesson_tags_user_tag", "ix_lesson_tags_lesson"} <= indexes

            migrate("downgrade", "0025_lesson_activity")
            async with engine.connect() as c:
                tables = await c.run_sync(lambda conn: inspect(conn).get_table_names())
            assert "lesson_tags" not in tables
            migrate("upgrade", "heads")
        finally:
            await engine.dispose()
