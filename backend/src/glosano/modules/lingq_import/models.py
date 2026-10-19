"""Vocabulary import jobs (FLQ-14, ADR-0033).

A job records progress and the report of one import run. It never holds the
LingQ API token: the token lives only in memory for the duration of the run.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Index, Integer, String, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from glosano.core.db import Base


class VocabularyImportJob(Base):
    __tablename__ = "vocabulary_import_jobs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    language_code: Mapped[str] = mapped_column(String(8))
    source: Mapped[str] = mapped_column(String(8))  # csv | lingq
    conflict_mode: Mapped[str] = mapped_column(String(8))  # keep | update
    status: Mapped[str] = mapped_column(
        String(16), default="running", server_default="running"
    )  # running | done | failed | interrupted
    total: Mapped[int | None] = mapped_column(Integer)
    processed: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_tokens: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_phrases: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    updated_items: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    known_words: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    skipped: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    issues_json: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB, default=list, server_default=text("'[]'::jsonb")
    )
    # Issues past the report cap (records.MAX_REPORT_ISSUES): counted, not listed.
    issues_dropped: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    meta_json: Mapped[dict[str, Any] | None] = mapped_column(JSONB)
    error_code: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        CheckConstraint("source IN ('csv', 'lingq')", name="ck_vocabulary_import_jobs_source"),
        CheckConstraint(
            "conflict_mode IN ('keep', 'update')", name="ck_vocabulary_import_jobs_conflict_mode"
        ),
        CheckConstraint(
            "status IN ('running', 'done', 'failed', 'interrupted')",
            name="ck_vocabulary_import_jobs_status",
        ),
        # One running import per user; finished jobs stay as history.
        Index(
            "uq_vocabulary_import_jobs_running",
            "user_id",
            unique=True,
            postgresql_where=text("status = 'running'"),
        ),
    )
