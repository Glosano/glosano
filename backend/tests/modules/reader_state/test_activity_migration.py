"""0025: бэкфилл last_activity_at только по признакам реальной работы (FLQ-36)."""

import os
import subprocess
import sys
import uuid
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import inspect, text
from sqlalchemy.ext.asyncio import create_async_engine
from testcontainers.postgres import PostgresContainer  # pyright: ignore[reportMissingTypeStubs]

LESSON_SQL = (
    "INSERT INTO lessons (id, owner_user_id, language_code, title, raw_text, word_count, "
    "segment_count, current_source_version, visibility, status) "
    # `title` gets its own bind param (not `:id` reused) — asyncpg refuses to
    # infer a single parameter's type as both uuid and varchar.
    "VALUES (:id, :user, 'pt', :title, 'x', 1, 1, 1, 'private', 'ready')"
)
POSITION_SQL = (
    "INSERT INTO reader_positions (id, user_id, lesson_id, view_mode, current_token_ordinal, "
    "completed_at) VALUES (:pid, :user, :id, 'page', 40, :completed)"
)


async def test_activity_backfill_and_roundtrip() -> None:
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

        migrate("upgrade", "0024_numeric_tokens")
        engine = create_async_engine(url)
        user = uuid.uuid4()
        opened, completed, paged, tracked = (uuid.uuid4() for _ in range(4))
        async with engine.begin() as c:
            await c.execute(
                text(
                    "INSERT INTO users (id,email,password_hash,role,is_active) "
                    "VALUES (:user,'backfill@example.com','unused','learner',true)"
                ),
                {"user": user},
            )
            for lesson in (opened, completed, paged, tracked):
                await c.execute(
                    text(LESSON_SQL), {"id": lesson, "user": user, "title": str(lesson)}
                )
                await c.execute(
                    text(POSITION_SQL),
                    {
                        "pid": uuid.uuid4(),
                        "user": user,
                        "id": lesson,
                        "completed": None
                        if lesson != completed
                        else datetime(2026, 9, 1, 10, 0, 0, tzinfo=UTC),
                    },
                )
            await c.execute(
                text(
                    "INSERT INTO bulk_actions (id, user_id, lesson_id, action_type, "
                    "page_fingerprint, payload_json) "
                    "VALUES (:id, :user, :lesson, 'bulk_known', '0:1', '{}'::jsonb)"
                ),
                {"id": uuid.uuid4(), "user": user, "lesson": paged},
            )
            await c.execute(
                text(
                    "INSERT INTO token_items (id, user_id, language_code, token_text, status, "
                    "confidence, created_from_lesson_id) "
                    "VALUES (:id, :user, 'pt', 'palavra', 'tracked', 1, :lesson)"
                ),
                {"id": uuid.uuid4(), "user": user, "lesson": tracked},
            )

        migrate("upgrade", "0025_lesson_activity")
        async with engine.connect() as c:
            result = await c.execute(
                text(
                    "SELECT lesson_id, last_activity_at = last_opened_at AS is_backfilled "
                    "FROM reader_positions"
                )
            )
            rows: dict[uuid.UUID, bool | None] = {}
            for row in result.all():
                rows[row.lesson_id] = row.is_backfilled
            assert rows == {opened: None, completed: True, paged: True, tracked: True}
        migrate("downgrade", "0024_numeric_tokens")
        async with engine.connect() as c:
            columns = await c.run_sync(lambda conn: inspect(conn).get_columns("reader_positions"))
            assert "last_activity_at" not in {column["name"] for column in columns}
        migrate("upgrade", "heads")
        await engine.dispose()
