"""The committed migration works alone and alongside the local numeric branch."""

import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest
from sqlalchemy import Connection, inspect, text
from sqlalchemy.ext.asyncio import create_async_engine
from testcontainers.postgres import PostgresContainer

from glosano.core.db import Base


def column_names(connection: Connection, name: str) -> set[str]:
    return {c["name"] for c in inspect(connection).get_columns(name)}


@pytest.mark.parametrize("feature_only", [True, False])
async def test_chat_migration_graphs_roundtrip(tmp_path: Path, feature_only: bool) -> None:
    backend = Path(__file__).resolve().parents[3]  # noqa: ASYNC240 -- local test fixture
    migration_dir = tmp_path / "migrations"
    shutil.copytree(backend / "migrations", migration_dir)
    if feature_only:
        for path in migration_dir.joinpath("versions").glob("*.py"):
            if path.name in {"0020_numeric_tokens.py", "0021_local_chat_numeric_merge.py"}:
                path.unlink()
    config = tmp_path / "alembic.ini"
    config.write_text(
        (backend / "alembic.ini")
        .read_text()
        .replace("script_location = migrations", f"script_location = {migration_dir}")
    )
    with PostgresContainer("postgres:16-alpine", driver="asyncpg") as pg:
        url = pg.get_connection_url()

        def migrate(direction: str, revision: str) -> None:
            result = subprocess.run(  # noqa: S603 -- fixed local migration commands
                [sys.executable, "-m", "alembic", "-c", str(config), direction, revision],
                cwd=backend,
                env={**os.environ, "GLOSANO_DATABASE_URL": url},
                capture_output=True,
                text=True,
            )
            assert result.returncode == 0, result.stderr

        migrate("upgrade", "heads")
        engine = create_async_engine(url)
        async with engine.connect() as conn:
            for name, table in Base.metadata.tables.items():
                if name.startswith("chat_"):
                    columns = await conn.run_sync(column_names, name)
                    assert columns == set(table.c.keys())
            revisions = list(
                (await conn.execute(text("SELECT version_num FROM alembic_version"))).scalars()
            )
            if feature_only:
                assert revisions == ["0022_chat_citation_offsets"]
            elif (migration_dir / "versions/0021_local_chat_numeric_merge.py").exists():
                assert revisions == ["0021_local_chat_numeric_merge"]
            else:
                assert "0022_chat_citation_offsets" in revisions
        migrate("downgrade", "0019_youtube_materials")
        async with engine.connect() as conn:
            tables = await conn.run_sync(lambda c: inspect(c).get_table_names())
            assert "chat_conversations" not in tables
            assert "lessons" in tables
        await engine.dispose()
