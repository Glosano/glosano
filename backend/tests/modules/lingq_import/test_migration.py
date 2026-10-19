"""0029 adds vocabulary_import_jobs and import_source, and rolls back cleanly."""

import os
import subprocess
import sys
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine
from testcontainers.postgres import PostgresContainer

BACKEND_ROOT = Path(__file__).resolve().parents[3]


async def _constraints(conn: AsyncConnection) -> set[str]:
    rows = await conn.execute(
        text(
            "SELECT conname FROM pg_constraint WHERE conname LIKE 'ck_vocabulary_import_jobs_%' "
            "OR conname LIKE 'ck_%_items_import_source'"
        )
    )
    return {row[0] for row in rows}


async def _import_source_columns(conn: AsyncConnection) -> set[str]:
    rows = await conn.execute(
        text(
            "SELECT table_name FROM information_schema.columns "
            "WHERE column_name = 'import_source' AND table_schema = 'public'"
        )
    )
    return {row[0] for row in rows}


async def test_vocabulary_import_migration_roundtrip() -> None:
    with PostgresContainer("postgres:16-alpine", driver="asyncpg") as pg:
        url = pg.get_connection_url()
        env = {**os.environ, "GLOSANO_DATABASE_URL": url}

        def migrate(target: str, *, downgrade: bool = False) -> None:
            result = subprocess.run(  # noqa: S603 -- fixed migration executable
                [sys.executable, "-m", "alembic", "downgrade" if downgrade else "upgrade", target],
                cwd=BACKEND_ROOT,
                env=env,
                capture_output=True,
                text=True,
                check=False,
            )
            assert result.returncode == 0, result.stdout + result.stderr

        engine = create_async_engine(url)
        migrate("0029_vocabulary_import")
        async with engine.connect() as conn:
            columns = {
                row[0]
                for row in await conn.execute(
                    text(
                        "SELECT column_name FROM information_schema.columns "
                        "WHERE table_name = 'vocabulary_import_jobs'"
                    )
                )
            }
            assert columns == {
                "id",
                "user_id",
                "language_code",
                "source",
                "conflict_mode",
                "status",
                "total",
                "processed",
                "created_tokens",
                "created_phrases",
                "updated_items",
                "known_words",
                "skipped",
                "issues_json",
                "meta_json",
                "error_code",
                "created_at",
                "finished_at",
            }
            assert await _constraints(conn) == {
                "ck_vocabulary_import_jobs_source",
                "ck_vocabulary_import_jobs_conflict_mode",
                "ck_vocabulary_import_jobs_status",
                "ck_token_items_import_source",
                "ck_phrase_items_import_source",
            }
            assert await _import_source_columns(conn) == {"token_items", "phrase_items"}
            index = (
                await conn.execute(
                    text(
                        "SELECT indexdef FROM pg_indexes "
                        "WHERE indexname = 'uq_vocabulary_import_jobs_running'"
                    )
                )
            ).scalar_one()
            assert "UNIQUE" in index and "status" in index

        migrate("0028_native_language", downgrade=True)
        async with engine.connect() as conn:
            assert await _constraints(conn) == set()
            assert await _import_source_columns(conn) == set()
            assert (
                await conn.execute(text("SELECT to_regclass('vocabulary_import_jobs')"))
            ).scalar_one() is None

        migrate("0029_vocabulary_import")
        async with engine.connect() as conn:
            assert await _import_source_columns(conn) == {"token_items", "phrase_items"}
        await engine.dispose()


async def test_issues_dropped_migration_roundtrip() -> None:
    with PostgresContainer("postgres:16-alpine", driver="asyncpg") as pg:
        url = pg.get_connection_url()
        env = {**os.environ, "GLOSANO_DATABASE_URL": url}

        def migrate(target: str, *, downgrade: bool = False) -> None:
            result = subprocess.run(  # noqa: S603 -- fixed migration executable
                [sys.executable, "-m", "alembic", "downgrade" if downgrade else "upgrade", target],
                cwd=BACKEND_ROOT,
                env=env,
                capture_output=True,
                text=True,
                check=False,
            )
            assert result.returncode == 0, result.stdout + result.stderr

        async def column(conn: AsyncConnection) -> tuple[str, str | None] | None:
            row = (
                await conn.execute(
                    text(
                        "SELECT is_nullable, column_default FROM information_schema.columns "
                        "WHERE table_name = 'vocabulary_import_jobs' "
                        "AND column_name = 'issues_dropped'"
                    )
                )
            ).first()
            return (row[0], row[1]) if row is not None else None

        engine = create_async_engine(url)
        migrate("0029_vocabulary_import")
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    "INSERT INTO users (id, email, password_hash, role, is_active) "
                    "VALUES (gen_random_uuid(), 'm@t.io', 'x', 'learner', true)"
                )
            )
            await conn.execute(
                text(
                    "INSERT INTO vocabulary_import_jobs "
                    "(id, user_id, language_code, source, conflict_mode, status) "
                    "SELECT gen_random_uuid(), id, 'pt', 'csv', 'keep', 'done' FROM users"
                )
            )
        migrate("0030_import_issues_dropped")
        async with engine.connect() as conn:
            assert await column(conn) == ("NO", "0")
            assert (
                await conn.execute(text("SELECT issues_dropped FROM vocabulary_import_jobs"))
            ).scalar_one() == 0

        migrate("0029_vocabulary_import", downgrade=True)
        async with engine.connect() as conn:
            assert await column(conn) is None
        await engine.dispose()
