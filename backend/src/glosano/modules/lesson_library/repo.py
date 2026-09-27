"""Lesson repository: library feed queries, create, and pipeline-fact persistence."""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date

from sqlalchemy import Date, and_, cast, delete, func, or_, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.elements import ColumnElement

from glosano.modules.lesson_library.models import (
    Lesson,
    LessonImportJob,
    LessonSegment,
    LessonSource,
    LessonTag,
    LessonTokenOccurrence,
)
from glosano.modules.reader_state.models import ReaderPosition


@dataclass(frozen=True)
class HistoryDay:
    day: date
    total: int
    lessons: list[Lesson]


class LessonRepo:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    @staticmethod
    def _visible(
        user_id: uuid.UUID, lang: str, q: str | None, tags: Sequence[str] = ()
    ) -> list[ColumnElement[bool]]:
        filters: list[ColumnElement[bool]] = [
            Lesson.language_code == lang,
            Lesson.status != "archived",
            or_(Lesson.owner_user_id == user_id, Lesson.visibility == "shared"),
        ]
        if q:
            filters.append(Lesson.title.ilike(f"%{q}%"))
        # Every selected tag must be on the lesson, and only the viewer's own tags count.
        filters.extend(
            select(LessonTag.lesson_id)
            .where(
                LessonTag.user_id == user_id,
                LessonTag.lesson_id == Lesson.id,
                LessonTag.tag == tag,
            )
            .exists()
            for tag in tags
        )
        return filters

    async def list_continue(
        self,
        *,
        user_id: uuid.UUID,
        lang: str,
        q: str | None,
        tags: Sequence[str] = (),
        limit: int,
    ) -> list[Lesson]:
        stmt = (
            select(Lesson)
            .join(
                ReaderPosition,
                and_(ReaderPosition.lesson_id == Lesson.id, ReaderPosition.user_id == user_id),
            )
            .where(
                *self._visible(user_id, lang, q, tags),
                ReaderPosition.last_activity_at.is_not(None),
                ReaderPosition.completed_at.is_(None),
            )
            .order_by(ReaderPosition.last_activity_at.desc(), Lesson.id)
            .limit(limit)
        )
        return list((await self.session.scalars(stmt)).all())

    async def timezone_exists(self, tz: str) -> bool:
        # Дни считает Postgres (timezone()), поэтому и допустимость пояса
        # проверяется по его базе, а не по zoneinfo процесса. Сравнение без
        # учёта регистра — как у самого timezone().
        stmt = text(
            "SELECT EXISTS (SELECT 1 FROM pg_timezone_names WHERE lower(name) = lower(:tz))"
        )
        return bool(await self.session.scalar(stmt, {"tz": tz}))

    async def list_history_days(
        self,
        *,
        user_id: uuid.UUID,
        lang: str,
        q: str | None,
        tags: Sequence[str] = (),
        tz: str,
        before: date | None,
        days: int,
        per_day: int = 100,
    ) -> tuple[list[HistoryDay], date | None]:
        # День считается один раз во внутреннем подзапросе: одинаковое выражение
        # с bind-параметром tz в SELECT и GROUP BY Postgres не сопоставит.
        dated = (
            select(
                Lesson.id.label("id"),
                Lesson.created_at.label("created_at"),
                cast(func.timezone(tz, Lesson.created_at), Date).label("day"),
            )
            .where(*self._visible(user_id, lang, q, tags))
            .subquery()
        )
        day_stmt = select(dated.c.day).group_by(dated.c.day).order_by(dated.c.day.desc())
        if before is not None:
            day_stmt = day_stmt.where(dated.c.day < before)
        found = list((await self.session.scalars(day_stmt.limit(days + 1))).all())
        page_days = found[:days]
        if not page_days:
            return [], None

        ranked = (
            select(
                dated.c.id,
                dated.c.day,
                func.row_number()
                .over(
                    partition_by=dated.c.day,
                    order_by=(dated.c.created_at.desc(), dated.c.id),
                )
                .label("rn"),
                func.count().over(partition_by=dated.c.day).label("total"),
            )
            .where(dated.c.day.in_(page_days))
            .subquery()
        )
        rows = (
            await self.session.execute(
                select(Lesson, ranked.c.day, ranked.c.total)
                .join(ranked, ranked.c.id == Lesson.id)
                .where(ranked.c.rn <= per_day)
                .order_by(ranked.c.day.desc(), Lesson.created_at.desc(), Lesson.id)
            )
        ).all()
        grouped: dict[date, tuple[int, list[Lesson]]] = {}
        for lesson, day, total in rows:
            grouped.setdefault(day, (total, []))[1].append(lesson)
        result = [
            HistoryDay(day=day, total=grouped[day][0], lessons=grouped[day][1]) for day in page_days
        ]
        return result, (page_days[-1] if len(found) > days else None)

    async def create_processing_lesson(
        self,
        *,
        owner_user_id: uuid.UUID,
        title: str,
        language_code: str,
        raw_text: str,
        visibility: str,
    ) -> Lesson:
        lesson = Lesson(
            owner_user_id=owner_user_id,
            title=title,
            language_code=language_code,
            raw_text=raw_text,
            visibility=visibility,
            word_count=0,
            segment_count=0,
            current_source_version=1,
            status="processing",
        )
        self.session.add(lesson)
        await self.session.flush()
        return lesson

    async def add_tags(
        self, *, user_id: uuid.UUID, lesson_id: uuid.UUID, tags: Sequence[str]
    ) -> None:
        """Attach the user's tags to a lesson, keeping tags that are already there."""
        if not tags:
            return
        await self.session.execute(
            pg_insert(LessonTag)
            .values([{"user_id": user_id, "lesson_id": lesson_id, "tag": tag} for tag in tags])
            .on_conflict_do_nothing()
        )

    async def replace_tags(
        self, *, user_id: uuid.UUID, lesson_id: uuid.UUID, tags: Sequence[str]
    ) -> None:
        await self.session.execute(
            delete(LessonTag).where(LessonTag.user_id == user_id, LessonTag.lesson_id == lesson_id)
        )
        await self.add_tags(user_id=user_id, lesson_id=lesson_id, tags=tags)

    async def tags_for_lessons(
        self, *, user_id: uuid.UUID, lesson_ids: Sequence[uuid.UUID]
    ) -> dict[uuid.UUID, list[str]]:
        rows = await self.session.execute(
            select(LessonTag.lesson_id, LessonTag.tag)
            .where(LessonTag.user_id == user_id, LessonTag.lesson_id.in_(lesson_ids))
            .order_by(LessonTag.lesson_id, LessonTag.tag)
        )
        result: dict[uuid.UUID, list[str]] = {}
        for lesson_id, tag in rows.tuples():
            result.setdefault(lesson_id, []).append(tag)
        return result

    async def list_tag_counts(self, *, user_id: uuid.UUID, lang: str) -> list[tuple[str, int]]:
        """The viewer's tags on lessons they can currently see in this language."""
        rows = await self.session.execute(
            select(LessonTag.tag, func.count())
            .join(Lesson, Lesson.id == LessonTag.lesson_id)
            .where(LessonTag.user_id == user_id, *self._visible(user_id, lang, None))
            .group_by(LessonTag.tag)
            .order_by(LessonTag.tag)
        )
        return [(tag, count) for tag, count in rows.tuples()]

    async def add_source(
        self,
        *,
        lesson_id: uuid.UUID,
        content_hash: str,
        source_type: str = "manual",
        original_filename: str | None = None,
        version_number: int = 1,
        source_uri: str | None = None,
        author: str | None = None,
        license_name: str | None = None,
        source_label: str | None = None,
    ) -> LessonSource:
        source = LessonSource(
            lesson_id=lesson_id,
            content_hash=content_hash,
            source_type=source_type,
            original_filename=original_filename,
            version_number=version_number,
            source_uri=source_uri,
            author=author,
            license=license_name,
            source_label=source_label,
        )
        self.session.add(source)
        await self.session.flush()
        return source

    async def get_source(self, lesson_id: uuid.UUID, version_number: int) -> LessonSource | None:
        return await self.session.scalar(
            select(LessonSource)
            .where(
                LessonSource.lesson_id == lesson_id,
                LessonSource.version_number == version_number,
            )
            .order_by(LessonSource.created_at.desc())
            .limit(1)
        )

    async def add_import_job(
        self,
        *,
        lesson_id: uuid.UUID,
        requested_by_user_id: uuid.UUID,
        job_type: str = "import_text",
    ) -> LessonImportJob:
        job = LessonImportJob(
            lesson_id=lesson_id,
            requested_by_user_id=requested_by_user_id,
            job_type=job_type,
            status="pending",
        )
        self.session.add(job)
        await self.session.flush()
        return job

    async def get_lesson(self, lesson_id: uuid.UUID) -> Lesson | None:
        return await self.session.get(Lesson, lesson_id)

    async def lock_lesson(self, lesson_id: uuid.UUID) -> Lesson | None:
        """Fetch a lesson with a row-level lock (FOR UPDATE).

        Serializes concurrent/duplicate import runs for the same lesson so the
        delete-and-recreate of facts cannot interleave.
        """
        stmt = select(Lesson).where(Lesson.id == lesson_id).with_for_update()
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def get_job(self, job_id: uuid.UUID) -> LessonImportJob | None:
        return await self.session.get(LessonImportJob, job_id)

    async def lock_job(self, job_id: uuid.UUID) -> LessonImportJob | None:
        """Fetch an import job with a row-level lock (FOR UPDATE).

        Lets the worker enforce a single pending/running transition even under
        duplicate task delivery.
        """
        stmt = select(LessonImportJob).where(LessonImportJob.id == job_id).with_for_update()
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def lock_import_jobs(self, lesson_id: uuid.UUID) -> None:
        """Use the worker's job-before-lesson lock order for edit/delete."""
        await self.session.execute(
            select(LessonImportJob)
            .where(LessonImportJob.lesson_id == lesson_id)
            .order_by(LessonImportJob.id)
            .with_for_update()
        )

    async def delete_facts(self, lesson_id: uuid.UUID) -> None:
        """Remove all segments + occurrences for a lesson (occurrences first)."""
        await self.session.execute(
            delete(LessonTokenOccurrence).where(LessonTokenOccurrence.lesson_id == lesson_id)
        )
        await self.session.execute(
            delete(LessonSegment).where(LessonSegment.lesson_id == lesson_id)
        )
        await self.session.flush()
