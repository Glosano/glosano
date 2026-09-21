"""Task registry. Import this module to register all Taskiq tasks."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from loguru import logger
from taskiq import TaskiqScheduler
from taskiq.schedule_sources import LabelScheduleSource

from glosano.core.db import session_scope
from glosano.modules.identity.repo import SessionRepo
from glosano.modules.lesson_library.repo import LessonRepo
from glosano.modules.lesson_library.service import (
    LessonNotProcessableError,
    process_lesson_import,
)
from glosano.worker.broker import broker


@broker.task
async def ping() -> str:
    """Smoke-test task used by tests and health scripts."""
    logger.info("ping task executed")
    return "pong"


@broker.task(schedule=[{"cron": "0 3 * * *"}])  # daily at 03:00
async def cleanup_expired_sessions() -> int:
    """Delete user_sessions rows whose expires_at is in the past (ADR-0008)."""
    async with session_scope() as s:
        deleted = await SessionRepo(s).cleanup_expired()
        if deleted:
            logger.info("cleanup_expired_sessions: removed {} sessions", deleted)
        return deleted


async def run_lesson_import(lesson_id: uuid.UUID, job_id: uuid.UUID) -> None:
    """Process an import for an EXACT job, end-to-end. Retry/duplicate-safe.

    Plain async function so tests and a future synchronous path can call it
    without a running worker. The taskiq task simply wraps this. The job row is
    locked FOR UPDATE and only a pending/running job is run, so duplicate task
    delivery becomes a no-op instead of double-processing.
    """
    async with session_scope() as session:
        job = await LessonRepo(session).get_job(job_id)
        is_video = job is not None and job.job_type == "import_youtube"
    if is_video:
        from glosano.modules.lesson_library.video_import import run_video_import

        await run_video_import(lesson_id, job_id)
        return
    async with session_scope() as session:
        repo = LessonRepo(session)
        job = await repo.lock_job(job_id)  # FOR UPDATE: serialize deliveries
        if job is None:
            logger.warning("run_lesson_import: job {} not found", job_id)
            return
        if job.status not in {"pending", "running"}:
            logger.info("run_lesson_import: job {} already {}; skipping", job_id, job.status)
            return
        job.status = "running"
        job.started_at = datetime.now(UTC)
        await session.flush()
        try:
            await process_lesson_import(session, lesson_id)
        except LessonNotProcessableError as exc:
            logger.info("run_lesson_import: skipped {} ({})", lesson_id, exc)
            job.status = "done"
            job.finished_at = datetime.now(UTC)
            return
        except Exception as exc:  # record any failure on the job
            logger.exception("run_lesson_import failed for {}", lesson_id)
            lesson = await repo.get_lesson(lesson_id)
            if lesson is not None:
                lesson.status = "failed"
            job.status = "failed"
            job.error_message = str(exc)
            job.finished_at = datetime.now(UTC)
            return
        job.status = "done"
        job.finished_at = datetime.now(UTC)


@broker.task
async def import_lesson_task(lesson_id: str, job_id: str) -> None:
    """Taskiq entry point: process a lesson import for an exact job."""
    await run_lesson_import(uuid.UUID(lesson_id), uuid.UUID(job_id))


async def enqueue_lesson_import(lesson_id: uuid.UUID, job_id: uuid.UUID) -> None:
    """Enqueue the import task. Patched in tests to isolate the API handler."""
    await import_lesson_task.kiq(str(lesson_id), str(job_id))


@broker.task(schedule=[{"cron": "* * * * *"}])
async def cleanup_expired_video_imports() -> int:
    from glosano.modules.lesson_library.video_import import expire_imports

    async with session_scope() as session:
        return await expire_imports(session)


scheduler = TaskiqScheduler(broker=broker, sources=[LabelScheduleSource(broker)])


@broker.task
async def chat_generation_task(generation_id: str) -> None:
    from glosano.modules.chat.generation import run_generation

    await run_generation(uuid.UUID(generation_id))


async def enqueue_chat_generation(generation_id: uuid.UUID) -> None:
    """Queue failure cannot roll back an acknowledged durable command."""
    try:
        await chat_generation_task.kiq(str(generation_id))
    except Exception:
        logger.warning("Chat enqueue unavailable; generation={}", generation_id)
