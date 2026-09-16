import asyncio
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from glosano.core.db import session_scope
from glosano.modules.identity.repo import UserRepo
from glosano.modules.lesson_library.models import (
    Lesson,
    LessonImportJob,
    LessonMediaSource,
    LessonSegment,
)
from glosano.modules.lesson_library.service import delete_lesson
from glosano.modules.lesson_library.video_import import (
    create_video_import,
    expire_imports,
    retry_video_import,
    run_video_import,
)
from glosano.modules.lesson_library.video_segments import Cue
from glosano.modules.lesson_library.youtube import VideoImportError, VideoResult


async def make_import() -> tuple[uuid.UUID, uuid.UUID, uuid.UUID]:
    async with session_scope() as s:
        user = await UserRepo(s).create(
            email=f"{uuid.uuid4()}@example.com", password_hash="hash", display_name="Video"
        )
        lesson, job, _ = await create_video_import(
            s,
            user_id=user.id,
            url="https://youtu.be/M7lc1UVf-VE",
            language_code="en",
            request_id=uuid.uuid4(),
        )
        return user.id, lesson.id, job.id


def result() -> VideoResult:
    return VideoResult("M7lc1UVf-VE", "Video", None, "en", True, [Cue("Hello world.", 0, 1000)])


async def test_failed_retry_and_late_attempt_cannot_publish(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    owner, lesson_id, old_job = await make_import()
    started, release = asyncio.Event(), asyncio.Event()

    async def blocked(*args: Any) -> VideoResult:
        started.set()
        await release.wait()
        return result()

    monkeypatch.setattr(
        "glosano.modules.lesson_library.youtube.YouTubeTranscriptProvider.acquire", blocked
    )
    task = asyncio.create_task(run_video_import(lesson_id, old_job))
    await started.wait()
    # A duplicate delivery must finish while acquisition is waiting, without another acquisition.
    await asyncio.wait_for(run_video_import(lesson_id, old_job), 2)
    async with session_scope() as s:
        job = await s.get(LessonImportJob, old_job)
        assert job is not None
        job.lease_expires_at = datetime.now(UTC) - timedelta(seconds=1)
    async with session_scope() as s:
        assert await expire_imports(s) == 1
    async with session_scope() as s:
        _, retry = await retry_video_import(s, lesson_id, owner)
        retry_id = retry.id
    release.set()
    await task
    async with session_scope() as s:
        lesson = await s.get(Lesson, lesson_id)
        assert lesson is not None and lesson.status == "processing"
        assert not list(
            await s.scalars(
                select(LessonMediaSource).where(LessonMediaSource.lesson_id == lesson_id)
            )
        )
    await run_video_import(lesson_id, retry_id)
    async with session_scope() as s:
        lesson = await s.get(Lesson, lesson_id)
        assert lesson is not None and lesson.status == "ready"


async def test_delete_during_acquisition_is_noop(monkeypatch: pytest.MonkeyPatch) -> None:
    owner, lesson_id, job_id = await make_import()

    async def acquire(*args: Any) -> VideoResult:
        async with session_scope() as s:
            await delete_lesson(s, lesson_id=lesson_id, user_id=owner)
        return result()

    monkeypatch.setattr(
        "glosano.modules.lesson_library.youtube.YouTubeTranscriptProvider.acquire", acquire
    )
    await run_video_import(lesson_id, job_id)
    async with session_scope() as s:
        assert await s.get(Lesson, lesson_id) is None
        assert await s.get(LessonImportJob, job_id) is None


async def test_publication_rollback_records_safe_failed_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _, lesson_id, job_id = await make_import()

    async def acquire(*args: Any) -> VideoResult:
        return result()

    async def fail(session: AsyncSession, *args: Any, **kwargs: Any) -> None:
        # A real constraint error invalidates this transaction after media insertion.
        session.add(
            LessonSegment(
                lesson_id=lesson_id, ordinal=0, text=None, start_char_offset=0, end_char_offset=1
            )
        )
        await session.flush()

    monkeypatch.setattr(
        "glosano.modules.lesson_library.youtube.YouTubeTranscriptProvider.acquire", acquire
    )
    monkeypatch.setattr("glosano.modules.lesson_library.video_import.process_lesson_import", fail)
    await run_video_import(lesson_id, job_id)
    async with session_scope() as s:
        lesson = await s.get(Lesson, lesson_id)
        job = await s.get(LessonImportJob, job_id)
        assert lesson is not None and lesson.status == "failed" and lesson.raw_text == ""
        assert job is not None and job.error_message == "import_failed"
        assert not list(
            await s.scalars(
                select(LessonMediaSource).where(LessonMediaSource.lesson_id == lesson_id)
            )
        )


async def test_provider_error_is_safe_and_retryable(monkeypatch: pytest.MonkeyPatch) -> None:
    owner, lesson_id, job_id = await make_import()

    async def acquire(*args: Any) -> VideoResult:
        raise VideoImportError("network_error", True)

    monkeypatch.setattr(
        "glosano.modules.lesson_library.youtube.YouTubeTranscriptProvider.acquire", acquire
    )
    await run_video_import(lesson_id, job_id)
    async with session_scope() as s:
        _, retry = await retry_video_import(s, lesson_id, owner)
        assert retry.id != job_id


async def test_worker_maintenance_expires_abandoned_jobs(monkeypatch: pytest.MonkeyPatch) -> None:
    from glosano.worker import broker as worker_broker

    _, lesson_id, job_id = await make_import()
    async with session_scope() as s:
        job = await s.get(LessonImportJob, job_id)
        assert job is not None
        job.lease_expires_at = datetime.now(UTC) - timedelta(seconds=1)
    cleaned = asyncio.Event()

    @asynccontextmanager
    async def committed_cleanup_session() -> AsyncIterator[AsyncSession]:
        async with session_scope() as session:
            yield session
        # Observations from another connection must wait for the worker's commit,
        # not only for expire_imports to return inside its open transaction.
        cleaned.set()

    monkeypatch.setattr(worker_broker, "session_scope", committed_cleanup_session)
    task = asyncio.create_task(worker_broker.run_import_maintenance())
    try:
        await asyncio.wait_for(cleaned.wait(), 3)
        async with session_scope() as s:
            job = await s.get(LessonImportJob, job_id)
            lesson = await s.get(Lesson, lesson_id)
            assert job is not None and job.status == "failed"
            assert lesson is not None and lesson.status == "failed"
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)


async def test_retry_and_cleanup_use_job_before_lesson_lock_order(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from glosano.modules.lesson_library.repo import LessonRepo

    owner, lesson_id, job_id = await make_import()
    async with session_scope() as s:
        job = await s.get(LessonImportJob, job_id)
        assert job is not None
        job.lease_expires_at = datetime.now(UTC) - timedelta(seconds=1)
    cleanup_holds_job = asyncio.Event()
    retry_waits_for_jobs = asyncio.Event()
    release_cleanup = asyncio.Event()
    lock_lesson = LessonRepo.lock_lesson
    lock_jobs = LessonRepo.lock_import_jobs

    async def guarded_lesson(repo: LessonRepo, target: uuid.UUID) -> Lesson | None:
        task = asyncio.current_task()
        if task is not None and task.get_name() == "expire-import-race":
            cleanup_holds_job.set()
            await release_cleanup.wait()
        return await lock_lesson(repo, target)

    async def guarded_jobs(repo: LessonRepo, target: uuid.UUID) -> None:
        retry_waits_for_jobs.set()
        await lock_jobs(repo, target)

    monkeypatch.setattr(LessonRepo, "lock_lesson", guarded_lesson)
    monkeypatch.setattr(LessonRepo, "lock_import_jobs", guarded_jobs)

    async def cleanup() -> None:
        async with session_scope() as s:
            await expire_imports(s)

    async def retry() -> None:
        async with session_scope() as s:
            lesson, job = await retry_video_import(s, lesson_id, owner)
            assert lesson.status == "processing"
            assert job.status == "pending"

    cleanup_task = asyncio.create_task(cleanup(), name="expire-import-race")
    retry_task = None
    try:
        await asyncio.wait_for(cleanup_holds_job.wait(), 2)
        retry_task = asyncio.create_task(retry())
        await asyncio.wait_for(retry_waits_for_jobs.wait(), 2)
        release_cleanup.set()
        await asyncio.wait_for(asyncio.gather(cleanup_task, retry_task), 3)
    finally:
        cleanup_task.cancel()
        if retry_task is not None:
            retry_task.cancel()
        await asyncio.gather(
            cleanup_task, *([retry_task] if retry_task else []), return_exceptions=True
        )


async def test_expiration_rechecks_renewed_lease_after_waiting_for_job(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from glosano.modules.lesson_library.repo import LessonRepo

    _, lesson_id, job_id = await make_import()
    async with session_scope() as s:
        job = await s.get(LessonImportJob, job_id)
        assert job is not None
        job.lease_expires_at = datetime.now(UTC) - timedelta(seconds=1)
    cleanup_waiting = asyncio.Event()
    lock_job = LessonRepo.lock_job

    async def guarded_job(repo: LessonRepo, target: uuid.UUID) -> LessonImportJob | None:
        cleanup_waiting.set()
        return await lock_job(repo, target)

    async def cleanup() -> int:
        async with session_scope() as s:
            return await expire_imports(s)

    async with session_scope() as claim:
        job = await LessonRepo(claim).lock_job(job_id)
        assert job is not None
        job.status = "running"
        job.lease_expires_at = datetime.now(UTC) + timedelta(seconds=150)
        await claim.flush()
        monkeypatch.setattr(LessonRepo, "lock_job", guarded_job)
        task = asyncio.create_task(cleanup())
        await asyncio.wait_for(cleanup_waiting.wait(), 2)
        await claim.commit()
    assert await asyncio.wait_for(task, 3) == 0
    async with session_scope() as s:
        job = await s.get(LessonImportJob, job_id)
        lesson = await s.get(Lesson, lesson_id)
        assert job is not None and job.status == "running"
        assert lesson is not None and lesson.status == "processing"
