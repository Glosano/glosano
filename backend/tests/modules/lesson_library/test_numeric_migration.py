"""Repair persisted numeric occurrences without losing user-authored vocabulary."""

import os
import subprocess
import sys
import uuid
from datetime import UTC, date, datetime
from pathlib import Path

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from testcontainers.postgres import PostgresContainer  # pyright: ignore[reportMissingTypeStubs]

from glosano.modules.identity.models import User
from glosano.modules.lesson_library.models import Lesson, LessonSegment, LessonTokenOccurrence
from glosano.modules.reader_state.models import ReaderPosition
from glosano.modules.review.models import ReviewItem
from glosano.modules.statistics.models import (
    DailyReadOccurrence,
    DailyUserLanguageStats,
    DailyUserStats,
)
from glosano.modules.vocabulary.models import ItemTag, PersonalNote, PersonalTranslation, TokenItem


async def test_numeric_migration_repairs_legacy_data() -> None:
    with PostgresContainer("postgres:16-alpine", driver="asyncpg") as pg:
        url = pg.get_connection_url()

        def migrate(target: str, command: str = "upgrade") -> None:
            result = subprocess.run(  # noqa: S603 -- fixed executable and migration targets
                [sys.executable, "-m", "alembic", command, target],
                cwd=Path(__file__).resolve().parents[3],
                env={**os.environ, "GLOSANO_DATABASE_URL": url},
                capture_output=True,
                text=True,
                check=False,
            )
            assert result.returncode == 0, result.stdout + result.stderr

        migrate("0019_youtube_materials")
        engine = create_async_engine(url)
        user_id, lesson_id, segment_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
        day = date(2026, 9, 16)
        surfaces = ["It's", "2020", "٢٠٢٠", "B2B", "___"]
        async with AsyncSession(engine) as s:
            s.add(User(id=user_id, email="numbers@example.com", password_hash="unused"))
            await s.flush()
            s.add(
                Lesson(
                    id=lesson_id,
                    owner_user_id=user_id,
                    language_code="en",
                    title="Numbers",
                    raw_text="It's 2020 ٢٠٢٠ B2B ___",
                    word_count=5,
                    segment_count=1,
                )
            )
            await s.flush()
            s.add(
                LessonSegment(
                    id=segment_id,
                    lesson_id=lesson_id,
                    ordinal=0,
                    text="It's 2020 ٢٠٢٠ B2B ___",
                    start_char_offset=0,
                    end_char_offset=22,
                )
            )
            await s.flush()
            offset = 0
            for i, surface in enumerate(surfaces):
                s.add(
                    LessonTokenOccurrence(
                        lesson_id=lesson_id,
                        segment_id=segment_id,
                        ordinal_in_lesson=i,
                        ordinal_in_segment=i,
                        surface_text=surface,
                        normalized_text=surface.lower().strip("_"),
                        start_char_offset=offset,
                        end_char_offset=offset + len(surface),
                        is_word_like=True,
                    )
                )
                offset += len(surface) + 1
                s.add(
                    DailyReadOccurrence(user_id=user_id, date=day, lesson_id=lesson_id, ordinal=i)
                )
            # Two historical reads no longer linked to a live lesson must survive.
            s.add(DailyUserStats(user_id=user_id, date=day, tokens_read=7))
            await s.flush()
            s.add(
                DailyUserLanguageStats(user_id=user_id, date=day, language_code="en", tokens_read=7)
            )
            for token, added_by, status in [
                ("2020", "bulk", "known"),
                ("٢٠٢٠", "bulk", "known"),
                ("B2B", "bulk", "known"),
                ("42", "user", "known"),
                ("43", "user", "tracked"),
            ]:
                s.add(
                    TokenItem(
                        user_id=user_id,
                        language_code="en",
                        token_text=token,
                        status=status,
                        added_by=added_by,
                        confidence=1 if status == "tracked" else None,
                    )
                )
            protected_ids = {token: uuid.uuid4() for token in ("44", "45", "46", "47")}
            for token, item_id in protected_ids.items():
                s.add(
                    TokenItem(
                        id=item_id,
                        user_id=user_id,
                        language_code="en",
                        token_text=token,
                        status="known",
                        added_by="bulk",
                    )
                )
            s.add(
                PersonalTranslation(
                    owner_user_id=user_id,
                    item_kind="token",
                    item_id=protected_ids["44"],
                    target_language_code="en",
                    translation_text="forty-four",
                    source_type="user",
                )
            )
            s.add(
                PersonalNote(
                    owner_user_id=user_id,
                    item_kind="token",
                    item_id=protected_ids["45"],
                    note_text="keep",
                )
            )
            # Seed the historical schema without fields introduced by later migrations.
            await s.execute(
                text(
                    "INSERT INTO item_tags (id, owner_user_id, item_kind, item_id, tag_name) "
                    "VALUES (:id, :user, 'token', :item, 'keep')"
                ),
                {"id": uuid.uuid4(), "user": user_id, "item": protected_ids["46"]},
            )
            s.add(
                ReviewItem(
                    user_id=user_id,
                    item_kind="token",
                    item_id=protected_ids["47"],
                    language_code="en",
                    algorithm_state_json={},
                    due_at=datetime.now(UTC),
                )
            )
            # reader_positions at 0019 predates last_activity_at (0025_lesson_activity).
            await s.execute(
                text(
                    "INSERT INTO reader_positions "
                    "(id, user_id, lesson_id, view_mode, current_segment_id, "
                    "current_token_ordinal) "
                    "VALUES (:id, :user, :lesson, 'page', :segment, 1)"
                ),
                {
                    "id": uuid.uuid4(),
                    "user": user_id,
                    "lesson": lesson_id,
                    "segment": segment_id,
                },
            )
            await s.commit()
        migrate("head")
        migrate("head")
        migrate("0019_youtube_materials", "downgrade")
        migrate("head")
        async with AsyncSession(engine) as s:
            rows = list(
                (
                    await s.scalars(
                        select(LessonTokenOccurrence).order_by(
                            LessonTokenOccurrence.ordinal_in_lesson
                        )
                    )
                ).all()
            )
            assert [row.is_word_like for row in rows] == [True, False, False, True, False]
            assert [row.surface_text for row in rows] == surfaces
            assert [row.ordinal_in_lesson for row in rows] == list(range(5))
            assert [row.start_char_offset for row in rows] == [0, 5, 10, 15, 19]
            lesson = await s.get(Lesson, lesson_id)
            assert lesson is not None and lesson.word_count == 2
            statuses = dict(
                (await s.execute(select(TokenItem.token_text, TokenItem.status))).tuples().all()
            )
            assert statuses == {
                "2020": "ignored",
                "٢٠٢٠": "ignored",
                "B2B": "known",
                "42": "known",
                "43": "tracked",
                "44": "known",
                "45": "known",
                "46": "known",
                "47": "known",
            }
            assert await s.scalar(select(PersonalTranslation.translation_text)) == "forty-four"
            assert await s.scalar(select(PersonalNote.note_text)) == "keep"
            assert await s.scalar(select(ItemTag.tag_name)) == "keep"
            assert await s.scalar(select(ReviewItem.item_id)) == protected_ids["47"]
            assert await s.scalar(select(ReaderPosition.current_token_ordinal)) == 1
            assert await s.scalar(select(DailyUserStats.tokens_read)) == 4
            assert await s.scalar(select(DailyUserLanguageStats.tokens_read)) == 4
            assert await s.scalar(text("SELECT count(*) FROM daily_read_occurrences")) == 2
        await engine.dispose()
