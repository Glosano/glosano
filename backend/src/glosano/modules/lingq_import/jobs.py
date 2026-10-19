"""Vocabulary import jobs: row lifecycle and the in-process asyncio runner (FLQ-14.1, ADR-0033).

An import runs as an `asyncio.Task` inside app-api, not in the Taskiq worker: the
LingQ token must stay in this process's memory and never reach Redis. The job row
holds progress and the report; it is written in short transactions after every
batch and once more with the terminal status.

Exception messages are never written to the row or the logs, only codes: they may
carry user content or the LingQ token.
"""

from __future__ import annotations

import asyncio
import uuid
from collections import Counter
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from loguru import logger
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from glosano.core.config import get_settings
from glosano.core.db import session_scope
from glosano.modules.lingq_import import core
from glosano.modules.lingq_import.errors import ImportJobError
from glosano.modules.lingq_import.lingq_client import (
    LingqClient,
    card_from_api,
    lingq_language_code,
)
from glosano.modules.lingq_import.models import VocabularyImportJob
from glosano.modules.lingq_import.records import ImportOptions, ImportReport

ACTIVE_FINISHED_WINDOW = timedelta(minutes=10)
_RUNNING_INDEX = "uq_vocabulary_import_jobs_running"
_MAX_ERROR_CODE = 64
# meta_json caps: LingQ responses are untrusted, the row must stay small.
_MAX_META_KEYS = 100
_MAX_META_KEY_LENGTH = 64
_MAX_META_STATUS_VALUES = 50

_tasks: set[asyncio.Task[None]] = set()


class ImportAlreadyRunning(Exception):  # noqa: N818 -- name fixed by the plan interface
    """The user already has a running import."""


@dataclass
class JobReport(ImportReport):
    """The report a job's work fills in, bound to its job row.

    `total` and `meta` are written only when set. Pass `save` as `on_batch` to
    `import_cards` to persist progress after every batch.
    """

    job_id: uuid.UUID = field(kw_only=True)
    total: int | None = None
    meta: dict[str, Any] | None = None

    async def save(self, _report: ImportReport | None = None) -> None:
        """Write the current counters, issues, total and meta to the running job."""
        async with session_scope() as session:
            await session.execute(
                update(VocabularyImportJob)
                .where(
                    VocabularyImportJob.id == self.job_id, VocabularyImportJob.status == "running"
                )
                .values(**_progress_values(self))
            )


Work = Callable[[JobReport], Awaitable[None]]


def _default_lingq_client(token: str) -> LingqClient:
    settings = get_settings()
    return LingqClient(
        token,
        base_url=settings.lingq_base_url,
        timeout=settings.lingq_timeout_seconds,
        page_delay=settings.lingq_page_delay_seconds,
    )


# Builds the LingQ client from the token; tests swap it for a MockTransport client.
lingq_client_factory: Callable[[str], LingqClient] = _default_lingq_client


def lingq_work(token: str, *, user_id: uuid.UUID, options: ImportOptions) -> Work:
    """The job work of a LingQ API import.

    The token stays in this closure and the client it builds: it is never put on
    the report, the job row, the meta or a log line.
    """

    async def work(report: JobReport) -> None:
        client = lingq_client_factory(token)
        state = core.ImportState()  # one per job: a term repeated on a later page merges
        card_keys: set[str] = set()
        status_values: Counter[str] = Counter()
        first_page = True
        async for count, results in client.iter_card_pages(
            lingq_language_code(options.language_code)
        ):
            if first_page:
                report.total = count
                first_page = False
            _collect_meta(results, card_keys, status_values)
            report.meta = {
                "card_keys": sorted(card_keys),
                "status_values": dict(status_values),
            }
            await report.save()
            await core.import_cards(
                [card_from_api(raw) for raw in results],
                user_id=user_id,
                options=options,
                report=report,
                on_batch=report.save,
                state=state,
            )

    return work


def _collect_meta(
    results: list[dict[str, Any]], card_keys: set[str], status_values: Counter[str]
) -> None:
    """Field names and status pairs seen in LingQ cards — never card values (Task 10)."""
    for raw in results:
        for key in raw:
            if len(card_keys) >= _MAX_META_KEYS:
                break
            if len(key) <= _MAX_META_KEY_LENGTH:
                card_keys.add(key)
        pair = f"{_status_part(raw.get('status'))}/{_status_part(raw.get('extended_status'))}"
        if pair in status_values or len(status_values) < _MAX_META_STATUS_VALUES:
            status_values[pair] += 1


def _status_part(value: object) -> str:
    if value is None:
        return "none"
    if isinstance(value, int) and not isinstance(value, bool) and -1000 < value < 1000:
        return str(value)
    return "other"


async def create_job(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    language_code: str,
    source: Literal["csv", "lingq"],
    conflict_mode: Literal["keep", "update"],
    total: int | None,
) -> VocabularyImportJob:
    """Insert a running job and commit, so the background task sees the row.

    Raises `ImportAlreadyRunning` when the user already has a running job.
    """
    job = VocabularyImportJob(
        user_id=user_id,
        language_code=language_code,
        source=source,
        conflict_mode=conflict_mode,
        status="running",
        total=total,
    )
    session.add(job)
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        if _RUNNING_INDEX in str(exc.orig):
            raise ImportAlreadyRunning from None
        raise
    await session.refresh(job)
    return job


def launch(job_id: uuid.UUID, work: Work) -> None:
    """Run `work` for the job as a background task; the task finishes the job row."""
    task = asyncio.create_task(_run(job_id, work), name=f"vocabulary-import-{job_id}")
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


async def _run(job_id: uuid.UUID, work: Work) -> None:
    report = JobReport(job_id=job_id)
    try:
        await work(report)
    except asyncio.CancelledError:
        await _finish(report, "interrupted", "server_stopped")
        raise
    except Exception as exc:
        code = _error_code(exc)
        logger.warning("Vocabulary import {} failed: {} ({})", job_id, code, type(exc).__name__)
        await _finish(report, "failed", code)
    else:
        await _finish(report, "done", None)


async def _finish(report: JobReport, status: str, error_code: str | None) -> None:
    values: dict[str, Any] = {"status": status, "error_code": error_code, "finished_at": func.now()}
    if status == "done":
        values |= _progress_values(report)
    # A failed or interrupted run keeps the counters of its last `save()`: the
    # in-memory report may include a batch whose transaction rolled back.
    try:
        async with session_scope() as session:
            await session.execute(
                update(VocabularyImportJob)
                .where(
                    VocabularyImportJob.id == report.job_id,
                    VocabularyImportJob.status == "running",
                )
                .values(**values)
            )
    except Exception as exc:
        # The row stays running until the next startup marks it interrupted.
        logger.error(
            "Vocabulary import {} could not be finished ({})", report.job_id, type(exc).__name__
        )


def _progress_values(report: JobReport) -> dict[str, Any]:
    values: dict[str, Any] = {
        "processed": report.processed,
        "created_tokens": report.created_tokens,
        "created_phrases": report.created_phrases,
        "updated_items": report.updated_items,
        "known_words": report.known_words,
        "skipped": report.skipped,
        "issues_json": [
            {"row": issue.row, "term": issue.term, "code": issue.code} for issue in report.issues
        ],
        "issues_dropped": report.issues_dropped,
    }
    if report.total is not None:
        values["total"] = report.total
    if report.meta is not None:
        values["meta_json"] = report.meta
    return values


def _error_code(exc: Exception) -> str:
    # Only domain errors carry user-facing codes; e.g. SQLAlchemy errors have a
    # class-level `code` too, which must not leak into the job.
    if isinstance(exc, ImportJobError) and 0 < len(exc.code) <= _MAX_ERROR_CODE:
        return exc.code
    return "internal_error"


async def mark_interrupted_jobs() -> int:
    """On startup: jobs left running by a previous process can no longer progress."""
    async with session_scope() as session:
        result = await session.execute(
            update(VocabularyImportJob)
            .where(VocabularyImportJob.status == "running")
            .values(status="interrupted", error_code="server_restarted", finished_at=func.now())
        )
    count: int = getattr(result, "rowcount", 0) or 0
    if count:
        logger.info("Marked {} vocabulary import job(s) as interrupted", count)
    return count


async def shutdown() -> None:
    """Cancel running imports; their jobs become interrupted."""
    tasks = list(_tasks)
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)


async def drain() -> None:
    """Wait for every launched import to finish (tests)."""
    while pending := [task for task in _tasks if not task.done()]:
        await asyncio.gather(*pending, return_exceptions=True)


async def get_job(
    session: AsyncSession, *, user_id: uuid.UUID, job_id: uuid.UUID
) -> VocabularyImportJob | None:
    return await session.scalar(
        select(VocabularyImportJob).where(
            VocabularyImportJob.id == job_id, VocabularyImportJob.user_id == user_id
        )
    )


async def get_active_job(
    session: AsyncSession, *, user_id: uuid.UUID, language_code: str
) -> VocabularyImportJob | None:
    """The running job for the language, else the latest one if it finished recently."""
    of_language = (
        select(VocabularyImportJob)
        .where(
            VocabularyImportJob.user_id == user_id,
            VocabularyImportJob.language_code == language_code,
        )
        .order_by(VocabularyImportJob.created_at.desc())
        .limit(1)
    )
    running = await session.scalar(of_language.where(VocabularyImportJob.status == "running"))
    if running is not None:
        return running
    latest = await session.scalar(of_language)
    if (
        latest is not None
        and latest.finished_at is not None
        and latest.finished_at >= datetime.now(UTC) - ACTIVE_FINISHED_WINDOW
    ):
        return latest
    return None
