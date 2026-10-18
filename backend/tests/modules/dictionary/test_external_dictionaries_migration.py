"""0027: external dictionary tables round-trip through upgrade and downgrade (FLQ-46)."""

import os
import subprocess
import sys
from pathlib import Path

from sqlalchemy import inspect
from sqlalchemy.ext.asyncio import create_async_engine
from testcontainers.postgres import PostgresContainer  # pyright: ignore[reportMissingTypeStubs]


async def test_external_dictionaries_migration_roundtrip() -> None:
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

        migrate("upgrade", "0027_external_dictionaries")
        engine = create_async_engine(url)
        try:
            async with engine.connect() as c:
                dictionaries = await c.run_sync(
                    lambda conn: {
                        col["name"]
                        for col in inspect(conn).get_columns("user_external_dictionaries")
                    }
                )
                layouts = await c.run_sync(
                    lambda conn: {
                        col["name"] for col in inspect(conn).get_columns("user_dictionary_layouts")
                    }
                )
                pk = await c.run_sync(
                    lambda conn: inspect(conn).get_pk_constraint("user_dictionary_layouts")[
                        "constrained_columns"
                    ]
                )
                indexes = await c.run_sync(
                    lambda conn: {
                        ix["name"] for ix in inspect(conn).get_indexes("user_external_dictionaries")
                    }
                )
            assert dictionaries == {
                "id",
                "user_id",
                "name",
                "url_template",
                "source_language_code",
                "target_language_code",
                "created_at",
                "updated_at",
            }
            assert layouts == {
                "user_id",
                "source_language_code",
                "target_language_code",
                "visible",
                "hidden",
                "updated_at",
            }
            assert pk == ["user_id", "source_language_code", "target_language_code"]
            assert indexes == {"ix_user_external_dictionaries_user"}

            migrate("downgrade", "0026_lesson_tags")
            async with engine.connect() as c:
                tables = await c.run_sync(lambda conn: inspect(conn).get_table_names())
            assert "user_external_dictionaries" not in tables
            assert "user_dictionary_layouts" not in tables
            migrate("upgrade", "heads")
        finally:
            await engine.dispose()
