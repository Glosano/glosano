"""The video schema upgrades real historical PostgreSQL facts without reprocessing."""

import os
import subprocess
import sys
import uuid
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from testcontainers.postgres import PostgresContainer


async def test_video_migration_round_trip_preserves_text_facts() -> None:
    with PostgresContainer("postgres:16-alpine", driver="asyncpg") as pg:
        url = pg.get_connection_url()

        def migrate(direction: str, revision: str) -> None:
            result = subprocess.run(  # noqa: S603 -- fixed Python and migration arguments
                [sys.executable, "-m", "alembic", direction, revision],
                cwd=Path(__file__).resolve().parents[3],
                env={**os.environ, "GLOSANO_DATABASE_URL": url},
                capture_output=True,
                text=True,
            )
            assert result.returncode == 0, result.stderr

        migrate("upgrade", "0018_reader_completion")
        engine = create_async_engine(url)
        user_id, lesson_id, segment_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
        async with engine.begin() as connection:
            await connection.execute(
                text(
                    "INSERT INTO users (id,email,password_hash,role,is_active) "
                    "VALUES (:id, 'video-migration@test', 'hash', 'learner', true)"
                ),
                {"id": user_id},
            )
            await connection.execute(
                text(
                    "INSERT INTO lessons "
                    "(id,owner_user_id,language_code,title,raw_text,word_count,status,visibility) "
                    "VALUES (:id,:owner,'en','Text','Original',1,'ready','private')"
                ),
                {"id": lesson_id, "owner": user_id},
            )
            await connection.execute(
                text(
                    "INSERT INTO lesson_segments "
                    "(id,lesson_id,ordinal,segment_type,text,start_char_offset,end_char_offset) "
                    "VALUES (:id,:lesson,0,'sentence','Original',0,8)"
                ),
                {"id": segment_id, "lesson": lesson_id},
            )
        migrate("upgrade", "head")
        async with engine.connect() as connection:
            row = (
                await connection.execute(
                    text(
                        "SELECT text, media_start_ms, cue_intervals "
                        "FROM lesson_segments WHERE id=:id"
                    ),
                    {"id": segment_id},
                )
            ).one()
            assert tuple(row) == ("Original", None, None)
            assert await connection.scalar(text("SELECT count(*) FROM lesson_media_sources")) == 0
        migrate("downgrade", "0018_reader_completion")
        async with engine.connect() as connection:
            assert (
                await connection.scalar(
                    text("SELECT text FROM lesson_segments WHERE id=:id"), {"id": segment_id}
                )
                == "Original"
            )
        await engine.dispose()
