"""The chat migrations sit in a single linear graph and roundtrip cleanly."""

import os
import subprocess
import sys
from pathlib import Path

from sqlalchemy import Connection, inspect, text
from sqlalchemy.ext.asyncio import create_async_engine
from testcontainers.postgres import PostgresContainer

from glosano.core.db import Base


def column_names(connection: Connection, name: str) -> set[str]:
    return {c["name"] for c in inspect(connection).get_columns(name)}


async def test_chat_migration_graph_roundtrip() -> None:
    backend = Path(__file__).resolve().parents[3]  # noqa: ASYNC240 -- local test fixture
    with PostgresContainer("postgres:16-alpine", driver="asyncpg") as pg:
        url = pg.get_connection_url()

        def migrate(direction: str, revision: str) -> None:
            result = subprocess.run(  # noqa: S603 -- fixed local migration commands
                [sys.executable, "-m", "alembic", direction, revision],
                cwd=backend,
                env={**os.environ, "GLOSANO_DATABASE_URL": url},
                capture_output=True,
                text=True,
            )
            assert result.returncode == 0, result.stderr

        # "head" (not "heads") fails if the graph ever forks again.
        migrate("upgrade", "head")
        engine = create_async_engine(url)
        async with engine.connect() as conn:
            for name, table in Base.metadata.tables.items():
                if name.startswith("chat_"):
                    columns = await conn.run_sync(column_names, name)
                    assert columns == set(table.c.keys())
            revisions = list(
                (await conn.execute(text("SELECT version_num FROM alembic_version"))).scalars()
            )
            assert len(revisions) == 1
        migrate("downgrade", "0019_youtube_materials")
        async with engine.connect() as conn:
            tables = await conn.run_sync(lambda c: inspect(c).get_table_names())
            assert "chat_conversations" not in tables
            assert "lessons" in tables
        await engine.dispose()
