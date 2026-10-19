"""Background import jobs: lifecycle, progress and terminal states (FLQ-14.1)."""

import asyncio
import json
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from loguru import logger
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncSession

from glosano.core.db import session_scope
from glosano.core.security import hash_password
from glosano.modules.identity.repo import UserRepo
from glosano.modules.lingq_import import jobs
from glosano.modules.lingq_import.errors import ImportJobError
from glosano.modules.lingq_import.models import VocabularyImportJob
from glosano.modules.lingq_import.records import MAX_REPORT_ISSUES, ImportIssue


async def _user() -> uuid.UUID:
    async with session_scope() as s:
        user = await UserRepo(s).create(
            email=f"{uuid.uuid4().hex}@t.io",
            password_hash=hash_password("x"),
            display_name="T",
            role="learner",
        )
        await s.flush()
        return user.id


async def _job(user_id: uuid.UUID, *, language_code: str = "pt") -> uuid.UUID:
    async with session_scope() as s:
        job = await jobs.create_job(
            s,
            user_id=user_id,
            language_code=language_code,
            source="csv",
            conflict_mode="keep",
            total=3,
        )
        return job.id


async def _row(job_id: uuid.UUID) -> VocabularyImportJob:
    async with session_scope() as s:
        row = await s.get(VocabularyImportJob, job_id)
        assert row is not None
        return row


async def _get(s: AsyncSession, job_id: uuid.UUID) -> VocabularyImportJob:
    row = await s.get(VocabularyImportJob, job_id)
    assert row is not None
    return row


async def test_create_job_starts_running() -> None:
    user_id = await _user()
    job_id = await _job(user_id)

    row = await _row(job_id)
    assert row.status == "running"
    assert row.total == 3
    assert row.processed == 0
    assert row.issues_json == []
    assert row.issues_dropped == 0
    assert row.finished_at is None


async def test_second_running_job_raises() -> None:
    user_id = await _user()
    await _job(user_id)

    with pytest.raises(jobs.ImportAlreadyRunning):
        await _job(user_id, language_code="es")


async def test_running_jobs_marked_interrupted_on_startup() -> None:
    user_id = await _user()
    job_id = await _job(user_id)

    assert await jobs.mark_interrupted_jobs() >= 1

    row = await _row(job_id)
    assert row.status == "interrupted"
    assert row.error_code == "server_restarted"
    assert row.finished_at is not None
    # the user can start a new import afterwards
    await _job(user_id)


async def test_done_job_stores_report() -> None:
    user_id = await _user()
    job_id = await _job(user_id)

    async def work(report: jobs.JobReport) -> None:
        report.processed = 3
        report.created_tokens = 1
        report.created_phrases = 1
        report.skipped = 1
        report.add_issue(ImportIssue(code="empty_term", row=4))
        report.meta = {"card_keys": ["term"]}

    jobs.launch(job_id, work)
    await jobs.drain()

    row = await _row(job_id)
    assert row.status == "done"
    assert row.error_code is None
    assert row.finished_at is not None
    assert (row.processed, row.created_tokens, row.created_phrases, row.skipped) == (3, 1, 1, 1)
    assert row.issues_json == [{"row": 4, "term": None, "code": "empty_term"}]
    assert row.meta_json == {"card_keys": ["term"]}


async def test_dropped_issues_are_counted_on_the_row() -> None:
    user_id = await _user()
    job_id = await _job(user_id)
    saved = asyncio.Event()
    release = asyncio.Event()

    async def work(report: jobs.JobReport) -> None:
        for row in range(MAX_REPORT_ISSUES + 2):
            report.add_issue(ImportIssue(code="empty_term", row=row))
        await report.save()
        saved.set()
        await release.wait()
        report.add_issue(ImportIssue(code="empty_term", row=0))

    jobs.launch(job_id, work)
    try:
        await asyncio.wait_for(saved.wait(), 5)
        row = await _row(job_id)
        assert (row.status, len(row.issues_json), row.issues_dropped) == (
            "running",
            MAX_REPORT_ISSUES,
            2,
        )
    finally:
        release.set()
        await jobs.drain()
    row = await _row(job_id)
    assert (row.status, len(row.issues_json), row.issues_dropped) == (
        "done",
        MAX_REPORT_ISSUES,
        3,
    )


async def test_progress_saved_while_running() -> None:
    user_id = await _user()
    job_id = await _job(user_id)
    saved = asyncio.Event()
    release = asyncio.Event()

    async def work(report: jobs.JobReport) -> None:
        report.processed = 2
        report.created_tokens = 2
        report.total = 5
        await report.save()
        saved.set()
        await release.wait()

    jobs.launch(job_id, work)
    await asyncio.wait_for(saved.wait(), 5)

    row = await _row(job_id)
    assert row.status == "running"
    assert (row.processed, row.created_tokens, row.total) == (2, 2, 5)

    release.set()
    await jobs.drain()
    assert (await _row(job_id)).status == "done"


async def test_failed_job_stores_code_not_message() -> None:
    user_id = await _user()
    job_id = await _job(user_id)
    logs: list[str] = []
    sink = logger.add(logs.append, level="DEBUG")

    async def work(report: jobs.JobReport) -> None:
        report.processed = 1
        await report.save()
        report.processed = 2  # a batch that rolled back: not written
        report.add_issue(ImportIssue(code="empty_term", row=9))
        raise RuntimeError("secret-xyz")

    try:
        jobs.launch(job_id, work)
        await jobs.drain()
    finally:
        logger.remove(sink)

    async with session_scope() as s:
        row = await _get(s, job_id)
        assert row.status == "failed"
        assert row.error_code == "internal_error"
        assert row.processed == 1
        assert row.issues_json == []
        assert row.finished_at is not None
        columns = {c.key: getattr(row, c.key) for c in VocabularyImportJob.__table__.columns}
    assert "secret-xyz" not in json.dumps(columns, default=str)
    assert "secret-xyz" not in "".join(logs)


async def test_failed_job_uses_domain_error_code() -> None:
    user_id = await _user()
    job_id = await _job(user_id)

    class LingqUnauthorizedError(ImportJobError):
        pass

    async def work(report: jobs.JobReport) -> None:
        raise LingqUnauthorizedError("lingq_unauthorized")

    jobs.launch(job_id, work)
    await jobs.drain()

    row = await _row(job_id)
    assert row.status == "failed"
    assert row.error_code == "lingq_unauthorized"


@pytest.mark.parametrize(
    "error",
    [
        OperationalError("SELECT 1", {}, Exception("connection refused")),
        type("Coded", (Exception,), {"code": "looks_like_a_code"})(),
    ],
)
async def test_non_domain_error_codes_are_internal(error: Exception) -> None:
    user_id = await _user()
    job_id = await _job(user_id)

    async def work(report: jobs.JobReport) -> None:
        raise error

    jobs.launch(job_id, work)
    await jobs.drain()

    row = await _row(job_id)
    assert row.status == "failed"
    assert row.error_code == "internal_error"


async def test_cancel_marks_interrupted() -> None:
    user_id = await _user()
    job_id = await _job(user_id)
    started = asyncio.Event()

    async def work(report: jobs.JobReport) -> None:
        report.processed = 1
        await report.save()
        report.processed = 2  # never saved
        started.set()
        await asyncio.Event().wait()  # never finishes on its own

    jobs.launch(job_id, work)
    await asyncio.wait_for(started.wait(), 5)
    await jobs.shutdown()

    row = await _row(job_id)
    assert row.status == "interrupted"
    assert row.error_code == "server_stopped"
    assert row.processed == 1
    assert row.finished_at is not None


async def test_get_job_is_scoped_to_owner() -> None:
    owner = await _user()
    other = await _user()
    job_id = await _job(owner)

    async with session_scope() as s:
        assert await jobs.get_job(s, user_id=owner, job_id=job_id) is not None
        assert await jobs.get_job(s, user_id=other, job_id=job_id) is None


async def test_active_job_prefers_running_then_recent_finished() -> None:
    user_id = await _user()
    job_id = await _job(user_id)

    async with session_scope() as s:
        active = await jobs.get_active_job(s, user_id=user_id, language_code="pt")
        assert active is not None and active.id == job_id
        assert await jobs.get_active_job(s, user_id=user_id, language_code="es") is None

    jobs.launch(job_id, _noop)
    await jobs.drain()
    async with session_scope() as s:
        active = await jobs.get_active_job(s, user_id=user_id, language_code="pt")
        assert active is not None and active.status == "done"

        row = await _get(s, job_id)
        row.finished_at = datetime.now(UTC) - timedelta(minutes=11)
    async with session_scope() as s:
        assert await jobs.get_active_job(s, user_id=user_id, language_code="pt") is None


async def _noop(report: jobs.JobReport) -> None:
    return None
