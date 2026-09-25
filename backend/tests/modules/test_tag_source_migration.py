"""Existing personal tags remain manual after the additive migration."""

import os
import subprocess
import sys
import uuid
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from testcontainers.postgres import PostgresContainer


async def test_tag_source_migration_preserves_legacy_tags() -> None:
    with PostgresContainer("postgres:16-alpine", driver="asyncpg") as pg:
        url = pg.get_connection_url()

        def migrate(command: str, target: str) -> None:
            result = subprocess.run(  # noqa: S603 -- fixed migration command
                [sys.executable, "-m", "alembic", command, target],
                cwd=Path(__file__).resolve().parents[2],
                env={**os.environ, "GLOSANO_DATABASE_URL": url},
                capture_output=True,
                text=True,
                check=False,
            )
            assert result.returncode == 0, result.stdout + result.stderr

        migrate("upgrade", "0022_chat_citation_offsets")
        engine = create_async_engine(url)
        ids = {"user": uuid.uuid4(), "tag": uuid.uuid4(), "item": uuid.uuid4()}
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    "INSERT INTO users (id,email,password_hash,role,is_active) "
                    "VALUES (:user,'legacy@example.com','unused','learner',true)"
                ),
                ids,
            )
            await conn.execute(
                text(
                    "INSERT INTO item_tags (id,owner_user_id,item_kind,item_id,tag_name) "
                    "VALUES (:tag,:user,'token',:item,'legacy')"
                ),
                ids,
            )
        migrate("upgrade", "0023_item_tag_source")
        async with engine.connect() as conn:
            row = (await conn.execute(text("SELECT tag_name, source_type FROM item_tags"))).one()
            assert tuple(row) == ("legacy", "user")
        migrate("downgrade", "0022_chat_citation_offsets")
        async with engine.connect() as conn:
            assert (
                await conn.execute(text("SELECT tag_name FROM item_tags"))
            ).scalar_one() == "legacy"
        # Verify coexistence with any local development branches as well.
        migrate("upgrade", "heads")
        await engine.dispose()
