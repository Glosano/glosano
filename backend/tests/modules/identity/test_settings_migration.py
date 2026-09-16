"""Upgrade preserves legacy data; downgrade never exposes personal caches."""

import os
import subprocess
import sys
import uuid
from pathlib import Path

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from testcontainers.postgres import PostgresContainer

from flinq.modules.identity.repo import UserRepo
from flinq.modules.lesson_library.models import Lesson
from flinq.modules.reader_state.models import LessonSegmentTranslation

BACKEND_ROOT = Path(__file__).resolve().parents[3]


async def test_translation_migration_preserves_legacy_and_refuses_unsafe_downgrade() -> None:
    with PostgresContainer("postgres:16-alpine", driver="asyncpg") as pg:
        url = pg.get_connection_url()
        env = {**os.environ, "FLINQ_DATABASE_URL": url}

        def migrate(target: str, *, downgrade: bool = False, succeeds: bool = True) -> None:
            result = subprocess.run(  # noqa: S603 -- fixed migration executable
                [sys.executable, "-m", "alembic", "downgrade" if downgrade else "upgrade", target],
                cwd=BACKEND_ROOT,
                env=env,
                capture_output=True,
                text=True,
                check=False,
            )
            if succeeds:
                assert result.returncode == 0, result.stdout + result.stderr
            else:
                assert result.returncode != 0
                assert "Archive personal sentence translations" in result.stderr

        migrate("0016_statistics")
        engine = create_async_engine(url)
        async with AsyncSession(engine, expire_on_commit=False) as session:
            user = await UserRepo(session).create(
                email="migration@example.com", password_hash="hash", display_name="Migration"
            )
            user.profile.ui_language_code = "ru"
            user.settings.preferred_translation_language_code = "pt"
            lesson = Lesson(owner_user_id=user.id, language_code="pt", title="T", raw_text="cada")
            session.add(lesson)
            await session.flush()
            segment_id = uuid.uuid4()
            await session.execute(
                text(
                    "INSERT INTO lesson_segments (id, lesson_id, ordinal, segment_type, text, "
                    "start_char_offset, end_char_offset) "
                    "VALUES (:id, :lesson, 0, 'sentence', 'cada', 0, 4)"
                ),
                {"id": segment_id, "lesson": lesson.id},
            )
            legacy_id = uuid.uuid4()
            await session.execute(
                text("""INSERT INTO lesson_segment_translations
                (id, segment_id, target_language_code, translation_text, source, model)
                VALUES (:id, :segment, 'en', 'legacy', 'ai', 'old')"""),
                {"id": legacy_id, "segment": segment_id},
            )
            user_id = user.id
            await session.commit()
        migrate("0017_ui_language_translation")
        async with AsyncSession(engine) as session:
            user = await UserRepo(session).get_by_id_full(user_id)
            assert user and user.settings.preferred_translation_language_code == "ru"
            legacy = await session.get(LessonSegmentTranslation, legacy_id)
            assert legacy and legacy.user_id is None and legacy.translation_text == "legacy"
            session.add(
                LessonSegmentTranslation(
                    user_id=user_id,
                    segment_id=segment_id,
                    target_language_code="en",
                    translation_text="personal",
                    model="new",
                )
            )
            await session.commit()
        migrate("0016_statistics", downgrade=True, succeeds=False)
        async with AsyncSession(engine) as session:
            assert len((await session.scalars(select(LessonSegmentTranslation))).all()) == 2
            assert (
                await session.scalar(text("SELECT version_num FROM alembic_version"))
                == "0017_ui_language_translation"
            )
            # Test-only cleanup of newly seeded personal rows allows a lossless legacy downgrade.
            await session.execute(
                text("DELETE FROM lesson_segment_translations WHERE user_id IS NOT NULL")
            )
            await session.commit()
        migrate("0016_statistics", downgrade=True)
        async with engine.connect() as conn:
            assert (
                await conn.scalar(text("SELECT translation_text FROM lesson_segment_translations"))
                == "legacy"
            )
        migrate("0017_ui_language_translation")
        async with engine.connect() as conn:
            assert await conn.scalar(text("SELECT count(*) FROM lesson_segment_translations")) == 1
        await engine.dispose()
