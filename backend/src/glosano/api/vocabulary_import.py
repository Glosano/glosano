"""Vocabulary import API: LingQ CSV upload, LingQ API import and job status (FLQ-14, ADR-0033)."""

from __future__ import annotations

import asyncio
import re
import uuid
from collections.abc import Callable, Coroutine
from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter, Form, HTTPException, Request, Response, UploadFile
from fastapi import status as http_status
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from pydantic import BaseModel, Field, SecretStr, field_validator

from glosano.core.db import SessionDep
from glosano.core.languages import LearningLanguageCode
from glosano.core.lesson_upload import MAX_LESSON_FILE_BYTES
from glosano.modules.identity.service import translation_target
from glosano.modules.lingq_import import core, jobs
from glosano.modules.lingq_import.csv_source import CsvFormatError, parse_lingq_csv
from glosano.modules.lingq_import.models import VocabularyImportJob
from glosano.modules.lingq_import.records import ImportOptions


class _NoEchoRoute(APIRoute):
    """Validation errors without the submitted values.

    FastAPI's default 422 body repeats each error's `input` — for a model-level
    error that is the whole request body, which here includes the LingQ token.
    Only `type`, `loc` and `msg` are kept.
    """

    def get_route_handler(self) -> Callable[[Request], Coroutine[Any, Any, Response]]:
        handler = super().get_route_handler()

        async def route_handler(request: Request) -> Response:
            try:
                return await handler(request)
            except RequestValidationError as exc:
                errors = [
                    {key: error[key] for key in ("type", "loc", "msg") if key in error}
                    for error in exc.errors()
                ]
                raise RequestValidationError(errors) from None

        return route_handler


router = APIRouter(
    prefix="/api/vocabulary/import", tags=["vocabulary-import"], route_class=_NoEchoRoute
)

MAX_CONFIDENCE = 5
MAX_LINGQ_TOKEN_LENGTH = 200
_TOKEN_CHARS = re.compile(r"[!-~]+")


class ImportIssueOut(BaseModel):
    row: int | None
    term: str | None
    code: str


class ImportJobOut(BaseModel):
    id: uuid.UUID
    status: Literal["running", "done", "failed", "interrupted"]
    source: Literal["csv", "lingq"]
    language_code: str
    total: int | None
    processed: int
    created_tokens: int
    created_phrases: int
    updated_items: int
    known_words: int
    skipped: int
    issues: list[ImportIssueOut]
    issues_dropped: int
    error_code: str | None
    created_at: datetime
    finished_at: datetime | None


class LingqImportRequest(BaseModel):
    lang: LearningLanguageCode
    # SecretStr keeps the token out of repr() and logs.
    token: SecretStr = Field(min_length=1, max_length=MAX_LINGQ_TOKEN_LENGTH)
    conflict_mode: Literal["keep", "update"] = "keep"
    import_tags: bool = True

    @field_validator("token", mode="before")
    @classmethod
    def _strip_token(cls, value: object) -> object:
        return value.strip() if isinstance(value, str) else value

    @field_validator("token")
    @classmethod
    def _header_safe_token(cls, value: SecretStr) -> SecretStr:
        # The token goes into an HTTP header: printable ASCII, no spaces.
        if not _TOKEN_CHARS.fullmatch(value.get_secret_value()):
            raise ValueError("token must be printable ASCII without spaces")
        return value


def _require_user(request: Request) -> uuid.UUID:
    user_id = getattr(request.state, "user_id", None)
    if user_id is None:
        raise HTTPException(http_status.HTTP_401_UNAUTHORIZED)
    return user_id


def _job_out(job: VocabularyImportJob) -> ImportJobOut:
    return ImportJobOut.model_validate(
        {
            "id": job.id,
            "status": job.status,
            "source": job.source,
            "language_code": job.language_code,
            "total": job.total,
            "processed": job.processed,
            "created_tokens": job.created_tokens,
            "created_phrases": job.created_phrases,
            "updated_items": job.updated_items,
            "known_words": job.known_words,
            "skipped": job.skipped,
            "issues": job.issues_json,
            "issues_dropped": job.issues_dropped,
            "error_code": job.error_code,
            "created_at": job.created_at,
            "finished_at": job.finished_at,
        }
    )


@router.post("/csv", status_code=http_status.HTTP_202_ACCEPTED, response_model=ImportJobOut)
async def import_csv(
    request: Request,
    session: SessionDep,
    file: UploadFile,
    lang: LearningLanguageCode = Form(),
    status: Literal["tracked", "known"] = Form("tracked"),
    confidence: int | None = Form(1),
    import_tags: bool = Form(True),
) -> ImportJobOut:
    user_id = _require_user(request)
    try:
        if status == "known":
            confidence = None
        elif confidence is None or not 0 <= confidence <= MAX_CONFIDENCE:
            raise HTTPException(http_status.HTTP_422_UNPROCESSABLE_CONTENT, "invalid_confidence")
        content = await file.read(MAX_LESSON_FILE_BYTES + 1)
        if len(content) > MAX_LESSON_FILE_BYTES:
            raise HTTPException(http_status.HTTP_413_CONTENT_TOO_LARGE, "csv_too_large")
    finally:
        await file.close()
    try:
        cards, parse_issues = await asyncio.to_thread(parse_lingq_csv, content)
    except CsvFormatError as exc:
        raise HTTPException(http_status.HTTP_422_UNPROCESSABLE_CONTENT, exc.code) from None

    options = ImportOptions(
        language_code=lang,
        source="csv",
        conflict_mode="keep",
        import_tags=import_tags,
        native_language=await translation_target(session, user_id),
        default_status=status,
        default_confidence=confidence,
    )
    try:
        job = await jobs.create_job(
            session,
            user_id=user_id,
            language_code=lang,
            source="csv",
            conflict_mode="keep",
            total=len(cards) + len(parse_issues),
        )
    except jobs.ImportAlreadyRunning:
        raise HTTPException(http_status.HTTP_409_CONFLICT, "import_already_running") from None

    async def work(report: jobs.JobReport) -> None:
        # Rows the parser already rejected count as processed and skipped up front.
        for issue in parse_issues:
            report.add_issue(issue)
        report.processed += len(parse_issues)
        report.skipped += len(parse_issues)
        await core.import_cards(
            cards, user_id=user_id, options=options, report=report, on_batch=report.save
        )

    jobs.launch(job.id, work)
    return _job_out(job)


@router.post("/lingq", status_code=http_status.HTTP_202_ACCEPTED, response_model=ImportJobOut)
async def import_lingq(
    request: Request, session: SessionDep, body: LingqImportRequest
) -> ImportJobOut:
    user_id = _require_user(request)
    options = ImportOptions(
        language_code=body.lang,
        source="lingq",
        conflict_mode=body.conflict_mode,
        import_tags=body.import_tags,
        native_language=await translation_target(session, user_id),
    )
    try:
        job = await jobs.create_job(
            session,
            user_id=user_id,
            language_code=body.lang,
            source="lingq",
            conflict_mode=body.conflict_mode,
            total=None,  # the first LingQ page tells the count
        )
    except jobs.ImportAlreadyRunning:
        raise HTTPException(http_status.HTTP_409_CONFLICT, "import_already_running") from None
    # The token goes only into the job's in-memory work closure (never the job row).
    jobs.launch(
        job.id,
        jobs.lingq_work(body.token.get_secret_value(), user_id=user_id, options=options),
    )
    return _job_out(job)


# Declared before /{job_id} so "active" is not parsed as a job id.
@router.get("/active", response_model=ImportJobOut | None)
async def active_import(
    request: Request, session: SessionDep, lang: LearningLanguageCode
) -> ImportJobOut | None:
    user_id = _require_user(request)
    job = await jobs.get_active_job(session, user_id=user_id, language_code=lang)
    return _job_out(job) if job is not None else None


@router.get("/{job_id}", response_model=ImportJobOut)
async def get_import(request: Request, session: SessionDep, job_id: uuid.UUID) -> ImportJobOut:
    user_id = _require_user(request)
    job = await jobs.get_job(session, user_id=user_id, job_id=job_id)
    if job is None:
        raise HTTPException(http_status.HTTP_404_NOT_FOUND, "import_not_found")
    return _job_out(job)
